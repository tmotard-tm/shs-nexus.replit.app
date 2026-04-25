import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Database, Radio, Activity, Pencil, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export type FieldSource =
  | "snowflake-stream"
  | "samsara-webhook"
  | "samsara-api"
  | "wms-bulk"
  | "wms-live"
  | "nexus-write"
  | "holman-webhook"
  | "ams-webhook"
  | "tpms"
  | "pmf-live"
  | "none";

export interface FieldProvenance {
  source: FieldSource;
  /** Null/omitted when source === "none" (no data available). */
  sourceTier?: 1 | 2 | 3 | null;
  /** Null/omitted when source === "none". */
  lastSyncedAt?: Date | string | null;
  stale?: boolean;
  ageSec?: number;
  reason?: "rate-limit" | "breaker-open" | "no-data";
}

const sourceMeta: Record<FieldSource, { icon: typeof Database; label: string }> = {
  "snowflake-stream": { icon: Database, label: "Snowflake mirror" },
  "samsara-webhook": { icon: Radio, label: "Samsara webhook" },
  "samsara-api": { icon: Activity, label: "Samsara live API" },
  "wms-bulk": { icon: Database, label: "WMS bulk reconcile" },
  "wms-live": { icon: Activity, label: "WMS live API" },
  "nexus-write": { icon: Pencil, label: "Nexus write (optimistic)" },
  "holman-webhook": { icon: Radio, label: "Holman webhook" },
  "ams-webhook": { icon: Radio, label: "AMS webhook" },
  "tpms": { icon: Database, label: "TPMS (system of record)" },
  "pmf-live": { icon: Activity, label: "PMF live API" },
  "none": { icon: AlertTriangle, label: "No data" },
};

interface Props {
  provenance: FieldProvenance;
  className?: string;
}

export function FieldProvenanceBadge({ provenance, className }: Props) {
  const meta = sourceMeta[provenance.source];
  const Icon = meta.icon;
  const isNoData = provenance.source === "none";

  const syncedDate =
    !isNoData && provenance.lastSyncedAt
      ? typeof provenance.lastSyncedAt === "string"
        ? new Date(provenance.lastSyncedAt)
        : provenance.lastSyncedAt
      : null;
  const relative =
    syncedDate && !isNaN(syncedDate.getTime())
      ? formatDistanceToNow(syncedDate, { addSuffix: true })
      : null;

  const variant = isNoData ? "outline" : provenance.stale ? "destructive" : "secondary";
  const tierLabel = !isNoData && provenance.sourceTier ? `T${provenance.sourceTier}` : "—";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={variant}
            className={`text-[10px] gap-1 font-normal ${className ?? ""}`}
            data-testid={`badge-provenance-${provenance.source}`}
          >
            <Icon className="w-2.5 h-2.5" />
            <span>{tierLabel}</span>
            {provenance.stale && !isNoData && <span>· stale</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">{meta.label}</div>
          {relative && <div className="text-muted-foreground">Synced {relative}</div>}
          {isNoData && <div className="text-muted-foreground">No data available</div>}
          {provenance.stale && provenance.reason && !isNoData && (
            <div className="text-destructive mt-1">Stale: {provenance.reason}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
