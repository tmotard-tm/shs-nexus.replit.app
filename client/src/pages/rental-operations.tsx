import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Download, RefreshCw, Search, AlertTriangle, CheckCircle, XCircle,
  Clock, TrendingUp, Car, Users, FileSpreadsheet, Database,
  ChevronUp, ChevronDown, Info, Loader2
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";

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

  const { data: openData, isLoading: loadingOpen } = useQuery<{ data: any[]; total: number; enterpriseCount: number; holmanNonEnterpriseCount: number; view: string }>({
    queryKey: ["/api/rental-ops/open", showRaw ? "raw" : "business"],
    queryFn: () => fetch(`/api/rental-ops/open${showRaw ? "?view=raw" : ""}`, { credentials: "include" }).then(r => r.json()),
    enabled: activeTab === "open" || activeTab === "position",
    staleTime: 5 * 60 * 1000,
  });

  const { data: closedData, isLoading: loadingClosed } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/rental-ops/closed"],
    enabled: activeTab === "closed" || activeTab === "extensions",
    staleTime: 5 * 60 * 1000,
  });

  const { data: ticketData, isLoading: loadingTickets } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/rental-ops/tickets"],
    enabled: activeTab === "tickets",
    staleTime: 5 * 60 * 1000,
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<any>({
    queryKey: ["/api/rental-ops/summary"],
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
        <div className="flex items-center gap-2 flex-wrap">
          <BackButton />
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Database className="h-4 w-4" />
            <span>Snowflake Pipeline Tables</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
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

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 md:grid-cols-5 h-auto gap-1 mb-4">
            <TabsTrigger value="open">Open Rentals</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
            <TabsTrigger value="tickets">Open Tickets</TabsTrigger>
            <TabsTrigger value="extensions">Extensions</TabsTrigger>
            <TabsTrigger value="position">Position Report</TabsTrigger>
          </TabsList>

          {/* Open Rentals Tab */}
          <TabsContent value="open">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base">Open Rentals</CardTitle>
                  <Badge variant="secondary">{sortedOpen.length}</Badge>

                  {/* Source filter */}
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
                          <TableCell className="font-mono text-xs">
                            {r.holmanPoNumber || "—"}
                          </TableCell>
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
        </Tabs>

        {/* Data Quality Detail */}
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
      </div>
    </MainContent>
  );
}
