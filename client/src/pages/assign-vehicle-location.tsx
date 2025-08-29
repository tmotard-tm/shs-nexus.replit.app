import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Car, Search, Calendar, MapPin, Settings } from "lucide-react";
import licensePlateIcon from "@assets/generated_images/Generic_license_plate_icon_8524bf34.png";
import { BackButton } from "@/components/ui/back-button";
import { getAvailableVehicles, getBrandingOptions, getInteriorOptions, getTuneStatusOptions, getUnassignedVehicles, type FleetVehicle } from "@/data/fleetData";

export default function AssignVehicleLocation() {
  const { toast } = useToast();
  const [vehicleAssignment, setVehicleAssignment] = useState({
    employeeId: "",
    vehicleId: "",
    startDate: "",
    endDate: "",
    purpose: ""
  });
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [interiorFilter, setInteriorFilter] = useState("all");
  const [targetZipcode, setTargetZipcode] = useState("");
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);

  // Real data from CSV
  const employees = [
    { id: "1", name: "John Doe", department: "Sales", region: "Northeast" },
    { id: "2", name: "Jane Smith", department: "Marketing", region: "Southeast" },
    { id: "3", name: "Mike Johnson", department: "Operations", region: "Midwest" },
    { id: "4", name: "Sarah Williams", department: "Service", region: "West Coast" },
    { id: "5", name: "David Brown", department: "Field Service", region: "Southwest" }
  ];

  // Simple distance calculation based on zip code numerical difference
  // This is a basic approximation - can be enhanced with proper geocoding later
  const calculateZipDistance = (zip1: string, zip2: string): number => {
    if (!zip1 || !zip2) return 9999;
    const num1 = parseInt(zip1.replace(/\D/g, ''), 10);
    const num2 = parseInt(zip2.replace(/\D/g, ''), 10);
    if (isNaN(num1) || isNaN(num2)) return 9999;
    return Math.abs(num1 - num2);
  };

  const availableVehicles = getAvailableVehicles();
  let filteredVehicles = availableVehicles.filter(vehicle => {
    const matchesSearch = !searchQuery || 
      vehicle.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBranding = brandingFilter === "all" || vehicle.branding === brandingFilter;
    const matchesInterior = interiorFilter === "all" || vehicle.interior === interiorFilter;
    
    return matchesSearch && matchesBranding && matchesInterior;
  });

  // Sort by distance to target zipcode if provided
  if (targetZipcode.trim()) {
    filteredVehicles = filteredVehicles
      .map(vehicle => ({
        ...vehicle,
        distanceScore: calculateZipDistance(vehicle.zip, targetZipcode.trim())
      }))
      .sort((a, b) => a.distanceScore - b.distanceScore);
  }


  const handleVehicleAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    const employee = employees.find(emp => emp.id === vehicleAssignment.employeeId);
    const vehicle = availableVehicles.find(veh => veh.vin === vehicleAssignment.vehicleId);
    
    if (!employee || !vehicle) {
      toast({
        title: "Error",
        description: "Please select both an employee and a vehicle",
        variant: "destructive"
      });
      return;
    }
    
    toast({
      title: "Vehicle Assigned",
      description: `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (${vehicle.licensePlate}) has been assigned to ${employee.name}`,
    });
    
    setVehicleAssignment({
      employeeId: "",
      vehicleId: "",
      startDate: "",
      endDate: "",
      purpose: ""
    });
    setSelectedVehicle(null);
    setIsAssignmentDialogOpen(false);
  };

  const handleVehicleSelect = (vehicleVin: string) => {
    const vehicle = availableVehicles.find(v => v.vin === vehicleVin);
    setSelectedVehicle(vehicle || null);
    setVehicleAssignment(prev => ({ ...prev, vehicleId: vehicleVin }));
    setIsAssignmentDialogOpen(true);
  };


  return (
    <MainContent>
      <TopBar 
        title="Assign Vehicle" 
        breadcrumbs={["Home", "Assign Vehicle"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            {/* Vehicle Search and Filters */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Search Available Vehicles</CardTitle>
                  <CardDescription>
                    Search by VIN, vehicle number, license plate, or make/model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                      <Input
                        placeholder="Search vehicles..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                        data-testid="input-search-vehicles"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sort By Distance To Zipcode</Label>
                      <Input
                        placeholder="Enter zipcode (e.g. 10001)"
                        value={targetZipcode}
                        onChange={(e) => setTargetZipcode(e.target.value)}
                        data-testid="input-target-zipcode"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Branding</Label>
                      <Select value={brandingFilter} onValueChange={setBrandingFilter} data-testid="select-branding-filter">
                        <SelectTrigger>
                          <SelectValue placeholder="All branding" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All branding</SelectItem>
                          {getBrandingOptions().map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Interior</Label>
                      <Select value={interiorFilter} onValueChange={setInteriorFilter} data-testid="select-interior-filter">
                        <SelectTrigger>
                          <SelectValue placeholder="All interiors" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All interiors</SelectItem>
                          {getInteriorOptions().map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Status Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Vehicle Assignment Overview</CardTitle>
                  <CardDescription>
                    Current fleet assignment status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                      <p className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-assigned-vehicles-count">{getAvailableVehicles().length}</p>
                      <p className="text-sm text-green-700 dark:text-green-300">Assigned Vehicles</p>
                      <p className="text-xs text-muted-foreground mt-1">Currently in use</p>
                    </div>
                    <div className="text-center p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                      <p className="text-3xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-unassigned-vehicles-count">{getUnassignedVehicles().length}</p>
                      <p className="text-sm text-orange-700 dark:text-orange-300">Unassigned Vehicles</p>
                      <p className="text-xs text-muted-foreground mt-1">Available for assignment</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle List */}
              <div className="grid gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">
                    Available Vehicles ({filteredVehicles.length})
                    {targetZipcode.trim() && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        - Sorted by distance to {targetZipcode}
                      </span>
                    )}
                  </h3>
                </div>
                
                <div className="grid gap-4">
                  {filteredVehicles.map((vehicle) => (
                    <Card 
                      key={vehicle.vin}
                      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${selectedVehicle?.vin === vehicle.vin ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => handleVehicleSelect(vehicle.vin)}
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
                            {targetZipcode.trim() && 'distanceScore' in vehicle && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                                  Distance Score: {(vehicle as any).distanceScore}
                                </span>
                              </div>
                            )}
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
                        
                        {vehicle.odometerDelivery > 0 && (
                          <div className="mt-2 pt-2 border-t">
                            <p className="text-xs text-muted-foreground">
                              Odometer: {vehicle.odometerDelivery.toLocaleString()} miles
                            </p>
                          </div>
                        )}
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
          
          {/* Assignment Dialog */}
          <Dialog open={isAssignmentDialogOpen} onOpenChange={setIsAssignmentDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Complete the Assignment Details</DialogTitle>
                <DialogDescription>
                  Assign the selected vehicle to an employee
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => {
                handleVehicleAssignment(e);
              }} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="dialog-employeeId">Employee *</Label>
                  <Select 
                    value={vehicleAssignment.employeeId} 
                    onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, employeeId: value }))}
                    data-testid="dialog-select-employee"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(employee => (
                        <SelectItem key={employee.id} value={employee.id} data-testid={`dialog-option-employee-${employee.id}`}>
                          {employee.name}
                          <span className="text-muted-foreground ml-2">({employee.department} - {employee.region})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedVehicle && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="font-semibold text-sm mb-1">Selected Vehicle:</p>
                    <p className="text-sm">{selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedVehicle.licensePlate} | VIN: {selectedVehicle.vin}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="dialog-startDate">Start Date *</Label>
                  <Input
                    id="dialog-startDate"
                    type="date"
                    value={vehicleAssignment.startDate}
                    onChange={(e) => setVehicleAssignment(prev => ({ ...prev, startDate: e.target.value }))}
                    data-testid="dialog-input-start-date"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="dialog-endDate">End Date</Label>
                  <Input
                    id="dialog-endDate"
                    type="date"
                    value={vehicleAssignment.endDate}
                    onChange={(e) => setVehicleAssignment(prev => ({ ...prev, endDate: e.target.value }))}
                    data-testid="dialog-input-end-date"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dialog-purpose">Purpose</Label>
                  <Select 
                    value={vehicleAssignment.purpose} 
                    onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, purpose: value }))}
                    data-testid="dialog-select-purpose"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="field_service" data-testid="dialog-option-field-service">Field Service</SelectItem>
                      <SelectItem value="delivery" data-testid="dialog-option-delivery">Acquisition/Transport</SelectItem>
                      <SelectItem value="maintenance" data-testid="dialog-option-maintenance">Maintenance Work</SelectItem>
                      <SelectItem value="business_travel" data-testid="dialog-option-business-travel">Business Travel</SelectItem>
                      <SelectItem value="daily_operations" data-testid="dialog-option-daily-operations">Daily Operations</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="flex-1" 
                    onClick={() => setIsAssignmentDialogOpen(false)}
                    data-testid="dialog-button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1" 
                    disabled={!vehicleAssignment.employeeId || !vehicleAssignment.vehicleId || !vehicleAssignment.startDate}
                    data-testid="dialog-button-assign-vehicle"
                  >
                    Assign Vehicle
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </MainContent>
  );
}