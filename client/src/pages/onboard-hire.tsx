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
    street: "",
    city: "",
    state: "",
    zipCode: "",
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

    specialties: [] as string[],
    isGeneralist: false
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
    "HVAC",
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
    
    // Validate Employee ID (must be exactly 11 digits)
    if (!/^\d{11}$/.test(employeeForm.employeeId)) {
      toast({
        title: "Validation Error",
        description: "Employee ID must be exactly 11 digits.",
        variant: "destructive"
      });
      return;
    }
    
    // Validate Tech RACF ID (must be exactly 7 alphanumeric characters)
    if (!/^[a-zA-Z0-9]{7}$/.test(employeeForm.techId)) {
      toast({
        title: "Validation Error",
        description: "Tech RACF ID must be exactly 7 characters (letters and numbers only).",
        variant: "destructive"
      });
      return;
    }
    
    // Validate required address fields
    if (!employeeForm.street.trim()) {
      toast({
        title: "Validation Error",
        description: "Street address is required.",
        variant: "destructive"
      });
      return;
    }
    
    if (!employeeForm.city.trim()) {
      toast({
        title: "Validation Error",
        description: "City is required.",
        variant: "destructive"
      });
      return;
    }
    
    if (!employeeForm.state) {
      toast({
        title: "Validation Error",
        description: "State is required.",
        variant: "destructive"
      });
      return;
    }
    
    if (!/^\d{5}$/.test(employeeForm.zipCode)) {
      toast({
        title: "Validation Error",
        description: "ZIP code must be exactly 5 digits.",
        variant: "destructive"
      });
      return;
    }
    
    // Validate specialty fields
    if (!employeeForm.isGeneralist && employeeForm.specialties.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please select at least one specialty or mark as generalist.",
        variant: "destructive"
      });
      return;
    }
    
    const orderMessages = [];
    const requestsCreated = [];
    
    try {
      // Create separate department tasks for onboarding
      const onboardingDepartmentTasks = [];
      
      if (supplyOrders.assetsSupplies) {
        onboardingDepartmentTasks.push({ dept: 'Assets & Supplies', priority: 'high', taskType: 'Day 1 Supplies' });
      }
      
      if (supplyOrders.ntaoPartsStock) {
        onboardingDepartmentTasks.push({ dept: 'NTAO', priority: 'medium', taskType: 'Parts Stock Allocation' });
      }

      // Create separate queue tasks for each department
      for (const { dept, priority, taskType } of onboardingDepartmentTasks) {
        // Route to correct department-specific queue
        let queueEndpoint = "/api/queue"; // fallback
        switch (dept) {
          case "NTAO":
            queueEndpoint = "/api/ntao-queue";
            break;
          case "Assets Management":
          case "Assets & Supplies":
            queueEndpoint = "/api/assets-queue";
            break;
          case "Inventory Control":
            queueEndpoint = "/api/inventory-queue";
            break;
          case "Fleet Management":
            queueEndpoint = "/api/fleet-queue";
            break;
          case "Decommissions":
            queueEndpoint = "/api/decommissions-queue";
            break;
        }
        
        const deptQueueItem = await apiRequest("POST", queueEndpoint, {
          workflowType: "department_notification",
          title: `${dept} - Employee Onboarding Task (Auto-triggered)`,
          description: `${taskType} task for ${dept} regarding new employee onboarding. Employee: ${employeeForm.firstName} ${employeeForm.lastName} (${employeeForm.enterpriseId}). Department: ${employeeForm.department}. Start date: ${employeeForm.startDate}. Region: ${employeeForm.region}, District: ${employeeForm.district}.`,
          priority: priority,
          requesterId: user?.id || "system",
          data: JSON.stringify({
            submitter: {
              name: user?.username || user?.email || "Unknown User",
              submittedAt: new Date().toISOString()
            },
            department: dept,
            notificationType: "Employee Onboarding",
            taskType: taskType,
            employee: {
              firstName: employeeForm.firstName,
              lastName: employeeForm.lastName,
              enterpriseId: employeeForm.enterpriseId,
              department: employeeForm.department,
              startDate: employeeForm.startDate,
              region: employeeForm.region,
              district: employeeForm.district,
              specialties: employeeForm.isGeneralist ? specialtyOptions.filter(s => s !== "HVAC") : employeeForm.specialties,
              techId: employeeForm.techId,
              address: {
                street: employeeForm.street,
                city: employeeForm.city,
                state: employeeForm.state,
                zipCode: employeeForm.zipCode
              }
            },
            workLocation: vehicleAssignment.workZipcode || 'TBD',
            autoTriggered: true,
            triggeredBy: "employee_onboarding",
            ...(dept === "Assets & Supplies" && {
              checklist: [
                {
                  id: "phone_order",
                  task: "Verify new phone order has been placed",
                  description: "Confirm mobile phone order is submitted for new employee",
                  completed: false,
                  required: true
                },
                {
                  id: "uniform_order", 
                  task: "Verify new uniform order has been placed",
                  description: "Confirm uniform/apparel order is submitted for new employee",
                  completed: false,
                  required: true
                },
                {
                  id: "tpms_update",
                  task: "Update TPMS with employee address and tech ID",
                  description: `Update TPMS system with employee address: ${employeeForm.street}, ${employeeForm.city}, ${employeeForm.state} ${employeeForm.zipCode} and Tech ID: ${employeeForm.techId}`,
                  completed: false,
                  required: true
                }
              ],
              instructions: [
                "Complete all checklist items for new employee setup",
                "Verify all orders are placed in appropriate systems", 
                "Update TPMS with accurate employee information",
                "Mark task complete only after all checklist items are verified"
              ]
            })
          })
        });
        requestsCreated.push(`${dept} ${taskType.toLowerCase()}`);
        orderMessages.push(`${dept} task created for ${taskType.toLowerCase()}`);
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
              name: user?.username || user?.email || "Unknown User",
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
      street: "",
      city: "",
      state: "",
      zipCode: "",
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
  
      specialties: [],
      isGeneralist: false
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

                    {/* Employee Address Information */}
                    <div className="border-t pt-6">
                      <h4 className="font-semibold mb-4 text-lg">Employee Address</h4>
                      
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="street">Street Address *</Label>
                          <Input
                            id="street"
                            value={employeeForm.street}
                            onChange={(e) => setEmployeeForm(prev => ({ ...prev, street: e.target.value }))}
                            placeholder="123 Main Street, Apt 4B"
                            data-testid="input-street"
                          />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="city">City *</Label>
                            <Input
                              id="city"
                              value={employeeForm.city}
                              onChange={(e) => setEmployeeForm(prev => ({ ...prev, city: e.target.value }))}
                              placeholder="Chicago"
                              data-testid="input-city"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="state">State *</Label>
                            <Select 
                              value={employeeForm.state} 
                              onValueChange={(value) => setEmployeeForm(prev => ({ ...prev, state: value }))}
                              data-testid="select-state"
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select state" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="AL">Alabama</SelectItem>
                                <SelectItem value="AK">Alaska</SelectItem>
                                <SelectItem value="AZ">Arizona</SelectItem>
                                <SelectItem value="AR">Arkansas</SelectItem>
                                <SelectItem value="CA">California</SelectItem>
                                <SelectItem value="CO">Colorado</SelectItem>
                                <SelectItem value="CT">Connecticut</SelectItem>
                                <SelectItem value="DE">Delaware</SelectItem>
                                <SelectItem value="FL">Florida</SelectItem>
                                <SelectItem value="GA">Georgia</SelectItem>
                                <SelectItem value="HI">Hawaii</SelectItem>
                                <SelectItem value="ID">Idaho</SelectItem>
                                <SelectItem value="IL">Illinois</SelectItem>
                                <SelectItem value="IN">Indiana</SelectItem>
                                <SelectItem value="IA">Iowa</SelectItem>
                                <SelectItem value="KS">Kansas</SelectItem>
                                <SelectItem value="KY">Kentucky</SelectItem>
                                <SelectItem value="LA">Louisiana</SelectItem>
                                <SelectItem value="ME">Maine</SelectItem>
                                <SelectItem value="MD">Maryland</SelectItem>
                                <SelectItem value="MA">Massachusetts</SelectItem>
                                <SelectItem value="MI">Michigan</SelectItem>
                                <SelectItem value="MN">Minnesota</SelectItem>
                                <SelectItem value="MS">Mississippi</SelectItem>
                                <SelectItem value="MO">Missouri</SelectItem>
                                <SelectItem value="MT">Montana</SelectItem>
                                <SelectItem value="NE">Nebraska</SelectItem>
                                <SelectItem value="NV">Nevada</SelectItem>
                                <SelectItem value="NH">New Hampshire</SelectItem>
                                <SelectItem value="NJ">New Jersey</SelectItem>
                                <SelectItem value="NM">New Mexico</SelectItem>
                                <SelectItem value="NY">New York</SelectItem>
                                <SelectItem value="NC">North Carolina</SelectItem>
                                <SelectItem value="ND">North Dakota</SelectItem>
                                <SelectItem value="OH">Ohio</SelectItem>
                                <SelectItem value="OK">Oklahoma</SelectItem>
                                <SelectItem value="OR">Oregon</SelectItem>
                                <SelectItem value="PA">Pennsylvania</SelectItem>
                                <SelectItem value="RI">Rhode Island</SelectItem>
                                <SelectItem value="SC">South Carolina</SelectItem>
                                <SelectItem value="SD">South Dakota</SelectItem>
                                <SelectItem value="TN">Tennessee</SelectItem>
                                <SelectItem value="TX">Texas</SelectItem>
                                <SelectItem value="UT">Utah</SelectItem>
                                <SelectItem value="VT">Vermont</SelectItem>
                                <SelectItem value="VA">Virginia</SelectItem>
                                <SelectItem value="WA">Washington</SelectItem>
                                <SelectItem value="WV">West Virginia</SelectItem>
                                <SelectItem value="WI">Wisconsin</SelectItem>
                                <SelectItem value="WY">Wyoming</SelectItem>
                                <SelectItem value="DC">Washington DC</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="zipCode">ZIP Code *</Label>
                            <Input
                              id="zipCode"
                              value={employeeForm.zipCode}
                              onChange={(e) => setEmployeeForm(prev => ({ ...prev, zipCode: e.target.value }))}
                              placeholder="60601"
                              maxLength={5}
                              pattern="[0-9]{5}"
                              data-testid="input-zip-code"
                            />
                          </div>
                        </div>
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

                      {/* Employee Specialties */}
                      <div className="space-y-4 mb-4">
                        <div className="flex items-center space-x-3">
                          <Label className="text-base font-medium">Employee Specialties *</Label>
                        </div>
                        
                        {/* Generalist Option */}
                        <div className="flex items-center space-x-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                          <Checkbox
                            id="generalist"
                            checked={employeeForm.isGeneralist}
                            onCheckedChange={(checked) => {
                              const generalistSpecialties = specialtyOptions.filter(s => s !== "HVAC");
                              setEmployeeForm(prev => ({
                                ...prev,
                                isGeneralist: !!checked,
                                specialties: checked ? generalistSpecialties : []
                              }));
                            }}
                            data-testid="checkbox-generalist"
                          />
                          <Label htmlFor="generalist" className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Generalist (All Specialties except HVAC)
                          </Label>
                          <span className="text-xs text-blue-600 dark:text-blue-300 ml-2">
                            Check this if the employee handles all specialty types (HVAC requires separate selection)
                          </span>
                        </div>

                        {/* Individual Specialty Checkboxes */}
                        {!employeeForm.isGeneralist && (
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Select Multiple Specialties:</Label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {specialtyOptions.map(specialty => (
                                <div key={specialty} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`specialty-${specialty}`}
                                    checked={employeeForm.specialties.includes(specialty)}
                                    onCheckedChange={(checked) => {
                                      setEmployeeForm(prev => ({
                                        ...prev,
                                        specialties: checked 
                                          ? [...prev.specialties, specialty]
                                          : prev.specialties.filter(s => s !== specialty)
                                      }));
                                    }}
                                    data-testid={`checkbox-specialty-${specialty.toLowerCase().replace(/\s+/g, '-')}`}
                                  />
                                  <Label htmlFor={`specialty-${specialty}`} className="text-sm">
                                    {specialty}
                                  </Label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Selected Specialties Display */}
                        {(employeeForm.isGeneralist || employeeForm.specialties.length > 0) && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm font-medium mb-2">Selected Specialties:</p>
                            <div className="flex flex-wrap gap-1">
                              {employeeForm.isGeneralist ? (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-medium">
                                  🌟 Generalist (All Specialties except HVAC)
                                </span>
                              ) : (
                                employeeForm.specialties.map((specialty) => (
                                  <span key={specialty} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                                    {specialty}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>


                    {/* Automatic Supply Orders */}

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