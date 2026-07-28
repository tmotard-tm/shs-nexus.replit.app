import type { Express, RequestHandler } from "express";

import {
  fetchNearbyTlts,
  NearbyTltClientError,
  type NearbyTltResult,
} from "./nearby-tlt-client";

export interface AssetsQueueEnterpriseIdResolution {
  found: boolean;
  enterpriseId?: string;
}

export interface NearbyTltProxyDependencies {
  requireAuth: RequestHandler;
  hasAssetsAccess: (user: any) => Promise<boolean>;
  resolveAssetsQueueEnterpriseId: (
    itemId: string,
  ) => Promise<AssetsQueueEnterpriseIdResolution>;
  fetchNearbyTlts?: (enterpriseId: string) => Promise<NearbyTltResult>;
}

function sendError(
  res: any,
  status: number,
  code: string,
  message: string,
): any {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({
    success: false,
    error: { code, message },
  });
}

function sendClientError(res: any, error: NearbyTltClientError): any {
  switch (error.code) {
    case "CONFIG_MISSING":
      return sendError(res, 503, "NEXUS_CONFIGURATION_MISSING", error.message);
    case "ORIGIN_NOT_FOUND":
      return sendError(res, 404, "ORIGIN_NOT_FOUND", error.message);
    case "ORIGIN_LOCATION_UNAVAILABLE":
      return sendError(res, 422, "ORIGIN_LOCATION_UNAVAILABLE", error.message);
    case "AUTHENTICATION_FAILED":
      return sendError(res, 502, "CTR_AUTHENTICATION_FAILED", error.message);
    case "RATE_LIMITED":
      return sendError(res, 429, "CTR_RATE_LIMITED", error.message);
    case "TIMEOUT":
      return sendError(res, 504, "CTR_TIMEOUT", error.message);
    case "MALFORMED_RESPONSE":
      return sendError(res, 502, "CTR_INVALID_RESPONSE", error.message);
    default:
      return sendError(res, 502, "CTR_UPSTREAM_UNAVAILABLE", error.message);
  }
}

export function registerNearbyTltProxy(
  app: Express,
  dependencies: NearbyTltProxyDependencies,
): void {
  const client = dependencies.fetchNearbyTlts ?? fetchNearbyTlts;
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  app.get(
    "/api/assets-queue/:itemId/nearby-tlts",
    noStore,
    dependencies.requireAuth,
    async (req: any, res) => {
      try {
        if (!await dependencies.hasAssetsAccess(req.user)) {
          return sendError(res, 403, "ACCESS_DENIED", "Access denied");
        }

        const resolution = await dependencies.resolveAssetsQueueEnterpriseId(
          req.params.itemId,
        );
        if (!resolution.found) {
          return sendError(
            res,
            404,
            "ASSETS_ITEM_NOT_FOUND",
            "Assets Management queue item not found",
          );
        }

        const enterpriseId = resolution.enterpriseId?.trim();
        if (!enterpriseId) {
          return sendError(
            res,
            422,
            "ORIGIN_ENTERPRISE_ID_UNAVAILABLE",
            "The Assets Management queue item does not contain a technician enterprise ID",
          );
        }

        const result = await client(enterpriseId);
        return res.json({
          success: true,
          data: result,
        });
      } catch (error: any) {
        if (error instanceof NearbyTltClientError) {
          return sendClientError(res, error);
        }
        console.error(
          "[NearbyTLT] Proxy request failed:",
          error?.message || "Unknown error",
        );
        return sendError(
          res,
          500,
          "NEXUS_INTERNAL_ERROR",
          "Failed to retrieve nearby TLTs",
        );
      }
    },
  );
}
