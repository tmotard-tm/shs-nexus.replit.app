import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Car, MapPin, AlertTriangle, Trash2, Archive } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

export default function OffboardVehicleLocation() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [vehicleOffboard, setVehicleOffboard] = useState({
    vehicleId: "",
    techRacfId: "",
    techName: "",
    lastDayWorked: "",
    vehicleNumber: "",
    vehicleLocation: "",
    reason: "",
    effectiveDate: "",
    notes: "",
    returnCondition: ""
  });

  const [locationOffboard, setLocationOffboard] = useState({
    locationId: "",
    reason: "",
    effectiveDate: "",
    notes: "",
    equipmentDisposal: ""
  });

  // Mock data
  const vehicles = [
    { id: "1", name: "Toyota Camry (ABC-1234)", status: "assigned", assignedTo: "John Doe" },
    { id: "2", name: "Honda Civic (XYZ-5678)", status: "maintenance", assignedTo: null },
    { id: "3", name: "Ford F-150 (DEF-9012)", status: "available", assignedTo: null },
    { id: "4", name: "BMW X5 (GHI-3456)", status: "assigned", assignedTo: "Jane Smith" }
  ];

  const locations = [
    { id: "1", name: "Downtown Office", type: "office", status: "active", employees: 15 },
    { id: "2", name: "Warehouse District", type: "warehouse", status: "active", employees: 8 },
    { id: "3", name: "Old Retail Store", type: "retail", status: "closing", employees: 3 },
    { id: "4", name: "Remote Office #2", type: "office", status: "active", employees: 5 }
  ];

  const offboardReasons = [
    "Involuntary Termination",
    "Voluntary Termination",
    "End of lease",
    "Vehicle sold",
    "Damaged beyond repair",
    "High maintenance costs",
    "Employee terminated",
    "Employee resigned",
    "Employee retired",
    "Employee transferred",
    "Employee on leave",
    "Location closure",
    "Lease expiration",
    "Downsizing",
    "Relocation",
    "Other"
  ];

  const handleVehicleOffboard = async (e: React.FormEvent) => {
    e.preventDefault();
    const vehicle = vehicles.find(veh => veh.id === vehicleOffboard.vehicleId);
    
    // Departments that need separate tasks
    const departmentTasks = [
      { dept: 'NTAO', priority: 'high' },
      { dept: 'Assets Management', priority: 'high' },
      { dept: 'Inventory Control', priority: 'medium' },
      { dept: 'Fleet Management', priority: 'high' }
    ];
    
    const tasksCreated: string[] = [];
    
    try {
      // Create separate queue tasks for each department
      for (const { dept, priority } of departmentTasks) {
        // Route to correct department-specific queue
        let queueEndpoint = "/api/queue"; // fallback
        switch (dept) {
          case "NTAO":
            queueEndpoint = "/api/ntao-queue";
            break;
          case "Assets Management":
            queueEndpoint = "/api/assets-queue";
            break;
          case "Inventory Control":
            queueEndpoint = "/api/inventory-queue";
            break;
          case "Fleet Management":
            queueEndpoint = "/api/fleet-queue";
            break;
        }
        
        const deptQueueItem = await apiRequest("POST", queueEndpoint, {
          workflowType: "department_notification",
          title: `${dept} - Vehicle Offboarding Notification (Auto-triggered)`,
          description: `Notification for ${dept} regarding vehicle offboarding. Employee: ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). Vehicle: ${vehicleOffboard.vehicleNumber}. Last day: ${vehicleOffboard.lastDayWorked}. Reason: ${vehicleOffboard.reason}`,
          priority: priority,
          requesterId: user?.id || "system",
          data: JSON.stringify({
            submitter: {
              name: user?.username || user?.email || "Unknown User",
              submittedAt: new Date().toISOString()
            },
            department: dept,
            notificationType: "Vehicle Offboarding",
            employee: {
              name: vehicleOffboard.techName,
              racfId: vehicleOffboard.techRacfId,
              lastDayWorked: vehicleOffboard.lastDayWorked,
              enterpriseId: vehicleOffboard.techRacfId
            },
            vehicle: {
              vehicleNumber: vehicleOffboard.vehicleNumber,
              vehicleName: vehicle?.name || vehicleOffboard.vehicleNumber,
              reason: vehicleOffboard.reason
            },
            autoTriggered: true,
            triggeredBy: "vehicle_offboarding"
          })
        });
        tasksCreated.push(dept);
      }
      
      // Create main queue item for offboarding process (goes to general queue management)
      await apiRequest("POST", "/api/queue", {
        workflowType: "offboarding",
        title: `Offboard Employee - ${vehicleOffboard.techName}`,
        description: `Process offboarding for ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). Vehicle: ${vehicleOffboard.vehicleNumber}. Last day: ${vehicleOffboard.lastDayWorked}. Reason: ${vehicleOffboard.reason}. ${tasksCreated.length} department notifications created.`,
        priority: "high",
        requesterId: user?.id || "system",
        data: JSON.stringify({
          submitter: {
            name: user?.username || user?.email || "Unknown User",
            submittedAt: new Date().toISOString()
          },
          employee: {
            name: vehicleOffboard.techName,
            racfId: vehicleOffboard.techRacfId,
            lastDayWorked: vehicleOffboard.lastDayWorked,
            enterpriseId: vehicleOffboard.techRacfId,
            departments: ["Field Services", "NTAO", "Fleet Management"]
          },
          vehicle: {
            vehicleNumber: vehicleOffboard.vehicleNumber,
            reason: vehicleOffboard.reason
          },
          notifications: {
            departments: tasksCreated,
            timestamp: new Date().toISOString()
          },
          offboardingDate: new Date().toISOString()
        })
      });
    } catch (queueError) {
      console.error('Error creating queue items:', queueError);
    }

    toast({
      title: "Vehicle Offboarded Successfully",
      description: `${vehicle?.name} removed from fleet. ${tasksCreated.length} department tasks created: ${tasksCreated.join(', ')}`,
    });
    
    // Show secondary notification confirmation
    setTimeout(() => {
      toast({
        title: "Department Tasks Created",
        description: `✅ ${tasksCreated.join(', ')} teams have been assigned tasks for ${vehicleOffboard.techName}'s offboarding`,
        variant: "default"
      });
    }, 2000);
    
    setVehicleOffboard({
      vehicleId: "",
      techRacfId: "",
      techName: "",
      lastDayWorked: "",
      vehicleNumber: "",
      vehicleLocation: "",
      reason: "",
      effectiveDate: "",
      notes: "",
      returnCondition: ""
    });
  };

  const handleLocationOffboard = (e: React.FormEvent) => {
    e.preventDefault();
    const location = locations.find(loc => loc.id === locationOffboard.locationId);
    
    toast({
      title: "Location Offboarded",
      description: `${location?.name} has been deactivated`,
    });
    
    setLocationOffboard({
      locationId: "",
      reason: "",
      effectiveDate: "",
      notes: "",
      equipmentDisposal: ""
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "assigned": return "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]";
      case "available": return "bg-[hsl(var(--chart-1))]/10 text-[hsl(var(--chart-1))]";
      case "maintenance": return "bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]";
      case "active": return "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]";
      case "closing": return "bg-destructive/10 text-destructive";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="flex-1">
      <TopBar 
        title="Offboard Vehicle/Location" 
        breadcrumbs={["Home", "Offboard"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <Tabs defaultValue="vehicle" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="vehicle" data-testid="tab-offboard-vehicle">
                <Car className="h-4 w-4 mr-2" />
                Offboard Vehicle
              </TabsTrigger>
              <TabsTrigger value="location" data-testid="tab-offboard-location">
                <MapPin className="h-4 w-4 mr-2" />
                Offboard Location
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vehicle">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2" data-testid="text-vehicle-offboard-title">
                        <Trash2 className="h-5 w-5" />
                        Remove Vehicle from Fleet
                      </CardTitle>
                      <CardDescription>
                        Process vehicle removal and document the reason
                      </CardDescription>
                      <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <p className="font-medium text-yellow-800 dark:text-yellow-200">Automatic Notifications</p>
                            <p className="text-yellow-700 dark:text-yellow-300">Upon submission, the following departments will be automatically notified:</p>
                            <ul className="mt-1 text-yellow-600 dark:text-yellow-400 list-disc list-inside text-xs">
                              <li>NTAO</li>
                              <li>Assets Management</li>
                              <li>Inventory Control</li>
                              <li>Fleet Management</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleVehicleOffboard} className="space-y-6">
                        {/* Employee Information Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="techRacfId">Tech RacfId *</Label>
                            <Input
                              id="techRacfId"
                              value={vehicleOffboard.techRacfId}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, techRacfId: e.target.value }))}
                              placeholder="Enter tech RacfId"
                              data-testid="input-tech-racfid"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="techName">Tech Name *</Label>
                            <Input
                              id="techName"
                              value={vehicleOffboard.techName}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, techName: e.target.value }))}
                              placeholder="Enter tech name"
                              data-testid="input-tech-name"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="lastDayWorked">Last Day Worked *</Label>
                            <Input
                              id="lastDayWorked"
                              type="date"
                              value={vehicleOffboard.lastDayWorked}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, lastDayWorked: e.target.value }))}
                              data-testid="input-last-day-worked"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="vehicleNumber">Vehicle Number *</Label>
                            <Input
                              id="vehicleNumber"
                              value={vehicleOffboard.vehicleNumber}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                              placeholder="Enter vehicle number"
                              data-testid="input-vehicle-number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="vehicleId">Vehicle *</Label>
                            <Select 
                              value={vehicleOffboard.vehicleId} 
                              onValueChange={(value) => setVehicleOffboard(prev => ({ ...prev, vehicleId: value }))}
                              data-testid="select-vehicle-offboard"
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select vehicle to offboard" />
                              </SelectTrigger>
                              <SelectContent>
                                {vehicles.map(vehicle => (
                                  <SelectItem key={vehicle.id} value={vehicle.id} data-testid={`option-vehicle-${vehicle.id}`}>
                                    <div className="flex items-center justify-between w-full">
                                      <span>{vehicle.name}</span>
                                      <Badge className={`ml-2 ${getStatusColor(vehicle.status)}`}>
                                        {vehicle.status}
                                      </Badge>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="vehicleLocation">Vehicle Location *</Label>
                          <Input
                            id="vehicleLocation"
                            value={vehicleOffboard.vehicleLocation}
                            onChange={(e) => setVehicleOffboard(prev => ({ ...prev, vehicleLocation: e.target.value }))}
                            placeholder="Enter current location"
                            data-testid="input-vehicle-location"
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="reason">Reason for Offboarding *</Label>
                            <Select 
                              value={vehicleOffboard.reason} 
                              onValueChange={(value) => setVehicleOffboard(prev => ({ ...prev, reason: value }))}
                              data-testid="select-vehicle-reason"
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {offboardReasons.map(reason => (
                                  <SelectItem key={reason} value={reason} data-testid={`option-${reason.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {reason}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="effectiveDate">Effective Date *</Label>
                            <Input
                              id="effectiveDate"
                              type="date"
                              value={vehicleOffboard.effectiveDate}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, effectiveDate: e.target.value }))}
                              data-testid="input-vehicle-effective-date"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="returnCondition">Vehicle Condition</Label>
                          <Select 
                            value={vehicleOffboard.returnCondition} 
                            onValueChange={(value) => setVehicleOffboard(prev => ({ ...prev, returnCondition: value }))}
                            data-testid="select-return-condition"
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select condition" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="excellent" data-testid="option-excellent">Excellent</SelectItem>
                              <SelectItem value="good" data-testid="option-good">Good</SelectItem>
                              <SelectItem value="fair" data-testid="option-fair">Fair</SelectItem>
                              <SelectItem value="poor" data-testid="option-poor">Poor</SelectItem>
                              <SelectItem value="damaged" data-testid="option-damaged">Damaged</SelectItem>
                              <SelectItem value="unknown" data-testid="option-unknown">Unknown</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="vehicleNotes">Additional Notes</Label>
                          <Textarea
                            id="vehicleNotes"
                            value={vehicleOffboard.notes}
                            onChange={(e) => setVehicleOffboard(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Any additional information about the offboarding..."
                            rows={4}
                            data-testid="textarea-vehicle-notes"
                          />
                        </div>

                        <Button type="submit" className="w-full" data-testid="button-offboard-vehicle">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Offboard Vehicle & Notify Departments
                        </Button>
                      </form>
                    </CardContent>
                  </Card>
                </div>

                {/* Vehicle Details Sidebar */}
                <div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base" data-testid="text-vehicle-details-title">Vehicle Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {vehicleOffboard.vehicleId ? (
                        (() => {
                          const vehicle = vehicles.find(v => v.id === vehicleOffboard.vehicleId);
                          return vehicle ? (
                            <div className="space-y-3">
                              <div>
                                <p className="font-medium">{vehicle.name}</p>
                                <Badge className={getStatusColor(vehicle.status)}>
                                  {vehicle.status}
                                </Badge>
                              </div>
                              {vehicle.assignedTo && (
                                <div>
                                  <p className="text-sm text-muted-foreground">Assigned to:</p>
                                  <p className="font-medium">{vehicle.assignedTo}</p>
                                </div>
                              )}
                              {vehicle.status === "assigned" && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                    <p className="text-sm font-medium">Note</p>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    This vehicle is currently assigned. Please ensure proper handover.
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : null;
                        })()
                      ) : (
                        <p className="text-sm text-muted-foreground">Select a vehicle to view details</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="location">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2" data-testid="text-location-offboard-title">
                        <Archive className="h-5 w-5" />
                        Deactivate Location
                      </CardTitle>
                      <CardDescription>
                        Process location closure and document the reason
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleLocationOffboard} className="space-y-6">
                        <div className="space-y-2">
                          <Label htmlFor="locationId">Location *</Label>
                          <Select 
                            value={locationOffboard.locationId} 
                            onValueChange={(value) => setLocationOffboard(prev => ({ ...prev, locationId: value }))}
                            data-testid="select-location-offboard"
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select location to offboard" />
                            </SelectTrigger>
                            <SelectContent>
                              {locations.map(location => (
                                <SelectItem key={location.id} value={location.id} data-testid={`option-location-${location.id}`}>
                                  <div className="flex items-center justify-between w-full">
                                    <span>{location.name} ({location.type})</span>
                                    <Badge className={`ml-2 ${getStatusColor(location.status)}`}>
                                      {location.status}
                                    </Badge>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="locationReason">Reason for Closure *</Label>
                            <Select 
                              value={locationOffboard.reason} 
                              onValueChange={(value) => setLocationOffboard(prev => ({ ...prev, reason: value }))}
                              data-testid="select-location-reason"
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {offboardReasons.slice(4).map(reason => (
                                  <SelectItem key={reason} value={reason} data-testid={`option-location-${reason.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {reason}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="locationEffectiveDate">Effective Date *</Label>
                            <Input
                              id="locationEffectiveDate"
                              type="date"
                              value={locationOffboard.effectiveDate}
                              onChange={(e) => setLocationOffboard(prev => ({ ...prev, effectiveDate: e.target.value }))}
                              data-testid="input-location-effective-date"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="equipmentDisposal">Equipment Disposal Plan</Label>
                          <Select 
                            value={locationOffboard.equipmentDisposal} 
                            onValueChange={(value) => setLocationOffboard(prev => ({ ...prev, equipmentDisposal: value }))}
                            data-testid="select-equipment-disposal"
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select disposal method" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="transfer" data-testid="option-transfer">Transfer to other location</SelectItem>
                              <SelectItem value="sell" data-testid="option-sell">Sell equipment</SelectItem>
                              <SelectItem value="store" data-testid="option-store">Store in warehouse</SelectItem>
                              <SelectItem value="dispose" data-testid="option-dispose">Dispose/Recycle</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="locationNotes">Additional Notes</Label>
                          <Textarea
                            id="locationNotes"
                            value={locationOffboard.notes}
                            onChange={(e) => setLocationOffboard(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Any additional information about the closure..."
                            rows={4}
                            data-testid="textarea-location-notes"
                          />
                        </div>

                        <Button type="submit" className="w-full" data-testid="button-offboard-location">
                          <Archive className="h-4 w-4 mr-2" />
                          Deactivate Location
                        </Button>
                      </form>
                    </CardContent>
                  </Card>
                </div>

                {/* Location Details Sidebar */}
                <div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base" data-testid="text-location-details-title">Location Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {locationOffboard.locationId ? (
                        (() => {
                          const location = locations.find(l => l.id === locationOffboard.locationId);
                          return location ? (
                            <div className="space-y-3">
                              <div>
                                <p className="font-medium">{location.name}</p>
                                <p className="text-sm text-muted-foreground">{location.type}</p>
                                <Badge className={getStatusColor(location.status)}>
                                  {location.status}
                                </Badge>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Active Employees:</p>
                                <p className="font-medium">{location.employees}</p>
                              </div>
                              {location.employees > 0 && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                    <p className="text-sm font-medium">Employee Transfer Required</p>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {location.employees} employees need to be reassigned.
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : null;
                        })()
                      ) : (
                        <p className="text-sm text-muted-foreground">Select a location to view details</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}