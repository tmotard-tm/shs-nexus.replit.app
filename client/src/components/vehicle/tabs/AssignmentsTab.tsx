import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  UserCog, User, Truck as TruckIcon, History, Calendar,
  AlertCircle, CheckCircle2, AlertTriangle, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toTpmsRef } from "@shared/vehicle-number-utils";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Assignments tab — Phase 2A.3.
 *
 * TPMS is the system of record for tech-to-truck assignments
 * (decision locked in docs/end-to-end-review.md). WMS engine provides
 * a live confirmation cross-check; mismatch is rendered as a soft warning
 * (TPMS wins per conflict-resolution policy).
 *
 * Sections:
 *   1. Current Assignment (TPMS cache lookup by truck number)
 *   2. WMS Live Confirmation (cross-check on the techRacfid)
 *   3. Assignment History (absorbed from AssignmentHistoryDialog vehicle-mode)
 */

interface TpmsLookupResult {
  success: boolean;
  message?: string;
  source?: "live" | "cached";
  data?: {
    techRacfid?: string;
    techName?: string;
    ldapId?: string;
    employeeId?: string;
    truckNo?: string;
    districtNo?: string;
    planningArea?: string;
    jobTitle?: string;
    employmentStatus?: string;
    [k: string]: any;
  };
}

interface AssignmentHistoryEntry {
  id: number;
  techRacfid: string;
  truckNo: string;
  previousTruckNo?: string;
  changeType: string;
  action?: string;
  changeSource?: string;
  changedBy?: string;
  notes?: string;
  performedBy?: string;
  createdAt: string;
}

function getActionBadge(action: string) {
  const a = action.toLowerCase();
  switch (a) {
    case "assign":
    case "assigned":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Assigned</Badge>;
    case "unassign":
    case "unassigned":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Unassigned</Badge>;
    case "sync":
      return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">Synced</Badge>;
    case "changed":
    case "transfer":
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">Reassigned</Badge>;
    case "status_changed":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Status Changed</Badge>;
    case "updated":
      return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">Info Updated</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{action || "—"}</Badge>;
  }
}

function CurrentAssignment({ truckNumber }: { truckNumber: string }) {
  const { data, isLoading, error } = useQuery<TpmsLookupResult>({
    queryKey: ["/api/tpms/lookup/truck", truckNumber],
    enabled: !!truckNumber,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tech = data?.data;
  const techRacfid = tech?.techRacfid || tech?.ldapId;

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <UserCog className="w-4 h-4 text-muted-foreground" />
        Current Assignment
        <Badge variant="outline" className="text-[10px] ml-1 border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-300">
          TPMS · SoT
        </Badge>
      </h3>

      <div className="rounded-md border p-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to load TPMS assignment</span>
          </div>
        ) : !data?.success || !tech ? (
          <div className="flex items-start gap-2 text-muted-foreground" data-testid="tpms-no-assignment">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="text-sm">No tech currently assigned in TPMS</p>
              {data?.message && (
                <p className="text-xs italic mt-1">{data.message}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-semibold" data-testid="tpms-tech-name">
                    {tech.techName || "—"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  RACFID: {techRacfid || "—"}
                </p>
                {tech.employeeId && (
                  <p className="text-xs text-muted-foreground font-mono">
                    Employee #: {tech.employeeId}
                  </p>
                )}
              </div>
              <Badge
                variant={data.source === "live" ? "default" : "secondary"}
                className="text-xs shrink-0"
                data-testid="tpms-source-badge"
              >
                {data.source || "cached"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1 border-t">
              {tech.jobTitle && (
                <div>
                  <span className="text-muted-foreground">Title:</span>{" "}
                  <span className="font-medium">{tech.jobTitle}</span>
                </div>
              )}
              {tech.districtNo && (
                <div>
                  <span className="text-muted-foreground">District:</span>{" "}
                  <span className="font-medium">{tech.districtNo}</span>
                </div>
              )}
              {tech.planningArea && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Planning Area:</span>{" "}
                  <span className="font-medium">{tech.planningArea}</span>
                </div>
              )}
              {tech.employmentStatus && (
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className="font-medium">{tech.employmentStatus}</span>
                </div>
              )}
            </div>

            {techRacfid && <WmsCrossCheck techRacfid={techRacfid} expectedTruckNo={truckNumber} />}
          </div>
        )}
      </div>
    </section>
  );
}

function WmsCrossCheck({
  techRacfid,
  expectedTruckNo,
}: {
  techRacfid: string;
  expectedTruckNo: string;
}) {
  const { data, isLoading, error } = useQuery<{ success: boolean; data?: any }>({
    queryKey: ["/api/wms/assignments", techRacfid],
    enabled: !!techRacfid,
    staleTime: 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return <Skeleton className="h-6 w-full mt-2" />;
  }
  if (error) {
    return null;
  }

  const wmsTruck =
    data?.data?.truckNo ||
    data?.data?.truckNumber ||
    data?.data?.truck ||
    null;

  // Compare on canonical (zero-stripped) form so padded vs unpadded
  // representations from either side don't trigger a false mismatch.
  const matches =
    wmsTruck != null &&
    String(wmsTruck).trim().replace(/^0+/, "") ===
      String(expectedTruckNo).trim().replace(/^0+/, "");

  return (
    <div className="flex items-center gap-2 pt-2 border-t text-xs" data-testid="wms-crosscheck">
      {wmsTruck == null ? (
        <span className="text-muted-foreground italic">
          WMS has no live assignment record for this tech
        </span>
      ) : matches ? (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
          <span className="text-muted-foreground">
            WMS confirms truck <span className="font-mono font-medium text-foreground">{wmsTruck}</span>
          </span>
        </>
      ) : (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-amber-700 dark:text-amber-400">
            WMS shows truck <span className="font-mono font-medium">{wmsTruck}</span>; TPMS (SoT) wins.
          </span>
        </>
      )}
    </div>
  );
}

function HistoryList({ truckNumber }: { truckNumber: string }) {
  const { data, isLoading, error } = useQuery<{ success: boolean; data: AssignmentHistoryEntry[] }>({
    queryKey: ["/api/vehicle-assignments/by-truck", truckNumber],
    enabled: !!truckNumber,
    staleTime: 5 * 60 * 1000,
  });

  const history = data?.data || [];

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <History className="w-4 h-4 text-muted-foreground" />
        Assignment History
        {!isLoading && !error && (
          <Badge variant="secondary" className="text-xs ml-1">{history.length}</Badge>
        )}
      </h3>

      <div className="rounded-md border p-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to load history</span>
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground italic" data-testid="history-empty">
            No assignment history found for this vehicle.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="border rounded-md p-2.5 space-y-1.5"
                data-testid={`history-entry-${entry.id}`}
              >
                <div className="flex items-center justify-between">
                  {getActionBadge(entry.changeType || entry.action || "")}
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <User className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Tech:</span>
                    <span className="font-mono truncate">{entry.techRacfid || "—"}</span>
                  </div>
                  {entry.previousTruckNo && entry.previousTruckNo !== entry.truckNo && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <TruckIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">From:</span>
                      <span className="font-mono truncate">{entry.previousTruckNo}</span>
                    </div>
                  )}
                </div>

                {entry.notes && (
                  <p className="text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded">
                    {entry.notes}
                  </p>
                )}

                {(entry.changedBy || entry.performedBy) && (
                  <p className="text-[10px] text-muted-foreground">
                    By: {entry.changedBy || entry.performedBy}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function AssignmentsTab({ truck }: { truck: TruckPanelData }) {
  // TPMS cache stores 6-digit zero-padded truck numbers (per
  // tpms-service.lookupByTruckNumber exact-match semantics). The history
  // table is also populated from TPMS sync, so it uses the same form.
  const truckNumberPadded = toTpmsRef(truck.truckNumber);

  if (!truckNumberPadded) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <UserCog className="w-6 h-6 mx-auto mb-2 text-muted-foreground/60" />
        <div>Vehicle number is required to load assignment data.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <CurrentAssignment truckNumber={truckNumberPadded} />
      <HistoryList truckNumber={truckNumberPadded} />

      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic flex items-start gap-2">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          TPMS is system-of-record for assignments. WMS is shown for cross-check only;
          on conflict, TPMS wins (decision locked in end-to-end review).
        </span>
      </div>
    </div>
  );
}
