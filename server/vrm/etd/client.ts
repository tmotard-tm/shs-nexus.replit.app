/**
 * ETD API client — TypeScript port of `etd-runner/etd/client.py`.
 *
 * Only the surface the in-server booking executor needs is ported. Provisioning
 * (create_user), the extension flow and cancellation stay in Python; they are not on
 * the booking path and porting unused writes would be new risk for no gain.
 *
 * WRITE SAFETY
 * ------------
 * `confirmReservation` is the only call that creates a real, billable reservation, and
 * it refuses to run unless the caller passes `{ live: true }` explicitly. Everything
 * else is a read or a draft journey (invisible in My Journeys, nothing billed).
 */
import { getEtdToken } from "./token";
import { isTruckBranch, type TruckVerdict } from "./truck-locations";

export const API_BASE = "https://prd-we-api.etd.ehi.com";

export const COMPANY_ID = 33425;

/**
 * The TransformCo billing account. Captured 2026-08-11 from a real booking;
 * `company/accounts` is 403 for our admin role, so this cannot be looked up.
 */
export const ACCOUNT_UID = "8792e92a-841f-44bc-ac1c-dfffe981db2c";

/** Brands the account may book. Sent to reservation/locations and the branch lookup. */
export const BRANDS = "ET,ZL";

/**
 * Bounds for the `nearbyOnEmpty` quote fallback: at most this many additional
 * branches are priced after the nearest came up empty, and only while candidates
 * stay within this `calculatedDistance` (the feed documents it as km). The list is
 * nearest-first, so crossing the distance cap ends the walk rather than skipping.
 */
export const NEARBY_FALLBACK_MAX_CANDIDATES = 5;
export const NEARBY_FALLBACK_MAX_DISTANCE = 40;

/** ETD silently caps PageSize at 100 — asking for more returns 100 rows with no warning. */
export const MAX_PAGE_SIZE = 100;

// Identity constants, mirrored from the proven Python client. COMPANY_UID is the
// account's own uid inside the user model and is NOT the same value as
// COMPANY_ID, which is the numeric CompanyInternalNumber used by search.
export const COMPANY_UID = "86d9bd6f-44b4-4d3f-b316-6ed1e97c54a4";
export const COMPANY_NAME = "TransformCo";
export const DEFAULT_LANGUAGE = "en-US";
export const ROLE_ADMIN = "CompanyAdministrator";
export const ROLE_EMPLOYEE = "CompanyEmployee";

export class EtdError extends Error {
  /** HTTP status of the failing call, when there was a response at all. */
  readonly httpStatus?: number;
  readonly method?: string;
  readonly path?: string;
  /**
   * The parsed response body, IN MEMORY ONLY.
   *
   * A savedr refusal is the whole reservation view model echoed back — driver name,
   * phone, email, address. A caller may derive a REDACTED shape from this for evidence;
   * nothing may persist it, log it or hand it to a UI raw.
   */
  readonly responseBody?: unknown;

  constructor(
    message: string,
    meta: { httpStatus?: number; method?: string; path?: string; responseBody?: unknown } = {},
  ) {
    super(message);
    this.name = "EtdError";
    this.httpStatus = meta.httpStatus;
    this.method = meta.method;
    this.path = meta.path;
    this.responseBody = meta.responseBody;
  }
}

type Json = any;

/**
 * ETD error bodies sometimes echo the request back, which means a 400 on a booking can
 * carry the technician's name, phone, email or address. Errors get logged and stored as
 * evidence, so mask the person-shaped parts before the text escapes this module. Codes
 * and messages — the parts that explain the failure — survive intact.
 */
/**
 * The HTTP-200 `success:false` rejection, masked. Free-form vendor text can echo the
 * renter back, and this is the rejection most likely to be quoted to a staffer or stored
 * as evidence, so it goes through the same mask as a 4xx body.
 */
export function rejectionMessage(method: string, path: string, payload: Json): string {
  return `${method} ${path} rejected: ${safeErrorText(rejectionReasons(payload))}`;
}

export function safeErrorText(text: string): string {
  return String(text ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d()\s.-]{8,}\d/g, "[phone]")
    .replace(/"(firstName|lastName|name|phone\w*|email|address\w*|street\w*|postal\w*|zip\w*|dob|licen[cs]e\w*)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    // Prose names ("Driver Dana Reyes is ineligible") survive every structural rule above,
    // so any run of two or more Capitalised words goes too. Error CODES are ALL CAPS and
    // lowercase prose is untouched, so the triage value stays; the cost is that a
    // Title-Cased vendor phrase gets masked as well. Over-masking is the right failure.
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+)+/g, "[name]")
    .slice(0, 300);
}

/** ETD spells it 'succecss' in the wizard response. Accept either. */
function isOk(payload: Json): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  for (const key of ["success", "succecss"]) {
    if (key in payload) return !!payload[key];
  }
  return true;
}

/**
 * Keys that carry a refusal reason, and how important each one is.
 *
 * The wizard's ordinary envelope answers `{success:false, messages:[...]}`, but the
 * reservation endpoints answer with the reservation VIEW MODEL: the reasons live in
 * `errors` / `warnings` / `hasErrors` / `notificationMessage` and in per-field
 * `validationMessage`. Reading only `messages`/`errorMessage` is why a real savedr
 * refusal was recorded as "rejected: " with nothing after the colon.
 *
 * The rank orders the join so the 300-char mask cap trims boilerplate (the standing
 * "a copy of the confirmation email will be sent" notice) before it trims the error.
 *
 * `errorDescription` / `validationErrors` / `title` / `detail` and the singular
 * `message` / `reason` are names a parallel fix on main had already collected from real
 * refusals; they are kept here so that knowledge is not lost. `status` is deliberately
 * NOT ranked: it is the HTTP status, which the attempt already stores in its own field,
 * and ranking it would prepend "status: 400" to every reason line.
 */
const REASON_RANK: Record<string, number> = {
  errors: 0,
  error: 0,
  errormessage: 1,
  errormessages: 1,
  errordescription: 1,
  validationmessage: 1,
  validationmessages: 1,
  validationerrors: 1,
  modelstate: 1,
  model_state: 1,
  messages: 2,
  message: 2,
  detail: 2,
  reason: 2,
  warnings: 3,
  notificationmessage: 4,
  title: 4,
};

/** Inside a reason container, the fields that hold the human text and its label. */
const REASON_TEXT_KEY = /^(message|messageText|text|description|detail|errorMessage|value|reason)$/i;
const REASON_CODE_KEY = /^(code|errorCode|field|fieldName|key|propertyName)$/i;

const REASON_MAX_ITEMS = 24;
const REASON_MAX_DEPTH = 6;

/** Flatten one reason-bearing value (string, list, {code,message}, ModelState map). */
function reasonTexts(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined || depth > 3) return [];
  if (typeof value === "boolean") return [];
  if (typeof value === "string" || typeof value === "number") {
    const s = String(value).replace(/\u00a0/g, " ").trim();
    return s && s.toLowerCase() !== "null" ? [s] : [];
  }
  if (Array.isArray(value)) {
    return value.slice(0, REASON_MAX_ITEMS).flatMap((v) => reasonTexts(v, depth + 1));
  }
  if (typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const codeKey = Object.keys(obj).find(
    (k) => REASON_CODE_KEY.test(k) && (typeof obj[k] === "string" || typeof obj[k] === "number"),
  );
  const code = codeKey ? String(obj[codeKey]).trim() : "";
  const textKeys = Object.keys(obj).filter((k) => REASON_TEXT_KEY.test(k));
  if (textKeys.length) {
    return textKeys
      .flatMap((k) => reasonTexts(obj[k], depth + 1))
      .map((t) => (code && !t.includes(code) ? `${code}: ${t}` : t));
  }
  // ASP.NET ModelState shape: { "239": ["PICKUP DATE IS IN THE PAST"] }.
  const out: string[] = [];
  for (const k of Object.keys(obj).slice(0, 12)) {
    for (const t of reasonTexts(obj[k], depth + 1)) out.push(`${k}: ${t}`);
  }
  return out.slice(0, REASON_MAX_ITEMS);
}

/**
 * Every reason a rejection body carries, joined into one line (UNMASKED — callers pass
 * the result through `safeErrorText`).
 *
 * A body that says nothing at all still reports which keys came back: an operator
 * reading the attempt ledger months later needs a thread to pull, and "rejected: "
 * with an empty tail is not one.
 */
export function rejectionReasons(payload: Json): string {
  if (payload === null || payload === undefined) return "empty response body";
  if (typeof payload !== "object") {
    const s = String(payload).replace(/\u00a0/g, " ").trim();
    return s || "empty response body";
  }

  const found: { rank: number; text: string }[] = [];
  const flags: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: any, parent: string, depth: number): void => {
    if (!node || typeof node !== "object" || depth > REASON_MAX_DEPTH) return;
    if (found.length >= REASON_MAX_ITEMS) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node.slice(0, 25)) walk(v, parent, depth + 1);
      return;
    }
    // A per-field validation message means nothing without the field it belongs to.
    const fieldName = String((node as Record<string, unknown>).fieldName ?? "").trim();
    for (const k of Object.keys(node)) {
      if (found.length >= REASON_MAX_ITEMS) return;
      const v = (node as Record<string, unknown>)[k];
      if (v === true && /^has(Errors|Warnings)$/i.test(k)) {
        flags.push(parent ? `${parent}.${k}` : k);
        continue;
      }
      const rank = REASON_RANK[k.toLowerCase()];
      if (rank !== undefined) {
        const label =
          /^validationmessages?$/i.test(k) && fieldName
            ? `${fieldName} ${k}`
            : parent
              ? `${parent}.${k}`
              : k;
        for (const t of reasonTexts(v)) {
          found.push({ rank, text: `${label}: ${t}` });
          if (found.length >= REASON_MAX_ITEMS) break;
        }
        continue;
      }
      if (v && typeof v === "object") walk(v, k, depth + 1);
    }
  };
  walk(payload, "", 0);

  const best = new Map<string, number>();
  for (const r of found) {
    const prev = best.get(r.text);
    if (prev === undefined || prev > r.rank) best.set(r.text, r.rank);
  }
  if (best.size) {
    return Array.from(best.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([text]) => text)
      .join(" | ");
  }

  const keys = Object.keys(payload as object).slice(0, 20);
  const flagNote = flags.length
    ? `${Array.from(new Set(flags)).join(", ")} set but carried no text; `
    : "";
  return `${flagNote}no reason text in body; keys: ${keys.join(", ") || "none"}`;
}

export type CarClass = {
  code: string | null;
  description: string | null;
  passengers: unknown;
  bags: unknown;
  base_rate: number | null;
  estimated_total: unknown;
  currency: unknown;
  unit: unknown;
  unlimited_miles: unknown;
};

export type QuoteResult = {
  journey_id: string;
  reference: string | null;
  place: Json;
  branch: Json;
  branch_pinned: boolean;
  branch_code: string;
  branch_name: string;
  branch_address: string;
  /** Branch counter phone. ETD carries it as `telephone`, formatted "(+1)7574651000". */
  branch_phone: string | null;
  site: Json;
  classes: CarClass[];
  /**
   * Set only when `nearbyOnEmpty` moved the quote off the nearest branch because it
   * priced ZERO classes: the branch that came up empty, and how many candidates were
   * priced before one had cars. Absent (undefined) on every direct quote.
   */
  branch_fallback_from_code?: string;
  branch_fallback_from_name?: string;
  branch_fallback_tried?: number;
  /**
   * Branches that were nearer but are Enterprise TRUCK RENTAL counters, in the order
   * they were skipped. Present whenever at least one was dropped, so the drawer can
   * explain why the technician is being sent past a closer Enterprise sign.
   */
  branch_truck_skipped?: {
    code: string;
    name: string;
    address: string;
    distance: string;
    reason: string;
  }[];
  /**
   * True when `preferBranchCode` pinned a branch that IS a truck counter. The pin is
   * honoured (see quote()) but the caller must surface this.
   */
  branch_pinned_is_truck?: boolean;
};

export type EtdCallLog = { method: string; path: string; status: number; ms: number };

export class EtdClient {
  readonly calls: EtdCallLog[] = [];
  private timeoutMs: number;

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  // ---------------------------------------------------------------- transport

  private async request(method: string, path: string, body?: Json): Promise<Json> {
    const token = await getEtdToken();
    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          Origin: "https://etd.ehi.com",
          Referer: "https://etd.ehi.com/",
          "User-Agent": "Mozilla/5.0",
          Authorization: `Bearer ${token.secret}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new EtdError(`${method} ${path} transport failure: ${reason}`, { method, path });
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    this.calls.push({ method, path, status: resp.status, ms: Date.now() - started });

    const parsed = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })();

    if (resp.status === 403) {
      throw new EtdError(`403 not entitled: ${method} ${path}`, {
        httpStatus: 403,
        method,
        path,
        responseBody: parsed,
      });
    }
    if (resp.status >= 400) {
      // A 4xx body can be reasoned about too — read it the same way, and fall back to
      // the masked raw text when it is not JSON at all.
      const detail = parsed === undefined ? safeErrorText(text) : safeErrorText(rejectionReasons(parsed));
      throw new EtdError(`${resp.status} ${method} ${path}: ${detail}`, {
        httpStatus: resp.status,
        method,
        path,
        responseBody: parsed,
      });
    }

    if (parsed === undefined) return text;
    const payload: Json = parsed;

    // ETD returns HTTP 200 with success:false for validation failures.
    if (!isOk(payload)) {
      throw new EtdError(rejectionMessage(method, path, payload), {
        httpStatus: resp.status,
        method,
        path,
        responseBody: payload,
      });
    }
    return payload;
  }

  get(path: string): Promise<Json> {
    return this.request("GET", path);
  }

  post(path: string, body: Json): Promise<Json> {
    return this.request("POST", path, body);
  }

  // ----------------------------------------------------------------- identity

  /** One raw page. Returns the whole envelope, which carries recordsTotal. */
  private searchUsers(opts: {
    username?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Json> {
    const body = {
      Username: opts.username ?? "",
      LastName: "",
      FirstName: "",
      EmailAddress: "",
      CompanyInternalNumber: COMPANY_ID,
      PageNumber: opts.page ?? 1,
      PageSize: Math.min(opts.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE),
      IsAllUsersSearch: true,
      IsAdminUsersSearch: false,
      TotalAdminCount: 0,
      TotalUserCount: 0,
    };
    // A search is a read despite being a POST.
    return this.post("/api/identity/search", body);
  }

  /**
   * Active user for an LDAP/username, or null.
   *
   * Pages through the 100-row cap: a single call looks like a complete list right up
   * until the account grows past 100 users (verified 2026-08-11 against 607 users).
   */
  async findUserByUsername(username: string): Promise<Json | null> {
    const target = username.trim().toUpperCase();
    let page = 1;
    let seen = 0;
    for (;;) {
      const env = await this.searchUsers({ username: target, page, pageSize: MAX_PAGE_SIZE });
      const rows: Json[] = env?.data || [];
      if (!rows.length) return null;
      for (const u of rows) {
        if (String(u?.username || "").trim().toUpperCase() === target && !u?.deleted) return u;
      }
      seen += rows.length;
      const total = Number(env?.recordsTotal || 0);
      if (seen >= total || rows.length < MAX_PAGE_SIZE) return null;
      page += 1;
    }
  }

  /**
   * ETD's own empty user model. Overlay this and post it back; never hand-build
   * one. Their validator returns 200 with success:false and names one missing
   * field at a time, so a hand-built body turns into a guessing game.
   */
  blankUser(): Promise<Json> {
    return this.get("/api/identity/create");
  }

  /** The full, editable model for one user. The search row does not carry the phone. */
  readUser(username: string): Promise<Json> {
    return this.get(`/api/identity/user?uid=${encodeURIComponent(username)}`);
  }

  /**
   * Create a seat. Verified 2026-08-25 (DPRITC1, MGOLSTO, RKLEIN).
   *
   * ⚠ ETD mails a welcome invite to `email` and there is no suppress flag. For
   * technicians that address is an SMS gateway, so the caller must have
   * validated the number first.
   */
  async createUser(opts: {
    firstName: string;
    lastName: string;
    email: string;
    username?: string;
    role?: string;
    lineManagerEmail?: string;
    language?: string;
  }): Promise<Json> {
    const role = opts.role ?? ROLE_EMPLOYEE;
    const model: any = await this.blankUser();
    model.firstName = opts.firstName;
    model.lastName = opts.lastName;
    model.email = opts.email;
    model.username = opts.username ?? opts.email;
    model.isNew = true;
    model.deleted = false;
    model.isActive = true;
    model.lineManagerEmail = opts.lineManagerEmail ?? "";
    if (model.role && typeof model.role === "object") {
      model.role.selectedValue = role;
      model.role.selectedText = role === ROLE_ADMIN ? "Company Admin" : "Company Employee";
    }
    if (model.companyName && typeof model.companyName === "object") {
      model.companyName.selectedValue = COMPANY_UID;
      model.companyName.selectedText = COMPANY_NAME;
    }
    if (model.preferredLanguage && typeof model.preferredLanguage === "object") {
      model.preferredLanguage.selectedValue = opts.language ?? DEFAULT_LANGUAGE;
    }
    return this.post("/api/identity/create", model);
  }

  /**
   * Change an existing user's email (that is, their phone) or name.
   *
   * ⛔ This MUST go to /api/identity/update. Posting an edit model back to
   * /api/identity/create is rejected with "Username is already in use" even
   * with isNew:false, which reads like a duplicate-account bug and is not one.
   * Measured 2026-08-25.
   */
  async updateUser(username: string, changes: { email?: string; firstName?: string; lastName?: string }): Promise<Json> {
    const model: any = await this.readUser(username);
    if (changes.email !== undefined) model.email = changes.email;
    if (changes.firstName !== undefined) model.firstName = changes.firstName;
    if (changes.lastName !== undefined) model.lastName = changes.lastName;
    model.isNameOrEmailChanged = true;
    return this.post("/api/identity/update", model);
  }

  // ----------------------------------------------------------------- journeys

  searchJourneys(opts: {
    criteria?: string;
    period?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<Json> {
    return this.post("/api/myjourney/search", {
      SearchCriteria: opts.criteria ?? "",
      Period: opts.period ?? "Last30Days",
      PageNumber: opts.page ?? 1,
      PageSize: opts.pageSize ?? 100,
      CompanyInternalNumber: COMPANY_ID,
    });
  }

  blankJourney(): Promise<Json> {
    return this.get("/api/journeyassessment/newjourney");
  }

  /**
   * Step one of a booking: submits the search, returns an id.
   *
   * `start` / `end` are ISO local datetimes, e.g. `2026-08-12T09:00:00`. This creates a
   * draft journey assessment — it does NOT reserve a vehicle and nothing is billed.
   */
  async createJourney(opts: {
    location: string;
    latitude: string;
    longitude: string;
    postcode: string;
    town: string;
    start: string;
    end: string;
    country?: string;
  }): Promise<Json> {
    const model = await this.blankJourney();
    const place = {
      location: opts.location,
      latitude: opts.latitude,
      longitude: opts.longitude,
      countryCode: opts.country ?? "US",
      townOrCity: opts.town,
      postcode: opts.postcode,
      addressSearch: opts.location,
      peopleSoftId: "",
      stationId: "",
      brand: "",
      address1: "",
      address2: "",
      address3: "",
    };
    Object.assign(model, {
      startLocation: place,
      endLocation: { ...place },
      useStartAsEndLocation: true,
      startDateTime: opts.start,
      endDateTime: opts.end,
      startDate: opts.start.slice(0, 10),
      endDate: opts.end.slice(0, 10),
      startTime: opts.start.slice(11),
      endTime: opts.end.slice(11),
      registrationNumber: "",
      viaPoints: [],
      edtAction: 0,
    });
    return this.request("POST", "/api/journeyassessment/create", model);
  }

  /**
   * Advance the reservation wizard; returns the full journey.
   *
   * Note the two vendor typos this deliberately preserves: the request key is
   * `OrigionalJourneyId` and the response flag is `succecss`.
   */
  wizard(journeyId: string, mode = "3"): Promise<Json> {
    return this.post("/api/reservationwizard/wizard", {
      JourneyId: journeyId,
      OrigionalJourneyId: null,
      Mode: mode,
    });
  }

  // ------------------------------------------------------- places and branches

  /**
   * Free-text address -> ETD's own geocode. Two hops, because ETD only trusts
   * locations its own resolver produced. The returned `stationId` on the autocomplete
   * hit is a Google place id, not an Enterprise station.
   */
  async resolvePlace(address: string): Promise<Json> {
    const res = await this.get(`/api/places/autocomplete?filter=${encodeURIComponent(address)}`);
    const hits: Json[] = res?.data?.data || [];
    if (!hits.length) throw new EtdError(`no place match for '${address}'`);
    const detail = await this.get("/api/places/" + hits[0].stationId);
    const place = detail?.data;
    // Where did that actually land?
    //
    // hits[0] was taken on trust. A garbled address ("8000 Stream Walk Ln, Manassas,
    // Manassas,, VA") resolved to VALENCIA, SPAIN - 39.4738, -0.3756 - and since the
    // branch search is pinned to countryCode=US it came back empty with no reason
    // text. The operator then saw quote_failed, class_unmapped, branch_zip_missing
    // and no_date, four errors that say nothing about the real cause. Catch it here.
    const lat = Number(place?.latitude);
    const lon = Number(place?.longitude);
    const inUS =
      Number.isFinite(lat) && Number.isFinite(lon) &&
      ((lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) ||
       (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) ||
       (lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154));
    if (!inUS) {
      throw new EtdError(
        `'${address}' resolved to ${lat}, ${lon}, which is not in the United States ` +
        `(ETD matched "${String(place?.location ?? "?")}"). Fix the shop address or the ` +
        `technician's reported branch on the request; Enterprise has no branch there.`,
      );
    }
    return place;
  }

  /**
   * Enterprise branches near a point, nearest first. Each entry carries `stationId`
   * (e.g. `E12102`), `peoplesoftBranchId`, `branchCode` (`2102`),
   * `customerFacingBranchName`, `fullAddress` and `calculatedDistance` in km.
   */
  async closestBranches(
    latitude: string,
    longitude: string,
    when: string,
    opts: { journeyId?: string; count?: number; country?: string } = {},
  ): Promise<Json[]> {
    const url =
      `/api/crossdomain/GetClosestBranchesBasicByLatLong` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&numberOfBranchesToFind=${opts.count ?? 10}&availableBrands=${BRANDS}` +
      `&journeyDateTime=${when}&journeyUId=${opts.journeyId ?? ""}` +
      `&isPlaceAirport=false&countryCode=${opts.country ?? "US"}`;
    const res = await this.get(url);
    return res?.data || [];
  }

  /**
   * The location block `carClasses` wants, built from a branch record.
   *
   * Casing is load-bearing: this inner object is PascalCase while the request wrapping
   * it is camelCase. All-PascalCase binds partially and returns an empty class list
   * with hasErrors:false.
   */
  /**
   * ETD hands branch numbers back as "(+1)7574651000". A technician needs ten digits
   * they can tap, so anything that is not a clean US number is dropped rather than
   * put in front of them half-formatted.
   */
  static usPhone(raw: unknown): string | null {
    const d = String(raw ?? "").replace(/\D/g, "");
    const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
    if (ten.length !== 10) return null;
    return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  }

  static branchSite(branch: Json): Json {
    return {
      Name: `${branch.customerFacingBranchName},${branch.fullAddress}`,
      Latitude: String(branch.latitude ?? ""),
      Longitude: String(branch.longitude ?? ""),
      StationIds: { ET: branch.stationId },
      PeopleSoftIds: { ET: String(branch.peoplesoftBranchId) },
    };
  }

  // ---------------------------------------------------------------- availability

  /** Available vehicle classes with weekly rates, cheapest first. */
  /**
   * The additional-info fields the ACCOUNT requires RIGHT NOW.
   *
   * Read-only, and deliberately not cached. Enterprise edits this configuration without
   * telling us: between the last accepted booking of the 2026-08-13 wave and 2026-08-17
   * they dropped the mandatory `Truck Number` field, and a stale copy of this list is
   * precisely the bug the call exists to prevent.
   */
  async accountAdditionalInfoFields(accountUid: string = ACCOUNT_UID): Promise<Json[]> {
    const payload = await this.get(`/api/reservationwizard/additioninformation/${accountUid}`);
    const fields = payload?.data?.additionalInformationFields ?? [];
    return (Array.isArray(fields) ? fields : []).filter(
      (f: unknown) => !!f && typeof f === "object" && !Array.isArray(f),
    );
  }

  async carClasses(
    journeyId: string,
    site: Json,
    start: string,
    end: string,
    accountUid: string = ACCOUNT_UID,
  ): Promise<CarClass[]> {
    const payload = {
      journeyProfileId: journeyId,
      accountId: accountUid,
      startLocation: site,
      endLocation: { ...site },
      startDateTime: start,
      endDateTime: end,
      loyalty: null,
    };
    const raw = await this.post("/api/reservation/carclasses", payload);
    const out: CarClass[] = [];
    for (const c of raw?.carsInformation?.classInfo || []) {
      const brand = (c?.brandInfo || [{}])[0] || {};
      out.push({
        code: c?.modelCode ?? null,
        description: c?.modelDescription ?? null,
        passengers: c?.passengerQt,
        bags: c?.baggageQt,
        base_rate: brand?.baseRatePrice ?? null,
        estimated_total: brand?.estimatedTotalAmount,
        currency: brand?.currency,
        unit: brand?.unitName,
        unlimited_miles: c?.distance?.unlimited,
      });
    }
    return out.sort((a, b) => (a.base_rate || 0) - (b.base_rate || 0));
  }

  // ------------------------------------------------------------------- booking

  /**
   * Everything up to, but not including, the commit: resolve address -> create journey
   * -> advance wizard -> find branch -> price the classes.
   *
   * Nearest branch is the right default for a new rental. For a contract SWAP it is
   * wrong — the technician must return to the branch holding the Holman agreement,
   * which is `RENTING_BRANCH` on the feed and `branchCode` here. `preferBranchCode`
   * pins it and `branch_pinned` reports whether the pin took, so a fallback to nearest
   * is visible rather than silent.
   */
  async quote(opts: {
    address: string;
    start: string;
    end: string;
    accountUid?: string;
    preferBranchCode?: string;
    /**
     * When the chosen branch prices ZERO classes, walk the rest of the nearest-first
     * branch list and adopt the first one that has cars. Request #95 (SWICKLA,
     * 2026-08-24): the closest counter to the Eau Claire shop was a National-brand
     * desk that returns an EMPTY class list on this account, the next an airport
     * counter with nothing either, and the real branch sat 0.29 mi further with 17
     * classes including the exact approved one — the request read like a mapping bug
     * for hours while a car was available. Ignored whenever `preferBranchCode` is
     * set: a pinned branch (a cutover's contract branch) must never silently move.
     */
    nearbyOnEmpty?: boolean;
  }): Promise<QuoteResult> {
    const place = await this.resolvePlace(opts.address);
    const journey = await this.createJourney({
      location: place.location,
      latitude: place.latitude,
      longitude: place.longitude,
      postcode: place.postcode ?? "",
      town: place.townOrCity ?? "",
      start: opts.start,
      end: opts.end,
    });
    const journeyId: string = journey.id;
    const wiz = await this.wizard(journeyId);
    const reference: string | null = wiz?.data?.journeyDetails?.referenceNumber ?? null;

    const branches = await this.closestBranches(place.latitude, place.longitude, opts.start, {
      journeyId,
    });
    if (!branches.length) throw new EtdError(`no Enterprise branch near '${opts.address}'`);

    // Enterprise TRUCK RENTAL counters come back in this list looking exactly like car
    // branches - same brand 'ET', same shape, no type field anywhere (see
    // truck-locations.ts). They rent box trucks. Tyler, 2026-08-26: "we aren't supposed
    // to use the truck locations right now." Three of the sixteen branches around the
    // Athens shop on request #148 were truck yards, including the SECOND NEAREST, which
    // is the one an operator would have reached for when the nearest ran out of cars.
    const truckSkipped: NonNullable<QuoteResult["branch_truck_skipped"]> = [];
    const truckOf = new Map<Json, TruckVerdict>();
    const bookable: Json[] = [];
    for (const b of branches) {
      const v = isTruckBranch(b);
      truckOf.set(b, v);
      if (v.isTruck) {
        truckSkipped.push({
          code: String(b?.branchCode ?? ""),
          name: String(b?.customerFacingBranchName ?? ""),
          address: String(b?.fullAddress ?? ""),
          distance: String(b?.calculatedDistance ?? ""),
          reason: String(v.reason ?? ""),
        });
      } else {
        bookable.push(b);
      }
    }
    // Every branch in range being a truck yard is a real answer, not a bug. Say so
    // plainly rather than falling back to one, because a technician sent to a box-truck
    // counter is turned away at the desk and we find out hours later.
    if (!bookable.length) {
      throw new EtdError(
        `every Enterprise branch near '${opts.address}' is a TRUCK RENTAL location ` +
          `(${truckSkipped.map((t) => `${t.code} ${t.name}`).join(", ")}). ` +
          `Book by hand or add an allow entry to etd-runner/reference/branch_policy_overrides.json.`,
      );
    }

    let branch = bookable[0];
    let pinned = false;
    let pinnedIsTruck = false;
    if (opts.preferBranchCode) {
      const want = String(opts.preferBranchCode).trim().replace(/^0+/, "");
      // A pin is searched across ALL branches, truck ones included, and it is HONOURED.
      // A pin means a contract branch already holding this technician's vehicle, so
      // refusing it would strand a swap that is already in motion; ~20 of our historical
      // cutover bookings sit at truck addresses. It is reported instead, via
      // branch_pinned_is_truck, and the caller decides.
      for (const b of branches) {
        if (String(b?.branchCode ?? "").trim().replace(/^0+/, "") === want) {
          branch = b;
          pinned = true;
          pinnedIsTruck = Boolean(truckOf.get(b)?.isTruck);
          break;
        }
      }
    }
    let site = EtdClient.branchSite(branch);
    site.Latitude = place.latitude;
    site.Longitude = place.longitude;

    let classes = await this.carClasses(
      journeyId,
      site,
      opts.start,
      opts.end,
      opts.accountUid ?? ACCOUNT_UID,
    );

    // The chosen branch priced nothing. When the caller opted in and no branch is
    // pinned, price the next-nearest candidates in order and adopt the first with
    // cars. The list arrives nearest-first, so the distance cap doubles as the stop
    // condition; the attempt cap bounds the extra ETD calls. A branch adopted here is
    // reported via `branch_fallback_from_*` so the preview facts, the drawer and the
    // technician's confirmation all name the branch that was ACTUALLY priced — and the
    // commit lane pins `branchCode` from the confirmed preview, so this move can never
    // book a different place than the one an operator approved.
    let fallbackFrom: Json | null = null;
    let fallbackTried = 0;
    if (!classes.length && opts.nearbyOnEmpty && !opts.preferBranchCode) {
      // `bookable`, not `branches`: the ladder must not rescue an empty car branch by
      // adopting a truck yard, which is the exact move it would have made in Athens.
      for (const b of bookable) {
        if (b === branch) continue;
        if (fallbackTried >= NEARBY_FALLBACK_MAX_CANDIDATES) break;
        // `calculatedDistance` is documented as km on the feed; an absent value is
        // treated as too far rather than free (Number(null) is 0, which would rank
        // "unknown distance" CLOSER than every real branch), because unknown is
        // exactly the airport-satellite shape the cap exists to exclude.
        //
        // The feed does not actually send a bare number — real responses read
        // "22.45 km", unit suffix included. Number() demands the WHOLE string be
        // numeric and rejects that suffix, so it returned NaN for every branch,
        // every time, and this walk broke on its first candidate no matter how
        // close it was (verified live: request #237/#238 each had 7-9 real,
        // non-truck branches within a few km that were never tried). parseFloat
        // reads the leading numeric token and ignores the rest, which is what this
        // cap check has always needed.
        const raw = b?.calculatedDistance;
        const dist = raw === null || raw === undefined || raw === "" ? NaN : parseFloat(String(raw));
        if (!Number.isFinite(dist) || dist > NEARBY_FALLBACK_MAX_DISTANCE) break;
        fallbackTried += 1;
        const s2 = EtdClient.branchSite(b);
        s2.Latitude = place.latitude;
        s2.Longitude = place.longitude;
        const c2 = await this.carClasses(
          journeyId,
          s2,
          opts.start,
          opts.end,
          opts.accountUid ?? ACCOUNT_UID,
        );
        if (c2.length) {
          fallbackFrom = branch;
          branch = b;
          site = s2;
          classes = c2;
          break;
        }
      }
    }

    return {
      journey_id: journeyId,
      reference,
      place,
      branch,
      branch_pinned: pinned,
      branch_code: String(branch?.branchCode ?? ""),
      branch_name: branch?.customerFacingBranchName ?? "",
      branch_address: branch?.fullAddress ?? "",
      branch_phone: EtdClient.usPhone(branch?.telephone),
      site,
      classes,
      ...(fallbackFrom
        ? {
            branch_fallback_from_code: String(fallbackFrom?.branchCode ?? ""),
            branch_fallback_from_name: String(fallbackFrom?.customerFacingBranchName ?? ""),
            branch_fallback_tried: fallbackTried,
          }
        : {}),
      ...(truckSkipped.length ? { branch_truck_skipped: truckSkipped } : {}),
      ...(pinnedIsTruck ? { branch_pinned_is_truck: true } : {}),
    };
  }

  /** One of ETD's two pre-commit validators. Reads despite being POSTs. */
  postGate(path: string, model: Json): Promise<Json> {
    return this.post(path, model);
  }

  /**
   * THE COMMIT. Creates a real, billable Enterprise reservation.
   *
   * `live` is required and has no default: a caller that forgets it gets a refusal,
   * not a booking. `model` is the full reservation object the wizard builds up — the
   * same shape both validate gates accept — and must carry `boboId` plus
   * `isBOBOToggleEnabled: true` for a book-on-behalf-of.
   */
  confirmReservation(model: Json, opts: { live: boolean }): Promise<Json> {
    if (!opts?.live) {
      throw new EtdError(
        "confirmReservation blocked: pass { live: true } to commit. " +
          "This creates a real, billable Enterprise reservation.",
      );
    }
    return this.request("POST", "/api/reservationwizard/reservation/savedr", model);
  }

  timingSummary(): string {
    if (!this.calls.length) return "no calls";
    const total = this.calls.reduce((a, c) => a + c.ms, 0);
    return `${this.calls.length} calls, ${total} ms total, ${Math.trunc(total / this.calls.length)} ms avg`;
  }
}
