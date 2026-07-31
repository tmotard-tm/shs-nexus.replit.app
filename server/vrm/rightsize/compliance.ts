/**
 * VRM Rightsize COMPLIANCE — vehicle-truth view of the right-size initiative.
 *
 * Why this exists alongside the existing tracker (Tyler, 2026-07-30):
 *
 *  1. UNIVERSE. The tracker's universe is a frozen campaign roster (round 1 on
 *     7/10 plus later seed waves). Anyone who opened a rental after seeding was
 *     never added, so on 7/30 the tracker was missing 63 of the 179 technicians
 *     actually sitting on an oversized open ticket. This module takes its
 *     universe from the LIVE Enterprise open-ticket feed instead
 *     (vrm_rental_operations_cases WHERE present_in_latest), so the denominator
 *     is "who is renting right now", rebuilt every sync.
 *
 *  2. RETURNS ARE NOT RIGHT-SIZING. The tracker counted RETURNED as secured,
 *     which padded an initiative that is about getting people into smaller
 *     vehicles. On an open-ticket denominator a returned rental simply leaves
 *     the list, so returns can no longer inflate the numerator.
 *
 *  3. THE TEST IS THE VEHICLE OR THE RATE, NOT THE CLASS DESCRIPTION.
 *        compliant = (rate_authorized <= sedan ceiling)
 *                 OR (the actual rented vehicle is a confirmed sedan nameplate)
 *                 OR (the technician told us in SMS that the swap is done)
 *
 * The third test is Tyler's ruling (2026-07-30): "if they told me they did the
 * swap then they did the swap." It credits a stage of DONE on the SMS tracker
 * even when the Enterprise ticket still shows an oversized class, because the
 * ARI report lags the branch by days. RETURNED is deliberately NOT credited —
 * giving a rental back is not right-sizing.
 *     Rate alone qualifies because Enterprise writing a larger unit down to the
 *     sedan rate costs the company nothing extra. Vehicle alone qualifies
 *     because `Rate Authorized` on the ARI report is the RESERVATION basis, not
 *     the invoiced rate — a real sedan showing an SUV rate is a stale
 *     reservation field, not an overcharge. `Car Class Authorized Description`
 *     is deliberately NOT a test: it reports FULLSIZE for Pacificas, F-150s and
 *     a Tacoma, which is what made the 7/30 hand count read 195 when only 142
 *     of those were physically cars.
 *
 * The sedan nameplate list is a TABLE, not a hardcoded regex, because the
 * previous hardcoded list silently missed Kia Soul, Genesis G70 and the Elantra
 * Hybrid. Fleet edits it in the UI; every edit is attributed.
 *
 * Additive only: new vrm_rightsize_compliance_* / vrm_rightsize_sedan_models
 * tables plus reads of vrm_rental_operations_cases, fs_comms_*, all_techs and
 * the tpms_* mirrors. Nothing here writes to the existing tracker tables.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

/** Top of the sedan rate band on the ARI report. Rates cluster at or below
 *  59.75 and then jump to 68.00 with nothing in between, so this is a real gap
 *  in the data rather than a chosen threshold. */
export const SEDAN_RATE_CEILING = 59.75;

/** Seed nameplates, stored as "MAKE MODEL" exactly as ARI abbreviates them in
 *  Rented Veh Make / Rented Veh Model. Confirmed passenger cars only: no
 *  crossovers, no "small SUV", nothing that merely looks car-adjacent. */
const SEED_SEDANS: Array<[string, string]> = [
  ["NISN SENT", "Nissan Sentra"], ["NISN ALTI", "Nissan Altima"], ["NISN VERS", "Nissan Versa"], ["NISN MAXI", "Nissan Maxima"],
  ["CHEV MALI", "Chevrolet Malibu"], ["CHEV IMPA", "Chevrolet Impala"], ["CHEV CRUZ", "Chevrolet Cruze"], ["CHEV SPAR", "Chevrolet Spark"],
  ["TOYO CORO", "Toyota Corolla"], ["TOYO CAMR", "Toyota Camry"], ["TOYO PRIU", "Toyota Prius"], ["TOYO AVAL", "Toyota Avalon"],
  ["HOND CIVC", "Honda Civic"], ["HOND CIVH", "Honda Civic Hybrid"], ["HOND ACRD", "Honda Accord"], ["HOND ACCH", "Honda Accord Hybrid"],
  ["HYUN SONA", "Hyundai Sonata"], ["HYUN SONH", "Hyundai Sonata Hybrid"], ["HYUN ELAN", "Hyundai Elantra"],
  ["HYUN ELAH", "Hyundai Elantra Hybrid"], ["HYUN ACCE", "Hyundai Accent"],
  ["VOLK JETT", "Volkswagen Jetta"], ["VOLK PASS", "Volkswagen Passat"],
  ["KIA K5", "Kia K5"], ["KIA K4", "Kia K4"], ["KIA RIO", "Kia Rio"], ["KIA FORT", "Kia Forte"],
  ["MITS MIRA", "Mitsubishi Mirage"], ["FORD FUSI", "Ford Fusion"], ["FORD TAUR", "Ford Taurus"],
  ["DODG CHAR", "Dodge Charger"], ["CHRY 300", "Chrysler 300"], ["GENE G70", "Genesis G70"],
  ["SUBA LEGA", "Subaru Legacy"], ["MAZD MAZ3", "Mazda 3"], ["BUIC REGA", "Buick Regal"],
];

export async function initRightsizeComplianceSchema(): Promise<void> {
  // Editable sedan nameplate list. PK is the ARI "MAKE MODEL" token pair.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_sedan_models (
      nameplate  VARCHAR(40) PRIMARY KEY,
      label      TEXT,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      added_by   TEXT,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      note       TEXT
    );
  `);

  // Day-over-day KPI history so the huddle deck can show movement without
  // re-deriving from a spreadsheet each morning.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_compliance_snapshots (
      id               SERIAL PRIMARY KEY,
      snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      file_date        DATE,
      total_open       INTEGER NOT NULL,
      compliant        INTEGER NOT NULL,
      not_compliant    INTEGER NOT NULL,
      by_rate_only     INTEGER NOT NULL DEFAULT 0,
      by_model_only    INTEGER NOT NULL DEFAULT 0,
      by_both          INTEGER NOT NULL DEFAULT 0,
      never_contacted  INTEGER NOT NULL DEFAULT 0,
      hvac_open        INTEGER NOT NULL DEFAULT 0,
      daily_spend      NUMERIC(12,2),
      monthly_over     NUMERIC(12,2)
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_rsz_comp_snap_at ON vrm_rightsize_compliance_snapshots (snapshot_at DESC);`);

  // Seed in ONE statement, not a loop.
  //
  // The first version issued 36 separate INSERT round trips here. Boot DDL runs
  // POST-listen on an autoscale container, so the container was recycled partway
  // through: CREATE TABLE landed, the seed did not, and prod came up with an
  // EMPTY nameplate list. An empty list silently turns the model test off, which
  // makes every sedan fail compliance and the board under-reports. One statement
  // is atomic and cannot half-apply.
  //
  // ON CONFLICT DO NOTHING so Fleet's own edits are never clobbered on boot.
  const values = sql.join(
    SEED_SEDANS.map(([np, label]) => sql`(${np}, ${label}, 'seed', 'initial confirmed-sedan list, 2026-07-30')`),
    sql`, `,
  );
  await db.execute(sql`
    INSERT INTO vrm_rightsize_sedan_models (nameplate, label, added_by, note)
    VALUES ${values}
    ON CONFLICT (nameplate) DO NOTHING;
  `);

  // Self-heal: if the table is somehow still empty we have a silent-wrong-number
  // bug, not a cosmetic one. Say so loudly in the boot log.
  const seeded = await db.execute(sql`SELECT count(*)::int AS n FROM vrm_rightsize_sedan_models WHERE active`);
  const n = Number((seeded as any)?.rows?.[0]?.n ?? 0);
  if (n === 0) {
    console.error("[VRM/RightsizeCompliance] sedan nameplate table is EMPTY after seed — compliance will under-report until this is fixed.");
  } else {
    console.log(`[VRM/RightsizeCompliance] ${n} confirmed sedan nameplates active.`);
  }
}

// ---------------------------------------------------------------- helpers

const last10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const bareTruck = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const NAME_STOP = new Set(["JR", "SR", "II", "III", "IV", "SEARS", "SERVICE", "HOME", "SERVICES"]);
const nameTokens = (s: unknown) =>
  String(s ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !NAME_STOP.has(w));

/** "25 FORD ESCA" -> "FORD ESCA". ARI prefixes the model year. */
export const modelKey = (vehDesc: unknown) =>
  String(vehDesc ?? "").toUpperCase().trim().replace(/^\d{2,4}\s+/, "").replace(/\s+/g, " ").trim();

export type ComplianceRow = {
  caseKey: string | null;
  ticket: string | null;
  truck: string;
  renterName: string | null;
  ldap: string | null;
  matchedBy: "truck" | "name" | "none";
  vehicle: string | null;
  modelKey: string;
  carClass: string | null;
  rate: number;
  daysOpen: number | null;
  ticketStatus: string | null;
  source: string | null;
  vendor: string | null;
  state: string | null;
  district: string | null;
  jobTitle: string | null;
  isHvac: boolean;
  compliant: boolean;
  compliantBy: "rate" | "model" | "both" | "sms" | null;
  smsStage: string | null;
  smsConfirmed: boolean;
  monthlyOverSedan: number;
  outboundCount: number;
  inboundCount: number;
  neverContacted: boolean;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  phone: string | null;
  teamLead: string | null;
};

/**
 * Resolve every open rental to a technician, then score compliance.
 *
 * Identity is deliberately resolved here rather than leaning on
 * vrm_rental_identity_resolutions: that table resolves to employee_id/tech_name,
 * and everything downstream (comms threads, never-contacted) is keyed by ldap.
 * Truck number is tried first, then a 2-token name match. A single shared first
 * name is NEVER enough — an earlier version scored one point per matching source
 * and merged every "Michael" in the company into one record.
 */
export async function computeCompliance(): Promise<{ rows: ComplianceRow[]; kpis: any }> {
  const [cases, sedans, contacts, techs, tpms, trackerStages, msgAgg] = await Promise.all([
    db.execute(sql`
      SELECT case_key, ticket_number, vehicle_number_padded, renter_name_raw, veh_desc, rental_class,
             rate_authorized, days_open, ticket_status, renting_state, district, source, rental_vendor
      FROM vrm_rental_operations_cases WHERE present_in_latest
    `),
    db.execute(sql`SELECT nameplate FROM vrm_rightsize_sedan_models WHERE active`),
    db.execute(sql`SELECT ldap, name, truck_number, phone_digits, manager_name, primary_state, district FROM fs_comms_contacts`),
    db.execute(sql`SELECT tech_racfid AS ldap, first_name, last_name, job_title, truck_lu, last_known_truck_lu FROM all_techs`),
    db.execute(sql`SELECT truck_no, enterprise_id FROM tpms_last_known_truck_tech`),
    db.execute(sql`SELECT upper(ldap) AS ldap, stage FROM vrm_rightsize_techs`),
    db.execute(sql`
      SELECT upper(ldap) AS ldap,
             count(*) FILTER (WHERE direction = 'outbound') AS outbound,
             count(*) FILTER (WHERE direction = 'inbound')  AS inbound,
             max(created_at) FILTER (WHERE direction = 'outbound') AS last_out,
             max(created_at) FILTER (WHERE direction = 'inbound')  AS last_in
      FROM fs_comms_messages WHERE ldap IS NOT NULL GROUP BY 1
    `),
  ]);

  const rowsOf = (r: any) => (r?.rows ?? r ?? []) as any[];
  const sedanSet = new Set(rowsOf(sedans).map((r) => String(r.nameplate).toUpperCase()));

  const truckIdx = new Map<string, string>();
  const addTruck = (t: unknown, ldap: unknown) => {
    const k = bareTruck(t);
    const L = String(ldap ?? "").toUpperCase();
    if (k && L && !truckIdx.has(k)) truckIdx.set(k, L);
  };
  for (const c of rowsOf(contacts)) addTruck(c.truck_number, c.ldap);
  for (const t of rowsOf(techs)) { addTruck(t.truck_lu, t.ldap); addTruck(t.last_known_truck_lu, t.ldap); }
  for (const t of rowsOf(tpms)) addTruck(t.truck_no, t.enterprise_id);

  const nameIdx = [
    ...rowsOf(contacts).map((c) => ({ ldap: String(c.ldap).toUpperCase(), set: new Set(nameTokens(c.name)) })),
    ...rowsOf(techs).map((t) => ({ ldap: String(t.ldap).toUpperCase(), set: new Set(nameTokens(`${t.first_name} ${t.last_name}`)) })),
  ].filter((x) => x.set.size > 0);

  const cByLdap = new Map(rowsOf(contacts).map((c) => [String(c.ldap).toUpperCase(), c]));
  const tByLdap = new Map(rowsOf(techs).map((t) => [String(t.ldap).toUpperCase(), t]));
  const mByLdap = new Map(rowsOf(msgAgg).map((m) => [String(m.ldap).toUpperCase(), m]));
  const stageByLdap = new Map(rowsOf(trackerStages).map((r) => [String(r.ldap).toUpperCase(), String(r.stage ?? "")]));

  const out: ComplianceRow[] = [];
  for (const k of rowsOf(cases)) {
    const truck = bareTruck(k.vehicle_number_padded);
    let ldap: string | null = truckIdx.get(truck) ?? null;
    let matchedBy: ComplianceRow["matchedBy"] = ldap ? "truck" : "none";
    if (!ldap) {
      const want = new Set(nameTokens(k.renter_name_raw));
      if (want.size >= 2) {
        const hit = nameIdx.find((n) => Array.from(want).filter((w) => n.set.has(w)).length >= 2);
        if (hit) { ldap = hit.ldap; matchedBy = "name"; }
      }
    }

    const mk = modelKey(k.veh_desc);
    const rate = Number(k.rate_authorized) || 0;
    const byRate = rate > 0 && rate <= SEDAN_RATE_CEILING;
    const byModel = mk.length > 0 && sedanSet.has(mk);
    // Third test: the technician said the swap is done. RETURNED is NOT credited.
    const smsStage = ldap ? (stageByLdap.get(ldap) ?? null) : null;
    const smsConfirmed = smsStage === "DONE";
    const compliant = byRate || byModel || smsConfirmed;

    const c = ldap ? cByLdap.get(ldap) : null;
    const t = ldap ? tByLdap.get(ldap) : null;
    const m = ldap ? mByLdap.get(ldap) : null;
    const outbound = Number(m?.outbound ?? 0);
    const title = t?.job_title ?? null;

    out.push({
      caseKey: k.case_key ?? null,
      ticket: k.ticket_number ?? null,
      truck,
      renterName: k.renter_name_raw ?? null,
      ldap,
      matchedBy,
      vehicle: k.veh_desc ?? null,
      modelKey: mk,
      carClass: k.rental_class ?? null,
      rate,
      daysOpen: k.days_open ?? null,
      ticketStatus: k.ticket_status ?? null,
      source: k.source ?? null,
      vendor: k.rental_vendor ?? null,
      state: k.renting_state ?? c?.primary_state ?? null,
      district: k.district ?? c?.district ?? null,
      jobTitle: title,
      isHvac: /HVAC/i.test(String(title ?? "")),
      compliant,
      compliantBy: compliant
        ? (byRate && byModel ? "both" : byRate ? "rate" : byModel ? "model" : "sms")
        : null,
      smsStage,
      smsConfirmed,
      monthlyOverSedan: compliant ? 0 : Math.round(Math.max(rate - 54.99, 0) * 30 * 100) / 100,
      outboundCount: outbound,
      inboundCount: Number(m?.inbound ?? 0),
      neverContacted: !compliant && outbound === 0,
      lastOutboundAt: m?.last_out ? new Date(m.last_out).toISOString() : null,
      lastInboundAt: m?.last_in ? new Date(m.last_in).toISOString() : null,
      phone: c?.phone_digits ?? null,
      teamLead: c?.manager_name ?? null,
    });
  }

  // The initiative is measured on the Enterprise open-ticket book, which is the
  // report Fleet colours each morning. Holman non-Enterprise rentals (Hertz,
  // Avis) carry NO vehicle description at all, so they cannot be scored by
  // vehicle and would silently drag the denominator. They are reported
  // separately rather than dropped, because they are still open rentals costing
  // real money.
  const ent = out.filter((r) => r.source === "enterprise");
  const nonEnt = out.filter((r) => r.source !== "enterprise");
  const comp = ent.filter((r) => r.compliant);
  const notComp = ent.filter((r) => !r.compliant);
  const kpis = {
    totalOpen: ent.length,
    nonEnterpriseOpen: nonEnt.length,
    nonEnterpriseDaily: Math.round(nonEnt.reduce((a, r) => a + r.rate, 0)),
    allOpenIncludingNonEnterprise: out.length,
    compliant: comp.length,
    notCompliant: notComp.length,
    compliantPct: ent.length ? Math.round((comp.length / ent.length) * 1000) / 10 : 0,
    byRateOnly: comp.filter((r) => r.compliantBy === "rate").length,
    byModelOnly: comp.filter((r) => r.compliantBy === "model").length,
    byBoth: comp.filter((r) => r.compliantBy === "both").length,
    bySmsOnly: comp.filter((r) => r.compliantBy === "sms").length,
    // What is actually LEFT, split so HVAC never hides the real chase list.
    // HVAC was excluded from round 1 on 7/9 and that exclusion was never
    // revisited, so mixing them in makes the remaining number look worse than
    // the work Fleet can actually action today.
    remainingHvac: notComp.filter((r) => r.isHvac).length,
    remainingHvacMonthly: Math.round(notComp.filter((r) => r.isHvac).reduce((a, r) => a + r.monthlyOverSedan, 0)),
    remainingNonHvac: notComp.filter((r) => !r.isHvac).length,
    remainingNonHvacMonthly: Math.round(notComp.filter((r) => !r.isHvac).reduce((a, r) => a + r.monthlyOverSedan, 0)),
    neverContacted: notComp.filter((r) => r.neverContacted).length,
    neverContactedMonthly: Math.round(notComp.filter((r) => r.neverContacted).reduce((a, r) => a + r.monthlyOverSedan, 0)),
    hvacOpen: notComp.filter((r) => r.isHvac).length,
    hvacMonthly: Math.round(notComp.filter((r) => r.isHvac).reduce((a, r) => a + r.monthlyOverSedan, 0)),
    unresolvedIdentity: ent.filter((r) => !r.ldap).length,
    dailySpend: Math.round(ent.reduce((a, r) => a + r.rate, 0)),
    notCompliantDaily: Math.round(notComp.reduce((a, r) => a + r.rate, 0)),
    monthlyOverSedan: Math.round(notComp.reduce((a, r) => a + r.monthlyOverSedan, 0)),
    sedanRateCeiling: SEDAN_RATE_CEILING,
    sedanModelCount: sedanSet.size,
  };
  return { rows: out, kpis };
}

/** Persist one KPI row so the huddle deck can show day-over-day movement. */
export async function snapshotCompliance(): Promise<any> {
  const { kpis } = await computeCompliance();
  const fd = await db.execute(sql`
    SELECT file_date FROM vrm_rental_operations_import_runs ORDER BY created_at DESC LIMIT 1
  `);
  const fileDate = ((fd as any)?.rows ?? [])[0]?.file_date ?? null;
  await db.execute(sql`
    INSERT INTO vrm_rightsize_compliance_snapshots
      (file_date, total_open, compliant, not_compliant, by_rate_only, by_model_only, by_both,
       never_contacted, hvac_open, daily_spend, monthly_over)
    VALUES (${fileDate}, ${kpis.totalOpen}, ${kpis.compliant}, ${kpis.notCompliant},
            ${kpis.byRateOnly}, ${kpis.byModelOnly}, ${kpis.byBoth},
            ${kpis.neverContacted}, ${kpis.hvacOpen}, ${kpis.dailySpend}, ${kpis.monthlyOverSedan});
  `);
  return kpis;
}
