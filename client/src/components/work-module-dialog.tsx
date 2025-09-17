import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
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
  ListTodo
} from "lucide-react";
import type { QueueItem, CombinedQueueItem, QueueModule, User as UserType } from "@shared/schema";

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
  
  // Form state
  const [decisionType, setDecisionType] = useState<string>("");
  const [finalResolution, setFinalResolution] = useState<string>("");
  const [completeFinal, setCompleteFinal] = useState<boolean>(false);
  const [workNotes, setWorkNotes] = useState<string>("");
  const [requiresReview, setRequiresReview] = useState<boolean>(false);
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [adminNotes, setAdminNotes] = useState<string>("");
  const [approvedAmount, setApprovedAmount] = useState<string>("");

  // Parse task data
  const taskData = queueItem?.data ? JSON.parse(queueItem.data) : {};
  const assignedUser = users.find(u => u.id === queueItem?.assignedTo);

  // Load work template for this task
  const {
    template,
    checklistState,
    isLoading: templateLoading,
    error: templateError,
    updateStepProgress,
    updateSubstepProgress,
    calculateOverallProgress,
    getEstimatedTimeRemaining,
    isStepCompleted,
    isSubstepCompleted,
    getStepNotes,
    getSubstepNotes,
  } = useWorkTemplate({ queueItem, module });

  useEffect(() => {
    if (queueItem) {
      // Pre-fill form with existing data
      setWorkNotes(queueItem.notes || "");
      setAssignedTo(queueItem.assignedTo || "");
      setAdminNotes(""); // Reset admin notes for new work session
      setDecisionType("");
      setFinalResolution("");
      setCompleteFinal(false);
      setRequiresReview(false);
      setApprovedAmount("");
    }
  }, [queueItem]);

  // Save progress mutation - Enhanced with better error handling and logging
  const saveProgressMutation = useMutation({
    mutationFn: async (data: any) => {
      console.log('Saving progress for task:', queueItem?.id, 'Current status:', queueItem?.status);
      return apiRequest("PATCH", `/api/work-progress/${queueItem?.id}`, data);
    },
    onSuccess: (data) => {
      console.log('Progress saved successfully for task:', queueItem?.id, 'Response:', data);
      // Invalidate specific queue item queries first for immediate UI update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: queueItem?.id }],
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
      queryClient.invalidateQueries({ queryKey: [`/api/work-progress/${queueItem?.id}`] });
      
      toast({
        title: "Progress Saved",
        description: "Your work progress has been saved successfully.",
      });
    },
    onError: (error) => {
      console.error('Failed to save progress for task:', queueItem?.id, 'Error:', error);
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
      console.log('Completing task:', queueItem?.id, 'Current status:', queueItem?.status);
      
      // Validate that task is in the correct state for completion
      if (queueItem?.status !== 'in_progress') {
        throw new Error(`Cannot complete task with status: ${queueItem?.status}. Task must be in_progress.`);
      }
      
      const endpoint = module 
        ? `/api/queues/${module}/${queueItem?.id}/complete`
        : `/api/queue-items/${queueItem?.id}/complete`;
      
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
      console.log('Task completed successfully:', queueItem?.id, 'Response:', data);
      // Invalidate specific queries first for immediate update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: queueItem?.id }],
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
      console.error('Failed to complete task:', queueItem?.id, 'Error:', error);
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
      console.log('Starting work on task:', queueItem?.id, 'Current status:', queueItem?.status);
      
      // Validate that task can be started
      if (queueItem?.status !== 'pending') {
        console.warn('Task already started or completed:', queueItem?.id, 'Status:', queueItem?.status);
        return; // Don't make API call if already started
      }
      
      const endpoint = module 
        ? `/api/queues/${module}/${queueItem?.id}/start-work`
        : `/api/queue-items/${queueItem?.id}/start-work`;
      
      return apiRequest("PATCH", endpoint);
    },
    onSuccess: (data) => {
      console.log('Work started successfully for task:', queueItem?.id, 'Response:', data);
      // Immediately invalidate specific item query for fast UI update
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues", { module, id: queueItem?.id }],
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
      console.error('Failed to start work on task:', queueItem?.id, 'Error:', error);
      toast({
        title: "Error",
        description: "Failed to start work on this task. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    // Auto-start work if opening dialog and task is still pending
    if (isOpen && queueItem?.status === "pending" && currentUser && !startWorkMutation.isPending) {
      console.log('Auto-starting work for task:', queueItem?.id, 'Status:', queueItem?.status);
      startWorkMutation.mutate();
    }
  }, [isOpen, queueItem?.status, currentUser?.id, startWorkMutation.isPending]);

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
    console.log('Canceling dialog for task:', queueItem?.id, 'Current status:', queueItem?.status);
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

  // Extract request details
  const getRequestDetails = () => {
    const employee = taskData.employee || {};
    const submitter = taskData.submitter || {};
    return {
      requestId: queueItem?.id?.slice(-8) || "N/A",
      techId: employee.enterpriseId || employee.racfId || "N/A",
      ldapId: submitter.name || "N/A",
      district: employee.district || taskData.district || "N/A",
      serviceOrder: taskData.serviceOrder || taskData.workflowId || queueItem?.id?.slice(-6) || "N/A",
      status: queueItem?.status || "pending"
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
                  <Label className="text-sm font-medium text-muted-foreground">Tech ID</Label>
                  <p className="font-mono text-sm" data-testid="text-tech-id">{requestDetails.techId}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">LDAP ID</Label>
                  <p className="font-mono text-sm" data-testid="text-ldap-id">{requestDetails.ldapId}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">District</Label>
                  <p className="text-sm" data-testid="text-district">{requestDetails.district}</p>
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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="checklist" className="flex items-center gap-2">
                <ListTodo className="h-4 w-4" />
                Task Checklist
              </TabsTrigger>
              <TabsTrigger value="instructions" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Tech Details
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="checklist" className="space-y-4">
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
                  readonly={queueItem?.status === "completed"}
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
            </TabsContent>

            <TabsContent value="instructions" className="space-y-4">
              {/* Technician Details Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Technician Information
                  </CardTitle>
                  <CardDescription>
                    Complete technician details and onboarding information
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Personal Information - Always Show */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Personal Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Full Name</Label>
                        <p className="text-sm font-medium" data-testid="text-tech-name">
                          {taskData.employee?.firstName && taskData.employee?.lastName 
                            ? `${taskData.employee.firstName} ${taskData.employee.lastName}`
                            : taskData.firstName && taskData.lastName
                            ? `${taskData.firstName} ${taskData.lastName}`
                            : taskData.employee?.name || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Employee ID</Label>
                        <p className="font-mono text-sm" data-testid="text-employee-id">
                          {taskData.employee?.enterpriseId || taskData.employeeId || taskData.employee?.racfId || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Contact Information - Always Show */}
                  <div>
                    <div>
                      <Label className="text-sm font-medium text-primary">Contact Information</Label>
                      <div className="grid grid-cols-1 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                        {(taskData.employee?.address || taskData.address || taskData.employee?.street || taskData.street) && (
                          <div>
                            <Label className="text-sm font-medium text-muted-foreground">Full Address</Label>
                            <div className="text-sm space-y-1" data-testid="text-address">
                              {/* If we have a complete address string */}
                              {(taskData.employee?.address || taskData.address) ? (
                                <p>{taskData.employee?.address || taskData.address}</p>
                              ) : (
                                /* If we have separate address fields, combine them */
                                <div>
                                  {(taskData.employee?.street || taskData.street) && (
                                    <p>{taskData.employee?.street || taskData.street}</p>
                                  )}
                                  <p>
                                    {[
                                      taskData.employee?.city || taskData.city,
                                      taskData.employee?.state || taskData.state,
                                      taskData.employee?.zip || taskData.zipCode || taskData.zip
                                    ].filter(Boolean).join(", ")}
                                  </p>
                                </div>
                              )}
                              
                              {/* Always show individual components if available */}
                              {((taskData.employee?.city || taskData.city) || 
                                (taskData.employee?.state || taskData.state) || 
                                (taskData.employee?.zip || taskData.zipCode || taskData.zip)) && 
                                (taskData.employee?.address || taskData.address) && (
                                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                  <p><strong>Street:</strong> {taskData.employee?.street || taskData.street || "N/A"}</p>
                                  <p><strong>City:</strong> {taskData.employee?.city || taskData.city || "N/A"}</p>
                                  <p><strong>State:</strong> {taskData.employee?.state || taskData.state || "N/A"}</p>
                                  <p><strong>ZIP:</strong> {taskData.employee?.zip || taskData.zipCode || taskData.zip || "N/A"}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {(taskData.employee?.phone || taskData.phone) && (
                          <div>
                            <Label className="text-sm font-medium text-muted-foreground">Phone Number</Label>
                            <p className="text-sm" data-testid="text-phone">
                              {taskData.employee?.phone || taskData.phone || "N/A"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Employment Information */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Employment Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Department</Label>
                        <p className="text-sm" data-testid="text-department">
                          {taskData.employee?.department || taskData.department || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Position</Label>
                        <p className="text-sm" data-testid="text-position">
                          {taskData.employee?.position || taskData.position || "Technician"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Start Date</Label>
                        <p className="text-sm" data-testid="text-start-date">
                          {taskData.employee?.startDate || taskData.startDate || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Proposed Route Start Date</Label>
                        <p className="text-sm" data-testid="text-proposed-date">
                          {taskData.employee?.proposedRouteStartDate || taskData.proposedRouteStartDate || taskData.proposedStartDate || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">District</Label>
                        <p className="text-sm" data-testid="text-district">
                          {taskData.employee?.district || taskData.district || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Technical Information - Always Show */}
                  <div>
                    <Label className="text-sm font-medium text-primary">Technical Information</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-4 bg-muted/30 rounded-lg">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Tech ID</Label>
                        <p className="font-mono text-sm" data-testid="text-tech-id-detail">
                          {taskData.employee?.techId || taskData.techId || taskData.employee?.enterpriseId || "N/A"}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">RACF ID</Label>
                        <p className="font-mono text-sm" data-testid="text-racf-id">
                          {taskData.employee?.racfId || taskData.racfId || "N/A"}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-sm font-medium text-primary">Parts to Ship - Technician Specialties</Label>
                        {(taskData.employee?.specialties || taskData.specialties) ? (
                          <div className="flex flex-wrap gap-2 mt-2" data-testid="specialties-badges">
                            {(Array.isArray(taskData.employee?.specialties || taskData.specialties)
                              ? (taskData.employee?.specialties || taskData.specialties)
                              : [taskData.employee?.specialties || taskData.specialties]
                            ).filter(Boolean).map((specialty: string, index: number) => (
                              <span 
                                key={specialty || index} 
                                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700"
                              >
                                🔧 {specialty}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-2">No specialties specified</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          💡 Ship parts/equipment for the specialties shown above
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">FSSL Tech Status</Label>
                        {(taskData.employee?.isFSSLTech || taskData.isFSSLTech) ? (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 font-medium">
                              🏆 FSSL Tech (Field Service Support Lead)
                            </span>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">Standard Technician</p>
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