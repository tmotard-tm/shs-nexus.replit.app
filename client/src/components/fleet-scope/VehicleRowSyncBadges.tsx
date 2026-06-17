import { useQuery } from "@tanstack/react-query";
import { SystemSyncBadges } from "./SystemSyncBadges";

interface RecentOpData {
  id: number;
  operationType: string;
  tpmsStatus?: string;
  holmanStatus?: string;
  amsStatus?: string;
  createdAt?: string;
}

interface VehicleRowSyncBadgesProps {
  truckNumber: string;
  tpmsAssignedTechId?: string | null;
  holmanTechAssigned?: string | null;
  onOpenHistory: () => void;
}

// A change is considered "in flight" for up to 30 min after the operation that
// triggered it, covering Holman's ~5-7 min async apply plus sync lag.
const IN_FLIGHT_MS = 30 * 60 * 1000;

/**
 * Per-system sync indicator for a fleet card row.
 *
 * The color reflects the CURRENT sync STATE between TPMS and Holman, not the
 * outcome of the last operation:
 *   green check = TPMS tech matches Holman tech (properly synced)
 *   red X       = they disagree (a real mismatch, e.g. assigned in Holman but
 *                 not in TPMS)
 *   amber clock = a change is still in flight (recent pending operation)
 *   (hidden)    = nothing assigned in either system, nothing to sync
 *
 * recent-op is fetched ONLY to detect the in-flight window, so a freshly-changed
 * truck shows "in progress" instead of a false mismatch X while it settles.
 */
export function VehicleRowSyncBadges({
  truckNumber,
  tpmsAssignedTechId,
  holmanTechAssigned,
  onOpenHistory,
}: VehicleRowSyncBadgesProps) {
  const { data: recentOp } = useQuery<RecentOpData | null>({
    queryKey: ["/api/fleet-ops/recent-op", truckNumber],
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/recent-op/${encodeURIComponent(truckNumber)}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch recent op");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const tpmsId = (tpmsAssignedTechId ?? "").trim();
  const holmanId = (holmanTechAssigned ?? "").trim();

  // Nothing assigned in either system → nothing to sync, render nothing.
  if (!tpmsId && !holmanId) return null;

  const synced = !!tpmsId && !!holmanId && tpmsId.toLowerCase() === holmanId.toLowerCase();

  const inFlight =
    !synced &&
    !!recentOp?.createdAt &&
    Date.now() - new Date(recentOp.createdAt).getTime() < IN_FLIGHT_MS &&
    (recentOp.holmanStatus === "pending" || recentOp.tpmsStatus === "pending");

  // success → green check, pending → amber clock, failed → red X.
  const status = synced ? "success" : inFlight ? "pending" : "failed";

  const message = synced
    ? `In sync: TPMS and Holman both = ${tpmsId}`
    : inFlight
      ? "Change in progress, awaiting confirmation"
      : `Out of sync: TPMS = ${tpmsId || "unassigned"}, Holman = ${holmanId || "unassigned"}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenHistory();
      }}
      className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
      title="View operation history"
    >
      <SystemSyncBadges
        tpmsStatus={status}
        tpmsMessage={message}
        holmanStatus={status}
        holmanMessage={message}
        showAms={false}
        timestamp={recentOp?.createdAt}
        className="pt-2 pointer-events-none"
      />
    </button>
  );
}
