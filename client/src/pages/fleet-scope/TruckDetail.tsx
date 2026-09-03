import { useEffect, useMemo, useState, useRef } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useParams, useLocation, useSearch } from "wouter";
import { type Truck, type Action, type TrackingRecord, insertTruckSchema, MAIN_STATUSES, SUB_STATUSES, REPAIR_OR_SALE_OPTIONS, type MainStatus } from "@shared/fleet-scope-schema";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { ActionTimeline } from "@/components/fleet-scope/ActionTimeline";
import { useUser } from "@/context/FleetScopeUserContext";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Search, FileCheck, Wrench, Tags, Calendar, Truck as TruckIcon, DollarSign, FileText, MapPin, ClipboardCheck, CheckCircle2, Package, RefreshCw, Plus, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { SystemSyncBadges } from "@/components/fleet-scope/SystemSyncBadges";

interface FleetOpsSystemResult {
  status: "success" | "failed" | "skipped" | "pending";
  message: string;
}

interface FleetOpsResult {
  log?: { id: number };
  tpms: FleetOpsSystemResult;
  holman: FleetOpsSystemResult;
  ams: FleetOpsSystemResult;
  overallSuccess: boolean;
  partialSuccess: boolean;
  message?: string;
}

interface RecentOpLog {
  id: number;
  operationType: string;
  tpmsStatus: string | null;
  tpmsMessage: string | null;
  holmanStatus: string | null;
  holmanMessage: string | null;
  amsStatus: string | null;
  amsMessage: string | null;
  toLdap: string | null;
  toTechName: string | null;
  requestedBy: string | null;
  createdAt: string;
}

interface FleetOpLogEntry {
  id: number;
  operationType: string;
  tpmsStatus: string | null;
  tpmsMessage: string | null;
  holmanStatus: string | null;
  holmanMessage: string | null;
  amsStatus: string | null;
  amsMessage: string | null;
  fromLdap: string | null;
  toLdap: string | null;
  toTechName: string | null;
  requestedBy: string | null;
  createdAt: string;
}

type OwnerName = "Oscar S" | "Rob A" | "Bob B" | "Final Actioned";

const ownerColors: Record<OwnerName, string> = {
  "Oscar S": "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
  "Rob A": "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  "Bob B": "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  "Final Actioned": "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
};

function determineOwner(truck: Truck): OwnerName {
  const mainStatus = truck.mainStatus || "";
  const subStatus = truck.subStatus || "";

  if (truck.vanPickedUp || mainStatus === "On Road" || subStatus === "Vehicle was sold") {
    return "Final Actioned";
  }
  if (mainStatus === "Confirming Status") {
    return "Oscar S";
  }
  if (mainStatus === "Decision Pending") {
    if (subStatus === "Estimate received, needs review") {
      return "Rob A";
    }
    return "Oscar S";
  }
  if (mainStatus === "Repairing") {
    return "Oscar S";
  }
  if (mainStatus === "Declined Repair" || mainStatus === "PMF") {
    return "Bob B";
  }
  if (mainStatus === "In Transit") {
    return "Oscar S";
  }
  return "Oscar S";
}

function getDefaultExpandedSections(mainStatus: string | null): string[] {
  const status = mainStatus || "Confirming Status";
  switch (status) {
    case "Confirming Status":
      return ["research"];
    case "Decision Pending":
      return ["research", "decision"];
    case "Repairing":
      return ["repair"];
    case "Declined Repair":
      return ["sales"];
    case "Tags":
      return ["registration"];
    case "Scheduling":
      return ["scheduling"];
    case "PMF":
    case "In Transit":
    case "On Road":
      return ["transport"];
    default:
      return ["research"];
  }
}

export default function TruckDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const { currentUser } = useUser();
  const { user: authUser } = useAuth();
  const { lookupCostCenter } = useCostCenters();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  
  // Determine where to navigate back to based on the 'from' query parameter
  const getBackUrl = () => {
    const params = new URLSearchParams(searchString);
    const from = params.get("from");
    if (from === "dashboard") {
      return "/fleet-scope/dashboard";
    }
    if (from === "queue") {
      return "/fleet-scope/queue";
    }
    return "/fleet-scope";
  };

  const { data: truck, isLoading: truckLoading } = useQuery<Truck>({
    queryKey: ["/api/fs/trucks", id],
  });

  const { data: actions, isLoading: actionsLoading } = useQuery<Action[]>({
    queryKey: ["/api/fs/trucks", id, "actions"],
  });

  const { data: trackingRecords, isLoading: trackingLoading, refetch: refetchTracking } = useQuery<TrackingRecord[]>({
    queryKey: ["/api/fs/trucks", id, "tracking"],
    enabled: !!id,
  });

  const truckNumberForSpecialty = truck?.truckNumber || "";
  const { data: techSpecialtyData } = useQuery<{ jobTitle: string | null; enterpriseId: string | null }>({
    queryKey: [`/api/fs/tech-specialty?truckNumber=${encodeURIComponent(truckNumberForSpecialty)}`],
    enabled: !!truckNumberForSpecialty,
  });

  const { data: tpmsVehicleData, isLoading: tpmsLoading } = useQuery<any>({
    queryKey: ["/api/tpms/lookup/truck", truckNumberForSpecialty],
    queryFn: async () => {
      const res = await fetch(`/api/tpms/lookup/truck/${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!truckNumberForSpecialty,
  });

  const { data: tpmsTechProfile } = useQuery<any>({
    queryKey: ["/api/tpms/techs", { truckNo: truckNumberForSpecialty }],
    queryFn: async () => {
      const res = await fetch(`/api/tpms/techs?truckNo=${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!truckNumberForSpecialty,
  });

  // TPMS Assign Tech modal state
  const [showAssignTechModal, setShowAssignTechModal] = useState(false);
  const [techSearchInput, setTechSearchInput] = useState("");
  const [techSearchQuery, setTechSearchQuery] = useState("");
  const [assignmentType, setAssignmentType] = useState<'assigned' | 'temp'>('assigned');
  const [tempEndDate, setTempEndDate] = useState("");
  const [showRepairSection, setShowRepairSection] = useState(false);
  const [repairData, setRepairData] = useState<{
    repairStatus?: number;
    repairReason?: number;
    vendor?: string;
    etaDate?: string;
    estimateCost?: number;
    rentalCar?: number;
    rentalStartDate?: string;
    rentalEndDate?: string;
  }>({});

  // Vehicle status from cache (for eligibility check)
  const { data: vehicleStatus, isLoading: isLoadingVehicleStatus } = useQuery<{
    holmanVehicleNumber: string;
    holmanAssignedStatusCd: string | null;
    holmanTechAssigned: string | null;
    holmanTechName: string | null;
    isLocked: boolean;
    lockedBy: string | null;
    byovVinMissing: boolean;
    vin: string | null;
  } | null>({
    queryKey: ["/api/fleet-ops/vehicle-status", truckNumberForSpecialty],
    queryFn: async () => {
      if (!truckNumberForSpecialty) return null;
      const res = await fetch(`/api/fleet-ops/vehicle-status/${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!truckNumberForSpecialty && showAssignTechModal,
    staleTime: 30000,
  });

  const { data: techSearchResults, isFetching: isSearchingTechs } = useQuery<any[]>({
    queryKey: ["/api/tpms/techs", { search: techSearchQuery }],
    queryFn: async () => {
      if (!techSearchQuery.trim()) return [];
      const res = await fetch(`/api/tpms/techs?search=${encodeURIComponent(techSearchQuery)}&limit=10`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!techSearchQuery,
  });

  // Last fleet operation result for this truck (inline system sync badges)
  const [lastOpResult, setLastOpResult] = useState<FleetOpsResult | null>(null);
  const [opDetailDialogOpen, setOpDetailDialogOpen] = useState(false);

  // BYOV creation audit record for this truck
  const [byovDetailOpen, setByovDetailOpen] = useState(false);
  const { data: byovAuditEntry } = useQuery<{
    id: number;
    vehicleNumber: string;
    vin: string | null;
    make: string | null;
    model: string | null;
    modelYear: string | null;
    assetType: string | null;
    district: string | null;
    submittedBy: string;
    submittedAt: string;
    holmanSuccess: boolean;
    holmanError: string | null;
    wmsSuccess: boolean;
    wmsError: string | null;
  } | null>({
    queryKey: ["/api/byov/audit-log", truckNumberForSpecialty],
    queryFn: async () => {
      if (!truckNumberForSpecialty) return null;
      const res = await fetch(`/api/byov/audit-log/${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!truckNumberForSpecialty,
    staleTime: 5 * 60 * 1000,
  });

  // Most recent op log for this truck — persists status across page reloads
  const { data: recentOpLog } = useQuery<RecentOpLog | null>({
    queryKey: ["/api/fleet-ops/recent-op", truckNumberForSpecialty],
    queryFn: async () => {
      if (!truckNumberForSpecialty) return null;
      const res = await fetch(`/api/fleet-ops/recent-op/${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!truckNumberForSpecialty,
  });

  // All op logs for this truck — fetched only when the detail dialog is open
  const { data: opDetailLogs } = useQuery<FleetOpLogEntry[]>({
    queryKey: ["/api/fleet-ops/logs", truckNumberForSpecialty],
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/logs?truckNumber=${encodeURIComponent(truckNumberForSpecialty)}`);
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json) ? json : (json.data || []);
    },
    enabled: opDetailDialogOpen && !!truckNumberForSpecialty,
    staleTime: 0,
  });

  const canRetrySync = authUser?.role === "admin" || authUser?.role === "developer";

  const retrySyncMutation = useMutation({
    mutationFn: async (logId: number) => {
      const res = await apiRequest("POST", `/api/operation-events/${logId}/retry`);
      return res.json();
    },
    onSuccess: () => {
      setLastOpResult(null);
      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/recent-op", truckNumberForSpecialty] });
      toast({ title: "Sync retry triggered", description: "The failed sync has been queued for retry." });
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err?.message ?? "Could not retry the sync.", variant: "destructive" });
    },
  });

  const assignTechMutation = useMutation({
    mutationFn: async ({ enterpriseId, districtNo, techName: tName }: { enterpriseId: string; districtNo: string; techName?: string }): Promise<FleetOpsResult> => {
      const statusCd = vehicleStatus?.holmanAssignedStatusCd;
      const isInRepair = statusCd === 'I';
      const res = await apiRequest("POST", "/api/fleet-ops/assign", {
        truckNumber: truckNumberForSpecialty,
        ldapId: enterpriseId,
        districtNo,
        techName: tName || enterpriseId,
        assignmentType,
        repairData: isInRepair && showRepairSection ? repairData : undefined,
      });
      return res.json() as Promise<FleetOpsResult>;
    },
    onSuccess: (result: FleetOpsResult) => {
      setLastOpResult(result);
      if (result.overallSuccess) {
        toast({ title: "Technician Assigned", description: "Tech assigned to vehicle in all systems." });
      } else if (result.partialSuccess) {
        const systemEntries: [string, FleetOpsSystemResult][] = [["TPMS", result.tpms], ["Holman", result.holman], ["AMS", result.ams]];
        const succeeded = systemEntries.filter(([, s]) => s.status === "success" || s.status === "skipped").map(([name]) => name).join(" and ");
        const failed = systemEntries.filter(([, s]) => s.status === "failed" || s.status === "pending").map(([name]) => name).join(", ");
        toast({
          title: "Partially Assigned",
          description: `Updated in ${succeeded} — ${failed} update pending`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Assignment failed", description: result.message || "All systems failed.", variant: "destructive" });
      }
      setShowAssignTechModal(false);
      setTechSearchInput("");
      setTechSearchQuery("");
      setAssignmentType('assigned');
      setTempEndDate("");
      setShowRepairSection(false);
      setRepairData({});
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/lookup/truck", truckNumberForSpecialty] });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/vehicle-status", truckNumberForSpecialty] });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/recent-op", truckNumberForSpecialty] });
    },
    onError: (err: any) => {
      if (err.status === 409 || (typeof err.message === 'string' && err.message.includes('being updated'))) {
        toast({ title: "Vehicle Locked", description: err.message || "This vehicle is being updated — please try again in a moment.", variant: "destructive" });
      } else {
        toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
      }
    },
  });

  // CDC pending changes for this truck's tech
  // enterprise_id is the UNIQUE profile key — tech_id can be shared by multiple techs
  // (the server 409s ambiguous tech_ids), so prefer enterpriseId in route params.
  const tpmsTechId = Array.isArray(tpmsTechProfile) && tpmsTechProfile.length > 0
    ? (tpmsTechProfile[0]?.enterpriseId || tpmsTechProfile[0]?.techId)
    : null;
  const { data: tpmsChangeHistoryData } = useQuery<{ techId: string; cdcLog: any[]; currentTpmsState: any; tpmsStateSource: string; pendingCount: number }>({
    queryKey: ["/api/tpms/techs", tpmsTechId, "change-history"],
    queryFn: async () => {
      const res = await fetch(`/api/tpms/techs/${encodeURIComponent(tpmsTechId!)}/change-history`);
      if (!res.ok) return { techId: tpmsTechId!, cdcLog: [], currentTpmsState: null, tpmsStateSource: 'none', pendingCount: 0 };
      return res.json();
    },
    enabled: !!tpmsTechId,
  });
  const tpmsChangeHistory = tpmsChangeHistoryData?.cdcLog || [];
  const pendingCdcCount = tpmsChangeHistoryData?.pendingCount ?? tpmsChangeHistory.filter((c: any) => !c.confirmedByTpms && !c.confirmedAt).length;

  // TPMS address management state
  const [addressDialogMode, setAddressDialogMode] = useState<'add' | 'edit' | null>(null);
  const [addressEditIndex, setAddressEditIndex] = useState<number | null>(null);
  const [addressForm, setAddressForm] = useState({ addrLine1: "", addrLine2: "", city: "", stateCd: "", zipCd: "", addressType: "PRIMARY" });

  const addAddressMutation = useMutation({
    mutationFn: async (addr: Record<string, string>) =>
      apiRequest("POST", `/api/tpms/techs/${encodeURIComponent(tpmsTechId!)}/addresses`, addr),
    onSuccess: () => {
      toast({ title: "Address added" });
      setAddressDialogMode(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs", { truckNo: truckNumberForSpecialty }] });
    },
    onError: (err: any) => toast({ title: "Failed to add address", description: err.message, variant: "destructive" }),
  });

  const editAddressMutation = useMutation({
    mutationFn: async ({ index, addr }: { index: number; addr: Record<string, string> }) =>
      apiRequest("PUT", `/api/tpms/techs/${encodeURIComponent(tpmsTechId!)}/addresses/${index}`, addr),
    onSuccess: () => {
      toast({ title: "Address updated" });
      setAddressDialogMode(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs", { truckNo: truckNumberForSpecialty }] });
    },
    onError: (err: any) => toast({ title: "Failed to update address", description: err.message, variant: "destructive" }),
  });

  const deleteAddressMutation = useMutation({
    mutationFn: async (index: number) =>
      apiRequest("DELETE", `/api/tpms/techs/${encodeURIComponent(tpmsTechId!)}/addresses/${index}`),
    onSuccess: () => {
      toast({ title: "Address removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs", { truckNo: truckNumberForSpecialty }] });
    },
    onError: (err: any) => toast({ title: "Failed to remove address", description: err.message, variant: "destructive" }),
  });

  // State for adding new tracking numbers
  const [newTrackingNumber, setNewTrackingNumber] = useState("");
  const [isAddingTracking, setIsAddingTracking] = useState(false);
  const [refreshingTrackingId, setRefreshingTrackingId] = useState<string | null>(null);

  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [showStatusConfirmDialog, setShowStatusConfirmDialog] = useState(false);
  const pendingFormDataRef = useRef<any>(null);

  useEffect(() => {
    if (truck?.mainStatus) {
      setExpandedSections(getDefaultExpandedSections(truck.mainStatus));
    }
  }, [truck?.mainStatus]);

  const form = useForm({
    resolver: zodResolver(insertTruckSchema),
    defaultValues: {
      truckNumber: "",
      mainStatus: "Confirming Status" as MainStatus,
      subStatus: null as string | null,
      shsOwner: "",
      registrationStickerValid: null as string | null,
      registrationInProgress: false,
      repairOrSaleDecision: null as string | null,
      vanInventoried: false,
      salePrice: "",
      datePutForSale: "",
      dateSold: "",
      datePutInRepair: "",
      repairCompleted: false,
      inAms: false,
      repairAddress: "",
      repairPhone: "",
      contactName: "",
      confirmedDeclinedRepair: "",
      tagsInOffice: false,
      tagsSentToTech: false,
      renewalProcessStarted: false,
      awaitingTechDocuments: false,
      documentsSentToHolman: false,
      holmanProcessingComplete: false,
      inspectionLocation: "",
      vanBroughtForInspection: false,
      inspectionComplete: false,
      techName: "",
      techPhone: "",
      techLeadName: "",
      techLeadPhone: "",
      pickUpSlotBooked: false,
      timeBlockedToPickUpVan: "",
      rentalReturned: false,
      vanPickedUp: false,
      comments: "",
      newTruckAssigned: false,
      registrationRenewalInProcess: false,
      spareVanAssignmentInProcess: false,
      spareVanInProcessToShip: false,
      lastUpdatedBy: "User",
    },
  });

  const watchedMainStatus = useWatch({ control: form.control, name: "mainStatus" });
  const availableSubStatuses = watchedMainStatus ? SUB_STATUSES[watchedMainStatus as MainStatus] || [] : [];

  // Watch all form values to detect changes for status reminder
  const formValues = useWatch({ control: form.control });

  useEffect(() => {
    if (watchedMainStatus) {
      const newSections = getDefaultExpandedSections(watchedMainStatus);
      setExpandedSections(prev => {
        const combined = new Set([...prev, ...newSections]);
        return Array.from(combined);
      });
    }
  }, [watchedMainStatus]);

  useEffect(() => {
    if (truck) {
      const truckAny = truck as any;
      form.reset({
        truckNumber: truck.truckNumber,
        mainStatus: (truck.mainStatus || "Confirming Status") as MainStatus,
        subStatus: truck.subStatus || null,
        shsOwner: truck.shsOwner || "",
        registrationStickerValid: truck.registrationStickerValid || null,
        registrationInProgress: truck.registrationInProgress || false,
        repairOrSaleDecision: truck.repairOrSaleDecision || null,
        vanInventoried: truck.vanInventoried || false,
        salePrice: truck.salePrice || "",
        datePutForSale: truck.datePutForSale || "",
        dateSold: truck.dateSold || "",
        datePutInRepair: truck.datePutInRepair || "",
        repairCompleted: truck.repairCompleted || false,
        inAms: truck.inAms || false,
        repairAddress: truck.repairAddress || "",
        repairPhone: truck.repairPhone || "",
        contactName: truck.contactName || "",
        confirmedDeclinedRepair: truck.confirmedDeclinedRepair || "",
        tagsInOffice: truckAny.tagsInOffice || false,
        tagsSentToTech: truckAny.tagsSentToTech || false,
        renewalProcessStarted: truckAny.renewalProcessStarted || false,
        awaitingTechDocuments: truckAny.awaitingTechDocuments || false,
        documentsSentToHolman: truckAny.documentsSentToHolman || false,
        holmanProcessingComplete: truckAny.holmanProcessingComplete || false,
        inspectionLocation: truckAny.inspectionLocation || "",
        vanBroughtForInspection: truckAny.vanBroughtForInspection || false,
        inspectionComplete: truckAny.inspectionComplete || false,
        techName: truck.techName || "",
        techPhone: truck.techPhone || "",
        techLeadName: (truck as any).techLeadName || "",
        techLeadPhone: (truck as any).techLeadPhone || "",
        pickUpSlotBooked: truck.pickUpSlotBooked || false,
        timeBlockedToPickUpVan: truck.timeBlockedToPickUpVan || "",
        rentalReturned: truck.rentalReturned || false,
        vanPickedUp: truck.vanPickedUp || false,
        comments: truck.comments || "",
        newTruckAssigned: truck.newTruckAssigned || false,
        registrationRenewalInProcess: truck.registrationRenewalInProcess || false,
        spareVanAssignmentInProcess: truck.spareVanAssignmentInProcess || false,
        spareVanInProcessToShip: truck.spareVanInProcessToShip || false,
        lastUpdatedBy: "User",
      });
    }
  }, [truck, form]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("PATCH", `/api/fs/trucks/${id}`, {
        ...data,
        lastUpdatedBy: currentUser || "Unknown User",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", id, "actions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      toast({
        title: "Success",
        description: "Truck details updated successfully",
      });
      // Navigate back to the correct page (Dashboard or Queue)
      setLocation(getBackUrl());
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update truck details",
        variant: "destructive",
      });
    },
  });

  const performSave = (data: any) => {
    // Status & shop-phone fields are VRM-owned (edited in VRM Rental
    // Operations, mirrored down); strip them from updates so stale form
    // values never trip the server-side ownership guard.
    const { mainStatus, subStatus, repairPhone, ...rest } = data ?? {};
    mutation.mutate(rest);
  };

  // Add tracking number mutation
  const addTrackingMutation = useMutation({
    mutationFn: async (trackingNumber: string) => {
      const response = await apiRequest("POST", "/api/fs/tracking", {
        truckId: id,
        trackingNumber,
        carrier: "UPS",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", id, "tracking"] });
      setNewTrackingNumber("");
      setIsAddingTracking(false);
      toast({
        title: "Tracking Added",
        description: "The tracking number has been added successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add tracking number",
        variant: "destructive",
      });
    },
  });

  // Refresh tracking info mutation
  const refreshTrackingMutation = useMutation({
    mutationFn: async (trackingId: string) => {
      setRefreshingTrackingId(trackingId);
      const response = await apiRequest("POST", `/api/fs/tracking/${trackingId}/refresh`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", id, "tracking"] });
      setRefreshingTrackingId(null);
      toast({
        title: "Tracking Updated",
        description: "The tracking information has been refreshed",
      });
    },
    onError: (error: any) => {
      setRefreshingTrackingId(null);
      toast({
        title: "Error",
        description: error.message || "Failed to refresh tracking",
        variant: "destructive",
      });
    },
  });

  // Delete tracking record mutation
  const deleteTrackingMutation = useMutation({
    mutationFn: async (trackingId: string) => {
      const response = await apiRequest("DELETE", `/api/fs/tracking/${trackingId}`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", id, "tracking"] });
      toast({
        title: "Tracking Removed",
        description: "The tracking number has been removed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove tracking",
        variant: "destructive",
      });
    },
  });

  const handleAddTracking = () => {
    if (!newTrackingNumber.trim()) return;
    addTrackingMutation.mutate(newTrackingNumber.trim());
  };

  const onSubmit = form.handleSubmit((data) => {
    // Check if status fields have changed from original truck values
    const originalMainStatus = truck?.mainStatus || "Confirming Status";
    const originalSubStatus = truck?.subStatus || null;
    const statusChanged = 
      data.mainStatus !== originalMainStatus || 
      data.subStatus !== originalSubStatus;

    if (!statusChanged && form.formState.isDirty) {
      // Status wasn't changed but other fields were - show confirmation
      pendingFormDataRef.current = data;
      setShowStatusConfirmDialog(true);
    } else {
      // Status was changed or no changes at all - proceed with save
      performSave(data);
    }
  });

  const owner = useMemo(() => {
    if (!truck) return "Oscar S";
    return determineOwner(truck);
  }, [truck]);

  if (truckLoading) {
    return (
      <div className="bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 lg:px-6 py-4">
            <Skeleton className="h-8 w-48" />
          </div>
        </header>
        <main className="container mx-auto px-4 lg:px-6 py-6 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Skeleton className="h-96 w-full" />
            </div>
            <div>
              <Skeleton className="h-96 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!truck) {
    return (
      <div className="bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Truck not found</h2>
          <p className="text-muted-foreground mb-4">
            The truck you're looking for doesn't exist.
          </p>
          <Link href="/fleet-scope">
            <Button>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href={getBackUrl()}>
                <Button variant="ghost" size="icon" data-testid="button-back">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-xl font-semibold">
                    Truck <span className="font-mono" data-testid="text-truck-number">{truck.truckNumber}</span>
                  </h1>
                </div>
                <StatusBadge 
                  status={truck.status} 
                  mainStatus={truck.mainStatus}
                  subStatus={truck.subStatus}
                  showSubStatusOnly={false}
                />
                <Badge 
                  variant="outline"
                  className={`text-xs font-medium ${ownerColors[owner]}`}
                  data-testid="badge-assigned-to"
                >
                  {owner}
                </Badge>
              </div>
            </div>
            <Button 
              onClick={onSubmit}
              disabled={mutation.isPending}
              data-testid="button-save"
            >
              {mutation.isPending ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 lg:px-6 py-6 max-w-7xl">
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <Accordion 
                  type="multiple" 
                  value={expandedSections}
                  onValueChange={setExpandedSections}
                  className="space-y-4"
                >
                  {/* Research & Location */}
                  <AccordionItem value="research" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-research">
                      <div className="flex items-center gap-2 flex-1">
                        <Search className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Research & Location</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Oscar</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="relative">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name="mainStatus"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Status</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value} disabled>
                                    <FormControl>
                                      <SelectTrigger data-testid="select-main-status">
                                        <SelectValue placeholder="Select status" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {MAIN_STATUSES.map((status) => (
                                        <SelectItem key={status} value={status}>
                                          {status}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs text-muted-foreground">
                                    Managed in VRM Rental Operations
                                  </p>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {availableSubStatuses.length > 0 && (
                              <FormField
                                control={form.control}
                                name="subStatus"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Sub-Status</FormLabel>
                                    <Select 
                                      onValueChange={(value) => field.onChange(value === "_none_" ? null : value)} 
                                      value={field.value || "_none_"}
                                      disabled
                                    >
                                      <FormControl>
                                        <SelectTrigger data-testid="select-sub-status">
                                          <SelectValue placeholder="Select sub-status" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="_none_">No sub-status</SelectItem>
                                        {availableSubStatuses.map((subStatus) => (
                                          <SelectItem key={subStatus} value={subStatus}>
                                            {subStatus}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="truckNumber"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Truck Number</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., 46249"
                                    className="font-mono"
                                    data-testid="input-truck-number"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="shsOwner"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>SHS Owner (Manual Override)</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Enter SHS owner name"
                                    data-testid="input-shs-owner"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={form.control}
                          name="repairAddress"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Repair Shop Location</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  placeholder="Enter full repair shop address"
                                  rows={2}
                                  data-testid="input-repair-address"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="repairPhone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Shop Phone</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="(555) 123-4567"
                                    className="font-mono"
                                    disabled
                                    data-testid="input-repair-phone"
                                  />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">
                                  Managed in VRM Rental Operations
                                </p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="contactName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Shop Contact Name</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Contact person"
                                    data-testid="input-contact-name"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Estimate & Decision */}
                  <AccordionItem value="decision" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-decision">
                      <div className="flex items-center gap-2 flex-1">
                        <FileCheck className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Estimate & Decision</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Rob A.</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="repairOrSaleDecision"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Repair or Sale Decision</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "__NONE__" ? null : value)} 
                                  value={field.value || "__NONE__"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-repair-or-sale-decision">
                                      <SelectValue placeholder="Not selected" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="__NONE__">Not selected</SelectItem>
                                    {REPAIR_OR_SALE_OPTIONS.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {option}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="confirmedDeclinedRepair"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Declined Repair Notes</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Details about declined repair"
                                    data-testid="input-declined-repair"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Repair Progress */}
                  <AccordionItem value="repair" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-repair">
                      <div className="flex items-center gap-2 flex-1">
                        <Wrench className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Repair Progress</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Oscar</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <FormField
                            control={form.control}
                            name="datePutInRepair"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date Put In Repair</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., 5/19/2025"
                                    data-testid="input-date-in-repair"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="repairCompleted"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Repair Completed</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "yes")} 
                                  value={field.value ? "yes" : "no"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-repair-completed">
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="inAms"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>AMS Documented</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "yes")} 
                                  value={field.value ? "yes" : "no"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-in-ams">
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Registration & Tags */}
                  <AccordionItem value="registration" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-registration">
                      <div className="flex items-center gap-2 flex-1">
                        <Tags className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Registration & Tags</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Cheryl</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <FormField
                            control={form.control}
                            name="registrationStickerValid"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Registration Sticker Status</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "__NONE__" ? null : value)} 
                                  value={field.value || "__NONE__"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-registration-sticker-valid">
                                      <SelectValue placeholder="Not selected" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="__NONE__">Not selected</SelectItem>
                                    <SelectItem value="Yes">Yes</SelectItem>
                                    <SelectItem value="Expired">Expired</SelectItem>
                                    <SelectItem value="Shop would not check">Shop would not check</SelectItem>
                                    <SelectItem value="Mailed Tag">Mailed Tag</SelectItem>
                                    <SelectItem value="Contacted tech">Contacted tech</SelectItem>
                                    <SelectItem value="Ordered duplicates">Ordered duplicates</SelectItem>
                                    <SelectItem value="Started Renewal">Started Renewal</SelectItem>
                                    <SelectItem value="Texted Reg">Texted Reg</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="registrationRenewalInProcess"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Registration Renewal In Process</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "yes")} 
                                  value={field.value ? "yes" : "no"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-registration-renewal">
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                            <ClipboardCheck className="w-4 h-4" />
                            Expired Tags Workflow
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            <FormField
                              control={form.control}
                              name="tagsInOffice"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-tags-in-office"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Tags in John/Cheryl's office
                                  </FormLabel>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="tagsSentToTech"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-tags-sent-to-tech"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Tags sent to technician
                                  </FormLabel>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="renewalProcessStarted"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-renewal-process-started"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Renewal process started
                                  </FormLabel>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="awaitingTechDocuments"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-awaiting-tech-documents"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Awaiting tech documents
                                  </FormLabel>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="documentsSentToHolman"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-documents-sent-to-holman"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Documents sent to Holman
                                  </FormLabel>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="holmanProcessingComplete"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-holman-processing-complete"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Holman processing complete
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>

                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            Vehicle Inspection Workflow
                          </h4>
                          <div className="space-y-3">
                            <FormField
                              control={form.control}
                              name="inspectionLocation"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Inspection Location</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder="Where tech should bring van for inspection"
                                      data-testid="input-inspection-location"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="flex flex-wrap gap-4">
                              <FormField
                                control={form.control}
                                name="vanBroughtForInspection"
                                render={({ field }) => (
                                  <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        data-testid="checkbox-van-brought-for-inspection"
                                      />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal cursor-pointer">
                                      Van brought for inspection
                                    </FormLabel>
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={form.control}
                                name="inspectionComplete"
                                render={({ field }) => (
                                  <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                      <Checkbox
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        data-testid="checkbox-inspection-complete"
                                      />
                                    </FormControl>
                                    <FormLabel className="text-sm font-normal cursor-pointer">
                                      Inspection complete
                                    </FormLabel>
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-3">Legacy Fields</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name="registrationInProgress"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Registration In Process (Cheryl mailed to tech)</FormLabel>
                                  <Select 
                                    onValueChange={(value) => field.onChange(value === "yes")} 
                                    value={field.value ? "yes" : "no"}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid="select-registration-in-progress">
                                        <SelectValue placeholder="Select..." />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="yes">Yes</SelectItem>
                                      <SelectItem value="no">No</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Pickup Scheduling */}
                  <AccordionItem value="scheduling" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-scheduling">
                      <div className="flex items-center gap-2 flex-1">
                        <Calendar className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Pickup Scheduling</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Oscar</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="techName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tech Name</FormLabel>
                                <FormControl>
                                  <Input {...field} placeholder="Technician name" data-testid="input-tech-name" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="techPhone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tech Phone Number</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="(555) 123-4567"
                                    className="font-mono"
                                    data-testid="input-tech-phone"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {truckNumberForSpecialty && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-3 bg-muted/50 rounded-lg" data-testid="text-enterprise-id">
                              <p className="text-sm text-muted-foreground mb-1">Enterprise ID</p>
                              <p className="text-sm font-medium">{techSpecialtyData?.enterpriseId || "Not available"}</p>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-lg" data-testid="text-tech-specialty">
                              <p className="text-sm text-muted-foreground mb-1">Tech Specialty</p>
                              <p className="text-sm font-medium">{techSpecialtyData?.jobTitle || "Not available"}</p>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="techLeadName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tech Lead Name</FormLabel>
                                <FormControl>
                                  <Input {...field} placeholder="Manager/Lead name" data-testid="input-tech-lead-name" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="techLeadPhone"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tech Lead Phone</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="(555) 123-4567"
                                    className="font-mono"
                                    data-testid="input-tech-lead-phone"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="pickUpSlotBooked"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Pick Up Slot Booked</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "yes")} 
                                  value={field.value ? "yes" : "no"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-pickup-slot-booked">
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="timeBlockedToPickUpVan"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Scheduled Pickup Time</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., 11/28/2025 2:00 PM"
                                    data-testid="input-time-blocked-pickup"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Transport & Delivery */}
                  <AccordionItem value="transport" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-transport">
                      <div className="flex items-center gap-2 flex-1">
                        <TruckIcon className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Transport & Delivery</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Oscar</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <p className="text-sm text-muted-foreground mb-1">Pickup Location</p>
                          <p className="text-sm font-medium">
                            {truck.repairAddress || "Not specified - set in Research & Location"}
                          </p>
                        </div>

                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4" />
                            Pickup & Return Checklist
                          </h4>
                          <div className="space-y-3">
                            <FormField
                              control={form.control}
                              name="vanPickedUp"
                              render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                      data-testid="checkbox-van-picked-up"
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal cursor-pointer">
                                    Van picked up by tech
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Sales Pipeline */}
                  <AccordionItem value="sales" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-sales">
                      <div className="flex items-center gap-2 flex-1">
                        <DollarSign className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Sales Pipeline</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Bob / Rob A.</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <FormField
                            control={form.control}
                            name="vanInventoried"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Van Inventoried</FormLabel>
                                <Select 
                                  onValueChange={(value) => field.onChange(value === "yes")} 
                                  value={field.value ? "yes" : "no"}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-van-inventoried">
                                      <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="salePrice"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Sale Price</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="e.g., $5,000"
                                    data-testid="input-sale-price"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="datePutForSale"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date Put for Sale</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="MM/DD/YYYY"
                                    data-testid="input-date-put-for-sale"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="dateSold"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date Sold</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="MM/DD/YYYY"
                                    data-testid="input-date-sold"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* UPS Shipment Tracking */}
                  <AccordionItem value="tracking" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-tracking">
                      <div className="flex items-center gap-2 flex-1">
                        <Package className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">UPS Shipment Tracking</span>
                        {trackingRecords && trackingRecords.length > 0 && (
                          <Badge variant="secondary" className="ml-2">{trackingRecords.length}</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="space-y-4">
                        {/* Add new tracking number */}
                        <div className="flex gap-2">
                          {isAddingTracking ? (
                            <>
                              <Input
                                value={newTrackingNumber}
                                onChange={(e) => setNewTrackingNumber(e.target.value)}
                                placeholder="Enter UPS tracking number"
                                className="flex-1"
                                data-testid="input-tracking-number"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddTracking();
                                  }
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                onClick={handleAddTracking}
                                disabled={addTrackingMutation.isPending || !newTrackingNumber.trim()}
                                data-testid="button-add-tracking-confirm"
                              >
                                {addTrackingMutation.isPending ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  "Add"
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setIsAddingTracking(false);
                                  setNewTrackingNumber("");
                                }}
                                data-testid="button-add-tracking-cancel"
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setIsAddingTracking(true)}
                              data-testid="button-add-tracking"
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Add Tracking Number
                            </Button>
                          )}
                        </div>

                        {/* Tracking records list */}
                        {trackingLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                          </div>
                        ) : trackingRecords && trackingRecords.length > 0 ? (
                          <div className="space-y-3">
                            {trackingRecords.map((record) => (
                              <div
                                key={record.id}
                                className="border rounded-lg p-3 bg-muted/30"
                                data-testid={`tracking-record-${record.id}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                                        {record.trackingNumber}
                                      </code>
                                      <Badge variant="outline" className="text-xs">
                                        {record.carrier}
                                      </Badge>
                                      {record.lastStatus && (
                                        <Badge
                                          variant={
                                            record.lastStatus === 'D' ? 'default' :
                                            record.lastStatus === 'I' ? 'secondary' :
                                            record.lastStatus === 'X' ? 'outline' :
                                            record.lastStatus === 'P' ? 'secondary' :
                                            'outline'
                                          }
                                          className={
                                            record.lastStatus === 'D' ? 'bg-green-500 text-white' :
                                            record.lastStatus === 'I' ? 'bg-blue-500 text-white' :
                                            record.lastStatus === 'X' ? 'bg-amber-500 text-white' :
                                            ''
                                          }
                                        >
                                          {record.lastStatus === 'D' ? 'Delivered' :
                                           record.lastStatus === 'I' ? 'In Transit' :
                                           record.lastStatus === 'P' ? 'Picked Up' :
                                           record.lastStatus === 'X' ? 'Exception' :
                                           record.lastStatus || 'Unknown'}
                                        </Badge>
                                      )}
                                    </div>
                                    {record.lastStatusDescription && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {record.lastStatusDescription}
                                      </p>
                                    )}
                                    {record.lastLocation && (
                                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3" />
                                        {record.lastLocation}
                                      </p>
                                    )}
                                    {record.estimatedDelivery && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Est. Delivery: {format(new Date(record.estimatedDelivery), "MMM d, yyyy h:mm a")}
                                      </p>
                                    )}
                                    {record.deliveredAt && (
                                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                        Delivered: {format(new Date(record.deliveredAt), "MMM d, yyyy h:mm a")}
                                      </p>
                                    )}
                                    {record.lastError && (
                                      <p className="text-xs text-red-500 mt-1">
                                        Error: {record.lastError}
                                      </p>
                                    )}
                                    {record.lastCheckedAt && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Last checked: {format(new Date(record.lastCheckedAt), "MMM d, h:mm a")}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => refreshTrackingMutation.mutate(record.id)}
                                      disabled={refreshingTrackingId === record.id}
                                      title="Refresh tracking"
                                      data-testid={`button-refresh-tracking-${record.id}`}
                                    >
                                      <RefreshCw
                                        className={`w-4 h-4 ${refreshingTrackingId === record.id ? 'animate-spin' : ''}`}
                                      />
                                    </Button>
                                    <a
                                      href={`https://www.ups.com/track?tracknum=${record.trackingNumber}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="View on UPS website"
                                    >
                                      <Button type="button" size="icon" variant="ghost">
                                        <ExternalLink className="w-4 h-4" />
                                      </Button>
                                    </a>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => deleteTrackingMutation.mutate(record.id)}
                                      disabled={deleteTrackingMutation.isPending}
                                      title="Remove tracking"
                                      data-testid={`button-delete-tracking-${record.id}`}
                                      className="text-destructive hover:text-destructive"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No tracking numbers added yet. Add a UPS tracking number to track shipments for this truck.
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* Legacy Options */}
                  <AccordionItem value="legacy" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-legacy">
                      <div className="flex items-center gap-2 flex-1">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">Additional Options</span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">Oscar</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="newTruckAssigned"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>New Truck Assigned</FormLabel>
                              <Select 
                                onValueChange={(value) => field.onChange(value === "yes")} 
                                value={field.value ? "yes" : "no"}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-new-truck-assigned">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="spareVanAssignmentInProcess"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Spare Van Assignment In Process</FormLabel>
                              <Select 
                                onValueChange={(value) => field.onChange(value === "yes")} 
                                value={field.value ? "yes" : "no"}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-spare-van-assignment">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="spareVanInProcessToShip"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Spare Van In Process to Ship</FormLabel>
                              <Select 
                                onValueChange={(value) => field.onChange(value === "yes")} 
                                value={field.value ? "yes" : "no"}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-spare-van-ship">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* TPMS Integration */}
                  <AccordionItem value="tpms" className="border rounded-lg px-4">
                    <AccordionTrigger className="hover:no-underline py-4" data-testid="accordion-tpms">
                      <div className="flex items-center gap-2 flex-1">
                        <Package className="w-5 h-5 text-muted-foreground" />
                        <span className="font-semibold">TPMS</span>
                        {tpmsVehicleData?.success && (
                          <Badge variant="outline" className="ml-2 text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                            Connected
                          </Badge>
                        )}
                        {!tpmsLoading && !tpmsVehicleData?.success && (
                          <Badge variant="outline" className="ml-2 text-xs bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                            No Data
                          </Badge>
                        )}
                        {!tpmsLoading && Array.isArray(tpmsTechProfile) && tpmsTechProfile[0]?.isLastKnown && (
                          <Badge variant="outline" className="ml-1 text-xs bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700">
                            Last known tech
                          </Badge>
                        )}
                        {pendingCdcCount > 0 && (
                          <Badge className="ml-1 text-xs bg-amber-500/20 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700" variant="outline">
                            {pendingCdcCount} pending
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      {tpmsLoading ? (
                        <div className="space-y-3">
                          <Skeleton className="h-6 w-48" />
                          <Skeleton className="h-20 w-full" />
                        </div>
                      ) : (() => {
                        const hasLiveData = tpmsVehicleData?.success;
                        const info = hasLiveData ? (tpmsVehicleData.data?.truckInfo || tpmsVehicleData.data) : null;
                        const techProfile = Array.isArray(tpmsTechProfile) && tpmsTechProfile.length > 0 ? tpmsTechProfile[0] : null;
                        const isLastKnown = techProfile?.isLastKnown === true;
                        const hasAnyData = hasLiveData || techProfile;
                        const currentEnterprise = info?.ldapId || techProfile?.enterpriseId || techSpecialtyData?.enterpriseId;
                        
                        if (!hasAnyData) {
                          const emptyStateSrc = lastOpResult
                            ? { tpmsStatus: lastOpResult.tpms?.status, tpmsMessage: lastOpResult.tpms?.message, holmanStatus: lastOpResult.holman?.status, holmanMessage: lastOpResult.holman?.message, amsStatus: lastOpResult.ams?.status, amsMessage: lastOpResult.ams?.message, logId: lastOpResult.log?.id ?? recentOpLog?.id, timestamp: undefined as string | undefined }
                            : recentOpLog
                            ? { tpmsStatus: recentOpLog.tpmsStatus ?? undefined, tpmsMessage: recentOpLog.tpmsMessage ?? undefined, holmanStatus: recentOpLog.holmanStatus ?? undefined, holmanMessage: recentOpLog.holmanMessage ?? undefined, amsStatus: recentOpLog.amsStatus ?? undefined, amsMessage: recentOpLog.amsMessage ?? undefined, logId: recentOpLog.id, timestamp: recentOpLog.createdAt }
                            : null;
                          return (
                            <div className="text-center py-6 space-y-3">
                              <Package className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                              <p className="text-sm text-muted-foreground">No TPMS data available for this vehicle.</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                The vehicle may not be registered in TPMS or the service is unavailable.
                              </p>
                              {emptyStateSrc && (
                                <div className="flex items-center gap-1.5 justify-center text-xs text-muted-foreground">
                                  <span className="shrink-0">Last sync:</span>
                                  <SystemSyncBadges
                                    tpmsStatus={emptyStateSrc.tpmsStatus}
                                    tpmsMessage={emptyStateSrc.tpmsMessage}
                                    holmanStatus={emptyStateSrc.holmanStatus}
                                    holmanMessage={emptyStateSrc.holmanMessage}
                                    amsStatus={emptyStateSrc.amsStatus}
                                    amsMessage={emptyStateSrc.amsMessage}
                                    logId={emptyStateSrc.logId}
                                    timestamp={emptyStateSrc.timestamp}
                                    onOpenDetail={() => setOpDetailDialogOpen(true)}
                                    onRetry={(logId) => retrySyncMutation.mutate(logId)}
                                    canRetry={canRetrySync}
                                    isRetrying={retrySyncMutation.isPending}
                                  />
                                </div>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setTechSearchInput("");
                                  setTechSearchQuery("");
                                  setShowAssignTechModal(true);
                                }}
                              >
                                <Plus className="w-3.5 h-3.5 mr-1.5" />
                                Assign Tech
                              </Button>
                            </div>
                          );
                        }
                        
                        return (
                          <div className="space-y-4">
                            {isLastKnown && (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
                                <span className="text-xs text-amber-700 dark:text-amber-400">
                                  Tech no longer active in TPMS — showing last known profile
                                  {techProfile?.lastSeenAt && (
                                    <> · last seen {new Date(techProfile.lastSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>
                                  )}
                                </span>
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Assigned Technician</p>
                                <p className="text-sm font-medium">
                                  {info?.techFirstName || info?.firstName || techProfile?.firstName || "—"}{" "}
                                  {info?.techLastName || info?.lastName || techProfile?.lastName || ""}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Enterprise ID</p>
                                <p className="text-sm font-medium">{currentEnterprise || "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">District</p>
                                <p className="text-sm font-medium">{info?.districtNo || techProfile?.districtNo || "—"}</p>
                                {(info?.districtNo || techProfile?.districtNo) && lookupCostCenter(info?.districtNo || techProfile?.districtNo) && (
                                  <p className="text-xs text-muted-foreground">CC {lookupCostCenter(info?.districtNo || techProfile?.districtNo)}</p>
                                )}
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Tech ID</p>
                                <p className="text-sm font-medium">{info?.techId || techProfile?.techId || "—"}</p>
                              </div>
                            </div>

                            {(() => {
                              const addrs = info?.addresses || techProfile?.shippingAddresses || [];
                              return (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-medium text-muted-foreground">Shipping Addresses ({addrs.length})</p>
                                    {tpmsTechId && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => {
                                          setAddressForm({ addrLine1: "", addrLine2: "", city: "", stateCd: "", zipCd: "", addressType: "PRIMARY" });
                                          setAddressEditIndex(null);
                                          setAddressDialogMode("add");
                                        }}
                                      >
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add
                                      </Button>
                                    )}
                                  </div>
                                  {addrs.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-2">No addresses on file.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {addrs.map((addr: any, i: number) => (
                                        <div key={i} className="text-sm bg-muted/50 rounded-md p-3 flex items-start justify-between gap-2">
                                          <div>
                                            {addr.addressType && <p className="text-xs text-muted-foreground mb-0.5">{addr.addressType}</p>}
                                            <p>{addr.addrLine1 || addr.address1 || ""}</p>
                                            {(addr.addrLine2 || addr.address2) && <p>{addr.addrLine2 || addr.address2}</p>}
                                            <p>
                                              {addr.city || ""}{addr.city && (addr.state || addr.stateCd) ? ", " : ""}{addr.state || addr.stateCd || ""} {addr.zipCd || addr.zip || ""}
                                            </p>
                                          </div>
                                          {tpmsTechId && (
                                            <div className="flex gap-1 shrink-0">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0"
                                                onClick={() => {
                                                  setAddressForm({
                                                    addrLine1: addr.addrLine1 || "",
                                                    addrLine2: addr.addrLine2 || "",
                                                    city: addr.city || "",
                                                    stateCd: addr.stateCd || addr.state || "",
                                                    zipCd: addr.zipCd || addr.zip || "",
                                                    addressType: addr.addressType || "PRIMARY",
                                                  });
                                                  setAddressEditIndex(i);
                                                  setAddressDialogMode("edit");
                                                }}
                                              >
                                                <RefreshCw className="w-3 h-3" />
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                                disabled={deleteAddressMutation.isPending}
                                                onClick={() => {
                                                  if (!confirm("Remove this shipping address?")) return;
                                                  deleteAddressMutation.mutate(i);
                                                }}
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {techProfile && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {techProfile.mobilePhone && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Mobile Phone</p>
                                    <p className="text-sm">{techProfile.mobilePhone}</p>
                                  </div>
                                )}
                                {techProfile.email && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Email</p>
                                    <p className="text-sm">{techProfile.email}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {techProfile?.shippingSchedule && Object.keys(techProfile.shippingSchedule).length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Shipping Schedule</p>
                                <div className="flex gap-1.5 flex-wrap">
                                  {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => (
                                    <Badge
                                      key={day}
                                      variant={(techProfile.shippingSchedule as Record<string, boolean>)?.[day] ? "default" : "outline"}
                                      className="text-xs"
                                    >
                                      {day.slice(0, 3)}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* System sync status badges — shown after any assign/unassign op */}
                            {(() => {
                              const src = lastOpResult
                                ? {
                                    tpmsStatus: lastOpResult.tpms?.status,
                                    tpmsMessage: lastOpResult.tpms?.message,
                                    holmanStatus: lastOpResult.holman?.status,
                                    holmanMessage: lastOpResult.holman?.message,
                                    amsStatus: lastOpResult.ams?.status,
                                    amsMessage: lastOpResult.ams?.message,
                                    logId: lastOpResult.log?.id ?? recentOpLog?.id,
                                    timestamp: undefined as string | undefined,
                                  }
                                : recentOpLog
                                ? {
                                    tpmsStatus: recentOpLog.tpmsStatus ?? undefined,
                                    tpmsMessage: recentOpLog.tpmsMessage ?? undefined,
                                    holmanStatus: recentOpLog.holmanStatus ?? undefined,
                                    holmanMessage: recentOpLog.holmanMessage ?? undefined,
                                    amsStatus: recentOpLog.amsStatus ?? undefined,
                                    amsMessage: recentOpLog.amsMessage ?? undefined,
                                    logId: recentOpLog.id,
                                    timestamp: recentOpLog.createdAt,
                                  }
                                : null;
                              if (!src) return null;
                              return (
                                <div className="flex items-center gap-1.5 justify-between text-xs text-muted-foreground">
                                  <span className="shrink-0">Last sync:</span>
                                  <SystemSyncBadges
                                    tpmsStatus={src.tpmsStatus}
                                    tpmsMessage={src.tpmsMessage}
                                    holmanStatus={src.holmanStatus}
                                    holmanMessage={src.holmanMessage}
                                    amsStatus={src.amsStatus}
                                    amsMessage={src.amsMessage}
                                    logId={src.logId}
                                    timestamp={src.timestamp}
                                    onOpenDetail={() => setOpDetailDialogOpen(true)}
                                    onRetry={(logId) => retrySyncMutation.mutate(logId)}
                                    canRetry={canRetrySync}
                                    isRetrying={retrySyncMutation.isPending}
                                  />
                                </div>
                              );
                            })()}

                            <div className="flex items-center gap-2 justify-end flex-wrap">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setTechSearchInput("");
                                  setTechSearchQuery("");
                                  setShowAssignTechModal(true);
                                }}
                              >
                                <Plus className="w-3.5 h-3.5 mr-1.5" />
                                {currentEnterprise ? "Reassign Tech" : "Assign Tech"}
                              </Button>
                              {currentEnterprise && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
                                  onClick={async () => {
                                    if (!confirm(`Unassign technician ${currentEnterprise} from truck ${truckNumberForSpecialty}?`)) return;
                                    try {
                                      const res = await apiRequest("POST", `/api/fleet-ops/unassign`, { truckNumber: truckNumberForSpecialty, ldapId: currentEnterprise });
                                      const result = await res.json() as FleetOpsResult;
                                      setLastOpResult(result);
                                      if (result.overallSuccess) {
                                        toast({ title: "Unassigned", description: "Technician unassigned from vehicle in all systems." });
                                      } else if (result.partialSuccess) {
                                        const systemEntries: [string, FleetOpsSystemResult][] = [["TPMS", result.tpms], ["Holman", result.holman], ["AMS", result.ams]];
                                        const succeeded = systemEntries.filter(([, s]) => s.status === "success" || s.status === "skipped").map(([name]) => name).join(" and ");
                                        const failed = systemEntries.filter(([, s]) => s.status === "failed" || s.status === "pending").map(([name]) => name).join(", ");
                                        toast({
                                          title: "Partially Unassigned",
                                          description: `Updated in ${succeeded} — ${failed} update pending`,
                                          variant: "destructive",
                                        });
                                      } else {
                                        toast({ title: "Unassign failed", description: result.message || "All systems failed.", variant: "destructive" });
                                      }
                                      queryClient.invalidateQueries({ queryKey: ["/api/tpms/lookup/truck", truckNumberForSpecialty] });
                                      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
                                      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/recent-op", truckNumberForSpecialty] });
                                    } catch (err: unknown) {
                                      toast({ title: "Unassign failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
                                    }
                                  }}
                                >
                                  Unassign Tech
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (currentEnterprise) {
                                    window.open(`/tpms/tech-profiles?enterpriseId=${encodeURIComponent(currentEnterprise)}`, "_blank");
                                  } else {
                                    window.open("/tpms/tech-profiles", "_blank");
                                  }
                                }}
                              >
                                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                Open in TPMS
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                {/* Comments - Always Visible */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Comments
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="comments"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Any comments or notes about this truck"
                              rows={4}
                              data-testid="input-comments"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* BYOV Creation Note */}
                {byovAuditEntry && (
                  <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <ClipboardCheck className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                      <span>
                        Created via BYOV by{" "}
                        <span className="font-medium text-foreground">{byovAuditEntry.submittedBy}</span>
                        {" "}on{" "}
                        <span className="font-medium text-foreground">
                          {format(new Date(byovAuditEntry.submittedAt), "MMM d, yyyy")}
                        </span>
                      </span>
                      {(!byovAuditEntry.holmanSuccess || !byovAuditEntry.wmsSuccess) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium cursor-default ${
                                  !byovAuditEntry.holmanSuccess && !byovAuditEntry.wmsSuccess
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                }`}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                {!byovAuditEntry.holmanSuccess && !byovAuditEntry.wmsSuccess
                                  ? "Holman & WMS failed"
                                  : !byovAuditEntry.holmanSuccess
                                  ? "Holman failed"
                                  : "WMS failed"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs whitespace-pre-line">
                              {!byovAuditEntry.holmanSuccess && !byovAuditEntry.wmsSuccess
                                ? [
                                    byovAuditEntry.holmanError
                                      ? `Holman: ${byovAuditEntry.holmanError}`
                                      : "Holman registration failed",
                                    byovAuditEntry.wmsError
                                      ? `WMS: ${byovAuditEntry.wmsError}`
                                      : "WMS registration failed",
                                  ].join("\n")
                                : !byovAuditEntry.holmanSuccess
                                ? byovAuditEntry.holmanError
                                  ? `Holman: ${byovAuditEntry.holmanError}`
                                  : "Holman registration failed"
                                : byovAuditEntry.wmsError
                                ? `WMS: ${byovAuditEntry.wmsError}`
                                : "WMS registration failed"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setByovDetailOpen(true)}
                      className="text-blue-500 hover:text-blue-600 hover:underline font-medium shrink-0"
                    >
                      View details
                    </button>
                  </div>
                )}

                {/* Last Updated */}
                <div className="text-xs text-muted-foreground text-right">
                  Last updated: {truck.lastUpdatedAt ? format(new Date(truck.lastUpdatedAt), "MMM d, yyyy h:mm a") : "—"} by {truck.lastUpdatedBy || "System"}
                </div>
              </div>

              <div>
                <Card className="sticky top-24">
                  <CardHeader>
                    <CardTitle className="text-lg">Action History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {actionsLoading ? (
                      <div className="space-y-3">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-20 w-full" />
                        ))}
                      </div>
                    ) : (
                      <ActionTimeline actions={actions || []} />
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </form>
        </Form>
      </main>

      {/* BYOV Creation Detail Dialog */}
      {byovAuditEntry && (
        <Dialog open={byovDetailOpen} onOpenChange={setByovDetailOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-blue-500" />
                BYOV Submission Details
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="text-muted-foreground">Vehicle #</div>
                <div className="font-medium">{byovAuditEntry.vehicleNumber}</div>

                {byovAuditEntry.vin && (
                  <>
                    <div className="text-muted-foreground">VIN</div>
                    <div className="font-medium font-mono text-xs">{byovAuditEntry.vin}</div>
                  </>
                )}

                {(byovAuditEntry.make || byovAuditEntry.model || byovAuditEntry.modelYear) && (
                  <>
                    <div className="text-muted-foreground">Vehicle</div>
                    <div className="font-medium">
                      {[byovAuditEntry.modelYear, byovAuditEntry.make, byovAuditEntry.model].filter(Boolean).join(" ") || "—"}
                    </div>
                  </>
                )}

                {byovAuditEntry.assetType && (
                  <>
                    <div className="text-muted-foreground">Asset Type</div>
                    <div className="font-medium">{byovAuditEntry.assetType}</div>
                  </>
                )}

                {byovAuditEntry.district && (
                  <>
                    <div className="text-muted-foreground">District</div>
                    <div className="font-medium">{byovAuditEntry.district}</div>
                  </>
                )}

                <div className="text-muted-foreground">Submitted By</div>
                <div className="font-medium">{byovAuditEntry.submittedBy}</div>

                <div className="text-muted-foreground">Submitted At</div>
                <div className="font-medium">{format(new Date(byovAuditEntry.submittedAt), "MMM d, yyyy h:mm a")}</div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">System Results</div>
                <div className="flex items-start gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${byovAuditEntry.holmanSuccess ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                    {byovAuditEntry.holmanSuccess ? "✓" : "✗"} Holman
                  </span>
                  {!byovAuditEntry.holmanSuccess && byovAuditEntry.holmanError && (
                    <span className="text-xs text-muted-foreground">{byovAuditEntry.holmanError}</span>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${byovAuditEntry.wmsSuccess ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                    {byovAuditEntry.wmsSuccess ? "✓" : "✗"} WMS
                  </span>
                  {!byovAuditEntry.wmsSuccess && byovAuditEntry.wmsError && (
                    <span className="text-xs text-muted-foreground">{byovAuditEntry.wmsError}</span>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setByovDetailOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Status Change Confirmation Dialog */}
      <AlertDialog open={showStatusConfirmDialog} onOpenChange={setShowStatusConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Don't forget to change the status if needed!
            </AlertDialogTitle>
            <AlertDialogDescription>
              You're saving changes but haven't updated the status. Are you sure the current status is still correct?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-save">
              Go Back & Update Status
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (pendingFormDataRef.current) {
                  performSave(pendingFormDataRef.current);
                  pendingFormDataRef.current = null;
                }
              }}
              data-testid="button-confirm-save"
            >
              Save Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Address Add/Edit Dialog */}
      <Dialog open={addressDialogMode !== null} onOpenChange={(open) => { if (!open) setAddressDialogMode(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{addressDialogMode === 'add' ? 'Add Shipping Address' : 'Edit Shipping Address'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Address Type</label>
              <Select value={addressForm.addressType} onValueChange={(v) => setAddressForm(f => ({ ...f, addressType: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIMARY">Primary</SelectItem>
                  <SelectItem value="RE_ASSORTMENT">Re-Assortment</SelectItem>
                  <SelectItem value="DROP_RETURN">Drop Return</SelectItem>
                  <SelectItem value="ALTERNATE">Alternate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Address Line 1</label>
              <Input className="mt-1" value={addressForm.addrLine1} onChange={(e) => setAddressForm(f => ({ ...f, addrLine1: e.target.value }))} placeholder="Street address" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Address Line 2</label>
              <Input className="mt-1" value={addressForm.addrLine2} onChange={(e) => setAddressForm(f => ({ ...f, addrLine2: e.target.value }))} placeholder="Apt, suite, etc. (optional)" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="text-xs font-medium text-muted-foreground">City</label>
                <Input className="mt-1" value={addressForm.city} onChange={(e) => setAddressForm(f => ({ ...f, city: e.target.value }))} placeholder="City" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">State</label>
                <Input className="mt-1" value={addressForm.stateCd} onChange={(e) => setAddressForm(f => ({ ...f, stateCd: e.target.value }))} placeholder="ST" maxLength={2} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ZIP</label>
                <Input className="mt-1" value={addressForm.zipCd} onChange={(e) => setAddressForm(f => ({ ...f, zipCd: e.target.value }))} placeholder="ZIP" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddressDialogMode(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!addressForm.addrLine1 || addAddressMutation.isPending || editAddressMutation.isPending}
              onClick={() => {
                const addr = { ...addressForm };
                if (addressDialogMode === 'add') {
                  addAddressMutation.mutate(addr);
                } else if (addressDialogMode === 'edit' && addressEditIndex !== null) {
                  editAddressMutation.mutate({ index: addressEditIndex, addr });
                }
              }}
            >
              {addressDialogMode === 'add' ? 'Add Address' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Tech Modal */}
      <Dialog open={showAssignTechModal} onOpenChange={(open) => {
        setShowAssignTechModal(open);
        if (!open) {
          setTechSearchInput("");
          setTechSearchQuery("");
          setAssignmentType('assigned');
          setTempEndDate("");
          setShowRepairSection(false);
          setRepairData({});
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Technician to Truck {truckNumberForSpecialty}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Vehicle status and eligibility */}
            {isLoadingVehicleStatus && <Skeleton className="h-12 w-full" />}
            {vehicleStatus && (() => {
              const statusCd = vehicleStatus.holmanAssignedStatusCd;
              const BLOCKED_STATUSES: Record<string, string> = { L: 'For Sale', B: 'At Auction', W: 'Wrecked/Stolen', T: 'Terminated' };
              const BORDERLINE_STATUSES: Record<string, string> = { H: 'At Upfitter', I: 'In Repair', O: 'Storage', Q: 'Order Pending' };
              const isBlocked = statusCd ? !!BLOCKED_STATUSES[statusCd] : false;
              const isBorderline = statusCd ? !!BORDERLINE_STATUSES[statusCd] : false;
              const isInRepair = statusCd === 'I';
              return (
                <>
                  {/* Status badge */}
                  {statusCd && (
                    <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm border ${
                      isBlocked ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300' :
                      isBorderline ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300' :
                      'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300'
                    }`}>
                      <span className="font-medium">
                        Holman Status: {statusCd}
                        {BLOCKED_STATUSES[statusCd] && ` — ${BLOCKED_STATUSES[statusCd]}`}
                        {BORDERLINE_STATUSES[statusCd] && ` — ${BORDERLINE_STATUSES[statusCd]}`}
                      </span>
                      {isBlocked && <span className="ml-auto text-xs font-semibold">BLOCKED</span>}
                      {isBorderline && <span className="ml-auto text-xs font-semibold">WARNING</span>}
                    </div>
                  )}
                  {/* Blocked message */}
                  {isBlocked && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300">
                      This vehicle cannot be assigned because its Holman status is <strong>{BLOCKED_STATUSES[statusCd!]}</strong>. Contact fleet operations to resolve the vehicle status before assigning.
                    </div>
                  )}
                  {/* Locked message */}
                  {vehicleStatus.isLocked && (
                    <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300">
                      ⚠ This vehicle is currently being updated by another operation. Please wait and try again in a moment.
                    </div>
                  )}
                  {/* Current occupant warning */}
                  {vehicleStatus.holmanTechAssigned && (
                    <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300">
                      Currently assigned: <strong>{vehicleStatus.holmanTechName || vehicleStatus.holmanTechAssigned}</strong> ({vehicleStatus.holmanTechAssigned}). Assigning a new tech will displace this tech.
                    </div>
                  )}
                  {/* In Repair expand prompt */}
                  {isInRepair && !showRepairSection && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300">
                      This vehicle is In Repair (I). You must provide repair details before assigning.{' '}
                      <button type="button" className="underline font-medium" onClick={() => setShowRepairSection(true)}>
                        Add repair info
                      </button>
                    </div>
                  )}
                  {/* Repair section */}
                  {isInRepair && showRepairSection && (
                    <div className="border rounded-md p-3 space-y-3 bg-amber-50/40 dark:bg-amber-900/10">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">AMS Repair Details (Required)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Repair Status ID</label>
                          <Input
                            type="number"
                            placeholder="e.g. 6"
                            value={repairData.repairStatus ?? ""}
                            onChange={e => setRepairData(d => ({ ...d, repairStatus: e.target.value ? parseInt(e.target.value) : undefined }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Repair Reason ID</label>
                          <Input
                            type="number"
                            placeholder="e.g. 1"
                            value={repairData.repairReason ?? ""}
                            onChange={e => setRepairData(d => ({ ...d, repairReason: e.target.value ? parseInt(e.target.value) : undefined }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Vendor</label>
                          <Input
                            placeholder="Vendor name"
                            value={repairData.vendor ?? ""}
                            onChange={e => setRepairData(d => ({ ...d, vendor: e.target.value || undefined }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">ETA Date</label>
                          <Input
                            type="date"
                            value={repairData.etaDate ?? ""}
                            onChange={e => setRepairData(d => ({ ...d, etaDate: e.target.value || undefined }))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Est. Cost (optional)</label>
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={repairData.estimateCost ?? ""}
                            onChange={e => setRepairData(d => ({ ...d, estimateCost: e.target.value ? parseFloat(e.target.value) : undefined }))}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Status preview */}
                  <div className="rounded-md border px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">After assignment</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>Holman → <strong>{assignmentType === 'temp' ? 'F (Temp)' : (statusCd === 'D' ? 'D (BYOV)' : 'A (Assigned)')}</strong></span>
                      <span>TPMS → <strong>Assigned</strong></span>
                      <span>AMS → <strong>{isInRepair && showRepairSection ? 'In Repair (Status 6)' : 'Assigned to Tech (Status 1)'}</strong></span>
                    </div>
                  </div>
                  {/* Only show rest of form if not blocked or locked */}
                  {!isBlocked && !vehicleStatus.isLocked && (
                    <>
                      {/* Assignment type */}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={assignmentType === 'assigned' ? 'default' : 'outline'}
                          onClick={() => setAssignmentType('assigned')}
                        >
                          Assigned (Permanent)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={assignmentType === 'temp' ? 'default' : 'outline'}
                          onClick={() => setAssignmentType('temp')}
                        >
                          Temp Assignment
                        </Button>
                      </div>
                      {assignmentType === 'temp' && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">End Date (optional)</label>
                          <Input
                            type="date"
                            value={tempEndDate}
                            onChange={e => setTempEndDate(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      )}
                      {/* Tech search */}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search by enterprise ID or name…"
                          value={techSearchInput}
                          onChange={(e) => setTechSearchInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setTechSearchQuery(techSearchInput);
                          }}
                          data-testid="input-tpms-tech-search"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setTechSearchQuery(techSearchInput)}
                          disabled={isSearchingTechs}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                      {isSearchingTechs && (
                        <div className="space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      )}
                      {!isSearchingTechs && techSearchResults && techSearchResults.length === 0 && techSearchQuery && (
                        <p className="text-sm text-muted-foreground text-center py-4">No technicians found.</p>
                      )}
                      {!isSearchingTechs && techSearchResults && techSearchResults.length > 0 && (
                        <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                          {techSearchResults.map((tech: any) => (
                            <div
                              key={tech.enterpriseId || tech.techId}
                              className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer"
                              onClick={() => {
                                if (assignTechMutation.isPending) return;
                                if (isInRepair && showRepairSection && (!repairData.repairStatus || !repairData.repairReason || !repairData.vendor || !repairData.etaDate)) {
                                  toast({ title: "Repair details required", description: "Please fill in all required repair fields before assigning.", variant: "destructive" });
                                  return;
                                }
                                assignTechMutation.mutate({
                                  enterpriseId: tech.enterpriseId,
                                  districtNo: tech.districtNo || "",
                                  techName: `${tech.firstName || ''} ${tech.lastName || ''}`.trim() || tech.enterpriseId,
                                });
                              }}
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {tech.firstName} {tech.lastName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {tech.enterpriseId} · District {tech.districtNo || "—"}{tech.districtNo && lookupCostCenter(tech.districtNo) ? ` · CC ${lookupCostCenter(tech.districtNo)}` : ""}
                                </p>
                              </div>
                              <Button type="button" size="sm" variant="outline" disabled={assignTechMutation.isPending}>
                                Assign
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}
            {/* Fallback: no vehicleStatus yet but not loading */}
            {!isLoadingVehicleStatus && !vehicleStatus && (
              <>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={assignmentType === 'assigned' ? 'default' : 'outline'}
                    onClick={() => setAssignmentType('assigned')}
                  >
                    Assigned (Permanent)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={assignmentType === 'temp' ? 'default' : 'outline'}
                    onClick={() => setAssignmentType('temp')}
                  >
                    Temp Assignment
                  </Button>
                </div>
                {assignmentType === 'temp' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">End Date (optional)</label>
                    <Input
                      type="date"
                      value={tempEndDate}
                      onChange={e => setTempEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="Search by enterprise ID or name…"
                    value={techSearchInput}
                    onChange={(e) => setTechSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setTechSearchQuery(techSearchInput);
                    }}
                    data-testid="input-tpms-tech-search"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTechSearchQuery(techSearchInput)}
                    disabled={isSearchingTechs}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
                {isSearchingTechs && (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                )}
                {!isSearchingTechs && techSearchResults && techSearchResults.length === 0 && techSearchQuery && (
                  <p className="text-sm text-muted-foreground text-center py-4">No technicians found.</p>
                )}
                {!isSearchingTechs && techSearchResults && techSearchResults.length > 0 && (
                  <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                    {techSearchResults.map((tech: any) => (
                      <div
                        key={tech.enterpriseId || tech.techId}
                        className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          if (assignTechMutation.isPending) return;
                          assignTechMutation.mutate({
                            enterpriseId: tech.enterpriseId,
                            districtNo: tech.districtNo || "",
                            techName: `${tech.firstName || ''} ${tech.lastName || ''}`.trim() || tech.enterpriseId,
                          });
                        }}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {tech.firstName} {tech.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tech.enterpriseId} · District {tech.districtNo || "—"}
                          </p>
                        </div>
                        <Button type="button" size="sm" variant="outline" disabled={assignTechMutation.isPending}>
                          Assign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setShowAssignTechModal(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Operation History Detail Dialog */}
      <Dialog open={opDetailDialogOpen} onOpenChange={setOpDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Operation History — Truck #{truckNumberForSpecialty}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {!opDetailLogs ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : opDetailLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No operations logged for this vehicle.</p>
            ) : (
              opDetailLogs.slice(0, 10).map((log: FleetOpLogEntry, i: number) => {
                const systems: Array<{ key: string; label: string; status: string | null; message: string | null }> = [
                  { key: "tpms", label: "TPMS", status: log.tpmsStatus, message: log.tpmsMessage },
                  { key: "holman", label: "Holman", status: log.holmanStatus, message: log.holmanMessage },
                  { key: "ams", label: "AMS", status: log.amsStatus, message: log.amsMessage },
                ];
                const statusColor = (s: string) =>
                  s === "success" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                  : s === "failed" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                  : s === "pending" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-muted text-muted-foreground";
                return (
                  <div key={i} className="rounded-md border p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize">{log.operationType?.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                    </div>
                    {(log.fromLdap || log.toLdap) && (
                      <div className="text-xs text-muted-foreground">
                        {log.fromLdap && <span>{log.fromLdap} → </span>}
                        {log.toLdap && <span className="font-medium text-foreground">{log.toLdap}{log.toTechName ? ` (${log.toTechName})` : ""}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {systems.map(({ key, label, status, message }) => (
                        status ? (
                          <span
                            key={key}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${statusColor(status)}`}
                            title={message || undefined}
                          >
                            <span className="font-mono">{label}</span>
                            <span>{status}</span>
                          </span>
                        ) : null
                      ))}
                    </div>
                    {log.requestedBy && (
                      <div className="text-xs text-muted-foreground">by {log.requestedBy}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpDetailDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
