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
  TrendingUp,
} from "lucide-react";

/**
 * Truck Maintenance monitoring screen (Task #664 + #676).
 *
 * Read-only by design: staff MONITOR this workflow, they do not drive it. The
 * only writes are the three a human genuinely needs — retry one failed cycle,
 * pause cycle-opening, and run the sweep now.
 *
 * Task #676 additions:
 *  - The Cycle table now shows the Enterprise ID, the 8-day scheduling window,
 *    and the confirmation follow-up state.
 *  - A new "Approaching threshold" section below the cycle table shows trucks
 *    within N miles of the 5,500-mile trigger that do not yet have an open
 *    cycle, so staff can see who is coming up before any text goes out.
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
  /** Days a cycle may sit blocked by the same reason before it is flagged. */
  staleExclusionDays: number;
  /** Open excluded cycles blocked past that threshold. */
  staleBlockedCount: number;
  exclusionLabels: Record<string, string>;
  missingOdometer: { assigned: number; byov: number; unassigned: number; total: number } | null;
  missingOdometerError: string | null;
}

interface MissingOdometerTruck {
  truckNumber: string;
  vin: string | null;
  lastReading: number | null;
  lastReadingDate: string | null;
  lastReadingSource: string | null;
  reason: string;
  ldap: string | null;
  techName: string | null;
  district: string | null;
}

interface MissingOdometerReport {
  counts: { assigned: number; byov: number; unassigned: number; total: number };
  trucks: MissingOdometerTruck[];
  reasonLabels: Record<string, string>;
  generatedAt: string;
}

interface Cycle {
  id: number;
  truck_number: string;
  vin: string | null;
  ldap: string | null;
  /** Enterprise ID used as TechnicianId in the DCA booking payload. */
  enterprise_id: string | null;
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
  /** When the cycle FIRST became blocked by its current reason (Task #674). */
  exclusion_since: string | null;
  /** Whole days blocked by the same reason; null when not excluded. */
  blocked_days: number | null;
  /** Server-computed: blocked_days >= the configured threshold. */
  stale_blocked: boolean;
  /** Current reconciled odometer from the vehicle cache, when available. */
  current_odometer: number | null;
  /** current_odometer - odometer_at_trigger. */
  miles_past_trigger: number | null;
  text_status: string | null;
  text_body: string | null;
  text_detail: string | null;
  texted_at: string | null;
  trigger_date: string | null;
  booking_window_start: string | null;
  booking_window_end: string | null;
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
  confirmation_status: string | null;
  confirmed_slot_date: string | null;
  confirmed_slot_time: string | null;
  follow_up_claimed_at: string | null;
  follow_up_sent_at: string | null;
  attempts: number;
  last_error: string | null;
  opened_at: string;
  closed_at: string | null;
}

/** Row from the uncapped overdue endpoint (Task #674). */
interface OverdueCycle {
  id: number;
  truck_number: string;
  ldap: string | null;
  enterprise_id: string | null;
  tech_name: string | null;
  exclusion_reason: string;
  exclusion_detail: string | null;
  exclusion_since: string;
  blocked_days: number;
  odometer_at_trigger: number;
  current_odometer: number | null;
  miles_past_trigger: number | null;
}

interface ApproachingTruck {
  truckNumber: string;
  vin: string | null;
  odometer: number;
  watermark: number;
  milesSinceWatermark: number;
  milesRemaining: number;
  odometerDate: string | null;
  odometerSource: string | null;
  ldap: string | null;
  techName: string | null;
  district: string | null;
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
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [slotDate, setSlotDate] = useState("");
  const [slotTime, setSlotTime] = useState("");

  const approachingQuery = useQuery<{ trucks: ApproachingTruck[]; approachingMiles: number; triggerMiles: number }>({
    queryKey: ["/api/fs/truck-maintenance/approaching"],
    refetchInterval: 120_000,
  });

  const statusQuery = useQuery<WorkflowStatus>({
    queryKey: ["/api/fs/truck-maintenance/status"],
    refetchInterval: 60_000,
  });

  const missingOdometerQuery = useQuery<MissingOdometerReport>({
    queryKey: ["/api/fs/truck-maintenance/missing-odometer"],
    // The report is served from a short server-side cache over daily-refreshed
    // sources — 5 minutes keeps it current without hammering the TPMS mirror.
    refetchInterval: 5 * 60_000,
  });

  // The complete overdue set — its own uncapped endpoint, NOT derived from
  // the (limited, newest-first) cycle list below.
  const staleQuery = useQuery<{ cycles: OverdueCycle[]; staleExclusionDays: number }>({
    queryKey: ["/api/fs/truck-maintenance/stale-blocked"],
    refetchInterval: 5 * 60_000,
  });

  const cyclesQuery = useQuery<{ cycles: Cycle[]; staleExclusionDays: number }>({
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
    queryClient.invalidateQueries({ queryKey: ["/api/fs/truck-maintenance/approaching"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fs/truck-maintenance/missing-odometer"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fs/truck-maintenance/stale-blocked"] });
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

  const confirmSlotMutation = useMutation({
    mutationFn: async (args: { id: number; slotDate: string; slotTime?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/fs/truck-maintenance/cycles/${args.id}/confirm`,
        { slotDate: args.slotDate, slotTime: args.slotTime || null },
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      setConfirmingId(null);
      setSlotDate("");
      setSlotTime("");
      toast({ title: "Confirmed slot recorded", description: "The follow-up text will be sent on the next sweep." });
    },
    onError: (e: any) => toast({ title: "Could not record slot", description: e?.message, variant: "destructive" }),
  });

  const status = statusQuery.data;
  const cycles = cyclesQuery.data?.cycles ?? [];
  const staleDays = staleQuery.data?.staleExclusionDays
    ?? cyclesQuery.data?.staleExclusionDays
    ?? status?.staleExclusionDays
    ?? 14;
  // "Overdue — needs a human" (Task #674): the COMPLETE set from its own
  // uncapped endpoint — the general cycle list is limited and newest-first,
  // so deriving this client-side would drop exactly the oldest blocked
  // cycles once the table outgrows the cap. Server order: oldest block first.
  const overdue = staleQuery.data?.cycles ?? [];

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
                {status.staleBlockedCount > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Blocked &gt; {status.staleExclusionDays}d</span>
                    <span className="text-red-700 font-medium" data-testid="text-stale-blocked-count">
                      {status.staleBlockedCount}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trucks watermarked</span>
                  <span>{status.watermarks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No odometer reading</span>
                  {status.missingOdometerError ? (
                    <span className="text-red-700" title={status.missingOdometerError} data-testid="text-missing-odometer">
                      unavailable
                    </span>
                  ) : (
                    <span
                      className={status.missingOdometer && status.missingOdometer.assigned > 0 ? "text-amber-700 font-medium" : undefined}
                      data-testid="text-missing-odometer"
                    >
                      {status.missingOdometer ? status.missingOdometer.assigned : "—"}
                    </span>
                  )}
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

      {overdue.length > 0 ? (
        <Card className="border-red-300" data-testid="card-overdue-blocked">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              Overdue — blocked more than {staleDays} days ({overdue.length})
            </CardTitle>
            <CardDescription>
              These cycles have been stuck on the same reason past the threshold. The sweep keeps re-checking
              them, but they will not move until a human chases the shop, the assignment, or the data — and the
              trucks keep driving past their service interval in the meantime.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>Blocked</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">At trigger</TableHead>
                    <TableHead className="text-right">Now</TableHead>
                    <TableHead className="text-right">Past trigger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map((c) => (
                    <TableRow key={`overdue-${c.id}`} data-testid={`row-overdue-${c.id}`}>
                      <TableCell className="font-medium">{c.truck_number}</TableCell>
                      <TableCell className="text-xs">
                        {c.tech_name ?? c.enterprise_id ?? c.ldap ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                          {c.blocked_days} days
                        </Badge>
                        {c.exclusion_since ? (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            since {new Date(c.exclusion_since).toLocaleDateString()}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs">
                        {status?.exclusionLabels?.[c.exclusion_reason ?? ""] ?? c.exclusion_reason ?? "—"}
                        {c.exclusion_detail
                          ? <span className="block text-muted-foreground">{c.exclusion_detail}</span>
                          : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(c.odometer_at_trigger)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(c.current_odometer)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.miles_past_trigger != null && c.miles_past_trigger > 0 ? (
                          <span className="text-red-700 font-medium">+{fmtMiles(c.miles_past_trigger)} mi</span>
                        ) : c.current_odometer == null ? (
                          <span className="text-muted-foreground">no reading</span>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                        {/* Enterprise ID is the identifier the booking is filed
                            under (TechnicianId in the DCA payload). Rendered
                            prominently so staff can match it to DCA records. */}
                        {c.enterprise_id ?? c.ldap ?? "—"}
                        {c.tech_name ? <div className="text-xs text-muted-foreground">{c.tech_name}</div> : null}
                        {c.enterprise_id && c.enterprise_id !== c.ldap && c.ldap
                          ? <div className="text-xs text-muted-foreground">ldap: {c.ldap}</div>
                          : null}
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMiles(c.odometer_at_trigger)}
                        {c.odometer_source
                          ? <div className="text-xs text-muted-foreground">{c.odometer_source}</div>
                          : null}
                        {/* Current reading vs the frozen trigger reading, so a
                            blocked truck's drift is visible (Task #674). */}
                        {!c.closed_at && c.current_odometer != null && c.current_odometer !== c.odometer_at_trigger
                          ? (
                            <div className="text-xs text-muted-foreground">
                              now {fmtMiles(c.current_odometer)}
                              {c.miles_past_trigger != null && c.miles_past_trigger > 0
                                ? <span className="text-red-700"> (+{fmtMiles(c.miles_past_trigger)})</span>
                                : null}
                            </div>
                          )
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
                        {/* Scheduling window (Task #676) */}
                        {c.booking_window_start && c.booking_window_end
                          ? (
                            <div className="text-muted-foreground">
                              window: {String(c.booking_window_start).slice(0, 10)} –{" "}
                              {String(c.booking_window_end).slice(0, 10)}
                            </div>
                          )
                          : c.booking_date
                            ? <div className="text-muted-foreground">for {c.booking_date}</div>
                            : null}
                        {c.booking_project_name
                          ? <div className="text-muted-foreground">{c.booking_project_name}</div>
                          : null}
                        {!c.booking_status && c.booking_due_at
                          ? <div className="text-muted-foreground">due {fmtDate(c.booking_due_at)}</div>
                          : null}
                        {/* Confirmation follow-up state (Task #676) */}
                        {c.confirmation_status === "follow_up_sent"
                          ? (
                            <div className="text-green-700">
                              ✓ confirmation texted{c.follow_up_sent_at ? ` ${fmtDate(c.follow_up_sent_at)}` : ""}
                            </div>
                          )
                          : c.confirmation_status === "confirmed"
                            ? <div className="text-amber-700">slot confirmed — text pending</div>
                            : c.confirmation_status === "follow_up_failed"
                              ? <div className="text-red-700">confirmation text failed</div>
                              : c.booking_status === "filed_live" || c.booking_status === "duplicate"
                                ? <div className="text-muted-foreground">awaiting slot confirmation</div>
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
                            <ShieldAlert className={`h-3 w-3 mt-0.5 shrink-0 ${c.stale_blocked ? "text-red-600" : "text-slate-500"}`} />
                            <span>
                              {status?.exclusionLabels?.[c.exclusion_reason] ?? c.exclusion_reason}
                              {c.exclusion_detail
                                ? <span className="block text-muted-foreground">{c.exclusion_detail}</span>
                                : null}
                              {c.blocked_days != null && !c.closed_at ? (
                                <Badge
                                  variant="outline"
                                  className={`mt-1 ${c.stale_blocked
                                    ? "bg-red-100 text-red-800 border-red-200"
                                    : "bg-slate-100 text-slate-700 border-slate-200"}`}
                                  data-testid={`badge-blocked-days-${c.id}`}
                                >
                                  blocked {c.blocked_days} {c.blocked_days === 1 ? "day" : "days"}
                                </Badge>
                              ) : null}
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
                        {/* Booked cycles are closed — show the confirm-slot
                            form instead of retry (which would double-book). */}
                        {(c.booking_status === "filed_live" || c.booking_status === "duplicate") ? (
                          <div className="space-y-1">
                            {c.confirmation_status === "follow_up_sent" || c.follow_up_sent_at ? (
                              <span className="text-xs text-green-700">✓ follow-up sent</span>
                            ) : confirmingId === c.id ? (
                              <div className="space-y-1 text-left" data-testid={`confirm-form-${c.id}`}>
                                <input
                                  type="date"
                                  value={slotDate}
                                  onChange={(e) => setSlotDate(e.target.value)}
                                  className="text-xs border rounded px-1 py-0.5 w-28"
                                />
                                <input
                                  type="time"
                                  value={slotTime}
                                  onChange={(e) => setSlotTime(e.target.value)}
                                  placeholder="HH:MM (opt)"
                                  className="text-xs border rounded px-1 py-0.5 w-24"
                                />
                                <div className="flex gap-1 justify-end">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setConfirmingId(null); setSlotDate(""); setSlotTime(""); }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (!slotDate) return;
                                      confirmSlotMutation.mutate({ id: c.id, slotDate, slotTime: slotTime || undefined });
                                    }}
                                    disabled={!slotDate || confirmSlotMutation.isPending}
                                    data-testid={`button-confirm-submit-${c.id}`}
                                  >
                                    Save
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setConfirmingId(c.id); setSlotDate(c.confirmed_slot_date ?? ""); setSlotTime(c.confirmed_slot_time ?? ""); }}
                                data-testid={`button-record-slot-${c.id}`}
                              >
                                <CalendarClock className="h-3 w-3 mr-1" />
                                {c.confirmed_slot_date ? "Update slot" : "Record slot"}
                              </Button>
                            )}
                          </div>
                        ) : c.closed_at ? (
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

      {/* Approaching threshold — read-only early-warning view (Task #676) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Approaching threshold
          </CardTitle>
          <CardDescription>
            Trucks within{" "}
            {approachingQuery.data ? fmtMiles(approachingQuery.data.approachingMiles) : "500"} miles of the{" "}
            {approachingQuery.data ? fmtMiles(approachingQuery.data.triggerMiles) : "5,500"}-mile trigger that do not
            yet have an open cycle. Purely informational — no texts or bookings originate from this view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approachingQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : approachingQuery.isError ? (
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Could not load approaching trucks.
            </p>
          ) : !approachingQuery.data || approachingQuery.data.trucks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No trucks approaching the threshold right now.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead className="text-right">Current odometer</TableHead>
                    <TableHead className="text-right">Since service</TableHead>
                    <TableHead className="text-right">Miles remaining</TableHead>
                    <TableHead>Reading date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approachingQuery.data.trucks.map((t) => (
                    <TableRow key={t.truckNumber}>
                      <TableCell className="font-medium">{t.truckNumber}</TableCell>
                      <TableCell>
                        {t.ldap ?? "—"}
                        {t.techName
                          ? <div className="text-xs text-muted-foreground">{t.techName}</div>
                          : null}
                      </TableCell>
                      <TableCell>{t.district ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(t.odometer)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(t.milesSinceWatermark)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmtMiles(t.milesRemaining)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.odometerDate ? String(t.odometerDate).slice(0, 10) : "—"}
                        {t.odometerSource
                          ? <div>{t.odometerSource}</div>
                          : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* No usable odometer — the trucks the sweep cannot see (Task #675) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            No usable odometer reading
          </CardTitle>
          <CardDescription>
            Assigned, non-BYOV trucks whose reconciled odometer is missing or outside the sanity window — the
            sweep cannot see them, so their feed needs chasing. A missing reading is never treated as zero
            miles and never opens a cycle.
          </CardDescription>
          {missingOdometerQuery.data ? (
            <p className="text-xs text-muted-foreground mt-2" data-testid="text-missing-odometer-counts">
              {missingOdometerQuery.data.counts.total.toLocaleString()} trucks without a usable reading
              {" · "}{missingOdometerQuery.data.counts.assigned.toLocaleString()} assigned (listed below)
              {" · "}{missingOdometerQuery.data.counts.unassigned.toLocaleString()} unassigned
              {" · "}{missingOdometerQuery.data.counts.byov.toLocaleString()} BYOV
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {missingOdometerQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : missingOdometerQuery.isError ? (
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Could not load the missing-odometer report.
            </p>
          ) : !missingOdometerQuery.data || missingOdometerQuery.data.trucks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Every assigned, non-BYOV truck has a usable odometer reading.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck</TableHead>
                    <TableHead>Technician</TableHead>
                    <TableHead>District</TableHead>
                    <TableHead>Why unusable</TableHead>
                    <TableHead className="text-right">Last reading</TableHead>
                    <TableHead>Reading date / source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingOdometerQuery.data.trucks.map((t) => (
                    <TableRow key={t.truckNumber} data-testid={`row-missing-odometer-${t.truckNumber}`}>
                      <TableCell className="font-medium">{t.truckNumber}</TableCell>
                      <TableCell>
                        {t.ldap ?? "—"}
                        {t.techName
                          ? <div className="text-xs text-muted-foreground">{t.techName}</div>
                          : null}
                      </TableCell>
                      <TableCell>{t.district ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {missingOdometerQuery.data?.reasonLabels?.[t.reason] ?? t.reason}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.lastReading != null ? fmtMiles(t.lastReading) : "none"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.lastReadingDate ? String(t.lastReadingDate).slice(0, 10) : "—"}
                        {t.lastReadingSource ? <div>{t.lastReadingSource}</div> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fleet roster — read-only, daily self-refreshing (Task #680) */}
      <FleetRosterCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Fleet roster (Task #680)
 *
 * Read-only by contract: every eligible truck (BYOV and AMS In Repair /
 * Declined Repair / Sent To Auction excluded) with the SAME reconciled
 * odometer and TPMS technician the maintenance sweep computes. There is no
 * edit affordance anywhere — the values refresh themselves from the source
 * tables, and "Refresh now" only re-reads.
 * -------------------------------------------------------------------------- */

interface RosterTruck {
  truckNumber: string;
  vin: string | null;
  odometer: number;
  odometerDate: string | null;
  odometerSource: string | null;
  amsStatus: string | null;
  ldap: string | null;
  techName: string | null;
  district: string | null;
}

interface FleetRoster {
  trucks: RosterTruck[];
  excluded: { byov: number; amsBlocked: number; amsUnknown: number };
  odometerRefreshedAt: string | null;
  techRefreshedAt: string | null;
  generatedAt: string;
}

type RosterError = Error & { warming?: boolean };

type RosterSortKey = "truck" | "odometer" | "tech";

const ROSTER_PAGE_SIZE = 100;

function FleetRosterCard() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<RosterSortKey>("truck");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  const rosterQuery = useQuery<FleetRoster, RosterError>({
    queryKey: ["/api/fs/truck-maintenance/roster"],
    // The server answers 503 {warming:true} while the AMS status map warms (a
    // cold build takes minutes) — poll through THAT, and only that. Any other
    // failure (500, network) gets a couple of retries and then a real error,
    // so a genuine outage never masquerades as an endless loading state.
    queryFn: async () => {
      const res = await fetch("/api/fs/truck-maintenance/roster", { credentials: "include" });
      if (!res.ok) {
        let body: any = null;
        try { body = await res.json(); } catch { /* non-JSON error body */ }
        const err: RosterError = new Error(body?.message || `HTTP ${res.status}`);
        err.warming = body?.warming === true;
        throw err;
      }
      return res.json();
    },
    retry: (failureCount, error) => (error.warming ? failureCount < 4 : failureCount < 2),
    retryDelay: (attempt) => Math.min(15_000 * (attempt + 1), 60_000),
    refetchInterval: (query) => {
      const err = query.state.error;
      if (err?.warming) return 30_000; // keep polling while the map warms
      if (query.state.status === "error") return false; // hard error: stop, show it
      return 15 * 60_000; // loaded: sources refresh daily, 15 min is plenty
    },
    staleTime: 5 * 60_000,
  });

  const roster = rosterQuery.data;

  const filtered = (() => {
    if (!roster) return [];
    const q = search.trim().toLowerCase();
    let rows = roster.trucks;
    if (q) {
      rows = rows.filter((t) =>
        t.truckNumber.toLowerCase().includes(q)
        || (t.ldap ?? "").toLowerCase().includes(q)
        || (t.techName ?? "").toLowerCase().includes(q)
        || (q === "unassigned" && !t.ldap),
      );
    }
    const dir = sortAsc ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === "odometer") return (a.odometer - b.odometer) * dir;
      if (sortKey === "tech") {
        // Unassigned sorts last regardless of direction — staff scan for names.
        const an = a.techName ?? a.ldap;
        const bn = b.techName ?? b.ldap;
        if (!an && !bn) return a.truckNumber.localeCompare(b.truckNumber, undefined, { numeric: true });
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn) * dir;
      }
      return a.truckNumber.localeCompare(b.truckNumber, undefined, { numeric: true }) * dir;
    });
    return rows;
  })();

  const pageCount = Math.max(1, Math.ceil(filtered.length / ROSTER_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * ROSTER_PAGE_SIZE, (safePage + 1) * ROSTER_PAGE_SIZE);

  function sortBy(key: RosterSortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
    setPage(0);
  }

  const sortIndicator = (key: RosterSortKey) => (sortKey === key ? (sortAsc ? " ↑" : " ↓") : "");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Fleet roster
          </CardTitle>
          <CardDescription>
            Every eligible truck with its current odometer and assigned technician — the same values the
            maintenance sweep uses. BYOV, In Repair, Declined Repair and Sent To Auction trucks are excluded.
            Read-only: the values refresh themselves daily from the source systems.
          </CardDescription>
          {roster ? (
            <p className="text-xs text-muted-foreground mt-2" data-testid="text-roster-freshness">
              {roster.trucks.length.toLocaleString()} trucks
              {" · "}excluded: {roster.excluded.byov.toLocaleString()} BYOV, {roster.excluded.amsBlocked.toLocaleString()} repair/auction, {roster.excluded.amsUnknown.toLocaleString()} unreadable AMS status
              {" · "}odometer data as of {fmtDate(roster.odometerRefreshedAt)}
              {" · "}tech assignments as of {fmtDate(roster.techRefreshedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search truck # or technician…"
            className="h-8 w-56 rounded-md border border-input bg-background px-3 text-sm"
            data-testid="input-roster-search"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => rosterQuery.refetch()}
            disabled={rosterQuery.isFetching}
            data-testid="button-roster-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${rosterQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh now
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rosterQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : rosterQuery.isError && rosterQuery.error?.warming ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center" data-testid="text-roster-warming">
            <RefreshCw className="h-4 w-4 animate-spin" />
            AMS status data is still loading — the roster appears automatically once the repair/auction
            exclusions can be applied (usually a few minutes).
          </p>
        ) : rosterQuery.isError ? (
          <p className="text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {rosterQuery.error?.message || "Could not load the fleet roster."}
          </p>
        ) : !roster || roster.trucks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No eligible trucks found.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => sortBy("truck")} data-testid="header-roster-truck">
                      Truck{sortIndicator("truck")}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => sortBy("tech")} data-testid="header-roster-tech">
                      Technician{sortIndicator("tech")}
                    </TableHead>
                    <TableHead>District</TableHead>
                    <TableHead className="cursor-pointer select-none text-right" onClick={() => sortBy("odometer")} data-testid="header-roster-odometer">
                      Current odometer{sortIndicator("odometer")}
                    </TableHead>
                    <TableHead>Reading date / source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((t) => (
                    <TableRow key={t.truckNumber} data-testid={`row-roster-${t.truckNumber}`}>
                      <TableCell className="font-medium">{t.truckNumber}</TableCell>
                      <TableCell>
                        {t.ldap ? (
                          <>
                            {t.ldap}
                            {t.techName
                              ? <div className="text-xs text-muted-foreground">{t.techName}</div>
                              : null}
                          </>
                        ) : (
                          <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
                            Unassigned
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{t.district ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMiles(t.odometer)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.odometerDate ? String(t.odometerDate).slice(0, 10) : "—"}
                        {t.odometerSource ? <div>{t.odometerSource}</div> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pageCount > 1 ? (
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-muted-foreground">
                  {filtered.length.toLocaleString()} trucks · page {safePage + 1} of {pageCount}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} data-testid="button-roster-prev">
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} data-testid="button-roster-next">
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
