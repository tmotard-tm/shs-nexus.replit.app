import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Phone,
  Truck,
  Package,
  PackageCheck,
  User,
  MapPin,
  Mail,
  MessageSquare,
  Circle,
  Send,
  Eye,
  ExternalLink,
  Pencil,
  Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const QUEUE_KEYS = ["phone", "assets", "fleet", "inventory", "ntao"] as const;
const QUEUE_LABELS: Record<string, string> = {
  phone: "Phone Recovery",
  assets: "Assets/Tools",
  fleet: "Fleet",
  inventory: "Inventory",
  ntao: "NTAO",
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500",
  in_progress: "bg-blue-500",
  pending: "bg-amber-500",
  missing: "bg-gray-300",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
};

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function daysAgoColor(days: number): string {
  if (days > 14) return "text-red-600 dark:text-red-400";
  if (days > 5) return "text-amber-600 dark:text-amber-400";
  return "text-gray-600 dark:text-gray-400";
}

function copyToClipboard(text: string, toast: any): void {
  navigator.clipboard.writeText(text).then(() => {
    toast({ title: "Copied to clipboard", description: text });
  });
}

interface TechSummary {
  workflowId: string;
  techName: string;
  enterpriseId: string;
  employeeId: string;
  separationDate: string | null;
  daysOpen: number;
  truckNumber: string;
  isByov: boolean;
  isTlt: boolean;
  hasRental: boolean;
  hasEscalation: boolean;
  queueStatuses: Record<string, { status: string; id: string | null }>;
}

interface TechDetail {
  workflowId: string;
  techName: string;
  enterpriseId: string;
  employeeId: string;
  separationDate: string | null;
  truckNumber: string;
  fleetPickupAddress: string | null;
  contactNumber: string | null;
  personalEmail: string | null;
  district: string | null;
  planningArea: string | null;
  jobTitle: string | null;
  separationCategory: string | null;
  tasks: Record<string, any>;
}

interface ListData {
  techs: TechSummary[];
  summary: {
    totalTechs: number;
    escalated: number;
    avgDaysOpen: number;
    completionPct: number;
    queueBreakdown: Record<string, { pending: number; in_progress: number; completed: number; missing: number }>;
  };
}

function TechCard({
  tech,
  selected,
  onClick,
}: {
  tech: TechSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`border-b cursor-pointer p-4 hover:bg-accent/50 transition-colors ${
        selected ? "border-l-4 border-l-blue-500 bg-accent" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-1">
        <span className="font-medium text-sm">{toTitleCase(tech.techName)}</span>
        <div className="flex gap-1 flex-wrap justify-end">
          {tech.isTlt && <Badge variant="secondary" className="text-xs">TLT</Badge>}
          {tech.isByov && <Badge variant="outline" className="text-xs">BYOV</Badge>}
          {tech.hasRental && <Badge variant="outline" className="text-xs text-orange-600">Rental</Badge>}
          {tech.hasEscalation && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Escalated
            </Badge>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground mb-1">
        {tech.enterpriseId} {tech.truckNumber ? `• Truck ${tech.truckNumber}` : ""}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs ${daysAgoColor(tech.daysOpen)}`}>
          {tech.separationDate ? `${formatDate(tech.separationDate)} (${tech.daysOpen}d)` : "No sep date"}
        </span>
        <div className="flex gap-1">
          {QUEUE_KEYS.map((qk) => {
            const qs = tech.queueStatuses[qk];
            const color = STATUS_COLORS[qs?.status || "missing"] || "bg-gray-300";
            return (
              <span
                key={qk}
                className={`w-2.5 h-2.5 rounded-full ${color}`}
                title={`${QUEUE_LABELS[qk]}: ${qs?.status || "missing"}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryDashboard({ data }: { data: ListData }) {
  const { summary } = data;
  const [timeFilter, setTimeFilter] = useState("all");

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Summary Dashboard</h2>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="7">Last 7 Days</SelectItem>
            <SelectItem value="14">Last 14 Days</SelectItem>
            <SelectItem value="30">Last 30 Days</SelectItem>
            <SelectItem value="60">Last 60 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold">{summary.totalTechs}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <Users className="w-4 h-4" />
            Total Techs
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold text-red-600">{summary.escalated}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            Escalated
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold">{summary.avgDaysOpen}</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="w-4 h-4" />
            Avg Days Open
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold text-green-600">{summary.completionPct}%</div>
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" />
            Completion
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="font-semibold mb-4">Queue Breakdown</h3>
        <div className="space-y-3">
          {QUEUE_KEYS.map((qk) => {
            const qb = summary.queueBreakdown[qk] || { pending: 0, in_progress: 0, completed: 0, missing: 0 };
            const total = qb.pending + qb.in_progress + qb.completed + qb.missing;
            const pctCompleted = total > 0 ? (qb.completed / total) * 100 : 0;
            const pctInProgress = total > 0 ? (qb.in_progress / total) * 100 : 0;
            const pctPending = total > 0 ? (qb.pending / total) * 100 : 0;
            return (
              <div key={qk}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{QUEUE_LABELS[qk]}</span>
                  <span className="text-muted-foreground">{qb.completed}/{total} complete</span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full flex overflow-hidden">
                  <div className="bg-green-500 h-full" style={{ width: `${pctCompleted}%` }} />
                  <div className="bg-blue-500 h-full" style={{ width: `${pctInProgress}%` }} />
                  <div className="bg-amber-500 h-full" style={{ width: `${pctPending}%` }} />
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                  <span className="text-green-600">{qb.completed} completed</span>
                  <span className="text-blue-600">{qb.in_progress} in progress</span>
                  <span className="text-amber-600">{qb.pending} pending</span>
                  <span className="text-gray-400">{qb.missing} missing</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-4">Attention Needed</h3>
        <div className="space-y-2">
          {data.techs
            .filter((t) => t.hasEscalation)
            .slice(0, 5)
            .map((t) => (
              <div key={t.workflowId} className="flex items-center justify-between border rounded p-3">
                <div>
                  <div className="font-medium text-sm">{toTitleCase(t.techName)}</div>
                  <div className="text-xs text-muted-foreground">{t.enterpriseId} • {t.daysOpen}d open</div>
                </div>
                <Badge variant="destructive" className="text-xs">Escalated</Badge>
              </div>
            ))}
          {data.techs.filter((t) => t.hasEscalation).length === 0 && (
            <div className="text-sm text-muted-foreground">No escalations</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactDetailsSection({ techDetail, toast }: { techDetail: TechDetail; toast: any }) {
  const workEmail = (!techDetail.personalEmail && techDetail.techName)
    ? (() => {
        const name = techDetail.techName.toLowerCase();
        const parts = name.includes(",")
          ? name.split(",").map((p) => p.trim()).filter(Boolean)
          : name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          const lastName = name.includes(",") ? parts[0] : parts[parts.length - 1];
          const firstName = name.includes(",") ? parts[1] : parts[0];
          return `${firstName}.${lastName}@transformco.com`;
        }
        return "";
      })()
    : "";

  const address = [
    techDetail.fleetPickupAddress,
  ].filter(Boolean).join(", ");

  return (
    <div className="border rounded-lg p-4 mb-4">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <User className="w-4 h-4" />
        Contact Details
      </h4>
      <div className="grid grid-cols-1 gap-2 text-sm">
        {techDetail.contactNumber && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-3 h-3" />
              <span>Mobile</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{techDetail.contactNumber}</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(techDetail.contactNumber!, toast)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {workEmail && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-3 h-3" />
              <span>Work Email</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs">{workEmail}</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(workEmail, toast)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {techDetail.personalEmail && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-3 h-3" />
              <span>Personal Email</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs">{techDetail.personalEmail}</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(techDetail.personalEmail!, toast)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {address && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-3 h-3" />
              <span>Address</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs max-w-xs text-right">{address}</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(address, toast)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
        {techDetail.truckNumber && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Truck className="w-3 h-3" />
              <span>Truck Number</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{techDetail.truckNumber}</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(techDetail.truckNumber, toast)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GenericQueuePanel({
  task,
  children,
  techDetail,
  updateTaskMutation,
}: {
  task: any;
  children?: ReactNode;
  techDetail: TechDetail;
  updateTaskMutation: any;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(task?.notes || "");
  const [notesTaskId, setNotesTaskId] = useState(task?.id);
  if (task?.id !== notesTaskId) {
    setNotes(task?.notes || "");
    setNotesTaskId(task?.id);
  }

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Circle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p>No task created yet</p>
        </div>
      </div>
    );
  }

  function handlePickUp() {
    updateTaskMutation.mutate({ taskId: task.id, updates: { status: "in_progress" } });
  }

  function handleMarkComplete() {
    updateTaskMutation.mutate({ taskId: task.id, updates: { status: "completed" } });
  }

  function handleSaveNotes() {
    updateTaskMutation.mutate({ taskId: task.id, updates: { notes } });
    toast({ title: "Notes saved" });
  }

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-auto">
      <div className="flex-1">
        {children}
        <div className="mt-4">
          <label className="text-sm font-medium mb-2 block">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Add notes..."
          />
          <Button className="mt-2" variant="outline" size="sm" onClick={handleSaveNotes}>
            Save Notes
          </Button>
        </div>
      </div>
      <div className="w-48 flex-shrink-0">
        <h4 className="font-semibold text-sm mb-3">Quick Actions</h4>
        <div className="space-y-2">
          {task.status !== "in_progress" && task.status !== "completed" && (
            <Button className="w-full" size="sm" onClick={handlePickUp}>
              Pick Up
            </Button>
          )}
          <Button className="w-full" variant="outline" size="sm" disabled>
            <User className="w-4 h-4 mr-1" />
            Assign
          </Button>
          <Button
            className="w-full"
            variant={task.status === "completed" ? "secondary" : "default"}
            size="sm"
            onClick={handleMarkComplete}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            {task.status === "completed" ? "Completed" : "Mark Complete"}
          </Button>
        </div>
        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Status: <span className="font-medium capitalize">{task.status}</span></div>
          {task.assignedTo && <div>Assigned: <span className="font-medium">{task.assignedTo}</span></div>}
        </div>
      </div>
    </div>
  );
}

function NtaoPanel({ task, techDetail, updateTaskMutation }: { task: any; techDetail: TechDetail; updateTaskMutation: any }) {
  return (
    <GenericQueuePanel task={task} techDetail={techDetail} updateTaskMutation={updateTaskMutation}>
      <div className="border rounded-lg p-4">
        <h4 className="font-semibold text-sm mb-3">NTAO Information</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Truck/Vehicle Ref</div>
          <div>{techDetail.truckNumber || "N/A"}</div>
          <div className="text-muted-foreground">Enterprise ID</div>
          <div>{techDetail.enterpriseId || "N/A"}</div>
          <div className="text-muted-foreground">Stop Replenishment</div>
          <div>
            <Badge variant={task?.status === "completed" ? "default" : "outline"} className="text-xs">
              {task?.status === "completed" ? "Done" : "Pending"}
            </Badge>
          </div>
          <div className="text-muted-foreground">Workflow Step</div>
          <div>{task?.workflowStep || 1}</div>
        </div>
      </div>
    </GenericQueuePanel>
  );
}

function InventoryPanel({ task, techDetail, updateTaskMutation }: { task: any; techDetail: TechDetail; updateTaskMutation: any }) {
  return (
    <GenericQueuePanel task={task} techDetail={techDetail} updateTaskMutation={updateTaskMutation}>
      <div className="border rounded-lg p-4">
        <h4 className="font-semibold text-sm mb-3">Inventory Information</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Truck Number</div>
          <div>{techDetail.truckNumber || "N/A"}</div>
          <div className="text-muted-foreground">Enterprise ID</div>
          <div>{techDetail.enterpriseId || "N/A"}</div>
          <div className="text-muted-foreground">TPMS Removal</div>
          <div>
            <Badge variant={task?.status === "completed" ? "default" : "outline"} className="text-xs">
              {task?.status === "completed" ? "Done" : "Pending"}
            </Badge>
          </div>
          <div className="text-muted-foreground">Workflow Step</div>
          <div>{task?.workflowStep || 4}</div>
        </div>
      </div>
    </GenericQueuePanel>
  );
}

function FleetPanel({ task, techDetail, updateTaskMutation }: { task: any; techDetail: TechDetail; updateTaskMutation: any }) {
  return (
    <GenericQueuePanel task={task} techDetail={techDetail} updateTaskMutation={updateTaskMutation}>
      <div className="border rounded-lg p-4">
        <h4 className="font-semibold text-sm mb-3">Fleet Information</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-muted-foreground">Truck Number</div>
          <div>{techDetail.truckNumber || "N/A"}</div>
          <div className="text-muted-foreground">Routing Decision</div>
          <div>{task?.fleetRoutingDecision || "Awaiting"}</div>
          <div className="text-muted-foreground">Routing Received</div>
          <div>{task?.routingReceivedAt ? formatDate(task.routingReceivedAt) : "N/A"}</div>
          <div className="text-muted-foreground">Blocked Actions</div>
          <div>
            {task?.blockedActions?.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.blockedActions.map((a: string) => (
                  <Badge key={a} variant="destructive" className="text-xs">{a}</Badge>
                ))}
              </div>
            ) : "None"}
          </div>
          {techDetail.fleetPickupAddress && (
            <>
              <div className="text-muted-foreground">Pickup Address</div>
              <div className="text-xs">{techDetail.fleetPickupAddress}</div>
            </>
          )}
        </div>
      </div>
    </GenericQueuePanel>
  );
}

function AssetsPanel({ task, techDetail, updateTaskMutation }: { task: any; techDetail: TechDetail; updateTaskMutation: any }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(task?.notes || "");
  const [notesTaskId, setNotesTaskId] = useState(task?.id);
  if (task?.id !== notesTaskId) {
    setNotes(task?.notes || "");
    setNotesTaskId(task?.id);
  }
  const [showCarrierDropdown, setShowCarrierDropdown] = useState(!!task?.taskDisconnectedLine);

  const checklist = [
    { key: "taskToolsReturn", label: "Tools Return", desc: "" },
    { key: "taskIphoneReturn", label: "iPhone Return", desc: "" },
    { key: "taskDisconnectedLine", label: "Disconnect Phone Line", desc: "Suspend service" },
    { key: "taskDisconnectedMPayment", label: "Deactivate mPayment", desc: "Remove access in Temples system" },
    { key: "taskCloseSegnoOrders", label: "Close Segno Orders", desc: "Ensure no open work orders remain" },
    { key: "taskCreateShippingLabel", label: "Create UPS Shipping Label", desc: "Generate QR code for tech" },
  ];

  const allChecked = checklist.every((c) => task?.[c.key]);
  const uncheckedCount = checklist.filter((c) => !task?.[c.key]).length;

  function handleCheck(key: string, checked: boolean) {
    const update: any = { [key]: checked };
    if (key === "taskDisconnectedLine") setShowCarrierDropdown(checked);
    updateTaskMutation.mutate({ taskId: task.id, updates: update });
  }

  function handleMarkComplete() {
    if (!allChecked) {
      toast({ title: "Case still in progress", description: `${uncheckedCount} checklist item(s) still unchecked`, variant: "destructive" });
      return;
    }
    updateTaskMutation.mutate({ taskId: task.id, updates: { status: "completed" } });
  }

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Circle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p>No task created yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-auto">
      <div className="flex-1">
        <div className="border rounded-lg p-4 mb-4">
          <h4 className="font-semibold text-sm mb-3">Checklist</h4>
          <div className="space-y-3">
            {checklist.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <Checkbox
                  checked={!!task?.[item.key]}
                  onCheckedChange={(checked) => handleCheck(item.key, !!checked)}
                />
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  {item.desc && <div className="text-xs text-muted-foreground">{item.desc}</div>}
                  {item.key === "taskDisconnectedLine" && showCarrierDropdown && (
                    <Select
                      value={task?.carrier || ""}
                      onValueChange={(v) => updateTaskMutation.mutate({ taskId: task.id, updates: { carrier: v } })}
                    >
                      <SelectTrigger className="w-40 h-7 mt-1 text-xs">
                        <SelectValue placeholder="Select carrier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Verizon">Verizon</SelectItem>
                        <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                        <SelectItem value="AT&T">AT&T</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Add notes..."
          />
          <Button
            className="mt-2"
            variant="outline"
            size="sm"
            onClick={() => {
              updateTaskMutation.mutate({ taskId: task.id, updates: { notes } });
              toast({ title: "Notes saved" });
            }}
          >
            Save Notes
          </Button>
        </div>
      </div>

      <div className="w-48 flex-shrink-0">
        <h4 className="font-semibold text-sm mb-3">Quick Actions</h4>
        <div className="space-y-2">
          {task.status !== "in_progress" && task.status !== "completed" && (
            <Button
              className="w-full"
              size="sm"
              onClick={() => updateTaskMutation.mutate({ taskId: task.id, updates: { status: "in_progress" } })}
            >
              Pick Up
            </Button>
          )}
          <Button className="w-full" variant="outline" size="sm" disabled>
            <User className="w-4 h-4 mr-1" />
            Assign
          </Button>
          <Button className="w-full" variant="outline" size="sm" disabled>
            <Eye className="w-4 h-4 mr-1" />
            View Tool Audit
          </Button>
          <Button
            className="w-full"
            variant="outline"
            size="sm"
            disabled={!techDetail.personalEmail}
            title={!techDetail.personalEmail ? "No personal email" : ""}
          >
            <Send className="w-4 h-4 mr-1" />
            Send Audit Notif
          </Button>
          <Button className="w-full" variant="outline" size="sm" disabled>
            <ExternalLink className="w-4 h-4 mr-1" />
            View in Segno
            <span className="text-xs ml-1 text-muted-foreground">(Soon)</span>
          </Button>
          <Button className="w-full" variant="outline" size="sm" disabled>
            <Package className="w-4 h-4 mr-1" />
            Generate Label
            <span className="text-xs ml-1 text-muted-foreground">(Soon)</span>
          </Button>
          <Separator />
          <Button
            className="w-full"
            size="sm"
            onClick={handleMarkComplete}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            Mark Complete
          </Button>
        </div>
        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Status: <span className="font-medium capitalize">{task.status}</span></div>
          <div>Checked: <span className="font-medium">{checklist.filter(c => task?.[c.key]).length}/{checklist.length}</span></div>
        </div>
      </div>
    </div>
  );
}

function PhonePanel({
  task,
  techDetail,
  updateTaskMutation,
}: {
  task: any;
  techDetail: TechDetail;
  updateTaskMutation: any;
}) {
  const { toast } = useToast();
  const [subTab, setSubTab] = useState<"history" | "log">("history");
  const [notes, setNotes] = useState(task?.notes || "");
  const [notesTaskId, setNotesTaskId] = useState(task?.id);
  if (task?.id !== notesTaskId) {
    setNotes(task?.notes || "");
    setNotesTaskId(task?.id);
  }
  const [contactMethod, setContactMethod] = useState("phone");
  const [contactOutcome, setContactOutcome] = useState("");
  const [contactNotes, setContactNotes] = useState("");

  const addContactMutation = useMutation({
    mutationFn: async (payload: any) =>
      apiRequest("POST", `/api/unified-offboarding/task/${task.id}/contact-log`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unified-offboarding/tech", techDetail.workflowId] });
      setContactNotes("");
      toast({ title: "Contact logged" });
    },
  });

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Circle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p>No task created yet</p>
        </div>
      </div>
    );
  }

  const history: any[] = Array.isArray(task.phoneContactHistory) ? task.phoneContactHistory : [];

  function getMethodIcon(method: string) {
    switch (method) {
      case "phone": return <Phone className="w-3 h-3" />;
      case "email": return <Mail className="w-3 h-3" />;
      case "text": return <MessageSquare className="w-3 h-3" />;
      default: return <User className="w-3 h-3" />;
    }
  }

  function getOutcomeBadge(outcome: string | null) {
    if (!outcome) return null;
    const colors: Record<string, string> = {
      Reached: "bg-green-100 text-green-700",
      Voicemail: "bg-amber-100 text-amber-700",
      "No Response": "bg-gray-100 text-gray-700",
      "Wrong Number": "bg-red-100 text-red-700",
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${colors[outcome] || "bg-gray-100 text-gray-700"}`}>
        {outcome}
      </span>
    );
  }

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-auto">
      <div className="flex-1">
        <div className="border rounded-lg p-3 mb-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-1">
              <Badge variant="outline">{task.phoneRecoveryStage || "initiation"}</Badge>
            </div>
            {task.phoneNumber && (
              <div className="flex items-center gap-1">
                <Phone className="w-3 h-3 text-muted-foreground" />
                <span>{task.phoneNumber}</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{task.daysOpen || 0}d open</span>
            </div>
            {task.assignedTo && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <User className="w-3 h-3" />
                <span>{task.assignedTo}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button
            size="sm"
            variant={subTab === "history" ? "default" : "outline"}
            onClick={() => setSubTab("history")}
          >
            Contact History
          </Button>
          <Button
            size="sm"
            variant={subTab === "log" ? "default" : "outline"}
            onClick={() => setSubTab("log")}
          >
            Log Contact
          </Button>
        </div>

        {subTab === "history" && (
          <div className="space-y-3">
            {history.length === 0 && (
              <div className="text-sm text-muted-foreground">No contact attempts logged yet.</div>
            )}
            {history.map((entry: any, i: number) => (
              <div key={i} className="border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getMethodIcon(entry.method)}
                    <span className="capitalize font-medium">{entry.method}</span>
                    {getOutcomeBadge(entry.outcome)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""}
                  </span>
                </div>
                {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {subTab === "log" && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Contact Method</label>
              <Select value={contactMethod} onValueChange={setContactMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="text">Text/SMS</SelectItem>
                  <SelectItem value="in_person">In Person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Outcome</label>
              <Select value={contactOutcome} onValueChange={setContactOutcome}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Reached">Reached</SelectItem>
                  <SelectItem value="Voicemail">Voicemail</SelectItem>
                  <SelectItem value="No Response">No Response</SelectItem>
                  <SelectItem value="Wrong Number">Wrong Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <Textarea
                value={contactNotes}
                onChange={(e) => setContactNotes(e.target.value)}
                rows={3}
                placeholder="Contact notes..."
              />
            </div>
            <Button
              onClick={() =>
                addContactMutation.mutate({
                  method: contactMethod,
                  outcome: contactOutcome,
                  notes: contactNotes,
                })
              }
              disabled={addContactMutation.isPending}
            >
              Log Contact
            </Button>
          </div>
        )}

        <div className="mt-4">
          <label className="text-sm font-medium mb-2 block">Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Add notes..."
          />
          <Button
            className="mt-2"
            variant="outline"
            size="sm"
            onClick={() => {
              updateTaskMutation.mutate({ taskId: task.id, updates: { notes } });
              toast({ title: "Notes saved" });
            }}
          >
            Save Notes
          </Button>
        </div>
      </div>

      <div className="w-48 flex-shrink-0">
        <h4 className="font-semibold text-sm mb-3">Quick Actions</h4>
        <div className="space-y-2">
          {task.status !== "in_progress" && task.status !== "completed" && (
            <Button
              className="w-full"
              size="sm"
              onClick={() => updateTaskMutation.mutate({ taskId: task.id, updates: { status: "in_progress" } })}
            >
              Pick Up
            </Button>
          )}
          <Button className="w-full" variant="outline" size="sm" disabled>
            <User className="w-4 h-4 mr-1" />
            Assign
          </Button>
          <Button className="w-full" variant="outline" size="sm" disabled>
            <PackageCheck className="w-4 h-4 mr-1" />
            Mark Received
          </Button>
          <Button className="w-full" variant="outline" size="sm" disabled>
            <Send className="w-4 h-4 mr-1" />
            Send Label
          </Button>
          <Button
            className="w-full"
            size="sm"
            onClick={() => updateTaskMutation.mutate({ taskId: task.id, updates: { status: "completed" } })}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            Mark Complete
          </Button>
        </div>
        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Stage: <span className="font-medium capitalize">{task.phoneRecoveryStage || "initiation"}</span></div>
          <div>Status: <span className="font-medium capitalize">{task.status}</span></div>
          {task.phoneShippingLabelSent && <div className="text-green-600">Label Sent</div>}
        </div>
      </div>
    </div>
  );
}

function TechDetailPanel({
  techDetail,
  activeTab,
  setActiveTab,
  updateTaskMutation,
}: {
  techDetail: TechDetail;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  updateTaskMutation: any;
}) {
  const { toast } = useToast();
  const tasks = techDetail.tasks;

  const TAB_DEFS = [
    { key: "assets", label: "Assets/Tools", icon: Package },
    { key: "fleet", label: "Fleet", icon: Truck },
    { key: "inventory", label: "Inventory", icon: PackageCheck },
    { key: "ntao", label: "NTAO", icon: Package },
    { key: "phone", label: "Phone", icon: Phone },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">{toTitleCase(techDetail.techName)}</h2>
            <div className="text-sm text-muted-foreground">
              {techDetail.enterpriseId} {techDetail.employeeId ? `• EID: ${techDetail.employeeId}` : ""}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-sm text-muted-foreground">
              Sep Date: {formatDate(techDetail.separationDate)}
            </div>
            {techDetail.jobTitle && <Badge variant="outline" className="text-xs">{techDetail.jobTitle}</Badge>}
          </div>
        </div>
        <ContactDetailsSection techDetail={techDetail} toast={toast} />
        <div className="flex gap-2 flex-wrap">
          {TAB_DEFS.map((tab) => {
            const task = tasks[tab.key];
            const statusColor = STATUS_COLORS[task?.status || "missing"] || "bg-gray-300";
            return (
              <button
                key={tab.key}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "assets" && (
          <AssetsPanel task={tasks.assets} techDetail={techDetail} updateTaskMutation={updateTaskMutation} />
        )}
        {activeTab === "fleet" && (
          <FleetPanel task={tasks.fleet} techDetail={techDetail} updateTaskMutation={updateTaskMutation} />
        )}
        {activeTab === "inventory" && (
          <InventoryPanel task={tasks.inventory} techDetail={techDetail} updateTaskMutation={updateTaskMutation} />
        )}
        {activeTab === "ntao" && (
          <NtaoPanel task={tasks.ntao} techDetail={techDetail} updateTaskMutation={updateTaskMutation} />
        )}
        {activeTab === "phone" && (
          <PhonePanel task={tasks.phone} techDetail={techDetail} updateTaskMutation={updateTaskMutation} />
        )}
      </div>
    </div>
  );
}

export default function OffboardingQueue() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState("all");
  const [sortBy, setSortBy] = useState("sepDate");
  const [activeTab, setActiveTab] = useState("assets");

  const listQuery = useQuery<ListData>({
    queryKey: ["/api/unified-offboarding/techs"],
    refetchInterval: 60000,
  });

  const detailQuery = useQuery<TechDetail>({
    queryKey: ["/api/unified-offboarding/tech", selectedWorkflowId],
    enabled: !!selectedWorkflowId,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, updates }: { taskId: string; updates: any }) =>
      apiRequest("PATCH", `/api/unified-offboarding/task/${taskId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unified-offboarding/techs"] });
      if (selectedWorkflowId) {
        queryClient.invalidateQueries({ queryKey: ["/api/unified-offboarding/tech", selectedWorkflowId] });
      }
    },
  });

  const data = listQuery.data;

  const filteredTechs = data?.techs?.filter((t) => {
    const matchesSearch =
      !searchTerm ||
      t.techName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.enterpriseId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.truckNumber?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesQueue =
      queueFilter === "all" ||
      (t.queueStatuses[queueFilter]?.status !== "missing" && t.queueStatuses[queueFilter]?.status !== undefined);

    return matchesSearch && matchesQueue;
  }) || [];

  const sortedTechs = [...filteredTechs].sort((a, b) => {
    if (sortBy === "sepDate") {
      if (!a.separationDate && !b.separationDate) return 0;
      if (!a.separationDate) return 1;
      if (!b.separationDate) return -1;
      return new Date(b.separationDate).getTime() - new Date(a.separationDate).getTime();
    }
    if (sortBy === "name") return a.techName.localeCompare(b.techName);
    if (sortBy === "daysOpen") return b.daysOpen - a.daysOpen;
    return 0;
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="w-[420px] flex-shrink-0 border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <h1 className="text-lg font-semibold flex-1">Offboarding Queue</h1>
            <Badge variant="outline">{data?.summary?.totalTechs || 0} techs</Badge>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search techs, IDs, trucks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Select value={queueFilter} onValueChange={setQueueFilter}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Queues</SelectItem>
                {QUEUE_KEYS.map((qk) => (
                  <SelectItem key={qk} value={qk}>{QUEUE_LABELS[qk]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sepDate">Sep Date</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="daysOpen">Days Open</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {listQuery.isLoading && (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}
          {!listQuery.isLoading && sortedTechs.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No techs found</p>
            </div>
          )}
          {sortedTechs.map((tech) => (
            <TechCard
              key={tech.workflowId}
              tech={tech}
              selected={selectedWorkflowId === tech.workflowId}
              onClick={() => {
                setSelectedWorkflowId(tech.workflowId);
                setActiveTab("assets");
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedWorkflowId && data && (
          <SummaryDashboard data={data} />
        )}
        {!selectedWorkflowId && !data && listQuery.isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <Skeleton className="w-3/4 h-64" />
          </div>
        )}
        {selectedWorkflowId && detailQuery.isLoading && (
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {selectedWorkflowId && detailQuery.data && (
          <TechDetailPanel
            techDetail={detailQuery.data}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            updateTaskMutation={updateTaskMutation}
          />
        )}
        {selectedWorkflowId && detailQuery.error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            Failed to load tech detail
          </div>
        )}
      </div>
    </div>
  );
}
