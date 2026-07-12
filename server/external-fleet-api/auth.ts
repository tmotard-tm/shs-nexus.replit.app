import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { ExternalFleetScope } from "./types";

const KEYRING_ENV_NAME = "NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON";

const externalFleetScopeSchema = z.enum([
  "modules:read",
  "profiles:read",
  "search:read",
]);

const externalFleetConsumerSchema = z.object({
  consumerId: z.string().min(1).max(80),
  key: z.string().min(24),
  scopes: z.array(externalFleetScopeSchema).min(1),
});

const externalFleetKeyringSchema = z.array(externalFleetConsumerSchema);

export type ExternalFleetConsumer = {
  consumerId: string;
  key: string;
  scopes: ExternalFleetScope[];
};

export function parseExternalFleetKeyring(
  raw: string | undefined,
): ExternalFleetConsumer[] {
  if (raw === undefined) {
    return [];
  }

  try {
    return externalFleetKeyringSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(`${KEYRING_ENV_NAME} is invalid`);
  }
}

export function isExternalFleetReadApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NEXUS_EXTERNAL_FLEET_READ_API_ENABLED === "true";
}

export function findAuthorizedConsumer(
  header: string | undefined,
  consumers: ExternalFleetConsumer[],
): ExternalFleetConsumer | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (!match) {
    return null;
  }

  const providedKey = Buffer.from(match[1]);
  for (const consumer of consumers) {
    const expectedKey = Buffer.from(consumer.key);
    if (
      providedKey.length === expectedKey.length &&
      timingSafeEqual(providedKey, expectedKey)
    ) {
      return consumer;
    }
  }

  return null;
}

export function hasExternalFleetScope(
  consumer: ExternalFleetConsumer,
  scope: ExternalFleetScope,
): boolean {
  return consumer.scopes.includes(scope);
}
