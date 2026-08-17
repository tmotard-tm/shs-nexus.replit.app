import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  History,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ShieldQuestion,
  Ghost,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ByovMismatch {
  enterpriseId: string;
  fullName: string;
  truckNumber: string;
  holmanPass: boolean;
  holmanDetail: string;
  wmsPass: boolean;
  wmsDetail: string;
}

interface DriftCheckRun {
  id: number;
  run_at: string;
  triggered_by: string;
  total_checked: number;
  holman_fail_count: number;
  wms_fail_count: number;
  mismatches: ByovMismatch[];
  duration_ms: number;
  // Task 638 — creation read-back state carried by the same run.
  create_pending_count?: number;
  create_failed_count?: number;
  create_partial_count?: number;
  create_unverified_count?: number;
  create_issues?: CreateVerificationEntry[];
}

/**
 * Task 638 — a create is only real once the vehicle has been read back out of the
 * systems it was submitted to. Holman's submit is a queue receipt, not an applied
 * record, so these are the attempts that are still unconfirmed, failed verification,
 * or only partially landed.
 */
interface CreateVerificationEntry {
  auditId: number;
  vehicleNumber: string;
  vin: string | null;
  submittedBy: string;
  submittedAt: string;
  state: string;
  detail: string | null;
  attempts: number;
  verifiedAt: string | null;
  systems: Record<string, { checked: boolean; found: boolean; detail?: string }> | null;
  numberReleased: boolean;
  /** Confirmed real, but its number is still released and can be re-allocated. */
  reservationConflict?: boolean;
}

interface CreateVerificationReport {
  counts: { confirmed: number; pending: number; failed: number; partial: number; unverified: number };
  attention: CreateVerificationEntry[];
  windowDays: number;
}

interface PhantomCandidate {
  vehicleNumber: string;
  vin: string | null;
  dataSource: string | null;
  createdAt: string | null;
  lastHolmanSyncAt: string | null;
  auditId: number | null;
  submittedBy: string | null;
  submittedAt: string | null;
  verdict: string;
  reason: string;
  safeToPurge: boolean;
}

interface PhantomReport {
  runAt: string;
  scanned: number;
  phantoms: PhantomCandidate[];
  cleared: PhantomCandidate[];
  unverifiable: PhantomCandidate[];
  graceHours: number;
  incomplete: boolean;
  note: string;
  recentPurges?: Array<{
    id: number;
    vehicleNumber: string;
    purgedAt: string;
    purgedBy: string;
    numberReleased: boolean | null;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function durationLabel(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ pass }: { pass: boolean }) {
  return pass ? (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
      <CheckCircle2 className="h-3 w-3" /> Pass
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 gap-1">
      <XCircle className="h-3 w-3" /> Fail
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Mismatch table for a single run
// ---------------------------------------------------------------------------

function MismatchTable({ mismatches }: { mismatches: ByovMismatch[] }) {
  if (mismatches.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 py-3">
        <CheckCircle2 className="h-4 w-4" />
        All vehicles verified — no mismatches detected.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tech (LDAP)</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Truck</TableHead>
            <TableHead>Holman</TableHead>
            <TableHead>Holman Detail</TableHead>
            <TableHead>WMS</TableHead>
            <TableHead>WMS Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mismatches.map((m) => (
            <TableRow key={m.enterpriseId} className={(!m.holmanPass || !m.wmsPass) ? "bg-red-50 dark:bg-red-950/30" : ""}>
              <TableCell className="font-mono text-sm">{m.enterpriseId}</TableCell>
              <TableCell>{m.fullName || "—"}</TableCell>
              <TableCell className="font-mono text-sm">{m.truckNumber}</TableCell>
              <TableCell><StatusBadge pass={m.holmanPass} /></TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate" title={m.holmanDetail}>
                {m.holmanDetail}
              </TableCell>
              <TableCell><StatusBadge pass={m.wmsPass} /></TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate" title={m.wmsDetail}>
                {m.wmsDetail}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create read-back verification (Task 638)
// ---------------------------------------------------------------------------

const CREATE_STATE_STYLES: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  pending: { label: "Unconfirmed", className: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  partial: { label: "Partially created", className: "bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100" },
  failed: { label: "Failed verification", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  unverified: { label: "Could not verify", className: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100" },
};

function CreateStateBadge({ state }: { state: string }) {
  const style = CREATE_STATE_STYLES[state] ?? CREATE_STATE_STYLES.pending;
  return <Badge className={style.className}>{style.label}</Badge>;
}

function systemsSummary(systems: CreateVerificationEntry["systems"]) {
  if (!systems) return "—";
  return Object.keys(systems)
    .map((name) => {
      const s = systems[name];
      const mark = !s.checked ? "?" : s.found ? "✓" : "✗";
      return `${name} ${mark}`;
    })
    .join(" · ");
}

function CreateVerificationCard() {
  const { toast } = useToast();

  const query = useQuery<CreateVerificationReport>({
    queryKey: ["/api/byov/create-verification"],
    refetchOnWindowFocus: false,
  });

  const sweepMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/byov/create-verification/sweep");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/byov/create-verification"] });
      toast({
        title: "Read-back complete",
        description: `Re-checked ${data?.swept ?? 0} unresolved create(s) against Holman, WMS and TPMS.`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Read-back failed", description: err.message || "Unknown error", variant: "destructive" }),
  });

  const verifyOne = useMutation({
    mutationFn: async (auditId: number) => {
      const res = await apiRequest("POST", `/api/byov/create-verification/${auditId}/verify`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/byov/create-verification"] });
      const state = data?.outcome?.resolution?.state ?? "unknown";
      toast({ title: `Verification: ${state}`, description: data?.outcome?.resolution?.detail ?? "" });
    },
    onError: (err: any) =>
      toast({ title: "Verification failed", description: err.message || "Unknown error", variant: "destructive" }),
  });

  const counts = query.data?.counts;
  const attention = query.data?.attention ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldQuestion className="h-4 w-4" />
              Vehicle Create Verification
            </CardTitle>
            <CardDescription>
              Holman applies submissions asynchronously, so every create is read back out of Holman, WMS and
              TPMS before it counts. A create proven not to have landed is marked failed and its vehicle number
              is released. AMS is not checked — AMS records arrive from a downstream sync about 24 hours later.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sweepMutation.mutate()}
            disabled={sweepMutation.isPending}
            className="shrink-0"
          >
            {sweepMutation.isPending ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Re-checking…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Re-check now</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Could not load create verification state.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">Last {query.data?.windowDays ?? 14} days:</span>
              <span><span className="font-semibold">{counts?.confirmed ?? 0}</span> confirmed</span>
              <span><span className="font-semibold">{counts?.pending ?? 0}</span> unconfirmed</span>
              <span><span className="font-semibold">{counts?.partial ?? 0}</span> partial</span>
              <span><span className="font-semibold">{counts?.failed ?? 0}</span> failed</span>
              <span><span className="font-semibold">{counts?.unverified ?? 0}</span> unverifiable</span>
            </div>

            {attention.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 py-2">
                <CheckCircle2 className="h-4 w-4" />
                Every recent create has been confirmed in the systems it was submitted to.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>VIN</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Systems</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attention.map((entry) => (
                      <TableRow key={entry.auditId}>
                        <TableCell className="font-mono text-sm">{entry.vehicleNumber}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.vin ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {formatDate(entry.submittedAt)}
                          <div className="text-muted-foreground">{entry.submittedBy}</div>
                        </TableCell>
                        <TableCell>
                          <CreateStateBadge state={entry.state} />
                          {entry.reservationConflict ? (
                            <div className="text-[11px] text-red-600 font-medium mt-1">
                              confirmed, but number still released — resolve before it is reused
                            </div>
                          ) : (
                            entry.numberReleased && (
                              <div className="text-[11px] text-muted-foreground mt-1">number released</div>
                            )
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{systemsSummary(entry.systems)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[320px]">{entry.detail ?? "—"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => verifyOne.mutate(entry.auditId)}
                            disabled={verifyOne.isPending}
                          >
                            Verify
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phantom vehicle reconciliation + reviewed cleanup (Task 638)
// ---------------------------------------------------------------------------

function PhantomVehiclesCard() {
  const { toast } = useToast();
  const [report, setReport] = useState<PhantomReport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/byov/phantom-vehicles", { credentials: "include" });
      if (!res.ok) throw new Error((await res.text()) || "Scan failed");
      return (await res.json()) as PhantomReport;
    },
    onSuccess: (data) => {
      setReport(data);
      setSelected(data.phantoms.map((p) => p.vehicleNumber));
      toast({
        title: "Reconciliation complete",
        description: `${data.phantoms.length} phantom row(s) found in ${data.scanned} unsynced cache row(s).`,
      });
    },
    onError: (err: any) =>
      toast({ title: "Reconciliation failed", description: err.message || "Unknown error", variant: "destructive" }),
  });

  const purgeMutation = useMutation({
    mutationFn: async (vehicleNumbers: string[]) => {
      const res = await apiRequest("POST", "/api/byov/phantom-vehicles/purge", { vehicleNumbers, confirm: true });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cleanup complete",
        description: `Removed ${data?.purged?.length ?? 0} phantom row(s); ${data?.skipped?.length ?? 0} skipped.`,
      });
      scanMutation.mutate();
    },
    onError: (err: any) =>
      toast({ title: "Cleanup failed", description: err.message || "Unknown error", variant: "destructive" }),
  });

  const toggle = (num: string) =>
    setSelected((prev) => (prev.indexOf(num) !== -1 ? prev.filter((n) => n !== num) : prev.concat(num)));

  const confirmPurge = () => {
    if (selected.length === 0) return;
    const ok = window.confirm(
      `Remove ${selected.length} phantom cache row(s) and release their vehicle numbers?\n\n` +
        `${selected.join(", ")}\n\n` +
        `This deletes local cache rows only — nothing is removed from Holman, WMS or TPMS. ` +
        `Every number is re-checked against live Holman before it is touched.`,
    );
    if (ok) purgeMutation.mutate(selected);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Ghost className="h-4 w-4" />
              Phantom Vehicles
            </CardTitle>
            <CardDescription>
              Locally cached vehicles that live Holman does not have and that trace back to an optimistic
              create. They hold a vehicle number that does not exist. Scanning is read-only; removal is a
              separate, confirmed step and deletes local cache rows only.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="shrink-0"
          >
            {scanMutation.isPending ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Scanning…</>
            ) : (
              <><PlayCircle className="h-4 w-4 mr-2" /> Scan cache</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!report ? (
          <p className="text-sm text-muted-foreground">
            Run a scan to compare unsynced cache rows against live Holman.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><span className="font-semibold">{report.scanned}</span> rows examined</span>
              <span><span className="font-semibold">{report.phantoms.length}</span> phantoms</span>
              <span><span className="font-semibold">{report.cleared.length}</span> cleared</span>
              <span><span className="font-semibold">{report.unverifiable.length}</span> unverifiable</span>
              <span className="text-muted-foreground">grace window {report.graceHours}h</span>
            </div>

            {report.incomplete && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {report.unverifiable.length} row(s) could not be checked against Holman, so this report is
                  incomplete. Those rows are never treated as phantoms.
                </AlertDescription>
              </Alert>
            )}

            {report.phantoms.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 py-2">
                <CheckCircle2 className="h-4 w-4" />
                No phantom rows — every unsynced cache row is either real, too new to judge, or unrelated to a create.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Vehicle</TableHead>
                        <TableHead>VIN</TableHead>
                        <TableHead>Cached</TableHead>
                        <TableHead>Created by</TableHead>
                        <TableHead>Why it is a phantom</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.phantoms.map((p) => (
                        <TableRow key={p.vehicleNumber}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selected.indexOf(p.vehicleNumber) !== -1}
                              onChange={() => toggle(p.vehicleNumber)}
                              aria-label={`Select ${p.vehicleNumber}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{p.vehicleNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{p.vin ?? "—"}</TableCell>
                          <TableCell className="text-xs">{p.createdAt ? formatDate(p.createdAt) : "—"}</TableCell>
                          <TableCell className="text-xs">{p.submittedBy ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[380px]">{p.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={confirmPurge}
                    disabled={selected.length === 0 || purgeMutation.isPending}
                  >
                    {purgeMutation.isPending ? (
                      <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Removing…</>
                    ) : (
                      <><Trash2 className="h-4 w-4 mr-2" /> Remove {selected.length} selected</>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Local cache only — Holman, WMS and TPMS records are never deleted.
                  </span>
                </div>
              </>
            )}

            {(report.recentPurges?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground">
                Recently removed:{" "}
                {report.recentPurges!.map((p) => `${p.vehicleNumber} (${formatDate(p.purgedAt)}, ${p.purgedBy})`).join(" · ")}
              </div>
            )}

            <p className="text-xs text-muted-foreground">{report.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History row (collapsible)
// ---------------------------------------------------------------------------

function HistoryRow({ run }: { run: DriftCheckRun }) {
  const [expanded, setExpanded] = useState(false);
  const createIssues =
    (run.create_pending_count ?? 0) +
    (run.create_failed_count ?? 0) +
    (run.create_partial_count ?? 0) +
    (run.create_unverified_count ?? 0);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm">{formatDate(run.run_at)}</TableCell>
        <TableCell className="text-sm text-muted-foreground">{run.triggered_by}</TableCell>
        <TableCell className="text-sm">{run.total_checked}</TableCell>
        <TableCell>
          {run.holman_fail_count > 0 ? (
            <Badge variant="destructive">{run.holman_fail_count} failed</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">All pass</Badge>
          )}
        </TableCell>
        <TableCell>
          {run.wms_fail_count > 0 ? (
            <Badge variant="destructive">{run.wms_fail_count} failed</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">All pass</Badge>
          )}
        </TableCell>
        <TableCell>
          {createIssues > 0 ? (
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              {createIssues} unresolved
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">All confirmed</Badge>
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{durationLabel(run.duration_ms)}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-4 space-y-4">
            <MismatchTable mismatches={run.mismatches ?? []} />
            {(run.create_issues?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium">Creates awaiting or failing verification</div>
                {run.create_issues!.map((c) => (
                  <div key={c.auditId} className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.vehicleNumber}</span> — {CREATE_STATE_STYLES[c.state]?.label ?? c.state}
                    {c.detail ? `: ${c.detail}` : ""}
                  </div>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ByovDriftCheck() {
  const { toast } = useToast();
  const [runResult, setRunResult] = useState<DriftCheckRun | null>(null);

  const latestQuery = useQuery<{ latest: DriftCheckRun | null }>({
    queryKey: ["/api/byov/verify/latest"],
    refetchOnWindowFocus: false,
  });

  const historyQuery = useQuery<{ history: DriftCheckRun[] }>({
    queryKey: ["/api/byov/verify/history"],
    refetchOnWindowFocus: false,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/byov/verify");
      return res.json();
    },
    onSuccess: async (data: any) => {
      const result: DriftCheckRun = data?.result ?? data;
      queryClient.invalidateQueries({ queryKey: ["/api/byov/create-verification"] });
      setRunResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/byov/verify/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/byov/verify/latest"] });

      const fails = (result.holman_fail_count ?? 0) + (result.wms_fail_count ?? 0);
      if (fails === 0) {
        toast({ title: "Verification complete", description: `All ${result.total_checked} vehicles passed.` });
      } else {
        toast({
          title: "Mismatches detected",
          description: `${fails} failure(s) found across ${result.total_checked} vehicles.`,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Verification failed", description: err.message || "Unknown error", variant: "destructive" });
    },
  });

  const latest = runResult ?? latestQuery.data?.latest ?? null;
  const history = historyQuery.data?.history ?? [];

  return (
    <MainContent>
      <TopBar title="BYOV Assignment Drift Check" />

      <div className="p-6 space-y-6">
        {/* Header + run button */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">BYOV Assignment Drift Check</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Verifies that every enrolled BYOV technician's vehicle assignment is correctly reflected
              in both Holman and WMS. Runs automatically every night at 2:00 AM EST.
            </p>
          </div>
          <Button
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="shrink-0"
          >
            {verifyMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Run Now
              </>
            )}
          </Button>
        </div>

        {/* In-progress notice */}
        {verifyMutation.isPending && (
          <Alert>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <AlertDescription>
              Verification in progress — querying Holman and WMS for each enrolled technician.
              This may take a few minutes depending on the number of enrolled vehicles.
            </AlertDescription>
          </Alert>
        )}

        {/* Latest run result */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Latest Run
            </CardTitle>
            {latest && (
              <CardDescription>
                {formatDate(latest.run_at)} · triggered by {latest.triggered_by} ·{" "}
                {durationLabel(latest.duration_ms)}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {latestQuery.isLoading && !runResult ? (
              <Skeleton className="h-24 w-full" />
            ) : latest ? (
              <div className="space-y-4">
                {/* Summary chips */}
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Checked:</span>
                    <span className="font-semibold">{latest.total_checked}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Holman:</span>
                    {latest.holman_fail_count > 0 ? (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        {latest.holman_fail_count} failed
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        All pass
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">WMS:</span>
                    {latest.wms_fail_count > 0 ? (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        {latest.wms_fail_count} failed
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        All pass
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Mismatch detail */}
                {(latest.mismatches?.length ?? 0) > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {latest.mismatches.length} vehicle(s) have assignment mismatches. Review the
                      table below and re-run the bulk assignment script to correct them.
                    </AlertDescription>
                  </Alert>
                )}

                <MismatchTable mismatches={latest.mismatches ?? []} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No runs yet. Click "Run Now" to perform the first check.</p>
            )}
          </CardContent>
        </Card>

        {/* Create read-back verification (Task 638) */}
        <CreateVerificationCard />

        {/* Phantom cache rows left behind by the old optimistic create (Task 638) */}
        <PhantomVehiclesCard />

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Run History
            </CardTitle>
            <CardDescription>
              The last {history.length} verification run{history.length !== 1 ? "s" : ""}. Click a row
              to expand the mismatch details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Run At</TableHead>
                      <TableHead>Triggered By</TableHead>
                      <TableHead>Checked</TableHead>
                      <TableHead>Holman</TableHead>
                      <TableHead>WMS</TableHead>
                      <TableHead>Creates</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((run) => (
                      <HistoryRow key={run.id} run={run} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainContent>
  );
}
