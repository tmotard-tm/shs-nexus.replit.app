import { useQuery } from "@tanstack/react-query";
import { SystemSyncBadges } from "./SystemSyncBadges";

interface RecentOpData {
  id: number;
  operationType: string;
  tpmsStatus?: string;
  tpmsMessage?: string;
  holmanStatus?: string;
  holmanMessage?: string;
  amsStatus?: string;
  amsMessage?: string;
  createdAt?: string;
}

interface VehicleRowSyncBadgesProps {
  truckNumber: string;
  onOpenHistory: () => void;
}

export function VehicleRowSyncBadges({ truckNumber, onOpenHistory }: VehicleRowSyncBadgesProps) {
  const { data } = useQuery<RecentOpData | null>({
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

  if (!data) return null;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenHistory(); }}
      className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
      title="View operation history"
    >
      <SystemSyncBadges
        tpmsStatus={data.tpmsStatus}
        tpmsMessage={data.tpmsMessage}
        holmanStatus={data.holmanStatus}
        holmanMessage={data.holmanMessage}
        amsStatus={data.amsStatus}
        amsMessage={data.amsMessage}
        timestamp={data.createdAt}
        className="pt-2 pointer-events-none"
      />
    </button>
  );
}
