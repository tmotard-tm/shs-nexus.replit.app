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

  // Save progress mutation
  const saveProgressMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PATCH", `/api/work-progress/${queueItem?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      queryClient.invalidateQueries({ queryKey: [`/api/${module}-queue`] });
      queryClient.invalidateQueries({ queryKey: [`/api/work-progress/${queueItem?.id}`] });
      toast({
        title: "Progress Saved",
        description: "Your work progress has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save progress.",
        variant: "destructive",
      });
    },
  });

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: async () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      queryClient.invalidateQueries({ queryKey: [`/api/${module}-queue`] });
      toast({
        title: "Task Completed",
        description: "Task has been marked as complete.",
      });
      onTaskCompleted?.();
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to complete task.",
        variant: "destructive",
      });
    },
  });

  // Start work mutation (if not already started)
  const startWorkMutation = useMutation({
    mutationFn: async () => {
      const endpoint = module 
        ? `/api/queues/${module}/${queueItem?.id}/start-work`
        : `/api/queue-items/${queueItem?.id}/start-work`;
      
      return apiRequest("PATCH", endpoint, { workerId: currentUser?.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      queryClient.invalidateQueries({ queryKey: [`/api/${module}-queue`] });
    },
  });

  useEffect(() => {
    // Auto-start work if opening dialog and task is still pending
    if (isOpen && queueItem?.status === "pending" && currentUser) {
      startWorkMutation.mutate();
    }
  }, [isOpen, queueItem?.status, currentUser?.id]);

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
    if (!completeFinal) {
      toast({
        title: "Action Required",
        description: "Please check the completion checkbox to finalize this task.",
        variant: "destructive",
      });
      return;
    }

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
                <BookOpen className="h-4 w-4" />
                Additional Info
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
              {/* Additional task information and context */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Task Context & Information
                  </CardTitle>
                  <CardDescription>
                    Additional details and context for this task
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {taskData.description && (
                    <div>
                      <Label className="text-sm font-medium">Description</Label>
                      <p className="text-sm text-muted-foreground mt-1">{taskData.description}</p>
                    </div>
                  )}
                  
                  {taskData.notes && (
                    <div>
                      <Label className="text-sm font-medium">Additional Notes</Label>
                      <p className="text-sm text-muted-foreground mt-1">{taskData.notes}</p>
                    </div>
                  )}

                  {template && (
                    <div>
                      <Label className="text-sm font-medium">Template Information</Label>
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{template.department}</Badge>
                          <Badge variant="secondary">v{template.version}</Badge>
                          <Badge variant={template.difficulty === 'easy' ? 'default' : template.difficulty === 'hard' ? 'destructive' : 'secondary'}>
                            {template.difficulty}
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="text-sm text-muted-foreground">{template.description}</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Financial Details Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Financial Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Labor Refund</Label>
                  <p className="font-mono text-sm font-medium" data-testid="text-labor-refund">{financialDetails.laborRefund}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Parts Refund</Label>
                  <p className="font-mono text-sm font-medium" data-testid="text-parts-refund">{financialDetails.partsRefund}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Taxes</Label>
                  <p className="font-mono text-sm font-medium" data-testid="text-taxes">{financialDetails.taxes}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Total Amount</Label>
                  <p className="font-mono text-sm font-bold" data-testid="text-total-amount">{financialDetails.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>

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

          {/* Final Disposition Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Final Disposition
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Decision Type</Label>
                <RadioGroup value={decisionType} onValueChange={setDecisionType} className="mt-2">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="final_disposition" id="final-disposition" data-testid="radio-final-disposition" />
                    <Label htmlFor="final-disposition" className="text-sm font-medium">
                      Final Disposition
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="requires_review" id="requires-review-radio" data-testid="radio-requires-review" />
                    <Label htmlFor="requires-review-radio" className="text-sm font-medium">
                      Requires Further Review
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div>
                <Label htmlFor="final-resolution">Final Resolution</Label>
                <Select value={finalResolution} onValueChange={setFinalResolution}>
                  <SelectTrigger data-testid="select-final-resolution">
                    <SelectValue placeholder="Select Resolution..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_refund_approved">Full Refund Approved</SelectItem>
                    <SelectItem value="partial_refund_approved">Partial Refund Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Approved Amount Field - Show only when Final Disposition is selected */}
              {decisionType === "final_disposition" && (
                <div>
                  <Label htmlFor="approved-amount">Approved Amount</Label>
                  <div className="relative">
                    <Input
                      id="approved-amount"
                      type="text"
                      placeholder="0.00"
                      value={approvedAmount}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty string, digits, and single decimal point
                        if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
                          setApprovedAmount(value);
                        }
                      }}
                      className="pl-6"
                      data-testid="input-approved-amount"
                    />
                    <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground">$</span>
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="complete-final"
                  checked={completeFinal}
                  onCheckedChange={(checked) => setCompleteFinal(checked as boolean)}
                  data-testid="checkbox-complete-final"
                />
                <Label htmlFor="complete-final" className="text-sm font-medium">
                  Complete this request with a final decision
                </Label>
              </div>

              <div>
                <Label htmlFor="work-notes">Work Notes</Label>
                <Textarea
                  id="work-notes"
                  placeholder="Add your notes about this decision..."
                  value={workNotes}
                  onChange={(e) => setWorkNotes(e.target.value)}
                  rows={4}
                  data-testid="textarea-work-notes"
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
              disabled={!completeFinal || completeTaskMutation.isPending}
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