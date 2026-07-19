// client/src/hooks/use-pending-assign.ts
// Client-side pending-assign indicator (Tyler 2026-07-18: "it takes a second...
// there needs to be a pending indicator with the truck number that's pending,
// stored locally on this side"). The real assignTech call takes a few seconds
// (TPMS + Holman + AMS awaited before the route returns); this shows the
// in-flight truck number the instant the write starts, survives reload via
// localStorage, and expires on the same 2-minute TTL as the server-side
// acquireVehicleLock so a lost request never shows "pending" forever.
import { useSyncExternalStore } from "react";

const PENDING_KEY = "nexus_weekly_onboarding_pending_assign_v1";
const PENDING_TTL_MS = 2 * 60 * 1000; // matches the server truck lock acquireVehicleLock's 2-min TTL

export type PendingAssignEntry = { tn: string; startedAt: number };
type PendingAssignMap = Record<string, PendingAssignEntry>;

function readRaw(): PendingAssignMap {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}"); } catch { return {}; }
}
function writeRaw(map: PendingAssignMap) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)); } catch { /* storage unavailable; degrades to in-memory only */ }
}
export function pruneExpiredPendingAssigns(map: PendingAssignMap): PendingAssignMap {
  const now = Date.now();
  const out: PendingAssignMap = {};
  for (const [id, entry] of Object.entries(map)) {
    if (now - entry.startedAt <= PENDING_TTL_MS) out[id] = entry;
  }
  return out;
}

const listeners = new Set<() => void>();
function emitChange() { listeners.forEach((l) => l()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

// useSyncExternalStore requires a STABLE snapshot between store changes, so we
// cache the last computed snapshot and only recompute after a write (or on the
// first read). Recomputing fresh objects every call would infinite-loop React.
let snapshotCache: PendingAssignMap | null = null;
function getSnapshot(): PendingAssignMap {
  if (snapshotCache === null) snapshotCache = pruneExpiredPendingAssigns(readRaw());
  return snapshotCache;
}
function invalidateSnapshot() { snapshotCache = null; emitChange(); }

export function setPendingAssign(hireId: string, truckNumber: string) {
  const map = pruneExpiredPendingAssigns(readRaw());
  map[hireId] = { tn: truckNumber, startedAt: Date.now() };
  writeRaw(map);
  invalidateSnapshot();
}
export function clearPendingAssign(hireId: string) {
  const map = pruneExpiredPendingAssigns(readRaw());
  delete map[hireId];
  writeRaw(map);
  invalidateSnapshot();
}
export function usePendingAssignMap(): PendingAssignMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
export function usePendingAssign(hireId: string | null | undefined): PendingAssignEntry | null {
  const map = usePendingAssignMap();
  return hireId ? map[hireId] ?? null : null;
}
