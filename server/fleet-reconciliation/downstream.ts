/**
 * Live downstream pulls for the tier-3 reconciler dry-run (#5b, #10, #14, #19).
 *
 * Every reader re-pulls LIVE from the production gateway — the Nexus-local caches
 * (ams_vehicles_cache, holman_vehicles_cache) are correction TARGETS, never authority.
 * All identities are normalized through the SAME helpers AIMS authority uses
 * (toCanonical for truck#, normalizeEnterpriseId for tech) so comparisons are
 * apples-to-apples to canonical Enterprise ID (#16).
 */

import { wmsEngineService } from '../wms-engine-service';
import { AmsApiService } from '../ams-api-service';
import { holmanApiService } from '../holman-api-service';
import { toCanonical, normalizeEnterpriseId } from '../vehicle-number-utils';

const HOLMAN_LESSEE = '2B56';

// Values that mean "no tech" across systems (#14 Holman sentinel = '^null^').
const UNASSIGNED_SENTINELS = new Set(['', '^null^', 'null', 'none', 'unassigned', 'n/a']);

function techOrNull(raw: unknown): string | null {
  const norm = normalizeEnterpriseId(raw == null ? '' : String(raw));
  if (!norm || UNASSIGNED_SENTINELS.has(norm)) return null;
  return norm;
}

function strOrNull(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

// ---- WMS (#19: non-paginated getAllTrucks) ----
export interface WmsTruck {
  tech: string | null;
  costCenter: string | null;
  isInactive: boolean;
  name: string;
}
export interface WmsPull {
  byTruck: Map<string, WmsTruck>;
  techToTrucks: Map<string, Set<string>>; // reverse index for move/displacement detection (#9)
  rawCount: number;
  distinctCanonical: number;
  duplicateCanonical: number;
}

export async function pullWms(): Promise<WmsPull> {
  const rows = await wmsEngineService.getAllTrucks();
  const byTruck = new Map<string, WmsTruck>();
  const techToTrucks = new Map<string, Set<string>>();
  let duplicateCanonical = 0;

  for (const r of rows) {
    const canon = toCanonical(r?.name);
    if (!canon) continue;
    const tech = techOrNull(r?.techEnterpriseId);
    const truck: WmsTruck = {
      tech,
      costCenter: strOrNull(r?.costCenter),
      isInactive: r?.isInactive === true,
      name: String(r?.name ?? ''),
    };
    const existing = byTruck.get(canon);
    if (existing) {
      duplicateCanonical++;
      // prefer the assigned row if a duplicate canonical appears
      if (tech && !existing.tech) byTruck.set(canon, truck);
    } else {
      byTruck.set(canon, truck);
    }
    if (tech) {
      let set = techToTrucks.get(tech);
      if (!set) {
        set = new Set();
        techToTrucks.set(tech, set);
      }
      set.add(canon);
    }
  }

  return { byTruck, techToTrucks, rawCount: rows.length, distinctCanonical: byTruck.size, duplicateCanonical };
}

// ---- AMS (#10: live re-pull, not the stale cache) ----
function normalizeAmsRows(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const key of ['data', 'vehicles', 'results', 'items']) {
      if (Array.isArray(r[key])) return r[key] as any[];
    }
  }
  return [];
}

export interface AmsTruck {
  tech: string | null;
  outOfService: boolean;
  sold: boolean;
}
export interface AmsPull {
  byTruck: Map<string, AmsTruck>;
  rawCount: number;
  pages: number;
  truncated: boolean;
}

export async function pullAms(): Promise<AmsPull> {
  const ams = new AmsApiService();
  const byTruck = new Map<string, AmsTruck>();
  const PAGE_SIZE = 1000; // AMS hard cap is 1000 (limit>1000 is rejected)
  const MAX_PAGES = 30; // 30,000 vehicles safety cap
  const CONCURRENCY = 6; // parallel page fetches (the envelope's `total` drives page math)
  let truncated = false;

  const ingest = (raw: unknown): number => {
    const rows = normalizeAmsRows(raw);
    for (const row of rows) {
      const canon = toCanonical(row?.VehicleNumber);
      if (!canon) continue;
      const tech = techOrNull(row?.Tech);
      const truck: AmsTruck = {
        tech,
        outOfService: !!strOrNull(row?.OutofSvcDate),
        sold: !!strOrNull(row?.SaleDate),
      };
      const existing = byTruck.get(canon);
      if (!existing || (tech && !existing.tech)) byTruck.set(canon, truck);
    }
    return rows.length;
  };

  // Page 0 first to learn `total`, then parallel-fetch the remainder.
  const first: any = await ams.searchVehicles({ limit: PAGE_SIZE, offset: 0 });
  let rawCount = ingest(first);
  const total = Number(first?.total ?? 0);
  let totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  if (totalPages > MAX_PAGES) {
    totalPages = MAX_PAGES;
    truncated = true;
  }

  const offsets: number[] = [];
  for (let p = 1; p < totalPages; p++) offsets.push(p * PAGE_SIZE);

  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((offset) => ams.searchVehicles({ limit: PAGE_SIZE, offset })));
    for (const raw of results) rawCount += ingest(raw);
  }

  return { byTruck, rawCount, pages: totalPages, truncated };
}

// ---- Holman (#14: clientData2/4 = Enterprise ID; statusCode 0=new 1=active 2=oos 3=sold) ----
export function holmanStatusLabel(code: number | null): string {
  switch (code) {
    case 0:
      return 'new';
    case 1:
      return 'active';
    case 2:
      return 'out-of-service';
    case 3:
      return 'sold';
    default:
      return 'unknown';
  }
}

export interface HolmanTruck {
  tech: string | null;
  statusCode: number | null;
  statusLabel: string;
  lifecycleConflict: boolean; // sold or out-of-service
}
export interface HolmanPull {
  byTruck: Map<string, HolmanTruck>;
  rawCount: number;
  pages: number;
}

async function fetchHolmanPages(
  statusCodes: string,
  soldDateCode: string | undefined,
  counters: { pages: number },
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  const out: any[] = [];
  let page = 1;
  let total = 0;
  // hard page cap mirrors the sync service's defensive loop
  while (page <= 50) {
    const resp: any = await holmanApiService.getVehicles(HOLMAN_LESSEE, statusCodes, soldDateCode, page, PAGE_SIZE);
    const data = (resp?.items ?? resp?.data ?? []) as any[];
    total = Number(resp?.totalCount ?? 0);
    counters.pages++;
    if (!data.length) break;
    out.push(...data);
    const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : page;
    if (page >= totalPages) break;
    page++;
  }
  return out;
}

export async function pullHolman(): Promise<HolmanPull> {
  const counters = { pages: 0 };
  // Mirror holman-vehicle-sync-service: status 0,1,2 in one call; sold (3) needs soldDateCode=4 (last 90d).
  const [active, sold] = await Promise.all([
    fetchHolmanPages('0,1,2', undefined, counters),
    fetchHolmanPages('3', '4', counters),
  ]);
  const all = [...active, ...sold];

  const byTruck = new Map<string, HolmanTruck>();
  for (const v of all) {
    // Match the proven holman-vehicle-sync reader: primary field is holmanVehicleNumber/vehicleNumber,
    // NOT clientVehicleNumber (which is empty on the basic-query response).
    const vehicleNumber =
      v?.holmanVehicleNumber?.toString() || v?.clientVehicleNumber?.toString() || v?.vehicleNumber?.toString();
    const canon = toCanonical(vehicleNumber);
    if (!canon) continue;
    const code =
      v?.statusCode != null ? Number(v.statusCode) : v?.status_code != null ? Number(v.status_code) : null;
    const tech = techOrNull(v?.clientData2 ?? v?.clientData4);
    const truck: HolmanTruck = {
      tech,
      statusCode: code,
      statusLabel: holmanStatusLabel(code),
      lifecycleConflict: code === 2 || code === 3,
    };
    const existing = byTruck.get(canon);
    if (!existing) {
      byTruck.set(canon, truck);
    } else if (truck.lifecycleConflict && !existing.lifecycleConflict) {
      // prefer the sold/oos row so a lifecycle conflict is never masked by a duplicate
      byTruck.set(canon, truck);
    }
  }

  return { byTruck, rawCount: all.length, pages: counters.pages };
}
