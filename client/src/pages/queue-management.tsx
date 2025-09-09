import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Clock, User, CheckCircle, XCircle, AlertCircle, Filter, Plus, Eye } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import type { QueueItem, InsertQueueItem, User as UserType } from "@shared/schema";

export default function QueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<string>("all");
  const [viewQueueItem, setViewQueueItem] = useState<QueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch queue items
  const { data: queueItems = [], isLoading } = useQuery({
    queryKey: ["/api/queue", selectedFilter, selectedWorkflowType],
    queryFn: async () => {
      let url = "/api/queue";
      const params = new URLSearchParams();
      
      if (selectedFilter === "my-items") {
        params.append("userId", user?.id || "");
      } else if (selectedFilter === "assigned-to-me") {
        params.append("assignedTo", user?.id || "");
      } else if (selectedFilter !== "all") {
        params.append("status", selectedFilter);
      }
      
      if (selectedWorkflowType !== "all") {
        params.append("workflowType", selectedWorkflowType);
      }
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await apiRequest("GET", url);
      return response.json();
    },
  });

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      // Since we don't have a users endpoint yet, we'll use mock data
      return [
        { id: "1", username: "ENT1234", email: "requester@sears.com", password: "", role: "requester", createdAt: new Date() },
        { id: "2", username: "ENT1235", email: "approver@sears.com", password: "", role: "approver", createdAt: new Date() },
        { id: "3", username: "ADMIN123", email: "admin@sears.com", password: "", role: "admin", createdAt: new Date() },
      ];
    },
  });

  // Mutations
  const assignMutation = useMutation({
    mutationFn: async ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) => {
      const response = await apiRequest("PATCH", `/api/queue/${queueItemId}/assign`, {
        assigneeId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({
        title: "Success",
        description: "Queue item assigned successfully",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (queueItemId: string) => {
      const response = await apiRequest("PATCH", `/api/queue/${queueItemId}/complete`, {
        completedBy: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({
        title: "Success",
        description: "Queue item marked as completed",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ queueItemId, reason }: { queueItemId: string; reason: string }) => {
      const response = await apiRequest("PATCH", `/api/queue/${queueItemId}/cancel`, {
        reason,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      toast({
        title: "Success",
        description: "Queue item cancelled",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertQueueItem) => {
      const response = await apiRequest("POST", "/api/queue", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Success",
        description: "Queue item created successfully",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "in_progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "completed": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "failed": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "cancelled": return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "medium": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "low": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  const getWorkflowTypeDisplay = (workflowType: string) => {
    switch (workflowType) {
      case "onboarding": return "Onboarding";
      case "offboarding": return "Offboarding";
      case "vehicle_assignment": return "Vehicle Assignment";
      case "decommission": return "Decommission";
      default: return workflowType;
    }
  };

  if (isLoading) {
    return (
      <MainContent>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading queue items...</p>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <BackButton href="/" />
            <h1 className="text-3xl font-bold tracking-tight">Queue Management</h1>
            <p className="text-muted-foreground">
              Manage workflow queue items and track progress
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Queue Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Queue Item</DialogTitle>
                <DialogDescription>
                  Add a new item to the workflow queue
                </DialogDescription>
              </DialogHeader>
              <CreateQueueItemForm 
                onSubmit={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
                currentUserId={user?.id || ""}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-2">
                <Label>Status Filter</Label>
                <Select value={selectedFilter} onValueChange={setSelectedFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Items</SelectItem>
                    <SelectItem value="my-items">My Items</SelectItem>
                    <SelectItem value="assigned-to-me">Assigned to Me</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Workflow Type</Label>
                <Select value={selectedWorkflowType} onValueChange={setSelectedWorkflowType}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="offboarding">Offboarding</SelectItem>
                    <SelectItem value="vehicle_assignment">Vehicle Assignment</SelectItem>
                    <SelectItem value="decommission">Decommission</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Queue Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatsCard 
            title="Total Items" 
            value={queueItems.length} 
            icon={Clock}
          />
          <StatsCard 
            title="Pending" 
            value={queueItems.filter((item: QueueItem) => item.status === "pending").length}
            icon={AlertCircle}
            className="text-yellow-600"
          />
          <StatsCard 
            title="In Progress" 
            value={queueItems.filter((item: QueueItem) => item.status === "in_progress").length}
            icon={User}
            className="text-blue-600"
          />
          <StatsCard 
            title="Completed" 
            value={queueItems.filter((item: QueueItem) => item.status === "completed").length}
            icon={CheckCircle}
            className="text-green-600"
          />
        </div>

        {/* Queue Items */}
        <Card>
          <CardHeader>
            <CardTitle>Queue Items</CardTitle>
            <CardDescription>
              {queueItems.length} items found
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queueItems.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No queue items found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {queueItems.map((item: QueueItem) => (
                  <QueueItemCard
                    key={item.id}
                    item={item}
                    users={users}
                    onAssign={(assigneeId) => assignMutation.mutate({ queueItemId: item.id, assigneeId })}
                    onComplete={() => completeMutation.mutate(item.id)}
                    onCancel={(reason) => cancelMutation.mutate({ queueItemId: item.id, reason })}
                    onView={() => setViewQueueItem(item)}
                    currentUserId={user?.id || ""}
                    isAssigning={assignMutation.isPending}
                    isCompleting={completeMutation.isPending}
                    isCancelling={cancelMutation.isPending}
                    getStatusColor={getStatusColor}
                    getPriorityColor={getPriorityColor}
                    getWorkflowTypeDisplay={getWorkflowTypeDisplay}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Queue Item Details</DialogTitle>
            </DialogHeader>
            {viewQueueItem && (
              <ViewQueueItemDetails 
                item={viewQueueItem}
                users={users}
                getStatusColor={getStatusColor}
                getPriorityColor={getPriorityColor}
                getWorkflowTypeDisplay={getWorkflowTypeDisplay}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainContent>
  );
}

// Component definitions for the queue management page
function StatsCard({ title, value, icon: Icon, className = "" }: {
  title: string;
  value: number;
  icon: any;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center space-x-2">
          <Icon className={`h-5 w-5 ${className}`} />
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueItemCard({ 
  item, 
  users, 
  onAssign, 
  onComplete, 
  onCancel, 
  onView,
  currentUserId,
  isAssigning,
  isCompleting,
  isCancelling,
  getStatusColor,
  getPriorityColor,
  getWorkflowTypeDisplay
}: {
  item: QueueItem;
  users: UserType[];
  onAssign: (assigneeId: string) => void;
  onComplete: () => void;
  onCancel: (reason: string) => void;
  onView: () => void;
  currentUserId: string;
  isAssigning: boolean;
  isCompleting: boolean;
  isCancelling: boolean;
  getStatusColor: (status: string) => string;
  getPriorityColor: (priority: string) => string;
  getWorkflowTypeDisplay: (type: string) => string;
}) {
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const assignedUser = users.find(u => u.id === item.assignedTo);

  return (
    <Card className="border-l-4 border-l-primary">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{item.title}</h3>
              <Badge className={getStatusColor(item.status)}>
                {item.status.replace("_", " ")}
              </Badge>
              <Badge className={getPriorityColor(item.priority)}>
                {item.priority}
              </Badge>
              <Badge variant="outline">
                {getWorkflowTypeDisplay(item.workflowType)}
              </Badge>
            </div>
            
            <p className="text-sm text-muted-foreground">{item.description}</p>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Created: {new Date(item.createdAt).toLocaleDateString()}</span>
              {item.assignedTo && (
                <span>Assigned to: {assignedUser?.username || "Unknown"}</span>
              )}
              {item.completedAt && (
                <span>Completed: {new Date(item.completedAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2 ml-4">
            <Button variant="outline" size="sm" onClick={onView}>
              <Eye className="h-4 w-4" />
            </Button>
            
            {item.status === "pending" && (
              <Select value={selectedAssignee} onValueChange={(value) => {
                setSelectedAssignee(value);
                onAssign(value);
              }}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Assign" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {item.status === "in_progress" && (item.assignedTo === currentUserId || currentUserId === "ADMIN123") && (
              <Button 
                size="sm" 
                onClick={onComplete}
                disabled={isCompleting}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Complete
              </Button>
            )}
            
            {(item.status === "pending" || item.status === "in_progress") && (
              <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel Queue Item</DialogTitle>
                    <DialogDescription>
                      Please provide a reason for cancelling this queue item.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Textarea
                      placeholder="Cancellation reason..."
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        onClick={() => {
                          onCancel(cancelReason);
                          setShowCancelDialog(false);
                          setCancelReason("");
                        }}
                        disabled={!cancelReason.trim() || isCancelling}
                      >
                        Cancel Item
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowCancelDialog(false)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateQueueItemForm({ 
  onSubmit, 
  isLoading, 
  currentUserId 
}: {
  onSubmit: (data: InsertQueueItem) => void;
  isLoading: boolean;
  currentUserId: string;
}) {
  const [formData, setFormData] = useState({
    workflowType: "",
    title: "",
    description: "",
    priority: "medium",
    data: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      requesterId: currentUserId,
      data: formData.data || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="workflowType">Workflow Type</Label>
        <Select value={formData.workflowType} onValueChange={(value) => setFormData({ ...formData, workflowType: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select workflow type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="onboarding">Onboarding</SelectItem>
            <SelectItem value="offboarding">Offboarding</SelectItem>
            <SelectItem value="vehicle_assignment">Vehicle Assignment</SelectItem>
            <SelectItem value="decommission">Decommission</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Enter queue item title"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Enter description"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="data">Data (JSON)</Label>
        <Textarea
          id="data"
          value={formData.data}
          onChange={(e) => setFormData({ ...formData, data: e.target.value })}
          placeholder='{"key": "value"}'
        />
      </div>

      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Queue Item"}
      </Button>
    </form>
  );
}

function ViewQueueItemDetails({ 
  item, 
  users, 
  getStatusColor, 
  getPriorityColor, 
  getWorkflowTypeDisplay 
}: {
  item: QueueItem;
  users: UserType[];
  getStatusColor: (status: string) => string;
  getPriorityColor: (priority: string) => string;
  getWorkflowTypeDisplay: (type: string) => string;
}) {
  const requester = users.find(u => u.id === item.requesterId);
  const assignee = users.find(u => u.id === item.assignedTo);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-lg">{item.title}</h3>
        <p className="text-muted-foreground">{item.description}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Status</Label>
          <Badge className={`${getStatusColor(item.status)} mt-1`}>
            {item.status.replace("_", " ")}
          </Badge>
        </div>
        <div>
          <Label>Priority</Label>
          <Badge className={`${getPriorityColor(item.priority)} mt-1`}>
            {item.priority}
          </Badge>
        </div>
        <div>
          <Label>Workflow Type</Label>
          <Badge variant="outline" className="mt-1">
            {getWorkflowTypeDisplay(item.workflowType)}
          </Badge>
        </div>
        <div>
          <Label>Attempts</Label>
          <p className="text-sm mt-1">{item.attempts}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Requester</Label>
          <p className="text-sm mt-1">{requester?.username || "Unknown"}</p>
        </div>
        <div>
          <Label>Assigned To</Label>
          <p className="text-sm mt-1">{assignee?.username || "Unassigned"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Created</Label>
          <p className="text-sm mt-1">{new Date(item.createdAt).toLocaleString()}</p>
        </div>
        <div>
          <Label>Updated</Label>
          <p className="text-sm mt-1">{new Date(item.updatedAt).toLocaleString()}</p>
        </div>
      </div>

      {item.completedAt && (
        <div>
          <Label>Completed</Label>
          <p className="text-sm mt-1">{new Date(item.completedAt).toLocaleString()}</p>
        </div>
      )}

      {item.lastError && (
        <div>
          <Label>Last Error</Label>
          <p className="text-sm mt-1 text-red-600">{item.lastError}</p>
        </div>
      )}

      {item.data && (
        <div>
          <Label>Data</Label>
          <pre className="text-sm mt-1 bg-muted p-2 rounded overflow-auto">
            {JSON.stringify(JSON.parse(item.data), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}