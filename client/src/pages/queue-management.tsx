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
import { Clock, User, CheckCircle, XCircle, AlertCircle, Filter, Plus, Eye, Settings, List, Calendar, Save } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import type { QueueItem, InsertQueueItem, User as UserType } from "@shared/schema";

export default function QueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [searchRequestId, setSearchRequestId] = useState<string>("");
  const [searchServiceOrder, setSearchServiceOrder] = useState<string>("");
  const [selectedResolution, setSelectedResolution] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("new");
  const [viewQueueItem, setViewQueueItem] = useState<QueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch queue items
  const { data: queueItems = [], isLoading } = useQuery({
    queryKey: ["/api/queue", selectedFilter, selectedWorkflowType, selectedDepartment],
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

  // Calculate stats
  const newTasksCount = queueItems.filter((item: QueueItem) => item.status === "pending").length;
  const inProgressCount = queueItems.filter((item: QueueItem) => item.status === "in_progress").length;
  const completedCount = queueItems.filter((item: QueueItem) => item.status === "completed").length;
  const totalCount = queueItems.length;

  // Filter queue items based on active tab
  const filteredQueueItems = queueItems.filter((item: QueueItem) => {
    // Filter by tab
    if (activeTab === "new") return item.status === "pending";
    if (activeTab === "in_progress") return item.status === "in_progress";
    if (activeTab === "completed") return item.status === "completed";
    if (activeTab === "all") return true;
    
    // Apply additional filters
    let matches = true;
    
    if (searchRequestId && !item.id.toLowerCase().includes(searchRequestId.toLowerCase())) {
      matches = false;
    }
    
    if (selectedWorkflowType !== "all" && item.workflowType !== selectedWorkflowType) {
      matches = false;
    }
    
    // Department filter
    if (selectedDepartment !== "all") {
      const itemData = item.data ? JSON.parse(item.data) : {};
      const department = itemData.department || '';
      if (department.toLowerCase() !== selectedDepartment.toLowerCase()) {
        matches = false;
      }
    }
    
    return matches;
  });

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
      <div className="min-h-screen bg-background text-foreground p-6">
        <BackButton href="/" />
        
        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-orange-500 border-orange-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">New Tasks</p>
                  <p className="text-white text-2xl font-bold">{newTasksCount}</p>
                </div>
                <Clock className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-blue-500 border-blue-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">In Progress</p>
                  <p className="text-white text-2xl font-bold">{inProgressCount}</p>
                </div>
                <Settings className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-green-500 border-green-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">Completed</p>
                  <p className="text-white text-2xl font-bold">{completedCount}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-red-500 border-red-600">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/90 text-sm font-medium">Total Requests</p>
                  <p className="text-white text-2xl font-bold">{totalCount}</p>
                </div>
                <List className="h-8 w-8 text-white/80" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="bg-card rounded-lg p-4 mb-6 border border-border">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <div>
              <Label className="text-muted-foreground text-sm">Department:</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="bg-green-50 border-green-300 text-green-900 dark:bg-green-900 dark:border-green-600 dark:text-green-100">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  <SelectItem value="ntao">NTAO</SelectItem>
                  <SelectItem value="assets & supplies">Assets & Supplies</SelectItem>
                  <SelectItem value="assets management">Assets Management</SelectItem>
                  <SelectItem value="inventory control">Inventory Control</SelectItem>
                  <SelectItem value="fleet management">Fleet Management</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-muted-foreground text-sm">Filter by Agent:</Label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue placeholder="All Agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-muted-foreground text-sm">Resolution:</Label>
              <Select value={selectedResolution} onValueChange={setSelectedResolution}>
                <SelectTrigger className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue placeholder="All Resolutions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Resolutions</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label className="text-muted-foreground text-sm">From:</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100"
              />
            </div>
            
            <div>
              <Label className="text-muted-foreground text-sm">To:</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100"
              />
            </div>
          </div>
          
          <div className="flex justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setSelectedAgent("all");
                setSelectedResolution("all");
                setDateFrom("");
                setDateTo("");
              }}
              className="text-muted-foreground border-border hover:bg-muted"
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-lg border border-border">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full bg-muted grid grid-cols-4">
              <TabsTrigger value="new" className="data-[state=active]:bg-orange-500">
                <Clock className="h-4 w-4 mr-2" />
                New Tasks ({newTasksCount})
              </TabsTrigger>
              <TabsTrigger value="in_progress" className="data-[state=active]:bg-blue-500">
                <Settings className="h-4 w-4 mr-2" />
                In Progress ({inProgressCount})
              </TabsTrigger>
              <TabsTrigger value="completed" className="data-[state=active]:bg-green-500">
                <CheckCircle className="h-4 w-4 mr-2" />
                Completed ({completedCount})
              </TabsTrigger>
              <TabsTrigger value="all" className="data-[state=active]:bg-slate-600">
                <List className="h-4 w-4 mr-2" />
                All Requests
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              <div className="p-4">
                {/* Table Header */}
                <div className="grid grid-cols-10 gap-4 text-muted-foreground text-sm font-medium border-b border-border pb-2 mb-4">
                  <div>ID</div>
                  <div>Submitted</div>
                  <div>Type</div>
                  <div>Department</div>
                  <div>Title</div>
                  <div>Priority</div>
                  <div>Assigned To</div>
                  <div>Status</div>
                  <div>Actions</div>
                  <div></div>
                </div>

                {/* Table Content */}
                {filteredQueueItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No items found for the current filter</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredQueueItems.map((item: QueueItem) => {
                      const itemData = item.data ? JSON.parse(item.data) : {};
                      let department = itemData.department || '';
                      
                      // Extract department from different data structures
                      if (!department && itemData.notifications?.departments) {
                        department = `Multiple: ${itemData.notifications.departments.join(', ')}`;
                      }
                      if (!department && itemData.employee?.department) {
                        department = itemData.employee.department;
                      }
                      if (!department) {
                        department = 'General';
                      }
                      
                      return (
                        <div key={item.id} className="grid grid-cols-10 gap-4 text-sm bg-muted/50 rounded p-3 hover:bg-muted transition-colors">
                          <div className="text-muted-foreground">#{item.id.slice(0, 8)}...</div>
                          <div className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</div>
                          <div className="text-muted-foreground capitalize">{item.workflowType.replace('_', ' ')}</div>
                          <div className="text-muted-foreground">
                            <Badge 
                              variant="outline" 
                              className={`font-medium ${
                                department.includes('NTAO') ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900 dark:text-blue-100' :
                                department.includes('Assets') ? 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-900 dark:text-orange-100' :
                                department.includes('Fleet') ? 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900 dark:text-purple-100' :
                                department.includes('Inventory') ? 'bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-100' :
                                'bg-green-50 text-green-700 border-green-300 dark:bg-green-900 dark:text-green-100'
                              }`}
                            >
                              {department}
                            </Badge>
                          </div>
                          <div className="text-foreground font-medium truncate">{item.title}</div>
                          <div>
                            <Badge variant={item.priority === 'high' ? 'destructive' : item.priority === 'medium' ? 'default' : 'secondary'}>
                              {item.priority}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {item.assignedTo ? users.find(u => u.id === item.assignedTo)?.username || 'Unknown' : '-'}
                          </div>
                          <div>
                            <Badge variant={item.status === 'completed' ? 'secondary' : item.status === 'in_progress' ? 'default' : 'outline'}>
                              {item.status === 'in_progress' ? 'In Progress' : item.status}
                            </Badge>
                          </div>
                        <div className="flex gap-2">
                          {item.status === 'pending' && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="bg-primary text-primary-foreground hover:bg-primary/90"
                              onClick={() => {
                                assignMutation.mutate(
                                  { queueItemId: item.id, assigneeId: user?.id || "" },
                                  {
                                    onSuccess: () => {
                                      // Auto-open details modal after successful assignment
                                      setViewQueueItem(item);
                                    }
                                  }
                                );
                              }}
                            >
                              Pick Up
                            </Button>
                          )}
                          {item.status === 'in_progress' && item.assignedTo === user?.id && (
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="bg-green-600 text-white hover:bg-green-700"
                              onClick={() => completeMutation.mutate(item.id)}
                            >
                              Complete
                            </Button>
                          )}
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => setViewQueueItem(item)}
                          >
                            View
                          </Button>
                        </div>
                        <div></div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Queue Item Details</DialogTitle>
              <DialogDescription>
                View complete form submission and manage queue item
              </DialogDescription>
            </DialogHeader>
            {viewQueueItem && <QueueItemDetailsView item={viewQueueItem} users={users} />}
            {viewQueueItem && (
              <div className="flex gap-2 pt-4 border-t">
                {viewQueueItem.status === "pending" && (
                  <Button onClick={() => assignMutation.mutate({ queueItemId: viewQueueItem.id, assigneeId: user?.id || "" })}>
                    Assign to Me
                  </Button>
                )}
                {viewQueueItem.status === "in_progress" && viewQueueItem.assignedTo === user?.id && (
                  <Button onClick={() => completeMutation.mutate(viewQueueItem.id)}>
                    Mark Complete
                  </Button>
                )}
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
      apiRequest("PATCH", `/api/queue/${item.id}/notes`, { notes: newNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue"] });
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
          className="min-h-[100px] bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300"
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



// Component to display queue item details with all form data
function QueueItemDetailsView({ item, users }: { item: QueueItem; users: UserType[] }) {
  let parsedData = null;
  try {
    parsedData = item.data ? JSON.parse(item.data) : null;
  } catch (error) {
    console.error('Error parsing queue item data:', error);
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const assignedUser = users.find(u => u.id === item.assignedTo);

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
        <div>
          <Label className="font-semibold">Request ID</Label>
          <p className="text-sm">{item.id}</p>
        </div>
        <div>
          <Label className="font-semibold">Status</Label>
          <div className="mt-1">
            <Badge variant={item.status === 'completed' ? 'secondary' : item.status === 'in_progress' ? 'default' : 'outline'}>
              {item.status === 'in_progress' ? 'In Progress' : item.status}
            </Badge>
          </div>
        </div>
        <div>
          <Label className="font-semibold">Workflow Type</Label>
          <p className="text-sm capitalize">{item.workflowType.replace('_', ' ')}</p>
        </div>
        <div>
          <Label className="font-semibold">Priority</Label>
          <div className="mt-1">
            <Badge variant={item.priority === 'high' ? 'destructive' : item.priority === 'medium' ? 'default' : 'secondary'}>
              {item.priority}
            </Badge>
          </div>
        </div>
        <div>
          <Label className="font-semibold">Created</Label>
          <p className="text-sm">{new Date(item.createdAt).toLocaleString()}</p>
        </div>
        <div>
          <Label className="font-semibold">Assigned To</Label>
          <p className="text-sm">{assignedUser ? assignedUser.username : 'Unassigned'}</p>
        </div>
      </div>

      <div>
        <Label className="font-semibold">Description</Label>
        <p className="text-sm mt-1 p-3 bg-muted rounded">{item.description}</p>
      </div>

      {/* Form Data Based on Workflow Type */}
      {parsedData && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">Original Form Submission</h3>
          
          {/* Submitter Information */}
          {parsedData.submitter && (
            <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
              <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Form Submitter</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-blue-700 dark:text-blue-300">Submitted By</Label>
                  <p className="font-medium text-blue-900 dark:text-blue-100">{parsedData.submitter.name}</p>
                </div>
                <div>
                  <Label className="text-blue-700 dark:text-blue-300">Submitted At</Label>
                  <p className="text-blue-900 dark:text-blue-100">{new Date(parsedData.submitter.submittedAt).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}
          
          {item.workflowType === "onboarding" && (
            <OnboardingFormData data={parsedData} />
          )}
          
          {item.workflowType === "vehicle_assignment" && (
            <VehicleAssignmentFormData data={parsedData} />
          )}
          
          {item.workflowType === "offboarding" && (
            <OffboardingFormData data={parsedData} />
          )}
          
          {item.workflowType === "decommission" && (
            <DecommissionFormData data={parsedData} />
          )}
          
          {item.workflowType === "assets_supplies" && (
            <AssetsSuppliesFormData data={parsedData} />
          )}
          
          {item.workflowType === "ntao_parts" && (
            <NTAOPartsFormData data={parsedData} />
          )}
          
          {item.workflowType === "department_notification" && (
            <DepartmentNotificationFormData data={parsedData} />
          )}
        </div>
      )}

      {/* Notes Section */}
      <NotesSection item={item} />

      {/* Raw Data (for debugging) */}
      {parsedData && (
        <details className="bg-muted rounded p-3 border border-border">
          <summary className="cursor-pointer font-medium">Raw Data (Developer View)</summary>
          <pre className="text-xs mt-2 overflow-auto">
            {JSON.stringify(parsedData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}



// Onboarding form data display
function OnboardingFormData({ data }: { data: any }) {
  const { employee, vehicleAssignment, supplyOrders, requestsCreated } = data || {};

  return (
    <div className="space-y-4">
      {/* Employee Information */}
      <div className="bg-muted p-4 rounded-lg border border-border">
        <h4 className="font-semibold mb-3">Employee Information</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Name</Label>
            <p>{employee?.firstName || 'N/A'} {employee?.lastName || ''}</p>
          </div>
          <div>
            <Label>Enterprise ID</Label>
            <p>{employee?.enterpriseId || 'N/A'}</p>
          </div>
          <div>
            <Label>Department</Label>
            <p>{employee?.department || 'N/A'}</p>
          </div>
          <div>
            <Label>Start Date</Label>
            <p>{employee?.startDate || 'N/A'}</p>
          </div>
          <div>
            <Label>Region</Label>
            <p>{employee?.region || 'N/A'}</p>
          </div>
          <div>
            <Label>District</Label>
            <p>{employee?.district || 'N/A'}</p>
          </div>
          <div className="col-span-2">
            <Label>Specialties</Label>
            <div className="flex gap-2 mt-1">
              <Badge variant="outline">Primary: {employee?.primarySpecialty || 'N/A'}</Badge>
              <Badge variant="outline">Secondary: {employee?.secondarySpecialty || 'N/A'}</Badge>
              <Badge variant="outline">Tertiary: {employee?.tertiarySpecialty || 'N/A'}</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Assignment */}
      {vehicleAssignment && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Vehicle Assignment</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-blue-700 dark:text-blue-300">Auto Assign</Label>
              <p className="text-blue-900 dark:text-blue-100">{vehicleAssignment.autoAssign ? 'Yes' : 'No'}</p>
            </div>
            {vehicleAssignment.workZipcode && (
              <div>
                <Label className="text-blue-700 dark:text-blue-300">Work Zipcode</Label>
                <p className="text-blue-900 dark:text-blue-100">{vehicleAssignment.workZipcode}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Supply Orders */}
      {supplyOrders && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Supply Orders</h4>
          <div className="flex gap-4 text-sm">
            <div>
              <Label className="text-blue-700 dark:text-blue-300">Assets & Supplies</Label>
              <p className="text-blue-900 dark:text-blue-100">{supplyOrders.assetsSupplies ? 'Requested' : 'Not Requested'}</p>
            </div>
            <div>
              <Label className="text-blue-700 dark:text-blue-300">NTAO Parts Stock</Label>
              <p className="text-blue-900 dark:text-blue-100">{supplyOrders.ntaoPartsStock ? 'Requested' : 'Not Requested'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Requests Created */}
      {requestsCreated && requestsCreated.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Triggered Requests</h4>
          <div className="flex flex-wrap gap-2">
            {requestsCreated.map((request: string, index: number) => (
              <Badge key={index} variant="secondary">{request}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



// Vehicle Assignment form data display
function VehicleAssignmentFormData({ data }: { data: any }) {
  const { employee, vehicle, supplyOrders, orderMessages } = data || {};

  return (
    <div className="space-y-4">
      {/* Employee Information */}
      <div className="bg-muted p-4 rounded-lg border border-border">
        <h4 className="font-semibold mb-3">Employee Information</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Name</Label>
            <p>{employee?.name || 'N/A'}</p>
          </div>
          <div>
            <Label>Enterprise ID</Label>
            <p>{employee?.enterpriseId || 'N/A'}</p>
          </div>
          <div className="col-span-2">
            <Label>Specialties</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {employee?.specialties && employee.specialties.map((specialty: string, index: number) => (
                <Badge key={index} variant="outline" className="text-xs">{specialty}</Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Information */}
      <div className="bg-muted p-4 rounded-lg border border-border">
        <h4 className="font-semibold mb-3">Vehicle Information</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Vehicle</Label>
            <p>{vehicle?.year || 'N/A'} {vehicle?.make || ''} {vehicle?.model || ''}</p>
          </div>
          <div>
            <Label>License Plate</Label>
            <p>{vehicle?.licensePlate || 'N/A'}</p>
          </div>
          <div>
            <Label>VIN</Label>
            <p>{vehicle?.vin || 'N/A'}</p>
          </div>
          <div>
            <Label>Location</Label>
            <p>{vehicle?.location || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Supply Orders */}
      {supplyOrders && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Supply Orders</h4>
          <div className="flex gap-4 text-sm">
            <div>
              <Label className="text-blue-700 dark:text-blue-300">Assets & Supplies</Label>
              <p className="text-blue-900 dark:text-blue-100">{supplyOrders.assetsSupplies ? 'Requested' : 'Not Requested'}</p>
            </div>
            <div>
              <Label className="text-blue-700 dark:text-blue-300">NTAO Parts Stock</Label>
              <p className="text-blue-900 dark:text-blue-100">{supplyOrders.ntaoPartsStock ? 'Requested' : 'Not Requested'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Order Messages */}
      {orderMessages && orderMessages.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Order Messages</h4>
          <div className="space-y-1 text-sm">
            {orderMessages.map((message: string, index: number) => (
              <p key={index} className="text-blue-900 dark:text-blue-100">• {message}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



// Offboarding form data display
function OffboardingFormData({ data }: { data: any }) {
  const { employee, vehicle, notifications } = data || {};

  return (
    <div className="space-y-4">
      {/* Employee Information */}
      {employee && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Employee Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Name</Label>
              <p>{employee.name || 'N/A'}</p>
            </div>
            <div>
              <Label>RACF ID</Label>
              <p>{employee.racfId || 'N/A'}</p>
            </div>
            <div>
              <Label>Enterprise ID</Label>
              <p>{employee.enterpriseId || 'N/A'}</p>
            </div>
            <div>
              <Label>Last Day Worked</Label>
              <p>{employee.lastDayWorked || 'N/A'}</p>
            </div>
          </div>
          
          {/* Departments */}
          {employee.departments && employee.departments.length > 0 && (
            <div className="mt-4">
              <Label>Departments</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {employee.departments.map((dept: string, index: number) => (
                  <Badge key={index} variant="outline" className="text-xs">{dept}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vehicle Information */}
      {vehicle && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Vehicle Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Vehicle Number</Label>
              <p>{vehicle.vehicleNumber || 'N/A'}</p>
            </div>
            <div>
              <Label>Reason</Label>
              <p>{vehicle.reason || 'N/A'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Departments Notified */}
      {notifications && notifications.departments && notifications.departments.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Departments Notified</h4>
          <div className="flex flex-wrap gap-2">
            {notifications.departments.map((dept: string, index: number) => (
              <Badge key={index} variant="secondary">{dept}</Badge>
            ))}
          </div>
          {notifications.timestamp && (
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
              Notified at: {new Date(notifications.timestamp).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}



// Decommission form data display (placeholder)
function DecommissionFormData({ data }: { data: any }) {
  return (
    <div className="bg-slate-700 p-4 rounded-lg border border-slate-600">
      <h4 className="font-semibold mb-3 text-slate-200">Decommission Data</h4>
      <pre className="text-xs overflow-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}



// Assets & Supplies form data display
function AssetsSuppliesFormData({ data }: { data: any }) {
  const { employee, orderType, autoTriggered, triggeredBy } = data || {};

  return (
    <div className="space-y-4">
      {/* Order Information */}
      <div className="bg-muted p-4 rounded-lg border border-border">
        <h4 className="font-semibold mb-3">Order Information</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Order Type</Label>
            <p>{orderType || 'N/A'}</p>
          </div>
          <div>
            <Label>Auto Triggered</Label>
            <p>{autoTriggered ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <Label>Triggered By</Label>
            <p>{triggeredBy || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Employee Information */}
      {employee && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Employee Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Name</Label>
              <p>{employee.firstName} {employee.lastName}</p>
            </div>
            <div>
              <Label>Enterprise ID</Label>
              <p>{employee.enterpriseId || 'N/A'}</p>
            </div>
            <div>
              <Label>Department</Label>
              <p>{employee.department || 'N/A'}</p>
            </div>
            <div>
              <Label>Start Date</Label>
              <p>{employee.startDate || 'N/A'}</p>
            </div>
            <div>
              <Label>Region</Label>
              <p>{employee.region || 'N/A'}</p>
            </div>
            <div>
              <Label>District</Label>
              <p>{employee.district || 'N/A'}</p>
            </div>
          </div>

          {/* Specialties */}
          {employee.specialties && employee.specialties.length > 0 && (
            <div className="mt-4">
              <Label>Specialties</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {employee.specialties.map((specialty: string, index: number) => (
                  <Badge key={index} variant="outline" className="text-xs">{specialty}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}



// NTAO Parts form data display
function NTAOPartsFormData({ data }: { data: any }) {
  const { employee, orderType, autoTriggered, triggeredBy, workLocation } = data || {};

  return (
    <div className="space-y-4">
      {/* Order Information */}
      <div className="bg-muted p-4 rounded-lg border border-border">
        <h4 className="font-semibold mb-3">Order Information</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Order Type</Label>
            <p>{orderType || 'N/A'}</p>
          </div>
          <div>
            <Label>Auto Triggered</Label>
            <p>{autoTriggered ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <Label>Triggered By</Label>
            <p>{triggeredBy || 'N/A'}</p>
          </div>
          <div>
            <Label>Work Location</Label>
            <p>{workLocation || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Employee Information */}
      {employee && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Technician Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Name</Label>
              <p>{employee.firstName} {employee.lastName}</p>
            </div>
            <div>
              <Label>Enterprise ID</Label>
              <p>{employee.enterpriseId || 'N/A'}</p>
            </div>
            <div>
              <Label>Tech ID</Label>
              <p>{employee.techId || 'N/A'}</p>
            </div>
            <div>
              <Label>Department</Label>
              <p>{employee.department || 'N/A'}</p>
            </div>
            <div>
              <Label>Region</Label>
              <p>{employee.region || 'N/A'}</p>
            </div>
            <div>
              <Label>District</Label>
              <p>{employee.district || 'N/A'}</p>
            </div>
          </div>

          {/* Specialties */}
          {employee.specialties && employee.specialties.length > 0 && (
            <div className="mt-4">
              <Label>Specialties</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {employee.specialties.map((specialty: string, index: number) => (
                  <Badge key={index} variant="outline" className="text-xs">{specialty}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Department Notification form data display
function DepartmentNotificationFormData({ data }: { data: any }) {
  const { department, notificationType, employee, vehicle, autoTriggered, triggeredBy } = data || {};

  return (
    <div className="space-y-4">
      {/* Notification Information */}
      <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
        <h4 className="font-semibold mb-3 text-blue-900 dark:text-blue-100">Notification Details</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label className="text-blue-700 dark:text-blue-300">Department</Label>
            <p className="font-medium text-blue-900 dark:text-blue-100">{department || 'N/A'}</p>
          </div>
          <div>
            <Label className="text-blue-700 dark:text-blue-300">Notification Type</Label>
            <p className="text-blue-900 dark:text-blue-100">{notificationType || 'N/A'}</p>
          </div>
          <div>
            <Label className="text-blue-700 dark:text-blue-300">Auto Triggered</Label>
            <p className="text-blue-900 dark:text-blue-100">{autoTriggered ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <Label className="text-blue-700 dark:text-blue-300">Triggered By</Label>
            <p className="text-blue-900 dark:text-blue-100">{triggeredBy || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Employee Information */}
      {employee && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Employee Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Name</Label>
              <p>{employee.name || 'N/A'}</p>
            </div>
            <div>
              <Label>RACF ID</Label>
              <p>{employee.racfId || 'N/A'}</p>
            </div>
            <div>
              <Label>Enterprise ID</Label>
              <p>{employee.enterpriseId || 'N/A'}</p>
            </div>
            <div>
              <Label>Last Day Worked</Label>
              <p>{employee.lastDayWorked || 'N/A'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Information */}
      {vehicle && (
        <div className="bg-muted p-4 rounded-lg border border-border">
          <h4 className="font-semibold mb-3">Vehicle Information</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Vehicle Number</Label>
              <p>{vehicle.vehicleNumber || 'N/A'}</p>
            </div>
            <div>
              <Label>Vehicle Name</Label>
              <p>{vehicle.vehicleName || 'N/A'}</p>
            </div>
            <div>
              <Label>Reason</Label>
              <p>{vehicle.reason || 'N/A'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}