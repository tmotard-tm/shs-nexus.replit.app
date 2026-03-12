/**
 * TPMS API Service
 *
 * Dedicated client for the TPMS REST API. Authenticates using API key credentials
 * (TPMS_API_BASE_URL + TPMS_API_KEY) when available, otherwise falls through to
 * the token-based auth provided by the existing tpms-service.ts.
 *
 * Exposes higher-level helpers used by the scheduler and sync routes:
 *  - getTechById          — fetch a single tech's full profile
 *  - getShippingAddresses — fetch just the addresses array for a tech
 *  - upsertShippingAddress — add or replace one address
 *  - deleteShippingAddress — remove an address by type
 *  - getChangeHistory     — fetch TPMS-side history for a tech (30-day window)
 *  - getSchedule          — fetch replenishment schedule for a tech
 */

import { getTPMSService } from "./tpms-service";

const TPMS_API_BASE_URL = process.env.TPMS_API_BASE_URL;
const TPMS_API_KEY = process.env.TPMS_API_KEY;

async function apiKeyHeaders(): Promise<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-key": TPMS_API_KEY!,
  };
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  if (!TPMS_API_BASE_URL || !TPMS_API_KEY) {
    throw new Error("TPMS_API_BASE_URL / TPMS_API_KEY not configured");
  }
  const url = `${TPMS_API_BASE_URL.replace(/\/$/, "")}${path}`;
  const headers = await apiKeyHeaders();
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers as Record<string, string> || {}) } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TPMS API ${opts.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

export interface TpmsHistoryEntry {
  entryDate: string;
  fieldChanged: string;
  valueBefore?: string;
  valueAfter?: string;
  changedBy?: string;
  source: "tpms_api";
}

export interface TpmsShippingAddress {
  addressType: "PRIMARY" | "RE_ASSORTMENT" | "DROP_RETURN" | "ALTERNATE";
  shipToName?: string;
  addrLine1?: string;
  addrLine2?: string;
  city?: string;
  stateCd?: string;
  zipCd?: string;
}

class TpmsApiService {
  private useApiKey(): boolean {
    return !!(TPMS_API_BASE_URL && TPMS_API_KEY);
  }

  async getTechById(enterpriseId: string): Promise<any> {
    if (this.useApiKey()) {
      return apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}`);
    }
    const svc = getTPMSService();
    return svc.getTechInfo(enterpriseId);
  }

  async getShippingAddresses(enterpriseId: string): Promise<TpmsShippingAddress[]> {
    if (this.useApiKey()) {
      const data = await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/addresses`);
      return data?.addresses ?? [];
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    return (info?.addresses as TpmsShippingAddress[]) ?? [];
  }

  async upsertShippingAddress(enterpriseId: string, address: TpmsShippingAddress): Promise<void> {
    if (this.useApiKey()) {
      await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/addresses`, {
        method: "PUT",
        body: JSON.stringify(address),
      });
      return;
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    const addresses = (info?.addresses as TpmsShippingAddress[]) ?? [];
    const rest = addresses.filter((a) => a.addressType !== address.addressType);
    await svc.updateTechInfo({ ldapId: enterpriseId, addresses: [...rest, address] });
  }

  async deleteShippingAddress(enterpriseId: string, addressType: string): Promise<void> {
    if (this.useApiKey()) {
      await apiFetch(
        `/techinfo/${encodeURIComponent(enterpriseId)}/addresses/${encodeURIComponent(addressType)}`,
        { method: "DELETE" }
      );
      return;
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    const addresses = ((info?.addresses as TpmsShippingAddress[]) ?? []).filter(
      (a) => a.addressType !== addressType
    );
    await svc.updateTechInfo({ ldapId: enterpriseId, addresses });
  }

  /**
   * Returns a list of TPMS-side change history entries for a given tech.
   * Uses a 30-day lookback window via `getTechsUpdatedAfter`.
   * Filters the bulk response to only include entries for the requested tech.
   */
  async getChangeHistory(enterpriseId: string, techId?: string): Promise<TpmsHistoryEntry[]> {
    const svc = getTPMSService();
    const lookback = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const data = await svc.getTechsUpdatedAfter(lookback);
      const techs: any[] = data?.techInfoList ?? [];
      const match = techs.find(
        (t: any) =>
          (t.ldapId && t.ldapId === enterpriseId) ||
          (techId && t.techId && t.techId === techId)
      );
      if (!match) return [];
      const history: TpmsHistoryEntry[] = [];
      if (match.lastUpdated) {
        history.push({
          entryDate: match.lastUpdated,
          fieldChanged: "profile",
          valueAfter: JSON.stringify({ truckNo: match.truckNo, email: match.email }),
          source: "tpms_api",
        });
      }
      return history;
    } catch (err: any) {
      console.warn(`[TpmsApiService] getChangeHistory fallback skipped: ${err.message}`);
      return [];
    }
  }

  /**
   * Returns the replenishment schedule (primarySrc, providerName, storeLocation) for a tech.
   */
  async getSchedule(enterpriseId: string): Promise<any> {
    if (this.useApiKey()) {
      return apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/schedule`);
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    return info?.techReplenishment ?? null;
  }
}

let _instance: TpmsApiService | null = null;
export function getTpmsApiService(): TpmsApiService {
  if (!_instance) _instance = new TpmsApiService();
  return _instance;
}
