import { useState } from "react";
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
import type { QueueItem, User } from "@shared/schema";
import { useDebouncedSave } from "@/hooks/use-debounced-save";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  type DataSource,
  type ContactInfo,
  SourceDot,
  SourceLegend,
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
} from "lucide-react";


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
  { key: 'taskToolsReturn', label: 'Tools Return Asset', description: 'Verify all assigned tools returned', icon: Briefcase },
  { key: 'taskIphoneReturn', label: 'iPhone Return Asset', description: 'Check condition and unlock status', icon: Smartphone },
  { key: 'taskDisconnectedLine', label: 'Disconnect Phone Line', description: 'Suspend service', icon: Wifi, hasCarrier: true },
  { key: 'taskDisconnectedMPayment', label: 'Deactivate mPayment', description: 'Remove access in Temples system', icon: CreditCard },
  { key: 'taskCloseSegnoOrders', label: 'Close Segno Orders', description: 'Ensure no open work orders remain', icon: FileText },
  { key: 'taskCreateShippingLabel', label: 'Create UPS Shipping Label', description: 'Generate QR code for tech', icon: Package },
];

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

  const { data: vehicleNexusData } = useQuery<{ postOffboardedStatus: string | null }>({
    queryKey: ['/api/vehicle-nexus-data', truckNumber],
    enabled: !!truckNumber && truckNumber !== 'Unknown',
  });

  const disposition = vehicleNexusData?.postOffboardedStatus || null;

  const handleTaskToggle = (key: TaskKey) => {
    const newValue = !taskState[key];
    setTaskState(prev => ({ ...prev, [key]: newValue }));
    save({ [key]: newValue });
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
            <p className="text-sm text-muted-foreground">
              Assets Queue Task • {item.status}
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
                  <SourceLegend />
                  <div className="flex items-center gap-2 text-sm">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Mobile:</span>
                    <span>{contactInfo.mobilePhone?.value || 'Not available'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium flex items-center gap-1">
                      Personal:
                      <SourceDot source={contactInfo.personalPhone?.source} />
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
                        <SourceDot source={contactInfo.personalEmail.source} />
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
                      <SourceDot source={contactInfo.address?.source} />
                    </span>
                    <span>{formatAddress(contactInfo.homeAddress) || 'Not available'}</span>
                  </div>
                  {contactInfo.fleetPickupAddress?.value && (
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-amber-500 mt-0.5" />
                      <span className="font-medium flex items-center gap-1">
                        Fleet Pickup:
                        <SourceDot source={contactInfo.fleetPickupAddress.source} />
                      </span>
                      <span>{contactInfo.fleetPickupAddress.value}</span>
                    </div>
                  )}
                  {contactInfo.hrTruckNumber?.value && (
                    <div className="flex items-center gap-2 text-sm">
                      <Truck className="h-4 w-4 text-amber-500" />
                      <span className="font-medium flex items-center gap-1">
                        HR Truck:
                        <SourceDot source={contactInfo.hrTruckNumber.source} />
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
              disabled
            >
              <FileText className="h-4 w-4 mr-2" />
              View in Segno
              <Badge variant="secondary" className="ml-auto text-xs">Coming Soon</Badge>
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
