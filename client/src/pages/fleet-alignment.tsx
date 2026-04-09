import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, RefreshCw, Loader2, CheckCircle, XCircle, Clock, ExternalLink,
  AlertCircle, Zap, Shield, Layers, GitBranch, UserX, HelpCircle, Info, X, Play,
  Search, Filter,
} from "lucide-react";
import { Link } from "wouter";

type RootCause =
  | "pending"
  | "failed_operation"
  | "external_tpms_change"
  | "external_ams_change"
  | "status_blocked"
  | "partial_failure"
  | "stale_tech_id"
  | "byov_vin_missing"
  | "unexplained_drift";

type FixAction = "assign" | "unassign" | "push_holman" | "push_ams" | "push_multiple" | "cache_evict" | "manual_review" | "wait";

interface AlignmentRecord {
  truckNumber: string;
  holmanTechId: string | null;
  holmanTechName: string | null;
  tpmsTechId: string | null;
  tpmsTechName: string | null;
  amsTechId: string | null;
  vin: string | null;
  holmanStatusCd: string | null;
  byovVinMissing: boolean;
  districtNo: string | null;
  rootCause: RootCause;
  explanation: string;
  bulkFixEligible: boolean;
  suggestedAction: FixAction;
  suggestedActionLabel: string;
  ldapIdForAction: string | null;
}

interface BulkRunItem {
  id: string;
  truckNumber: string;
  action: string;
  ldapId: string | null;
  status: "pending" | "completed" | "failed" | "skipped" | "cancelled" | "conflict";
  outcome: any;
  processedAt: string | null;
}

interface BulkRun {
  runId: string;
  status: "running" | "completed" | "cancelled";
  startedBy: string;
  startedAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
  highFailureWarning: boolean;
  items: BulkRunItem[];
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
  conflictCount: number;
}

const ROOT_CAUSE_META: Record<RootCause, { label: string; color: string; badgeCls: string; icon: any; severity: number }> = {
  pending: { label: "Pending", color: "text-blue-600", badgeCls: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300", icon: Clock, severity: 1 },
  failed_operation: { label: "Failed Operation", color: "text-red-600", badgeCls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300", icon: XCircle, severity: 5 },
  external_tpms_change: { label: "External TPMS Change", color: "text-purple-600", badgeCls: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300", icon: Zap, severity: 4 },
  external_ams_change: { label: "External AMS Change", color: "text-emerald-600", badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300", icon: Zap, severity: 4 },
  status_blocked: { label: "Status Blocked", color: "text-orange-600", badgeCls: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300", icon: Shield, severity: 3 },
  partial_failure: { label: "Partial Failure", color: "text-amber-600", badgeCls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300", icon: Layers, severity: 4 },
  stale_tech_id: { label: "Stale Tech ID", color: "text-slate-600", badgeCls: "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-950 dark:text-slate-300", icon: UserX, severity: 2 },
  byov_vin_missing: { label: "BYOV VIN Missing", color: "text-rose-600", badgeCls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300", icon: AlertCircle, severity: 3 },
  unexplained_drift: { label: "Unexplained Drift", color: "text-gray-600", badgeCls: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300", icon: HelpCircle, severity: 2 },
};

const NON_BULK_FIXABLE: RootCause[] = ["stale_tech_id", "byov_vin_missing", "status_blocked"];

function RootCauseBadge({ cause }: { cause: RootCause }) {
  const meta = ROOT_CAUSE_META[cause];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.badgeCls}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function SystemCell({ label, techId, techName, labelColor }: { label: string; techId: string | null; techName: string | null; labelColor: string }) {
  return (
    <div className="space-y-0.5 min-w-[100px]">
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${labelColor}`}>{label}</p>
      {techId ? (
        <>
          <p className="text-xs font-medium leading-tight truncate max-w-[120px]">{techName || techId}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{techId}</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center gap-0.5">
          <XCircle className="h-3 w-3 text-orange-400" /> Unassigned
        </p>
      )}
    </div>
  );
}

function RunProgressDialog({
  runId,
  onClose,
  onForceConflicts,
}: {
  runId: string;
  onClose: () => void;
  onForceConflicts: (conflictTrucks: { truckNumber: string; ldapId: string | null; outcome: any }[]) => void;
}) {
  const { toast } = useToast();
  const [highFailureWarning, setHighFailureWarning] = useState(false);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [showConflictConfirm, setShowConflictConfirm] = useState(false);
  const prevItems = useRef<BulkRunItem[]>([]);

  const { data: run } = useQuery<BulkRun>({
    queryKey: ["/api/fleet-ops/bulk-runs", runId],
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/bulk-runs/${runId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to poll run");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as BulkRun | undefined;
      return data?.status === "running" ? 2000 : false;
    },
    staleTime: 0,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/fleet-ops/bulk-runs/${runId}/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/bulk-runs", runId] });
      toast({ title: "Run cancelled", description: "Remaining pending items have been skipped." });
    },
  });

  // Detect high failure rate: rely strictly on server-side flag (first 10 processed items)
  useEffect(() => {
    if (!run) return;
    if (!dismissedWarning && run.highFailureWarning) {
      setHighFailureWarning(true);
    }
    prevItems.current = run.items;
  }, [run, dismissedWarning]);

  const totalItems = run ? run.items.length : 0;
  const doneItems = run ? (run.completedCount + run.failedCount + run.skippedCount + (run.conflictCount ?? 0)) : 0;
  const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  const isRunning = run?.status === "running";
  const isDone = run && (run.status === "completed" || run.status === "cancelled");
  const conflictItems = run?.items.filter(i => i.status === "conflict") ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isRunning) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
            Bulk Fix {isRunning ? "In Progress" : run?.status === "cancelled" ? "Cancelled" : "Complete"}
          </DialogTitle>
          <DialogDescription>
            {isRunning
              ? `Processing vehicles — ${doneItems} of ${totalItems} done`
              : [
                  `${run?.completedCount ?? 0} succeeded`,
                  `${run?.failedCount ?? 0} failed`,
                  `${run?.skippedCount ?? 0} skipped`,
                  ...(run?.conflictCount ? [`${run.conflictCount} need confirmation`] : []),
                ].join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4 flex-1 overflow-y-auto">
          {/* Progress bar */}
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{progress}%</p>
          </div>

          {/* High failure warning */}
          {highFailureWarning && !dismissedWarning && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>High failure rate detected</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>Consider cancelling and investigating before continuing.</span>
                <Button size="sm" variant="outline" className="ml-4 shrink-0" onClick={() => setDismissedWarning(true)}>
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Conflict confirmation alert — shown after run finishes if any conflicts exist */}
          {isDone && conflictItems.length > 0 && !showConflictConfirm && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-300">
                {conflictItems.length} truck{conflictItems.length > 1 ? "s" : ""} need confirmation
              </AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-amber-700 dark:text-amber-400 text-sm">
                  TPMS shows a different tech assigned to these trucks. Review and confirm to proceed.
                </span>
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                  onClick={() => setShowConflictConfirm(true)}
                >
                  Review conflicts ({conflictItems.length})
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Conflict detail + confirm UI */}
          {showConflictConfirm && conflictItems.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Confirm forced unassign for {conflictItems.length} truck{conflictItems.length > 1 ? "s" : ""}
              </p>
              <div className="space-y-1.5">
                {conflictItems.map(item => (
                  <div key={item.id} className="text-xs bg-white dark:bg-amber-900/20 rounded px-2 py-1.5 border border-amber-200">
                    <span className="font-mono font-semibold">#{item.truckNumber}</span>
                    {" — "}
                    <span className="text-muted-foreground">{item.outcome?.message ?? `${item.outcome?.conflictTech ?? item.ldapId} is on truck ${item.outcome?.conflictTruck}`}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Proceeding will unassign each tech from their current truck. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => {
                    onForceConflicts(conflictItems.map(i => ({
                      truckNumber: i.truckNumber,
                      ldapId: i.ldapId,
                      outcome: i.outcome,
                    })));
                    setShowConflictConfirm(false);
                  }}
                >
                  Confirm & proceed
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowConflictConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Per-vehicle results */}
          <div className="space-y-1">
            {(run?.items ?? []).filter(i => i.status !== "pending").map(item => (
              <div key={item.id} className="flex items-center gap-2 text-sm py-1 border-b border-border/40 last:border-0">
                {item.status === "completed" && <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                {item.status === "failed" && <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                {item.status === "skipped" && <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                {item.status === "conflict" && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                <span className="font-mono text-xs">#{item.truckNumber}</span>
                <span className="text-xs text-muted-foreground flex-1">{item.action}{item.ldapId ? ` → ${item.ldapId}` : ""}</span>
                {item.status === "failed" && item.outcome?.error && (
                  <span className="text-xs text-red-600 truncate max-w-[200px]">{item.outcome.error}</span>
                )}
                {item.status === "conflict" && (
                  <span className="text-xs text-amber-600 truncate max-w-[200px]">
                    {item.outcome?.conflictTech} on truck #{item.outcome?.conflictTruck}
                  </span>
                )}
                <span className={`text-xs font-medium capitalize ${
                  item.status === "completed" ? "text-green-600"
                  : item.status === "failed" ? "text-red-600"
                  : item.status === "conflict" ? "text-amber-600"
                  : "text-muted-foreground"
                }`}>
                  {item.status === "conflict" ? "Needs review" : item.status}
                </span>
              </div>
            ))}
            {run && run.items.filter(i => i.status === "pending").length > 0 && isRunning && (
              <div className="flex items-center gap-2 text-sm py-1 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{run.items.filter(i => i.status === "pending").length} vehicles pending…</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 flex items-center justify-between">
          <div className="flex gap-2">
            {isRunning && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />}
                Cancel
              </Button>
            )}
          </div>
          {isDone && (
            <Button onClick={onClose}>Close</Button>
          )}
          {isRunning && (
            <p className="text-xs text-muted-foreground">Close this window to check back later</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SortField = "truckNumber" | "rootCause" | "holmanTechId" | "tpmsTechId";
type SortDir = "asc" | "desc";

export default function FleetAlignment() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rootCauseFilter, setRootCauseFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("truckNumber");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [patternFilter, setPatternFilter] = useState<
    "all" | "no_holman" | "holman_only" | "no_ams" | "no_tpms" |
    "tpms_ams_match" | "holman_ams_match" | "all_three_diff"
  >("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [bulkFixOnly, setBulkFixOnly] = useState(false);
  const [confirmUnassign, setConfirmUnassign] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [pendingVehicles, setPendingVehicles] = useState<AlignmentRecord[]>([]);

  // Load alignment data — fetches all pages and merges them into a single list
  const { data: alignmentData, isLoading, refetch, isFetching } = useQuery<{ data: AlignmentRecord[]; total: number }>({
    queryKey: ["/api/fleet-ops/mismatches", forceRefresh ? "force" : "cache"],
    queryFn: async () => {
      const pageSize = 200;
      const baseParams = forceRefresh ? "forceRefresh=true&" : "";
      const firstUrl = `/api/fleet-ops/mismatches?${baseParams}page=1&pageSize=${pageSize}`;
      const firstRes = await fetch(firstUrl, { credentials: "include" });
      if (!firstRes.ok) throw new Error("Failed to load mismatches");
      const firstPage = await firstRes.json();
      const total: number = firstPage.total ?? firstPage.data.length;
      const allData: AlignmentRecord[] = [...(firstPage.data ?? [])];

      // Fetch remaining pages in parallel
      const totalPages = Math.ceil(total / pageSize);
      if (totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, i) =>
            fetch(`/api/fleet-ops/mismatches?${baseParams}page=${i + 2}&pageSize=${pageSize}`, { credentials: "include" })
              .then(r => r.json())
              .then(j => j.data ?? [])
          )
        );
        rest.forEach(page => allData.push(...page));
      }
      return { data: allData, total };
    },
    staleTime: 14 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Check for any resumable runs
  const { data: recentRuns } = useQuery<{ runs: Array<{ runId: string; status: string; startedAt: string }> }>({
    queryKey: ["/api/fleet-ops/bulk-runs"],
    staleTime: 60 * 1000,
  });

  const resumableRun = recentRuns?.runs?.find(r => r.status === "running");

  const allRecords = alignmentData?.data ?? [];

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = (() => {
    const q = searchQuery.trim().toLowerCase();
    return [...allRecords]
      .filter(r => rootCauseFilter === "all" || r.rootCause === rootCauseFilter)
      .filter(r => {
        if (q === "") return true;
        return (
          r.truckNumber.toLowerCase().includes(q) ||
          (r.holmanTechId ?? "").toLowerCase().includes(q) ||
          (r.tpmsTechId ?? "").toLowerCase().includes(q) ||
          (r.amsTechId ?? "").toLowerCase().includes(q) ||
          (r.holmanTechName ?? "").toLowerCase().includes(q) ||
          (r.tpmsTechName ?? "").toLowerCase().includes(q)
        );
      })
      .filter(r => {
        if (patternFilter === "all") return true;
        const h = (r.holmanTechId ?? "").trim().toLowerCase();
        const t = (r.tpmsTechId ?? "").trim().toLowerCase();
        const a = (r.amsTechId ?? "").trim().toLowerCase();
        // Pattern 1: Empty | Tech A | Tech A  — TPMS & AMS agree, Holman empty
        if (patternFilter === "no_holman")       return h === "" && t !== "" && a !== "" && t === a;
        // Pattern 2: Tech A | Empty | Empty  — Holman only
        if (patternFilter === "holman_only")     return h !== "" && t === "" && a === "";
        // Pattern 3: Tech A | Tech A | Empty  — Holman & TPMS agree, AMS empty
        if (patternFilter === "no_ams")          return h !== "" && t !== "" && a === "" && h === t;
        // Pattern 4: Tech A | Empty | Tech A  — Holman & AMS agree, TPMS empty
        if (patternFilter === "no_tpms")         return h !== "" && t === "" && a !== "" && h === a;
        // Pattern 5: Tech A | Tech B | Tech B  — TPMS & AMS agree but differ from Holman
        if (patternFilter === "tpms_ams_match")  return h !== "" && t !== "" && a !== "" && t === a && h !== t;
        // Pattern 6: Tech A | Tech B | Tech A  — Holman & AMS agree, TPMS differs
        if (patternFilter === "holman_ams_match") return h !== "" && t !== "" && a !== "" && h === a && h !== t;
        // Pattern 7: Tech A | Tech B | Tech C  — all three different
        if (patternFilter === "all_three_diff")  return h !== "" && t !== "" && a !== "" && h !== t && t !== a && h !== a;
        return true;
      })
      .filter(r => actionFilter === "all" || r.suggestedAction === actionFilter)
      .filter(r => !bulkFixOnly || r.bulkFixEligible)
      .sort((a, b) => {
        const av = (a[sortField as keyof AlignmentRecord] as string) ?? "";
        const bv = (b[sortField as keyof AlignmentRecord] as string) ?? "";
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      });
  })();

  const activeFilterCount = [
    searchQuery.trim() !== "",
    patternFilter !== "all",
    actionFilter !== "all",
    bulkFixOnly,
  ].filter(Boolean).length;

  // Resume run data for pending count
  const { data: resumableRunData } = useQuery<BulkRun>({
    queryKey: ["/api/fleet-ops/bulk-runs", resumableRun?.runId],
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/bulk-runs/${resumableRun!.runId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load run");
      return res.json();
    },
    enabled: !!resumableRun,
    staleTime: 30 * 1000,
  });

  // All filtered records are selectable; non-fixable ones are submitted and recorded as skipped by the backend
  const selectableRecords = filtered;

  const toggleSelect = useCallback((truckNumber: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(truckNumber)) next.delete(truckNumber);
      else next.add(truckNumber);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === selectableRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableRecords.map(r => r.truckNumber)));
    }
  };

  const selectAllWithCause = (cause: RootCause) => {
    const trucks = filtered
      .filter(r => r.rootCause === cause)
      .map(r => r.truckNumber);
    setSelectedIds(prev => {
      const next = new Set(prev);
      trucks.forEach(t => next.add(t));
      return next;
    });
  };

  const selectedRecords = allRecords.filter(r => selectedIds.has(r.truckNumber));

  const bulkMutation = useMutation({
    mutationFn: async ({ vehicles, runId }: { vehicles?: AlignmentRecord[]; runId?: string }) => {
      let payload: Record<string, any>;
      if (runId && !vehicles) {
        // Resume: only send runId; backend re-loads pending items from DB
        payload = { runId };
      } else {
        payload = {
          vehicles: (vehicles ?? []).map(v => ({
            truckNumber: v.truckNumber,
            action: v.suggestedAction,
            ldapId: v.ldapIdForAction ?? undefined,
            districtNo: v.districtNo ?? undefined,
          })),
        };
        if (runId) payload.runId = runId;
      }
      const res = await apiRequest("POST", "/api/fleet-ops/bulk-reconcile", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || "Request failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setActiveRunId(data.runId);
      setShowProgress(true);
      setSelectedIds(new Set());
      setConfirmUnassign(false);
      setConfirmText("");
    },
    onError: (err: any) => {
      toast({ title: "Bulk fix failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFixSelected = () => {
    // Send ALL selected records to the backend.
    // Non-bulk-fixable records are included and will be recorded with status=skipped in the run results.
    const toFix = selectedRecords;
    if (toFix.length === 0) {
      toast({ title: "No vehicles selected", description: "Select vehicles to fix." });
      return;
    }

    const skippableCount = toFix.filter(
      r => NON_BULK_FIXABLE.includes(r.rootCause) || !r.bulkFixEligible || r.suggestedAction === "wait"
    ).length;
    if (skippableCount > 0 && skippableCount === toFix.length) {
      // All selected require manual intervention — still allow submission so they appear in audit trail
      toast({
        title: "Note: All selected require manual review",
        description: `${skippableCount} vehicle(s) will be recorded as skipped in the run log.`,
      });
    }

    const unassignCount = toFix.filter(r => r.suggestedAction === "unassign").length;
    if (unassignCount > 10) {
      setPendingVehicles(toFix);
      setConfirmUnassign(true);
    } else {
      bulkMutation.mutate({ vehicles: toFix });
    }
  };

  const handleResume = () => {
    if (!resumableRun) return;
    // POST to backend with runId only — backend resumes from persisted pending items
    bulkMutation.mutate({ runId: resumableRun.runId });
  };

  // Get district breakdown for the unassign confirmation
  const unassignDistricts = (() => {
    const districts = new Map<string, number>();
    pendingVehicles
      .filter(v => v.suggestedAction === "unassign")
      .forEach(v => {
        const d = v.districtNo || "Unknown";
        districts.set(d, (districts.get(d) ?? 0) + 1);
      });
    return districts;
  })();

  const rootCauseGroups = (() => {
    const groups: Record<string, number> = {};
    allRecords.forEach(r => {
      groups[r.rootCause] = (groups[r.rootCause] ?? 0) + 1;
    });
    return groups;
  })();

  return (
    <MainContent>
      <TopBar
        title="Fleet Alignment"
        breadcrumbs={["Home", "Fleet", "Alignment"]}
      />

      <main className="p-6">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold">Cross-System Alignment</h1>
              <p className="text-muted-foreground text-sm">
                Vehicles where Holman, TPMS, or AMS disagree on assignment state.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setForceRefresh(true);
                  setTimeout(() => setForceRefresh(false), 100);
                  refetch();
                }}
                disabled={isFetching}
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Refresh
              </Button>
            </div>
          </div>

          {/* Resume banner */}
          {resumableRun && resumableRunData && resumableRunData.pendingCount > 0 && (
            <Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/20">
              <Play className="h-4 w-4 text-blue-600" />
              <AlertTitle className="text-blue-800 dark:text-blue-300">Resumable run detected</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-blue-700 dark:text-blue-400">
                  A previous bulk fix run has {resumableRunData.pendingCount} vehicle(s) still pending.
                </span>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleResume}
                >
                  Resume run ({resumableRunData.pendingCount} pending)
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Root cause summary pills + sort controls */}
          {!isLoading && allRecords.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setRootCauseFilter("all")}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    rootCauseFilter === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                  }`}
                >
                  All ({allRecords.length})
                </button>
                {Object.entries(ROOT_CAUSE_META)
                  .sort((a, b) => b[1].severity - a[1].severity)
                  .filter(([key]) => rootCauseGroups[key] > 0)
                  .map(([key, meta]) => {
                    const Icon = meta.icon;
                    const count = rootCauseGroups[key] ?? 0;
                    const active = rootCauseFilter === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setRootCauseFilter(active ? "all" : key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          active ? meta.badgeCls : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label} ({count})
                      </button>
                    );
                  })}
              </div>
              {/* Sort controls */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">Sort by:</span>
                {(["truckNumber", "rootCause", "holmanTechId", "tpmsTechId"] as SortField[]).map(f => (
                  <button
                    key={f}
                    onClick={() => toggleSort(f)}
                    className={`px-2 py-1 rounded border transition-colors ${
                      sortField === f
                        ? "bg-muted border-border font-semibold text-foreground"
                        : "border-transparent hover:border-border hover:bg-muted/50"
                    }`}
                  >
                    {f === "truckNumber" ? "Truck" : f === "rootCause" ? "Root Cause" : f === "holmanTechId" ? "Holman Tech" : "TPMS Tech"}
                    {sortField === f && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compact filters */}
          {!isLoading && allRecords.length > 0 && (
            <div className="rounded-md border bg-card px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setPatternFilter("all");
                      setActionFilter("all");
                      setBulkFixOnly(false);
                    }}
                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3 items-end">
                {/* Search */}
                <div className="flex flex-col gap-1 min-w-[180px] flex-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Truck # or tech LDAP…"
                      className="h-8 pl-7 text-sm"
                    />
                  </div>
                </div>

                {/* Mismatch pattern */}
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Mismatch Pattern</Label>
                  <Select value={patternFilter} onValueChange={v => setPatternFilter(v as any)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All patterns</SelectItem>
                      <SelectItem value="no_holman">Holman empty · TPMS &amp; AMS match</SelectItem>
                      <SelectItem value="holman_only">Holman assigned · TPMS &amp; AMS empty</SelectItem>
                      <SelectItem value="no_ams">Holman &amp; TPMS match · AMS empty</SelectItem>
                      <SelectItem value="no_tpms">Holman &amp; AMS match · TPMS empty</SelectItem>
                      <SelectItem value="tpms_ams_match">TPMS &amp; AMS match · differ from Holman</SelectItem>
                      <SelectItem value="holman_ams_match">Holman &amp; AMS match · TPMS differs</SelectItem>
                      <SelectItem value="all_three_diff">All three systems differ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Suggested action */}
                <div className="flex flex-col gap-1 min-w-[160px]">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Suggested Action</Label>
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All actions</SelectItem>
                      {[...new Set(allRecords.map(r => r.suggestedAction))].sort().map(action => (
                        <SelectItem key={action} value={action}>
                          {action === "assign" ? "Assign"
                            : action === "unassign" ? "Unassign"
                            : action === "push_holman" ? "Push to Holman"
                            : action === "push_ams" ? "Push to AMS"
                            : action === "push_multiple" ? "Push to multiple"
                            : action === "cache_evict" ? "Cache evict"
                            : action === "manual_review" ? "Manual review"
                            : action === "wait" ? "Wait"
                            : action}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Bulk fix eligible toggle */}
                <div className="flex items-center gap-2 pb-1">
                  <Checkbox
                    id="bulk-fix-only"
                    checked={bulkFixOnly}
                    onCheckedChange={v => setBulkFixOnly(!!v)}
                  />
                  <Label htmlFor="bulk-fix-only" className="text-sm cursor-pointer">Bulk-fix eligible only</Label>
                </div>
              </div>

              {/* Result count */}
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
                <span className="font-semibold text-foreground">{allRecords.length}</span> mismatches
              </p>
            </div>
          )}

          {/* Action bar */}
          {!isLoading && filtered.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-3 py-2 px-3 border rounded-md bg-muted/30">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={
                    selectableRecords.length > 0 &&
                    selectableRecords.every(r => selectedIds.has(r.truckNumber))
                  }
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filtered.length} vehicles`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <Button
                    size="sm"
                    onClick={handleFixSelected}
                    disabled={bulkMutation.isPending}
                  >
                    {bulkMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <Zap className="h-4 w-4 mr-1.5" />
                    )}
                    Fix Selected ({selectedIds.size})
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && filtered.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <CheckCircle className="h-10 w-10 text-green-500 opacity-60" />
                <p className="text-muted-foreground text-sm">
                  {allRecords.length === 0
                    ? "No mismatches detected. All systems are aligned."
                    : "No mismatches match the current filter."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Mismatch table */}
          {!isLoading && filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map(record => {
                const meta = ROOT_CAUSE_META[record.rootCause];
                const isNonFixable = NON_BULK_FIXABLE.includes(record.rootCause) || !record.bulkFixEligible;
                const isSelected = selectedIds.has(record.truckNumber);

                return (
                  <Card
                    key={record.truckNumber}
                    className={`transition-all ${isSelected ? "ring-2 ring-primary/50" : ""} ${isNonFixable && isSelected ? "opacity-80" : ""}`}
                  >
                    <CardContent className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        {/* Checkbox — all records selectable; non-fixable submitted and skipped by backend */}
                        <div className="pt-1 shrink-0">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(record.truckNumber)}
                            disabled={false}
                            aria-label={`Select truck ${record.truckNumber}`}
                          />
                        </div>

                        {/* Truck number + link */}
                        <div className="shrink-0 min-w-[80px]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold text-sm">#{record.truckNumber}</span>
                            <Link href={`/fleet-scope/trucks/${record.truckNumber}`}>
                              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-pointer" />
                            </Link>
                          </div>
                          {record.districtNo && (
                            <p className="text-[10px] text-muted-foreground">District {record.districtNo}</p>
                          )}
                        </div>

                        {/* System states */}
                        <div className="flex gap-4 flex-1 flex-wrap">
                          <SystemCell
                            label="Holman"
                            techId={record.holmanTechId}
                            techName={record.holmanTechName}
                            labelColor="text-blue-600 dark:text-blue-400"
                          />
                          <SystemCell
                            label="TPMS"
                            techId={record.tpmsTechId}
                            techName={record.tpmsTechName}
                            labelColor="text-purple-600 dark:text-purple-400"
                          />
                          <SystemCell
                            label="AMS"
                            techId={record.amsTechId}
                            techName={null}
                            labelColor="text-emerald-600 dark:text-emerald-400"
                          />
                        </div>

                        {/* Root cause + fix */}
                        <div className="shrink-0 space-y-1.5 text-right">
                          <div className="flex justify-end">
                            <RootCauseBadge cause={record.rootCause} />
                          </div>
                          <p className="text-xs text-muted-foreground max-w-[200px] text-right">{record.suggestedActionLabel}</p>
                          {isNonFixable && (
                            <p className="text-[10px] text-muted-foreground italic">Requires manual review</p>
                          )}
                          {!isSelected && (
                            <button
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => selectAllWithCause(record.rootCause)}
                            >
                              Select all "{ROOT_CAUSE_META[record.rootCause].label}"
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Explanation */}
                      <div className="mt-2 ml-8 pl-3 border-l-2 border-border/50">
                        <p className="text-xs text-muted-foreground">{record.explanation}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Unassign safety gate */}
      <Dialog open={confirmUnassign} onOpenChange={(open) => { if (!open) { setConfirmUnassign(false); setConfirmText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Bulk Unassign
            </DialogTitle>
            <DialogDescription>
              This action will unassign <strong>{pendingVehicles.filter(v => v.suggestedAction === "unassign").length} vehicles</strong> across the following districts:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <ul className="text-sm space-y-1">
              {[...unassignDistricts.entries()].map(([district, count]) => (
                <li key={district} className="flex justify-between">
                  <span>District {district}</span>
                  <span className="font-semibold">{count} vehicles</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Type <strong>CONFIRM</strong> to proceed:</p>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmUnassign(false); setConfirmText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "CONFIRM" || bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ vehicles: pendingVehicles })}
            >
              {bulkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Proceed with Bulk Unassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress dialog */}
      {showProgress && activeRunId && (
        <RunProgressDialog
          runId={activeRunId}
          onClose={() => {
            setShowProgress(false);
            setActiveRunId(null);
            queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/bulk-runs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/mismatches"] });
          }}
          onForceConflicts={async (conflictTrucks) => {
            try {
              const res = await apiRequest("POST", "/api/fleet-ops/bulk-reconcile", {
                vehicles: conflictTrucks.map(c => ({
                  truckNumber: c.truckNumber,
                  action: "unassign",
                  ldapId: c.ldapId ?? c.outcome?.conflictTech ?? undefined,
                })),
                forceConflictTrucks: conflictTrucks.map(c => c.truckNumber),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({ message: "Request failed" }));
                toast({ title: "Force proceed failed", description: body.message, variant: "destructive" });
                return;
              }
              const data = await res.json();
              setActiveRunId(data.runId);
            } catch (err: any) {
              toast({ title: "Force proceed failed", description: err.message, variant: "destructive" });
            }
          }}
        />
      )}
    </MainContent>
  );
}
