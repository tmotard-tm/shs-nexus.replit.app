import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { MainContent } from "@/components/layout/main-content";
import { BackButton } from "@/components/ui/back-button";
import type { QueueItem, QueueModule, User } from "@shared/schema";
import { 
  FileText, 
  Clock, 
  User as UserIcon, 
  CheckCircle, 
  AlertTriangle,
  Loader2 
} from "lucide-react";

interface TaskWithModule extends QueueItem {
  module: QueueModule;
}

export default function TaskWorkPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [workModuleOpen, setWorkModuleOpen] = useState(false);

  // Fetch the task data
  const { data: taskData, isLoading, error } = useQuery<TaskWithModule>({
    queryKey: ["/api/tasks", id],
    queryFn: () => apiRequest("GET", `/api/tasks/${id}`).then(res => res.json()),
    retry: 1, // Only retry once for 404 errors
  });

  // Fetch users for assignee information
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Auto-open work module dialog when task loads
  useEffect(() => {
    if (taskData && !workModuleOpen) {
      setWorkModuleOpen(true);
    }
  }, [taskData, workModuleOpen]);

  // Handle task completion
  const handleTaskCompleted = () => {
    toast({
      title: "Task Completed",
      description: "Task has been completed successfully.",
    });
    setLocation("/dashboard");
  };

  // Handle dialog close
  const handleDialogClose = (open: boolean) => {
    setWorkModuleOpen(open);
    if (!open) {
      // Return to dashboard when dialog is closed
      setLocation("/dashboard");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <MainContent className="p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground" data-testid="loading-task">Loading task...</p>
          </div>
        </div>
      </MainContent>
    );
  }

  // Error state
  if (error || !taskData) {
    return (
      <MainContent className="p-6">
        <div className="max-w-2xl mx-auto">
          <BackButton href="/dashboard" />
          <Card className="mt-6" data-testid="error-card">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <AlertTriangle className="h-16 w-16 text-destructive" />
              </div>
              <CardTitle className="text-2xl" data-testid="error-title">Task Not Found</CardTitle>
              <CardDescription data-testid="error-description">
                The requested task could not be found. It may have been deleted or the link may be invalid.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-sm text-muted-foreground" data-testid="task-id">
                Task ID: <span className="font-mono">{id}</span>
              </p>
              <div className="flex flex-col gap-2">
                <Button 
                  variant="default"
                  onClick={() => setLocation("/dashboard")}
                  data-testid="button-back-dashboard"
                >
                  Go to Dashboard
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setLocation("/queue-management")}
                  data-testid="button-queue-management"
                >
                  View All Queues
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </MainContent>
    );
  }

  const assignedUser = users.find(u => u.id === taskData.assignedTo);

  // Parse task data for display
  const taskDetails = taskData.data ? JSON.parse(taskData.data) : {};
  const employee = taskDetails.employee || {};
  const submitter = taskDetails.submitter || {};

  return (
    <MainContent className="p-6">
      <div className="max-w-4xl mx-auto">
        <BackButton href="/dashboard" />
        
        <div className="mt-6 space-y-6">
          {/* Task Header */}
          <Card data-testid="task-header-card">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    <CardTitle data-testid="task-title">{taskData.title}</CardTitle>
                  </div>
                  <CardDescription data-testid="task-description">
                    {taskData.workflowType} task in {taskData.module} queue
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={taskData.status === "completed" ? "default" : "secondary"}
                    data-testid="task-status-badge"
                  >
                    {taskData.status === "completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                    {taskData.status === "in_progress" && <Clock className="h-3 w-3 mr-1" />}
                    {taskData.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Task ID</p>
                  <p className="font-mono text-sm" data-testid="task-id-display">{taskData.id?.slice(-8) || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Assigned To</p>
                  <p className="text-sm" data-testid="task-assigned-to">
                    {assignedUser ? assignedUser.username : "Unassigned"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Created</p>
                  <p className="text-sm" data-testid="task-created-date">
                    {new Date(taskData.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="flex gap-4">
            <Button
              onClick={() => setWorkModuleOpen(true)}
              disabled={taskData.status === "completed"}
              data-testid="button-open-work-module"
            >
              <FileText className="h-4 w-4 mr-2" />
              {taskData.status === "completed" ? "View Task Details" : "Work on Task"}
            </Button>
            
            <Button
              variant="outline"
              onClick={() => setLocation(`/${taskData.module}-queue`)}
              data-testid="button-view-queue"
            >
              View {taskData.module.toUpperCase()} Queue
            </Button>
          </div>

          {/* Task Description */}
          {taskData.description && (
            <Card data-testid="task-description-card">
              <CardHeader>
                <CardTitle className="text-lg">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap" data-testid="task-description-text">
                  {taskData.description}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Work Module Dialog */}
      <WorkModuleDialog
        isOpen={workModuleOpen}
        onOpenChange={handleDialogClose}
        queueItem={taskData}
        module={taskData.module}
        currentUser={user || undefined}
        users={users}
        onTaskCompleted={handleTaskCompleted}
      />
    </MainContent>
  );
}