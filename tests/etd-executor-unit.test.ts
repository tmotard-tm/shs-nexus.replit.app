/**
 * In-server booking executor — lane behaviour, against the real DEV database.
 *
 * The executor is what turns a staff click into an actual Enterprise reservation, so
 * the things worth pinning are the ones that decide whether a REAL booking happens:
 * which lane an intent lands in, what has to be true before the commit call is
 * reachable, and what it records when it stops. Every external system is substituted
 * (the ETD client and the Snowflake-backed schedule read are injected), but the
 * orchestrator, its claim/lease/fencing rules and the attempt ledger are the real ones
 * on the real schema — those are exactly the parts a mock would make lie.
 *
 * Fixtures are WORKFLOW_REQUEST intents on purpose: a request workflow files no route
 * block and sends no technician texts (block_state is born 'not_applicable'), so
 * driving one to completion cannot reach ART or Twilio even by accident.
 *
 * The orchestrator's own server-side schedule re-check (a real Snowflake-backed read,
 * NOT the executor's injected one) is CUTOVER-ONLY at every home — preview, confirm
 * and op_open. Request fixtures therefore pass through it untouched even though
 * ZZEXEC ldaps have no Snowflake schedule; the preview assertions are still written
 * against the RUNNER-owned failure codes so they cannot pass for the wrong reason.
 *
 * All fixtures use ZZEXEC* ldaps and are deleted in before()/after().
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import {
  WORKFLOW_CUTOVER,
  WORKFLOW_REQUEST,
  isContractBlockLive,
  etTodayISO,
  claimBookingWork,
  quoteWithReportedFallback,
  type QueueItem,
  type ScheduleWindow,
} from "../server/vrm/forms/cutover-orchestrator";
import {
  runBookingExecutor,
  bookingRequestHash,
  extractJourneyRows,
  identifyJourneyRows,
  possibleUnlinkedRows,
  mergePossibleUnlinked,
  POSSIBLE_UNLINKED_CAP,
  parseConfirmation,
  intentAddress,
  scrubPlaceholder,
  classForIntent,
  quoteWithReportedFallback,
  redactedShape,
} from "../server/vrm/etd/executor";
import { resolvePickupWindow } from "../server/vrm/etd/pickup-window";
import { safeErrorText, rejectionMessage, rejectionReasons, EtdClient as EtdClientImpl } from "../server/vrm/etd/client";
import { useAccountAdditionalInfo, assertAdditionalInfoComplete } from "../server/vrm/etd/surgery";
import type { EtdClient, CarClass } from "../server/vrm/etd/client";

const LDAP_PREFIX = "ZZEXEC";

// --------------------------------------------------------------------- fakes

const CLASSES: CarClass[] = [
  { code: "ECAR", description: "Economy Car", passengers: "4", bags: "2", base_rate: 30, estimated_total: null, currency: "USD", unit: null, unlimited_miles: null },
  { code: "ICAR", description: "Intermediate Car", passengers: "5", bags: "3", base_rate: 40, estimated_total: null, currency: "USD", unit: null, unlimited_miles: null },
  { code: "FCAR", description: "Full Size Car", passengers: "5", bags: "4", base_rate: 50, estimated_total: null, currency: "USD", unit: null, unlimited_miles: null },
  { code: "MVAR", description: "Minivan", passengers: "7", bags: "5", base_rate: 70, estimated_total: null, currency: "USD", unit: null, unlimited_miles: null },
];

/**
 * What account XZ79406 defines TODAY: one mandatory field. The capture in
 * reference/savedr_request.json still carries two, the second being `Truck Number`
 * (gid 91912527020037), which Enterprise removed from the account after the 2026-08-13
 * wave. Sending the removed field is what savedr answers with
 * `REQUIRED FIELD MISSING: ADDITIONALINFO`.
 */
const ACCOUNT_ADDITIONAL_INFO = [
  {
    additionalInformationGid: "91991858282501",
    sequence: 1,
    fieldTypeCode: 5,
    fieldName: "LDAP ",
    fieldValue: null,
    mandatory: true,
    includeInReservation: false,
    isBillingRef: false,
  },
];

type FakeOpts = {
  branchCode?: string;
  classes?: CarClass[];
  gateOk?: boolean;
  confirmOut?: unknown;
  confirmThrows?: boolean;
  journeys?: unknown;
  searchThrows?: boolean;
  user?: Record<string, unknown> | null;
  addInfoFields?: unknown[];
  addInfoThrows?: boolean;
  /** Simulate the client's nearbyOnEmpty walk having moved off an empty branch. */
  fallbackFrom?: { code: string; name: string };
};

/** Records what was called so a test can assert the commit was never reached. */
function fakeEtd(opts: FakeOpts = {}) {
  const calls: string[] = [];
  /** Every model handed to the commit, so a test can assert what was actually sent. */
  const sent: unknown[] = [];
  const code = opts.branchCode ?? "9911";
  const client = {
    calls: [],
    async quote(p: any) {
      calls.push(`quote:${p.preferBranchCode ?? ""}`);
      return {
        journey_id: "j-fake-1",
        reference: "R-FAKE-1",
        place: { latitude: "41.1", longitude: "-81.5" },
        branch: {
          branchCode: code,
          customerFacingBranchName: "Testville Central",
          fullAddress: "100 EXAMPLE WAY,TESTVILLE,OH,44100",
          latitude: "41.1",
          longitude: "-81.5",
          peoplesoftBranchId: "PS9911",
          stationId: "ST9911",
          formattedPhoneNumber: "(+1) 555-0100",
        },
        branch_pinned: true,
        branch_code: code,
        branch_name: "Testville Central",
        branch_address: "100 EXAMPLE WAY,TESTVILLE,OH,44100",
        site: {},
        classes: opts.classes ?? CLASSES,
        ...(opts.fallbackFrom
          ? {
              branch_fallback_from_code: opts.fallbackFrom.code,
              branch_fallback_from_name: opts.fallbackFrom.name,
              branch_fallback_tried: 1,
            }
          : {}),
      };
    },
    async findUserByUsername(u: string) {
      calls.push(`user:${u}`);
      return opts.user === undefined
        ? { userId: "u-fake", firstName: "Pat", lastName: "Sample", emailAddress: "p@example.invalid", userName: u }
        : opts.user;
    },
    async searchJourneys() {
      calls.push("search");
      if (opts.searchThrows) throw new Error("ETD search 503");
      return opts.journeys ?? { data: [] };
    },
    async postGate(p: string) {
      calls.push(`gate:${p.split("/").pop()}`);
      return { success: opts.gateOk !== false };
    },
    async confirmReservation(_m: unknown, o: { live: boolean }) {
      calls.push(`confirm:${o.live}`);
      sent.push(_m);
      if (opts.confirmThrows) throw new Error("ETD savedr 500");
      return opts.confirmOut ?? { data: { reservationNumber: { number: "FAKE123" } } };
    },
    async accountAdditionalInfoFields() {
      calls.push("addinfo");
      if (opts.addInfoThrows) throw new Error("ETD additioninformation 503");
      return opts.addInfoFields ?? ACCOUNT_ADDITIONAL_INFO;
    },
    timingSummary: () => "fake",
  };
  return { client: client as unknown as EtdClient, calls, sent };
}

/** A fresh schedule window whose working days start tomorrow. */
function fakeSchedule(opts: { fresh?: boolean; workingFrom?: number } = {}) {
  return async (ldap: string, fromISO: string, horizon: number): Promise<ScheduleWindow> => {
    const base = new Date(`${fromISO}T00:00:00Z`);
    const days = Array.from({ length: horizon }, (_, i) => {
      const d = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
      return { date: d, hasShift: true, absences: [] as string[], working: i >= (opts.workingFrom ?? 1), snapshotTs: "" };
    });
    return {
      ldap: ldap.toUpperCase(),
      watermarkUtc: new Date().toISOString(),
      watermarkAgeHours: 1,
      fresh: opts.fresh !== false,
      days,
    };
  };
}

// ------------------------------------------------------------------ fixtures

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE upper(tech_racfid) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM tpms_tech_profiles WHERE upper(enterprise_id) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM fs_comms_contacts WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
}

/**
 * The roster / TPMS / contact rows the eligibility gate demands. Without these the
 * gate fails for reasons that have nothing to do with the executor, and every lane
 * test would pass for the wrong reason.
 */
async function seedEligibility(ldap: string) {
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status, district_no, effective_date, synced_at)
    VALUES (${"99" + Math.floor(Math.random() * 1e6)}, ${ldap}, 'ZZ Exec Fixture', 'A', '8330', now(), now())
  `);
  await db.execute(sql`
    INSERT INTO tpms_tech_profiles (tech_id, enterprise_id, truck_no, synced_at)
    VALUES (${"ZZX" + Math.floor(Math.random() * 1e6)}, ${ldap}, '012345', now())
  `);
  await db.execute(sql`
    INSERT INTO fs_comms_contacts (ldap, phone, primary_state) VALUES (${ldap}, '2145550142', 'OH')
  `);
}

/**
 * Gate codes the RUNNER owns on the REQUEST lane — the ones that say something
 * about the quote it just took, as opposed to roster/approval facts. A synthetic
 * LDAP has no Snowflake schedule, so the orchestrator's own server-side re-check
 * always adds `not_working_day` and these fixtures can never reach preview_ready.
 * What the executor is responsible for is that these four codes clear on a good
 * quote and appear on a bad one.
 *
 * `branch_not_pinned` is deliberately ABSENT: a request pins no branch (the
 * nearest one to the shop is the right answer for a new rental), so the quote
 * always reports branchPinned:false and the gate is cutover-only. `quote_failed`
 * is what now carries "there was no usable quote" on this lane.
 */
const RUNNER_OWNED = ["quote_failed", "class_unmapped", "branch_zip_missing", "no_date"] as const;

/** A request row + an intent pointing at it, in the given lane. */
async function makeRequestIntent(over: {
  ldap: string;
  status: string;
  executionMode?: string;
  preview?: unknown;
  eventDate?: string;
  shopState?: string;
  approvedClass?: string;
}): Promise<{ intentId: number; sourceId: string }> {
  const sourceId = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO vrm_rental_request (id, ldap, status, shop_address, shop_city, shop_state, approved_vehicle_class, truck_number)
    VALUES (${sourceId}::uuid, ${over.ldap}, 'approved', '100 Example Way', 'Testville',
            ${over.shopState ?? "OH"}, ${over.approvedClass ?? null}, '012345')
  `);
  await seedEligibility(over.ldap);
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status, preview_version, preview, event_date)
    VALUES (${WORKFLOW_REQUEST}, ${sourceId}, 0, ${over.executionMode ?? "dry_run"}, ${over.ldap},
            ${over.status}, ${over.preview ? 1 : 0}, ${over.preview ? JSON.stringify(over.preview) : null},
            ${over.eventDate ?? null})
    RETURNING id
  `);
  return { intentId: (rows as any[])[0].id as number, sourceId };
}

const loadIntentRow = async (id: number) =>
  ((await db.execute(sql`
    SELECT status, reservation_state, preview, preview_version, last_error
    FROM vrm_rental_workflow_intents WHERE id = ${id}
  `)).rows as any[])[0];

const attemptsFor = async (id: number) =>
  (await db.execute(sql`
    SELECT attempt_no, outcome, request_hash FROM vrm_workflow_attempts
    WHERE intent_id = ${id} AND phase = 'etd_booking' ORDER BY attempt_no
  `)).rows as any[];

before(async () => {
  await initFormsSchema();
  await cleanup();
});

after(async () => {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ------------------------------------------------------------- pure helpers

describe("journey readback parsing", () => {
  test("collects reservation and reference numbers from any shape, and strips COUNT", () => {
    const rows = extractJourneyRows({
      data: {
        results: [
          { reservationNumber: { number: "AAA111COUNT" }, referenceNumber: "SHS ZZ1", branchCode: "9911", startDateTime: "2026-09-08T09:00:00", carClassCode: "ICAR" },
          { nested: [{ confirmationNumber: "BBB222", ReferenceNumber: "SHS ZZ2" }] },
        ],
      },
    });
    assert.deepEqual(rows.map((r) => r.confirmation), ["AAA111", "BBB222"]);
    assert.equal(rows[0].reference, "SHS ZZ1");
    assert.equal(rows[0].branchCode, "9911");
    assert.equal(rows[0].date, "2026-09-08");
    assert.equal(rows[0].sipp, "ICAR");
  });

  test("dedupes on (confirmation, reference) so one journey is not counted twice", () => {
    const dup = { reservationNumber: { number: "AAA111" }, referenceNumber: "SHS ZZ1" };
    assert.equal(extractJourneyRows({ a: dup, b: { ...dup } }).length, 1);
  });

  test("identifies a journey only by this intent's confirmation or SHS reference", () => {
    const rows = [
      { confirmation: "AAA111", reference: "SHS ZZEXEC1 SHSNX-42", branchCode: "", date: "", sipp: "" },
      { confirmation: "BBB222", reference: "SHS OTHER", branchCode: "", date: "", sipp: "" },
    ];
    assert.deepEqual(
      identifyJourneyRows(rows, { confirmation: "BBB222" }).map((r) => r.confirmation),
      ["BBB222"],
    );
    assert.deepEqual(
      identifyJourneyRows(rows, { intentRef: "shsnx-42" }).map((r) => r.confirmation),
      ["AAA111"],
    );
  });

  test("reference identity is TOKEN-exact: SHSNX-42 never matches SHSNX-420", () => {
    // SHSNX-42 as a SUBSTRING also lives inside SHSNX-420/421, so a plain
    // includes() reported a neighbouring intent's reservation as this one's —
    // refusing a legitimate first booking pre-commit, or settling the wrong
    // state on readback. The unit of identity is the whole token.
    const neighbours = [
      { confirmation: "AAA111", reference: "SHS ZZEXEC1 SHSNX-420", branchCode: "", date: "", sipp: "" },
      { confirmation: "BBB222", reference: "SHS ZZEXEC1 SHSNX-421", branchCode: "", date: "", sipp: "" },
    ];
    assert.equal(identifyJourneyRows(neighbours, { intentRef: "SHSNX-42" }).length, 0);
    // The exact reference still identifies, even wrapped in punctuation —
    // only alphanumerics and the in-reference dash bind tokens together.
    const mine = [
      { confirmation: "CCC333", reference: "SHS ZZEXEC1 (SHSNX-42)", branchCode: "", date: "", sipp: "" },
      ...neighbours,
    ];
    assert.deepEqual(
      identifyJourneyRows(mine, { intentRef: "SHSNX-42" }).map((r) => r.confirmation),
      ["CCC333"],
    );
  });

  test("returns NOTHING rather than everything when no row identifies", () => {
    // ETD's Last30Days list is every QUOTE the engine ever took, so a criteria
    // search routinely answers with dozens of unrelated journeys. Handing them
    // back as "matches" reported them all as this intent's reservations, which
    // parked first-ever bookings in manual review as phantom duplicates.
    const rows = Array.from({ length: 65 }, (_, i) => ({
      confirmation: `J${i}`, reference: `SHS SOMEONE-${i}`, branchCode: "", date: "", sipp: "",
    }));
    assert.equal(identifyJourneyRows(rows, { confirmation: "ZZZ", intentRef: "SHSNX-42" }).length, 0);
    // The LDAP is NOT an identifier: one tech owns many journeys, so a reference
    // carrying it says "this tech", never "this intent".
    const mine = [{ confirmation: "AAA111", reference: "SHS ZZEXEC1", branchCode: "", date: "", sipp: "" }];
    assert.equal(identifyJourneyRows(mine, { intentRef: "SHSNX-42" }).length, 0);
    // And with no witness at all there is nothing to identify against.
    assert.equal(identifyJourneyRows(mine, {}).length, 0);
  });

  test("possibleUnlinked is ADVISORY: unidentified confirmation-bearing rows, never matches", () => {
    // A reservation booked BY HAND in the ETD portal carries no SHSNX
    // reference — its row cannot identify, but it does carry a confirmation.
    // That sighting must reach the server as advisory data (the cancel lane
    // refuses to settle terminal on it) without EVER entering matches.
    const rows = [
      { confirmation: "AAA111", reference: "SHS ZZEXEC1 SHSNX-42", branchCode: "9911", date: "2026-09-08", sipp: "ICAR" },
      { confirmation: "HAND99", reference: "walk-in for John Q Technician", branchCode: "9912", date: "2026-09-09", sipp: "FCAR" },
      { confirmation: "", reference: "SHS QUOTE ONLY", branchCode: "9913", date: "2026-09-10", sipp: "ECAR" },
    ];
    const matches = identifyJourneyRows(rows, { intentRef: "SHSNX-42" });
    assert.deepEqual(matches.map((r) => r.confirmation), ["AAA111"]);
    const advisory = possibleUnlinkedRows(rows, matches);
    // Identified rows and confirmation-less quote rows are both excluded.
    assert.deepEqual(advisory, [
      { confirmation: "HAND99", branchCode: "9912", date: "2026-09-09", sipp: "FCAR" },
    ]);
    // The reference field is DROPPED from the advisory shape — for a hand
    // booking it is branch-typed free text that can carry a person's name.
    assert.ok(!("reference" in (advisory[0] as any)));
  });

  test("possibleUnlinked dedupes on the confirmation and stays capped", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      confirmation: `C${i % 15}`, reference: "", branchCode: "", date: "", sipp: "",
    }));
    const advisory = possibleUnlinkedRows(rows, []);
    assert.equal(advisory.length, POSSIBLE_UNLINKED_CAP, "a hint, not a roster");
    assert.equal(new Set(advisory.map((r) => r.confirmation)).size, advisory.length);
    // Case-insensitive dedupe, like every confirmation comparison in this file.
    assert.equal(
      possibleUnlinkedRows(
        [
          { confirmation: "abc123", reference: "", branchCode: "", date: "", sipp: "" },
          { confirmation: "ABC123", reference: "", branchCode: "", date: "", sipp: "" },
        ],
        [],
      ).length,
      1,
    );
    // Merging successive searches keeps first sighting and the cap.
    const merged = mergePossibleUnlinked(
      [{ confirmation: "X1", branchCode: "A", date: "", sipp: "" }],
      [
        { confirmation: "x1", branchCode: "B", date: "", sipp: "" },
        { confirmation: "X2", branchCode: "C", date: "", sipp: "" },
      ],
    );
    assert.deepEqual(merged.map((r) => `${r.confirmation}:${r.branchCode}`), ["X1:A", "X2:C"]);
  });
});

describe("confirmation parsing", () => {
  test("prefers data.reservationNumber.number, then digs for a confirmation", () => {
    assert.equal(parseConfirmation({ data: { reservationNumber: { number: "AAA111" } } }), "AAA111");
    assert.equal(parseConfirmation({ x: { confirmationNumber: "BBB222COUNT" } }), "BBB222");
    assert.equal(parseConfirmation({ deep: [{ reservationNo: "CCC333" }] }), "CCC333");
  });

  test("NEVER falls back to a reference number", () => {
    // referenceNumber is the QUOTE reference. Recording it as a confirmation makes
    // every later readback fail to find a reservation that really does exist.
    assert.equal(parseConfirmation({ data: { referenceNumber: "R-FAKE-1" } }), "");
    assert.equal(parseConfirmation({ data: { reservationNumber: { number: "" } }, referenceNumber: "R-1" }), "");
    assert.equal(parseConfirmation({}), "");
    assert.equal(parseConfirmation({ data: { reservationNumber: { number: 0 } } }), "");
  });
});

describe("request hash is byte-identical to the Python runner", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "etd-surgery", "request-hash.json"), "utf-8"),
  );
  for (const c of fixture.cases as any[]) {
    test(`${c.input.branch || "(blank)"}/${c.input.sipp || "-"}/${c.input.date || "-"}`, () => {
      assert.equal(bookingRequestHash(c.input), c.hash);
    });
  }
});

describe("intent addressing", () => {
  const item = (over: Partial<QueueItem>): QueueItem =>
    ({ intentId: 1, kind: "book", fencingToken: 1, workflowType: WORKFLOW_REQUEST, executionMode: "dry_run",
       ldap: "ZZ1", requiresReconcile: false, facts: {}, preview: null, ...over } as QueueItem);

  test("a cutover pins the branch holding the Holman agreement", () => {
    const got = intentAddress(item({
      workflowType: WORKFLOW_CUTOVER,
      facts: { surveyBranch: { name: "Testville Central", city: "Testville", state: "OH" }, caseFacts: { rentingBranch: "9911" } },
    }));
    assert.equal(got.address, "Testville Central, Testville, OH");
    assert.equal(got.code, "9911", "a swap must return to the renting branch, not the nearest one");
    assert.equal(got.wantState, "OH");
  });

  test("a request geocodes the shop and pins nothing", () => {
    const got = intentAddress(item({ facts: { requestSeed: { shopAddress: "100 Example Way", shopCity: "Testville", shopState: "oh" } } }));
    assert.equal(got.address, "100 Example Way, Testville, oh");
    assert.equal(got.code, "", "a new rental is not tied to an existing agreement");
    assert.equal(got.wantState, "OH");
  });

  test("a request with no shop address REFUSES a reported branch that names no place", () => {
    // LGONZ15 typed the single word "Enterprise"; the geocoder resolved it to Boston
    // Logan and booked a California technician a car 3,000 miles away (2026-08-19).
    // A reported branch with no street number, no ZIP and no state must throw, not
    // fall through to the geocoder's best guess.
    assert.throws(
      () => intentAddress(item({ facts: { requestSeed: { reportedBranch: "Enterprise Testville" } } })),
      /names no location/,
    );
  });

  test("a reported branch that IS locatable still serves as the no-shop fallback", () => {
    const got = intentAddress(item({
      facts: { requestSeed: { reportedBranch: "Enterprise, 4501 Main St, Testville, OH" } },
    }));
    assert.equal(got.address, "Enterprise, 4501 Main St, Testville, OH");
    assert.equal(got.code, "", "a new rental is still not tied to an existing agreement");
  });

  test("Fleet's approved branch beats the shop AND the technician's answer, state guard off", () => {
    // VPRAK #110 (2026-08-24): a BYOV breakdown with no shop and no reported branch,
    // where the operator typed the branch on the approval and this lane quoted from
    // nothing anyway — the decision endpoint documented the override but nothing
    // downstream read it. Mirrors book_one in etd-runner/scripts/book_request.py.
    const got = intentAddress(item({
      facts: { requestSeed: {
        approvedBranch: "7440 W Cactus Rd Ste A7, Peoria, AZ 85381",
        shopAddress: "100 Example Way", shopCity: "Testville", shopState: "OH",
        reportedBranch: "Enterprise, 4501 Main St, Testville, OH",
      } },
    }));
    assert.equal(got.address, "7440 W Cactus Rd Ste A7, Peoria, AZ 85381");
    assert.equal(got.code, "", "Fleet's branch is an address, never a contract pin");
    assert.equal(got.wantState, "", "a human checked this address; the state guard must not overrule them");
  });

  test("an approved branch also rescues the no-shop request that would otherwise refuse", () => {
    const got = intentAddress(item({
      facts: { requestSeed: { approvedBranch: "7440 W Cactus Rd, Peoria, AZ" } },
    }));
    assert.equal(got.address, "7440 W Cactus Rd, Peoria, AZ");
  });

  test("placeholder shop fields fall through to a locatable reported branch", () => {
    // BSOKOLO request b17c091a (2026-08-25): street "Na", city "Na", state PA
    // — truck taken off the road, no shop. "Na, PA" geocoded to the Balearic
    // Islands and the US guard stopped the booking, even though the reported
    // branch was fully locatable. A placeholder is an answer of NO answer.
    const got = intentAddress(item({
      facts: { requestSeed: {
        shopAddress: "Na", shopCity: "Na", shopState: "PA",
        reportedBranch: "Enterprise 300 pinewood dr Warrendale pa 15086",
      } },
    }));
    assert.equal(got.address, "Enterprise 300 pinewood dr Warrendale pa 15086");
    assert.equal(got.wantState, "PA", "the wrong-geocode guard stays ON for a reported branch");
  });

  test("placeholder shop + unlocatable reported branch still refuses (LGONZ15 rule holds)", () => {
    assert.throws(
      () => intentAddress(item({ facts: { requestSeed: {
        shopAddress: "N/A", shopCity: "n/a", shopState: "CA",
        reportedBranch: "Enterprise",
      } } })),
      /names no location/,
    );
  });

  test("one real shop field survives scrubbing and still quotes the shop", () => {
    const got = intentAddress(item({ facts: { requestSeed: {
      shopAddress: "na", shopCity: "Pittsburgh", shopState: "PA",
      reportedBranch: "Enterprise 300 pinewood dr Warrendale pa 15086",
    } } }));
    assert.equal(got.address, "Pittsburgh, PA", "a real city beats the fallback");
    assert.equal(got.wantState, "PA");
  });

  test("scrubPlaceholder: tokens go, places stay", () => {
    for (const junk of ["Na", "N/A", "n/a", "N.A.", "none", "NULL", "Unknown", "unk", "TBD", "x", "XXX", "-", "--", "?", "..."]) {
      assert.equal(scrubPlaceholder(junk), "", `${JSON.stringify(junk)} is a placeholder`);
    }
    for (const real of ["Natrona Heights", "Xenia", "Nowhere Rd 5", "300 Pinewood Dr", "Nampa"]) {
      assert.equal(scrubPlaceholder(real), real, `${JSON.stringify(real)} is a real answer`);
    }
  });
});

describe("nearbyOnEmpty branch walk (real client, faked transport)", () => {
  const BR = (code: string, dist: number | null) => ({
    branchCode: code,
    customerFacingBranchName: `Branch ${code}`,
    fullAddress: `${code} MAIN ST,TESTVILLE,OH,44100`,
    latitude: "41.1",
    longitude: "-81.5",
    peoplesoftBranchId: `PS${code}`,
    stationId: `ST${code}`,
    calculatedDistance: dist,
    telephone: "(+1)5555550100",
  });

  /** Real EtdClient.quote() with every HTTP-touching step substituted. */
  function nearbyClient(branches: unknown[], classesByStation: Record<string, CarClass[]>) {
    const priced: string[] = [];
    const c = new EtdClientImpl() as any;
    c.resolvePlace = async () => ({
      latitude: "41.1", longitude: "-81.5", location: "Testville", postcode: "44100", townOrCity: "Testville",
    });
    c.createJourney = async () => ({ id: "j-1" });
    c.wizard = async () => ({ data: { journeyDetails: { referenceNumber: "R-1" } } });
    c.closestBranches = async () => branches;
    c.carClasses = async (_j: string, site: any) => {
      const station = String(site?.StationIds?.ET ?? "");
      priced.push(station);
      return classesByStation[station] ?? [];
    };
    return { client: c as EtdClientImpl, priced };
  }

  const START = "2026-08-25T09:00:00";
  const END = "2026-08-29T09:00:00";

  test("zero classes at the nearest branch walks to the next one that prices cars", async () => {
    // The SWICKLA #95 shape: a National desk, then an airport counter, both empty,
    // then the real branch 0.29 mi further with cars on the lot.
    const { client, priced } = nearbyClient(
      [BR("1001", 9.1), BR("1002", 9.3), BR("1003", 9.6)],
      { ST1003: CLASSES },
    );
    const q = await client.quote({ address: "x", start: START, end: END, nearbyOnEmpty: true });
    assert.deepEqual(priced, ["ST1001", "ST1002", "ST1003"], "candidates priced nearest-first, no skipping");
    assert.equal(q.branch_code, "1003");
    assert.ok((q.classes || []).length, "the adopted branch's classes are the quote's classes");
    assert.equal(q.branch_fallback_from_code, "1001", "the branch moved off is named");
    assert.equal(q.branch_fallback_tried, 2);
  });

  test("a pinned branch never moves, even when it prices nothing", async () => {
    const { client, priced } = nearbyClient(
      [BR("1001", 1.0), BR("1002", 2.0)],
      { ST1002: CLASSES },
    );
    const q = await client.quote({
      address: "x", start: START, end: END, preferBranchCode: "1001", nearbyOnEmpty: true,
    });
    assert.deepEqual(priced, ["ST1001"], "a cutover's contract branch is priced once and left alone");
    assert.equal(q.branch_code, "1001");
    assert.equal(q.classes.length, 0, "empty stays empty rather than silently moving the contract branch");
    assert.equal(q.branch_fallback_from_code, undefined);
  });

  test("the walk stops at the distance cap instead of adopting a far branch", async () => {
    const { client, priced } = nearbyClient(
      [BR("1001", 5.0), BR("1002", 100.0), BR("1003", 101.0)],
      { ST1002: CLASSES, ST1003: CLASSES },
    );
    const q = await client.quote({ address: "x", start: START, end: END, nearbyOnEmpty: true });
    assert.deepEqual(priced, ["ST1001"], "a candidate beyond the cap ends the walk (nearest-first list)");
    assert.equal(q.branch_code, "1001");
    assert.equal(q.classes.length, 0);
  });

  test("an unknown distance is too far, not free", async () => {
    const { client, priced } = nearbyClient(
      [BR("1001", 5.0), BR("1002", null)],
      { ST1002: CLASSES },
    );
    await client.quote({ address: "x", start: START, end: END, nearbyOnEmpty: true });
    assert.deepEqual(priced, ["ST1001"], "the airport-satellite shape (no distance) is excluded");
  });

  test("without the opt-in the quote behaves exactly as before", async () => {
    const { client, priced } = nearbyClient(
      [BR("1001", 1.0), BR("1002", 2.0)],
      { ST1002: CLASSES },
    );
    const q = await client.quote({ address: "x", start: START, end: END });
    assert.deepEqual(priced, ["ST1001"]);
    assert.equal(q.classes.length, 0);
  });
});

describe("class choice per workflow", () => {
  const item = (over: Partial<QueueItem>): QueueItem =>
    ({ intentId: 1, kind: "book", fencingToken: 1, workflowType: WORKFLOW_REQUEST, executionMode: "dry_run",
       ldap: "ZZ1", requiresReconcile: false, facts: {}, preview: null, ...over } as QueueItem);

  test("a cutover keeps the same vehicle", () => {
    // The case feed carries the 4-letter coded make/model ("CHRY"/"PACI"), which is
    // what MODEL_MAP is keyed on — spelled-out names are deliberately UNMAPPED.
    const got = classForIntent(item({ workflowType: WORKFLOW_CUTOVER, facts: { caseFacts: { make: "CHRY", model: "PACI" } } }), CLASSES);
    assert.equal(got.decision.mode, "same_vehicle");
    assert.equal(got.decision.chosenSipp, "MVAR");
    assert.equal(got.decision.mapped, true);
  });

  test("a spelled-out make/model parks the swap for a human instead of guessing a class", () => {
    const got = classForIntent(item({ workflowType: WORKFLOW_CUTOVER, facts: { caseFacts: { make: "Chrysler", model: "Pacifica" } } }), CLASSES);
    assert.equal(got.decision.mapped, false);
    assert.equal(got.decision.match, "UNMAPPED");
    assert.equal(got.pick, null, "a cutover NEVER falls back to a sedan — it must return the same vehicle");
  });

  test("an unset approved class defaults to a sedan via the ladder, not UNMAPPED", () => {
    // ETD descriptions rarely contain the word "sedan", so a literal match would park
    // every plain request for a human.
    const got = classForIntent(item({ facts: { requestSeed: {} } }), CLASSES);
    assert.equal(got.decision.mode, "approved_class");
    assert.equal(got.decision.match, "sedan_ladder");
    // Smallest the branch offers, not largest (Tyler, 2026-08-17). The ladder was
    // ordered FCAR-first until then, so every technician whose branch had one was
    // handed a full-size, which is the opposite of right-sizing. CLASSES here offers
    // ECAR, ICAR, FCAR and MVAR, so ECAR is the smallest sedan available.
    assert.equal(got.decision.chosenSipp, "ECAR");
  });

  test("underscored legacy labels still match (cargo_van == cargo van)", () => {
    const vans: CarClass[] = [{ ...CLASSES[3], code: "CVAR", description: "Cargo Van" }];
    const got = classForIntent(item({ facts: { requestSeed: { approvedVehicleClass: "cargo_van" } } }), vans);
    assert.equal(got.decision.chosenSipp, "CVAR");
    assert.equal(got.decision.match, "approved_label");
  });

  // Fixture classes by code, for the substitution-walk tests below. Non-code fields
  // are irrelevant to the walk; CLASSES[0] donates them.
  const cls = (code: string, description = `${code} class`): CarClass =>
    ({ ...CLASSES[0], code, description });

  test("a named SPACE class that is not offered walks DOWN only, from the minivan ceiling", () => {
    // cargo van (RVAR) sits above the ladder, so the walk starts at MVAR — and it
    // must never climb: there is no "up" above the policy ceiling.
    const got = classForIntent(item({ facts: { requestSeed: { approvedVehicleClass: "cargo van" } } }), CLASSES);
    assert.equal(got.decision.chosenSipp, "MVAR");
    assert.equal(got.decision.match, "named_class_downgraded");
    // And a named SUV with a bigger SUV on the lot still goes DOWN, never up.
    const suv = classForIntent(
      item({ facts: { requestSeed: { approvedVehicleClass: "suv" } } }),
      [cls("SFAR"), cls("FCAR")],
    );
    assert.equal(suv.decision.chosenSipp, "FCAR", "IFAR named: SFAR is above it and must not be taken");
    assert.equal(suv.decision.match, "named_class_downgraded");
  });

  test("a named sedan with a smaller sedan offered still takes the down-walk", () => {
    // CLASSES offers ECAR/ICAR/FCAR/MVAR; SCAR's down-walk finds ICAR first.
    const got = classForIntent(item({ facts: { requestSeed: { approvedVehicleClass: "SCAR" } } }), CLASSES);
    assert.equal(got.decision.chosenSipp, "ICAR");
    assert.equal(got.decision.match, "named_class_downgraded");
  });

  test("a named sedan with only LARGER sedans offered walks UP to the nearest one", () => {
    // The intent #110 shape: SCAR approved, branch stocks nothing smaller than
    // full-size. Down-only parked it at class_unmapped forever; naming a small
    // sedan must never book worse than the plain default, which walks up.
    const got = classForIntent(
      item({ facts: { requestSeed: { approvedVehicleClass: "SCAR" } } }),
      [cls("FCAR"), cls("MVAR")],
    );
    assert.equal(got.decision.mapped, true);
    assert.equal(got.decision.chosenSipp, "FCAR");
    assert.equal(got.decision.match, "named_class_upgraded");
    assert.match(String(got.decision.detail), /nearest sedan above/, "the substitution is named on the request");
  });

  test("ECAR named with nothing below takes the next sedan up, not a dead-end", () => {
    // ECAR is the smallest rung: its down-walk can never find anything, so before
    // the up-walk existed, naming it at a branch without one could NEVER map.
    const got = classForIntent(
      item({ facts: { requestSeed: { approvedVehicleClass: "ECAR" } } }),
      [cls("ICAR"), cls("FCAR")],
    );
    assert.equal(got.decision.chosenSipp, "ICAR", "nearest larger sedan, not the largest");
    assert.equal(got.decision.match, "named_class_upgraded");
  });

  test("a named sedan at a branch with NO sedans escalates smallest-first, as a last resort", () => {
    const got = classForIntent(
      item({ facts: { requestSeed: { approvedVehicleClass: "SCAR" } } }),
      [cls("SFAR"), cls("MVAR")],
    );
    assert.equal(got.decision.chosenSipp, "SFAR", "smallest offered escalation class, never the minivan first");
    assert.equal(got.decision.match, "named_class_escalated");
    assert.match(String(got.decision.detail), /escalated to SFAR/);
  });

  test("a named class no ladder can satisfy stays UNMAPPED and names what WAS offered", () => {
    // Only classes outside every ladder (pickup, cargo van). The note must read as
    // an availability fact — listing the branch's real codes — not a mapping bug.
    const got = classForIntent(
      item({ facts: { requestSeed: { approvedVehicleClass: "SCAR" } } }),
      [cls("PPAR"), cls("RVAR")],
    );
    assert.equal(got.decision.mapped, false);
    assert.equal(got.decision.match, "UNMAPPED");
    assert.equal(got.pick, null);
    assert.match(String(got.decision.detail), /branch offered: PPAR, RVAR/);
  });

  test("the raw pick never leaks into the persisted decision", () => {
    const got = classForIntent(item({ facts: { requestSeed: {} } }), CLASSES);
    assert.ok(got.pick, "the caller still needs the pick for the payload");
    assert.equal((got.decision as any)._pick, undefined);
    assert.equal((got.decision as any).pick, undefined);
  });
});

// --------------------------------------------------------------- lane tests

describe("preview lane", () => {
  test("quotes the shop, persists a reviewable preview and records the schedule evidence", async () => {
    const ldap = `${LDAP_PREFIX}PRV`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.claimed, 1);
    assert.equal(run.results[0].action, "PREV");
    assert.ok(calls.some((c) => c.startsWith("quote:")), "a preview must actually quote");
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0, "a preview must never commit");

    // The quote pinned a branch, mapped a class, carried a ZIP and carried a date:
    // every runner-owned gate code is clear, leaving only the environment's own.
    const detail = run.results[0].detail ?? "";
    for (const owned of RUNNER_OWNED) {
      assert.ok(!detail.includes(owned), `a good quote must clear ${owned} (detail: ${detail})`);
    }
    // A request is not schedule-gated, so a clean quote is a READY preview. It used
    // to stop at preview_required purely because the server re-checked ServicePower
    // and a synthetic LDAP has no rows there — the same gate that made real
    // technicians with no route unbookable.
    assert.equal(run.results[0].status, "preview_ready", "a clean request quote is ready to confirm");

    const row = await loadIntentRow(intentId);
    const sched = (row.preview as any)?.schedule ?? {};
    assert.equal(sched.scheduleGated, false, "and the preview records that no schedule gate ran");
    assert.equal(sched.requestedDateWorking, null, "so it must not claim a working-day check passed");
  });

  test("a preview that moved off an empty branch says so in the persisted facts", async () => {
    const ldap = `${LDAP_PREFIX}NRBY`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const { client } = fakeEtd({ fallbackFrom: { code: "1001", name: "Empty Corner" } });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "PREV");
    assert.equal(run.results[0].status, "preview_ready", "a rescued quote is still a clean quote");
    const row = await loadIntentRow(intentId);
    const resv = (row.preview as any)?.reservation ?? {};
    assert.equal(resv.quotedFromNearbyBranch, true, "the move is recorded, not silent");
    assert.ok(
      (resv.quote?.warnings ?? []).some(
        (w: string) => w.includes("Empty Corner") && w.includes("priced no classes"),
      ),
      `the branch moved off is named in the preview (warnings: ${JSON.stringify(resv.quote?.warnings)})`,
    );
  });

  test("a same-day request ignores the schedule entirely, stale watermark included", async () => {
    // The stale-watermark hard stop protects the CUTOVER lane, where a reservation is
    // paired with a route block and must land on a day the technician is working.
    // A request is a technician already off the road asking for a car today: it picks
    // today, files no block, and never reads ServicePower. Enforcing the cutover rule
    // here meant anyone with no route inside the 21-day window could never be booked,
    // and it surfaced as four separate codes (no_date, quote_failed, class_unmapped,
    // branch_zip_missing) that were all this one cause.
    const ldap = `${LDAP_PREFIX}STALE`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({
      runnerId: "test-exec", intentId,
      deps: { client, schedule: fakeSchedule({ fresh: false }) },
    });

    assert.equal(
      calls.filter((c) => c.startsWith("quote:")).length,
      1,
      "a request quotes regardless of the schedule watermark",
    );
    assert.doesNotMatch(run.results[0].detail ?? "", /no_date/, "today is always a date");
    // The pickup date IS today, and the SCHEDULE never moves it. That is the whole
    // contract for this lane and it is what makes a technician with no ServicePower
    // route bookable.
    //
    // The one thing that legitimately moves it is the branch cutoff: past roughly
    // 15:00 ET a now+90m pickup lands after the last realistic hand-over, so the
    // quote takes tomorrow at 09:00 instead. Asserting a bare etTodayISO() made this
    // test fail every single afternoon and pass every morning, which is worse than
    // no test - it trained everyone to ignore a red run. Ask the same resolver the
    // preview asks, so the expectation is right at any hour and a real regression
    // (the schedule pushing the day) still fails.
    const row = await loadIntentRow(intentId);
    const expected = resolvePickupWindow({
      dayISO: etTodayISO(),
      wantedTime: "09:00:00",
      todayISO: etTodayISO(),
    });
    assert.equal(
      String((row.preview as any)?.reservation?.pickupDate ?? ""),
      expected.day,
      "a same-day request takes today, or tomorrow only because of the branch cutoff",
    );
    // And when the cutoff does move it, the preview must SAY so. A silent roll is
    // how 31 technicians were told "pickup today" for a reservation that was not
    // there until the next morning.
    const warnings = ((row.preview as any)?.reservation?.quote?.warnings ?? []) as string[];
    if (expected.rolled) {
      assert.ok(
        warnings.some((w) => /last-pickup cutoff/i.test(w)),
        `the roll is named in the preview (warnings: ${JSON.stringify(warnings)})`,
      );
    } else {
      assert.ok(
        !warnings.some((w) => /last-pickup cutoff/i.test(w)),
        "no cutoff warning when nothing rolled",
      );
    }
  });

  test("a quote failure lands in the preview warnings, not in an exception", async () => {
    const ldap = `${LDAP_PREFIX}QFAIL`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const client = {
      async quote() { throw new Error("geocoder exploded"); },
      timingSummary: () => "fake",
    } as unknown as EtdClient;

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });
    assert.equal(run.results[0].action, "PREV", "a failed quote is a reported preview, not a crashed pass");
    assert.match(run.results[0].detail ?? "", /geocoder exploded/, "the staffer has to be told WHY there is no preview");
    // The pin check is cutover-only now, so this is the gate that keeps an
    // unquoted request unbookable — and it names the real cause.
    assert.match(run.results[0].detail ?? "", /quote_failed/, "and the gate records it as unbookable");
    assert.equal((await loadIntentRow(intentId)).status, "preview_required");
  });

  test("a request is NEVER failed for an unpinned branch — nearest-to-the-shop is the right answer", async () => {
    // The request lane passes no preferred branch code (a NEW rental has no
    // contract branch to return to), so ETD always answers branch_pinned:false.
    // Gating both lanes on the pin made every request preview fail and no
    // request could ever reach Awaiting Confirm.
    const ldap = `${LDAP_PREFIX}NOPIN`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const { client, calls } = fakeEtd();
    (client as any).quote = async (p: any) => {
      calls.push(`quote:${p.preferBranchCode ?? ""}`);
      const q = await fakeEtd().client.quote(p as any);
      return { ...(q as any), branch_pinned: false };
    };

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.ok(calls.includes("quote:"), "the request lane pins nothing");
    const detail = run.results[0].detail ?? "";
    assert.ok(!detail.includes("branch_not_pinned"), `an unpinned request must not be gated (detail: ${detail})`);
    assert.ok(!detail.includes("quote_failed"), `and a good unpinned quote is not a failed quote (detail: ${detail})`);
  });
});

describe("booking lane", () => {
  // A preview as the preview lane would have persisted it. tpmsTruck and the ART unit
  // must agree with the seeded facts: the orchestrator re-compares them at booking time
  // and refuses on drift, which is what stops a reservation being booked against inputs
  // that changed after the staffer reviewed them.
  const preview = (over: Record<string, unknown> = {}) => ({
    workflowType: WORKFLOW_REQUEST,
    tpmsTruck: "012345",
    artBlock: { unit: "8330" },
    reservation: {
      pickupDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      pickupTime: "09:00:00",
      returnDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      returnTime: "09:00:00",
      branchCode: "9911",
      sipp: "ICAR",
      intentReference: "SHSNX-TEST",
      specialNotes: "Test note.",
      bookingReferences: ["ZZ REF"],
      ...over,
    },
  });

  test("the executor books NOTHING when the server declines to authorize the attempt", async () => {
    // The orchestrator re-compares the confirmed preview to the CURRENT facts
    // immediately before authorizing the external call. Here the technician's TPMS
    // truck moves after the staffer confirmed — so op_open is refused. That refusal
    // is the whole safety property: the executor has a complete preview and a willing
    // ETD client, and still must not touch savedr without the server's authorization.
    // (The schedule re-check is deliberately NOT the decline used here: it is
    // cutover-only at every home, so it no longer refuses a request.)
    const ldap = `${LDAP_PREFIX}DARK`;
    const { intentId } = await makeRequestIntent({
      ldap, status: "confirmed", preview: preview(), eventDate: preview().reservation.pickupDate,
    });
    await db.execute(sql`
      UPDATE tpms_tech_profiles SET truck_no = '054321' WHERE upper(enterprise_id) = ${ldap}
    `);
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "HOLD");
    assert.equal(run.results[0].status, "preview_required");
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0, "no authorization, no reservation");
    assert.equal(calls.filter((c) => c.startsWith("gate:")).length, 0, "and it stops before the ETD gates");
    assert.equal((await attemptsFor(intentId)).length, 0, "an unauthorized booking leaves no attempt row");

    // A hold is recoverable: the intent goes back to the staffer, not to a dead end.
    const row = await loadIntentRow(intentId);
    assert.equal(row.status, "preview_required");
    assert.match(String(row.last_error ?? ""), /drift/i);
  });

  test("branch drift between preview and booking aborts before the attempt opens", async () => {
    const ldap = `${LDAP_PREFIX}DRIFT`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    // The staffer reviewed 9911; the fresh quote comes back with a different branch.
    const { client, calls } = fakeEtd({ branchCode: "7777" });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "ABRT");
    assert.equal(run.results[0].status, "aborted_before_open");
    assert.equal(calls.filter((c) => c.startsWith("gate:")).length, 0);
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0);
  });

  test("a class that sold out between quote and commit substitutes from the same ladder", async () => {
    // Demanding the exact preview class still be offered meant a sold-out Mirage
    // aborted the whole booking (DWHITE0, 2026-08-18) even though the branch had
    // other cars. The executor re-picks with the SAME ladder rules and books the
    // substitute; the attempt is keyed on what is ACTUALLY booked, so the hash moves.
    const ldap = `${LDAP_PREFIX}NOCLS`;
    const p = preview({ sipp: "XXAR" });
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: p });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });
    assert.equal(run.results[0].action, "DARK", "the substitution continues the pass instead of aborting it");
    assert.equal(run.results[0].status, "dry_run_validated");
    assert.ok(calls.some((c) => c.startsWith("gate:")), "the substitute is validated like any other pick");
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0, "dry_run still never commits");
    const attempts = await attemptsFor(intentId);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].outcome, "dry_run_validated");
    assert.notEqual(
      attempts[0].request_hash,
      bookingRequestHash({ branch: "9911", date: p.reservation.pickupDate, ldap, sipp: "XXAR" }),
      "the attempt hash keys the substitute actually sent, not the sold-out class",
    );
  });

  test("a class NOTHING on the ladder can replace still aborts", async () => {
    // Only substitution on the same rules is allowed; an empty lot is not a licence
    // to book whatever exists elsewhere.
    const ldap = `${LDAP_PREFIX}NOLAD`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    const { client, calls } = fakeEtd({ classes: [] });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });
    assert.equal(run.results[0].status, "aborted_before_open");
    assert.match(run.results[0].detail ?? "", /nothing on the ladder/);
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0);
  });

  test("a dead working-day feed does NOT stop a request — the schedule gate is cutover-only", async () => {
    // A cutover pairs its reservation with a route block, so the day must be one the
    // technician works. A request books a car for someone standing next to a dead
    // van; ServicePower has no say in it. This used to abort here ("no longer a
    // working day") and stranded real requests — all three homes of the gate are now
    // cutover-only.
    const ldap = `${LDAP_PREFIX}NOWD`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    const { client, calls } = fakeEtd();

    // Nothing is a working day any more.
    const run = await runBookingExecutor({
      runnerId: "test-exec", intentId,
      deps: { client, schedule: fakeSchedule({ workingFrom: 999 }) },
    });
    assert.ok(calls.some((c) => c.startsWith("quote:")), "the request proceeds to a real quote");
    assert.equal(run.results[0].action, "DARK");
    assert.equal(run.results[0].status, "dry_run_validated", "and runs the full dark lane to the stop");
  });

  test("an incomplete preview aborts instead of booking a half-specified reservation", async () => {
    const ldap = `${LDAP_PREFIX}INC`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: { reservation: { sipp: "ICAR" } } });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });
    assert.equal(run.results[0].status, "aborted_before_open");
    assert.equal(calls.length, 0, "nothing is asked of ETD without a complete preview");
  });

  test("a pre-commit search that already finds this intent's reservation books nothing", async () => {
    const ldap = `${LDAP_PREFIX}DUPE`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    const { client, calls } = fakeEtd({
      journeys: { data: [{ reservationNumber: { number: "ALREADY1" }, referenceNumber: `SHS ${ldap} SHSNX-TEST` }] },
    });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "DUPE");
    assert.match(run.results[0].detail ?? "", /identified 1 existing reservation/);
    assert.equal(calls.filter((c) => c.startsWith("gate:")).length, 0);
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0, "a found reservation must never be booked again");
    assert.equal((await attemptsFor(intentId)).length, 0, "no attempt is opened when the work is already done");
  });

  test("unrelated quote journeys are NOT duplicates — a first booking is never parked by them", async () => {
    // ETD's Last30Days list carries every QUOTE the engine has ever taken, and the
    // row filter used to hand ALL of them back when nothing matched. That reported
    // 65 unrelated journeys as this intent's reservations, and the orchestrator's
    // (correct) refusal to book against "multiple" parked the very first booking in
    // MANUAL REVIEW before an attempt was ever opened.
    const ldap = `${LDAP_PREFIX}NOISE`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    const { client, calls } = fakeEtd({
      journeys: {
        data: Array.from({ length: 65 }, (_, i) => ({
          reservationNumber: { number: `J${i}` },
          referenceNumber: `SHS SOMEONE-${i}`,
        })),
      },
    });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.ok(calls.includes("search"), "the duplicate search still runs");
    assert.notEqual(run.results[0].action, "DUPE", "none of those journeys identifies as this intent's");
    // It goes on to open the attempt and run the full dark lane to the stop. The
    // point is that 65 unrelated quotes are no longer what parks it.
    assert.equal(run.results[0].action, "DARK");
    assert.equal(run.results[0].status, "dry_run_validated");
    const row = await loadIntentRow(intentId);
    assert.equal(String(row.status), "awaiting_verification", "the intent proceeds, not parked in manual_review");
    assert.equal(String(row.reservation_state), "dry_run_validated");
  });

  test("a pre-commit search FAILURE holds instead of booking on a blind spot", async () => {
    const ldap = `${LDAP_PREFIX}BLIND`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", preview: preview() });
    const { client, calls } = fakeEtd({ searchThrows: true });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "HOLD");
    assert.equal(run.results[0].status, "search_failed");
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0);
  });

  test("one claim never holds more than its limit, however many lanes have work", async () => {
    // Lanes used to spend the budget each, so limit:20 could lease 80 intents that a
    // serial pass would not reach for half an hour.
    const a = await makeRequestIntent({ ldap: `${LDAP_PREFIX}LANEA`, status: "preview_pending" });
    const b = await makeRequestIntent({ ldap: `${LDAP_PREFIX}LANEB`, status: "preview_pending" });
    const c = await makeRequestIntent({
      ldap: `${LDAP_PREFIX}LANEC`, status: "confirmed", preview: preview(),
    });
    const claimed = await claimBookingWork({ runnerId: "test-limit", limit: 2 });
    const summary = JSON.stringify(claimed.map((i) => ({ id: i.intentId, kind: i.kind, ldap: i.ldap })));
    const mine = claimed.filter((i) => [a.intentId, b.intentId, c.intentId].includes(i.intentId));
    assert.ok(claimed.length <= 2, `claimed ${claimed.length} with limit 2: ${summary}`);
    assert.ok(mine.length >= 1, `and it still claims work (claimed: ${summary})`);
    assert.ok(
      claimed.some((i) => i.kind === "book"),
      `one slot stays reserved for the book lane — a preview backlog must not starve bookings (claimed: ${summary})`,
    );
  });

  test("the attempt the executor would open is keyed by the cross-runner request hash", async () => {
    // Both runners write into one attempt ledger, and the hash is what makes the second
    // one recognise the first one's work. It is asserted here against the same inputs
    // the booking lane derives it from, and against the Python output in the fixture
    // suite above.
    const p = preview().reservation;
    assert.equal(
      bookingRequestHash({ branch: p.branchCode, date: p.pickupDate, ldap: `${LDAP_PREFIX}DARK`, sipp: p.sipp }),
      bookingRequestHash({ branch: "9911", date: p.pickupDate, ldap: `${LDAP_PREFIX}DARK`, sipp: "ICAR" }),
    );
  });

  test("a live intent is skipped while the contract-block flag is disarmed", async () => {
    // Defense in depth: claimBookingWork already hides live intents while disarmed, so
    // this only fires if the flag flips mid-pass. The point is that it never commits.
    if (isContractBlockLive()) return; // dev is deliberately unarmed; prod runs armed
    const ldap = `${LDAP_PREFIX}LIVE`;
    const { intentId } = await makeRequestIntent({ ldap, status: "confirmed", executionMode: "live", preview: preview() });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.claimed, 0, "a live intent is not even claimable while disarmed");
    assert.equal(calls.length, 0);
    assert.equal((await loadIntentRow(intentId)).status, "confirmed", "and it is left exactly as it was");
  });
});

describe("reconcile / cancel lane", () => {
  test("a cancel claim only reads back — it never books", async () => {
    const ldap = `${LDAP_PREFIX}CXL`;
    const { intentId } = await makeRequestIntent({ ldap, status: "cancel_pending_readback", preview: { reservation: { intentReference: "SHSNX-CXL" } } });
    const { client, calls } = fakeEtd();

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "RECON");
    assert.ok(calls.includes("search"));
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0);
    assert.equal(calls.filter((c) => c.startsWith("gate:")).length, 0);
  });

  test("a readback whose search FAILED is reported as an error, never as 'no reservation'", async () => {
    const ldap = `${LDAP_PREFIX}RBERR`;
    const { intentId } = await makeRequestIntent({ ldap, status: "cancel_pending_readback", preview: { reservation: { intentReference: "SHSNX-ERR" } } });
    const { client } = fakeEtd({ searchThrows: true });

    await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    const row = await loadIntentRow(intentId);
    assert.notEqual(row.status, "cancelled", "a broken search must not be read as proof the reservation is gone");
  });
});

describe("pass hygiene", () => {
  test("an empty queue is a no-op, not an error", async () => {
    const { client, calls } = fakeEtd();
    const run = await runBookingExecutor({ runnerId: "test-exec", intentId: 2147483600, deps: { client, schedule: fakeSchedule() } });
    assert.equal(run.claimed, 0);
    assert.deepEqual(run.results, []);
    assert.equal(calls.length, 0);
  });

  test("concurrent passes serialize instead of racing the same queue", async () => {
    const ldap = `${LDAP_PREFIX}RACE`;
    const { intentId } = await makeRequestIntent({ ldap, status: "preview_pending" });
    const { client } = fakeEtd();
    const deps = { client, schedule: fakeSchedule() };

    const [a, b] = await Promise.all([
      runBookingExecutor({ runnerId: "test-exec-a", intentId, deps }),
      runBookingExecutor({ runnerId: "test-exec-b", intentId, deps }),
    ]);

    // One pass claims the intent; the other finds nothing left in that lane. What must
    // never happen is both driving the same intent through ETD at once.
    assert.equal(a.claimed + b.claimed, 1, "the intent is served exactly once");
  });
});

describe("evidence redaction", () => {
  // A savedr response and an ETD error body both carry the renter — and both end up in
  // evidence rows and logs, which are neither a booking system nor a place for PII.
  const savedr = {
    success: true,
    reservation: { confirmationNumber: "1234567890", status: "OPEN" },
    driver: { firstName: "Dana", lastName: "Reyes", email: "dana.reyes@example.com", phone: "(214) 555-0142" },
    pickup: { address: "9 Maple Street", postalCode: "44100" },
  };

  test("an unparsed response keeps its shape and its ids, not its people", () => {
    const shape = redactedShape(savedr);
    for (const leak of ["Dana", "Reyes", "dana.reyes@example.com", "555-0142", "9 Maple Street"]) {
      assert.ok(!shape.includes(leak), `redactedShape leaked ${leak}: ${shape}`);
    }
    assert.match(shape, /reservation\.confirmationNumber:1234567890/, "the id a human needs survives");
    assert.match(shape, /driver\.firstName:string/, "and the shape a developer needs survives");
    assert.ok(shape.length <= 300);
  });

  test("unquoted PII is redacted too — a number is no less identifying", () => {
    const shape = redactedShape({
      driver: { phone: 2145550142, zip: 44100 },
      pickup: { lat: 41.4993, lon: -81.6944 },
      journeys: [{ id: "J-77", renter: "Dana Reyes", homePhone: 2145550142 }],
      success: true,
    });
    for (const leak of ["2145550142", "44100", "41.4993", "-81.6944", "Dana"]) {
      assert.ok(!shape.includes(leak), `redactedShape leaked ${leak}: ${shape}`);
    }
    assert.match(shape, /journeys\[0\]\.id:J-77/, "an array element's id is still recoverable");
    assert.match(shape, /success:true/, "booleans are safe on their face");
  });

  test("an ETD error body is masked before it becomes evidence", () => {
    const masked = safeErrorText(
      '{"error":"RATE_UNAVAILABLE","message":"no rate","driver":{"firstName":"Dana","email":"dana.reyes@example.com","phone":"+1 214-555-0142"}}',
    );
    assert.match(masked, /RATE_UNAVAILABLE/, "the reason must survive — it is why we log at all");
    assert.match(masked, /no rate/);
    for (const leak of ["Dana", "dana.reyes@example.com", "214-555-0142"]) {
      assert.ok(!masked.includes(leak), `safeErrorText leaked ${leak}: ${masked}`);
    }
  });

  test("the HTTP-200 rejection ETD actually returns is masked on the same path", () => {
    // ETD answers validation failures with 200 + success:false, so this — not a 4xx — is
    // the rejection a staffer is most likely to be shown.
    const msg = rejectionMessage("POST", "/api/reservation/savedr", {
      success: false,
      messages: ["Driver Dana Reyes (dana.reyes@example.com, 214-555-0142) is ineligible"],
    });
    assert.match(msg, /POST \/api\/reservation\/savedr rejected:/);
    assert.match(msg, /ineligible/, "the reason survives");
    for (const leak of ["Dana Reyes", "dana.reyes@example.com", "214-555-0142"]) {
      assert.ok(!msg.includes(leak), `rejectionMessage leaked ${leak}: ${msg}`);
    }
  });
});

describe("reading a savedr refusal", () => {
  // savedr does NOT answer with the wizard's {success,messages} envelope. It answers
  // with the reservation VIEW MODEL — the same shape reference/savedr_request.json has —
  // and puts its reasons in errors/warnings/hasErrors/notificationMessage and in
  // per-field validationMessage. Reading only messages/errorMessage is how a real
  // refusal was recorded as "rejected: " with nothing after the colon.
  const refusal = {
    success: false,
    hasErrors: true,
    hasWarnings: true,
    errorMessage: null,
    notificationMessage:
      "NOTE: A copy of the confirmation email will be sent to your email address on file.",
    errors: [
      {
        code: "RES_DRIVER_DECLARATION",
        message:
          "Driver Mustafa Ebadi must accept the driver declaration before this reservation can be committed.",
      },
    ],
    warnings: ["Rate is not guaranteed until pickup."],
    reasonForHire: { selectedId: null, errors: null, warnings: null, hasErrors: true, hasWarnings: false },
    additionalInformation: {
      additionalInformationFields: [
        { fieldName: "Truck Number ", value: "036056", validationMessage: null },
        { fieldName: "Reason For Hire", value: "", validationMessage: "Reason For Hire is required." },
      ],
      errors: null,
      warnings: null,
      hasErrors: true,
      hasWarnings: false,
    },
    driver: {
      firstName: "Mustafa",
      lastName: "Ebadi",
      email: "m.ebadi@example.com",
      phone: "(703) 555-0188",
    },
  };

  test("every reason the view model carries comes back, labelled by where it sat", () => {
    const reasons = rejectionReasons(refusal);
    assert.match(reasons, /RES_DRIVER_DECLARATION/, "the code Enterprise gave");
    assert.match(reasons, /must accept the driver declaration/, "and its sentence");
    assert.match(reasons, /Rate is not guaranteed until pickup/, "warnings count as reasons");
    assert.match(
      reasons,
      /Reason For Hire validationMessage: Reason For Hire is required/,
      "a per-field message is useless without the field it belongs to",
    );
    assert.ok(
      !reasons.includes("Truck Number validationMessage"),
      `a null validationMessage is not a reason: ${reasons}`,
    );
  });

  test("the error outranks the boilerplate, so the length cap trims the right end", () => {
    const reasons = rejectionReasons(refusal);
    assert.ok(
      reasons.indexOf("RES_DRIVER_DECLARATION") < reasons.indexOf("A copy of the confirmation"),
      `the standing email notice must not push the error past the cap: ${reasons}`,
    );
    assert.ok(
      reasons.indexOf("must accept the driver declaration") < reasons.indexOf("Rate is not guaranteed"),
      `errors rank ahead of warnings: ${reasons}`,
    );
  });

  test("the refusal reaches the ledger masked, with the code intact", () => {
    const msg = rejectionMessage("POST", "/api/reservationwizard/reservation/savedr", refusal);
    assert.match(msg, /POST \/api\/reservationwizard\/reservation\/savedr rejected: \S/);
    assert.match(msg, /RES_DRIVER_DECLARATION/, "the code is the diagnosis; it must survive");
    assert.match(msg, /must accept the driver declaration/);
    for (const leak of ["Mustafa", "Ebadi", "m.ebadi@example.com", "555-0188"]) {
      assert.ok(!msg.includes(leak), `the refusal leaked ${leak}: ${msg}`);
    }
  });

  test("a body with no message text names its keys instead of ending at a colon", () => {
    // The exact regression: HTTP 200, succecss:false, flags set, not one string of prose.
    // "rejected: " with an empty tail is not a thread an operator can pull.
    const msg = rejectionMessage("POST", "/api/reservationwizard/reservation/savedr", {
      succecss: false,
      hasErrors: true,
      errors: null,
      warnings: [],
      notificationMessage: "",
      data: null,
    });
    assert.ok(!/rejected:\s*$/.test(msg), `the empty-tail regression is back: ${msg}`);
    assert.match(msg, /hasErrors set but carried no text/);
    assert.match(msg, /keys: succecss, hasErrors, errors, warnings, notificationMessage, data/);
  });

  test("a rejection with nothing in it at all still says so", () => {
    assert.match(rejectionMessage("POST", "/x", null), /rejected: empty response body/);
    assert.match(rejectionMessage("POST", "/x", {}), /no reason text in body; keys: none/);
  });

  test("a self-referential body cannot hang the reader", () => {
    const loop: any = { success: false, errors: [{ message: "LOOP_GUARD tripped" }] };
    loop.self = loop;
    loop.nested = { parent: loop, warnings: ["also seen"] };
    const reasons = rejectionReasons(loop);
    assert.match(reasons, /LOOP_GUARD tripped/);
    assert.match(reasons, /also seen/);
  });

  test("the flatter error shapes are read too, and the HTTP status is not mistaken for one", () => {
    // A parallel fix collected these key names from real refusals before this reader
    // existed. They are ranked here so that knowledge survives; `status` deliberately
    // is not, because the attempt stores the HTTP status in its own field and ranking
    // it would prepend "status: 400" to every reason line.
    const problem = rejectionReasons({
      status: 400,
      title: "Bad Request",
      detail: "Pickup date is in the past.",
      validationErrors: { pickupDate: ["PICKUP DATE IS IN THE PAST"] },
    });
    assert.match(problem, /Pickup date is in the past/, "the specific reason");
    assert.match(problem, /PICKUP DATE IS IN THE PAST/, "and the field that carried it");
    assert.ok(
      problem.indexOf("PICKUP DATE IS IN THE PAST") < problem.indexOf("Bad Request"),
      `the generic title must rank behind the real reason: ${problem}`,
    );
    assert.ok(!problem.includes("status: 400"), `the HTTP status is not a reason: ${problem}`);

    assert.match(
      rejectionReasons({ message: "Journey is no longer valid.", errorDescription: "J_EXPIRED" }),
      /Journey is no longer valid/,
      "a singular top-level message is still a message",
    );
  });
});


describe("account additional-info is read live, never inherited from the capture", () => {
  const preview = () => ({
    workflowType: WORKFLOW_REQUEST,
    tpmsTruck: "012345",
    artBlock: { unit: "8330" },
    reservation: {
      pickupDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      pickupTime: "09:00:00",
      returnDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      returnTime: "09:00:00",
      branchCode: "9911",
      sipp: "ICAR",
      intentReference: "SHSNX-TEST",
      specialNotes: "Test note.",
      bookingReferences: ["ZZ REF"],
    },
  });

  test("the account's current field list replaces the captured one", () => {
    const model: Record<string, unknown> = {
      additionalInformation: {
        additionalInformationFields: [
          { additionalInformationGid: "91912527020037", fieldName: "Truck Number ", fieldValue: "37046", mandatory: true },
          { additionalInformationGid: "91991858282501", fieldName: "LDAP ", fieldValue: "MRAY0", mandatory: true },
        ],
      },
    };

    const names = useAccountAdditionalInfo(model, ACCOUNT_ADDITIONAL_INFO);
    const fields = (model.additionalInformation as any).additionalInformationFields as any[];

    assert.deepEqual(names, ["LDAP"]);
    assert.equal(fields.length, 1, "a field the account no longer defines must not be sent back");
    assert.ok(
      fields.every((f) => f.additionalInformationGid !== "91912527020037"),
      "gid 91912527020037 is the one Enterprise deleted, and the one savedr refuses over",
    );
    assert.equal(fields[0].fieldValue, "", "the definition arrives empty; setDriver fills it next");
  });

  test("a mandatory field nothing knows how to fill refuses BY NAME", () => {
    const model: Record<string, unknown> = {};
    useAccountAdditionalInfo(model, [
      { additionalInformationGid: "99", fieldName: "Cost Centre ", fieldValue: null, mandatory: true },
    ]);
    assert.throws(
      () => assertAdditionalInfoComplete(model, "ZZEXEC1"),
      /Cost Centre/,
      "ETD only ever says REQUIRED FIELD MISSING, so the refusal here has to name the field itself",
    );
  });

  test("a failed lookup aborts before the commit rather than booking on the captured block", async () => {
    const ldap = `${LDAP_PREFIX}ADDI`;
    const { intentId } = await makeRequestIntent({
      ldap, status: "confirmed", preview: preview(), eventDate: preview().reservation.pickupDate,
    });
    const { client, calls } = fakeEtd({ addInfoThrows: true });

    const run = await runBookingExecutor({ runnerId: "test-exec", intentId, deps: { client, schedule: fakeSchedule() } });

    assert.equal(run.results[0].action, "ABRT");
    assert.equal(run.results[0].status, "aborted_before_open");
    assert.equal(calls.filter((c) => c.startsWith("confirm:")).length, 0, "a stale block must never reach savedr");
    assert.equal(calls.filter((c) => c.startsWith("gate:")).length, 0, "and it stops before the ETD gates");
  });
});


/**
 * The nearest counter is not always one we can rent from.
 *
 * Request #95 (SWICKLA, 2026-08-24) geocoded to its repair shop and took the closest
 * branch, a National-brand desk 0.29 mi nearer than the Enterprise branch that actually
 * had the approved class on the lot. The National desk answers with an EMPTY class list,
 * which surfaces as `class_unmapped` and reads as a vehicle-mapping bug, so the request
 * sat unbooked for hours. book_request.py had the fallback and rescued it; this path did
 * not. These pin the fallback and, just as importantly, pin that it stays OUT of the way
 * when the first quote is fine.
 */
describe("reported-branch fallback", () => {
  /** A quote stub that answers differently per address, and records what it was asked. */
  function addressAwareEtd(byAddress: Record<string, CarClass[] | "throw">) {
    const asked: string[] = [];
    const client = {
      async quote(p: any) {
        asked.push(String(p.address));
        const hit = byAddress[String(p.address)];
        if (hit === "throw") throw new Error("geocoder put the branch in TX, expected WI");
        return {
          journey_id: "j-fb", reference: "R-FB",
          place: { latitude: "44.8", longitude: "-91.5" },
          branch: { branchCode: "4450", customerFacingBranchName: "Eau Claire" },
          branch_pinned: false, branch_code: "4450", branch_name: "Eau Claire",
          branch_address: "2103 S HASTINGS WAY,ALTOONA,WI,54720",
          site: {}, classes: hit ?? [],
        };
      },
    };
    return { client: client as unknown as EtdClient, asked };
  }

  const SHOP = "2521 N Clairemont Ave, EAU Claire, WI";
  const REPORTED = "2103 S Hastings way Altoona Wi 54720";
  const SOME: CarClass[] = [{
    code: "SCAR", description: "VOLKSWAGEN JETTA OR SIMILAR", passengers: "5", bags: "3",
    base_rate: 33.02, estimated_total: 42.01, currency: "USD", unit: null, unlimited_miles: null,
  }];

  function item(reportedBranch: string | null): QueueItem {
    return {
      workflowType: WORKFLOW_REQUEST,
      facts: { requestSeed: { reportedBranch } },
    } as unknown as QueueItem;
  }

  test("an empty class list at the shop address re-quotes from the branch the tech named", async () => {
    const { client, asked } = addressAwareEtd({ [SHOP]: [], [REPORTED]: SOME });
    const out = await quoteWithReportedFallback(
      client, item(REPORTED), SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, true, "the fallback must fire on an empty list");
    assert.equal((out.q.classes ?? []).length, 1, "and the returned quote is the one WITH cars");
    assert.deepEqual(asked, [SHOP, REPORTED], "shop first, tech's answer only as a fallback");
  });

  test("a shop address that already offers cars is never second-guessed", async () => {
    const { client, asked } = addressAwareEtd({ [SHOP]: SOME, [REPORTED]: SOME });
    const out = await quoteWithReportedFallback(
      client, item(REPORTED), SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, false);
    assert.deepEqual(asked, [SHOP], "one quote only — the fallback must not cost a second call");
  });

  test("a reported branch naming no place is refused, not geocoded", async () => {
    // LGONZ15 typed the single word "Enterprise" and it resolved to Boston Logan.
    const { client, asked } = addressAwareEtd({ [SHOP]: [], Enterprise: SOME });
    const out = await quoteWithReportedFallback(
      client, item("Enterprise"), SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, false, "no digit and no state names nowhere on earth");
    assert.deepEqual(asked, [SHOP], "the unlocatable string must never reach the geocoder");
  });

  test("when the fallback is empty too, the original quote survives to report availability", async () => {
    const { client, asked } = addressAwareEtd({ [SHOP]: [], [REPORTED]: [] });
    const out = await quoteWithReportedFallback(
      client, item(REPORTED), SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, false);
    assert.equal((out.q.classes ?? []).length, 0, "an empty list is a real answer about the lot");
    assert.deepEqual(asked, [SHOP, REPORTED]);
  });

  test("a fallback that throws the state guard does not turn 'no cars' into a hard abort", async () => {
    const { client } = addressAwareEtd({ [SHOP]: [], [REPORTED]: "throw" });
    const out = await quoteWithReportedFallback(
      client, item(REPORTED), SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, false, "the throw is swallowed");
    assert.equal(out.q.branch_code, "4450", "and the first quote is still what comes back");
  });

  test("a cutover has no reported branch and is left entirely alone", async () => {
    const { client, asked } = addressAwareEtd({ [SHOP]: [] });
    const cutover = { workflowType: WORKFLOW_CUTOVER, facts: {} } as unknown as QueueItem;
    const out = await quoteWithReportedFallback(
      client, cutover, SHOP, "", "", "2026-08-24T11:00:00", "2026-08-31T09:00:00");
    assert.equal(out.usedReported, false);
    assert.deepEqual(asked, [SHOP]);
  });
});
