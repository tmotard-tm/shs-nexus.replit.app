import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Settings, UserPlus, UserX, FileText, History, Users, MessageSquare,
  Pencil, Wrench, Send, Loader2, ChevronDown, ChevronUp, Activity,
  Link2, Truck as TruckIcon, RefreshCw, CheckCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/* ─── helpers (mirrored from fleet-management.tsx getAmsLookupLabel) ─────── */
function getAmsLookupLabel(item: any): string {
  if (!item) return "";
  return (
    item.Name || item.Description || item.Label || item.label ||
    item.name || item.description || item.Status || item.Reason ||
    String(item.UniqueID ?? "")
  );
}

/* ─── Operations modal-trigger contract ──────────────────────────────────── */
export type OperationsModalKind =
  | "assign" | "unassign" | "poHistory" | "history"
  | "opsReview" | "amsEdit" | "amsRepair" | "viewInventory" | "telematics";

export interface OperationsModalContext {
  /** May be undefined when emitted from the no-fs_trucks ghost-row fallback
   *  surface (UVP's Truck-not-found branch). Callers that depend on truck
   *  fields should fall back to their own page-level vehicle context. */
  truck?: TruckPanelData;
  vin: string | null;
  vehicleNumber: string | null;
  /** AMS-side prefill for amsEdit (computed via lookup matching). */
  amsEditPrefill?: Record<string, any>;
  /** Initial repair-modal state derived from current AMS InRepair. */
  amsRepairPrefill?: { inRepair: boolean };
  /** Ops Review needs a reference zip. */
  opsReviewRefZip?: string | null;
  /** PO count, to render in confirmation copy. */
  poCount?: number;
}

export interface OperationsTabProps {
  truck: TruckPanelData;
  /** VIN drives all AMS-side queries + writes. */
  vin: string | null;
  /** Vehicle (truck) number drives Nexus tracking + ops logs + Holman fleet lookup. */
  vehicleNumber: string | null;
  /** Caller renders modals (Assign/Unassign/POHistory/AMSEdit/AMSRepair/OpsReview/History).
   *  When omitted, operations buttons are hidden — read-only mode. */
  onOpenModal?: (kind: OperationsModalKind, ctx: OperationsModalContext) => void;
}

/* ─── Holman fleet-vehicle shape (subset used here) ───────────────────────── */
interface HolmanFleetVehicle {
  vehicleNumber: string;
  vin: string;
  region?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  tpmsAssignedTechId?: string | null;
  tpmsAssignedTechName?: string | null;
  holmanTechAssigned?: string | null;
  holmanTechName?: string | null;
}

export function OperationsTab({ truck, vin, vehicleNumber, onOpenModal }: OperationsTabProps) {
  const { toast } = useToast();

  /* ─── Data queries ─────────────────────────────────────────────────────── */
  const { data: amsVehicle, isLoading: amsLoading } = useQuery<any>({
    queryKey: ["/api/ams/vehicles", vin],
    enabled: !!vin,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${vin}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: amsComments, isLoading: amsCommentsLoading } = useQuery<any[]>({
    queryKey: ["/api/ams/vehicles/comments", vin],
    enabled: !!vin,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${vin}/comments`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      if (Array.isArray(json)) return json;
      if (json && typeof json === "object") {
        const arr = json.data || json.comments || json.rows || json.items || json.records ||
          json.CommentList || json.Comments || json.Notes || json.notes;
        if (Array.isArray(arr)) return arr;
        if (arr && typeof arr === "object") return Object.values(arr);
      }
      return [];
    },
  });

  const { data: vehicleOpLogs, isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/fleet-ops/logs", vehicleNumber],
    enabled: !!vehicleNumber,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/logs?truckNumber=${encodeURIComponent(vehicleNumber!)}`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || json || [];
    },
  });

  // AMS lookups (always-on subset)
  const { data: truckStatusLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "truck-status"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });
  const { data: vehicleRunsLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "vehicle-runs"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });
  const { data: vehicleLooksLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "vehicle-looks"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });
  const { data: colorLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "colors"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });
  const { data: brandingLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "branding"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });
  const { data: interiorLookup } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "interior"], enabled: !!vin, staleTime: 10 * 60 * 1000,
  });

  // Nexus tracking
  const { data: nexusData, isLoading: nexusDataLoading } = useQuery<{
    postOffboardedStatus: string | null;
    nexusNewLocation: string | null;
    nexusNewLocationContact: string | null;
    comments: string | null;
  } | null>({
    queryKey: ["/api/vehicle-nexus-data", vehicleNumber],
    enabled: !!vehicleNumber,
  });

  // Vehicle POs (count). Server route is GET /api/holman/pos/:vehicleNumber.
  const { data: vehiclePOs } = useQuery<any[]>({
    queryKey: ["/api/holman/pos", vehicleNumber],
    enabled: !!vehicleNumber,
    queryFn: async () => {
      const res = await fetch(`/api/holman/pos/${vehicleNumber}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Holman fleet vehicle (for assignment summary; sourced from cached endpoint)
  const { data: fleetVehiclesEnvelope } = useQuery<any>({
    queryKey: ["/api/holman/fleet-vehicles"],
    enabled: !!vehicleNumber,
    staleTime: 60 * 1000,
  });
  const fleetVehicle: HolmanFleetVehicle | undefined = (() => {
    if (!fleetVehiclesEnvelope || !vehicleNumber) return undefined;
    const list: HolmanFleetVehicle[] =
      fleetVehiclesEnvelope.data || fleetVehiclesEnvelope.vehicles || fleetVehiclesEnvelope || [];
    return Array.isArray(list) ? list.find((v) => v.vehicleNumber === vehicleNumber) : undefined;
  })();

  /* ─── Local state ──────────────────────────────────────────────────────── */
  const [newComment, setNewComment] = useState("");
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [amsCommentsCollapsed, setAmsCommentsCollapsed] = useState(false);

  const [nexusStatus, setNexusStatus] = useState("");
  const [nexusLocation, setNexusLocation] = useState("");
  const [nexusContact, setNexusContact] = useState("");
  const [nexusComments, setNexusComments] = useState("");

  useEffect(() => {
    if (nexusData) {
      setNexusStatus(nexusData.postOffboardedStatus || "");
      setNexusLocation(nexusData.nexusNewLocation || "");
      setNexusContact(nexusData.nexusNewLocationContact || "");
      setNexusComments(nexusData.comments || "");
    } else {
      setNexusStatus("");
      setNexusLocation("");
      setNexusContact("");
      setNexusComments("");
    }
  }, [nexusData, vehicleNumber]);

  /* ─── Mutations ────────────────────────────────────────────────────────── */
  const addCommentMutation = useMutation({
    mutationFn: async (comment: string) => {
      const res = await apiRequest("POST", `/api/ams/vehicles/${vin}/comments`, { comment });
      return res.json();
    },
    onSuccess: () => {
      setNewComment("");
      setCommentDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles/comments", vin] });
      toast({ title: "Comment added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const saveNexusDataMutation = useMutation({
    mutationFn: async (data: {
      vehicleNumber: string;
      postOffboardedStatus: string | null;
      nexusNewLocation: string | null;
      nexusNewLocationContact: string | null;
      comments: string | null;
    }) => {
      const response = await apiRequest("PUT", `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Tracking Data Saved", description: "Vehicle tracking information has been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-nexus-data", vehicleNumber] });
    },
    onError: (error: any) => {
      toast({ title: "Save Failed", description: error.message || "Failed to save tracking data", variant: "destructive" });
    },
  });

  const resyncAssignmentsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fleet-vehicles/resync-assignments", {
        vehicleNumber, enterpriseId: fleetVehicle?.holmanTechAssigned,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/holman/fleet-vehicles"] });
      const tpms = data?.tpms;
      const tpmsMsg = tpms?.error
        ? `TPMS error: ${tpms.error}`
        : tpms?.truckNo
          ? `TPMS truck: ${tpms.truckNo}`
          : "TPMS: no truck assigned";
      toast({ title: "Assignment Resynced", description: `${tpmsMsg} · Holman: live data refreshed` });
    },
    onError: (error: any) => {
      toast({ title: "Resync Failed", description: error.message || "Failed to resync assignments", variant: "destructive" });
    },
  });

  /* ─── Modal-trigger helpers (compose ctx) ──────────────────────────────── */
  const baseCtx: OperationsModalContext = { truck, vin, vehicleNumber };

  const openAmsEdit = () => {
    if (!onOpenModal) return;
    const matchLookup = (lookup: any[] | undefined, raw: any): string => {
      if (raw == null || !lookup?.length) return "";
      const s = String(raw);
      const byId = lookup.find((it) => String(it.UniqueID) === s);
      if (byId) return s;
      const byLabel = lookup.find((it) => getAmsLookupLabel(it).toLowerCase() === s.toLowerCase());
      return byLabel ? String(byLabel.UniqueID) : "";
    };
    const tv = amsVehicle?.TheftVerified;
    onOpenModal("amsEdit", {
      ...baseCtx,
      amsEditPrefill: {
        color: matchLookup(colorLookup, amsVehicle?.Color),
        branding: matchLookup(brandingLookup, amsVehicle?.Branding),
        interior: matchLookup(interiorLookup, amsVehicle?.Interior),
        address: amsVehicle?.CurLocAddress || "",
        addressZip: amsVehicle?.CurLocZip || "",
        truckStatus: matchLookup(truckStatusLookup, amsVehicle?.TruckStatus),
        theftVerified: tv === true || tv === "Y" ? "Y" : tv === false || tv === "N" ? "N" : "",
        keyAddress: amsVehicle?.KeyLocAddress || amsVehicle?.KeyAddress || amsVehicle?.keyAddress || "",
        keyZip: amsVehicle?.KeyLocZip || amsVehicle?.KeyZip || amsVehicle?.keyZip || "",
        storageCost: amsVehicle?.StorageCost != null ? String(amsVehicle.StorageCost) : "",
        vehicleRuns: matchLookup(vehicleRunsLookup, amsVehicle?.VehicleRuns),
        vehicleLooks: matchLookup(vehicleLooksLookup, amsVehicle?.VehicleLooks),
      },
    });
  };

  const openAmsRepair = () => {
    if (!onOpenModal) return;
    onOpenModal("amsRepair", {
      ...baseCtx,
      amsRepairPrefill: { inRepair: !!amsVehicle?.InRepair },
    });
  };

  const openOpsReview = () => {
    if (!onOpenModal) return;
    onOpenModal("opsReview", {
      ...baseCtx,
      opsReviewRefZip: fleetVehicle?.zip || null,
    });
  };

  const openPoHistory = () => onOpenModal?.("poHistory", { ...baseCtx, poCount: vehiclePOs?.length || 0 });

  const noAssignments =
    !fleetVehicle?.tpmsAssignedTechId?.trim() && !fleetVehicle?.holmanTechAssigned?.trim();

  /* ─── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Assignment Summary + Resync */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Assignment Summary
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={!vehicleNumber || resyncAssignmentsMutation.isPending}
            onClick={() => resyncAssignmentsMutation.mutate()}
            data-testid="op-button-resync-assignments"
          >
            {resyncAssignmentsMutation.isPending
              ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              : <RefreshCw className="h-3 w-3 mr-1" />}
            {resyncAssignmentsMutation.isPending ? "Resyncing…" : "Resync"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="h-4 w-4 text-blue-600" />
              <Label className="text-xs font-medium">TPMS</Label>
            </div>
            {fleetVehicle?.tpmsAssignedTechId ? (
              <>
                <p className="font-mono text-sm">{fleetVehicle.tpmsAssignedTechId}</p>
                {fleetVehicle.tpmsAssignedTechName && (
                  <p className="text-xs text-muted-foreground mt-1">{fleetVehicle.tpmsAssignedTechName}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Unassigned</p>
            )}
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <TruckIcon className="h-4 w-4 text-green-600" />
              <Label className="text-xs font-medium">Holman</Label>
            </div>
            {fleetVehicle?.holmanTechAssigned ? (
              <>
                <p className="font-mono text-sm">{fleetVehicle.holmanTechAssigned}</p>
                {fleetVehicle.holmanTechName && (
                  <p className="text-xs text-muted-foreground mt-1">{fleetVehicle.holmanTechName}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Unassigned</p>
            )}
          </Card>
        </div>
      </section>

      <Separator />

      {/* Operations action buttons */}
      {onOpenModal && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Operations</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="w-full" onClick={() => onOpenModal("assign", baseCtx)} data-testid="op-button-assign">
              <UserPlus className="h-4 w-4 mr-1.5" />Assign Tech
            </Button>
            <Button
              size="sm" variant="outline" className="w-full"
              onClick={() => onOpenModal("unassign", baseCtx)}
              disabled={noAssignments}
              data-testid="op-button-unassign"
            >
              <UserX className="h-4 w-4 mr-1.5" />Unassign Tech
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={openPoHistory} data-testid="op-button-po-history">
              <FileText className="h-4 w-4 mr-1.5" />
              PO History{vehiclePOs && vehiclePOs.length > 0 ? ` (${vehiclePOs.length})` : ""}
            </Button>
            <Button
              size="sm" variant="outline" className="w-full"
              onClick={() => onOpenModal("history", baseCtx)}
              disabled={!fleetVehicle?.tpmsAssignedTechId}
              data-testid="op-button-history"
            >
              <History className="h-4 w-4 mr-1.5" />History
            </Button>
          </div>
          {noAssignments && (
            <Button
              size="sm" variant="outline" className="w-full text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-300 dark:border-purple-700 dark:hover:bg-purple-950"
              onClick={openOpsReview}
              data-testid="op-button-ops-review"
            >
              <Users className="h-4 w-4 mr-1.5" />Ops Review
            </Button>
          )}
        </section>
      )}

      <Separator />

      {/* AMS Information */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">AMS Information</h3>
        {!vin ? (
          <p className="text-xs text-muted-foreground">No VIN available — AMS data unavailable.</p>
        ) : amsLoading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading AMS data…</div>
        ) : !amsVehicle ? (
          <p className="text-xs text-muted-foreground">AMS data not available for this vehicle.</p>
        ) : (
          <div className="space-y-4">
            {/* Ownership */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Ownership</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {amsVehicle.Tech && (
                  <div>
                    <Label className="text-xs text-muted-foreground">AMS Tech</Label>
                    <p className="font-mono text-xs">{amsVehicle.Tech}</p>
                    {amsVehicle.TechName && <p className="text-xs text-muted-foreground">{amsVehicle.TechName}</p>}
                  </div>
                )}
                {(amsVehicle.TFD || amsVehicle.TFDName) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">TFD</Label>
                    <p className="text-xs font-mono">{amsVehicle.TFD || "—"}</p>
                    {amsVehicle.TFDName && <p className="text-xs text-muted-foreground">{amsVehicle.TFDName}</p>}
                  </div>
                )}
                {(amsVehicle.DSM || amsVehicle.DSMName) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">DSM</Label>
                    <p className="text-xs font-mono">{amsVehicle.DSM || "—"}</p>
                    {amsVehicle.DSMName && <p className="text-xs text-muted-foreground">{amsVehicle.DSMName}</p>}
                  </div>
                )}
                {(amsVehicle.TM || amsVehicle.TMName) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">TM</Label>
                    <p className="text-xs font-mono">{amsVehicle.TM || "—"}</p>
                    {amsVehicle.TMName && <p className="text-xs text-muted-foreground">{amsVehicle.TMName}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Description</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {amsVehicle.ColorName && (<div><Label className="text-xs text-muted-foreground">Color</Label><p>{amsVehicle.ColorName}</p></div>)}
                {amsVehicle.BrandingName && (<div><Label className="text-xs text-muted-foreground">Branding</Label><p>{amsVehicle.BrandingName}</p></div>)}
                {amsVehicle.InteriorName && (<div><Label className="text-xs text-muted-foreground">Interior</Label><p>{amsVehicle.InteriorName}</p></div>)}
                {amsVehicle.CurOdometer != null && (
                  <div>
                    <Label className="text-xs text-muted-foreground">AMS Odometer</Label>
                    <p>{amsVehicle.CurOdometer.toLocaleString()} mi</p>
                    {amsVehicle.CurOdometerDate && <p className="text-xs text-muted-foreground">{amsVehicle.CurOdometerDate.slice(0, 10)}</p>}
                  </div>
                )}
                {amsVehicle.RemBookValue != null && (<div><Label className="text-xs text-muted-foreground">Book Value</Label><p>${Number(amsVehicle.RemBookValue).toLocaleString()}</p></div>)}
                {amsVehicle.LeaseEndDate && (<div><Label className="text-xs text-muted-foreground">Lease End</Label><p>{amsVehicle.LeaseEndDate}</p></div>)}
                {amsVehicle.OutofSvcDate && (<div><Label className="text-xs text-muted-foreground">Out of Service</Label><p>{amsVehicle.OutofSvcDate}</p></div>)}
                {amsVehicle.SaleDate && (<div><Label className="text-xs text-muted-foreground">Sale Date</Label><p>{amsVehicle.SaleDate}</p></div>)}
                {amsVehicle.RegRenewalDate && (<div><Label className="text-xs text-muted-foreground">Reg Renewal</Label><p>{amsVehicle.RegRenewalDate}</p></div>)}
                {amsVehicle.LifeTimeMaintenanceCost != null && (<div><Label className="text-xs text-muted-foreground">Lifetime Maint.</Label><p>${Number(amsVehicle.LifeTimeMaintenanceCost).toLocaleString()}</p></div>)}
                {amsVehicle.StorageCost != null && (<div><Label className="text-xs text-muted-foreground">Storage Cost</Label><p>${Number(amsVehicle.StorageCost).toLocaleString()}</p></div>)}
              </div>
            </div>

            {/* Condition */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Condition</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Road Ready</Label>
                  <div className="mt-0.5">
                    {amsVehicle.RoadReady === "Y" || amsVehicle.RoadReady === "Yes" ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-none text-xs">Ready</Badge>
                    ) : amsVehicle.RoadReady ? (
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-none text-xs">{amsVehicle.RoadReady}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Grade</Label>
                  <p>{amsVehicle.Grade || "N/A"}</p>
                  {amsVehicle.GradeDescription && <p className="text-xs text-muted-foreground">{amsVehicle.GradeDescription}</p>}
                  {amsVehicle.GradeVerified && <p className="text-xs text-muted-foreground">Verified: {amsVehicle.GradeVerified}</p>}
                </div>
                {amsVehicle.TruckStatus != null && (() => {
                  const match = Array.isArray(truckStatusLookup) ? truckStatusLookup.find((it: any) => String(it.UniqueID) === String(amsVehicle.TruckStatus)) : undefined;
                  return (
                    <div>
                      <Label className="text-xs text-muted-foreground">Truck Status</Label>
                      <p>{match ? getAmsLookupLabel(match) : String(amsVehicle.TruckStatus)}</p>
                    </div>
                  );
                })()}
                {amsVehicle.TheftVerified != null && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Theft Verified</Label>
                    <p>{amsVehicle.TheftVerified === "Y" || amsVehicle.TheftVerified === true ? "Yes" : "No"}</p>
                  </div>
                )}
                {amsVehicle.VehicleRuns != null && (() => {
                  const match = Array.isArray(vehicleRunsLookup) ? vehicleRunsLookup.find((it: any) => String(it.UniqueID) === String(amsVehicle.VehicleRuns)) : undefined;
                  return (
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">How Vehicle Runs</Label>
                      <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleRuns)}</p>
                    </div>
                  );
                })()}
                {amsVehicle.VehicleLooks != null && (() => {
                  const match = Array.isArray(vehicleLooksLookup) ? vehicleLooksLookup.find((it: any) => String(it.UniqueID) === String(amsVehicle.VehicleLooks)) : undefined;
                  return (
                    <div className="col-span-2">
                      <Label className="text-xs text-muted-foreground">How Vehicle Looks</Label>
                      <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleLooks)}</p>
                    </div>
                  );
                })()}
                {amsVehicle.InRepair != null && (
                  <div>
                    <Label className="text-xs text-muted-foreground">In Repair</Label>
                    <p>{amsVehicle.InRepair === true || amsVehicle.InRepair === "Y" ? "Yes" : "No"}</p>
                  </div>
                )}
                {amsVehicle.DaysInRepair != null && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Days In Repair</Label>
                    <p>{amsVehicle.DaysInRepair}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Location</p>
              <div className="space-y-1.5 text-sm">
                {(amsVehicle.CurLocAddress || amsVehicle.CurLocCity) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Current Location</Label>
                    <p className="text-xs">
                      {[amsVehicle.CurLocAddress, amsVehicle.CurLocCity, amsVehicle.CurLocState].filter(Boolean).join(", ")}
                      {amsVehicle.CurLocZip ? ` ${amsVehicle.CurLocZip}` : ""}
                    </p>
                    {amsVehicle.UpdateDate && <p className="text-xs text-muted-foreground">Updated: {amsVehicle.UpdateDate}</p>}
                  </div>
                )}
                {(amsVehicle.DeliveryDate || amsVehicle.Address) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Delivery Location</Label>
                    <p className="text-xs">
                      {[amsVehicle.Address, amsVehicle.City, amsVehicle.State].filter(Boolean).join(", ")}
                      {amsVehicle.Zip ? ` ${amsVehicle.Zip}` : ""}
                    </p>
                    {amsVehicle.DeliveryDate && <p className="text-xs text-muted-foreground">Delivered: {amsVehicle.DeliveryDate}</p>}
                  </div>
                )}
                {((amsVehicle.KeyAddress || amsVehicle.keyAddress) || (amsVehicle.KeyZip || amsVehicle.keyZip)) && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Key Location</Label>
                    <p className="text-xs">
                      {[(amsVehicle.KeyAddress || amsVehicle.keyAddress)].filter(Boolean).join(", ")}
                      {(amsVehicle.KeyZip || amsVehicle.keyZip) ? ` ${amsVehicle.KeyZip || amsVehicle.keyZip}` : ""}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {(amsVehicle.LastUpdate || amsVehicle.LastUpdateUser) && (
              <p className="text-xs text-muted-foreground">
                AMS last updated: {amsVehicle.LastUpdate || "N/A"}{amsVehicle.LastUpdateUser ? ` by ${amsVehicle.LastUpdateUser}` : ""}
              </p>
            )}

            {/* AMS write-action buttons (modal triggers) */}
            {onOpenModal && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={openAmsEdit} data-testid="op-button-ams-edit">
                  <Pencil className="h-4 w-4 mr-1.5" />Edit Fields
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={openAmsRepair} data-testid="op-button-ams-repair">
                  <Wrench className="h-4 w-4 mr-1.5" />Repair
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* AMS Comments / History */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setAmsCommentsCollapsed((v) => !v)}
            data-testid="op-button-comments-toggle"
          >
            <MessageSquare className="h-4 w-4" />
            AMS Comments / History
            {amsCommentsLoading ? (
              <Loader2 className="h-3 w-3 animate-spin ml-1" />
            ) : amsComments && amsComments.length > 0 ? (
              <span className="text-xs text-muted-foreground">({amsComments.length})</span>
            ) : null}
            {amsCommentsCollapsed ? <ChevronDown className="h-3.5 w-3.5 ml-0.5" /> : <ChevronUp className="h-3.5 w-3.5 ml-0.5" />}
          </button>
          {vin && (
            <Button
              size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => setCommentDialogOpen(true)}
              data-testid="op-button-add-comment"
            >
              <Send className="h-3 w-3" />
              Add Comment
            </Button>
          )}
        </div>

        {!amsCommentsCollapsed && (
          !vin ? (
            <p className="text-xs text-muted-foreground">No VIN available.</p>
          ) : amsCommentsLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading comments…</div>
          ) : !amsComments || amsComments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No AMS comments for this vehicle.</p>
          ) : (
            <div className="overflow-y-auto max-h-[600px] space-y-1.5 pr-1">
              {[...amsComments]
                .sort((a, b) => {
                  const da = new Date(a.Date || a.CommentDate || a.CreatedAt || a.UpdateDate || a.commentDate || a.createdAt || a.date || 0).getTime();
                  const db = new Date(b.Date || b.CommentDate || b.CreatedAt || b.UpdateDate || b.commentDate || b.createdAt || b.date || 0).getTime();
                  return db - da;
                })
                .map((comment: any, i: number) => (
                  <div key={i} className="p-2.5 bg-muted/40 rounded-lg space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{comment.User || comment.Author || comment.author || comment.CreatedBy || comment.UpdatedBy || comment.user || "Unknown"}</span>
                      <span className="text-xs text-muted-foreground">{comment.Date || comment.CommentDate || comment.CreatedAt || comment.UpdateDate || comment.commentDate || comment.createdAt || comment.date || ""}</span>
                    </div>
                    <p className="text-xs leading-relaxed">{comment.Comment || comment.CommentText || comment.Note || comment.Text || comment.comment || comment.note || comment.text || "—"}</p>
                  </div>
                ))}
            </div>
          )
        )}

        {/* Add Comment dialog (lives in tab — tightly coupled to comment list) */}
        <Dialog open={commentDialogOpen} onOpenChange={(open) => { setCommentDialogOpen(open); if (!open) setNewComment(""); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />Add AMS Comment
              </DialogTitle>
              <DialogDescription>
                Add a comment to vehicle {vin} in AMS.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Textarea
                placeholder="Add an AMS comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={5}
                className="resize-none"
                disabled={addCommentMutation.isPending}
                data-testid="op-textarea-ams-comment"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCommentDialogOpen(false); setNewComment(""); }} disabled={addCommentMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => newComment.trim() && addCommentMutation.mutate(newComment.trim())}
                disabled={!newComment.trim() || addCommentMutation.isPending}
                data-testid="op-button-submit-comment"
              >
                {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Add Comment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <Separator />

      {/* Nexus Tracking */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Nexus Tracking</h3>
        {nexusDataLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Post-Offboarded Status</Label>
              <Select value={nexusStatus} onValueChange={setNexusStatus}>
                <SelectTrigger className="mt-1" data-testid="op-select-nexus-status">
                  <SelectValue placeholder="Select status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reserved_for_new_hire">Reserved for new hire</SelectItem>
                  <SelectItem value="in_repair">In repair</SelectItem>
                  <SelectItem value="declined_repair">Declined repair</SelectItem>
                  <SelectItem value="available_for_rental_pmf">Available to assign for rental / send to PMF</SelectItem>
                  <SelectItem value="sent_to_pmf">Sent to PMF</SelectItem>
                  <SelectItem value="assigned_to_tech_in_rental">Assigned to tech in rental</SelectItem>
                  <SelectItem value="not_found">Not found</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">New Location</Label>
              <Input value={nexusLocation} onChange={(e) => setNexusLocation(e.target.value)} placeholder="Address or location description..." className="mt-1" data-testid="op-input-nexus-location" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">New Location Contact</Label>
              <Input value={nexusContact} onChange={(e) => setNexusContact(e.target.value)} placeholder="Phone number or contact info..." className="mt-1" data-testid="op-input-nexus-contact" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Comments</Label>
              <Textarea
                value={nexusComments}
                onChange={(e) => setNexusComments(e.target.value.slice(0, 400))}
                placeholder="Additional notes (max 400 characters)..."
                className="mt-1 resize-none" rows={3} maxLength={400}
                data-testid="op-textarea-nexus-comments"
              />
              <p className="text-xs text-muted-foreground text-right mt-1">{nexusComments.length}/400</p>
            </div>
            <Button
              onClick={() => vehicleNumber && saveNexusDataMutation.mutate({
                vehicleNumber,
                postOffboardedStatus: nexusStatus || null,
                nexusNewLocation: nexusLocation || null,
                nexusNewLocationContact: nexusContact || null,
                comments: nexusComments || null,
              })}
              disabled={!vehicleNumber || saveNexusDataMutation.isPending}
              className="w-full"
              data-testid="op-button-save-nexus"
            >
              {saveNexusDataMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <CheckCircle className="h-4 w-4 mr-2" />}
              Save Tracking Data
            </Button>
          </div>
        )}
      </section>

      <Separator />

      {/* Operation Log */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-4 w-4" />Operation Log
        </h3>
        {logsLoading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading logs…</div>
        ) : !vehicleOpLogs || vehicleOpLogs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No operations logged for this vehicle.</p>
        ) : (
          <div className="space-y-1.5">
            {vehicleOpLogs.slice(0, 5).map((log: any, i: number) => (
              <div key={i} className="p-2 bg-muted/40 rounded text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{log.operationType?.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">{log.createdAt ? new Date(log.createdAt).toLocaleDateString() : "—"}</span>
                </div>
                {(log.fromLdap || log.toLdap) && (
                  <div className="text-muted-foreground">{log.fromLdap || "—"} → {log.toLdap || "—"}</div>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {["tpms", "holman", "ams"].map((sys) => {
                    const st = log[`${sys}Status`];
                    if (!st) return null;
                    return (
                      <span key={sys} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${st === "success" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : st === "failed" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>
                        {sys.toUpperCase()}: {st}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
