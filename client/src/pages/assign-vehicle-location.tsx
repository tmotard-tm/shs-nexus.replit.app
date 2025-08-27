import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Car, Search, Calendar, MapPin, Settings, Tag } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { getAvailableVehicles, getBrandingOptions, getInteriorOptions, getTuneStatusOptions, type FleetVehicle } from "@/data/fleetData";

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
  const [brandingFilter, setBrandingFilter] = useState("");
  const [interiorFilter, setInteriorFilter] = useState("");

  // Real data from CSV
  const employees = [
    { id: "1", name: "John Doe", department: "Sales", region: "Northeast" },
    { id: "2", name: "Jane Smith", department: "Marketing", region: "Southeast" },
    { id: "3", name: "Mike Johnson", department: "Operations", region: "Midwest" },
    { id: "4", name: "Sarah Williams", department: "Service", region: "West Coast" },
    { id: "5", name: "David Brown", department: "Field Service", region: "Southwest" }
  ];

  const availableVehicles = getAvailableVehicles();
  const filteredVehicles = availableVehicles.filter(vehicle => {
    const matchesSearch = !searchQuery || 
      vehicle.vin.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.vehicleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}`.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesBranding = !brandingFilter || vehicle.branding === brandingFilter;
    const matchesInterior = !interiorFilter || vehicle.interior === interiorFilter;
    
    return matchesSearch && matchesBranding && matchesInterior;
  });


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
  };

  const handleVehicleSelect = (vehicleVin: string) => {
    const vehicle = availableVehicles.find(v => v.vin === vehicleVin);
    setSelectedVehicle(vehicle || null);
    setVehicleAssignment(prev => ({ ...prev, vehicleId: vehicleVin }));
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Vehicle Search and Filters */}
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Search Available Vehicles</CardTitle>
                  <CardDescription>
                    Search by VIN, vehicle number, license plate, or make/model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Branding</Label>
                      <Select value={brandingFilter} onValueChange={setBrandingFilter} data-testid="select-branding-filter">
                        <SelectTrigger>
                          <SelectValue placeholder="All branding" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All branding</SelectItem>
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
                          <SelectItem value="">All interiors</SelectItem>
                          {getInteriorOptions().map(option => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle List */}
              <div className="grid gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Available Vehicles ({filteredVehicles.length})</h3>
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
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Tag className="h-4 w-4 text-muted-foreground" />
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
                              <span className="text-sm">{vehicle.city}, {vehicle.state}</span>
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

            {/* Assignment Form */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle data-testid="text-assign-vehicle-title">Assign Vehicle</CardTitle>
                  <CardDescription>
                    Complete the assignment details
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVehicleAssignment} className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="employeeId">Employee *</Label>
                      <Select 
                        value={vehicleAssignment.employeeId} 
                        onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, employeeId: value }))}
                        data-testid="select-employee"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map(employee => (
                            <SelectItem key={employee.id} value={employee.id} data-testid={`option-employee-${employee.id}`}>
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
                      <Label htmlFor="startDate">Start Date *</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={vehicleAssignment.startDate}
                        onChange={(e) => setVehicleAssignment(prev => ({ ...prev, startDate: e.target.value }))}
                        data-testid="input-start-date"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="endDate">End Date</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={vehicleAssignment.endDate}
                        onChange={(e) => setVehicleAssignment(prev => ({ ...prev, endDate: e.target.value }))}
                        data-testid="input-end-date"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="purpose">Purpose</Label>
                      <Select 
                        value={vehicleAssignment.purpose} 
                        onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, purpose: value }))}
                        data-testid="select-purpose"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select purpose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="field_service" data-testid="option-field-service">Field Service</SelectItem>
                          <SelectItem value="delivery" data-testid="option-delivery">Delivery/Transport</SelectItem>
                          <SelectItem value="maintenance" data-testid="option-maintenance">Maintenance Work</SelectItem>
                          <SelectItem value="business_travel" data-testid="option-business-travel">Business Travel</SelectItem>
                          <SelectItem value="daily_operations" data-testid="option-daily-operations">Daily Operations</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={!vehicleAssignment.employeeId || !vehicleAssignment.vehicleId || !vehicleAssignment.startDate}
                      data-testid="button-assign-vehicle"
                    >
                      Assign Vehicle
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </MainContent>
  );
}