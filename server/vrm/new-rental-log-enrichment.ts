import { sql } from "drizzle-orm";
import { db } from "../db";

export interface EnrichedNewRentalLogRow {
  id: string;
  dateOfRequest: string | null;
  vanRentalPo: string | null;
  name: string | null;
  enterpriseId: string | null;
  trimVanNum: string | null;
  techPhNum: string | null;
  vanAssignedInTpms: string | null;
  startRentalDate: string | null;
  repairLocation: string | null;
  repairPhone: string | null;
  issue: string | null;
  permanentSolution: boolean;
  amsUpdated: boolean;
  fleetTrackerUpdated: boolean;
  rentalApproved: boolean;
  approvedInHolman: boolean;
  unitNumber: string | null;
  teamMembers: string | null;
  existingRentalOnTruck: string | null;
  newRentalOrExtension: string | null;
  truckBreakdownOrNewHire: string | null;
  existingRentalOpenHowLong: string | null;
  techServiceDate: string | null;
  declinedRepair: boolean;
  createdAt: string;

  // Enrichment — profitability snapshot
  ldap: string | null;
  tenureMonths: number | null;
  scorecardScore: number | null;
  completes: number | null;
  workingDays: number | null;
  dailyRevenue: number | null;
  dailyCosts: number | null;
  dailyNetBeforeRental: number | null;
  dailyNetWithRental: number | null;
  dailyPptProfit: number | null;
  recommendation: string | null;

  // Enrichment — geography & truck
  state: string | null;
  district: string | null;
  technician: string | null;
  truckNumber: string | null;

  // Enrichment — TPMS phone (for export)
  tpmsPhone: string | null;
}

interface RawLogRow {
  id: string;
  date_of_request: string | null;
  van_rental_po: string | null;
  name: string | null;
  enterprise_id: string | null;
  trim_van_num: string | null;
  tech_ph_num: string | null;
  van_assigned_in_tpms: string | null;
  start_rental_date: string | null;
  repair_location: string | null;
  repair_phone: string | null;
  issue: string | null;
  permanent_solution: boolean;
  ams_updated: boolean;
  fleet_tracker_updated: boolean;
  rental_approved: boolean;
  approved_in_holman: boolean;
  unit_number: string | null;
  team_members: string | null;
  existing_rental_on_truck: string | null;
  new_rental_or_extension: string | null;
  truck_breakdown_or_new_hire: string | null;
  existing_rental_open_how_long: string | null;
  tech_service_date: string | null;
  declined_repair: boolean;
  created_at: string;
}

interface SnapshotRow {
  tech_ldap: string;
  tenure_months: number | null;
  scorecard_score: string | null;
  completes: number | null;
  working_days: number | null;
  daily_revenue: string | null;
  daily_costs: string | null;
  daily_net_before_rental: string | null;
  daily_net_with_rental: string | null;
  daily_ppt_profit: string | null;
  recommendation: string | null;
}

interface DistrictStateRow {
  ldap: string;
  district: string | null;
  state: string | null;
}

interface TpmsRow {
  enterprise_id: string;
  contact_no: string | null;
  truck_no: string | null;
  first_name: string | null;
  last_name: string | null;
}

const toNum = (s: string | null): number | null => (s == null ? null : Number(s));

export async function listNewRentalLogEnriched(): Promise<EnrichedNewRentalLogRow[]> {
  const logResult = await db.execute(sql`
    SELECT
      id::text AS id,
      date_of_request, van_rental_po, name, enterprise_id, trim_van_num,
      tech_ph_num, van_assigned_in_tpms, start_rental_date, repair_location,
      repair_phone, issue, permanent_solution, ams_updated, fleet_tracker_updated,
      rental_approved, approved_in_holman, unit_number, team_members,
      existing_rental_on_truck, new_rental_or_extension, truck_breakdown_or_new_hire,
      existing_rental_open_how_long, tech_service_date, declined_repair,
      created_at::text AS created_at
    FROM vrm_new_rental_log
    ORDER BY created_at DESC
  `);
  const logs = (logResult.rows ?? []) as unknown as RawLogRow[];

  const ldaps = Array.from(
    new Set(
      logs
        .map((r) => (r.enterprise_id ?? "").trim().toUpperCase())
        .filter((l) => l.length > 0),
    ),
  );

  let snapshotByLdap = new Map<string, SnapshotRow>();
  let dsByLdap = new Map<string, { district: string | null; state: string | null }>();
  let tpmsByLdap = new Map<string, TpmsRow>();

  if (ldaps.length > 0) {
    const ldapList = sql.join(ldaps.map((l) => sql`${l}`), sql`, `);

    const [snapshotResult, dsResult, tpmsResult] = await Promise.all([
      db.execute(sql`
        SELECT tech_ldap, tenure_months, scorecard_score, completes, working_days,
               daily_revenue, daily_costs, daily_net_before_rental, daily_net_with_rental,
               daily_ppt_profit, recommendation
        FROM vrm_profitability_snapshot
        WHERE UPPER(tech_ldap) IN (${ldapList})
      `),
      db.execute(sql`
        SELECT UPPER(tp.enterprise_id) AS ldap,
               tp.district_no          AS district,
               at.home_state           AS state
        FROM tpms_tech_profiles tp
        LEFT JOIN all_techs at ON UPPER(at.tech_racfid) = UPPER(tp.enterprise_id)
        WHERE UPPER(tp.enterprise_id) IN (${ldapList})
        UNION ALL
        SELECT UPPER(at.tech_racfid) AS ldap,
               at.district_no        AS district,
               at.home_state         AS state
        FROM all_techs at
        WHERE UPPER(at.tech_racfid) IN (${ldapList})
          AND UPPER(at.tech_racfid) NOT IN (
            SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
          )
      `),
      db.execute(sql`
        SELECT UPPER(enterprise_id) AS enterprise_id, contact_no, truck_no, first_name, last_name
        FROM tpms_cached_assignments
        WHERE UPPER(enterprise_id) IN (${ldapList})
      `),
    ]);

    for (const r of (snapshotResult.rows ?? []) as unknown as SnapshotRow[]) {
      snapshotByLdap.set(r.tech_ldap.toUpperCase(), r);
    }
    for (const r of (dsResult.rows ?? []) as unknown as DistrictStateRow[]) {
      if (!dsByLdap.has(r.ldap)) dsByLdap.set(r.ldap, { district: r.district, state: r.state });
    }
    for (const r of (tpmsResult.rows ?? []) as unknown as TpmsRow[]) {
      tpmsByLdap.set(r.enterprise_id, r);
    }
  }

  return logs.map((r): EnrichedNewRentalLogRow => {
    const ldapKey = (r.enterprise_id ?? "").trim().toUpperCase();
    const snap = ldapKey ? snapshotByLdap.get(ldapKey) : undefined;
    const ds = ldapKey ? dsByLdap.get(ldapKey) : undefined;
    const tpms = ldapKey ? tpmsByLdap.get(ldapKey) : undefined;

    const truckNumber = r.unit_number ?? r.trim_van_num ?? tpms?.truck_no ?? null;
    const technician = r.name ?? (tpms ? `${tpms.first_name ?? ""} ${tpms.last_name ?? ""}`.trim() || null : null);

    return {
      id: r.id,
      dateOfRequest: r.date_of_request,
      vanRentalPo: r.van_rental_po,
      name: r.name,
      enterpriseId: r.enterprise_id,
      trimVanNum: r.trim_van_num,
      techPhNum: r.tech_ph_num,
      vanAssignedInTpms: r.van_assigned_in_tpms,
      startRentalDate: r.start_rental_date,
      repairLocation: r.repair_location,
      repairPhone: r.repair_phone,
      issue: r.issue,
      permanentSolution: r.permanent_solution,
      amsUpdated: r.ams_updated,
      fleetTrackerUpdated: r.fleet_tracker_updated,
      rentalApproved: r.rental_approved,
      approvedInHolman: r.approved_in_holman,
      unitNumber: r.unit_number,
      teamMembers: r.team_members,
      existingRentalOnTruck: r.existing_rental_on_truck,
      newRentalOrExtension: r.new_rental_or_extension,
      truckBreakdownOrNewHire: r.truck_breakdown_or_new_hire,
      existingRentalOpenHowLong: r.existing_rental_open_how_long,
      techServiceDate: r.tech_service_date,
      declinedRepair: r.declined_repair,
      createdAt: r.created_at,

      ldap: snap?.tech_ldap ?? r.enterprise_id ?? null,
      tenureMonths: snap?.tenure_months ?? null,
      scorecardScore: snap?.scorecard_score != null ? Number(snap.scorecard_score) : null,
      completes: snap?.completes ?? null,
      workingDays: snap?.working_days ?? null,
      dailyRevenue: toNum(snap?.daily_revenue ?? null),
      dailyCosts: toNum(snap?.daily_costs ?? null),
      dailyNetBeforeRental: toNum(snap?.daily_net_before_rental ?? null),
      dailyNetWithRental: toNum(snap?.daily_net_with_rental ?? null),
      dailyPptProfit: toNum(snap?.daily_ppt_profit ?? null),
      recommendation: snap?.recommendation ?? null,

      state: ds?.state ?? null,
      district: ds?.district ?? null,
      technician,
      truckNumber,

      tpmsPhone: tpms?.contact_no ?? null,
    };
  });
}
