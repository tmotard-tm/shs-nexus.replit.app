import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  warning: string | null;
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
  isSaving: boolean;
} {
  const { toast } = useToast();
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});
  const [substepNotes, setSubstepNotes] = useState<Record<string, Record<string, string>>>({});
  
  // Debouncing refs
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(false);
  const queuedSaveRef = useRef<boolean>(false);
  
  // Track if initial progress data has been loaded to prevent race conditions
  const initializedRef = useRef<boolean>(false);
  
  // Refs to store current state for debounced save (prevents stale closures)
  const checklistStateRef = useRef<Record<string, boolean>>({});
  const stepNotesRef = useRef<Record<string, string>>({});
  const substepNotesRef = useRef<Record<string, Record<string, string>>>({});

  // Load template based on workflow type and department, with task data for enhanced selection
  const { data: templateData, isLoading, error } = useQuery<{ template: WorkTemplate | null; error?: string; warning?: string }>({
    queryKey: [`/api/work-templates/${queueItem?.workflowType}/${(module || queueItem?.department)?.toUpperCase()}`, queueItem?.data],
    queryFn: async () => {
      try {
        let url = `/api/work-templates/${queueItem?.workflowType}/${(module || queueItem?.department)?.toUpperCase()}`;
        
        // Add task data as query parameter for enhanced template selection
        if (queueItem?.data) {
          const taskDataParam = encodeURIComponent(queueItem.data);
          url += `?taskData=${taskDataParam}`;
        }
        
        console.log('Loading work template from:', url);
        const response = await apiRequest("GET", url);
        console.log('Template response status:', response.status);
        const data = await response.json();
        console.log('Template data loaded:', data?.template ? 'success' : 'no template');
        return data;
      } catch (err: any) {
        console.error('Template loading error:', err);
        
        // Handle 401 authentication errors specifically
        if (err.message?.includes('401')) {
          console.warn('Authentication required for template loading - user may need to re-login');
          throw new Error('Authentication required. Please log in again to access work templates.');
        }
        
        // Re-throw other errors
        throw err;
      }
    },
    enabled: !!queueItem?.workflowType && !!(module || queueItem?.department),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry authentication errors
      if (error?.message?.includes('401') || error?.message?.includes('Authentication required')) {
        return false;
      }
      // Retry other errors up to 2 times
      return failureCount < 2;
    },
  });

  // Load existing progress if available
  const { data: progressData } = useQuery<{
    progress?: WorkTemplateProgress | null;
    checklistState?: Record<string, boolean>;
    stepNotes?: Record<string, string>;
    substepNotes?: Record<string, Record<string, string>>;
  }>({
    queryKey: [`/api/work-progress/${queueItem?.id}`],
    queryFn: async () => {
      try {
        const url = `/api/work-progress/${queueItem?.id}`;
        console.log('Loading work progress from:', url);
        const response = await apiRequest("GET", url);
        console.log('Progress response status:', response.status);
        const data = await response.json();
        console.log('Progress data loaded:', data ? 'success' : 'no data');
        return data;
      } catch (err: any) {
        console.error('Progress loading error:', err);
        
        // Handle 401 authentication errors specifically
        if (err.message?.includes('401')) {
          console.warn('Authentication required for progress loading - user may need to re-login');
          // Return empty progress data instead of throwing to prevent breaking the UI
          return { progress: null, checklistState: {}, stepNotes: {}, substepNotes: {} };
        }
        
        // Re-throw other errors
        throw err;
      }
    },
    enabled: !!queueItem?.id,
    retry: (failureCount, error) => {
      // Don't retry authentication errors
      if (error?.message?.includes('401') || error?.message?.includes('Authentication required')) {
        return false;
      }
      // Retry other errors up to 2 times
      return failureCount < 2;
    },
  });

  // Only initialize state from server data when safe to do so
  // This prevents race conditions where server data overwrites local changes after saves
  useEffect(() => {
    // Only update local state if:
    // 1. This is the first load (not initialized yet), OR
    // 2. There are no saves in flight AND no pending changes AND no queued saves
    if (progressData && (!initializedRef.current || (!pendingSaveRef.current && !dirtyRef.current && !queuedSaveRef.current))) {
      if (progressData.checklistState) {
        setChecklistState(progressData.checklistState);
      }
      if (progressData.stepNotes) {
        setStepNotes(progressData.stepNotes);
      }
      if (progressData.substepNotes) {
        setSubstepNotes(progressData.substepNotes);
      }
      
      // Mark as initialized after first load
      if (!initializedRef.current) {
        initializedRef.current = true;
      }
    }
  }, [progressData]);

  // Keep refs synchronized with current state to prevent stale closures
  useEffect(() => {
    checklistStateRef.current = checklistState;
  }, [checklistState]);
  
  useEffect(() => {
    stepNotesRef.current = stepNotes;
  }, [stepNotes]);
  
  useEffect(() => {
    substepNotesRef.current = substepNotes;
  }, [substepNotes]);

  // Reset flags and state when task switches to prevent race conditions
  useEffect(() => {
    // Clear all flags and cancel timers on task switch
    initializedRef.current = false;
    dirtyRef.current = false;
    pendingSaveRef.current = false;
    queuedSaveRef.current = false;
    
    // Cancel any pending debounce timers
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    // Reset local state to empty until progressData arrives
    setChecklistState({});
    setStepNotes({});
    setSubstepNotes({});
  }, [queueItem?.id]); // Reset when task ID changes

  // Save progress mutation - Enhanced with debouncing and error handling
  const saveProgressMutation = useMutation({
    mutationFn: async (data: {
      checklistState: Record<string, boolean>;
      stepNotes: Record<string, string>;
      substepNotes: Record<string, Record<string, string>>;
      templateId?: string;
    }) => {
      console.log('Saving progress for task:', queueItem?.id, 'Current status:', queueItem?.status);
      
      if (!module && !queueItem?.department) {
        throw new Error('Module or department is required for saving progress');
      }
      
      if (!queueItem?.id) {
        throw new Error('Queue item ID is required for saving progress');
      }
      
      const moduleToUse = module || queueItem.department;
      const endpoint = `/api/work-progress/${queueItem.id}`;
      
      console.log('Calling save progress endpoint:', endpoint);
      return apiRequest("PATCH", endpoint, {
        checklistState: data.checklistState,
        stepNotes: Object.keys(data.stepNotes).length > 0 ? data.stepNotes : undefined,
        substepNotes: Object.keys(data.substepNotes).length > 0 ? data.substepNotes : undefined,
        templateId: data.templateId,
        templateProgress: calculateOverallProgress()
      });
    },
    onSuccess: (data) => {
      console.log('Progress saved successfully for task:', queueItem?.id, 'Response:', data);
      
      // Use cache update instead of invalidation to prevent refetch clobbering
      const workProgressQueryKey = [`/api/work-progress/${queueItem?.id}`];
      queryClient.setQueryData(workProgressQueryKey, {
        progress: progressData?.progress,
        checklistState: checklistStateRef.current,
        stepNotes: stepNotesRef.current,
        substepNotes: substepNotesRef.current
      });
      
      // Still invalidate queue queries for immediate UI update, but delay it slightly
      // to avoid race condition with the above cache update
      setTimeout(() => {
        const moduleToUse = module || queueItem?.department;
        queryClient.invalidateQueries({ 
          queryKey: ["/api/queues"],
          exact: false
        });
        if (moduleToUse) {
          queryClient.invalidateQueries({ 
            queryKey: [`/api/${moduleToUse}-queue`],
            exact: false
          });
        }
      }, 100);
    },
    onError: (error: any) => {
      console.error('Failed to save progress for task:', queueItem?.id, 'Error:', error);
      
      toast({
        title: "Error Saving Progress",
        description: error.message || "Failed to save progress. Changes will be lost if you leave this page.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      pendingSaveRef.current = false;
      
      // If there are dirty changes that occurred during the save, queue another save
      if (dirtyRef.current && templateData?.template) {
        console.log('Dirty changes detected after save, queueing immediate retry');
        queuedSaveRef.current = true; // Mark that a save is queued
        
        // Trigger another save immediately for reliability
        setTimeout(() => {
          if (templateData?.template && queuedSaveRef.current) {
            // Now starting the queued save - clear flags
            dirtyRef.current = false;
            queuedSaveRef.current = false;
            pendingSaveRef.current = true;
            
            saveProgressMutation.mutate({
              checklistState: checklistStateRef.current,
              stepNotes: stepNotesRef.current,
              substepNotes: substepNotesRef.current,
              templateId: templateData.template.id
            });
          }
        }, 300); // Short delay to avoid overwhelming the server
      }
    },
  });

  // Start work mutation - Auto-triggered when first checkbox is completed
  const startWorkMutation = useMutation({
    mutationFn: async () => {
      console.log('Starting work on task:', queueItem?.id, 'Current status:', queueItem?.status);
      
      if (!queueItem?.id) {
        console.error('Cannot start work: No task ID available');
        throw new Error('No task ID available');
      }
      
      if (queueItem?.status !== 'pending') {
        console.warn('Task already started or completed:', queueItem?.id, 'Status:', queueItem?.status);
        return; // Don't make API call if already started
      }
      
      const moduleToUse = module || queueItem.department;
      if (!moduleToUse) {
        throw new Error('Module or department is required for starting work');
      }
      
      const endpoint = `/api/queues/${moduleToUse}/${queueItem.id}/start-work`;
      
      console.log('Calling start work endpoint:', endpoint);
      return apiRequest("PATCH", endpoint);
    },
    onSuccess: (data) => {
      console.log('Work started successfully for task:', queueItem?.id, 'Response:', data);
      
      // Invalidate queue queries for immediate UI update
      const moduleToUse = module || queueItem?.department;
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      if (moduleToUse) {
        queryClient.invalidateQueries({ 
          queryKey: [`/api/${moduleToUse}-queue`],
          exact: false
        });
      }
      
      toast({
        title: "Work Started",
        description: "Task status has been changed to in-progress.",
      });
    },
    onError: (error: any) => {
      console.error('Failed to start work on task:', queueItem?.id, 'Error:', error);
      
      toast({
        title: "Error Starting Work",
        description: error.message || "Failed to start work on this task. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Debounced save function to batch progress saves
  const debouncedSaveProgress = useCallback(() => {
    // Mark that there are unsaved changes
    dirtyRef.current = true;
    
    // Clear any pending timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set a new timeout to save after 1 second of inactivity
    saveTimeoutRef.current = setTimeout(() => {
      if (templateData?.template) {
        if (!pendingSaveRef.current) {
          // No save in progress, start a new save
          dirtyRef.current = false; // Clear dirty flag as we're about to save
          pendingSaveRef.current = true;
          
          saveProgressMutation.mutate({
            checklistState: checklistStateRef.current,
            stepNotes: stepNotesRef.current,
            substepNotes: substepNotesRef.current,
            templateId: templateData.template.id
          });
        } else {
          // Save already in progress, dirtyRef stays true and onSettled will handle retry
          console.log('Save already in progress, will retry after completion');
        }
      }
    }, 1000);
  }, [templateData?.template, saveProgressMutation]);

  // Check if this is the first checkbox being completed and task is pending
  const checkAndStartWork = useCallback((isFirstCompletion: boolean) => {
    if (isFirstCompletion && 
        queueItem?.status === 'pending' && 
        !startWorkMutation.isPending &&
        templateData?.template) {
      
      console.log('First checkbox completed on pending task - starting work');
      startWorkMutation.mutate();
    }
  }, [queueItem?.status, startWorkMutation, templateData?.template]);

  const updateStepProgress = (stepId: string, completed: boolean, notes?: string) => {
    // Check if this is the first completion on a pending task
    const wasAnyCompleted = Object.values(checklistState).some(Boolean);
    const isFirstCompletion = completed && !wasAnyCompleted;
    
    // Update local state first (preserve existing behavior)
    setChecklistState(prev => ({ ...prev, [stepId]: completed }));
    if (notes !== undefined) {
      setStepNotes(prev => ({ ...prev, [stepId]: notes }));
    }

    // Start work if this is the first checkbox completion on a pending task
    checkAndStartWork(isFirstCompletion);

    // Debounce the progress save to avoid excessive API calls
    debouncedSaveProgress();
  };

  const updateSubstepProgress = (stepId: string, substepId: string, completed: boolean, notes?: string) => {
    // Check if this is the first completion on a pending task
    const wasAnyCompleted = Object.values(checklistState).some(Boolean);
    const isFirstCompletion = completed && !wasAnyCompleted;
    
    // Update local state first (preserve existing behavior)
    const key = `${stepId}.${substepId}`;
    setChecklistState(prev => ({ ...prev, [key]: completed }));
    if (notes !== undefined) {
      setSubstepNotes(prev => ({
        ...prev,
        [stepId]: { ...(prev[stepId] || {}), [substepId]: notes }
      }));
    }

    // Start work if this is the first checkbox completion on a pending task
    checkAndStartWork(isFirstCompletion);

    // Debounce the progress save to avoid excessive API calls
    debouncedSaveProgress();
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

  // Flush function to save any pending changes immediately
  const flushPendingChanges = useCallback(() => {
    if (dirtyRef.current && templateData?.template && !pendingSaveRef.current) {
      console.log('Flushing pending changes before unmount/unload');
      dirtyRef.current = false;
      
      // Use synchronous save for beforeunload - no async/await here as it may not complete
      saveProgressMutation.mutate({
        checklistState: checklistStateRef.current,
        stepNotes: stepNotesRef.current,
        substepNotes: substepNotesRef.current,
        templateId: templateData.template.id
      });
    }
  }, [dirtyRef, templateData, pendingSaveRef, saveProgressMutation]);

  // Handle beforeunload and unmount to persist any pending changes
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        // Flush changes synchronously
        flushPendingChanges();
        
        // Show browser confirmation dialog
        event.preventDefault();
        event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return event.returnValue;
      }
    };

    // Add beforeunload listener
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function for unmount
    return () => {
      // Remove beforeunload listener
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Clear timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Flush any pending changes on unmount
      flushPendingChanges();
    };
  }, [flushPendingChanges]);

  return {
    template: templateData?.template || null,
    progress: progressData?.progress || null,
    checklistState,
    isLoading,
    error: error?.message || templateData?.error || null,
    warning: templateData?.warning || null,
    updateStepProgress,
    updateSubstepProgress,
    calculateOverallProgress,
    getEstimatedTimeRemaining,
    isStepCompleted,
    isSubstepCompleted,
    getStepNotes,
    getSubstepNotes,
    isSaving: saveProgressMutation.isPending || pendingSaveRef.current,
  };
}