import express, {
  type Express,
  type RequestHandler,
  type Router,
} from "express";
import rateLimit from "express-rate-limit";

import {
  findAuthorizedConsumer,
  hasExternalFleetScope,
  isExternalFleetReadApiEnabled,
  parseExternalFleetKeyring,
  type ExternalFleetConsumer,
} from "./auth";
import { createEnvelope, type ExternalFleetScope } from "./types";

const API_PATH = "/api/external/fleet/v1";

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
