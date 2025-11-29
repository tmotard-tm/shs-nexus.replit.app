import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Clipboard,
  Play,
  Edit
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { PickUpRequestDialog } from "@/components/pick-up-request-dialog";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { QueueItemDataTemplate } from "@/components/queue-item-data-template";
import type { QueueItem, CombinedQueueItem, QueueModule, User as UserType } from "@shared/schema";

// Module labels for display
const moduleLabels = {
  ntao: "NTAO — National Truck Assortment",
  assets: "Assets Management", 
  inventory: "Inventory Control",
  fleet: "Fleet Management"
};

// Department code to queue module mapping
function departmentToQueueModule(department: string): QueueModule | null {
  switch (department.toUpperCase()) {
    case 'NTAO':
      return 'ntao';
    case 'ASSETS':
      return 'assets';
    case 'INVENTORY':
      return 'inventory';
    case 'FLEET':
      return 'fleet';
    default:
      return null;
  }
}

// Get accessible queue modules for a user
function getUserAccessibleModules(user: UserType): QueueModule[] {
  // Superadmin has access to everything
  if (user.role === 'superadmin') {
    return ['ntao', 'assets', 'inventory', 'fleet'];
  }
  
  // Use departmentAccess array to determine accessible modules
  if (user.departmentAccess && Array.isArray(user.departmentAccess)) {
    return user.departmentAccess
      .map(dept => departmentToQueueModule(dept))
      .filter((module: QueueModule | null) => module !== null) as QueueModule[];
  }
  
  // Fallback to single department for backwards compatibility
  if (user.department) {
    const module = departmentToQueueModule(user.department);
    return module ? [module] : [];
  }
  
  return [];
}

export default function UnifiedQueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Selected queue modules - start with empty array for security
  const [selectedModules, setSelectedModules] = useState<QueueModule[]>([]);
  
  // Filters
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [expandedQueues, setExpandedQueues] = useState<Record<QueueModule, boolean>>({} as Record<QueueModule, boolean>);
  const [viewQueueItem, setViewQueueItem] = useState<CombinedQueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pickUpItem, setPickUpItem] = useState<CombinedQueueItem | null>(null);
  const [workModuleItem, setWorkModuleItem] = useState<CombinedQueueItem | null>(null);
  const [isWorkModuleOpen, setIsWorkModuleOpen] = useState(false);

  // Auto-populate module selection based on user's department access
  useEffect(() => {
    if (user) {
      // Get accessible modules using the new departmentAccess system
      const accessibleModules = getUserAccessibleModules(user);
      setSelectedModules(accessibleModules);
    } else {
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
      
      return items;
    },
    enabled: selectedModules.length > 0,
    refetchInterval: 30000,
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
    refetchInterval: 30000,
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
    onSuccess: (_data, variables) => {
      // Invalidate all related queue queries with proper patterns
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false // This allows partial matching for complex query keys
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues/stats"],
        exact: false
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] }); // Refresh users data
      
      console.log("Task assignment successful:", {
        assigneeId: variables.assigneeId,
        userId: user?.id,
        pickUpItem: pickUpItem?.id,
        userMatch: variables.assigneeId === user?.id,
        pickUpItemExists: !!pickUpItem
      });
      
      // If the task was assigned to the current user, open the work module dialog
      if (variables.assigneeId === user?.id && pickUpItem) {
        console.log("Opening work module for assigned task", {
          taskId: pickUpItem.id,
          status: pickUpItem.status,
          assignedTo: pickUpItem.assignedTo
        });
        // Create updated item with fresh assignment data
        const updatedItem = {
          ...pickUpItem, 
          assignedTo: variables.assigneeId, 
          status: "pending" as const,
          updatedAt: new Date() // Update timestamp for UI
        };
        setWorkModuleItem(updatedItem);
        setIsWorkModuleOpen(true);
      }
      
      // Always close the pickup dialog after assignment
      setPickUpItem(null);
      
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

  // Start work mutation
  const startWorkMutation = useMutation({
    mutationFn: async ({ module, id }: { module: QueueModule; id: string }) => {
      const response = await apiRequest("PATCH", `/api/queues/${module}/${id}/start-work`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues/stats"],
        exact: false
      });
      toast({
        title: "Success",
        description: "Work started successfully! Task is now in progress.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start work on task",
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
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues"],
        exact: false
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/queues/stats"],
        exact: false
      });
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

  const handlePickUpTask = (item: CombinedQueueItem) => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return;
    }
    
    console.log("Picking up task for current user:", {
      taskId: item.id,
      userId: user.id,
      userDept: user.department
    });
    
    // Directly assign to current user and set pickup item for work module
    setPickUpItem(item);
    assignMutation.mutate({ module: item.module, id: item.id, assigneeId: user.id });
  };

  const handleStartWork = (item: CombinedQueueItem) => {
    setWorkModuleItem(item);
    setIsWorkModuleOpen(true);
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
      default: return "bg-gray-500";
    }
  };

  // Helper function to group items by module and then by status
  const groupItemsByModuleAndStatus = (items: CombinedQueueItem[]) => {
    const grouped: Record<QueueModule, Record<string, CombinedQueueItem[]>> = {} as Record<QueueModule, Record<string, CombinedQueueItem[]>>;
    
    selectedModules.forEach(module => {
      grouped[module] = {
        pending: [],
        in_progress: [],
        completed: [],
        failed: [],
        cancelled: []
      };
    });

    items.forEach(item => {
      if (selectedModules.includes(item.module)) {
        if (!grouped[item.module][item.status]) {
          grouped[item.module][item.status] = [];
        }
        grouped[item.module][item.status].push(item);
      }
    });

    return grouped;
  };

  // Helper function to calculate status counts per module
  const getModuleStatusCounts = (items: CombinedQueueItem[], module: QueueModule) => {
    const moduleItems = items.filter(item => item.module === module);
    return {
      pending: moduleItems.filter(item => item.status === "pending").length,
      in_progress: moduleItems.filter(item => item.status === "in_progress").length,
      completed: moduleItems.filter(item => item.status === "completed").length,
      failed: moduleItems.filter(item => item.status === "failed").length,
      cancelled: moduleItems.filter(item => item.status === "cancelled").length,
      total: moduleItems.length
    };
  };

  // Helper function to get module-specific icon
  const getModuleIcon = (module: QueueModule) => {
    switch (module) {
      case "ntao": return "📋";
      case "assets": return "🏢";
      case "inventory": return "📦";
      case "fleet": return "🚐";
      default: return "📋";
    }
  };

  // Filter items based on date, agent, and workflow type criteria
  const getFilteredItems = (items: CombinedQueueItem[]) => {
    let filtered = items;

    // Apply agent filter
    if (selectedAgent !== "all") {
      filtered = filtered.filter(item => item.assignedTo === selectedAgent);
    }

    // Apply workflow type filter
    if (selectedWorkflowType !== "all") {
      filtered = filtered.filter(item => item.workflowType === selectedWorkflowType);
    }

    // Apply date filters
    if (dateFrom) {
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.createdAt).toISOString().split('T')[0];
        return itemDate >= dateFrom;
      });
    }

    if (dateTo) {
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.createdAt).toISOString().split('T')[0];
        return itemDate <= dateTo;
      });
    }

    return filtered;
  };

  // Toggle expanded state for queue sections
  const toggleQueueExpansion = (module: QueueModule) => {
    setExpandedQueues(prev => ({
      ...prev,
      [module]: !prev[module]
    }));
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
                const userAccessibleModules = user ? getUserAccessibleModules(user) : [];
                const userCanAccess = userAccessibleModules.includes(module);
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
              {/* Status Filter Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <Card 
                  className={`cursor-pointer transition-all hover:scale-105 ${
                    selectedFilter === 'pending' 
                      ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white ring-2 ring-orange-400 ring-offset-2' 
                      : 'bg-gradient-to-r from-orange-500/20 to-orange-600/20 hover:from-orange-500/40 hover:to-orange-600/40'
                  }`}
                  onClick={() => setSelectedFilter('pending')}
                  data-testid="tab-pending"
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className={`text-sm font-medium ${selectedFilter === 'pending' ? 'text-white' : ''}`}>
                      New Tasks
                    </CardTitle>
                    <Clock className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-new-tasks-count">{queueStats?.pending || 0}</div>
                  </CardContent>
                </Card>

                <Card 
                  className={`cursor-pointer transition-all hover:scale-105 ${
                    selectedFilter === 'in_progress' 
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white ring-2 ring-blue-400 ring-offset-2' 
                      : 'bg-gradient-to-r from-blue-500/20 to-blue-600/20 hover:from-blue-500/40 hover:to-blue-600/40'
                  }`}
                  onClick={() => setSelectedFilter('in_progress')}
                  data-testid="tab-in-progress"
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className={`text-sm font-medium ${selectedFilter === 'in_progress' ? 'text-white' : ''}`}>
                      In Progress
                    </CardTitle>
                    <Settings className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-in-progress-count">{queueStats?.in_progress || 0}</div>
                  </CardContent>
                </Card>

                <Card 
                  className={`cursor-pointer transition-all hover:scale-105 ${
                    selectedFilter === 'completed' 
                      ? 'bg-gradient-to-r from-green-500 to-green-600 text-white ring-2 ring-green-400 ring-offset-2' 
                      : 'bg-gradient-to-r from-green-500/20 to-green-600/20 hover:from-green-500/40 hover:to-green-600/40'
                  }`}
                  onClick={() => setSelectedFilter('completed')}
                  data-testid="tab-completed"
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className={`text-sm font-medium ${selectedFilter === 'completed' ? 'text-white' : ''}`}>
                      Completed
                    </CardTitle>
                    <CheckCircle className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-completed-count">{queueStats?.completed || 0}</div>
                  </CardContent>
                </Card>

                <Card 
                  className={`cursor-pointer transition-all hover:scale-105 ${
                    selectedFilter === 'all' 
                      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white ring-2 ring-red-400 ring-offset-2' 
                      : 'bg-gradient-to-r from-red-500/20 to-red-600/20 hover:from-red-500/40 hover:to-red-600/40'
                  }`}
                  onClick={() => setSelectedFilter('all')}
                  data-testid="tab-all"
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className={`text-sm font-medium ${selectedFilter === 'all' ? 'text-white' : ''}`}>
                      All Requests
                    </CardTitle>
                    <List className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-requests-count">{queueStats?.total || 0}</div>
                  </CardContent>
                </Card>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="workflow-type">Workflow Type</Label>
                  <Select value={selectedWorkflowType} onValueChange={setSelectedWorkflowType}>
                    <SelectTrigger data-testid="select-workflow-type">
                      <SelectValue placeholder="Select workflow type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Workflow Types</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="offboarding">Offboarding</SelectItem>
                      <SelectItem value="vehicle_assignment">Vehicle Assignment</SelectItem>
                      <SelectItem value="decommission">Decommission</SelectItem>
                      <SelectItem value="byov_assignment">BYOV Assignment</SelectItem>
                      <SelectItem value="storage_request">Storage Request</SelectItem>
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

        {/* Queue Items - Grouped by Module */}
        {selectedModules.length > 0 && (
          <div className="space-y-6">
            {isLoading ? (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    <p className="text-muted-foreground">Loading queue items...</p>
                  </div>
                </CardContent>
              </Card>
            ) : filteredItems.length === 0 ? (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    <p className="text-muted-foreground">
                      {selectedModules.length === 0 
                        ? "Select at least one queue to view items"
                        : "No queue items found matching your criteria"
                      }
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              selectedModules.map((module) => {
                const moduleItems = filteredItems.filter(item => item.module === module);
                const statusCounts = getModuleStatusCounts(filteredItems, module);
                const isExpanded = expandedQueues[module] !== false; // Default to expanded
                
                return (
                  <Card key={module} className="overflow-hidden">
                    <CardHeader 
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${getModuleColor(module)} text-white`}
                      onClick={() => toggleQueueExpansion(module)}
                      data-testid={`header-queue-${module}`}
                    >
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-3">
                          <span className="text-2xl">{getModuleIcon(module)}</span>
                          <span>{moduleLabels[module]} Queue</span>
                          <Badge variant="secondary" className="bg-white/20 text-white border-white/30">
                            {statusCounts.total} items
                          </Badge>
                        </CardTitle>
                        <div className="flex items-center gap-4">
                          {/* Status count badges */}
                          <div className="flex items-center gap-2">
                            {statusCounts.pending > 0 && (
                              <Badge variant="secondary" className="bg-yellow-500/20 text-white border-yellow-400/30" data-testid={`badge-${module}-pending-count`}>
                                {statusCounts.pending} New
                              </Badge>
                            )}
                            {statusCounts.in_progress > 0 && (
                              <Badge variant="secondary" className="bg-blue-500/20 text-white border-blue-400/30" data-testid={`badge-${module}-progress-count`}>
                                {statusCounts.in_progress} In Progress
                              </Badge>
                            )}
                            {statusCounts.completed > 0 && (
                              <Badge variant="secondary" className="bg-green-500/20 text-white border-green-400/30" data-testid={`badge-${module}-completed-count`}>
                                {statusCounts.completed} Completed
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/10"
                            data-testid={`button-toggle-${module}`}
                          >
                            {isExpanded ? "▼" : "▶"}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    
                    {isExpanded && (
                      <CardContent className="p-6">
                        {moduleItems.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-muted-foreground">
                              No items in {moduleLabels[module]} queue matching your criteria
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {/* Status Buckets within Module */}
                            {[
                              { status: 'pending', label: 'New Tasks', color: 'bg-yellow-500', icon: Clock },
                              { status: 'in_progress', label: 'In Progress', color: 'bg-blue-500', icon: Settings },
                              { status: 'completed', label: 'Completed', color: 'bg-green-500', icon: CheckCircle },
                              { status: 'failed', label: 'Failed', color: 'bg-red-500', icon: XCircle },
                              { status: 'cancelled', label: 'Cancelled', color: 'bg-gray-500', icon: AlertCircle }
                            ].map(({ status, label, color, icon: Icon }) => {
                              const statusItems = moduleItems.filter(item => item.status === status);
                              if (statusItems.length === 0) return null;

                              return (
                                <div key={status} className="space-y-3">
                                  <div className={`flex items-center gap-2 p-3 rounded-lg ${color} text-white`}>
                                    <Icon className="h-5 w-5" />
                                    <h4 className="font-semibold">{label}</h4>
                                    <Badge variant="secondary" className="bg-white/20 text-white ml-auto">
                                      {statusItems.length} items
                                    </Badge>
                                  </div>
                                  
                                  <div className="grid grid-cols-1 gap-4">
                                    {statusItems.map((item) => (
                                      <Card key={`${item.module}-${item.id}`} className="hover:shadow-lg transition-all duration-200 border-l-4 border-l-transparent hover:border-l-blue-500">
                                        <CardContent className="p-4">
                                          <div className="flex items-start justify-between">
                                            <div className="space-y-2 flex-1">
                                              <div className="flex items-center justify-between">
                                                <h3 className="font-semibold text-lg text-foreground" data-testid={`text-item-title-${item.id}`}>
                                                  {item.title}
                                                </h3>
                                                <div className="flex items-center gap-2">
                                                  <Badge 
                                                    className={`${getPriorityColor(item.priority)} text-white px-2 py-1`}
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
                                              </div>
                                              
                                              <p className="text-muted-foreground text-sm" data-testid={`text-item-description-${item.id}`}>
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

                                            {/* Direct action buttons */}
                                            <div className="flex flex-col gap-2 ml-4 min-w-fit">
                                              <div className="flex items-center gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => setViewQueueItem(item)}
                                                  data-testid={`button-view-${item.id}`}
                                                >
                                                  <Eye className="h-4 w-4 mr-1" />
                                                  View
                                                </Button>
                                                
                                                {/* Start Work button */}
                                                {item.status === "pending" && item.assignedTo === user?.id && (
                                                  <Button
                                                    size="sm"
                                                    className="bg-green-600 hover:bg-green-700 text-white font-medium shadow-md"
                                                    onClick={() => handleStartWork(item)}
                                                    disabled={startWorkMutation.isPending}
                                                    data-testid={`button-start-work-${item.id}`}
                                                  >
                                                    <Play className="h-4 w-4 mr-1" />
                                                    Start Work
                                                  </Button>
                                                )}
                                                
                                                {/* Continue Work button - opens dialog for editing */}
                                                {item.status === "in_progress" && item.assignedTo === user?.id && (
                                                  <Button
                                                    size="sm"
                                                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md"
                                                    onClick={() => handleStartWork(item)}
                                                    disabled={completeMutation.isPending}
                                                    data-testid={`button-continue-work-${item.id}`}
                                                  >
                                                    <Play className="h-4 w-4 mr-1" />
                                                    Continue Work
                                                  </Button>
                                                )}
                                              </div>
                                              
                                              {/* Pick Up buttons for unassigned items */}
                                              {item.status === "pending" && !item.assignedTo && (
                                                <div className="flex gap-2">
                                                  <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={() => {
                                                      if (user?.id) {
                                                        console.log("Direct self-pickup:", {
                                                          taskId: item.id,
                                                          userId: user.id,
                                                          username: user.username
                                                        });
                                                        // Directly assign to self and open work module
                                                        setWorkModuleItem(item);
                                                        setIsWorkModuleOpen(true);
                                                        assignMutation.mutate({ module: item.module, id: item.id, assigneeId: user.id });
                                                      }
                                                    }}
                                                    disabled={assignMutation.isPending}
                                                    data-testid={`button-pick-up-self-${item.id}`}
                                                  >
                                                    <User className="h-4 w-4 mr-1" />
                                                    Pick Up for Me
                                                  </Button>
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setPickUpItem(item)}
                                                    disabled={assignMutation.isPending}
                                                    data-testid={`button-assign-other-${item.id}`}
                                                  >
                                                    <Users className="h-4 w-4 mr-1" />
                                                    Assign to Other
                                                  </Button>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </CardContent>
                                      </Card>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })
            )}
          </div>
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
                    <div className="mt-1">
                      <QueueItemDataTemplate data={viewQueueItem.data} />
                    </div>
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

        {/* Pick Up Request Dialog */}
        <PickUpRequestDialog
          isOpen={!!pickUpItem}
          onClose={() => setPickUpItem(null)}
          onPickUp={(agentId) => {
            if (pickUpItem) {
              console.log("PickUp dialog calling handleAssignTask with:", {
                pickUpItemId: pickUpItem.id,
                agentId,
                currentUserId: user?.id,
                agentUsername: users.find((u: UserType) => u.id === agentId)?.username
              });
              handleAssignTask(pickUpItem, agentId);
            }
          }}
          users={users}
          queueModule={pickUpItem?.module}
          isLoading={assignMutation.isPending}
          currentUser={user || undefined}
        />

        {/* Work Module Dialog */}
        <WorkModuleDialog
          isOpen={isWorkModuleOpen}
          onOpenChange={setIsWorkModuleOpen}
          queueItem={workModuleItem}
          module={workModuleItem?.module}
          currentUser={user || undefined}
          users={users}
          onTaskCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
            queryClient.invalidateQueries({ queryKey: ["/api/queues/stats"] });
          }}
        />
      </div>
    </MainContent>
  );
}