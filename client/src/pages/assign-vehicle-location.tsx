import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Car, Search } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

export default function AssignVehicleLocation() {
  const { toast } = useToast();
  const [vehicleAssignment, setVehicleAssignment] = useState({
    employeeId: "",
    vehicleId: "",
    startDate: "",
    endDate: "",
    purpose: ""
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


  return (
    <MainContent>
      <TopBar 
        title="Assign Vehicle" 
        breadcrumbs={["Home", "Assign Vehicle"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="w-full">

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
          </div>
        </div>
      </main>
    </MainContent>
  );
}