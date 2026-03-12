/**
 * TPMS API Service
 *
 * Dedicated client for the TPMS REST API. Authenticates using API key credentials
 * (TPMS_API_BASE_URL + TPMS_API_KEY) when available, otherwise delegates to the
 * token-based auth provided by the existing tpms-service.ts.
 *
 * Methods:
 *  - getTechById          — fetch a single tech's full profile
 *  - searchTechs          — search techs by partial name or enterprise ID
 *  - getTechsUpdatedAfter — get all techs updated after a timestamp
 *  - getShippingAddresses — fetch just the addresses array for a tech
 *  - upsertShippingAddress — add or replace one address
 *  - deleteShippingAddress — remove an address by type
 *  - updateShippingSchedule — update the replenishment schedule
 *  - getChangeHistory     — fetch TPMS-side history for a tech (30-day window)
 *  - getSchedule          — fetch replenishment schedule for a tech
 *  - assignVehicle        — assign a truck to a tech via TPMS API
 *  - unassignVehicle      — remove a truck assignment from a tech via TPMS API
 */

import { getTPMSService } from "./tpms-service";

const TPMS_API_BASE_URL = process.env.TPMS_API_BASE_URL;
const TPMS_API_KEY = process.env.TPMS_API_KEY;

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  if (!TPMS_API_BASE_URL || !TPMS_API_KEY) {
    throw new Error("TPMS_API_BASE_URL / TPMS_API_KEY not configured");
  }
  const url = `${TPMS_API_BASE_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-key": TPMS_API_KEY,
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, { ...opts, headers });
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

  /** Fetch a single tech's full profile by enterprise ID. */
  async getTechById(enterpriseId: string): Promise<any> {
    if (this.useApiKey()) {
      return apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}`);
    }
    const svc = getTPMSService();
    return svc.getTechInfo(enterpriseId);
  }

  /**
   * Search techs by name or enterprise ID substring.
   * Falls back to listing all techs updated in the last 90 days when API key is absent.
   */
  async searchTechs(query: string): Promise<any[]> {
    if (this.useApiKey()) {
      const data = await apiFetch(`/techinfo/search?q=${encodeURIComponent(query)}`);
      return data?.techInfoList ?? data ?? [];
    }
    const svc = getTPMSService();
    const lookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const data = await svc.getTechsUpdatedAfter(lookback);
    const techs: any[] = data?.techInfoList ?? [];
    const q = query.toLowerCase();
    return techs.filter(
      (t: any) =>
        (t.ldapId && t.ldapId.toLowerCase().includes(q)) ||
        (t.firstName && t.firstName.toLowerCase().includes(q)) ||
        (t.lastName && t.lastName.toLowerCase().includes(q))
    );
  }

  /**
   * Return all techs updated after the given ISO timestamp.
   * This is the core watermark-based incremental sync primitive.
   */
  async getTechsUpdatedAfter(isoTimestamp: string): Promise<any> {
    if (this.useApiKey()) {
      return apiFetch(`/techsupdatedafter/${encodeURIComponent(isoTimestamp)}`);
    }
    const svc = getTPMSService();
    return svc.getTechsUpdatedAfter(isoTimestamp);
  }

  /** Fetch just the addresses array for a tech. */
  async getShippingAddresses(enterpriseId: string): Promise<TpmsShippingAddress[]> {
    if (this.useApiKey()) {
      const data = await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/addresses`);
      return data?.addresses ?? [];
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    return (info?.addresses as TpmsShippingAddress[]) ?? [];
  }

  /** Add or replace one address (keyed by addressType). */
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

  /** Remove an address by type from the tech's profile. */
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

  /** Update the replenishment (shipping) schedule for a tech. */
  async updateShippingSchedule(enterpriseId: string, schedule: Record<string, any>): Promise<void> {
    if (this.useApiKey()) {
      await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/schedule`, {
        method: "PUT",
        body: JSON.stringify(schedule),
      });
      return;
    }
    const svc = getTPMSService();
    await svc.updateTechInfo({ ldapId: enterpriseId, techReplenishment: schedule });
  }

  /**
   * Returns TPMS-side change history entries for a given tech using a 30-day
   * lookback window via getTechsUpdatedAfter. Since the TPMS API returns only
   * the latest state of each tech (not a change log), history entries are
   * synthesised from the current snapshot when the tech appears in the window.
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
      const updatedDate = match.lastUpdated ?? match.updatedAt ?? new Date().toISOString();
      history.push({
        entryDate: updatedDate,
        fieldChanged: "profile",
        valueAfter: JSON.stringify({
          truckNo: match.truckNo,
          email: match.email,
          contactNo: match.contactNo,
        }),
        source: "tpms_api",
      });
      return history;
    } catch (err: any) {
      console.warn(`[TpmsApiService] getChangeHistory fallback skipped: ${err.message}`);
      return [];
    }
  }

  /** Returns the replenishment schedule for a tech. */
  async getSchedule(enterpriseId: string): Promise<any> {
    if (this.useApiKey()) {
      return apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/schedule`);
    }
    const svc = getTPMSService();
    const info = await svc.getTechInfo(enterpriseId);
    return info?.techReplenishment ?? null;
  }

  /**
   * Assign a truck number to a tech in TPMS.
   * Uses tempTruckAssign (district-based temporary assignment) when available.
   */
  async assignVehicle(enterpriseId: string, districtNo: string, truckNo: string): Promise<void> {
    if (this.useApiKey()) {
      await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/assign`, {
        method: "PUT",
        body: JSON.stringify({ truckNo, districtNo }),
      });
      return;
    }
    const svc = getTPMSService();
    await svc.tempTruckAssign(enterpriseId, districtNo, truckNo);
  }

  /**
   * Remove a truck assignment from a tech in TPMS.
   * Clears truckNo by updating the tech's profile with an empty truck number.
   */
  async unassignVehicle(enterpriseId: string, districtNo?: string): Promise<void> {
    if (this.useApiKey()) {
      await apiFetch(`/techinfo/${encodeURIComponent(enterpriseId)}/assign`, {
        method: "DELETE",
      });
      return;
    }
    const svc = getTPMSService();
    await svc.updateTechInfo({ ldapId: enterpriseId, truckNo: "", districtNo: districtNo ?? "" });
  }
}

let _instance: TpmsApiService | null = null;
export function getTpmsApiService(): TpmsApiService {
  if (!_instance) _instance = new TpmsApiService();
  return _instance;
}
