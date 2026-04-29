import { CheckCircle, XCircle, Clock, SkipForward, AlertTriangle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SyncStatus = "success" | "failed" | "pending" | "skipped" | "conflict" | string;

const STATUS_CONFIG: Record<string, { classes: string; icon: React.ReactNode }> = {
  success: {
    classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
    icon: <CheckCircle className="h-2.5 w-2.5" />,
  },
  failed: {
    classes: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700",
    icon: <XCircle className="h-2.5 w-2.5" />,
  },
  pending: {
    classes: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
    icon: <Clock className="h-2.5 w-2.5" />,
  },
  skipped: {
    classes: "bg-muted text-muted-foreground border-border",
    icon: <SkipForward className="h-2.5 w-2.5" />,
  },
  conflict: {
    classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
    icon: <AlertTriangle className="h-2.5 w-2.5" />,
  },
};

function getConfig(status?: string) {
  if (!status) return null;
  return STATUS_CONFIG[status] ?? {
    classes: "bg-muted text-muted-foreground border-border",
    icon: null,
  };
}

interface SystemBadgeProps {
  system: string;
  status?: string;
  message?: string;
}

function SystemBadge({ system, status, message }: SystemBadgeProps) {
  if (!status || status === "skipped") return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground border-border"
      title={message || `${system}: skipped`}
    >
      <span className="font-mono">{system}</span>
      <span className="opacity-60">—</span>
    </span>
  );

  const cfg = getConfig(status);
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium",
        cfg.classes
      )}
      title={message || `${system}: ${status}`}
    >
      <span className="font-mono">{system}</span>
      {cfg.icon}
    </span>
  );
}

export interface SystemSyncBadgesProps {
  tpmsStatus?: string;
  holmanStatus?: string;
  amsStatus?: string;
  tpmsMessage?: string;
  holmanMessage?: string;
  amsMessage?: string;
  logId?: number;
  timestamp?: string | Date;
  onOpenDetail?: (logId: number) => void;
  className?: string;
}

export function SystemSyncBadges({
  tpmsStatus,
  holmanStatus,
  amsStatus,
  tpmsMessage,
  holmanMessage,
  amsMessage,
  logId,
  timestamp,
  onOpenDetail,
  className,
}: SystemSyncBadgesProps) {
  const hasAnyStatus = tpmsStatus || holmanStatus || amsStatus;
  if (!hasAnyStatus) return null;

  const allSkipped =
    (!tpmsStatus || tpmsStatus === "skipped") &&
    (!holmanStatus || holmanStatus === "skipped") &&
    (!amsStatus || amsStatus === "skipped");

  if (allSkipped) return null;

  const ts = timestamp
    ? typeof timestamp === "string"
      ? new Date(timestamp)
      : timestamp
    : null;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      <SystemBadge system="TPMS" status={tpmsStatus} message={tpmsMessage} />
      <SystemBadge system="Holman" status={holmanStatus} message={holmanMessage} />
      <SystemBadge system="AMS" status={amsStatus} message={amsMessage} />
      {ts && (
        <span className="text-xs text-muted-foreground ml-0.5">
          {ts.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
      {logId !== undefined && onOpenDetail && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onOpenDetail(logId)}
        >
          <History className="h-3 w-3 mr-0.5" />
          Detail
        </Button>
      )}
    </div>
  );
}
