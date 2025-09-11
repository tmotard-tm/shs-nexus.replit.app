import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Clock, 
  CheckCircle, 
  Circle, 
  ChevronDown, 
  ChevronRight,
  AlertTriangle,
  FileText,
  User,
  Timer
} from "lucide-react";
import type { WorkTemplate, WorkTemplateStep, WorkTemplateSubstep } from "@shared/schema";

interface TemplateChecklistProps {
  template: WorkTemplate;
  isStepCompleted: (stepId: string) => boolean;
  isSubstepCompleted: (stepId: string, substepId: string) => boolean;
  updateStepProgress: (stepId: string, completed: boolean, notes?: string) => void;
  updateSubstepProgress: (stepId: string, substepId: string, completed: boolean, notes?: string) => void;
  getStepNotes: (stepId: string) => string;
  getSubstepNotes: (stepId: string, substepId: string) => string;
  overallProgress: number;
  estimatedTimeRemaining: number | null;
  readonly?: boolean;
}

export function TemplateChecklist({
  template,
  isStepCompleted,
  isSubstepCompleted,
  updateStepProgress,
  updateSubstepProgress,
  getStepNotes,
  getSubstepNotes,
  overallProgress,
  estimatedTimeRemaining,
  readonly = false
}: TemplateChecklistProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set(template.steps.map(s => s.id)));
  const [editingNotes, setEditingNotes] = useState<{ stepId?: string; substepId?: string } | null>(null);

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  const handleStepCheck = (step: WorkTemplateStep, completed: boolean) => {
    if (readonly) return;
    
    updateStepProgress(step.id, completed);
    
    // If checking step as complete and it has substeps, mark all required substeps as complete
    if (completed && step.substeps) {
      step.substeps.forEach(substep => {
        if (substep.required) {
          updateSubstepProgress(step.id, substep.id, true);
        }
      });
    }
  };

  const handleSubstepCheck = (stepId: string, substep: WorkTemplateSubstep, completed: boolean) => {
    if (readonly) return;
    
    updateSubstepProgress(stepId, substep.id, completed);
    
    // Check if all required substeps are completed to auto-complete the step
    const step = template.steps.find(s => s.id === stepId);
    if (step?.substeps && completed) {
      const allRequiredCompleted = step.substeps
        .filter(s => s.required)
        .every(s => s.id === substep.id || isSubstepCompleted(stepId, s.id));
      
      if (allRequiredCompleted) {
        updateStepProgress(stepId, true);
      }
    }
  };

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case "verification": return <CheckCircle className="h-4 w-4" />;
      case "documentation": return <FileText className="h-4 w-4" />;
      case "system_action": return <Circle className="h-4 w-4" />;
      case "communication": return <User className="h-4 w-4" />;
      case "inspection": return <AlertTriangle className="h-4 w-4" />;
      case "approval": return <CheckCircle className="h-4 w-4" />;
      default: return <Circle className="h-4 w-4" />;
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case "verification": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "documentation": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "system_action": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "communication": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "inspection": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "approval": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Template Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {template.name}
              </CardTitle>
              <CardDescription>{template.description}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{template.department}</Badge>
              <Badge variant={template.difficulty === 'easy' ? 'default' : template.difficulty === 'hard' ? 'destructive' : 'secondary'}>
                {template.difficulty}
              </Badge>
            </div>
          </div>
          
          {/* Progress Overview */}
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Overall Progress</span>
              <span className="font-medium">{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" data-testid="progress-overall" />
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {template.estimatedDuration && (
                <div className="flex items-center gap-1">
                  <Timer className="h-4 w-4" />
                  <span>Total: {template.estimatedDuration} min</span>
                </div>
              )}
              {estimatedTimeRemaining !== null && (
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>Remaining: {estimatedTimeRemaining} min</span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Steps Checklist */}
      <div className="space-y-4">
        {template.steps.map((step, stepIndex) => {
          const stepCompleted = isStepCompleted(step.id);
          const isExpanded = expandedSteps.has(step.id);
          const hasSubsteps = step.substeps && step.substeps.length > 0;
          
          return (
            <Card key={step.id} className={`transition-colors ${stepCompleted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    <Checkbox
                      checked={stepCompleted}
                      onCheckedChange={(checked) => handleStepCheck(step, !!checked)}
                      disabled={readonly}
                      data-testid={`checkbox-step-${step.id}`}
                    />
                  </div>
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className={`font-medium ${stepCompleted ? 'line-through text-muted-foreground' : ''}`}>
                          {stepIndex + 1}. {step.title}
                        </h3>
                        {step.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                        {step.category && (
                          <Badge variant="outline" className={`text-xs ${getCategoryColor(step.category)}`}>
                            <span className="flex items-center gap-1">
                              {getCategoryIcon(step.category)}
                              {step.category.replace('_', ' ')}
                            </span>
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {step.estimatedTime && (
                          <Badge variant="outline" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            {step.estimatedTime}m
                          </Badge>
                        )}
                        {hasSubsteps && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleStepExpansion(step.id)}
                            data-testid={`button-expand-${step.id}`}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {step.description && (
                      <p className="text-sm text-muted-foreground">{step.description}</p>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              {hasSubsteps && (
                <Collapsible open={isExpanded}>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <Separator className="mb-4" />
                      <div className="space-y-3">
                        {step.substeps!.map((substep, substepIndex) => {
                          const substepCompleted = isSubstepCompleted(step.id, substep.id);
                          
                          return (
                            <div key={substep.id} className="flex items-start gap-3 pl-4">
                              <div className="mt-1">
                                <Checkbox
                                  checked={substepCompleted}
                                  onCheckedChange={(checked) => handleSubstepCheck(step.id, substep, !!checked)}
                                  disabled={readonly}
                                  data-testid={`checkbox-substep-${step.id}-${substep.id}`}
                                />
                              </div>
                              
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-medium ${substepCompleted ? 'line-through text-muted-foreground' : ''}`}>
                                    {stepIndex + 1}.{substepIndex + 1} {substep.title}
                                  </span>
                                  {substep.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                                </div>
                                
                                {substep.description && (
                                  <p className="text-xs text-muted-foreground">{substep.description}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}