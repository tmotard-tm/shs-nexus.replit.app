import assert from "node:assert/strict";

import {
  createVanDeliveryBuilder,
  parseDeliveredDate,
  renderVanDeliveryCsv,
  VanDeliverySourceUnavailableError,
  type OnboardingHireSource,
  type PalTransportSource,
} from "./van-delivery-read-model";

// ── parseDeliveredDate ───────────────────────────────────────────────────────
// PAL's delivered field is free text with no year on the common form.

assert.equal(parseDeliveredDate("8/28", "2026-08-25"), "2026-08-28");
assert.equal(parseDeliveredDate("5/1", "2026-04-28"), "2026-05-01");
assert.equal(parseDeliveredDate("08/27", "2026-08-20"), "2026-08-27");
assert.equal(parseDeliveredDate("8/28/26", "2026-08-25"), "2026-08-28");
assert.equal(parseDeliveredDate("8/28/2026", "2026-08-25"), "2026-08-28");
// Year rolls forward across the December → January boundary.
assert.equal(parseDeliveredDate("1/6", "2025-12-22"), "2026-01-06");
// A delivered month just behind the submitted month is a back-dated entry in
// the same year, not a year-forward roll.
assert.equal(parseDeliveredDate("7/30", "2026-08-02"), "2026-07-30");
// Never guess.
assert.equal(parseDeliveredDate("", "2026-08-25"), null);
assert.equal(parseDeliveredDate("TBD", "2026-08-25"), null);
assert.equal(parseDeliveredDate("next week", "2026-08-25"), null);
assert.equal(parseDeliveredDate("2/30", "2026-02-01"), null);
assert.equal(parseDeliveredDate("13/1", "2026-08-25"), null);
// No year on the text and no submitted date to borrow one from.
assert.equal(parseDeliveredDate("8/28", null), null);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function hire(overrides: Partial<OnboardingHireSource> = {}): OnboardingHireSource {
  return {
    enterpriseId: "TTECH1",
    employeeName: "TECH,TEST",
    serviceDate: "2026-08-03",
    district: "D1",
    workState: "NC",
    byovIntent: null,
    employmentStatus: "Active",
    assignedTruckNo: "046625",
    assignedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function transport(overrides: Partial<PalTransportSource> = {}): PalTransportSource {
  return {
    id: 1279,
    truck: "46625",
    status: "completed",
    delivered: "8/20",
    submitted: "2026-08-10",
    eta: "08/19",
    ...overrides,
  };
}

function build(hires: OnboardingHireSource[], transports: PalTransportSource[]) {
  return createVanDeliveryBuilder({
    readOnboardingHires: async () => ({ data: hires, sourceUpdatedAt: "2026-08-31T06:00:00.000Z" }),
    readPalTransports: async () => ({ data: transports, sourceUpdatedAt: "2026-08-31T07:00:00.000Z" }),
  });
}

// ── Happy path: a completed transport after the assignment is the delivery ───

{
  const { model } = await build([hire()], [transport()])({ hiredFrom: "2026-01-01" });
  const row = model.rows[0];
  assert.equal(row.status, "delivered");
  assert.equal(row.vanDeliveredOn, "2026-08-20");
  assert.equal(row.daysHireToVanDelivered, 17);
  assert.equal(row.daysHireToTruckAssigned, 2);
  assert.equal(row.deliverySource, "pal_transport");
  assert.equal(row.transportRecordId, 1279);
  assert.deepEqual(row.warnings, []);
  assert.equal(model.summary.byStatus.delivered, 1);
  assert.equal(model.summary.daysToVan.measured, 1);
  assert.equal(model.summary.daysToVan.median, 17);
}

// Leading zeros must not break the join: Nexus stores "046625", PAL "46625".
{
  const { model } = await build(
    [hire({ assignedTruckNo: "046625" })],
    [transport({ truck: "46625" })],
  )({});
  assert.equal(model.rows[0].status, "delivered");
  assert.equal(model.rows[0].truckNumber, "46625");
}

// ── The anchor: an older transport for the same truck is NOT this delivery ───

{
  const { model } = await build(
    [hire({ serviceDate: "2026-08-03", assignedAt: "2026-08-05T12:00:00.000Z" })],
    // Delivered to the truck's PREVIOUS technician, months earlier.
    [transport({ delivered: "3/11", submitted: "2026-03-02" })],
  )({});
  assert.equal(model.rows[0].status, "no_transport_record");
  assert.equal(model.rows[0].vanDeliveredOn, null);
  assert.equal(model.rows[0].warnings[0].code, "PARTIAL_DATA");
}

// A delivery two days before the assignment was keyed in still counts (grace).
{
  const { model } = await build(
    [hire({ assignedAt: "2026-08-05T12:00:00.000Z" })],
    [transport({ delivered: "8/3", submitted: "2026-07-28" })],
  )({});
  assert.equal(model.rows[0].status, "delivered");
  assert.equal(model.rows[0].vanDeliveredOn, "2026-08-03");
}

// Four days before is outside the grace window and is treated as a prior move.
{
  const { model } = await build(
    [hire({ assignedAt: "2026-08-05T12:00:00.000Z" })],
    [transport({ delivered: "8/1", submitted: "2026-07-28" })],
  )({});
  assert.equal(model.rows[0].status, "no_transport_record");
}

// ── Statuses other than delivered ────────────────────────────────────────────

{
  const { model } = await build(
    [hire({ assignedTruckNo: null, assignedAt: null })],
    [transport()],
  )({});
  assert.equal(model.rows[0].status, "awaiting_truck_assignment");
  assert.equal(model.rows[0].truckNumber, null);
}

{
  const { model } = await build(
    [hire({ assignedTruckNo: null, assignedAt: null, byovIntent: "perm" })],
    [],
  )({});
  assert.equal(model.rows[0].status, "byov_no_van");
}

{
  const { model } = await build(
    [hire()],
    [transport({ status: "standard", delivered: "", submitted: "2026-08-06" })],
  )({});
  assert.equal(model.rows[0].status, "in_transit");
  assert.equal(model.rows[0].transportRecordId, 1279);
  assert.equal(model.rows[0].vanDeliveredOn, null);
}

// A cancelled transport is not in-transit and not a delivery.
{
  const { model } = await build(
    [hire()],
    [transport({ status: "cancelled", delivered: "", submitted: "2026-08-06" })],
  )({});
  assert.equal(model.rows[0].status, "no_transport_record");
}

// No PAL record at all — the Holman tow case. Says so, never guesses a date.
{
  const { model } = await build([hire()], [])({});
  const row = model.rows[0];
  assert.equal(row.status, "no_transport_record");
  assert.equal(row.vanDeliveredOn, null);
  assert.match(row.warnings.map((w) => w.message).join(" "), /towed through Holman|handed over locally/);
}

// ── Data-quality guards ──────────────────────────────────────────────────────

// "BYOV" in the truck-number column must never be padded into a fake number.
{
  const { model } = await build([hire({ assignedTruckNo: "BYOV" })], [transport()])({});
  const row = model.rows[0];
  assert.equal(row.status, "no_transport_record");
  assert.equal(row.truckNumber, "BYOV");
  assert.equal(row.warnings[0].code, "PARTIAL_DATA");
}

// One truck on two hires: both rows carry the ambiguity, neither is silent.
{
  const { model } = await build(
    [
      hire({ enterpriseId: "AONE", serviceDate: "2026-08-03" }),
      hire({ enterpriseId: "BTWO", serviceDate: "2026-08-10", assignedAt: "2026-08-11T12:00:00.000Z" }),
    ],
    [transport({ delivered: "8/20", submitted: "2026-08-10" })],
  )({});
  assert.equal(model.rows.length, 2);
  for (const row of model.rows) {
    assert.ok(row.warnings.some((warning) => warning.code === "AMBIGUOUS_MATCH"), row.enterpriseId ?? "");
  }
}

// Two qualifying completed transports: report the earliest, flag the rest.
{
  const { model } = await build(
    [hire()],
    [
      transport({ id: 1, delivered: "8/20", submitted: "2026-08-10" }),
      transport({ id: 2, delivered: "8/28", submitted: "2026-08-25" }),
    ],
  )({});
  assert.equal(model.rows[0].vanDeliveredOn, "2026-08-20");
  assert.equal(model.rows[0].transportRecordId, 1);
  assert.ok(model.rows[0].warnings.some((warning) => warning.code === "AMBIGUOUS_MATCH"));
}

// A BYOV-flagged hire that also carries a truck is reported, but flagged.
{
  const { model } = await build([hire({ byovIntent: "training" })], [transport()])({});
  assert.equal(model.rows[0].status, "delivered");
  assert.ok(model.rows[0].warnings.some((warning) => warning.code === "PARTIAL_DATA"));
}

// ── Filters ──────────────────────────────────────────────────────────────────

{
  const hires = [
    hire({ enterpriseId: "OLD", serviceDate: "2026-01-05" }),
    hire({ enterpriseId: "NEW", serviceDate: "2026-08-03" }),
  ];
  const { model } = await build(hires, [transport()])({ hiredFrom: "2026-06-01" });
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].enterpriseId, "NEW");
  assert.equal(model.filters.hiredFrom, "2026-06-01");
}

// Future-dated hires are excluded unless asked for: they have not started.
{
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const hires = [hire({ enterpriseId: "FUTURE", serviceDate: future, assignedTruckNo: null, assignedAt: null })];
  assert.equal((await build(hires, [])({})).model.rows.length, 0);
  assert.equal((await build(hires, [])({ includeFutureHires: true })).model.rows.length, 1);
}

// ── Summary arithmetic ───────────────────────────────────────────────────────

{
  // Hired 2026-06-01; delivered 3, 10, 26 and 40 days later.
  const deliveries = ["6/4", "6/11", "6/27", "7/11"];
  const hires = deliveries.map((_, index) =>
    hire({
      enterpriseId: `T${index}`,
      serviceDate: "2026-06-01",
      assignedTruckNo: String(1000 + index),
      assignedAt: "2026-06-01T00:00:00.000Z",
    }));
  const transports = deliveries.map((delivered, index) =>
    transport({
      id: index,
      truck: String(1000 + index),
      submitted: "2026-06-01",
      delivered,
    }));
  const { model } = await build(hires, transports)({});
  const summary = model.summary.daysToVan;
  assert.equal(summary.measured, 4);
  assert.equal(summary.min, 3);
  assert.equal(summary.max, 40);
  assert.equal(summary.mean, 19.8);
  assert.equal(summary.withinSevenDays, 1);
  assert.equal(summary.withinFourteenDays, 2);
  assert.equal(summary.overThirtyDays, 1);
  assert.equal(model.summary.hireCount, 4);
}

// ── PAL outage is a 503, never a page of blank delivery dates ────────────────

{
  const builder = createVanDeliveryBuilder({
    readOnboardingHires: async () => ({ data: [hire()], sourceUpdatedAt: null }),
    readPalTransports: async () => { throw new Error("ECONNREFUSED"); },
  });
  await assert.rejects(() => builder({}), VanDeliverySourceUnavailableError);
}

// An empty PAL response is reported as a source warning, not silently.
{
  const { warnings } = await build([hire()], [])({});
  assert.equal(warnings[0].code, "SOURCE_UNAVAILABLE");
}

// ── CSV ──────────────────────────────────────────────────────────────────────

{
  const { model } = await build([hire()], [transport()])({});
  const csv = renderVanDeliveryCsv(model.rows);
  const [header, first] = csv.trim().split("\r\n");
  assert.equal(header.split(",")[0], "enterprise_id");
  assert.ok(header.includes("van_delivered_on"));
  assert.ok(first.includes("2026-08-20"));
  assert.ok(first.includes("TTECH1"));
}

// Commas and quotes in a warning message must not break the row.
{
  const { model } = await build([hire({ assignedTruckNo: 'BY"OV, X' })], [])({});
  const csv = renderVanDeliveryCsv(model.rows);
  assert.equal(csv.trim().split("\r\n").length, 2);
  assert.ok(csv.includes('""'));
}

console.log("van-delivery-read-model: all assertions passed");
