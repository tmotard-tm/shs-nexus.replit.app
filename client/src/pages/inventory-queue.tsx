import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { QueueItem, User } from "@shared/schema";
import { Clock, User as UserIcon, Save, Eye, PickUpTruck } from "lucide-react";
import { MainContent } from "@/components/layout/main-content";

export default function InventoryQueuePage() {
  const [viewQueueItem, setViewQueueItem] = useState<QueueItem | null>(null);
  const [workingOnItem, setWorkingOnItem] = useState<QueueItem | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Fetch Inventory Control queue items only
  const { data: queueItems = [], isLoading } = useQuery<QueueItem[]>({
    queryKey: ["/api/inventory-queue"],
    queryFn: () => apiRequest("GET", "/api/inventory-queue").then(res => res.json()),
  });

  // Fetch users for assignee names
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Only show Inventory Control users in assignment
  const inventoryUsers = users.filter(u => u.department === "Inventory Control" || u.role === "superadmin");

  const assignMutation = useMutation({
    mutationFn: ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) =>
      apiRequest("PATCH", `/api/inventory-queue/${queueItemId}/assign`, { assigneeId }),
    onSuccess: (_, { queueItemId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
      // Find the assigned item and open it automatically
      const assignedItem = queueItems.find(item => item.id === queueItemId);
      if (assignedItem) {
        setWorkingOnItem(assignedItem);
      }
      toast({
        title: "Task Picked Up",
        description: "You've been assigned to this task. The work module is now open.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (queueItemId: string) =>
      apiRequest("PATCH", `/api/inventory-queue/${queueItemId}/complete`, { completedBy: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
      toast({
        title: "Success",
        description: "Queue item marked as complete.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "in_progress": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "completed": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "failed": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "cancelled": return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "destructive";
      case "high": return "destructive";
      case "medium": return "default";
      case "low": return "secondary";
      default: return "secondary";
    }
  };

  const getWorkflowIcon = (workflowType: string) => {
    switch (workflowType) {
      case "onboarding": return "👤";
      case "vehicle_assignment": return "🚗";
      case "offboarding": return "🚪";
      case "decommission": return "🔧";
      case "assets_supplies": return "📦";
      case "ntao_parts": return "⚙️";
      case "department_notification": return "📢";
      default: return "📋";
    }
  };

  // Group items by status
  const pendingItems = queueItems.filter(item => item.status === "pending");
  const inProgressItems = queueItems.filter(item => item.status === "in_progress");
  const completedItems = queueItems.filter(item => item.status === "completed");

  // Extract relevant data from queue item metadata
  const getItemDetails = (item: QueueItem) => {
    const data = item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {};
    return {
      techId: data.techRacfId || data.techId || "N/A",
      district: data.district || data.location || "N/A", 
      serviceOrder: data.serviceOrder || data.vehicleNumber || "N/A",
      amount: data.amount || "$0.00",
      reason: data.reason || item.description || "N/A"
    };
  };

  if (isLoading) {
    return (
      <MainContent>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/3"></div>
            <div className="h-32 bg-muted rounded"></div>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventory Queue</h1>
            <p className="text-muted-foreground">
              Manage Inventory Control department tasks and assignments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900 dark:text-purple-100">
              Inventory Control
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                {pendingItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{pendingItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items awaiting assignment
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                {inProgressItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inProgressItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items being worked on
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <Badge variant="outline" className="bg-green-50 text-green-700">
                {completedItems.length}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completedItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Items finished today
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Table View */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
              Inventory Control
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Tech ID</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>Service Order</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueItems.map((item) => {
                  const details = getItemDetails(item);
                  const assignedUser = users.find(user => user.id === item.assignedTo);
                  const itemNumber = item.id.slice(-2); // Use last 2 chars for display ID
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">#{itemNumber}</TableCell>
                      <TableCell>{new Date(item.createdAt).toLocaleDateString()} {new Date(item.createdAt).toLocaleTimeString()}</TableCell>
                      <TableCell>{details.techId}</TableCell>
                      <TableCell>{details.district}</TableCell>
                      <TableCell>{details.serviceOrder}</TableCell>
                      <TableCell>{details.amount}</TableCell>
                      <TableCell>
                        {assignedUser ? (
                          <Badge variant={item.status === 'in_progress' ? 'default' : 'secondary'}>
                            {assignedUser.username}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{details.reason}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {item.status === "pending" && (
                            <Button
                              size="sm"
                              onClick={() => assignMutation.mutate({ 
                                queueItemId: item.id, 
                                assigneeId: user?.id || "" 
                              })}
                              disabled={assignMutation.isPending}
                              data-testid={`button-pickup-${item.id}`}
                            >
                              Pick Up
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViewQueueItem(item)}
                            data-testid={`button-view-${item.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {queueItems.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No inventory tasks available
              </div>
            )}
          </CardContent>
        </Card>

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Inventory Control Queue Item Details</DialogTitle>
              <DialogDescription>
                View complete form submission and manage queue item
              </DialogDescription>
            </DialogHeader>
            {viewQueueItem && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="font-semibold">Status</Label>
                    <div className="mt-1">
                      <Badge className={getStatusColor(viewQueueItem.status)}>
                        {viewQueueItem.status}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="font-semibold">Priority</Label>
                    <div className="mt-1">
                      <Badge variant={getPriorityColor(viewQueueItem.priority)}>
                        {viewQueueItem.priority}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="font-semibold">Created</Label>
                    <p className="text-sm">{new Date(viewQueueItem.createdAt).toLocaleString()}</p>
                  </div>
                  <div>
                    <Label className="font-semibold">Assigned To</Label>
                    <p className="text-sm">
                      {users.find(u => u.id === viewQueueItem.assignedTo)?.username || 'Unassigned'}
                    </p>
                  </div>
                </div>

                <div>
                  <Label className="font-semibold">Description</Label>
                  <p className="text-sm mt-1 p-3 bg-muted rounded">{viewQueueItem.description}</p>
                </div>

                {/* Notes Section */}
                <NotesSection item={viewQueueItem} />
              </div>
            )}
            {viewQueueItem && (
              <div className="flex gap-2 pt-4 border-t">
                {viewQueueItem.status === "pending" && (
                  <Button 
                    onClick={() => assignMutation.mutate({ 
                      queueItemId: viewQueueItem.id, 
                      assigneeId: user?.id || "" 
                    })}
                    disabled={assignMutation.isPending}
                  >
                    Pick Up Task
                  </Button>
                )}
                {viewQueueItem.status === "in_progress" && viewQueueItem.assignedTo === user?.id && (
                  <Button 
                    onClick={() => completeMutation.mutate(viewQueueItem.id)}
                    disabled={completeMutation.isPending}
                  >
                    Mark Complete
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Work Module Dialog - Opens automatically when user picks up a task */}
        <Dialog open={!!workingOnItem} onOpenChange={() => setWorkingOnItem(null)}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Working on Task - Inventory Control</DialogTitle>
              <DialogDescription>
                Complete your assigned task and add notes about your work
              </DialogDescription>
            </DialogHeader>
            {workingOnItem && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">In Progress</Badge>
                    <span className="text-sm font-medium">Task #{workingOnItem.id.slice(-2)}</span>
                  </div>
                  <h3 className="font-semibold text-lg">{workingOnItem.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{workingOnItem.description}</p>
                </div>

                {/* Task Details */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="font-semibold">Tech ID</Label>
                    <p className="text-sm">{getItemDetails(workingOnItem).techId}</p>
                  </div>
                  <div>
                    <Label className="font-semibold">District</Label>
                    <p className="text-sm">{getItemDetails(workingOnItem).district}</p>
                  </div>
                  <div>
                    <Label className="font-semibold">Service Order</Label>
                    <p className="text-sm">{getItemDetails(workingOnItem).serviceOrder}</p>
                  </div>
                  <div>
                    <Label className="font-semibold">Amount</Label>
                    <p className="text-sm">{getItemDetails(workingOnItem).amount}</p>
                  </div>
                </div>

                {/* Work Notes Section */}
                <NotesSection item={workingOnItem} />

                <div className="flex gap-3 pt-4 border-t">
                  <Button 
                    onClick={() => {
                      completeMutation.mutate(workingOnItem.id);
                      setWorkingOnItem(null);
                    }}
                    disabled={completeMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    Complete Task
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setWorkingOnItem(null)}
                  >
                    Save Progress & Close
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainContent>
  );
}

// Notes Section Component
function NotesSection({ item }: { item: QueueItem }) {
  const [notes, setNotes] = useState(item.notes || "");
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  // Update notes mutation
  const updateNotesMutation = useMutation({
    mutationFn: (newNotes: string) =>
      apiRequest("PATCH", `/api/inventory-queue/${item.id}/notes`, { notes: newNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Notes updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateNotesMutation.mutate(notes);
  };

  const handleCancel = () => {
    setNotes(item.notes || "");
    setIsEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-semibold">Notes</Label>
        {!isEditing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            data-testid="button-edit-notes"
          >
            Edit Notes
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={updateNotesMutation.isPending}
              data-testid="button-cancel-notes"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateNotesMutation.isPending}
              data-testid="button-save-notes"
            >
              <Save className="h-4 w-4 mr-1" />
              {updateNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>
      
      {isEditing ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about your work on this item..."
          className="min-h-[100px] bg-purple-50 border-purple-300 text-purple-900 placeholder:text-purple-500 dark:bg-purple-900 dark:border-purple-600 dark:text-purple-100 dark:placeholder:text-purple-300"
          data-testid="textarea-notes"
        />
      ) : (
        <div className="p-3 bg-muted rounded border min-h-[100px]" data-testid="display-notes">
          {item.notes ? (
            <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No notes added yet.</p>
          )}
        </div>
      )}
    </div>
  );
}