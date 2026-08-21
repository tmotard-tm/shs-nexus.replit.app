import { db } from "./db";
import { holmanSubmissions, fleetOperationLog, holmanVehiclesCache, reconciliationWriteFences, type HolmanSubmission, type InsertHolmanSubmission } from "@shared/schema";
import { eq, and, inArray, desc, gte, lte, like, sql, isNull, or } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";
import { verifyFence, expireFence } from "./fleet-reconciliation/fences";
import { toCanonical, normalizeEnterpriseId } from "./vehicle-number-utils";
import {
  isOutOfServiceRecord,
  oosVerificationExpired,
  OOS_VERIFICATION_WINDOW_MS,
} from "./holman-oos-policy";

const HOLMAN_SUBMISSION_EXPIRY_MS = parseInt(process.env.HOLMAN_SUBMISSION_EXPIRY_MS || '1200000', 10); // default 20 minutes
const PRE_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes before expiry
const POST_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes after expiry

// Lifecycle (out-of-service) changes are NOT applied by Holman in near-real-time the
// way driver/assignment edits are. Measured against the live fleet, ~94% of all Holman
// record changes land in two nightly batch windows (~00:xx and ~05:xx UTC); a record
// submitted just after a window waits for the next one. The 20-minute default would
// therefore mark every out-of-service submission "failed" many hours before Holman had
// any opportunity to process it.
//
// The window is deliberately larger than a single cycle: an observed submit at 12:15Z
// was not applied until ~05:2x two calendar days later (~41 hours). Expiring earlier
// than that fails a valid in-flight write, and a failed row stops being polled — so the
// late success would never be recorded. See OOS_VERIFICATION_WINDOW_MS.
const HOLMAN_OOS_EXPIRY_MS = parseInt(
  process.env.HOLMAN_OOS_EXPIRY_MS || String(OOS_VERIFICATION_WINDOW_MS),
  10,
); // default 72 hours

function expiryMsForAction(action: string | null | undefined): number {
  return action === 'out_of_service' ? HOLMAN_OOS_EXPIRY_MS : HOLMAN_SUBMISSION_EXPIRY_MS;
}

export class HolmanSubmissionService {
  async createSubmission(data: {
    holmanVehicleNumber: string;
    action: 'assign' | 'unassign' | 'field_test' | 'district' | 'out_of_service';
    enterpriseId?: string | null;
    submissionId?: string | null;
    correlationId?: string | null;
    payload?: any;
    response?: any;
    createdBy?: string | null;
  }): Promise<HolmanSubmission> {
    const [submission] = await db.insert(holmanSubmissions).values({
      holmanVehicleNumber: data.holmanVehicleNumber,
      action: data.action,
      enterpriseId: data.enterpriseId || null,
      submissionId: data.submissionId || null,
      correlationId: data.correlationId || null,
      status: 'pending',
      payload: data.payload || null,
      response: data.response || null,
      createdBy: data.createdBy || null,
    }).returning();
    
    console.log(`[HolmanSubmission] Created submission ${submission.id} for vehicle ${data.holmanVehicleNumber}`);
    return submission;
  }

  async getSubmissionById(id: string): Promise<HolmanSubmission | null> {
    const [submission] = await db.select()
      .from(holmanSubmissions)
      .where(eq(holmanSubmissions.id, id))
      .limit(1);
    return submission || null;
  }

  async getSubmissionsByVehicle(holmanVehicleNumber: string): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(eq(holmanSubmissions.holmanVehicleNumber, holmanVehicleNumber))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async getPendingSubmissionsForVehicle(holmanVehicleNumber: string): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(and(
        eq(holmanSubmissions.holmanVehicleNumber, holmanVehicleNumber),
        inArray(holmanSubmissions.status, ['pending', 'processing'])
      ))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async getAllPendingSubmissions(): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(inArray(holmanSubmissions.status, ['pending', 'processing']))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async updateSubmissionStatus(
    id: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string | null,
    lastObservedTech?: string | null
  ): Promise<HolmanSubmission | null> {
    const updateData: any = {
      status,
      lastCheckedAt: new Date(),
    };
    
    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = new Date();
    }
    
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    if (lastObservedTech !== undefined) {
      updateData.lastObservedTech = lastObservedTech;
    }

    const [updated] = await db.update(holmanSubmissions)
      .set(updateData)
      .where(eq(holmanSubmissions.id, id))
      .returning();
    
    return updated || null;
  }

  // Normalize a district/prefix value to its last 4 digits for comparison.
  // Holman stores the prefix as a 4-digit string (e.g. "7670"); local district
  // values may be zero-padded to 7 ("0007670"). Compare on the last 4 digits.
  private normalizePrefix(value: any): string {
    // Holman district prefixes are 4-digit, zero-padded (e.g. "0890"). Strip any
    // non-digits; return '' when there are none so the empty-target guard in the
    // district branches still fires (otherwise padStart would turn "" into "0000"
    // and a malformed payload could false-match a real district of "0000"). When
    // digits exist, take the last 4 and left-pad to 4 so an unpadded Holman value
    // like "890" still compares equal to a padded target "0890" (avoids a false
    // "not yet applied" that would leave the card frozen). Padding can't create a
    // false positive — distinct 4-digit prefixes stay distinct.
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.slice(-4).padStart(4, '0');
  }

  // ─── Superseded write-fence release (2026-07-24, truck 23893) ────────────────
  // A reconciliation write-fence freezes holman_vehicles_cache's tech fields to
  // the backstop-written value until bulk-verify confirms it or the 7-day TTL
  // expires. If a NEWER assign/unassign is confirmed against live Holman while
  // such a fence is active, the fence's expectation is obsolete: without this
  // release it would pin the stale cached value (blocking every bulk pull) for
  // up to a week. Called at each confirmed-assign/unassign point.
  //  - fence expectation matches the confirmed value → verifyFence (live now
  //    matches what the backstop wanted; lift early, normal semantics)
  //  - fence expectation differs → expireFence (superseded by this newer
  //    confirmed operation) + mirror the confirmed truth into the cache so the
  //    mismatch view heals without waiting for the next bulk pull.
  // ONLY call this from LIVE-Holman-confirmed points, never from cache-based
  // confirms: the fence pins the cache to its own expected value, so a cache
  // "confirmation" can be the fence's own pinned value reflected back
  // (circular evidence) — lifting on it would clobber the very correction the
  // fence protects during Holman's apply-latency window.
  // Never throws — fence bookkeeping must not fail a successful verification.
  private async releaseSupersededFence(
    vehicleNumber: string,
    confirmedTech: string | null,
    confirmedName: string | null,
    submissionCreatedAt: Date | null,
  ): Promise<void> {
    try {
      const canonical = (toCanonical(vehicleNumber) || "").trim();
      if (!canonical) return;
      const [fence] = await db
        .select()
        .from(reconciliationWriteFences)
        .where(
          and(
            eq(reconciliationWriteFences.system, "holman"),
            eq(reconciliationWriteFences.truckCanonical, canonical),
            eq(reconciliationWriteFences.field, "assignment"),
            isNull(reconciliationWriteFences.verifiedAt),
            or(
              isNull(reconciliationWriteFences.expiresAt),
              sql`${reconciliationWriteFences.expiresAt} > now()`,
            ),
          ),
        )
        .limit(1);
      if (!fence) return;

      // Supersession-order guard: only a submission created strictly AFTER
      // the fence may release it. An older in-flight submission confirming
      // late must not expire a newer fence (mirrors the sweep's check).
      if (!submissionCreatedAt || !(submissionCreatedAt > fence.createdAt)) {
        return;
      }

      const norm = (v: string | null | undefined) => {
        const t = String(v ?? "").trim().toLowerCase();
        return t || null;
      };
      const expected = norm(fence.expectedValue);
      const confirmed = norm(confirmedTech);

      if (expected === confirmed) {
        await verifyFence(db, "holman", canonical, "assignment");
        console.log(`[HolmanVerify] Fence on ${canonical} verified early — live matches backstop expectation ("${expected ?? ""}")`);
        return;
      }

      await expireFence(db, "holman", canonical, "assignment");
      await db
        .update(holmanVehiclesCache)
        .set({
          // Same normalization the bulk sync writes (lowercased enterprise id)
          holmanTechAssigned: confirmedTech ? normalizeEnterpriseId(confirmedTech) || null : null,
          holmanTechName: confirmedTech ? (confirmedName || null) : null,
          lastLocalUpdateAt: new Date(),
        })
        .where(sql`UPPER(LTRIM(TRIM(${holmanVehiclesCache.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()}`);
      console.log(
        `[HolmanVerify] Fence on ${canonical} SUPERSEDED (expected "${expected ?? ""}", confirmed "${confirmed ?? ""}") — expired + cache mirrored`,
      );
    } catch (e: any) {
      console.warn(`[HolmanVerify] Fence release failed for ${vehicleNumber} (non-fatal):`, e?.message);
    }
  }

  // ─── Live-confirmed out-of-service cache mirror ──────────────────────────────
  // ONLY call this from points where LIVE Holman (custom-query) returned
  // statusCode=2 for this vehicle — never off a 202 submit response (queued ≠
  // applied) and never speculatively. The bulk sync writes the same fields on
  // its own; this just heals the cache row immediately at a live-confirmed
  // point so the card doesn't show "active" until the next sync.
  // Never throws — cache mirroring must not fail a successful verification.
  async mirrorVerifiedOutOfService(vehicleNumber: string, rawVehicle: any): Promise<void> {
    try {
      const canonical = (toCanonical(vehicleNumber) || '').trim();
      const oosDate = String(rawVehicle?.outOfServiceDate ?? '').trim() || null;
      const where = canonical
        ? sql`UPPER(LTRIM(TRIM(${holmanVehiclesCache.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()}`
        : eq(holmanVehiclesCache.holmanVehicleNumber, vehicleNumber);
      await db.update(holmanVehiclesCache)
        .set({ statusCode: 2, outOfServiceDate: oosDate, lastLocalUpdateAt: new Date() })
        .where(where);
      console.log(`[HolmanVerify] Cache mirrored out-of-service for ${vehicleNumber} (live-confirmed statusCode=2)`);
    } catch (e: any) {
      console.warn(`[HolmanVerify] OOS cache mirror failed for ${vehicleNumber} (non-fatal):`, e?.message);
    }
  }

  // ─── Vehicle-lookup verification (primary strategy) ──────────────────────────
  // Holman's batch submission API returns 202 Accepted (async queue).
  // There is no per-vehicle status endpoint.  Holman's basic-query GET does not
  // support filtering by holmanVehicleNumber, and custom-query POST does not
  // accept a "filters" body field.  Both return 400 for per-vehicle queries.
  //
  // Strategy: verify against fresh fleet data supplied by the full fleet sync
  // (verifyFromFleetData, called from holman-vehicle-sync-service after every
  // cache update).  This method is kept as a thin wrapper that marks expired
  // submissions failed and returns 'pending' otherwise.
  //
  // PERSISTENCE CONTRACT (settle-persistence gap): this method only
  // RETURNS a verdict — it never writes a terminal status itself. The only DB
  // writes here are 'pending' + lastObservedTech bookkeeping. Every caller
  // that receives newStatus='completed'/'failed' MUST persist it via
  // updateSubmissionStatus (and check the write landed), or the row stays
  // 'pending' forever: the 90s sweep re-verifies it every cycle and the
  // --report mode keeps reporting it as in-flight.
  async verifyByVehicleLookup(submission: HolmanSubmission): Promise<{
    verified: boolean;
    newStatus: 'completed' | 'failed' | 'pending';
    message: string;
    rawVehicle?: any;
  }> {
    const vehicleNumber = submission.holmanVehicleNumber;
    try {
      // Live Holman re-query FIRST (authoritative + immediate). Only confirms on a
      // positive match; on error or inconclusive result it falls through to the
      // cache-based check below. This stops good assigns/unassigns from timing out
      // into a false "failed" when no fleet sync happens to run in the window.
      if (submission.action === 'assign' || submission.action === 'unassign') {
        try {
          const live = await holmanApiService.getVehicleAssignedStatus(vehicleNumber);
          if (live.found) {
            const techInHolman = (live.techAssigned || '').trim();
            const expectedTech = (submission.enterpriseId || '').trim();
            if (submission.action === 'assign') {
              const cd = (live.assignedStatusCode || '').toUpperCase();
              if (expectedTech && cd !== 'U' && techInHolman.toLowerCase() === expectedTech.toLowerCase()) {
                const raw: any = live.rawVehicle;
                const liveName = raw?.firstName && raw?.lastName
                  ? `${raw.firstName} ${raw.lastName}`.trim()
                  : (raw?.driverName || null);
                await this.releaseSupersededFence(vehicleNumber, techInHolman, liveName, submission.createdAt);
                return { verified: true, newStatus: 'completed', message: `Confirmed assigned via live Holman (tech="${techInHolman}")`, rawVehicle: live.rawVehicle };
              }
            } else {
              const cd = (live.assignedStatusCode || '').toUpperCase();
              if (cd === 'U' || !techInHolman) {
                await this.releaseSupersededFence(vehicleNumber, null, null, submission.createdAt);
                return { verified: true, newStatus: 'completed', message: `Confirmed unassigned via live Holman (status=${live.assignedStatus})`, rawVehicle: live.rawVehicle };
              }
            }
          }
        } catch (liveErr: any) {
          console.warn(`[HolmanVerify] Live re-query failed for ${vehicleNumber}, falling back to cache:`, liveErr?.message);
        }
      }
      // Live re-query for out-of-service submissions: the lifecycle statusCode
      // in the custom-query response is authoritative. Only a positive
      // statusCode=2 confirms; on probe failure or a still-active status this
      // falls through to the cache-based check below (fed by fleet syncs).
      if (submission.action === 'out_of_service') {
        try {
          const live = await holmanApiService.lookupVehicleByNumberChecked(vehicleNumber);
          if (live.checked && live.found && live.vehicle) {
            const raw: any = live.vehicle;
            // Do NOT test statusCode alone: Holman nulls it once the vehicle
            // leaves the active projection, so an applied change reads as
            // "still active" and this sweep would never settle.
            if (isOutOfServiceRecord(raw)) {
              await this.mirrorVerifiedOutOfService(vehicleNumber, raw);
              const dateNote = raw.outOfServiceDate ? `, outOfServiceDate=${raw.outOfServiceDate}` : '';
              return { verified: true, newStatus: 'completed', message: `Confirmed out of service via live Holman (statusCode=${raw.statusCode ?? '—'}${dateNote})`, rawVehicle: raw };
            }
          }
        } catch (liveErr: any) {
          console.warn(`[HolmanVerify] Live OOS re-query failed for ${vehicleNumber}, falling back to cache:`, liveErr?.message);
        }
      }
      const [cached] = await db.select()
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, vehicleNumber))
        .limit(1);

      if (!cached || !cached.lastHolmanSyncAt) {
        console.log(`[HolmanVerify] Submission ${submission.id} for vehicle ${vehicleNumber} (${submission.action}) — no cached data, awaiting next fleet sync`);
        return { verified: false, newStatus: 'pending', message: 'No cached vehicle data — awaiting fleet sync' };
      }

      const submittedAt = submission.createdAt ? new Date(submission.createdAt).getTime() : 0;
      const syncedAt = new Date(cached.lastHolmanSyncAt).getTime();
      if (syncedAt < submittedAt) {
        console.log(`[HolmanVerify] Submission ${submission.id} for vehicle ${vehicleNumber} — cache is stale (synced ${new Date(syncedAt).toISOString()} < submitted ${new Date(submittedAt).toISOString()}), awaiting next sync`);
        return { verified: false, newStatus: 'pending', message: 'Cache predates submission — awaiting fresh fleet sync' };
      }

      const techInCache = (cached.holmanTechAssigned || '').trim();
      const expectedTech = (submission.enterpriseId || '').trim();
      const assignedStatusCd = (cached.holmanAssignedStatusCd || '').trim().toUpperCase();

      if (submission.action === 'unassign') {
        const success = assignedStatusCd === 'U' || techInCache === '';
        if (success) {
          console.log(`[HolmanVerify] Submission ${submission.id} — confirmed unassigned from cache (status=${assignedStatusCd}, tech="${techInCache}")`);
          // NOTE: no fence release here — a cache confirm can be the fence's
          // own pinned value reflected back (circular); only live-confirmed
          // points may release fences. The supersede sweep covers the rest.
          return { verified: true, newStatus: 'completed', message: `Confirmed unassigned via cache (status=${assignedStatusCd})`, rawVehicle: cached };
        }
        console.log(`[HolmanVerify] Submission ${submission.id} — cache still shows assigned (status=${assignedStatusCd}, tech="${techInCache}"), pending`);
        return { verified: false, newStatus: 'pending', message: `Cache shows status=${assignedStatusCd}, tech="${techInCache}" — not yet unassigned` };
      }

      if (submission.action === 'assign') {
        const techMatch = !!(expectedTech && techInCache.toLowerCase().includes(expectedTech.toLowerCase()));
        if (techMatch) {
          console.log(`[HolmanVerify] Submission ${submission.id} — confirmed assigned from cache (tech="${techInCache}" matches "${expectedTech}")`);
          // NOTE: no fence release here — cache confirm is circular evidence
          // (the fence pins the cache); only live-confirmed points release.
          return { verified: true, newStatus: 'completed', message: `Confirmed assigned via cache (tech="${techInCache}")`, rawVehicle: cached };
        }
        if (techInCache && expectedTech) {
          await this.updateSubmissionStatus(submission.id, 'pending', undefined, techInCache);
        }
        console.log(`[HolmanVerify] Submission ${submission.id} — cache tech="${techInCache}" doesn't match expected="${expectedTech}", pending`);
        return { verified: false, newStatus: 'pending', message: `Cache tech="${techInCache}", expected="${expectedTech}" — not yet matched` };
      }

      if (submission.action === 'district') {
        const target = this.normalizePrefix((submission.payload as any)?.targetPrefix ?? (submission.payload as any)?.prefix);
        if (!target) {
          return { verified: false, newStatus: 'pending', message: 'District submission missing target prefix — cannot verify' };
        }
        const current = this.normalizePrefix(cached.district);
        if (current && current === target) {
          console.log(`[HolmanVerify] Submission ${submission.id} — confirmed district ${target} from cache`);
          return { verified: true, newStatus: 'completed', message: `Confirmed district ${target} via cache`, rawVehicle: cached };
        }
        return { verified: false, newStatus: 'pending', message: `Cache district="${cached.district ?? ''}" (last4=${current || '—'}), expected "${target}" — not yet applied` };
      }

      if (submission.action === 'out_of_service') {
        // Cache row is post-submission (stale-cache guard above) so its
        // statusCode reflects a fleet sync that ran AFTER the submit.
        const cachedStatus = cached.statusCode == null ? null : Number(cached.statusCode);
        if (isOutOfServiceRecord(cached)) {
          console.log(`[HolmanVerify] Submission ${submission.id} — confirmed out of service from cache`);
          return { verified: true, newStatus: 'completed', message: 'Confirmed out of service via cache', rawVehicle: cached };
        }
        return { verified: false, newStatus: 'pending', message: `Cache shows statusCode=${cachedStatus ?? '—'} — not yet out of service` };
      }

      return { verified: false, newStatus: 'pending', message: 'Awaiting fleet sync for verification' };
    } catch (err: any) {
      console.warn(`[HolmanVerify] Cache lookup failed for ${vehicleNumber}:`, err.message);
      return { verified: false, newStatus: 'pending', message: `Cache lookup error: ${err.message}` };
    }
  }

  // ─── Passive verification from fleet sync data ────────────────────────────
  // Called by holman-vehicle-sync-service after every full or incremental sync.
  // holmanVehicles is the raw Holman API data for all fetched vehicles.
  async verifyFromFleetData(holmanVehicles: any[]): Promise<void> {
    const pending = await this.getAllPendingSubmissions();
    if (pending.length === 0) return;

    // Build a fast lookup map keyed by the vehicle number. Use the SAME fallback
    // chain the cache writer uses (holmanVehicleNumber || clientVehicleNumber ||
    // vehicleNumber) so the key here matches the key a submission was stored under
    // (submission.holmanVehicleNumber == the cache row key). If we only keyed by
    // holmanVehicleNumber, a vehicle Holman returns under a fallback field would
    // never be found and its pending submission could never be verified.
    const vehicleMap = new Map<string, any>();
    for (const v of holmanVehicles) {
      const num = (v.holmanVehicleNumber || v.clientVehicleNumber || v.vehicleNumber || '').toString().trim();
      if (num) vehicleMap.set(num, v);
    }

    for (const submission of pending) {
      const vehicleNumber = submission.holmanVehicleNumber;
      const vehicle = vehicleMap.get(vehicleNumber);
      if (!vehicle) continue; // vehicle not in this sync batch — skip

      const action = submission.action;
      const assignedStatus = (vehicle.assignedStatus || '').toLowerCase();
      const techInHolman = (vehicle.clientData2 || vehicle.firstName || '').trim();
      const expectedTech = (submission.enterpriseId || '').trim();

      let success = false;
      let message = '';

      if (action === 'unassign') {
        success = assignedStatus.includes('unassign') || techInHolman === '';
        message = success
          ? `Confirmed unassigned via fleet sync (assignedStatus="${vehicle.assignedStatus}")`
          : `Fleet sync shows "${vehicle.assignedStatus}" — Holman may still be processing`;
      } else if (action === 'assign') {
        const techMatch = !!(expectedTech && techInHolman.toLowerCase().includes(expectedTech.toLowerCase()));
        const isAssigned = assignedStatus.includes('assign') && !assignedStatus.includes('unassign');
        success = techMatch;
        if (techMatch) {
          message = `Confirmed assigned via fleet sync (assignedStatus="${vehicle.assignedStatus}", tech="${techInHolman}")`;
        } else if (expectedTech && techInHolman && !techMatch) {
          // Tech is present in Holman but doesn't match — warn regardless of assignedStatus string
          const statusContext = isAssigned ? 'vehicle is "Assigned"' : `assignedStatus="${vehicle.assignedStatus}"`;
          console.warn(`[HolmanVerify] Submission ${submission.id} (vehicle ${vehicleNumber}): ${statusContext} but tech mismatch — expected="${expectedTech}", actual="${techInHolman}". Leaving pending until timeout.`);
          message = `Fleet sync shows ${statusContext} but tech is "${techInHolman}", expected "${expectedTech}" — Holman may not have applied the change`;
        } else {
          message = `Fleet sync shows "${vehicle.assignedStatus}" (tech="${techInHolman}") — Holman may still be processing`;
        }
      } else if (action === 'district') {
        const target = this.normalizePrefix((submission.payload as any)?.targetPrefix ?? (submission.payload as any)?.prefix);
        const currentPrefix = this.normalizePrefix(vehicle.prefix ?? vehicle.district);
        success = !!target && currentPrefix === target;
        message = success
          ? `Confirmed district ${target} via fleet sync (Holman prefix="${vehicle.prefix ?? ''}")`
          : `Fleet sync shows Holman prefix="${vehicle.prefix ?? ''}" (last4=${currentPrefix || '—'}), expected "${target || '—'}" — Holman may not have applied the change`;
      } else if (action === 'out_of_service') {
        // The full sync fetches statusCodes 0,1,2 so an OOS truck stays in the
        // batch. Success is the durable outOfServiceDate signal, NOT statusCode
        // alone — Holman nulls statusCode once the vehicle leaves the active
        // projection. The sync writes statusCode/outOfServiceDate to the cache
        // row, so no extra cache mirror is needed here.
        const liveStatusCode = Number(vehicle.statusCode ?? vehicle.status_code);
        success = isOutOfServiceRecord(vehicle);
        message = success
          ? `Confirmed out of service via fleet sync (outOfServiceDate=${(vehicle as any).outOfServiceDate ?? '—'})`
          : `Fleet sync shows statusCode=${Number.isFinite(liveStatusCode) ? liveStatusCode : '—'} — Holman may still be processing`;
      } else {
        // field_test or other — just finding the vehicle is enough
        success = true;
        message = `Vehicle found in fleet sync, action "${action}" not directly verifiable`;
      }

      if (success) {
        console.log(`[HolmanVerify] Fleet sync verified submission ${submission.id} (vehicle ${vehicleNumber}, ${action}): ${message}`);
        const persisted = await this.updateSubmissionStatus(submission.id, 'completed');
        if (!persisted || persisted.status !== 'completed') {
          console.error(`[HolmanVerify] SETTLE NOT PERSISTED: submission ${submission.id} (vehicle ${vehicleNumber}, ${action}) verified completed by fleet sync but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified by the next sweep`);
        }
        await this.propagateStatusToFleetLog(submission, 'completed', message);
        // District changes are confirmed here (raw Holman prefix is the source of
        // truth). The fleet sync freezes cache.district on conflict, so this is the
        // only place the card's district is updated for a Nexus-initiated change.
        if (action === 'district') {
          const confirmedPrefix = String(vehicle.prefix ?? vehicle.district ?? '').trim();
          if (confirmedPrefix) {
            try {
              await db.update(holmanVehiclesCache)
                .set({ district: confirmedPrefix, lastLocalUpdateAt: new Date() })
                .where(eq(holmanVehiclesCache.holmanVehicleNumber, submission.holmanVehicleNumber));
            } catch (cacheErr: any) {
              console.warn(`[HolmanVerify] Failed to update cache district for ${vehicleNumber}:`, cacheErr.message);
            }
          }
        }
      } else {
        // INTENTIONALLY left 'pending': a not-yet-confirmed verdict is
        // non-terminal — Holman applies queued records in nightly batch
        // windows, so "not applied yet" must never settle the row. The only
        // write here is lastObservedTech bookkeeping (assign only) so
        // timeout/expiry messages can include actual vs expected.
        console.log(`[HolmanVerify] Fleet sync: submission ${submission.id} not yet confirmed: ${message}`);
        if (action === 'assign' && techInHolman) {
          await this.updateSubmissionStatus(submission.id, 'pending', null, techInHolman);
        }
      }
    }
  }

  async resetForReverification(id: string): Promise<void> {
    await db.update(holmanSubmissions)
      .set({
        status: 'pending',
        errorMessage: null,
        completedAt: null,
        lastCheckedAt: null,
        createdAt: new Date(),
      })
      .where(eq(holmanSubmissions.id, id));
    console.log(`[HolmanVerify] Reset submission ${id} for re-verification with fresh timestamp`);
  }

  async propagateStatusToFleetLog(
    submission: HolmanSubmission,
    finalStatus: 'completed' | 'failed',
    message: string
  ): Promise<void> {
    try {
      const vehicleNumber = submission.holmanVehicleNumber;
      const action = submission.action;
      const opType = action === 'assign' || action === 'unassign' || action === 'out_of_service' ? action : null;
      if (!opType) return;

      const submissionCreatedAt = submission.createdAt ? new Date(submission.createdAt) : null;
      const searchWindow = 60 * 60 * 1000; // 1 hour window around submission creation

      const findMatchingLog = async (truckNum: string) => {
        const candidates = await db.select()
          .from(fleetOperationLog)
          .where(and(
            eq(fleetOperationLog.truckNumber, truckNum),
            eq(fleetOperationLog.operationType, opType),
            eq(fleetOperationLog.holmanStatus, 'pending'),
          ))
          .orderBy(desc(fleetOperationLog.createdAt))
          .limit(5);

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        if (submissionCreatedAt) {
          const closest = candidates.reduce((best, log) => {
            const logTime = new Date(log.createdAt).getTime();
            const subTime = submissionCreatedAt.getTime();
            const bestTime = new Date(best.createdAt).getTime();
            return Math.abs(logTime - subTime) < Math.abs(bestTime - subTime) ? log : best;
          });
          const timeDiff = Math.abs(new Date(closest.createdAt).getTime() - submissionCreatedAt.getTime());
          if (timeDiff <= searchWindow) return closest;
        }

        return candidates[0];
      };

      const log = await findMatchingLog(vehicleNumber);

      if (!log) {
        console.log(`[HolmanVerify] No pending fleet_operation_log found for vehicle ${vehicleNumber} / ${opType}`);
        return;
      }

      const holmanStatus = finalStatus === 'completed' ? 'success' : 'failed';
      await db.update(fleetOperationLog)
        .set({
          holmanStatus,
          holmanMessage: message,
          completedAt: new Date(),
        })
        .where(eq(fleetOperationLog.id, log.id));

      console.log(`[HolmanVerify] Updated fleet_operation_log #${log.id} → holmanStatus=${holmanStatus}`);
    } catch (err: any) {
      console.error(`[HolmanVerify] Failed to propagate status to fleet_operation_log:`, err.message);
    }
  }

  scheduleVerification(
    submissionId: string,
    delayMs: number = 60_000,
    maxAttempts: number = 5
  ): void {
    const getExpiryTimes = async () => {
      const submission = await this.getSubmissionById(submissionId);
      const createdAtMs = submission?.createdAt
        ? new Date(submission.createdAt).getTime()
        : Date.now();
      const expiryAt = createdAtMs + expiryMsForAction(submission?.action);
      const preExpiryAt = expiryAt - PRE_EXPIRY_BUFFER_MS;
      const postExpiryAt = expiryAt + POST_EXPIRY_BUFFER_MS;
      return { createdAtMs, expiryAt, preExpiryAt, postExpiryAt };
    };

    let preExpiryScheduled = false;
    let postExpiryScheduled = false;

    const isSettled = async (): Promise<boolean> => {
      const submission = await this.getSubmissionById(submissionId);
      if (!submission) return true;
      return submission.status === 'completed' || submission.status === 'failed';
    };

    const settleSubmission = async (
      finalStatus: 'completed' | 'failed',
      message: string
    ) => {
      if (finalStatus === 'completed') {
        // Persist the settle — without this the row stays 'pending' until the
        // next fleet sync re-confirms it (verifyFromFleetData was the only
        // path that wrote status='completed'), so the 90s sweep would keep
        // re-verifying an already-confirmed submission.
        const persisted = await this.updateSubmissionStatus(submissionId, 'completed');
        if (!persisted || persisted.status !== 'completed') {
          console.error(`[HolmanVerify] SETTLE NOT PERSISTED: submission ${submissionId} verified completed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified by the next sweep`);
        }
        const submission = await this.getSubmissionById(submissionId);
        if (submission) await this.propagateStatusToFleetLog(submission, 'completed', message);
      } else {
        const persisted = await this.updateSubmissionStatus(submissionId, 'failed', message);
        if (!persisted || persisted.status !== 'failed') {
          console.error(`[HolmanVerify] SETTLE NOT PERSISTED: submission ${submissionId} settled failed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified by the next sweep`);
        }
        const submission = await this.getSubmissionById(submissionId);
        if (submission) await this.propagateStatusToFleetLog(submission, 'failed', message);
      }
    };

    const pollingAttempt = async (attemptsLeft: number, currentDelay: number) => {
      try {
        if (await isSettled()) return;
        const { preExpiryAt } = await getExpiryTimes();
        const now = Date.now();

        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        const { newStatus, message } = await this.verifyByVehicleLookup(submission);
        console.log(`[HolmanVerify] ${submissionId} → ${newStatus}: ${message} (${attemptsLeft - 1} polling attempts left)`);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
          return;
        }

        if (attemptsLeft > 1 && now < preExpiryAt) {
          const nextDelay = Math.min(currentDelay * 1.5, 150_000);
          const timeToPreExpiry = preExpiryAt - Date.now();
          const effectiveDelay = Math.min(nextDelay, Math.max(timeToPreExpiry - 5000, 10_000));
          setTimeout(() => pollingAttempt(attemptsLeft - 1, nextDelay), effectiveDelay);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Polling error for ${submissionId}:`, err.message);
        if (attemptsLeft > 1) {
          setTimeout(() => pollingAttempt(attemptsLeft - 1, 30_000), 30_000);
        }
      }
    };

    const preExpiryCheck = async () => {
      try {
        if (await isSettled()) return;
        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        console.log(`[HolmanVerify] Pre-expiry check for ${submissionId}`);
        const { newStatus, message } = await this.verifyByVehicleLookup(submission);
        console.log(`[HolmanVerify] Pre-expiry ${submissionId} → ${newStatus}: ${message}`);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Pre-expiry error for ${submissionId}:`, err.message);
      }
    };

    const postExpiryCheck = async () => {
      try {
        if (await isSettled()) return;
        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        console.log(`[HolmanVerify] Post-expiry definitive check for ${submissionId}`);
        const { newStatus, message } = await this.verifyByVehicleLookup(submission);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
        } else {
          let techDetail = '';
          if (submission.action === 'assign' && submission.enterpriseId) {
            techDetail = ` Expected tech: "${submission.enterpriseId}"`;
            if (submission.lastObservedTech) {
              techDetail += `, last observed in Holman: "${submission.lastObservedTech}"`;
            }
            techDetail += '.';
          }
          const failMsg = `Verification expired after ${Math.round(expiryMsForAction(submission.action) / 60000)} minutes.${techDetail} Last: ${message}`;
          console.error(`[HolmanVerify] Submission ${submissionId} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) expired without confirmation.${techDetail}`);
          await settleSubmission('failed', failMsg);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Post-expiry error for ${submissionId}:`, err.message);
        const failMsg = `Post-expiry check failed: ${err.message}`;
        await settleSubmission('failed', failMsg);
      }
    };

    const scheduleAll = async () => {
      const { preExpiryAt, postExpiryAt } = await getExpiryTimes();
      const now = Date.now();

      if (!preExpiryScheduled) {
        const delayToPreExpiry = Math.max(preExpiryAt - now, 1000);
        console.log(`[HolmanVerify] Scheduling pre-expiry check for ${submissionId} in ${Math.round(delayToPreExpiry / 1000)}s`);
        setTimeout(preExpiryCheck, delayToPreExpiry);
        preExpiryScheduled = true;
      }

      if (!postExpiryScheduled) {
        const delayToPostExpiry = Math.max(postExpiryAt - now, 1000);
        console.log(`[HolmanVerify] Scheduling post-expiry check for ${submissionId} in ${Math.round(delayToPostExpiry / 1000)}s`);
        setTimeout(postExpiryCheck, delayToPostExpiry);
        postExpiryScheduled = true;
      }

      setTimeout(() => pollingAttempt(maxAttempts, delayMs), delayMs);
    };

    console.log(`[HolmanVerify] Scheduling verification for ${submissionId} in ${delayMs}ms (expiry window is action-dependent; see scheduleAll)`);
    scheduleAll();
  }

  // Legacy: check via Holman status API (kept for field_test submissions)
  async checkSubmissionStatus(submission: HolmanSubmission): Promise<{
    checked: boolean;
    newStatus?: 'processing' | 'completed' | 'failed';
    message?: string;
  }> {
    if (!submission.submissionId) {
      await this.updateSubmissionStatus(submission.id, 'completed');
      return { checked: true, newStatus: 'completed', message: 'No submission ID' };
    }
    // For assign/unassign use vehicle lookup; for field_test keep legacy path
    if (submission.action === 'assign' || submission.action === 'unassign' || submission.action === 'district' || submission.action === 'out_of_service') {
      const r = await this.verifyByVehicleLookup(submission);
      // Persist terminal verdicts HERE (settle-persistence gap): this entry
      // point used to return the verdict without writing it, so a caller that
      // didn't persist left the row 'pending' and every 90s sweep re-verified
      // an already-confirmed submission. Idempotent with the sweep's persist.
      if (r.newStatus === 'completed' || r.newStatus === 'failed') {
        const persisted = await this.updateSubmissionStatus(submission.id, r.newStatus, r.newStatus === 'failed' ? r.message : undefined);
        if (!persisted || persisted.status !== r.newStatus) {
          console.error(`[HolmanVerify] SETTLE NOT PERSISTED: submission ${submission.id} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) verified ${r.newStatus} via checkSubmissionStatus but DB row reads '${persisted?.status ?? 'row missing'}'`);
        }
        await this.propagateStatusToFleetLog(submission, r.newStatus, r.message);
      }
      return { checked: r.verified, newStatus: r.newStatus === 'pending' ? 'processing' : r.newStatus, message: r.message };
    }
    // Legacy status-API path for field_test
    try {
      const result = await holmanApiService.getSubmissionStatus(submission.submissionId);
      if (!result.success) return { checked: false, message: result.error };
      const s = result.status?.toLowerCase() || '';
      if (s.includes('complet') || s.includes('success') || s.includes('process')) {
        await this.updateSubmissionStatus(submission.id, 'completed');
        return { checked: true, newStatus: 'completed', message: result.message };
      }
      if (s.includes('fail') || s.includes('error') || s.includes('reject')) {
        await this.updateSubmissionStatus(submission.id, 'failed', result.message);
        return { checked: true, newStatus: 'failed', message: result.message };
      }
      return { checked: true, newStatus: 'processing', message: 'Still processing' };
    } catch {
      return { checked: false, message: 'Status API unavailable' };
    }
  }

  // Poll stale pending submissions (called by scheduler every 90s)
  // Now also handles expiry: submissions older than HOLMAN_SUBMISSION_EXPIRY_MS
  // get a definitive check and are settled as completed or failed.
  async pollPendingSubmissions(): Promise<{ checked: number; completed: number; failed: number; stillPending: number }> {
    const pending = await this.getAllPendingSubmissions();
    if (pending.length === 0) {
      return { checked: 0, completed: 0, failed: 0, stillPending: 0 };
    }
    console.log(`[HolmanSubmission] Polling ${pending.length} pending submissions`);

    let completed = 0;
    let failed = 0;
    let stillPending = 0;

    for (const submission of pending) {
      const ageMs = Date.now() - new Date(submission.createdAt!).getTime();
      if (ageMs < 45_000) { stillPending++; continue; }

      const { newStatus, message } = await this.verifyByVehicleLookup(submission);

      if (newStatus === 'completed') {
        completed++;
        // Persist the settle (see settleSubmission) — otherwise the row stays
        // 'pending' and every subsequent sweep re-verifies it. Read back the
        // persist result so a silently-missing write is loud in the sweep log.
        const persisted = await this.updateSubmissionStatus(submission.id, 'completed');
        if (!persisted || persisted.status !== 'completed') {
          console.error(`[HolmanSubmission] SETTLE NOT PERSISTED: submission ${submission.id} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) verified completed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified next sweep`);
        }
        await this.propagateStatusToFleetLog(submission, 'completed', message);
      } else if (newStatus === 'failed') {
        // verifyByVehicleLookup currently never returns 'failed', but its
        // return type allows it — settle defensively so a future verifier
        // change can't reopen the silent-stall gap (an unpersisted 'failed'
        // verdict would previously have been counted as stillPending).
        failed++;
        const persisted = await this.updateSubmissionStatus(submission.id, 'failed', message);
        if (!persisted || persisted.status !== 'failed') {
          console.error(`[HolmanSubmission] SETTLE NOT PERSISTED: submission ${submission.id} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) verified failed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified next sweep`);
        }
        await this.propagateStatusToFleetLog(submission, 'failed', message);
      } else if (oosVerificationExpired(ageMs, expiryMsForAction(submission.action), POST_EXPIRY_BUFFER_MS)) {
        let techDetail = '';
        if (submission.action === 'assign' && submission.enterpriseId) {
          techDetail = ` Expected tech: "${submission.enterpriseId}"`;
          if (submission.lastObservedTech) {
            techDetail += `, last observed in Holman: "${submission.lastObservedTech}"`;
          }
          techDetail += '.';
        }
        const failMsg = `Verification expired after ${Math.round(ageMs / 60000)} minutes.${techDetail} Last: ${message}`;
        console.error(`[HolmanVerify] Submission ${submission.id} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) expired without confirmation.${techDetail}`);
        const persisted = await this.updateSubmissionStatus(submission.id, 'failed', failMsg);
        if (!persisted || persisted.status !== 'failed') {
          console.error(`[HolmanSubmission] SETTLE NOT PERSISTED: submission ${submission.id} (vehicle ${submission.holmanVehicleNumber}, ${submission.action}) expired-failed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified next sweep`);
        }
        await this.propagateStatusToFleetLog(submission, 'failed', failMsg);
        failed++;
      } else {
        stillPending++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[HolmanSubmission] Poll done: ${completed} completed, ${failed} failed, ${stillPending} still pending`);
    return { checked: pending.length, completed, failed, stillPending };
  }

  async markAsCompleted(holmanVehicleNumber: string): Promise<number> {
    const pending = await this.getPendingSubmissionsForVehicle(holmanVehicleNumber);
    let count = 0;
    
    for (const sub of pending) {
      await this.updateSubmissionStatus(sub.id, 'completed');
      count++;
    }
    
    return count;
  }

  async getAllSubmissions(filters?: {
    status?: string;
    action?: string;
    vehicleNumber?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<(HolmanSubmission & { durationMs?: number | null })[]> {
    const conditions = [];
    
    if (filters?.status && filters.status !== 'all') {
      conditions.push(eq(holmanSubmissions.status, filters.status));
    }
    
    if (filters?.action && filters.action !== 'all') {
      conditions.push(eq(holmanSubmissions.action, filters.action));
    }
    
    if (filters?.vehicleNumber) {
      conditions.push(like(holmanSubmissions.holmanVehicleNumber, `%${filters.vehicleNumber}%`));
    }
    
    if (filters?.startDate) {
      conditions.push(gte(holmanSubmissions.createdAt, filters.startDate));
    }
    
    if (filters?.endDate) {
      conditions.push(lte(holmanSubmissions.createdAt, filters.endDate));
    }
    
    const query = db.select()
      .from(holmanSubmissions)
      .orderBy(desc(holmanSubmissions.createdAt));
    
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    
    const results = await query;
    
    return results.map(sub => ({
      ...sub,
      durationMs: sub.completedAt && sub.createdAt 
        ? new Date(sub.completedAt).getTime() - new Date(sub.createdAt).getTime()
        : null,
    }));
  }
}

export const holmanSubmissionService = new HolmanSubmissionService();

// One-time backfill: re-verify the stuck Mar 6 submission 4f59f66f and fleet_operation_log id=7
(async () => {
  const STUCK_SUBMISSION_PREFIX = '4f59f66f';
  const STUCK_FLEET_LOG_ID = 7;
  try {
    await new Promise(r => setTimeout(r, 15_000));

    const results = await db.select()
      .from(holmanSubmissions)
      .where(like(holmanSubmissions.id, `${STUCK_SUBMISSION_PREFIX}%`))
      .limit(1);

    if (results.length === 0) {
      console.log(`[HolmanBackfill] Submission ${STUCK_SUBMISSION_PREFIX}* not found, skipping backfill`);
      return;
    }

    const submission = results[0];
    if (submission.status === 'completed') {
      console.log(`[HolmanBackfill] Submission ${submission.id} already completed, skipping`);
      return;
    }

    console.log(`[HolmanBackfill] Re-verifying stuck submission ${submission.id} (vehicle ${submission.holmanVehicleNumber})`);
    const verifyResult = await holmanSubmissionService.verifyByVehicleLookup(submission);
    console.log(`[HolmanBackfill] Result: ${verifyResult.newStatus} - ${verifyResult.message}`);

    if (verifyResult.newStatus === 'completed') {
      // Persist the submission settle too (settle-persistence gap): this
      // backfill previously updated only the fleet log, leaving the
      // holman_submissions row 'pending' — so every 90s sweep re-verified it.
      // Read back the persist result so a write that lands nowhere is loud
      // BEFORE the fleet log is marked terminal (same check as the sweep).
      const persisted = await holmanSubmissionService.updateSubmissionStatus(submission.id, 'completed');
      if (!persisted || persisted.status !== 'completed') {
        console.error(`[HolmanBackfill] SETTLE NOT PERSISTED: submission ${submission.id} verified completed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified by the next sweep`);
      }
      await holmanSubmissionService.propagateStatusToFleetLog(submission, 'completed', verifyResult.message);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'success',
        holmanMessage: `Backfill: ${verifyResult.message}`,
      });
      console.log(`[HolmanBackfill] Fixed fleet_operation_log #${STUCK_FLEET_LOG_ID} → success`);
    } else if (verifyResult.newStatus === 'failed') {
      // Same gap on the failed branch: settle the submission row itself and
      // verify the write landed before touching the fleet log.
      const persisted = await holmanSubmissionService.updateSubmissionStatus(submission.id, 'failed', `Backfill: ${verifyResult.message}`);
      if (!persisted || persisted.status !== 'failed') {
        console.error(`[HolmanBackfill] SETTLE NOT PERSISTED: submission ${submission.id} settled failed but DB row reads '${persisted?.status ?? 'row missing'}' — it will be re-verified by the next sweep`);
      }
      await holmanSubmissionService.propagateStatusToFleetLog(submission, 'failed', verifyResult.message);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'failed',
        holmanMessage: `Backfill: ${verifyResult.message}`,
      });
      console.log(`[HolmanBackfill] Fixed fleet_operation_log #${STUCK_FLEET_LOG_ID} → failed`);
    } else {
      const failMsg = `Backfill: Vehicle still pending after re-check. ${verifyResult.message}`;
      await holmanSubmissionService.updateSubmissionStatus(submission.id, 'failed', failMsg);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'failed',
        holmanMessage: failMsg,
      });
      console.log(`[HolmanBackfill] Settled stuck submission as failed and updated fleet_operation_log #${STUCK_FLEET_LOG_ID}`);
    }
  } catch (err: any) {
    console.error(`[HolmanBackfill] Error during backfill:`, err.message);
  }
})();
