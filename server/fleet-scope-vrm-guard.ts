/**
 * VRM rental-state ownership guard (2026-08-04 directive).
 *
 * VRM Rental Operations is the authority for rental/repair status and call
 * fields; Fleet Scope is a downstream mirror. No user-facing Fleet Scope
 * route may originate or change these fields — updates 403 on a real change
 * (unchanged re-sends are stripped silently), and creates are force-
 * initialized to a neutral status that VRM's reconcile adopts as the opening
 * history row once a rental case exists.
 *
 * Kept dependency-free so unit tests can import it without dragging in the
 * route registry, storage, or a database connection.
 */

export const VRM_OWNED_FIELDS = [
  "mainStatus",
  "subStatus",
  "lastCallStatus",
  "lastCallSummary",
  "lastCallDate",
  "lastCallConversationId",
  "eta",
  "repairPhone",
  // Tech-pickup date — set via the VRM Ops Queue schedule_pickup action and
  // mirrored to fs_trucks.scheduled_pickup_date. FS never originates it.
  "scheduledPickupDate",
] as const;

export type VrmOwnedField = (typeof VRM_OWNED_FIELDS)[number];

/**
 * Every user-facing Fleet Scope create lands with this status — the canonical
 * vocabulary's neutral entry state ("we have the truck, status not yet
 * confirmed"). NOTE: the old create-form default "Research required" was
 * never a valid MAIN_STATUSES member (hidden behind an `as` cast); creates
 * relying on it failed schema validation. Real rental state is set in VRM.
 */
export const FS_CREATE_INITIAL_STATUS = {
  mainStatus: "Confirming Status",
  subStatus: null,
} as const;

/** Normalize for change comparison: undefined/null/"" equivalent, Dates ISO. */
export function normalizeOwnedValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/**
 * Which VRM-owned fields does `incoming` actually CHANGE relative to
 * `existing`? Fields that are absent, or re-sent with an equivalent value,
 * do not count (full-form PUTs historically re-send current values).
 */
export function findChangedOwnedFields(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): VrmOwnedField[] {
  return VRM_OWNED_FIELDS.filter(
    (f) =>
      incoming[f] !== undefined &&
      normalizeOwnedValue(incoming[f]) !== normalizeOwnedValue(existing[f]),
  );
}

/** Delete every VRM-owned key from a payload (mutating update-path strip). */
export function stripOwnedFields(payload: Record<string, unknown>): void {
  for (const f of VRM_OWNED_FIELDS) {
    if (payload[f] !== undefined) delete payload[f];
  }
}

/**
 * Sanitize a user-facing CREATE body before schema validation: any supplied
 * VRM-owned field is discarded and the truck is force-initialized to
 * FS_CREATE_INITIAL_STATUS. Returns the sanitized copy plus which owned
 * fields the caller attempted to set (for logging/response transparency).
 */
export function sanitizeCreatePayload<T extends Record<string, unknown>>(
  body: T,
): { sanitized: Record<string, unknown>; discarded: VrmOwnedField[] } {
  const discarded = VRM_OWNED_FIELDS.filter((f) => {
    const v = (body as Record<string, unknown>)[f];
    if (v === undefined || v === null) return false;
    if (f === "mainStatus" && v === FS_CREATE_INITIAL_STATUS.mainStatus) return false;
    return normalizeOwnedValue(v) !== "";
  });
  const sanitized: Record<string, unknown> = { ...body };
  for (const f of VRM_OWNED_FIELDS) delete sanitized[f];
  sanitized.mainStatus = FS_CREATE_INITIAL_STATUS.mainStatus;
  sanitized.subStatus = FS_CREATE_INITIAL_STATUS.subStatus;
  return { sanitized, discarded };
}
