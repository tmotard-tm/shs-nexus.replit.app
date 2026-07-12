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
import { createEnvelope, type ExternalFleetScope } from "./types";

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
        const {
          sourceUpdatedAt,
          warnings,
          _cachedAt: _legacyCachedAt,
          ...data
        } = model as OpenRentalsReadModel & { _cachedAt?: number };
        return res.json(
          createEnvelope({
            sourceUpdatedAt,
            freshness: rentalOpsFreshness(sourceUpdatedAt),
            warnings,
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

  const consumers = parseExternalFleetKeyring(
    env.NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON,
  );
  app.use(API_PATH, createExternalFleetReadRouter(consumers));
  return true;
}
