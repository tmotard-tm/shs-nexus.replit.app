import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarClock, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Finding {
  id: number;
  detectedDate: string;
  vin: string;
  truckNumber: string | null;
  previousStatus: string | null;
  newStatus: string;
  dedupOutcome: string;
  decommissioningVehicleId: number | null;
  address: string | null;
  zipCode: string | null;
}

interface Report {
  days: Array<{ date: string; newDeclined: number; findings: Finding[] }>;
  snapshotDates: Array<{ date: string; count: number }>;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
    triggeredBy: string | null;
  } | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  added: "Added to Decommissioning",
  already_in_decommissioning: "Already in Decommissioning",
  already_excluded: "On exclusion list",
  covered_by_po_sync: "Covered by PO sync",
  no_truck_number: "No truck # found",
};

const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  added: "default",
  already_in_decommissioning: "secondary",
  already_excluded: "outline",
  covered_by_po_sync: "secondary",
  no_truck_number: "destructive",
};

export function AmsDeclinedCheckDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: report, isLoading } = useQuery<Report>({
    queryKey: ["/api/fs/ams-declined-check/report"],
    enabled: open,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fs/ams-declined-check/run");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/ams-declined-check/report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: result.baseline ? "Baseline snapshot saved" : "Check complete",
        description: result.baseline
          ? `First run — snapshotted ${result.snapshotRows} vehicles. Tomorrow's run will report changes.`
          : `${result.newDeclined} new Declined Repair truck(s) vs ${result.previousSnapshotDate}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Check failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-ams-declined-check">
          <CalendarClock className="h-4 w-4 mr-2" />
          Daily Declined Check
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily AMS Declined Repair Report</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {report?.lastRun ? (
              <>
                Last run: {new Date(report.lastRun.completedAt ?? report.lastRun.startedAt).toLocaleString()}{" "}
                <Badge variant={report.lastRun.status === "completed" ? "secondary" : "destructive"}>
                  {report.lastRun.status}
                </Badge>
                {report.lastRun.errorMessage && (
                  <span className="text-destructive ml-2">{report.lastRun.errorMessage}</span>
                )}
              </>
            ) : (
              "No runs yet — the first run saves a baseline snapshot."
            )}
          </div>
          <Button
            size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            data-testid="button-run-declined-check"
          >
            {runMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run now
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !report || report.days.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No new Declined Repair trucks detected yet.
            {report && report.snapshotDates.length > 0 && (
              <> Snapshots on file: {report.snapshotDates.length} day(s), latest {report.snapshotDates[0].date} ({report.snapshotDates[0].count} vehicles).</>
            )}
          </p>
        ) : (
          <div className="space-y-4">
            {report.days.map((day) => (
              <div key={day.date} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium">{day.date}</span>
                  <Badge>{day.newDeclined} new</Badge>
                </div>
                <div className="space-y-1">
                  {day.findings.map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-wrap items-center gap-2 text-sm border-b last:border-b-0 py-1"
                      data-testid={`row-finding-${f.id}`}
                    >
                      <span className="font-mono font-medium w-20">
                        {f.truckNumber || "—"}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">{f.vin}</span>
                      <span className="text-muted-foreground">
                        prev: {f.previousStatus ?? "not tracked"}
                      </span>
                      <Badge variant={OUTCOME_VARIANT[f.dedupOutcome] ?? "outline"}>
                        {OUTCOME_LABEL[f.dedupOutcome] ?? f.dedupOutcome}
                      </Badge>
                      {f.address && (
                        <span className="text-xs text-muted-foreground truncate max-w-[240px]">
                          {f.address}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
