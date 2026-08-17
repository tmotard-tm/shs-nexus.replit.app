import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ShieldX, AlertTriangle, PlugZap, FlaskConical } from "lucide-react";
import { useState } from "react";

interface GateState {
  enabled: boolean;
  rehearsalMode: boolean;
  enabledUpdatedAt: string | null;
  enabledUpdatedBy: string | null;
  rehearsalUpdatedAt: string | null;
  rehearsalUpdatedBy: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/**
 * Activation surface for the Create Vehicle gate (Task #636).
 *
 * Vehicle creation writes REAL records into Holman, WMS and TPMS, so the
 * function ships fail-safe OFF: with no setting row present it stays off. This
 * page is the supported way to turn it on, and to put it in rehearsal mode —
 * which runs every duplicate/permission gate and reports the exact payloads
 * without sending anything to an external system.
 */
export default function VehicleCreateAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmEnableOpen, setConfirmEnableOpen] = useState(false);

  const isDeveloper = user?.role === "developer";

  const gateQuery = useQuery<GateState>({
    queryKey: ["/api/admin/vehicle-create/gate"],
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: { enabled?: boolean; rehearsalMode?: boolean }) => {
      const res = await apiRequest("PUT", "/api/admin/vehicle-create/gate", patch);
      return res.json();
    },
    onSuccess: (data: GateState) => {
      toast({
        title: data?.enabled
          ? data?.rehearsalMode
            ? "Vehicle creation ON — rehearsal only"
            : "Vehicle creation ON — live writes"
          : "Vehicle creation OFF",
        description: data?.enabled
          ? data?.rehearsalMode
            ? "Submissions run every gate and report what would be sent. Nothing reaches Holman, WMS or TPMS."
            : "Submissions create real records in Holman, WMS and TPMS."
          : "The create route refuses every submission, including the single-system retries.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vehicle-create/gate"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed to update the gate", description: e.message, variant: "destructive" }),
  });

  if (!isDeveloper) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <ShieldX className="h-6 w-6 text-destructive" />
            <CardTitle>Developer access only</CardTitle>
            <CardDescription>
              Turning vehicle creation on or off is restricted to developer accounts.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const gate = gateQuery.data;
  const liveWrites = !!gate?.enabled && !gate?.rehearsalMode;

  // Going straight to live external writes needs an explicit confirmation;
  // every other transition is reversible and harmless.
  const handleEnabledSwitch = (checked: boolean) => {
    if (checked && !gate?.rehearsalMode) {
      setConfirmEnableOpen(true);
    } else {
      updateMutation.mutate({ enabled: checked });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
          Vehicle Creation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Master switch for the Create New Vehicle flow. Creation writes real records into Holman,
          WMS and TPMS, so it stays off until someone turns it on here.
        </p>
      </div>

      <Card data-testid="card-vehicle-create-enabled">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="h-5 w-5" />
                Vehicle creation
              </CardTitle>
              <CardDescription className="mt-1">
                When OFF, the create route and both single-system retry routes refuse every
                submission — no one can register a vehicle, whatever their permissions say.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {gateQuery.isLoading ? (
                <Skeleton className="h-6 w-11 rounded-full" />
              ) : (
                <>
                  <span
                    className={`text-sm font-medium ${gate?.enabled ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`}
                    data-testid="text-vehicle-create-state"
                  >
                    {gate?.enabled ? "ON" : "OFF"}
                  </span>
                  <Switch
                    checked={gate?.enabled ?? false}
                    onCheckedChange={handleEnabledSwitch}
                    disabled={updateMutation.isPending}
                    data-testid="switch-vehicle-create-enabled"
                    aria-label="Toggle vehicle creation"
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={
              liveWrites
                ? "flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
                : "flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground"
            }
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {liveWrites
                ? "Live writes are armed. Each submission creates a real Holman, WMS and TPMS record."
                : "No submission can reach an external system in this state."}
              {gate?.enabledUpdatedBy ? (
                <>
                  {" "}
                  Last changed by <span className="font-medium">{gate.enabledUpdatedBy}</span> on{" "}
                  {fmt(gate.enabledUpdatedAt)}.
                </>
              ) : null}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-vehicle-create-rehearsal">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Rehearsal mode
              </CardTitle>
              <CardDescription className="mt-1">
                Runs the full path — permissions, VIN validity, duplicate checks, payload build —
                and returns exactly what would be sent to each system, without sending it and
                without holding a vehicle number.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {gateQuery.isLoading ? (
                <Skeleton className="h-6 w-11 rounded-full" />
              ) : (
                <>
                  <span
                    className={`text-sm font-medium ${gate?.rehearsalMode ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}
                    data-testid="text-vehicle-create-rehearsal-state"
                  >
                    {gate?.rehearsalMode ? "ON" : "OFF"}
                  </span>
                  <Switch
                    checked={gate?.rehearsalMode ?? false}
                    onCheckedChange={(checked) => updateMutation.mutate({ rehearsalMode: checked })}
                    disabled={updateMutation.isPending}
                    data-testid="switch-vehicle-create-rehearsal"
                    aria-label="Toggle rehearsal mode"
                  />
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Rehearsal only applies while vehicle creation is ON — it is what the function does
            instead of writing.
            {gate?.rehearsalUpdatedBy ? (
              <>
                {" "}
                Last changed by <span className="font-medium">{gate.rehearsalUpdatedBy}</span> on{" "}
                {fmt(gate.rehearsalUpdatedAt)}.
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={confirmEnableOpen} onOpenChange={setConfirmEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arm live vehicle creation?</AlertDialogTitle>
            <AlertDialogDescription>
              With rehearsal mode off, every submission creates real records in Holman, WMS and
              TPMS. Consider turning rehearsal mode on first and reviewing the reported payloads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-enable">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-enable"
              onClick={() => {
                setConfirmEnableOpen(false);
                updateMutation.mutate({ enabled: true });
              }}
            >
              Turn on live writes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
