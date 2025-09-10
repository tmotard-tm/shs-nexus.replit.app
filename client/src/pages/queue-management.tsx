import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  Clock, 
  User, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Filter, 
  Plus, 
  Eye, 
  Settings, 
  List, 
  Calendar, 
  Save,
  BarChart,
  Users,
  FileText,
  Clipboard
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import type { QueueItem, CombinedQueueItem, QueueModule, User as UserType } from "@shared/schema";

// Module labels for display
const moduleLabels = {
  ntao: "NTAO",
  assets: "Assets Management", 
  inventory: "Inventory Control",
  fleet: "Fleet Management",
  decommissions: "Decommissions"
};

export default function UnifiedQueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Selected queue modules - start with empty array for security
  const [selectedModules, setSelectedModules] = useState<QueueModule[]>([]);
  
  // Filters
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
  const [viewQueueItem, setViewQueueItem] = useState<CombinedQueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Update selected modules based on user's accessible queues
  useEffect(() => {
    if (user?.accessibleQueues && user.accessibleQueues.length > 0) {
      setSelectedModules(user.accessibleQueues);
    } else if (user?.role === "superadmin") {
      // Only superadmin gets access to all queues by default
      setSelectedModules(['ntao', 'assets', 'inventory', 'fleet', 'decommissions']);
    } else {
      // Regular users without accessible queues get no access
      setSelectedModules([]);
    }
  }, [user]);

  // Fetch unified queue items
  const { data: queueItems = [], isLoading } = useQuery({
    queryKey: ["/api/queues", { modules: selectedModules, filters: selectedFilter }],
    queryFn: async (): Promise<CombinedQueueItem[]> => {
      if (selectedModules.length === 0) return [];
      
      let url = "/api/queues";
      const params = new URLSearchParams();
      
      // Add modules
      params.append("modules", selectedModules.join(","));
      
      // Add status filter
      if (selectedFilter !== "all" && selectedFilter !== "my-items" && selectedFilter !== "assigned-to-me") {
        params.append("status", selectedFilter);
      }
      
      url += `?${params.toString()}`;
      
      const response = await apiRequest("GET", url);
      let items = await response.json() as CombinedQueueItem[];
      
      // Apply client-side filters for complex filters
      if (selectedFilter === "my-items") {
        items = items.filter(item => item.requesterId === user?.id);
      } else if (selectedFilter === "assigned-to-me") {
        items = items.filter(item => item.assignedTo === user?.id);
      }
      
      if (selectedWorkflowType !== "all") {
        items = items.filter(item => item.workflowType === selectedWorkflowType);
      }
      
      return items;
    },
    enabled: selectedModules.length > 0,
  });

  // Fetch queue stats
  const { data: queueStats } = useQuery({
    queryKey: ["/api/queues/stats", { modules: selectedModules }],
    queryFn: async () => {
      if (selectedModules.length === 0) return { pending: 0, in_progress: 0, completed: 0, total: 0 };
      
      const params = new URLSearchParams();
      params.append("modules", selectedModules.join(","));
      
      const response = await apiRequest("GET", `/api/queues/stats?${params.toString()}`);
      return response.json();
    },
    enabled: selectedModules.length > 0,
  });

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/users");
      return response.json();
    },
  });

  // Assign queue item mutation
  const assignMutation = useMutation({
    mutationFn: async ({ module, id, assigneeId }: { module: QueueModule; id: string; assigneeId: string }) => {
      const response = await apiRequest("PATCH", `/api/queues/${module}/${id}/assign`, {
        assigneeId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queues/stats"] });
      toast({
        title: "Success",
        description: "Task assigned successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to assign task",
        variant: "destructive",
      });
    },
  });

  // Complete queue item mutation
  const completeMutation = useMutation({
    mutationFn: async ({ module, id, completedBy }: { module: QueueModule; id: string; completedBy: string }) => {
      const response = await apiRequest("PATCH", `/api/queues/${module}/${id}/complete`, {
        completedBy,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queues/stats"] });
      toast({
        title: "Success",
        description: "Task completed successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to complete task",
        variant: "destructive",
      });
    },
  });

  const handleModuleToggle = (module: QueueModule, checked: boolean) => {
    if (checked) {
      setSelectedModules(prev => [...prev, module]);
    } else {
      setSelectedModules(prev => prev.filter(m => m !== module));
    }
  };

  const handleAssignTask = (item: CombinedQueueItem, assigneeId: string) => {
    assignMutation.mutate({ module: item.module, id: item.id, assigneeId });
  };

  const handleCompleteTask = (item: CombinedQueueItem) => {
    completeMutation.mutate({ module: item.module, id: item.id, completedBy: user?.id || "" });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500";
      case "in_progress": return "bg-blue-500";
      case "completed": return "bg-green-500";
      case "failed": return "bg-red-500";
      case "cancelled": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-red-500";
      case "high": return "bg-orange-500";
      case "medium": return "bg-yellow-500";
      case "low": return "bg-blue-500";
      default: return "bg-gray-500";
    }
  };

  const getModuleColor = (module: QueueModule) => {
    switch (module) {
      case "ntao": return "bg-purple-500";
      case "assets": return "bg-green-500";
      case "inventory": return "bg-blue-500";
      case "fleet": return "bg-orange-500";
      case "decommissions": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  // Filter items based on active tab
  const getFilteredItems = (items: CombinedQueueItem[]) => {
    switch (activeTab) {
      case "new":
        return items.filter(item => item.status === "pending");
      case "in-progress":
        return items.filter(item => item.status === "in_progress");
      case "completed":
        return items.filter(item => item.status === "completed");
      case "all":
      default:
        return items;
    }
  };

  const filteredItems = getFilteredItems(queueItems);

  return (
    <MainContent>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">
                Queue Management Dashboard
              </h1>
              <p className="text-muted-foreground mt-2">
                Manage tasks across all department queues from one unified interface
              </p>
            </div>
          </div>
        </div>

        {/* Queue Module Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Queue Access
            </CardTitle>
            <CardDescription>
              Select which department queues you want to access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {(Object.keys(moduleLabels) as QueueModule[]).map((module) => {
                // Only show modules the user has access to
                const userCanAccess = !user?.accessibleQueues || user.accessibleQueues.includes(module);
                if (!userCanAccess) return null;
                
                return (
                  <div key={module} className="flex items-center space-x-2">
                    <Checkbox
                      id={module}
                      checked={selectedModules.includes(module)}
                      onCheckedChange={(checked) => 
                        handleModuleToggle(module, checked as boolean)
                      }
                      data-testid={`checkbox-queue-${module}`}
                    />
                    <label
                      htmlFor={module}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {moduleLabels[module]}
                    </label>
                  </div>
                );
              })}
            </div>
            {selectedModules.length === 0 && (
              <p className="text-sm text-muted-foreground mt-4">
                Please select at least one queue to view tasks
              </p>
            )}
          </CardContent>
        </Card>

        {/* Dashboard Cards */}
        {selectedModules.length > 0 && queueStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">New Tasks</CardTitle>
                <Clock className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-new-tasks-count">
                  {queueStats.pending}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                <Settings className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-in-progress-count">
                  {queueStats.in_progress}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-completed-count">
                  {queueStats.completed}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-r from-red-500 to-red-600 text-white">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
                <List className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-requests-count">
                  {queueStats.total}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters and Search */}
        {selectedModules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filters & Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="filter">Status Filter</Label>
                  <Select value={selectedFilter} onValueChange={setSelectedFilter}>
                    <SelectTrigger data-testid="select-status-filter">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Items</SelectItem>
                      <SelectItem value="my-items">My Items</SelectItem>
                      <SelectItem value="assigned-to-me">Assigned to Me</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="workflow-type">Workflow Type</Label>
                  <Select value={selectedWorkflowType} onValueChange={setSelectedWorkflowType}>
                    <SelectTrigger data-testid="select-workflow-type">
                      <SelectValue placeholder="Select workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Workflows</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="offboarding">Offboarding</SelectItem>
                      <SelectItem value="vehicle_assignment">Vehicle Assignment</SelectItem>
                      <SelectItem value="decommission">Decommission</SelectItem>
                      <SelectItem value="department_notification">Department Notification</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="agent">Assigned Agent</Label>
                  <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                    <SelectTrigger data-testid="select-assigned-agent">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Agents</SelectItem>
                      {users.map((selectUser: UserType) => (
                        <SelectItem key={selectUser.id} value={selectUser.id}>
                          {selectUser.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="department">Department</Label>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger data-testid="select-department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      <SelectItem value="NTAO">NTAO</SelectItem>
                      <SelectItem value="Assets Management">Assets Management</SelectItem>
                      <SelectItem value="Inventory Control">Inventory Control</SelectItem>
                      <SelectItem value="Fleet Management">Fleet Management</SelectItem>
                      <SelectItem value="Decommissions">Decommissions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="search-request-id">Request ID</Label>
                  <Input
                    id="search-request-id"
                    placeholder="Search by request ID..."
                    value={searchRequestId}
                    onChange={(e) => setSearchRequestId(e.target.value)}
                    data-testid="input-search-request-id"
                  />
                </div>

                <div>
                  <Label htmlFor="search-service-order">Service Order</Label>
                  <Input
                    id="search-service-order"
                    placeholder="Search by service order..."
                    value={searchServiceOrder}
                    onChange={(e) => setSearchServiceOrder(e.target.value)}
                    data-testid="input-search-service-order"
                  />
                </div>

                <div>
                  <Label htmlFor="date-from">Date From</Label>
                  <Input
                    id="date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    data-testid="input-date-from"
                  />
                </div>

                <div>
                  <Label htmlFor="date-to">Date To</Label>
                  <Input
                    id="date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    data-testid="input-date-to"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Queue Items */}
        {selectedModules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                Queue Items
                {queueItems.length > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {filteredItems.length} of {queueItems.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="new" data-testid="tab-new">
                    New ({queueItems.filter(item => item.status === "pending").length})
                  </TabsTrigger>
                  <TabsTrigger value="in-progress" data-testid="tab-in-progress">
                    In Progress ({queueItems.filter(item => item.status === "in_progress").length})
                  </TabsTrigger>
                  <TabsTrigger value="completed" data-testid="tab-completed">
                    Completed ({queueItems.filter(item => item.status === "completed").length})
                  </TabsTrigger>
                  <TabsTrigger value="all" data-testid="tab-all">
                    All ({queueItems.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value={activeTab} className="mt-6">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">Loading queue items...</p>
                    </div>
                  ) : filteredItems.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">
                        {selectedModules.length === 0 
                          ? "Select at least one queue to view items"
                          : "No queue items found matching your criteria"
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredItems.map((item) => (
                        <Card key={`${item.module}-${item.id}`} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-6">
                            <div className="flex items-start justify-between">
                              <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge 
                                    className={`${getModuleColor(item.module)} text-white`}
                                    data-testid={`badge-module-${item.module}`}
                                  >
                                    {moduleLabels[item.module]}
                                  </Badge>
                                  <Badge 
                                    className={`${getStatusColor(item.status)} text-white`}
                                    data-testid={`badge-status-${item.status}`}
                                  >
                                    {item.status.replace('_', ' ')}
                                  </Badge>
                                  <Badge 
                                    className={`${getPriorityColor(item.priority)} text-white`}
                                    data-testid={`badge-priority-${item.priority}`}
                                  >
                                    {item.priority}
                                  </Badge>
                                  {item.workflowType && (
                                    <Badge variant="outline" data-testid={`badge-workflow-${item.workflowType}`}>
                                      {item.workflowType.replace('_', ' ')}
                                    </Badge>
                                  )}
                                </div>
                                
                                <h3 className="font-semibold text-lg text-foreground" data-testid={`text-item-title-${item.id}`}>
                                  {item.title}
                                </h3>
                                
                                <p className="text-muted-foreground" data-testid={`text-item-description-${item.id}`}>
                                  {item.description}
                                </p>

                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                                  </div>
                                  
                                  {item.assignedTo && (
                                    <div className="flex items-center gap-1">
                                      <User className="h-4 w-4" />
                                      <span>
                                        {users.find((u: UserType) => u.id === item.assignedTo)?.username || 'Unknown'}
                                      </span>
                                    </div>
                                  )}

                                  {item.department && (
                                    <div className="flex items-center gap-1">
                                      <Users className="h-4 w-4" />
                                      <span>{item.department}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 ml-4">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setViewQueueItem(item)}
                                  data-testid={`button-view-${item.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>

                                {item.status === "pending" && (
                                  <Select
                                    onValueChange={(assigneeId) => handleAssignTask(item, assigneeId)}
                                  >
                                    <SelectTrigger className="w-32" data-testid={`select-assign-${item.id}`}>
                                      <SelectValue placeholder="Assign" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {users
                                        .filter((u: UserType) => !user?.accessibleQueues || user.accessibleQueues.includes(item.module))
                                        .map((assigneeUser: UserType) => (
                                          <SelectItem key={assigneeUser.id} value={assigneeUser.id}>
                                            {assigneeUser.username}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                )}

                                {item.status === "in_progress" && item.assignedTo === user?.id && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleCompleteTask(item)}
                                    disabled={completeMutation.isPending}
                                    data-testid={`button-complete-${item.id}`}
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* View Queue Item Dialog */}
        <Dialog open={!!viewQueueItem} onOpenChange={() => setViewQueueItem(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Queue Item Details
              </DialogTitle>
            </DialogHeader>
            {viewQueueItem && (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Module</Label>
                    <Badge className={`${getModuleColor(viewQueueItem.module)} text-white mt-1`}>
                      {moduleLabels[viewQueueItem.module]}
                    </Badge>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Badge className={`${getStatusColor(viewQueueItem.status)} text-white mt-1`}>
                      {viewQueueItem.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Badge className={`${getPriorityColor(viewQueueItem.priority)} text-white mt-1`}>
                      {viewQueueItem.priority}
                    </Badge>
                  </div>
                  <div>
                    <Label>Workflow Type</Label>
                    <p className="text-sm mt-1">{viewQueueItem.workflowType?.replace('_', ' ')}</p>
                  </div>
                </div>

                <div>
                  <Label>Title</Label>
                  <p className="text-sm mt-1 font-medium">{viewQueueItem.title}</p>
                </div>

                <div>
                  <Label>Description</Label>
                  <p className="text-sm mt-1">{viewQueueItem.description}</p>
                </div>

                {viewQueueItem.data && (
                  <div>
                    <Label>Additional Data</Label>
                    <pre className="text-xs mt-1 p-3 bg-muted rounded-md overflow-x-auto">
                      {JSON.stringify(JSON.parse(viewQueueItem.data), null, 2)}
                    </pre>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Created At</Label>
                    <p className="text-sm mt-1">{new Date(viewQueueItem.createdAt).toLocaleString()}</p>
                  </div>
                  {viewQueueItem.updatedAt && (
                    <div>
                      <Label>Updated At</Label>
                      <p className="text-sm mt-1">{new Date(viewQueueItem.updatedAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {viewQueueItem.completedAt && (
                  <div>
                    <Label>Completed At</Label>
                    <p className="text-sm mt-1">{new Date(viewQueueItem.completedAt).toLocaleString()}</p>
                  </div>
                )}

                {viewQueueItem.notes && (
                  <div>
                    <Label>Notes</Label>
                    <p className="text-sm mt-1">{viewQueueItem.notes}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainContent>
  );
}