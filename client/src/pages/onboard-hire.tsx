import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, CheckCircle, Clock, Users, Package, Wrench, MapPin } from "lucide-react";
import { getUnassignedVehicles, type FleetVehicle } from "@/data/fleetData";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { BackButton } from "@/components/ui/back-button";

export default function OnboardHire() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [employeeForm, setEmployeeForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    startDate: "",
    manager: "",
    employeeId: "",
    region: "",
    district: "",
    requisitionId: "",
    enterpriseId: "",
    techId: "",
    proposedRouteStartDate: "",

    primarySpecialty: "",
    secondarySpecialty: "",
    tertiarySpecialty: ""
  });

  const [onboardingTasks, setOnboardingTasks] = useState([
    { id: "background-check", label: "Background Check", completed: false },
    { id: "equipment-assignment", label: "Equipment Assignment", completed: false },
    { id: "system-access", label: "System Access Setup", completed: false },
    { id: "workspace-setup", label: "Workspace Setup", completed: false },
    { id: "orientation-scheduled", label: "Orientation Scheduled", completed: false },
    { id: "documentation", label: "Documentation Completed", completed: false }
  ]);

  const [supplyOrders, setSupplyOrders] = useState({
    assetsSupplies: true,  // Automatically enabled
    ntaoPartsStock: true   // Automatically enabled
  });
  const [vehicleAssignment, setVehicleAssignment] = useState({
    autoAssign: true,      // Automatically enabled
    workZipcode: ""
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

  // Simple distance calculation based on zip code numerical difference
  const calculateZipDistance = (zip1: string, zip2: string): number => {
    if (!zip1 || !zip2) return 9999;
    const num1 = parseInt(zip1.replace(/\D/g, ''), 10);
    const num2 = parseInt(zip2.replace(/\D/g, ''), 10);
    if (isNaN(num1) || isNaN(num2)) return 9999;
    return Math.abs(num1 - num2);
  };

  const findClosestVehicle = (targetZip: string): FleetVehicle | null => {
    if (!targetZip.trim()) return null;
    
    // Get only truly unassigned vehicles (vehicles that are available for assignment)
    const unassignedVehicles = getUnassignedVehicles();
    console.log(`Found ${unassignedVehicles.length} unassigned vehicles available for assignment`);
    
    if (unassignedVehicles.length === 0) {
      console.log('No unassigned vehicles available for assignment');
      return null;
    }
    
    const vehiclesWithDistance = unassignedVehicles
      .map(vehicle => ({
        ...vehicle,
        distance: calculateZipDistance(vehicle.zip, targetZip.trim())
      }))
      .sort((a, b) => a.distance - b.distance);
    
    const closestVehicle = vehiclesWithDistance[0];
    console.log(`Closest vehicle found: ${closestVehicle?.modelYear} ${closestVehicle?.makeName} ${closestVehicle?.modelName} at distance ${closestVehicle?.distance}`);
    
    return closestVehicle || null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required specialty fields
    if (!employeeForm.primarySpecialty || !employeeForm.secondarySpecialty || !employeeForm.tertiarySpecialty) {
      toast({
        title: "Validation Error",
        description: "All three specialties (Primary, Secondary, and Tertiary) are required.",
        variant: "destructive"
      });
      return;
    }

    // Check for duplicate specialties
    const specialties = [employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty];
    const uniqueSpecialties = new Set(specialties);
    if (uniqueSpecialties.size !== specialties.length) {
      toast({
        title: "Validation Error", 
        description: "Each specialty must be different. Please select three different specialties.",
        variant: "destructive"
      });
      return;
    }
    
    const orderMessages = [];
    const requestsCreated = [];
    
    try {
      // Create Assets & Supplies queue task if triggered
      if (supplyOrders.assetsSupplies) {
        const assetsQueueItem = await apiRequest("POST", "/api/queue", {
          workflowType: "assets_supplies",
          title: `Assets & Supplies Order for Day 1 Supplies (Auto-triggered)`,
          description: `Day 1 supplies and assets for new employee ${employeeForm.firstName} ${employeeForm.lastName} (${employeeForm.department}). Start date: ${employeeForm.startDate}. Region: ${employeeForm.region}, District: ${employeeForm.district}. Specialties: ${[employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty].filter(Boolean).join(', ') || 'None specified'}. Enterprise ID: ${employeeForm.enterpriseId}.`,
          priority: "high",
          requesterId: user?.id || "system",
          data: JSON.stringify({
            submitter: {
              name: user?.name || user?.enterpriseId || "Unknown User",
              submittedAt: new Date().toISOString()
            },
            employee: {
              firstName: employeeForm.firstName,
              lastName: employeeForm.lastName,
              enterpriseId: employeeForm.enterpriseId,
              department: employeeForm.department,
              startDate: employeeForm.startDate,
              region: employeeForm.region,
              district: employeeForm.district,
              specialties: [employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty]
            },
            orderType: "Day 1 Assets & Supplies",
            autoTriggered: true,
            triggeredBy: "onboarding"
          })
        });
        requestsCreated.push("Assets & Supplies order");
        orderMessages.push("Assets & Supplies order triggered for Day 1 supplies");
      }
      
      // Create NTAO parts stock queue task if triggered
      if (supplyOrders.ntaoPartsStock) {
        const ntaoQueueItem = await apiRequest("POST", "/api/queue", {
          workflowType: "ntao_parts",
          title: `NTAO Order for Parts Stock (Auto-triggered)`,
          description: `Parts stock allocation for new technician ${employeeForm.firstName} ${employeeForm.lastName} (${employeeForm.department}). Work location: ${vehicleAssignment.workZipcode || 'TBD'}. Region: ${employeeForm.region}, District: ${employeeForm.district}. Specialties: ${[employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty].filter(Boolean).join(', ') || 'None specified'}. Tech ID: ${employeeForm.techId || 'TBD'}. Enterprise ID: ${employeeForm.enterpriseId}.`,
          priority: "medium",
          requesterId: user?.id || "system",
          data: JSON.stringify({
            submitter: {
              name: user?.name || user?.enterpriseId || "Unknown User",
              submittedAt: new Date().toISOString()
            },
            employee: {
              firstName: employeeForm.firstName,
              lastName: employeeForm.lastName,
              enterpriseId: employeeForm.enterpriseId,
              techId: employeeForm.techId,
              department: employeeForm.department,
              region: employeeForm.region,
              district: employeeForm.district,
              specialties: [employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty]
            },
            workLocation: vehicleAssignment.workZipcode || 'TBD',
            orderType: "NTAO Parts Stock",
            autoTriggered: true,
            triggeredBy: "onboarding"
          })
        });
        requestsCreated.push("NTAO parts stock order");
        orderMessages.push("NTAO order triggered for parts stock");
      }
      
      // Handle vehicle assignment
      let vehicleMessage = "";
      if (vehicleAssignment.autoAssign && vehicleAssignment.workZipcode) {
        const closestVehicle = findClosestVehicle(vehicleAssignment.workZipcode);
        if (closestVehicle) {
          requestsCreated.push("Vehicle assignment");
          vehicleMessage = `Closest vehicle assigned: ${closestVehicle.modelYear} ${closestVehicle.makeName} ${closestVehicle.modelName} (${closestVehicle.licensePlate}) located in ${closestVehicle.city}, ${closestVehicle.state}.`;
        } else {
          vehicleMessage = "No available vehicles found for assignment.";
        }
      }
      
      const allMessages = [...orderMessages];
      if (vehicleMessage) allMessages.push(vehicleMessage);
      
      let description = `${employeeForm.firstName} ${employeeForm.lastName} has been onboarded.`;
      if (requestsCreated.length > 0) {
        description += ` ${requestsCreated.length} request(s) created: ${requestsCreated.join(", ")}.`;
      }
      if (allMessages.length > 0) {
        description += ` ${allMessages.join(" ")}`;
      }

      // Create queue item for onboarding process
      try {
        await apiRequest("POST", "/api/queue", {
          workflowType: "onboarding",
          title: `Onboard New Employee - ${employeeForm.firstName} ${employeeForm.lastName}`,
          description: `Complete onboarding process for ${employeeForm.firstName} ${employeeForm.lastName} (${employeeForm.department}). ${requestsCreated.length > 0 ? `Requests created: ${requestsCreated.join(", ")}.` : ""}`,
          priority: "high",
          requesterId: user?.id || "system",
          data: JSON.stringify({
            submitter: {
              name: user?.name || user?.enterpriseId || "Unknown User",
              submittedAt: new Date().toISOString()
            },
            employee: employeeForm,
            vehicleAssignment,
            supplyOrders,
            requestsCreated,
            onboardingDate: new Date().toISOString()
          })
        });
      } catch (queueError) {
        console.error('Error creating queue item:', queueError);
      }
      
      toast({
        title: "Employee Onboarded",
        description,
      });
      
    } catch (error) {
      console.error('Error creating requests:', error);
      toast({
        title: "Employee Onboarded",
        description: `${employeeForm.firstName} ${employeeForm.lastName} has been onboarded, but there was an issue creating some requests. Please check the request system.`,
        variant: "destructive"
      });
    }
    
    setEmployeeForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      department: "",
      position: "",
      startDate: "",
      manager: "",
      employeeId: "",
      region: "",
      district: "",
      requisitionId: "",
      enterpriseId: "",
      techId: "",
      proposedRouteStartDate: "",
  
      primarySpecialty: "",
      secondarySpecialty: "",
      tertiarySpecialty: ""
    });

    setOnboardingTasks(tasks => tasks.map(task => ({ ...task, completed: false })));
    setSupplyOrders({ assetsSupplies: false, ntaoPartsStock: false });
    setVehicleAssignment({ autoAssign: false, workZipcode: "" });
  };

  const toggleTask = (taskId: string) => {
    setOnboardingTasks(tasks => 
      tasks.map(task => 
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  const completedTasks = onboardingTasks.filter(task => task.completed).length;
  const totalTasks = onboardingTasks.length;

  return (
    <MainContent>
      <TopBar 
        title="Onboard New Hire" 
        breadcrumbs={["Home", "Onboard"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Employee Information Form */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-employee-info-title">
                    <UserPlus className="h-5 w-5" />
                    Employee Information
                  </CardTitle>
                  <CardDescription>
                    Enter the new employee's personal and job information
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name *</Label>
                        <Input
                          id="firstName"
                          value={employeeForm.firstName}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, firstName: e.target.value }))}
                          placeholder="John"
                          data-testid="input-first-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name *</Label>
                        <Input
                          id="lastName"
                          value={employeeForm.lastName}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Doe"
                          data-testid="input-last-name"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={employeeForm.email}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="john.doe@company.com"
                          data-testid="input-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          value={employeeForm.phone}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, phone: e.target.value }))}
                          placeholder="(555) 123-4567"
                          data-testid="input-phone"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="department">Department *</Label>
                        <Select 
                          value={employeeForm.department} 
                          onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, department: value }))}
                          data-testid="select-department"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                          <SelectContent>
                            {departments.map(dept => (
                              <SelectItem key={dept} value={dept} data-testid={`option-${dept.toLowerCase().replace(/\s+/g, '-')}`}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="position">Position *</Label>
                        <Input
                          id="position"
                          value={employeeForm.position}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, position: e.target.value }))}
                          placeholder="e.g., Sales Representative"
                          data-testid="input-position"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="startDate">Start Date *</Label>
                        <Input
                          id="startDate"
                          type="date"
                          value={employeeForm.startDate}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, startDate: e.target.value }))}
                          data-testid="input-start-date"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="manager">Manager *</Label>
                        <Select 
                          value={employeeForm.manager} 
                          onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, manager: value }))}
                          data-testid="select-manager"
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select manager" />
                          </SelectTrigger>
                          <SelectContent>
                            {managers.map(manager => (
                              <SelectItem key={manager.id} value={manager.id} data-testid={`option-manager-${manager.id}`}>
                                {manager.name} ({manager.department})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employeeId">Employee ID</Label>
                        <Input
                          id="employeeId"
                          value={employeeForm.employeeId}
                          onChange={(e) => setEmployeeForm(prev => ({ ...prev, employeeId: e.target.value }))}
                          placeholder="EMP-001"
                          data-testid="input-employee-id"
                        />
                      </div>
                    </div>

                    {/* Additional Employee Information */}
                    <div className="border-t pt-6">
                      <h4 className="font-semibold mb-4 text-lg">Employee Route details</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="space-y-2">
                          <Label htmlFor="region">Region *</Label>
                          <Select 
                            value={employeeForm.region} 
                            onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, region: value }))}
                            data-testid="select-region"
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select region" />
                            </SelectTrigger>
                            <SelectContent>
                              {regions.map(region => (
                                <SelectItem key={region} value={region} data-testid={`option-${region.toLowerCase().replace(/\s+/g, '-')}`}>
                                  {region}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="district">District *</Label>
                          <Input
                            id="district"
                            value={employeeForm.district}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, district: e.target.value }))}
                            placeholder="e.g., District 25"
                            data-testid="input-district"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="requisitionId">Requisition ID *</Label>
                          <Input
                            id="requisitionId"
                            value={employeeForm.requisitionId}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, requisitionId: e.target.value }))}
                            placeholder="REQ-2024-001"
                            data-testid="input-requisition-id"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="space-y-2">
                          <Label htmlFor="enterpriseId">Enterprise ID *</Label>
                          <Input
                            id="enterpriseId"
                            value={employeeForm.enterpriseId}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, enterpriseId: e.target.value }))}
                            placeholder="ENT1234"
                            data-testid="input-enterprise-id"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="techId">Tech ID</Label>
                          <Input
                            id="techId"
                            value={employeeForm.techId}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, techId: e.target.value }))}
                            placeholder="TECH-001"
                            data-testid="input-tech-id"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="proposedRouteStartDate">Proposed Route Start Date</Label>
                          <Input
                            id="proposedRouteStartDate"
                            type="date"
                            value={employeeForm.proposedRouteStartDate}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, proposedRouteStartDate: e.target.value }))}
                            data-testid="input-proposed-route-start-date"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        {/* Primary Specialty */}
                        <div className="space-y-2">
                          <Label htmlFor="primarySpecialty">Primary Specialty *</Label>
                          <Select 
                            value={employeeForm.primarySpecialty} 
                            onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, primarySpecialty: value }))}
                          >
                            <SelectTrigger data-testid="select-primary-specialty">
                              <SelectValue placeholder="Select specialty" />
                            </SelectTrigger>
                            <SelectContent>
                              {specialtyOptions.map(specialty => (
                                <SelectItem key={specialty} value={specialty}>{specialty}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Secondary Specialty */}
                        <div className="space-y-2">
                          <Label htmlFor="secondarySpecialty">Secondary Specialty *</Label>
                          <Select 
                            value={employeeForm.secondarySpecialty} 
                            onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, secondarySpecialty: value }))}
                          >
                            <SelectTrigger data-testid="select-secondary-specialty">
                              <SelectValue placeholder="Select specialty" />
                            </SelectTrigger>
                            <SelectContent>
                              {specialtyOptions.filter(option => option !== employeeForm.primarySpecialty).map(specialty => (
                                <SelectItem key={specialty} value={specialty}>{specialty}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Tertiary Specialty */}
                        <div className="space-y-2">
                          <Label htmlFor="tertiarySpecialty">Tertiary Specialty *</Label>
                          <Select 
                            value={employeeForm.tertiarySpecialty} 
                            onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, tertiarySpecialty: value }))}
                          >
                            <SelectTrigger data-testid="select-tertiary-specialty">
                              <SelectValue placeholder="Select specialty" />
                            </SelectTrigger>
                            <SelectContent>
                              {specialtyOptions.filter(option => 
                                option !== employeeForm.primarySpecialty && 
                                option !== employeeForm.secondarySpecialty
                              ).map(specialty => (
                                <SelectItem key={specialty} value={specialty}>{specialty}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Selected Specialties Display */}
                      {(employeeForm.primarySpecialty || employeeForm.secondarySpecialty || employeeForm.tertiarySpecialty) && (
                        <div className="mb-4 p-3 bg-muted rounded-lg">
                          <p className="text-sm font-medium mb-2">Selected Specialties:</p>
                          <div className="flex flex-wrap gap-1">
                            {[employeeForm.primarySpecialty, employeeForm.secondarySpecialty, employeeForm.tertiarySpecialty].filter(Boolean).map((specialty, index) => (
                              <span key={specialty} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                                {index === 0 ? 'Primary' : index === 1 ? 'Secondary' : 'Tertiary'}: {specialty}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>


                    {/* Automatic Supply Orders */}
                    <div className="border-t pt-6">
                      <h4 className="font-semibold mb-4 flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Day 1 Supply Orders (Automatic)
                      </h4>
                      <div className="space-y-3 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                        <div className="flex items-center space-x-3">
                          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                          <Label className="flex items-center gap-2 text-green-800 dark:text-green-200">
                            <Package className="h-4 w-4" />
                            Assets & Supplies Order for Day 1 Supplies (Auto-triggered)
                          </Label>
                        </div>
                        <div className="flex items-center space-x-3">
                          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                          <Label className="flex items-center gap-2 text-green-800 dark:text-green-200">
                            <Wrench className="h-4 w-4" />
                            NTAO Order for Parts Stock (Auto-triggered)
                          </Label>
                        </div>
                        <p className="text-xs text-green-700 dark:text-green-300 mt-2 italic">
                          *Triggered automatically when employee profile is created
                        </p>
                      </div>
                    </div>

                    {/* Automatic Vehicle Assignment */}
                    <div className="border-t pt-6">
                      <h4 className="font-semibold mb-4 flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Vehicle Assignment (Automatic)
                      </h4>
                      <div className="space-y-3">
                        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                          <div className="flex items-center space-x-3 mb-3">
                            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <Label className="text-green-800 dark:text-green-200 font-medium">
                              Auto-assign closest available vehicle
                            </Label>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="work-zipcode">Employee Work Location Zipcode *</Label>
                            <Input
                              id="work-zipcode"
                              value={vehicleAssignment.workZipcode}
                              onChange={(e) => setVehicleAssignment(prev => ({ ...prev, workZipcode: e.target.value }))}
                              placeholder="Enter work location zipcode (e.g., 10001)"
                              data-testid="input-work-zipcode"
                              required
                            />
                            <p className="text-xs text-green-700 dark:text-green-300">
                              System will automatically find and assign the closest unassigned vehicle
                            </p>
                            <p className="text-xs text-green-700 dark:text-green-300 mt-1 italic">
                              *Assignment occurs when employee profile is created
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t pt-6">
                      <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <p className="font-medium text-blue-800 dark:text-blue-200">Upon Profile Creation</p>
                            <p className="text-blue-700 dark:text-blue-300">The following processes will be automatically triggered when you click "Create Employee Profile":</p>
                            <ul className="mt-2 text-blue-600 dark:text-blue-400 list-disc list-inside text-xs space-y-1">
                              <li>Assets & Supplies Order for Day 1 Supplies</li>
                              <li>NTAO Order for Parts Stock</li>
                              <li>Vehicle Assignment (closest available to work location)</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" data-testid="button-submit-employee">
                        Create Employee Profile & Trigger Automation
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Onboarding Checklist */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-checklist-title">
                    <CheckCircle className="h-5 w-5" />
                    Onboarding Checklist
                  </CardTitle>
                  <CardDescription>
                    Track completion of onboarding tasks
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span>Progress</span>
                      <span data-testid="text-progress">{completedTasks}/{totalTasks}</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
                        data-testid="progress-bar"
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {onboardingTasks.map((task) => (
                      <div key={task.id} className="flex items-center space-x-3">
                        <Checkbox 
                          id={task.id}
                          checked={task.completed}
                          onCheckedChange={() => toggleTask(task.id)}
                          data-testid={`checkbox-${task.id}`}
                        />
                        <Label 
                          htmlFor={task.id} 
                          className={`flex-1 ${task.completed ? 'line-through text-muted-foreground' : ''}`}
                          data-testid={`label-${task.id}`}
                        >
                          {task.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2" data-testid="text-timeline-title">
                    <Clock className="h-5 w-5" />
                    Onboarding Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span><strong>Day 1:</strong> Welcome & Orientation</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Day 3:</strong> System Training</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Week 1:</strong> Department Introduction</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Week 2:</strong> Role-specific Training</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-muted rounded-full"></div>
                    <span><strong>Month 1:</strong> Performance Review</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </MainContent>
  );
}