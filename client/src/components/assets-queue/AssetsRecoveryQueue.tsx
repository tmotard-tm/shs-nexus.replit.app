import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { QueueItem, User } from "@shared/schema";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import { PickUpRequestDialog } from "@/components/pick-up-request-dialog";
import { WorkModuleDialog } from "@/components/work-module-dialog";
import { AssetsTaskDetailView } from "@/components/assets-queue/AssetsTaskDetailView";
import {
  type DataSource,
  type TechData,
  type AssetsQueueItemEnriched,
  SourceDot,
  SourceLegend,
  pickSourced,
  parseTechData,
  enrichItem,
} from "@/components/assets-queue/tech-data-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Truck,
  ExternalLink,
  Send,
  UserX,
  UserCheck,
  Loader2,
  Save,
  Edit3,
} from "lucide-react";

type VehicleType = "company" | "byov" | "rental";
type UrgencyLevel = "CRITICAL" | "HIGH" | "STANDARD";

type TaskKey = 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel';

function getVehicleType(item: AssetsQueueItemEnriched): VehicleType {
  if ((item as any).vehicleType === "byov" || (item as any).isByov) return "byov";
  if ((item as any).vehicleType === "rental") return "rental";
  if ((item as any).vehicleType) return (item as any).vehicleType as VehicleType;
  return "company";
}


function getDaysSinceSeparation(separationDate: string | null): number | null {
  if (!separationDate) return null;
  const sepDate = new Date(separationDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  sepDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - sepDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function getDaysUntilSeparation(separationDate: string | null): number | null {
  if (!separationDate) return null;
  const sepDate = new Date(separationDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = sepDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getAgingBadge(separationDate: string | null): { label: string; className: string } | null {
  const daysSince = getDaysSinceSeparation(separationDate);
  if (daysSince === null) return null;
  if (daysSince < 0) return { label: "Upcoming", className: "bg-blue-100 text-blue-700 border-blue-200" };
  if (daysSince <= 7) return { label: "New", className: "bg-green-100 text-green-700 border-green-200" };
  if (daysSince <= 30) return { label: "Active", className: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" };
}

function getUrgencyLevel(vehicleType: VehicleType, daysUntilSep: number | null): UrgencyLevel {
  const days = daysUntilSep ?? 999;
  if (vehicleType === "rental") return days <= 7 ? "CRITICAL" : "HIGH";
  if (vehicleType === "byov") return days <= 2 ? "CRITICAL" : "HIGH";
  if (days <= 2) return "HIGH";
  return "STANDARD";
}

function getTaskProgress(item: AssetsQueueItemEnriched): { completed: number; total: number; percentage: number } {
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

type SourceLabel = "fleet_separation" | "terminated_tech" | "both" | "manual";

function getItemSourceFromData(item: QueueItem): boolean {
  try {
    const parsed = item.data ? JSON.parse(item.data) : {};
    const source = parsed.source || "";
    if (
      source === "snowflake_sync" ||
      source === "hr_separation" ||
      source === "hr_separation_sync"
    ) {
      return true;
    }
    const createdVia = item.metadata ? JSON.parse(item.metadata)?.createdVia : "";
    if (createdVia === "hr_separation_sync") {
      return true;
    }
    if (parsed.workflowType === "offboarding_sequence") {
      return true;
    }
  } catch {}
  return false;
}

function getItemSource(item: QueueItem, separationIds: Set<string>): SourceLabel {
  const fromSync = getItemSourceFromData(item);
  if (!fromSync) return "manual";

  const techData = parseTechData(item);
  const eid = (techData?.enterpriseId || "").toUpperCase();

  if (eid && separationIds.has(eid)) return "both";

  return "terminated_tech";
}

function renderSourceLabels(source: SourceLabel) {
  switch (source) {
    case "both":
      return (
        <>
          <span className="text-[10px] text-slate-400 italic">Fleet Separation</span>
          <span className="text-[10px] text-slate-400 italic"> · Terminated Tech</span>
        </>
      );
    case "fleet_separation":
      return <span className="text-[10px] text-slate-400 italic">Fleet Separation</span>;
    case "terminated_tech":
      return <span className="text-[10px] text-slate-400 italic">Terminated Tech</span>;
    case "manual":
      return <span className="text-[10px] text-slate-400 italic">Manual</span>;
  }
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "default";
    case "in_progress": return "secondary";
    default: return "outline";
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
  includeManual: boolean;
  daysBack: number;
}

function AssetsRecoveryFilterBar({
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
    activeFilters.includeManual ||
    activeFilters.daysBack !== 30 ||
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

      <Select
        value={String(activeFilters.daysBack)}
        onValueChange={(val) => onFilterChange("daysBack", parseInt(val))}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Date Range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7">Last 7 Days</SelectItem>
          <SelectItem value="14">Last 14 Days</SelectItem>
          <SelectItem value="30">Last 30 Days</SelectItem>
          <SelectItem value="60">Last 60 Days</SelectItem>
          <SelectItem value="90">Last 90 Days</SelectItem>
          <SelectItem value="0">All Time</SelectItem>
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

      <Button
        variant={activeFilters.includeManual ? "default" : "outline"}
        size="sm"
        onClick={() => onFilterChange("includeManual", !activeFilters.includeManual)}
        className="gap-2"
      >
        <Edit3 className="h-4 w-4" />
        Include Manual
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

function InlineNotesSection({ item }: { item: AssetsQueueItemEnriched }) {
  const [notes, setNotes] = useState(item.notes || "");
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  const updateNotesMutation = useMutation({
    mutationFn: (newNotes: string) =>
      apiRequest("PATCH", `/api/assets-queue/${item.id}/notes`, { notes: newNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/assets-queue");
        },
      });
      setIsEditing(false);
      toast({ title: "Notes saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error saving notes", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          Notes
        </h4>
        {!isEditing ? (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-xs">
            <Edit3 className="h-3 w-3 mr-1" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setNotes(item.notes || ""); setIsEditing(false); }} className="h-7 text-xs" disabled={updateNotesMutation.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => updateNotesMutation.mutate(notes)} className="h-7 text-xs" disabled={updateNotesMutation.isPending}>
              <Save className="h-3 w-3 mr-1" />
              {updateNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </div>
      {isEditing ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about this case..."
          className="min-h-[80px] text-sm"
        />
      ) : (
        <div className="p-3 bg-white rounded-md border border-slate-200 shadow-sm min-h-[60px]">
          {item.notes ? (
            <p className="text-sm whitespace-pre-wrap text-slate-700">{item.notes}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No notes yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ExpandedRowDetails({
  item,
  currentUser,
  users,
  onComplete,
  onPickUp,
  onQuickPickUp,
  onStartWork,
  isCompletePending,
  isAssignFailed,
}: {
  item: AssetsQueueItemEnriched;
  currentUser?: User;
  users: User[];
  onComplete: (id: string) => void;
  onPickUp: (item: AssetsQueueItemEnriched) => void;
  onQuickPickUp: (item: AssetsQueueItemEnriched) => void;
  onStartWork: (item: AssetsQueueItemEnriched) => void;
  isCompletePending: boolean;
  isAssignFailed: boolean;
}) {
  const { toast } = useToast();
  const techData = item.techData;
  const isPending = item.status === "pending";
  const isInProgress = item.status === "in_progress";
  const isAssignedToMe = item.assignedTo === currentUser?.id;
  const assignedUser = users.find(u => u.id === item.assignedTo);

  const personalPhone = techData?.personalPhone || techData?.homePhone || techData?.contactNumber || null;
  const email = techData?.email || techData?.personalEmail || null;

  const [justPickedUp, setJustPickedUp] = useState(false);

  useEffect(() => {
    if (item.status !== 'pending') {
      setJustPickedUp(false);
    }
  }, [item.status, item.assignedTo]);

  useEffect(() => {
    if (isAssignFailed && justPickedUp) {
      setJustPickedUp(false);
    }
  }, [isAssignFailed, justPickedUp]);

  const [taskState, setTaskState] = useState<Record<TaskKey, boolean>>({
    taskToolsReturn: item.taskToolsReturn ?? false,
    taskIphoneReturn: item.taskIphoneReturn ?? false,
    taskDisconnectedLine: item.taskDisconnectedLine ?? false,
    taskDisconnectedMPayment: item.taskDisconnectedMPayment ?? false,
    taskCloseSegnoOrders: item.taskCloseSegnoOrders ?? false,
    taskCreateShippingLabel: item.taskCreateShippingLabel ?? false,
  });

  const [carrier, setCarrier] = useState<string>(item.carrier || "");

  const truckNumber = techData?.hrTruckNumber || '';
  const { data: vehicleNexusData } = useQuery<{ postOffboardedStatus: string | null }>({
    queryKey: ['/api/vehicle-nexus-data', truckNumber],
    enabled: !!truckNumber && truckNumber !== 'N/A',
  });
  const disposition = vehicleNexusData?.postOffboardedStatus || null;

  const { saveStatus, save: debouncedSave } = useDebouncedSave({ itemId: item.id, module: 'assets' });

  const handleTaskChange = (key: TaskKey, checked: boolean) => {
    const newState = { ...taskState, [key]: checked };
    setTaskState(newState);
    debouncedSave({ [key]: checked });
  };

  const handleCarrierChange = (value: string) => {
    setCarrier(value);
    debouncedSave({ carrier: value });
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
        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <UserX className="h-4 w-4 text-slate-500" />
              Contact Details
            </h4>
            <div className="bg-white p-4 rounded-md border border-slate-200 shadow-sm space-y-3">
              <SourceLegend />
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500">Mobile Phone:</span>
                <span className="text-sm font-medium text-slate-900 flex items-center gap-1">
                  <Smartphone className="h-3 w-3 text-slate-400" />
                  {techData?.mobilePhone || "N/A"}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  Personal Phone:
                  <SourceDot source={techData?.sources.personalPhone || null} />
                </span>
                {personalPhone ? (
                  <span className="text-sm font-medium text-[#2db386] bg-[#36D9A3]/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {personalPhone}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">N/A</span>
                )}
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  Email:
                  <SourceDot source={techData?.sources.email || null} />
                </span>
                {email ? (
                  <a href={`mailto:${email}`} className="text-sm font-medium text-[#1A4B8C] hover:underline flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {email}
                  </a>
                ) : (
                  <span className="text-sm text-slate-400">N/A</span>
                )}
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  Address:
                  <SourceDot source={techData?.sources.address || null} />
                </span>
                <span className="text-sm font-medium text-slate-900 text-right max-w-[200px] flex items-start justify-end gap-1">
                  <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  {techData?.address || "N/A"}
                </span>
              </div>
              <Separator className="my-2" />
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  Fleet Pickup Address:
                  <SourceDot source={techData?.sources.fleetPickupAddress || null} />
                </span>
                <span className="text-sm font-medium text-slate-900 text-right max-w-[200px] flex items-start justify-end gap-1">
                  <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-500" />
                  {techData?.fleetPickupAddress || "N/A"}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-sm text-slate-500 flex items-center gap-1">
                  HR Truck Number:
                  <SourceDot source={techData?.sources.hrTruckNumber || null} />
                </span>
                <span className="text-sm font-medium text-slate-900 flex items-center gap-1">
                  <Truck className="h-3 w-3 text-amber-500" />
                  {techData?.hrTruckNumber || "N/A"}
                </span>
              </div>
              {assignedUser && (
                <div className="flex items-start justify-between mt-2 pt-2 border-t border-slate-100">
                  <span className="text-sm text-slate-500">Assigned To:</span>
                  <span className="text-sm font-medium text-slate-900">{assignedUser.username}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Truck className="h-4 w-4 text-slate-500" />
              Vehicle Disposition
            </h4>
            <div className="bg-white p-4 rounded-md border border-slate-200 shadow-sm">
              {disposition ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-sm font-medium">
                    {disposition}
                  </Badge>
                </div>
              ) : (
                <span className="text-sm text-slate-400 italic">No disposition set — update on Weekly Offboarding page</span>
              )}
            </div>
          </div>
        </div>

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

          {taskItems.some(t => t.showCarrier) && (
            <div className="bg-white p-3 rounded-md border border-slate-200 shadow-sm">
              <Label className="text-xs text-slate-500 uppercase tracking-wider">Phone Carrier</Label>
              <Select value={carrier || "none"} onValueChange={(v) => handleCarrierChange(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Selected</SelectItem>
                  <SelectItem value="AT&T">AT&T</SelectItem>
                  <SelectItem value="Verizon">Verizon</SelectItem>
                  <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {saveStatus !== "idle" && (
            <div className="text-xs text-center">
              {saveStatus === "saving" && <span className="text-slate-500">Saving...</span>}
              {saveStatus === "saved" && <span className="text-green-600">Saved</span>}
              {saveStatus === "error" && <span className="text-red-600">Error saving</span>}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">
              Quick Actions
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {isPending && !justPickedUp && (
                <>
                  <Button
                    className="w-full"
                    style={{ backgroundColor: "#1A4B8C" }}
                    onClick={() => {
                      setJustPickedUp(true);
                      onQuickPickUp(item);
                    }}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Pick Up
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onPickUp(item)}
                  >
                    <Send className="h-4 w-4 mr-2 text-slate-500" />
                    Assign
                  </Button>
                </>
              )}

              {(justPickedUp && isPending) && (
                <div className="space-y-2">
                  <Button
                    className="w-full pointer-events-none"
                    style={{ backgroundColor: "#36D9A3" }}
                    disabled
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Picked Up
                  </Button>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-[#2db386] font-medium">
                    <UserCheck className="h-3 w-3" />
                    Assigned to you
                  </div>
                </div>
              )}

              {(isInProgress || (justPickedUp && !isPending)) && isAssignedToMe && (
                <>
                  {isInProgress && !justPickedUp && (
                    <div className="space-y-2 mb-2">
                      <div className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#36D9A3]/10 border border-[#36D9A3]/30">
                        <CheckCircle className="h-4 w-4 text-[#36D9A3]" />
                        <span className="text-sm font-medium text-[#2db386]">Picked Up</span>
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onStartWork(item)}
                  >
                    <Briefcase className="h-4 w-4 mr-2 text-slate-500" />
                    Open Work Module
                  </Button>
                </>
              )}

              {isInProgress && !isAssignedToMe && (
                <div className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-slate-100 border border-slate-200">
                  <UserX className="h-4 w-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-600">Assigned to {assignedUser?.username || 'another agent'}</span>
                </div>
              )}

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
              {isPending && !isAssignedToMe && !justPickedUp && (
                <p className="text-xs text-muted-foreground text-center">
                  Pick up the case first to mark complete
                </p>
              )}
            </div>
          </div>

          <InlineNotesSection item={item} />
        </div>
      </div>
    </div>
  );
}

export function AssetsRecoveryQueue() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    status: [],
    vehicleType: [],
    district: [],
    incompleteOnly: false,
    includeManual: false,
    daysBack: 30,
  });
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>({ key: "separationDate", direction: "desc" });
  const itemsPerPage = 10;

  const [pickUpItem, setPickUpItem] = useState<AssetsQueueItemEnriched | null>(null);
  const [workModuleItem, setWorkModuleItem] = useState<AssetsQueueItemEnriched | null>(null);
  const [isWorkModuleOpen, setIsWorkModuleOpen] = useState(false);
  const [detailViewItem, setDetailViewItem] = useState<AssetsQueueItemEnriched | null>(null);
  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);
  const [pendingCompleteId, setPendingCompleteId] = useState<string | null>(null);

  const { data: rawQueueItems = [], isLoading } = useQuery<QueueItem[]>({
    queryKey: ["/api/assets-queue", filters.daysBack],
    queryFn: () => apiRequest("GET", `/api/assets-queue?daysBack=${filters.daysBack}`).then(res => res.json()),
    refetchInterval: 30000,
  });

  const queueItems = useMemo(() => rawQueueItems.map(enrichItem), [rawQueueItems]);

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: separationIdsRaw = [] } = useQuery<string[]>({
    queryKey: ["/api/snowflake/separation-ids"],
    staleTime: 10 * 60 * 1000,
  });

  const vehicleNumbers = useMemo(() => {
    return [...new Set(queueItems.map(item => item.techData?.hrTruckNumber).filter(Boolean) as string[])];
  }, [queueItems]);

  const { data: vehicleNexusBatchData = {} } = useQuery<Record<string, { postOffboardedStatus: string | null }>>({
    queryKey: ["/api/vehicle-nexus-data/batch", vehicleNumbers],
    queryFn: async () => {
      if (vehicleNumbers.length === 0) return {};
      const res = await apiRequest("POST", "/api/vehicle-nexus-data/batch", { vehicleNumbers });
      const arr = await res.json();
      const map: Record<string, { postOffboardedStatus: string | null }> = {};
      for (const item of arr) {
        map[item.vehicleNumber] = { postOffboardedStatus: item.postOffboardedStatus };
      }
      return map;
    },
    enabled: vehicleNumbers.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const separationIds = useMemo(() => {
    return new Set(separationIdsRaw.map(id => id.toUpperCase()));
  }, [separationIdsRaw]);

  const assetsUsers = users.filter(u => u.departments?.includes("ASSETS") || u.role === "developer" || u.role === "admin");

  const invalidateAssetsQueue = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/assets-queue");
      },
    });
  };

  const completeMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiRequest("PATCH", `/api/assets-queue/${itemId}/complete`, { completedBy: user?.id }),
    onSuccess: () => {
      invalidateAssetsQueue();
      toast({ title: "Case marked complete" });
      setExpandedRowId(null);
      setDetailViewItem(null);
    },
    onError: () => {
      toast({ title: "Failed to complete case", variant: "destructive" });
    },
  });

  const handleCompleteWithWarning = (itemId: string) => {
    const item = queueItems.find(i => i.id === itemId);
    if (item) {
      const progress = getTaskProgress(item);
      if (progress.completed < progress.total) {
        setPendingCompleteId(itemId);
        setShowIncompleteWarning(true);
        return;
      }
    }
    completeMutation.mutate(itemId);
  };

  const handleConfirmComplete = () => {
    if (pendingCompleteId) {
      completeMutation.mutate(pendingCompleteId);
    }
    setShowIncompleteWarning(false);
    setPendingCompleteId(null);
  };

  const assignMutation = useMutation({
    mutationFn: ({ queueItemId, assigneeId }: { queueItemId: string; assigneeId: string }) =>
      apiRequest("PATCH", `/api/assets-queue/${queueItemId}/assign`, { assigneeId }),
    onSuccess: () => {
      invalidateAssetsQueue();
      toast({ title: "Case assigned successfully" });
      setPickUpItem(null);
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

      const itemSource = getItemSource(item, separationIds);
      const matchesSource = filters.includeManual || itemSource !== "manual";

      const isOrphan = techData?.techName === "Unknown" && !techData?.enterpriseId;
      const matchesNotOrphan = !isOrphan;

      return matchesSearch && matchesStatus && matchesVehicle && matchesDistrict && matchesIncomplete && matchesSource && matchesNotOrphan;
    });
  }, [queueItems, searchQuery, filters, separationIds]);

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
          aVal = a.techData?.separationDate ? new Date(a.techData.separationDate).getTime() : 0;
          bVal = b.techData?.separationDate ? new Date(b.techData.separationDate).getTime() : 0;
          break;
        case "vehicleType":
          aVal = getVehicleType(a);
          bVal = getVehicleType(b);
          break;
        case "routing":
          aVal = (a.techData?.hrTruckNumber ? vehicleNexusBatchData[a.techData.hrTruckNumber]?.postOffboardedStatus : null) || '';
          bVal = (b.techData?.hrTruckNumber ? vehicleNexusBatchData[b.techData.hrTruckNumber]?.postOffboardedStatus : null) || '';
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
    setFilters((prev) => ({ ...prev, [type]: value }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setFilters({ status: [], vehicleType: [], district: [], incompleteOnly: false, includeManual: false, daysBack: 30 });
    setCurrentPage(1);
  };

  const getVehicleBadgeStyle = (type: VehicleType) => {
    switch (type) {
      case "byov": return "bg-green-100 text-green-800 border-green-200";
      case "rental": return "bg-red-100 text-red-800 border-red-200";
      default: return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const columns = [
    { key: "techName", label: "Technician", width: "w-48" },
    { key: "district", label: "District", width: "w-20" },
    { key: "separationDate", label: "Last Day", width: "w-28" },
    { key: "vehicleType", label: "Vehicle", width: "w-24" },
    { key: "routing", label: "Disposition", width: "w-28" },
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

  if (detailViewItem) {
    return (
      <>
        <AssetsTaskDetailView
          item={detailViewItem}
          currentUser={user ?? undefined}
          users={assetsUsers}
          onBack={() => setDetailViewItem(null)}
          onComplete={(id) => handleCompleteWithWarning(id)}
          onAssign={(id, assigneeId) => assignMutation.mutate({ queueItemId: id, assigneeId })}
          onPickUp={(item) => setPickUpItem(item)}
          isCompletePending={completeMutation.isPending}
          isAssignPending={assignMutation.isPending}
        />
        <AlertDialog open={showIncompleteWarning} onOpenChange={setShowIncompleteWarning}>
          <AlertDialogContent aria-describedby="incomplete-tasks-description">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Incomplete Tasks
              </AlertDialogTitle>
              <AlertDialogDescription id="incomplete-tasks-description">
                {(() => {
                  const item = queueItems.find(i => i.id === pendingCompleteId);
                  const progress = item ? getTaskProgress(item) : { completed: 0, total: 6 };
                  return `Only ${progress.completed} of ${progress.total} tasks are marked complete. Some tasks may not apply to this case.`;
                })()}
                <br /><br />
                Are you sure you want to mark this case complete?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go Back</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmComplete}
                style={{ backgroundColor: '#36D9A3' }}
              >
                Complete Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <PickUpRequestDialog
          isOpen={!!pickUpItem}
          onClose={() => setPickUpItem(null)}
          onPickUp={(agentId) => {
            if (pickUpItem) {
              assignMutation.mutate({ queueItemId: pickUpItem.id, assigneeId: agentId });
            }
          }}
          users={assetsUsers}
          queueModule="assets"
          isLoading={assignMutation.isPending}
          currentUser={user}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <AssetsRecoveryFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        availableDistricts={availableDistricts}
      />

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
                const rowDisposition = row.techData?.hrTruckNumber ? vehicleNexusBatchData[row.techData.hrTruckNumber]?.postOffboardedStatus : null;
                const sepDate = row.techData?.separationDate || null;
                const daysUntilSep = getDaysUntilSeparation(sepDate);
                const urgency = getUrgencyLevel(vehicleType, daysUntilSep);
                const isUrgent = urgency === "CRITICAL" || urgency === "HIGH";
                const isExpanded = expandedRowId === row.id;
                const taskProgress = getTaskProgress(row);
                const personalPhone = row.techData?.personalPhone || row.techData?.homePhone || row.techData?.contactNumber || null;

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
                        <div className="flex items-center gap-1">
                          <div className="font-medium text-slate-900">{row.techData?.techName || row.title || "Unknown"}</div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDetailViewItem(row); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-slate-200 rounded"
                            title="Open detail view"
                          >
                            <ExternalLink className="h-3 w-3 text-[#1A4B8C]" />
                          </button>
                        </div>
                        <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
                          {row.techData?.enterpriseId || "N/A"}
                          {personalPhone && (
                            <span className="inline-flex items-center gap-0.5 text-[#2db386]">
                              <Phone className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <span>
                          {renderSourceLabels(getItemSource(row, separationIds))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.techData?.district || "N/A"}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex flex-col gap-1">
                          <span>
                            {sepDate
                              ? new Date(sepDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                              : "N/A"}
                          </span>
                          {(() => {
                            const aging = getAgingBadge(sepDate);
                            return aging ? (
                              <Badge className={`text-[10px] px-1.5 py-0 h-4 w-fit font-medium border ${aging.className}`}>
                                {aging.label}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${getVehicleBadgeStyle(vehicleType)}`}>
                          {vehicleType === "byov" ? "BYOV" : vehicleType === "rental" ? "Rental" : "Company"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {rowDisposition ? (
                          <span className="text-xs font-medium">{rowDisposition}</span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Pending</span>
                        )}
                      </td>
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
                            users={users}
                            onComplete={(id) => handleCompleteWithWarning(id)}
                            onPickUp={(item) => setPickUpItem(item)}
                            onQuickPickUp={(item) => {
                              if (user) {
                                assignMutation.mutate({ queueItemId: item.id, assigneeId: user.id });
                              }
                            }}
                            onStartWork={(item) => {
                              setWorkModuleItem(item);
                              setIsWorkModuleOpen(true);
                            }}
                            isCompletePending={completeMutation.isPending}
                            isAssignFailed={assignMutation.isError}
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

      <WorkModuleDialog
        isOpen={isWorkModuleOpen}
        onOpenChange={setIsWorkModuleOpen}
        queueItem={workModuleItem}
        module="assets"
        currentUser={user}
        users={users}
        onTaskCompleted={() => {
          invalidateAssetsQueue();
        }}
      />

      <AlertDialog open={showIncompleteWarning} onOpenChange={setShowIncompleteWarning}>
        <AlertDialogContent aria-describedby="incomplete-tasks-description">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Incomplete Tasks
            </AlertDialogTitle>
            <AlertDialogDescription id="incomplete-tasks-description">
              {(() => {
                const item = queueItems.find(i => i.id === pendingCompleteId);
                const progress = item ? getTaskProgress(item) : { completed: 0, total: 6 };
                return `Only ${progress.completed} of ${progress.total} tasks are marked complete. Some tasks may not apply to this case.`;
              })()}
              <br /><br />
              Are you sure you want to mark this case complete?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmComplete}
              style={{ backgroundColor: '#36D9A3' }}
            >
              Complete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
