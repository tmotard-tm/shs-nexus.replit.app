import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  Gauge,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

/**
 * Truck Maintenance monitoring screen (Task #664).
 *
 * Read-only by design: staff MONITOR this workflow, they do not drive it. The
 * only writes are the three a human genuinely needs — retry one failed cycle,
 * pause cycle-opening, and run the sweep now.
 *
 * The page leads with the gates, because "why has nothing gone out?" is nearly
 * always answered by a gate rather than by the cycle table.
 */

interface WorkflowStatus {
  triggerMiles: number;
  blockDurationMinutes: number;
  bookingLeadDays: number;
  smsLive: boolean;
  bookingLive: boolean;
  activityTypeConfirmed: boolean;
  activityType: string | null;
  paused: boolean;
  lastSweepDateET: string | null;
  todayET: string;
  watermarks: number;
  openByStatus: Record<string, number>;
  openTotal: number;
  bookedTotal: number;
  exclusionLabels: Record<string, string>;
}

interface Cycle {
  id: number;
  truck_number: string;
  vin: string | null;
  ldap: string | null;
  tech_name: string | null;
  district: string | null;
  status: string;
  odometer_at_trigger: number;
  watermark_at_trigger: number;
  miles_since_watermark: number;
  odometer_source: string | null;
  odometer_date: string | null;
  exclusion_reason: string | null;
  exclusion_detail: string | null;
  text_status: string | null;
  text_body: string | null;
  text_detail: string | null;
  texted_at: string | null;
  booking_due_at: string | null;
  booking_date: string | null;
  booking_status: string | null;
  booking_project_name: string | null;
  booking_project_id: string | null;
  booking_detail: string | null;
  booking_test_status: string | null;
  booking_test_detail: string | null;
  booking_test_project_name: string | null;
  booking_test_at: string | null;
  booked_at: string | null;
  attempts: number;
  last_error: string | null;
  opened_at: string;
  closed_at: string | null;
}

function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtMiles(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 border-blue-200",
  texted: "bg-amber-100 text-amber-800 border-amber-200",
  booked: "bg-green-100 text-green-800 border-green-200",
  excluded: "bg-slate-100 text-slate-700 border-slate-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  // An upstream filing we cannot confirm. Deliberately not red-as-failure and
  // deliberately not retryable: a human has to ask DCA what happened.
  needs_review: "bg-purple-100 text-purple-800 border-purple-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700"}>
      {status}
    </Badge>
  );
}

function GateCard(props: {
  title: string;
  live: boolean;
  description: string;
  note?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {props.icon}
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={props.live
              ? "bg-green-100 text-green-800 border-green-200"
              : "bg-slate-100 text-slate-700 border-slate-200"}
          >
            {props.live ? "LIVE" : "DRY RUN"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">{props.description}</p>
        {props.note ? <p className="text-xs text-amber-700 mt-1">{props.note}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function TruckMaintenance() {
  const { toast } = useToast();
  const [showClosed, setShowClosed] = useState(false);

  const statusQuery = useQuery<WorkflowStatus>({
    queryKey: ["/api/fs/truck-maintenance/status"],
    refetchInterval: 60_000,
  });

  const cyclesQuery = useQuery<{ cycles: Cycle[] }>({
    queryKey: ["/api/fs/truck-maintenance/cycles", showClosed ? "all" : "open"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/fs/truck-maintenance/cycles?limit=500${showClosed ? "" : "&openOnly=true"}`,
      );
      return res.json();
    },
    refetchInterval: 60_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/fs/truck-maintenance/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fs/truck-maintenance/cycles"] });
  }

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      const res = await apiRequest("POST", "/api/fs/truck-maintenance/pause", { paused });
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidate();
      toast({
        title: data?.paused ? "Cycle opening paused" : "Cycle opening resumed",
        description: data?.paused
          ? "No new maintenance cycles will open. Cycles already in flight continue."
          : "New maintenance cycles will open on the next sweep.",
      });
    },
    onError: (e: any) => toast({ title: "Could not change the kill switch", description: e?.message, variant: "destructive" }),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fs/truck-maintenance/run", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidate();
      const s = data?.summary;
      toast({
        title: "Sweep complete",
        description: s
          ? `${s.candidates} trucks checked · ${s.seeded} seeded · ${s.opened} opened · ${s.texted} texted · ${s.booked} booked · ${s.excluded} excluded`
          : "Done",
      });
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: e?.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (args: { id: number; testFiling?: boolean }) => {
      const res = await apiRequest(
        "POST",
        `/api/fs/truck-maintenance/cycles/${args.id}/retry`,
        { testFiling: args.testFiling === true },
      );
      return res.json();
    },
    onSuccess: (data: any) => {
      invalidate();
      toast({
        title: "Retry finished",
        description: data?.outcome ? `${data.outcome.step}: ${data.outcome.action}` : "Done",
      });
    },
    onError: (e: any) => toast({ title: "Retry failed", description: e?.message, variant: "destructive" }),
  });

  const status = statusQuery.data;
  const cycles = cyclesQuery.data?.cycles ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gauge className="h-6 w-6" />
            Truck Maintenance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {status
              ? `A cycle opens automatically when a truck's odometer runs ${fmtMiles(status.triggerMiles)} miles past its last service point. `
                + `The technician is texted, then a ${status.blockDurationMinutes / 60}-hour "Truck Maintenance" block is filed `
                + `${status.bookingLeadDays} days later.`
              : "Odometer-driven routine maintenance scheduling."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { statusQuery.refetch(); cyclesQuery.refetch(); }}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            data-testid="button-run-sweep"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            {runMutation.isPending ? "Running…" : "Run sweep now"}
          </Button>
        </div>
      </div>

      {statusQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : status ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <GateCard
              title="Text technicians"
              live={status.smsLive}
              icon={<MessageSquare className="h-4 w-4" />}
              description={status.smsLive
                ? "Heads-up texts go to real technicians through the fleet comms lane."
                : "Every check runs, the message is recorded, nothing is sent. Cycles stay open so arming the gate still sends the first real text."}
            />
            <GateCard
              title="File 4-hour blocks"
              live={status.bookingLive}
              icon={<CalendarClock className="h-4 w-4" />}
              description={status.bookingLive
                ? "Blocks are filed on real technician routes via the Event Request API."
                : "The payload is built and stored for inspection, but nothing is sent upstream."}
              note={status.activityTypeConfirmed
                ? undefined
                : "ActivityType not configured — confirm the value with the DCA side before the live gate can arm."}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <PauseCircle className="h-4 w-4" />
                  Kill switch
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={status.paused}
                    onCheckedChange={(v) => pauseMutation.mutate(v)}
                    disabled={pauseMutation.isPending}
                    data-testid="switch-pause"
                  />
                  <span className="text-sm">{status.paused ? "Opening paused" : "Opening active"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Pauses new cycles only. Cycles already in flight keep running.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Open cycles</span>
                  <span data-testid="text-open-total">{status.openTotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booked (all time)</span>
                  <span>{status.bookedTotal}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trucks watermarked</span>
                  <span>{status.watermarks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last sweep</span>
                  <span>{status.lastSweepDateET ?? "never"}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {Object.keys(status.openByStatus).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(status.openByStatus).map(([s, n]) => (
                <Badge key={s} variant="outline" className={STATUS_STYLES[s] ?? ""}>
                  {s}: {n}
                </Badge>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Could not load the workflow status.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Maintenance cycles</CardTitle>
            <CardDescription>
              Ineligible trucks stay listed with the reason they were skipped — they are never silently dropped.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={showClosed} onCheckedChange={setShowClosed} data-testid="switch-show-closed" />
            <span>Include closed</span>
          </div>
        </CardHeader>
        <CardContent>
          {cyclesQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : cycles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No maintenance cycles yet. Watermarks are seeded from each truck's current odometer, so the first
              cycles open once a truck has driven {status ? fmtMiles(status.triggerMiles) : "5,500"} miles.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Odometer</TableHead>
                    <TableHead className="text-right">Since last</TableHead>
                    <TableHead>Text</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Reason / error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cycles.map((c) => (
                    <TableRow key={c.id} data-testid={`row-cycle-${c.id}`}>
                      <TableCell className="font-medium">
                        {c.truck_number}
                        {c.district ? <div className="text-xs text-muted-foreground">Unit {c.district}</div> : null}
                      </TableCell>
                      <TableCell>
                        {c.ldap ?? "—"}
                        {c.tech_name ? <div className="text-xs text-muted-foreground">{c.tech_name}</div> : null}
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMiles(c.odometer_at_trigger)}
                        {c.odometer_source
                          ? <div className="text-xs text-muted-foreground">{c.odometer_source}</div>
                          : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(c.miles_since_watermark)}</TableCell>
                      <TableCell className="text-xs">
                        {c.text_status ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="underline decoration-dotted cursor-help">{c.text_status}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">
                                <p className="text-xs">{c.text_body ?? "—"}</p>
                                {c.text_detail ? <p className="text-xs mt-1 opacity-80">{c.text_detail}</p> : null}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : "—"}
                        {c.texted_at ? <div className="text-muted-foreground">{fmtDate(c.texted_at)}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.booking_status === "unknown" || c.booking_status === "needs_review" ? (
                          <span className="text-purple-800 font-medium">{c.booking_status}</span>
                        ) : (c.booking_status ?? "—")}
                        {c.booking_date ? <div className="text-muted-foreground">for {c.booking_date}</div> : null}
                        {c.booking_project_name
                          ? <div className="text-muted-foreground">{c.booking_project_name}</div>
                          : null}
                        {!c.booking_status && c.booking_due_at
                          ? <div className="text-muted-foreground">due {fmtDate(c.booking_due_at)}</div>
                          : null}
                        {/* TEST evidence is shown separately because it is a
                            separate upstream row — it never stands in for the
                            real block and never blocks it. */}
                        {c.booking_test_status
                          ? (
                            <div className="text-muted-foreground">
                              TEST: {c.booking_test_status}
                              {c.booking_test_project_name ? ` · ${c.booking_test_project_name}` : ""}
                            </div>
                          )
                          : null}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs">
                        {c.exclusion_reason ? (
                          <span className="flex items-start gap-1">
                            <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0 text-slate-500" />
                            <span>
                              {status?.exclusionLabels?.[c.exclusion_reason] ?? c.exclusion_reason}
                              {c.exclusion_detail
                                ? <span className="block text-muted-foreground">{c.exclusion_detail}</span>
                                : null}
                            </span>
                          </span>
                        ) : c.last_error ? (
                          <span className="text-red-700">{c.last_error}</span>
                        ) : c.status === "booked" ? (
                          <span className="flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-3 w-3" /> {c.booking_detail ?? "booked"}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.closed_at ? (
                          <span className="text-xs text-muted-foreground">closed</span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            {/* An unconfirmed filing is not retryable: the request
                                reached DCA and there is no way to ask what became
                                of it, so re-firing could double-book the tech. */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retryMutation.mutate({ id: c.id })}
                              disabled={
                                retryMutation.isPending
                                || c.booking_status === "unknown"
                                || c.booking_status === "needs_review"
                              }
                              title={
                                c.booking_status === "unknown" || c.booking_status === "needs_review"
                                  ? "Confirm with DCA whether the block exists before re-filing"
                                  : undefined
                              }
                              data-testid={`button-retry-${c.id}`}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Retry
                            </Button>
                            {c.status === "texted" ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => retryMutation.mutate({ id: c.id, testFiling: true })}
                                      disabled={retryMutation.isPending}
                                      data-testid={`button-test-file-${c.id}`}
                                    >
                                      <FlaskConical className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs max-w-xs">
                                      Files ONE TEST-prefixed block to prove the connection. It does not close the
                                      cycle and does not advance the odometer watermark.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
