import { z } from "zod";

const APPROVED_JOB_TITLES = [
  "Team Lead Technician",
  "HVAC Team Lead Technician",
] as const;

const upstreamResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    origin: z.object({
      enterpriseId: z.string().min(1),
      technicianRecordSyncedAt: z.string().datetime(),
    }),
    matches: z.array(z.object({
      enterpriseId: z.string().min(1),
      displayName: z.string().min(1),
      jobTitle: z.enum(APPROVED_JOB_TITLES),
      distanceMiles: z.number().finite().nonnegative(),
      technicianRecordSyncedAt: z.string().datetime(),
    })).max(3),
    requestedLimit: z.literal(3),
    returnedCount: z.number().int().min(0).max(3),
    rankingBasis: z.literal("straight_line_distance"),
  }),
});

export type NearbyTltClientErrorCode =
  | "CONFIG_MISSING"
  | "ORIGIN_NOT_FOUND"
  | "ORIGIN_LOCATION_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE";

export class NearbyTltClientError extends Error {
  constructor(
    public readonly code: NearbyTltClientErrorCode,
    message: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "NearbyTltClientError";
  }
}

export interface NearbyTltMatch {
  enterpriseId: string;
  displayName: string;
  jobTitle: (typeof APPROVED_JOB_TITLES)[number];
  distanceMiles: number;
  technicianRecordSyncedAt: string;
}

export interface NearbyTltResult {
  originTechnicianRecordSyncedAt: string;
  matches: NearbyTltMatch[];
  returnedCount: number;
  rankingBasis: "straight_line_distance";
}

export interface NearbyTltClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function getConfig(env: NodeJS.ProcessEnv): { baseUrl: string; apiKey: string } {
  const baseUrl = env.CTR_API_BASE_URL?.trim();
  const apiKey = env.CTR_NEXUS_LOCATION_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new NearbyTltClientError(
      "CONFIG_MISSING",
      "Nearby TLT integration is not configured in Nexus",
    );
  }

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    throw new NearbyTltClientError(
      "CONFIG_MISSING",
      "Nearby TLT integration has an invalid CTR base URL",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function mapUpstreamFailure(status: number): NearbyTltClientError {
  if (status === 401 || status === 403) {
    return new NearbyTltClientError(
      "AUTHENTICATION_FAILED",
      "CTR rejected Nexus authentication",
      status,
    );
  }
  if (status === 404) {
    return new NearbyTltClientError(
      "ORIGIN_NOT_FOUND",
      "The selected technician was not found in CTR",
      status,
    );
  }
  if (status === 422) {
    return new NearbyTltClientError(
      "ORIGIN_LOCATION_UNAVAILABLE",
      "CTR does not have usable coordinates for the selected technician",
      status,
    );
  }
  if (status === 429) {
    return new NearbyTltClientError(
      "RATE_LIMITED",
      "CTR temporarily rate-limited the Nearby TLT request",
      status,
    );
  }
  return new NearbyTltClientError(
    "UPSTREAM_UNAVAILABLE",
    "CTR Nearby TLT service is unavailable",
    status,
  );
}

export async function fetchNearbyTlts(
  enterpriseIdRaw: string,
  options: NearbyTltClientOptions = {},
): Promise<NearbyTltResult> {
  const enterpriseId = enterpriseIdRaw.trim();
  if (!enterpriseId) {
    throw new NearbyTltClientError(
      "MALFORMED_RESPONSE",
      "A workflow enterprise ID is required",
    );
  }

  const config = getConfig(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const url = new URL("/api/internal/nexus/v1/nearby-tlts", config.baseUrl);
    url.searchParams.set("technician_enterprise_id", enterpriseId);
    url.searchParams.set("limit", "3");

    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": config.apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw mapUpstreamFailure(response.status);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new NearbyTltClientError(
        "MALFORMED_RESPONSE",
        "CTR returned a non-JSON response",
        response.status,
      );
    }

    const parsed = upstreamResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.data.returnedCount !== parsed.data.data.matches.length) {
      throw new NearbyTltClientError(
        "MALFORMED_RESPONSE",
        "CTR returned an invalid Nearby TLT response",
        response.status,
      );
    }

    const matches = parsed.data.data.matches
      .map((match) => ({
        enterpriseId: match.enterpriseId,
        displayName: match.displayName,
        jobTitle: match.jobTitle,
        distanceMiles: match.distanceMiles,
        technicianRecordSyncedAt: match.technicianRecordSyncedAt,
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    return {
      originTechnicianRecordSyncedAt:
        parsed.data.data.origin.technicianRecordSyncedAt,
      matches,
      returnedCount: matches.length,
      rankingBasis: "straight_line_distance",
    };
  } catch (error: any) {
    if (error instanceof NearbyTltClientError) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new NearbyTltClientError(
        "TIMEOUT",
        "CTR Nearby TLT request timed out",
      );
    }
    throw new NearbyTltClientError(
      "UPSTREAM_UNAVAILABLE",
      "CTR Nearby TLT service could not be reached",
    );
  } finally {
    clearTimeout(timeout);
  }
}
