import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { toHolmanRef, toDisplayNumber, toCanonical } from "@shared/vehicle-number-utils";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Truck, Search, Filter, ChevronDown, ChevronUp, RefreshCw, AlertCircle, 
  CheckCircle, XCircle, Database, Loader2, Link2, MapPin, Eye, EyeOff,
  UserX, History, AlertTriangle, User, Package, Car, X, Gauge,
  UserPlus, ArrowLeftRight, FileText, Home, Activity, MessageSquare, Send, Pencil, Wrench
} from "lucide-react";
import { GiMagicLamp } from "react-icons/gi";
import { BackButton } from "@/components/ui/back-button";
import { ViewInventoryButton } from "@/components/view-inventory-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { type FleetVehicle } from "@/data/fleetData";
import { getVehicleOwnership } from "@/lib/vehicle-utils";
import { DataSourceIndicator, calculateZipDistance, getDistanceLabel, AssignmentHistoryDialog } from "@/components/fleet";
import { LicensePlate } from "@/components/license-plate";

interface FleetVehiclesResponse {
  success: boolean;
  totalCount?: number;
  vehicles: FleetVehicle[];
  message?: string;
  syncStatus?: {
    dataMode: 'live' | 'cached' | 'empty';
    isStale: boolean;
    lastSyncAt: string | null;
    pendingChangeCount: number;
    totalVehicles: number;
    apiAvailable: boolean;
    errorMessage?: string | null;
  };
}

interface ServiceStatus {
  configured: boolean;
  dataSources: {
    snowflake: boolean;
    tpms: boolean;
    holman: boolean;
  };
}

interface TpmsSyncState {
  initialSyncComplete: boolean;
  lastSyncAt: string | null;
  totalVehicles: number;
  processedVehicles: number;
  cachedAssignments: number;
  syncInProgress: boolean;
  lastError: string | null;
  vehiclesSynced?: number;
  totalVehiclesToSync?: number;
  vehiclesWithAssignments?: number;
  vehiclesWithoutAssignments?: number;
  status?: string;
  errorMessage?: string | null;
  initialSyncCompletedAt?: string | null;
}

function getAmsLookupLabel(item: any): string {
  if (!item) return "Unknown";
  const skip = new Set(['UniqueID', 'uniqueID', 'Id', 'id']);
  for (const [key, val] of Object.entries(item)) {
    if (skip.has(key)) continue;
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return String(item.UniqueID);
}

export default function FleetManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'developer' || user?.role === 'admin';
  
  // Search and filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetZipcode, setTargetZipcode] = useState("");
  
  // Vehicle Details filters
  const [makeFilter, setMakeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  
  // Configuration filters
  const [vehicleProgramFilter, setVehicleProgramFilter] = useState("all");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [interiorFilter, setInteriorFilter] = useState("all");
  const [tuneStatusFilter, setTuneStatusFilter] = useState("all");
  
  // Assignment Status filter
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");
  
  // Location filters
  const [stateFilter, setStateFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [licenseStateFilter, setLicenseStateFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  
  // Tech Assignment filters
  const [holmanTechFilter, setHolmanTechFilter] = useState("all");
  const [tpmsTechFilter, setTpmsTechFilter] = useState("all");
  const [mismatchFilter, setMismatchFilter] = useState("all");
  
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [showOos, setShowOos] = useState(false);
  
  // Quick lookup state
  const [techLookup, setTechLookup] = useState("");
  const [truckLookup, setTruckLookup] = useState("");
  
  // Selected vehicle for detail view
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  
  // Nexus tracking data form state
  const [nexusStatus, setNexusStatus] = useState<string>("");
  const [nexusLocation, setNexusLocation] = useState("");
  const [nexusContact, setNexusContact] = useState("");
  const [nexusComments, setNexusComments] = useState("");

  // Fetch vehicles from Holman API with TPMS enrichment
  const { data: apiResponse, isLoading, error, refetch, isFetching } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Service status for data sources
  const { data: serviceStatus } = useQuery<{ success: boolean; data: ServiceStatus }>({
    queryKey: ['/api/vehicle-assignments/status'],
  });

  // TPMS sync state for cache-first mode
  const { data: tpmsSyncState, refetch: refetchSyncState } = useQuery<{ success: boolean; data: TpmsSyncState }>({
    queryKey: ['/api/tpms/fleet-sync/state'],
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.data?.syncInProgress ? 3000 : false;
    },
  });

  const tpmsSync = tpmsSyncState?.data;

  const syncStatus = apiResponse?.syncStatus;
  const apiError = apiResponse && !apiResponse.success ? apiResponse.message : null;
  const hasError = error || (apiError && syncStatus?.dataMode === 'empty');
  const errorMessage = apiError || syncStatus?.errorMessage || (error as Error)?.message || 'Failed to load vehicles';
  const isDegradedMode = syncStatus?.dataMode === 'cached';
  const isLiveMode = syncStatus?.dataMode === 'live';
  
  const allVehicles = apiResponse?.vehicles || [];
  
  // Sync to Holman mutation
  const syncToHolmanMutation = useMutation({
    mutationFn: async ({ vehicleNumber, enterpriseId }: { vehicleNumber: string; enterpriseId?: string | null }) => {
      const response = await apiRequest('POST', '/api/holman/assignments/update', { vehicleNumber, enterpriseId });
      return response.json();
    },
    onSuccess: (data: any) => {
      const isUnassign = !data.payload?.clientData2;
      toast({
        title: isUnassign ? "Vehicle Unassigned in Holman" : "Holman Sync Started",
        description: isUnassign 
          ? `Vehicle ${data.holmanVehicleNumber} has been unassigned in Holman`
          : `Vehicle ${data.holmanVehicleNumber} sync initiated`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/holman/fleet-vehicles'] });
    },
    onError: (error: any) => {
      toast({
        title: "Holman Update Failed",
        description: error.message || "Failed to update vehicle assignment",
        variant: "destructive",
      });
    },
  });

  // Fetch Nexus tracking data when vehicle is selected
  const { data: nexusData, isLoading: nexusDataLoading } = useQuery<{
    postOffboardedStatus: string | null;
    nexusNewLocation: string | null;
    nexusNewLocationContact: string | null;
    comments: string | null;
  } | null>({
    queryKey: ['/api/vehicle-nexus-data', selectedVehicle?.vehicleNumber],
    enabled: !!selectedVehicle?.vehicleNumber,
  });

  // Update form state when nexus data is loaded
  useEffect(() => {
    if (nexusData) {
      setNexusStatus(nexusData.postOffboardedStatus || "");
      setNexusLocation(nexusData.nexusNewLocation || "");
      setNexusContact(nexusData.nexusNewLocationContact || "");
      setNexusComments(nexusData.comments || "");
    } else if (selectedVehicle) {
      setNexusStatus("");
      setNexusLocation("");
      setNexusContact("");
      setNexusComments("");
    }
  }, [nexusData, selectedVehicle]);

  // Save Nexus tracking data mutation
  const saveNexusDataMutation = useMutation({
    mutationFn: async (data: { 
      vehicleNumber: string;
      postOffboardedStatus: string | null;
      nexusNewLocation: string | null;
      nexusNewLocationContact: string | null;
      comments: string | null;
    }) => {
      const response = await apiRequest('PUT', `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Tracking Data Saved",
        description: "Vehicle tracking information has been updated",
      });
      if (selectedVehicle) {
        queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', selectedVehicle.vehicleNumber] });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save tracking data",
        variant: "destructive",
      });
    },
  });

  // ─── Cross-System Fleet Operations State ───────────────────────────────────
  type FleetModal = "assign" | "unassign" | "address" | "poHistory" | "amsComments" | "amsEdit" | "amsRepair" | null;
  const [activeModal, setActiveModal] = useState<FleetModal>(null);

  // Assign form
  const [assignLdap, setAssignLdap] = useState("");
  const [assignTechName, setAssignTechName] = useState("");
  const [assignDistrict, setAssignDistrict] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  // Assign form — tech lookup / typeahead
  const [assignLookupStatus, setAssignLookupStatus] = useState<"idle" | "loading" | "found" | "notfound">("idle");
  const [techNameSuggestions, setTechNameSuggestions] = useState<any[]>([]);
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const nameDropdownRef = useRef<HTMLDivElement>(null);
  const assignAutoFilledRef = useRef(false); // prevents search firing when we auto-fill name

  // Reset lookup state when assign modal opens
  useEffect(() => {
    if (activeModal === "assign") {
      setAssignLookupStatus("idle");
      setTechNameSuggestions([]);
      setShowNameDropdown(false);
    }
  }, [activeModal]);

  // Close name dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (nameDropdownRef.current && !nameDropdownRef.current.contains(e.target as Node)) {
        setShowNameDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced LDAP ID → auto-fill name & district
  useEffect(() => {
    if (!assignLdap || assignLdap.length < 3) {
      setAssignLookupStatus("idle");
      return;
    }
    setAssignLookupStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/all-techs/lookup/${encodeURIComponent(assignLdap.trim())}`, { credentials: "include" });
        const json = await res.json();
        if (json.found) {
          setAssignLookupStatus("found");
          if (!assignTechName) {
            assignAutoFilledRef.current = true;
            setAssignTechName(json.techName || `${json.firstName ?? ""} ${json.lastName ?? ""}`.trim());
          }
          if (!assignDistrict && json.districtNo) {
            setAssignDistrict(String(json.districtNo));
          }
        } else {
          setAssignLookupStatus("notfound");
        }
      } catch {
        setAssignLookupStatus("idle");
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [assignLdap]);

  // Debounced Tech Name → search for suggestions
  useEffect(() => {
    if (assignAutoFilledRef.current) {
      assignAutoFilledRef.current = false;
      return;
    }
    if (!assignTechName || assignTechName.length < 2) {
      setTechNameSuggestions([]);
      setShowNameDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/vehicle-assignments/search/technicians?q=${encodeURIComponent(assignTechName)}`, { credentials: "include" });
        const json = await res.json();
        const results = json.data ?? json.technicians ?? [];
        setTechNameSuggestions(results);
        setShowNameDropdown(results.length > 0);
      } catch {
        setTechNameSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [assignTechName]);

  function selectTechSuggestion(tech: any) {
    assignAutoFilledRef.current = true;
    setAssignLdap(tech.techRacfid || tech.racfId || tech.ldapId || "");
    setAssignTechName(tech.techName || `${tech.firstName ?? ""} ${tech.lastName ?? ""}`.trim());
    setAssignDistrict(tech.districtNo ? String(tech.districtNo) : "");
    setAssignLookupStatus("found");
    setShowNameDropdown(false);
    setTechNameSuggestions([]);
  }


  // Unassign form
  const [unassignNotes, setUnassignNotes] = useState("");

  // PO History filter state
  const [poFilterDateFrom, setPoFilterDateFrom] = useState("");
  const [poFilterDateTo, setPoFilterDateTo] = useState("");
  const [poFilterPoNumber, setPoFilterPoNumber] = useState("");
  const [poFilterVendor, setPoFilterVendor] = useState("");

  // Address form
  const [addrLine1, setAddrLine1] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");

  // AMS Edit form (user-updatable fields)
  const [amsEditColor, setAmsEditColor] = useState("");
  const [amsEditBranding, setAmsEditBranding] = useState("");
  const [amsEditInterior, setAmsEditInterior] = useState("");
  const [amsEditAddress, setAmsEditAddress] = useState("");
  const [amsEditAddressZip, setAmsEditAddressZip] = useState("");
  const [amsEditTruckStatus, setAmsEditTruckStatus] = useState("");
  const [amsEditTheftVerified, setAmsEditTheftVerified] = useState("");
  const [amsEditKeyAddress, setAmsEditKeyAddress] = useState("");
  const [amsEditKeyZip, setAmsEditKeyZip] = useState("");
  const [amsEditStorageCost, setAmsEditStorageCost] = useState("");
  const [amsEditVehicleRuns, setAmsEditVehicleRuns] = useState("");
  const [amsEditVehicleLooks, setAmsEditVehicleLooks] = useState("");

  // AMS Repair form
  const [amsRepairInRepair, setAmsRepairInRepair] = useState(false);
  const [amsRepairDate, setAmsRepairDate] = useState("");
  const [amsRepairReason, setAmsRepairReason] = useState("");
  const [amsRepairVendor, setAmsRepairVendor] = useState("");
  const [amsRepairETA, setAmsRepairETA] = useState("");
  const [amsRepairStatus, setAmsRepairStatus] = useState("");
  const [amsRepairEstimate, setAmsRepairEstimate] = useState("");
  const [amsRepairRentalCar, setAmsRepairRentalCar] = useState("");
  const [amsRepairRentalStart, setAmsRepairRentalStart] = useState("");
  const [amsRepairRentalEnd, setAmsRepairRentalEnd] = useState("");
  const [amsRepairFinalDisposition, setAmsRepairFinalDisposition] = useState("");
  const [amsRepairDispositionReason, setAmsRepairDispositionReason] = useState("");
  const [amsRepairFinalDate, setAmsRepairFinalDate] = useState("");

  // Operation result (per-system status returned from fleet-ops endpoint)
  const [opResult, setOpResult] = useState<any>(null);

  // PO flags (open rental / maintenance counts per vehicle) — loaded once
  const { data: poFlagsData } = useQuery<Record<string, { hasOpenRental: boolean; openRentalCount: number; hasOpenMaintenance: boolean; openMaintenanceCount: number }>>({
    queryKey: ['/api/fleet-vehicles/po-flags'],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  type PoFlag = { hasOpenRental: boolean; openRentalCount: number; hasOpenMaintenance: boolean; openMaintenanceCount: number };
  const poFlagsMap = useMemo(() => {
    const m = new Map<string, PoFlag>();
    if (!poFlagsData) return m;
    for (const [rawKey, val] of Object.entries(poFlagsData)) {
      m.set(rawKey, val as PoFlag);
      const stripped = toCanonical(rawKey) || rawKey;
      if (stripped !== rawKey) m.set(stripped, val as PoFlag);
      const padded = toDisplayNumber(rawKey);
      if (padded !== rawKey) m.set(padded, val as PoFlag);
    }
    return m;
  }, [poFlagsData]);

  // POs for selected vehicle
  const { data: vehiclePOs, isLoading: posLoading } = useQuery<any[]>({
    queryKey: ["/api/holman/pos", selectedVehicle?.vehicleNumber],
    enabled: !!selectedVehicle?.vehicleNumber,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/holman/pos/${selectedVehicle!.vehicleNumber}`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || json || [];
    },
  });

  // AMS vehicle data for selected vehicle
  const { data: amsVehicle, isLoading: amsLoading } = useQuery<any>({
    queryKey: ["/api/ams/vehicles", selectedVehicle?.vin],
    enabled: !!selectedVehicle?.vin,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${selectedVehicle!.vin}`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return json || null;
    },
  });

  const [newComment, setNewComment] = useState("");
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [amsCommentsCollapsed, setAmsCommentsCollapsed] = useState(false);

  const addCommentMutation = useMutation({
    mutationFn: async (comment: string) => {
      const res = await apiRequest("POST", `/api/ams/vehicles/${selectedVehicle!.vin}/comments`, { comment });
      return res.json();
    },
    onSuccess: () => {
      setNewComment("");
      setCommentDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles/comments", selectedVehicle?.vin] });
      toast({ title: "Comment added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const amsUserUpdateMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/ams/vehicles/${selectedVehicle!.vin}/user-updates`, payload);
      return res.json();
    },
    onSuccess: () => {
      setActiveModal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles", selectedVehicle?.vin] });
      toast({ title: "AMS vehicle fields updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update AMS fields", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const { data: truckStatusLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'truck-status'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: vehicleRunsLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'vehicle-runs'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: vehicleLooksLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'vehicle-looks'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: colorLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'colors'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: brandingLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'branding'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: interiorLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'interior'],
    enabled: !!selectedVehicle?.vin,
    staleTime: 10 * 60 * 1000,
  });
  const { data: repairReasonLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'service-reasons'],
    enabled: activeModal === "amsRepair",
    staleTime: 10 * 60 * 1000,
  });
  const { data: repairStatusLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'repair-status'],
    enabled: activeModal === "amsRepair",
    staleTime: 10 * 60 * 1000,
  });
  const { data: dispositionLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'repair-disposition'],
    enabled: activeModal === "amsRepair",
    staleTime: 10 * 60 * 1000,
  });
  const { data: dispositionReasonLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'disposition-reasons'],
    enabled: activeModal === "amsRepair",
    staleTime: 10 * 60 * 1000,
  });
  const { data: rentalCarLookup } = useQuery<any[]>({
    queryKey: ['/api/ams/lookups', 'rental-car'],
    enabled: activeModal === "amsRepair",
    staleTime: 10 * 60 * 1000,
  });

  const amsRepairMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const isFinalizing = payload.finalDisposition !== undefined;
      const endpoint = isFinalizing
        ? `/api/ams/vehicles/${selectedVehicle!.vin}/repair-disposition`
        : `/api/ams/vehicles/${selectedVehicle!.vin}/repair-updates`;
      const res = await apiRequest("POST", endpoint, payload);
      return res.json();
    },
    onSuccess: () => {
      setActiveModal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles", selectedVehicle?.vin] });
      toast({ title: "AMS repair status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update repair status", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  // AMS comments for selected vehicle — always load when vehicle is selected
  const { data: amsComments, isLoading: amsCommentsLoading } = useQuery<any[]>({
    queryKey: ["/api/ams/vehicles/comments", selectedVehicle?.vin],
    enabled: !!selectedVehicle?.vin,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${selectedVehicle!.vin}/comments`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      if (Array.isArray(json)) return json;
      if (json && typeof json === 'object') {
        const arr = json.data || json.comments || json.rows || json.items || json.records || json.CommentList || json.Comments || json.Notes || json.notes;
        if (Array.isArray(arr)) return arr;
        if (typeof arr === 'object' && arr !== null) return Object.values(arr);
      }
      return [];
    },
  });

  // Fleet op logs for selected vehicle
  const { data: vehicleOpLogs, isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/fleet-ops/logs", selectedVehicle?.vehicleNumber],
    enabled: !!selectedVehicle?.vehicleNumber,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/logs?truckNumber=${encodeURIComponent(selectedVehicle!.vehicleNumber)}`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || json || [];
    },
  });

  const fleetOpMutation = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body: any }) => {
      const res = await apiRequest("POST", endpoint, body);
      const json = await res.json();
      return json;
    },
    onSuccess: (data: any, variables: { endpoint: string; body: any }) => {
      setOpResult(data);
      const { endpoint, body } = variables;
      const isAssignOrUnassign = endpoint.includes("/assign") || endpoint.includes("/unassign");

      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/logs", selectedVehicle?.vehicleNumber] });
      // For assign/unassign, DON'T immediately invalidate fleet-vehicles — the Holman live API
      // still returns the old data until the 202 is confirmed, which would overwrite the
      // optimistic setQueryData patch below. Only invalidate for other operations.
      if (!isAssignOrUnassign) {
        queryClient.invalidateQueries({ queryKey: ["/api/holman/fleet-vehicles"] });
      }
      if (selectedVehicle?.vehicleNumber) {
        queryClient.invalidateQueries({ queryKey: ["/api/vehicle-nexus-data", selectedVehicle.vehicleNumber] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments/status"] });

      // Immediately patch both selectedVehicle AND the fleet vehicles query cache
      // so that the vehicle card and detail sheet update without waiting for the
      // Holman confirmation (202 async queue).
      const vNum = selectedVehicle?.vehicleNumber;
      if (vNum && isAssignOrUnassign) {
        const applyPatch = (v: FleetVehicle): FleetVehicle => {
          if (v.vehicleNumber !== vNum) return v;
          if (endpoint.includes("/unassign")) {
            return { ...v, tpmsAssignedTechId: "", tpmsAssignedTechName: "", holmanTechAssigned: "", holmanTechName: "" };
          }
          if (endpoint.includes("/assign")) {
            return {
              ...v,
              tpmsAssignedTechId: body.ldapId ?? v.tpmsAssignedTechId,
              tpmsAssignedTechName: body.techName ?? v.tpmsAssignedTechName,
              holmanTechAssigned: body.ldapId ?? v.holmanTechAssigned,
              holmanTechName: body.techName ?? v.holmanTechName,
            };
          }
          return v;
        };

        // Patch the in-memory query cache so every card in the grid updates now
        queryClient.setQueryData<FleetVehiclesResponse>(['/api/holman/fleet-vehicles'], (old) => {
          if (!old) return old;
          return { ...old, vehicles: old.vehicles.map(applyPatch) };
        });

        // Also update the standalone selectedVehicle state (drives the Sheet panel)
        setSelectedVehicle(prev => prev ? applyPatch(prev) : prev);
      }
    },
    onError: (err: any) => {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    },
  });

  // Poll Holman submission status while it's pending verification (202 async queue).
  // Holman uses async 202 responses — "pending" means accepted, not failed.
  // We poll for up to 30s; if still pending, we show "Accepted" (safe to close).
  const holmanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holmanPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const submissionId = opResult?.holmanSubmissionDbId;
    const isHolmanPending = opResult?.holman?.status === "pending";

    if (submissionId && isHolmanPending) {
      if (holmanPollRef.current) clearInterval(holmanPollRef.current);
      if (holmanPollTimeoutRef.current) clearTimeout(holmanPollTimeoutRef.current);

      holmanPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/holman/submissions/${submissionId}`, { credentials: "include" });
          if (!res.ok) return;
          const json = await res.json();
          const sub = json.submission;
          if (!sub) return;

          if (sub.status === "completed" || sub.status === "failed") {
            if (holmanPollRef.current) clearInterval(holmanPollRef.current);
            if (holmanPollTimeoutRef.current) clearTimeout(holmanPollTimeoutRef.current);
            setOpResult((prev: any) => ({
              ...prev,
              holman: {
                ...prev.holman,
                status: sub.status === "completed" ? "success" : "failed",
                message: sub.status === "completed"
                  ? "Confirmed by Holman"
                  : (sub.errorMessage || "Holman verification failed"),
              },
            }));
            queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/logs", selectedVehicle?.vehicleNumber] });
          }
        } catch {
          // ignore poll errors silently
        }
      }, 5_000);

      // After 30s, Holman verification happens via background fleet sync (not real-time).
      // Transition to "accepted" so the dialog doesn't show a spinner indefinitely.
      holmanPollTimeoutRef.current = setTimeout(() => {
        if (holmanPollRef.current) clearInterval(holmanPollRef.current);
        setOpResult((prev: any) => {
          if (prev?.holman?.status !== "pending") return prev;
          return {
            ...prev,
            holman: {
              ...prev.holman,
              status: "accepted",
              message: "Accepted by Holman — confirmation happens via background sync",
            },
          };
        });
      }, 30_000);

    } else {
      if (holmanPollRef.current) {
        clearInterval(holmanPollRef.current);
        holmanPollRef.current = null;
      }
      if (holmanPollTimeoutRef.current) {
        clearTimeout(holmanPollTimeoutRef.current);
        holmanPollTimeoutRef.current = null;
      }
    }

    return () => {
      if (holmanPollRef.current) clearInterval(holmanPollRef.current);
      if (holmanPollTimeoutRef.current) clearTimeout(holmanPollTimeoutRef.current);
    };
  }, [opResult?.holmanSubmissionDbId, opResult?.holman?.status]);

  function openModal(m: FleetModal) {
    setOpResult(null);
    // Pre-populate district from selected vehicle when opening assign
    if (m === "assign") {
      setAssignDistrict(selectedVehicle?.district || "");
    }
    // Pre-populate address from vehicle location
    if (m === "address") {
      setAddrLine1(selectedVehicle?.city ? `${selectedVehicle.city}` : "");
      setAddrCity(selectedVehicle?.city || "");
      setAddrState(selectedVehicle?.state || "");
      setAddrZip(selectedVehicle?.zip || "");
    }
    setActiveModal(m);
  }

  function SystemStatusBadge({ status }: { status: string }) {
    if (status === "success") return <Badge className="bg-green-600 text-white text-xs"><CheckCircle className="h-3 w-3 mr-1 inline" />Success</Badge>;
    if (status === "failed") return <Badge className="bg-red-600 text-white text-xs"><XCircle className="h-3 w-3 mr-1 inline" />Failed</Badge>;
    if (status === "skipped") return <Badge variant="secondary" className="text-xs">Skipped</Badge>;
    if (status === "pending") return <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400"><Loader2 className="h-3 w-3 mr-1 inline animate-spin" />Pending</Badge>;
    if (status === "accepted") return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-xs border border-amber-300"><CheckCircle className="h-3 w-3 mr-1 inline" />Accepted</Badge>;
    return <Badge variant="secondary" className="text-xs">{status || "—"}</Badge>;
  }

  // ─── Generate filter options from data ────────────────────────────────────
  const filterOptions = useMemo(() => {
    const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    const uniqueNum = (arr: number[]) => Array.from(new Set(arr.filter(n => n > 0))).sort((a, b) => b - a);
    
    return {
      makes: unique(allVehicles.map(v => v.makeName)),
      models: unique(allVehicles.map(v => v.modelName)),
      colors: unique(allVehicles.map(v => v.color)),
      years: uniqueNum(allVehicles.map(v => v.modelYear)),
      states: unique(allVehicles.map(v => v.state)),
      licenseStates: unique(allVehicles.map(v => v.licenseState)),
      regions: unique(allVehicles.map(v => v.region)),
      divisions: unique(allVehicles.map(v => v.division || '')),
      districts: unique(allVehicles.map(v => v.district)),
      cities: unique(allVehicles.map(v => v.city)),
      brandings: unique(allVehicles.map(v => v.branding)),
      interiors: unique(allVehicles.map(v => v.interior)),
      tuneStatuses: unique(allVehicles.map(v => v.tuneStatus)),
      holmanTechs: unique(allVehicles.map(v => v.holmanTechAssigned || '').filter(Boolean)),
      tpmsTechs: unique(allVehicles.map(v => v.tpmsAssignedTechId || '').filter(Boolean)),
    };
  }, [allVehicles]);

  // Count active filters
  const activeFiltersCount = [
    makeFilter, modelFilter, yearFilter, colorFilter,
    vehicleProgramFilter, brandingFilter, interiorFilter, tuneStatusFilter,
    assignmentStatusFilter,
    stateFilter, cityFilter, licenseStateFilter, regionFilter, divisionFilter, districtFilter,
    holmanTechFilter, tpmsTechFilter, mismatchFilter
  ].filter(f => f !== "all").length + (targetZipcode ? 1 : 0);

  // OOS pre-filter — exclude out-of-service vehicles unless toggle is on
  const activeVehicles = useMemo(() =>
    showOos ? allVehicles : allVehicles.filter(v => !v.outOfServiceDate && v.statusCode !== 2),
    [allVehicles, showOos]
  );
  const oosCount = allVehicles.length - activeVehicles.length;

  // Apply filters — when a search is active, include OOS vehicles so targeted
  // lookups (e.g. searching by truck number) always return a result
  const filteredVehicles = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();
    const pool = (searchLower && !showOos) ? allVehicles : activeVehicles;
    return pool.filter(vehicle => {
      const searchNoLeadingZeros = toCanonical(searchLower);
      const vehicleNumNoLeadingZeros = toCanonical(vehicle.vehicleNumber).toLowerCase();
      
      // Unified search: VIN, truck #, tech ID/name, license plate
      const matchesSearch = !searchQuery || 
        (vehicle.vin || '').toLowerCase().includes(searchLower) ||
        (vehicle.vehicleNumber || '').toLowerCase().includes(searchLower) ||
        vehicleNumNoLeadingZeros.includes(searchNoLeadingZeros) ||
        (vehicle.licensePlate || '').toLowerCase().includes(searchLower) ||
        `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchLower) ||
        (vehicle.tpmsAssignedTechId || '').toLowerCase().includes(searchLower) ||
        (vehicle.tpmsAssignedTechName || '').toLowerCase().includes(searchLower) ||
        (vehicle.holmanTechAssigned || '').toLowerCase().includes(searchLower) ||
        (vehicle.holmanTechName || '').toLowerCase().includes(searchLower) ||
        (vehicle.city || '').toLowerCase().includes(searchLower);
      
      // Vehicle Details filters
      const matchesMake = makeFilter === "all" || vehicle.makeName === makeFilter;
      const matchesModel = modelFilter === "all" || vehicle.modelName === modelFilter;
      const matchesYear = yearFilter === "all" || vehicle.modelYear.toString() === yearFilter;
      const matchesColor = colorFilter === "all" || vehicle.color === colorFilter;
      
      // Configuration filters
      const ownership = getVehicleOwnership(vehicle.vehicleNumber);
      const matchesProgram = vehicleProgramFilter === "all" ||
        (vehicleProgramFilter === "byov" && ownership.type === 'BYOV') ||
        (vehicleProgramFilter === "fleet" && ownership.type === 'Fleet');
      const matchesBranding = brandingFilter === "all" || vehicle.branding === brandingFilter;
      const matchesInterior = interiorFilter === "all" || vehicle.interior === interiorFilter;
      const matchesTuneStatus = tuneStatusFilter === "all" || vehicle.tuneStatus === tuneStatusFilter;
      
      // Assignment Status filter
      const matchesAssignment = assignmentStatusFilter === "all" || 
        (assignmentStatusFilter === "assigned" && vehicle.tpmsAssignedTechId) ||
        (assignmentStatusFilter === "unassigned" && !vehicle.tpmsAssignedTechId);
      
      // Location filters
      const matchesState = stateFilter === "all" || vehicle.state === stateFilter;
      const matchesCity = cityFilter === "all" || vehicle.city === cityFilter;
      const matchesLicenseState = licenseStateFilter === "all" || vehicle.licenseState === licenseStateFilter;
      const matchesRegion = regionFilter === "all" || vehicle.region === regionFilter;
      const matchesDivision = divisionFilter === "all" || vehicle.division === divisionFilter;
      const matchesDistrict = districtFilter === "all" || vehicle.district === districtFilter;
      
      // Tech Assignment filters
      const matchesHolmanTech = holmanTechFilter === "all" || 
        (holmanTechFilter === "unassigned" && !vehicle.holmanTechAssigned) ||
        vehicle.holmanTechAssigned === holmanTechFilter;
      const matchesTpmsTech = tpmsTechFilter === "all" || 
        (tpmsTechFilter === "unassigned" && !vehicle.tpmsAssignedTechId) ||
        vehicle.tpmsAssignedTechId === tpmsTechFilter;
      
      const holmanId = vehicle.holmanTechAssigned?.trim() || '';
      const tpmsId = vehicle.tpmsAssignedTechId?.trim() || '';
      const hasMismatch = (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) ||
                          (holmanId && !tpmsId);
      const matchesMismatch = mismatchFilter === "all" || 
        (mismatchFilter === "mismatch" && hasMismatch) ||
        (mismatchFilter === "match" && !hasMismatch);
      
      return matchesSearch && matchesMake && matchesModel && matchesYear && matchesColor &&
             matchesProgram && matchesBranding && matchesInterior && matchesTuneStatus &&
             matchesAssignment &&
             matchesState && matchesCity && matchesLicenseState && matchesRegion && matchesDivision && matchesDistrict &&
             matchesHolmanTech && matchesTpmsTech && matchesMismatch;
    });
  }, [activeVehicles, searchQuery, makeFilter, modelFilter, yearFilter, colorFilter,
      vehicleProgramFilter, brandingFilter, interiorFilter, tuneStatusFilter,
      assignmentStatusFilter,
      stateFilter, cityFilter, licenseStateFilter, regionFilter, divisionFilter, districtFilter,
      holmanTechFilter, tpmsTechFilter, mismatchFilter]);

  // Sort by zip distance if target provided
  const sortedVehicles = useMemo(() => {
    if (!targetZipcode.trim()) return filteredVehicles;
    
    return [...filteredVehicles]
      .map(v => ({ ...v, distanceScore: calculateZipDistance(v.zip || '', targetZipcode.trim()) }))
      .sort((a, b) => a.distanceScore - b.distanceScore);
  }, [filteredVehicles, targetZipcode]);

  // Quick lookup handlers
  const handleTechLookup = async () => {
    if (!techLookup.trim()) return;
    try {
      const response = await fetch(`/api/vehicle-assignments/tech/${techLookup.trim().toUpperCase()}`);
      if (!response.ok) {
        toast({ title: "Not Found", description: `No data for Enterprise ID: ${techLookup}`, variant: "destructive" });
        return;
      }
      const result = await response.json();
      if (result.success && result.data?.truckNo) {
        setSearchQuery(result.data.truckNo);
      }
    } catch {
      toast({ title: "Lookup Failed", description: "Unable to lookup technician", variant: "destructive" });
    }
  };

  const handleTruckLookup = async () => {
    if (!truckLookup.trim()) return;
    const truck = allVehicles.find(v => 
      v.vehicleNumber === truckLookup.trim() || 
      v.vehicleNumber === toHolmanRef(truckLookup)
    );
    if (truck) {
      setSelectedVehicle(truck);
    } else {
      toast({ title: "Not Found", description: `No vehicle found for Truck #: ${truckLookup}`, variant: "destructive" });
    }
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setTargetZipcode("");
    setMakeFilter("all");
    setModelFilter("all");
    setYearFilter("all");
    setColorFilter("all");
    setVehicleProgramFilter("all");
    setBrandingFilter("all");
    setInteriorFilter("all");
    setTuneStatusFilter("all");
    setAssignmentStatusFilter("all");
    setStateFilter("all");
    setCityFilter("all");
    setLicenseStateFilter("all");
    setRegionFilter("all");
    setDivisionFilter("all");
    setDistrictFilter("all");
    setHolmanTechFilter("all");
    setTpmsTechFilter("all");
    setMismatchFilter("all");
  };

  const getAssignmentStatus = (vehicle: FleetVehicle) => {
    const holmanId = vehicle.holmanTechAssigned?.trim();
    const tpmsId = vehicle.tpmsAssignedTechId?.trim();
    
    if (tpmsId && holmanId && tpmsId.toLowerCase() === holmanId.toLowerCase()) {
      return { status: 'synced', label: 'Synced', color: 'bg-blue-100 text-blue-800 border-blue-300', cardBorder: 'border-blue-500', cardBg: 'bg-blue-50 dark:bg-blue-950/20' };
    }
    if (tpmsId && !holmanId) {
      return { status: 'pending', label: 'Pending Sync', color: 'bg-blue-100 text-blue-800 border-blue-300', cardBorder: 'border-blue-500', cardBg: 'bg-blue-50 dark:bg-blue-950/20' };
    }
    if (holmanId && !tpmsId) {
      return { status: 'mismatch', label: 'Mismatch', color: 'bg-red-100 text-red-800 border-red-300', cardBorder: 'border-red-500', cardBg: 'bg-red-50 dark:bg-red-950/20' };
    }
    if (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) {
      return { status: 'mismatch', label: 'Mismatch', color: 'bg-red-100 text-red-800 border-red-300', cardBorder: 'border-red-500', cardBg: 'bg-red-50 dark:bg-red-950/20' };
    }
    return { status: 'unassigned', label: 'Unassigned', color: 'bg-green-100 text-green-800 border-green-300', cardBorder: 'border-green-500', cardBg: 'bg-green-50 dark:bg-green-950/20' };
  };

  // Stats - vehicle is assigned if it has a TPMS tech (source of truth for assignments)
  // These counts respect the OOS filter so cards always reflect the visible fleet
  const assignedCount = activeVehicles.filter(v => v.tpmsAssignedTechId).length;
  const unassignedCount = activeVehicles.length - assignedCount;
  const mismatchCount = activeVehicles.filter(v => {
    const h = v.holmanTechAssigned?.trim() || '';
    const t = v.tpmsAssignedTechId?.trim() || '';
    return (h && t && h.toLowerCase() !== t.toLowerCase()) || (h && !t);
  }).length;

  return (
    <MainContent>
      <TopBar 
        title="Fleet Management"
        breadcrumbs={["Home", "Fleet", "Fleet Management"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Vehicles</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid="text-total-vehicles">{activeVehicles.length}</p>
                </CardContent>
              </Card>
              <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-blue-600">Assigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-blue-600" data-testid="text-assigned-count">{assignedCount}</p>
                </CardContent>
              </Card>
              <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-green-600">Unassigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-unassigned-count">{unassignedCount}</p>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-red-600">Mismatches</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-600" data-testid="text-mismatch-count">{mismatchCount}</p>
                </CardContent>
              </Card>
            </div>

            {/* Quick Lookup Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Lookup by Enterprise ID</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter Enterprise ID..."
                      value={techLookup}
                      onChange={(e) => setTechLookup(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && handleTechLookup()}
                      data-testid="input-tech-lookup"
                    />
                    <Button onClick={handleTechLookup} disabled={!techLookup.trim()} data-testid="button-tech-lookup">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Lookup by Truck #</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter Truck Number..."
                      value={truckLookup}
                      onChange={(e) => setTruckLookup(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTruckLookup()}
                      data-testid="input-truck-lookup"
                    />
                    <Button onClick={handleTruckLookup} disabled={!truckLookup.trim()} data-testid="button-truck-lookup">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Data Status Alerts */}
            {hasError && !isLoading && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Vehicles</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>{errorMessage}</span>
                  <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                    {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {isDegradedMode && !isLoading && activeVehicles.length > 0 && (
              <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                <Database className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-400">Using Cached Data</AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-300">
                  Holman API is unavailable. Showing {activeVehicles.length} cached vehicles{oosCount > 0 && !showOos ? ` (${oosCount} Out of Service hidden)` : ""}.
                </AlertDescription>
              </Alert>
            )}

            {isLiveMode && !isLoading && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>Live data from Holman API</span>
              </div>
            )}

            {/* Search and Filters */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Truck className="h-6 w-6 text-blue-600" />
                    <div>
                      <CardTitle data-testid="text-page-title">Fleet Vehicles</CardTitle>
                      <CardDescription>
                        Manage all fleet vehicles - assign, update, and sync with Holman
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = "/api/fleet-vehicles/export.csv";
                        a.download = "";
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      variant="outline"
                      data-testid="button-fleet-export-csv"
                    >
                      <GiMagicLamp className="h-4 w-4 mr-2" />
                      Sean's Genie
                    </Button>
                    <Button 
                      onClick={() => refetch()}
                      variant="outline"
                      disabled={isFetching}
                      data-testid="button-refresh"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="relative md:col-span-2">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by VIN, truck #, tech ID, name, license plate, or city..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                        onClick={() => setSearchQuery("")}
                        data-testid="button-clear-search"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Sort by zip distance..."
                          value={targetZipcode}
                          onChange={(e) => setTargetZipcode(e.target.value)}
                          className="pl-9"
                          data-testid="input-zipcode"
                        />
                      </div>
                    </div>
                    <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2" data-testid="button-toggle-filters">
                          <Filter className="h-4 w-4" />
                          Filters
                          {activeFiltersCount > 0 && (
                            <Badge variant="secondary" className="ml-1">{activeFiltersCount}</Badge>
                          )}
                          {isFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </CollapsibleTrigger>
                    </Collapsible>
                  </div>
                </div>

                {/* Expanded Filters Panel */}
                <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                  <CollapsibleContent className="space-y-4 mt-4">
                    {/* Vehicle Details Filters */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Vehicle Details</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Make</Label>
                          <Select value={makeFilter} onValueChange={setMakeFilter}>
                            <SelectTrigger className="h-8" data-testid="select-make-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All makes</SelectItem>
                              {filterOptions.makes.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Model</Label>
                          <Select value={modelFilter} onValueChange={setModelFilter}>
                            <SelectTrigger className="h-8" data-testid="select-model-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All models</SelectItem>
                              {filterOptions.models.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Year</Label>
                          <Select value={yearFilter} onValueChange={setYearFilter}>
                            <SelectTrigger className="h-8" data-testid="select-year-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All years</SelectItem>
                              {filterOptions.years.map(option => (
                                <SelectItem key={option.toString()} value={option.toString()}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Color</Label>
                          <Select value={colorFilter} onValueChange={setColorFilter}>
                            <SelectTrigger className="h-8" data-testid="select-color-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All colors</SelectItem>
                              {filterOptions.colors.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {/* Configuration Filters */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Configuration</h4>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Vehicle Program</Label>
                          <Select value={vehicleProgramFilter} onValueChange={setVehicleProgramFilter}>
                            <SelectTrigger className="h-8" data-testid="select-vehicle-program-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All programs</SelectItem>
                              <SelectItem value="fleet">Fleet</SelectItem>
                              <SelectItem value="byov">BYOV</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Branding</Label>
                          <Select value={brandingFilter} onValueChange={setBrandingFilter}>
                            <SelectTrigger className="h-8" data-testid="select-branding-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All branding</SelectItem>
                              {filterOptions.brandings.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Interior</Label>
                          <Select value={interiorFilter} onValueChange={setInteriorFilter}>
                            <SelectTrigger className="h-8" data-testid="select-interior-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All interiors</SelectItem>
                              {filterOptions.interiors.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Tune Status</Label>
                          <Select value={tuneStatusFilter} onValueChange={setTuneStatusFilter}>
                            <SelectTrigger className="h-8" data-testid="select-tune-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All tune statuses</SelectItem>
                              {filterOptions.tuneStatuses.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {/* Assignment Status Filter */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Assignment Status</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Status</Label>
                          <Select value={assignmentStatusFilter} onValueChange={setAssignmentStatusFilter}>
                            <SelectTrigger className="h-8" data-testid="select-assignment-status-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All vehicles</SelectItem>
                              <SelectItem value="assigned">Assigned</SelectItem>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {/* Location Filters */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Location</h4>
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">State</Label>
                          <Select value={stateFilter} onValueChange={setStateFilter}>
                            <SelectTrigger className="h-8" data-testid="select-state-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All states</SelectItem>
                              {filterOptions.states.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">City</Label>
                          <Select value={cityFilter} onValueChange={setCityFilter}>
                            <SelectTrigger className="h-8" data-testid="select-city-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All cities</SelectItem>
                              {filterOptions.cities.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">License State</Label>
                          <Select value={licenseStateFilter} onValueChange={setLicenseStateFilter}>
                            <SelectTrigger className="h-8" data-testid="select-license-state-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All license states</SelectItem>
                              {filterOptions.licenseStates.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Region</Label>
                          <Select value={regionFilter} onValueChange={setRegionFilter}>
                            <SelectTrigger className="h-8" data-testid="select-region-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All regions</SelectItem>
                              {filterOptions.regions.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Division</Label>
                          <Select value={divisionFilter} onValueChange={setDivisionFilter}>
                            <SelectTrigger className="h-8" data-testid="select-division-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All divisions</SelectItem>
                              {filterOptions.divisions.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">District</Label>
                          <Select value={districtFilter} onValueChange={setDistrictFilter}>
                            <SelectTrigger className="h-8" data-testid="select-district-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All districts</SelectItem>
                              {filterOptions.districts.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {/* Tech Assignment Filters */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Tech Assignment</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Holman Tech ID</Label>
                          <Select value={holmanTechFilter} onValueChange={setHolmanTechFilter}>
                            <SelectTrigger className="h-8" data-testid="select-holman-tech-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All techs</SelectItem>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {filterOptions.holmanTechs.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">TPMS Tech ID</Label>
                          <Select value={tpmsTechFilter} onValueChange={setTpmsTechFilter}>
                            <SelectTrigger className="h-8" data-testid="select-tpms-tech-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All techs</SelectItem>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {filterOptions.tpmsTechs.map(option => (
                                <SelectItem key={option} value={option}>{option}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-1">
                          <Label className="text-xs">Assignment Match</Label>
                          <Select value={mismatchFilter} onValueChange={setMismatchFilter}>
                            <SelectTrigger className="h-8" data-testid="select-mismatch-filter">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All vehicles</SelectItem>
                              <SelectItem value="mismatch">Mismatch Only</SelectItem>
                              <SelectItem value="match">Matched Only</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    
                    {/* Filter Actions */}
                    <div className="flex justify-between items-center pt-2 border-t">
                      <span className="text-sm text-muted-foreground">
                        {activeFiltersCount > 0 ? `${activeFiltersCount} filter(s) active` : 'No filters applied'}
                      </span>
                      <div className="flex gap-2">
                        {activeFiltersCount > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearAllFilters}
                            data-testid="button-clear-filters"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Clear Filters
                          </Button>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Showing {sortedVehicles.length} of {searchQuery.trim() && !showOos ? allVehicles.length : activeVehicles.length} vehicles
                    {oosCount > 0 && !showOos && !searchQuery.trim() && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        ({oosCount} Out of Service hidden)
                      </span>
                    )}
                    {oosCount > 0 && !showOos && searchQuery.trim() && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        (Out of Service included in search)
                      </span>
                    )}
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer select-none" title="Out-of-service vehicles are hidden by default">
                    <EyeOff className="h-4 w-4" />
                    <span className="text-xs">Show Out of Service</span>
                    <Switch checked={showOos} onCheckedChange={setShowOos} />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Vehicle Cards Grid */}
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))}
              </div>
            ) : sortedVehicles.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center p-8 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-semibold text-lg">No Vehicles Found</h3>
                  <p className="text-muted-foreground">
                    {searchQuery || activeFiltersCount > 0 
                      ? "No vehicles match your current filters" 
                      : "No vehicles available"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {sortedVehicles.slice(0, 99).map((vehicle) => {
                    const assignStatus = getAssignmentStatus(vehicle);
                    const ownership = getVehicleOwnership(vehicle.vehicleNumber);
                    const distanceScore = (vehicle as any).distanceScore;
                    const distanceInfo = distanceScore ? getDistanceLabel(distanceScore) : null;
                    const hasMismatch = assignStatus.status === 'mismatch';
                    const poFlags = poFlagsMap.get(vehicle.vehicleNumber);
                    
                    return (
                      <Card 
                        key={vehicle.vin} 
                        className={`cursor-pointer hover:shadow-md transition-shadow ${assignStatus.cardBorder} ${assignStatus.cardBg} border-2`}
                        onClick={() => setSelectedVehicle(vehicle)}
                        data-testid={`card-vehicle-${vehicle.vehicleNumber}`}
                      >
                        <CardContent className="p-4 space-y-3">
                          {/* Mismatch Warning Banner */}
                          {hasMismatch && (
                            <div className="p-2 bg-red-100 dark:bg-red-900 rounded-md flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-red-600" />
                              <span className="text-xs font-medium text-red-700 dark:text-red-300">
                                Assignment Mismatch
                              </span>
                            </div>
                          )}
                          
                          {/* Header: Vehicle Info + Badges */}
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <Car className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-semibold text-sm">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</p>
                                <p className="text-xs text-muted-foreground font-mono">#{vehicle.vehicleNumber}</p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              {(vehicle.statusCode === 2 || vehicle.outOfServiceDate) && (
                                <Badge className="bg-amber-600 text-white border-amber-700 text-xs">Out of Service</Badge>
                              )}
                              <Badge className={assignStatus.color + ' border text-xs'}>
                                {assignStatus.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {ownership.type}
                              </Badge>
                              {poFlags?.hasOpenRental && (
                                <Badge className="bg-red-600 text-white text-xs border-none">RENTAL ({poFlags.openRentalCount})</Badge>
                              )}
                              {poFlags?.hasOpenMaintenance && (
                                <Badge className="bg-amber-500 text-white text-xs border-none">MAINT ({poFlags.openMaintenanceCount})</Badge>
                              )}
                            </div>
                          </div>
                          
                          {/* VIN */}
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">VIN:</span> <span className="font-mono">{vehicle.vin}</span>
                          </div>
                          
                          {/* Tech Assignment Section */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                            {/* Holman Tech */}
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <Truck className="h-3 w-3 text-blue-600" />
                                <span className="text-xs font-medium text-blue-600">Holman Tech</span>
                              </div>
                              {vehicle.holmanTechAssigned ? (
                                <>
                                  <p className="text-sm font-medium">{vehicle.holmanTechName || 'N/A'}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{vehicle.holmanTechAssigned}</p>
                                </>
                              ) : (
                                <p className="text-xs text-orange-600 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  Unassigned
                                </p>
                              )}
                            </div>
                            
                            {/* TPMS Tech */}
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <Link2 className="h-3 w-3 text-purple-600" />
                                <span className="text-xs font-medium text-purple-600">TPMS Tech</span>
                              </div>
                              {vehicle.tpmsAssignedTechId ? (
                                <>
                                  <p className="text-sm font-medium">{vehicle.tpmsAssignedTechName || 'N/A'}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{vehicle.tpmsAssignedTechId}</p>
                                </>
                              ) : (
                                <p className="text-xs text-orange-600 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  Unassigned
                                </p>
                              )}
                            </div>
                          </div>
                          
                          {/* Location & License Plate */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>Location</span>
                              </div>
                              <p className="font-medium">{vehicle.city}, {vehicle.state}</p>
                              <p className="text-muted-foreground">{vehicle.region} / {vehicle.district}</p>
                              {distanceInfo && (
                                <p className={`text-xs ${distanceInfo.color}`}>{distanceInfo.label}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                                <span>License Plate</span>
                              </div>
                              <LicensePlate 
                                plateNumber={vehicle.licensePlate || ''} 
                                state={vehicle.licenseState}
                                renewalDate={vehicle.regRenewalDate}
                                size="sm"
                              />
                            </div>
                          </div>
                          
                          {/* Odometer */}
                          {vehicle.odometer ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1 border-t">
                              <Gauge className="h-3 w-3 shrink-0" />
                              <span>{vehicle.odometer.toLocaleString()} mi</span>
                              {vehicle.odometerDate && <span>· {vehicle.odometerDate.slice(0, 10)}</span>}
                              {vehicle.odometerSource && <span>· {vehicle.odometerSource}</span>}
                            </div>
                          ) : null}

                          {/* Status Badge + Action */}
                          <div className="flex items-center justify-between pt-2 border-t">
                            <Badge className={assignStatus.color + ' border text-xs'}>
                              {assignStatus.label}
                            </Badge>
                            <ViewInventoryButton 
                              vehicleNumber={vehicle.vehicleNumber} 
                              size="sm" 
                              variant="ghost" 
                              className="h-7 text-xs"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                
                {sortedVehicles.length > 99 && (
                  <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg">
                    Showing first 99 of {sortedVehicles.length} vehicles. Use filters to narrow results.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Vehicle Detail Drawer */}
      <Sheet open={!!selectedVehicle} onOpenChange={(open) => !open && setSelectedVehicle(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto" data-testid="sheet-vehicle-detail">
          {selectedVehicle && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Vehicle #{selectedVehicle.vehicleNumber}
                </SheetTitle>
                <SheetDescription>
                  {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
                </SheetDescription>
              </SheetHeader>
              
              <div className="mt-6 space-y-6">
                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  <Badge className={getAssignmentStatus(selectedVehicle).color}>
                    {getAssignmentStatus(selectedVehicle).label}
                  </Badge>
                  <Badge variant="outline">{getVehicleOwnership(selectedVehicle.vehicleNumber).type}</Badge>
                </div>

                <Separator />

                {/* Vehicle Details */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Vehicle Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">VIN</Label>
                      <p className="font-mono text-xs">{selectedVehicle.vin}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">License Plate</Label>
                      <p>{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Location</Label>
                      <p>{selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Region / District</Label>
                      <p>{selectedVehicle.region} / {selectedVehicle.district}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Odometer</Label>
                      <p>{selectedVehicle.odometer?.toLocaleString() || 'N/A'} miles</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Color</Label>
                      <p>{selectedVehicle.color || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Assignment Info */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Assignment Details</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Link2 className="h-4 w-4 text-blue-600" />
                        <Label className="text-xs font-medium">TPMS</Label>
                      </div>
                      {selectedVehicle.tpmsAssignedTechId ? (
                        <>
                          <p className="font-mono text-sm">{selectedVehicle.tpmsAssignedTechId}</p>
                          {selectedVehicle.tpmsAssignedTechName && (
                            <p className="text-xs text-muted-foreground mt-1">{selectedVehicle.tpmsAssignedTechName}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">Unassigned</p>
                      )}
                    </Card>
                    <Card className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Truck className="h-4 w-4 text-green-600" />
                        <Label className="text-xs font-medium">Holman</Label>
                      </div>
                      {selectedVehicle.holmanTechAssigned ? (
                        <>
                          <p className="font-mono text-sm">{selectedVehicle.holmanTechAssigned}</p>
                          {selectedVehicle.holmanTechName && (
                            <p className="text-xs text-muted-foreground mt-1">{selectedVehicle.holmanTechName}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">Unassigned</p>
                      )}
                    </Card>
                  </div>

                  {/* Mismatch Warning */}
                  {getAssignmentStatus(selectedVehicle).status === 'mismatch' && (
                    <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-800 dark:text-amber-400">Assignment Mismatch</AlertTitle>
                      <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm">
                        TPMS and Holman records don't match. Use "Sync to Holman" to update.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <Separator />

                {/* Operations */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">Operations</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" className="w-full" onClick={() => openModal("assign")} data-testid="button-fleet-assign">
                      <UserPlus className="h-4 w-4 mr-1.5" />Assign Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("unassign")} disabled={!selectedVehicle.tpmsAssignedTechId && !selectedVehicle.holmanTechAssigned} data-testid="button-fleet-unassign">
                      <UserX className="h-4 w-4 mr-1.5" />Unassign Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("address")} data-testid="button-fleet-address">
                      <Home className="h-4 w-4 mr-1.5" />Update Address
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => syncToHolmanMutation.mutate({ vehicleNumber: selectedVehicle.vehicleNumber, enterpriseId: selectedVehicle.tpmsAssignedTechId })}
                      disabled={syncToHolmanMutation.isPending}
                      data-testid="button-sync-holman"
                    >
                      {syncToHolmanMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                      Sync to Holman
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("poHistory")} data-testid="button-po-history">
                      <FileText className="h-4 w-4 mr-1.5" />
                      PO History{vehiclePOs && vehiclePOs.length > 0 ? ` (${vehiclePOs.length})` : ""}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowHistoryDialog(true)}
                      disabled={!selectedVehicle.tpmsAssignedTechId}
                      data-testid="button-view-history"
                    >
                      <History className="h-4 w-4 mr-1.5" />History
                    </Button>
                  </div>
                  <ViewInventoryButton vehicleNumber={selectedVehicle.vehicleNumber} className="w-full" size="sm" />
                </div>

                <Separator />

                {/* AMS Information */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">AMS Information</h4>
                  {amsLoading ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading AMS data...</div>
                  ) : !amsVehicle ? (
                    <p className="text-xs text-muted-foreground">AMS data not available for this vehicle.</p>
                  ) : (
                    <div className="space-y-4">

                      {/* Ownership / Management Hierarchy */}
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
                          {amsVehicle.ColorName && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Color</Label>
                              <p>{amsVehicle.ColorName}</p>
                            </div>
                          )}
                          {amsVehicle.BrandingName && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Branding</Label>
                              <p>{amsVehicle.BrandingName}</p>
                            </div>
                          )}
                          {amsVehicle.InteriorName && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Interior</Label>
                              <p>{amsVehicle.InteriorName}</p>
                            </div>
                          )}
                          {amsVehicle.CurOdometer != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">AMS Odometer</Label>
                              <p>{amsVehicle.CurOdometer.toLocaleString()} mi</p>
                              {amsVehicle.CurOdometerDate && <p className="text-xs text-muted-foreground">{amsVehicle.CurOdometerDate.slice(0, 10)}</p>}
                            </div>
                          )}
                          {amsVehicle.RemBookValue != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Book Value</Label>
                              <p>${Number(amsVehicle.RemBookValue).toLocaleString()}</p>
                            </div>
                          )}
                          {amsVehicle.LeaseEndDate && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Lease End</Label>
                              <p>{amsVehicle.LeaseEndDate}</p>
                            </div>
                          )}
                          {amsVehicle.OutofSvcDate && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Out of Service</Label>
                              <p>{amsVehicle.OutofSvcDate}</p>
                            </div>
                          )}
                          {amsVehicle.SaleDate && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Sale Date</Label>
                              <p>{amsVehicle.SaleDate}</p>
                            </div>
                          )}
                          {amsVehicle.RegRenewalDate && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Reg Renewal</Label>
                              <p>{amsVehicle.RegRenewalDate}</p>
                            </div>
                          )}
                          {amsVehicle.LifeTimeMaintenanceCost != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Lifetime Maint.</Label>
                              <p>${Number(amsVehicle.LifeTimeMaintenanceCost).toLocaleString()}</p>
                            </div>
                          )}
                          {amsVehicle.StorageCost != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Storage Cost</Label>
                              <p>${Number(amsVehicle.StorageCost).toLocaleString()}</p>
                            </div>
                          )}
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
                          {amsVehicle.TruckStatus != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Truck Status</Label>
                              <p>{amsVehicle.TruckStatus}</p>
                            </div>
                          )}
                          {amsVehicle.TheftVerified != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Theft Verified</Label>
                              <p>{amsVehicle.TheftVerified === "Y" || amsVehicle.TheftVerified === true ? "Yes" : "No"}</p>
                            </div>
                          )}
                          {amsVehicle.VehicleRuns != null && (
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">How Vehicle Runs</Label>
                              <p className="text-xs">{amsVehicle.VehicleRuns}</p>
                            </div>
                          )}
                          {amsVehicle.VehicleLooks != null && (
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">How Vehicle Looks</Label>
                              <p className="text-xs">{amsVehicle.VehicleLooks}</p>
                            </div>
                          )}
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
                          {(amsVehicle.KeyAddress || amsVehicle.KeyZip) && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Key Location</Label>
                              <p className="text-xs">
                                {[amsVehicle.KeyAddress].filter(Boolean).join(", ")}
                                {amsVehicle.KeyZip ? ` ${amsVehicle.KeyZip}` : ""}
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

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                          // Match a raw AMS value (text label or numeric ID) to a lookup UniqueID
                          const matchLookup = (lookup: any[] | undefined, raw: any): string => {
                            if (raw == null || !lookup?.length) return "";
                            const s = String(raw);
                            const byId = lookup.find(item => String(item.UniqueID) === s);
                            if (byId) return s;
                            const byLabel = lookup.find(item => getAmsLookupLabel(item).toLowerCase() === s.toLowerCase());
                            return byLabel ? String(byLabel.UniqueID) : "";
                          };
                          setAmsEditColor(matchLookup(colorLookup, amsVehicle?.Color));
                          setAmsEditBranding(matchLookup(brandingLookup, amsVehicle?.Branding));
                          setAmsEditInterior(matchLookup(interiorLookup, amsVehicle?.Interior));
                          setAmsEditAddress(amsVehicle?.CurLocAddress || "");
                          setAmsEditAddressZip(amsVehicle?.CurLocZip || "");
                          setAmsEditTruckStatus(matchLookup(truckStatusLookup, amsVehicle?.TruckStatus));
                          const tv = amsVehicle?.TheftVerified;
                          setAmsEditTheftVerified(tv === true || tv === "Y" ? "Y" : tv === false || tv === "N" ? "N" : "");
                          setAmsEditKeyAddress(amsVehicle?.KeyAddress || "");
                          setAmsEditKeyZip(amsVehicle?.KeyZip || "");
                          setAmsEditStorageCost(amsVehicle?.StorageCost != null ? String(amsVehicle.StorageCost) : "");
                          setAmsEditVehicleRuns(matchLookup(vehicleRunsLookup, amsVehicle?.VehicleRuns));
                          setAmsEditVehicleLooks(matchLookup(vehicleLooksLookup, amsVehicle?.VehicleLooks));
                          openModal("amsEdit");
                        }} data-testid="button-ams-edit">
                          <Pencil className="h-4 w-4 mr-1.5" />Edit Fields
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                          setAmsRepairInRepair(!!amsVehicle?.InRepair);
                          setAmsRepairDate("");
                          setAmsRepairReason("");
                          setAmsRepairVendor("");
                          setAmsRepairETA("");
                          setAmsRepairStatus("");
                          setAmsRepairEstimate("");
                          setAmsRepairRentalCar("");
                          setAmsRepairRentalStart("");
                          setAmsRepairRentalEnd("");
                          setAmsRepairFinalDisposition("");
                          setAmsRepairDispositionReason("");
                          setAmsRepairFinalDate("");
                          openModal("amsRepair");
                        }} data-testid="button-ams-repair">
                          <Wrench className="h-4 w-4 mr-1.5" />Repair
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* AMS Comments / History — collapsible inline */}
                <div className="space-y-2">
                  {/* Header row: title + collapse toggle + Add Comment button */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setAmsCommentsCollapsed(v => !v)}
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
                    {selectedVehicle?.vin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs gap-1.5"
                        onClick={() => setCommentDialogOpen(true)}
                        data-testid="button-open-add-comment"
                      >
                        <Send className="h-3 w-3" />
                        Add Comment
                      </Button>
                    )}
                  </div>

                  {/* Collapsible comment list */}
                  {!amsCommentsCollapsed && (
                    !selectedVehicle?.vin ? (
                      <p className="text-xs text-muted-foreground">No VIN available.</p>
                    ) : amsCommentsLoading ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading comments...</div>
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
                          ))
                        }
                      </div>
                    )
                  )}
                </div>

                {/* Add Comment popup dialog */}
                <Dialog open={commentDialogOpen} onOpenChange={(open) => { setCommentDialogOpen(open); if (!open) setNewComment(""); }}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Add AMS Comment
                      </DialogTitle>
                      <DialogDescription>
                        Add a comment to vehicle {selectedVehicle?.vin} in AMS.
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
                        data-testid="textarea-ams-comment"
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
                        data-testid="button-add-ams-comment"
                      >
                        {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                        Add Comment
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Separator />

                {/* Nexus Tracking Data */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Nexus Tracking</h4>
                  
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
                          <SelectTrigger className="mt-1" data-testid="select-nexus-status">
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
                        <Input
                          value={nexusLocation}
                          onChange={(e) => setNexusLocation(e.target.value)}
                          placeholder="Address or location description..."
                          className="mt-1"
                          data-testid="input-nexus-location"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">New Location Contact</Label>
                        <Input
                          value={nexusContact}
                          onChange={(e) => setNexusContact(e.target.value)}
                          placeholder="Phone number or contact info..."
                          className="mt-1"
                          data-testid="input-nexus-contact"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">Comments</Label>
                        <Textarea
                          value={nexusComments}
                          onChange={(e) => setNexusComments(e.target.value.slice(0, 400))}
                          placeholder="Additional notes (max 400 characters)..."
                          className="mt-1 resize-none"
                          rows={3}
                          maxLength={400}
                          data-testid="textarea-nexus-comments"
                        />
                        <p className="text-xs text-muted-foreground text-right mt-1">{nexusComments.length}/400</p>
                      </div>

                      <Button
                        onClick={() => saveNexusDataMutation.mutate({
                          vehicleNumber: selectedVehicle.vehicleNumber,
                          postOffboardedStatus: nexusStatus || null,
                          nexusNewLocation: nexusLocation || null,
                          nexusNewLocationContact: nexusContact || null,
                          comments: nexusComments || null,
                        })}
                        disabled={saveNexusDataMutation.isPending}
                        className="w-full"
                        data-testid="button-save-nexus-data"
                      >
                        {saveNexusDataMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        Save Tracking Data
                      </Button>
                    </div>
                  )}
                </div>


                <Separator />

                {/* Operation Log */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-1.5">
                    <Activity className="h-4 w-4" />Operation Log
                  </h4>
                  {logsLoading ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading logs...</div>
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
                            {["tpms", "holman", "ams"].map(sys => {
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
                </div>

              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Fleet Operations Modals */}
      {/* Assign Tech Modal */}
      <Dialog open={activeModal === "assign"} onOpenChange={(o) => { if (!o) { setActiveModal(null); setOpResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" />Assign Tech — Vehicle #{selectedVehicle?.vehicleNumber}</DialogTitle>
            <DialogDescription>Writes simultaneously to TPMS, Holman, and AMS.</DialogDescription>
          </DialogHeader>
          {opResult ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Operation Complete</p>
              {["tpms", "holman", "ams"].map(sys => (
                <div key={sys} className="flex items-center justify-between">
                  <span className="text-sm uppercase font-mono">{sys}</span>
                  <div className="flex items-center gap-2">
                    <SystemStatusBadge status={opResult?.[sys]?.status || opResult[`${sys}Status`] || opResult?.data?.[`${sys}Status`]} />
                    {(opResult?.[sys]?.message || opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult?.[sys]?.message || opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]}</span>
                    )}
                  </div>
                </div>
              ))}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setActiveModal(null); setOpResult(null); }}>Close</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Enterprise / LDAP ID *</Label>
                  <div className="relative mt-1">
                    <Input
                      value={assignLdap}
                      onChange={e => { setAssignLdap(e.target.value.toUpperCase()); setAssignLookupStatus("idle"); }}
                      placeholder="e.g. JSMITH01"
                      className={assignLookupStatus === "found" ? "border-green-500 pr-7" : assignLookupStatus === "notfound" ? "border-amber-400 pr-7" : ""}
                    />
                    {assignLookupStatus === "loading" && <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    {assignLookupStatus === "found" && <CheckCircle className="absolute right-2 top-2.5 h-3.5 w-3.5 text-green-500" />}
                    {assignLookupStatus === "notfound" && <span className="absolute right-2 top-2 text-[10px] text-amber-600">Not found</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">District #</Label>
                  <Input className="mt-1" value={assignDistrict} onChange={e => setAssignDistrict(e.target.value)} placeholder="e.g. 123" />
                </div>
              </div>
              <div ref={nameDropdownRef} className="relative">
                <Label className="text-xs">Tech Name (for log)</Label>
                <Input
                  className="mt-1"
                  value={assignTechName}
                  onChange={e => { setAssignTechName(e.target.value); setShowNameDropdown(true); }}
                  onFocus={() => techNameSuggestions.length > 0 && setShowNameDropdown(true)}
                  placeholder="First Last"
                  autoComplete="off"
                />
                {showNameDropdown && techNameSuggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                    {techNameSuggestions.slice(0, 8).map((tech, i) => (
                      <button
                        key={i}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground flex items-center justify-between gap-2"
                        onMouseDown={e => { e.preventDefault(); selectTechSuggestion(tech); }}
                      >
                        <span className="font-medium">{tech.techName || `${tech.firstName ?? ""} ${tech.lastName ?? ""}`.trim()}</span>
                        <span className="text-xs text-muted-foreground font-mono shrink-0">{tech.techRacfid || tech.racfId || ""}{tech.districtNo ? ` · D${tech.districtNo}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input className="mt-1" value={assignNotes} onChange={e => setAssignNotes(e.target.value)} placeholder="Optional notes..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                <Button
                  disabled={!assignLdap || fleetOpMutation.isPending}
                  onClick={() => fleetOpMutation.mutate({
                    endpoint: "/api/fleet-ops/assign",
                    body: { truckNumber: selectedVehicle?.vehicleNumber, ldapId: assignLdap, districtNo: assignDistrict, techName: assignTechName, notes: assignNotes },
                  })}
                >
                  {fleetOpMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                  Assign to All Systems
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unassign Tech Modal */}
      <Dialog open={activeModal === "unassign"} onOpenChange={(o) => { if (!o) { setActiveModal(null); setOpResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserX className="h-4 w-4" />Unassign Tech — Vehicle #{selectedVehicle?.vehicleNumber}</DialogTitle>
            <DialogDescription>
              Removes assignment from TPMS, Holman, and AMS simultaneously.
              {selectedVehicle?.tpmsAssignedTechId && <span className="block mt-1 font-medium">Currently: {selectedVehicle.tpmsAssignedTechName || selectedVehicle.tpmsAssignedTechId}</span>}
            </DialogDescription>
          </DialogHeader>
          {opResult ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Operation Complete</p>
              {["tpms", "holman", "ams"].map(sys => (
                <div key={sys} className="flex items-center justify-between">
                  <span className="text-sm uppercase font-mono">{sys}</span>
                  <div className="flex items-center gap-2">
                    <SystemStatusBadge status={opResult?.[sys]?.status || opResult[`${sys}Status`] || opResult?.data?.[`${sys}Status`]} />
                    {(opResult?.[sys]?.message || opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult?.[sys]?.message || opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]}</span>
                    )}
                  </div>
                </div>
              ))}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setActiveModal(null); setOpResult(null); }}>Close</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Notes</Label>
                <Input className="mt-1" value={unassignNotes} onChange={e => setUnassignNotes(e.target.value)} placeholder="Optional notes..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={fleetOpMutation.isPending}
                  onClick={() => fleetOpMutation.mutate({
                    endpoint: "/api/fleet-ops/unassign",
                    body: { truckNumber: selectedVehicle?.vehicleNumber, ldapId: selectedVehicle?.tpmsAssignedTechId || selectedVehicle?.holmanTechAssigned, notes: unassignNotes },
                  })}
                >
                  {fleetOpMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserX className="h-4 w-4 mr-1.5" />}
                  Unassign from All Systems
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Update Address Modal */}
      <Dialog open={activeModal === "address"} onOpenChange={(o) => { if (!o) { setActiveModal(null); setOpResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Home className="h-4 w-4" />Update Address — Vehicle #{selectedVehicle?.vehicleNumber}</DialogTitle>
            <DialogDescription>Updates address in TPMS and AMS (Holman not applicable).</DialogDescription>
          </DialogHeader>
          {opResult ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Operation Complete</p>
              {[{ key: "tpms", label: "TPMS" }, { key: "ams", label: "AMS" }, { key: "holman", label: "Holman" }].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm uppercase font-mono">{label}</span>
                  <div className="flex items-center gap-2">
                    <SystemStatusBadge status={opResult?.[key]?.status || opResult[`${key}Status`] || opResult?.data?.[`${key}Status`]} />
                    {(opResult?.[key]?.message || opResult[`${key}Message`] || opResult?.data?.[`${key}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult?.[key]?.message || opResult[`${key}Message`] || opResult?.data?.[`${key}Message`]}</span>
                    )}
                  </div>
                </div>
              ))}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setActiveModal(null); setOpResult(null); }}>Close</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Tech LDAP ID *</Label>
                <Input className="mt-1" value={assignLdap} onChange={e => setAssignLdap(e.target.value)} placeholder="e.g. JSMITH01" defaultValue={selectedVehicle?.tpmsAssignedTechId || ""} />
              </div>
              <div>
                <Label className="text-xs">Street Address</Label>
                <Input className="mt-1" value={addrLine1} onChange={e => setAddrLine1(e.target.value)} placeholder="123 Main St" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">City</Label>
                  <Input className="mt-1" value={addrCity} onChange={e => setAddrCity(e.target.value)} placeholder="City" />
                </div>
                <div>
                  <Label className="text-xs">State</Label>
                  <Input className="mt-1" value={addrState} onChange={e => setAddrState(e.target.value)} placeholder="IL" maxLength={2} />
                </div>
              </div>
              <div>
                <Label className="text-xs">ZIP Code</Label>
                <Input className="mt-1" value={addrZip} onChange={e => setAddrZip(e.target.value)} placeholder="60601" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                <Button
                  disabled={!assignLdap || !addrCity || fleetOpMutation.isPending}
                  onClick={() => fleetOpMutation.mutate({
                    endpoint: "/api/fleet-ops/update-address",
                    body: {
                      truckNumber: selectedVehicle?.vehicleNumber,
                      ldapId: assignLdap,
                      address: addrLine1,
                      city: addrCity,
                      state: addrState,
                      zip: addrZip,
                    },
                  })}
                >
                  {fleetOpMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                  Update Address
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Assignment History Dialog */}
      {selectedVehicle?.tpmsAssignedTechId && (
        <AssignmentHistoryDialog
          open={showHistoryDialog}
          onOpenChange={setShowHistoryDialog}
          techRacfid={selectedVehicle.tpmsAssignedTechId}
          techName={selectedVehicle.tpmsAssignedTechName || selectedVehicle.tpmsAssignedTechId}
        />
      )}

      {/* PO History Modal */}
      <Dialog
        open={activeModal === "poHistory"}
        onOpenChange={(o) => {
          if (!o) {
            setActiveModal(null);
            setPoFilterDateFrom("");
            setPoFilterDateTo("");
            setPoFilterPoNumber("");
            setPoFilterVendor("");
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              PO History — Vehicle #{selectedVehicle?.vehicleNumber}
            </DialogTitle>
            <DialogDescription>
              All POs cached from Holman for this vehicle.
            </DialogDescription>
          </DialogHeader>

          {/* Filter bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground">Date From</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-xs"
                value={poFilterDateFrom}
                onChange={e => setPoFilterDateFrom(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Date To</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-xs"
                value={poFilterDateTo}
                onChange={e => setPoFilterDateTo(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">PO #</Label>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Search PO number..."
                value={poFilterPoNumber}
                onChange={e => setPoFilterPoNumber(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Vendor</Label>
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Search vendor..."
                value={poFilterVendor}
                onChange={e => setPoFilterVendor(e.target.value)}
              />
            </div>
          </div>
          {(poFilterDateFrom || poFilterDateTo || poFilterPoNumber || poFilterVendor) && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start text-xs h-7 text-muted-foreground"
              onClick={() => { setPoFilterDateFrom(""); setPoFilterDateTo(""); setPoFilterPoNumber(""); setPoFilterVendor(""); }}
            >
              Clear all filters
            </Button>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto min-h-0">
            {posLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />Loading POs...
              </div>
            ) : !vehiclePOs || vehiclePOs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No POs cached for this vehicle.
              </div>
            ) : (() => {
              const filtered = vehiclePOs.filter((po: any) => {
                if (poFilterPoNumber && !String(po.poNumber || "").toLowerCase().includes(poFilterPoNumber.toLowerCase())) return false;
                if (poFilterVendor && !String(po.vendor || po.vendorName || "").toLowerCase().includes(poFilterVendor.toLowerCase())) return false;
                const poDate = po.poDate || po.openDate || po.date || "";
                if (poFilterDateFrom && poDate && poDate < poFilterDateFrom) return false;
                if (poFilterDateTo && poDate && poDate > poFilterDateTo) return false;
                return true;
              });
              return (
                <>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b">
                      <tr>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">PO #</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">Amount</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Vendor</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-muted-foreground">No POs match your filters.</td>
                        </tr>
                      ) : filtered.map((po: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="py-1.5 px-2 font-mono">{po.poNumber || "—"}</td>
                          <td className="py-1.5 px-2">
                            {po.poType === "maintenance"
                              ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border-none">MAINT</Badge>
                              : po.poType === "rental"
                              ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 text-xs border-none">RENTAL</Badge>
                              : po.poType
                              ? <Badge variant="secondary" className="text-xs">{po.poType}</Badge>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 px-2">
                            <span className={`font-medium ${po.poStatus?.toUpperCase() === 'OPEN' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                              {po.poStatus || "—"}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">{po.poDate || po.openDate || po.date || "—"}</td>
                          <td className="py-1.5 px-2 text-right">{po.amount != null ? `$${Number(po.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                          <td className="py-1.5 px-2">{po.vendor || po.vendorName || "—"}</td>
                          <td className="py-1.5 px-2 text-muted-foreground max-w-[200px] truncate">{po.description || po.serviceDescription || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground px-2 py-2 border-t">
                    Showing {filtered.length} of {vehiclePOs.length} POs
                  </p>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* AMS Edit Fields Modal */}
      <Dialog open={activeModal === "amsEdit"} onOpenChange={(o) => { if (!o) setActiveModal(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" />Edit AMS Fields — {selectedVehicle?.vin}</DialogTitle>
            <DialogDescription>Update user-editable fields in the AMS system.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {/* Description fields */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Color</Label>
                <Select value={amsEditColor} onValueChange={setAmsEditColor}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select color..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(colorLookup) ? colorLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Branding</Label>
                <Select value={amsEditBranding} onValueChange={setAmsEditBranding}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select branding..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(brandingLookup) ? brandingLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Interior</Label>
              <Select value={amsEditInterior} onValueChange={setAmsEditInterior}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select interior..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No change —</SelectItem>
                  {(Array.isArray(interiorLookup) ? interiorLookup : []).map((item: any) => (
                    <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Current Location</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Address</Label>
                <Input className="mt-1" value={amsEditAddress} onChange={e => setAmsEditAddress(e.target.value)} placeholder="Street address" />
              </div>
              <div>
                <Label className="text-xs">ZIP</Label>
                <Input className="mt-1" value={amsEditAddressZip} onChange={e => setAmsEditAddressZip(e.target.value)} placeholder="ZIP" />
              </div>
            </div>

            {/* Status */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Status</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Truck Status</Label>
                <Select value={amsEditTruckStatus} onValueChange={setAmsEditTruckStatus}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select status..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(truckStatusLookup) ? truckStatusLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Theft Verified</Label>
                <Select value={amsEditTheftVerified} onValueChange={setAmsEditTheftVerified}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    <SelectItem value="Y">Yes</SelectItem>
                    <SelectItem value="N">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Key Location */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Key Location</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Key Address</Label>
                <Input className="mt-1" value={amsEditKeyAddress} onChange={e => setAmsEditKeyAddress(e.target.value)} placeholder="Key pickup address" />
              </div>
              <div>
                <Label className="text-xs">Key ZIP</Label>
                <Input className="mt-1" value={amsEditKeyZip} onChange={e => setAmsEditKeyZip(e.target.value)} placeholder="ZIP" />
              </div>
            </div>

            {/* Financial / Condition */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Condition &amp; Financial</p>
            <div>
              <Label className="text-xs">Storage Cost ($)</Label>
              <Input className="mt-1" type="number" value={amsEditStorageCost} onChange={e => setAmsEditStorageCost(e.target.value)} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">How Vehicle Runs</Label>
                <Select value={amsEditVehicleRuns} onValueChange={setAmsEditVehicleRuns}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(vehicleRunsLookup) ? vehicleRunsLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">How Vehicle Looks</Label>
                <Select value={amsEditVehicleLooks} onValueChange={setAmsEditVehicleLooks}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(vehicleLooksLookup) ? vehicleLooksLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-3 border-t">
            <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
            <Button
              disabled={amsUserUpdateMutation.isPending}
              onClick={() => {
                const payload: Record<string, any> = { updateUser: user?.username || "nexus" };
                if (amsEditColor && amsEditColor !== "__none__") payload.color = amsEditColor;
                if (amsEditBranding && amsEditBranding !== "__none__") payload.branding = amsEditBranding;
                if (amsEditInterior && amsEditInterior !== "__none__") payload.interior = amsEditInterior;
                if (amsEditAddress) payload.address = amsEditAddress;
                if (amsEditAddressZip) payload.zip = amsEditAddressZip;
                if (amsEditTruckStatus && amsEditTruckStatus !== "__none__") payload.truckStatus = amsEditTruckStatus;
                if (amsEditTheftVerified && amsEditTheftVerified !== "__none__") payload.theftVerified = amsEditTheftVerified;
                if (amsEditKeyAddress) payload.keyAddress = amsEditKeyAddress;
                if (amsEditKeyZip) payload.keyZip = amsEditKeyZip;
                if (amsEditStorageCost !== "") payload.storageCost = parseFloat(amsEditStorageCost);
                if (amsEditVehicleRuns && amsEditVehicleRuns !== "__none__") payload.vehicleRuns = amsEditVehicleRuns;
                if (amsEditVehicleLooks && amsEditVehicleLooks !== "__none__") payload.vehicleLooks = amsEditVehicleLooks;
                amsUserUpdateMutation.mutate(payload);
              }}
            >
              {amsUserUpdateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AMS Repair Updates Modal */}
      <Dialog open={activeModal === "amsRepair"} onOpenChange={(o) => { if (!o) setActiveModal(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />Repair Updates — {selectedVehicle?.vehicleNumber}</DialogTitle>
            <DialogDescription>Log or update repair status in AMS for this vehicle.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="flex items-center gap-3">
              <Label className="text-xs">In Repair</Label>
              <Switch checked={amsRepairInRepair} onCheckedChange={setAmsRepairInRepair} />
              <span className="text-xs text-muted-foreground">{amsRepairInRepair ? "Yes — vehicle is in repair" : "No — vehicle is not in repair"}</span>
            </div>

            {amsRepairInRepair && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Repair Date</Label>
                    <Input className="mt-1" type="date" value={amsRepairDate} onChange={e => setAmsRepairDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Repair ETA</Label>
                    <Input className="mt-1" type="date" value={amsRepairETA} onChange={e => setAmsRepairETA(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Svc. Reason</Label>
                  <Select value={amsRepairReason} onValueChange={setAmsRepairReason}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(repairReasonLookup) ? repairReasonLookup : []).map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Repair Status</Label>
                  <Select value={amsRepairStatus} onValueChange={setAmsRepairStatus}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select status..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(repairStatusLookup) ? repairStatusLookup : []).map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Repair Vendor</Label>
                  <Input className="mt-1" value={amsRepairVendor} onChange={e => setAmsRepairVendor(e.target.value)} placeholder="Vendor name / address" />
                </div>
                <div>
                  <Label className="text-xs">Estimate Cost ($)</Label>
                  <Input className="mt-1" type="number" value={amsRepairEstimate} onChange={e => setAmsRepairEstimate(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <Label className="text-xs">Rental Car</Label>
                  <Select value={amsRepairRentalCar} onValueChange={setAmsRepairRentalCar}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(rentalCarLookup) && rentalCarLookup.length > 0) ? rentalCarLookup.map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      )) : (
                        <>
                          <SelectItem value="1">Yes — Rental</SelectItem>
                          <SelectItem value="0">No Rental</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {amsRepairRentalCar === "1" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Rental Start</Label>
                      <Input className="mt-1" type="date" value={amsRepairRentalStart} onChange={e => setAmsRepairRentalStart(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Rental End</Label>
                      <Input className="mt-1" type="date" value={amsRepairRentalEnd} onChange={e => setAmsRepairRentalEnd(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Final Disposition — for closing a repair */}
            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Final Disposition (close repair)</p>
              <div>
                <Label className="text-xs">Disposition</Label>
                <Select value={amsRepairFinalDisposition} onValueChange={setAmsRepairFinalDisposition}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select disposition..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not closing —</SelectItem>
                    {(Array.isArray(dispositionLookup) ? dispositionLookup : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__" && (
                <>
                  <div>
                    <Label className="text-xs">Disposition Reason</Label>
                    <Select value={amsRepairDispositionReason} onValueChange={setAmsRepairDispositionReason}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Select —</SelectItem>
                        {(Array.isArray(dispositionReasonLookup) ? dispositionReasonLookup : []).map((item: any) => (
                          <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Final Date</Label>
                    <Input className="mt-1" type="date" value={amsRepairFinalDate} onChange={e => setAmsRepairFinalDate(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter className="pt-3 border-t">
            <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
            <Button
              disabled={amsRepairMutation.isPending}
              onClick={() => {
                const updateUser = user?.username || "nexus";
                const isFinalizing = amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__";
                const payload: Record<string, any> = {
                  inRepair: amsRepairInRepair,
                  updateUser,
                };
                if (amsRepairDate) payload.repairDateStart = amsRepairDate;
                if (amsRepairReason && amsRepairReason !== "__none__") payload.repairReason = parseInt(amsRepairReason);
                if (amsRepairStatus && amsRepairStatus !== "__none__") payload.repairStatus = parseInt(amsRepairStatus);
                if (amsRepairVendor) payload.vendor = amsRepairVendor;
                if (amsRepairETA) payload.etaDate = amsRepairETA;
                if (amsRepairEstimate) payload.estimateCost = parseFloat(amsRepairEstimate);
                if (amsRepairRentalCar && amsRepairRentalCar !== "__none__") payload.rentalCar = parseInt(amsRepairRentalCar);
                if (amsRepairRentalStart) payload.rentalStartDate = amsRepairRentalStart;
                if (amsRepairRentalEnd) payload.rentalEndDate = amsRepairRentalEnd;
                if (isFinalizing) {
                  payload.finalDisposition = parseInt(amsRepairFinalDisposition);
                  if (amsRepairDispositionReason && amsRepairDispositionReason !== "__none__") payload.finalDispositionReason = parseInt(amsRepairDispositionReason);
                  if (amsRepairFinalDate) payload.finalDispositionDate = amsRepairFinalDate;
                }
                amsRepairMutation.mutate(payload);
              }}
            >
              {amsRepairMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
              {amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__" ? "Close Repair" : "Save Repair Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AMS Comment History Modal */}
      <Dialog
        open={activeModal === "amsComments"}
        onOpenChange={(o) => { if (!o) setActiveModal(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              AMS Comment History — {selectedVehicle?.vin}
            </DialogTitle>
            <DialogDescription>
              Comments logged in AMS for this vehicle.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0 space-y-2">
            {amsCommentsLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />Loading comments...
              </div>
            ) : !amsComments || amsComments.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No comments found for this vehicle.
              </div>
            ) : amsComments.map((comment: any, i: number) => (
              <div key={i} className="p-3 bg-muted/40 rounded-lg space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{comment.Author || comment.author || comment.CreatedBy || "Unknown"}</span>
                  <span className="text-xs text-muted-foreground">
                    {comment.CommentDate || comment.commentDate || comment.CreatedAt || comment.createdAt || ""}
                  </span>
                </div>
                <p className="text-sm">{comment.Comment || comment.comment || comment.Text || comment.text || "—"}</p>
              </div>
            ))}
          </div>
          <div className="border-t pt-3 space-y-2">
            <Textarea
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              disabled={addCommentMutation.isPending}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => newComment.trim() && addCommentMutation.mutate(newComment.trim())}
                disabled={!newComment.trim() || addCommentMutation.isPending}
              >
                {addCommentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Add Comment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
