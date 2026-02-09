import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWorkTemplate } from "@/hooks/use-work-template";
import { TemplateChecklist } from "./template-checklist";
import { 
  Clock, 
  User, 
  DollarSign, 
  ClipboardCheck, 
  FileText, 
  Calendar,
  CheckCircle,
  Save,
  X,
  AlertTriangle,
  BookOpen,
  ListTodo,
  Truck,
  Briefcase,
  Smartphone,
  CreditCard,
  Package,
  Wifi,
} from "lucide-react";
import type { QueueItem, CombinedQueueItem, QueueModule, User as UserType } from "@shared/schema";
import { useDebouncedSave } from "@/hooks/use-debounced-save";

interface WorkModuleDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  queueItem: QueueItem | CombinedQueueItem | null;
  module?: QueueModule;
  currentUser?: UserType;
  users?: UserType[];
  onTaskCompleted?: () => void;
}

export function WorkModuleDialog({
  isOpen,
  onOpenChange,
  queueItem,
  module,
  currentUser,
  users = [],
  onTaskCompleted
}: WorkModuleDialogProps) {
  const { toast } = useToast();
  
  // Use ref to track if we've already started work to prevent race conditions
  const hasStartedWorkRef = useRef<string | null>(null);
  
  // Form state
  const [decisionType, setDecisionType] = useState<string>("");
  const [finalResolution, setFinalResolution] = useState<string>("");
  const [completeFinal, setCompleteFinal] = useState<boolean>(false);
  const [workNotes, setWorkNotes] = useState<string>("");
  const [requiresReview, setRequiresReview] = useState<boolean>(false);
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [adminNotes, setAdminNotes] = useState<string>("");
  const [approvedAmount, setApprovedAmount] = useState<string>("");

  const isAssetsModule = module === 'assets';

  // Fetch fresh task data to avoid stale status issues
  const { data: freshQueueItem } = useQuery<QueueItem>({
    queryKey: module 
      ? [`/api/${module}-queue`, queueItem?.id] 
      : [`/api/queue-items`, queueItem?.id],
    queryFn: async () => {
      if (!queueItem?.id) throw new Error('No queue item ID');
      const endpoint = module 
        ? `/api/${module}-queue/${queueItem.id}`
        : `/api/queue-items/${queueItem.id}`;
      const response = await apiRequest("GET", endpoint);
      return response.json();
    },
    enabled: !!queueItem?.id && isOpen,
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Use fresh data when available, fallback to prop
  const currentQueueItem = freshQueueItem || queueItem;

  // Parse task data
  const taskData = currentQueueItem?.data ? JSON.parse(currentQueueItem.data) : {};
  const assignedUser = users.find(u => u.id === currentQueueItem?.assignedTo);

  // Get employee/technician identifiers from task data
  const techData = taskData.technician || taskData.employee || {};
  const employeeLookupId = techData.employeeId || techData.techRacfid || techData.enterpriseId || '';

  // Fetch employee roster data from all_techs to get district, contact info, and fleet info
  const { data: rosterData } = useQuery<{ 
    found: boolean;
    employeeId?: string;
    techRacfid?: string;
    techName?: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    districtNo?: string;
    planningAreaName?: string;
    employmentStatus?: string;
    cellPhone?: string;
    mainPhone?: string;
    homePhone?: string;
    homeAddr1?: string;
    homeAddr2?: string;
    homeCity?: string;
    homeState?: string;
    homePostal?: string;
    truckLu?: string;
  }>({
    queryKey: ['/api/all-techs/lookup', employeeLookupId],
    queryFn: async () => {
      if (!employeeLookupId) return { found: false };
      const response = await apiRequest("GET", `/api/all-techs/lookup/${employeeLookupId}`);
      return response.json();
    },
    enabled: !!employeeLookupId && isOpen,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Merge roster data with task data for complete employee info
  const enrichedEmployeeData = {
    ...techData,
    // Override with roster data if available
    district: rosterData?.found ? rosterData.districtNo : techData.district,
    districtNo: rosterData?.found ? rosterData.districtNo : techData.districtNo,
    planningArea: rosterData?.found ? rosterData.planningAreaName : techData.planningArea,
    jobTitle: rosterData?.found ? rosterData.jobTitle : techData.jobTitle,
    employmentStatus: rosterData?.found ? rosterData.employmentStatus : techData.employmentStatus,
    // Contact info from roster
    cellPhone: rosterData?.found ? rosterData.cellPhone : techData.cellPhone,
    mainPhone: rosterData?.found ? rosterData.mainPhone : techData.mainPhone,
    homePhone: rosterData?.found ? rosterData.homePhone : techData.homePhone,
    // Home address from roster
    homeAddr1: rosterData?.found ? rosterData.homeAddr1 : techData.homeAddr1,
    homeAddr2: rosterData?.found ? rosterData.homeAddr2 : techData.homeAddr2,
    homeCity: rosterData?.found ? rosterData.homeCity : techData.homeCity,
    homeState: rosterData?.found ? rosterData.homeState : techData.homeState,
    homePostal: rosterData?.found ? rosterData.homePostal : techData.homePostal,
    // Fleet info from roster
    truckLu: rosterData?.found ? rosterData.truckLu : techData.truckLu,
  };

  // Format phone number helper
  const formatPhone = (phone: string | null | undefined): string => {
    if (!phone) return 'N/A';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0,3)})${digits.slice(3,6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === '1') {
      return `(${digits.slice(1,4)})${digits.slice(4,7)}-${digits.slice(7)}`;
    }
    return phone;
  };

  // Load work template for this task
  const {
    template,
    checklistState,
    isLoading: templateLoading,
    error: templateError,
    warning: templateWarning,
    updateStepProgress,
    updateSubstepProgress,
    calculateOverallProgress,
    getEstimatedTimeRemaining,
    isStepCompleted,
    isSubstepCompleted,
    getStepNotes,
    getSubstepNotes,
  } = useWorkTemplate({ queueItem: currentQueueItem, module });

  type TaskKey = 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel';

  const [assetsTaskState, setAssetsTaskState] = useState<Record<TaskKey, boolean>>({
    taskToolsReturn: false,
    taskIphoneReturn: false,
    taskDisconnectedLine: false,
    taskDisconnectedMPayment: false,
    taskCloseSegnoOrders: false,
    taskCreateShippingLabel: false,
  });
  const [assetsCarrier, setAssetsCarrier] = useState<string>("");

  const { saveStatus: assetsSaveStatus, save: assetsDebouncedSave } = useDebouncedSave({
    itemId: currentQueueItem?.id || '',
    module: 'assets',
  });

  useEffect(() => {
    if (currentQueueItem && isAssetsModule) {
      setAssetsTaskState({
        taskToolsReturn: (currentQueueItem as any).taskToolsReturn ?? false,
        taskIphoneReturn: (currentQueueItem as any).taskIphoneReturn ?? false,
        taskDisconnectedLine: (currentQueueItem as any).taskDisconnectedLine ?? false,
        taskDisconnectedMPayment: (currentQueueItem as any).taskDisconnectedMPayment ?? false,
        taskCloseSegnoOrders: (currentQueueItem as any).taskCloseSegnoOrders ?? false,
        taskCreateShippingLabel: (currentQueueItem as any).taskCreateShippingLabel ?? false,
      });
      setAssetsCarrier((currentQueueItem as any).carrier || "");
    }
  }, [currentQueueItem, isAssetsModule]);

  const handleAssetsTaskChange = (key: TaskKey, checked: boolean) => {
    const newState = { ...assetsTaskState, [key]: checked };
    setAssetsTaskState(newState);
    assetsDebouncedSave({ [key]: checked });
  };

  const handleAssetsCarrierChange = (value: string) => {
    setAssetsCarrier(value);
    assetsDebouncedSave({ carrier: value });
  };

  const assetsCompletedCount = Object.values(assetsTaskState).filter(Boolean).length;

  const assetsTaskItems: { key: TaskKey; label: string; desc: string; icon: any; showCarrier?: boolean }[] = [
    { key: "taskToolsReturn", label: "Tools Return Asset", desc: "Verify all assigned tools returned", icon: Briefcase },
    { key: "taskIphoneReturn", label: "iPhone Return Asset", desc: "Check condition and unlock status", icon: Smartphone },
    { key: "taskDisconnectedLine", label: "Disconnect Phone Line", desc: "Suspend service", icon: Wifi, showCarrier: true },
    { key: "taskDisconnectedMPayment", label: "Deactivate mPayment", desc: "Remove access in Temples system", icon: CreditCard },
    { key: "taskCloseSegnoOrders", label: "Close Segno Orders", desc: "Ensure no open work orders remain", icon: FileText },
    { key: "taskCreateShippingLabel", label: "Create UPS Shipping Label", desc: "Generate QR code for tech", icon: Package },
  ];

  useEffect(() => {
    if (currentQueueItem) {
      // Pre-fill form with existing data
      setWorkNotes(currentQueueItem.notes || "");
      setAssignedTo(currentQueueItem.assignedTo || "");
      setAdminNotes(""); // Reset admin notes for new work session
      setDecisionType("");
      setFinalResolution("");
      setCompleteFinal(false);
      setRequiresReview(false);
      setApprovedAmount("");
    }
  }, [currentQueueItem]);

  // Save progress mutation - Enhanced with better error handling and logging
  const saveProgressMutation = useMutation({
    mutationFn: async (data: any) => {
      console.log('Saving progress for task:', currentQueueItem?.id, 'Current status:', currentQueueItem?.status);
      
      if (!module) {
        throw new Error('Module is required for saving progress');
      }
      
      if (!currentQueueItem?.id) {
        throw new Error('Queue item ID is required for saving progress');
      }
      
      // Use the correct endpoint for general queue item progress
      const endpoint = `/api/queues/${module}/${currentQueueItem.id}/save-progress`;
      
      console.log('Calling save progress endpoint:', endpoint);
      return apiRequest("PATCH", endpoint, data);
    },
    onSuccess: (data) => {
      console.log('Progress saved successfully for task:', currentQueueItem?.id, 'Response:', data);
      // Invalidate specific queue item queries first for immediate UI update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: currentQueueItem?.id }],
        exact: false
      });
      // Then invalidate broader queries
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/${module}-queue`],
        exact: false
      });
      queryClient.invalidateQueries({ queryKey: [`/api/work-progress/${currentQueueItem?.id}`] });
      
      toast({
        title: "Progress Saved",
        description: "Your work progress has been saved successfully.",
      });
    },
    onError: (error) => {
      console.error('Failed to save progress for task:', currentQueueItem?.id, 'Error:', error);
      toast({
        title: "Error",
        description: "Failed to save progress. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Complete task mutation - Enhanced with logging and validation
  const completeTaskMutation = useMutation({
    mutationFn: async () => {
      console.log('Completing task:', currentQueueItem?.id, 'Current status:', currentQueueItem?.status);
      
      // Validate that task is in the correct state for completion
      if (currentQueueItem?.status !== 'in_progress') {
        throw new Error(`Cannot complete task with status: ${currentQueueItem?.status}. Task must be in_progress.`);
      }
      
      const endpoint = module 
        ? `/api/queues/${module}/${currentQueueItem?.id}/complete`
        : `/api/queue-items/${currentQueueItem?.id}/complete`;
      
      return apiRequest("PATCH", endpoint, {
        completedBy: currentUser?.id,
        finalNotes: workNotes,
        decisionType,
        finalResolution,
        requiresReview,
        adminNotes,
        approvedAmount,
        // Include final template state
        finalChecklistState: template ? checklistState : undefined,
        templateId: template?.id
      });
    },
    onSuccess: (data) => {
      console.log('Task completed successfully:', currentQueueItem?.id, 'Response:', data);
      // Invalidate specific queries first for immediate update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: currentQueueItem?.id }],
        exact: false
      });
      // Then invalidate broader queries
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/${module}-queue`],
        exact: false
      });
      
      toast({
        title: "Task Completed",
        description: "Task has been marked as complete.",
      });
      onTaskCompleted?.();
      onOpenChange(false);
    },
    onError: (error: any) => {
      console.error('Failed to complete task:', currentQueueItem?.id, 'Error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete task. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Start work mutation - Enhanced with logging and validation
  const startWorkMutation = useMutation({
    mutationFn: async () => {
      console.log('Starting work on task:', currentQueueItem?.id, 'Current status:', currentQueueItem?.status);
      
      // Validate that task can be started
      if (!currentQueueItem?.id) {
        console.error('Cannot start work: No task ID available');
        throw new Error('No task ID available');
      }
      
      if (currentQueueItem?.status !== 'pending') {
        console.warn('Task already started or completed:', currentQueueItem?.id, 'Status:', currentQueueItem?.status);
        return; // Don't make API call if already started
      }
      
      const endpoint = module 
        ? `/api/queues/${module}/${currentQueueItem?.id}/start-work`
        : `/api/queue-items/${currentQueueItem?.id}/start-work`;
      
      return apiRequest("PATCH", endpoint);
    },
    onSuccess: (data) => {
      console.log('Work started successfully for task:', currentQueueItem?.id, 'Response:', data);
      // Immediately invalidate specific item query for fast UI update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: currentQueueItem?.id }],
        exact: false
      });
      // Then invalidate broader queries
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      queryClient.invalidateQueries({ 
        queryKey: [`/api/${module}-queue`],
        exact: false
      });
    },
    onError: (error) => {
      console.error('Failed to start work on task:', currentQueueItem?.id, 'Error:', error);
      toast({
        title: "Error",
        description: "Failed to start work on this task. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    // Auto-start work if opening dialog and task is still pending
    // Use ref to prevent multiple start attempts for the same task
    if (isOpen && 
        currentQueueItem?.status === "pending" && 
        currentUser && 
        !startWorkMutation.isPending && 
        currentQueueItem?.id && 
        hasStartedWorkRef.current !== currentQueueItem.id) {
      
      console.log('Auto-starting work for task:', currentQueueItem?.id, 'Status:', currentQueueItem?.status);
      hasStartedWorkRef.current = currentQueueItem.id; // Mark this task as having start attempted
      startWorkMutation.mutate();
    }
  }, [isOpen, currentQueueItem?.status, currentQueueItem?.id, currentUser]); // Only essential dependencies
  
  // Reset the ref when dialog closes or different item opens
  useEffect(() => {
    if (!isOpen) {
      hasStartedWorkRef.current = null;
    }
  }, [isOpen]);

  const handleSaveProgress = () => {
    // Collect stepNotes and substepNotes from template
    let stepNotes: Record<string, string> = {};
    let substepNotes: Record<string, Record<string, string>> = {};
    
    if (template) {
      template.steps.forEach(step => {
        const stepNote = getStepNotes(step.id);
        if (stepNote) {
          stepNotes[step.id] = stepNote;
        }
        
        if (step.substeps) {
          step.substeps.forEach(substep => {
            const substepNote = getSubstepNotes(step.id, substep.id);
            if (substepNote) {
              if (!substepNotes[step.id]) {
                substepNotes[step.id] = {};
              }
              substepNotes[step.id][substep.id] = substepNote;
            }
          });
        }
      });
    }

    const progressData = {
      notes: workNotes,
      adminNotes,
      assignedTo,
      lastWorkedBy: currentUser?.id,
      workInProgress: true,
      approvedAmount,
      // Include template progress
      checklistState: template ? checklistState : undefined,
      stepNotes: Object.keys(stepNotes).length > 0 ? stepNotes : undefined,
      substepNotes: Object.keys(substepNotes).length > 0 ? substepNotes : undefined,
      templateId: template?.id
    };
    
    saveProgressMutation.mutate(progressData);
  };

  const handleCompleteTask = () => {
    // Check if template requires all steps to be completed
    if (template) {
      const requiredStepsCompleted = template.steps
        .filter(step => step.required)
        .every(step => {
          if (step.substeps && step.substeps.length > 0) {
            return step.substeps
              .filter(substep => substep.required)
              .every(substep => isSubstepCompleted(step.id, substep.id));
          }
          return isStepCompleted(step.id);
        });

      if (!requiredStepsCompleted) {
        toast({
          title: "Incomplete Required Steps",
          description: "Please complete all required steps in the checklist before finalizing the task.",
          variant: "destructive",
        });
        return;
      }
    }
    
    completeTaskMutation.mutate();
  };

  const handleCancel = () => {
    console.log('Canceling dialog for task:', currentQueueItem?.id, 'Current status:', currentQueueItem?.status);
    // Just close the dialog - no status changes
    onOpenChange(false);
  };

  // Extract financial details from task data
  const getFinancialDetails = () => {
    const formData = taskData.formData || {};
    return {
      laborRefund: formData.laborRefund || "$0.00",
      partsRefund: formData.partsRefund || "$0.00", 
      taxes: formData.taxes || "$0.00",
      total: formData.totalAmount || "$0.00"
    };
  };

  // Extract request details - uses enrichedEmployeeData which includes roster data
  const getRequestDetails = () => {
    // Look for district in multiple places
    const district = enrichedEmployeeData.district || 
                     enrichedEmployeeData.districtNo || 
                     taskData.district || 
                     taskData.districtNo ||
                     taskData.employee?.district ||
                     taskData.employee?.districtNo ||
                     taskData.technician?.district ||
                     taskData.technician?.districtNo ||
                     "N/A";
    
    // Look for phone in multiple places for contact info
    const phone = enrichedEmployeeData.phone || 
                  enrichedEmployeeData.phoneNumber || 
                  enrichedEmployeeData.cellPhone ||
                  taskData.phone || 
                  taskData.phoneNumber || 
                  taskData.cellPhone ||
                  taskData.employee?.phone ||
                  taskData.employee?.phoneNumber ||
                  taskData.technician?.phone ||
                  taskData.technician?.phoneNumber ||
                  null;
    
    return {
      requestId: currentQueueItem?.id?.slice(-8) || "N/A",
      employeeId: enrichedEmployeeData.employeeId || taskData.employeeId || taskData.employee?.employeeId || "N/A",
      enterpriseId: enrichedEmployeeData.techRacfid || enrichedEmployeeData.enterpriseId || enrichedEmployeeData.racfId || 
                    taskData.enterpriseId || taskData.racfId || taskData.employee?.enterpriseId || taskData.technician?.enterpriseId || "N/A",
      district,
      phone,
      serviceOrder: taskData.serviceOrder || taskData.workflowId || currentQueueItem?.id?.slice(-6) || "N/A",
      status: currentQueueItem?.status || "pending"
    };
  };

  const requestDetails = getRequestDetails();
  const financialDetails = getFinancialDetails();

  if (!queueItem) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Work Module - {queueItem.title}
          </DialogTitle>
          <DialogDescription>
            Complete the work for this {queueItem.workflowType} task
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Request Details Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" />
                Request Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Request ID</Label>
                  <p className="font-mono text-sm" data-testid="text-request-id">{requestDetails.requestId}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Employee ID</Label>
                  <p className="font-mono text-sm" data-testid="text-employee-id">{requestDetails.employeeId}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Enterprise ID</Label>
                  <p className="font-mono text-sm" data-testid="text-enterprise-id">{requestDetails.enterpriseId}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">District</Label>
                  <p className="text-sm" data-testid="text-district">{requestDetails.district}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Contact Phone</Label>
                  <p className="text-sm" data-testid="text-contact-phone">{requestDetails.phone || "N/A"}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Service Order</Label>
                  <p className="font-mono text-sm" data-testid="text-service-order">{requestDetails.serviceOrder}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Status</Label>
                  <Badge variant={requestDetails.status === "completed" ? "default" : "secondary"} data-testid="badge-status">
                    {requestDetails.status}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Template Checklist Section */}
          <Tabs defaultValue="checklist" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="checklist" className="flex items-center gap-2" data-testid="tab-task-checklist">
                <ListTodo className="h-4 w-4" />
                Task Checklist
              </TabsTrigger>
              <TabsTrigger value="instructions" className="flex items-center gap-2" data-testid="tab-employee-details">
                <User className="h-4 w-4" />
                Employee Details
              </TabsTrigger>
              <TabsTrigger value="fleet" className="flex items-center gap-2" data-testid="tab-fleet-details">
                <Truck className="h-4 w-4" />
                Fleet Details
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="checklist" className="space-y-4">
              {isAssetsModule ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Recovery Tasks
                    </CardTitle>
                    <CardDescription className="flex items-center justify-between">
                      <span>Complete each task as you work through this case</span>
                      <Badge variant="secondary" className="ml-2">
                        {assetsCompletedCount}/6 Complete
                      </Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-border">
                      {assetsTaskItems.map((task) => {
                        const Icon = task.icon;
                        const isChecked = assetsTaskState[task.key];
                        const isReadonly = currentQueueItem?.status === "completed";
                        return (
                          <label
                            key={task.key}
                            className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors ${isChecked ? "bg-muted/30" : ""} ${isReadonly ? "pointer-events-none opacity-70" : ""}`}
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(checked) => handleAssetsTaskChange(task.key, !!checked)}
                              className="mt-1"
                              disabled={isReadonly}
                            />
                            <div className="flex-1">
                              <div className={`text-sm font-medium ${isChecked ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                {task.label}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {task.showCarrier && (
                                  <Select value={assetsCarrier} onValueChange={handleAssetsCarrierChange} disabled={isReadonly}>
                                    <SelectTrigger className="h-6 w-[120px] text-xs">
                                      <SelectValue placeholder="Carrier" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="Verizon">Verizon</SelectItem>
                                      <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                                      <SelectItem value="AT&T">AT&T</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                                <span className="text-xs text-muted-foreground">{task.desc}</span>
                              </div>
                            </div>
                            <Icon className={`h-4 w-4 mt-1 ${isChecked ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
                          </label>
                        );
                      })}
                    </div>
                    {assetsSaveStatus !== "idle" && (
                      <div className="text-xs text-center py-2 border-t">
                        {assetsSaveStatus === "saving" && <span className="text-muted-foreground">Saving...</span>}
                        {assetsSaveStatus === "saved" && <span className="text-green-600">Saved</span>}
                        {assetsSaveStatus === "error" && <span className="text-red-600">Error saving</span>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <>
                  {templateLoading && (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-center p-8">
                          <div className="text-center space-y-2">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                            <p className="text-sm text-muted-foreground">Loading work template...</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {templateWarning && (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Using Default Template</p>
                            <p className="text-xs text-blue-700 dark:text-blue-300">{templateWarning}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {templateError && (
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Template Loading Error</p>
                            <p className="text-xs text-yellow-700 dark:text-yellow-300">{templateError}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {template && (
                    <TemplateChecklist
                      template={template}
                      isStepCompleted={isStepCompleted}
                      isSubstepCompleted={isSubstepCompleted}
                      updateStepProgress={updateStepProgress}
                      updateSubstepProgress={updateSubstepProgress}
                      getStepNotes={getStepNotes}
                      getSubstepNotes={getSubstepNotes}
                      overallProgress={calculateOverallProgress()}
                      estimatedTimeRemaining={getEstimatedTimeRemaining()}
                      readonly={currentQueueItem?.status === "completed"}
                    />
                  )}

                  {!template && !templateLoading && !templateError && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <ClipboardCheck className="h-4 w-4" />
                          Standard Task Instructions
                        </CardTitle>
                        <CardDescription>
                          Complete the following items to finish this task
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {taskData.instructions && Array.isArray(taskData.instructions) ? (
                          <div className="space-y-3">
                            {taskData.instructions.map((instruction: string, index: number) => (
                              <div key={index} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                                <Checkbox 
                                  id={`instruction-${index}`}
                                  className="mt-0.5"
                                  data-testid={`checkbox-instruction-${index}`}
                                />
                                <div className="flex-1">
                                  <Label 
                                    htmlFor={`instruction-${index}`}
                                    className="text-sm font-normal cursor-pointer leading-relaxed"
                                  >
                                    {instruction}
                                  </Label>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <p className="text-sm text-muted-foreground">No specific instructions available for this task.</p>
                            <p className="text-xs text-muted-foreground mt-1">Use your best judgment and department procedures.</p>
                          </div>
                        )}
                        
                        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                              Complete all necessary work and use the Final Disposition section below to mark the task as complete.
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="instructions" className="space-y-4">
              {/* Employee Details Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Employee Information
                  </CardTitle>
                  <CardDescription>
                    Complete Employee details and onboarding information
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Personal Information - Uses enrichedEmployeeData with roster lookup */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Personal Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Full Name</Label>
                        <p className="text-sm font-medium" data-testid="text-tech-name">
                          {enrichedEmployeeData.firstName && enrichedEmployeeData.lastName 
                            ? `${enrichedEmployeeData.firstName} ${enrichedEmployeeData.lastName}`
                            : taskData.firstName && taskData.lastName
                            ? `${taskData.firstName} ${taskData.lastName}`
                            : enrichedEmployeeData.techName || enrichedEmployeeData.name || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Employee ID</Label>
                        <p className="font-mono text-sm" data-testid="text-emp-employee-id">
                          {enrichedEmployeeData.employeeId || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Enterprise ID</Label>
                        <p className="font-mono text-sm" data-testid="text-emp-enterprise-id">
                          {enrichedEmployeeData.techRacfid || enrichedEmployeeData.enterpriseId || enrichedEmployeeData.racfId || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">District</Label>
                        <p className="text-sm" data-testid="text-emp-district">
                          {enrichedEmployeeData.district || enrichedEmployeeData.districtNo || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Job Title</Label>
                        <p className="text-sm" data-testid="text-emp-job-title">
                          {enrichedEmployeeData.jobTitle || enrichedEmployeeData.position || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Planning Area</Label>
                        <p className="text-sm" data-testid="text-emp-planning-area">
                          {enrichedEmployeeData.planningArea || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>
                

                  {/* Contact Information - Always Show */}
                  <div>
                    <div>
                      <Label className="text-sm font-medium text-primary">Contact Information</Label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Cell Phone</Label>
                          <p className="text-sm font-mono" data-testid="text-cell-phone">
                            {formatPhone(enrichedEmployeeData.cellPhone)}
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Main Phone</Label>
                          <p className="text-sm font-mono" data-testid="text-main-phone">
                            {formatPhone(enrichedEmployeeData.mainPhone)}
                          </p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-muted-foreground">Email</Label>
                          <p className="text-sm" data-testid="text-email">
                            {enrichedEmployeeData.email || enrichedEmployeeData.emailAddress ||
                             taskData.email || taskData.emailAddress ||
                             taskData.employee?.email || taskData.employee?.emailAddress ||
                             taskData.technician?.email || taskData.technician?.emailAddress ||
                             "N/A"}
                          </p>
                        </div>
                        <div className="md:col-span-3">
                          <Label className="text-sm font-medium text-muted-foreground">Home Address</Label>
                          <div className="text-sm" data-testid="text-address">
                            {enrichedEmployeeData.homeAddr1 ? (
                              <div>
                                <p>{enrichedEmployeeData.homeAddr1}{enrichedEmployeeData.homeAddr2 ? `, ${enrichedEmployeeData.homeAddr2}` : ''}</p>
                                <p className="text-muted-foreground">
                                  {[enrichedEmployeeData.homeCity, enrichedEmployeeData.homeState, enrichedEmployeeData.homePostal].filter(Boolean).join(', ')}
                                </p>
                              </div>
                            ) : (enrichedEmployeeData.address || taskData.address || taskData.employee?.address || taskData.technician?.address) ? (
                              <p>{enrichedEmployeeData.address || taskData.address || taskData.employee?.address || taskData.technician?.address}</p>
                            ) : (enrichedEmployeeData.street || taskData.street || taskData.employee?.street || taskData.technician?.street) ? (
                              <div>
                                <p>{enrichedEmployeeData.street || taskData.street || taskData.employee?.street || taskData.technician?.street}</p>
                                <p className="text-muted-foreground">
                                  {[
                                    enrichedEmployeeData.city || taskData.city || taskData.employee?.city || taskData.technician?.city,
                                    enrichedEmployeeData.state || taskData.state || taskData.employee?.state || taskData.technician?.state,
                                    enrichedEmployeeData.zip || taskData.zipCode || taskData.zip || taskData.employee?.zip || taskData.technician?.zip
                                  ].filter(Boolean).join(", ")}
                                </p>
                              </div>
                            ) : (
                              <p className="text-muted-foreground">N/A</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Employment Information */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Employment Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Last Day Worked</Label>
                        <p className="text-sm" data-testid="text-last-day-worked">
                          {enrichedEmployeeData.lastDayWorked || taskData.lastDayWorked || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Effective Date</Label>
                        <p className="text-sm" data-testid="text-effective-date">
                          {enrichedEmployeeData.effectiveDate || taskData.effectiveDate || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Department</Label>
                        <p className="text-sm" data-testid="text-department">
                          {enrichedEmployeeData.department || taskData.department || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Position</Label>
                        <p className="text-sm" data-testid="text-position">
                          {enrichedEmployeeData.jobTitle || enrichedEmployeeData.position || taskData.position || "Employee"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Technical Information - Always Show */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Technical Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div className="md:col-span-2">
                        <Label className="text-sm font-medium text-primary">Parts to Ship - Employee Specialties</Label>
                        {(enrichedEmployeeData.specialties || taskData.specialties) ? (
                          <div className="flex flex-wrap gap-2 mt-2" data-testid="specialties-badges">
                            {(Array.isArray(enrichedEmployeeData.specialties || taskData.specialties)
                              ? (enrichedEmployeeData.specialties || taskData.specialties)
                              : [enrichedEmployeeData.specialties || taskData.specialties]
                            ).filter(Boolean).map((specialty: string, index: number) => (
                              <span 
                                key={specialty || index} 
                                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700"
                              >
                                {specialty}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-2">No specialties specified</p>
                        )}
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">FSSL Status</Label>
                        {(enrichedEmployeeData.isFSSLTech || taskData.isFSSLTech) ? (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 font-medium">
                              FSSL (Field Service Support Lead)
                            </span>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">Standard Employee</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Additional Notes */}
                  {(taskData.description || taskData.notes) && (
                    <div>
                      <Label className="text-sm font-medium text-primary">Additional Information</Label>
                      <div className="mt-3 p-4 bg-muted/30 rounded-lg">
                        {taskData.description && (
                          <div className="mb-3">
                            <Label className="text-sm font-medium text-muted-foreground">Description</Label>
                            <p className="text-sm text-muted-foreground mt-1">{taskData.description}</p>
                          </div>
                        )}
                        {taskData.notes && (
                          <div>
                            <Label className="text-sm font-medium text-muted-foreground">Notes</Label>
                            <p className="text-sm text-muted-foreground mt-1">{taskData.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fleet" className="space-y-4">
              {/* Fleet Details Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Fleet Information
                  </CardTitle>
                  <CardDescription>
                    Vehicle assignment and fleet details from TPMS
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Vehicle Assignment */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Vehicle Assignment</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Truck Number (LU)</Label>
                        <p className="text-lg font-mono font-bold" data-testid="text-truck-lu">
                          {enrichedEmployeeData.truckLu || taskData.truckLu || taskData.truckNumber || taskData.vehicleNumber || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Assignment Status</Label>
                        <div className="mt-1">
                          {enrichedEmployeeData.truckLu ? (
                            <Badge className="bg-green-100 text-green-800">Assigned</Badge>
                          ) : (
                            <Badge variant="secondary">No Vehicle Assigned</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Employee Info for Fleet Context */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Employee Fleet Context</Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Employee Name</Label>
                        <p className="text-sm font-medium" data-testid="text-fleet-employee-name">
                          {enrichedEmployeeData.techName || enrichedEmployeeData.name || 
                           (enrichedEmployeeData.firstName && enrichedEmployeeData.lastName 
                             ? `${enrichedEmployeeData.firstName} ${enrichedEmployeeData.lastName}` 
                             : "N/A")}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Enterprise ID</Label>
                        <p className="font-mono text-sm" data-testid="text-fleet-enterprise-id">
                          {enrichedEmployeeData.techRacfid || enrichedEmployeeData.enterpriseId || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">District</Label>
                        <p className="text-sm" data-testid="text-fleet-district">
                          {enrichedEmployeeData.district || enrichedEmployeeData.districtNo || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Contact for Fleet Coordination */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Contact for Fleet Coordination</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Cell Phone</Label>
                        <p className="text-sm font-mono" data-testid="text-fleet-cell-phone">
                          {formatPhone(enrichedEmployeeData.cellPhone)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Main Phone</Label>
                        <p className="text-sm font-mono" data-testid="text-fleet-main-phone">
                          {formatPhone(enrichedEmployeeData.mainPhone)}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>


          {/* Assignment Information Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Assignment Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Assigned To</Label>
                  <p className="text-sm" data-testid="text-assigned-to">
                    {assignedUser ? assignedUser.username : "Unassigned"}
                  </p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Assigned At</Label>
                  <p className="text-sm" data-testid="text-assigned-at">
                    {queueItem.updatedAt ? new Date(queueItem.updatedAt).toLocaleString() : "N/A"}
                  </p>
                </div>
              </div>
              <div>
                <Label htmlFor="admin-notes">Admin Notes</Label>
                <Textarea
                  id="admin-notes"
                  placeholder="Add administrative notes about this assignment..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  data-testid="textarea-admin-notes"
                />
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Action Buttons */}
        <Separator />
        <div className="flex justify-between items-center pt-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            Last updated: {queueItem.updatedAt ? new Date(queueItem.updatedAt).toLocaleString() : "N/A"}
          </div>
          
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={handleCancel}
              data-testid="button-cancel"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            
            <Button 
              variant="secondary" 
              onClick={handleSaveProgress}
              disabled={saveProgressMutation.isPending}
              data-testid="button-save-progress"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveProgressMutation.isPending ? "Saving..." : "Save Progress"}
            </Button>
            
            <Button 
              onClick={handleCompleteTask}
              disabled={completeTaskMutation.isPending}
              data-testid="button-complete-task"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {completeTaskMutation.isPending ? "Completing..." : "Complete Task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}