import { useState, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import {
  Phone,
  Loader2,
  Search,
  CheckCircle,
  Clock,
  AlertTriangle,
  PhoneOff,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CallLog } from "@shared/fleet-scope-schema";

// ---- Sorting primitives (shared by both tables) ----
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

// A multi-select filter popover.
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

export default function CallHistory() {
  // Per-table sort state.
  const [followSort, setFollowSort] = useState<SortState>({ field: "nextFollowUpDate", dir: "asc" });
  const [historySort, setHistorySort] = useState<SortState>({ field: "callTimestamp", dir: "desc" });
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

  // Expanded-row tracking, keyed by ROW ID (never index) so sorting/filtering
  // re-orders don't move which row is open. CallLog ids are numeric -> String().
  const [expandedFollowUps, setExpandedFollowUps] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const { data: followUps = [], isLoading: followUpsLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/follow-ups"],
    refetchInterval: 60000,
  });

  const { data: recentLogs = [] } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/call-logs"],
    refetchInterval: 30000,
  });

  // Distinct filter options derived from the data.
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
      case "OUTCOME_UNKNOWN":
        // The call happened but told us nothing definitive about the vehicle.
        // Deliberately NOT green or yellow: it is neither ready nor not-ready.
        return <Badge variant="default" className="bg-slate-500 text-white no-default-hover-elevate"><HelpCircle className="w-3 h-3 mr-1" />Unverified</Badge>;
      default:
        return <Badge variant="secondary">{outcome}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Phone className="h-6 w-6 text-muted-foreground mt-0.5" />
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-call-history-title">Call History</h1>
          <p className="text-sm text-muted-foreground">
            Read-only log of repair-shop and technician calls. Outbound calls are placed by LUCA, dispatched from VRM Rental Operations.
          </p>
        </div>
      </div>

      <Tabs defaultValue="history" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="history" data-testid="tab-call-history">
            <Phone className="h-3.5 w-3.5 mr-1.5" />
            Call History
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
        </TabsList>

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
      </Tabs>
    </div>
  );
}
