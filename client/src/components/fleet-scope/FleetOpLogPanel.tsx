import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { SystemSyncBadges } from "./SystemSyncBadges";

interface FleetOpLog {
  id: number;
  operationType: string;
  tpmsStatus?: string;
  tpmsMessage?: string;
  holmanStatus?: string;
  holmanMessage?: string;
  amsStatus?: string;
  amsMessage?: string;
  fromLdap?: string;
  toLdap?: string;
  toTechName?: string;
  requestedBy?: string;
  createdAt?: string;
}

interface FleetOpLogPanelProps {
  truckNumber: string | null;
}

export function FleetOpLogPanel({ truckNumber }: FleetOpLogPanelProps) {
  const { data: logs, isLoading, isError } = useQuery<FleetOpLog[]>({
    queryKey: ["/api/fleet-ops/logs", truckNumber],
    queryFn: async () => {
      const res = await fetch(
        `/api/fleet-ops/logs?truckNumber=${encodeURIComponent(truckNumber!)}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch fleet op logs");
      return res.json();
    },
    enabled: !!truckNumber,
    staleTime: 30_000,
  });

  if (!truckNumber) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading operation history…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive p-4">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load operation history. Please try again.
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No operations logged for this vehicle.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 space-y-2 p-1">
      {logs.map((log) => (
        <div key={log.id} className="p-3 bg-muted/40 rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium capitalize text-sm">
              {log.operationType?.replace(/_/g, " ")}
            </span>
            <span className="text-muted-foreground">
              {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
            </span>
          </div>
          {(log.fromLdap || log.toLdap) && (
            <div className="text-muted-foreground">
              {log.fromLdap || "—"} → {log.toLdap || "—"}
              {log.toTechName && <span className="ml-1">({log.toTechName})</span>}
            </div>
          )}
          {log.requestedBy && (
            <div className="text-muted-foreground">By: {log.requestedBy}</div>
          )}
          <SystemSyncBadges
            tpmsStatus={log.tpmsStatus}
            tpmsMessage={log.tpmsMessage}
            holmanStatus={log.holmanStatus}
            holmanMessage={log.holmanMessage}
            amsStatus={log.amsStatus}
            amsMessage={log.amsMessage}
          />
        </div>
      ))}
    </div>
  );
}
