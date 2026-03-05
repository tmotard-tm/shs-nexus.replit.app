import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MainContent } from "@/components/layout/main-content";
import { TopBar } from "@/components/layout/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  XCircle,
  Clock,
  Calendar,
  X,
  Loader2,
  ChevronDown,
  Smartphone,
} from "lucide-react";
import type { QueueItem } from "@shared/schema";
import {
  ContactLogForm,
  ContactHistoryTimeline,
  ReprovisioningChecklist,
  deriveRecoveryStatus,
  deriveReprovisioningStatus,
  isEscalated,
} from "@/components/phone-recovery";
import type { ContactHistoryEntry } from "@/components/phone-recovery";

type PipelineCard = "new" | "inContact" | "inTransit" | "reprovisioning" | "ready" | "assigned";
type SortColumn = "technician" | "separationDate" | "stage" | "status" | "daysOpen" | "assignedTo" | "alert";
type SortDirection = "asc" | "desc";

function getTechName(task: QueueItem): string {
  const match = task.title.match(/Phone Recovery\s*[-–—]\s*(.+)$/i);
  if (match) return match[1].trim();
  try {
    const d = JSON.parse(task.data || "{}");
    if (d.technician?.techName) return d.technician.techName;
  } catch {}
  return task.title;
}

function getEnterpriseId(task: QueueItem): string | null {
  try {
    const d = JSON.parse(task.data || "{}");
    return d.technician?.enterpriseId || d.technician?.techRacfid || null;
  } catch {}
  return null;
}

function getDateAgingBadge(date: Date | null): { label: string; className: string } | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "Upcoming", className: "bg-blue-100 text-blue-700 border-blue-200" };
  if (diffDays <= 7) return { label: "New", className: "bg-green-100 text-green-700 border-green-200" };
  if (diffDays <= 30) return { label: "Active", className: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" };
}

function getSeparationDate(task: QueueItem): Date | null {
  try {
    const d = JSON.parse(task.data || "{}");
    const dateStr = d.technician?.lastDayWorked || d.technician?.effectiveDate || d.separationDate;
    if (dateStr) return new Date(dateStr);
  } catch {}
  return null;
}

function getStage(task: QueueItem): "Recovery" | "Reprovisioning" {
  return task.phoneRecoveryStage === "reprovisioning" ? "Reprovisioning" : "Recovery";
}

function getStatus(task: QueueItem): string {
  const stage = getStage(task);
  if (stage === "Reprovisioning") {
    return deriveReprovisioningStatus(task);
  }
  return deriveRecoveryStatus(task);
}

function getDaysOpen(task: QueueItem): number {
  const stage = getStage(task);
  const startDate = stage === "Reprovisioning" && task.phoneDateReceived
    ? new Date(task.phoneDateReceived)
    : new Date(task.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isAging(task: QueueItem): boolean {
  return getDaysOpen(task) > 5;
}

function getStatusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case "New":
    case "Label Sent":
    case "In Transit":
      return { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" };
    case "Contact Attempted":
      return { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" };
    case "Received":
    case "Ready for Deployment":
    case "Assigned":
      return { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" };
    case "Inspecting":
    case "Wiping":
    case "Reprovisioning":
      return { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300" };
    default:
      return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300" };
  }
}

function matchesPipelineCard(task: QueueItem, card: PipelineCard): boolean {
  const status = getStatus(task);
  const stage = getStage(task);
  switch (card) {
    case "new":
      return stage === "Recovery" && status === "New";
    case "inContact":
      return stage === "Recovery" && status === "Contact Attempted";
    case "inTransit":
      return stage === "Recovery" && (status === "Label Sent" || status === "In Transit");
    case "reprovisioning":
      return stage === "Reprovisioning" && !task.phoneServiceReinstated;
    case "ready":
      return stage === "Reprovisioning" && !!task.phoneServiceReinstated && !task.phoneAssignedToNewHire;
    case "assigned":
      return !!task.phoneAssignedToNewHire;
    default:
      return false;
  }
}

const PIPELINE_CARDS: { key: PipelineCard; label: string; borderColor: string }[] = [
  { key: "new", label: "New", borderColor: "border-l-[#003366]" },
  { key: "inContact", label: "In Contact", borderColor: "border-l-amber-500" },
  { key: "inTransit", label: "In Transit", borderColor: "border-l-[#003366]" },
  { key: "reprovisioning", label: "Reprovisioning", borderColor: "border-l-purple-500" },
  { key: "ready", label: "Ready", borderColor: "border-l-emerald-500" },
  { key: "assigned", label: "Assigned", borderColor: "border-l-emerald-500" },
];

const ALL_STATUSES = [
  "New", "Contact Attempted", "Label Sent", "In Transit",
  "Received", "Inspecting", "Wiping", "Reprovisioning",
  "Ready for Deployment", "Assigned",
];

export function PhoneRecoveryDashboard() {
  const { toast } = useToast();
  const [selectedCard, setSelectedCard] = useState<PipelineCard | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("separationDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTask, setSelectedTask] = useState<QueueItem | null>(null);
  const [activeTab, setActiveTab] = useState<"history" | "action">("action");

  const { data: tasks = [], isLoading } = useQuery<QueueItem[]>({
    queryKey: ["/api/phone-recovery"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/phone-recovery/seed");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-recovery"] });
      toast({ title: "Seed data created", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/phone-recovery/backfill");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/phone-recovery"] });
      toast({ title: "Backfill complete", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const pipelineCounts = useMemo(() => {
    const counts: Record<PipelineCard, number> = { new: 0, inContact: 0, inTransit: 0, reprovisioning: 0, ready: 0, assigned: 0 };
    tasks.forEach((t) => {
      if (t.phoneWrittenOff) return;
      PIPELINE_CARDS.forEach((c) => {
        if (matchesPipelineCard(t, c.key)) counts[c.key]++;
      });
    });
    return counts;
  }, [tasks]);

  const uniqueMembers = useMemo(() => {
    const members = new Set<string>();
    tasks.forEach((t) => { if (t.assignedTo) members.add(t.assignedTo); });
    return Array.from(members).sort();
  }, [tasks]);

  const agingTasks = useMemo(() => {
    return tasks
      .filter((t) => !t.phoneWrittenOff && isAging(t))
      .sort((a, b) => getDaysOpen(b) - getDaysOpen(a));
  }, [tasks]);

  const deviceInventory = useMemo(() => {
    const ready = tasks.filter((t) => !t.phoneWrittenOff && t.phoneServiceReinstated && !t.phoneAssignedToNewHire).length;
    const inReprov = tasks.filter((t) => !t.phoneWrittenOff && getStage(t) === "Reprovisioning" && !t.phoneServiceReinstated).length;
    const writtenOff = tasks.filter((t) => t.phoneWrittenOff).length;
    return { ready, inReprov, writtenOff, total: ready + inReprov + writtenOff };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => !t.phoneWrittenOff);

    if (selectedCard) {
      result = result.filter((t) => matchesPipelineCard(t, selectedCard));
    }
    if (stageFilter !== "all") {
      result = result.filter((t) => getStage(t) === stageFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => getStatus(t) === statusFilter);
    }
    if (memberFilter !== "all") {
      result = result.filter((t) => t.assignedTo === memberFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter((t) => { const sd = getSeparationDate(t); return sd && sd >= from; });
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((t) => { const sd = getSeparationDate(t); return sd && sd <= to; });
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "technician":
          cmp = getTechName(a).localeCompare(getTechName(b));
          break;
        case "separationDate":
          cmp = (getSeparationDate(a)?.getTime() || 0) - (getSeparationDate(b)?.getTime() || 0);
          break;
        case "stage":
          cmp = getStage(a).localeCompare(getStage(b));
          break;
        case "status":
          cmp = getStatus(a).localeCompare(getStatus(b));
          break;
        case "daysOpen":
          cmp = getDaysOpen(a) - getDaysOpen(b);
          break;
        case "assignedTo":
          cmp = (a.assignedTo || "").localeCompare(b.assignedTo || "");
          break;
        case "alert": {
          const aScore = (isEscalated(a) ? 2 : 0) + (isAging(a) ? 1 : 0);
          const bScore = (isEscalated(b) ? 2 : 0) + (isAging(b) ? 1 : 0);
          cmp = aScore - bScore;
          break;
        }
      }
      return sortDirection === "desc" ? -cmp : cmp;
    });

    return result;
  }, [tasks, selectedCard, stageFilter, statusFilter, memberFilter, dateFrom, dateTo, sortColumn, sortDirection]);

  const hasActiveFilters = selectedCard || stageFilter !== "all" || statusFilter !== "all" || memberFilter !== "all" || dateFrom || dateTo;

  function clearAllFilters() {
    setSelectedCard(null);
    setStageFilter("all");
    setStatusFilter("all");
    setMemberFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("desc");
    }
  }

  function openDetail(task: QueueItem) {
    setSelectedTask(task);
    setActiveTab("action");
  }

  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find((t) => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
    }
  }, [tasks]);

  function handleDetailSuccess() {
    queryClient.invalidateQueries({ queryKey: ["/api/phone-recovery"] });
  }



  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

        {tasks.length === 0 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-8 text-center">
            <Smartphone className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No Phone Recovery Tasks</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Populate phone recovery tasks from existing offboarding data, or seed sample data for testing.</p>
            <div className="flex items-center justify-center gap-3">
              <Button
                onClick={() => backfillMutation.mutate()}
                disabled={backfillMutation.isPending}
                className="bg-[#003366] hover:bg-[#002244] text-white"
              >
                {backfillMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Populating...</> : "Populate from Offboarding Data"}
              </Button>
              <Button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                variant="outline"
              >
                {seedMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : "Seed Sample Data"}
              </Button>
            </div>
          </div>
        )}

        {/* Pipeline Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {PIPELINE_CARDS.map((card) => {
            const isActive = selectedCard === card.key;
            return (
              <button
                key={card.key}
                onClick={() => setSelectedCard(isActive ? null : card.key)}
                className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 border-l-4 ${card.borderColor} rounded-lg shadow-sm p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  isActive ? "ring-2 ring-[#003366] dark:ring-blue-400" : ""
                }`}
              >
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{pipelineCounts[card.key]}</p>
                {isActive && <p className="text-[10px] text-[#003366] dark:text-blue-400 font-medium mt-1">Filtered</p>}
              </button>
            );
          })}
        </div>

        {/* Aging Alerts + Device Inventory */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Aging Alerts */}
          <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Aging Alerts</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Tasks open &gt;5 days</p>
              </div>
            </div>
            {agingTasks.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No aging tasks</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {agingTasks.slice(0, 4).map((task) => {
                  const escalated = isEscalated(task);
                  const status = getStatus(task);
                  const sc = getStatusColor(status);
                  return (
                    <button
                      key={task.id}
                      onClick={() => openDetail(task)}
                      className={`flex items-center justify-between p-3 rounded-lg border-l-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        escalated
                          ? "border-l-red-500 bg-red-50/50 dark:bg-red-950/20"
                          : "border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {escalated && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{getTechName(task)}</p>
                          <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text} mt-0.5`}>
                            {status}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-gray-700 dark:text-gray-300 flex-shrink-0 ml-2">{getDaysOpen(task)}d</span>
                    </button>
                  );
                })}
                {agingTasks.length > 4 && (
                  <div className="flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 col-span-full">
                    +{agingTasks.length - 4} more
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Device Inventory */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Device Inventory</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Ready for Deployment</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{deviceInventory.ready}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-purple-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">In Reprovisioning</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{deviceInventory.inReprov}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Written Off</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{deviceInventory.writtenOff}</span>
              </div>
            </div>
            {deviceInventory.total > 0 && (
              <div className="mt-4 h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 flex">
                {deviceInventory.ready > 0 && (
                  <div
                    className="bg-emerald-500 h-full"
                    style={{ width: `${(deviceInventory.ready / deviceInventory.total) * 100}%` }}
                  />
                )}
                {deviceInventory.inReprov > 0 && (
                  <div
                    className="bg-purple-500 h-full"
                    style={{ width: `${(deviceInventory.inReprov / deviceInventory.total) * 100}%` }}
                  />
                )}
                {deviceInventory.writtenOff > 0 && (
                  <div
                    className="bg-gray-400 h-full"
                    style={{ width: `${(deviceInventory.writtenOff / deviceInventory.total) * 100}%` }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="w-[150px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  <SelectItem value="Recovery">Recovery</SelectItem>
                  <SelectItem value="Reprovisioning">Reprovisioning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Team Member</Label>
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger className="w-[160px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  {uniqueMembers.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Separation Date</Label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-8 text-sm pl-7 w-[140px]"
                    placeholder="From"
                  />
                </div>
                <span className="text-gray-400 text-xs">—</span>
                <div className="relative">
                  <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-8 text-sm pl-7 w-[140px]"
                    placeholder="To"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 ml-auto">
              {hasActiveFilters && (
                <button onClick={clearAllFilters} className="text-xs text-[#003366] dark:text-blue-400 hover:underline">
                  Clear all filters
                </button>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Showing {filteredTasks.length} of {tasks.filter((t) => !t.phoneWrittenOff).length} tasks
              </span>
            </div>
          </div>
        </div>

        {/* Task Table */}
        <div className="w-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#1A4B8C] text-white">
                <tr>
                  {([
                    { key: "technician" as SortColumn, label: "Technician", width: "w-48" },
                    { key: "separationDate" as SortColumn, label: "Last Day", width: "w-28" },
                    { key: "stage" as SortColumn, label: "Stage", width: "w-24" },
                    { key: "status" as SortColumn, label: "Status", width: "w-28" },
                    { key: "daysOpen" as SortColumn, label: "Days Open", width: "w-24" },
                    { key: "assignedTo" as SortColumn, label: "Assigned To", width: "w-28" },
                    { key: "alert" as SortColumn, label: "Alert", width: "w-24" },
                  ]).map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={`${col.width} px-4 py-3 font-semibold cursor-pointer hover:bg-[#153d73] transition-colors select-none`}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortColumn === col.key && (
                          <ChevronDown
                            className={`h-3 w-3 transition-transform ${sortDirection === "asc" ? "rotate-180" : ""}`}
                          />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {filteredTasks.map((task) => {
                  const status = getStatus(task);
                  const stage = getStage(task);
                  const days = getDaysOpen(task);
                  const escalated = isEscalated(task);
                  const aging = isAging(task);
                  const sc = getStatusColor(status);
                  const sepDate = getSeparationDate(task);
                  const agingBadge = getDateAgingBadge(sepDate);
                  const enterpriseId = getEnterpriseId(task);

                  let rowClass = "hover:bg-slate-50 dark:hover:bg-gray-800";
                  if (escalated) rowClass = "bg-red-50/60 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/30";
                  else if (aging) rowClass = "bg-amber-50/40 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30";

                  return (
                    <tr
                      key={task.id}
                      onClick={() => openDetail(task)}
                      className={`group transition-all cursor-pointer ${rowClass}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{getTechName(task)}</div>
                        {enterpriseId && (
                          <div className="text-xs text-slate-400 font-mono">{enterpriseId}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-gray-400">
                        <div className="flex flex-col gap-1">
                          <span>
                            {sepDate
                              ? sepDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                              : "N/A"}
                          </span>
                          {agingBadge && (
                            <span className={`inline-block text-[10px] px-1.5 py-0 rounded-full font-medium border w-fit ${agingBadge.className}`}>
                              {agingBadge.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                          stage === "Recovery"
                            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                            : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                        }`}>
                          {stage}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${sc.bg} ${sc.text}`}>
                          {status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-medium ${
                        days > 14 ? "text-red-600 dark:text-red-400" : days > 5 ? "text-amber-600 dark:text-amber-400" : "text-slate-700 dark:text-gray-300"
                      }`}>
                        {days}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-gray-400">{task.assignedTo || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {escalated && (
                            <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                              <AlertTriangle className="h-3 w-3" />
                              Escalation
                            </span>
                          )}
                          {aging && (
                            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <Clock className="h-3 w-3" />
                              Aging
                            </span>
                          )}
                          {!escalated && !aging && <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-gray-500">
                      No tasks match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        <Sheet open={!!selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-[480px] p-0 flex flex-col overflow-hidden">
            {selectedTask && (
              <>
                <SheetTitle className="sr-only">{getTechName(selectedTask)} - Phone Recovery Details</SheetTitle>
                <SheetDescription className="sr-only">View and manage phone recovery details</SheetDescription>
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{getTechName(selectedTask)}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const s = getStatus(selectedTask);
                          const c = getStatusColor(s);
                          return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.bg} ${c.text}`}>{s}</span>;
                        })()}
                        {isEscalated(selectedTask) && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                            Escalated
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Separation Date</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {(() => { const sd = getSeparationDate(selectedTask); return sd ? sd.toLocaleDateString() : "—"; })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Phone Number</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedTask.phoneNumber || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Days Open</p>
                    {(() => {
                      const d = getDaysOpen(selectedTask);
                      return (
                        <p className={`text-sm font-medium ${
                          d > 14 ? "text-red-600 dark:text-red-400" : d > 5 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"
                        }`}>{d} days</p>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Assigned To</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedTask.assignedTo || "Unassigned"}</p>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setActiveTab("history")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === "history"
                        ? "text-[#003366] dark:text-blue-400 border-b-2 border-[#003366] dark:border-blue-400"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    Contact History
                  </button>
                  <button
                    onClick={() => setActiveTab("action")}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === "action"
                        ? "text-[#003366] dark:text-blue-400 border-b-2 border-[#003366] dark:border-blue-400"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    {getStage(selectedTask) === "Recovery" ? "Log Contact" : "Reprovisioning"}
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-4">
                  {activeTab === "history" && (
                    <ContactHistoryTimeline
                      contactHistory={(selectedTask.phoneContactHistory ?? []) as ContactHistoryEntry[]}
                      shippingLabelSent={selectedTask.phoneShippingLabelSent || false}
                      trackingNumber={selectedTask.phoneTrackingNumber || null}
                    />
                  )}
                  {activeTab === "action" && getStage(selectedTask) === "Recovery" && (
                    <ContactLogForm
                      taskId={selectedTask.id}
                      onSuccess={handleDetailSuccess}
                    />
                  )}
                  {activeTab === "action" && getStage(selectedTask) === "Reprovisioning" && (
                    <ReprovisioningChecklist
                      taskId={selectedTask.id}
                      task={selectedTask}
                      onSuccess={handleDetailSuccess}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedTask(null)}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}

export default function PhoneRecovery() {
  return (
    <MainContent>
      <TopBar title="Phone Recovery" breadcrumbs={["Home", "Queues", "Phone Recovery"]} />
      <main className="p-6 bg-gray-100 dark:bg-gray-950 min-h-screen">
        <PhoneRecoveryDashboard />
      </main>
    </MainContent>
  );
}
