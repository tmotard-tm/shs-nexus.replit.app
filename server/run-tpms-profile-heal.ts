/**
 * server/run-tpms-profile-heal.ts
 *
 * TPMS-Profile Heal - standalone script (Nexus-Heal-Implementation-Spec-for-Fable.md).
 * Authored by Fable; tech_id fix + entity-decode applied by the orchestrator.
 *
 * Heals `tpms_tech_profiles` from the nightly AIMS extract (AIMS_TRUCK_INFO in
 * Snowflake, itself the full nightly batch export FROM TPMS). The mirror's
 * incremental feed is move-blind, so many trucks have no profile row; this script
 * bulk-copies the authoritative AIMS truck -> OWNERLDAPID map in, clears conflicting
 * claims, and ghost-sweeps terminated / not-in-roster profiles.
 *
 * Writes ONLY: tpms_tech_profiles + the audit table tpms_profile_heal_log.
 * Zero writes to TPMS / Holman / AMS / WMS. Zero live TPMS calls (AIMS covers the bulk).
 *
 * Modes:
 *   npx tsx server/run-tpms-profile-heal.ts                         DRY-RUN (default; reads only)
 *   npx tsx server/run-tpms-profile-heal.ts --apply --run-id=<iso>  APPLY (one BEGIN..COMMIT)
 *   npx tsx server/run-tpms-profile-heal.ts --revert=<runId>        REVERT from the audit log
 *
 * Employment gate (Tyler-confirmed 2026-07-05):
 *   T / not-in-roster -> never assign; ghost-sweep nulls any truck they still hold.
 *   L (on leave)      -> KEEP the truck; phone passed NULL (blank-by-design; never an error).
 *   A / P / R         -> normal.
 *
 * Safety: any planned write touching a CURRENT validated Holman==profile match aborts the run.
 * tech_id (NOT NULL) sourced from AIMS TECHNO zero-padded to 7 (verified 1602/1602 vs profiles).
 */

import { Pool } from "pg";
import type { PoolClient } from "pg";
import { executeQuery } from "./fleet-scope-snowflake";

const AIMS_SQL = `WITH latest AS (SELECT MAX(FILE_DATE) AS mfd FROM PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO)
SELECT a.TRUCKNO, a.OWNERLDAPID, a.DISTRICT, a.TECHNO, TO_CHAR(l.mfd,'YYYY-MM-DD') AS FILE_DATE
FROM PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO a, latest l
WHERE a.FILE_DATE=l.mfd AND a.DELIND=0`;

// tech_id added ($2); NOT touched on conflict so existing rows keep their tech_id.
const UPSERT_SQL = `INSERT INTO tpms_tech_profiles (enterprise_id, tech_id, truck_no, district_no, first_name, last_name, mobile_phone, synced_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
ON CONFLICT (enterprise_id) DO UPDATE SET truck_no=EXCLUDED.truck_no,
  district_no=COALESCE(EXCLUDED.district_no, tpms_tech_profiles.district_no), synced_at=now(), updated_at=now()`;

const NULL_TRUCK_SQL = `UPDATE tpms_tech_profiles SET truck_no = NULL, updated_at = now() WHERE enterprise_id = $1`;
const RESTORE_TRUCK_SQL = `UPDATE tpms_tech_profiles SET truck_no = $2, updated_at = now() WHERE enterprise_id = $1`;
const DELETE_PROFILE_SQL = `DELETE FROM tpms_tech_profiles WHERE enterprise_id = $1`;

const HEAL_LOG_DDL = `CREATE TABLE IF NOT EXISTS tpms_profile_heal_log (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  enterprise_id text,
  truck_no_before text,
  truck_no_after text,
  row_existed boolean,
  reason text
)`;
const HEAL_LOG_IDX_DDL = `CREATE INDEX IF NOT EXISTS idx_heal_log_run ON tpms_profile_heal_log(run_id)`;
const HEAL_LOG_INSERT_SQL = `INSERT INTO tpms_profile_heal_log
  (run_id, action, enterprise_id, truck_no_before, truck_no_after, row_existed, reason)
VALUES ($1,$2,$3,$4,$5,$6,$7)`;

const TRUCK_PAD_WIDTH = 7;
const TECHID_PAD_WIDTH = 7;

interface AimsRow {
  TRUCKNO: string | number | null;
  OWNERLDAPID: string | null;
  DISTRICT: string | number | null;
  TECHNO: string | number | null;
  FILE_DATE: string;
}

interface RosterInfo {
  status: string;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  phone: string | null;
}

interface ProfileInfo {
  eidStored: string;
  eidUpper: string;
  truckRaw: string | null;
  truckCanon: string;
  freshAt: Date | null;
}

type HealAction = "update" | "create" | "ghost_null" | "conflict_null";

interface PlannedMutation {
  action: HealAction;
  enterpriseId: string;
  techId: string | null;
  truckBefore: string | null;
  truckAfter: string | null;
  rowExisted: boolean;
  reason: string;
  districtNo: string | null;
  firstName: string | null;
  lastName: string | null;
  mobilePhone: string | null;
}

interface HealPlan {
  fileDate: string;
  cutoff: Date;
  aimsTotalRows: number;
  aimsOwnedRows: number;
  rosterCount: number;
  profileCount: number;
  validatedCount: number;
  mutations: PlannedMutation[];
  counts: {
    noop: number;
    update: number;
    create: number;
    skipFresher: number;
    ownerTermSkip: number;
    ownerUnknownStatusSkip: number;
    dupOwnerSkip: number;
    dupTruckSkip: number;
    noTruckSkip: number;
    conflictNull: number;
    ghostNull: number;
  };
  violations: string[];
  termSkipSamples: string[];
}

function canonTruck(x: unknown): string {
  return String(x ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
}
function padTruck(canon: string): string {
  return canon.padStart(TRUCK_PAD_WIDTH, "0");
}
function padTechId(x: unknown): string | null {
  const s = String(x ?? "").replace(/[^0-9]/g, "");
  return s === "" ? null : s.padStart(TECHID_PAD_WIDTH, "0");
}
function upperTrim(x: unknown): string {
  return String(x ?? "").trim().toUpperCase();
}
function strOrNull(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
}
function toDateOrNull(x: unknown): Date | null {
  if (x === null || x === undefined) return null;
  const d = x instanceof Date ? x : new Date(String(x));
  return isNaN(d.getTime()) ? null : d;
}
function sortKeyTruck(canon: string): string {
  return canon.padStart(12, "0");
}
function fmtCount(label: string, n: number): string {
  return `  ${label.padEnd(28, " ")}${String(n).padStart(6, " ")}`;
}

async function buildPlan(pool: Pool): Promise<HealPlan> {
  console.log("[heal] querying AIMS (Snowflake, latest FILE_DATE, DELIND=0)...");
  const aimsRows = await executeQuery<AimsRow>(AIMS_SQL);
  if (!aimsRows || aimsRows.length === 0) {
    throw new Error("AIMS query returned 0 rows - refusing to plan against an empty extract.");
  }
  const fileDate = String(aimsRows[0].FILE_DATE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    throw new Error(`Unexpected AIMS FILE_DATE format: "${fileDate}" (expected YYYY-MM-DD).`);
  }
  const cutoff = new Date(fileDate + "T12:00:00Z");

  console.log("[heal] loading roster (all_techs)...");
  const rosterRes = await pool.query(
    `SELECT tech_racfid, first_name, last_name, district_no, employment_status, cell_phone, main_phone
     FROM all_techs`
  );
  const roster = new Map<string, RosterInfo>();
  for (const r of rosterRes.rows) {
    const key = upperTrim(r.tech_racfid);
    if (key === "") continue;
    roster.set(key, {
      status: upperTrim(r.employment_status),
      firstName: strOrNull(r.first_name),
      lastName: strOrNull(r.last_name),
      districtNo: strOrNull(r.district_no),
      phone: strOrNull(r.cell_phone) ?? strOrNull(r.main_phone),
    });
  }

  console.log("[heal] loading tpms_tech_profiles...");
  const profRes = await pool.query(
    `SELECT enterprise_id, truck_no,
            GREATEST(synced_at, updated_at, last_tpms_updated_at) AS fresh_at
     FROM tpms_tech_profiles`
  );
  const profByEid = new Map<string, ProfileInfo>();
  const claimersByTruck = new Map<string, ProfileInfo[]>();
  for (const r of profRes.rows) {
    const eidStored = String(r.enterprise_id ?? "");
    const eidUpper = upperTrim(eidStored);
    if (eidUpper === "") continue;
    const info: ProfileInfo = {
      eidStored,
      eidUpper,
      truckRaw: r.truck_no === null || r.truck_no === undefined ? null : String(r.truck_no),
      truckCanon: canonTruck(r.truck_no),
      freshAt: toDateOrNull(r.fresh_at),
    };
    profByEid.set(eidUpper, info);
    if (info.truckCanon !== "") {
      const list = claimersByTruck.get(info.truckCanon);
      if (list) list.push(info);
      else claimersByTruck.set(info.truckCanon, [info]);
    }
  }

  console.log("[heal] computing validated Holman==profile matches...");
  const holmanRes = await pool.query(
    `SELECT holman_vehicle_number, holman_tech_assigned
     FROM holman_vehicles_cache
     WHERE holman_tech_assigned IS NOT NULL AND btrim(holman_tech_assigned) <> ''`
  );
  const validatedPairs = new Set<string>();
  const validatedTrucks = new Set<string>();
  for (const r of holmanRes.rows) {
    const t = canonTruck(r.holman_vehicle_number);
    const eid = upperTrim(r.holman_tech_assigned);
    if (t === "" || eid === "") continue;
    const prof = profByEid.get(eid);
    // A "validated match" to PROTECT is an EMPLOYED tech (A/L/P/R) whose Holman and
    // profile agree. A Terminated / not-in-roster agreement is a GHOST pair, NOT a
    // correct assignment: the ghost-sweep is supposed to clear it (which correctly
    // unmasks the Holman-side departed-tech assignment), so it must not be protected.
    const holder = roster.get(eid);
    const holderEmployed = !!holder && (holder.status === "A" || holder.status === "L" || holder.status === "P" || holder.status === "R");
    if (prof && prof.truckCanon === t && holderEmployed) {
      validatedPairs.add(`${t}|${eid}`);
      validatedTrucks.add(t);
    }
  }

  const counts: HealPlan["counts"] = {
    noop: 0, update: 0, create: 0, skipFresher: 0, ownerTermSkip: 0,
    ownerUnknownStatusSkip: 0, dupOwnerSkip: 0, dupTruckSkip: 0, noTruckSkip: 0,
    conflictNull: 0, ghostNull: 0,
  };
  const violations: string[] = [];
  const termSkipSamples: string[] = [];
  const fillMutations: PlannedMutation[] = [];
  const conflictMutations: PlannedMutation[] = [];
  const ghostMutations: PlannedMutation[] = [];

  const ownedRows = aimsRows.filter((r) => upperTrim(r.OWNERLDAPID) !== "");
  const sortedOwned = [...ownedRows].sort((a, b) => {
    const ka = sortKeyTruck(canonTruck(a.TRUCKNO));
    const kb = sortKeyTruck(canonTruck(b.TRUCKNO));
    if (ka !== kb) return ka < kb ? -1 : 1;
    const oa = upperTrim(a.OWNERLDAPID);
    const ob = upperTrim(b.OWNERLDAPID);
    return oa < ob ? -1 : oa > ob ? 1 : 0;
  });

  const seenTrucks = new Set<string>();
  const handledOwners = new Set<string>();
  const writePlannedEids = new Set<string>();
  const nullPlannedEids = new Set<string>();
  const conflictClearTrucks: Array<{ truckCanon: string; ownerUpper: string }> = [];

  for (const row of sortedOwned) {
    const truckC = canonTruck(row.TRUCKNO);
    const owner = upperTrim(row.OWNERLDAPID);

    if (truckC === "") { counts.noTruckSkip++; continue; }
    if (seenTrucks.has(truckC)) { counts.dupTruckSkip++; continue; }
    seenTrucks.add(truckC);

    const rosterInfo = roster.get(owner);
    if (!rosterInfo) {
      counts.ownerTermSkip++;
      if (termSkipSamples.length < 10) termSkipSamples.push(`${owner} (not-in-roster) truck ${truckC}`);
      continue;
    }
    if (rosterInfo.status === "T") {
      counts.ownerTermSkip++;
      if (termSkipSamples.length < 10) termSkipSamples.push(`${owner} (T) truck ${truckC}`);
      continue;
    }
    if (rosterInfo.status !== "A" && rosterInfo.status !== "L" && rosterInfo.status !== "P" && rosterInfo.status !== "R") {
      counts.ownerUnknownStatusSkip++;
      continue;
    }
    if (handledOwners.has(owner)) { counts.dupOwnerSkip++; continue; }

    const profile = profByEid.get(owner);

    if (profile && profile.freshAt && profile.freshAt.getTime() > cutoff.getTime()) {
      counts.skipFresher++;
      handledOwners.add(owner);
      continue;
    }

    handledOwners.add(owner);
    conflictClearTrucks.push({ truckCanon: truckC, ownerUpper: owner });

    if (profile && profile.truckCanon === truckC) { counts.noop++; continue; }

    if (validatedTrucks.has(truckC) && !validatedPairs.has(`${truckC}|${owner}`)) {
      violations.push(
        `pass-A ${profile ? "update" : "create"}: truck ${truckC} is a validated Holman==profile match held by someone else; AIMS wants it on ${owner}`
      );
    }
    if (profile && profile.truckCanon !== "" && validatedPairs.has(`${profile.truckCanon}|${owner}`)) {
      violations.push(
        `pass-A update: ${owner} currently holds validated truck ${profile.truckCanon}; AIMS would move them to ${truckC}`
      );
    }

    const isLeave = rosterInfo.status === "L";
    const techId = padTechId(row.TECHNO);
    if (!profile && !techId) {
      violations.push(`pass-A create: ${owner} truck ${truckC} has no AIMS TECHNO for the NOT NULL tech_id column`);
    }
    fillMutations.push({
      action: profile ? "update" : "create",
      enterpriseId: profile ? profile.eidStored : owner,
      techId,
      truckBefore: profile ? profile.truckRaw : null,
      truckAfter: padTruck(truckC),
      rowExisted: !!profile,
      reason: `aims-fill FILE_DATE=${fileDate} owner-status=${rosterInfo.status}`,
      districtNo: rosterInfo.districtNo,
      firstName: rosterInfo.firstName,
      lastName: rosterInfo.lastName,
      mobilePhone: isLeave ? null : rosterInfo.phone,
    });
    writePlannedEids.add(owner);
    if (profile) counts.update++;
    else counts.create++;
  }

  for (const { truckCanon, ownerUpper } of conflictClearTrucks) {
    const claimers = claimersByTruck.get(truckCanon);
    if (!claimers) continue;
    for (const claimer of claimers) {
      if (claimer.eidUpper === ownerUpper) continue;
      if (writePlannedEids.has(claimer.eidUpper)) continue;
      if (nullPlannedEids.has(claimer.eidUpper)) continue;
      if (validatedPairs.has(`${truckCanon}|${claimer.eidUpper}`)) {
        violations.push(
          `pass-B conflict_null: ${claimer.eidUpper} on truck ${truckCanon} is a validated Holman==profile match (AIMS owner ${ownerUpper})`
        );
      }
      conflictMutations.push({
        action: "conflict_null",
        enterpriseId: claimer.eidStored,
        techId: null,
        truckBefore: claimer.truckRaw,
        truckAfter: null,
        rowExisted: true,
        reason: `conflict: truck ${truckCanon} belongs to ${ownerUpper} per AIMS FILE_DATE=${fileDate}`,
        districtNo: null, firstName: null, lastName: null, mobilePhone: null,
      });
      nullPlannedEids.add(claimer.eidUpper);
      counts.conflictNull++;
    }
  }

  const allProfiles = Array.from(profByEid.values()).sort((a, b) =>
    a.eidUpper < b.eidUpper ? -1 : a.eidUpper > b.eidUpper ? 1 : 0
  );
  for (const profile of allProfiles) {
    if (profile.truckCanon === "") continue;
    const rosterInfo = roster.get(profile.eidUpper);
    const isGhost = !rosterInfo || rosterInfo.status === "T";
    if (!isGhost) continue;
    if (nullPlannedEids.has(profile.eidUpper)) continue;
    if (writePlannedEids.has(profile.eidUpper)) continue;
    if (validatedPairs.has(`${profile.truckCanon}|${profile.eidUpper}`)) {
      violations.push(
        `pass-C ghost_null: ${profile.eidUpper} on truck ${profile.truckCanon} is a validated Holman==profile match`
      );
    }
    ghostMutations.push({
      action: "ghost_null",
      enterpriseId: profile.eidStored,
      techId: null,
      truckBefore: profile.truckRaw,
      truckAfter: null,
      rowExisted: true,
      reason: rosterInfo ? "ghost: terminated (T)" : "ghost: not-in-roster",
      districtNo: null, firstName: null, lastName: null, mobilePhone: null,
    });
    nullPlannedEids.add(profile.eidUpper);
    counts.ghostNull++;
  }

  return {
    fileDate, cutoff,
    aimsTotalRows: aimsRows.length,
    aimsOwnedRows: ownedRows.length,
    rosterCount: roster.size,
    profileCount: profByEid.size,
    validatedCount: validatedPairs.size,
    mutations: [...fillMutations, ...conflictMutations, ...ghostMutations],
    counts, violations, termSkipSamples,
  };
}

function printPlan(plan: HealPlan, mode: string): void {
  const c = plan.counts;
  console.log("");
  console.log(`=== TPMS PROFILE HEAL - ${mode} ===`);
  console.log(`AIMS FILE_DATE: ${plan.fileDate}   freshness cutoff: ${plan.cutoff.toISOString()}`);
  console.log(
    `AIMS rows (DELIND=0): ${plan.aimsTotalRows}   with owner: ${plan.aimsOwnedRows}   roster: ${plan.rosterCount}   profiles: ${plan.profileCount}   validated Holman==profile matches: ${plan.validatedCount}`
  );
  console.log("");
  console.log("PASS A (fill/refresh from AIMS):");
  console.log(fmtCount("no-op", c.noop));
  console.log(fmtCount("UPDATE", c.update));
  console.log(fmtCount("CREATE", c.create));
  console.log(fmtCount("SKIP (profile fresher)", c.skipFresher));
  console.log(fmtCount("owner-terminated-skip", c.ownerTermSkip));
  console.log(fmtCount("owner-unknown-status-skip", c.ownerUnknownStatusSkip));
  console.log(fmtCount("duplicate-owner-skip", c.dupOwnerSkip));
  console.log(fmtCount("duplicate-truck-skip", c.dupTruckSkip));
  console.log(fmtCount("no-truck-skip", c.noTruckSkip));
  console.log("PASS B (conflict-clear):");
  console.log(fmtCount("conflict_null", c.conflictNull));
  console.log("PASS C (ghost-sweep, LAST):");
  console.log(fmtCount("ghost_null", c.ghostNull));
  console.log("");
  console.log(
    `VALIDATED MATCHES THAT WOULD CHANGE: ${plan.violations.length}   (must be 0 - any other value is a BUG and the run aborts)`
  );
  if (plan.violations.length > 0) {
    console.log("");
    console.log("!!! VALIDATED-MATCH VIOLATIONS (planned writes touching a Holman==profile match):");
    for (const v of plan.violations) console.log(`  - ${v}`);
  }
  if (plan.termSkipSamples.length > 0) {
    console.log("");
    console.log(`owner-terminated-skip samples (first ${plan.termSkipSamples.length} of ${c.ownerTermSkip}):`);
    for (const s of plan.termSkipSamples) console.log(`  - ${s}`);
  }
  console.log("");
  console.log(`PLANNED MUTATIONS (${plan.mutations.length}):`);
  for (const m of plan.mutations) {
    const before = m.truckBefore === null ? "(none)" : m.truckBefore;
    const after = m.truckAfter === null ? "NULL" : m.truckAfter;
    console.log(
      `  ${m.action.toUpperCase().padEnd(13, " ")} eid=${m.enterpriseId.padEnd(12, " ")} truck ${before} -> ${after}   [${m.reason}]`
    );
  }
  console.log("");
}

async function ensureHealLog(pool: Pool): Promise<void> {
  await pool.query(HEAL_LOG_DDL);
  await pool.query(HEAL_LOG_IDX_DDL);
}

async function logMutation(
  client: PoolClient, runId: string, action: string, enterpriseId: string | null,
  truckBefore: string | null, truckAfter: string | null, rowExisted: boolean, reason: string
): Promise<void> {
  await client.query(HEAL_LOG_INSERT_SQL, [runId, action, enterpriseId, truckBefore, truckAfter, rowExisted, reason]);
}

async function applyPlan(pool: Pool, plan: HealPlan, runId: string): Promise<void> {
  if (plan.violations.length > 0) {
    throw new Error(
      `ABORT: ${plan.violations.length} planned write(s) would touch a validated Holman==profile match. Nothing was written.`
    );
  }
  await ensureHealLog(pool);
  const dupCheck = await pool.query(`SELECT COUNT(*)::int AS n FROM tpms_profile_heal_log WHERE run_id = $1`, [runId]);
  if (dupCheck.rows[0].n > 0) {
    throw new Error(
      `ABORT: run_id "${runId}" already has ${dupCheck.rows[0].n} heal_log row(s). Pass a new --run-id (or --revert=${runId} first).`
    );
  }
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query("BEGIN");
    for (const m of plan.mutations) {
      await logMutation(client, runId, m.action, m.enterpriseId, m.truckBefore, m.truckAfter, m.rowExisted, m.reason);
      if (m.action === "update" || m.action === "create") {
        await client.query(UPSERT_SQL, [
          m.enterpriseId, m.techId, m.truckAfter, m.districtNo, m.firstName, m.lastName, m.mobilePhone,
        ]);
      } else {
        await client.query(NULL_TRUCK_SQL, [m.enterpriseId]);
      }
      applied++;
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
      console.error(`[heal] ERROR after ${applied} mutation(s) - transaction rolled back, nothing was written.`);
    } catch (rbErr) {
      console.error("[heal] ROLLBACK also failed:", rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
  console.log(`[heal] APPLY COMMITTED: run_id=${runId} mutations=${applied}`);
  console.log(`[heal] audit: SELECT * FROM tpms_profile_heal_log WHERE run_id = '${runId.replace(/'/g, "''")}' ORDER BY id;`);
  console.log(`[heal] revert with: npx tsx server/run-tpms-profile-heal.ts --revert=${runId}`);
}

async function revertRun(pool: Pool, targetRunId: string, runIdOverride: string | null): Promise<void> {
  await ensureHealLog(pool);
  const revertRunId = runIdOverride ?? `revert-of-${targetRunId}`;
  const rowsRes = await pool.query(
    `SELECT id, action, enterprise_id, truck_no_before, truck_no_after, row_existed, reason
     FROM tpms_profile_heal_log WHERE run_id = $1 ORDER BY id DESC`,
    [targetRunId]
  );
  if (rowsRes.rows.length === 0) {
    throw new Error(`No heal_log rows found for run_id "${targetRunId}" - nothing to revert.`);
  }
  const supported = new Set(["create", "update", "ghost_null", "conflict_null"]);
  for (const r of rowsRes.rows) {
    if (!supported.has(String(r.action))) {
      throw new Error(
        `Run "${targetRunId}" contains action "${r.action}" (log id ${r.id}) which this script cannot revert. Aborting with no writes.`
      );
    }
    if (r.enterprise_id === null || String(r.enterprise_id) === "") {
      throw new Error(`Run "${targetRunId}" log id ${r.id} has no enterprise_id - cannot revert. Aborting.`);
    }
  }
  const dupCheck = await pool.query(`SELECT COUNT(*)::int AS n FROM tpms_profile_heal_log WHERE run_id = $1`, [revertRunId]);
  if (dupCheck.rows[0].n > 0) {
    throw new Error(
      `ABORT: revert run_id "${revertRunId}" already has ${dupCheck.rows[0].n} heal_log row(s). Pass an explicit --run-id to force a distinct revert run.`
    );
  }
  console.log(`[heal] REVERT: run_id=${targetRunId} (${rowsRes.rows.length} logged mutation(s), reverse order) as revert run_id=${revertRunId}`);
  const client = await pool.connect();
  let reverted = 0;
  try {
    await client.query("BEGIN");
    for (const r of rowsRes.rows) {
      const eid = String(r.enterprise_id);
      const curRes = await client.query(`SELECT truck_no FROM tpms_tech_profiles WHERE enterprise_id = $1`, [eid]);
      const rowExists = curRes.rows.length > 0;
      const currentTruck: string | null =
        rowExists && curRes.rows[0].truck_no !== null && curRes.rows[0].truck_no !== undefined
          ? String(curRes.rows[0].truck_no) : null;
      const reason = `revert of run ${targetRunId} (log id ${r.id}, original action ${r.action})`;
      if (String(r.action) === "create") {
        await logMutation(client, revertRunId, "revert_create", eid, currentTruck, null, rowExists, reason);
        await client.query(DELETE_PROFILE_SQL, [eid]);
      } else {
        const restoreTo: string | null =
          r.truck_no_before === null || r.truck_no_before === undefined ? null : String(r.truck_no_before);
        await logMutation(client, revertRunId, `revert_${r.action}`, eid, currentTruck, restoreTo, rowExists, reason);
        await client.query(RESTORE_TRUCK_SQL, [eid, restoreTo]);
      }
      reverted++;
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
      console.error(`[heal] REVERT ERROR after ${reverted} row(s) - transaction rolled back, nothing was changed.`);
    } catch (rbErr) {
      console.error("[heal] ROLLBACK also failed:", rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
  console.log(`[heal] REVERT COMMITTED: restored ${reverted} row(s) from run_id=${targetRunId} (logged as ${revertRunId}).`);
}

function getArgValue(args: string[], prefix: string): string | null {
  const hit = args.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const v = hit.slice(prefix.length);
  return v === "" ? null : v;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const revertTarget = getArgValue(args, "--revert=");
  const runIdArg = getArgValue(args, "--run-id=");

  if (apply && revertTarget) throw new Error("--apply and --revert are mutually exclusive. Pick one.");
  if (apply && !runIdArg) {
    throw new Error('APPLY requires a deterministic run id: --run-id=<iso>  (e.g. --run-id=2026-07-05T18:00:00Z).');
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Refusing to guess a database.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  let exitCode = 0;
  try {
    if (revertTarget) {
      await revertRun(pool, revertTarget, runIdArg);
    } else {
      const plan = await buildPlan(pool);
      printPlan(plan, apply ? "APPLY (plan)" : "DRY RUN (no writes)");
      if (plan.violations.length > 0) {
        console.error(
          `[heal] BUG: ${plan.violations.length} planned write(s) would change a validated Holman==profile match. ` +
            (apply ? "Run ABORTED - nothing was written." : "Dry run flagged red - do NOT apply.")
        );
        exitCode = 1;
      } else if (apply) {
        await applyPlan(pool, plan, runIdArg as string);
      } else {
        console.log("[heal] dry run complete - nothing was written. Re-run with --apply --run-id=<iso> to execute.");
      }
    }
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[heal] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
