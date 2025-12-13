import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Car, Search, MapPin, Calendar, Filter, ChevronDown, ChevronUp, X, CheckCircle, XCircle, User, AlertCircle, Loader2, RefreshCw, Truck } from "lucide-react";
import { getHolmanStatus, getVehicleOwnership } from "@/lib/vehicle-utils";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { useToast } from "@/hooks/use-toast";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";
// FleetVehicle type for Holman API data
interface FleetVehicle {
  vin: string;
  vehicleNumber: string;
  modelYear: number;
  makeName: string;
  modelName: string;
  licensePlate: string;
  licenseState: string;
  color: string;
  branding: string;
  interior: string;
  tuneStatus: string;
  city: string;
  state: string;
  zip: string;
  region: string;
  division?: string;
  district: string;
  deliveryAddress?: string;
  deliveryDate?: string;
  odometer?: number;
  outOfServiceDate?: string;
  saleDate?: string;
  regRenewalDate?: string;
  mis?: string;
  remainingBookValue?: number;
  leaseEndDate?: string;
  tpmsAssignedTechId?: string;
  tpmsAssignedTechName?: string;
  holmanTechAssigned?: string;
  holmanTechName?: string;
  dataSource?: string;
  statusCode?: number;
  [key: string]: any;
}

interface FleetVehiclesApiResponse {
  success: boolean;
  vehicles: FleetVehicle[];
  syncStatus: {
    dataMode: string;
    totalVehicles: number;
  };
}

interface HolmanVehicle {
  lesseeCode: string;
  holmanVehicleNumber?: string;
  clientVehicleNumber?: string;
  vin: string;
  modelYear?: number;
  year?: number;
  makeVin?: string;
  makeClient?: string;
  make?: string;
  modelVin?: string;
  modelClient?: string;
  model?: string;
  status?: string;
  assignedStatus?: string;
  licensePlate?: string;
  licenseState?: string;
  color?: string;
  garagingCity?: string;
  garagingState?: string;
  garagingZip?: string;
  garagingStreet1?: string;
  clientData2?: string;
  [key: string]: any;
}

interface HolmanVehiclesResponse {
  totalCount: number;
  pageInfo: {
    pageNumber: number;
    pageSize: number;
    totalPages: number;
  };
  data: HolmanVehicle[];
}

const getHolmanStatusInfo = (status: string | undefined): { label: string; color: string; icon: 'active' | 'inactive' | 'pending' | 'unknown' } => {
  const statusCode = status?.toString().toUpperCase() || '';
  
  switch (statusCode) {
    case '1':
    case 'ACTIVE':
    case 'A':
      return { label: 'Active', color: 'text-green-600 bg-green-50 border-green-200', icon: 'active' };
    case '2':
    case 'PENDING':
    case 'ON ORDER':
    case 'P':
      return { label: 'Pending/On Order', color: 'text-yellow-600 bg-yellow-50 border-yellow-200', icon: 'pending' };
    case '3':
    case 'SOLD':
    case 'TERMINATED':
    case 'S':
      return { label: 'Sold/Terminated', color: 'text-red-600 bg-red-50 border-red-200', icon: 'inactive' };
    case '4':
    case 'MAINTENANCE':
    case 'M':
      return { label: 'In Maintenance', color: 'text-orange-600 bg-orange-50 border-orange-200', icon: 'pending' };
    default:
      return { label: status || 'Unknown', color: 'text-gray-600 bg-gray-50 border-gray-200', icon: 'unknown' };
  }
};

export default function UpdateVehicle() {
  const { toast } = useToast();
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
  const [districtFilter, setDistrictFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [vehicleUpdateData, setVehicleUpdateData] = useState({
    licensePlate: "",
    color: "",
    branding: "",
    interior: "",
    tuneStatus: "",
    city: "",
    state: "",
    zip: "",
    region: "",
    district: ""
  });
  
  const [employeeData, setEmployeeData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    manager: "",
    enterpriseId: "",
    region: "",
    district: "",
    requisitionId: "",
    techId: "",
    proposedRouteStartDate: "",
    specialties: [] as string[],
    emergencyContact: "",
    emergencyPhone: ""
  });
  
  const departments = [
    "Human Resources",
    "Sales", 
    "Marketing",
    "Operations",
    "Finance",
    "IT",
    "Customer Service"
  ];

  const specialtyOptions = [
    "Cooking",
    "Microwave",
    "Laundry",
    "Dishwasher",
    "Refrigerator",
    "HA PM Check"
  ];
  
  // Fetch vehicles from Holman API with TPMS enrichment
  const { data: fleetResponse, isLoading: isLoadingHolman, error: holmanError, refetch: refetchHolman } = useQuery<FleetVehiclesApiResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const holmanVehicles: FleetVehicle[] = fleetResponse?.vehicles || [];

  // Mutation to sync vehicle assignment to Holman based on TPMS data
  const syncToHolmanMutation = useMutation({
    mutationFn: async ({ vehicleNumber, enterpriseId }: { vehicleNumber: string; enterpriseId: string }) => {
      const response = await apiRequest('POST', '/api/holman/assignments/update', { vehicleNumber, enterpriseId });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Holman Update Successful",
        description: `Vehicle ${data.holmanVehicleNumber} has been updated in Holman with TPMS assignment data`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/holman/fleet-vehicles'] });
    },
    onError: (error: any) => {
      toast({
        title: "Holman Update Failed",
        description: error.message || "Failed to update vehicle assignment in Holman",
        variant: "destructive",
      });
    },
  });

  const handleSyncToHolman = () => {
    if (!selectedVehicle) return;
    
    const enterpriseId = selectedVehicle.tpmsAssignedTechId || employeeData.enterpriseId;
    
    if (!enterpriseId) {
      toast({
        title: "Missing Enterprise ID",
        description: "Please enter an Enterprise ID or select a vehicle with a TPMS assigned technician",
        variant: "destructive",
      });
      return;
    }
    
    syncToHolmanMutation.mutate({
      vehicleNumber: selectedVehicle.vehicleNumber,
      enterpriseId,
    });
  };
  
  // Generate filter options from actual data
  const unique = (arr: (string | undefined)[]) => Array.from(new Set(arr.filter(Boolean))).sort() as string[];
  const uniqueNum = (arr: (number | undefined)[]) => Array.from(new Set(arr.filter((n): n is number => typeof n === 'number' && n > 0))).sort((a, b) => b - a);
  
  const filterOptions = {
    makes: unique(holmanVehicles.map(v => v.makeName)),
    models: unique(holmanVehicles.map(v => v.modelName)),
    colors: unique(holmanVehicles.map(v => v.color)),
    states: unique(holmanVehicles.map(v => v.state)),
    licenseStates: unique(holmanVehicles.map(v => v.licenseState)),
    regions: unique(holmanVehicles.map(v => v.region)),
    divisions: unique(holmanVehicles.map(v => v.division)),
    districts: unique(holmanVehicles.map(v => v.district)),
    cities: unique(holmanVehicles.map(v => v.city)),
    years: uniqueNum(holmanVehicles.map(v => v.modelYear)),
    brandings: unique(holmanVehicles.map(v => v.branding)),
    interiors: unique(holmanVehicles.map(v => v.interior)),
    tuneStatuses: unique(holmanVehicles.map(v => v.tuneStatus)),
  };

  const regions = [
    "Northeast",
    "Southeast",
    "Midwest",
    "Southwest",
    "West Coast",
    "Central"
  ];
  
  const managers = [
    { id: "1", name: "Sarah Johnson", department: "Sales" },
    { id: "2", name: "Mike Chen", department: "Operations" },
    { id: "3", name: "Emily Davis", department: "Marketing" },
    { id: "4", name: "Robert Wilson", department: "Finance" }
  ];
  
  // Apply prefill data from query parameters on component mount
  useEffect(() => {
    const updateFields = [
      'licensePlate', 'color', 'branding', 'interior', 'tuneStatus', 'city', 'state', 
      'zip', 'region', 'district'
    ];
    const employeeFields = [
      'firstName', 'lastName', 'email', 'phone', 'department', 'position', 'manager',
      'enterpriseId', 'region', 'district', 'requisitionId', 'techId', 'proposedRouteStartDate',
      'emergencyContact', 'emergencyPhone'
    ];
    const searchFields = ['searchQuery', 'brandingFilter', 'interiorFilter', 'tuneStatusFilter'];

    const updatePrefill = getPrefillParams(updateFields);
    const employeePrefill = getPrefillParams(employeeFields);
    const searchPrefill = getPrefillParams(searchFields);

    // Apply vehicle update prefill data
    if (Object.keys(updatePrefill).length > 0) {
      const processedData: any = {};
      if (updatePrefill.licensePlate) processedData.licensePlate = commonValidators.licensePlate(updatePrefill.licensePlate);
      if (updatePrefill.zip) processedData.zip = commonValidators.zipCode(updatePrefill.zip);
      if (updatePrefill.city) processedData.city = commonValidators.text(updatePrefill.city);
      if (updatePrefill.state) processedData.state = commonValidators.stateAbbr(updatePrefill.state);
      
      Object.keys(updatePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && updatePrefill[key]) {
          processedData[key] = updatePrefill[key];
        }
      });
      
      setVehicleUpdateData(prev => ({ ...prev, ...processedData }));
    }

    // Apply employee prefill data
    if (Object.keys(employeePrefill).length > 0) {
      const processedData: any = {};
      if (employeePrefill.email) processedData.email = commonValidators.email(employeePrefill.email);
      if (employeePrefill.phone) processedData.phone = commonValidators.phone(employeePrefill.phone);
      if (employeePrefill.firstName) processedData.firstName = commonValidators.employeeName(employeePrefill.firstName);
      if (employeePrefill.lastName) processedData.lastName = commonValidators.employeeName(employeePrefill.lastName);
      if (employeePrefill.department) processedData.department = commonValidators.department(employeePrefill.department);
      if (employeePrefill.position) processedData.position = commonValidators.position(employeePrefill.position);
      if (employeePrefill.enterpriseId) processedData.enterpriseId = commonValidators.employeeId(employeePrefill.enterpriseId);
      if (employeePrefill.requisitionId) processedData.requisitionId = commonValidators.text(employeePrefill.requisitionId);
      if (employeePrefill.techId) processedData.techId = commonValidators.text(employeePrefill.techId);
      if (employeePrefill.proposedRouteStartDate) processedData.proposedRouteStartDate = commonValidators.date(employeePrefill.proposedRouteStartDate);
      if (employeePrefill.emergencyContact) processedData.emergencyContact = commonValidators.employeeName(employeePrefill.emergencyContact);
      if (employeePrefill.emergencyPhone) processedData.emergencyPhone = commonValidators.phone(employeePrefill.emergencyPhone);
      
      Object.keys(employeePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && employeePrefill[key]) {
          processedData[key] = employeePrefill[key];
        }
      });
      
      setEmployeeData(prev => ({ ...prev, ...processedData }));
    }

    // Apply search/filter prefill data
    if (Object.keys(searchPrefill).length > 0) {
      if (searchPrefill.searchQuery) setSearchQuery(searchPrefill.searchQuery);
      if (searchPrefill.brandingFilter && searchPrefill.brandingFilter !== "all") setBrandingFilter(searchPrefill.brandingFilter);
      if (searchPrefill.interiorFilter && searchPrefill.interiorFilter !== "all") setInteriorFilter(searchPrefill.interiorFilter);
      if (searchPrefill.tuneStatusFilter && searchPrefill.tuneStatusFilter !== "all") setTuneStatusFilter(searchPrefill.tuneStatusFilter);
    }
  }, []); // Run once on mount

  // Count active filters
  const activeFiltersCount = [
    brandingFilter, interiorFilter, tuneStatusFilter, makeFilter, modelFilter,
    colorFilter, stateFilter, licenseStateFilter, regionFilter, districtFilter,
    yearFilter, cityFilter
  ].filter(filter => filter !== "all").length;

  const baseVehicles = holmanVehicles;
  const filteredVehicles = baseVehicles.filter(vehicle => {
    const matchesSearch = !searchQuery || 
      vehicle.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (vehicle.deliveryAddress || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBranding = brandingFilter === "all" || vehicle.branding === brandingFilter;
    const matchesInterior = interiorFilter === "all" || vehicle.interior === interiorFilter;
    const matchesTuneStatus = tuneStatusFilter === "all" || vehicle.tuneStatus === tuneStatusFilter;
    const matchesMake = makeFilter === "all" || vehicle.makeName === makeFilter;
    const matchesModel = modelFilter === "all" || vehicle.modelName === modelFilter;
    const matchesColor = colorFilter === "all" || vehicle.color === colorFilter;
    const matchesState = stateFilter === "all" || vehicle.state === stateFilter;
    const matchesLicenseState = licenseStateFilter === "all" || vehicle.licenseState === licenseStateFilter;
    const matchesRegion = regionFilter === "all" || vehicle.region === regionFilter;
    const matchesDistrict = districtFilter === "all" || vehicle.district === districtFilter;
    const matchesYear = yearFilter === "all" || vehicle.modelYear.toString() === yearFilter;
    const matchesCity = cityFilter === "all" || vehicle.city === cityFilter;
    
    return matchesSearch && matchesBranding && matchesInterior && matchesTuneStatus &&
           matchesMake && matchesModel && matchesColor && matchesState && matchesLicenseState &&
           matchesRegion && matchesDistrict && matchesYear && matchesCity;
  });

  const handleVehicleSelect = (vehicle: FleetVehicle) => {
    setSelectedVehicle(vehicle);
    setVehicleUpdateData({
      licensePlate: vehicle.licensePlate,
      color: vehicle.color,
      branding: vehicle.branding,
      interior: vehicle.interior,
      tuneStatus: vehicle.tuneStatus,
      city: vehicle.city,
      state: vehicle.state,
      zip: vehicle.zip,
      region: vehicle.region,
      district: vehicle.district
    });
    setIsUpdateDialogOpen(true);
  };

  const handleUpdateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;

    toast({
      title: "Vehicle Updated",
      description: `${selectedVehicle.modelYear} ${selectedVehicle.makeName} ${selectedVehicle.modelName} (${selectedVehicle.vin}) has been updated successfully`,
    });

    setIsUpdateDialogOpen(false);
    setSelectedVehicle(null);
  };

  return (
    <MainContent>
      <TopBar 
        title="Update Vehicle Information"
        breadcrumbs={["Home", "Update Vehicle Information"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            {/* Search and Filters */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Search Vehicles to Update</span>
                  <div className="flex items-center gap-2">
                    <CopyLinkButton
                      variant="icon"
                      preserveQuery={true}
                      preserveHash={true}
                      data-testid="button-copy-form-link"
                      className="shrink-0"
                    />
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
                                  setDistrictFilter("all");
                                  setYearFilter("all");
                                  setCityFilter("all");
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
                  Select a vehicle to update its information
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
              <div className="flex justify-between items-center flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-semibold">
                    Holman Fleet Vehicles ({isLoadingHolman ? '...' : baseVehicles.length})
                  </h3>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => refetchHolman()}
                    disabled={isLoadingHolman}
                    className="h-8"
                    data-testid="button-refresh-holman"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingHolman ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>
              
              {holmanError && (
                <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Holman API temporarily unavailable</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        The API connection will retry automatically.
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => refetchHolman()}
                    >
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              )}
              
              {isLoadingHolman && holmanVehicles.length === 0 && (
                <div className="grid gap-4">
                  {[1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-40" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-32" />
                          </div>
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-4 w-24" />
                          </div>
                          <div className="space-y-2">
                            <Skeleton className="h-5 w-36" />
                            <Skeleton className="h-4 w-20" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              
              <div className="grid gap-4">
                {filteredVehicles.map((vehicle) => (
                  <Card 
                    key={vehicle.vin} 
                    className="cursor-pointer hover:shadow-md transition-all duration-200"
                    onClick={() => handleVehicleSelect(vehicle)}
                    data-testid={`card-vehicle-${vehicle.vin}`}
                  >
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Car className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">Vehicle #{vehicle.vehicleNumber}</p>
                          <p className="text-sm text-muted-foreground">VIN: {vehicle.vin}</p>
                          
                          {/* Holman Status & Ownership Badges */}
                          <div className="flex items-center gap-2 mt-2">
                            <span 
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getHolmanStatus(vehicle.statusCode).bgColor} ${getHolmanStatus(vehicle.statusCode).color} border ${getHolmanStatus(vehicle.statusCode).borderColor}`}
                              data-testid={`holman-status-${vehicle.vin}`}
                            >
                              {getHolmanStatus(vehicle.statusCode).label}
                            </span>
                            <span 
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getVehicleOwnership(vehicle.vehicleNumber).bgColor} ${getVehicleOwnership(vehicle.vehicleNumber).color} border ${getVehicleOwnership(vehicle.vehicleNumber).borderColor}`}
                              data-testid={`ownership-${vehicle.vin}`}
                            >
                              {getVehicleOwnership(vehicle.vehicleNumber).type === 'BYOV' ? (
                                <><Truck className="h-3 w-3 mr-1" />BYOV</>
                              ) : (
                                <>Fleet</>
                              )}
                            </span>
                          </div>
                          
                          {/* TPMS determines assignment status */}
                          <div className="flex items-center gap-2 mt-1">
                            {vehicle.tpmsAssignedTechId ? (
                              <>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <span className="text-sm font-medium text-green-600" data-testid="status-assigned">Assigned (TPMS)</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="h-4 w-4 text-red-500" />
                                <span className="text-sm font-medium text-red-600" data-testid="status-unassigned">Unassigned</span>
                              </>
                            )}
                          </div>
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
                        
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{vehicle.city}, {vehicle.state} {vehicle.zip}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Region: {vehicle.region}</p>
                          <p className="text-xs text-muted-foreground">District: {vehicle.district}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
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
          </div>
          
          {/* Update Vehicle Dialog */}
          <Dialog open={isUpdateDialogOpen} onOpenChange={setIsUpdateDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Update Vehicle Information</DialogTitle>
                <DialogDescription>
                  Update the selected vehicle's details
                </DialogDescription>
              </DialogHeader>
              
              {selectedVehicle && (
                <form onSubmit={handleUpdateVehicle} className="space-y-4">
                  {/* Vehicle Identification */}
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="font-semibold text-sm mb-1">Selected Vehicle:</p>
                    <p className="text-sm">{selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}</p>
                    <p className="text-xs text-muted-foreground">
                      VIN: {selectedVehicle.vin} | Vehicle #: {selectedVehicle.vehicleNumber}
                    </p>
                  </div>
                  
                  {/* Editable Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="licensePlate">License Plate</Label>
                      <Input
                        id="licensePlate"
                        value={vehicleUpdateData.licensePlate}
                        onChange={(e) => setVehicleUpdateData(prev => ({ ...prev, licensePlate: e.target.value }))}
                        data-testid="input-license-plate"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="color">Color</Label>
                      <Select 
                        value={vehicleUpdateData.color} 
                        onValueChange={(value) => setVehicleUpdateData(prev => ({ ...prev, color: value }))}
                        data-testid="select-color"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterOptions.colors.map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="branding">Branding</Label>
                      <Select 
                        value={vehicleUpdateData.branding} 
                        onValueChange={(value) => setVehicleUpdateData(prev => ({ ...prev, branding: value }))}
                        data-testid="select-branding"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterOptions.brandings.map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="interior">Interior</Label>
                      <Select 
                        value={vehicleUpdateData.interior} 
                        onValueChange={(value) => setVehicleUpdateData(prev => ({ ...prev, interior: value }))}
                        data-testid="select-interior"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterOptions.interiors.map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="tuneStatus">Tune Status</Label>
                      <Select 
                        value={vehicleUpdateData.tuneStatus} 
                        onValueChange={(value) => setVehicleUpdateData(prev => ({ ...prev, tuneStatus: value }))}
                        data-testid="select-tune-status"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterOptions.tuneStatuses.map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={vehicleUpdateData.city}
                        onChange={(e) => setVehicleUpdateData(prev => ({ ...prev, city: e.target.value }))}
                        data-testid="input-city"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Select 
                        value={vehicleUpdateData.state} 
                        onValueChange={(value) => setVehicleUpdateData(prev => ({ ...prev, state: value }))}
                        data-testid="select-state"
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {filterOptions.states.map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="zip">ZIP Code</Label>
                      <Input
                        id="zip"
                        value={vehicleUpdateData.zip}
                        onChange={(e) => setVehicleUpdateData(prev => ({ ...prev, zip: e.target.value }))}
                        data-testid="input-zip"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="region">Region</Label>
                      <Input
                        id="region"
                        value={vehicleUpdateData.region}
                        onChange={(e) => setVehicleUpdateData(prev => ({ ...prev, region: e.target.value }))}
                        data-testid="input-region"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="district">District</Label>
                      <Input
                        id="district"
                        value={vehicleUpdateData.district}
                        onChange={(e) => setVehicleUpdateData(prev => ({ ...prev, district: e.target.value }))}
                        data-testid="input-district"
                      />
                    </div>
                  </div>

                  {/* Employee Information Section */}
                  <div className="border-t pt-6">
                    <h4 className="font-semibold mb-4 text-lg flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Employee Information
                    </h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-firstName">First Name *</Label>
                        <Input
                          id="dialog-firstName"
                          value={employeeData.firstName}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, firstName: e.target.value }))}
                          placeholder="John"
                          data-testid="dialog-input-first-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-lastName">Last Name *</Label>
                        <Input
                          id="dialog-lastName"
                          value={employeeData.lastName}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Doe"
                          data-testid="dialog-input-last-name"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-email">Email *</Label>
                        <Input
                          id="dialog-email"
                          type="email"
                          value={employeeData.email}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="john.doe@company.com"
                          data-testid="dialog-input-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-phone">Phone</Label>
                        <Input
                          id="dialog-phone"
                          value={employeeData.phone}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, phone: e.target.value }))}
                          placeholder="(555) 123-4567"
                          data-testid="dialog-input-phone"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-department">Department *</Label>
                        <Select 
                          value={employeeData.department} 
                          onValueChange={(value) => setEmployeeData(prev => ({ ...prev, department: value }))}
                          data-testid="dialog-select-department"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                          <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept} value={dept} data-testid={`dialog-option-${dept.toLowerCase().replace(/\s+/g, '-')}`}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-position">Position *</Label>
                        <Input
                          id="dialog-position"
                          value={employeeData.position}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, position: e.target.value }))}
                          placeholder="e.g., Service Employee"
                          data-testid="dialog-input-position"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-manager">Manager *</Label>
                        <Input
                          id="dialog-manager"
                          value={employeeData.manager}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, manager: e.target.value }))}
                          placeholder="Enter manager name"
                          data-testid="dialog-input-manager"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-emp-region">Employee Region *</Label>
                        <Select 
                          value={employeeData.region} 
                          onValueChange={(value) => setEmployeeData(prev => ({ ...prev, region: value }))}
                          data-testid="dialog-select-emp-region"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select employee region" />
                          </SelectTrigger>
                          <SelectContent>
                            {regions.map(region => (
                              <SelectItem key={region} value={region} data-testid={`dialog-option-${region.toLowerCase().replace(/\s+/g, '-')}`}>
                                {region}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-emp-district">Employee District *</Label>
                        <Input
                          id="dialog-emp-district"
                          value={employeeData.district}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, district: e.target.value }))}
                          placeholder="e.g., District 25"
                          data-testid="dialog-input-emp-district"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-requisitionId">Requisition ID *</Label>
                        <Input
                          id="dialog-requisitionId"
                          value={employeeData.requisitionId}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, requisitionId: e.target.value }))}
                          placeholder="REQ-2024-001"
                          data-testid="dialog-input-requisition-id"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-enterpriseId">Enterprise ID *</Label>
                        <Input
                          id="dialog-enterpriseId"
                          value={employeeData.enterpriseId}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, enterpriseId: e.target.value }))}
                          placeholder="ENT1234"
                          data-testid="dialog-input-enterprise-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-techId">Employee ID</Label>
                        <Input
                          id="dialog-techId"
                          value={employeeData.techId}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, techId: e.target.value }))}
                          placeholder="EMP-001"
                          data-testid="dialog-input-tech-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-proposedRouteStartDate">Proposed Route Start Date</Label>
                        <Input
                          id="dialog-proposedRouteStartDate"
                          type="date"
                          value={employeeData.proposedRouteStartDate}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, proposedRouteStartDate: e.target.value }))}
                          data-testid="dialog-input-proposed-route-start-date"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 mb-4">
                      <div className="space-y-2">
                        <Label>Specialties *</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {specialtyOptions.map(specialty => (
                            <div key={specialty} className="flex items-center space-x-2">
                              <Checkbox 
                                id={`dialog-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                                checked={employeeData.specialties.includes(specialty)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setEmployeeData(prev => ({ 
                                      ...prev, 
                                      specialties: [...prev.specialties, specialty]
                                    }));
                                  } else {
                                    setEmployeeData(prev => ({ 
                                      ...prev, 
                                      specialties: prev.specialties.filter(s => s !== specialty)
                                    }));
                                  }
                                }}
                                data-testid={`dialog-checkbox-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                              />
                              <Label 
                                htmlFor={`dialog-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                {specialty}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="dialog-emergencyContact">Emergency Contact</Label>
                        <Input
                          id="dialog-emergencyContact"
                          value={employeeData.emergencyContact}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyContact: e.target.value }))}
                          placeholder="Jane Doe"
                          data-testid="dialog-input-emergency-contact"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-emergencyPhone">Emergency Phone</Label>
                        <Input
                          id="dialog-emergencyPhone"
                          value={employeeData.emergencyPhone}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, emergencyPhone: e.target.value }))}
                          placeholder="(555) 987-6543"
                          data-testid="dialog-input-emergency-phone"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="flex-1" 
                      onClick={() => setIsUpdateDialogOpen(false)}
                      data-testid="button-cancel-update"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      onClick={handleSyncToHolman}
                      disabled={syncToHolmanMutation.isPending}
                      data-testid="button-sync-to-holman"
                    >
                      {syncToHolmanMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Syncing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Sync to Holman
                        </>
                      )}
                    </Button>
                    <Button 
                      type="submit" 
                      className="flex-1"
                      data-testid="button-update-vehicle"
                    >
                      Update Vehicle & Employee
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </MainContent>
  );
}