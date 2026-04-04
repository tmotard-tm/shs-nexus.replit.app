import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, CheckCircle2, Circle, AlertTriangle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

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
  return new Date().toISOString().slice(0, 10);
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

function QueueRow({ item, done, onToggleDone }: { item: QueueItem; done: boolean; onToggleDone: (id: string) => void }) {
  return (
    <div className={cn(
      "flex items-start gap-3 px-4 py-3 transition-all duration-200",
      "border-b border-border last:border-0",
      done && "opacity-40"
    )}>
      <div className="flex-shrink-0 pt-0.5">
        <span className={cn("inline-flex items-center justify-center rounded-full text-xs font-bold w-6 h-6 border", STEP_COLORS[item.step])}>
          {item.step}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={cn("font-mono text-sm font-semibold", done && "line-through")}>{item.truckNumber}</span>
          {item.techName && <span className="text-sm text-muted-foreground">{item.techName}</span>}
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

      <div className="flex-shrink-0 self-start pt-0.5">
        <Button
          size="sm"
          variant={done ? "secondary" : "outline"}
          className={cn("h-7 px-2.5 text-xs gap-1.5", done && "text-green-700 dark:text-green-400")}
          onClick={() => onToggleDone(item.truckId)}
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {done ? "Done" : "Done"}
        </Button>
      </div>
    </div>
  );
}

export default function TodaysQueue() {
  const [doneSet, setDoneSet] = useState<Set<string>>(() => loadDoneSet());
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const [noActionExpanded, setNoActionExpanded] = useState(false);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<QueueResponse>({
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

  useEffect(() => {
    setDoneSet(loadDoneSet());
  }, []);

  const items = data?.items ?? [];
  const noAction = data?.noAction ?? [];

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
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between gap-4">
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
        ) : items.length === 0 && noAction.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No vehicles in the system yet.
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
                      <div key={item.truckId} className="flex items-center gap-3 px-4 py-2 border-b border-border last:border-0 opacity-60">
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
    </div>
  );
}
