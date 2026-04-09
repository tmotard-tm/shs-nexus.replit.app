import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
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
  Truck, Search, Filter, ChevronDown, ChevronUp, ChevronRight, RefreshCw, AlertCircle, 
  CheckCircle, XCircle, Database, Loader2, Link2, MapPin, Eye, EyeOff,
  UserX, History, AlertTriangle, User, Package, Car, X, Gauge,
  UserPlus, ArrowLeftRight, FileText, Home, Activity, MessageSquare, Send, Pencil, Wrench, Download,
  Users, PhoneCall, ClipboardList
} from "lucide-react";
import { MultiSelectFilter } from "@/components/fleet-scope/MultiSelectFilter";
import { ViewInventoryButton } from "@/components/view-inventory-button";
import { TelematicsButton } from "@/components/telematics-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { type FleetVehicle } from "@/data/fleetData";
import { getVehicleOwnership } from "@/lib/vehicle-utils";
import { DataSourceIndicator, calculateZipDistance, fetchZipCoords, haversineDistance, getDistanceLabel, AssignmentHistoryDialog } from "@/components/fleet";
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

const DISTANCE_BANDS = [
  { key: 'Nearby',    min: 0,   max: 25,       label: 'Nearby',    range: 'Within 25 miles',  color: 'text-green-600',  borderColor: 'border-green-500'  },
  { key: 'Moderate',  min: 25,  max: 100,      label: 'Moderate',  range: '25 – 100 miles',   color: 'text-yellow-600', borderColor: 'border-yellow-500' },
  { key: 'Far',       min: 100, max: 300,      label: 'Far',       range: '100 – 300 miles',  color: 'text-orange-600', borderColor: 'border-orange-500' },
  { key: 'Very Far',  min: 300, max: Infinity, label: 'Very Far',  range: '300+ miles',       color: 'text-red-600',    borderColor: 'border-red-500'    },
] as const;

function getDistanceBand(miles: number): string {
  if (miles < 25)  return 'Nearby';
  if (miles < 100) return 'Moderate';
  if (miles < 300) return 'Far';
  return 'Very Far';
}

// Approximate drive time using tiered avg speeds: city (<25mi=30mph), mixed (<100mi=50mph), highway (55mph)
function formatDriveTime(miles: number): string {
  const avgSpeed = miles < 25 ? 30 : miles < 100 ? 50 : 55;
  const totalMinutes = Math.round((miles / avgSpeed) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Separate component so it can call useQuery per-VIN without violating hook rules.
// React Query caches per ["/api/ams/vehicles", vin], so slide-out won't re-fetch.
function MismatchAssignmentSection({ vehicle }: { vehicle: FleetVehicle }) {
  const { data: amsData, isLoading: amsLoading } = useQuery<any>({
    queryKey: ["/api/ams/vehicles", vehicle.vin],
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${vehicle.vin}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !!vehicle.vin,
  });

  const amsTech = amsData?.Tech?.trim() || "";
  const amsTechName = amsData?.TechName?.trim() || "";

  const SystemCol = ({
    icon, label, labelColor, techId, techName, loading,
  }: {
    icon: ReactNode; label: string; labelColor: string;
    techId: string; techName: string; loading?: boolean;
  }) => (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        {icon}
        <span className={`text-xs font-medium ${labelColor}`}>{label}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-1 py-0.5">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading…</span>
        </div>
      ) : techId ? (
        <>
          <p className="text-xs font-medium leading-tight">{techName || techId}</p>
          <p className="text-xs text-muted-foreground font-mono leading-tight">{techId}</p>
        </>
      ) : (
        <p className="text-xs text-orange-500 flex items-center gap-0.5">
          <XCircle className="h-3 w-3" />Unassigned
        </p>
      )}
    </div>
  );

  return (
    <div className="pt-2 border-t space-y-1.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
        <span className="text-xs font-semibold text-red-600 dark:text-red-400">Assignment Mismatch</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <SystemCol
          icon={<Truck className="h-3 w-3 text-blue-500" />}
          label="Holman"
          labelColor="text-blue-600 dark:text-blue-400"
          techId={vehicle.holmanTechAssigned?.trim() || ""}
          techName={vehicle.holmanTechName?.trim() || ""}
        />
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            <Link2 className="h-3 w-3 text-purple-500 shrink-0" />
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400">TPMS</span>
            <span className="text-[10px] font-semibold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded px-1 leading-tight">authoritative</span>
          </div>
          {vehicle.tpmsAssignedTechId?.trim() ? (
            <>
              <p className="text-xs font-medium leading-tight">{vehicle.tpmsAssignedTechName?.trim() || vehicle.tpmsAssignedTechId}</p>
              <p className="text-xs text-muted-foreground font-mono leading-tight">{vehicle.tpmsAssignedTechId}</p>
            </>
          ) : (
            <p className="text-xs text-orange-500 flex items-center gap-0.5"><XCircle className="h-3 w-3" />Unassigned</p>
          )}
        </div>
        <SystemCol
          icon={<Database className="h-3 w-3 text-emerald-500" />}
          label="AMS"
          labelColor="text-emerald-600 dark:text-emerald-400"
          techId={amsTech}
          techName={amsTechName}
          loading={amsLoading}
        />
      </div>
    </div>
  );
}

export default function FleetManagement() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'developer' || user?.role === 'admin';
  
  // Search and filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetZipcode, setTargetZipcode] = useState("");
  const [zipSortLoading, setZipSortLoading] = useState(false);
  const [zipSortedVehicles, setZipSortedVehicles] = useState<(FleetVehicle & { distanceScore: number })[] | null>(null);
  const zipDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
  
  // Stat card quick-filter (clicking a summary card filters the grid)
  const [statCardFilter, setStatCardFilter] = useState<"all"|"assigned"|"unassigned"|"mismatch"|"rental"|"maintenance"|"dtc">("all");

  // Tech Assignment filters
  const [holmanTechFilter, setHolmanTechFilter] = useState("all");
  const [tpmsTechFilter, setTpmsTechFilter] = useState("all");
  const [mismatchFilter, setMismatchFilter] = useState("all");

  // Badge filters
  const [rentalOpsFilter, setRentalOpsFilter] = useState("all");
  const [poRentalFilter, setPoRentalFilter] = useState("all");
  const [poMaintFilter, setPoMaintFilter] = useState("all");
  const [dtcFilter, setDtcFilter] = useState("all");

  // Status field filters
  const [holmanStatusFilter, setHolmanStatusFilter] = useState<string[]>([]);
  const [amsTruckStatusFilter, setAmsTruckStatusFilter] = useState<string[]>([]);
  const [amsRepairShopFilter, setAmsRepairShopFilter] = useState<string[]>([]);
  const [offboardingFilter, setOffboardingFilter] = useState<string[]>([]);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Ops Review modal
  const [showOpsReview, setShowOpsReview] = useState(false);
  const [opsReviewVehicle, setOpsReviewVehicle] = useState<FleetVehicle | null>(null);
  const [opsRefZip, setOpsRefZip] = useState("");
  const [opsRentalSorted, setOpsRentalSorted] = useState<Array<{
    techRacfid: string; techName: string; vehicleNumber: string;
    homeCity: string; homeState: string; homePostal: string; distanceMiles: number;
  }>>([]);
  const [opsUnassignedSorted, setOpsUnassignedSorted] = useState<Array<{
    techRacfid: string; techName: string; employeeId: string;
    districtNo: string; planningAreaName: string;
    homeCity: string; homeState: string; homePostal: string;
    mainPhone: string; cellPhone: string; distanceMiles: number;
  }>>([]);
  const [opsSorting, setOpsSorting] = useState(false);
  const [opsListFilter, setOpsListFilter] = useState<"all" | "rental" | "unassigned">("all");
  const [showOos, setShowOos] = useState(false);
  
  // Quick lookup state
  const [techLookup, setTechLookup] = useState("");
  const [truckLookup, setTruckLookup] = useState("");
  
  // Selected vehicle for detail view
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  // Capture ?openTruck= param once at mount (lazy useState so it runs once, before any URL cleaning)
  const [pendingOpenTruck] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search).get('openTruck');
    if (p) {
      const params = new URLSearchParams(window.location.search);
      params.delete('openTruck');
      const qs = params.toString();
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }
    return p;
  });
  
  // Nexus tracking data form state
  const [nexusStatus, setNexusStatus] = useState<string>("");
  const [nexusLocation, setNexusLocation] = useState("");
  const [nexusContact, setNexusContact] = useState("");
  const [nexusComments, setNexusComments] = useState("");

  // Cross-system mismatch count from alignment API (includes AMS disagreements)
  const { data: alignmentCountData } = useQuery<{ count: number }>({
    queryKey: ['/api/fleet-ops/mismatches', 'countOnly'],
    queryFn: async () => {
      const res = await fetch('/api/fleet-ops/mismatches?countOnly=true', { credentials: 'include' });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    staleTime: 14 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Fetch vehicles from Holman API with TPMS enrichment.
  // refetchInterval aligns with the server's 15-minute in-memory cache so the client
  // automatically picks up background-refreshed data without a manual sync trigger.
  const { data: apiResponse, isLoading, error, refetch, isFetching } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
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

  // Auto-open vehicle detail sheet when page loads with ?openTruck=VEHICLE_NUMBER.
  // pendingOpenTruck is captured once at mount (before any URL cleaning), so it
  // survives allVehicles refetches and background reloads without losing the value.
  useEffect(() => {
    if (!pendingOpenTruck || allVehicles.length === 0) return;
    const normalized = toCanonical(pendingOpenTruck);
    const match = allVehicles.find(v => toCanonical(v.vehicleNumber) === normalized);
    if (!match) return; // wait for next vehicle load — ref keeps the value
    setSearchQuery(pendingOpenTruck);
    setSelectedVehicle(match);
  }, [allVehicles, pendingOpenTruck]);

  // Resync assignments mutation (re-checks TPMS + Holman APIs for selected vehicle)
  const resyncAssignmentsMutation = useMutation({
    mutationFn: async ({ vehicleNumber, enterpriseId }: { vehicleNumber: string; enterpriseId?: string | null }) => {
      const response = await apiRequest('POST', '/api/fleet-vehicles/resync-assignments', { vehicleNumber, enterpriseId });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/holman/fleet-vehicles'] });
      const tpms = data.tpms;
      const tpmsMsg = tpms?.error
        ? `TPMS error: ${tpms.error}`
        : tpms?.truckNo
          ? `TPMS truck: ${tpms.truckNo}`
          : 'TPMS: no truck assigned';
      toast({ title: "Assignment Resynced", description: `${tpmsMsg} · Holman: live data refreshed` });
    },
    onError: (error: any) => {
      toast({ title: "Resync Failed", description: error.message || "Failed to resync assignments", variant: "destructive" });
    },
  });

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
  const [assignmentType, setAssignmentType] = useState<'assigned' | 'temp' | 'dummy' | 'in-repair'>('assigned');
  const [assignAmsStatusId, setAssignAmsStatusId] = useState<number>(1);
  const [assignRepairData, setAssignRepairData] = useState<{
    repairStatus?: number; repairReason?: number; vendor?: string;
    etaDate?: string; estimateCost?: number;
  }>({});

  // Assign form — tech lookup / typeahead
  const [assignLookupStatus, setAssignLookupStatus] = useState<"idle" | "loading" | "found" | "notfound">("idle");
  const [techNameSuggestions, setTechNameSuggestions] = useState<any[]>([]);
  const [showNameDropdown, setShowNameDropdown] = useState(false);
  const nameDropdownRef = useRef<HTMLDivElement>(null);
  const assignAutoFilledRef = useRef(false); // prevents search firing when we auto-fill name

  // Reset all assign form fields when modal opens or closes
  useEffect(() => {
    if (activeModal === "assign") {
      setAssignLdap("");
      setAssignTechName("");
      setAssignDistrict("");
      setAssignNotes("");
      setAssignmentType('assigned');
      setAssignAmsStatusId(1);
      setAssignRepairData({});
      setAssignLookupStatus("idle");
      setTechNameSuggestions([]);
      setShowNameDropdown(false);
      assignAutoFilledRef.current = false;
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

  // Debounced LDAP field: name search when input looks like a name, ID lookup otherwise
  useEffect(() => {
    const q = assignLdap.trim();
    if (!q || q.length < 2) {
      setAssignLookupStatus("idle");
      setTechNameSuggestions([]);
      setShowNameDropdown(false);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Always run a name search — covers partial names typed in any case
    timers.push(setTimeout(async () => {
      try {
        const res = await fetch(`/api/vehicle-assignments/search/technicians?q=${encodeURIComponent(q)}`, { credentials: "include" });
        const json = await res.json();
        const results = json.data ?? json.technicians ?? [];
        setTechNameSuggestions(results);
        setShowNameDropdown(results.length > 0);
      } catch {
        setTechNameSuggestions([]);
      }
    }, 350));

    // Also run an exact ID lookup for any single-word input (no spaces) — backend normalises to uppercase
    const looksLikeId = q.length >= 3 && !/\s/.test(q);
    if (looksLikeId) {
      setAssignLookupStatus("loading");
      timers.push(setTimeout(async () => {
        try {
          const res = await fetch(`/api/all-techs/lookup/${encodeURIComponent(q.toUpperCase())}`, { credentials: "include" });
          const json = await res.json();
          if (json.found) {
            setAssignLookupStatus("found");
            assignAutoFilledRef.current = true;
            setAssignTechName(json.techName || `${json.firstName ?? ""} ${json.lastName ?? ""}`.trim());
            if (!assignDistrict && json.districtNo) setAssignDistrict(String(json.districtNo));
            // Exact match found — collapse the name suggestions
            setShowNameDropdown(false);
            setTechNameSuggestions([]);
          } else {
            setAssignLookupStatus("notfound");
            // "Not found" as ID — keep name suggestions visible so user can pick
          }
        } catch {
          setAssignLookupStatus("idle");
        }
      }, 450));
    } else {
      setAssignLookupStatus("idle");
    }

    return () => timers.forEach(clearTimeout);
  }, [assignLdap]);

  function selectTechSuggestion(tech: any) {
    assignAutoFilledRef.current = true;
    const id = (tech.techRacfid || tech.racfId || tech.ldapId || "").toUpperCase();
    setAssignLdap(id);
    setAssignTechName(tech.techName || `${tech.firstName ?? ""} ${tech.lastName ?? ""}`.trim());
    setAssignDistrict(tech.districtNo ? String(tech.districtNo) : "");
    setAssignLookupStatus(id ? "found" : "idle");
    setShowNameDropdown(false);
    setTechNameSuggestions([]);
  }


  // Unassign form
  const [unassignNotes, setUnassignNotes] = useState("");

  // PO History filter state
  const [poFiltersExpanded, setPoFiltersExpanded] = useState(false);
  const [poFilterDateFrom, setPoFilterDateFrom] = useState("");
  const [poFilterDateTo, setPoFilterDateTo] = useState("");
  const [poFilterPoNumber, setPoFilterPoNumber] = useState("");
  const [poFilterVendor, setPoFilterVendor] = useState("");
  const [poFilterPoType, setPoFilterPoType] = useState("");
  const [poFilterAtaCode, setPoFilterAtaCode] = useState("");
  const [poFilterStatus, setPoFilterStatus] = useState<string[]>([]);
  const [poFilterStatusOpen, setPoFilterStatusOpen] = useState(false);
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());

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

  // AMS Truck Status map — VIN → human-readable status label (batch, 30-min cache)
  const { data: amsTruckStatusData } = useQuery<Record<string, string | null>>({
    queryKey: ['/api/ams/truck-status-map'],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const amsTruckStatusOptions = useMemo(() => {
    if (!amsTruckStatusData) return [];
    return [...new Set(Object.values(amsTruckStatusData).filter((v): v is string => !!v))].sort();
  }, [amsTruckStatusData]);

  // Repair-shop flags — truck number → boolean (in repair shop)
  const { data: repairShopFlagsData } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/fleet-vehicles/repair-shop-flags'],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const repairShopFlagsMap = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!repairShopFlagsData) return m;
    for (const [rawKey, val] of Object.entries(repairShopFlagsData)) {
      m.set(rawKey, val);
      const canonical = toCanonical(rawKey);
      if (canonical && canonical !== rawKey) m.set(canonical, val);
      const padded = toDisplayNumber(rawKey);
      if (padded && padded !== rawKey) m.set(padded, val);
    }
    return m;
  }, [repairShopFlagsData]);

  // Offboarding flags — truck number → boolean (offboarding flagged)
  const { data: offboardingFlagsData } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/fleet-vehicles/offboarding-flags'],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const offboardingFlagsMap = useMemo(() => {
    const m = new Map<string, boolean>();
    if (!offboardingFlagsData) return m;
    for (const [rawKey, val] of Object.entries(offboardingFlagsData)) {
      m.set(rawKey, val);
      const canonical = toCanonical(rawKey);
      if (canonical && canonical !== rawKey) m.set(canonical, val);
      const padded = toDisplayNumber(rawKey);
      if (padded && padded !== rawKey) m.set(padded, val);
    }
    return m;
  }, [offboardingFlagsData]);

  // Rental Ops open vehicle set — cross-references Rental Operations page open rentals (Snowflake)
  const { data: rentalOpsData } = useQuery<{ vehicleNumbers: string[] }>({
    queryKey: ['/api/rental-ops/open-vehicle-numbers'],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const rentalOpsVehicleSet = useMemo(() => {
    const s = new Set<string>();
    if (!rentalOpsData?.vehicleNumbers) return s;
    for (const vn of rentalOpsData.vehicleNumbers) {
      s.add(vn);
      const canonical = toCanonical(vn);
      if (canonical) s.add(canonical);
      const display = toDisplayNumber(vn);
      if (display) s.add(display);
    }
    return s;
  }, [rentalOpsData]);

  // Truck numbers with active J1939 fault codes from Samsara live API — used for check engine badges
  const { data: dtcVehiclesData } = useQuery<{
    truckNumbers: string[];
    vehicles: { truckNumber: string; severityScore: number; severityLabel: string }[];
  }>({
    queryKey: ['/api/samsara/dtc-vehicles'],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Map every canonical form of a truck number → its numeric severity score
  const dtcScoreMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of dtcVehiclesData?.vehicles ?? []) {
      if (!v.truckNumber) continue;
      const canonical = v.truckNumber.replace(/^0+/, '') || '0';
      const score = v.severityScore ?? 0;
      for (const key of [v.truckNumber, canonical, canonical.padStart(5, '0'), canonical.padStart(6, '0')]) {
        m.set(key, score);
      }
    }
    return m;
  }, [dtcVehiclesData]);

  const dtcTruckSet = useMemo(() => new Set(dtcScoreMap.keys()), [dtcScoreMap]);

  // All techs roster — fetched lazily when Ops Review modal is opened
  const { data: allTechsRoster } = useQuery<Array<{
    techRacfid: string; techName: string; employeeId: string;
    districtNo: string | null; planningAreaName: string | null;
    employmentStatus: string | null;
    homeCity: string | null; homeState: string | null; homePostal: string | null;
    mainPhone: string | null; cellPhone: string | null;
  }>>({
    queryKey: ['/api/all-techs'],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: showOpsReview,
  });

  type AllTechEntry = {
    techRacfid: string; techName: string; employeeId: string;
    districtNo: string | null; planningAreaName: string | null;
    employmentStatus: string | null;
    homeCity: string | null; homeState: string | null; homePostal: string | null;
    mainPhone: string | null; cellPhone: string | null;
  };
  const allTechsRosterMap = useMemo(() => {
    const m = new Map<string, AllTechEntry>();
    for (const t of allTechsRoster ?? []) {
      m.set(t.techRacfid.toLowerCase(), t);
    }
    return m;
  }, [allTechsRoster]);

  // Ops Review — raw list of techs whose assigned vehicle is in rental ops
  const opsRawRentalTechs = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ techRacfid: string; techName: string; vehicleNumber: string; homeCity: string; homeState: string; homePostal: string; distanceMiles: number }> = [];
    for (const v of allVehicles) {
      const inRental = rentalOpsVehicleSet.has(v.vehicleNumber)
        || rentalOpsVehicleSet.has(toCanonical(v.vehicleNumber))
        || rentalOpsVehicleSet.has(toDisplayNumber(v.vehicleNumber));
      const techId = (v.tpmsAssignedTechId?.trim() || v.holmanTechAssigned?.trim() || '');
      if (!inRental || !techId || seen.has(techId.toLowerCase())) continue;
      seen.add(techId.toLowerCase());
      const rec = allTechsRosterMap.get(techId.toLowerCase());
      result.push({
        techRacfid: techId,
        techName: v.tpmsAssignedTechName || v.holmanTechName || rec?.techName || techId,
        vehicleNumber: v.vehicleNumber,
        homeCity: rec?.homeCity || '',
        homeState: rec?.homeState || '',
        homePostal: rec?.homePostal || '',
        distanceMiles: Infinity,
      });
    }
    return result;
  }, [allVehicles, rentalOpsVehicleSet, allTechsRosterMap]);

  // Ops Review — raw list of active techs not assigned to any vehicle
  const opsRawUnassigned = useMemo(() => {
    const assignedIds = new Set<string>();
    for (const v of allVehicles) {
      if (v.tpmsAssignedTechId?.trim()) assignedIds.add(v.tpmsAssignedTechId.trim().toLowerCase());
      if (v.holmanTechAssigned?.trim()) assignedIds.add(v.holmanTechAssigned.trim().toLowerCase());
    }
    return (allTechsRoster ?? [])
      .filter(t => t.employmentStatus === 'A' && !assignedIds.has(t.techRacfid.toLowerCase()))
      .map(t => ({
        techRacfid: t.techRacfid,
        techName: t.techName,
        employeeId: t.employeeId,
        districtNo: t.districtNo || '',
        planningAreaName: t.planningAreaName || '',
        homeCity: t.homeCity || '',
        homeState: t.homeState || '',
        homePostal: t.homePostal || '',
        mainPhone: t.mainPhone || '',
        cellPhone: t.cellPhone || '',
        distanceMiles: Infinity,
      }));
  }, [allVehicles, allTechsRoster]);

  // Sort both Ops Review lists by distance from opsRefZip whenever the modal is open or ref zip changes
  useEffect(() => {
    if (!showOpsReview) return;
    let cancelled = false;
    setOpsSorting(true);

    const sortByZip = async <T extends { homePostal: string; distanceMiles: number }>(items: T[]): Promise<T[]> => {
      if (!opsRefZip || items.length === 0) return items.map(i => ({ ...i, distanceMiles: Infinity }));
      const refCoords = await fetchZipCoords(opsRefZip);
      if (!refCoords) return items.map(i => ({ ...i, distanceMiles: Infinity }));
      const withDist = await Promise.all(items.map(async item => {
        if (!item.homePostal) return { ...item, distanceMiles: Infinity };
        const coords = await fetchZipCoords(item.homePostal);
        if (!coords) return { ...item, distanceMiles: Infinity };
        return { ...item, distanceMiles: haversineDistance(refCoords.lat, refCoords.lng, coords.lat, coords.lng) };
      }));
      return withDist.sort((a, b) => a.distanceMiles - b.distanceMiles);
    };

    Promise.all([sortByZip(opsRawRentalTechs), sortByZip(opsRawUnassigned)]).then(([rental, unassigned]) => {
      if (cancelled) return;
      setOpsRentalSorted(rental);
      setOpsUnassignedSorted(unassigned);
      setOpsSorting(false);
    });

    return () => { cancelled = true; };
  }, [showOpsReview, opsRefZip, opsRawRentalTechs, opsRawUnassigned]);

  // Merged + re-sorted combined list for the unified Ops Review view
  const opsCombinedList = useMemo(() => {
    type RentalRow = (typeof opsRentalSorted)[0] & { kind: "rental"; employeeId?: string; districtNo?: string; planningAreaName?: string; mainPhone?: string; cellPhone?: string };
    type UnassignedRow = (typeof opsUnassignedSorted)[0] & { kind: "unassigned"; vehicleNumber?: string };
    const rental: RentalRow[] = opsRentalSorted.map(r => ({ ...r, kind: "rental" as const }));
    const unassigned: UnassignedRow[] = opsUnassignedSorted.map(u => ({ ...u, kind: "unassigned" as const }));
    const merged = ([...rental, ...unassigned] as (RentalRow | UnassignedRow)[]);
    return merged.sort((a, b) => a.distanceMiles - b.distanceMiles);
  }, [opsRentalSorted, opsUnassignedSorted]);

  // Score thresholds: higher score → warmer colour → red = critical
  function dtcBadgeClass(score: number): string {
    if (score >= 5) return 'bg-red-600 text-white';
    if (score >= 3) return 'bg-orange-500 text-white';
    return 'bg-yellow-400 text-black';
  }

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

  // Vehicle status pre-check for the assign modal
  const assignTruckNumber = activeModal === "assign" ? selectedVehicle?.vehicleNumber : null;
  const { data: assignVehicleStatus, isLoading: isLoadingAssignVehicleStatus } = useQuery<{
    holmanAssignedStatusCd: string | null;
    holmanTechAssigned: string | null;
    holmanTechName: string | null;
    isLocked: boolean;
  }>({
    queryKey: ["/api/fleet-ops/vehicle-status", assignTruckNumber],
    enabled: !!assignTruckNumber,
    queryFn: async () => {
      const res = await fetch(`/api/fleet-ops/vehicle-status/${encodeURIComponent(assignTruckNumber!)}`);
      if (!res.ok) return { holmanAssignedStatusCd: null, holmanTechAssigned: null, holmanTechName: null, isLocked: false };
      return res.json();
    },
    staleTime: 30_000,
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
    holmanTechFilter, tpmsTechFilter, mismatchFilter,
    rentalOpsFilter, poRentalFilter, poMaintFilter, dtcFilter,
  ].filter(f => f !== "all").length +
  [holmanStatusFilter, amsTruckStatusFilter, amsRepairShopFilter, offboardingFilter].filter(f => f.length > 0).length +
  (targetZipcode ? 1 : 0);

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

      // Badge filters
      const isInRentalOpsF = rentalOpsVehicleSet.has(vehicle.vehicleNumber)
        || rentalOpsVehicleSet.has(toCanonical(vehicle.vehicleNumber))
        || rentalOpsVehicleSet.has(toDisplayNumber(vehicle.vehicleNumber));
      const matchesRentalOps = rentalOpsFilter === "all" ||
        (rentalOpsFilter === "yes" && isInRentalOpsF) ||
        (rentalOpsFilter === "no" && !isInRentalOpsF);

      const pfF = poFlagsMap.get(vehicle.vehicleNumber);
      const matchesPoRental = poRentalFilter === "all" ||
        (poRentalFilter === "yes" && pfF?.hasOpenRental) ||
        (poRentalFilter === "no" && !pfF?.hasOpenRental);
      const matchesPoMaint = poMaintFilter === "all" ||
        (poMaintFilter === "yes" && pfF?.hasOpenMaintenance) ||
        (poMaintFilter === "no" && !pfF?.hasOpenMaintenance);

      const hasDTCF = dtcTruckSet.has(vehicle.vehicleNumber) || dtcTruckSet.has(toCanonical(vehicle.vehicleNumber));
      const matchesDTC = dtcFilter === "all" ||
        (dtcFilter === "yes" && hasDTCF) ||
        (dtcFilter === "no" && !hasDTCF);

      // Status field filters
      const holmanStatusCodeMap: Record<string, number> = { "Active": 1, "New": 0, "Inactive / Out of Service": 2, "Sold": 3 };
      const matchesHolmanStatus = holmanStatusFilter.length === 0 ||
        holmanStatusFilter.some(label => holmanStatusCodeMap[label] === (vehicle.statusCode ?? 1));

      const vehicleVinUpper = (vehicle.vin || '').toUpperCase();
      const amsTruckLabel = amsTruckStatusData?.[vehicleVinUpper] ?? null;
      const matchesAmsTruckStatus = amsTruckStatusFilter.length === 0 ||
        (amsTruckLabel != null && amsTruckStatusFilter.some(f => amsTruckLabel.toLowerCase() === f.toLowerCase()));

      const isInRepairShop = repairShopFlagsMap.get(vehicle.vehicleNumber)
        ?? repairShopFlagsMap.get(toCanonical(vehicle.vehicleNumber))
        ?? false;
      const matchesAmsRepairShop = amsRepairShopFilter.length === 0 ||
        (amsRepairShopFilter.includes("In Repair Shop") && isInRepairShop) ||
        (amsRepairShopFilter.includes("Not in Repair Shop") && !isInRepairShop);

      const isOffboardingFlagged = offboardingFlagsMap.get(vehicle.vehicleNumber)
        ?? offboardingFlagsMap.get(toCanonical(vehicle.vehicleNumber))
        ?? false;
      const matchesOffboarding = offboardingFilter.length === 0 ||
        (offboardingFilter.includes("Offboarding Flagged") && isOffboardingFlagged) ||
        (offboardingFilter.includes("Not Flagged") && !isOffboardingFlagged);

      // Stat card quick-filter
      const tpmsId2 = vehicle.tpmsAssignedTechId?.trim() || '';
      const holmanId2 = vehicle.holmanTechAssigned?.trim() || '';
      const isMismatchSC = (holmanId2 && tpmsId2 && holmanId2.toLowerCase() !== tpmsId2.toLowerCase()) || (holmanId2 && !tpmsId2);
      const isRentalSC = rentalOpsVehicleSet.has(vehicle.vehicleNumber)
        || rentalOpsVehicleSet.has(toCanonical(vehicle.vehicleNumber))
        || rentalOpsVehicleSet.has(toDisplayNumber(vehicle.vehicleNumber));
      const matchesStatCard =
        statCardFilter === "all" ||
        (statCardFilter === "assigned"     && !!tpmsId2) ||
        (statCardFilter === "unassigned"   && !tpmsId2) ||
        (statCardFilter === "mismatch"     && isMismatchSC) ||
        (statCardFilter === "rental"       && isRentalSC) ||
        (statCardFilter === "maintenance"  && !!(poFlagsMap.get(vehicle.vehicleNumber)?.hasOpenMaintenance)) ||
        (statCardFilter === "dtc"          && hasDTCF);

      return matchesSearch && matchesMake && matchesModel && matchesYear && matchesColor &&
             matchesProgram && matchesBranding && matchesInterior && matchesTuneStatus &&
             matchesAssignment &&
             matchesState && matchesCity && matchesLicenseState && matchesRegion && matchesDivision && matchesDistrict &&
             matchesHolmanTech && matchesTpmsTech && matchesMismatch &&
             matchesRentalOps && matchesPoRental && matchesPoMaint && matchesDTC &&
             matchesHolmanStatus && matchesAmsTruckStatus && matchesAmsRepairShop && matchesOffboarding &&
             matchesStatCard;
    });
  }, [activeVehicles, searchQuery, makeFilter, modelFilter, yearFilter, colorFilter,
      vehicleProgramFilter, brandingFilter, interiorFilter, tuneStatusFilter,
      assignmentStatusFilter,
      stateFilter, cityFilter, licenseStateFilter, regionFilter, divisionFilter, districtFilter,
      holmanTechFilter, tpmsTechFilter, mismatchFilter,
      rentalOpsFilter, poRentalFilter, poMaintFilter, dtcFilter,
      holmanStatusFilter, amsTruckStatusFilter, amsTruckStatusData, amsRepairShopFilter, repairShopFlagsMap,
      offboardingFilter, offboardingFlagsMap,
      statCardFilter,
      rentalOpsVehicleSet, poFlagsMap, dtcTruckSet]);

  // Async zip-distance sort: fetch real coordinates and sort by haversine distance
  useEffect(() => {
    if (zipDebounceRef.current) clearTimeout(zipDebounceRef.current);

    const zip = targetZipcode.trim();
    if (!zip) {
      setZipSortedVehicles(null);
      setZipSortLoading(false);
      return;
    }

    let cancelled = false;

    zipDebounceRef.current = setTimeout(async () => {
      setZipSortLoading(true);
      try {
        const targetCoords = await fetchZipCoords(zip);
        if (cancelled) return;

        // Gather unique vehicle zips
        const uniqueZips = [...new Set(filteredVehicles.map(v => v.zip || '').filter(Boolean))];
        const coordsMap = new Map<string, { lat: number; lng: number } | null>();
        await Promise.all(
          uniqueZips.map(async vZip => {
            const coords = await fetchZipCoords(vZip);
            coordsMap.set(vZip, coords);
          })
        );

        if (cancelled) return;

        const withScores = filteredVehicles.map(v => {
          const vZip = v.zip || '';
          let score = 9999;
          if (targetCoords && vZip && coordsMap.get(vZip)) {
            const vc = coordsMap.get(vZip)!;
            score = haversineDistance(targetCoords.lat, targetCoords.lng, vc.lat, vc.lng);
          } else if (vZip) {
            // Fallback to numerical difference if geocoding failed
            score = calculateZipDistance(vZip, zip);
          }
          return { ...v, distanceScore: score };
        });

        withScores.sort((a, b) => a.distanceScore - b.distanceScore);
        setZipSortedVehicles(withScores);
      } finally {
        if (!cancelled) setZipSortLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      if (zipDebounceRef.current) clearTimeout(zipDebounceRef.current);
    };
  }, [filteredVehicles, targetZipcode]);

  // Use async-sorted list when zip filter is active, otherwise use plain filtered list
  const sortedVehicles = targetZipcode.trim()
    ? (zipSortedVehicles ?? filteredVehicles)
    : filteredVehicles;

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
    setRentalOpsFilter("all");
    setPoRentalFilter("all");
    setPoMaintFilter("all");
    setDtcFilter("all");
    setHolmanStatusFilter([]);
    setAmsTruckStatusFilter([]);
    setAmsRepairShopFilter([]);
    setOffboardingFilter([]);
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
  const rentalCount = activeVehicles.filter(v =>
    rentalOpsVehicleSet.has(v.vehicleNumber) ||
    rentalOpsVehicleSet.has(toCanonical(v.vehicleNumber)) ||
    rentalOpsVehicleSet.has(toDisplayNumber(v.vehicleNumber))
  ).length;
  const maintenanceCount = activeVehicles.filter(v =>
    poFlagsMap.get(v.vehicleNumber)?.hasOpenMaintenance
  ).length;
  const dtcCount = activeVehicles.filter(v =>
    dtcTruckSet.has(v.vehicleNumber) || dtcTruckSet.has(toCanonical(v.vehicleNumber))
  ).length;

  return (
    <MainContent>
      <TopBar 
        title="Fleet Management"
        breadcrumbs={["Home", "Fleet", "Fleet Management"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="space-y-6">
            {/* Stats Cards — clickable quick-filters */}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
              {/* Total Vehicles — clears filter */}
              <Card
                onClick={() => setStatCardFilter("all")}
                className={`cursor-pointer transition-all hover:shadow-md select-none ${statCardFilter === "all" ? "ring-2 ring-offset-1 ring-foreground/30" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Vehicles</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid="text-total-vehicles">{activeVehicles.length}</p>
                </CardContent>
              </Card>

              {/* Assigned */}
              <Card
                onClick={() => setStatCardFilter(statCardFilter === "assigned" ? "all" : "assigned")}
                className={`cursor-pointer transition-all hover:shadow-md select-none border-blue-200 bg-blue-50/50 dark:bg-blue-950/10 ${statCardFilter === "assigned" ? "ring-2 ring-offset-1 ring-blue-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-blue-600">Assigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-blue-600" data-testid="text-assigned-count">{assignedCount}</p>
                </CardContent>
              </Card>

              {/* Unassigned */}
              <Card
                onClick={() => setStatCardFilter(statCardFilter === "unassigned" ? "all" : "unassigned")}
                className={`cursor-pointer transition-all hover:shadow-md select-none border-green-200 bg-green-50/50 dark:bg-green-950/10 ${statCardFilter === "unassigned" ? "ring-2 ring-offset-1 ring-green-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-green-600">Unassigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-unassigned-count">{unassignedCount}</p>
                </CardContent>
              </Card>

              {/* Mismatches — links to Alignment dashboard; count from cross-system API
                  Severity: 0=neutral, 1-10=amber, 11+=red */}
              {(() => {
                const displayCount = alignmentCountData !== undefined ? alignmentCountData.count : mismatchCount;
                const severity = displayCount === 0 ? "neutral" : displayCount <= 10 ? "amber" : "red";
                const cardCls = severity === "neutral"
                  ? "border-border bg-card"
                  : severity === "amber"
                  ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/10"
                  : "border-red-200 bg-red-50/50 dark:bg-red-950/10";
                const textCls = severity === "neutral"
                  ? "text-muted-foreground"
                  : severity === "amber"
                  ? "text-amber-600"
                  : "text-red-600";
                const ringCls = severity === "neutral" ? "ring-foreground/30" : severity === "amber" ? "ring-amber-500" : "ring-red-500";
                const linkCls = severity === "neutral"
                  ? "text-muted-foreground hover:text-foreground"
                  : severity === "amber"
                  ? "text-amber-500 hover:text-amber-700"
                  : "text-red-500 hover:text-red-700";
                return (
                  <Card
                    onClick={() => setStatCardFilter(statCardFilter === "mismatch" ? "all" : "mismatch")}
                    className={`cursor-pointer transition-all hover:shadow-md select-none ${cardCls} ${statCardFilter === "mismatch" ? `ring-2 ring-offset-1 ${ringCls}` : ""}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className={`text-sm font-medium ${textCls}`}>Mismatches</CardTitle>
                        <a
                          href="/fleet-alignment"
                          onClick={e => e.stopPropagation()}
                          className={`text-[10px] hover:underline shrink-0 ${linkCls}`}
                          title="Open Alignment Dashboard"
                        >
                          Alignment →
                        </a>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className={`text-2xl font-bold ${textCls}`} data-testid="text-mismatch-count">
                        {displayCount}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Rentals */}
              <Card
                onClick={() => setStatCardFilter(statCardFilter === "rental" ? "all" : "rental")}
                className={`cursor-pointer transition-all hover:shadow-md select-none border-orange-200 bg-orange-50/50 dark:bg-orange-950/10 ${statCardFilter === "rental" ? "ring-2 ring-offset-1 ring-orange-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-orange-600">Rentals</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-orange-600">{rentalCount}</p>
                </CardContent>
              </Card>

              {/* Maintenance */}
              <Card
                onClick={() => setStatCardFilter(statCardFilter === "maintenance" ? "all" : "maintenance")}
                className={`cursor-pointer transition-all hover:shadow-md select-none border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 ${statCardFilter === "maintenance" ? "ring-2 ring-offset-1 ring-amber-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-amber-600">Maintenance</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-600">{maintenanceCount}</p>
                </CardContent>
              </Card>

              {/* Check Engine */}
              <Card
                onClick={() => setStatCardFilter(statCardFilter === "dtc" ? "all" : "dtc")}
                className={`cursor-pointer transition-all hover:shadow-md select-none border-rose-200 bg-rose-50/50 dark:bg-rose-950/10 ${statCardFilter === "dtc" ? "ring-2 ring-offset-1 ring-rose-500" : ""}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-rose-600 flex items-center gap-1">
                    <Wrench className="h-3.5 w-3.5" />
                    Check Engine
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-rose-600">{dtcCount}</p>
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
                        {syncStatus?.lastSyncAt && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            · Last synced {(() => {
                              const diffMs = Date.now() - new Date(syncStatus.lastSyncAt!).getTime();
                              const mins = Math.floor(diffMs / 60000);
                              if (mins < 1) return "just now";
                              if (mins < 60) return `${mins}m ago`;
                              return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
                            })()}
                          </span>
                        )}
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
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
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
                          className="pl-9 pr-9"
                          data-testid="input-zipcode"
                        />
                        {zipSortLoading && (
                          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
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
                  <CollapsibleContent className="mt-3">
                    <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                      {/* Row 1 — Status / Badge filters */}
                      <div className="flex flex-wrap gap-2">
                        <Select value={assignmentStatusFilter} onValueChange={setAssignmentStatusFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-assignment-status-filter">
                            <SelectValue placeholder="Assignment" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All assignments</SelectItem>
                            <SelectItem value="assigned">Assigned</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={vehicleProgramFilter} onValueChange={setVehicleProgramFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-vehicle-program-filter">
                            <SelectValue placeholder="Program" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All programs</SelectItem>
                            <SelectItem value="fleet">Fleet</SelectItem>
                            <SelectItem value="byov">BYOV</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={mismatchFilter} onValueChange={setMismatchFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-mismatch-filter">
                            <SelectValue placeholder="Tech match" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All (match)</SelectItem>
                            <SelectItem value="mismatch">Mismatch only</SelectItem>
                            <SelectItem value="match">Matched only</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={rentalOpsFilter} onValueChange={setRentalOpsFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-rental-ops-filter">
                            <SelectValue placeholder="Rental Ops" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All (rental ops)</SelectItem>
                            <SelectItem value="yes">In Rental Ops</SelectItem>
                            <SelectItem value="no">Not in Rental Ops</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={poRentalFilter} onValueChange={setPoRentalFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-po-rental-filter">
                            <SelectValue placeholder="PO Rental" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All (PO rental)</SelectItem>
                            <SelectItem value="yes">Has open rental PO</SelectItem>
                            <SelectItem value="no">No open rental PO</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={poMaintFilter} onValueChange={setPoMaintFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-po-maint-filter">
                            <SelectValue placeholder="PO Maint" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All (PO maint)</SelectItem>
                            <SelectItem value="yes">Has open maint PO</SelectItem>
                            <SelectItem value="no">No open maint PO</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={dtcFilter} onValueChange={setDtcFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-dtc-filter">
                            <SelectValue placeholder="DTC" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All (DTC)</SelectItem>
                            <SelectItem value="yes">Has DTC</SelectItem>
                            <SelectItem value="no">No DTC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Row 2 — Vehicle details */}
                      <div className="flex flex-wrap gap-2">
                        <Select value={makeFilter} onValueChange={setMakeFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-make-filter">
                            <SelectValue placeholder="Make" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All makes</SelectItem>
                            {filterOptions.makes.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={modelFilter} onValueChange={setModelFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-model-filter">
                            <SelectValue placeholder="Model" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All models</SelectItem>
                            {filterOptions.models.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={yearFilter} onValueChange={setYearFilter}>
                          <SelectTrigger className="h-7 text-xs w-24" data-testid="select-year-filter">
                            <SelectValue placeholder="Year" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All years</SelectItem>
                            {filterOptions.years.map(o => <SelectItem key={o.toString()} value={o.toString()}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={colorFilter} onValueChange={setColorFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-color-filter">
                            <SelectValue placeholder="Color" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All colors</SelectItem>
                            {filterOptions.colors.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={brandingFilter} onValueChange={setBrandingFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-branding-filter">
                            <SelectValue placeholder="Branding" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All branding</SelectItem>
                            {filterOptions.brandings.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={interiorFilter} onValueChange={setInteriorFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-interior-filter">
                            <SelectValue placeholder="Interior" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All interiors</SelectItem>
                            {filterOptions.interiors.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={tuneStatusFilter} onValueChange={setTuneStatusFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-tune-filter">
                            <SelectValue placeholder="Tune status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All tune statuses</SelectItem>
                            {filterOptions.tuneStatuses.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Row 3 — Location */}
                      <div className="flex flex-wrap gap-2">
                        <Select value={stateFilter} onValueChange={setStateFilter}>
                          <SelectTrigger className="h-7 text-xs w-24" data-testid="select-state-filter">
                            <SelectValue placeholder="State" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All states</SelectItem>
                            {filterOptions.states.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={cityFilter} onValueChange={setCityFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-city-filter">
                            <SelectValue placeholder="City" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All cities</SelectItem>
                            {filterOptions.cities.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={licenseStateFilter} onValueChange={setLicenseStateFilter}>
                          <SelectTrigger className="h-7 text-xs w-32" data-testid="select-license-state-filter">
                            <SelectValue placeholder="License state" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All license states</SelectItem>
                            {filterOptions.licenseStates.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={regionFilter} onValueChange={setRegionFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-region-filter">
                            <SelectValue placeholder="Region" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All regions</SelectItem>
                            {filterOptions.regions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={divisionFilter} onValueChange={setDivisionFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-division-filter">
                            <SelectValue placeholder="Division" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All divisions</SelectItem>
                            {filterOptions.divisions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={districtFilter} onValueChange={setDistrictFilter}>
                          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-district-filter">
                            <SelectValue placeholder="District" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All districts</SelectItem>
                            {filterOptions.districts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Row 4 — Tech assignment */}
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={holmanTechFilter} onValueChange={setHolmanTechFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-holman-tech-filter">
                            <SelectValue placeholder="Holman Tech ID" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Holman techs</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {filterOptions.holmanTechs.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={tpmsTechFilter} onValueChange={setTpmsTechFilter}>
                          <SelectTrigger className="h-7 text-xs w-36" data-testid="select-tpms-tech-filter">
                            <SelectValue placeholder="TPMS Tech ID" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All TPMS techs</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {filterOptions.tpmsTechs.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Row 5 — Status fields */}
                      <div className="flex flex-wrap items-center gap-2">
                        <MultiSelectFilter
                          options={["Active", "New", "Inactive / Out of Service", "Sold"]}
                          selectedValues={holmanStatusFilter}
                          onSelectionChange={vals => setHolmanStatusFilter(vals.filter(v => v !== "__NONE_SELECTED__"))}
                          placeholder="Holman Status"
                          label="Holman Status"
                          className="w-40"
                        />
                        <MultiSelectFilter
                          options={amsTruckStatusOptions}
                          selectedValues={amsTruckStatusFilter}
                          onSelectionChange={vals => setAmsTruckStatusFilter(vals.filter(v => v !== "__NONE_SELECTED__"))}
                          placeholder="AMS Truck Status"
                          label="AMS Truck Status"
                          className="w-44"
                        />
                        <MultiSelectFilter
                          options={["In Repair Shop", "Not in Repair Shop"]}
                          selectedValues={amsRepairShopFilter}
                          onSelectionChange={vals => setAmsRepairShopFilter(vals.filter(v => v !== "__NONE_SELECTED__"))}
                          placeholder="Repair Shop"
                          label="Repair Shop"
                          showSearch={false}
                          className="w-40"
                        />
                        <MultiSelectFilter
                          options={["Offboarding Flagged", "Not Flagged"]}
                          selectedValues={offboardingFilter}
                          onSelectionChange={vals => setOffboardingFilter(vals.filter(v => v !== "__NONE_SELECTED__"))}
                          placeholder="Offboarding"
                          label="Offboarding"
                          showSearch={false}
                          className="w-40"
                        />
                        <div className="flex-1" />
                        {activeFiltersCount > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                            onClick={clearAllFilters}
                            data-testid="button-clear-filters"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Clear all
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
                  {sortedVehicles.slice(0, 99).flatMap((vehicle, index) => {
                    const assignStatus = getAssignmentStatus(vehicle);
                    const ownership = getVehicleOwnership(vehicle.vehicleNumber);
                    const distanceScore = (vehicle as any).distanceScore;
                    const distanceInfo = typeof distanceScore === 'number' && Number.isFinite(distanceScore) ? getDistanceLabel(distanceScore) : null;
                    const isZipSorted = !!(targetZipcode.trim() && zipSortedVehicles);
                    const currentBand = isZipSorted && typeof distanceScore === 'number' && Number.isFinite(distanceScore) ? getDistanceBand(distanceScore) : null;
                    const prevScore = isZipSorted && index > 0 ? (sortedVehicles[index - 1] as any).distanceScore : null;
                    const prevBand = prevScore != null && Number.isFinite(prevScore) ? getDistanceBand(prevScore) : null;
                    const showBandHeader = isZipSorted && currentBand && currentBand !== prevBand;
                    const bandMeta = showBandHeader ? DISTANCE_BANDS.find(b => b.key === currentBand) : null;
                    const bandCount = showBandHeader ? sortedVehicles.filter(v => {
                      const s = (v as any).distanceScore;
                      return typeof s === 'number' && Number.isFinite(s) && getDistanceBand(s) === currentBand;
                    }).length : 0;
                    const hasMismatch = assignStatus.status === 'mismatch';
                    const poFlags = poFlagsMap.get(vehicle.vehicleNumber);
                    const isInRentalOps = rentalOpsVehicleSet.has(vehicle.vehicleNumber)
                      || rentalOpsVehicleSet.has(toCanonical(vehicle.vehicleNumber))
                      || rentalOpsVehicleSet.has(toDisplayNumber(vehicle.vehicleNumber));
                    const hasDTC = dtcTruckSet.has(vehicle.vehicleNumber) || dtcTruckSet.has(toCanonical(vehicle.vehicleNumber));
                    const dtcScore = dtcScoreMap.get(vehicle.vehicleNumber) ?? dtcScoreMap.get(toCanonical(vehicle.vehicleNumber)) ?? 0;
                    
                    const card = (
                      <Card 
                        key={vehicle.vin} 
                        className={`cursor-pointer hover:shadow-md transition-shadow ${assignStatus.cardBorder} ${assignStatus.cardBg} border-2 relative`}
                        onClick={() => setSelectedVehicle(vehicle)}
                        data-testid={`card-vehicle-${vehicle.vehicleNumber}`}
                      >
                        {/* Programs badge — top-left corner */}
                        <Badge variant="outline" className="absolute top-3 left-3 text-xs z-10">
                          {ownership.type}
                        </Badge>
                        <CardContent className="p-4 pt-9 space-y-3">
                          {/* Header: Vehicle Info */}
                          <div className="flex items-center gap-2">
                            <Car className="h-5 w-5 text-muted-foreground shrink-0" />
                            <div>
                              <p className="font-semibold text-sm">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</p>
                              <p className="text-xs text-muted-foreground font-mono">#{vehicle.vehicleNumber}</p>
                            </div>
                          </div>
                          
                          {/* VIN */}
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">VIN:</span> <span className="font-mono">{vehicle.vin}</span>
                          </div>
                          
                          {/* Tech Assignment Section */}
                          {hasMismatch ? (
                            <MismatchAssignmentSection vehicle={vehicle} />
                          ) : (
                            /* Matched or unassigned: show single tech line */
                            <div className="flex items-center gap-2 pt-2 border-t">
                              <User className="h-4 w-4 text-muted-foreground shrink-0" />
                              {vehicle.tpmsAssignedTechId ? (
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{vehicle.tpmsAssignedTechName || vehicle.tpmsAssignedTechId}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{vehicle.tpmsAssignedTechId}</p>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <XCircle className="h-3 w-3 text-orange-500" />
                                  Unassigned
                                </p>
                              )}
                            </div>
                          )}
                          
                          {/* Location & License Plate */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>Location</span>
                              </div>
                              <p className="font-medium">{vehicle.city}, {vehicle.state}</p>
                              <p className="text-muted-foreground">{vehicle.region} / {vehicle.district}</p>
                              {distanceInfo && typeof distanceScore === 'number' && Number.isFinite(distanceScore) && (
                                <p className={`text-xs font-medium ${distanceInfo.color}`}>
                                  {Math.round(distanceScore).toLocaleString()} mi · ~{formatDriveTime(distanceScore)}
                                </p>
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

                          {/* Badges row */}
                          <div className="flex flex-wrap gap-1 pt-2 border-t">
                            {(vehicle.statusCode === 2 || vehicle.outOfServiceDate) && (
                              <Badge className="bg-amber-600 text-white border-amber-700 text-xs">Out of Service</Badge>
                            )}
                            <Badge className={assignStatus.color + ' border text-xs'}>
                              {assignStatus.label}
                            </Badge>
                            {poFlags?.hasOpenRental && !isInRentalOps && (
                              <Badge className="bg-red-600 text-white text-xs border-none">RENTAL ({poFlags.openRentalCount})</Badge>
                            )}
                            {poFlags?.hasOpenMaintenance && (
                              <Badge className="bg-amber-500 text-white text-xs border-none">MAINT ({poFlags.openMaintenanceCount})</Badge>
                            )}
                            {isInRentalOps && (
                              <Badge className="bg-orange-500 text-white text-xs border-none">Rental</Badge>
                            )}
                            {hasDTC && (
                              <Badge className={`text-xs border-none flex items-center gap-1 ${dtcBadgeClass(dtcScore)}`}>
                                <Wrench className="h-3 w-3" />
                                Check Engine
                              </Badge>
                            )}
                          </div>

                          {/* Action bar */}
                          <div className="flex items-center justify-end pt-2 border-t">
                            <div className="flex items-center gap-1">
                              <ViewInventoryButton 
                                vehicleNumber={vehicle.vehicleNumber} 
                                size="sm" 
                                variant="ghost" 
                                className="h-7 text-xs"
                              />
                              <TelematicsButton
                                vehicleNumber={vehicle.vehicleNumber}
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );

                    const results: JSX.Element[] = [];
                    if (showBandHeader && bandMeta) {
                      results.push(
                        <div
                          key={`band-${currentBand}-${index}`}
                          className={`col-span-full flex items-center gap-3 border-l-4 ${bandMeta.borderColor} pl-3 py-1 ${index > 0 ? 'mt-4' : ''}`}
                        >
                          <div>
                            <h3 className={`font-semibold text-sm ${bandMeta.color}`}>{bandMeta.label}</h3>
                            <p className="text-xs text-muted-foreground">{bandMeta.range} · {bandCount} vehicle{bandCount !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                      );
                    }
                    results.push(card);
                    return results;
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
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm text-muted-foreground">Assignment Details</h4>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={resyncAssignmentsMutation.isPending}
                      onClick={() => resyncAssignmentsMutation.mutate({
                        vehicleNumber: selectedVehicle.vehicleNumber,
                        enterpriseId: selectedVehicle.holmanTechAssigned,
                      })}
                      data-testid="button-resync-assignments"
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

                </div>

                <Separator />

                {/* Operations */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">Operations</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" className="w-full" onClick={() => openModal("assign")} data-testid="button-fleet-assign">
                      <UserPlus className="h-4 w-4 mr-1.5" />Assign Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("unassign")} disabled={!selectedVehicle.tpmsAssignedTechId?.trim() && !selectedVehicle.holmanTechAssigned?.trim()} data-testid="button-fleet-unassign">
                      <UserX className="h-4 w-4 mr-1.5" />Unassign Tech
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
                  <TelematicsButton vehicleNumber={selectedVehicle.vehicleNumber} className="w-full" size="sm" />
                  {!selectedVehicle.tpmsAssignedTechId?.trim() && !selectedVehicle.holmanTechAssigned?.trim() && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-300 dark:border-purple-700 dark:hover:bg-purple-950"
                      onClick={() => {
                        setOpsReviewVehicle(selectedVehicle);
                        setOpsRefZip(selectedVehicle.zip || targetZipcode);
                        setShowOpsReview(true);
                      }}
                    >
                      <Users className="h-4 w-4 mr-1.5" />Ops Review
                    </Button>
                  )}
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
                          {amsVehicle.TruckStatus != null && (() => {
                            const match = Array.isArray(truckStatusLookup) ? truckStatusLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.TruckStatus)) : undefined;
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
                            const match = Array.isArray(vehicleRunsLookup) ? vehicleRunsLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleRuns)) : undefined;
                            return (
                              <div className="col-span-2">
                                <Label className="text-xs text-muted-foreground">How Vehicle Runs</Label>
                                <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleRuns)}</p>
                              </div>
                            );
                          })()}
                          {amsVehicle.VehicleLooks != null && (() => {
                            const match = Array.isArray(vehicleLooksLookup) ? vehicleLooksLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleLooks)) : undefined;
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
                          setAmsEditKeyAddress(amsVehicle?.KeyLocAddress || amsVehicle?.KeyAddress || amsVehicle?.keyAddress || "");
                          setAmsEditKeyZip(amsVehicle?.KeyLocZip || amsVehicle?.KeyZip || amsVehicle?.keyZip || "");
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
              {/* Vehicle status pre-check */}
              {isLoadingAssignVehicleStatus && <Skeleton className="h-10 w-full" />}
              {assignVehicleStatus && (() => {
                const sc = assignVehicleStatus.holmanAssignedStatusCd;
                const BLOCKED: Record<string, string> = { L: 'For Sale', B: 'At Auction', W: 'Wrecked/Stolen', T: 'Terminated' };
                const BORDERLINE: Record<string, string> = { H: 'At Upfitter', I: 'In Repair', O: 'Storage', Q: 'Order Pending' };
                const isBlocked = sc ? !!BLOCKED[sc] : false;
                const isBorderline = sc ? !!BORDERLINE[sc] : false;
                return (
                  <>
                    {sc && (
                      <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm border ${
                        isBlocked ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300' :
                        isBorderline ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300' :
                        'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300'
                      }`}>
                        <span className="font-medium">
                          Holman Status: {sc}
                          {BLOCKED[sc] && ` — ${BLOCKED[sc]}`}
                          {BORDERLINE[sc] && ` — ${BORDERLINE[sc]}`}
                        </span>
                        {isBlocked && <span className="ml-auto text-xs font-semibold">BLOCKED</span>}
                        {isBorderline && <span className="ml-auto text-xs font-semibold">WARNING</span>}
                      </div>
                    )}
                    {isBlocked && (
                      <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300">
                        This vehicle cannot be assigned — Holman status is <strong>{BLOCKED[sc!]}</strong>. Resolve the vehicle status in fleet operations first.
                      </div>
                    )}
                    {assignVehicleStatus.isLocked && (
                      <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300">
                        ⚠ This vehicle is currently being updated by another operation. Please wait a moment and try again.
                      </div>
                    )}
                    {assignVehicleStatus.holmanTechAssigned && (
                      <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300">
                        Currently assigned: <strong>{assignVehicleStatus.holmanTechName || assignVehicleStatus.holmanTechAssigned}</strong> ({assignVehicleStatus.holmanTechAssigned}). Assigning a new tech will displace this one.
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Holman Status Dropdown */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Holman Assigned Status</Label>
                  <Select
                    value={assignmentType}
                    onValueChange={(v: 'assigned' | 'temp' | 'dummy' | 'in-repair') => {
                      setAssignmentType(v);
                      // Reset AMS status to the natural default for this Holman type
                      setAssignAmsStatusId(v === 'in-repair' ? 6 : 1);
                      setAssignRepairData({});
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assigned">Assigned — A</SelectItem>
                      <SelectItem value="dummy">Dummy — D</SelectItem>
                      <SelectItem value="in-repair">In Repair — I</SelectItem>
                      <SelectItem value="temp">Temp Assignment — F</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* AMS Status — fixed for most types, selectable for Dummy */}
                <div>
                  <Label className="text-xs mb-1 block">AMS Truck Status</Label>
                  {assignmentType === 'dummy' ? (
                    <Select
                      value={String(assignAmsStatusId)}
                      onValueChange={v => setAssignAmsStatusId(Number(v))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 — Assigned to Tech</SelectItem>
                        <SelectItem value="10">10 — Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-1 flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {assignmentType === 'in-repair'
                        ? '6 — In Repair'
                        : '1 — Assigned to Tech'}
                    </div>
                  )}
                </div>
              </div>

              {/* Repair details — shown when In Repair is selected */}
              {assignmentType === 'in-repair' && (
                <div className="border rounded-md p-3 space-y-3 bg-amber-50/40 dark:bg-amber-900/10">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">AMS Repair Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Repair Status ID</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 6"
                        className="mt-1"
                        value={assignRepairData.repairStatus ?? ""}
                        onChange={e => setAssignRepairData(d => ({ ...d, repairStatus: e.target.value ? parseInt(e.target.value) : undefined }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Repair Reason ID</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 1"
                        className="mt-1"
                        value={assignRepairData.repairReason ?? ""}
                        onChange={e => setAssignRepairData(d => ({ ...d, repairReason: e.target.value ? parseInt(e.target.value) : undefined }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Vendor</Label>
                      <Input
                        placeholder="Vendor name"
                        className="mt-1"
                        value={assignRepairData.vendor ?? ""}
                        onChange={e => setAssignRepairData(d => ({ ...d, vendor: e.target.value || undefined }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">ETA Date</Label>
                      <Input
                        type="date"
                        className="mt-1"
                        value={assignRepairData.etaDate ?? ""}
                        onChange={e => setAssignRepairData(d => ({ ...d, etaDate: e.target.value || undefined }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* After-assignment preview */}
              <div className="rounded-md border px-3 py-2 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">After assignment</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Holman → <strong>
                    {assignmentType === 'temp'      ? 'F — Temp Assignment' :
                     assignmentType === 'dummy'     ? 'D — Dummy' :
                     assignmentType === 'in-repair' ? 'I — In Repair' :
                                                      'A — Assigned'}
                  </strong></span>
                  <span>TPMS → <strong>Assigned</strong></span>
                  <span>AMS → <strong>
                    {assignmentType === 'in-repair'             ? 'Status 6 — In Repair' :
                     assignmentType === 'dummy' && assignAmsStatusId === 10 ? 'Status 10 — Unknown (skipped)' :
                                                                  'Status 1 — Assigned to Tech'}
                  </strong></span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Enterprise / LDAP ID *</Label>
                  <div ref={nameDropdownRef} className="relative mt-1">
                    <Input
                      value={assignLdap}
                      onChange={e => { setAssignLdap(e.target.value); setAssignLookupStatus("idle"); }}
                      placeholder="Enterprise ID or search by name…"
                      className={assignLookupStatus === "found" ? "border-green-500 pr-7" : assignLookupStatus === "notfound" ? "border-amber-400 pr-7" : ""}
                      autoComplete="off"
                    />
                    {assignLookupStatus === "loading" && <Loader2 className="absolute right-2 top-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    {assignLookupStatus === "found" && <CheckCircle className="absolute right-2 top-2.5 h-3.5 w-3.5 text-green-500" />}
                    {assignLookupStatus === "notfound" && !showNameDropdown && <span className="absolute right-2 top-2 text-[10px] text-amber-600">Not found</span>}
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
                            <span className="text-xs text-muted-foreground font-mono shrink-0">{(tech.techRacfid || tech.racfId || "").toUpperCase()}{tech.districtNo ? ` · D${tech.districtNo}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">District #</Label>
                  <Input className="mt-1" value={assignDistrict} onChange={e => setAssignDistrict(e.target.value)} placeholder="e.g. 123" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Tech Name (for log)</Label>
                <Input
                  className="mt-1"
                  value={assignTechName}
                  onChange={e => setAssignTechName(e.target.value)}
                  placeholder="Auto-filled from selection"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input className="mt-1" value={assignNotes} onChange={e => setAssignNotes(e.target.value)} placeholder="Optional notes..." />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                <Button
                  disabled={!assignLdap.trim() || fleetOpMutation.isPending || !!(assignVehicleStatus && (() => {
                    const sc = assignVehicleStatus.holmanAssignedStatusCd;
                    return sc && ['L','B','W','T'].includes(sc);
                  })()) || assignVehicleStatus?.isLocked}
                  onClick={() => fleetOpMutation.mutate({
                    endpoint: "/api/fleet-ops/assign",
                    body: {
                      truckNumber: selectedVehicle?.vehicleNumber,
                      ldapId: assignLdap,
                      districtNo: assignDistrict,
                      techName: assignTechName,
                      notes: assignNotes,
                      assignmentType,
                      amsStatusId: assignAmsStatusId,
                      repairData: assignmentType === 'in-repair' ? assignRepairData : undefined,
                    },
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
                  onClick={() => {
                    const ldapId = selectedVehicle?.tpmsAssignedTechId?.trim() || selectedVehicle?.holmanTechAssigned?.trim();
                    if (!ldapId) {
                      toast({ title: "No technician LDAP ID found — try refreshing", variant: "destructive" });
                      return;
                    }
                    fleetOpMutation.mutate({
                      endpoint: "/api/fleet-ops/unassign",
                      body: { truckNumber: selectedVehicle?.vehicleNumber, ldapId, notes: unassignNotes },
                    });
                  }}
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
            setExpandedPOs(new Set());
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
              All POs from Holman for this vehicle, queried live from Snowflake.
            </DialogDescription>
          </DialogHeader>

          {/* Filter bar — compact collapsible */}
          {(() => {
            const activeCount = [poFilterPoNumber, poFilterVendor, poFilterPoType, poFilterAtaCode, poFilterDateFrom, poFilterDateTo].filter(Boolean).length + poFilterStatus.length;
            const clearAll = () => { setPoFilterPoNumber(""); setPoFilterVendor(""); setPoFilterPoType(""); setPoFilterAtaCode(""); setPoFilterDateFrom(""); setPoFilterDateTo(""); setPoFilterStatus([]); setPoFilterStatusOpen(false); };
            return (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPoFiltersExpanded(o => !o)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Filter className="h-3 w-3" />
                    Filters
                    {activeCount > 0 && (
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">{activeCount}</span>
                    )}
                    {poFiltersExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {activeCount > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
                      Clear all
                    </button>
                  )}
                </div>

                {poFiltersExpanded && (
                  <div className="flex flex-wrap gap-1.5 p-2 rounded-md border bg-muted/30">
                    <Input
                      className="h-7 text-xs w-28"
                      placeholder="PO #"
                      value={poFilterPoNumber}
                      onChange={e => setPoFilterPoNumber(e.target.value)}
                    />
                    <Input
                      className="h-7 text-xs w-36"
                      placeholder="Vendor"
                      value={poFilterVendor}
                      onChange={e => setPoFilterVendor(e.target.value)}
                    />
                    <Input
                      className="h-7 text-xs w-24"
                      placeholder="ATA Code"
                      value={poFilterAtaCode}
                      onChange={e => setPoFilterAtaCode(e.target.value)}
                    />
                    <select
                      className="h-7 text-xs rounded-md border border-input bg-background px-2 w-36"
                      value={poFilterPoType}
                      onChange={e => setPoFilterPoType(e.target.value)}
                    >
                      <option value="">All types</option>
                      <option value="rental">Rental</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="other">Other</option>
                    </select>
                    <div className="relative">
                      <button
                        type="button"
                        className="h-7 text-xs rounded-md border border-input bg-background px-2 flex items-center gap-1 w-36"
                        onClick={() => setPoFilterStatusOpen(o => !o)}
                      >
                        <span className="truncate flex-1 text-left">
                          {poFilterStatus.length === 0 ? "All statuses" : `${poFilterStatus.length} status${poFilterStatus.length > 1 ? "es" : ""}`}
                        </span>
                        <span className="text-muted-foreground shrink-0">▾</span>
                      </button>
                      {poFilterStatusOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setPoFilterStatusOpen(false)} />
                          <div className="absolute z-50 mt-1 min-w-[140px] rounded-md border border-input bg-background shadow-md">
                            {[
                              { value: "APPROVED", label: "Approved" },
                              { value: "OPEN", label: "Open" },
                              { value: "HOLD", label: "Hold" },
                              { value: "BILL HOLD", label: "Bill Hold" },
                              { value: "PAID", label: "Paid" },
                              { value: "VOID", label: "Void" },
                              { value: "SUSPENDED", label: "Suspended" },
                            ].map(opt => (
                              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted">
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 accent-primary"
                                  checked={poFilterStatus.includes(opt.value)}
                                  onChange={() => setPoFilterStatus(prev =>
                                    prev.includes(opt.value) ? prev.filter(s => s !== opt.value) : [...prev, opt.value]
                                  )}
                                />
                                {opt.label}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <Input
                      type="date"
                      className="h-7 text-xs w-34"
                      placeholder="From"
                      value={poFilterDateFrom}
                      onChange={e => setPoFilterDateFrom(e.target.value)}
                    />
                    <Input
                      type="date"
                      className="h-7 text-xs w-34"
                      placeholder="To"
                      value={poFilterDateTo}
                      onChange={e => setPoFilterDateTo(e.target.value)}
                    />
                  </div>
                )}
              </>
            );
          })()}

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
              // Group all line items by PO number
              const groupMap = new Map<string, { summary: any; lines: any[] }>();
              for (const row of vehiclePOs) {
                const key = row.poNumber || "UNKNOWN";
                if (!groupMap.has(key)) {
                  groupMap.set(key, { summary: row, lines: [] });
                }
                groupMap.get(key)!.lines.push(row);
              }

              // Apply filters at the PO group level
              const filteredGroups = Array.from(groupMap.values()).filter(({ summary, lines }) => {
                if (poFilterPoNumber && !String(summary.poNumber || "").toLowerCase().includes(poFilterPoNumber.toLowerCase())) return false;
                if (poFilterVendor && !String(summary.vendor || summary.vendorName || "").toLowerCase().includes(poFilterVendor.toLowerCase())) return false;
                if (poFilterPoType && String(summary.poType || "").toLowerCase() !== poFilterPoType.toLowerCase()) return false;
                if (poFilterAtaCode) {
                  const ataSearch = poFilterAtaCode.toLowerCase();
                  const anyMatch = lines.some(l => String(l.rawData?.ataCode || l.ataCode || "").toLowerCase().includes(ataSearch));
                  if (!anyMatch) return false;
                }
                if (poFilterStatus.length > 0) {
                  const s = String(summary.poStatus || "").toUpperCase();
                  if (!poFilterStatus.some(sel => s === sel.toUpperCase())) return false;
                }
                const poDate = summary.poDate || summary.openDate || summary.date || "";
                if (poFilterDateFrom && poDate && poDate < poFilterDateFrom) return false;
                if (poFilterDateTo && poDate && poDate > poFilterDateTo) return false;
                return true;
              });

              const totalLines = filteredGroups.reduce((acc, g) => acc + g.lines.length, 0);

              const fmtAmt = (v: any) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

              return (
                <>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background border-b z-10">
                      <tr>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground w-6"></th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">PO #</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-right py-2 px-2 font-medium text-muted-foreground">Total</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Vendor</th>
                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroups.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-muted-foreground">No POs match your filters.</td>
                        </tr>
                      ) : filteredGroups.map(({ summary, lines }) => {
                        const poKey = summary.poNumber || "UNKNOWN";
                        const isExpanded = expandedPOs.has(poKey);
                        const totalAmt = lines.reduce((acc: number, l: any) => acc + (Number(l.amount) || 0), 0);
                        return (
                          <>
                            {/* PO Summary Row */}
                            <tr
                              key={`po-${poKey}`}
                              className="border-b hover:bg-muted/30 cursor-pointer"
                              onClick={() => setExpandedPOs(prev => {
                                const next = new Set(prev);
                                if (next.has(poKey)) next.delete(poKey);
                                else next.add(poKey);
                                return next;
                              })}
                            >
                              <td className="py-1.5 px-2 text-muted-foreground">
                                {isExpanded
                                  ? <ChevronDown className="h-3 w-3" />
                                  : <ChevronRight className="h-3 w-3" />}
                              </td>
                              <td className="py-1.5 px-2 font-mono font-semibold text-blue-600 dark:text-blue-400">
                                {summary.poNumber || "—"}
                              </td>
                              <td className="py-1.5 px-2">
                                {summary.poType === "maintenance"
                                  ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border-none">MAINT</Badge>
                                  : summary.poType === "rental"
                                  ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 text-xs border-none">RENTAL</Badge>
                                  : summary.poType
                                  ? <Badge variant="secondary" className="text-xs">{summary.poType}</Badge>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="py-1.5 px-2">
                                {(() => {
                                  const s = (summary.poStatus || "").toUpperCase();
                                  if (!s) return <span className="text-muted-foreground">—</span>;
                                  if (s === "OPEN")
                                    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs border-none">OPEN</Badge>;
                                  if (s === "APPROVED")
                                    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border-none">APPROVED</Badge>;
                                  if (s === "CLOSED" || s === "PAID")
                                    return <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 text-xs border-none">{summary.poStatus}</Badge>;
                                  return <Badge variant="secondary" className="text-xs">{summary.poStatus}</Badge>;
                                })()}
                              </td>
                              <td className="py-1.5 px-2 text-muted-foreground">{summary.poDate || summary.openDate || summary.date || "—"}</td>
                              <td className="py-1.5 px-2 text-right font-medium">{fmtAmt(totalAmt)}</td>
                              <td className="py-1.5 px-2">{summary.vendor || summary.vendorName || "—"}</td>
                              <td className="py-1.5 px-2 text-muted-foreground">{lines.length} line{lines.length !== 1 ? "s" : ""}</td>
                            </tr>

                            {/* Expanded Line Items */}
                            {isExpanded && (
                              <tr key={`lines-${poKey}`}>
                                <td colSpan={8} className="p-0 bg-muted/20 dark:bg-muted/10">
                                  <table className="w-full text-xs border-l-2 border-blue-300 dark:border-blue-700 ml-4">
                                    <thead>
                                      <tr className="border-b border-muted">
                                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">#</th>
                                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Description</th>
                                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">ATA Code</th>
                                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">ATA Group</th>
                                        <th className="text-left py-1.5 px-3 font-medium text-muted-foreground">Repair Type</th>
                                        <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {lines.map((line: any, idx: number) => (
                                        <tr key={idx} className="border-b border-muted/50 hover:bg-muted/30">
                                          <td className="py-1 px-3 text-muted-foreground">{idx + 1}</td>
                                          <td className="py-1 px-3 max-w-[240px]">{line.description || "—"}</td>
                                          <td className="py-1 px-3 font-mono text-orange-600 dark:text-orange-400">
                                            {line.ataCode || <span className="text-muted-foreground">—</span>}
                                          </td>
                                          <td className="py-1 px-3 text-muted-foreground">
                                            {line.ataGroupDesc || "—"}
                                          </td>
                                          <td className="py-1 px-3">
                                            {line.repairType
                                              ? <Badge variant="outline" className="text-[10px] py-0 h-4 font-normal">{line.repairType}</Badge>
                                              : <span className="text-muted-foreground">—</span>}
                                          </td>
                                          <td className="py-1 px-3 text-right">{fmtAmt(line.amount)}</td>
                                        </tr>
                                      ))}
                                      <tr className="border-t border-muted">
                                        <td colSpan={5} className="py-1.5 px-3 text-right font-medium text-muted-foreground">PO Total</td>
                                        <td className="py-1.5 px-3 text-right font-semibold">{fmtAmt(totalAmt)}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground px-2 py-2 border-t">
                    Showing {filteredGroups.length} PO{filteredGroups.length !== 1 ? "s" : ""} ({totalLines} line item{totalLines !== 1 ? "s" : ""}) — click a PO row to see line items &amp; ATA codes
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

      {/* ── Ops Review Modal ────────────────────────────────────────────────── */}
      <Dialog open={showOpsReview} onOpenChange={(open) => { setShowOpsReview(open); if (!open) setOpsReviewVehicle(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-600" />
              Ops Review
              {opsReviewVehicle && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  — #{opsReviewVehicle.vehicleNumber}
                  {opsReviewVehicle.city ? ` · ${opsReviewVehicle.city}, ${opsReviewVehicle.state}` : ''}
                  {opsReviewVehicle.zip ? ` ${opsReviewVehicle.zip}` : ''}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {opsReviewVehicle
                ? `Techs nearest to vehicle #${opsReviewVehicle.vehicleNumber} who are in rental ops or unassigned and active.`
                : 'Techs whose vehicle is currently in rental ops, and active techs without an assigned vehicle.'}
            </DialogDescription>
            {/* Reference zip for distance sorting */}
            <div className="flex items-center gap-2 mt-3">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Reference zip for distance sort..."
                value={opsRefZip}
                onChange={e => setOpsRefZip(e.target.value)}
                className="h-8 w-48 text-sm"
              />
              {opsSorting && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {!opsSorting && opsRefZip && (
                <span className="text-xs text-muted-foreground">Sorted by distance from {opsRefZip}</span>
              )}
              {!opsRefZip && (
                <span className="text-xs text-muted-foreground">Enter a zip to sort closest → furthest</span>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-hidden px-6 pb-6 pt-4 flex flex-col gap-3">
            {/* Filter bar */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {(["all", "rental", "unassigned"] as const).map(f => {
                const count = f === "all" ? opsCombinedList.length : f === "rental" ? opsRentalSorted.length : opsUnassignedSorted.length;
                const label = f === "all" ? "All" : f === "rental" ? "In Rentals" : "Unassigned Active";
                const active = opsListFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setOpsListFilter(f)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? f === "rental"
                          ? "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-700"
                          : f === "unassigned"
                          ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700"
                          : "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
                    }`}
                  >
                    {f === "rental" && <Car className="h-3 w-3" />}
                    {f === "unassigned" && <UserX className="h-3 w-3" />}
                    {label}
                    <span className={`rounded-full px-1.5 py-0.5 text-xs leading-none ${active ? "bg-white/20" : "bg-muted"}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Unified list */}
            <div className="flex-1 overflow-y-auto">
              {!allTechsRoster && (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />Loading tech roster…
                </div>
              )}
              {allTechsRoster && opsCombinedList.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                  <Users className="h-8 w-8 opacity-40" />
                  No techs match the current filter.
                </div>
              )}
              <div className="space-y-2">
                {opsCombinedList
                  .filter(t => opsListFilter === "all" || t.kind === opsListFilter)
                  .map((t, i) => {
                    const hasDist = t.distanceMiles !== Infinity && Number.isFinite(t.distanceMiles);
                    const distLabel = hasDist ? getDistanceLabel(t.distanceMiles) : null;
                    const phone = ('cellPhone' in t ? t.cellPhone : '') || ('mainPhone' in t ? t.mainPhone : '') || '';
                    return (
                      <div key={`${t.kind}-${t.techRacfid}`} className="flex items-start gap-3 border rounded-md px-4 py-3 bg-card hover:bg-muted/40 transition-colors">
                        <span className="text-xs font-mono text-muted-foreground w-6 shrink-0 pt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{t.techName}</span>
                            <span className="text-xs font-mono text-muted-foreground">{t.techRacfid}</span>
                            {t.kind === "rental" ? (
                              <Badge className="bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 text-xs h-5 border">In Rental</Badge>
                            ) : (
                              <Badge className="bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 text-xs h-5 border">Unassigned</Badge>
                            )}
                            {'districtNo' in t && t.districtNo && (
                              <Badge variant="outline" className="text-xs h-5">District {t.districtNo}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {t.kind === "rental" && 'vehicleNumber' in t && t.vehicleNumber && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Truck className="h-3 w-3" /> Truck #{t.vehicleNumber}
                              </span>
                            )}
                            {(t.homeCity || t.homeState) && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Home className="h-3 w-3" />
                                {[t.homeCity, t.homeState].filter(Boolean).join(', ')}
                                {t.homePostal && ` ${t.homePostal}`}
                              </span>
                            )}
                            {phone && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <PhoneCall className="h-3 w-3" />{phone}
                              </span>
                            )}
                            {'planningAreaName' in t && t.planningAreaName && (
                              <span className="text-xs text-muted-foreground">{t.planningAreaName}</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right min-w-[72px]">
                          {hasDist ? (
                            <div>
                              <span className={`text-sm font-medium ${distLabel!.color}`}>
                                {Math.round(t.distanceMiles).toLocaleString()} mi
                              </span>
                              <div className="text-xs text-muted-foreground">~{formatDriveTime(t.distanceMiles)}</div>
                              <div className={`text-xs ${distLabel!.color}`}>{distLabel!.label}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
