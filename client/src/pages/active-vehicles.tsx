import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Car, Search, MapPin, Calendar, Filter, ChevronDown, ChevronUp, X } from "lucide-react";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { 
  getAvailableVehicles, 
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

export default function ActiveVehicles() {
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
  
  // Count active filters
  const activeFiltersCount = [
    brandingFilter, interiorFilter, tuneStatusFilter, makeFilter, modelFilter,
    colorFilter, stateFilter, licenseStateFilter, regionFilter, districtFilter,
    yearFilter, cityFilter
  ].filter(filter => filter !== "all").length;

  const availableVehicles = getAvailableVehicles();
  const filteredVehicles = availableVehicles.filter(vehicle => {
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

  return (
    <MainContent>
      <TopBar 
        title="Active Vehicles" 
        breadcrumbs={["Home", "Active Vehicles"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            {/* Search and Filters */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Search Active Vehicles</span>
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
                                  {getBrandingOptions().map(option => (
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
                                  {getInteriorOptions().map(option => (
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
                                  {getTuneStatusOptions().map(option => (
                                    <SelectItem key={option} value={option}>{option}</SelectItem>
                                  ))}
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
                                  {getStateOptions().map(option => (
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
                                  {getCityOptions().map(option => (
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
                                  {getLicenseStateOptions().map(option => (
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
                                  {getRegionOptions().map(option => (
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
                                  {getDistrictOptions().map(option => (
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
                <h3 className="text-lg font-semibold">Active Vehicles ({filteredVehicles.length})</h3>
              </div>
              
              <div className="grid gap-4">
                {filteredVehicles.map((vehicle) => (
                  <Card key={vehicle.vin} data-testid={`card-vehicle-${vehicle.vin}`}>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                            <img src={licensePlateIcon} alt="License plate" className="h-4 w-5 object-contain" />
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
                      
                      <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
                        {vehicle.deliveryDate && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            <span>Acquired: {vehicle.deliveryDate}</span>
                          </div>
                        )}
                        {vehicle.odometerDelivery > 0 && (
                          <div>
                            <span>Odometer: {vehicle.odometerDelivery.toLocaleString()} miles</span>
                          </div>
                        )}
                        {vehicle.remainingBookValue > 0 && (
                          <div>
                            <span>Book Value: ${vehicle.remainingBookValue.toLocaleString()}</span>
                          </div>
                        )}
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
        </div>
      </main>
    </MainContent>
  );
}