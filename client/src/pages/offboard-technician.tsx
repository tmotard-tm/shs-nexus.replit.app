import { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, AlertTriangle, Trash2, Loader2, Truck, Clock, User, Calendar } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

export default function OffboardTechnician() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [technicianOffboard, setTechnicianOffboard] = useState({
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmissionTime, setLastSubmissionTime] = useState<{[key: string]: number}>({});
  const [isLookingUpTruck, setIsLookingUpTruck] = useState(false);
  const [tpmsLookupResult, setTpmsLookupResult] = useState<{
    success: boolean;
    truckNo?: string;
    techInfo?: any;
    error?: string;
  } | null>(null);

  // Fetch pending offboarding queue items
  const { data: offboardingQueue, isLoading: isLoadingQueue } = useQuery<any[]>({
    queryKey: ['/api/fleet-queue'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Filter to show only pending/in_progress offboarding tasks
  const pendingOffboardings = offboardingQueue?.filter(
    (item: any) => item.workflowType === 'offboarding' && item.status !== 'completed'
  ) || [];

  // Function to load queue item data into the form
  const loadQueueItem = async (item: any) => {
    try {
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
      const technician = data?.technician || {};
      const vehicle = data?.vehicle || {};
      
      // Get truck number from vehicle data if available
      let truckNumber = vehicle?.truckNo || vehicle?.vehicleNumber || "";
      
      // If no truck number in data but we have a tech RACF ID, try TPMS lookup
      const techRacfId = technician.techRacfid || technician.enterpriseId || "";
      if (!truckNumber && techRacfId) {
        try {
          const response = await fetch(`/api/tpms/truck/${encodeURIComponent(techRacfId)}`, {
            credentials: 'include'
          });
          const result = await response.json();
          if (result.success && result.truckNo) {
            truckNumber = result.truckNo.trim();
            toast({
              title: "Truck Found",
              description: `Found truck ${truckNumber} for ${techRacfId}`,
            });
          }
        } catch (e) {
          console.log('TPMS lookup during load failed:', e);
        }
      }
      
      setTechnicianOffboard({
        vehicleId: "",
        techRacfId: techRacfId,
        techName: technician.techName || technician.name || "",
        employeeId: technician.employeeId || "",
        lastDayWorked: technician.lastDayWorked || "",
        vehicleNumber: truckNumber,
        vehicleLocation: "",
        vehicleType: "",
        reason: "",
        effectiveDate: technician.lastDayWorked || "",
        notes: "",
        returnCondition: ""
      });

      toast({
        title: "Queue Item Loaded",
        description: `Loaded data for ${technician.techName || 'technician'}. Review and complete the form.`,
      });
    } catch (e) {
      console.error('Error parsing queue item data:', e);
      toast({
        title: "Error Loading Data",
        description: "Could not parse queue item data.",
        variant: "destructive"
      });
    }
  };

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

  useEffect(() => {
    const offboardFields = [
      'vehicleId', 'techRacfId', 'techName', 'employeeId', 'lastDayWorked',
      'vehicleNumber', 'vehicleLocation', 'vehicleType', 'reason', 'effectiveDate', 'notes', 'returnCondition'
    ];

    const prefill = getPrefillParams(offboardFields);

    if (Object.keys(prefill).length > 0) {
      const processedData: any = {};
      if (prefill.techName) processedData.techName = commonValidators.employeeName(prefill.techName);
      if (prefill.employeeId) processedData.employeeId = prefill.employeeId.replace(/\D/g, '').slice(0, 11);
      if (prefill.techRacfId) processedData.techRacfId = prefill.techRacfId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7);
      if (prefill.lastDayWorked) processedData.lastDayWorked = commonValidators.date(prefill.lastDayWorked);
      if (prefill.effectiveDate) processedData.effectiveDate = commonValidators.date(prefill.effectiveDate);
      if (prefill.vehicleNumber) processedData.vehicleNumber = commonValidators.vehicleNumber(prefill.vehicleNumber);
      if (prefill.notes) processedData.notes = commonValidators.text(prefill.notes);
      if (prefill.vehicleLocation) processedData.vehicleLocation = commonValidators.text(prefill.vehicleLocation);
      
      Object.keys(prefill).forEach(key => {
        if (!processedData.hasOwnProperty(key) && prefill[key]) {
          processedData[key] = prefill[key];
        }
      });
      
      setTechnicianOffboard(prev => ({ ...prev, ...processedData }));
    }
  }, []);

  const handleTpmsLookup = async () => {
    const enterpriseId = technicianOffboard.techRacfId.trim();
    
    if (!enterpriseId) {
      toast({
        title: "Missing Tech RACF ID",
        description: "Please enter a Tech RACF ID before looking up truck info.",
        variant: "destructive"
      });
      return;
    }

    setIsLookingUpTruck(true);
    setTpmsLookupResult(null);

    try {
      const response = await fetch(`/api/tpms/truck/${encodeURIComponent(enterpriseId)}`, {
        credentials: 'include'
      });
      
      const result = await response.json();
      setTpmsLookupResult(result);

      if (result.success && result.truckNo) {
        setTechnicianOffboard(prev => {
          const updates: Partial<typeof prev> = {
            vehicleNumber: result.truckNo.trim()
          };
          
          if (result.techInfo) {
            if (result.techInfo.firstName && result.techInfo.lastName && !prev.techName) {
              updates.techName = `${result.techInfo.firstName} ${result.techInfo.lastName}`.trim();
            }
          }
          
          return { ...prev, ...updates };
        });

        toast({
          title: "Truck Found",
          description: `Truck number ${result.truckNo.trim()} has been filled in for ${enterpriseId}.`,
        });
      } else {
        toast({
          title: "Truck Not Found",
          description: result.error || `No truck assigned to technician ${enterpriseId}.`,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('TPMS lookup error:', error);
      setTpmsLookupResult({ success: false, error: error.message });
      toast({
        title: "Lookup Failed",
        description: error.message || "Failed to look up truck information.",
        variant: "destructive"
      });
    } finally {
      setIsLookingUpTruck(false);
    }
  };

  const handleTechnicianOffboard = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) {
      toast({
        title: "Submission In Progress",
        description: "Please wait for the current submission to complete.",
        variant: "default"
      });
      return;
    }
    
    const submissionKey = `technician_${technicianOffboard.employeeId}_${technicianOffboard.techRacfId}`;
    const now = Date.now();
    const lastSubmission = lastSubmissionTime[submissionKey];
    if (lastSubmission && (now - lastSubmission) < 5000) {
      toast({
        title: "Duplicate Submission Prevented",
        description: "Please wait at least 5 seconds between submissions for the same employee.",
        variant: "destructive"
      });
      return;
    }
    
    if (!/^\d{11}$/.test(technicianOffboard.employeeId)) {
      toast({
        title: "Validation Error",
        description: "Employee ID must be exactly 11 digits.",
        variant: "destructive"
      });
      return;
    }
    
    if (!/^[a-zA-Z0-9]{7}$/.test(technicianOffboard.techRacfId)) {
      toast({
        title: "Validation Error",
        description: "Tech RACF ID must be exactly 7 characters (letters and numbers only).",
        variant: "destructive"
      });
      return;
    }
    
    setIsSubmitting(true);
    setLastSubmissionTime(prev => ({...prev, [submissionKey]: now}));
    
    const workflowId = `offboard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const sharedTriggerData = {
        workflowId: workflowId,
        vehicleType: technicianOffboard.vehicleType,
        employee: {
          name: technicianOffboard.techName,
          racfId: technicianOffboard.techRacfId,
          employeeId: technicianOffboard.employeeId,
          lastDayWorked: technicianOffboard.lastDayWorked,
          enterpriseId: technicianOffboard.techRacfId
        },
        vehicle: {
          vehicleNumber: technicianOffboard.vehicleNumber,
          vehicleName: technicianOffboard.vehicleNumber,
          reason: technicianOffboard.reason,
          location: technicianOffboard.vehicleLocation,
          condition: technicianOffboard.returnCondition,
          type: technicianOffboard.vehicleType
        },
        submitter: user ? {
          name: user.username || user.email || "Unknown User",
          submittedAt: new Date().toISOString()
        } : {
          name: "Anonymous User",
          submittedAt: new Date().toISOString()
        }
      };

      await apiRequest("POST", "/api/ntao-queue", {
        workflowType: "offboarding",
        title: `Day 0: NTAO — National Truck Assortment - Stop Truck Stock Replenishment - ${technicianOffboard.techName}`,
        description: `IMMEDIATE TASK: Stop truck stock replenishment for ${technicianOffboard.techName} (${technicianOffboard.techRacfId}). Vehicle: ${technicianOffboard.vehicleNumber}. Last day: ${technicianOffboard.lastDayWorked}. Reason: ${technicianOffboard.reason}. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
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
            "Update truck status in NTAO — National Truck Assortment system",
            "Complete Day 0 task - no follow-up tasks until all teams complete Day 0"
          ]
        })
      });

      await apiRequest("POST", "/api/assets-queue", {
        workflowType: "offboarding",
        title: `Day 0: Recover Company Equipment - ${technicianOffboard.techName}`,
        description: `IMMEDIATE TASK: Recover company equipment from ${technicianOffboard.techName} (${technicianOffboard.techRacfId}). Vehicle: ${technicianOffboard.vehicleNumber}. Contact employee immediately to arrange pickup/return of all company devices and equipment. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
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

      await apiRequest("POST", "/api/fleet-queue", {
        workflowType: "offboarding",
        title: `Day 0: Initial Vehicle Coordination - ${technicianOffboard.vehicleNumber}`,
        description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${technicianOffboard.vehicleNumber}. Employee: ${technicianOffboard.techName} (${technicianOffboard.techRacfId}). Contact technician and begin preliminary arrangements. This is a Day 0 task - must be completed before Phase 2 (Day 1-5) Fleet tasks are triggered.`,
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

      await apiRequest("POST", "/api/inventory-queue", {
        workflowType: "offboarding",
        title: `Day 0: Remove from TPMS & Stop Orders - ${technicianOffboard.vehicleNumber}`,
        description: `IMMEDIATE TASK: Remove terminated technician's truck ${technicianOffboard.vehicleNumber} from TPMS assignment and stop all inventory processes. Employee: ${technicianOffboard.techName} (${technicianOffboard.techRacfId}). This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
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
            `Remove vehicle ${technicianOffboard.vehicleNumber} from TPMS assignment`,
            "Update vehicle status to unassigned/pending-offboard",
            "Clear and cancel any pending parts orders for this vehicle/technician",
            "Stop any automatic inventory replenishment processes",
            "Document current inventory assignment status",
            "Complete Day 0 task - detailed inventory work will follow in Phase 2"
          ]
        })
      });

      try {
        await apiRequest("POST", "/api/send-deactivation-email", {
          employeeName: technicianOffboard.techName,
          employeeId: technicianOffboard.employeeId,
          racfId: technicianOffboard.techRacfId,
          lastDayWorked: technicianOffboard.lastDayWorked,
          reason: technicianOffboard.reason
        });
      } catch (emailError) {
        console.error('Error sending credit card deactivation email:', emailError);
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
      setIsSubmitting(false);
      return;
    }

    toast({
      title: "Two-Phase Offboarding Started",
      description: `Phase 1 (Day 0) tasks created for ${technicianOffboard.techName}: NTAO — National Truck Assortment, Equipment, Fleet, and Inventory teams. Phase 2 tasks will auto-trigger after all Day 0 tasks complete.`,
    });
    
    setTimeout(() => {
      toast({
        title: "Workflow Phases",
        description: `✅ PHASE 1: Day 0 tasks (all 4 teams) → PHASE 2: Day 1-5 Fleet follow-up tasks (auto-generated)`,
        variant: "default"
      });
    }, 2000);
    
    setTechnicianOffboard({
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
    
    setIsSubmitting(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "assigned": return "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]";
      case "available": return "bg-[hsl(var(--chart-1))]/10 text-[hsl(var(--chart-1))]";
      case "maintenance": return "bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="flex-1">
      <TopBar 
        title="Offboard Technician" 
        breadcrumbs={["Home", "Offboard"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-3 flex-1">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2" data-testid="text-technician-offboard-title">
                          <Trash2 className="h-5 w-5" />
                          Remove Technician from Fleet
                        </CardTitle>
                        <CardDescription>
                          Process technician removal and document the reason
                        </CardDescription>
                      </div>
                      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <p className="font-medium text-yellow-800 dark:text-yellow-200">Workflow Sequence</p>
                            <p className="text-yellow-700 dark:text-yellow-300"><strong>Phase 1 (Day 0)</strong> - Immediate tasks for all departments:</p>
                            <ul className="mt-1 text-yellow-600 dark:text-yellow-400 list-disc list-inside text-xs">
                              <li>NTAO — National Truck Assortment (Stop truck replenishment immediately)</li>
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
                      path="/offboard-technician" 
                      preserveQuery={true}
                      variant="icon"
                      className="ml-2"
                      data-testid="button-copy-offboard-link"
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleTechnicianOffboard} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employeeId">Employee ID *</Label>
                        <Input
                          id="employeeId"
                          placeholder="EMP-001"
                          value={technicianOffboard.employeeId}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, employeeId: e.target.value })}
                          required
                          data-testid="input-employee-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="techRacfId">Tech Racfid *</Label>
                        <Input
                          id="techRacfId"
                          placeholder="Enter tech Racfid"
                          value={technicianOffboard.techRacfId}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, techRacfId: e.target.value })}
                          required
                          data-testid="input-tech-racfid"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="techName">Tech Name *</Label>
                        <Input
                          id="techName"
                          placeholder="Enter tech name"
                          value={technicianOffboard.techName}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, techName: e.target.value })}
                          required
                          data-testid="input-tech-name"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="effectiveDate">Effective Date *</Label>
                        <Input
                          id="effectiveDate"
                          type="date"
                          value={technicianOffboard.effectiveDate}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, effectiveDate: e.target.value })}
                          required
                          data-testid="input-effective-date"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastDayWorked">Last Day Worked *</Label>
                        <Input
                          id="lastDayWorked"
                          type="date"
                          value={technicianOffboard.lastDayWorked}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, lastDayWorked: e.target.value })}
                          required
                          data-testid="input-last-day-worked"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="vehicleNumber">Vehicle Number *</Label>
                      <div className="flex gap-2">
                        <Input
                          id="vehicleNumber"
                          placeholder="Enter vehicle number"
                          value={technicianOffboard.vehicleNumber}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, vehicleNumber: e.target.value })}
                          required
                          data-testid="input-vehicle-number"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleTpmsLookup}
                          disabled={isLookingUpTruck || !technicianOffboard.techRacfId}
                          title="Look up truck number from TPMS using Tech RACF ID"
                          data-testid="button-tpms-lookup"
                        >
                          {isLookingUpTruck ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Truck className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enter Tech RACF ID first, then click the truck icon to auto-fill from TPMS
                      </p>
                      {tpmsLookupResult && (
                        <div className={`text-xs p-2 rounded ${tpmsLookupResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                          {tpmsLookupResult.success 
                            ? `Found truck: ${tpmsLookupResult.truckNo}${tpmsLookupResult.techInfo?.firstName ? ` (${tpmsLookupResult.techInfo.firstName} ${tpmsLookupResult.techInfo.lastName})` : ''}`
                            : `Lookup failed: ${tpmsLookupResult.error || 'Unknown error'}`}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="vehicleLocation">Vehicle Location *</Label>
                      <Input
                        id="vehicleLocation"
                        placeholder="Enter current location"
                        value={technicianOffboard.vehicleLocation}
                        onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, vehicleLocation: e.target.value })}
                        required
                        data-testid="input-vehicle-location"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="vehicleType">Vehicle Type *</Label>
                      <Select
                        value={technicianOffboard.vehicleType}
                        onValueChange={(value) => setTechnicianOffboard({ ...technicianOffboard, vehicleType: value })}
                        required
                      >
                        <SelectTrigger data-testid="select-vehicle-type">
                          <SelectValue placeholder="Select vehicle type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sprinter">Sprinter</SelectItem>
                          <SelectItem value="transit">Transit</SelectItem>
                          <SelectItem value="promaster">Promaster</SelectItem>
                          <SelectItem value="pickup">Pickup Truck</SelectItem>
                          <SelectItem value="cargo_van">Cargo Van</SelectItem>
                          <SelectItem value="box_truck">Box Truck</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Vehicle type determines which Phase 2 tasks are generated after Day 0 completion
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reason">Reason for Offboarding *</Label>
                      <Select
                        value={technicianOffboard.reason}
                        onValueChange={(value) => setTechnicianOffboard({ ...technicianOffboard, reason: value })}
                        required
                      >
                        <SelectTrigger data-testid="select-offboard-reason">
                          <SelectValue placeholder="Select reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {offboardReasons.map((reason) => (
                            <SelectItem key={reason} value={reason}>
                              {reason}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="returnCondition">Vehicle Condition</Label>
                      <Select
                        value={technicianOffboard.returnCondition}
                        onValueChange={(value) => setTechnicianOffboard({ ...technicianOffboard, returnCondition: value })}
                      >
                        <SelectTrigger data-testid="select-vehicle-condition">
                          <SelectValue placeholder="Select condition" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="excellent">Excellent</SelectItem>
                          <SelectItem value="good">Good</SelectItem>
                          <SelectItem value="fair">Fair</SelectItem>
                          <SelectItem value="poor">Poor</SelectItem>
                          <SelectItem value="needs_repair">Needs Repair</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes">Additional Notes</Label>
                      <Textarea
                        id="notes"
                        placeholder="Any additional information about the offboarding..."
                        value={technicianOffboard.notes}
                        onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, notes: e.target.value })}
                        rows={3}
                        data-testid="textarea-notes"
                      />
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={isSubmitting}
                      data-testid="button-submit-offboard"
                    >
                      {isSubmitting ? "Processing..." : "Start Offboarding Workflow"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2" data-testid="text-offboarding-queue-title">
                      <ClipboardList className="h-5 w-5" />
                      Offboarding Queue
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {pendingOffboardings.length} pending
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Click an item to load into form
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingQueue ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : pendingOffboardings.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No pending offboardings
                      </p>
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <div className="divide-y">
                        {pendingOffboardings.map((item: any) => {
                          const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
                          const technician = data?.technician || {};
                          const statusColor = item.status === 'pending' 
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
                          
                          return (
                            <button
                              key={item.id}
                              onClick={() => loadQueueItem(item)}
                              className="w-full p-3 text-left hover:bg-muted/50 transition-colors"
                              data-testid={`queue-item-${item.id}`}
                            >
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span className="font-medium text-sm truncate flex-1">
                                  {technician.techName || 'Unknown Technician'}
                                </span>
                                <Badge className={`${statusColor} text-[10px] px-1.5 py-0`}>
                                  {item.status}
                                </Badge>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <User className="h-3 w-3" />
                                  <span>{technician.techRacfid || technician.enterpriseId || 'N/A'}</span>
                                </div>
                                {technician.lastDayWorked && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Calendar className="h-3 w-3" />
                                    <span>Last day: {technician.lastDayWorked}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  <span>
                                    {new Date(item.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                                {technician.planningArea && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {technician.planningArea}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
