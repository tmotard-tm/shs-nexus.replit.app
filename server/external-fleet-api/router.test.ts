import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express, { type Express } from "express";

import { registerExternalFleetReadApi } from "./router";

const modulesKey = "sample-secret-value-at-least-24";
const profilesKey = "profiles-secret-value-at-least-24";

function enabledEnv(): NodeJS.ProcessEnv {
  return {
    NEXUS_EXTERNAL_FLEET_READ_API_ENABLED: "true",
    NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON: JSON.stringify([
      {
        consumerId: "modules-consumer",
        key: modulesKey,
        scopes: ["modules:read"],
      },
      {
        consumerId: "profiles-consumer",
        key: profilesKey,
        scopes: ["profiles:read"],
      },
    ]),
  } as NodeJS.ProcessEnv;
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await new Promise<ReturnType<Express["listen"]>>((resolve, reject) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

{
  const app = express();
  assert.equal(registerExternalFleetReadApi(app, {} as NodeJS.ProcessEnv), false);
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`);
    assert.equal(response.status, 404);
  });
}

{
  const app = express();
  assert.equal(registerExternalFleetReadApi(app, enabledEnv()), true);
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`, {
      method: "POST",
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(await response.json(), {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Only GET and HEAD are supported",
      },
    });
  });
}

{
  const app = express();
  registerExternalFleetReadApi(app, enabledEnv());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Valid bearer authentication is required",
      },
    });
  });
}

{
  const app = express();
  registerExternalFleetReadApi(app, enabledEnv());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`, {
      headers: { Authorization: "Bearer unknown-secret-value-at-least-24" },
    });
    assert.equal(response.status, 401);
  });
}

{
  const app = express();
  registerExternalFleetReadApi(app, enabledEnv());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`, {
      headers: { Authorization: `Bearer ${profilesKey}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: "The API key is not authorized for this resource",
      },
    });
  });
}

{
  const app = express();
  registerExternalFleetReadApi(app, enabledEnv());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.apiVersion, "1.0.0");
    assert.deepEqual(body.data, {
      service: "nexus-external-fleet-read-api",
      status: "ok",
    });
    assert.equal(JSON.stringify(body).includes(modulesKey), false);
  });
}

{
  const app = express();
  registerExternalFleetReadApi(app, enabledEnv());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/health`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  });
}
