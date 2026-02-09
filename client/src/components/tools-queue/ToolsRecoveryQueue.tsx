import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QueueItem, User, EnrichedToolsQueueItem } from "@shared/schema";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import {
  Search,
  AlertTriangle,
  Clock,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Check,
  LayoutDashboard,
  ListTodo,
  X,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Smartphone,
  CreditCard,
  Package,
  FileText,
  Wifi,
  WifiOff,
  Truck,
  ExternalLink,
  Send,
  UserX,
  Loader2,
} from "lucide-react";

type VehicleType = "company" | "byov" | "rental";
type RoutingDestination = "PMF" | "Pep Boys" | "Transfer" | "Pending";
type UrgencyLevel = "CRITICAL" | "HIGH" | "STANDARD";
type Status = "pending" | "in_progress" | "completed";

interface TechData {
  techName: string;
  enterpriseId: string;
  district: string | null;
  separationDate: string | null;
  mobilePhone: string | null;
  personalPhone: string | null;
  email: string | null;
  address: string | null;
  fleetPickupAddress: string | null;
  hrTruckNumber: string | null;
  separationCategory: string | null;
  notes: string | null;
  fromSnowflake?: boolean;
}

interface ToolsQueueItemEnriched extends QueueItem {
  techData?: TechData;
}

type TaskKey = 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel';

function getVehicleType(item: ToolsQueueItemEnriched): VehicleType {
  if (item.vehicleType) {
    return item.vehicleType as VehicleType;
  }
  if (item.isByov) return "byov";
  return "company";
}

function getRouting(item: ToolsQueueItemEnriched): RoutingDestination {
  const routing = item.fleetRoutingDecision?.toLowerCase() || "";
  if (routing.includes("pmf")) return "PMF";
  if (routing.includes("pep") || routing.includes("boys")) return "Pep Boys";
  if (routing.includes("transfer") || routing.includes("reassign")) return "Transfer";
  return "Pending";
}

function getDaysUntilSeparation(separationDate: string | null): number | null {
  if (!separationDate) return null;
  const sepDate = new Date(separationDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = sepDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function getUrgencyLevel(vehicleType: VehicleType, daysUntilSep: number | null): UrgencyLevel {
  const days = daysUntilSep ?? 999;
  
  if (vehicleType === "rental") {
    return days <= 7 ? "CRITICAL" : "HIGH";
  }
  if (vehicleType === "byov") {
    if (days <= 2) return "CRITICAL";
    return "HIGH";
  }
  if (days <= 2) return "HIGH";
  return "STANDARD";
}

function getTaskProgress(item: ToolsQueueItemEnriched): { completed: number; total: number; percentage: number } {
  const tasks = [
    item.taskToolsReturn,
    item.taskIphoneReturn,
    item.taskDisconnectedLine,
    item.taskDisconnectedMPayment,
    item.taskCloseSegnoOrders,
    item.taskCreateShippingLabel,
  ];
  const completed = tasks.filter(Boolean).length;
  return { completed, total: 6, percentage: (completed / 6) * 100 };
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "in_progress":
      return "secondary";
    default:
      return "outline";
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case "pending": return "Pending";
    case "in_progress": return "In Progress";
    case "completed": return "Completed";
    default: return status;
  }
}

interface FilterState {
  status: string[];
  vehicleType: string[];
  district: string[];
  incompleteOnly: boolean;
}

function ToolsRecoveryFilterBar({
  searchQuery,
  onSearchChange,
  activeFilters,
  onFilterChange,
  onClearFilters,
  availableDistricts,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilters: FilterState;
  onFilterChange: (type: keyof FilterState, value: any) => void;
  onClearFilters: () => void;
  availableDistricts: string[];
}) {
  const hasActiveFilters =
    activeFilters.status.length > 0 ||
    activeFilters.vehicleType.length > 0 ||
    activeFilters.district.length > 0 ||
    activeFilters.incompleteOnly ||
    searchQuery;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="text"
          placeholder="Search by name or ID..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select
        value={activeFilters.status[0] || "all"}
        onValueChange={(val) => onFilterChange("status", val === "all" ? [] : [val])}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={activeFilters.vehicleType[0] || "all"}
        onValueChange={(val) => onFilterChange("vehicleType", val === "all" ? [] : [val])}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All Vehicles" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Vehicles</SelectItem>
          <SelectItem value="company">Company</SelectItem>
          <SelectItem value="byov">BYOV</SelectItem>
          <SelectItem value="rental">Rental</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={activeFilters.district[0] || "all"}
        onValueChange={(val) => onFilterChange("district", val === "all" ? [] : [val])}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All Districts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Districts</SelectItem>
          {availableDistricts.map((d) => (
            <SelectItem key={d} value={d}>{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant={activeFilters.incompleteOnly ? "default" : "outline"}
        size="sm"
        onClick={() => onFilterChange("incompleteOnly", !activeFilters.incompleteOnly)}
        className="gap-2"
      >
        <ListTodo className="h-4 w-4" />
        Incomplete Only
      </Button>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-slate-500 hover:text-red-600">
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function ExpandedRowDetails({
  item,
  currentUser,
  onComplete,
  onAssign,
  isCompletePending,
  isAssignPending,
}: {
  item: ToolsQueueItemEnriched;
  currentUser?: User;
  onComplete: (id: string) => void;
  onAssign?: (id: string, assigneeId: string) => void;
  isCompletePending: boolean;
  isAssignPending?: boolean;
}) {
  const { toast } = useToast();
  const techData = item.techData;
  const isPending = item.status === "pending";
  const isAssignedToMe = item.assignedTo === currentUser?.id;

  const [taskState, setTaskState] = useState<Record<TaskKey, boolean>>({
    taskToolsReturn: item.taskToolsReturn ?? false,
    taskIphoneReturn: item.taskIphoneReturn ?? false,
    taskDisconnectedLine: item.taskDisconnectedLine ?? false,
    taskDisconnectedMPayment: item.taskDisconnectedMPayment ?? false,
    taskCloseSegnoOrders: item.taskCloseSegnoOrders ?? false,
    taskCreateShippingLabel: item.taskCreateShippingLabel ?? false,
  });

  const [carrier, setCarrier] = useState<string>(item.carrier || "");
  const [routing, setRouting] = useState<string>(item.fleetRoutingDecision || "Pending");

  const { saveStatus, save: debouncedSave } = useDebouncedSave({ itemId: item.id });

  const handleTaskChange = (key: TaskKey, checked: boolean) => {
    const newState = { ...taskState, [key]: checked };
    setTaskState(newState);
    debouncedSave({ [key]: checked });
  };

  const handleCarrierChange = (value: string) => {
    setCarrier(value);
    debouncedSave({ carrier: value });
  };

  const handleRoutingChange = (value: string) => {
    setRouting(value);
    debouncedSave({ fleetRoutingDecision: value });
  };

  const completedTasksCount = Object.values(taskState).filter(Boolean).length;

  const taskItems = [
    { key: "taskToolsReturn" as TaskKey, label: "Tools Return Asset", desc: "Verify all assigned tools returned", icon: Briefcase },
    { key: "taskIphoneReturn" as TaskKey, label: "iPhone Return Asset", desc: "Check condition and unlock status", icon: Smartphone },
    { key: "taskDisconnectedLine" as TaskKey, label: "Disconnect Phone Line", desc: "Suspend service", icon: Wifi, showCarrier: true },
    { key: "taskDisconnectedMPayment" as TaskKey, label: "Deactivate mPayment", desc: "Remove access in Temples system", icon: CreditCard },
    { key: "taskCloseSegnoOrders" as TaskKey, label: "Close Segno Orders", desc: "Ensure no open work orders remain", icon: FileText },
    { key: "taskCreateShippingLabel" as TaskKey, label: "Create UPS Shipping Label", desc: "Generate QR code for tech", icon: Package },
  ];

  return (
    <div className="p-6 bg-slate-50 border-t border-b border-slate-200 shadow-inner">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Column 1: Contact & Routing */}
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <UserX className="h-4 w-4 text-slate-500" />
              Contact Details
            </h4>
            <div className="bg-white p-4 rounded-md border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Mobile Phone:</span>
                <span className="text-sm font-medium text-slate-900 flex items-center gap-1">
                  <Smartphone className="h-3 w-3 text-slate-400" />
                  {techData?.mobilePhone || "N/A"}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Personal Phone:</span>
                {techData?.personalPhone ? (
                  <span className="text-sm font-medium text-[#2db386] bg-[#36D9A3]/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {techData.personalPhone}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">N/A</span>
                )}
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Email:</span>
                {techData?.email ? (
                  <a
                    href={`mailto:${techData.email}`}
                    className="text-sm font-medium text-[#1A4B8C] hover:underline flex items-center gap-1"
                  >
                    <Mail className="h-3 w-3" />
                    {techData.email}
                  </a>
                ) : (
                  <span className="text-sm text-slate-400">N/A</span>
                )}
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Address:</span>
                <span className="text-sm font-medium text-slate-900 text-right max-w-[200px] flex items-start justify-end gap-1">
                  <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {techData?.address || "N/A"}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Fleet Pickup Address:</span>
                <span className="text-sm font-medium text-slate-900 text-right max-w-[200px] flex items-start justify-end gap-1">
                  <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-500" />
                  {techData?.fleetPickupAddress || "N/A"}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">HR Truck Number:</span>
                <span className="text-sm font-medium text-slate-900 flex items-center gap-1">
                  <Truck className="h-3 w-3 text-amber-500" />
                  {techData?.hrTruckNumber || "N/A"}
                </span>
              </div>
              {techData?.notes && (
                <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
                  <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">HR Notes:</span>
                  <p className="text-sm text-slate-700 mt-1">{techData.notes}</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Truck className="h-4 w-4 text-slate-500" />
              Vehicle Routing
            </h4>
            <div className="bg-white p-4 rounded-md border border-slate-200 shadow-sm">
              <RadioGroup value={routing} onValueChange={handleRoutingChange}>
                {["PMF", "Pep Boys", "Transfer", "Pending"].map((option) => (
                  <div key={option} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50">
                    <RadioGroupItem value={option} id={`routing-${item.id}-${option}`} />
                    <Label htmlFor={`routing-${item.id}-${option}`} className="text-sm font-medium text-slate-700 cursor-pointer">
                      {option}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        </div>

        {/* Column 2: Task Checklist */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-slate-500" />
              Recovery Tasks
            </h4>
            <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
              {completedTasksCount}/6 Complete
            </span>
          </div>

          <div className="bg-white rounded-md border border-slate-200 shadow-sm divide-y divide-slate-100">
            {taskItems.map((task) => {
              const Icon = task.icon;
              const isChecked = taskState[task.key];
              return (
                <label
                  key={task.key}
                  className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-50 transition-colors ${isChecked ? "bg-slate-50/50" : ""}`}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(checked) => handleTaskChange(task.key, !!checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${isChecked ? "text-slate-500 line-through" : "text-slate-900"}`}>
                      {task.label}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.showCarrier && carrier && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                          {carrier}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-500">{task.desc}</span>
                    </div>
                  </div>
                  <Icon className={`h-4 w-4 ${isChecked ? "text-slate-300" : "text-slate-400"}`} />
                </label>
              );
            })}
          </div>

          {saveStatus !== "idle" && (
            <div className="text-xs text-center">
              {saveStatus === "saving" && <span className="text-slate-500">Saving...</span>}
              {saveStatus === "saved" && <span className="text-green-600">Saved</span>}
              {saveStatus === "error" && <span className="text-red-600">Error saving</span>}
            </div>
          )}
        </div>

        {/* Column 3: Actions */}
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">
              Quick Actions
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" className="justify-start" asChild>
                <a
                  href="https://tech-tool-audit-checklist-lucabuccilli1.replit.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Briefcase className="h-4 w-4 mr-2 text-slate-500" />
                  View Tool Audit Form
                  <ExternalLink className="h-3 w-3 ml-auto" />
                </a>
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <FileText className="h-4 w-4 mr-2 text-slate-500" />
                View in Segno
                <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <Package className="h-4 w-4 mr-2 text-slate-500" />
                Generate Return Label
                <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <Send className="h-4 w-4 mr-2 text-slate-500" />
                Send Reminder Email
                <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
              </Button>

              <Separator className="my-2" />

              {isPending && !isAssignedToMe && onAssign && currentUser && (
                <Button
                  className="w-full"
                  style={{ backgroundColor: "#1A4B8C" }}
                  onClick={() => onAssign(item.id, currentUser.id)}
                  disabled={isAssignPending}
                >
                  {isAssignPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Assign to Me
                    </>
                  )}
                </Button>
              )}

              <Button
                className="w-full"
                style={{ backgroundColor: "#36D9A3" }}
                onClick={() => onComplete(item.id)}
                disabled={isCompletePending || (isPending && !isAssignedToMe)}
              >
                {isCompletePending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Case Complete
                  </>
                )}
              </Button>
              {isPending && !isAssignedToMe && (
                <p className="text-xs text-muted-foreground text-center">
                  Assign to yourself first to mark complete
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ToolsRecoveryQueue() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    status: [],
    vehicleType: [],
    district: [],
    incompleteOnly: false,
  });
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const itemsPerPage = 10;

  const { data: queueItems = [], isLoading, refetch } = useQuery<ToolsQueueItemEnriched[]>({
    queryKey: ["/api/tools-queue"],
    refetchInterval: 30000,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const completeMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiRequest("PATCH", `/api/tools-queue/${itemId}/complete`, { completedBy: user?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
      toast({ title: "Case marked complete" });
      setExpandedRowId(null);
    },
    onError: () => {
      toast({ title: "Failed to complete case", variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) =>
      apiRequest("PATCH", `/api/tools-queue/${queueItemId}/assign`, { assigneeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools-queue"] });
      toast({ title: "Case assigned to you" });
    },
    onError: () => {
      toast({ title: "Failed to assign case", variant: "destructive" });
    },
  });

  const availableDistricts = useMemo(() => {
    const districts = new Set<string>();
    queueItems.forEach((item) => {
      if (item.techData?.district) {
        districts.add(item.techData.district);
      }
    });
    return Array.from(districts).sort();
  }, [queueItems]);

  const filteredData = useMemo(() => {
    return queueItems.filter((item) => {
      const searchLower = searchQuery.toLowerCase();
      const techData = item.techData;
      const matchesSearch =
        !searchQuery ||
        techData?.techName?.toLowerCase().includes(searchLower) ||
        techData?.enterpriseId?.toLowerCase().includes(searchLower) ||
        item.title?.toLowerCase().includes(searchLower);

      const matchesStatus =
        filters.status.length === 0 || filters.status.includes(item.status);

      const vehicleType = getVehicleType(item);
      const matchesVehicle =
        filters.vehicleType.length === 0 || filters.vehicleType.includes(vehicleType);

      const matchesDistrict =
        filters.district.length === 0 ||
        (techData?.district && filters.district.includes(techData.district));

      const taskProgress = getTaskProgress(item);
      const matchesIncomplete = !filters.incompleteOnly || taskProgress.completed < taskProgress.total;

      return matchesSearch && matchesStatus && matchesVehicle && matchesDistrict && matchesIncomplete;
    });
  }, [queueItems, searchQuery, filters]);

  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;
    return [...filteredData].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortConfig.key) {
        case "techName":
          aVal = a.techData?.techName || "";
          bVal = b.techData?.techName || "";
          break;
        case "district":
          aVal = a.techData?.district || "";
          bVal = b.techData?.district || "";
          break;
        case "separationDate":
          aVal = a.techData?.separationDate || "";
          bVal = b.techData?.separationDate || "";
          break;
        case "vehicleType":
          aVal = getVehicleType(a);
          bVal = getVehicleType(b);
          break;
        case "routing":
          aVal = getRouting(a);
          bVal = getRouting(b);
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const paginatedData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const stats = useMemo(() => {
    const total = queueItems.length;
    const urgent = queueItems.filter((item) => {
      const vt = getVehicleType(item);
      return vt === "rental" || vt === "byov";
    }).length;
    const inProgress = queueItems.filter((i) => i.status === "in_progress").length;
    const completed = queueItems.filter((i) => i.status === "completed").length;
    return { total, urgent, inProgress, completed };
  }, [queueItems]);

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const handleFilterChange = (type: keyof FilterState, value: any) => {
    if (type === "incompleteOnly") {
      setFilters((prev) => ({ ...prev, incompleteOnly: value }));
    } else {
      setFilters((prev) => ({ ...prev, [type]: value }));
    }
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setFilters({ status: [], vehicleType: [], district: [], incompleteOnly: false });
    setCurrentPage(1);
  };

  const getVehicleBadgeStyle = (type: VehicleType) => {
    switch (type) {
      case "byov":
        return "bg-green-100 text-green-800 border-green-200";
      case "rental":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const getUrgencyBadgeStyle = (level: UrgencyLevel) => {
    switch (level) {
      case "CRITICAL":
        return "bg-red-500 text-white";
      case "HIGH":
        return "bg-orange-500 text-white";
      default:
        return "bg-slate-200 text-slate-700";
    }
  };

  const columns = [
    { key: "techName", label: "Technician", width: "w-48" },
    { key: "district", label: "District", width: "w-20" },
    { key: "separationDate", label: "Last Day", width: "w-28" },
    { key: "vehicleType", label: "Vehicle", width: "w-24" },
    { key: "routing", label: "Routing", width: "w-24" },
    { key: "status", label: "Status", width: "w-28" },
    { key: "tasks", label: "Tasks", width: "w-32" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-[#1A4B8C] p-1.5 rounded">
            <LayoutDashboard className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-[#1A4B8C]">Tools Recovery Queue</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{stats.total} cases</span>
          <div className="h-4 w-px bg-slate-200" />
          <Badge variant="destructive" className="h-6 px-2 gap-1 text-xs">
            <AlertTriangle className="h-3 w-3" />
            {stats.urgent} Urgent
          </Badge>
          <Badge className="h-6 px-2 gap-1 text-xs bg-[#1A4B8C]">
            <Clock className="h-3 w-3" />
            {stats.inProgress} Active
          </Badge>
          <Badge className="h-6 px-2 gap-1 text-xs bg-[#36D9A3]/10 text-[#2db386] border border-[#36D9A3]/20">
            <CheckCircle className="h-3 w-3" />
            {stats.completed} Done
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <ToolsRecoveryFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        availableDistricts={availableDistricts}
      />

      {/* Table */}
      <div className="w-full bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#1A4B8C] text-white">
              <tr>
                <th className="w-12 px-4 py-3"></th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`${col.width} px-4 py-3 font-semibold cursor-pointer hover:bg-[#153d73] transition-colors`}
                    onClick={() => col.key !== "tasks" && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortConfig?.key === col.key && (
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${sortConfig.direction === "asc" ? "rotate-180" : ""}`}
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedData.map((row) => {
                const vehicleType = getVehicleType(row);
                const routing = getRouting(row);
                const daysUntilSep = getDaysUntilSeparation(row.techData?.separationDate || null);
                const urgency = getUrgencyLevel(vehicleType, daysUntilSep);
                const isUrgent = urgency === "CRITICAL" || urgency === "HIGH";
                const isExpanded = expandedRowId === row.id;
                const taskProgress = getTaskProgress(row);

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`group transition-all cursor-pointer ${isUrgent ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-slate-50"} ${isExpanded ? "bg-slate-50" : ""}`}
                      onClick={() => setExpandedRowId(isExpanded ? null : row.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                          {isUrgent && <AlertTriangle className="h-4 w-4 text-red-500" />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.techData?.techName || "Unknown"}</div>
                        <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
                          {row.techData?.enterpriseId || "N/A"}
                          {row.techData?.fromSnowflake && (
                            <span className="text-[10px] text-slate-400 italic">Source: Snowflake</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.techData?.district || "N/A"}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.techData?.separationDate
                          ? new Date(row.techData.separationDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : "N/A"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${getVehicleBadgeStyle(vehicleType)}`}>
                          {vehicleType === "byov" ? "BYOV" : vehicleType === "rental" ? "Rental" : "Company"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{routing}</td>
                      <td className="px-4 py-3">
                        <Badge variant={getStatusBadgeVariant(row.status)} className="text-xs">
                          {formatStatus(row.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${taskProgress.completed === taskProgress.total ? "bg-[#36D9A3]" : "bg-[#1A4B8C]"}`}
                                style={{ width: `${taskProgress.percentage}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-slate-500 w-8">
                            {taskProgress.completed}/{taskProgress.total}
                          </span>
                          {taskProgress.completed === taskProgress.total && (
                            <Check className="h-3.5 w-3.5 text-[#36D9A3]" />
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <ExpandedRowDetails
                            item={row}
                            currentUser={user ?? undefined}
                            onComplete={(id) => completeMutation.mutate(id)}
                            onAssign={(id, assigneeId) => assignMutation.mutate({ queueItemId: id, assigneeId })}
                            isCompletePending={completeMutation.isPending}
                            isAssignPending={assignMutation.isPending}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <div className="text-sm text-slate-500">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length} cases
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={page}
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className={currentPage === page ? "bg-[#1A4B8C]" : ""}
                  >
                    {page}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {paginatedData.length === 0 && (
          <div className="p-12 text-center text-slate-500">No recovery cases found matching your filters.</div>
        )}
      </div>
    </div>
  );
}
