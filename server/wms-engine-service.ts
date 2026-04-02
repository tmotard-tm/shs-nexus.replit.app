/**
 * WMS Engine API Service
 *
 * Client for the WMS Engine REST API. Authenticates using a bearer token
 * (WMS_ENGINE_TOKEN) and proxies calls to the WMS Engine base URL
 * (WMS_ENGINE_BASE_URL). The use-case identifier (WMS_ENGINE_USE_CASE_ID)
 * defaults to "TECHHUB" when not set.
 *
 * Methods:
 *  Trucks:
 *   - createTruck       — POST  /wms-engine/v1/trucks
 *   - getAllTrucks       — GET   /wms-engine/v1/trucks
 *   - getTruck          — GET   /wms-engine/v1/trucks/:truckId
 *   - updateTruck       — POST  /wms-engine/v1/trucks/:truckId
 *   - deleteTruck       — DELETE /wms-engine/v1/trucks/:truckId
 *
 *  Assignments:
 *   - createAssignment  — POST   /wms-engine/v1/trucks/assignments
 *   - getAssignment     — GET    /wms-engine/v1/trucks/assignments/:techId
 *   - updateAssignment  — PUT    /wms-engine/v1/trucks/assignments/:techId
 *   - deleteAssignment  — DELETE /wms-engine/v1/trucks/assignments/:techId
 */

const WMS_ENGINE_BASE_URL = process.env.WMS_ENGINE_BASE_URL;
const WMS_ENGINE_TOKEN = process.env.WMS_ENGINE_TOKEN;
const WMS_ENGINE_USE_CASE_ID = process.env.WMS_ENGINE_USE_CASE_ID || "TECHHUB";

function isConfigured(): boolean {
  return !!(WMS_ENGINE_BASE_URL && WMS_ENGINE_TOKEN);
}

function assertConfigured(): void {
  if (!isConfigured()) {
    throw new Error(
      "WMS Engine is not configured. Set WMS_ENGINE_BASE_URL and WMS_ENGINE_TOKEN environment variables."
    );
  }
}

async function apiFetch(
  path: string,
  opts: RequestInit = {}
): Promise<any> {
  assertConfigured();
  const url = `${WMS_ENGINE_BASE_URL!.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${WMS_ENGINE_TOKEN}`,
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || body;
    } catch {}
    const err: any = new Error(
      `WMS Engine ${opts.method || "GET"} ${path} → ${res.status}: ${message}`
    );
    err.status = res.status;
    err.wmsMessage = message;
    throw err;
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface TruckRequest {
  useCaseId?: string;
  name: string;
  locationId: string;
  description?: string;
  isActive: boolean;
  subsidiary?: string;
  parentLocation?: string;
}

export interface TruckResponse {
  truckId: string;
  name: string;
  locationId: string;
  description?: string;
  isActive: boolean;
  subsidiary?: string;
  parentLocation?: string;
  netsuiteId?: string;
  status?: string;
  message?: string;
}

export interface TruckAssignmentRequest {
  techId: string;
  truckId: string;
}

export interface TruckAssignmentResponse {
  techId: string;
  truckId: string;
  netsuiteId?: string;
  status?: string;
  message?: string;
}

export interface NetSuiteTruckAssignmentResponse {
  id?: string;
  name?: string;
  techEnterpriseId?: string;
  locationType?: string;
  isInactive?: boolean;
  useBins?: boolean;
  url?: string;
  bins?: any[];
  status?: string;
  message?: string;
}

export const wmsEngineService = {
  isConfigured,

  async createTruck(data: TruckRequest): Promise<TruckResponse> {
    const body: TruckRequest = {
      ...data,
      useCaseId: data.useCaseId || WMS_ENGINE_USE_CASE_ID,
    };
    return apiFetch("/wms-engine/v1/trucks", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async getAllTrucks(): Promise<any[]> {
    const result = await apiFetch(
      `/wms-engine/v1/trucks?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "GET" }
    );
    return Array.isArray(result) ? result : result ? [result] : [];
  },

  async getTruck(truckId: string): Promise<any> {
    return apiFetch(
      `/wms-engine/v1/trucks/${encodeURIComponent(truckId)}?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "GET" }
    );
  },

  async updateTruck(truckId: string, data: TruckRequest): Promise<TruckResponse> {
    const body: TruckRequest = {
      ...data,
      useCaseId: data.useCaseId || WMS_ENGINE_USE_CASE_ID,
    };
    return apiFetch(`/wms-engine/v1/trucks/${encodeURIComponent(truckId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async deleteTruck(truckId: string): Promise<TruckResponse> {
    return apiFetch(`/wms-engine/v1/trucks/${encodeURIComponent(truckId)}`, {
      method: "DELETE",
      body: JSON.stringify({ useCaseId: WMS_ENGINE_USE_CASE_ID }),
    });
  },

  async createAssignment(data: TruckAssignmentRequest): Promise<TruckAssignmentResponse> {
    return apiFetch(
      `/wms-engine/v1/trucks/assignments?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  async getAssignment(techId: string): Promise<NetSuiteTruckAssignmentResponse> {
    return apiFetch(
      `/wms-engine/v1/trucks/assignments/${encodeURIComponent(techId)}?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "GET" }
    );
  },

  async updateAssignment(techId: string, data: TruckAssignmentRequest): Promise<TruckAssignmentResponse> {
    return apiFetch(
      `/wms-engine/v1/trucks/assignments/${encodeURIComponent(techId)}?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  },

  async deleteAssignment(techId: string): Promise<TruckAssignmentResponse> {
    return apiFetch(
      `/wms-engine/v1/trucks/assignments/${encodeURIComponent(techId)}?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "DELETE" }
    );
  },
};
