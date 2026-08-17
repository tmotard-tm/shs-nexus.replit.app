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

export const API_BASE = "https://prd-we-api.etd.ehi.com";

export const COMPANY_ID = 33425;

/**
 * The TransformCo billing account. Captured 2026-08-11 from a real booking;
 * `company/accounts` is 403 for our admin role, so this cannot be looked up.
 */
export const ACCOUNT_UID = "8792e92a-841f-44bc-ac1c-dfffe981db2c";

/** Brands the account may book. Sent to reservation/locations and the branch lookup. */
export const BRANDS = "ET,ZL";

/** ETD silently caps PageSize at 100 — asking for more returns 100 rows with no warning. */
export const MAX_PAGE_SIZE = 100;

export class EtdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtdError";
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
  return `${method} ${path} rejected: ${safeErrorText(messagesOf(payload))}`;
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

function messagesOf(payload: Json): string {
  if (!payload || typeof payload !== "object") return "";
  let msgs: unknown = payload.messages ?? payload.errorMessage ?? "";
  if (Array.isArray(msgs)) msgs = msgs.map((m) => String(m)).join(" | ");
  return String(msgs).replace(/\u00a0/g, " ");
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
  site: Json;
  classes: CarClass[];
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
      throw new EtdError(`${method} ${path} transport failure: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    this.calls.push({ method, path, status: resp.status, ms: Date.now() - started });

    if (resp.status === 403) throw new EtdError(`403 not entitled: ${method} ${path}`);
    if (resp.status >= 400) {
      throw new EtdError(`${resp.status} ${method} ${path}: ${safeErrorText(text)}`);
    }

    let payload: Json;
    try {
      payload = JSON.parse(text);
    } catch {
      return text;
    }

    // ETD returns HTTP 200 with success:false for validation failures.
    if (!isOk(payload)) {
      throw new EtdError(rejectionMessage(method, path, payload));
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
    return detail?.data;
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

    let branch = branches[0];
    let pinned = false;
    if (opts.preferBranchCode) {
      const want = String(opts.preferBranchCode).trim().replace(/^0+/, "");
      for (const b of branches) {
        if (String(b?.branchCode ?? "").trim().replace(/^0+/, "") === want) {
          branch = b;
          pinned = true;
          break;
        }
      }
    }
    const site = EtdClient.branchSite(branch);
    site.Latitude = place.latitude;
    site.Longitude = place.longitude;

    return {
      journey_id: journeyId,
      reference,
      place,
      branch,
      branch_pinned: pinned,
      branch_code: String(branch?.branchCode ?? ""),
      branch_name: branch?.customerFacingBranchName ?? "",
      branch_address: branch?.fullAddress ?? "",
      site,
      classes: await this.carClasses(
        journeyId,
        site,
        opts.start,
        opts.end,
        opts.accountUid ?? ACCOUNT_UID,
      ),
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
