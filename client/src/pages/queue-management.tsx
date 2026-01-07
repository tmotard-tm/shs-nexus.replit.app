import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
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
  Edit,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { PickUpRequestDialog } from "@/components/pick-up-request-dialog";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { QueueItemDataTemplate } from "@/components/queue-item-data-template";
import { TechCombobox, TechRosterEntry } from "@/components/ui/tech-combobox";
import { usePreviewRole } from "@/hooks/use-preview-role";
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
  
  // Use departments array to determine accessible modules
  if (user.departments && Array.isArray(user.departments)) {
    return user.departments
      .map(dept => departmentToQueueModule(dept))
      .filter((module: QueueModule | null) => module !== null) as QueueModule[];
  }
  
  return [];
}

export default function UnifiedQueueManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { permissions } = usePermissions();
  const { previewUser, isUserPreviewMode } = usePreviewRole();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  
  // Page feature permissions
  const pagePerms = permissions.pageFeatures?.queueManagement;
  const filterPerms = pagePerms?.filters;
  const taskPerms = pagePerms?.taskActions;
  const adminPerms = pagePerms?.adminActions;
  
  // Selected queue modules - start with empty array for security
  const [selectedModules, setSelectedModules] = useState<QueueModule[]>([]);
  
  // Filters
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [selectedWorkflowType, setSelectedWorkflowType] = useState<string>("all");
  const [selectedEmployee, setSelectedEmployee] = useState<TechRosterEntry | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortField, setSortField] = useState<"dateAdded" | "lastDayWorking">("dateAdded");
  const [sortDirection, setSortDirection] = useState<"newest" | "oldest">("oldest");
  const [expandedQueues, setExpandedQueues] = useState<Record<QueueModule, boolean>>({} as Record<QueueModule, boolean>);
  const [expandedStatusSections, setExpandedStatusSections] = useState<Record<string, boolean>>({});
  const [viewQueueItem, setViewQueueItem] = useState<CombinedQueueItem | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pickUpItem, setPickUpItem] = useState<CombinedQueueItem | null>(null);
  const [workModuleItem, setWorkModuleItem] = useState<CombinedQueueItem | null>(null);
  const [isWorkModuleOpen, setIsWorkModuleOpen] = useState(false);
  const [reassignItem, setReassignItem] = useState<CombinedQueueItem | null>(null);
  const [selectedReassignee, setSelectedReassignee] = useState<string>("");
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);

  // Get accessible modules for current user (use preview user departments when in preview mode)
  const effectiveUser = isUserPreviewMode && previewUser ? {
    ...user,
    role: previewUser.role,
    departments: previewUser.departments,
  } as UserType : user;
  
  const accessibleModules = effectiveUser ? getUserAccessibleModules(effectiveUser) : [];

  // Handle URL parameters for department and employee filters
  useEffect(() => {
    if (searchString && user) {
      const params = new URLSearchParams(searchString);
      const deptParam = params.get('dept');
      const employeeId = params.get('employeeId');
      const techRacfId = params.get('techRacfId');
      const techName = params.get('techName');
      
      // Handle department deep-link
      if (deptParam) {
        const deptModule = departmentToQueueModule(deptParam.toUpperCase());
        if (deptModule && accessibleModules.includes(deptModule)) {
          setSelectedModules([deptModule]);
        } else if (accessibleModules.length > 0) {
          // Fallback to all accessible if invalid department
          setSelectedModules(accessibleModules);
        }
      } else if (selectedModules.length === 0 && accessibleModules.length > 0) {
        // Default to all accessible modules if no dept specified
        setSelectedModules(accessibleModules);
      }
      
      // Handle employee filter
      if (employeeId || techRacfId || techName) {
        setSelectedEmployee({
          id: employeeId || '',
          employeeId: employeeId || '',
          techRacfid: techRacfId || '',
          techName: techName || '',
        });
        
        toast({
          title: "Filter Applied",
          description: `Showing tasks for ${techName || employeeId || techRacfId}`,
        });
      }
      
      // Clear URL parameters after applying (keep URL clean)
      if (deptParam || employeeId || techRacfId || techName) {
        navigate('/queue-management', { replace: true });
      }
    } else if (user && selectedModules.length === 0 && accessibleModules.length > 0) {
      // Auto-populate modules on initial load
      setSelectedModules(accessibleModules);
    }
  }, [searchString, user, accessibleModules.length]);

  // Reset selected modules when preview user changes (department access changes)
  useEffect(() => {
    if (accessibleModules.length > 0) {
      // Filter selectedModules to only include accessible ones
      const validModules = selectedModules.filter(m => accessibleModules.includes(m));
      if (validModules.length === 0) {
        // If no valid modules, default to all accessible
        setSelectedModules(accessibleModules);
      } else if (validModules.length !== selectedModules.length) {
        // If some modules were removed, update to only valid ones
        setSelectedModules(validModules);
      }
    }
  }, [previewUser?.id, previewUser?.departments?.join(',')]);

  // Handle department tab click - updates URL and selected modules
  const handleDepartmentTabClick = (module: QueueModule | 'all') => {
    if (module === 'all') {
      setSelectedModules(accessibleModules);
    } else {
      setSelectedModules([module]);
    }
  };

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

  // Release queue item mutation (superadmin only)
  const releaseMutation = useMutation({
    mutationFn: async ({ module, id }: { module: QueueModule; id: string }) => {
      const response = await apiRequest("PATCH", `/api/queues/${module}/${id}/release`);
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
      setViewQueueItem(null);
      toast({
        title: "Task Released",
        description: "Task has been released and is now available for pickup",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to release task",
        variant: "destructive",
      });
    },
  });

  // Reassign queue item mutation (superadmin only)
  const reassignMutation = useMutation({
    mutationFn: async ({ module, id, assigneeId }: { module: QueueModule; id: string; assigneeId: string }) => {
      const response = await apiRequest("PATCH", `/api/queues/${module}/${id}/reassign`, {
        assigneeId,
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
      setReassignItem(null);
      setSelectedReassignee("");
      setViewQueueItem(null);
      toast({
        title: "Task Reassigned",
        description: "Task has been reassigned successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reassign task",
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
      userDepts: user.departments
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

  // Helper function to extract lastDayWorked from a queue item's data
  const getLastDayWorked = (item: CombinedQueueItem): string | null => {
    if (!item.data) return null;
    try {
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
      // Check multiple possible locations for lastDayWorked
      return data?.employee?.lastDayWorked || 
             data?.technician?.lastDayWorked || 
             data?.lastDayWorked || 
             null;
    } catch {
      return null;
    }
  };

  // Filter items based on date, agent, workflow type, and employee criteria
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

    // Apply employee filter - search through the data JSON field
    // Supports both Snowflake sync format (data.technician) and offboarding form format (data.employee)
    if (selectedEmployee) {
      filtered = filtered.filter(item => {
        if (!item.data) return false;
        try {
          const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
          
          // Get employee data from either technician (Snowflake sync) or employee (offboarding form) or root
          const technician = data?.technician || data?.employee || data;
          
          // Match by employeeId - check multiple possible field locations
          const employeeIdMatch = 
            technician?.employeeId === selectedEmployee.employeeId ||
            data?.employee?.employeeId === selectedEmployee.employeeId;
          
          // Match by techRacfid/enterpriseId/racfId - check multiple possible field locations
          const racfIdMatch = 
            (technician?.techRacfid || technician?.enterpriseId || technician?.racfId) === selectedEmployee.techRacfid ||
            (data?.employee?.racfId || data?.employee?.enterpriseId) === selectedEmployee.techRacfid;
          
          // Match by name - check techName and name fields
          const nameMatch = 
            technician?.techName === selectedEmployee.techName || 
            technician?.name === selectedEmployee.techName ||
            data?.employee?.name === selectedEmployee.techName;
          
          return employeeIdMatch || racfIdMatch || nameMatch;
        } catch {
          return false;
        }
      });
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

    // Apply sort order based on sortField and sortDirection
    filtered = [...filtered].sort((a, b) => {
      if (sortField === "dateAdded") {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return sortDirection === "newest" ? dateB - dateA : dateA - dateB;
      } else {
        // Sort by lastDayWorking
        const lastDayA = getLastDayWorked(a);
        const lastDayB = getLastDayWorked(b);
        
        // Items without lastDayWorked go to the end
        if (!lastDayA && !lastDayB) return 0;
        if (!lastDayA) return 1;
        if (!lastDayB) return -1;
        
        const dateA = new Date(lastDayA).getTime();
        const dateB = new Date(lastDayB).getTime();
        return sortDirection === "newest" ? dateB - dateA : dateA - dateB;
      }
    });

    return filtered;
  };

  // Toggle expanded state for queue sections
  const toggleQueueExpansion = (module: QueueModule) => {
    setExpandedQueues(prev => ({
      ...prev,
      [module]: !prev[module]
    }));
  };

  // Toggle expanded state for status sections within queues
  const toggleStatusSection = (module: QueueModule, status: string) => {
    const key = `${module}-${status}`;
    setExpandedStatusSections(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key]
    }));
  };

  // Check if a status section is expanded (default to collapsed)
  const isStatusSectionExpanded = (module: QueueModule, status: string) => {
    const key = `${module}-${status}`;
    return expandedStatusSections[key] === true;
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

        {/* Department Tabs - Quick department switching */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={selectedModules.length === accessibleModules.length ? "default" : "outline"}
            size="sm"
            onClick={() => handleDepartmentTabClick('all')}
            className="flex items-center gap-2"
            data-testid="tab-dept-all"
          >
            <List className="h-4 w-4" />
            All Queues
            <Badge variant="secondary" className="ml-1">
              {queueItems.filter(item => item.status === 'pending' || item.status === 'in_progress').length}
            </Badge>
          </Button>
          {accessibleModules.map((module) => {
            const moduleOpenCount = queueItems.filter(
              item => item.module === module && (item.status === 'pending' || item.status === 'in_progress')
            ).length;
            const isActive = selectedModules.length === 1 && selectedModules[0] === module;
            
            return (
              <Button
                key={module}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => handleDepartmentTabClick(module)}
                className={`flex items-center gap-2 ${isActive ? getModuleColor(module).replace('bg-', 'bg-') : ''}`}
                data-testid={`tab-dept-${module}`}
              >
                <span>{getModuleIcon(module)}</span>
                {moduleLabels[module]}
                <Badge variant={isActive ? "outline" : "secondary"} className="ml-1">
                  {moduleOpenCount}
                </Badge>
              </Button>
            );
          })}
        </div>

        {/* Filters and Search - Collapsible */}
        <Collapsible open={isFiltersExpanded} onOpenChange={setIsFiltersExpanded}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Filters & Search
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-normal text-muted-foreground">
                      {isFiltersExpanded ? "Click to collapse" : "Click to expand"}
                    </span>
                    {isFiltersExpanded ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            {/* Show Queues Selection - controlled by queueCheckboxes permission */}
            {(filterPerms?.queueCheckboxes !== false) && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Show Queues ({(queueStats?.pending || 0) + (queueStats?.in_progress || 0)} - Total Open Tasks)</Label>
              <div className="flex flex-wrap gap-6">
                {(Object.keys(moduleLabels) as QueueModule[]).map((module) => {
                  // Only show checkboxes for modules the user has access to (respects preview mode)
                  if (!accessibleModules.includes(module)) return null;
                  
                  const moduleOpenCount = queueItems.filter(
                    item => item.module === module && (item.status === 'pending' || item.status === 'in_progress')
                  ).length;
                  
                  return (
                    <div key={module} className="flex flex-col">
                      <div className="flex items-center space-x-2">
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
                      <span className="text-xs text-muted-foreground ml-6">
                        ({moduleOpenCount} - Open Tasks)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
              {/* Status Filter Cards - controlled by statusCards permission */}
              {(filterPerms?.statusCards !== false) && (
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
              )}
              
              {/* Employee Search Filter - Full Width Row - controlled by employeeSearch permission */}
              {(filterPerms?.employeeSearch !== false) && (
              <div className="mb-4">
                <Label htmlFor="employee-search">Search Employee</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <TechCombobox
                      value={selectedEmployee?.techName || ""}
                      onSelect={(tech) => setSelectedEmployee(tech)}
                      searchField="techName"
                      placeholder="Search by name, ID, or Enterprise ID..."
                      data-testid="combobox-employee-filter"
                    />
                  </div>
                  {selectedEmployee && (
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => setSelectedEmployee(null)}
                      data-testid="button-clear-employee-filter"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {selectedEmployee && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Filtering by: {selectedEmployee.techName} (ID: {selectedEmployee.employeeId}, Enterprise: {selectedEmployee.techRacfid})
                  </p>
                )}
              </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Workflow Type Filter - controlled by workflowTypeFilter permission */}
                {(filterPerms?.workflowTypeFilter !== false) && (
                <div>
                  <Label htmlFor="workflow-type">Workflow Type</Label>
                  <Select value={selectedWorkflowType} onValueChange={setSelectedWorkflowType}>
                    <SelectTrigger data-testid="select-workflow-type">
                      <SelectValue placeholder="Select workflow type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Workflow Types</SelectItem>
                      <SelectItem value="byov_assignment">BYOV Assignment</SelectItem>
                      <SelectItem value="decommission">Decommission</SelectItem>
                      <SelectItem value="offboarding">Offboarding</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="storage_request">Storage Request</SelectItem>
                      <SelectItem value="vehicle_assignment">Vehicle Assignment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                )}

                {/* Assigned Agent Filter - controlled by assignedAgentFilter permission */}
                {(filterPerms?.assignedAgentFilter !== false) && (
                <div>
                  <Label htmlFor="agent">Assigned Agent</Label>
                  <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                    <SelectTrigger data-testid="select-assigned-agent">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Agents</SelectItem>
                      {[...users].sort((a: UserType, b: UserType) => 
                        a.username.localeCompare(b.username)
                      ).map((selectUser: UserType) => (
                        <SelectItem key={selectUser.id} value={selectUser.id}>
                          {selectUser.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                )}

                {/* Date Filters - controlled by dateFilters permission */}
                {(filterPerms?.dateFilters !== false) && (
                <>
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
                </>
                )}

                {/* Sort Field - controlled by sortOrder permission */}
                {(filterPerms?.sortOrder !== false) && (
                <>
                <div>
                  <Label htmlFor="sort-field">Sort By</Label>
                  <Select value={sortField} onValueChange={(value: "dateAdded" | "lastDayWorking") => setSortField(value)}>
                    <SelectTrigger data-testid="select-sort-field">
                      <SelectValue placeholder="Sort field" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dateAdded">Date Added</SelectItem>
                      <SelectItem value="lastDayWorking">Last Day Working</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="sort-direction">Order</Label>
                  <Select value={sortDirection} onValueChange={(value: "newest" | "oldest") => setSortDirection(value)}>
                    <SelectTrigger data-testid="select-sort-direction">
                      <SelectValue placeholder="Sort direction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oldest">Oldest First</SelectItem>
                      <SelectItem value="newest">Newest First</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                </>
                )}
              </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

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
                const isExpanded = expandedQueues[module] === true; // Default to collapsed
                
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

                              const isSectionExpanded = isStatusSectionExpanded(module, status);
                              
                              return (
                                <div key={status} className="space-y-3">
                                  <div 
                                    className={`flex items-center gap-2 p-3 rounded-lg ${color} text-white cursor-pointer hover:opacity-90 transition-opacity`}
                                    onClick={() => toggleStatusSection(module, status)}
                                    data-testid={`status-header-${module}-${status}`}
                                  >
                                    <Icon className="h-5 w-5" />
                                    <h4 className="font-semibold">{label}</h4>
                                    <Badge variant="secondary" className="bg-white/20 text-white ml-auto">
                                      {statusItems.length} items
                                    </Badge>
                                    <span className="ml-2">{isSectionExpanded ? "▼" : "▶"}</span>
                                  </div>
                                  
                                  {isSectionExpanded && (
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

                                              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                                <div className="flex items-center gap-1" title="Date Added">
                                                  <Calendar className="h-4 w-4" />
                                                  <span>Added: {new Date(item.createdAt).toLocaleDateString()}</span>
                                                </div>
                                                
                                                {getLastDayWorked(item) && (
                                                  <div className="flex items-center gap-1 text-orange-600 dark:text-orange-400 font-medium" title="Last Day Working">
                                                    <Clock className="h-4 w-4" />
                                                    <span>Last Day: {new Date(getLastDayWorked(item)!).toLocaleDateString()}</span>
                                                  </div>
                                                )}
                                                
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

                                            {/* Direct action buttons - controlled by taskActions permissions */}
                                            <div className="flex flex-col gap-2 ml-4 min-w-fit">
                                              <div className="flex items-center gap-2">
                                                {/* View button - controlled by viewTask permission */}
                                                {(taskPerms?.viewTask !== false) && (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => setViewQueueItem(item)}
                                                  data-testid={`button-view-${item.id}`}
                                                >
                                                  <Eye className="h-4 w-4 mr-1" />
                                                  View
                                                </Button>
                                                )}
                                                
                                                {/* Start Work button - controlled by startWork permission */}
                                                {(taskPerms?.startWork !== false) && item.status === "pending" && item.assignedTo === user?.id && (
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
                                                
                                                {/* Continue Work button - controlled by continueWork permission */}
                                                {(taskPerms?.continueWork !== false) && item.status === "in_progress" && item.assignedTo === user?.id && (
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
                                                  {/* Pick Up for Me - controlled by pickUpForMe permission */}
                                                  {(taskPerms?.pickUpForMe !== false) && (
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
                                                  )}
                                                  {/* Assign to Other - controlled by assignToOther permission */}
                                                  {(taskPerms?.assignToOther !== false) && (
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
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </CardContent>
                                      </Card>
                                    ))}
                                  </div>
                                  )}
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

                {/* Admin Actions - Release and Reassign - controlled by adminActions permissions */}
                {(adminPerms?.enabled !== false) && viewQueueItem.assignedTo && viewQueueItem.status !== 'completed' && (
                  <div className="border-t pt-4 mt-4">
                    <Label className="text-base font-semibold mb-3 block">Admin Actions</Label>
                    <p className="text-sm text-muted-foreground mb-3">
                      This task is currently assigned to{' '}
                      <span className="font-medium">
                        {users.find((u: UserType) => u.id === viewQueueItem.assignedTo)?.username || 'Unknown User'}
                      </span>
                    </p>
                    <div className="flex gap-3">
                      {/* Release Task - controlled by releaseTask permission */}
                      {(adminPerms?.releaseTask !== false) && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          releaseMutation.mutate({ 
                            module: viewQueueItem.module, 
                            id: viewQueueItem.id 
                          });
                        }}
                        disabled={releaseMutation.isPending}
                        data-testid="button-release-task"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        {releaseMutation.isPending ? "Releasing..." : "Release Task"}
                      </Button>
                      )}
                      {/* Reassign Task - controlled by reassignTask permission */}
                      {(adminPerms?.reassignTask !== false) && (
                      <Button
                        variant="default"
                        onClick={() => {
                          setReassignItem(viewQueueItem);
                          setSelectedReassignee("");
                        }}
                        data-testid="button-reassign-task"
                      >
                        <Users className="h-4 w-4 mr-2" />
                        Reassign Task
                      </Button>
                      )}
                    </div>
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

        {/* Reassign Task Dialog */}
        <Dialog open={!!reassignItem} onOpenChange={() => {
          setReassignItem(null);
          setSelectedReassignee("");
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reassign Task</DialogTitle>
              <DialogDescription>
                Select a new agent to assign this task to.
              </DialogDescription>
            </DialogHeader>
            {reassignItem && (
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium">{reassignItem.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Currently assigned to:{' '}
                    <span className="font-medium">
                      {users.find((u: UserType) => u.id === reassignItem.assignedTo)?.username || 'Unknown'}
                    </span>
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="reassignee">New Assignee</Label>
                  <Select value={selectedReassignee} onValueChange={setSelectedReassignee}>
                    <SelectTrigger data-testid="select-reassignee">
                      <SelectValue placeholder="Select an agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {users
                        .filter((u: UserType) => u.id !== reassignItem.assignedTo)
                        .map((u: UserType) => (
                          <SelectItem key={u.id} value={u.id} data-testid={`option-reassign-${u.id}`}>
                            {u.username} ({u.role})
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReassignItem(null);
                      setSelectedReassignee("");
                    }}
                    data-testid="button-cancel-reassign"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedReassignee && reassignItem) {
                        reassignMutation.mutate({
                          module: reassignItem.module,
                          id: reassignItem.id,
                          assigneeId: selectedReassignee
                        });
                      }
                    }}
                    disabled={!selectedReassignee || reassignMutation.isPending}
                    data-testid="button-confirm-reassign"
                  >
                    {reassignMutation.isPending ? "Reassigning..." : "Confirm Reassign"}
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