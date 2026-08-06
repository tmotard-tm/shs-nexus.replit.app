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
 * The SMS test is Tyler's ruling (2026-07-30): "if they told me they did the
 * swap then they did the swap." It credits a stage of DONE on the SMS tracker
 * even when the Enterprise ticket still shows an oversized class, because the
 * ARI report lags the branch by days. RETURNED is deliberately NOT credited —
 * giving a rental back is not right-sizing.
 *     RATE AND VEHICLE ARE TWO DIFFERENT THINGS (Tyler, clarified 2026-08-03):
 *     some techs secured the sedan RATE while keeping their larger rental —
 *     right-sized by rate, the company pays sedan money. Others show a sedan
 *     VEHICLE at a rate above the ceiling — right-sized by the vehicle,
 *     because `Rate Authorized` on the ARI report is the RESERVATION basis,
 *     not the invoiced rate; a real sedan showing an SUV rate is a stale
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
import { VAN_STATUS_JOIN, VAN_STATUS_COLUMNS, vanFieldsOf, type VanStatusRow } from "./workload";
import { sql } from "drizzle-orm";

/** Top of the sedan rate band on the ARI report. Rates cluster at or below
 *  59.75 and then jump to 68.00 with nothing in between, so this is a real gap
 *  in the data rather than a chosen threshold. */
export const SEDAN_RATE_CEILING = 59.75;

/** Program economics, not a rate-sheet delta. Fleet books savings at this rate
 *  per right-sized rental (Tyler, 2026-08-05). The observable ARI daily delta is
 *  only $4-8; the rest is fuel, mileage and the wider program cost. */
export const SAVINGS_PER_RENTAL_MONTHLY = 420;

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

  // Trade exclusions. HVAC was carved out on 7/9, but job_title alone does NOT
  // identify the trade: on 8/5 only 4 of 8 Refrigerator/HVAC hybrids carried a
  // Tech 3 title and none carried "HVAC". A hardcoded regex will always leak, so
  // Fleet maintains this list the same way it maintains the sedan nameplates.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_trade_exclusions (
      ldap       VARCHAR(60) PRIMARY KEY,
      label      TEXT,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      added_by   TEXT,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      note       TEXT
    );
  `);
  const tradeSeed = sql.join(
    ([
      ["CANDER4","Refrigerator/HVAC hybrid"],["ADITTA1","Refrigerator/HVAC hybrid"],
      ["VTARASY","Refrigerator/HVAC hybrid"],["JCARDO3","Refrigerator/HVAC hybrid"],
      ["PDUNKL","Refrigerator/HVAC hybrid"],["DPLANT","Refrigerator/HVAC hybrid"],
      ["SFNU0","Refrigerator/HVAC hybrid"],["CSCOTT","Refrigerator/HVAC hybrid"],
      ["AFRELIC","Refrigerator/HVAC hybrid"],
    ] as Array<[string,string]>).map(([l,lab]) => sql`(${l}, ${lab}, 'seed', 'self-declared refrigeration / sealed-system work, 2026-08-05')`),
    sql`, `,
  );
  await db.execute(sql`
    INSERT INTO vrm_rightsize_trade_exclusions (ldap, label, added_by, note)
    VALUES ${tradeSeed}
    ON CONFLICT (ldap) DO NOTHING;
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

/**
 * The MECE row every OPEN RENTAL lands in, in certainty order.
 *
 * This is the unit the board is scored on. The old stage table counted campaign
 * roster TECHNICIANS, so it summed to a different number than the header and
 * could not see the 65 open rentals that were never in the campaign at all.
 * One rental, one bucket, and the buckets sum to the open book exactly.
 */
export type ComplianceBucket =
  | "rightsized"    // the vehicle or the rate already proves it
  | "committed"     // they said they will
  | "blocked"       // equipment / branch stock / process is in the way
  | "followup"      // they asked something, or the reply contradicts the book
  | "cannotwork"    // van at auction, repair declined, or already on a spare
  | "silent"        // texted, never answered, and the ask is valid
  | "nevertexted";  // no outreach has ever gone out on this rental

const PUSHBACK = new Set(["PUSHBACK_EQUIP", "PUSHBACK_STOCK", "PUSHBACK_PROCESS"]);
const FOLLOWUP = new Set(["QUESTION", "PASS_EXCUSED", "NEW_REPLY", "RETURNED"]);

/**
 * RETURNED sits in `followup` on purpose. A technician who told us the rental
 * went back while the Enterprise book still shows it open is a reconcile item
 * worth real money, not a closed row. The old board filed those at $0.
 *
 * cannot_work is checked only AFTER the reply buckets: a tech who committed or
 * pushed back gave us a usable answer, and the van's fate does not change what
 * to do next. It is checked BEFORE `silent` because telling a Team Lead to
 * chase a man whose van is at auction burns credibility (see ./workload.ts).
 */
function bucketOf(
  compliant: boolean,
  smsStage: string | null,
  workload: "cannot_work" | "workable" | null,
  outbound: number,
): ComplianceBucket {
  if (compliant) return "rightsized";
  if (smsStage === "COMMITTED") return "committed";
  if (smsStage && PUSHBACK.has(smsStage)) return "blocked";
  if (smsStage && FOLLOWUP.has(smsStage)) return "followup";
  if (workload === "cannot_work") return "cannotwork";
  return outbound > 0 ? "silent" : "nevertexted";
}

export const BUCKET_META: Record<ComplianceBucket, { label: string; mix: string; next: string }> = {
  rightsized:  { label: "Right-sized",                          mix: "sedan rate, sedan model, or confirmed by the tech", next: "Holding. Re-verify against the Enterprise feed each morning — Tyler, daily" },
  committed:   { label: "Committed",                            mix: "said yes, swap not on the book yet",                next: "Chase each dated commitment the day it lapses — Tyler, daily" },
  blocked:     { label: "Blocked",                              mix: "equipment, branch stock, or process",               next: "Equipment-exception ruling + branch-stock escalation — Tyler w/ Gina, 8/5" },
  followup:    { label: "Follow-up",                            mix: "open question, or reply contradicts the book",       next: "Answer same-day; reconcile every RETURNED against Enterprise — Rob Anderson, 8/1" },
  cannotwork:  { label: "Cannot work · auction, declined, spare", mix: "the right-size ask itself is wrong",              next: "No TL escalation. Route to vehicle replacement or rental return — Tyler w/ Rob Anderson, 8/4" },
  silent:      { label: "No response · can act",                mix: "texted, never answered",                            next: "TL escalation + next blast wave — Tyler, 8/1" },
  nevertexted: { label: "Never texted",                         mix: "opened after the campaign froze on 7/9",             next: "Add to the next blast wave — Tyler, 8/1" },
};

/** Certainty order. Drives the bar, the pills and the table. */
export const BUCKET_ORDER: ComplianceBucket[] = [
  "rightsized", "committed", "blocked", "followup", "cannotwork", "silent", "nevertexted",
];

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
  /** on leave: employment_status L, or an open row in loa_leaves */
  isLoa: boolean;
  /** employment_status T */
  isTerminated: boolean;
  /** technician told us the rental went back. Not right-sizing, its own metric. */
  isReturned: boolean;
  compliant: boolean;
  /** "both" = sedan rate AND sedan model. SMS shows as "sms" only when alone. */
  compliantBy: "rate" | "model" | "both" | "sms" | null;
  bucket: ComplianceBucket;
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
  const [cases, sedans, contacts, techs, tpms, tradeEx, loaOpen, trackerStages, msgAgg] = await Promise.all([
    db.execute(sql`
      SELECT case_key, ticket_number, vehicle_number_padded, renter_name_raw, veh_desc, rental_class,
             rate_authorized, days_open, ticket_status, renting_state, district, source, rental_vendor
      FROM vrm_rental_operations_cases WHERE present_in_latest
    `),
    db.execute(sql`SELECT nameplate FROM vrm_rightsize_sedan_models WHERE active`),
    db.execute(sql`SELECT ldap, name, truck_number, phone_digits, manager_name, primary_state, district FROM fs_comms_contacts`),
    db.execute(sql`SELECT tech_racfid AS ldap, first_name, last_name, job_title, truck_lu, last_known_truck_lu, employment_status FROM all_techs`),
    db.execute(sql`SELECT truck_no, enterprise_id FROM tpms_last_known_truck_tech`),
    // Degrade, do not crash. This table is created by
    // initRightsizeComplianceSchema(), so on any deployment where compute runs
    // before init has landed (a fresh publish, a read-only replica, an ad-hoc
    // script) the whole compliance page 500s on a missing relation instead of
    // rendering with one exclusion source absent. Losing the hybrid carve-out
    // makes the HVAC count too LOW, which is visible and safe; a blank
    // dashboard is neither.
    db.execute(sql`SELECT upper(ldap) AS ldap FROM vrm_rightsize_trade_exclusions WHERE active`)
      .catch((e: any) => {
        console.warn("[VRM/Rightsize] trade exclusions unavailable, continuing without them:", e?.message || e);
        return { rows: [] } as any;
      }),
    db.execute(sql`SELECT upper(enterprise_id) AS ldap FROM loa_leaves WHERE closed = false`),
    db.execute(sql`
      SELECT upper(t.ldap) AS ldap, t.stage, ${VAN_STATUS_COLUMNS}
      FROM vrm_rightsize_techs t
      ${VAN_STATUS_JOIN}
    `),
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
  const tradeExcluded = new Set(rowsOf(tradeEx).map((r) => String(r.ldap).toUpperCase()));
  const onLeave = new Set(rowsOf(loaOpen).map((r) => String(r.ldap).toUpperCase()));
  const sedanSet = new Set(rowsOf(sedans).map((r) => String(r.nameplate).toUpperCase()));

  const truckIdx = new Map<string, string>();
  const addTruck = (t: unknown, ldap: unknown) => {
    const k = bareTruck(t);
    const L = String(ldap ?? "").toUpperCase();
    if (k && L && !truckIdx.has(k)) truckIdx.set(k, L);
  };
  // PRECEDENCE MATTERS (2026-08-05). truck_lu is the CURRENT assignment;
  // last_known_truck_lu is the PREVIOUS holder. Indexing both at equal priority put a
  // former assignee ahead of the live one and mis-attributed rentals - Geary Jordan was
  // credited with Elijah Moquin's rental on truck 61843. Terminated techs keep a
  // truck_lu long after they leave, so they never seed the index.
  const liveTech = (t: any) => String(t?.employment_status ?? "").toUpperCase() !== "T";
  for (const c of rowsOf(contacts)) addTruck(c.truck_number, c.ldap);
  for (const t of rowsOf(techs)) if (liveTech(t)) addTruck(t.truck_lu, t.ldap);
  for (const t of rowsOf(tpms)) addTruck(t.truck_no, t.enterprise_id);
  // history: lowest precedence, never overrides a live assignment
  for (const t of rowsOf(techs)) if (liveTech(t)) addTruck(t.last_known_truck_lu, t.ldap);

  const nameIdx = [
    ...rowsOf(contacts).map((c) => ({ ldap: String(c.ldap).toUpperCase(), set: new Set(nameTokens(c.name)) })),
    ...rowsOf(techs).map((t) => ({ ldap: String(t.ldap).toUpperCase(), set: new Set(nameTokens(`${t.first_name} ${t.last_name}`)) })),
  ].filter((x) => x.set.size > 0);

  const cByLdap = new Map(rowsOf(contacts).map((c) => [String(c.ldap).toUpperCase(), c]));
  const tByLdap = new Map(rowsOf(techs).map((t) => [String(t.ldap).toUpperCase(), t]));
  const mByLdap = new Map(rowsOf(msgAgg).map((m) => [String(m.ldap).toUpperCase(), m]));
  const stageByLdap = new Map(
    rowsOf(trackerStages).map((r) => [
      String(r.ldap).toUpperCase(),
      { stage: String(r.stage ?? ""), workload: vanFieldsOf(r as VanStatusRow).workload },
    ]),
  );

  const out: ComplianceRow[] = [];
  for (const k of rowsOf(cases)) {
    // RENTER NAME FIRST (2026-08-05). The ARI report names the person holding the
    // rental on every row. The truck number only says whose van is in the shop, and it
    // goes stale the moment someone transfers or leaves. Truck-first attribution put 11
    // messages in front of the wrong technician on 8/4.
    const truck = bareTruck(k.vehicle_number_padded);
    let ldap: string | null = null;
    let matchedBy: ComplianceRow["matchedBy"] = "none";
    const want = new Set(nameTokens(k.renter_name_raw));
    if (want.size >= 2) {
      const hit = nameIdx.find((n) => Array.from(want).filter((w) => n.set.has(w)).length >= 2);
      if (hit) { ldap = hit.ldap; matchedBy = "name"; }
    }
    if (!ldap) {
      ldap = truckIdx.get(truck) ?? null;
      if (ldap) matchedBy = "truck";
    }

    const mk = modelKey(k.veh_desc);
    const rate = Number(k.rate_authorized) || 0;
    const byRate = rate > 0 && rate <= SEDAN_RATE_CEILING;
    const byModel = mk.length > 0 && sedanSet.has(mk);
    // Third test: the technician said the swap is done. RETURNED is NOT credited.
    const tracked = ldap ? (stageByLdap.get(ldap) ?? null) : null;
    const smsStage = tracked?.stage ?? null;
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
      // Title OR the maintained trade list. Title alone misses every refrigeration
      // and mixed-trade technician working under a generic appliance title.
      isHvac: /HVAC|Rfr|Refrig|Technician HV/i.test(String(title ?? ""))
        || (!!ldap && tradeExcluded.has(ldap)),
      isLoa: String(t?.employment_status ?? "").toUpperCase() === "L"
        || (!!ldap && onLeave.has(ldap)),
      isTerminated: String(t?.employment_status ?? "").toUpperCase() === "T",
      isReturned: smsStage === "RETURNED",
      compliant,
      compliantBy: compliant
        ? (byRate && byModel ? "both" : byRate ? "rate" : byModel ? "model" : "sms")
        : null,
      bucket: bucketOf(compliant, smsStage, tracked?.workload ?? null, outbound),
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
  /**
   * ADDRESSABLE is the denominator the initiative is actually measured on:
   * the open Enterprise book less the excluded trades (HVAC + Refrigerator/HVAC
   * hybrid) and less anyone out of scope (returned the rental, on leave, or off
   * roll). Excluded technicians leave the numerator AND the denominator - crediting
   * a carve-out you are not chasing inflates the percentage.
   */
  const inScope = (r: ComplianceRow) =>
    !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned;
  const addressable = ent.filter(inScope);
  const rightSized = addressable.filter((r) => r.compliant);
  const leftToChase = addressable.filter((r) => !r.compliant);
  /**
   * Buckets are computed BEFORE the KPI object so monthlyOverSedan can be the
   * SUM OF THE BUCKETS rather than an independently-rounded total. Rounding each
   * bucket and then rounding the whole separately left the chart $1 off the
   * header, which is exactly the kind of drift that costs a number its
   * credibility in a room.
   */
  const bucketRollup = BUCKET_ORDER.map((key) => {
    const b = ent.filter((r) => r.bucket === key);
    return {
      key,
      label: BUCKET_META[key].label,
      mix: BUCKET_META[key].mix,
      next: BUCKET_META[key].next,
      rentals: b.length,
      monthly: Math.round(b.reduce((a, r) => a + r.monthlyOverSedan, 0)),
      daily: Math.round(b.reduce((a, r) => a + r.rate, 0)),
      hvac: b.filter((r) => r.isHvac).length,
    };
  });
  const bucketMonthlyTotal = bucketRollup.reduce((a, b) => a + b.monthly, 0);

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
    // ---- The addressable pyramid the huddle deck reads (Tyler, 2026-08-05) ----
    // 352 open  -  excluded trade  -  out of scope  =  addressable
    // addressable  =  rightSized + left.  Both halves must reconcile.
    excludedTrade: ent.filter((r) => r.isHvac).length,
    outOfScope: ent.filter((r) => !r.isHvac && (r.isLoa || r.isTerminated || r.isReturned)).length,
    returned: ent.filter((r) => !r.isHvac && r.isReturned).length,
    onLeave: ent.filter((r) => !r.isHvac && !r.isReturned && r.isLoa).length,
    terminated: ent.filter((r) => !r.isHvac && !r.isReturned && !r.isLoa && r.isTerminated).length,
    addressable: addressable.length,
    rightSized: rightSized.length,
    left: leftToChase.length,
    rightSizedPct: addressable.length
      ? Math.round((rightSized.length / addressable.length) * 1000) / 10 : 0,
    savingsCapturedMonthly: rightSized.length * SAVINGS_PER_RENTAL_MONTHLY,
    savingsRemainingMonthly: leftToChase.length * SAVINGS_PER_RENTAL_MONTHLY,
    savingsPerRentalMonthly: SAVINGS_PER_RENTAL_MONTHLY,
    unresolvedIdentity: ent.filter((r) => !r.ldap).length,
    dailySpend: Math.round(ent.reduce((a, r) => a + r.rate, 0)),
    notCompliantDaily: Math.round(notComp.reduce((a, r) => a + r.rate, 0)),
    monthlyOverSedan: bucketMonthlyTotal,  // == Σ buckets, by construction
    sedanRateCeiling: SEDAN_RATE_CEILING,
    sedanModelCount: sedanSet.size,
    /**
     * The chart. One row per bucket over the OPEN ENTERPRISE BOOK, so
     * Σ rentals === totalOpen and Σ monthly === monthlyOverSedan exactly.
     * `rightsized` carries $0 by construction, which is the point: the dollars
     * on this chart are what is still leaking, not what has been fixed.
     */
    buckets: bucketRollup,
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
