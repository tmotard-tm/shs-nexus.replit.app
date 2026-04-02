/**
 * WMS Engine API Service
 *
 * Authenticates via a GET request to WMS_ENGINE_AUTH_ENDPOINT (the full token URL,
 * e.g. https://…/HSSOMAuthService/services/auth/token) using the Authorization
 * header value from WMS_ENGINE_AUTHORIZATION (e.g. "Basic <base64>").
 * The response is XML; the bearer token is extracted from <ns2:token>.
 * The token is cached in memory and refreshed when it expires or on 401.
 *
 * Required env vars:
 *   WMS_ENGINE_BASE_URL      — base URL of the WMS Engine API gateway
 *   WMS_ENGINE_AUTH_ENDPOINT — full URL of the token endpoint (ending in /token)
 *   WMS_ENGINE_AUTHORIZATION — value for the Authorization header sent to the token endpoint
 *
 * Optional:
 *   WMS_ENGINE_USE_CASE_ID   — defaults to "Nexus"
 *   WMS_ENGINE_TOKEN_TTL_MS  — token cache TTL in ms, defaults to 3300000 (55 min)
 *
 * Methods:
 *  Trucks:
 *   - createTruck       — POST   /wms-engine/v1/trucks
 *   - getAllTrucks       — GET    /wms-engine/v1/trucks
 *   - getTruck          — GET    /wms-engine/v1/trucks/:truckId
 *   - updateTruck       — POST   /wms-engine/v1/trucks/:truckId
 *   - deleteTruck       — DELETE /wms-engine/v1/trucks/:truckId
 *
 *  Assignments:
 *   - createAssignment  — POST   /wms-engine/v1/trucks/assignments
 *   - getAssignment     — GET    /wms-engine/v1/trucks/assignments/:techId
 *   - updateAssignment  — PUT    /wms-engine/v1/trucks/assignments/:techId
 *   - deleteAssignment  — DELETE /wms-engine/v1/trucks/assignments/:techId
 */

const WMS_ENGINE_BASE_URL      = process.env.WMS_ENGINE_BASE_URL;
const WMS_ENGINE_AUTH_ENDPOINT = process.env.WMS_ENGINE_AUTH_ENDPOINT;
const WMS_ENGINE_AUTH_HEADER   = process.env.WMS_ENGINE_AUTHORIZATION;
const WMS_ENGINE_USE_CASE_ID   = process.env.WMS_ENGINE_USE_CASE_ID || "Nexus";
const TOKEN_TTL_MS = Number(process.env.WMS_ENGINE_TOKEN_TTL_MS || 3300000); // 55 min default

// In-memory token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function isConfigured(): boolean {
  return !!(WMS_ENGINE_BASE_URL && WMS_ENGINE_AUTH_ENDPOINT && WMS_ENGINE_AUTH_HEADER);
}

function assertConfigured(): void {
  if (!isConfigured()) {
    throw new Error(
      "WMS Engine is not configured. Set WMS_ENGINE_BASE_URL, WMS_ENGINE_AUTH_ENDPOINT, and WMS_ENGINE_AUTHORIZATION environment variables."
    );
  }
}

/** Build the token URL — don't double-append /token if endpoint already ends with it */
function buildTokenUrl(): string {
  const base = WMS_ENGINE_AUTH_ENDPOINT!.replace(/\/$/, "");
  return /\/token$/i.test(base) ? base : `${base}/token`;
}

/** Extract <ns2:token> (or any namespaced <token>) value from XML response.
 *  Uses a word-boundary check after "token" so that <ns2:TokenResponse> is NOT
 *  matched — only tags whose name IS exactly "token" (e.g. <ns2:token>, <token>).
 *  Falls back to plain text if the response is not XML. */
function extractTokenFromXml(xml: string): string | null {
  // (?:\s[^>]*)? — after the tag name "token", optionally allow a space + attributes.
  // This prevents matching <ns2:TokenResponse ...> where "Response" follows "Token".
  const patterns = [
    /<(?:\w+:)?token(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?token>/i,
    /<(?:\w+:)?return(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?return>/i,
    /<(?:\w+:)?accessToken(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?accessToken>/i,
    /<(?:\w+:)?access_token(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?access_token>/i,
  ];
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return match[1].trim();
  }
  // If it looks like plain text (no tags), treat the whole body as the token
  if (!xml.includes("<")) return xml.trim() || null;
  return null;
}

/** Fetch a fresh bearer token from the auth endpoint */
async function fetchToken(): Promise<{ token: string; url: string; status: number; rawExcerpt: string }> {
  const url = buildTokenUrl();
  console.log(`[WMS Engine] Fetching token from: ${url}`);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: WMS_ENGINE_AUTH_HEADER!,
      Accept: "application/xml, text/xml, */*",
    },
  });
  const rawText = await res.text().catch(() => "");
  const rawExcerpt = rawText.slice(0, 400);
  console.log(`[WMS Engine] Token response status: ${res.status}`);
  console.log(`[WMS Engine] Token response excerpt: ${rawExcerpt}`);
  if (!res.ok) {
    throw new Error(`WMS Engine auth failed (${res.status}): ${rawExcerpt}`);
  }
  const token = extractTokenFromXml(rawText);
  if (!token) {
    throw new Error(`WMS Engine auth: could not parse token from response (${res.status}): ${rawExcerpt}`);
  }
  console.log(`[WMS Engine] Token extracted, length=${token.length}, prefix=${token.slice(0, 12)}...`);
  return { token, url, status: res.status, rawExcerpt };
}

/** Return cached token, refreshing if expired */
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const { token } = await fetchToken();
  cachedToken = token;
  tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
  return token;
}

async function apiFetch(path: string, opts: RequestInit = {}, retry = true): Promise<any> {
  assertConfigured();
  const token = await getToken();
  const url = `${WMS_ENGINE_BASE_URL!.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(opts.headers as Record<string, string> || {}),
  };
  const res = await fetch(url, { ...opts, headers });

  // On 401, invalidate cache and retry once
  if (res.status === 401 && retry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return apiFetch(path, opts, false);
  }

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
      {
        method: "GET",
        body: JSON.stringify({ useCaseId: WMS_ENGINE_USE_CASE_ID }),
      }
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
      {
        method: "GET",
        body: JSON.stringify({ useCaseId: WMS_ENGINE_USE_CASE_ID }),
      }
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

  /** Debug: force a fresh token fetch and return diagnostic info (no secrets exposed) */
  async debugAuth(): Promise<{
    configured: boolean;
    tokenUrl: string;
    tokenStatus: number | null;
    rawExcerpt: string;
    tokenExtracted: boolean;
    tokenLength: number | null;
    tokenPrefix: string | null;
    cachedUntil: string | null;
    useCaseId: string;
    baseUrl: string;
  }> {
    if (!isConfigured()) {
      return {
        configured: false,
        tokenUrl: "(not configured)",
        tokenStatus: null,
        rawExcerpt: "",
        tokenExtracted: false,
        tokenLength: null,
        tokenPrefix: null,
        cachedUntil: null,
        useCaseId: WMS_ENGINE_USE_CASE_ID,
        baseUrl: WMS_ENGINE_BASE_URL || "(not set)",
      };
    }
    // Invalidate cache so we always do a fresh fetch on debug
    cachedToken = null;
    tokenExpiresAt = 0;
    const tokenUrl = buildTokenUrl();
    try {
      const { token, status, rawExcerpt } = await fetchToken();
      cachedToken = token;
      tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
      return {
        configured: true,
        tokenUrl,
        tokenStatus: status,
        rawExcerpt,
        tokenExtracted: true,
        tokenLength: token.length,
        tokenPrefix: token.slice(0, 16) + "…",
        cachedUntil: new Date(tokenExpiresAt).toISOString(),
        useCaseId: WMS_ENGINE_USE_CASE_ID,
        baseUrl: WMS_ENGINE_BASE_URL!,
      };
    } catch (err: any) {
      return {
        configured: true,
        tokenUrl,
        tokenStatus: null,
        rawExcerpt: err.message || "",
        tokenExtracted: false,
        tokenLength: null,
        tokenPrefix: null,
        cachedUntil: null,
        useCaseId: WMS_ENGINE_USE_CASE_ID,
        baseUrl: WMS_ENGINE_BASE_URL!,
      };
    }
  },
};
