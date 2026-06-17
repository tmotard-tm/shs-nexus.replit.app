import { useQuery } from "@tanstack/react-query";
import { SystemSyncBadges } from "./SystemSyncBadges";

interface RecentOpData {
  id: number;
  createdAt?: string;
}

/** Minimal shape of a record from Tim's alignment engine (/api/fleet-ops/mismatches). */
export interface AlignmentRec {
  truckNumber: string;
  holmanTechId?: string | null;
  tpmsTechId?: string | null;
  amsTechId?: string | null;
  rootCause?: string | null;
}

interface VehicleRowSyncBadgesProps {
  truckNumber: string;
  tpmsTechId?: string | null;
  holmanTechId?: string | null;
  amsTechId?: string | null;
  /** The truck's record from Tim's alignment engine, or null when it is in sync (not flagged). */
  alignRec?: AlignmentRec | null;
  onOpenHistory: () => void;
}

/**
 * Per-system sync status for one system, relative to the reference tech.
 * green(success)=matches the assigned tech, red(failed)=disagrees or is missing
 * what the others have, amber(pending)=a sync is in flight, gray(skipped)=
 * nothing to compare. AMS passes emptyIsGray so an untracked truck is gray, not red.
 */
function systemStatus(
  sysId: string,
  ref: string,
  rootCause: string | null | undefined,
  emptyIsGray: boolean,
): string | undefined {
  const s = (sysId || "").trim().toLowerCase();
  const r = (ref || "").trim().toLowerCase();
  if (!s) {
    if (emptyIsGray) return undefined; // AMS does not track this truck -> gray
    if (!r) return undefined; // nothing assigned anywhere -> gray
    return rootCause === "pending" ? "pending" : "failed"; // missing what the reference has
  }
  if (!r) return "success"; // has a value, nothing to compare -> green
  if (s === r) return "success"; // matches -> green
  return rootCause === "pending" ? "pending" : "failed"; // disagrees
}

/**
 * Per-system sync pills on a fleet card. Colors derive from Tim's alignment
 * engine verdict (the same source as the mismatch count/filter/badge), NOT the
 * last operation:
 *   - Not flagged by the engine = in sync: TPMS + Holman green, AMS green if AMS
 *     tracks the truck else gray. (This is why a synced truck whose TPMS row is
 *     only a stub still shows green: the engine counts it matched.)
 *   - Flagged: each system is colored against the assigned tech, with amber while
 *     a change is in flight.
 * Click opens the operation history (recent-op is fetched only for that + a date).
 */
export function VehicleRowSyncBadges({
  truckNumber,
  tpmsTechId,
  holmanTechId,
  amsTechId,
  alignRec,
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

  const tpms = (tpmsTechId || "").trim();
  const holman = (holmanTechId || "").trim();
  const ams = (amsTechId || "").trim();

  let tpmsStatus: string | undefined;
  let holmanStatus: string | undefined;
  let amsStatus: string | undefined;

  if (alignRec) {
    // Flagged by Tim's engine -> color each system against the reference tech.
    const rt = (alignRec.tpmsTechId || "").trim();
    const rh = (alignRec.holmanTechId || "").trim();
    const ra = (alignRec.amsTechId || "").trim();
    const ref = rt || rh;
    tpmsStatus = systemStatus(rt, ref, alignRec.rootCause, false);
    holmanStatus = systemStatus(rh, ref, alignRec.rootCause, false);
    amsStatus = systemStatus(ra, ref, alignRec.rootCause, true);
  } else {
    // Not flagged = in sync. Show green if the truck is assigned (Holman is the
    // reliable signal; TPMS may be a stub the engine already counted as matched).
    if (!holman && !tpms) return null; // unassigned -> nothing to sync
    tpmsStatus = "success";
    holmanStatus = "success";
    amsStatus = ams ? "success" : undefined; // green if AMS tracks it, else gray
  }

  if (!tpmsStatus && !holmanStatus && !amsStatus) return null;

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
        tpmsStatus={tpmsStatus}
        holmanStatus={holmanStatus}
        amsStatus={amsStatus}
        showAms={true}
        timestamp={recentOp?.createdAt}
        className="pt-2 pointer-events-none"
      />
    </button>
  );
}
