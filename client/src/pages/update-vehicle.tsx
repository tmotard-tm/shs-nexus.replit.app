import { useState, useEffect } from "react";
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
import { Car, Search, MapPin, Calendar, Filter, ChevronDown, ChevronUp, X, CheckCircle, XCircle, User } from "lucide-react";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { useToast } from "@/hooks/use-toast";
import { 
  activeVehicles,
  getBrandingOptions, 
  getInteriorOptions, 
  getTuneStatusOptions,
  getMakeOptions,
  getModelOptions,
  getColorOptions,
  getStateOptions,
  getLicenseStateOptions,
  getRegionOptions,
  getDistrictOptions,
  getYearOptions,
  getCityOptions,
  type FleetVehicle 
} from "@/data/fleetData";

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
  
  // Count active filters
  const activeFiltersCount = [
    brandingFilter, interiorFilter, tuneStatusFilter, makeFilter, modelFilter,
    colorFilter, stateFilter, licenseStateFilter, regionFilter, districtFilter,
    yearFilter, cityFilter
  ].filter(filter => filter !== "all").length;

  const baseVehicles = activeVehicles;
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
                                  {getMakeOptions().map(option => (
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
                                  {getModelOptions().map(option => (
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
                                  {getYearOptions().map(option => (
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
                                  {getColorOptions().map(option => (
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
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">All Vehicles ({baseVehicles.length})</h3>
              </div>
              
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
                          <div className="flex items-center gap-2 mt-2">
                            {!vehicle.outOfServiceDate ? (
                              <>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <span className="text-sm font-medium text-green-600" data-testid="status-assigned">Assigned</span>
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
                          {getColorOptions().map(option => (
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
                          {getBrandingOptions().map(option => (
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
                          {getInteriorOptions().map(option => (
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
                          {getTuneStatusOptions().map(option => (
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
                          {getStateOptions().map(option => (
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
                          placeholder="e.g., Technician"
                          data-testid="dialog-input-position"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dialog-manager">Manager *</Label>
                        <Select 
                          value={employeeData.manager} 
                          onValueChange={(value) => setEmployeeData(prev => ({ ...prev, manager: value }))}
                          data-testid="dialog-select-manager"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select manager" />
                          </SelectTrigger>
                          <SelectContent>
                            {managers.map(manager => (
                              <SelectItem key={manager.id} value={manager.id} data-testid={`dialog-option-manager-${manager.id}`}>
                                {manager.name} ({manager.department})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        <Label htmlFor="dialog-techId">Tech ID</Label>
                        <Input
                          id="dialog-techId"
                          value={employeeData.techId}
                          onChange={(e) => setEmployeeData(prev => ({ ...prev, techId: e.target.value }))}
                          placeholder="TECH-001"
                          data-testid="dialog-input-tech-id"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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