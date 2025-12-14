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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QueueItem, User } from "@shared/schema";
import { Clock, User as UserIcon, Save } from "lucide-react";
import { MainContent } from "@/components/layout/main-content";
import { PickUpRequestDialog } from "@/components/pick-up-request-dialog";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { QueueItemDataTemplate } from "@/components/queue-item-data-template";

export default function AssetsQueuePage() {
  const [viewQueueItem, setViewQueueItem] = useState<QueueItem | null>(null);
  const [pickUpItem, setPickUpItem] = useState<QueueItem | null>(null);
  const [workModuleItem, setWorkModuleItem] = useState<QueueItem | null>(null);
  const [isWorkModuleOpen, setIsWorkModuleOpen] = useState(false);
  const { toast } = useToast();

  // Fetch Assets Management queue items only
  const { data: queueItems = [], isLoading } = useQuery<QueueItem[]>({
    queryKey: ["/api/assets-queue"],
    queryFn: () => apiRequest("GET", "/api/assets-queue").then(res => res.json()),
    refetchInterval: 30000,
  });

  // Fetch users for assignee names
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Get current user (you might need to modify this based on your auth implementation)
  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // Only show Assets Management users in assignment
  const assetsUsers = users.filter(u => u.departments?.includes("ASSETS") || u.role === "superadmin");

  const assignMutation = useMutation({
    mutationFn: ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) =>
      apiRequest("PATCH", `/api/assets-queue/${queueItemId}/assign`, { assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets-queue"] });
      toast({
        title: "Success",
        description: "Queue item assigned successfully.",
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
      apiRequest("PATCH", `/api/assets-queue/${queueItemId}/complete`, { completedBy: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets-queue"] });
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
            <h1 className="text-3xl font-bold tracking-tight">Assets Queue</h1>
            <p className="text-muted-foreground">
              Manage Assets Management department tasks and assignments
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900 dark:text-green-100">
              Assets Management
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

        <Tabs defaultValue="pending" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pendingItems.length})</TabsTrigger>
            <TabsTrigger value="in_progress">In Progress ({inProgressItems.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedItems.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pendingItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No pending items</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {pendingItems.map((item) => {
                  const assignedUser = users.find(user => user.id === item.assignedTo);
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => setViewQueueItem(item)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">{getWorkflowIcon(item.workflowType)}</span>
                              <div>
                                <h3 className="font-semibold">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </div>
                              {assignedUser && (
                                <div className="flex items-center gap-1">
                                  <UserIcon className="h-4 w-4" />
                                  {assignedUser.username}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                              <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                            </div>
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPickUpItem(item);
                              }}
                              disabled={assignMutation.isPending}
                              data-testid={`button-pick-up-${item.id}`}
                            >
                              Pick Up
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="in_progress" className="space-y-4">
            {inProgressItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No items in progress</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {inProgressItems.map((item) => {
                  const assignedUser = users.find(user => user.id === item.assignedTo);
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => setViewQueueItem(item)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">{getWorkflowIcon(item.workflowType)}</span>
                              <div>
                                <h3 className="font-semibold">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </div>
                              {assignedUser && (
                                <div className="flex items-center gap-1">
                                  <UserIcon className="h-4 w-4" />
                                  {assignedUser.username}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                              <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                            </div>
                            {item.assignedTo === user?.id && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  completeMutation.mutate(item.id);
                                }}
                                disabled={completeMutation.isPending}
                              >
                                Mark Complete
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="space-y-4">
            {completedItems.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">No completed items</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {completedItems.map((item) => {
                  const assignedUser = users.find(user => user.id === item.assignedTo);
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow cursor-pointer"
                          onClick={() => setViewQueueItem(item)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">{getWorkflowIcon(item.workflowType)}</span>
                              <div>
                                <h3 className="font-semibold">{item.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </div>
                              {assignedUser && (
                                <div className="flex items-center gap-1">
                                  <UserIcon className="h-4 w-4" />
                                  {assignedUser.username}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              <Badge variant={getPriorityColor(item.priority)}>{item.priority}</Badge>
                              <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Assets Management Queue Item Details</DialogTitle>
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

                {viewQueueItem.data && (
                  <div>
                    <Label className="font-medium">Additional Data</Label>
                    <div className="mt-1">
                      <QueueItemDataTemplate data={viewQueueItem.data} />
                    </div>
                  </div>
                )}

                {/* Notes Section */}
                <NotesSection item={viewQueueItem} />
              </div>
            )}
            {viewQueueItem && (
              <div className="flex gap-2 pt-4 border-t">
                {viewQueueItem.status === "pending" && (
                  <Button 
                    onClick={() => setPickUpItem(viewQueueItem)}
                    disabled={assignMutation.isPending}
                    data-testid={`button-pick-up-dialog-${viewQueueItem.id}`}
                  >
                    Pick Up
                  </Button>
                )}
                {viewQueueItem.status === "in_progress" && viewQueueItem.assignedTo === user?.id && (
                  <>
                    <Button 
                      onClick={() => {
                        setWorkModuleItem(viewQueueItem);
                        setIsWorkModuleOpen(true);
                      }}
                      data-testid={`button-start-work-${viewQueueItem.id}`}
                    >
                      Start Work
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => completeMutation.mutate(viewQueueItem.id)}
                      disabled={completeMutation.isPending}
                    >
                      Mark Complete
                    </Button>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Pick Up Request Dialog */}
        <PickUpRequestDialog
          isOpen={!!pickUpItem}
          onClose={() => setPickUpItem(null)}
          onPickUp={(agentId) => {
            if (pickUpItem) {
              assignMutation.mutate({ queueItemId: pickUpItem.id, assigneeId: agentId });
            }
          }}
          users={users}
          queueModule="assets"
          isLoading={assignMutation.isPending}
          currentUser={user}
        />

        {/* Work Module Dialog */}
        <WorkModuleDialog
          isOpen={isWorkModuleOpen}
          onOpenChange={setIsWorkModuleOpen}
          queueItem={workModuleItem}
          module="assets"
          currentUser={user}
          users={users}
          onTaskCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/assets-queue"] });
            setViewQueueItem(null);
          }}
        />
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
      apiRequest("PATCH", `/api/assets-queue/${item.id}/notes`, { notes: newNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets-queue"] });
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
          className="min-h-[100px] bg-green-50 border-green-300 text-green-900 placeholder:text-green-500 dark:bg-green-900 dark:border-green-600 dark:text-green-100 dark:placeholder:text-green-300"
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