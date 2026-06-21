import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ShieldX,
  AlertTriangle,
  PlayCircle,
  CheckCircle2,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import { useState } from "react";

interface ItemCounts {
  total: number;
  actionable: number;
  verified: number;
  applied: number;
  failed: number;
  flagged: number;
  held: number;
  skipped: number;
  byStatus: Record<string, number>;
}

interface RunRow {
  id: string;
  kind: string;
  status: string;
  acceptedFileDate: string | null;
  killSwitch: boolean;
  alertMessage: string | null;
  requestedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  verifiedAt: string | null;
  itemCounts: ItemCounts;
}

interface AutomationState {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
    case "verified":
      return "default";
    case "halted":
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

export default function ReconciliationAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);

  const isDeveloper = user?.role === "developer";

  const runsQuery = useQuery<{ runs: RunRow[] }>({
    queryKey: ["/api/admin/reconciliation/runs"],
    enabled: isDeveloper,
  });

  const automationQuery = useQuery<AutomationState>({
    queryKey: ["/api/admin/reconciliation/automation"],
    enabled: isDeveloper,
  });

  const applyMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/admin/reconciliation/runs/${runId}/kick`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      const outcomes = data?.byOutcome ? JSON.stringify(data.byOutcome) : "{}";
      toast({
        title: "Apply complete",
        description: `Processed ${data?.processed ?? 0} · remaining ${data?.remainingActionable ?? 0} · ${outcomes}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reconciliation/runs"] });
    },
    onError: (e: any) =>
      toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/admin/reconciliation/runs/${runId}/verify`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      const outcomes = data?.byOutcome ? JSON.stringify(data.byOutcome) : "{}";
      toast({
        title: "Verify complete",
        description: `Scanned ${data?.scanned ?? 0} · ${outcomes}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reconciliation/runs"] });
    },
    onError: (e: any) =>
      toast({ title: "Verify failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("PUT", "/api/admin/reconciliation/automation", { enabled });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data?.enabled ? "Automation ON" : "Automation OFF",
        description: data?.enabled
          ? "Nightly runs will auto-apply and verify with NO human review."
          : "Nightly runs will materialize only (corrections stay manual).",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reconciliation/automation"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed to update automation", description: e.message, variant: "destructive" }),
  });

  if (!isDeveloper) {
    return (
      <div className="flex items-center justify-center p-10">
        <Card className="max-w-md w-full" data-testid="card-access-denied">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <ShieldX className="h-14 w-14 text-destructive" />
            </div>
            <CardTitle>Developer access only</CardTitle>
            <CardDescription>
              The Reconciliation Admin tools are restricted to developer accounts.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const automation = automationQuery.data;
  const runs = runsQuery.data?.runs ?? [];

  const handleSwitch = (checked: boolean) => {
    if (checked) {
      setConfirmEnableOpen(true);
    } else {
      toggleMutation.mutate(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
          Reconciliation Admin
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review nightly reconciliation runs and apply/verify the proposed Holman / WMS / AMS
          corrections. Triggering an Apply performs REAL downstream writes.
        </p>
      </div>

      {/* Automation toggle */}
      <Card data-testid="card-automation">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RefreshCcw className="h-5 w-5" />
                Automate nightly corrections
              </CardTitle>
              <CardDescription className="mt-1">
                When ON, the deployed app automatically applies and verifies every nightly run with
                no human review. When OFF, nightly runs only materialize proposals for manual review
                below.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {automationQuery.isLoading ? (
                <Skeleton className="h-6 w-11 rounded-full" />
              ) : (
                <>
                  <span
                    className={`text-sm font-medium ${automation?.enabled ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`}
                    data-testid="text-automation-state"
                  >
                    {automation?.enabled ? "ON" : "OFF"}
                  </span>
                  <Switch
                    checked={automation?.enabled ?? false}
                    onCheckedChange={handleSwitch}
                    disabled={toggleMutation.isPending}
                    data-testid="switch-automation"
                    aria-label="Toggle nightly auto-apply"
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Turning automation ON removes the human review gate. The 7:30&nbsp;AM&nbsp;ET nightly
              job will drain and verify each run automatically, writing to Holman, WMS, and AMS.
              {automation?.updatedBy ? (
                <>
                  {" "}
                  Last changed by <span className="font-medium">{automation.updatedBy}</span> on{" "}
                  {fmt(automation.updatedAt)}.
                </>
              ) : null}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Runs table */}
      <Card data-testid="card-runs">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>The 25 most recent reconciliation runs.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isFetching}
              data-testid="button-refresh-runs"
            >
              {runsQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : runsQuery.isError ? (
            <div className="text-sm text-destructive" data-testid="text-runs-error">
              Failed to load runs: {(runsQuery.error as any)?.message}
            </div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-runs">
              No reconciliation runs yet.
            </div>
          ) : (
            <TooltipProvider>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">To apply</TableHead>
                      <TableHead className="text-right">Verified</TableHead>
                      <TableHead className="text-right">Issues</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const c = run.itemCounts;
                      const issues = c.failed + c.flagged + c.held;
                      const applying = applyMutation.isPending && applyMutation.variables === run.id;
                      const verifying = verifyMutation.isPending && verifyMutation.variables === run.id;
                      const busy = applying || verifying;
                      return (
                        <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                          <TableCell className="whitespace-nowrap text-sm">{fmt(run.createdAt)}</TableCell>
                          <TableCell className="text-sm">{run.kind}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={statusVariant(run.status)} data-testid={`badge-status-${run.id}`}>
                                {run.status}
                              </Badge>
                              {run.killSwitch && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive">kill</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>Kill switch is set — kicks are blocked.</TooltipContent>
                                </Tooltip>
                              )}
                              {run.alertMessage && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">{run.alertMessage}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.total}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            <span className={c.actionable > 0 ? "font-medium" : "text-muted-foreground"}>
                              {c.actionable}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.verified}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {issues > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-amber-600 dark:text-amber-500 font-medium cursor-default">
                                    {issues}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  failed {c.failed} · flagged {c.flagged} · held {c.held} · skipped {c.skipped}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="default"
                                disabled={busy || run.killSwitch || c.actionable === 0}
                                onClick={() => applyMutation.mutate(run.id)}
                                data-testid={`button-apply-${run.id}`}
                              >
                                {applying ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <PlayCircle className="h-4 w-4" />
                                )}
                                <span className="ml-1.5">Apply</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => verifyMutation.mutate(run.id)}
                                data-testid={`button-verify-${run.id}`}
                              >
                                {verifying ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                <span className="ml-1.5">Verify</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* Confirm enabling automation */}
      <AlertDialog open={confirmEnableOpen} onOpenChange={setConfirmEnableOpen}>
        <AlertDialogContent data-testid="dialog-confirm-automation">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on full automation?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the human review step. Every nightly run will be applied and verified
              automatically, performing real writes to Holman, WMS, and AMS. You can turn it off
              again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-automation">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleMutation.mutate(true)}
              data-testid="button-confirm-automation"
            >
              Turn on automation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
