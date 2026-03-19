import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { type Truck, type Action } from "@shared/fleet-scope-schema";
import { Link } from "wouter";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { ActionTimeline } from "@/components/fleet-scope/ActionTimeline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  ExternalLink,
  MapPin,
  Phone,
  User,
  Calendar,
  Wrench,
  FileText,
  Clock,
  Pencil,
  Check,
  CheckCircle,
  X,
  Lightbulb,
  Car,
  PhoneCall,
  PhoneForwarded,
  Loader2,
  Wifi,
  Navigation,
  Gauge,
} from "lucide-react";
import { format } from "date-fns";

interface TruckDetailPanelProps {
  truckId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type OwnerName = "Oscar S" | "Rob A" | "Bob B" | "John C" | "Mandy R" | "Final Actioned";

function determineOwner(truck: Truck): OwnerName {
  const mainStatus = truck.mainStatus || "";
  const subStatus = truck.subStatus || "";
  if (truck.vanPickedUp || mainStatus === "On Road" || subStatus === "Vehicle was sold") {
    return "Final Actioned";
  }
  if (mainStatus === "Confirming Status") return "Oscar S";
  if (mainStatus === "Decision Pending") {
    if (subStatus === "Estimate received, needs review") return "Rob A";
    return "Oscar S";
  }
  if (mainStatus === "Repairing") return "Oscar S";
  if (mainStatus === "Declined Repair" || mainStatus === "PMF") return "Bob B";
  if (mainStatus === "Tags") return "John C";
  if (mainStatus === "Scheduling") return "Mandy R";
  if (mainStatus === "In Transit") return "Oscar S";
  return "Oscar S";
}

const ownerColors: Record<OwnerName, string> = {
  "Oscar S": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Rob A": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "Bob B": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "John C": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Mandy R": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Final Actioned": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function InfoRow({ label, value, icon, testId }: { label: string; value: string | null | undefined; icon?: React.ReactNode; testId?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5" data-testid={testId}>
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">{value}</p>
      </div>
    </div>
  );
}

function EditableInfoRow({
  label,
  value,
  icon,
  fieldName,
  truckId,
  placeholder,
  testIdPrefix,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  fieldName: string;
  truckId: number;
  placeholder?: string;
  testIdPrefix: string;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value || "");
    setIsEditing(false);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const mutation = useMutation({
    mutationFn: async (newValue: string) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { [fieldName]: newValue });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditing(false);
      toast({ title: `${label} updated` });
    },
    onError: () => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (mutation.isPending) return;
    if (editValue !== (value || "")) {
      mutation.mutate(editValue);
    } else {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value || "");
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  if (isEditing) {
    return (
      <div className="flex items-start gap-2 py-1">
        {icon && <span className="text-muted-foreground mt-2 shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm"
              placeholder={placeholder || `Enter ${label.toLowerCase()}...`}
              disabled={mutation.isPending}
              data-testid={`input-${testIdPrefix}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleSave}
              disabled={mutation.isPending}
              data-testid={`button-save-${testIdPrefix}`}
            >
              <Check className="w-3.5 h-3.5 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleCancel}
              disabled={mutation.isPending}
              data-testid={`button-cancel-${testIdPrefix}`}
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 py-1.5 group cursor-pointer rounded hover:bg-muted/50 px-1 -mx-1"
      onClick={() => setIsEditing(true)}
      data-testid={`editable-${testIdPrefix}`}
    >
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">
          {value || <span className="text-muted-foreground italic">Click to add...</span>}
        </p>
      </div>
      <Pencil className="w-3 h-3 text-muted-foreground invisible group-hover:visible mt-1 shrink-0" />
    </div>
  );
}

function BoolRow({ label, value }: { label: string; value: boolean | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value === true ? (
        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Yes</span>
      ) : value === false ? (
        <span className="text-xs text-muted-foreground">No</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

function EditableBoolRow({
  label,
  value,
  icon,
  fieldName,
  truckId,
  testIdPrefix,
}: {
  label: string;
  value: boolean | null | undefined;
  icon?: React.ReactNode;
  fieldName: string;
  truckId: number;
  testIdPrefix: string;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { [fieldName]: newValue });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditing(false);
      toast({ title: `${label} updated` });
    },
    onError: () => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, variant: "destructive" });
    },
  });

  if (isEditing) {
    return (
      <div className="flex items-start gap-2 py-1">
        {icon && <span className="text-muted-foreground mt-2 shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <Select
              defaultValue={value ? "yes" : "no"}
              onValueChange={(val) => mutation.mutate(val === "yes")}
              disabled={mutation.isPending}
            >
              <SelectTrigger className="h-7 text-sm flex-1" data-testid={`select-${testIdPrefix}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setIsEditing(false)}
              disabled={mutation.isPending}
              data-testid={`button-cancel-${testIdPrefix}`}
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 py-1.5 group cursor-pointer rounded hover:bg-muted/50 px-1 -mx-1"
      onClick={() => setIsEditing(true)}
      data-testid={`editable-${testIdPrefix}`}
    >
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">
          {value ? (
            <span className="font-semibold text-green-600 dark:text-green-400">Yes</span>
          ) : (
            <span>No</span>
          )}
        </p>
      </div>
      <Pencil className="w-3 h-3 text-muted-foreground invisible group-hover:visible mt-1 shrink-0" />
    </div>
  );
}

export function TruckDetailPanel({ truckId, open, onOpenChange }: TruckDetailPanelProps) {
  const { toast } = useToast();
  const [commentValue, setCommentValue] = useState("");
  const [isEditingComment, setIsEditingComment] = useState(false);

  const { data: truck, isLoading: truckLoading } = useQuery<Truck & { techAddress?: string }>({
    queryKey: ["/api/fs/trucks", truckId],
    enabled: !!truckId && open,
  });

  const { data: actions, isLoading: actionsLoading } = useQuery<Action[]>({
    queryKey: ["/api/fs/trucks", truckId, "actions"],
    enabled: !!truckId && open,
  });

  const { data: scraperStatusMap } = useQuery<Record<string, { status: string; lastScraped: string; location: string; primaryIssue: string; priority: string; repairVendorPhone: string; repairVendorAddress: string; recommendation: string }>>({
    queryKey: ["/api/fs/trucks/scraper-status"],
    queryFn: async () => {
      try {
        const directRes = await fetch("https://web-scraper-tool-seanchen37.replit.app/api/public/vehicles", {
          signal: AbortSignal.timeout(15000),
        });
        if (directRes.ok) {
          const result = await directRes.json();
          const vehicles = result.vehicles || [];
          const vehicleMap: Record<string, any> = {};
          for (const v of vehicles) {
            const num = (v.vehicle_number || '').toString().padStart(6, '0');
            vehicleMap[num] = {
              status: v.status || '',
              lastScraped: v.last_scraped || '',
              location: v.location || '',
              primaryIssue: v.primary_issue || '',
              priority: v.priority || '',
              repairVendorPhone: v.repair_vendor?.phone || '',
              repairVendorAddress: v.repair_vendor?.address || '',
              recommendation: v.recommendation || '',
            };
          }
          return vehicleMap;
        }
      } catch (e) {
        console.log("[Scraper] Direct fetch failed, falling back to server proxy");
      }
      const res = await fetch("/api/fs/trucks/scraper-status");
      if (!res.ok) throw new Error("Failed to fetch scraper status");
      return res.json();
    },
    enabled: !!truckId && open,
  });

  const { data: allVehiclesData } = useQuery<{ vehicles: Array<{ vehicleNumber: string; vin: string; licensePlate: string | null }> }>({
    queryKey: ["/api/fs/all-vehicles"],
    enabled: !!truckId && open,
  });

  const vehicleInfo = (() => {
    if (!truck || !allVehiclesData?.vehicles) return null;
    const truckNum = (truck.truckNumber || '').toString().padStart(6, '0');
    return allVehiclesData.vehicles.find(v => v.vehicleNumber === truckNum) || null;
  })();

  const samsaraVehicleName = truck ? (truck.truckNumber || '').toString().replace(/^0+/, '') : '';
  const { data: samsaraData, isLoading: samsaraLoading } = useQuery<any>({
    queryKey: ['/api/samsara/vehicle', samsaraVehicleName],
    enabled: !!samsaraVehicleName && open,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (truck) {
      setCommentValue(truck.comments || "");
      setIsEditingComment(false);
    }
  }, [truck?.id, truck?.comments]);

  const commentMutation = useMutation({
    mutationFn: async (comments: string) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { comments });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditingComment(false);
      toast({ title: "Comments saved" });
    },
    onError: () => {
      toast({ title: "Failed to save comments", variant: "destructive" });
    },
  });

  const owner = truck ? determineOwner(truck) : "Oscar S";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 flex flex-col sm:max-w-xl" data-testid="panel-truck-detail">
        {truckLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !truck ? (
          <div className="p-6 text-center text-muted-foreground">
            Truck not found
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
              <div className="flex items-center justify-between gap-2 pr-6">
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex items-center gap-2" data-testid="panel-truck-title">
                    Truck <span className="font-mono">{truck.truckNumber}</span>
                  </SheetTitle>
                  {truck.truckNumber && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-raw-pos"
                      onClick={() => {
                        const num = (truck.truckNumber || '').toString().replace(/^0+/, '');
                        window.open(`/fleet-scope/raw-pos/${num}`, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5" />
                      Raw POs
                    </Button>
                  )}
                </div>
                <Link href={`/fleet-scope/trucks/${truck.id}?from=dashboard`}>
                  <Button variant="outline" size="sm" data-testid="button-open-full-detail">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Full Details
                  </Button>
                </Link>
              </div>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <StatusBadge
                  status={truck.mainStatus || "Confirming Status"}
                  mainStatus={truck.mainStatus}
                  subStatus={truck.subStatus}
                />
                <Badge variant="secondary" className={`text-xs ${ownerColors[owner]}`}>
                  {owner}
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 overflow-auto">
              <div className="px-6 py-4 space-y-5">
                {(() => {
                  const tNum = (truck.truckNumber || '').toString().padStart(6, '0');
                  const scraperInfo = scraperStatusMap?.[tNum];
                  const fullAddress = scraperInfo?.repairVendorAddress || '';
                  return (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <Wrench className="w-4 h-4 text-muted-foreground" />
                        Repair Information
                      </h3>
                      <div className="rounded-md border p-3 space-y-0.5">
                        <div className="grid grid-cols-2 gap-x-4">
                          <EditableInfoRow
                            label="Repair Shop"
                            value={truck.repairAddress}
                            icon={<MapPin className="w-3.5 h-3.5" />}
                            fieldName="repairAddress"
                            truckId={truck.id}
                            placeholder="Enter repair shop name or address..."
                            testIdPrefix="panel-repair-shop"
                          />
                          <EditableInfoRow
                            label="Phone"
                            value={truck.repairPhone}
                            icon={<Phone className="w-3.5 h-3.5" />}
                            fieldName="repairPhone"
                            truckId={truck.id}
                            placeholder="Enter phone number..."
                            testIdPrefix="panel-repair-phone"
                          />
                        </div>
                        {fullAddress && (
                          <InfoRow label="Vendor Address" value={fullAddress} icon={<MapPin className="w-3.5 h-3.5" />} testId="panel-vendor-address" />
                        )}
                        {samsaraData?.REVERSE_GEO_FULL && (
                          <InfoRow label="Samsara Location" value={samsaraData.REVERSE_GEO_FULL} icon={<Navigation className="w-3.5 h-3.5" />} testId="panel-samsara-location" />
                        )}
                        {samsaraData?.TIME && (
                          <InfoRow label="Last Samsara Signal" value={format(new Date(samsaraData.TIME), "MMM d, yyyy h:mm a")} icon={<Clock className="w-3.5 h-3.5" />} testId="panel-samsara-signal" />
                        )}
                        <EditableInfoRow
                          label="Contact"
                          value={truck.contactName}
                          icon={<User className="w-3.5 h-3.5" />}
                          fieldName="contactName"
                          truckId={truck.id}
                          placeholder="Enter contact name..."
                          testIdPrefix="panel-contact-name"
                        />
                        <InfoRow label="Date In Repair" value={truck.datePutInRepair} icon={<Calendar className="w-3.5 h-3.5" />} />
                        <InfoRow label="Decision" value={truck.repairOrSaleDecision} icon={<FileText className="w-3.5 h-3.5" />} />
                        {truck.confirmedDeclinedRepair && (
                          <InfoRow label="Declined Repair Notes" value={truck.confirmedDeclinedRepair} icon={<FileText className="w-3.5 h-3.5" />} />
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <PhoneCall className="w-4 h-4 text-muted-foreground" />
                    Latest Shop Call
                  </h3>
                  <div className="rounded-md border p-3 space-y-1.5">
                    {truck.lastCallDate ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(truck.lastCallDate), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        {truck.lastCallSummary ? (
                          <p className="text-sm leading-relaxed" data-testid="panel-call-summary">
                            {truck.lastCallSummary}
                          </p>
                        ) : (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span className="text-sm italic">Analyzing call...</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground italic" data-testid="panel-call-none">
                        No calls recorded yet
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <PhoneForwarded className="w-4 h-4 text-muted-foreground" />
                    Latest Tech Call
                  </h3>
                  <div className="rounded-md border p-3 space-y-1.5">
                    {truck.lastTechCallDate ? (
                      <>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(truck.lastTechCallDate), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        {truck.lastTechCallSummary ? (
                          <p className="text-sm leading-relaxed" data-testid="panel-tech-call-summary">
                            {truck.lastTechCallSummary}
                          </p>
                        ) : (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span className="text-sm italic">Analyzing call...</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground italic" data-testid="panel-tech-call-none">
                        No tech calls recorded yet
                      </p>
                    )}
                  </div>
                </div>

                {(() => {
                  const truckNum = (truck.truckNumber || '').toString().padStart(6, '0');
                  const scraperData = scraperStatusMap?.[truckNum];
                  if (!scraperData?.recommendation) return null;
                  return (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                        <Lightbulb className="w-4 h-4 text-muted-foreground" />
                        AI Recommendation
                      </h3>
                      <div className="rounded-md border p-3">
                        <p className="text-sm text-muted-foreground leading-relaxed" data-testid="panel-ai-recommendation">
                          {scraperData.recommendation}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Car className="w-4 h-4 text-muted-foreground" />
                    Vehicle Information
                  </h3>
                  <div className="rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-x-4">
                      <InfoRow label="VIN" value={vehicleInfo?.vin || "N/A"} icon={<FileText className="w-3.5 h-3.5" />} testId="panel-vehicle-vin" />
                      <InfoRow label="License Plate" value={vehicleInfo?.licensePlate || "N/A"} icon={<Car className="w-3.5 h-3.5" />} testId="panel-vehicle-plate" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Wifi className="w-4 h-4 text-muted-foreground" />
                    Samsara Telematics
                  </h3>
                  <div className="rounded-md border p-3">
                    {samsaraLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading GPS data...
                      </div>
                    ) : samsaraData?.LAT !== undefined ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                        <InfoRow label="GPS Location" value={
                          samsaraData.LAT && samsaraData.LNG
                            ? `${Number(samsaraData.LAT).toFixed(4)}, ${Number(samsaraData.LNG).toFixed(4)}`
                            : "N/A"
                        } icon={<Navigation className="w-3.5 h-3.5" />} />
                        <InfoRow label="Address" value={
                          samsaraData.REVERSE_GEO_FULL || "N/A"
                        } icon={<MapPin className="w-3.5 h-3.5" />} />
                        <InfoRow label="Speed" value={
                          samsaraData.SPEED_MPH !== null && samsaraData.SPEED_MPH !== undefined ? `${samsaraData.SPEED_MPH} mph` : "N/A"
                        } icon={<Gauge className="w-3.5 h-3.5" />} />
                        <InfoRow label="Last Updated" value={
                          samsaraData.TIME ? format(new Date(samsaraData.TIME), 'MMM d, h:mm a') : "N/A"
                        } icon={<Clock className="w-3.5 h-3.5" />} />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No Samsara GPS data available</p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-muted-foreground" />
                    Tech Information
                  </h3>
                  <div className="rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <InfoRow label="Tech Name" value={truck.techName} icon={<User className="w-3.5 h-3.5" />} />
                      <InfoRow label="Tech Phone" value={truck.techPhone} icon={<Phone className="w-3.5 h-3.5" />} />
                      {truck.techAddress && (
                        <div className="col-span-2">
                          <InfoRow label="Tech Address" value={truck.techAddress} icon={<MapPin className="w-3.5 h-3.5" />} testId="panel-tech-address" />
                        </div>
                      )}
                      <InfoRow label="Tech Lead" value={truck.techLeadName} icon={<User className="w-3.5 h-3.5" />} />
                      <InfoRow label="Tech Lead Phone" value={truck.techLeadPhone} icon={<Phone className="w-3.5 h-3.5" />} />
                      {truck.techState && (
                        <InfoRow label="State" value={truck.techState} icon={<MapPin className="w-3.5 h-3.5" />} />
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    Pickup Information
                  </h3>
                  <div className="rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <EditableBoolRow
                        label="Pick Up Slot Booked"
                        value={truck.pickUpSlotBooked}
                        icon={<CheckCircle className="w-3.5 h-3.5" />}
                        fieldName="pickUpSlotBooked"
                        truckId={truck.id}
                        testIdPrefix="panel-pickup-slot"
                      />
                      <EditableInfoRow
                        label="Scheduled Pickup Time"
                        value={truck.timeBlockedToPickUpVan}
                        icon={<Clock className="w-3.5 h-3.5" />}
                        fieldName="timeBlockedToPickUpVan"
                        truckId={truck.id}
                        placeholder="e.g., 11/28/2025 2:00 PM"
                        testIdPrefix="panel-pickup-time"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    Comments
                  </h3>
                  <div className="rounded-md border p-3">
                    {isEditingComment ? (
                      <div className="space-y-2">
                        <Textarea
                          value={commentValue}
                          onChange={(e) => setCommentValue(e.target.value)}
                          className="text-sm min-h-[80px] resize-y"
                          data-testid="textarea-panel-comments"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => {
                            setCommentValue(truck.comments || "");
                            setIsEditingComment(false);
                          }} data-testid="button-cancel-comment">
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => commentMutation.mutate(commentValue)} disabled={commentMutation.isPending} data-testid="button-save-comment">
                            {commentMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="text-sm whitespace-pre-wrap cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[32px]"
                        onClick={() => setIsEditingComment(true)}
                        data-testid="text-panel-comments"
                      >
                        {truck.comments || <span className="text-muted-foreground italic">Click to add comments...</span>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Last updated: {truck.lastUpdatedAt ? format(new Date(truck.lastUpdatedAt), "MMM d, yyyy h:mm a") : "—"} by {truck.lastUpdatedBy || "System"}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    Action History
                  </h3>
                  <div className="rounded-md border p-3">
                    {actionsLoading ? (
                      <div className="space-y-3">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (
                      <ActionTimeline actions={actions || []} />
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
