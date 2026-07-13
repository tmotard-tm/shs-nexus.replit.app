import express, {
  type Express,
  type RequestHandler,
  type Router,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  findAuthorizedConsumer,
  hasExternalFleetScope,
  isExternalFleetReadApiEnabled,
  parseExternalFleetKeyring,
  type ExternalFleetConsumer,
} from "./auth";
import {
  buildOpenRentalsReadModel,
  OpenRentalsSourceUnavailableError,
  type OpenRentalsInput,
  type OpenRentalsReadModel,
} from "./rental-ops-read-model";
import {
  buildFleetManagementListing,
  FleetManagementPrimarySourceUnavailableError,
  type FleetManagementListingInput,
  type PagedFleetManagementListing,
} from "./fleet-management-read-model";
import {
  buildTechnicianProfile,
  buildTruckProfile,
  searchProfiles,
  type ProfileBuilders,
  type TechnicianProfile,
  type TruckProfile,
} from "./profiles";
import { toCanonical } from "../vehicle-number-utils";
import { TpmsSearchSourceUnavailableError } from "./tpms-read-model";
import { createEnvelope, type ExternalFleetScope, type SourceObservation } from "./types";

const API_PATH = "/api/external/fleet/v1";
const RENTAL_OPS_FRESHNESS_WINDOW_SECONDS = 30 * 60;

type OpenRentalsBuilder = (
  input: OpenRentalsInput,
) => Promise<OpenRentalsReadModel>;

type FleetManagementListingBuilder = (
  input: FleetManagementListingInput,
) => Promise<PagedFleetManagementListing>;

const openRentalsQuerySchema = z.object({
  fileDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeOos: z.enum(["true", "false"]).default("false"),
  view: z.enum(["business_logic", "raw"]).default("business_logic"),
}).strict();

const fleetManagementListingQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  sort: z.enum(["truckNumber", "vehicleNumber", "technician", "status"]).default("truckNumber"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  query: z.string().trim().max(120).optional(),
}).strict();

const enterpriseIdPathSchema = z.string().trim().min(2).max(40)
  .regex(/^[A-Za-z0-9._-]+$/)
  .transform((value) => value.toUpperCase());

const truckNumberPathSchema = z.string().trim().min(1).max(20)
  .regex(/^\d+$/)
  .transform((value) => toCanonical(value));

const profileSearchQuerySchema = z.object({
  query: z.string().trim().min(2).max(120),
}).strict();

const defaultProfileBuilders: ProfileBuilders = {
  buildTechnicianProfile,
  buildTruckProfile,
  searchProfiles,
};

function profileEnvelope<T extends TechnicianProfile | TruckProfile>(profile: T) {
  const sourceUpdatedAt = profile.observations
    .map((observation) => observation.sourceUpdatedAt)
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .sort()[0] ?? null;
  const observations = profile.observations as SourceObservation<unknown>[];
  const freshness = observations.length === 0 || observations.some((item) => item.freshness.state === "unknown")
    ? { state: "unknown" as const, observedAt: null, ageSeconds: null }
    : observations.some((item) => item.freshness.state === "stale")
      ? {
          state: "stale" as const,
          observedAt: sourceUpdatedAt,
          ageSeconds: Math.max(...observations.map((item) => item.freshness.ageSeconds ?? 0)),
        }
      : {
          state: "fresh" as const,
          observedAt: sourceUpdatedAt,
          ageSeconds: Math.max(...observations.map((item) => item.freshness.ageSeconds ?? 0)),
        };
  return createEnvelope({ sourceUpdatedAt, freshness, warnings: profile.warnings, data: profile });
}

function rentalOpsFreshness(sourceUpdatedAt: string | null) {
  if (!sourceUpdatedAt) {
    return { state: "unknown" as const, observedAt: null, ageSeconds: null };
  }
  const sourceTime = Date.parse(sourceUpdatedAt);
  if (!Number.isFinite(sourceTime)) {
    return { state: "unknown" as const, observedAt: null, ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.floor((Date.now() - sourceTime) / 1000));
  return {
    state: ageSeconds <= RENTAL_OPS_FRESHNESS_WINDOW_SECONDS
      ? "fresh" as const
      : "stale" as const,
    observedAt: sourceUpdatedAt,
    ageSeconds,
  };
}

export function requireExternalFleetScope(
  scope: ExternalFleetScope,
): RequestHandler {
  return (_req, res, next) => {
    const consumer = res.locals
      .externalFleetConsumer as ExternalFleetConsumer | undefined;

    if (!consumer || !hasExternalFleetScope(consumer, scope)) {
      return res.status(403).json({
        error: {
          code: "INSUFFICIENT_SCOPE",
          message: "The API key is not authorized for this resource",
        },
      });
    }

    next();
  };
}

export function createExternalFleetReadRouter(
  consumers: ExternalFleetConsumer[],
  openRentalsBuilder: OpenRentalsBuilder = buildOpenRentalsReadModel,
  fleetManagementListingBuilder: FleetManagementListingBuilder = buildFleetManagementListing,
  profileBuilders: ProfileBuilders = defaultProfileBuilders,
): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only GET and HEAD are supported",
        },
      });
    }

    next();
  });

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  router.use((req, res, next) => {
    const consumer = findAuthorizedConsumer(
      req.get("authorization"),
      consumers,
    );

    if (!consumer) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Valid bearer authentication is required",
        },
      });
    }

    res.locals.externalFleetConsumer = consumer;
    next();
  });

  router.get(
    "/modules/rental-ops-open-rentals",
    requireExternalFleetScope("modules:read"),
    async (req, res) => {
      const parsed = openRentalsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_QUERY",
            message: "The query parameters are invalid",
          },
        });
      }

      try {
        const model = await openRentalsBuilder({
          ...(parsed.data.fileDate ? { fileDate: parsed.data.fileDate } : {}),
          includeOos: parsed.data.includeOos === "true",
          view: parsed.data.view,
        });
        const typed = model as OpenRentalsReadModel & { _cachedAt?: number };
        // Explicit output allowlist: only the fields the v1 contract exposes
        // today are forwarded, so a field later added to the shared read-model
        // for an internal UI can never auto-leak to external callers.
        const data: Record<string, unknown> = {
          data: typed.data,
          total: typed.total,
          view: typed.view,
        };
        if (typed.enterpriseCount !== undefined) data.enterpriseCount = typed.enterpriseCount;
        if (typed.holmanNonEnterpriseCount !== undefined) data.holmanNonEnterpriseCount = typed.holmanNonEnterpriseCount;
        if (typed.totalHolmanPOLines !== undefined) data.totalHolmanPOLines = typed.totalHolmanPOLines;
        if (typed.totalPOLines !== undefined) data.totalPOLines = typed.totalPOLines;
        if (typed.oosFilteredCount !== undefined) data.oosFilteredCount = typed.oosFilteredCount;
        return res.json(
          createEnvelope({
            sourceUpdatedAt: typed.sourceUpdatedAt,
            freshness: rentalOpsFreshness(typed.sourceUpdatedAt),
            warnings: typed.warnings,
            data,
          }),
        );
      } catch (error) {
        if (error instanceof OpenRentalsSourceUnavailableError) {
          return res.status(503).json({
            error: {
              code: "SOURCE_UNAVAILABLE",
              message: "The rental operations source is unavailable",
            },
          });
        }
        return res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "The rental operations request could not be completed",
          },
        });
      }
    },
  );

  router.get(
    "/modules/fleet-management-listing",
    requireExternalFleetScope("modules:read"),
    async (req, res) => {
      const parsed = fleetManagementListingQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_QUERY",
            message: "The query parameters are invalid",
          },
        });
      }

      try {
        const model = await fleetManagementListingBuilder(parsed.data);
        const sourceUpdatedAt = model.rows
          .map((row) => row.sourceUpdatedAt)
          .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
          .sort()[0] ?? null;
        const warningMap = new Map(
          model.rows.flatMap((row) => row.warnings)
            .map((warning) => [`${warning.code}:${warning.message}`, warning] as const),
        );
        return res.json(createEnvelope({
          sourceUpdatedAt,
          freshness: rentalOpsFreshness(sourceUpdatedAt),
          warnings: [...warningMap.values()],
          data: model,
        }));
      } catch (error) {
        if (error instanceof FleetManagementPrimarySourceUnavailableError) {
          return res.status(503).json({
            error: {
              code: "SOURCE_UNAVAILABLE",
              message: "The fleet management vehicle source is unavailable",
            },
          });
        }
        return res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "The fleet management listing request could not be completed",
          },
        });
      }
    },
  );

  router.get(
    "/profiles/technicians/:enterpriseId",
    requireExternalFleetScope("profiles:read"),
    async (req, res) => {
      const parsed = enterpriseIdPathSchema.safeParse(req.params.enterpriseId);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "INVALID_QUERY", message: "The profile identifier is invalid" } });
      }
      try {
        const profile = await profileBuilders.buildTechnicianProfile(parsed.data);
        if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "The profile was not found" } });
        return res.json(profileEnvelope(profile));
      } catch {
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The profile request could not be completed" } });
      }
    },
  );

  router.get(
    "/profiles/trucks/:truckNumber",
    requireExternalFleetScope("profiles:read"),
    async (req, res) => {
      const parsed = truckNumberPathSchema.safeParse(req.params.truckNumber);
      if (!parsed.success || !parsed.data) {
        return res.status(400).json({ error: { code: "INVALID_QUERY", message: "The truck identifier is invalid" } });
      }
      try {
        const profile = await profileBuilders.buildTruckProfile(parsed.data);
        if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "The profile was not found" } });
        return res.json(profileEnvelope(profile));
      } catch {
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The profile request could not be completed" } });
      }
    },
  );

  router.get(
    "/search",
    requireExternalFleetScope("search:read"),
    async (req, res) => {
      const parsed = profileSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: { code: "INVALID_QUERY", message: "The query parameters are invalid" } });
      }
      try {
        const data = await profileBuilders.searchProfiles(parsed.data.query);
        return res.json(createEnvelope({
          sourceUpdatedAt: null,
          freshness: { state: "unknown", observedAt: null, ageSeconds: null },
          warnings: data.matchState === "ambiguous"
            ? [{ code: "AMBIGUOUS_MATCH", message: "The search matched multiple profiles" }]
            : [],
          data,
        }));
      } catch (error) {
        if (error instanceof TpmsSearchSourceUnavailableError) {
          return res.status(503).json({ error: { code: "SOURCE_UNAVAILABLE", message: "The profile search sources are unavailable" } });
        }
        return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The search request could not be completed" } });
      }
    },
  );

  router.get(
    "/health",
    requireExternalFleetScope("modules:read"),
    (_req, res) => {
      res.json(
        createEnvelope({
          sourceUpdatedAt: null,
          freshness: {
            state: "unknown",
            observedAt: null,
            ageSeconds: null,
          },
          warnings: [],
          data: {
            service: "nexus-external-fleet-read-api",
            status: "ok",
          },
        }),
      );
    },
  );

  return router;
}

export function registerExternalFleetReadApi(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isExternalFleetReadApiEnabled(env)) {
    return false;
  }

  let consumers: ExternalFleetConsumer[];
  try {
    consumers = parseExternalFleetKeyring(
      env.NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON,
    );
  } catch (error) {
    console.error(
      "[External Fleet API] NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON is invalid; " +
        "the external fleet read API stays disabled: " +
        (error instanceof Error ? error.message : String(error)),
    );
    return false;
  }

  app.use(API_PATH, createExternalFleetReadRouter(consumers));
  return true;
}
