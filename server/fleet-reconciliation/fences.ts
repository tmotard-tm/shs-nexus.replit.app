/**
 * Write fences (#b) — generic field-freeze so the nightly bulk syncs cannot
 * clobber a tier-3 backstop correction before it has been bulk-verified.
 *
 * When the backstop writes an assignment/cost-center correction to a downstream
 * system (Holman/AMS/WMS) it ALSO mirrors that value into the Nexus-local cache
 * and stamps a fence on {system, truck_canonical, field}. The downstream system
 * may not reflect the change immediately (Holman 202 != applied; AMS propagates
 * on an overnight batch), so the very next bulk sync would otherwise re-pull the
 * stale live value and overwrite the backstop's correction. While a fence is
 * ACTIVE the sync must PRESERVE the cached (backstop-written) value instead.
 *
 * A fence is ACTIVE until it is verified (bulk-verify confirmed the live system
 * now matches → lift early) OR it expires (safety TTL → lift). The sync paths
 * READ fences (loadActiveFenceSet); the tier-3 executor WRITES them (writeFence),
 * the bulk-verify / repair loop VERIFIES them (verifyFence) and an admin revert
 * may EXPIRE them (expireFence).
 */
import { db } from "../db";
import { reconciliationWriteFences } from "@shared/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";

export type FenceSystem = "holman" | "ams" | "wms";
export type FenceField = "assignment" | "cost_center";

// A drizzle transaction is assignable everywhere `db` is for insert/update, but
// its concrete type differs — accept either so the executor can fence inside the
// same tx that writes the cache (#a ordering).
type TxArg = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | TxArg;

// Default fence lifetime: a safety TTL so a never-verified fence eventually
// lifts on its own. Bulk-verify normally lifts it far sooner via verifyFence.
export const DEFAULT_FENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Load the set of canonical truck numbers with an ACTIVE fence for
 * (system, field). Active = not yet verified AND not yet expired. Callers check
 * membership per-row (canonicalize the row's truck number first) and skip
 * overwriting the fenced field when present.
 */
export async function loadActiveFenceSet(
  system: FenceSystem,
  field: FenceField,
): Promise<Set<string>> {
  const rows = await db
    .select({ truck: reconciliationWriteFences.truckCanonical })
    .from(reconciliationWriteFences)
    .where(
      and(
        eq(reconciliationWriteFences.system, system),
        eq(reconciliationWriteFences.field, field),
        isNull(reconciliationWriteFences.verifiedAt),
        or(
          isNull(reconciliationWriteFences.expiresAt),
          sql`${reconciliationWriteFences.expiresAt} > now()`,
        ),
      ),
    );
  return new Set(rows.map((r) => r.truck).filter((t): t is string => !!t));
}

/**
 * Stamp (or refresh) an ACTIVE fence on {system, truck, field} after the
 * executor has written the correction to the downstream system + mirrored it
 * into the Nexus cache. Re-stamping the same target resets the TTL and clears
 * any prior verifiedAt (a fresh correction must be re-verified). Pass the same
 * `tx` the cache write runs in so the cache + fence land atomically (#a).
 */
export async function writeFence(
  dbx: DbOrTx,
  fence: {
    system: FenceSystem;
    truckCanonical: string;
    field: FenceField;
    expectedValue: string | null;
    runId?: string | null;
    ttlMs?: number;
  },
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (fence.ttlMs ?? DEFAULT_FENCE_TTL_MS));
  await dbx
    .insert(reconciliationWriteFences)
    .values({
      system: fence.system,
      truckCanonical: fence.truckCanonical,
      field: fence.field,
      expectedValue: fence.expectedValue,
      runId: fence.runId ?? null,
      expiresAt,
      verifiedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        reconciliationWriteFences.system,
        reconciliationWriteFences.truckCanonical,
        reconciliationWriteFences.field,
      ],
      set: {
        expectedValue: fence.expectedValue,
        runId: fence.runId ?? null,
        expiresAt,
        verifiedAt: null,
        updatedAt: now,
      },
    });
}

/**
 * Lift a fence EARLY once bulk-verify confirms the live system now matches the
 * backstop's correction. Idempotent: only flips an as-yet-unverified fence.
 */
export async function verifyFence(
  dbx: DbOrTx,
  system: FenceSystem,
  truckCanonical: string,
  field: FenceField,
): Promise<void> {
  const now = new Date();
  await dbx
    .update(reconciliationWriteFences)
    .set({ verifiedAt: now, updatedAt: now })
    .where(
      and(
        eq(reconciliationWriteFences.system, system),
        eq(reconciliationWriteFences.truckCanonical, truckCanonical),
        eq(reconciliationWriteFences.field, field),
        isNull(reconciliationWriteFences.verifiedAt),
      ),
    );
}

/**
 * Force a fence to lift NOW (expire it) — used by an admin revert so the next
 * sync is free to re-pull the (reverted) live value rather than preserving the
 * cached correction we just undid.
 */
export async function expireFence(
  dbx: DbOrTx,
  system: FenceSystem,
  truckCanonical: string,
  field: FenceField,
): Promise<void> {
  const now = new Date();
  await dbx
    .update(reconciliationWriteFences)
    .set({ expiresAt: now, updatedAt: now })
    .where(
      and(
        eq(reconciliationWriteFences.system, system),
        eq(reconciliationWriteFences.truckCanonical, truckCanonical),
        eq(reconciliationWriteFences.field, field),
      ),
    );
}
