import { getSnowflakeService } from '../snowflake-service';
import { getTPMSService, type TechInfoResponse } from '../tpms-service';
import { storage } from '../storage';
import { db } from '../db';
import { techVehicleAssignments } from '@shared/schema';
import { toCanonical, toTpmsRef, normalizeEnterpriseId } from '../vehicle-number-utils';

const AIMS_TABLE = 'PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO';
const ET_TZ = 'America/New_York';

export const AIMS_EXTRACT_LANDING_ET = { hour: 12, minute: 1 };

export const EXEMPT_MAX_AGE_DAYS = 3;

function etOffsetMs(instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let hour = get('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asUtc - instant.getTime();
}

export function etYmd(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function etWallToUtc(ymd: string, hour: number, minute: number): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offset = etOffsetMs(new Date(guess));
  return new Date(guess - offset);
}

export function etDayDiff(fromYmd: string, toYmd: string): number {
  const [ay, am, ad] = fromYmd.split('-').map(Number);
  const [by, bm, bd] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function aimsFileDateToYmd(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export interface AimsTruckRow {
  truckNo: string;
  canonicalTruckNo: string;
  district: string | null;
  ownerLdapId: string | null;
  ldapId: string | null;
  ownerEnterpriseId: string | null;
  ownerStatus: 'owner' | 'vacant';
  fileDate: string;
}

export interface AimsSnapshot {
  fileDate: string;
  extractInstant: Date;
  totalRows: number;
  activeRows: number;
  rows: AimsTruckRow[];
  byCanonicalTruck: Map<string, AimsTruckRow>;
  localChangeByCanonical?: Map<string, Date>;
}

function resolveOwner(ownerLdap: string | null): Pick<AimsTruckRow, 'ownerEnterpriseId' | 'ownerStatus'> {
  const owner = normalizeEnterpriseId(ownerLdap || '');
  if (!owner) return { ownerEnterpriseId: null, ownerStatus: 'vacant' };
  return { ownerEnterpriseId: owner, ownerStatus: 'owner' };
}

export async function loadAimsSnapshot(opts: { withLocalChanges?: boolean } = {}): Promise<AimsSnapshot> {
  const sf = getSnowflakeService();

  const countRows = await sf.executeQuery(
    `/* aims_snapshot_counts */
     WITH latest AS (SELECT MAX(FILE_DATE) AS MAX_FILE_DATE FROM ${AIMS_TABLE})
     SELECT TO_CHAR(MAX(latest.MAX_FILE_DATE), 'YYYY-MM-DD') AS MAX_FILE_DATE,
            COUNT(*) AS TOTAL_ROWS,
            COUNT_IF(DELIND = 0) AS ACTIVE_ROWS
     FROM ${AIMS_TABLE}, latest
     WHERE FILE_DATE = latest.MAX_FILE_DATE`,
  );
  const fileDate = aimsFileDateToYmd(countRows?.[0]?.MAX_FILE_DATE);
  const totalRows = Number(countRows?.[0]?.TOTAL_ROWS ?? 0);
  const activeRows = Number(countRows?.[0]?.ACTIVE_ROWS ?? 0);

  const rawRows: any[] = await sf.executeQuery(
    `/* aims_active_snapshot */
     WITH latest AS (SELECT MAX(FILE_DATE) AS MAX_FILE_DATE FROM ${AIMS_TABLE})
     SELECT TRUCKNO, DISTRICT, LDAPID, OWNERLDAPID
     FROM ${AIMS_TABLE}, latest
     WHERE FILE_DATE = latest.MAX_FILE_DATE AND DELIND = 0`,
  );

  const rows: AimsTruckRow[] = [];
  const byCanonicalTruck = new Map<string, AimsTruckRow>();
  for (const r of rawRows) {
    const truckNo = String(r.TRUCKNO ?? '').trim();
    const canonicalTruckNo = toCanonical(truckNo);
    if (!canonicalTruckNo) continue;
    const owner = resolveOwner(r.OWNERLDAPID ?? null);
    const row: AimsTruckRow = {
      truckNo,
      canonicalTruckNo,
      district: r.DISTRICT != null ? String(r.DISTRICT).trim() : null,
      ownerLdapId: r.OWNERLDAPID != null ? String(r.OWNERLDAPID).trim() : null,
      ldapId: r.LDAPID != null ? String(r.LDAPID).trim() : null,
      ownerEnterpriseId: owner.ownerEnterpriseId,
      ownerStatus: owner.ownerStatus,
      fileDate,
    };
    rows.push(row);
    const existing = byCanonicalTruck.get(canonicalTruckNo);
    if (!existing || (existing.ownerStatus !== 'owner' && row.ownerStatus === 'owner')) {
      byCanonicalTruck.set(canonicalTruckNo, row);
    }
  }

  const snapshot: AimsSnapshot = {
    fileDate,
    extractInstant: fileDate
      ? etWallToUtc(fileDate, AIMS_EXTRACT_LANDING_ET.hour, AIMS_EXTRACT_LANDING_ET.minute)
      : new Date(0),
    totalRows,
    activeRows,
    rows,
    byCanonicalTruck,
  };

  if (opts.withLocalChanges !== false) {
    await attachLocalChangeMap(snapshot);
  }
  return snapshot;
}

export async function attachLocalChangeMap(snapshot: AimsSnapshot): Promise<void> {
  const rows = await db
    .select({ truckNo: techVehicleAssignments.truckNo, updatedAt: techVehicleAssignments.updatedAt })
    .from(techVehicleAssignments);
  const map = new Map<string, Date>();
  for (const r of rows) {
    const canon = toCanonical(r.truckNo || '');
    if (!canon || !r.updatedAt) continue;
    const ts = new Date(r.updatedAt);
    const prev = map.get(canon);
    if (!prev || ts > prev) map.set(canon, ts);
  }
  snapshot.localChangeByCanonical = map;
}

export type AuthorityResult =
  | { kind: 'owner'; enterpriseId: string; districtNo: string | null; expectedCostCenter: string | null }
  | { kind: 'vacant' }
  | { kind: 'contested'; reason: string };

export interface TruckAuthority {
  truckNo: string;
  canonicalTruckNo: string;
  active: boolean;
  authority: AuthorityResult;
  exempt: boolean;
  exemptAgeDays: number;
  aims: AimsTruckRow | null;
}

export interface ResolveOpts {
  localLastChangeAt?: Date | null;
  priorExemptSinceEt?: string | null;
  nowEt?: string;
}

function tpmsRead(): { getTechInfo(id: string): Promise<TechInfoResponse> } {
  return getTPMSService();
}

function isDefinitivelyNotFound(err: any): boolean {
  if (err?.statusCode === 404) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('no tech info entries') ||
    msg.includes('not found') ||
    msg.includes('no data found')
  );
}

async function expectedCostCenterFor(districtNo: string | null): Promise<string | null> {
  if (!districtNo) return null;
  const cc = await storage.getDistrictCostCenter(districtNo);
  return cc?.costCenter ?? null;
}

async function confirmOwner(
  canonicalTruckNo: string,
  ownerEnterpriseId: string,
  truckRef: string,
): Promise<AuthorityResult> {
  let live: TechInfoResponse;
  try {
    live = await tpmsRead().getTechInfo(toTpmsRef(truckRef));
  } catch (err: any) {
    if (isDefinitivelyNotFound(err)) {
      return { kind: 'contested', reason: 'aims-owner-but-live-vacant' };
    }
    throw err;
  }
  const liveTruck = toCanonical(live.truckNo || '');
  const liveLdap = normalizeEnterpriseId(live.ldapId || '');
  if (liveTruck !== canonicalTruckNo || !liveLdap) {
    return { kind: 'contested', reason: 'live-truck-mismatch' };
  }
  if (liveLdap !== ownerEnterpriseId) {
    return { kind: 'contested', reason: 'live-holder-differs-from-aims-owner' };
  }
  const districtNo = live.districtNo ? String(live.districtNo).trim() : null;
  const expectedCostCenter = await expectedCostCenterFor(districtNo);
  return { kind: 'owner', enterpriseId: liveLdap, districtNo, expectedCostCenter };
}

export async function resolveTruckAuthority(
  truckNo: string,
  snapshot: AimsSnapshot,
  opts: ResolveOpts = {},
): Promise<TruckAuthority> {
  const canonicalTruckNo = toCanonical(truckNo);
  const aims = snapshot.byCanonicalTruck.get(canonicalTruckNo) ?? null;

  const todayEt = opts.nowEt ?? etYmd();
  const localChange =
    opts.localLastChangeAt !== undefined
      ? opts.localLastChangeAt
      : (snapshot.localChangeByCanonical?.get(canonicalTruckNo) ?? null);
  const exempt = !!(
    localChange &&
    snapshot.fileDate &&
    localChange.getTime() > snapshot.extractInstant.getTime()
  );
  const exemptAgeDays = exempt ? etDayDiff(opts.priorExemptSinceEt ?? todayEt, todayEt) : 0;

  if (!aims) {
    return {
      truckNo,
      canonicalTruckNo,
      active: false,
      authority: { kind: 'vacant' },
      exempt,
      exemptAgeDays,
      aims: null,
    };
  }

  let authority: AuthorityResult;
  if (aims.ownerStatus === 'vacant') {
    authority = { kind: 'vacant' };
  } else {
    authority = await confirmOwner(canonicalTruckNo, aims.ownerEnterpriseId!, aims.truckNo);
  }

  return {
    truckNo: aims.truckNo,
    canonicalTruckNo,
    active: true,
    authority,
    exempt,
    exemptAgeDays,
    aims,
  };
}

export interface VacancyResult {
  vacant: boolean;
  resolvedHolder?: string;
  checked: string[];
  indeterminate?: boolean;
}

export async function confirmTruckVacant(
  truckNo: string,
  candidateHolders: string[] = [],
): Promise<VacancyResult> {
  const canonicalTruckNo = toCanonical(truckNo);
  const checked: string[] = [];

  try {
    const live = await tpmsRead().getTechInfo(toTpmsRef(truckNo));
    checked.push(`truck:${truckNo}`);
    const holder = normalizeEnterpriseId(live.ldapId || '');
    if (holder && toCanonical(live.truckNo || '') === canonicalTruckNo) {
      return { vacant: false, resolvedHolder: holder, checked };
    }
  } catch (err: any) {
    if (!isDefinitivelyNotFound(err)) {
      return { vacant: false, indeterminate: true, checked };
    }
    checked.push(`truck:${truckNo}`);
  }

  for (const cand of candidateHolders) {
    const id = normalizeEnterpriseId(cand);
    if (!id) continue;
    try {
      const live = await tpmsRead().getTechInfo(id);
      checked.push(`tech:${id}`);
      if (toCanonical(live.truckNo || '') === canonicalTruckNo) {
        return { vacant: false, resolvedHolder: id, checked };
      }
    } catch (err: any) {
      if (!isDefinitivelyNotFound(err)) {
        return { vacant: false, indeterminate: true, checked };
      }
      checked.push(`tech:${id}`);
    }
  }

  return { vacant: true, checked };
}
