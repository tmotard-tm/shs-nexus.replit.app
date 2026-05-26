import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import type { QueueItem, User, AutomationDetail } from "@shared/schema";
import {
  getLatestRecoveryOutreach,
  buildRecoveryOutreachBadgeText,
  type LatestRecoveryOutreach,
} from "@/components/assets-queue/outreach-utils";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  type DataSource,
  type ContactInfo,
} from "@/components/assets-queue/tech-data-utils";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Smartphone,
  Wifi,
  CreditCard,
  FileText,
  Package,
  ExternalLink,
  CheckCircle,
  Loader2,
  Truck,
  AlertCircle,
  Check,
  Save,
  Edit3,
  Send,
  Bot,
  Clock,
  AlertTriangle,
  Info,
} from "lucide-react";


function SendToolAuditButton({ itemId, techData }: { itemId: string; techData?: any }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/assets-queue/${itemId}/send-tool-audit`);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Tool Audit Notification Sent",
          description: `Sent to ${data.actualRecipient}${data.testMode ? ' (simulated)' : ''}`,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/assets-queue'] });
      } else {
        toast({
          title: "Failed to Send",
          description: data.error || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      let message = "Failed to send tool audit notification";
      if (error?.message) {
        const match = error.message.match(/^\d+:\s*(.+)/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            message = parsed.message || message;
          } catch {
            message = match[1];
          }
        } else {
          message = error.message;
        }
      }
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const hasEmail = techData?.personalEmail || techData?.email;

  return (
    <Button
      variant="outline"
      className="w-full justify-start"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Send className="h-4 w-4 mr-2" />
      )}
      {mutation.isPending ? "Sending..." : "Send Tool Audit Notification"}
      {!hasEmail && <Badge variant="secondary" className="ml-auto text-xs">No Email</Badge>}
    </Button>
  );
}

function SendOutreachButton({ itemId }: { itemId: string }) {
  const { toast } = useToast();

  const runSend = (intent: 'pre' | 'past', forceSend: boolean) =>
    apiRequest("POST", `/api/assets-queue/${itemId}/send-outreach`, {
      intent,
      ...(forceSend ? { forceSend: true } : {}),
    }).then(res => res.json());

  const handleResponse = (intent: 'pre' | 'past') => ({
    onSuccess: (data: any) => {
      // Always invalidate queue queries — partial PAST sends (e.g. email sent +
      // SMS blocked for no phone on file) still persist outreach events on the
      // server, so the timeline/badges must refresh regardless of overall
      // success. Without this, an operator sees stale per-channel status.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/assets-queue");
        },
      });
      if (data.success) {
        const parts = (data.results || []).map((r: any) => `${r.channel.toUpperCase()} ${r.status}`);
        toast({
          title: intent === 'pre' ? "Pre-Separation Outreach Sent" : "Past-Separation Outreach Sent",
          description: `${data.techName}: ${parts.join(' + ')}${data.auditWarning ? ` — ${data.auditWarning}` : ''}`,
        });
      } else {
        const parts = (data.results || []).map((r: any) => `${r.channel.toUpperCase()} ${r.success ? r.status : (r.error || r.status)}`);
        toast({
          title: "Outreach Partially Sent",
          description: `${data.techName || ''}: ${parts.join(' + ')}` || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      let message = "Failed to send outreach";
      let auditComplete = false;
      if (error?.message) {
        const match = error.message.match(/^\d+:\s*(.+)/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            message = parsed.message || message;
            auditComplete = !!parsed.auditComplete;
          } catch {
            message = match[1];
          }
        } else {
          message = error.message;
        }
      }
      if (auditComplete) {
        const confirmed = window.confirm(`${message}\n\nSend anyway?`);
        if (confirmed) {
          if (intent === 'pre') preMutation.mutate(true);
          else pastMutation.mutate(true);
          return;
        }
      }
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  const preMutation = useMutation({
    mutationFn: (forceSend: boolean = false) => runSend('pre', forceSend),
    ...handleResponse('pre'),
  });
  const pastMutation = useMutation({
    mutationFn: (forceSend: boolean = false) => runSend('past', forceSend),
    ...handleResponse('past'),
  });

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        className="justify-start border-blue-200 text-blue-700 hover:bg-blue-50"
        onClick={() => preMutation.mutate(false)}
        disabled={preMutation.isPending || pastMutation.isPending}
        data-testid="button-send-pre-outreach"
      >
        {preMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
        {preMutation.isPending ? "Sending Pre..." : "Send Pre Outreach"}
      </Button>
      <Button
        variant="outline"
        className="justify-start border-orange-200 text-orange-700 hover:bg-orange-50"
        onClick={() => pastMutation.mutate(false)}
        disabled={preMutation.isPending || pastMutation.isPending}
        data-testid="button-send-past-outreach"
      >
        {pastMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
        {pastMutation.isPending ? "Sending Past..." : "Send Past Outreach"}
      </Button>
    </div>
  );
}

function OutreachTimeline({ outreach }: { outreach?: Array<{ channel: string; templateName: string; lane: string; status: string; sentAt: string; sentBy?: string; error?: string }> }) {
  const laneLabels: Record<string, string> = {
    'recovery-pre-fleet': 'PRE — Fleet (Tool Audit)',
    'recovery-pre-byov': 'PRE — BYOV/Rental (Return)',
    'recovery-past-email': 'PAST — Return Everything (Email)',
    'recovery-past-sms': 'PAST — Return Everything (SMS)',
  };

  const statusStyles: Record<string, string> = {
    sent: 'bg-green-100 text-green-800 border-green-200',
    simulated: 'bg-blue-100 text-blue-800 border-blue-200',
    blocked: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    failed: 'bg-red-100 text-red-800 border-red-200',
  };

  if (!outreach || outreach.length === 0) {
    return (
      <div className="p-3 bg-muted rounded-md">
        <p className="text-sm text-muted-foreground italic">No outreach sent yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {outreach.map((entry, idx) => (
        <div key={idx} className="flex items-start gap-3 p-3 bg-white dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-700">
          <Mail className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{laneLabels[entry.templateName] || entry.templateName}</span>
              <Badge className={`text-[10px] px-1.5 py-0 h-4 border ${statusStyles[entry.status] || 'bg-slate-100 text-slate-700'}`}>
                {entry.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {new Date(entry.sentAt).toLocaleString()}
              {entry.sentBy && ` • by ${entry.sentBy}`}
            </div>
            {entry.error && (
              <p className="text-xs text-red-600 mt-1">{entry.error}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface VehicleLocation {
  lat?: number;
  lng?: number;
  address?: string;
  lastUpdated?: string;
}

interface AssetsTaskDetailViewProps {
  item: any;
  currentUser?: User;
  users: User[];
  onBack: () => void;
  onComplete: (itemId: string) => void;
  onAssign?: (itemId: string, assigneeId: string) => void;
  onPickUp?: (item: any) => void;
  isCompletePending: boolean;
  isAssignPending?: boolean;
}

type TaskKey = 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel';

interface TaskItem {
  key: TaskKey;
  label: string;
  description: string;
  icon: typeof Briefcase;
  hasCarrier?: boolean;
}

const TASK_LIST: TaskItem[] = [
  { key: 'taskToolsReturn', label: 'Tools Return', description: '', icon: Briefcase },
  { key: 'taskIphoneReturn', label: 'iPhone Return', description: '', icon: Smartphone },
  { key: 'taskDisconnectedLine', label: 'Disconnect Phone Line', description: 'Suspend service', icon: Wifi, hasCarrier: true },
  { key: 'taskDisconnectedMPayment', label: 'Deactivate mPayment', description: 'Remove access in Temples system', icon: CreditCard },
  { key: 'taskCloseSegnoOrders', label: 'Close Segno Orders', description: 'Ensure no open work orders remain', icon: FileText },
  { key: 'taskCreateShippingLabel', label: 'Create UPS Shipping Label', description: 'Generate QR code for tech', icon: Package },
];

type AutomationStatus = 'completed' | 'processing' | 'actionRequired';

const AUTOMATED_TASK_KEYS: TaskKey[] = [
  'taskToolsReturn',
  'taskIphoneReturn',
  'taskCreateShippingLabel',
];

const HUMAN_TASK_KEYS: TaskKey[] = [
  'taskDisconnectedLine',
  'taskDisconnectedMPayment',
  'taskCloseSegnoOrders',
];

const VENDOR_CHECK_ADVISORY = "Segno orders will be cancelled automatically. Check vendor portals (Amazon, FedEx, etc.) for any orders already in transit.";

function getAutomationStatus(key: TaskKey, isComplete: boolean, automationDetail?: AutomationDetail | null): AutomationStatus {
  if (automationDetail?.automatedTasks?.[key]?.status) {
    return automationDetail.automatedTasks[key].status;
  }
  if (isComplete) return 'completed';
  return 'processing';
}

function AutomationBadge({
  status,
  latestOutreach,
}: {
  status: AutomationStatus;
  latestOutreach?: LatestRecoveryOutreach | null;
}) {
  switch (status) {
    case 'completed':
      return (
        <Badge className="text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100">
          <CheckCircle className="h-3 w-3 mr-1" />
          System Completed
        </Badge>
      );
    case 'processing': {
      if (!latestOutreach) {
        return (
          <Badge
            className="text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
            title="No recovery outreach email has been sent yet."
          >
            <Clock className="h-3 w-3 mr-1" />
            Awaiting outreach
          </Badge>
        );
      }
      const text = buildRecoveryOutreachBadgeText(latestOutreach);
      const fullTimestamp = latestOutreach.sentAt.toLocaleString();
      const className =
        latestOutreach.status === 'sent'
          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-100'
          : latestOutreach.status === 'simulated'
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-100'
          : latestOutreach.status === 'failed'
          ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100'
          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800 hover:bg-yellow-100';
      const Icon =
        latestOutreach.status === 'sent' || latestOutreach.status === 'simulated'
          ? Mail
          : AlertTriangle;
      return (
        <Badge className={`text-xs font-medium ${className}`} title={fullTimestamp}>
          <Icon className="h-3 w-3 mr-1" />
          {text}
        </Badge>
      );
    }
    case 'actionRequired':
      return (
        <Badge className="text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Action Required
        </Badge>
      );
  }
}

function InlineNotesCard({ item }: { item: any }) {
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2" style={{ color: '#1A4B8C' }}>
            <FileText className="h-5 w-5" />
            Notes
          </CardTitle>
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
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this case..."
            className="min-h-[80px] text-sm"
          />
        ) : (
          <div className="p-3 bg-muted rounded-md min-h-[60px]">
            {item.notes ? (
              <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No notes yet.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AssetsTaskDetailView({
  item,
  currentUser,
  users,
  onBack,
  onComplete,
  onAssign,
  onPickUp,
  isCompletePending,
  isAssignPending
}: AssetsTaskDetailViewProps) {
  const isPending = item.status === 'pending';
  const isAssignedToMe = item.assignedTo === currentUser?.id;
  const [taskState, setTaskState] = useState<Record<TaskKey, boolean>>({
    taskToolsReturn: item.taskToolsReturn ?? false,
    taskIphoneReturn: item.taskIphoneReturn ?? false,
    taskDisconnectedLine: item.taskDisconnectedLine ?? false,
    taskDisconnectedMPayment: item.taskDisconnectedMPayment ?? false,
    taskCloseSegnoOrders: item.taskCloseSegnoOrders ?? false,
    taskCreateShippingLabel: item.taskCreateShippingLabel ?? false,
  });
  const [carrier, setCarrier] = useState<string>(item.carrier || '');

  const { save, saveStatus, flushPending } = useDebouncedSave({
    itemId: item.id,
    module: 'assets',
    debounceMs: 500
  });

  const handleBack = () => {
    flushPending();
    onBack();
  };

  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);

  const allTasksComplete = Object.values(taskState).every(Boolean);
  const completedCount = Object.values(taskState).filter(Boolean).length;
  const totalTasks = Object.keys(taskState).length;

  const handleCompleteClick = () => {
    flushPending();
    if (!allTasksComplete) {
      setShowIncompleteWarning(true);
    } else {
      onComplete(item.id);
    }
  };

  const handleConfirmComplete = () => {
    setShowIncompleteWarning(false);
    onComplete(item.id);
  };

  const parsedData = (() => {
    try {
      return item.data ? (typeof item.data === 'string' ? JSON.parse(item.data) : item.data) : {};
    } catch {
      return {};
    }
  })();
  const techName = parsedData.techName || parsedData.technicianName || parsedData.employeeName || item.techData?.techName || 'Unknown Technician';
  const truckNumber = parsedData.vehicleNumber || parsedData.truckNumber || parsedData.truck || item.techData?.hrTruckNumber || '';

  const { data: contactInfo, isLoading: isContactLoading } = useQuery<ContactInfo>({
    queryKey: ['/api/assets-queue', item.id, 'contact'],
  });

  const { data: vehicleLocation, isLoading: isLocationLoading } = useQuery<VehicleLocation>({
    queryKey: [`/api/samsara/vehicle/${truckNumber}`],
    enabled: !!truckNumber && truckNumber !== 'Unknown',
  });

  const { data: vehicleNexusData } = useQuery<{ postOffboardedStatus: string | null; toolsPartsLocation: string | null; partsRecoveryInitiated: string | null }>({
    queryKey: ['/api/vehicle-nexus-data', truckNumber],
    enabled: !!truckNumber && truckNumber !== 'Unknown',
  });

  const disposition = vehicleNexusData?.postOffboardedStatus || null;

  const [toolsPartsLocation, setToolsPartsLocation] = useState<string>("");
  const [partsRecoveryInitiated, setPartsRecoveryInitiated] = useState<string>("");

  useEffect(() => {
    if (vehicleNexusData) {
      setToolsPartsLocation(vehicleNexusData.toolsPartsLocation || "");
      setPartsRecoveryInitiated(vehicleNexusData.partsRecoveryInitiated || "");
    } else {
      setToolsPartsLocation("");
      setPartsRecoveryInitiated("");
    }
  }, [vehicleNexusData]);

  const nexusDataMutation = useMutation({
    mutationFn: (updates: Record<string, string | null>) =>
      apiRequest("PUT", `/api/vehicle-nexus-data/${truckNumber}`, { vehicleNumber: truckNumber, ...updates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', truckNumber] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === '/api/vehicle-nexus-data/batch',
      });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    },
  });

  const handleTaskToggle = (key: TaskKey) => {
    const newValue = !taskState[key];
    setTaskState(prev => ({ ...prev, [key]: newValue }));
    save({ [key]: newValue });
    apiRequest("PATCH", `/api/assets-queue/${item.id}/automation-detail`, {
      automatedTasks: {
        [key]: {
          status: newValue ? 'completed' : 'processing',
          source: 'manual',
          updatedAt: new Date().toISOString(),
        }
      }
    }).catch((err) => console.warn('automation-detail PATCH failed (non-blocking):', err));
  };

  const handleCarrierChange = (value: string) => {
    setCarrier(value);
    save({ carrier: value || null });
  };

  const formatAddress = (addr: ContactInfo['homeAddress'] | undefined) => {
    if (!addr) return null;
    const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.postal].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: '#1A4B8C' }}>
              Day 0: Recover Equipment & Tools - {techName}
            </h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                Assets Queue Task • {item.status}
              </p>
              {(item.automationDetail as AutomationDetail)?.page_visited_at && (
                <Badge className="text-xs bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Engaged
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus !== 'idle' && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {saveStatus === 'saving' && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <Check className="h-3 w-3 text-green-600" />
                  <span className="text-green-600">Saved</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <AlertCircle className="h-3 w-3 text-red-600" />
                  <span className="text-red-600">Save failed</span>
                </>
              )}
            </div>
          )}
          {item.isByov && (
            <Badge className="bg-green-100 text-green-800 border-green-200">BYOV</Badge>
          )}
          <Badge variant="outline">Truck: {truckNumber || 'N/A'}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Contact & Disposition */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ color: '#1A4B8C' }}>Contact & Disposition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-muted-foreground">Contact Details</h4>

              {isContactLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : contactInfo ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Mobile:</span>
                    <span>{contactInfo.mobilePhone?.value || 'Not available'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium flex items-center gap-1">
                      Personal:
                    </span>
                    {contactInfo.personalPhone?.value ? (
                      <span className="text-green-600 font-medium">{contactInfo.personalPhone.value}</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Not available</span>
                        <Button variant="outline" size="sm" disabled className="h-6 text-xs">
                          Request from HR
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Home:</span>
                    <span>{contactInfo.homePhone?.value || 'Not available'}</span>
                  </div>
                  {contactInfo.personalEmail?.value && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium flex items-center gap-1">
                        Email:
                      </span>
                      <a href={`mailto:${contactInfo.personalEmail.value}`} className="text-[#1A4B8C] hover:underline">
                        {contactInfo.personalEmail.value}
                      </a>
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span className="font-medium flex items-center gap-1">
                      Address:
                    </span>
                    <span>{formatAddress(contactInfo.homeAddress) || 'Not available'}</span>
                  </div>
                  {contactInfo.fleetPickupAddress?.value && (
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-amber-500 mt-0.5" />
                      <span className="font-medium flex items-center gap-1">
                        Fleet Pickup:
                      </span>
                      <span>{contactInfo.fleetPickupAddress.value}</span>
                    </div>
                  )}
                  {contactInfo.hrTruckNumber?.value && (
                    <div className="flex items-center gap-2 text-sm">
                      <Truck className="h-4 w-4 text-amber-500" />
                      <span className="font-medium flex items-center gap-1">
                        Truck Number:
                      </span>
                      <span>{contactInfo.hrTruckNumber.value}</span>
                    </div>
                  )}
                  {contactInfo.separationCategory && (
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Category:</span>
                      <Badge variant="outline" className="text-xs">{contactInfo.separationCategory}</Badge>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 inline mr-1" />
                  Unable to load contact info
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="font-medium text-sm text-muted-foreground">Vehicle Disposition</h4>
              <div className="p-3 bg-muted/50 rounded-lg border">
                {disposition ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-sm font-medium bg-white">
                      {disposition}
                    </Badge>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground italic">No disposition set — update on Weekly Offboarding page</span>
                )}
              </div>

              {vehicleLocation && !isLocationLoading && vehicleLocation.address && (
                <div className="mt-3 p-2 bg-muted rounded text-sm">
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Truck className="h-3 w-3" />
                    <span className="font-medium">Current Location:</span>
                  </div>
                  <span className="text-xs">{vehicleLocation.address}</span>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="font-medium text-sm text-muted-foreground">Tools &amp; Parts</h4>
              <div>
                <Label className="text-xs text-muted-foreground">Where are the tools &amp; parts being left?</Label>
                <Select
                  value={toolsPartsLocation || "__none__"}
                  onValueChange={(val) => {
                    const newVal = val === "__none__" ? "" : val;
                    setToolsPartsLocation(newVal);
                    if (truckNumber) nexusDataMutation.mutate({ toolsPartsLocation: newVal || null });
                  }}
                  disabled={!truckNumber || truckNumber === 'N/A' || truckNumber === 'Unknown'}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select location..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-- None --</SelectItem>
                    <SelectItem value="in_the_truck">In the truck</SelectItem>
                    <SelectItem value="techs_home">Tech's home</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Parts recovery initiated</Label>
                <Select
                  value={partsRecoveryInitiated || "__none__"}
                  onValueChange={(val) => {
                    const newVal = val === "__none__" ? "" : val;
                    setPartsRecoveryInitiated(newVal);
                    if (truckNumber) nexusDataMutation.mutate({ partsRecoveryInitiated: newVal || null });
                  }}
                  disabled={!truckNumber || truckNumber === 'N/A' || truckNumber === 'Unknown'}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-- None --</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Column 2: Task Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ color: '#1A4B8C' }}>Task Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Automated Tasks</span>
              </div>
              {TASK_LIST.filter(t => AUTOMATED_TASK_KEYS.includes(t.key)).map((task) => {
                const Icon = task.icon;
                const isChecked = taskState[task.key];
                const status = getAutomationStatus(task.key, isChecked, item.automationDetail as AutomationDetail | null);
                const latestOutreach = getLatestRecoveryOutreach(
                  item.automationDetail as AutomationDetail | null,
                  task.key,
                );
                return (
                  <div key={task.key} className="space-y-1">
                    <div
                      className={`flex items-center gap-3 p-2 rounded ${
                        status === 'completed' ? 'bg-green-50 dark:bg-green-900/20' :
                        status === 'actionRequired' ? 'bg-red-50 dark:bg-red-900/10' :
                        'bg-yellow-50 dark:bg-yellow-900/10'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${
                        status === 'completed' ? 'text-green-600' :
                        status === 'actionRequired' ? 'text-red-600' :
                        'text-yellow-600'
                      }`} />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{task.label}</span>
                        {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
                      </div>
                      <AutomationBadge status={status} latestOutreach={latestOutreach} />
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600">Manual Tasks</span>
              </div>
              {TASK_LIST.filter(t => HUMAN_TASK_KEYS.includes(t.key)).map((task) => {
                const Icon = task.icon;
                const isChecked = taskState[task.key];
                return (
                  <div key={task.key} className="space-y-2">
                    <div
                      className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                        isChecked ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-muted'
                      }`}
                      onClick={() => handleTaskToggle(task.key)}
                    >
                      <Checkbox
                        id={task.key}
                        checked={isChecked}
                        onCheckedChange={() => handleTaskToggle(task.key)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${isChecked ? 'text-green-600' : 'text-muted-foreground'}`} />
                          <Label
                            htmlFor={task.key}
                            className={`text-sm font-medium cursor-pointer ${isChecked ? 'line-through text-muted-foreground' : ''}`}
                          >
                            {task.label}
                          </Label>
                        </div>
                        {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                      </div>
                      {isChecked ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <Badge className="text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-100">
                          <Clock className="h-3 w-3 mr-1" />
                          Awaiting Operator
                        </Badge>
                      )}
                    </div>

                    {task.hasCarrier && (
                      <div className="ml-8">
                        <Select value={carrier} onValueChange={handleCarrierChange}>
                          <SelectTrigger className="w-40 h-8 text-sm">
                            <SelectValue placeholder="Select carrier" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Verizon">Verizon</SelectItem>
                            <SelectItem value="T-Mobile">T-Mobile</SelectItem>
                          </SelectContent>
                        </Select>
                        {carrier && (
                          <Badge variant="outline" className="mt-1 text-xs">
                            {carrier}
                          </Badge>
                        )}
                      </div>
                    )}

                    {task.key === 'taskCloseSegnoOrders' && (
                      <div className="ml-6 flex items-start gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                        <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-800 dark:text-amber-400">{VENDOR_CHECK_ADVISORY}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Column 3: Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ color: '#1A4B8C' }}>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              asChild
            >
              <a
                href={`https://tech-tool-audit-checklist-lucabuccilli1.replit.app/admin?enterpriseId=${item.techData?.enterpriseId || ''}&type=offboarding`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Briefcase className="h-4 w-4 mr-2" />
                View Tool Audit Form
                <ExternalLink className="h-3 w-3 ml-auto" />
              </a>
            </Button>

            <SendToolAuditButton itemId={item.id} techData={item.techData} />

            {(item as any).toolAuditStatus?.auditComplete && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                data-testid="alert-tool-audit-complete"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>Tool audit already complete</strong> for this technician in Snowflake. Sending outreach will require an override confirmation.
                </span>
              </div>
            )}
            {(item as any).toolAuditStatus?.preVariant && (
              <div
                className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900"
                data-testid="text-pre-variant"
              >
                <strong>Pre will send:</strong>{' '}
                {(item as any).toolAuditStatus.preVariant === 'byov'
                  ? 'BYOV/Rental Return (tools + iPhone via QR shipping)'
                  : 'Fleet Tool Audit (company vehicle — audit ask only)'}
              </div>
            )}
            <SendOutreachButton itemId={item.id} />

            <Button
              variant="outline"
              className="w-full justify-start"
              disabled
            >
              <Package className="h-4 w-4 mr-2" />
              Generate QR Label
              <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
            </Button>

            <Separator className="my-4" />

            {isPending && !isAssignedToMe && onAssign && currentUser && (
              <Button
                className="w-full mb-3"
                style={{ backgroundColor: '#1A4B8C' }}
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
              style={{ backgroundColor: '#36D9A3' }}
              onClick={handleCompleteClick}
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
              <p className="text-xs text-muted-foreground text-center mt-2">
                Assign to yourself first to mark complete
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Outreach History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2" style={{ color: '#1A4B8C' }}>
            <Mail className="h-5 w-5" />
            Outreach History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OutreachTimeline outreach={(item.automationDetail as AutomationDetail)?.outreach} />
        </CardContent>
      </Card>

      {/* Notes Section */}
      <InlineNotesCard item={item} />

      <AlertDialog open={showIncompleteWarning} onOpenChange={setShowIncompleteWarning}>
        <AlertDialogContent aria-describedby="incomplete-tasks-description">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Incomplete Tasks
            </AlertDialogTitle>
            <AlertDialogDescription id="incomplete-tasks-description">
              Only {completedCount} of {totalTasks} tasks are marked complete.
              Some tasks may not apply to this case.
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
