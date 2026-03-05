import { useState, useMemo, useEffect } from "react";
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
  UserPlus, ArrowLeftRight, FileText, Home, Activity
} from "lucide-react";
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
  type FleetModal = "assign" | "unassign" | "transfer" | "address" | null;
  const [activeModal, setActiveModal] = useState<FleetModal>(null);

  // Assign form
  const [assignLdap, setAssignLdap] = useState("");
  const [assignTechName, setAssignTechName] = useState("");
  const [assignDistrict, setAssignDistrict] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  // Transfer form
  const [transferToLdap, setTransferToLdap] = useState("");
  const [transferToName, setTransferToName] = useState("");

  // Unassign form
  const [unassignNotes, setUnassignNotes] = useState("");

  // Address form
  const [addrLine1, setAddrLine1] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");

  // Operation result (per-system status returned from fleet-ops endpoint)
  const [opResult, setOpResult] = useState<any>(null);

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
    onSuccess: (data: any) => {
      setOpResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/fleet-ops/logs", selectedVehicle?.vehicleNumber] });
      queryClient.invalidateQueries({ queryKey: ["/api/holman/fleet-vehicles"] });
    },
    onError: (err: any) => {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    },
  });

  function openModal(m: FleetModal) {
    setOpResult(null);
    // Pre-populate district from selected vehicle when opening assign/transfer
    if (m === "assign" || m === "transfer") {
      setAssignDistrict(selectedVehicle?.district || "");
    }
    // Pre-populate from tech when opening transfer
    if (m === "transfer") {
      setTransferToLdap("");
      setTransferToName("");
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
    if (status === "pending") return <Badge variant="outline" className="text-xs"><Loader2 className="h-3 w-3 mr-1 inline animate-spin" />Pending</Badge>;
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
      const searchNoLeadingZeros = searchLower.replace(/^0+/, '');
      const vehicleNumNoLeadingZeros = (vehicle.vehicleNumber || '').replace(/^0+/, '').toLowerCase();
      
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
      v.vehicleNumber === truckLookup.trim().padStart(6, '0')
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
                  Holman API is unavailable. Showing {activeVehicles.length} cached vehicles{oosCount > 0 && !showOos ? ` (${oosCount} OOS hidden)` : ""}.
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
                        ({oosCount} OOS hidden)
                      </span>
                    )}
                    {oosCount > 0 && !showOos && searchQuery.trim() && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">
                        (OOS included in search)
                      </span>
                    )}
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer select-none" title="Out-of-service vehicles are hidden by default">
                    <EyeOff className="h-4 w-4" />
                    <span className="text-xs">Show OOS</span>
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
                                <Badge className="bg-amber-600 text-white border-amber-700 text-xs">OOS</Badge>
                              )}
                              <Badge className={assignStatus.color + ' border text-xs'}>
                                {assignStatus.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {ownership.type}
                              </Badge>
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

                {/* Cross-System Operations */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">Cross-System Operations</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" className="w-full" onClick={() => openModal("assign")} data-testid="button-fleet-assign">
                      <UserPlus className="h-4 w-4 mr-1.5" />Assign Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("unassign")} disabled={!selectedVehicle.tpmsAssignedTechId && !selectedVehicle.holmanTechAssigned} data-testid="button-fleet-unassign">
                      <UserX className="h-4 w-4 mr-1.5" />Unassign Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("transfer")} data-testid="button-fleet-transfer">
                      <ArrowLeftRight className="h-4 w-4 mr-1.5" />Transfer Tech
                    </Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("address")} data-testid="button-fleet-address">
                      <Home className="h-4 w-4 mr-1.5" />Update Address
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* PO Section */}
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />POs for #{selectedVehicle.vehicleNumber}
                  </h4>
                  {posLoading ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading POs...</div>
                  ) : !vehiclePOs || vehiclePOs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No POs cached. Sync PO data from Holman Integration → PO Tracker.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {vehiclePOs.slice(0, 8).map((po: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-2 bg-muted/40 rounded text-xs">
                          <span className="font-mono flex-1">{po.poNumber}</span>
                          {po.poType === "maintenance"
                            ? <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs border-none shrink-0">MAINT</Badge>
                            : po.poType === "rental"
                            ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 text-xs border-none shrink-0">RENTAL</Badge>
                            : <Badge variant="secondary" className="text-xs shrink-0">{po.poType}</Badge>}
                          <span className="text-muted-foreground shrink-0">{po.poStatus}</span>
                          {po.amount != null && <span className="text-muted-foreground shrink-0">${Number(po.amount).toFixed(0)}</span>}
                        </div>
                      ))}
                      {vehiclePOs.length > 8 && <p className="text-xs text-muted-foreground">+{vehiclePOs.length - 8} more — see Holman PO Tracker</p>}
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

                <Separator />

                {/* Actions */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">Actions</h4>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {/* Sync to Holman */}
                    <Button 
                      onClick={() => syncToHolmanMutation.mutate({ 
                        vehicleNumber: selectedVehicle.vehicleNumber, 
                        enterpriseId: selectedVehicle.tpmsAssignedTechId 
                      })}
                      disabled={syncToHolmanMutation.isPending}
                      className="w-full"
                      data-testid="button-sync-holman"
                    >
                      {syncToHolmanMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Sync to Holman
                    </Button>

                    {/* Unassign from Holman */}
                    <Button 
                      variant="outline"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to unassign vehicle ${selectedVehicle.vehicleNumber} in Holman?`)) {
                          syncToHolmanMutation.mutate({ 
                            vehicleNumber: selectedVehicle.vehicleNumber, 
                            enterpriseId: null 
                          });
                        }
                      }}
                      disabled={syncToHolmanMutation.isPending || !selectedVehicle.holmanTechAssigned}
                      className="w-full"
                      data-testid="button-unassign-holman"
                    >
                      <UserX className="h-4 w-4 mr-2" />
                      Unassign
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* View Inventory */}
                    <ViewInventoryButton 
                      vehicleNumber={selectedVehicle.vehicleNumber} 
                      className="w-full"
                    />

                    {/* View History */}
                    <Button 
                      variant="outline"
                      onClick={() => setShowHistoryDialog(true)}
                      disabled={!selectedVehicle.tpmsAssignedTechId}
                      className="w-full"
                      data-testid="button-view-history"
                    >
                      <History className="h-4 w-4 mr-2" />
                      History
                    </Button>
                  </div>
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
                    <SystemStatusBadge status={opResult[`${sys}Status`] || opResult?.data?.[`${sys}Status`]} />
                    {(opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]}</span>
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
                  <Input className="mt-1" value={assignLdap} onChange={e => setAssignLdap(e.target.value)} placeholder="e.g. JSMITH01" />
                </div>
                <div>
                  <Label className="text-xs">District #</Label>
                  <Input className="mt-1" value={assignDistrict} onChange={e => setAssignDistrict(e.target.value)} placeholder="e.g. 123" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Tech Name (for log)</Label>
                <Input className="mt-1" value={assignTechName} onChange={e => setAssignTechName(e.target.value)} placeholder="First Last" />
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
                    <SystemStatusBadge status={opResult[`${sys}Status`] || opResult?.data?.[`${sys}Status`]} />
                    {(opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]}</span>
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

      {/* Transfer Tech Modal */}
      <Dialog open={activeModal === "transfer"} onOpenChange={(o) => { if (!o) { setActiveModal(null); setOpResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" />Transfer Tech — Vehicle #{selectedVehicle?.vehicleNumber}</DialogTitle>
            <DialogDescription>Unassigns current tech and assigns new tech across all systems.</DialogDescription>
          </DialogHeader>
          {opResult ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Operation Complete</p>
              {["tpms", "holman", "ams"].map(sys => (
                <div key={sys} className="flex items-center justify-between">
                  <span className="text-sm uppercase font-mono">{sys}</span>
                  <div className="flex items-center gap-2">
                    <SystemStatusBadge status={opResult[`${sys}Status`] || opResult?.data?.[`${sys}Status`]} />
                    {(opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult[`${sys}Message`] || opResult?.data?.[`${sys}Message`]}</span>
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
              <div className="p-3 bg-muted/50 rounded text-sm">
                <span className="text-muted-foreground">From: </span>
                <span className="font-mono">{selectedVehicle?.tpmsAssignedTechId || selectedVehicle?.holmanTechAssigned || "Unassigned"}</span>
                {selectedVehicle?.tpmsAssignedTechName && <span className="ml-2 text-muted-foreground">({selectedVehicle.tpmsAssignedTechName})</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">New Tech LDAP ID *</Label>
                  <Input className="mt-1" value={transferToLdap} onChange={e => setTransferToLdap(e.target.value)} placeholder="e.g. JDOE01" />
                </div>
                <div>
                  <Label className="text-xs">District #</Label>
                  <Input className="mt-1" value={assignDistrict} onChange={e => setAssignDistrict(e.target.value)} placeholder="e.g. 123" />
                </div>
              </div>
              <div>
                <Label className="text-xs">New Tech Name (for log)</Label>
                <Input className="mt-1" value={transferToName} onChange={e => setTransferToName(e.target.value)} placeholder="First Last" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                <Button
                  disabled={!transferToLdap || fleetOpMutation.isPending}
                  onClick={() => fleetOpMutation.mutate({
                    endpoint: "/api/fleet-ops/transfer",
                    body: {
                      truckNumber: selectedVehicle?.vehicleNumber,
                      fromLdap: selectedVehicle?.tpmsAssignedTechId || selectedVehicle?.holmanTechAssigned,
                      toLdap: transferToLdap,
                      districtNo: assignDistrict,
                      newTechName: transferToName,
                    },
                  })}
                >
                  {fleetOpMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ArrowLeftRight className="h-4 w-4 mr-1.5" />}
                  Transfer Tech
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
                    <SystemStatusBadge status={opResult[`${key}Status`] || opResult?.data?.[`${key}Status`]} />
                    {(opResult[`${key}Message`] || opResult?.data?.[`${key}Message`]) && (
                      <span className="text-xs text-muted-foreground">{opResult[`${key}Message`] || opResult?.data?.[`${key}Message`]}</span>
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
    </MainContent>
  );
}
