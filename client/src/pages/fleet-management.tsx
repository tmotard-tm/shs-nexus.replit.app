import { useState, useMemo } from "react";
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
import { 
  Truck, Search, Filter, ChevronDown, ChevronUp, RefreshCw, AlertCircle, 
  CheckCircle, XCircle, Database, Loader2, Link2, MapPin, Eye, 
  UserX, History, AlertTriangle, User
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { ViewInventoryButton } from "@/components/view-inventory-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type FleetVehicle } from "@/data/fleetData";
import { getVehicleOwnership } from "@/lib/vehicle-utils";
import { DataSourceIndicator, calculateZipDistance, getDistanceLabel } from "@/components/fleet";

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

export default function FleetManagement() {
  const { toast } = useToast();
  
  // Search and filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [targetZipcode, setTargetZipcode] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");
  const [vehicleProgramFilter, setVehicleProgramFilter] = useState("all");
  const [mismatchFilter, setMismatchFilter] = useState("all");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  // Quick lookup state
  const [techLookup, setTechLookup] = useState("");
  const [truckLookup, setTruckLookup] = useState("");
  
  // Selected vehicle for detail view
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);

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

  // Generate filter options from data
  const filterOptions = useMemo(() => {
    const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    return {
      regions: unique(allVehicles.map(v => v.region)),
      districts: unique(allVehicles.map(v => v.district)),
    };
  }, [allVehicles]);

  // Count active filters
  const activeFiltersCount = [
    regionFilter, districtFilter, assignmentStatusFilter, 
    vehicleProgramFilter, mismatchFilter
  ].filter(f => f !== "all").length + (targetZipcode ? 1 : 0);

  // Apply filters
  let filteredVehicles = useMemo(() => {
    return allVehicles.filter(vehicle => {
      const searchLower = searchQuery.toLowerCase().trim();
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
      
      const matchesRegion = regionFilter === "all" || vehicle.region === regionFilter;
      const matchesDistrict = districtFilter === "all" || vehicle.district === districtFilter;
      
      const matchesAssignment = assignmentStatusFilter === "all" || 
        (assignmentStatusFilter === "assigned" && vehicle.tpmsAssignedTechId) ||
        (assignmentStatusFilter === "unassigned" && !vehicle.tpmsAssignedTechId);
      
      const ownership = getVehicleOwnership(vehicle.vehicleNumber);
      const matchesProgram = vehicleProgramFilter === "all" ||
        (vehicleProgramFilter === "byov" && ownership.type === 'BYOV') ||
        (vehicleProgramFilter === "fleet" && ownership.type === 'Fleet');
      
      const holmanId = vehicle.holmanTechAssigned?.trim() || '';
      const tpmsId = vehicle.tpmsAssignedTechId?.trim() || '';
      const hasMismatch = (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) ||
                          (holmanId && !tpmsId);
      const matchesMismatch = mismatchFilter === "all" || 
        (mismatchFilter === "mismatch" && hasMismatch) ||
        (mismatchFilter === "match" && !hasMismatch);
      
      return matchesSearch && matchesRegion && matchesDistrict && 
             matchesAssignment && matchesProgram && matchesMismatch;
    });
  }, [allVehicles, searchQuery, regionFilter, districtFilter, assignmentStatusFilter, vehicleProgramFilter, mismatchFilter]);

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
    setRegionFilter("all");
    setDistrictFilter("all");
    setAssignmentStatusFilter("all");
    setVehicleProgramFilter("all");
    setMismatchFilter("all");
  };

  const getAssignmentStatus = (vehicle: FleetVehicle) => {
    const holmanId = vehicle.holmanTechAssigned?.trim();
    const tpmsId = vehicle.tpmsAssignedTechId?.trim();
    
    if (tpmsId && holmanId && tpmsId.toLowerCase() === holmanId.toLowerCase()) {
      return { status: 'synced', label: 'Synced', color: 'bg-green-100 text-green-800' };
    }
    if (tpmsId && !holmanId) {
      return { status: 'pending', label: 'Pending Sync', color: 'bg-yellow-100 text-yellow-800' };
    }
    if (holmanId && !tpmsId) {
      return { status: 'mismatch', label: 'Mismatch', color: 'bg-red-100 text-red-800' };
    }
    if (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) {
      return { status: 'mismatch', label: 'Mismatch', color: 'bg-red-100 text-red-800' };
    }
    return { status: 'unassigned', label: 'Unassigned', color: 'bg-gray-100 text-gray-800' };
  };

  // Stats
  const assignedCount = allVehicles.filter(v => v.tpmsAssignedTechId).length;
  const unassignedCount = allVehicles.length - assignedCount;
  const mismatchCount = allVehicles.filter(v => {
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
                  <p className="text-2xl font-bold" data-testid="text-total-vehicles">{allVehicles.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-green-600">Assigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-assigned-count">{assignedCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">Unassigned</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-gray-600" data-testid="text-unassigned-count">{unassignedCount}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-amber-600">Mismatches</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-600" data-testid="text-mismatch-count">{mismatchCount}</p>
                </CardContent>
              </Card>
            </div>

            {/* Quick Lookup Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-around">
                    <div className="text-center">
                      <Database className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.snowflake ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Snowflake</span>
                    </div>
                    <div className="text-center">
                      <Link2 className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.tpms ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">TPMS</span>
                    </div>
                    <div className="text-center">
                      <Truck className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.holman ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Holman</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

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

            {isDegradedMode && !isLoading && allVehicles.length > 0 && (
              <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                <Database className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800 dark:text-amber-400">Using Cached Data</AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-300">
                  Holman API is unavailable. Showing {allVehicles.length} cached vehicles.
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

                {/* Filters Panel */}
                <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <Label className="text-xs">Region</Label>
                        <Select value={regionFilter} onValueChange={setRegionFilter}>
                          <SelectTrigger data-testid="select-region">
                            <SelectValue placeholder="All Regions" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Regions</SelectItem>
                            {filterOptions.regions.map(r => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">District</Label>
                        <Select value={districtFilter} onValueChange={setDistrictFilter}>
                          <SelectTrigger data-testid="select-district">
                            <SelectValue placeholder="All Districts" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Districts</SelectItem>
                            {filterOptions.districts.map(d => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Assignment</Label>
                        <Select value={assignmentStatusFilter} onValueChange={setAssignmentStatusFilter}>
                          <SelectTrigger data-testid="select-assignment">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="assigned">Assigned</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Program</Label>
                        <Select value={vehicleProgramFilter} onValueChange={setVehicleProgramFilter}>
                          <SelectTrigger data-testid="select-program">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="fleet">Fleet</SelectItem>
                            <SelectItem value="byov">BYOV</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Sync Status</Label>
                        <Select value={mismatchFilter} onValueChange={setMismatchFilter}>
                          <SelectTrigger data-testid="select-mismatch">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="mismatch">Mismatches Only</SelectItem>
                            <SelectItem value="match">Synced Only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {activeFiltersCount > 0 && (
                      <div className="flex justify-end mt-2">
                        <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
                          Clear All Filters
                        </Button>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Showing {sortedVehicles.length} of {allVehicles.length} vehicles</span>
                </div>
              </CardContent>
            </Card>

            {/* Vehicle Table */}
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-6 space-y-4">
                    <Skeleton className="h-10 w-full" />
                    {[1, 2, 3, 4, 5].map(i => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : sortedVehicles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-semibold text-lg">No Vehicles Found</h3>
                    <p className="text-muted-foreground">
                      {searchQuery || activeFiltersCount > 0 
                        ? "No vehicles match your current filters" 
                        : "No vehicles available"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Truck #</th>
                          <th className="text-left p-3 font-medium">Vehicle</th>
                          <th className="text-left p-3 font-medium">Location</th>
                          <th className="text-left p-3 font-medium">TPMS Tech</th>
                          <th className="text-left p-3 font-medium">Holman Tech</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          {targetZipcode && <th className="text-left p-3 font-medium">Distance</th>}
                          <th className="text-left p-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedVehicles.slice(0, 100).map((vehicle) => {
                          const assignStatus = getAssignmentStatus(vehicle);
                          const ownership = getVehicleOwnership(vehicle.vehicleNumber);
                          const distanceScore = (vehicle as any).distanceScore;
                          const distanceInfo = distanceScore ? getDistanceLabel(distanceScore) : null;
                          
                          return (
                            <tr 
                              key={vehicle.vin} 
                              className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                              onClick={() => setSelectedVehicle(vehicle)}
                              data-testid={`row-vehicle-${vehicle.vehicleNumber}`}
                            >
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold">{vehicle.vehicleNumber}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {ownership.type}
                                  </Badge>
                                </div>
                              </td>
                              <td className="p-3 text-sm">
                                <div>{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</div>
                                <div className="text-xs text-muted-foreground">{vehicle.licensePlate}</div>
                              </td>
                              <td className="p-3 text-sm">
                                <div>{vehicle.city}, {vehicle.state}</div>
                                <div className="text-xs text-muted-foreground">{vehicle.zip}</div>
                              </td>
                              <td className="p-3">
                                {vehicle.tpmsAssignedTechId ? (
                                  <div className="text-sm">
                                    <div className="font-mono">{vehicle.tpmsAssignedTechId}</div>
                                    {vehicle.tpmsAssignedTechName && (
                                      <div className="text-xs text-muted-foreground">{vehicle.tpmsAssignedTechName}</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                              <td className="p-3">
                                {vehicle.holmanTechAssigned ? (
                                  <div className="text-sm">
                                    <div className="font-mono">{vehicle.holmanTechAssigned}</div>
                                    {vehicle.holmanTechName && (
                                      <div className="text-xs text-muted-foreground">{vehicle.holmanTechName}</div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </td>
                              <td className="p-3">
                                <Badge className={assignStatus.color}>{assignStatus.label}</Badge>
                              </td>
                              {targetZipcode && (
                                <td className="p-3">
                                  {distanceInfo && (
                                    <span className={`text-sm ${distanceInfo.color}`}>{distanceInfo.label}</span>
                                  )}
                                </td>
                              )}
                              <td className="p-3">
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); setSelectedVehicle(vehicle); }}
                                    title="View Details"
                                    data-testid={`button-view-${vehicle.vehicleNumber}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <ViewInventoryButton vehicleNumber={vehicle.vehicleNumber} size="sm" variant="ghost" className="h-8 px-2" />
                                  {assignStatus.status === 'mismatch' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        syncToHolmanMutation.mutate({
                                          vehicleNumber: vehicle.vehicleNumber,
                                          enterpriseId: vehicle.tpmsAssignedTechId || null,
                                        });
                                      }}
                                      disabled={syncToHolmanMutation.isPending}
                                      title="Sync to Holman"
                                      className="text-amber-600 hover:text-amber-700"
                                      data-testid={`button-sync-${vehicle.vehicleNumber}`}
                                    >
                                      <RefreshCw className={`h-4 w-4 ${syncToHolmanMutation.isPending ? 'animate-spin' : ''}`} />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {sortedVehicles.length > 100 && (
                      <div className="p-4 text-center text-sm text-muted-foreground border-t">
                        Showing first 100 of {sortedVehicles.length} vehicles. Use filters to narrow results.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Vehicle Detail Dialog - Placeholder for Task 3 */}
      {selectedVehicle && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedVehicle(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Vehicle Details</h2>
                <Button variant="ghost" size="sm" onClick={() => setSelectedVehicle(null)}>
                  <XCircle className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Truck #</Label>
                  <p className="font-mono font-semibold">{selectedVehicle.vehicleNumber}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">VIN</Label>
                  <p className="font-mono text-sm">{selectedVehicle.vin}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Vehicle</Label>
                  <p>{selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">License</Label>
                  <p>{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Location</Label>
                  <p>{selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Region / District</Label>
                  <p>{selectedVehicle.region} / {selectedVehicle.district}</p>
                </div>
              </div>
              
              <div className="border-t pt-4">
                <h3 className="font-medium mb-3">Assignment Info</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">TPMS Assigned</Label>
                    <p className="font-mono">{selectedVehicle.tpmsAssignedTechId || '-'}</p>
                    {selectedVehicle.tpmsAssignedTechName && (
                      <p className="text-sm text-muted-foreground">{selectedVehicle.tpmsAssignedTechName}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Holman Assigned</Label>
                    <p className="font-mono">{selectedVehicle.holmanTechAssigned || '-'}</p>
                    {selectedVehicle.holmanTechName && (
                      <p className="text-sm text-muted-foreground">{selectedVehicle.holmanTechName}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 flex gap-2">
                <Button 
                  onClick={() => syncToHolmanMutation.mutate({ 
                    vehicleNumber: selectedVehicle.vehicleNumber, 
                    enterpriseId: selectedVehicle.tpmsAssignedTechId 
                  })}
                  disabled={syncToHolmanMutation.isPending}
                  data-testid="button-sync-holman"
                >
                  {syncToHolmanMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Sync to Holman
                </Button>
                <ViewInventoryButton vehicleNumber={selectedVehicle.vehicleNumber} />
              </div>
            </div>
          </div>
        </div>
      )}
    </MainContent>
  );
}
