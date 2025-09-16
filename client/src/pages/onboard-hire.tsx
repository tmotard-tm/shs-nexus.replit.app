import { useState, useEffect } from "react";
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
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

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
    isGeneralist: false,
    isFSSLTech: false
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

  // Apply prefill data from query parameters on component mount
  useEffect(() => {
    const employeeFields = [
      'firstName', 'lastName', 'email', 'phone', 'street', 'city', 'state', 'zipCode',
      'department', 'position', 'startDate', 'manager', 'employeeId', 'region', 'district',
      'requisitionId', 'enterpriseId', 'techId', 'proposedRouteStartDate', 'isGeneralist', 'isFSSLTech'
    ];
    const vehicleFields = ['autoAssign', 'workZipcode'];

    const employeePrefill = getPrefillParams(employeeFields);
    const vehiclePrefill = getPrefillParams(vehicleFields);

    // Apply employee prefill data
    if (Object.keys(employeePrefill).length > 0) {
      const processedData: any = {};
      if (employeePrefill.email) processedData.email = commonValidators.email(employeePrefill.email);
      if (employeePrefill.phone) processedData.phone = commonValidators.phone(employeePrefill.phone);
      if (employeePrefill.startDate) processedData.startDate = commonValidators.date(employeePrefill.startDate);
      if (employeePrefill.proposedRouteStartDate) processedData.proposedRouteStartDate = commonValidators.date(employeePrefill.proposedRouteStartDate);
      if (employeePrefill.firstName) processedData.firstName = commonValidators.employeeName(employeePrefill.firstName);
      if (employeePrefill.lastName) processedData.lastName = commonValidators.employeeName(employeePrefill.lastName);
      if (employeePrefill.zipCode) processedData.zipCode = employeePrefill.zipCode.replace(/\D/g, '').slice(0, 5);
      if (employeePrefill.employeeId) processedData.employeeId = employeePrefill.employeeId.replace(/\D/g, '').slice(0, 11);
      if (employeePrefill.enterpriseId) processedData.enterpriseId = commonValidators.text(employeePrefill.enterpriseId);
      if (employeePrefill.techId) processedData.techId = commonValidators.text(employeePrefill.techId);
      if (employeePrefill.requisitionId) processedData.requisitionId = commonValidators.text(employeePrefill.requisitionId);
      if (employeePrefill.isGeneralist) processedData.isGeneralist = employeePrefill.isGeneralist === 'true';
      if (employeePrefill.isFSSLTech) processedData.isFSSLTech = employeePrefill.isFSSLTech === 'true';
      
      Object.keys(employeePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && employeePrefill[key]) {
          processedData[key] = employeePrefill[key];
        }
      });
      
      setEmployeeForm(prev => ({ ...prev, ...processedData }));
    }

    // Apply vehicle assignment prefill data
    if (Object.keys(vehiclePrefill).length > 0) {
      const processedData: any = {};
      if (vehiclePrefill.autoAssign) processedData.autoAssign = vehiclePrefill.autoAssign === 'true';
      
      Object.keys(vehiclePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && vehiclePrefill[key]) {
          processedData[key] = vehiclePrefill[key];
        }
      });
      
      setVehicleAssignment(prev => ({ ...prev, ...processedData }));
    }
  }, []);

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
          requesterId: user?.id || "anonymous",
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          data: JSON.stringify({
            submitter: user ? {
              name: user.username || user.email || "Unknown User",
              submittedAt: new Date().toISOString()
            } : {
              name: "Anonymous User",
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
      
      // Create task for manual vehicle assignment
      await apiRequest("POST", "/api/fleet-queue", {
        workflowType: "vehicle_assignment",
        title: `Vehicle Assignment - ${employeeForm.firstName} ${employeeForm.lastName}`,
        description: `Manually assign vehicle to new employee ${employeeForm.firstName} ${employeeForm.lastName} (${employeeForm.enterpriseId}) in ${employeeForm.region}.`,
        priority: "high",
        requesterId: user?.id || "anonymous",
        submitterInfo: user ? {
          id: user.id,
          name: user.username || user.email,
          email: user.email
        } : {
          id: "anonymous",
          name: "Anonymous User",
          email: null
        },
        data: JSON.stringify({
          submitter: user ? {
            name: user.username || user.email || "Unknown User",
            submittedAt: new Date().toISOString()
          } : {
            name: "Anonymous User",
            submittedAt: new Date().toISOString()
          },
          department: "Fleet Management",
          notificationType: "Vehicle Assignment",
          taskType: "Manual Vehicle Setup",
          employee: {
            firstName: employeeForm.firstName,
            lastName: employeeForm.lastName,
            enterpriseId: employeeForm.enterpriseId,
            techId: employeeForm.techId,
            department: employeeForm.department,
            region: employeeForm.region,
            startDate: employeeForm.startDate,
            address: {
              street: employeeForm.street,
              city: employeeForm.city,
              state: employeeForm.state,
              zipCode: employeeForm.zipCode
            }
          },
          workLocation: employeeForm.region,
          manualProcess: true,
          triggeredBy: "employee_onboarding",
          checklist: [
            {
              id: "select_vehicle",
              task: "Select appropriate vehicle for assignment",
              description: `Review available vehicles and select most suitable for employee ${employeeForm.firstName} ${employeeForm.lastName} (Tech ID: ${employeeForm.techId}) in ${employeeForm.region}`,
              completed: false,
              required: true
            },
            {
              id: "tpms_van_update",
              task: "Update TPMS with van number",
              description: `Update TPMS system with assigned van number for employee ${employeeForm.firstName} ${employeeForm.lastName} (Tech ID: ${employeeForm.techId})`,
              completed: false,
              required: true
            }
          ],
          instructions: [
            "Manually select and assign vehicle for new employee",
            "Update TPMS system with van number and employee assignment",
            "Verify vehicle is properly registered to employee",
            "Mark task complete only after TPMS is updated"
          ]
        })
      });
      
      requestsCreated.push("Vehicle assignment task");
      let vehicleMessage = "Manual vehicle assignment task created.";
      
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
          requesterId: user?.id || "anonymous",
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          data: JSON.stringify({
            submitter: user ? {
              name: user.username || user.email || "Unknown User",
              submittedAt: new Date().toISOString()
            } : {
              name: "Anonymous User",
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
      isGeneralist: false,
      isFSSLTech: false
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
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2" data-testid="text-employee-info-title">
                        <UserPlus className="h-5 w-5" />
                        Employee Information
                      </CardTitle>
                      <CardDescription>
                        Enter the new employee's personal and job information
                      </CardDescription>
                    </div>
                    <CopyLinkButton
                      variant="icon"
                      preserveQuery={true}
                      preserveHash={true}
                      data-testid="button-copy-form-link"
                      className="shrink-0"
                    />
                  </div>
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

                        {/* FSSL Tech Option */}
                        <div className="flex items-center space-x-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                          <Checkbox
                            id="fssl-tech"
                            checked={employeeForm.isFSSLTech}
                            onCheckedChange={(checked) => {
                              setEmployeeForm(prev => ({
                                ...prev,
                                isFSSLTech: !!checked
                              }));
                            }}
                            data-testid="checkbox-fssl-tech"
                          />
                          <div>
                            <Label htmlFor="fssl-tech" className="text-sm font-medium text-orange-800 dark:text-orange-200">
                              FSSL Tech (Field Service Support Lead)
                            </Label>
                            <span className="text-xs text-orange-600 dark:text-orange-300 ml-2">
                              Check this if the technician is designated as an FSSL tech
                            </span>
                          </div>
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
                        {(employeeForm.isGeneralist || employeeForm.specialties.length > 0 || employeeForm.isFSSLTech) && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-sm font-medium mb-2">Selected Specialties:</p>
                            <div className="flex flex-wrap gap-1">
                              {employeeForm.isGeneralist && (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-medium">
                                  🌟 Generalist (All Specialties except HVAC)
                                </span>
                              )}
                              {employeeForm.isFSSLTech && (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 font-medium">
                                  🏆 FSSL Tech
                                </span>
                              )}
                              {!employeeForm.isGeneralist && employeeForm.specialties.map((specialty) => (
                                <span key={specialty} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                                  {specialty}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>


                    {/* Automatic Supply Orders */}


                    <div className="border-t pt-6">
                      <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <p className="font-medium text-blue-800 dark:text-blue-200">Upon Profile Creation</p>
                            <p className="text-blue-700 dark:text-blue-300">The following tasks will be created for manual processing:</p>
                            <ul className="mt-2 text-blue-600 dark:text-blue-400 list-disc list-inside text-xs space-y-1">
                              <li>Assets & Supplies Order for Day 1 Supplies</li>
                              <li>NTAO Order for Parts Stock</li>
                              <li>Vehicle Assignment Task (for manual assignment)</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" data-testid="button-submit-employee">
                        Create Employee Profile & Generate Tasks
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