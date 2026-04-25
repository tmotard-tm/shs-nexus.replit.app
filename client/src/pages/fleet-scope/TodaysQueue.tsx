import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, Circle, AlertTriangle, ChevronDown, ChevronRight, Clock, Phone, Loader2, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UniversalVehiclePanel } from "@/components/vehicle/UniversalVehiclePanel";

interface QueueItem {
  step: number;
  stepTitle: string;
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  holmanStatus: string | null;
  lucaStatus: string | null;
  lastCallDate: string | null;
  actionText: string;
  sortKey: number;
  isConflict?: boolean;
  suggestions?: Array<{ vehicleNumber: string; status: string; address: string; distanceMiles: number | null; mileage: number | null }>;
  repairPhone: string | null;
  techState: string | null;
  readyReason?: 'luca' | 'holman' | 'date';
}

interface NoActionItem {
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  holmanStatus: string | null;
}

interface QueueResponse {
  success: boolean;
  items: QueueItem[];
  noAction: NoActionItem[];
  generatedAt: string;
}

const STATE_TO_REGION: Record<string, string> = {
  VA: "East Coast & Southeast", FL: "East Coast & Southeast", NY: "East Coast & Southeast",
  GA: "East Coast & Southeast", MD: "East Coast & Southeast", NC: "East Coast & Southeast",
  PA: "East Coast & Southeast", MA: "East Coast & Southeast", CT: "East Coast & Southeast",
  DE: "East Coast & Southeast", RI: "East Coast & Southeast", NJ: "East Coast & Southeast",
  WV: "East Coast & Southeast", ME: "East Coast & Southeast", SC: "East Coast & Southeast",
  TX: "Central & Midwest", IL: "Central & Midwest", OH: "Central & Midwest",
  KY: "Central & Midwest", IN: "Central & Midwest", MI: "Central & Midwest",
  MO: "Central & Midwest", TN: "Central & Midwest", WI: "Central & Midwest",
  IA: "Central & Midwest", KS: "Central & Midwest", OK: "Central & Midwest",
  ND: "Central & Midwest", NE: "Central & Midwest", MN: "Central & Midwest",
  CA: "West Coast & Deep South", AL: "West Coast & Deep South", AR: "West Coast & Deep South",
  CO: "West Coast & Deep South", MS: "West Coast & Deep South", WA: "West Coast & Deep South",
  AZ: "West Coast & Deep South", ID: "West Coast & Deep South", LA: "West Coast & Deep South",
  OR: "West Coast & Deep South", UT: "West Coast & Deep South", HI: "West Coast & Deep South",
};

const REGION_OPTIONS = ["East Coast & Southeast", "Central & Midwest", "West Coast & Deep South"];

const REGION_COLORS: Record<string, { active: string; inactive: string }> = {
  "East Coast & Southeast": {
    active: "bg-blue-500 text-white border-blue-500",
    inactive: "border-blue-300 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
  },
  "Central & Midwest": {
    active: "bg-amber-500 text-white border-amber-500",
    inactive: "border-amber-300 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20",
  },
  "West Coast & Deep South": {
    active: "bg-emerald-500 text-white border-emerald-500",
    inactive: "border-emerald-300 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
  },
};

const STEP_COLORS: Record<number, string> = {
  1: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
  2: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  4: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300",
  5: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
  6: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300",
  7: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300",
};

const STEP_HEADER_COLORS: Record<number, string> = {
  1: "border-l-4 border-l-orange-400",
  2: "border-l-4 border-l-blue-400",
  3: "border-l-4 border-l-green-400",
  4: "border-l-4 border-l-red-400",
  5: "border-l-4 border-l-purple-400",
  6: "border-l-4 border-l-yellow-400",
  7: "border-l-4 border-l-rose-400",
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDoneKey(): string {
  return `fs-queue-done-${todayKey()}`;
}

function loadDoneSet(): Set<string> {
  try {
    const raw = localStorage.getItem(getDoneKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDoneSet(ids: Set<string>) {
  try {
    localStorage.setItem(getDoneKey(), JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

function StatusPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="text-xs font-medium">{value}</span>
    </span>
  );
}

function LucaStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    status === "Ready" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" :
    status === "No Answer" || status === "Call Failed" || status === "Failed" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" :
    status === "In Repair" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" :
    status === "In Authorization" || status === "Parts Ordered" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" :
    "bg-muted text-muted-foreground";
  return <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded", color)}>{status}</span>;
}

function QueueRow({
  item,
  done,
  onToggleDone,
  callingId,
  onCallShop,
  onRowClick,
}: {
  item: QueueItem;
  done: boolean;
  onToggleDone: (id: string) => void;
  callingId: string | null;
  onCallShop: (id: string) => void;
  onRowClick: (id: string) => void;
}) {
  const isCalling = callingId === item.truckId;
  const showCallButton = item.step === 5 && !!item.repairPhone;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-all duration-200 cursor-pointer",
        "border-b border-border last:border-0",
        "hover:bg-muted/30",
        done && "opacity-40"
      )}
      onClick={() => onRowClick(item.truckId)}
    >
      <div className="flex-shrink-0 pt-0.5">
        <span className={cn("inline-flex items-center justify-center rounded-full text-xs font-bold w-6 h-6 border", STEP_COLORS[item.step])}>
          {item.step}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={cn("font-mono text-sm font-semibold", done && "line-through")}>{item.truckNumber}</span>
          {item.techName && <span className="text-sm text-muted-foreground">{item.techName}</span>}
          {item.techState && (
            <span className="text-xs font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{item.techState}</span>
          )}
          <StatusPill label="FS" value={item.fleetScopeStatus} />
          <StatusPill label="Holman" value={item.holmanStatus} />
          <LucaStatusBadge status={item.lucaStatus} />
        </div>

        <div className={cn(
          "text-sm flex items-start gap-1.5",
          item.isConflict ? "text-red-600 dark:text-red-400 font-medium" : "text-foreground",
          done && "line-through text-muted-foreground"
        )}>
          {item.isConflict && <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
          <span>→ {item.actionText}</span>
        </div>

        {item.step === 3 && item.readyReason === 'luca' && !item.isConflict && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
            <Bot className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-400">LucaAI confirmed READY via phone call</span>
          </div>
        )}

        {item.step === 7 && (
          <div className="mt-1.5 space-y-0.5">
            {item.suggestions && item.suggestions.length > 0 ? (
              item.suggestions.map((s, i) => (
                <div key={i} className="text-xs text-muted-foreground pl-4">
                  → Unit {s.vehicleNumber}
                  {s.distanceMiles !== null && <span className="mx-1">·</span>}
                  {s.distanceMiles !== null && <span className="font-medium">{s.distanceMiles} mi away</span>}
                  {s.mileage !== null && <span className="mx-1">·</span>}
                  {s.mileage !== null && <span>{s.mileage.toLocaleString()} mi on odometer</span>}
                  {s.status && <span className="mx-1">·</span>}
                  {s.status && <span>{s.status}</span>}
                  {s.address && <span className="mx-1">·</span>}
                  {s.address && <span>{s.address}</span>}
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground pl-4 italic">No suggested replacements available — manual search required.</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 self-start pt-0.5 flex items-center gap-1.5">
        {showCallButton && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs gap-1.5 text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-700 dark:hover:bg-purple-900/20"
            onClick={(e) => { e.stopPropagation(); onCallShop(item.truckId); }}
            disabled={isCalling || !!callingId}
            title="Call repair shop via LucaAI"
          >
            {isCalling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
            {isCalling ? "Calling…" : "Call Shop"}
          </Button>
        )}
        <Button
          size="sm"
          variant={done ? "secondary" : "outline"}
          className={cn("h-7 px-2.5 text-xs gap-1.5", done && "text-green-700 dark:text-green-400")}
          onClick={(e) => { e.stopPropagation(); onToggleDone(item.truckId); }}
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {done ? "Done" : "Mark Done"}
        </Button>
      </div>
    </div>
  );
}

export default function TodaysQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [doneSet, setDoneSet] = useState<Set<string>>(() => loadDoneSet());
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const [noActionExpanded, setNoActionExpanded] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [callingId, setCallingId] = useState<string | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/fs/queue/today"],
    staleTime: 2 * 60 * 1000,
  });

  const toggleDone = useCallback((truckId: string) => {
    setDoneSet(prev => {
      const next = new Set(prev);
      if (next.has(truckId)) next.delete(truckId);
      else next.add(truckId);
      saveDoneSet(next);
      return next;
    });
  }, []);

  const toggleStep = useCallback((step: number) => {
    setCollapsedSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }, []);

  const toggleRegion = useCallback((region: string) => {
    setSelectedRegions(prev => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }, []);

  const handleCallShop = useCallback(async (truckId: string) => {
    setCallingId(truckId);
    try {
      await apiRequest("POST", `/api/fs/trucks/${truckId}/call-repair-shop`, {});
      toast({
        title: "Call initiated",
        description: "The repair shop is being called now.",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/fs/queue/today"] });
    } catch (error: unknown) {
      toast({
        title: "Failed to start call",
        description: error instanceof Error ? error.message : "Could not initiate call to repair shop.",
        variant: "destructive",
      });
    } finally {
      setCallingId(null);
    }
  }, [toast, queryClient]);

  const handleRowClick = useCallback((truckId: string) => {
    setSelectedTruckId(truckId);
    setDetailPanelOpen(true);
  }, []);

  useEffect(() => {
    setDoneSet(loadDoneSet());
  }, []);

  const allItems = data?.items ?? [];
  const noAction = data?.noAction ?? [];

  const items = selectedRegions.size === 0
    ? allItems
    : allItems.filter(item => {
        if (!item.techState) return false;
        const region = STATE_TO_REGION[item.techState];
        return region ? selectedRegions.has(region) : false;
      });

  const stepGroups = items.reduce<Record<number, QueueItem[]>>((acc, item) => {
    if (!acc[item.step]) acc[item.step] = [];
    acc[item.step].push(item);
    return acc;
  }, {});

  const stepNumbers = Object.keys(stepGroups).map(Number).sort((a, b) => a - b);

  const totalActionable = items.length;
  const doneCount = items.filter(i => doneSet.has(i.truckId)).length;

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Today's Queue</h1>
            {!isLoading && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {doneCount}/{totalActionable} done
                </Badge>
                {noAction.length > 0 && (
                  <span className="text-xs text-muted-foreground">+{noAction.length} no action</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {generatedAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {generatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {REGION_OPTIONS.map(region => {
            const isActive = selectedRegions.has(region);
            const colors = REGION_COLORS[region];
            return (
              <button
                key={region}
                onClick={() => toggleRegion(region)}
                className={cn(
                  "text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
                  isActive ? colors.active : colors.inactive
                )}
              >
                {region}
              </button>
            );
          })}
          {selectedRegions.size > 0 && (
            <button
              onClick={() => setSelectedRegions(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1 underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Building queue…
          </div>
        ) : !data?.success ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Failed to load queue. Try refreshing.
          </div>
        ) : allItems.length === 0 && noAction.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No vehicles in the system yet.
          </div>
        ) : items.length === 0 && selectedRegions.size > 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
            <span>No items in the selected region{selectedRegions.size > 1 ? "s" : ""}.</span>
            <button
              onClick={() => setSelectedRegions(new Set())}
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Clear filter
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stepNumbers.map(step => {
              const group = stepGroups[step];
              const title = group[0].stepTitle;
              const collapsed = collapsedSteps.has(step);
              const groupDone = group.filter(i => doneSet.has(i.truckId)).length;
              const allDone = groupDone === group.length;

              return (
                <div key={step} className={cn("bg-background", allDone && "opacity-60")}>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors",
                      STEP_HEADER_COLORS[step]
                    )}
                    onClick={() => toggleStep(step)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={cn("inline-flex items-center justify-center rounded-full text-xs font-bold w-5 h-5 border flex-shrink-0", STEP_COLORS[step])}>
                        {step}
                      </span>
                      <span className="text-sm font-semibold tracking-wide uppercase text-foreground/80">
                        {title}
                      </span>
                      <Badge variant="outline" className="text-xs h-5 px-1.5">
                        {groupDone}/{group.length}
                      </Badge>
                    </div>
                    {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>

                  {!collapsed && (
                    <div>
                      {group.map(item => (
                        <QueueRow
                          key={item.truckId}
                          item={item}
                          done={doneSet.has(item.truckId)}
                          onToggleDone={toggleDone}
                          callingId={callingId}
                          onCallShop={handleCallShop}
                          onRowClick={handleRowClick}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {noAction.length > 0 && (
              <div className="bg-muted/20">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors border-l-4 border-l-muted-foreground/20"
                  onClick={() => setNoActionExpanded(v => !v)}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                      No action required today
                    </span>
                    <Badge variant="outline" className="text-xs h-5 px-1.5">{noAction.length}</Badge>
                  </div>
                  {noActionExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>

                {noActionExpanded && (
                  <div>
                    {noAction.map(item => (
                      <div
                        key={item.truckId}
                        className="flex items-center gap-3 px-4 py-2 border-b border-border last:border-0 opacity-60 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => handleRowClick(item.truckId)}
                      >
                        <span className="font-mono text-sm">{item.truckNumber}</span>
                        {item.techName && <span className="text-xs text-muted-foreground">{item.techName}</span>}
                        <StatusPill label="FS" value={item.fleetScopeStatus} />
                        <StatusPill label="Holman" value={item.holmanStatus} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <UniversalVehiclePanel
        vehicleId={selectedTruckId}
        open={detailPanelOpen}
        onOpenChange={(open) => setDetailPanelOpen(open)}
        fromPage="queue"
      />
    </div>
  );
}
