/**
 * Cross-surface alignment tests: Rental Operations (master board), Cases by
 * Region, Today's Ops Queue, and the Executive Summary must agree on every
 * shared field — same shop-of-record pick, same phones, same AMS status and
 * bucket rule, same ready-verified marks, same headline aggregates.
 *
 * Two layers:
 *   1. UNIT — the shared helpers themselves (cleanPhone, displayShopFor,
 *      attachReconciledShops, client case-model derivations). No DB.
 *   2. INTEGRATION — builds the real payload for each surface via the SAME
 *      exported builders the routes call, then cross-checks them row by row.
 *      Needs DATABASE_URL (dev DB); tests skip when absent.
 *
 * Timing caveat: each builder reads the DB at its own moment. A scheduled
 * ingest landing mid-test can shift a row and fail a strict compare — rerun
 * clears it. Kept strict on purpose: looseness here defeats the point.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanPhone,
  displayShopFor,
  attachReconciledShops,
  foldFallbackPhones,
  canonTruckKey,
  amsBucketOf,
  type QueuePoContext,
} from "../server/vrm/rental-operations/read-repository";
import { buildMasterBoardPayload } from "../server/vrm/rental-operations/routes";
import { buildByRegionPayload } from "../server/vrm/rental-operations/region-routes";
import { buildTodaysQueue } from "../server/todays-queue";
import { getExecutiveSummary } from "../server/vrm/executive-summary/routes";
import { normalizeVendor } from "../server/vrm/executive-summary/buckets";
import {
  workloadBucketOf,
  isNewHire,
  isUrgentEmp,
  isDeclinedAuction,
  daysSince,
} from "../client/src/pages/vehicle-rental-management/lib/case-model";

const HAS_DB = !!process.env.DATABASE_URL;

// ── unit: cleanPhone (the ONE phone gate for display + step-9 dialability) ──

test("cleanPhone accepts 10-digit numbers in any formatting", () => {
  assert.equal(cleanPhone("6155551234"), "6155551234");
  assert.equal(cleanPhone("(615) 555-1234"), "6155551234");
  assert.equal(cleanPhone(" 615.555.1234 "), "6155551234");
});

test("cleanPhone strips a leading 1 from 11-digit numbers", () => {
  assert.equal(cleanPhone("16155551234"), "6155551234");
  assert.equal(cleanPhone("+1 615 555 1234"), "6155551234");
});

test("cleanPhone rejects junk", () => {
  assert.equal(cleanPhone("0000000000"), null); // repeated-digit placeholder
  assert.equal(cleanPhone("9999999999"), null);
  assert.equal(cleanPhone("55512"), null); // too short
  assert.equal(cleanPhone("26155551234"), null); // 11 digits, not a +1 prefix
  assert.equal(cleanPhone(null), null);
  assert.equal(cleanPhone(""), null);
});

// ── unit: displayShopFor (the ONE display pick for boards, queue, drawer) ──

const ctxWith = (over: Partial<QueuePoContext>): QueuePoContext => ({
  effStatus: "APPROVED",
  openPoCount: 1,
  repairStartDate: "2026-08-01",
  openEvidenceAt: null,
  portalAt: "2026-08-05T12:00:00Z",
  shopName: "Midway Auto",
  shopPoDate: "2026-08-01",
  shopPhone: "6155551234",
  poNumber: "PO123",
  shopPhoneLocked: false,
  shopNameOverridden: false,
  ...over,
});

test("displayShopFor: no context and no fallback → null (nothing to show)", () => {
  assert.equal(displayShopFor(undefined, null), null);
  assert.equal(displayShopFor(null, ""), null);
  assert.equal(displayShopFor(null, "1111111111"), null); // junk fallback stays null
});

test("displayShopFor: fs_trucks fallback fills phone when no PO context", () => {
  const d = displayShopFor(undefined, "(615) 555-9999");
  assert.ok(d);
  assert.equal(d.shopPhone, "6155559999");
  assert.equal(d.shopPhoneIsFallback, true);
  assert.equal(d.shopName, null); // fallback NEVER invents a shop name
  assert.equal(d.openPoCount, 0);
  assert.equal(d.effStatus, null);
});

test("displayShopFor: context phone wins over fallback, flagged as reconciled", () => {
  const d = displayShopFor(ctxWith({}), "6150000000");
  assert.ok(d);
  assert.equal(d.shopPhone, "6155551234");
  assert.equal(d.shopPhoneIsFallback, false);
  assert.equal(d.shopName, "Midway Auto");
});

test("displayShopFor: context without phone borrows the fallback, keeps PO fields", () => {
  const d = displayShopFor(ctxWith({ shopPhone: null }), "1-615-555-8888");
  assert.ok(d);
  assert.equal(d.shopPhone, "6155558888");
  assert.equal(d.shopPhoneIsFallback, true);
  assert.equal(d.shopName, "Midway Auto");
  assert.equal(d.poNumber, "PO123");
});

// ── unit: attachReconciledShops (the ONE board attach) ──

test("attachReconciledShops: null context keeps the field ABSENT (never stamps null)", () => {
  const rows = [{ case_key: "88144", shop_name: "x" }];
  const out = attachReconciledShops(rows, null, new Map([["88144", "6155551234"]]));
  assert.equal(out, rows); // same array back, untouched
  assert.ok(!("reconciledShop" in out[0]));
});

test("attachReconciledShops: stamps by canonical truck key with fs fallback", () => {
  const ctx = new Map<string, QueuePoContext>([[canonTruckKey("088144"), ctxWith({})]]);
  const phones = new Map<string, string | null>([[canonTruckKey("099001"), "6155550000"]]);
  const out = attachReconciledShops(
    [{ case_key: "88144" }, { case_key: "99001" }, { case_key: "77000" }],
    ctx,
    phones,
  );
  assert.equal(out[0].reconciledShop?.shopName, "Midway Auto"); // ctx hit via canon
  assert.equal(out[1].reconciledShop?.shopPhone, "6155550000"); // fallback-only row
  assert.equal(out[1].reconciledShop?.shopPhoneIsFallback, true);
  assert.equal(out[2].reconciledShop, null); // no ctx, no fallback
});

// ── unit: foldFallbackPhones (fallback map merge rule) ──

test("foldFallbackPhones: padded dups fold; conflicting phones drop the key", () => {
  const m = foldFallbackPhones([
    { truck_number: "01234", repair_phone: "6155551234" }, // same truck…
    { truck_number: "1234", repair_phone: "(615) 555-1234" }, // …other padding, same phone
    { truck_number: "05678", repair_phone: null }, // phone-less dup first…
    { truck_number: "5678", repair_phone: "6155559999" }, // …real row fills the hole
    { truck_number: "07777", repair_phone: "6155550001" }, // two DIFFERENT valid phones…
    { truck_number: "7777", repair_phone: "6155550002" }, // …ambiguous → no fallback
    { truck_number: "7777", repair_phone: "6155550001" }, // late agreeing row can't revive it
    { truck_number: "", repair_phone: "6155550003" }, // uncanonicalizable → ignored
  ]);
  assert.equal(m.get("1234"), "6155551234");
  assert.equal(m.get("5678"), "6155559999");
  assert.equal(m.get("7777"), null); // present but explicitly no fallback
  assert.equal(m.size, 3);
});

// ── unit: client case-model derivations (shared by both boards) ──

test("client workloadBucketOf mirrors the chip/filter rule", () => {
  assert.equal(workloadBucketOf({ ams_bucket: "declined" }), "cannot_work");
  assert.equal(workloadBucketOf({ ams_bucket: "auction", workload_bucket: "mismatch_no_po" }), "cannot_work");
  assert.equal(workloadBucketOf({ ams_bucket: "in_repair", workload_bucket: "mismatch_no_po" }), "mismatch_no_po");
  assert.equal(workloadBucketOf({ ams_bucket: "unknown" }), "workable");
  assert.ok(isDeclinedAuction("declined") && isDeclinedAuction("auction") && !isDeclinedAuction("in_use"));
});

test("client isNewHire = Active within 270 days; isUrgentEmp = Terminated/On Leave", () => {
  const d200 = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const d300 = new Date(Date.now() - 300 * 86_400_000).toISOString();
  assert.equal(isNewHire({ employee_status: "Active", employee_status_date: d200 }), true);
  assert.equal(isNewHire({ employee_status: "Active", employee_status_date: d300 }), false);
  assert.equal(isNewHire({ employee_status: "Terminated", employee_status_date: d200 }), false);
  assert.equal(isNewHire({ employee_status: "Active", employee_status_date: null }), false);
  assert.equal(isUrgentEmp({ employee_status: "Terminated" }), true);
  assert.equal(isUrgentEmp({ employee_status: "On Leave" }), true);
  assert.equal(isUrgentEmp({ employee_status: "Active" }), false);
  assert.equal(daysSince(null), null);
  assert.equal(daysSince("not a date"), null);
});

// ── integration: the four surfaces, built via the routes' own builders ──

type AnyRow = Record<string, any>;
let surfacesP: Promise<{
  master: AnyRow;
  region: AnyRow;
  queue: AnyRow;
  exec: AnyRow;
}> | null = null;

function surfaces() {
  // One build, shared by every integration test; sequential so the payloads
  // are as close together in time as possible (and share the PO-context SWR).
  // If a scheduled ingest lands between the master and region reads the case
  // SETS diverge — that is clock noise, not surface drift, so rebuild once
  // before letting the strict comparisons run.
  surfacesP ??= (async () => {
    let master = await buildMasterBoardPayload(false);
    let region = await buildByRegionPayload(false);
    const keysOf = (p: AnyRow) => JSON.stringify((p.rows as AnyRow[]).map((r) => r.case_key).sort());
    if (keysOf(master) !== keysOf(region)) {
      console.log("# case sets diverged (ingest raced the build) — rebuilding once");
      master = await buildMasterBoardPayload(false);
      region = await buildByRegionPayload(false);
    }
    const queue = await buildTodaysQueue();
    const exec = await getExecutiveSummary();
    return { master, region, queue, exec };
  })();
  return surfacesP;
}

const byCaseKey = (rows: AnyRow[]) => new Map<string, AnyRow>(rows.map((r) => [r.case_key, r]));

const WORKBOOK_FIELDS = new Set([
  "workbook_status",
  "workbook_actor",
  "workbook_updated_at",
  "workbook_next_action",
]);

test("master vs by-region: same cases, every shared field identical", { skip: !HAS_DB }, async () => {
  const { master, region } = await surfaces();
  const m = byCaseKey(master.rows);
  const r = byCaseKey(region.rows);
  assert.equal(m.size, master.rows.length, "master case_key not unique");
  assert.deepEqual([...m.keys()].sort(), [...r.keys()].sort(), "case sets differ");

  // Computed against NOW() in SQL at each build — two builds minutes apart
  // legitimately differ by the elapsed wall-clock time. Everything else is
  // ingested data and must match exactly.
  const TIME_DERIVED_TOLERANCE: Record<string, number> = { po_evidence_age_hours: 0.5 };

  for (const [key, mrow] of m) {
    const rrow = r.get(key)!;
    for (const field of Object.keys(mrow)) {
      if (WORKBOOK_FIELDS.has(field)) continue; // master-only route attachment
      const tol = TIME_DERIVED_TOLERANCE[field];
      if (tol != null && typeof mrow[field] === "number" && typeof rrow[field] === "number") {
        assert.ok(
          Math.abs(mrow[field] - rrow[field]) <= tol,
          `field "${field}" drifted beyond clock skew for case ${key}: ${mrow[field]} vs ${rrow[field]}`,
        );
        continue;
      }
      assert.deepEqual(
        rrow[field],
        mrow[field],
        `field "${field}" drifted between boards for case ${key}`,
      );
    }
    assert.ok("reconciledShop" in mrow, `master row ${key} missing reconciledShop`);
    assert.ok("reconciledShop" in rrow, `region row ${key} missing reconciledShop`);
  }
});

test("by-region rollups sum back to the board total", { skip: !HAS_DB }, async () => {
  const { region } = await surfaces();
  const rollup = (region.regions ?? []) as AnyRow[];
  const unassigned = region.unassigned?.caseCount ?? region.unassigned?.count ?? 0;
  const sum = rollup.reduce((a, g) => a + (g.caseCount ?? g.count ?? 0), 0) + unassigned;
  assert.equal(sum, region.rows.length, "region rollup counts don't sum to row total");
});

test("master ams_bucket always equals amsBucketOf(ams_status) — one bucket rule", { skip: !HAS_DB }, async () => {
  const { master } = await surfaces();
  for (const row of master.rows as AnyRow[]) {
    assert.equal(row.ams_bucket, amsBucketOf(row.ams_status), `bucket rule drifted for ${row.case_key}`);
  }
});

test("queue chips repeat the master board's reconciled shop verbatim", { skip: !HAS_DB }, async () => {
  const { master, queue } = await surfaces();
  const m = byCaseKey(master.rows);
  // Actionable items only: noAction rows are dead-end trucks that intentionally
  // omit the case-facing fields, so there is nothing to align there.
  const items: AnyRow[] = queue.items ?? [];
  assert.ok(items.length > 0, "queue returned no items to compare");

  let compared = 0;
  for (const it of items) {
    if (!it.caseKey) continue;
    const row = m.get(it.caseKey);
    if (!row) continue; // case dropped from listing view — nothing to align with
    const rs = row.reconciledShop ?? null;
    const chips = it.contextChips;
    if (chips) {
      compared++;
      assert.equal(chips.shopName ?? null, rs?.shopName ?? null, `chip shopName ≠ board for ${it.caseKey}`);
      assert.equal(chips.shopPhone ?? null, rs?.shopPhone ?? null, `chip shopPhone ≠ board for ${it.caseKey}`);
      assert.equal(chips.effStatus ?? null, rs?.effStatus ?? null, `chip effStatus ≠ board for ${it.caseKey}`);
      assert.equal(chips.openPoDate ?? null, rs?.shopPoDate ?? null, `chip PO date ≠ board for ${it.caseKey}`);
      assert.equal(chips.portalAt ?? null, rs?.portalAt ?? null, `chip portalAt ≠ board for ${it.caseKey}`);
    }
    assert.equal(it.amsStatus ?? null, row.ams_status ?? null, `amsStatus ≠ board for ${it.caseKey}`);
    assert.equal(it.amsBucket ?? "unknown", row.ams_bucket, `amsBucket ≠ board for ${it.caseKey}`);
    assert.equal(!!it.readyVerified, row.ready_verified === true, `readyVerified ≠ board for ${it.caseKey}`);
    if (it.readyVerified && row.ready_verified_by != null) {
      assert.equal(it.readyVerified.by, row.ready_verified_by, `readyVerified.by ≠ board for ${it.caseKey}`);
    }
  }
  assert.ok(compared > 0, "no queue item had contextChips + a matching board row");
});

test("executive summary headline re-derives from the master rows", { skip: !HAS_DB }, async () => {
  const { master, exec } = await surfaces();
  const rows = master.rows as AnyRow[];
  const h = exec.headline;

  assert.equal(h.openTotal, rows.length, "openTotal ≠ master row count");

  const spend = rows.reduce((a, r) => a + (r.daily_cost ?? 0), 0);
  assert.ok(Math.abs(h.dailySpend - spend) < 0.011, `dailySpend ${h.dailySpend} ≠ Σ daily_cost ${spend}`);

  const over30 = rows.filter((r) => r.days_open != null && r.days_open > 30).length;
  assert.equal(h.over30Count, over30, "over30Count ≠ master recount");

  const byVendor: Record<string, number> = {};
  for (const r of rows) {
    const v = normalizeVendor(r.rental_vendor);
    byVendor[v] = (byVendor[v] ?? 0) + 1;
  }
  assert.deepEqual(h.byVendor, byVendor, "byVendor ≠ master recount");
});

// ─── Activity log labels (shared case pop-up) ───────────────────────────────
// Every board writes the same vrm_rental_operation_actions rows; the pop-up's
// Activity log is where operators read them back. Labels must stay plain
// language and never blank — including for writers added later.
import { describeAction } from "../client/src/pages/vehicle-rental-management/lib/activity-log";

test("activity labels: every known writer renders a sentence, unknown types never blank", () => {
  const at = (action_type: string, extra: Partial<Parameters<typeof describeAction>[0]> = {}) =>
    describeAction({ action_type, mark_value: null, note: null, actor: "t", created_at: "2026-08-11", ...extra });

  assert.equal(at("mark", { mark_value: "pickup" }).label, "Marked PICKUP");
  assert.equal(at("mark", { mark_value: "none" }).label, "Operator mark cleared");
  assert.equal(at("ready_verified", { payload: { verified: "true" } }).label, "Ready verified with the shop");
  assert.equal(at("ready_verified", { payload: { verified: "false" } }).label, "Ready verification undone");
  assert.equal(at("research_escalation", { payload: { active: "true" } }).label, "Escalated to research");
  assert.equal(at("research_escalation", { payload: { active: "false" } }).label, "Research escalation cleared");
  assert.equal(at("assign_owner", { assigned_to: "jmorga1", payload: { auto: "false" } }).label, "Owner set to jmorga1");
  assert.equal(at("assign_owner", { payload: { auto: "true" } }).label, "Owner returned to automatic routing");
  assert.equal(at("queue_dismiss", { payload: { undo: "false", day: "2026-08-11" } }).label, "Dismissed from today's queue");
  assert.equal(at("queue_dismiss", { payload: { undo: "true", day: "2026-08-11" } }).label, "Queue dismissal undone");
  assert.equal(
    at("fleet_status", { mark_value: "Vehicle Ready", payload: { sub_status: "At Shop" } }).label,
    "Fleet status → Vehicle Ready — At Shop",
  );
  assert.equal(at("schedule_pickup", { mark_value: "cleared" }).label, "Pickup schedule cleared");
  assert.equal(
    at("schedule_pickup", { mark_value: "2026-08-12", payload: { route_block_requested: true } }).detail,
    "route block requested",
  );
  const text = at("pickup_text", { note: "Pickup text sent to SMITH,JOHN", payload: { body: "Your van is ready" } });
  assert.equal(text.label, "Pickup text sent to SMITH,JOHN");
  assert.equal(text.detail, "Your van is ready");
  assert.equal(at("identity_override", { payload: { cleared: "true" } }).label, "Renter identity override cleared");
  assert.equal(
    at("identity_override", { note: "Renter identity pinned to SMITH,J (PO 123)" }).label,
    "Renter identity pinned to SMITH,J (PO 123)",
  );
  // payload arriving as a JSON string (driver/serialization variance) still parses
  assert.equal(at("ready_verified", { payload: '{"verified":"true"}' }).label, "Ready verified with the shop");
  // unknown/future action types: humanized fallback, never a blank row
  const fb = at("shiny_new_thing", { note: "details here" });
  assert.equal(fb.label, "Shiny new thing");
  assert.equal(fb.detail, "details here");
});
