import { useState, useMemo, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Phone,
  PhoneCall,
  Loader2,
  Search,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  PhoneOff,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Truck, CallLog, MainStatus } from "@shared/fleet-scope-schema";
import { MAIN_STATUSES } from "@shared/fleet-scope-schema";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";

const mainStatusColors: Record<string, string> = {
  "Confirming Status": "bg-status-amber text-status-amber-fg",
  "Decision Pending": "bg-status-red text-status-red-fg",
  "Repairing": "bg-status-amber text-status-amber-fg",
  "Declined Repair": "bg-status-red text-status-red-fg",
  "Approved for sale": "bg-status-amber text-status-amber-fg",
  "Tags": "bg-status-amber text-status-amber-fg",
  "Scheduling": "bg-status-green text-status-green-fg",
  "PMF": "bg-status-amber text-status-amber-fg",
  "In Transit": "bg-status-green text-status-green-fg",
  "On Road": "bg-status-green text-status-green-fg",
  "Needs truck assigned": "bg-status-amber text-status-amber-fg",
  "Available to be assigned": "bg-status-green text-status-green-fg",
  "Relocate Van": "bg-status-amber text-status-amber-fg",
  "NLWC - Return Rental": "bg-status-red text-status-red-fg",
  "Truck Swap": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
};

// ---- Sorting primitives (shared by all three tables) ----
type SortDir = "asc" | "desc";
type SortState = { field: string; dir: SortDir };

// Cycle the sort for a table: a new field starts ascending; the active field toggles.
function makeSortHandler(setSort: React.Dispatch<React.SetStateAction<SortState>>) {
  return (field: string) =>
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
}

// Generic, stable sort. Accessor returns a comparable primitive (date columns
// return epoch ms). null / undefined / "" always sort to the BOTTOM regardless
// of direction. Numbers compare numerically; everything else is a
// case-insensitive string compare.
function sortRows<T>(
  rows: T[],
  field: string,
  dir: SortDir,
  accessor: (row: T, field: string) => string | number | null | undefined
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a, field);
    const bv = accessor(b, field);
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1; // nulls to bottom regardless of direction
    if (bEmpty) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    }
    return cmp * factor;
  });
}

// A shadcn TableHead that is clickable and shows a sort indicator.
function SortableHead({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string;
  field: string;
  sort: SortState;
  onSort: (field: string) => void;
  className?: string;
}) {
  const active = sort.field === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 cursor-pointer select-none hover:text-foreground transition-colors -my-1 py-1"
        aria-label={`Sort by ${label}`}
        data-testid={`sort-${field}`}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-30" />
        )}
      </button>
    </TableHead>
  );
}

// A multi-select filter popover matching the Select & Call status-filter styling.
function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  onClear,
  renderOption,
  testidPrefix,
  width = "w-[170px]",
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  renderOption: (v: string) => ReactNode;
  testidPrefix: string;
  width?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`${width} justify-between`} data-testid={`button-${testidPrefix}-filter`}>
          <span className="flex items-center gap-1.5 truncate">
            <Filter className="h-3.5 w-3.5 shrink-0" />
            {selected.size === 0 ? label : `${selected.size} selected`}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-2" align="start">
        <div className="flex flex-col gap-0.5 max-h-[280px] overflow-auto">
          {options.length === 0 ? (
            <span className="px-2 py-1.5 text-xs text-muted-foreground">No options</span>
          ) : (
            options.map((o) => (
              <label
                key={o}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer text-sm"
                data-testid={`${testidPrefix}-option-${o}`}
              >
                <Checkbox checked={selected.has(o)} onCheckedChange={() => onToggle(o)} />
                {renderOption(o)}
              </label>
            ))
          )}
          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full text-xs"
              onClick={onClear}
              data-testid={`button-clear-${testidPrefix}`}
            >
              Clear All
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Toggle a value inside a Set stored in React state.
function toggleInSet(setState: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
  setState((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

// Sort accessors for the CallLog-backed tables (Follow-Ups & Call History).
function followUpSortValue(log: CallLog, field: string): string | number | null | undefined {
  switch (field) {
    case "truckNumber":
      return log.truckNumber;
    case "callType":
      return log.callType;
    case "outcome":
      return log.outcome;
    case "nextFollowUpDate": {
      if (!log.nextFollowUpDate) return null;
      const t = Date.parse(log.nextFollowUpDate);
      return Number.isNaN(t) ? log.nextFollowUpDate : t;
    }
    case "shopNotes":
      return log.shopNotes;
    default:
      return null;
  }
}

function historySortValue(log: CallLog, field: string): string | number | null | undefined {
  switch (field) {
    case "callTimestamp":
      return log.callTimestamp ? new Date(log.callTimestamp).getTime() : null;
    case "truckNumber":
      return log.truckNumber;
    case "callType":
      return log.callType;
    case "phoneNumber":
      return log.phoneNumber;
    case "status":
      return log.status;
    case "outcome":
      return log.outcome;
    case "shopNotes":
      return log.shopNotes;
    default:
      return null;
  }
}

// Format a stored transcript (raw text, or a JSON array of conversation turns)
// into readable "ROLE: message" lines. Falls back to the raw string.
function buildTranscriptText(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const lines = parsed
        .map((turn: any) => {
          const role = turn?.role ?? turn?.speaker ?? turn?.from ?? "";
          const text = turn?.message ?? turn?.text ?? turn?.content ?? "";
          const body = typeof text === "string" ? text : JSON.stringify(text);
          const who = role ? `${String(role).toUpperCase()}: ` : "";
          return `${who}${body}`.trim();
        })
        .filter((l) => l.length > 0);
      if (lines.length > 0) return lines.join("\n");
    }
  } catch {
    // Not JSON — treat as plain text.
  }
  return trimmed;
}

// Expandable detail panel for a CallLog row: full summary, ready date, blockers,
// and an on-demand transcript. Rendered inside a full-width table cell.
function CallSummaryDetail({ log }: { log: CallLog }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const transcript = buildTranscriptText(log.transcript);
  const summary = log.shopNotes?.trim();
  return (
    <div className="flex flex-col gap-3 py-1" data-testid={`detail-log-${log.id}`}>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Call Summary</div>
        <div className="text-sm whitespace-pre-wrap" data-testid={`text-summary-${log.id}`}>
          {summary ? (
            summary
          ) : (
            <span className="italic text-muted-foreground">No summary captured</span>
          )}
        </div>
      </div>
      {(log.estimatedReadyDate || log.blockers) && (
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {log.estimatedReadyDate && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Estimated Ready Date</div>
              <div className="text-sm">{log.estimatedReadyDate}</div>
            </div>
          )}
          {log.blockers && (
            <div className="min-w-[200px]">
              <div className="text-xs font-medium text-muted-foreground">Blockers</div>
              <div className="text-sm whitespace-pre-wrap">{log.blockers}</div>
            </div>
          )}
        </div>
      )}
      {transcript && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowTranscript((v) => !v)}
            data-testid={`button-transcript-${log.id}`}
          >
            {showTranscript ? (
              <ChevronDown className="h-3.5 w-3.5 mr-1" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 mr-1" />
            )}
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </Button>
          {showTranscript && (
            <div
              className="mt-2 max-h-[300px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed"
              data-testid={`text-transcript-${log.id}`}
            >
              {transcript}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Expandable detail panel for a Truck's last call (Select & Call table).
function TruckSummaryDetail({
  summary,
  status,
}: {
  summary: string | null;
  status: string | null;
}) {
  const text = summary?.trim();
  return (
    <div className="flex flex-col gap-2 py-1">
      {status && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Last Call Status: </span>
          <span className="text-sm">{status}</span>
        </div>
      )}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Last Call Summary</div>
        <div className="text-sm whitespace-pre-wrap">
          {text ? (
            text
          ) : (
            <span className="italic text-muted-foreground">No summary captured</span>
          )}
        </div>
      </div>
    </div>
  );
}

type BatchResult = {
  truckId: string;
  truckNumber: string;
  status: string;
  conversationId?: string;
  error?: string;
};

type BatchStatus = {
  id: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  inProgress: number;
  cancelled: boolean;
  results: BatchResult[];
  done: boolean;
};

export default function BatchCaller() {
  const { toast } = useToast();
  const [callType, setCallType] = useState<"shop" | "tech">("shop");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const cancelRef = useRef(false);

  // Per-table sort state.
  const [callSort, setCallSort] = useState<SortState>({ field: "truckNumber", dir: "asc" });
  const [followSort, setFollowSort] = useState<SortState>({ field: "nextFollowUpDate", dir: "asc" });
  const [historySort, setHistorySort] = useState<SortState>({ field: "callTimestamp", dir: "desc" });
  const onCallSort = useMemo(() => makeSortHandler(setCallSort), []);
  const onFollowSort = useMemo(() => makeSortHandler(setFollowSort), []);
  const onHistorySort = useMemo(() => makeSortHandler(setHistorySort), []);

  // Follow-Ups filters.
  const [followOutcomeFilter, setFollowOutcomeFilter] = useState<Set<string>>(new Set());
  const [followTypeFilter, setFollowTypeFilter] = useState<Set<string>>(new Set());
  const [followSearch, setFollowSearch] = useState("");

  // Call History filters.
  const [historyOutcomeFilter, setHistoryOutcomeFilter] = useState<Set<string>>(new Set());
  const [historyStatusFilter, setHistoryStatusFilter] = useState<Set<string>>(new Set());
  const [historyTypeFilter, setHistoryTypeFilter] = useState<Set<string>>(new Set());
  const [historySearch, setHistorySearch] = useState("");

  // Select & Call last-outcome filter (mirrors the mainStatus filter).
  const [callOutcomeFilter, setCallOutcomeFilter] = useState<Set<string>>(new Set());

  // Expanded-row tracking, keyed by ROW ID (never index) so sorting/filtering
  // re-orders don't move which row is open. CallLog ids are numeric -> String().
  const [expandedFollowUps, setExpandedFollowUps] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set());

  const { data: trucks = [], isLoading: trucksLoading } = useQuery<Truck[]>({
    queryKey: ["/api/fs/trucks"],
  });

  const { data: followUps = [], isLoading: followUpsLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/follow-ups"],
    refetchInterval: 60000,
  });

  const { data: recentLogs = [] } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/call-logs"],
    refetchInterval: activeBatchId ? 5000 : 30000,
  });

  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>();
    trucks.forEach((t) => {
      if (t.mainStatus) statuses.add(t.mainStatus);
    });
    return Array.from(statuses).sort();
  }, [trucks]);

  const filteredTrucks = useMemo(() => {
    let result = trucks.filter((t) => {
      const hasPhone = callType === "tech" ? t.techPhone?.trim() : t.repairPhone?.trim();
      const excluded = t.mainStatus === "Declined Repair" || t.mainStatus === "Approved for sale";
      return !!hasPhone && !excluded;
    });

    if (selectedStatuses.size > 0) {
      result = result.filter((t) => t.mainStatus && selectedStatuses.has(t.mainStatus));
    }

    if (callOutcomeFilter.size > 0) {
      result = result.filter((t) => {
        const o = callType === "shop" ? t.lastCallStatus : t.lastTechCallStatus;
        return !!o && callOutcomeFilter.has(o);
      });
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (t) =>
          t.truckNumber?.toLowerCase().includes(term) ||
          t.repairAddress?.toLowerCase().includes(term) ||
          t.techName?.toLowerCase().includes(term)
      );
    }

    return result;
  }, [trucks, selectedStatuses, callOutcomeFilter, callType, searchTerm]);

  // Sorted view of the (already-filtered) trucks. Selection logic keeps using
  // filteredTrucks; sorting only reorders what is rendered.
  const sortedTrucks = useMemo(() => {
    const accessor = (t: Truck, field: string): string | number | null | undefined => {
      switch (field) {
        case "truckNumber":
          return t.truckNumber;
        case "mainStatus":
          return t.mainStatus;
        case "name":
          return callType === "shop" ? t.repairAddress : t.techName;
        case "phone":
          return callType === "shop" ? t.repairPhone : t.techPhone;
        case "shopResult":
          return t.lastCallStatus;
        case "lastCall": {
          const d = callType === "shop" ? t.lastCallDate : t.lastTechCallDate;
          return d ? new Date(d).getTime() : null;
        }
        case "lastOutcome":
          return callType === "shop" ? t.lastCallStatus : t.lastTechCallStatus;
        default:
          return null;
      }
    };
    return sortRows(filteredTrucks, callSort.field, callSort.dir, accessor);
  }, [filteredTrucks, callSort, callType]);

  // Distinct filter options derived from the data.
  const callOutcomeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          trucks
            .map((t) => (callType === "shop" ? t.lastCallStatus : t.lastTechCallStatus))
            .filter((v): v is string => !!v)
        )
      ).sort(),
    [trucks, callType]
  );
  const followOutcomeOptions = useMemo(
    () => Array.from(new Set(followUps.map((l) => l.outcome).filter((v): v is string => !!v))).sort(),
    [followUps]
  );
  const followTypeOptions = useMemo(
    () => Array.from(new Set(followUps.map((l) => l.callType).filter((v): v is string => !!v))).sort(),
    [followUps]
  );
  const historyOutcomeOptions = useMemo(
    () => Array.from(new Set(recentLogs.map((l) => l.outcome).filter((v): v is string => !!v))).sort(),
    [recentLogs]
  );
  const historyStatusOptions = useMemo(
    () => Array.from(new Set(recentLogs.map((l) => l.status).filter((v): v is string => !!v))).sort(),
    [recentLogs]
  );
  const historyTypeOptions = useMemo(
    () => Array.from(new Set(recentLogs.map((l) => l.callType).filter((v): v is string => !!v))).sort(),
    [recentLogs]
  );

  const displayedFollowUps = useMemo(() => {
    let r = followUps;
    if (followOutcomeFilter.size > 0) r = r.filter((l) => l.outcome && followOutcomeFilter.has(l.outcome));
    if (followTypeFilter.size > 0) r = r.filter((l) => l.callType && followTypeFilter.has(l.callType));
    if (followSearch.trim()) {
      const term = followSearch.toLowerCase();
      r = r.filter((l) => l.truckNumber?.toLowerCase().includes(term));
    }
    return sortRows(r, followSort.field, followSort.dir, followUpSortValue);
  }, [followUps, followOutcomeFilter, followTypeFilter, followSearch, followSort]);

  const displayedLogs = useMemo(() => {
    let r = recentLogs;
    if (historyOutcomeFilter.size > 0) r = r.filter((l) => l.outcome && historyOutcomeFilter.has(l.outcome));
    if (historyStatusFilter.size > 0) r = r.filter((l) => l.status && historyStatusFilter.has(l.status));
    if (historyTypeFilter.size > 0) r = r.filter((l) => l.callType && historyTypeFilter.has(l.callType));
    if (historySearch.trim()) {
      const term = historySearch.toLowerCase();
      r = r.filter(
        (l) =>
          l.truckNumber?.toLowerCase().includes(term) ||
          l.phoneNumber?.toLowerCase().includes(term)
      );
    }
    return sortRows(r, historySort.field, historySort.dir, historySortValue);
  }, [recentLogs, historyOutcomeFilter, historyStatusFilter, historyTypeFilter, historySearch, historySort]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredTrucks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTrucks.map((t) => t.id)));
    }
  };

  const startBatch = async () => {
    if (selectedIds.size === 0) {
      toast({ title: "No vehicles selected", variant: "destructive" });
      return;
    }
    cancelRef.current = false;
    setIsStarting(true);
    setActiveBatchId("running");
    const ids = Array.from(selectedIds);
    const CHUNK = 15;
    const agg: BatchStatus = { id: "local", total: ids.length, completed: 0, failed: 0, skipped: 0, inProgress: 0, cancelled: false, results: [], done: false };
    setBatchStatus({ ...agg });
    try {
      for (let i = 0; i < ids.length && !cancelRef.current; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        agg.inProgress = chunk.length;
        setBatchStatus({ ...agg });
        // Each request carries at most CHUNK trucks so the server finishes and
        // responds well inside the autoscale proxy limit. Results come back
        // synchronously; there is no batch id or in-memory poll state to lose
        // across instances. The server-side 30-minute re-dial guard makes any
        // retry safe.
        const res = await apiRequest("POST", "/api/fs/batch-call/start", { truckIds: chunk, callType });
        const data = await res.json();
        for (const r of (data.results || [])) {
          agg.results.push(r);
          if (r.status === "failed") agg.failed++;
          else if (r.status === "skipped") agg.skipped++;
          else agg.completed++;
        }
        agg.inProgress = 0;
        setBatchStatus({ ...agg });
      }
      agg.cancelled = cancelRef.current;
      agg.done = true;
      setBatchStatus({ ...agg });
      const skippedNote = agg.skipped ? `, ${agg.skipped} skipped` : "";
      toast({
        title: agg.cancelled
          ? "Batch cancelled"
          : `Batch complete: ${agg.completed} called, ${agg.failed} failed${skippedNote}`,
      });
    } catch (err: any) {
      toast({ title: "Batch error", description: err.message, variant: "destructive" });
    } finally {
      setActiveBatchId(null);
      setIsStarting(false);
    }
  };

  const cancelBatch = async () => {
    cancelRef.current = true;
    toast({ title: "Cancelling: the current group will finish first" });
  };

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) return null;
    switch (outcome) {
      case "VEHICLE_READY":
        return <Badge variant="default" className="bg-green-600 text-white no-default-hover-elevate"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
      case "VEHICLE_NOT_READY":
        return <Badge variant="default" className="bg-yellow-600 text-white no-default-hover-elevate"><Clock className="w-3 h-3 mr-1" />Not Ready</Badge>;
      case "CALL_FAILED":
        return <Badge variant="default" className="bg-red-600 text-white no-default-hover-elevate"><PhoneOff className="w-3 h-3 mr-1" />Failed</Badge>;
      case "CALL_NO_CONTACT":
        return <Badge variant="default" className="bg-blue-600 text-white no-default-hover-elevate"><Phone className="w-3 h-3 mr-1" />No Answer</Badge>;
      default:
        return <Badge variant="secondary">{outcome}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Phone className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-semibold" data-testid="text-batch-caller-title">Batch Caller</h1>
      </div>

      <Tabs defaultValue="call" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="call" data-testid="tab-select-call">
            <PhoneCall className="h-3.5 w-3.5 mr-1.5" />
            Select &amp; Call
            {activeBatchId && <Loader2 className="h-3 w-3 ml-1.5 animate-spin" />}
          </TabsTrigger>
          <TabsTrigger value="followups" data-testid="tab-follow-ups">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Follow-Ups
            {followUps.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-yellow-600/15 text-yellow-700 dark:text-yellow-400">
                {followUps.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-call-history">
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
            Call History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="call" className="flex flex-col gap-4 mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">Vehicle Selection</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={callType} onValueChange={(v: string) => { setCallType(v as "shop" | "tech"); setSelectedIds(new Set()); setCallOutcomeFilter(new Set()); }}>
              <SelectTrigger className="w-[140px]" data-testid="select-call-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shop">Call Shops</SelectItem>
                <SelectItem value="tech">Call Techs</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-between" data-testid="button-status-filter">
                  <span className="flex items-center gap-1.5 truncate">
                    <Filter className="h-3.5 w-3.5 shrink-0" />
                    {selectedStatuses.size === 0
                      ? "All Statuses"
                      : `${selectedStatuses.size} status${selectedStatuses.size > 1 ? "es" : ""}`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-2" align="start">
                <div className="flex flex-col gap-0.5 max-h-[280px] overflow-auto">
                  {availableStatuses.map((s) => {
                    const colorClass = mainStatusColors[s] || "bg-muted text-muted-foreground";
                    return (
                      <label
                        key={s}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer text-sm"
                        data-testid={`filter-status-${s}`}
                      >
                        <Checkbox
                          checked={selectedStatuses.has(s)}
                          onCheckedChange={() => {
                            setSelectedStatuses((prev) => {
                              const next = new Set(prev);
                              if (next.has(s)) next.delete(s);
                              else next.add(s);
                              return next;
                            });
                          }}
                        />
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass} border-0 whitespace-nowrap`}>
                          {s}
                        </span>
                      </label>
                    );
                  })}
                  {selectedStatuses.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full text-xs"
                      onClick={() => setSelectedStatuses(new Set())}
                      data-testid="button-clear-statuses"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <MultiSelectFilter
              label="All Outcomes"
              options={callOutcomeOptions}
              selected={callOutcomeFilter}
              onToggle={(v) => toggleInSet(setCallOutcomeFilter, v)}
              onClear={() => setCallOutcomeFilter(new Set())}
              renderOption={(o) => <Badge variant="secondary" className="text-xs">{o}</Badge>}
              testidPrefix="call-outcome"
              width="w-[170px]"
            />

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[200px]"
                data-testid="input-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trucksLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTrucks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No vehicles with {callType === "shop" ? "shop" : "tech"} phone numbers found
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <span className="text-sm text-muted-foreground">
                  {filteredTrucks.length} vehicles · {selectedIds.size} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAll} data-testid="button-select-all">
                    {selectedIds.size === filteredTrucks.length ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={startBatch}
                    disabled={selectedIds.size === 0 || isStarting || !!activeBatchId}
                    data-testid="button-start-calling"
                  >
                    {isStarting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PhoneCall className="h-4 w-4 mr-1" />}
                    Start Calling ({selectedIds.size})
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-auto max-h-[max(240px,calc(100dvh-380px))]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === filteredTrucks.length && filteredTrucks.length > 0}
                          onCheckedChange={toggleAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <SortableHead label="Truck #" field="truckNumber" sort={callSort} onSort={onCallSort} />
                      <SortableHead label="Status" field="mainStatus" sort={callSort} onSort={onCallSort} />
                      <SortableHead label={callType === "shop" ? "Shop / Address" : "Tech"} field="name" sort={callSort} onSort={onCallSort} />
                      <SortableHead label="Phone" field="phone" sort={callSort} onSort={onCallSort} />
                      {callType === "tech" && <SortableHead label="Shop Call Result" field="shopResult" sort={callSort} onSort={onCallSort} />}
                      <SortableHead label="Last Call" field="lastCall" sort={callSort} onSort={onCallSort} />
                      <SortableHead label="Last Outcome" field="lastOutcome" sort={callSort} onSort={onCallSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTrucks.map((truck) => {
                      const phone = callType === "shop" ? truck.repairPhone : truck.techPhone;
                      const name = callType === "shop" ? (truck.repairAddress || "—") : truck.techName;
                      const lastStatus = callType === "shop" ? truck.lastCallStatus : truck.lastTechCallStatus;
                      const lastDate = callType === "shop" ? truck.lastCallDate : truck.lastTechCallDate;
                      const lastSummary = callType === "shop" ? truck.lastCallSummary : truck.lastTechCallSummary;
                      const truckOpen = expandedTrucks.has(truck.id);
                      const callColSpan = callType === "tech" ? 8 : 7;

                      return (
                        <Fragment key={truck.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleSelect(truck.id)}
                          data-testid={`row-truck-${truck.truckNumber}`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(truck.id)}
                              onCheckedChange={() => toggleSelect(truck.id)}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`checkbox-truck-${truck.truckNumber}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{truck.truckNumber}</TableCell>
                          <TableCell>
                            <StatusBadge status={truck.mainStatus || "Unknown"} mainStatus={truck.mainStatus} />
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{name || "—"}</TableCell>
                          <TableCell className="text-sm">{phone || "—"}</TableCell>
                          {callType === "tech" && (
                            <TableCell>
                              {truck.lastCallStatus ? (
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    truck.lastCallStatus === "Ready"
                                      ? "bg-green-600/15 text-green-700 dark:text-green-400"
                                      : truck.lastCallStatus === "Call Failed" || truck.lastCallStatus === "Failed"
                                      ? "bg-red-600/15 text-red-700 dark:text-red-400"
                                      : "bg-yellow-600/15 text-yellow-700 dark:text-yellow-400"
                                  }`}
                                >
                                  {truck.lastCallStatus}
                                </Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            {lastDate ? new Date(lastDate).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {lastStatus ? (
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    lastStatus === "Ready" || lastStatus === "Will Pick Up"
                                      ? "bg-green-600/15 text-green-700 dark:text-green-400"
                                      : lastStatus === "Call Failed" || lastStatus === "Failed"
                                      ? "bg-red-600/15 text-red-700 dark:text-red-400"
                                      : "bg-yellow-600/15 text-yellow-700 dark:text-yellow-400"
                                  }`}
                                >
                                  {lastStatus}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                              {lastSummary?.trim() && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleInSet(setExpandedTrucks, truck.id);
                                  }}
                                  className="text-muted-foreground hover:text-foreground shrink-0"
                                  aria-label={truckOpen ? "Hide last-call summary" : "Show last-call summary"}
                                  data-testid={`button-expand-truck-${truck.truckNumber}`}
                                >
                                  {truckOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {truckOpen && lastSummary?.trim() && (
                          <TableRow
                            className="bg-muted/30 hover:bg-muted/30"
                            data-testid={`row-truck-detail-${truck.truckNumber}`}
                          >
                            <TableCell colSpan={callColSpan} className="py-3">
                              <TruckSummaryDetail summary={lastSummary} status={lastStatus} />
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {(activeBatchId || batchStatus) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="h-4 w-4" />
              Batch Progress
              {activeBatchId && <Loader2 className="h-4 w-4 animate-spin" />}
            </CardTitle>
            {activeBatchId && (
              <Button variant="destructive" size="sm" onClick={cancelBatch} data-testid="button-cancel-batch">
                <XCircle className="h-4 w-4 mr-1" />Cancel
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {batchStatus && (
              <>
                <div className="flex items-center gap-4 mb-3 flex-wrap">
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium">{batchStatus.total}</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    <span>{batchStatus.completed} called</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span>{batchStatus.failed} failed</span>
                  </div>
                  {(batchStatus.skipped ?? 0) > 0 && (
                    <div className="flex items-center gap-1 text-sm">
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                      <span>{batchStatus.skipped} skipped</span>
                    </div>
                  )}
                  {batchStatus.inProgress > 0 && (
                    <div className="flex items-center gap-1 text-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{batchStatus.inProgress} in progress</span>
                    </div>
                  )}
                  {batchStatus.done && (
                    <Badge variant="secondary" className="bg-green-600/15 text-green-700 dark:text-green-400">Complete</Badge>
                  )}
                </div>

                <div className="w-full bg-muted rounded-full h-2 mb-4">
                  <div
                    className="bg-primary rounded-full h-2 transition-all"
                    style={{ width: `${((batchStatus.completed + batchStatus.failed + (batchStatus.skipped ?? 0)) / batchStatus.total) * 100}%` }}
                  />
                </div>

                {batchStatus.results.length > 0 && (
                  <div className="border rounded-md overflow-auto max-h-[250px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Truck #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {batchStatus.results.map((r, i) => (
                          <TableRow key={i} data-testid={`row-result-${r.truckNumber}`}>
                            <TableCell className="font-medium">{r.truckNumber}</TableCell>
                            <TableCell>
                              {r.status === "in_progress" ? (
                                <Badge variant="secondary" className="bg-blue-600/15 text-blue-700 dark:text-blue-400">
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />Calling
                                </Badge>
                              ) : r.status === "skipped" ? (
                                <Badge variant="secondary" className="bg-yellow-600/15 text-yellow-700 dark:text-yellow-400">
                                  <AlertTriangle className="h-3 w-3 mr-1" />Skipped
                                </Badge>
                              ) : r.status === "failed" ? (
                                <Badge variant="secondary" className="bg-red-600/15 text-red-700 dark:text-red-400">
                                  <XCircle className="h-3 w-3 mr-1" />Failed
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-green-600/15 text-green-700 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3 mr-1" />Sent
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {r.error || (r.conversationId ? `ID: ${r.conversationId.slice(0, 12)}...` : "—")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="followups" className="mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending Follow-Ups
            {followUps.length > 0 && (
              <Badge variant="secondary" className="bg-yellow-600/15 text-yellow-700 dark:text-yellow-400">
                {followUps.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <MultiSelectFilter
              label="All Outcomes"
              options={followOutcomeOptions}
              selected={followOutcomeFilter}
              onToggle={(v) => toggleInSet(setFollowOutcomeFilter, v)}
              onClear={() => setFollowOutcomeFilter(new Set())}
              renderOption={(o) => getOutcomeBadge(o) ?? <span className="text-sm">{o}</span>}
              testidPrefix="followup-outcome"
            />
            <MultiSelectFilter
              label="All Types"
              width="w-[130px]"
              options={followTypeOptions}
              selected={followTypeFilter}
              onToggle={(v) => toggleInSet(setFollowTypeFilter, v)}
              onClear={() => setFollowTypeFilter(new Set())}
              renderOption={(t) => <Badge variant="outline" className="text-xs capitalize">{t}</Badge>}
              testidPrefix="followup-type"
            />
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search truck #..."
                value={followSearch}
                onChange={(e) => setFollowSearch(e.target.value)}
                className="pl-8 w-[180px]"
                data-testid="input-followup-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {followUpsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : followUps.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No pending follow-ups
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground mb-3" data-testid="text-followup-count">
                {displayedFollowUps.length} of {followUps.length}
              </div>
              {displayedFollowUps.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No follow-ups match the current filters
                </div>
              ) : (
                <div className="border rounded-md overflow-auto max-h-[max(240px,calc(100dvh-320px))]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <SortableHead label="Truck #" field="truckNumber" sort={followSort} onSort={onFollowSort} />
                        <SortableHead label="Type" field="callType" sort={followSort} onSort={onFollowSort} />
                        <SortableHead label="Last Outcome" field="outcome" sort={followSort} onSort={onFollowSort} />
                        <SortableHead label="Follow-Up Date" field="nextFollowUpDate" sort={followSort} onSort={onFollowSort} />
                        <SortableHead label="Notes" field="shopNotes" sort={followSort} onSort={onFollowSort} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedFollowUps.map((log) => {
                        const rowId = String(log.id);
                        const isOpen = expandedFollowUps.has(rowId);
                        return (
                        <Fragment key={log.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleInSet(setExpandedFollowUps, rowId)}
                          data-testid={`row-followup-${log.truckNumber}`}
                        >
                          <TableCell className="w-8 align-top">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleInSet(setExpandedFollowUps, rowId); }}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={isOpen ? "Collapse row" : "Expand row"}
                              data-testid={`button-expand-followup-${log.id}`}
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </TableCell>
                          <TableCell className="font-medium">{log.truckNumber}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{log.callType}</Badge>
                          </TableCell>
                          <TableCell>{getOutcomeBadge(log.outcome)}</TableCell>
                          <TableCell className="text-sm">{log.nextFollowUpDate || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[300px]">
                            <span className="line-clamp-2">{log.shopNotes || "—"}</span>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30" data-testid={`row-followup-detail-${log.id}`}>
                            <TableCell colSpan={6} className="py-3">
                              <CallSummaryDetail log={log} />
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
      {recentLogs.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Recent Call Logs
              <Badge variant="secondary">{recentLogs.length}</Badge>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <MultiSelectFilter
                label="All Outcomes"
                options={historyOutcomeOptions}
                selected={historyOutcomeFilter}
                onToggle={(v) => toggleInSet(setHistoryOutcomeFilter, v)}
                onClear={() => setHistoryOutcomeFilter(new Set())}
                renderOption={(o) => getOutcomeBadge(o) ?? <span className="text-sm">{o}</span>}
                testidPrefix="history-outcome"
              />
              <MultiSelectFilter
                label="All Statuses"
                width="w-[140px]"
                options={historyStatusOptions}
                selected={historyStatusFilter}
                onToggle={(v) => toggleInSet(setHistoryStatusFilter, v)}
                onClear={() => setHistoryStatusFilter(new Set())}
                renderOption={(s) => <Badge variant="secondary" className="text-xs">{s}</Badge>}
                testidPrefix="history-status"
              />
              <MultiSelectFilter
                label="All Types"
                width="w-[130px]"
                options={historyTypeOptions}
                selected={historyTypeFilter}
                onToggle={(v) => toggleInSet(setHistoryTypeFilter, v)}
                onClear={() => setHistoryTypeFilter(new Set())}
                renderOption={(t) => <Badge variant="outline" className="text-xs capitalize">{t}</Badge>}
                testidPrefix="history-type"
              />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Truck # / phone..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="pl-8 w-[180px]"
                  data-testid="input-history-search"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-3" data-testid="text-history-count">
              {displayedLogs.length} of {recentLogs.length}
            </div>
            {displayedLogs.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No call logs match the current filters
              </div>
            ) : (
            <div className="border rounded-md overflow-auto max-h-[max(240px,calc(100dvh-320px))]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <SortableHead label="Time" field="callTimestamp" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Truck #" field="truckNumber" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Type" field="callType" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Phone" field="phoneNumber" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Status" field="status" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Outcome" field="outcome" sort={historySort} onSort={onHistorySort} />
                    <SortableHead label="Notes" field="shopNotes" sort={historySort} onSort={onHistorySort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedLogs.map((log) => {
                    const rowId = String(log.id);
                    const isOpen = expandedLogs.has(rowId);
                    return (
                    <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggleInSet(setExpandedLogs, rowId)}
                      data-testid={`row-log-${log.id}`}
                    >
                      <TableCell className="w-8 align-top">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleInSet(setExpandedLogs, rowId); }}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={isOpen ? "Collapse row" : "Expand row"}
                          data-testid={`button-expand-log-${log.id}`}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {log.callTimestamp ? new Date(log.callTimestamp).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{log.truckNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{log.callType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.phoneNumber || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            log.status === "completed"
                              ? "bg-green-600/15 text-green-700 dark:text-green-400"
                              : log.status === "failed"
                              ? "bg-red-600/15 text-red-700 dark:text-red-400"
                              : "bg-blue-600/15 text-blue-700 dark:text-blue-400"
                          }`}
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{getOutcomeBadge(log.outcome)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[250px]">
                        <span className="line-clamp-2">{log.shopNotes || "—"}</span>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30" data-testid={`row-log-detail-${log.id}`}>
                        <TableCell colSpan={8} className="py-3">
                          <CallSummaryDetail log={log} />
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">No call logs yet</div>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
