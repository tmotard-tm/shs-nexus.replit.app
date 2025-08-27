import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Car, MapPin, ArrowLeft, Search } from "lucide-react";
import { Link } from "wouter";

export default function AssignVehicleLocation() {
  const { toast } = useToast();
  const [vehicleAssignment, setVehicleAssignment] = useState({
    employeeId: "",
    vehicleId: "",
    startDate: "",
    endDate: "",
    purpose: ""
  });

  const [locationAssignment, setLocationAssignment] = useState({
    employeeId: "",
    locationId: "",
    role: "",
    startDate: "",
    accessLevel: ""
  });

  // Mock data
  const employees = [
    { id: "1", name: "John Doe", department: "Sales" },
    { id: "2", name: "Jane Smith", department: "Marketing" },
    { id: "3", name: "Mike Johnson", department: "Operations" }
  ];

  const vehicles = [
    { id: "1", name: "Toyota Camry (ABC-1234)", status: "available" },
    { id: "2", name: "Honda Civic (XYZ-5678)", status: "available" },
    { id: "3", name: "Ford F-150 (DEF-9012)", status: "assigned" }
  ];

  const locations = [
    { id: "1", name: "Downtown Office", type: "office" },
    { id: "2", name: "Warehouse District", type: "warehouse" },
    { id: "3", name: "Retail Store #1", type: "retail" }
  ];

  const handleVehicleAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    const employee = employees.find(emp => emp.id === vehicleAssignment.employeeId);
    const vehicle = vehicles.find(veh => veh.id === vehicleAssignment.vehicleId);
    
    toast({
      title: "Vehicle Assigned",
      description: `${vehicle?.name} has been assigned to ${employee?.name}`,
    });
    
    setVehicleAssignment({
      employeeId: "",
      vehicleId: "",
      startDate: "",
      endDate: "",
      purpose: ""
    });
  };

  const handleLocationAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    const employee = employees.find(emp => emp.id === locationAssignment.employeeId);
    const location = locations.find(loc => loc.id === locationAssignment.locationId);
    
    toast({
      title: "Location Assigned",
      description: `${employee?.name} has been assigned to ${location?.name}`,
    });
    
    setLocationAssignment({
      employeeId: "",
      locationId: "",
      role: "",
      startDate: "",
      accessLevel: ""
    });
  };

  return (
    <div className="flex-1">
      <TopBar 
        title="Assign Vehicle/Location" 
        breadcrumbs={["Home", "Assign"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <Link href="/">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Selection
              </Button>
            </Link>
          </div>

          <Tabs defaultValue="vehicle" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="vehicle" data-testid="tab-assign-vehicle">
                <Car className="h-4 w-4 mr-2" />
                Assign Vehicle
              </TabsTrigger>
              <TabsTrigger value="location" data-testid="tab-assign-location">
                <MapPin className="h-4 w-4 mr-2" />
                Assign Location
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vehicle">
              <Card>
                <CardHeader>
                  <CardTitle data-testid="text-assign-vehicle-title">Assign Vehicle to Employee</CardTitle>
                  <CardDescription>
                    Select an employee and vehicle to create an assignment
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVehicleAssignment} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                {employee.name} ({employee.department})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vehicleId">Vehicle *</Label>
                        <Select 
                          value={vehicleAssignment.vehicleId} 
                          onValueChange={(value) => setVehicleAssignment(prev => ({ ...prev, vehicleId: value }))}
                          data-testid="select-vehicle"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select vehicle" />
                          </SelectTrigger>
                          <SelectContent>
                            {vehicles.filter(v => v.status === "available").map(vehicle => (
                              <SelectItem key={vehicle.id} value={vehicle.id} data-testid={`option-vehicle-${vehicle.id}`}>
                                {vehicle.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                          <SelectItem value="business" data-testid="option-business">Business Use</SelectItem>
                          <SelectItem value="commute" data-testid="option-commute">Daily Commute</SelectItem>
                          <SelectItem value="delivery" data-testid="option-delivery">Delivery/Transport</SelectItem>
                          <SelectItem value="travel" data-testid="option-travel">Business Travel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button type="submit" className="w-full" data-testid="button-assign-vehicle">
                      Assign Vehicle
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="location">
              <Card>
                <CardHeader>
                  <CardTitle data-testid="text-assign-location-title">Assign Location to Employee</CardTitle>
                  <CardDescription>
                    Assign an employee to a specific location with role and access permissions
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLocationAssignment} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employeeLocationId">Employee *</Label>
                        <Select 
                          value={locationAssignment.employeeId} 
                          onValueChange={(value) => setLocationAssignment(prev => ({ ...prev, employeeId: value }))}
                          data-testid="select-location-employee"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select employee" />
                          </SelectTrigger>
                          <SelectContent>
                            {employees.map(employee => (
                              <SelectItem key={employee.id} value={employee.id} data-testid={`option-location-employee-${employee.id}`}>
                                {employee.name} ({employee.department})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="locationId">Location *</Label>
                        <Select 
                          value={locationAssignment.locationId} 
                          onValueChange={(value) => setLocationAssignment(prev => ({ ...prev, locationId: value }))}
                          data-testid="select-location"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map(location => (
                              <SelectItem key={location.id} value={location.id} data-testid={`option-location-${location.id}`}>
                                {location.name} ({location.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="role">Role *</Label>
                        <Select 
                          value={locationAssignment.role} 
                          onValueChange={(value) => setLocationAssignment(prev => ({ ...prev, role: value }))}
                          data-testid="select-role"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manager" data-testid="option-manager">Manager</SelectItem>
                            <SelectItem value="employee" data-testid="option-employee">Employee</SelectItem>
                            <SelectItem value="contractor" data-testid="option-contractor">Contractor</SelectItem>
                            <SelectItem value="visitor" data-testid="option-visitor">Visitor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="accessLevel">Access Level *</Label>
                        <Select 
                          value={locationAssignment.accessLevel} 
                          onValueChange={(value) => setLocationAssignment(prev => ({ ...prev, accessLevel: value }))}
                          data-testid="select-access-level"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select access level" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="full" data-testid="option-full">Full Access</SelectItem>
                            <SelectItem value="limited" data-testid="option-limited">Limited Access</SelectItem>
                            <SelectItem value="restricted" data-testid="option-restricted">Restricted</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="locationStartDate">Start Date *</Label>
                      <Input
                        id="locationStartDate"
                        type="date"
                        value={locationAssignment.startDate}
                        onChange={(e) => setLocationAssignment(prev => ({ ...prev, startDate: e.target.value }))}
                        data-testid="input-location-start-date"
                      />
                    </div>

                    <Button type="submit" className="w-full" data-testid="button-assign-location">
                      Assign Location
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}