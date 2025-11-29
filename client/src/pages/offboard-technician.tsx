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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, AlertTriangle, Trash2, Loader2, Truck, Clock, User, Calendar, Car, MapPin, Navigation } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";
import { TechCombobox, TechRosterEntry } from "@/components/ui/tech-combobox";

interface LocationOption {
  id: string;
  source: 'tpms' | 'samsara' | 'holman' | 'other';
  label: string;
  address: string;
  latitude?: number;
  longitude?: number;
  type?: string;
  lastUpdated?: string;
}

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
    effectiveDate: "",
    notes: "",
    returnCondition: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: ""
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmissionTime, setLastSubmissionTime] = useState<{[key: string]: number}>({});
  const [isLookingUpTruck, setIsLookingUpTruck] = useState(false);
  const [isLookingUpHolman, setIsLookingUpHolman] = useState(false);
  const [tpmsLookupResult, setTpmsLookupResult] = useState<{
    success: boolean;
    truckNo?: string;
    techInfo?: any;
    error?: string;
  } | null>(null);
  const [holmanLookupResult, setHolmanLookupResult] = useState<{
    success: boolean;
    vehicle?: {
      year: string;
      make: string;
      model: string;
      holmanVehicleNumber: string;
    };
    error?: string;
  } | null>(null);

  // Location selection state
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [customLocation, setCustomLocation] = useState({
    type: 'address' as 'address' | 'coordinates',
    address: '',
    latitude: '',
    longitude: ''
  });

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
        effectiveDate: technician.effectiveDate || "",
        notes: "",
        returnCondition: "",
        vehicleYear: "",
        vehicleMake: "",
        vehicleModel: ""
      });
      
      // If vehicle number is available, look up Holman info
      if (truckNumber) {
        handleHolmanLookup(truckNumber);
      }

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

  // Holman vehicle lookup by vehicle number (left-padded to 6 chars)
  const handleHolmanLookup = async (vehicleNum: string) => {
    if (!vehicleNum) return;
    
    // Left-pad vehicle number to 6 characters
    const paddedVehicleNum = vehicleNum.padStart(6, '0');
    
    setIsLookingUpHolman(true);
    setHolmanLookupResult(null);

    try {
      const response = await fetch(`/api/holman/vehicle/${encodeURIComponent(paddedVehicleNum)}`, {
        credentials: 'include'
      });
      
      const result = await response.json();
      setHolmanLookupResult(result);

      if (result.success && result.vehicle) {
        setTechnicianOffboard(prev => ({
          ...prev,
          vehicleYear: result.vehicle.year || '',
          vehicleMake: result.vehicle.make || '',
          vehicleModel: result.vehicle.model || ''
        }));

        toast({
          title: "Vehicle Info Found",
          description: `Found ${result.vehicle.year} ${result.vehicle.make} ${result.vehicle.model}`,
        });
      } else {
        toast({
          title: "Vehicle Not Found",
          description: result.error || `No vehicle found with number ${paddedVehicleNum} in Holman.`,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('Holman lookup error:', error);
      setHolmanLookupResult({ success: false, error: error.message });
      toast({
        title: "Holman Lookup Failed",
        description: error.message || "Failed to look up vehicle in Holman.",
        variant: "destructive"
      });
    } finally {
      setIsLookingUpHolman(false);
    }
  };

  useEffect(() => {
    const offboardFields = [
      'vehicleId', 'techRacfId', 'techName', 'employeeId', 'lastDayWorked',
      'vehicleNumber', 'vehicleLocation', 'vehicleType', 'effectiveDate', 'notes', 'returnCondition',
      'vehicleYear', 'vehicleMake', 'vehicleModel'
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
          location: technicianOffboard.vehicleLocation,
          condition: technicianOffboard.returnCondition,
          type: technicianOffboard.vehicleType,
          year: technicianOffboard.vehicleYear,
          make: technicianOffboard.vehicleMake,
          model: technicianOffboard.vehicleModel
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
        description: `IMMEDIATE TASK: Stop truck stock replenishment for ${technicianOffboard.techName} (${technicianOffboard.techRacfId}). Vehicle: ${technicianOffboard.vehicleNumber} (${technicianOffboard.vehicleYear} ${technicianOffboard.vehicleMake} ${technicianOffboard.vehicleModel}). Last day: ${technicianOffboard.lastDayWorked}. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
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
          lastDayWorked: technicianOffboard.lastDayWorked
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
      effectiveDate: "",
      notes: "",
      returnCondition: "",
      vehicleYear: "",
      vehicleMake: "",
      vehicleModel: ""
    });
    setHolmanLookupResult(null);
    setLocationOptions([]);
    setSelectedLocationId('');
    setCustomLocation({ type: 'address', address: '', latitude: '', longitude: '' });
    
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
                    <div className="space-y-2">
                      <Label htmlFor="techSearch">Search Technician *</Label>
                      <TechCombobox
                        value={technicianOffboard.techName}
                        onSelect={async (tech) => {
                          if (tech) {
                            const startTime = performance.now();
                            console.log(`[TIMING] Tech selection started for: ${tech.techName}`);
                            
                            // Clear previous technician's data first
                            setLocationOptions([]);
                            setSelectedLocationId('');
                            setCustomLocation({ type: 'address', address: '', latitude: '', longitude: '' });
                            setTpmsLookupResult(null);
                            setHolmanLookupResult(null);
                            
                            // Set basic tech info and clear vehicle fields
                            setTechnicianOffboard(prev => ({
                              ...prev,
                              employeeId: tech.employeeId,
                              techRacfId: tech.techRacfid,
                              techName: tech.techName,
                              vehicleNumber: '',
                              vehicleYear: '',
                              vehicleMake: '',
                              vehicleModel: '',
                              vehicleLocation: '',
                              effectiveDate: '',
                              lastDayWorked: ''
                            }));

                            // Auto-lookup termed tech dates (effectiveDate, lastDayWorked)
                            if (tech.employeeId) {
                              try {
                                const termedStart = performance.now();
                                const termedResponse = await fetch(`/api/termed-techs/lookup/${encodeURIComponent(tech.employeeId)}`, {
                                  credentials: 'include'
                                });
                                const termedResult = await termedResponse.json();
                                console.log(`[TIMING] Termed tech lookup: ${(performance.now() - termedStart).toFixed(0)}ms`);
                                
                                if (termedResult.found) {
                                  setTechnicianOffboard(prev => ({
                                    ...prev,
                                    effectiveDate: termedResult.effectiveDate ? new Date(termedResult.effectiveDate).toISOString().split('T')[0] : prev.effectiveDate,
                                    lastDayWorked: termedResult.lastDayWorked ? new Date(termedResult.lastDayWorked).toISOString().split('T')[0] : prev.lastDayWorked
                                  }));
                                  toast({
                                    title: "Termination Dates Found",
                                    description: `Auto-filled dates from termination records`,
                                  });
                                }
                              } catch (termedError) {
                                console.log('Termed tech lookup - tech not in terminated list:', termedError);
                              }
                            }

                            // Auto-lookup vehicle and addresses from Snowflake TPMS data
                            if (tech.techRacfid) {
                              setIsLookingUpTruck(true);
                              
                              try {
                                // Fetch TPMS addresses from Snowflake
                                const tpmsStart = performance.now();
                                const tpmsResponse = await fetch(`/api/snowflake/tech-addresses/${encodeURIComponent(tech.techRacfid)}`, {
                                  credentials: 'include'
                                });
                                const tpmsResult = await tpmsResponse.json();
                                console.log(`[TIMING] TPMS/Snowflake lookup: ${(performance.now() - tpmsStart).toFixed(0)}ms`);
                                setTpmsLookupResult(tpmsResult);

                                // Build location options list
                                const newLocationOptions: LocationOption[] = [];
                                const formatTimestamp = (date: Date) => {
                                  const dateStr = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                                  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                                  return `${dateStr} ${timeStr}`;
                                };
                                const todayMidnight = new Date();
                                todayMidnight.setHours(0, 0, 0, 0);
                                const today = formatTimestamp(todayMidnight);

                                // Set truck number if found
                                let truckNo = '';
                                if (tpmsResult.success && tpmsResult.truckNo) {
                                  truckNo = tpmsResult.truckNo.trim();
                                  setTechnicianOffboard(prev => ({
                                    ...prev,
                                    vehicleNumber: truckNo
                                  }));
                                  
                                  toast({
                                    title: "Truck Found",
                                    description: `Auto-filled truck ${truckNo} for ${tech.techRacfid}`,
                                  });
                                }

                                // Add TPMS addresses with file date (default to midnight if no time)
                                let fileDate = today;
                                if (tpmsResult.fileDate) {
                                  const fileDateObj = new Date(tpmsResult.fileDate);
                                  // If the date has no time component (midnight), keep it as midnight
                                  if (fileDateObj.getHours() === 0 && fileDateObj.getMinutes() === 0 && fileDateObj.getSeconds() === 0) {
                                    fileDate = formatTimestamp(fileDateObj);
                                  } else {
                                    fileDate = formatTimestamp(fileDateObj);
                                  }
                                }
                                
                                if (tpmsResult.success && tpmsResult.primaryAddress && tpmsResult.primaryAddress.trim() !== ',') {
                                  newLocationOptions.push({
                                    id: 'tpms-primary',
                                    source: 'tpms',
                                    label: 'TPMS Primary Address',
                                    address: tpmsResult.primaryAddress,
                                    lastUpdated: fileDate
                                  });
                                }
                                if (tpmsResult.success && tpmsResult.reassortAddress && tpmsResult.reassortAddress.trim() !== ',') {
                                  newLocationOptions.push({
                                    id: 'tpms-reassort',
                                    source: 'tpms',
                                    label: 'TPMS Reassort Address',
                                    address: tpmsResult.reassortAddress,
                                    lastUpdated: fileDate
                                  });
                                }
                                if (tpmsResult.success && tpmsResult.alternateAddress && tpmsResult.alternateAddress.trim() !== ',') {
                                  newLocationOptions.push({
                                    id: 'tpms-alternate',
                                    source: 'tpms',
                                    label: 'TPMS Alternate Address',
                                    address: tpmsResult.alternateAddress,
                                    lastUpdated: fileDate
                                  });
                                }
                                if (tpmsResult.success && tpmsResult.returnAddress && tpmsResult.returnAddress.trim() !== ',') {
                                  newLocationOptions.push({
                                    id: 'tpms-return',
                                    source: 'tpms',
                                    label: 'TPMS Return Address',
                                    address: tpmsResult.returnAddress,
                                    lastUpdated: fileDate
                                  });
                                }

                                // Auto-lookup vehicle details from Holman and Samsara GPS in parallel
                                if (truckNo) {
                                  setIsLookingUpHolman(true);
                                  setHolmanLookupResult(null);
                                  const paddedVehicleNum = truckNo.padStart(6, '0');
                                  
                                  // Run both lookups in parallel for faster response
                                  const parallelStart = performance.now();
                                  const [holmanResult, samsaraResult] = await Promise.all([
                                    fetch(`/api/holman/vehicle/${encodeURIComponent(paddedVehicleNum)}`, { credentials: 'include' })
                                      .then(res => res.json())
                                      .catch(err => { console.error('Holman lookup error:', err); return null; }),
                                    fetch(`/api/samsara/vehicle/${encodeURIComponent(truckNo)}`, { credentials: 'include' })
                                      .then(res => res.json())
                                      .catch(err => { console.log('Samsara GPS lookup error:', err); return { found: false }; })
                                  ]);

                                  console.log(`[TIMING] Holman + Samsara parallel: ${(performance.now() - parallelStart).toFixed(0)}ms`);
                                  
                                  // Process Holman result
                                  if (holmanResult) {
                                    setHolmanLookupResult(holmanResult);
                                    if (holmanResult.success && holmanResult.vehicle) {
                                      setTechnicianOffboard(prev => ({
                                        ...prev,
                                        vehicleYear: holmanResult.vehicle.year || '',
                                        vehicleMake: holmanResult.vehicle.make || '',
                                        vehicleModel: holmanResult.vehicle.model || ''
                                      }));
                                      
                                      // Add Holman address row (address may come from vehicles API if available)
                                      newLocationOptions.push({
                                        id: 'holman-address',
                                        source: 'holman',
                                        label: 'Holman Address',
                                        address: holmanResult.vehicle.garagingAddress || '',
                                        lastUpdated: today
                                      });
                                      
                                      toast({
                                        title: "Vehicle Info Found",
                                        description: `Auto-filled: ${holmanResult.vehicle.year} ${holmanResult.vehicle.make} ${holmanResult.vehicle.model}`,
                                      });
                                    }
                                  }
                                  setIsLookingUpHolman(false);

                                  // Process Samsara result
                                  if (samsaraResult && samsaraResult.found && samsaraResult.address) {
                                    let samsaraDate = today;
                                    if (samsaraResult.lastUpdated) {
                                      const samsaraDateObj = new Date(samsaraResult.lastUpdated);
                                      samsaraDate = formatTimestamp(samsaraDateObj);
                                    }
                                    
                                    newLocationOptions.unshift({
                                      id: 'samsara-gps',
                                      source: 'samsara',
                                      label: 'Samsara GPS',
                                      address: samsaraResult.address,
                                      latitude: samsaraResult.latitude,
                                      longitude: samsaraResult.longitude,
                                      lastUpdated: samsaraDate
                                    });
                                    
                                    // Auto-select Samsara GPS as default since it's most current
                                    setSelectedLocationId('samsara-gps');
                                    setTechnicianOffboard(prev => ({
                                      ...prev,
                                      vehicleLocation: samsaraResult.address
                                    }));
                                    toast({
                                      title: "GPS Location Found",
                                      description: `Last known: ${samsaraResult.address.substring(0, 50)}...`,
                                    });
                                  }
                                }

                                // Update location options
                                setLocationOptions(newLocationOptions);
                                console.log(`[TIMING] ✅ TOTAL auto-fill time: ${(performance.now() - startTime).toFixed(0)}ms`);
                                
                              } catch (tpmsError) {
                                console.error('TPMS/Snowflake lookup error:', tpmsError);
                              } finally {
                                setIsLookingUpTruck(false);
                              }
                            } else {
                              console.log(`[TIMING] ✅ TOTAL auto-fill time (no RACF ID): ${(performance.now() - startTime).toFixed(0)}ms`);
                            }
                          } else {
                            setTechnicianOffboard(prev => ({
                              ...prev,
                              employeeId: "",
                              techRacfId: "",
                              techName: "",
                              vehicleNumber: "",
                              vehicleYear: "",
                              vehicleMake: "",
                              vehicleModel: ""
                            }));
                            setTpmsLookupResult(null);
                            setHolmanLookupResult(null);
                            setLocationOptions([]);
                            setSelectedLocationId('');
                            setCustomLocation({ type: 'address', address: '', latitude: '', longitude: '' });
                          }
                        }}
                        searchField="techName"
                        placeholder="Search by ID, RACF ID, or Name..."
                        data-testid="input-tech-search"
                      />
                      <p className="text-xs text-muted-foreground">
                        Search the tech roster - selecting a technician will auto-fill all available information
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employeeId">Employee ID *</Label>
                        <Input
                          id="employeeId"
                          placeholder="Auto-filled from search"
                          value={technicianOffboard.employeeId}
                          readOnly
                          className="bg-muted"
                          data-testid="input-employee-id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="techRacfId">Tech RACF ID *</Label>
                        <Input
                          id="techRacfId"
                          placeholder="Auto-filled from search"
                          value={technicianOffboard.techRacfId}
                          readOnly
                          className="bg-muted"
                          data-testid="input-tech-racfid"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="techName">Tech Name *</Label>
                        <Input
                          id="techName"
                          placeholder="Auto-filled from search"
                          value={technicianOffboard.techName}
                          readOnly
                          className="bg-muted"
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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="vehicleYear">Year</Label>
                        <div className="flex gap-2">
                          <Input
                            id="vehicleYear"
                            placeholder="Year"
                            value={technicianOffboard.vehicleYear}
                            onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, vehicleYear: e.target.value })}
                            data-testid="input-vehicle-year"
                            className="flex-1"
                            readOnly
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleHolmanLookup(technicianOffboard.vehicleNumber)}
                            disabled={isLookingUpHolman || !technicianOffboard.vehicleNumber}
                            title="Look up vehicle info from Holman"
                            data-testid="button-holman-lookup"
                          >
                            {isLookingUpHolman ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Car className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vehicleMake">Make</Label>
                        <Input
                          id="vehicleMake"
                          placeholder="Make"
                          value={technicianOffboard.vehicleMake}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, vehicleMake: e.target.value })}
                          data-testid="input-vehicle-make"
                          readOnly
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vehicleModel">Model</Label>
                        <Input
                          id="vehicleModel"
                          placeholder="Model"
                          value={technicianOffboard.vehicleModel}
                          onChange={(e) => setTechnicianOffboard({ ...technicianOffboard, vehicleModel: e.target.value })}
                          data-testid="input-vehicle-model"
                          readOnly
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-4">
                      Enter Vehicle Number above, then click the car icon to auto-fill Year/Make/Model from Holman
                    </p>
                    {holmanLookupResult && (
                      <div className={`text-xs p-2 rounded ${holmanLookupResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                        {holmanLookupResult.success 
                          ? `Found: ${holmanLookupResult.vehicle?.year} ${holmanLookupResult.vehicle?.make} ${holmanLookupResult.vehicle?.model}`
                          : `Lookup failed: ${holmanLookupResult.error || 'Unknown error'}`}
                      </div>
                    )}

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

                    <div className="space-y-3">
                      <Label>Vehicle Location *</Label>
                      
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="w-10 px-3 py-2 text-left"></th>
                              <th className="px-3 py-2 text-left font-medium">Location Source</th>
                              <th className="px-3 py-2 text-left font-medium">Address</th>
                              <th className="w-24 px-3 py-2 text-left font-medium">As Of</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(() => {
                              const samsaraOption = locationOptions.find(o => o.id === 'samsara-gps');
                              const tpmsPrimary = locationOptions.find(o => o.id === 'tpms-primary');
                              const tpmsReassort = locationOptions.find(o => o.id === 'tpms-reassort');
                              const tpmsAlternate = locationOptions.find(o => o.id === 'tpms-alternate');
                              const tpmsReturn = locationOptions.find(o => o.id === 'tpms-return');
                              const holmanOption = locationOptions.find(o => o.id === 'holman-address');
                              const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                              
                              const rows = [
                                { id: 'samsara-gps', label: 'Samsara GPS', address: samsaraOption?.address || '', asOf: samsaraOption?.lastUpdated || '', hasData: !!samsaraOption },
                                { id: 'tpms-primary', label: 'TPMS Primary Address', address: tpmsPrimary?.address || '', asOf: tpmsPrimary?.lastUpdated || '', hasData: !!tpmsPrimary },
                                { id: 'tpms-reassort', label: 'TPMS Reassort Address', address: tpmsReassort?.address || '', asOf: tpmsReassort?.lastUpdated || '', hasData: !!tpmsReassort },
                                { id: 'tpms-alternate', label: 'TPMS Alternate Address', address: tpmsAlternate?.address || '', asOf: tpmsAlternate?.lastUpdated || '', hasData: !!tpmsAlternate },
                                { id: 'tpms-return', label: 'TPMS Return Address', address: tpmsReturn?.address || '', asOf: tpmsReturn?.lastUpdated || '', hasData: !!tpmsReturn },
                                { id: 'holman-address', label: 'Holman Address', address: holmanOption?.address || '', asOf: holmanOption?.lastUpdated || '', hasData: !!holmanOption },
                              ];
                              
                              return rows.map((row) => (
                                <tr 
                                  key={row.id}
                                  className={`hover:bg-accent/50 cursor-pointer transition-colors ${selectedLocationId === row.id ? 'bg-accent/30' : ''} ${!row.hasData ? 'opacity-50' : ''}`}
                                  onClick={() => {
                                    if (row.address) {
                                      setSelectedLocationId(row.id);
                                      setTechnicianOffboard(prev => ({
                                        ...prev,
                                        vehicleLocation: row.address
                                      }));
                                    }
                                  }}
                                >
                                  <td className="px-3 py-2">
                                    <input 
                                      type="checkbox" 
                                      checked={selectedLocationId === row.id}
                                      disabled={!row.address}
                                      onChange={() => {
                                        if (row.address) {
                                          setSelectedLocationId(row.id);
                                          setTechnicianOffboard(prev => ({
                                            ...prev,
                                            vehicleLocation: row.address
                                          }));
                                        }
                                      }}
                                      className="h-4 w-4 rounded border-gray-300"
                                      data-testid={`checkbox-location-${row.id}`}
                                    />
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">{row.label}</td>
                                  <td className="px-3 py-2">{row.address}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.asOf}</td>
                                </tr>
                              ));
                            })()}
                            <tr 
                              className={`hover:bg-accent/50 cursor-pointer transition-colors ${selectedLocationId === 'other' ? 'bg-accent/30' : ''}`}
                              onClick={() => setSelectedLocationId('other')}
                            >
                              <td className="px-3 py-2">
                                <input 
                                  type="checkbox" 
                                  checked={selectedLocationId === 'other'}
                                  onChange={() => setSelectedLocationId('other')}
                                  className="h-4 w-4 rounded border-gray-300"
                                  data-testid="checkbox-location-other"
                                />
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">Other:</td>
                              <td className="px-3 py-2">
                                {selectedLocationId === 'other' ? (
                                  <Input
                                    placeholder="Enter address manually"
                                    value={customLocation.address}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      setCustomLocation(prev => ({ ...prev, address: e.target.value }));
                                      setTechnicianOffboard(prev => ({
                                        ...prev,
                                        vehicleLocation: e.target.value
                                      }));
                                    }}
                                    className="h-8"
                                    data-testid="input-custom-address"
                                  />
                                ) : (
                                  <span className="text-muted-foreground italic"></span>
                                )}
                              </td>
                              <td className="px-3 py-2"></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
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
