import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { QueueItem, User } from "@shared/schema";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Smartphone,
  Wifi,
  WifiOff,
  CreditCard,
  FileText,
  Package,
  ExternalLink,
  CheckCircle,
  Loader2,
  Truck,
  AlertCircle,
  Check
} from "lucide-react";

interface ToolsQueueItem extends Omit<QueueItem, 'isByov' | 'fleetRoutingDecision' | 'routingReceivedAt' | 'blockedActions' | 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel' | 'carrier'> {
  isByov?: boolean | null;
  fleetRoutingDecision?: string | null;
  routingReceivedAt?: string | null;
  blockedActions?: string[] | null;
  taskToolsReturn?: boolean | null;
  taskIphoneReturn?: boolean | null;
  taskDisconnectedLine?: boolean | null;
  taskDisconnectedMPayment?: boolean | null;
  taskCloseSegnoOrders?: boolean | null;
  taskCreateShippingLabel?: boolean | null;
  carrier?: string | null;
  currentBlockingStatus?: {
    status: string;
    routingPath: string | null;
    blockedActions: string[];
    isByov: boolean;
  };
}

interface ContactInfo {
  personalPhone: string | null;
  workPhone: string | null;
  homePhone: string | null;
  homeAddress: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal: string | null;
  };
  employeeId: string;
  techName: string;
}

interface VehicleLocation {
  lat?: number;
  lng?: number;
  address?: string;
  lastUpdated?: string;
}

interface ToolsTaskDetailViewProps {
  item: ToolsQueueItem;
  currentUser?: User;
  onBack: () => void;
  onComplete: (itemId: string) => void;
  onAssign?: (itemId: string, assigneeId: string) => void;
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
  { key: 'taskToolsReturn', label: 'Tools Return Asset', description: 'Verify all assigned tools returned', icon: Briefcase },
  { key: 'taskIphoneReturn', label: 'iPhone Return Asset', description: 'Check condition and unlock status', icon: Smartphone },
  { key: 'taskDisconnectedLine', label: 'Disconnect Phone Line', description: 'Suspend service', icon: Wifi, hasCarrier: true },
  { key: 'taskDisconnectedMPayment', label: 'Deactivate mPayment', description: 'Remove access in Temples system', icon: CreditCard },
  { key: 'taskCloseSegnoOrders', label: 'Close Segno Orders', description: 'Ensure no open work orders remain', icon: FileText },
  { key: 'taskCreateShippingLabel', label: 'Create UPS Shipping Label', description: 'Generate QR code for tech', icon: Package },
];

export function ToolsTaskDetailView({
  item,
  currentUser,
  onBack,
  onComplete,
  onAssign,
  isCompletePending,
  isAssignPending
}: ToolsTaskDetailViewProps) {
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
  
  const normalizeRouting = (value: string | null | undefined): string => {
    if (!value) return 'pending';
    const upper = value.toUpperCase();
    if (upper === 'PMF') return 'PMF';
    if (upper === 'PEP_BOYS' || upper === 'PEPBOYS' || upper === 'PEP BOYS') return 'PEP_BOYS';
    if (upper === 'TRANSFER' || upper === 'REASSIGNED' || upper.includes('REASSIGN')) return 'TRANSFER';
    return 'pending';
  };
  
  const [routing, setRouting] = useState<string>(normalizeRouting(item.fleetRoutingDecision));

  const { save, saveStatus, flushPending } = useDebouncedSave({ 
    itemId: item.id,
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
  const techName = parsedData.techName || parsedData.technicianName || parsedData.employeeName || 'Unknown Technician';
  const truckNumber = parsedData.vehicleNumber || parsedData.truckNumber || parsedData.truck || '';

  const { data: contactInfo, isLoading: isContactLoading } = useQuery<ContactInfo>({
    queryKey: [`/api/tools-queue/${item.id}/contact`],
  });

  const { data: vehicleLocation, isLoading: isLocationLoading } = useQuery<VehicleLocation>({
    queryKey: [`/api/samsara/vehicle/${truckNumber}`],
    enabled: !!truckNumber && truckNumber !== 'Unknown',
  });

  const handleTaskToggle = (key: TaskKey) => {
    const newValue = !taskState[key];
    setTaskState(prev => ({ ...prev, [key]: newValue }));
    save({ [key]: newValue });
  };

  const handleCarrierChange = (value: string) => {
    setCarrier(value);
    save({ carrier: value || null });
  };

  const handleRoutingChange = (value: string) => {
    setRouting(value);
    save({ fleetRoutingDecision: value === 'pending' ? null : value });
  };

  const formatAddress = (addr: ContactInfo['homeAddress'] | undefined) => {
    if (!addr) return null;
    const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.postal].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  const getRoutingLabel = (value: string) => {
    switch (value?.toUpperCase()) {
      case 'PMF': return 'PMF (Park My Fleet)';
      case 'PEP_BOYS':
      case 'PEPBOYS':
      case 'PEP BOYS': return 'Pep Boys';
      case 'TRANSFER':
      case 'REASSIGNED': return 'Transfer/Reassigned';
      default: return 'Pending';
    }
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
            <p className="text-sm text-muted-foreground">
              Tools Queue Task • {item.status}
            </p>
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
        {/* Column 1: Contact & Routing */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ color: '#1A4B8C' }}>Contact & Routing</CardTitle>
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
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Work:</span>
                    <span>{contactInfo.workPhone || 'Not available'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Personal:</span>
                    {contactInfo.personalPhone ? (
                      <span className="text-green-600 font-medium">{contactInfo.personalPhone}</span>
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
                    <span>{contactInfo.homePhone || 'Not available'}</span>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span className="font-medium">Address:</span>
                    <span>{formatAddress(contactInfo.homeAddress) || 'Not available'}</span>
                  </div>
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
              <h4 className="font-medium text-sm text-muted-foreground">Vehicle Routing</h4>
              <RadioGroup value={routing} onValueChange={handleRoutingChange} className="space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="PMF" id="routing-pmf" />
                  <Label htmlFor="routing-pmf" className="text-sm cursor-pointer">PMF (Park My Fleet)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="PEP_BOYS" id="routing-pepboys" />
                  <Label htmlFor="routing-pepboys" className="text-sm cursor-pointer">Pep Boys</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="TRANSFER" id="routing-transfer" />
                  <Label htmlFor="routing-transfer" className="text-sm cursor-pointer">Transfer/Reassigned</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pending" id="routing-pending" />
                  <Label htmlFor="routing-pending" className="text-sm cursor-pointer">Pending</Label>
                </div>
              </RadioGroup>

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
          </CardContent>
        </Card>

        {/* Column 2: Task Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg" style={{ color: '#1A4B8C' }}>Task Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {TASK_LIST.map((task) => {
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
                        <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                      </div>
                      {isChecked && <CheckCircle className="h-4 w-4 text-green-600" />}
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
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="flex items-center justify-between p-2 bg-muted rounded">
              <span className="text-sm font-medium">Progress</span>
              <Badge 
                variant={completedCount === totalTasks ? "default" : "secondary"}
                style={completedCount === totalTasks ? { backgroundColor: '#36D9A3' } : {}}
              >
                {completedCount}/{totalTasks} Complete
              </Badge>
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
              <a href="#segno-pending" target="_blank" rel="noopener noreferrer">
                <FileText className="h-4 w-4 mr-2" />
                View in Segno
                <ExternalLink className="h-3 w-3 ml-auto" />
              </a>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              asChild
            >
              <a 
                href="https://tech-tool-audit-checklist-lucabuccilli1.replit.app/" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <Briefcase className="h-4 w-4 mr-2" />
                View Tool Audit Form
                <ExternalLink className="h-3 w-3 ml-auto" />
              </a>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              disabled
            >
              <Mail className="h-4 w-4 mr-2" />
              Send Reminder Email
              <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
            </Button>

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
