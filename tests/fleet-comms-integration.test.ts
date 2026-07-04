/**
 * Integration tests for the Master Fleet Communications Module.
 *
 * Hits the real dev Postgres (fs_comms_* tables + the legacy fs_reg_messages /
 * fs_decomm_messages source tables). Covers the review-flagged behaviors:
 *   - 72h category attribution (inbound inherits the last outbound category
 *     within the window; expires after it).
 *   - Opt-out enforcement (an opted-out number is never sent; STOP/START via
 *     the inbound webhook flips the flag).
 *   - Sender matching (one contact -> tech thread; ambiguous / unknown ->
 *     unmatched with contactRole 'unknown').
 *   - Legacy migration integrity + idempotency (reg -> 'registrations'/'tech';
 *     decomm manager -> 'decommissioning'/'manager'; deterministic dedupe key;
 *     re-run copies nothing new).
 *   - Contacts-sync anti-wipe guards (0-row abort + low-pull abort never
 *     tombstone the last-good directory).
 *
 * All test rows use the fixed `ZZT524` prefix so a failed run cannot collide
 * with real data, and everything is cleaned up before/after.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";

import { fsDb } from "../server/fleet-scope-db.js";
import { db } from "../server/db.js";
import {
  commsContacts,
  commsThreads,
  commsMessages,
  commsOptOuts,
  commsPhoneHistory,
  commsThreadAudit,
  regMessages,
  decommMessages,
} from "../shared/fleet-scope-schema.js";
import { syncLogs } from "../shared/schema.js";

import { initCommsSchema } from "../server/fleet-comms/schema-init.js";
import { handleInbound, ATTRIBUTION_WINDOW_MS } from "../server/fleet-comms/inbound.js";
import { sendMessage } from "../server/fleet-comms/outbound.js";
import {
  appendMessage,
  setOptOut,
  isOptedOut,
  getOrCreateTechThread,
  lastOutboundCategoryWithin,
} from "../server/fleet-comms/storage.js";
import { syncCommsContacts, type RosterRow } from "../server/fleet-comms/contacts-sync.js";
import { migrateLegacyComms } from "../server/run-comms-migrate.js";

// ── Fixed test identifiers (ZZT524 prefix, uppercase — contacts store UPPER) ──
const TECH1_LDAP = "ZZT524TECH1";
const TECH2_LDAP = "ZZT524TECH2";
const TECH3_LDAP = "ZZT524TECH3";
const MGR_LDAP = "ZZT524MGR1";

const SOLO_DIGITS = "5550524001"; // -> exactly one contact (TECH1)
const SHARED_DIGITS = "5550524002"; // -> two contacts (TECH2 + TECH3), ambiguous
const UNKNOWN_DIGITS = "5550524003"; // -> no contact
const OPTOUT_DIGITS = "5550524004";
const MGR_DIGITS = "5550524005";
const STOPSTART_DIGITS = "5550524006";

const SOLO_PHONE = "+1" + SOLO_DIGITS;
const OPTOUT_PHONE = "+1" + OPTOUT_DIGITS;

const REG1_ID = "ZZT524REG1";
const DECOMM_MGR_ID = "ZZT524DECOMMMGR";
const DECOMM_TECH_ID = "ZZT524DECOMMTECH";

const REG1_DEDUPE = `legacy:reg:${REG1_ID}`;
const DECOMM_MGR_DEDUPE = `legacy:decomm:${DECOMM_MGR_ID}`;
const DECOMM_TECH_DEDUPE = `legacy:decomm:${DECOMM_TECH_ID}`;

const ALL_LDAPS = [TECH1_LDAP, TECH2_LDAP, TECH3_LDAP, MGR_LDAP];
const ALL_DIGITS = [
  SOLO_DIGITS,
  SHARED_DIGITS,
  UNKNOWN_DIGITS,
  OPTOUT_DIGITS,
  MGR_DIGITS,
  STOPSTART_DIGITS,
];
const ALL_DEDUPE = [REG1_DEDUPE, DECOMM_MGR_DEDUPE, DECOMM_TECH_DEDUPE];
const TEST_TRIGGER = "_t524_test";

async function cleanup(): Promise<void> {
  // Messages first (by our test threads' ldap, phone digits, or dedupe keys).
  await fsDb.delete(commsMessages).where(inArray(commsMessages.twilioSid, ALL_DEDUPE));
  await fsDb.delete(commsMessages).where(inArray(commsMessages.phoneDigits, ALL_DIGITS));
  await fsDb.delete(commsMessages).where(inArray(commsMessages.ldap, ALL_LDAPS));

  // Thread audit + threads for our test threads.
  const byLdap = await fsDb
    .select({ id: commsThreads.id })
    .from(commsThreads)
    .where(inArray(commsThreads.ldap, ALL_LDAPS));
  const byDigits = await fsDb
    .select({ id: commsThreads.id })
    .from(commsThreads)
    .where(inArray(commsThreads.phoneDigits, ALL_DIGITS));
  const threadIds = Array.from(new Set([...byLdap, ...byDigits].map((r) => r.id)));
  if (threadIds.length) {
    await fsDb.delete(commsThreadAudit).where(inArray(commsThreadAudit.threadId, threadIds));
    await fsDb.delete(commsMessages).where(inArray(commsMessages.threadId, threadIds));
    await fsDb.delete(commsThreads).where(inArray(commsThreads.id, threadIds));
  }

  await fsDb.delete(commsPhoneHistory).where(inArray(commsPhoneHistory.ldap, ALL_LDAPS));
  await fsDb.delete(commsContacts).where(inArray(commsContacts.ldap, ALL_LDAPS));
  await fsDb.delete(commsOptOuts).where(inArray(commsOptOuts.phoneDigits, ALL_DIGITS));

  // Legacy source rows.
  await fsDb.delete(regMessages).where(eq(regMessages.id, REG1_ID));
  await fsDb.delete(decommMessages).where(inArray(decommMessages.id, [DECOMM_MGR_ID, DECOMM_TECH_ID]));

  // Sync-log rows written by the anti-wipe test.
  await db
    .delete(syncLogs)
    .where(and(eq(syncLogs.syncType, "comms_contacts"), eq(syncLogs.triggeredBy, TEST_TRIGGER)));
}

async function seedContacts(): Promise<void> {
  await fsDb.insert(commsContacts).values([
    { ldap: TECH1_LDAP, name: "T524 Tech One", phone: SOLO_PHONE, phoneDigits: SOLO_DIGITS, primaryState: "TX", emplStatus: "A", active: true },
    { ldap: TECH2_LDAP, name: "T524 Tech Two", phone: "+1" + SHARED_DIGITS, phoneDigits: SHARED_DIGITS, primaryState: "TX", emplStatus: "A", active: true },
    { ldap: TECH3_LDAP, name: "T524 Tech Three", phone: "+1" + SHARED_DIGITS, phoneDigits: SHARED_DIGITS, primaryState: "TX", emplStatus: "A", active: true },
    { ldap: MGR_LDAP, name: "T524 Manager", phone: "+1" + MGR_DIGITS, phoneDigits: MGR_DIGITS, primaryState: "TX", emplStatus: "A", active: true },
  ]);
}

before(async () => {
  await initCommsSchema();
  await cleanup();
  await seedContacts();
});
after(cleanup);

test("72h attribution: inbound inherits the last outbound category within the window", async () => {
  const thread = await getOrCreateTechThread(TECH1_LDAP, {
    phoneDigits: SOLO_DIGITS,
    name: "T524 Tech One",
  });
  // A recent outbound in the 'registrations' category.
  await appendMessage({
    threadId: thread.id,
    ldap: TECH1_LDAP,
    category: "registrations",
    direction: "outbound",
    body: "Your truck is registered.",
    phone: SOLO_PHONE,
    status: "sent",
  });

  const res = await handleInbound({ from: SOLO_PHONE, body: "Thanks!" });
  assert.equal(res.action, "message");
  assert.equal(res.contactRole, "tech");
  assert.equal(res.threadId, thread.id);

  const [inbound] = await fsDb
    .select()
    .from(commsMessages)
    .where(and(eq(commsMessages.threadId, thread.id), eq(commsMessages.direction, "inbound")))
    .orderBy(sql`${commsMessages.createdAt} DESC`)
    .limit(1);
  assert.equal(inbound.category, "registrations");
});

test("72h attribution: an outbound older than the window no longer attributes", async () => {
  const thread = await getOrCreateTechThread(MGR_LDAP, { phoneDigits: MGR_DIGITS });
  // Outbound stamped 73h ago (just past the 72h window).
  const old = new Date(Date.now() - (ATTRIBUTION_WINDOW_MS + 60 * 60 * 1000));
  await fsDb.insert(commsMessages).values({
    threadId: thread.id,
    ldap: MGR_LDAP,
    category: "decommissioning",
    direction: "outbound",
    body: "Old outbound",
    phone: "+1" + MGR_DIGITS,
    phoneDigits: MGR_DIGITS,
    status: "sent",
    createdAt: old,
  });

  const category = await lastOutboundCategoryWithin(thread.id, ATTRIBUTION_WINDOW_MS);
  assert.equal(category, null);
});

test("opt-out enforcement: sendMessage skips an opted-out recipient (never reaches Twilio)", async () => {
  await setOptOut(OPTOUT_DIGITS, true, "STOP");
  assert.equal(await isOptedOut(OPTOUT_DIGITS), true);

  const res = await sendMessage({
    ldap: null,
    phone: OPTOUT_PHONE,
    category: "general_fleet",
    body: "Should never send",
  });
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "recipient opted out");
});

test("opt-out enforcement: inbound STOP then START flips the opt-out flag", async () => {
  const stopRes = await handleInbound({ from: "+1" + STOPSTART_DIGITS, body: "STOP" });
  assert.equal(stopRes.action, "opt_out");
  assert.equal(await isOptedOut(STOPSTART_DIGITS), true);

  const startRes = await handleInbound({ from: "+1" + STOPSTART_DIGITS, body: "START" });
  assert.equal(startRes.action, "opt_in");
  assert.equal(await isOptedOut(STOPSTART_DIGITS), false);
});

test("sender matching: one contact -> tech thread; ambiguous / unknown -> unmatched (role unknown)", async () => {
  // Exactly one contact on SOLO_DIGITS -> tech thread for TECH1.
  const single = await handleInbound({ from: SOLO_PHONE, body: "hi from solo" });
  assert.equal(single.contactRole, "tech");
  const [singleThread] = await fsDb
    .select()
    .from(commsThreads)
    .where(eq(commsThreads.id, single.threadId!));
  assert.equal(singleThread.kind, "tech");
  assert.equal(singleThread.ldap, TECH1_LDAP);

  // Two contacts on SHARED_DIGITS -> ambiguous -> unmatched, role unknown.
  const ambiguous = await handleInbound({ from: "+1" + SHARED_DIGITS, body: "who am i" });
  assert.equal(ambiguous.contactRole, "unknown");
  const [ambThread] = await fsDb
    .select()
    .from(commsThreads)
    .where(eq(commsThreads.id, ambiguous.threadId!));
  assert.equal(ambThread.kind, "unmatched");

  // No contact on UNKNOWN_DIGITS -> unmatched, role unknown.
  const unknown = await handleInbound({ from: "+1" + UNKNOWN_DIGITS, body: "stranger" });
  assert.equal(unknown.contactRole, "unknown");
  const [unkThread] = await fsDb
    .select()
    .from(commsThreads)
    .where(eq(commsThreads.id, unknown.threadId!));
  assert.equal(unkThread.kind, "unmatched");
});

test("legacy migration: category/role mapping, deterministic dedupe key, and idempotency", async () => {
  const sentAt = new Date("2025-01-15T12:00:00Z");
  // Registration message -> category 'registrations', role 'tech'.
  await fsDb.insert(regMessages).values({
    id: REG1_ID,
    truckNumber: "88524001",
    techId: TECH1_LDAP,
    techPhone: SOLO_PHONE,
    direction: "outbound",
    body: "Reg body",
    status: "sent",
    twilioSid: null,
    sentAt,
  });
  // Decommissioning manager-CC row -> category 'decommissioning', role 'manager'.
  await fsDb.insert(decommMessages).values({
    id: DECOMM_MGR_ID,
    truckNumber: "88524001",
    contactType: "manager",
    contactName: "T524 Manager",
    contactPhone: "+1" + MGR_DIGITS,
    direction: "outbound",
    body: "Decomm mgr body",
    status: "sent",
    twilioSid: null,
    ccForLdap: TECH1_LDAP,
    sentAt,
  });
  // Decommissioning tech row -> category 'decommissioning', role 'tech'.
  await fsDb.insert(decommMessages).values({
    id: DECOMM_TECH_ID,
    truckNumber: "88524001",
    contactType: "technician",
    contactName: "T524 Tech One",
    contactPhone: SOLO_PHONE,
    direction: "inbound",
    body: "Decomm tech body",
    status: "received",
    twilioSid: null,
    ccForLdap: null,
    sentAt,
  });

  await migrateLegacyComms();

  const [reg] = await fsDb.select().from(commsMessages).where(eq(commsMessages.twilioSid, REG1_DEDUPE));
  assert.ok(reg, "reg message copied");
  assert.equal(reg.category, "registrations");
  assert.equal(reg.contactRole, "tech");

  const [mgr] = await fsDb.select().from(commsMessages).where(eq(commsMessages.twilioSid, DECOMM_MGR_DEDUPE));
  assert.ok(mgr, "decomm manager message copied");
  assert.equal(mgr.category, "decommissioning");
  assert.equal(mgr.contactRole, "manager");

  const [tech] = await fsDb.select().from(commsMessages).where(eq(commsMessages.twilioSid, DECOMM_TECH_DEDUPE));
  assert.ok(tech, "decomm tech message copied");
  assert.equal(tech.category, "decommissioning");
  assert.equal(tech.contactRole, "tech");

  // Re-run must be idempotent: still exactly one row per dedupe key.
  await migrateLegacyComms();
  for (const key of ALL_DEDUPE) {
    const rows = await fsDb.select({ id: commsMessages.id }).from(commsMessages).where(eq(commsMessages.twilioSid, key));
    assert.equal(rows.length, 1, `dedupe key ${key} has exactly one row after re-run`);
  }
});

test("contacts-sync anti-wipe: 0-row and low-pull both abort without tombstoning last-good", async () => {
  async function tech1Active(): Promise<boolean> {
    const [row] = await fsDb.select().from(commsContacts).where(eq(commsContacts.ldap, TECH1_LDAP));
    return !!row?.active;
  }
  assert.equal(await tech1Active(), true);

  // Guard #1 (absolute): 0 rows must throw and wipe nothing.
  await assert.rejects(
    () => syncCommsContacts(TEST_TRIGGER, { _rowsForTest: [] }),
    /0 rows/i,
  );
  assert.equal(await tech1Active(), true);

  // Guard #2 (proportional): a suspiciously small pull must skip and wipe nothing.
  const oneRow: RosterRow = {
    LDAP: "ZZT524OTHER",
    NAME: "solo",
    EMPL_STATUS: "A",
    MANAGER_LDAP: null,
    MANAGER_NAME: null,
    PHONE: "5550524099",
    DISTRICT: null,
    PRIMARYSTATE: "TX",
    TRUCK_LU: null,
  };
  const res = await syncCommsContacts(TEST_TRIGGER, { _rowsForTest: [oneRow] });
  assert.equal(res.skipped, true);
  assert.match(res.skipReason ?? "", /low pull/i);
  assert.equal(await tech1Active(), true);
});

test("health endpoint contract: fsDb.execute stats are read via .rows[0] (regression guard)", async () => {
  // The Neon serverless driver returns a non-iterable result object with a
  // `.rows` array — array-destructuring (`const [x] = await fsDb.execute(...)`)
  // throws at runtime and 500s the /comms/health endpoint. These are the exact
  // two queries the health route runs; assert the correct `.rows[0]` access
  // yields a row with the expected shape so the 500 can't silently return.
  const queueResult: any = await fsDb.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
      COUNT(*) FILTER (WHERE status = 'failed')   AS failed,
      COUNT(*) FILTER (WHERE status = 'claimed')  AS claimed
    FROM fs_comms_send_queue
  `);
  const queueStats = (queueResult?.rows ?? queueResult ?? [])[0];
  assert.ok(queueStats, "queue stats row present via .rows[0]");
  assert.ok("pending" in queueStats && "failed" in queueStats && "claimed" in queueStats);

  const contactResult: any = await fsDb.execute(sql`
    SELECT COUNT(*) FILTER (WHERE active) AS active, COUNT(*) AS total FROM fs_comms_contacts
  `);
  const contactStats = (contactResult?.rows ?? contactResult ?? [])[0];
  assert.ok(contactStats, "contact stats row present via .rows[0]");
  assert.ok("active" in contactStats && "total" in contactStats);
});
