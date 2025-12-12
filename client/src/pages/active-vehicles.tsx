import { useState, useEffect, useMemo } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Car, Search, MapPin, Calendar, Filter, ChevronDown, ChevronUp, X, CheckCircle, XCircle, Database, Loader2, AlertCircle, RefreshCw, User, AlertTriangle } from "lucide-react";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type FleetVehicle } from "@/data/fleetData";

interface SyncStatus {
  dataMode: 'live' | 'cached' | 'empty';
  isStale: boolean;
  lastSyncAt: string | null;
  pendingChangeCount: number;
  totalVehicles: number;
  apiAvailable: boolean;
  errorMessage?: string | null;
}

interface FleetVehiclesResponse {
  success: boolean;
  totalCount: number;
  pageInfo?: {
    pageNumber: number;
    pageSize: number;
    totalPages: number;
  };
  vehicles: FleetVehicle[];
  message?: string;
  syncStatus?: SyncStatus;
}

export default function ActiveVehicles() {
  const [location] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [interiorFilter, setInteriorFilter] = useState("all");
  const [tuneStatusFilter, setTuneStatusFilter] = useState("all");
  const [makeFilter, setMakeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [colorFilter, setColorFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [licenseStateFilter, setLicenseStateFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");
  const [holmanTechFilter, setHolmanTechFilter] = useState("all");
  const [tpmsTechFilter, setTpmsTechFilter] = useState("all");
  const [mismatchFilter, setMismatchFilter] = useState("all");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  
  // Fetch vehicles from Holman API
  const { data: apiResponse, isLoading, error, refetch, isFetching } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });

  // Check if API returned success:false
  const syncStatus = apiResponse?.syncStatus;
  const apiError = apiResponse && !apiResponse.success ? apiResponse.message : null;
  const hasError = error || (apiError && syncStatus?.dataMode === 'empty');
  const errorMessage = apiError || syncStatus?.errorMessage || (error as Error)?.message || 'Failed to load vehicles from Holman API';
  
  // Determine if we're in degraded mode (cached data)
  const isDegradedMode = syncStatus?.dataMode === 'cached';
  const isLiveMode = syncStatus?.dataMode === 'live';
  
  const allVehicles = apiResponse?.vehicles || [];
  
  // Count active filters
  const activeFiltersCount = [
    brandingFilter, interiorFilter, tuneStatusFilter, makeFilter, modelFilter,
    colorFilter, stateFilter, licenseStateFilter, regionFilter, divisionFilter, districtFilter,
    yearFilter, cityFilter, assignmentStatusFilter, holmanTechFilter, tpmsTechFilter, mismatchFilter
  ].filter(filter => filter !== "all").length;

  // Check if we should filter vehicles based on URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const filterParam = urlParams.get('filter');
  const showOnlyAssigned = filterParam === 'assigned';
  const showOnlyUnassigned = filterParam === 'unassigned';
  
  // Use appropriate vehicle list based on filter
  let baseVehicles = allVehicles;
  if (showOnlyAssigned) {
    baseVehicles = allVehicles.filter(v => !v.outOfServiceDate);
  } else if (showOnlyUnassigned) {
    baseVehicles = allVehicles.filter(v => v.outOfServiceDate);
  }
  
  // Generate filter options dynamically from the loaded data
  const filterOptions = useMemo(() => {
    const unique = (arr: string[]) => Array.from(new Set(arr.filter(Boolean))).sort();
    const uniqueNum = (arr: number[]) => Array.from(new Set(arr.filter(n => n > 0))).sort((a, b) => b - a);
    
    return {
      makes: unique(allVehicles.map(v => v.makeName)),
      models: unique(allVehicles.map(v => v.modelName)),
      colors: unique(allVehicles.map(v => v.color)),
      states: unique(allVehicles.map(v => v.state)),
      licenseStates: unique(allVehicles.map(v => v.licenseState)),
      regions: unique(allVehicles.map(v => v.region)),
      divisions: unique(allVehicles.map(v => v.division || '')),
      districts: unique(allVehicles.map(v => v.district)),
      cities: unique(allVehicles.map(v => v.city)),
      years: uniqueNum(allVehicles.map(v => v.modelYear)),
      brandings: unique(allVehicles.map(v => v.branding)),
      interiors: unique(allVehicles.map(v => v.interior)),
      tuneStatuses: unique(allVehicles.map(v => v.tuneStatus)),
      holmanTechs: unique(allVehicles.map(v => v.holmanTechAssigned || '').filter(Boolean)),
      tpmsTechs: unique(allVehicles.map(v => v.tpmsAssignedTechId || '').filter(Boolean)),
    };
  }, [allVehicles]);

  const filteredVehicles = baseVehicles.filter(vehicle => {
    const matchesSearch = !searchQuery || 
      vehicle.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.deliveryAddress.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBranding = brandingFilter === "all" || vehicle.branding === brandingFilter;
    const matchesInterior = interiorFilter === "all" || vehicle.interior === interiorFilter;
    const matchesTuneStatus = tuneStatusFilter === "all" || vehicle.tuneStatus === tuneStatusFilter;
    const matchesMake = makeFilter === "all" || vehicle.makeName === makeFilter;
    const matchesModel = modelFilter === "all" || vehicle.modelName === modelFilter;
    const matchesColor = colorFilter === "all" || vehicle.color === colorFilter;
    const matchesState = stateFilter === "all" || vehicle.state === stateFilter;
    const matchesLicenseState = licenseStateFilter === "all" || vehicle.licenseState === licenseStateFilter;
    const matchesRegion = regionFilter === "all" || vehicle.region === regionFilter;
    const matchesDivision = divisionFilter === "all" || vehicle.division === divisionFilter;
    const matchesDistrict = districtFilter === "all" || vehicle.district === districtFilter;
    const matchesYear = yearFilter === "all" || vehicle.modelYear.toString() === yearFilter;
    const matchesCity = cityFilter === "all" || vehicle.city === cityFilter;
    // Assignment status is determined by TPMS, not Holman
    const matchesAssignmentStatus = assignmentStatusFilter === "all" || 
      (assignmentStatusFilter === "assigned" && vehicle.tpmsAssignedTechId) ||
      (assignmentStatusFilter === "unassigned" && !vehicle.tpmsAssignedTechId);
    
    // Holman tech filter
    const matchesHolmanTech = holmanTechFilter === "all" || 
      (holmanTechFilter === "unassigned" && !vehicle.holmanTechAssigned) ||
      vehicle.holmanTechAssigned === holmanTechFilter;
    
    // TPMS tech filter  
    const matchesTpmsTech = tpmsTechFilter === "all" || 
      (tpmsTechFilter === "unassigned" && !vehicle.tpmsAssignedTechId) ||
      vehicle.tpmsAssignedTechId === tpmsTechFilter;
    
    // Mismatch filter
    const holmanId = vehicle.holmanTechAssigned?.trim() || '';
    const tpmsId = vehicle.tpmsAssignedTechId?.trim() || '';
    const vehicleHasMismatch = (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) ||
                               (holmanId && !tpmsId);
    const matchesMismatch = mismatchFilter === "all" || 
      (mismatchFilter === "mismatch" && vehicleHasMismatch) ||
      (mismatchFilter === "match" && !vehicleHasMismatch);
    
    return matchesSearch && matchesBranding && matchesInterior && matchesTuneStatus &&
           matchesMake && matchesModel && matchesColor && matchesState && matchesLicenseState &&
           matchesRegion && matchesDivision && matchesDistrict && matchesYear && matchesCity && 
           matchesAssignmentStatus && matchesHolmanTech && matchesTpmsTech && matchesMismatch;
  });

  return (
    <MainContent>
      <TopBar 
        title={showOnlyAssigned ? "Assigned Vehicles" : showOnlyUnassigned ? "Unassigned Vehicles" : "Active Vehicles"}
        breadcrumbs={["Home", showOnlyAssigned ? "Assigned Vehicles" : showOnlyUnassigned ? "Unassigned Vehicles" : "Active Vehicles"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          {/* Loading State */}
          {isLoading && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading vehicles from Holman API...</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <div className="grid gap-4">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Error State */}
          {hasError && !isLoading && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error Loading Vehicles</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{errorMessage}</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetch()}
                  disabled={isFetching}
                  data-testid="button-retry-load"
                >
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Degraded Mode Banner - Cached Data */}
          {isDegradedMode && !isLoading && allVehicles.length > 0 && (
            <Alert className="mb-6 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
              <Database className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800 dark:text-amber-400">Using Cached Data</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <div className="text-amber-700 dark:text-amber-300">
                  <span>Holman API is unavailable. Showing {allVehicles.length} cached vehicles.</span>
                  {syncStatus?.lastSyncAt && (
                    <span className="ml-2 text-sm opacity-80">
                      Last synced: {new Date(syncStatus.lastSyncAt).toLocaleString()}
                    </span>
                  )}
                  {syncStatus?.pendingChangeCount ? (
                    <span className="ml-2 text-sm font-medium">
                      ({syncStatus.pendingChangeCount} pending changes will sync when API recovers)
                    </span>
                  ) : null}
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="border-amber-500 text-amber-700 hover:bg-amber-100"
                  data-testid="button-retry-sync"
                >
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Retry Sync
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Live Mode Indicator */}
          {isLiveMode && !isLoading && (
            <div className="mb-4 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span>Live data from Holman API</span>
              {syncStatus?.lastSyncAt && (
                <span className="text-muted-foreground">
                  • Updated: {new Date(syncStatus.lastSyncAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}

          {/* Main Content */}
          {!isLoading && <div className="space-y-6">
            {/* Refresh Button */}
            <div className="flex justify-end">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-vehicles"
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh Data
              </Button>
            </div>

            {/* Search and Filters */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{showOnlyAssigned ? "Search Assigned Vehicles" : showOnlyUnassigned ? "Search Unassigned Vehicles" : "Search Active Vehicles"}</span>
                  <div className="flex items-center gap-2">
                    {activeFiltersCount > 0 && (
                      <span className="text-sm bg-primary/10 text-primary px-2 py-1 rounded-full">
                        {activeFiltersCount} active
                      </span>
                    )}
                    <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm" data-testid="button-toggle-filters">
                          <Filter className="h-4 w-4 mr-2" />
                          Filters
                          {isFiltersOpen ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
                        </Button>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent className="space-y-4 mt-4">
                        {/* Vehicle Information Filters */}
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Vehicle Details</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Make</Label>
                              <Select value={makeFilter} onValueChange={setMakeFilter} data-testid="select-make-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={modelFilter} onValueChange={setModelFilter} data-testid="select-model-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={yearFilter} onValueChange={setYearFilter} data-testid="select-year-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={colorFilter} onValueChange={setColorFilter} data-testid="select-color-filter">
                                <SelectTrigger className="h-8">
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
                        
                        {/* Service & Configuration Filters */}
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Configuration</h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Branding</Label>
                              <Select value={brandingFilter} onValueChange={setBrandingFilter} data-testid="select-branding-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={interiorFilter} onValueChange={setInteriorFilter} data-testid="select-interior-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={tuneStatusFilter} onValueChange={setTuneStatusFilter} data-testid="select-tune-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={assignmentStatusFilter} onValueChange={setAssignmentStatusFilter} data-testid="select-assignment-status-filter">
                                <SelectTrigger className="h-8">
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
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">State</Label>
                              <Select value={stateFilter} onValueChange={setStateFilter} data-testid="select-state-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={cityFilter} onValueChange={setCityFilter} data-testid="select-city-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={licenseStateFilter} onValueChange={setLicenseStateFilter} data-testid="select-license-state-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={regionFilter} onValueChange={setRegionFilter} data-testid="select-region-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={divisionFilter} onValueChange={setDivisionFilter} data-testid="select-division-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={districtFilter} onValueChange={setDistrictFilter} data-testid="select-district-filter">
                                <SelectTrigger className="h-8">
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
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Holman Tech ID</Label>
                              <Select value={holmanTechFilter} onValueChange={setHolmanTechFilter} data-testid="select-holman-tech-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={tpmsTechFilter} onValueChange={setTpmsTechFilter} data-testid="select-tpms-tech-filter">
                                <SelectTrigger className="h-8">
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
                              <Select value={mismatchFilter} onValueChange={setMismatchFilter} data-testid="select-mismatch-filter">
                                <SelectTrigger className="h-8">
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
                        
                        {/* Action Buttons */}
                        <div className="flex justify-between items-center pt-2 border-t">
                          <span className="text-sm text-muted-foreground">
                            {activeFiltersCount > 0 ? `${activeFiltersCount} filter(s) active` : 'No filters applied'}
                          </span>
                          <div className="flex gap-2">
                            {activeFiltersCount > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setBrandingFilter("all");
                                  setInteriorFilter("all");
                                  setTuneStatusFilter("all");
                                  setMakeFilter("all");
                                  setModelFilter("all");
                                  setColorFilter("all");
                                  setStateFilter("all");
                                  setLicenseStateFilter("all");
                                  setRegionFilter("all");
                                  setDivisionFilter("all");
                                  setDistrictFilter("all");
                                  setYearFilter("all");
                                  setCityFilter("all");
                                  setAssignmentStatusFilter("all");
                                  setHolmanTechFilter("all");
                                  setTpmsTechFilter("all");
                                  setMismatchFilter("all");
                                }}
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
                  </div>
                </CardTitle>
                <CardDescription>
                  View and search all active vehicles in the fleet
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search by VIN, vehicle number, license plate, make/model, city, or address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-vehicles"
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
              </CardContent>
            </Card>

            {/* Vehicle List */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">{showOnlyAssigned ? `Assigned Vehicles (${baseVehicles.length})` : showOnlyUnassigned ? `Unassigned Vehicles (${baseVehicles.length})` : `Active Vehicles (${apiResponse?.totalCount || allVehicles.length})`}</h3>
              </div>
              
              <div className="grid gap-4">
                {filteredVehicles.map((vehicle) => {
                  // Check for assignment mismatch:
                  // 1. Both have IDs but they don't match, OR
                  // 2. Holman has ID but TPMS doesn't (data inconsistency)
                  const holmanId = vehicle.holmanTechAssigned?.trim() || '';
                  const tpmsId = vehicle.tpmsAssignedTechId?.trim() || '';
                  const hasMismatch = (holmanId && tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase()) ||
                                      (holmanId && !tpmsId);
                  
                  return (
                  <Card 
                    key={vehicle.vin} 
                    data-testid={`card-vehicle-${vehicle.vin}`}
                    className={hasMismatch ? 'border-2 border-orange-500 bg-orange-50 dark:bg-orange-950' : ''}
                  >
                    <CardContent className="p-4">
                      {hasMismatch && (
                        <div className="mb-3 p-2 bg-orange-100 dark:bg-orange-900 rounded-md flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-orange-600" />
                          <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
                            Assignment Mismatch: {holmanId && !tpmsId 
                              ? `Holman has tech (${holmanId}) but TPMS has no assignment` 
                              : `Holman ID (${holmanId}) does not match TPMS ID (${tpmsId})`}
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Car className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Vehicle #{vehicle.vehicleNumber}</p>
                          <p className="text-sm text-muted-foreground">VIN: {vehicle.vin}</p>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <img src={licensePlateIcon} alt="License plate" className="h-6 w-8 object-contain" />
                            <span className="text-sm">{vehicle.licensePlate}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{vehicle.licenseState}</p>
                          <p className="text-xs text-muted-foreground">Color: {vehicle.color}</p>
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{vehicle.branding}</p>
                          <p className="text-xs text-muted-foreground">{vehicle.interior}</p>
                          <p className="text-xs text-muted-foreground">Tune: {vehicle.tuneStatus}</p>
                        </div>
                        
                        <div className="space-y-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-blue-500" />
                              <span className="text-xs font-medium text-blue-600">Holman Tech Assigned</span>
                              {vehicle.holmanTechAssigned ? (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle className="h-3 w-3" />
                                  Assigned
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-red-600">
                                  <XCircle className="h-3 w-3" />
                                  Unassigned
                                </span>
                              )}
                            </div>
                            {vehicle.holmanTechAssigned || vehicle.holmanTechName ? (
                              <>
                                <p className="text-sm ml-6" data-testid={`holman-tech-name-${vehicle.vin}`}>{vehicle.holmanTechName || 'N/A'}</p>
                                <p className="text-xs text-muted-foreground ml-6" data-testid={`holman-tech-id-${vehicle.vin}`}>ID: {vehicle.holmanTechAssigned || 'N/A'}</p>
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground ml-6">None</p>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-purple-500" />
                              <span className="text-xs font-medium text-purple-600">TPMS Assigned Tech</span>
                              {vehicle.tpmsAssignedTechId ? (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle className="h-3 w-3" />
                                  Assigned
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-red-600">
                                  <XCircle className="h-3 w-3" />
                                  Unassigned
                                </span>
                              )}
                            </div>
                            {vehicle.tpmsAssignedTechId ? (
                              <>
                                <p className="text-sm ml-6" data-testid={`tpms-tech-name-${vehicle.vin}`}>{vehicle.tpmsAssignedTechName || 'N/A'}</p>
                                <p className="text-xs text-muted-foreground ml-6" data-testid={`tpms-tech-id-${vehicle.vin}`}>ID: {vehicle.tpmsAssignedTechId}</p>
                              </>
                            ) : (
                              <p className="text-xs text-muted-foreground ml-6">None</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{vehicle.city}, {vehicle.state} {vehicle.zip}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Region: {vehicle.region || 'N/A'}</p>
                          <p className="text-xs text-muted-foreground">Division: {vehicle.division || 'N/A'}</p>
                          <p className="text-xs text-muted-foreground">District: {vehicle.district || 'N/A'}</p>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-5 gap-4 text-xs text-muted-foreground">
                        {vehicle.deliveryDate && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            <span>Acquired: {vehicle.deliveryDate}</span>
                          </div>
                        )}
                        {vehicle.regRenewalDate && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            <span>Reg Renewal: {vehicle.regRenewalDate}</span>
                          </div>
                        )}
                        {(vehicle.odometer && vehicle.odometer > 0) ? (
                          <div>
                            <span>Odometer: {vehicle.odometer.toLocaleString()} miles{vehicle.odometerDate ? ` (${vehicle.odometerDate})` : ''}</span>
                          </div>
                        ) : vehicle.odometerDelivery > 0 ? (
                          <div>
                            <span>Odometer: {vehicle.odometerDelivery.toLocaleString()} miles</span>
                          </div>
                        ) : null}
                        {vehicle.remainingBookValue > 0 && (
                          <div>
                            <span>Book Value: ${vehicle.remainingBookValue.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Database className="h-3 w-3" />
                          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium" data-testid={`source-${vehicle.vin}`}>
                            {vehicle.source || 'Holman'}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
                
                {filteredVehicles.length === 0 && (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Car className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No vehicles found matching your criteria</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>}
        </div>
      </main>
    </MainContent>
  );
}