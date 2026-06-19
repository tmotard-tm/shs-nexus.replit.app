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
 *   - createTruck          — POST   /wms-engine/v1/trucks
 *   - getAllTrucks          — GET    /wms-engine/v1/trucks
 *   - getTruck             — GET    /wms-engine/v1/trucks/:truckId
 *   - updateTruck          — POST   /wms-engine/v1/trucks/:truckId
 *   - deleteTruck          — DELETE /wms-engine/v1/trucks/:truckId
 *
 *  Assignments:
 *   - createAssignment     — POST   /wms-engine/v1/trucks/assignments
 *   - getAssignment        — GET    /wms-engine/v1/trucks/assignments/:techId
 *   - updateAssignment     — PUT    /wms-engine/v1/trucks/assignments/:techId
 *   - deleteAssignment     — DELETE /wms-engine/v1/trucks/assignments/:techId
 *
 *  Receive Tasks:
 *   - getReceiveTasks      — GET    /wms-engine/v1/trucks/:truckId/receive-tasks
 *   - submitReceiveTask    — POST   /wms-engine/v1/trucks/:truckId/receive-tasks
 *
 *  Return Tasks:
 *   - getReturnTasks       — GET    /wms-engine/v1/trucks/:truckId/return-tasks
 *
 *  Inventory Count:
 *   - submitInventoryCount — POST   /wms-engine/v1/trucks/:truckId/inventory-count
 */

import { request as undiciRequest } from "undici";

/** Low-level HTTP request that supports bodies on any method (including GET).
 *  Node.js globalThis.fetch follows WHATWG spec and silently strips GET bodies.
 *  Node.js http.request throws ERR_HTTP_BODY_NOT_ALLOWED for GET+body in Node 18+.
 *  undici has no such restriction and matches Postman's behaviour. */
async function nodeRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ status: number; text(): Promise<string> }> {
  const { statusCode, body } = await undiciRequest(url, {
    method: options.method as any,
    headers: options.body
      ? { ...options.headers, "Content-Length": String(Buffer.byteLength(options.body, "utf8")) }
      : options.headers,
    body: options.body,
  });
  const text = await body.text();
  return { status: statusCode, text: () => Promise.resolve(text) };
}

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
  const res = await nodeRequest(url, {
    method: "GET",
    headers: {
      Authorization: WMS_ENGINE_AUTH_HEADER!,
      Accept: "application/xml, text/xml, */*",
    },
  });
  const rawText = await res.text();
  const rawExcerpt = rawText.slice(0, 400);
  console.log(`[WMS Engine] Token response status: ${res.status}`);
  console.log(`[WMS Engine] Token response excerpt: ${rawExcerpt}`);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`WMS Engine auth failed (${res.status}): ${rawExcerpt}`);
  }
  const token = extractTokenFromXml(rawText);
  if (!token) {
    throw new Error(`WMS Engine auth: could not parse token from response (${res.status}): ${rawExcerpt}`);
  }
  console.log(`[WMS Engine] Token extracted, length=${token.length}, prefix=${token.slice(0, 12)}...`);
  return { token, url, status: res.status, rawExcerpt };
}

/**
 * In-flight token refresh, shared so a bounded-concurrency backfill batch does
 * not stampede the auth gateway with parallel logins when the cached token
 * expires mid-run (#15 refresh mutex).
 */
let tokenRefreshPromise: Promise<string> | null = null;

/** Return cached token, refreshing if expired (single-flight via mutex) */
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }
  const p = (async () => {
    const { token } = await fetchToken();
    cachedToken = token;
    tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  })();
  tokenRefreshPromise = p;
  try {
    return await p;
  } finally {
    tokenRefreshPromise = null;
  }
}

/**
 * Bucket a WMS/NetSuite error so the tier-3 backstop executor can react
 * correctly (#15): "auth" → re-auth + resume (NOT a write failure); "throttle"
 * → hold off + back off + resume from checkpoint (#5c); "data" → real failure
 * (audit + flag, no blind retry).
 */
function classifyWmsError(status: number, message: string): "auth" | "throttle" | "data" {
  if (status === 401 || status === 403) return "auth";
  const m = (message || "").toLowerCase();
  if (
    status === 429 ||
    m.includes("governance") ||
    m.includes("rate limit") ||
    m.includes("request limit") ||
    m.includes("sss_request_limit") ||
    m.includes("concurrent request") ||
    m.includes("too many requests")
  ) {
    return "throttle";
  }
  return "data";
}

interface ApiFetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function apiFetch(path: string, opts: ApiFetchOpts = {}, retry = true): Promise<any> {
  assertConfigured();
  const token = await getToken();
  const url = `${WMS_ENGINE_BASE_URL!.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(opts.headers || {}),
  };
  const res = await nodeRequest(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
  });

  // On 401/403 (expired/invalid token), invalidate cache and retry once (#15
  // reactive re-auth). A single reactive re-auth is NOT a write failure.
  if ((res.status === 401 || res.status === 403) && retry) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return apiFetch(path, opts, false);
  }

  if (res.status < 200 || res.status >= 300) {
    const body = await res.text();
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
    err.wmsErrorBucket = classifyWmsError(res.status, message);
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
  externalId?: string;
  costCenter?: string;
  regionNo?: string;
  createdBy?: string;
  spareTruck?: boolean;
}

export interface TruckResponse {
  truckId: string;
  name: string;
  locationId: string;
  description?: string;
  isActive: boolean;
  subsidiary?: string;
  parentLocation?: string;
  externalId?: string;
  netsuiteId?: string;
  status?: string;
  message?: string;
}

export interface DeleteTruckBody {
  useCaseId?: string;
  costCenter?: string;
  updatedBy?: string;
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

export interface DeleteAssignmentBody {
  techId?: string;
  useCaseId?: string;
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

export interface ReceiveTaskRequest {
  ldapId?: string;
  netSuiteIdNum?: string;
  netSuitePoNum?: string;
  orderNum?: string;
  receivedAt?: string;
  scacCode?: string;
  taskType?: string;
  techId?: string;
  truckId?: string;
  unitId?: string;
  vendorOrderNum?: string;
  details?: any[];
}

export interface InventoryCountRequest {
  inventoryDate?: string;
  inventoryDetails?: any[];
  inventoryType?: string;
  ldapId?: string;
  taskRefNum?: string;
  techId?: string;
  truckId?: string;
  unitId?: string;
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
      {
        method: "GET",
        body: JSON.stringify({ useCaseId: WMS_ENGINE_USE_CASE_ID }),
      }
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

  async deleteTruck(truckId: string, extra: DeleteTruckBody = {}): Promise<TruckResponse> {
    const body = {
      useCaseId: extra.useCaseId || WMS_ENGINE_USE_CASE_ID,
      ...(extra.costCenter !== undefined && { costCenter: extra.costCenter }),
      ...(extra.updatedBy !== undefined && { updatedBy: extra.updatedBy }),
    };
    return apiFetch(`/wms-engine/v1/trucks/${encodeURIComponent(truckId)}`, {
      method: "DELETE",
      body: JSON.stringify(body),
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

  async deleteAssignment(techId: string, extra: DeleteAssignmentBody = {}): Promise<TruckAssignmentResponse> {
    const body = {
      techId: extra.techId || techId,
      useCaseId: extra.useCaseId || WMS_ENGINE_USE_CASE_ID,
    };
    return apiFetch(
      `/wms-engine/v1/trucks/assignments/${encodeURIComponent(techId)}?useCaseId=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      {
        method: "DELETE",
        body: JSON.stringify(body),
      }
    );
  },

  async getReceiveTasks(truckId: string): Promise<any> {
    return apiFetch(
      `/wms-engine/v1/trucks/${encodeURIComponent(truckId)}/receive-tasks?useCase=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "GET" }
    );
  },

  async submitReceiveTask(truckId: string, data: ReceiveTaskRequest): Promise<any> {
    return apiFetch(
      `/wms-engine/v1/trucks/${encodeURIComponent(truckId)}/receive-tasks?useCase=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  },

  async getReturnTasks(truckId: string): Promise<any> {
    return apiFetch(
      `/wms-engine/v1/trucks/${encodeURIComponent(truckId)}/return-tasks?useCase=${encodeURIComponent(WMS_ENGINE_USE_CASE_ID)}`,
      { method: "GET" }
    );
  },

  async submitInventoryCount(truckId: string, data: InventoryCountRequest): Promise<any> {
    return apiFetch(
      `/wms-engine/v1/trucks/${encodeURIComponent(truckId)}/inventory-count`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
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
