import { useState, useEffect } from "react";
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
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

export default function OffboardVehicleLocation() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [vehicleOffboard, setVehicleOffboard] = useState({
    vehicleId: "",
    techRacfId: "",
    techName: "",
    employeeId: "",
    lastDayWorked: "",
    vehicleNumber: "",
    vehicleLocation: "",
    vehicleType: "",
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

  // Submission state tracking for duplicate prevention
  const [isVehicleSubmitting, setIsVehicleSubmitting] = useState(false);
  const [isLocationSubmitting, setIsLocationSubmitting] = useState(false);
  const [lastSubmissionTime, setLastSubmissionTime] = useState<{[key: string]: number}>({});

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

  // Apply prefill data from query parameters on component mount
  useEffect(() => {
    const vehicleOffboardFields = [
      'vehicleId', 'techRacfId', 'techName', 'employeeId', 'lastDayWorked',
      'vehicleNumber', 'vehicleLocation', 'vehicleType', 'reason', 'effectiveDate', 'notes', 'returnCondition'
    ];
    const locationOffboardFields = [
      'locationId', 'reason', 'effectiveDate', 'notes', 'equipmentDisposal'
    ];

    const vehiclePrefill = getPrefillParams(vehicleOffboardFields);
    const locationPrefill = getPrefillParams(locationOffboardFields);

    // Apply vehicle offboard prefill data
    if (Object.keys(vehiclePrefill).length > 0) {
      const processedData: any = {};
      if (vehiclePrefill.techName) processedData.techName = commonValidators.employeeName(vehiclePrefill.techName);
      if (vehiclePrefill.employeeId) processedData.employeeId = vehiclePrefill.employeeId.replace(/\D/g, '').slice(0, 11);
      if (vehiclePrefill.techRacfId) processedData.techRacfId = vehiclePrefill.techRacfId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7);
      if (vehiclePrefill.lastDayWorked) processedData.lastDayWorked = commonValidators.date(vehiclePrefill.lastDayWorked);
      if (vehiclePrefill.effectiveDate) processedData.effectiveDate = commonValidators.date(vehiclePrefill.effectiveDate);
      if (vehiclePrefill.vehicleNumber) processedData.vehicleNumber = commonValidators.vehicleNumber(vehiclePrefill.vehicleNumber);
      if (vehiclePrefill.notes) processedData.notes = commonValidators.text(vehiclePrefill.notes);
      if (vehiclePrefill.vehicleLocation) processedData.vehicleLocation = commonValidators.text(vehiclePrefill.vehicleLocation);
      
      Object.keys(vehiclePrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && vehiclePrefill[key]) {
          processedData[key] = vehiclePrefill[key];
        }
      });
      
      setVehicleOffboard(prev => ({ ...prev, ...processedData }));
    }

    // Apply location offboard prefill data
    if (Object.keys(locationPrefill).length > 0) {
      const processedData: any = {};
      if (locationPrefill.effectiveDate) processedData.effectiveDate = commonValidators.date(locationPrefill.effectiveDate);
      if (locationPrefill.notes) processedData.notes = commonValidators.text(locationPrefill.notes);
      if (locationPrefill.equipmentDisposal) processedData.equipmentDisposal = commonValidators.text(locationPrefill.equipmentDisposal);
      
      Object.keys(locationPrefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && locationPrefill[key]) {
          processedData[key] = locationPrefill[key];
        }
      });
      
      setLocationOffboard(prev => ({ ...prev, ...processedData }));
    }
  }, []);

  const handleVehicleOffboard = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent duplicate submissions - check if already submitting
    if (isVehicleSubmitting) {
      toast({
        title: "Submission In Progress",
        description: "Please wait for the current submission to complete.",
        variant: "default"
      });
      return;
    }
    
    // Prevent rapid duplicate submissions - check time since last submission
    const submissionKey = `vehicle_${vehicleOffboard.employeeId}_${vehicleOffboard.techRacfId}`;
    const now = Date.now();
    const lastSubmission = lastSubmissionTime[submissionKey];
    if (lastSubmission && (now - lastSubmission) < 5000) { // 5 second window
      toast({
        title: "Duplicate Submission Prevented",
        description: "Please wait at least 5 seconds between submissions for the same employee.",
        variant: "destructive"
      });
      return;
    }
    
    // Validate Employee ID (must be exactly 11 digits)
    if (!/^\d{11}$/.test(vehicleOffboard.employeeId)) {
      toast({
        title: "Validation Error",
        description: "Employee ID must be exactly 11 digits.",
        variant: "destructive"
      });
      return;
    }
    
    // Validate Tech RACF ID (must be exactly 7 alphanumeric characters)
    if (!/^[a-zA-Z0-9]{7}$/.test(vehicleOffboard.techRacfId)) {
      toast({
        title: "Validation Error",
        description: "Tech RACF ID must be exactly 7 characters (letters and numbers only).",
        variant: "destructive"
      });
      return;
    }
    
    // Set submitting state and record submission time
    setIsVehicleSubmitting(true);
    setLastSubmissionTime(prev => ({...prev, [submissionKey]: now}));
    
    const vehicle = vehicles.find(veh => veh.id === vehicleOffboard.vehicleId);
    
    // Generate unique workflow ID for this offboarding sequence
    const workflowId = `offboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Create shared trigger data for all workflow tasks
      const sharedTriggerData = {
        workflowId: workflowId,
        vehicleType: vehicleOffboard.vehicleType,
        employee: {
          name: vehicleOffboard.techName,
          racfId: vehicleOffboard.techRacfId,
          employeeId: vehicleOffboard.employeeId,
          lastDayWorked: vehicleOffboard.lastDayWorked,
          enterpriseId: vehicleOffboard.techRacfId
        },
        vehicle: {
          vehicleNumber: vehicleOffboard.vehicleNumber,
          vehicleName: vehicle?.name || vehicleOffboard.vehicleNumber,
          reason: vehicleOffboard.reason,
          location: vehicleOffboard.vehicleLocation,
          condition: vehicleOffboard.returnCondition,
          type: vehicleOffboard.vehicleType
        },
        submitter: user ? {
          name: user.username || user.email || "Unknown User",
          submittedAt: new Date().toISOString()
        } : {
          name: "Anonymous User",
          submittedAt: new Date().toISOString()
        }
      };

      // PHASE 1 (Day 0) - Create immediate tasks for all 4 teams
      
      // Day 0 Task 1: NTAO - Stop truck stock replenishment (immediate)
      await apiRequest("POST", "/api/ntao-queue", {
        workflowType: "offboarding",
        title: `Day 0: Stop Truck Stock Replenishment - ${vehicleOffboard.techName}`,
        description: `IMMEDIATE TASK: Stop truck stock replenishment for ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). Vehicle: ${vehicleOffboard.vehicleNumber}. Last day: ${vehicleOffboard.lastDayWorked}. Reason: ${vehicleOffboard.reason}. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
        priority: "high",
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "ntao_stop_replenishment_day0",
          workflowStep: 1,
          phase: "day0",
          isDay0Task: true,
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          ...sharedTriggerData,
          instructions: [
            "Place a shipping hold to prevent future shipments",
            "Cancel any pending orders for this technician",
            "Cancel all backorders associated with the vehicle",
            "Remove technician from automatic replenishment system",
            "Update truck status in NTAO system",
            "Complete Day 0 task - no follow-up tasks until all teams complete Day 0"
          ]
        })
      });

      // Day 0 Task 2: Equipment/Assets - Recover company devices (immediate)
      await apiRequest("POST", "/api/assets-queue", {
        workflowType: "offboarding",
        title: `Day 0: Recover Company Equipment - ${vehicleOffboard.techName}`,
        description: `IMMEDIATE TASK: Recover company equipment from ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). Vehicle: ${vehicleOffboard.vehicleNumber}. Contact employee immediately to arrange pickup/return of all company devices and equipment. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
        priority: "high",
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "equipment_recover_devices_day0",
          workflowStep: 2,
          phase: "day0",
          isDay0Task: true,
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          ...sharedTriggerData,
          instructions: [
            "Contact employee immediately to arrange equipment return",
            "Recover company phone and verify it's company-issued",
            "Collect any tablets, mobile hotspots, or other devices",
            "Retrieve company credit cards (coordinate with OneCard Help Desk if needed)",
            "Check for accessories (chargers, cases, cables)",
            "Wipe all device data per security protocol",
            "Update asset management system with returned items",
            "Complete Day 0 task - mark complete once all equipment recovered"
          ]
        })
      });

      // Day 0 Task 3: Fleet - Initial vehicle coordination (immediate)
      await apiRequest("POST", "/api/fleet-queue", {
        workflowType: "offboarding",
        title: `Day 0: Initial Vehicle Coordination - ${vehicleOffboard.vehicleNumber}`,
        description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${vehicleOffboard.vehicleNumber}. Employee: ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). Contact technician and begin preliminary arrangements. This is a Day 0 task - must be completed before Phase 2 (Day 1-5) Fleet tasks are triggered.`,
        priority: "high",
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "fleet_initial_coordination_day0",
          workflowStep: 3,
          phase: "day0",
          isDay0Task: true,
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          ...sharedTriggerData,
          instructions: [
            "Contact technician immediately to notify of offboarding process",
            "Arrange preliminary meeting/call to discuss vehicle handover",
            "Obtain current vehicle location and condition information",
            "Begin coordination with technician for vehicle retrieval timing",
            "Assess any immediate vehicle security or safety concerns",
            "Document initial vehicle status and location",
            "Complete Day 0 task - detailed Fleet work will follow in Phase 2"
          ]
        })
      });

      // Day 0 Task 4: Inventory - Remove from TPMS and stop orders (immediate)
      await apiRequest("POST", "/api/inventory-queue", {
        workflowType: "offboarding",
        title: `Day 0: Remove from TPMS & Stop Orders - ${vehicleOffboard.vehicleNumber}`,
        description: `IMMEDIATE TASK: Remove terminated technician's truck ${vehicleOffboard.vehicleNumber} from TPMS assignment and stop all inventory processes. Employee: ${vehicleOffboard.techName} (${vehicleOffboard.techRacfId}). This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
        priority: "high",
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "inventory_remove_tpms_day0",
          workflowStep: 4,
          phase: "day0",
          isDay0Task: true,
          submitterInfo: user ? {
            id: user.id,
            name: user.username || user.email,
            email: user.email
          } : {
            id: "anonymous",
            name: "Anonymous User",
            email: null
          },
          ...sharedTriggerData,
          instructions: [
            "Access TPMS (Truck Parts Management System) immediately",
            "Locate vehicle assignment for terminated technician",
            `Remove vehicle ${vehicleOffboard.vehicleNumber} from TPMS assignment`,
            "Update vehicle status to unassigned/pending-offboard",
            "Clear and cancel any pending parts orders for this vehicle/technician",
            "Stop any automatic inventory replenishment processes",
            "Document current inventory assignment status",
            "Complete Day 0 task - detailed inventory work will follow in Phase 2"
          ]
        })
      });

      // Send email notification to OneCard Help Desk for credit card deactivation
      try {
        await apiRequest("POST", "/api/send-deactivation-email", {
          employeeName: vehicleOffboard.techName,
          employeeId: vehicleOffboard.employeeId,
          racfId: vehicleOffboard.techRacfId,
          lastDayWorked: vehicleOffboard.lastDayWorked,
          reason: vehicleOffboard.reason
        });
      } catch (emailError) {
        console.error('Error sending credit card deactivation email:', emailError);
        // Don't fail the entire workflow if email fails
        toast({
          title: "Email Notification",
          description: "Offboarding created successfully. Credit card deactivation notification logged to server console (no email service configured).",
        });
      }

    } catch (queueError) {
      console.error('Error creating NTAO workflow task:', queueError);
      toast({
        title: "Error",
        description: "Failed to create offboarding workflow. Please try again.",
        variant: "destructive"
      });
      setIsVehicleSubmitting(false);
      return;
    }

    toast({
      title: "Two-Phase Offboarding Started",
      description: `Phase 1 (Day 0) tasks created for ${vehicleOffboard.techName}: NTAO, Equipment, Fleet, and Inventory teams. Phase 2 tasks will auto-trigger after all Day 0 tasks complete.`,
    });
    
    // Show secondary notification about workflow sequence
    setTimeout(() => {
      toast({
        title: "Workflow Phases",
        description: `✅ PHASE 1: Day 0 tasks (all 4 teams) → PHASE 2: Day 1-5 Fleet follow-up tasks (auto-generated)`,
        variant: "default"
      });
    }, 2000);
    
    setVehicleOffboard({
      vehicleId: "",
      techRacfId: "",
      techName: "",
      employeeId: "",
      lastDayWorked: "",
      vehicleNumber: "",
      vehicleLocation: "",
      vehicleType: "",
      reason: "",
      effectiveDate: "",
      notes: "",
      returnCondition: ""
    });
    
    // Reset submitting state after successful submission
    setIsVehicleSubmitting(false);
  };

  const handleLocationOffboard = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent duplicate submissions - check if already submitting
    if (isLocationSubmitting) {
      toast({
        title: "Submission In Progress",
        description: "Please wait for the current submission to complete.",
        variant: "default"
      });
      return;
    }
    
    // Prevent rapid duplicate submissions - check time since last submission
    const submissionKey = `location_${locationOffboard.locationId}`;
    const now = Date.now();
    const lastSubmission = lastSubmissionTime[submissionKey];
    if (lastSubmission && (now - lastSubmission) < 5000) { // 5 second window
      toast({
        title: "Duplicate Submission Prevented",
        description: "Please wait at least 5 seconds between submissions for the same location.",
        variant: "destructive"
      });
      return;
    }
    
    // Set submitting state and record submission time
    setIsLocationSubmitting(true);
    setLastSubmissionTime(prev => ({...prev, [submissionKey]: now}));
    
    try {
      const location = locations.find(loc => loc.id === locationOffboard.locationId);
      
      // Simulate API call delay (in real implementation this would be an actual API call)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
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
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to offboard location. Please try again.",
        variant: "destructive"
      });
    } finally {
      // Reset submitting state
      setIsLocationSubmitting(false);
    }
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
                      <div className="flex items-start justify-between">
                        <div className="space-y-3 flex-1">
                          <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2" data-testid="text-vehicle-offboard-title">
                              <Trash2 className="h-5 w-5" />
                              Remove Vehicle from Fleet
                            </CardTitle>
                            <CardDescription>
                              Process vehicle removal and document the reason
                            </CardDescription>
                          </div>
                          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                              <div className="text-sm">
                                <p className="font-medium text-yellow-800 dark:text-yellow-200">Workflow Sequence</p>
                                <p className="text-yellow-700 dark:text-yellow-300"><strong>Phase 1 (Day 0)</strong> - Immediate tasks for all departments:</p>
                                <ul className="mt-1 text-yellow-600 dark:text-yellow-400 list-disc list-inside text-xs">
                                  <li>NTAO (Stop truck replenishment immediately)</li>
                                  <li>Equipment/Assets (Recover company devices immediately)</li>
                                  <li>Fleet (Initial vehicle coordination)</li>
                                  <li>Inventory (Remove from TPMS, stop orders immediately)</li>
                                </ul>
                                <p className="text-yellow-700 dark:text-yellow-300 mt-2 text-xs"><strong>Phase 2 (Day 1-5)</strong> - Auto-generated ONLY after ALL Day 0 tasks complete:</p>
                                <ul className="mt-1 text-yellow-600 dark:text-yellow-400 list-disc list-inside text-xs">
                                  <li>Fleet follow-up tasks (vehicle retrieval, shop coordination, etc.)</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                        </div>
                        <CopyLinkButton
                          variant="icon"
                          preserveQuery={true}
                          preserveHash={true}
                          data-testid="button-copy-form-link-vehicle"
                          className="shrink-0"
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <form onSubmit={handleVehicleOffboard} className="space-y-6">
                        {/* Employee Information Section */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="employeeId">Employee ID *</Label>
                            <Input
                              id="employeeId"
                              value={vehicleOffboard.employeeId}
                              onChange={(e) => setVehicleOffboard(prev => ({ ...prev, employeeId: e.target.value }))}
                              placeholder="EMP-001"
                              data-testid="input-employee-id"
                            />
                          </div>
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                        {/* Vehicle Type Field */}
                        <div className="space-y-2">
                          <Label htmlFor="vehicleType">Vehicle Type *</Label>
                          <Select
                            value={vehicleOffboard.vehicleType}
                            onValueChange={(value) => setVehicleOffboard(prev => ({ ...prev, vehicleType: value }))}
                            required
                            data-testid="select-vehicle-type"
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select vehicle type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sears-fleet">Sears Fleet</SelectItem>
                              <SelectItem value="byov">BYOV (Bring Your Own Vehicle)</SelectItem>
                              <SelectItem value="rental">Rental</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-sm text-muted-foreground">
                            Vehicle type determines which Phase 2 tasks are generated after Day 0 completion
                          </p>
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

                        <Button 
                          type="submit" 
                          className="w-full" 
                          data-testid="button-offboard-vehicle"
                          disabled={isVehicleSubmitting}
                        >
                          {isVehicleSubmitting ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Processing Offboarding...
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-4 w-4 mr-2" />
                              Offboard Vehicle & Notify Departments
                            </>
                          )}
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
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="flex items-center gap-2" data-testid="text-location-offboard-title">
                            <Archive className="h-5 w-5" />
                            Deactivate Location
                          </CardTitle>
                          <CardDescription>
                            Process location closure and document the reason
                          </CardDescription>
                        </div>
                        <CopyLinkButton
                          variant="icon"
                          preserveQuery={true}
                          preserveHash={true}
                          data-testid="button-copy-form-link-location"
                          className="shrink-0"
                        />
                      </div>
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

                        <Button 
                          type="submit" 
                          className="w-full" 
                          data-testid="button-offboard-location"
                          disabled={isLocationSubmitting}
                        >
                          {isLocationSubmitting ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Processing Deactivation...
                            </>
                          ) : (
                            <>
                              <Archive className="h-4 w-4 mr-2" />
                              Deactivate Location
                            </>
                          )}
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