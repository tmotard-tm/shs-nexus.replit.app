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
// History row (collapsible)
// ---------------------------------------------------------------------------

function HistoryRow({ run }: { run: DriftCheckRun }) {
  const [expanded, setExpanded] = useState(false);
  const totalFails = run.holman_fail_count + run.wms_fail_count;

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
        <TableCell className="text-sm text-muted-foreground">{durationLabel(run.duration_ms)}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-4">
            <MismatchTable mismatches={run.mismatches ?? []} />
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
    mutationFn: () => apiRequest("POST", "/api/byov/verify"),
    onSuccess: async (data: any) => {
      const result: DriftCheckRun = data?.result ?? data;
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
