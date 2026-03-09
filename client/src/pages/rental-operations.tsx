import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, RefreshCw, Search, AlertTriangle, CheckCircle, XCircle,
  Clock, Car, Users, Database,
  ChevronUp, ChevronDown, Info, Loader2, EyeOff, History,
  BarChart3, Truck
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend
} from "recharts";

const AGING_COLORS: Record<string, string> = {
  "28+ Days":    "#ef4444",
  "21-27 Days":  "#f97316",
  "14-20 Days":  "#eab308",
  "<14 Days":    "#22c55e",
};

function DaysBadge({ days }: { days: number }) {
  if (days >= 28) return <Badge className="bg-red-600 text-white text-xs">{days}d</Badge>;
  if (days >= 21) return <Badge className="bg-orange-500 text-white text-xs">{days}d</Badge>;
  if (days >= 14) return <Badge className="bg-yellow-500 text-black text-xs">{days}d</Badge>;
  return <Badge className="bg-green-600 text-white text-xs">{days}d</Badge>;
}

function DivisionBadge({ division }: { division: string }) {
  return <Badge variant="secondary" className="text-xs font-mono">{division || "—"}</Badge>;
}

function QualityPill({ log }: { log: any }) {
  if (!log) return <Badge variant="secondary" className="text-xs">Never run</Badge>;
  if (log.failRows > 0) return <Badge className="bg-red-500 text-white text-xs">{log.failRows} failures</Badge>;
  if (log.warnRows > 0) return <Badge className="bg-amber-500 text-black text-xs">{log.warnRows} warnings</Badge>;
  return <Badge className="bg-green-600 text-white text-xs">All pass</Badge>;
}

function SortButton({ field, sort, setSort }: { field: string; sort: { field: string; dir: "asc" | "desc" }; setSort: (s: any) => void }) {
  const active = sort.field === field;
  return (
    <button
      className="ml-1 opacity-60 hover:opacity-100"
      onClick={() => setSort({ field, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
    >
      {active && sort.dir === "desc" ? <ChevronDown className="h-3 w-3 inline" /> : <ChevronUp className="h-3 w-3 inline" />}
    </button>
  );
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    const parsed = parseISO(String(d));
    if (isValid(parsed)) return format(parsed, "MM/dd/yyyy");
    return String(d).slice(0, 10);
  } catch {
    return String(d).slice(0, 10);
  }
}

function agingBucket(days: number): string {
  if (days >= 28) return "28+ Days";
  if (days >= 21) return "21-27 Days";
  if (days >= 14) return "14-20 Days";
  return "<14 Days";
}

interface FleetOverviewStats {
  isLiveData: boolean;
  lastUpdated: string;
  technicians: {
    totalActiveTechs: number;
    modifiedDutyTechs: number;
    activeRoutableTechs: number;
    byovTechnicians: number;
    techsRequiringTruck: number;
  };
  assignments: {
    trucksAssignedInTpms: number;
    trucksAssignedExclByov: number;
    techsWithNoTruck: number;
    modifiedDutyNoTruck: number;
    activeTechsNeedingTruck: number;
    techsWithDeclinedRepairTruck: number;
  };
  vehicles: {
    totalActiveHolmanVehicles: number;
    trucksAssigned: number;
    sentToAuction: number;
    declinedRepairUnassigned: number;
    totalSpares: number;
  };
}

export default function RentalOperations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("open");
  const [openSearch, setOpenSearch] = useState("");
  const [closedSearch, setClosedSearch] = useState("");
  const [ticketSearch, setTicketSearch] = useState("");
  const [openSort, setOpenSort] = useState({ field: "daysOpen", dir: "desc" as "asc" | "desc" });
  const [showRaw, setShowRaw] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "enterprise" | "holman_non_enterprise">("all");
  const [showOos, setShowOos] = useState(true);
  const [selectedFileDate, setSelectedFileDate] = useState<string | null>(null);

  const { data: availableDates } = useQuery<{ data: Array<{ fileDate: string; sourceFilename: string; loadedTs: string; rowCount: number; ticketRowCount?: number; openRowCount?: number; closedRowCount?: number }>; latestDate: string | null }>({
    queryKey: ["/api/rental-ops/available-dates"],
    staleTime: 10 * 60 * 1000,
  });

  const latestDate = availableDates?.latestDate ?? null;
  const isHistorical = selectedFileDate !== null && selectedFileDate !== latestDate;
  const effectiveDate = selectedFileDate;

  const { data: openData, isLoading: loadingOpen } = useQuery<{ data: any[]; total: number; enterpriseCount: number; holmanNonEnterpriseCount: number; oosFilteredCount?: number; view: string }>({
    queryKey: ["/api/rental-ops/open", showRaw ? "raw" : "business", showOos, effectiveDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (showRaw) params.set("view", "raw");
      if (showOos) params.set("includeOos", "true");
      if (effectiveDate) params.set("fileDate", effectiveDate);
      const qs = params.toString();
      return fetch(`/api/rental-ops/open${qs ? `?${qs}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: activeTab === "open" || activeTab === "position" || activeTab === "analytics",
    staleTime: 5 * 60 * 1000,
  });

  const { data: closedData, isLoading: loadingClosed } = useQuery<{ data: any[]; total: number; oosFilteredCount?: number }>({
    queryKey: ["/api/rental-ops/closed", showOos],
    queryFn: () => fetch(`/api/rental-ops/closed${showOos ? "?includeOos=true" : ""}`, { credentials: "include" }).then(r => r.json()),
    enabled: activeTab === "closed" || activeTab === "extensions",
    staleTime: 5 * 60 * 1000,
  });

  const { data: ticketData, isLoading: loadingTickets } = useQuery<{ data: any[]; total: number; oosFilteredCount?: number }>({
    queryKey: ["/api/rental-ops/tickets", showOos, effectiveDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (showOos) params.set("includeOos", "true");
      if (effectiveDate) params.set("fileDate", effectiveDate);
      return fetch(`/api/rental-ops/tickets?${params.toString()}`, { credentials: "include" }).then(r => r.json());
    },
    enabled: activeTab === "tickets",
    staleTime: 5 * 60 * 1000,
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<any>({
    queryKey: ["/api/rental-ops/summary", effectiveDate, showOos],
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveDate) params.set("fileDate", effectiveDate);
      if (showOos) params.set("includeOos", "true");
      const qs = params.toString();
      return fetch(`/api/rental-ops/summary${qs ? `?${qs}` : ""}`, { credentials: "include" }).then(r => r.json());
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: qualityLatest } = useQuery<any[]>({
    queryKey: ["/api/rental-ops/qualify/latest"],
    staleTime: 10 * 60 * 1000,
  });

  const { data: qualityHistory } = useQuery<any[]>({
    queryKey: ["/api/rental-ops/qualify/history"],
    enabled: activeTab === "quality",
    staleTime: 10 * 60 * 1000,
  });

  const { data: integrityData, isLoading: loadingIntegrity, refetch: refetchIntegrity } = useQuery<any>({
    queryKey: ["/api/rental-ops/integrity"],
    enabled: activeTab === "quality",
    staleTime: 10 * 60 * 1000,
  });

  const { data: fleetStats, isLoading: fleetStatsLoading } = useQuery<FleetOverviewStats>({
    queryKey: ["/api/fleet-overview/statistics"],
    enabled: activeTab === "analytics",
    refetchInterval: 5 * 60 * 1000,
  });

  const qualifyMutation = useMutation({
    mutationFn: (source: string) => apiRequest("POST", "/api/rental-ops/qualify", { source }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/qualify/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/qualify/history"] });
      toast({ title: "Qualification complete", description: "Results saved to quality history." });
    },
    onError: (e: any) => toast({ title: "Qualification failed", description: e.message, variant: "destructive" }),
  });

  function handleExport() {
    window.open("/api/rental-ops/export.xlsx", "_blank");
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/open"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/closed"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/tickets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/summary"] });
    toast({ title: "Data refreshed from Snowflake" });
  }

  const openRows = (openData?.data || []).filter((r: any) => {
    const q = openSearch.toLowerCase();
    const matchesSearch = !q || r.vehicleNumber?.toLowerCase().includes(q) || r.renterName?.toLowerCase().includes(q) || (r.poNumber || "")?.toLowerCase().includes(q);
    const matchesSource =
      sourceFilter === "all" ? true :
      sourceFilter === "enterprise" ? r.source === "enterprise" :
      r.source === "holman_non_enterprise" || r.source === "holman_raw";
    return matchesSearch && matchesSource;
  });

  const sortedOpen = [...openRows].sort((a: any, b: any) => {
    const av = a[openSort.field] ?? 0;
    const bv = b[openSort.field] ?? 0;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
    return openSort.dir === "asc" ? cmp : -cmp;
  });

  const closedRows = (closedData?.data || []).filter((r: any) => {
    const q = closedSearch.toLowerCase();
    return !q || r.vehicleNumber?.toLowerCase().includes(q) || r.renterName?.toLowerCase().includes(q) || r.poNumber?.toLowerCase().includes(q);
  });

  const ticketRows = (ticketData?.data as any[] || []).filter((r: any) => {
    const q = ticketSearch.toLowerCase();
    return !q
      || r.vehicleNumber?.toLowerCase().includes(q)
      || r.ticketNumber?.toLowerCase().includes(q)
      || r.holmanPoNumber?.toLowerCase().includes(q)
      || r.renterName?.toLowerCase().includes(q)
      || r.claimNumber?.toLowerCase().includes(q);
  });

  const extensionRows = (closedData?.data || []).filter((r: any) => r.rewriteFlag === "Y");

  const positionGroups = (openData?.data || []).reduce((acc: Record<string, any[]>, r: any) => {
    const key = r.renterName || "Unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const qualMap: Record<string, any> = {};
  for (const q of qualityLatest || []) qualMap[q.sourceTable] = q;

  // Analytics: compute aging buckets from open data
  const agingBuckets = useMemo(() => {
    const all = openData?.data || [];
    const counts: Record<string, number> = { "28+ Days": 0, "21-27 Days": 0, "14-20 Days": 0, "<14 Days": 0 };
    for (const r of all) {
      const b = agingBucket(r.daysOpen || 0);
      counts[b] = (counts[b] || 0) + 1;
    }
    const total = all.length;
    return Object.entries(counts).map(([bucket, count]) => ({
      bucket,
      count,
      pct: total > 0 ? count / total : 0,
      fill: AGING_COLORS[bucket],
    }));
  }, [openData]);

  const totalOver14 = useMemo(() => {
    return agingBuckets.filter(b => b.bucket !== "<14 Days").reduce((s, b) => s + b.count, 0);
  }, [agingBuckets]);

  const totalOpen = openData?.total ?? 0;
  const pctOver14 = totalOpen > 0 ? totalOver14 / totalOpen : 0;

  // Analytics: vendor/source breakdown from open data
  const vendorBreakdown = useMemo(() => {
    const all = openData?.data || [];
    const map: Record<string, { count: number; over14: number; totalDays: number }> = {};
    for (const r of all) {
      const vendor = r.source === "enterprise" ? "Enterprise" : (r.rentalVendor || r.source || "Unknown");
      if (!map[vendor]) map[vendor] = { count: 0, over14: 0, totalDays: 0 };
      map[vendor].count++;
      map[vendor].totalDays += r.daysOpen || 0;
      if ((r.daysOpen || 0) >= 14) map[vendor].over14++;
    }
    const total = all.length;
    return Object.entries(map)
      .map(([vendor, stats]) => ({
        vendor,
        count: stats.count,
        pct: total > 0 ? stats.count / total : 0,
        avgDays: stats.count > 0 ? stats.totalDays / stats.count : 0,
        over14: stats.over14,
      }))
      .sort((a, b) => b.count - a.count);
  }, [openData]);

  // Analytics: daily trend from availableDates
  const trendData = useMemo(() => {
    if (!availableDates?.data) return [];
    return [...availableDates.data]
      .sort((a, b) => a.fileDate.localeCompare(b.fileDate))
      .map(d => ({
        date: d.fileDate.slice(5), // MM-DD
        open: d.openRowCount ?? 0,
        tickets: d.ticketRowCount ?? 0,
        closed: d.closedRowCount ?? 0,
      }));
  }, [availableDates]);

  const SummaryCard = ({ label, value, sub, color }: { label: string; value: any; sub?: string; color?: string }) => (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color || ""}`}>{value ?? "—"}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  return (
    <MainContent>
      <TopBar title="Rental Operations" />
      <div className="p-4 space-y-4">
        {/* Header controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <BackButton />
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Database className="h-4 w-4" />
            <span>Snowflake Pipeline Tables</span>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <History className="h-4 w-4 text-muted-foreground" />
              <Select
                value={selectedFileDate ?? "__latest__"}
                onValueChange={(v) => setSelectedFileDate(v === "__latest__" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="Select file date…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__latest__">Latest ({latestDate ?? "…"})</SelectItem>
                  {(availableDates?.data ?? []).filter(d => d.fileDate !== latestDate).map(d => (
                    <SelectItem key={d.fileDate} value={d.fileDate}>
                      {d.fileDate} — {(d.ticketRowCount ?? 0)} tickets / {(d.openRowCount ?? 0)} open / {(d.closedRowCount ?? 0)} closed
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground select-none" title="Out-of-service vehicles are hidden by default">
              <EyeOff className="h-4 w-4" />
              <span>Show Out of Service</span>
              <Switch checked={showOos} onCheckedChange={setShowOos} />
            </label>
            <Button variant="outline" size="sm" onClick={() => qualifyMutation.mutate("all")} disabled={qualifyMutation.isPending}>
              {qualifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              <span className="ml-1.5">Run Qualification</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
              <span className="ml-1.5">Refresh</span>
            </Button>
            <Button size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span className="ml-1.5">Export Workbook</span>
            </Button>
          </div>
        </div>

        {/* Historical data banner */}
        {isHistorical && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-sm">
            <History className="h-4 w-4 shrink-0" />
            <span>
              Viewing historical snapshot from <strong>{selectedFileDate}</strong> — all 3 pipeline tables are filtered to this date.
              {(() => {
                const entry = availableDates?.data.find(d => d.fileDate === selectedFileDate);
                if (!entry) return null;
                return (
                  <span className="ml-1 text-xs opacity-75">
                    ({entry.ticketRowCount ?? 0} tickets · {entry.openRowCount ?? 0} open rentals · {entry.closedRowCount ?? 0} closed rentals)
                  </span>
                );
              })()}
            </span>
            <button
              className="ml-auto text-xs underline underline-offset-2 hover:no-underline shrink-0"
              onClick={() => setSelectedFileDate(null)}
            >
              Return to latest
            </button>
          </div>
        )}

        {/* Data Quality Banner */}
        <div className="flex flex-wrap gap-2 p-3 bg-muted/40 rounded-lg border">
          <span className="text-xs font-medium text-muted-foreground mr-1 self-center">Data Quality:</span>
          {[
            { key: "rental_open", label: "Open Rentals" },
            { key: "rental_closed", label: "Closed Rentals" },
            { key: "rental_ticket_detail", label: "Open Tickets" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{label}:</span>
              <QualityPill log={qualMap[key]} />
              {qualMap[key] && (
                <span className="text-xs text-muted-foreground">
                  (last run {format(new Date(qualMap[key].runAt), "M/d h:mm a")})
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Summary Cards */}
        {loadingSummary ? (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => <Card key={i}><CardContent className="pt-4 pb-3 px-4 h-16 animate-pulse bg-muted/40" /></Card>)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard
                label="Total Open Rentals"
                value={summary?.totalOpen}
                sub={summary?.enterpriseOpen !== undefined ? `${summary.enterpriseOpen} Enterprise + ${summary.holmanNonEnterprise} Hertz/Avis` : undefined}
                color="text-blue-600 dark:text-blue-400"
              />
              <SummaryCard label="Total Closed" value={summary?.totalClosed} />
              <SummaryCard label="Extensions" value={summary?.extensions} color="text-amber-600 dark:text-amber-400" />
              <SummaryCard label="Avg Days Open" value={summary?.avgDaysOpen !== undefined ? `${summary.avgDaysOpen}d` : "—"} />
            </div>
            {summary?.divisionBreakdown && Object.keys(summary.divisionBreakdown).length > 0 && (
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="text-muted-foreground font-medium">Holman non-Enterprise by Division:</span>
                {Object.entries(summary.divisionBreakdown as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <span key={code} className="inline-flex items-center gap-1 bg-muted rounded px-2 py-0.5 font-mono">
                      {code} <span className="font-semibold text-foreground">{count}</span>
                    </span>
                  ))}
              </div>
            )}
          </>
        )}

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
            <TabsTrigger value="open">Open Rentals</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
            <TabsTrigger value="tickets">Open Tickets</TabsTrigger>
            <TabsTrigger value="extensions">Extensions</TabsTrigger>
            <TabsTrigger value="position">Position Report</TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />Analytics
            </TabsTrigger>
            <TabsTrigger value="quality">Data Quality</TabsTrigger>
          </TabsList>

          {/* Open Rentals Tab */}
          <TabsContent value="open">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base">Open Rentals</CardTitle>
                  <Badge variant="secondary">{sortedOpen.length}</Badge>
                  <div className="flex items-center gap-0 border rounded overflow-hidden text-xs">
                    {([
                      { key: "all" as const, label: `All (${openData?.total ?? "—"})` },
                      { key: "enterprise" as const, label: `Enterprise (${openData?.enterpriseCount ?? summary?.enterpriseOpen ?? "—"})` },
                      { key: "holman_non_enterprise" as const, label: `Hertz/Avis (${openData?.holmanNonEnterpriseCount ?? summary?.holmanNonEnterprise ?? "—"})` },
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setSourceFilter(opt.key)}
                        className={`px-2 py-1 transition-colors ${sourceFilter === opt.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setShowRaw(v => !v); setSourceFilter("all"); }}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${showRaw ? "bg-amber-500 text-white border-amber-500" : "bg-muted text-muted-foreground border-muted-foreground/30"}`}
                    title={showRaw ? "Showing all raw Holman PO lines" : "Showing valid rentals (Excel formula)"}
                  >
                    {showRaw ? "Raw Holman Data" : "Valid Rentals"}
                  </button>
                  <div className="relative ml-auto w-56">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-8 h-8 text-sm" placeholder="Search vehicle, name, PO..." value={openSearch} onChange={e => setOpenSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingOpen ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading from Snowflake...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vehicle #<SortButton field="vehicleNumber" sort={openSort} setSort={setOpenSort} /></TableHead>
                        <TableHead>Tech / Renter<SortButton field="renterName" sort={openSort} setSort={setOpenSort} /></TableHead>
                        <TableHead>Ticket / PO #</TableHead>
                        <TableHead>Start Date<SortButton field="rentalStartDate" sort={openSort} setSort={setOpenSort} /></TableHead>
                        <TableHead>Days Open<SortButton field="daysOpen" sort={openSort} setSort={setOpenSort} /></TableHead>
                        <TableHead>Ext</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOpen.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {openSearch ? "No results match your search" : "No open rental data from Snowflake pipeline table"}
                        </TableCell></TableRow>
                      ) : sortedOpen.map((r: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">{r.vehicleNumber || "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{r.renterName || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.poNumber || "—"}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.rentalStartDate)}</TableCell>
                          <TableCell><DaysBadge days={r.daysOpen || 0} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.numberOfExtensions > 0 ? <Badge variant="secondary" className="text-xs">{r.numberOfExtensions}</Badge> : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.source === "enterprise"
                              ? <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs border-none">Enterprise</Badge>
                              : r.source === "holman_non_enterprise"
                                ? <span className="text-muted-foreground text-xs">{r.rentalVendor?.split(" ")[0] || "Holman"}</span>
                                : <span className="text-amber-600 dark:text-amber-400 text-xs">Holman (raw)</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Closed Tab */}
          <TabsContent value="closed">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Closed Rentals</CardTitle>
                  <Badge variant="secondary">{closedRows.length}</Badge>
                  <div className="relative ml-auto w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-8 h-8 text-sm" placeholder="Search vehicle, name, PO..." value={closedSearch} onChange={e => setClosedSearch(e.target.value)} />
                  </div>
                </div>
                <CardDescription className="flex items-center gap-1 text-xs">
                  <Info className="h-3 w-3" /> Deduplicated by vehicle + PO number — showing latest record per pair
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingClosed ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading from Snowflake...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vehicle #</TableHead>
                        <TableHead>Division</TableHead>
                        <TableHead>Tech / Renter</TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Start Date</TableHead>
                        <TableHead>End Date</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Rewrite</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {closedRows.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          {closedSearch ? "No results match your search" : "No closed rental data from Snowflake pipeline table"}
                        </TableCell></TableRow>
                      ) : closedRows.map((r: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">{r.vehicleNumber || "—"}</TableCell>
                          <TableCell><DivisionBadge division={r.division} /></TableCell>
                          <TableCell className="max-w-[180px] truncate">{r.renterName || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.poNumber || "—"}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.rentalStartDate)}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.rentalEndDate)}</TableCell>
                          <TableCell className="text-sm">{r.rentalDays || "—"}</TableCell>
                          <TableCell>{r.rewriteFlag === "Y" ? <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 text-xs border-none">Y</Badge> : r.rewriteFlag || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Open Tickets Tab */}
          <TabsContent value="tickets">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Open Ticket Detail</CardTitle>
                  <Badge variant="secondary">{ticketRows.length}</Badge>
                  <div className="relative ml-auto w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-8 h-8 text-sm" placeholder="Search vehicle, ticket..." value={ticketSearch} onChange={e => setTicketSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingTickets ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading from Snowflake...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vehicle #</TableHead>
                        <TableHead>Holman PO</TableHead>
                        <TableHead>ECARS Ticket</TableHead>
                        <TableHead>Renter / Tech</TableHead>
                        <TableHead>Orig. Start</TableHead>
                        <TableHead>Days Open</TableHead>
                        <TableHead>Days Auth</TableHead>
                        <TableHead>Rewrites</TableHead>
                        <TableHead>Repairs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ticketRows.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          {ticketSearch ? "No results match your search" : "No ticket data from Snowflake pipeline table"}
                        </TableCell></TableRow>
                      ) : ticketRows.map((r: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">{r.vehicleNumber || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.holmanPoNumber || "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{r.ticketNumber || "—"}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-xs">{r.renterName || "—"}</TableCell>
                          <TableCell className="text-sm">
                            <div>{formatDate(r.originalStartDate)}</div>
                            {r.isRewrite && r.rentalStartDate !== r.originalStartDate && (
                              <div className="text-xs text-muted-foreground">rewrite {formatDate(r.rentalStartDate)}</div>
                            )}
                          </TableCell>
                          <TableCell><DaysBadge days={r.daysOpen || 0} /></TableCell>
                          <TableCell className="text-sm">{r.daysAuthorized ?? "—"}</TableCell>
                          <TableCell className="text-sm">
                            {r.numberOfRewrites > 0
                              ? <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 text-xs border-none">{r.numberOfRewrites}×</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          <TableCell>
                            {r.repairsComplete === "Yes"
                              ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs border-none">Yes</Badge>
                              : <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-xs border-none">No</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Extensions Tab */}
          <TabsContent value="extensions">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Extensions / Rewrites</CardTitle>
                  <Badge variant="secondary">{extensionRows.length}</Badge>
                </div>
                <CardDescription className="text-xs">
                  Closed rentals where the Rewrite Flag = Y — indicates the rental was extended from its original start date
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingClosed ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vehicle #</TableHead>
                        <TableHead>Division</TableHead>
                        <TableHead>Tech / Renter</TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Original Start</TableHead>
                        <TableHead>Rewritten Start</TableHead>
                        <TableHead>End Date</TableHead>
                        <TableHead>Days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extensionRows.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No extension/rewrite records found</TableCell></TableRow>
                      ) : extensionRows.map((r: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">{r.vehicleNumber || "—"}</TableCell>
                          <TableCell><DivisionBadge division={r.division} /></TableCell>
                          <TableCell className="max-w-[180px] truncate">{r.renterName || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.poNumber || "—"}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.originalStartDate)}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.rentalStartDate)}</TableCell>
                          <TableCell className="text-sm">{formatDate(r.rentalEndDate)}</TableCell>
                          <TableCell className="text-sm">{r.rentalDays || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Position Report Tab */}
          <TabsContent value="position">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Position Report</CardTitle>
                <CardDescription className="text-xs">
                  Open rentals grouped by tech/renter — answers "who has which rentals"
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingOpen ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading...
                  </div>
                ) : Object.keys(positionGroups).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No open rental data available</div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(positionGroups)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([name, rentals]: [string, any[]]) => (
                        <div key={name} className="border rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{name}</span>
                            <Badge variant="secondary" className="text-xs">{rentals.length} vehicle{rentals.length !== 1 ? "s" : ""}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {rentals.map((r: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1 text-xs">
                                <Car className="h-3 w-3 text-muted-foreground" />
                                <span className="font-mono">{r.vehicleNumber}</span>
                                <DivisionBadge division={r.division} />
                                <DaysBadge days={r.daysOpen || 0} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-5">
            {loadingOpen ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <Card key={i}><CardContent className="pt-4 h-20 animate-pulse bg-muted/40" /></Card>)}
              </div>
            ) : (
              <>
                {/* Aging KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Open</CardTitle>
                      <Car className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalOpen}</div>
                      <p className="text-xs text-muted-foreground">{totalOver14} over 14 days ({(pctOver14 * 100).toFixed(1)}%)</p>
                    </CardContent>
                  </Card>
                  {agingBuckets.map(({ bucket, count, pct, fill }) => (
                    <Card key={bucket} style={{ borderColor: `${fill}40` }}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{bucket}</CardTitle>
                        <Clock className="h-4 w-4" style={{ color: fill }} />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold" style={{ color: fill }}>{count}</div>
                        <p className="text-xs text-muted-foreground">{(pct * 100).toFixed(1)}% of total</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Charts row */}
                <div className="grid gap-5 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Aging Distribution</CardTitle>
                      <CardDescription className="text-xs">Current open rentals by age bracket</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[260px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={agingBuckets}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""}
                              outerRadius={90}
                              dataKey="count"
                            >
                              {agingBuckets.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: any, name: any) => [v, name]} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Summary by Aging Category</CardTitle>
                      <CardDescription className="text-xs">Breakdown with percentages and averages</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 mt-1">
                        {agingBuckets.map(({ bucket, count, pct, fill }) => (
                          <div key={bucket} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: fill }} />
                              <span className="font-medium">{bucket}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="font-bold w-10 text-right">{count}</span>
                              <span className="text-muted-foreground w-14 text-right">{(pct * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        ))}
                        <div className="border-t pt-3 flex items-center justify-between font-bold text-sm">
                          <span>Grand Total</span>
                          <span>{totalOpen}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-destructive font-semibold">
                          <span>Total Over 14 Days</span>
                          <span>{totalOver14} ({(pctOver14 * 100).toFixed(1)}%)</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Daily trend from file dates */}
                {trendData.length > 1 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Daily Volume Trend</CardTitle>
                      <CardDescription className="text-xs">
                        Open rentals, tickets, and closed per daily Snowflake file load — {trendData.length} data point{trendData.length !== 1 ? "s" : ""} available
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="open" stroke="#3b82f6" strokeWidth={2} name="Open Rentals" dot />
                            <Line type="monotone" dataKey="tickets" stroke="#8b5cf6" strokeWidth={2} name="Open Tickets" dot />
                            <Line type="monotone" dataKey="closed" stroke="#6b7280" strokeWidth={2} name="Closed Rentals" dot />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {trendData.length <= 1 && (
                  <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm">
                        <Clock className="h-4 w-4" />
                        <span>Trend chart will appear once 2 or more daily Snowflake file loads are available. New data points are added automatically each time a pipeline file is received.</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Vendor / Source breakdown */}
                {vendorBreakdown.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Breakdown by Rental Source</CardTitle>
                      <CardDescription className="text-xs">Distribution of open rentals across Enterprise and Holman vendors</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2 font-medium">Source / Vendor</th>
                              <th className="text-right p-2 font-medium">Count</th>
                              <th className="text-right p-2 font-medium">% of Total</th>
                              <th className="text-right p-2 font-medium">Avg Days</th>
                              <th className="text-right p-2 font-medium">Over 14 Days</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vendorBreakdown.map((v) => (
                              <tr key={v.vendor} className="border-b hover:bg-muted/50">
                                <td className="p-2 font-medium">{v.vendor}</td>
                                <td className="p-2 text-right">{v.count}</td>
                                <td className="p-2 text-right">{(v.pct * 100).toFixed(1)}%</td>
                                <td className="p-2 text-right">{v.avgDays.toFixed(0)}</td>
                                <td className={`p-2 text-right ${v.over14 > 0 ? "text-destructive font-medium" : ""}`}>
                                  {v.over14}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Fleet Overview */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Fleet Overview Statistics
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Technician and vehicle assignment summary from TPMS and Holman
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {fleetStatsLoading ? (
                      <div className="space-y-3">
                        {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                      </div>
                    ) : fleetStats ? (
                      <div className="grid md:grid-cols-3 gap-5">
                        <Card className="border-blue-200 bg-blue-50/30 dark:bg-blue-950/20">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium flex items-center gap-2">
                              <Users className="h-3.5 w-3.5 text-blue-600" />
                              Technician Summary
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0">
                            <table className="w-full text-xs">
                              <tbody>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold">Total Active Techs (TPMS):</td>
                                  <td className="py-1.5 text-right font-bold text-blue-700">{fleetStats.technicians.totalActiveTechs.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">Modified Duty:</td>
                                  <td className="py-1.5 text-right">{fleetStats.technicians.modifiedDutyTechs}</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold">Active Routable (excl. Mod Duty):</td>
                                  <td className="py-1.5 text-right font-bold">{fleetStats.technicians.activeRoutableTechs.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">BYOV Technicians:</td>
                                  <td className="py-1.5 text-right">{fleetStats.technicians.byovTechnicians}</td>
                                </tr>
                                <tr>
                                  <td className="py-1.5 font-semibold">Techs requiring a truck:</td>
                                  <td className="py-1.5 text-right font-bold">{fleetStats.technicians.techsRequiringTruck.toLocaleString()}</td>
                                </tr>
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>

                        <Card className="border-green-200 bg-green-50/30 dark:bg-green-950/20">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium flex items-center gap-2">
                              <Truck className="h-3.5 w-3.5 text-green-600" />
                              Assignment Status
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0">
                            <table className="w-full text-xs">
                              <tbody>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">Trucks Assigned in TPMS (incl. modified):</td>
                                  <td className="py-1.5 text-right">{fleetStats.assignments.trucksAssignedInTpms.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold">Trucks Assigned (excl. BYOV):</td>
                                  <td className="py-1.5 text-right font-bold">{fleetStats.assignments.trucksAssignedExclByov.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">No truck assigned (all techs):</td>
                                  <td className="py-1.5 text-right">{fleetStats.assignments.techsWithNoTruck}</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold text-amber-700">Active techs needing truck:</td>
                                  <td className="py-1.5 text-right font-bold text-amber-700">{fleetStats.assignments.activeTechsNeedingTruck}</td>
                                </tr>
                                <tr>
                                  <td className="py-1.5 font-semibold text-red-700">Techs w/ declined repair truck:</td>
                                  <td className="py-1.5 text-right font-bold text-red-700">{fleetStats.assignments.techsWithDeclinedRepairTruck}</td>
                                </tr>
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>

                        <Card className="border-purple-200 bg-purple-50/30 dark:bg-purple-950/20">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-xs font-medium flex items-center gap-2">
                              <Car className="h-3.5 w-3.5 text-purple-600" />
                              Holman Vehicles
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-3 pt-0">
                            <table className="w-full text-xs">
                              <tbody>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold">Total Active Holman (excl. BYOV):</td>
                                  <td className="py-1.5 text-right font-bold text-purple-700">{fleetStats.vehicles.totalActiveHolmanVehicles.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-1.5 font-semibold">Trucks Assigned (excl. BYOV):</td>
                                  <td className="py-1.5 text-right font-bold">{fleetStats.vehicles.trucksAssigned.toLocaleString()}</td>
                                </tr>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">Sent to Auction:</td>
                                  <td className="py-1.5 text-right">{fleetStats.vehicles.sentToAuction}</td>
                                </tr>
                                <tr className="border-b text-muted-foreground">
                                  <td className="py-1.5 pl-3 italic">Declined Repair (unassigned):</td>
                                  <td className="py-1.5 text-right">{fleetStats.vehicles.declinedRepairUnassigned}</td>
                                </tr>
                                <tr>
                                  <td className="py-1.5 font-semibold">Total Spares:</td>
                                  <td className="py-1.5 text-right font-bold text-green-700">{fleetStats.vehicles.totalSpares}</td>
                                </tr>
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground text-sm">Unable to load fleet statistics.</div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Data Quality Tab */}
          <TabsContent value="quality" className="space-y-5">
            {/* Per-table quality cards */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Data Quality Detail</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => qualifyMutation.mutate("all")} disabled={qualifyMutation.isPending}>
                    {qualifyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    <span className="ml-1.5">Re-run All</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { key: "rental_open", label: "Open Rentals", source: "rental_open" },
                    { key: "rental_closed", label: "Closed Rentals", source: "rental_closed" },
                    { key: "rental_ticket_detail", label: "Open Ticket Detail", source: "rental_ticket_detail" },
                  ].map(({ key, label, source }) => {
                    const q = qualMap[key];
                    return (
                      <div key={key} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{label}</span>
                          <div className="flex items-center gap-1.5">
                            <QualityPill log={q} />
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
                              onClick={() => qualifyMutation.mutate(source)}
                              disabled={qualifyMutation.isPending}>
                              Run
                            </Button>
                          </div>
                        </div>
                        {q ? (
                          <>
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(q.runAt), "M/d/yy h:mm a")} · {q.totalRows} rows
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-xs">
                              <div className="text-center">
                                <div className="text-green-600 dark:text-green-400 font-bold">{q.passRows}</div>
                                <div className="text-muted-foreground">Pass</div>
                              </div>
                              <div className="text-center">
                                <div className="text-amber-600 dark:text-amber-400 font-bold">{q.warnRows}</div>
                                <div className="text-muted-foreground">Warn</div>
                              </div>
                              <div className="text-center">
                                <div className="text-red-600 dark:text-red-400 font-bold">{q.failRows}</div>
                                <div className="text-muted-foreground">Fail</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                              <span>Duplicates: {q.duplicateCount}</span>
                              <span>Unmatched vehicles: {q.unmatchedVehicleCount}</span>
                              <span>Date issues: {q.invalidDateCount}</span>
                            </div>
                            {q.issuesJson && (q.issuesJson as any[]).length > 0 && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                  {(q.issuesJson as any[]).length} issue{(q.issuesJson as any[]).length !== 1 ? "s" : ""}
                                </summary>
                                <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                                  {(q.issuesJson as any[]).slice(0, 20).map((issue: any, i: number) => (
                                    <div key={i} className="flex items-start gap-1.5 py-0.5">
                                      {issue.severity === "fail"
                                        ? <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                                        : <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />}
                                      <span>{issue.row ? `Row ${issue.row}: ` : ""}{issue.issue}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground py-2">No qualification data yet. Click Run to analyze.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Qualification history */}
            {qualityHistory && qualityHistory.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Qualification History</CardTitle>
                  <CardDescription className="text-xs">Recent qualification runs across all 3 pipeline tables</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source Table</TableHead>
                        <TableHead>Run At</TableHead>
                        <TableHead>Total Rows</TableHead>
                        <TableHead>Pass</TableHead>
                        <TableHead>Warn</TableHead>
                        <TableHead>Fail</TableHead>
                        <TableHead>Duplicates</TableHead>
                        <TableHead>Unmatched</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {qualityHistory.slice(0, 30).map((q: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-mono">{q.sourceTable}</TableCell>
                          <TableCell className="text-xs">{format(new Date(q.runAt), "M/d h:mm a")}</TableCell>
                          <TableCell className="text-xs">{q.totalRows}</TableCell>
                          <TableCell className="text-xs text-green-600">{q.passRows}</TableCell>
                          <TableCell className="text-xs text-amber-600">{q.warnRows}</TableCell>
                          <TableCell className="text-xs text-red-600">{q.failRows}</TableCell>
                          <TableCell className="text-xs">{q.duplicateCount}</TableCell>
                          <TableCell className="text-xs">{q.unmatchedVehicleCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Cross-System Integrity */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Cross-System Integrity: Enterprise vs Holman</CardTitle>
                  {integrityData?.summary && (
                    <Badge className={
                      integrityData.summary.integrityScore >= 80 ? "bg-green-600 text-white" :
                      integrityData.summary.integrityScore >= 60 ? "bg-amber-500 text-black" :
                      "bg-red-600 text-white"
                    }>
                      {integrityData.summary.integrityScore}% integrity
                    </Badge>
                  )}
                  <Button variant="outline" size="sm" onClick={() => refetchIntegrity()} disabled={loadingIntegrity} className="ml-auto">
                    {loadingIntegrity ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    <span className="ml-1.5">Refresh</span>
                  </Button>
                </div>
                <CardDescription className="text-xs">
                  Enterprise tracks rentals by renter; Holman tracks by truck + PO. Mid-rental truck updates can desync these systems.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingIntegrity ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Analyzing cross-system integrity...
                  </div>
                ) : integrityData ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      {[
                        { label: "Enterprise Tickets", value: integrityData.summary.totalEnterpriseTickets, color: "text-foreground" },
                        { label: "High Risk", value: integrityData.summary.highRiskCount, color: "text-red-600 dark:text-red-400" },
                        { label: "Medium Risk", value: integrityData.summary.mediumRiskCount, color: "text-amber-600 dark:text-amber-400" },
                        { label: "Low Risk", value: integrityData.summary.lowRiskCount, color: "text-blue-600 dark:text-blue-400" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="border rounded-lg p-3">
                          <div className={`text-2xl font-bold ${color}`}>{value}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>

                    {[
                      {
                        key: "orphanedEnterprise",
                        icon: <XCircle className="h-4 w-4 text-red-500 shrink-0" />,
                        severityClass: "border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20",
                        col1: "Vehicle", col2: "Ticket", col3: "Renter", col4: "Days Open",
                        renderRow: (r: any) => [r.vehicleNumber, r.ticketNumber, r.renterName, r.daysOpen ? `${r.daysOpen}d` : "—"],
                      },
                      {
                        key: "genuineRenterMismatch",
                        icon: <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />,
                        severityClass: "border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20",
                        col1: "Vehicle", col2: "Enterprise Renter", col3: "Holman Renter", col4: "Days Open",
                        renderRow: (r: any) => [r.vehicleNumber, r.enterpriseRenter, r.holmanRenter, r.daysOpen ? `${r.daysOpen}d` : "—"],
                      },
                      {
                        key: "stalePO",
                        icon: <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />,
                        severityClass: "border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20",
                        col1: "Vehicle", col2: "Enterprise PO", col3: "Current Holman PO(s)", col4: "Days Open",
                        renderRow: (r: any) => [r.vehicleNumber, r.entPo, r.allHolmanPos, r.daysOpen ? `${r.daysOpen}d` : "—"],
                      },
                      {
                        key: "nameTypo",
                        icon: <Info className="h-4 w-4 text-blue-500 shrink-0" />,
                        severityClass: "border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20",
                        col1: "Vehicle", col2: "Enterprise Name", col3: "Holman Name", col4: "PO Match",
                        renderRow: (r: any) => [r.vehicleNumber, r.enterpriseRenter, r.holmanRenter, r.poMatch ? "Yes" : "No"],
                      },
                    ].map(({ key, icon, severityClass, col1, col2, col3, col4, renderRow }) => {
                      const cat = integrityData.categories[key];
                      if (!cat) return null;
                      return (
                        <details key={key} className={`border rounded-lg overflow-hidden ${severityClass}`}>
                          <summary className="flex items-center gap-2 p-3 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 list-none">
                            {icon}
                            <span className="font-medium text-sm">{cat.label}</span>
                            <Badge variant="secondary" className="text-xs ml-1">{cat.count}</Badge>
                            <span className="text-xs text-muted-foreground ml-2 flex-1">{cat.description}</span>
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </summary>
                          {cat.records && cat.records.length > 0 && (
                            <div className="border-t">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs py-2">{col1}</TableHead>
                                    <TableHead className="text-xs py-2">{col2}</TableHead>
                                    <TableHead className="text-xs py-2">{col3}</TableHead>
                                    <TableHead className="text-xs py-2">{col4}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {cat.records.slice(0, 25).map((r: any, i: number) => {
                                    const [v1, v2, v3, v4] = renderRow(r);
                                    return (
                                      <TableRow key={i} className="text-xs">
                                        <TableCell className="font-mono py-1.5">{v1}</TableCell>
                                        <TableCell className="py-1.5">{v2}</TableCell>
                                        <TableCell className="py-1.5 text-muted-foreground">{v3}</TableCell>
                                        <TableCell className="py-1.5">{v4}</TableCell>
                                      </TableRow>
                                    );
                                  })}
                                  {cat.records.length > 25 && (
                                    <TableRow>
                                      <TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-2">
                                        + {cat.records.length - 25} more records
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </details>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-4 text-center">Switch to this tab to load integrity analysis from Snowflake.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainContent>
  );
}
