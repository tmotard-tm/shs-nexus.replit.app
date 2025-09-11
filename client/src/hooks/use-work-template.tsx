import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkTemplate, QueueItem, CombinedQueueItem, QueueModule, WorkTemplateProgress } from "@shared/schema";

interface UseWorkTemplateProps {
  queueItem: QueueItem | CombinedQueueItem | null;
  module?: QueueModule;
}

interface WorkTemplateState {
  template: WorkTemplate | null;
  progress: WorkTemplateProgress | null;
  checklistState: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;
}

export function useWorkTemplate({ queueItem, module }: UseWorkTemplateProps): WorkTemplateState & {
  updateStepProgress: (stepId: string, completed: boolean, notes?: string) => void;
  updateSubstepProgress: (stepId: string, substepId: string, completed: boolean, notes?: string) => void;
  calculateOverallProgress: () => number;
  getEstimatedTimeRemaining: () => number | null;
  isStepCompleted: (stepId: string) => boolean;
  isSubstepCompleted: (stepId: string, substepId: string) => boolean;
  getStepNotes: (stepId: string) => string;
  getSubstepNotes: (stepId: string, substepId: string) => string;
} {
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [substepNotes, setSubstepNotes] = useState<Record<string, Record<string, string>>>({});

  // Load template based on workflow type and department
  const { data: templateData, isLoading, error } = useQuery<{ template: WorkTemplate | null; error?: string }>({
    queryKey: [`/api/work-templates/${queueItem?.workflowType}/${(module || queueItem?.department)?.toUpperCase()}`],
    enabled: !!queueItem?.workflowType && !!(module || queueItem?.department),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Load existing progress if available
  const { data: progressData } = useQuery<{
    progress?: WorkTemplateProgress | null;
    checklistState?: Record<string, boolean>;
    stepNotes?: Record<string, string>;
    substepNotes?: Record<string, Record<string, string>>;
  }>({
    queryKey: [`/api/work-progress/${queueItem?.id}`],
    enabled: !!queueItem?.id,
  });

  useEffect(() => {
    if (progressData?.checklistState) {
      setChecklistState(progressData.checklistState);
    }
    if (progressData?.stepNotes) {
      setStepNotes(progressData.stepNotes);
    }
    if (progressData?.substepNotes) {
      setSubstepNotes(progressData.substepNotes);
    }
  }, [progressData]);

  const updateStepProgress = (stepId: string, completed: boolean, notes?: string) => {
    setChecklistState(prev => ({ ...prev, [stepId]: completed }));
    if (notes !== undefined) {
      setStepNotes(prev => ({ ...prev, [stepId]: notes }));
    }
  };

  const updateSubstepProgress = (stepId: string, substepId: string, completed: boolean, notes?: string) => {
    const key = `${stepId}.${substepId}`;
    setChecklistState(prev => ({ ...prev, [key]: completed }));
    if (notes !== undefined) {
      setSubstepNotes(prev => ({
        ...prev,
        [stepId]: { ...(prev[stepId] || {}), [substepId]: notes }
      }));
    }
  };

  const calculateOverallProgress = (): number => {
    if (!templateData?.template) return 0;
    
    let totalSteps = 0;
    let completedSteps = 0;

    templateData.template.steps.forEach(step => {
      if (step.substeps && step.substeps.length > 0) {
        // Count substeps
        totalSteps += step.substeps.length;
        step.substeps.forEach(substep => {
          if (checklistState[`${step.id}.${substep.id}`]) {
            completedSteps++;
          }
        });
      } else {
        // Count step itself
        totalSteps++;
        if (checklistState[step.id]) {
          completedSteps++;
        }
      }
    });

    return totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  };

  const getEstimatedTimeRemaining = (): number | null => {
    if (!templateData?.template) return null;
    
    const overallProgress = calculateOverallProgress();
    const totalEstimatedTime = templateData.template.estimatedDuration || 0;
    
    if (overallProgress === 0) return totalEstimatedTime;
    if (overallProgress === 100) return 0;
    
    // Calculate remaining time based on progress
    const remainingProgress = 100 - overallProgress;
    return Math.round((totalEstimatedTime * remainingProgress) / 100);
  };

  const isStepCompleted = (stepId: string): boolean => {
    return checklistState[stepId] || false;
  };

  const isSubstepCompleted = (stepId: string, substepId: string): boolean => {
    return checklistState[`${stepId}.${substepId}`] || false;
  };

  const getStepNotes = (stepId: string): string => {
    return stepNotes[stepId] || "";
  };

  const getSubstepNotes = (stepId: string, substepId: string): string => {
    return substepNotes[stepId]?.[substepId] || "";
  };

  return {
    template: templateData?.template || null,
    progress: progressData?.progress || null,
    checklistState,
    isLoading,
    error: error?.message || templateData?.error || null,
    updateStepProgress,
    updateSubstepProgress,
    calculateOverallProgress,
    getEstimatedTimeRemaining,
    isStepCompleted,
    isSubstepCompleted,
    getStepNotes,
    getSubstepNotes,
  };
}