import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import {
  TrendingUp, TrendingDown, Minus, Search, RefreshCw,
  ChevronUp, ChevronDown, DollarSign, Users, AlertTriangle,
  Info, Loader2
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { queryClient } from "@/lib/queryClient";

const DAILY_RENTAL_COST = 80;

function fmt$(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtFull$(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    const parsed = parseISO(String(d));
    if (isValid(parsed)) return format(parsed, "MM/dd/yyyy");
    return String(d).slice(0, 10);
  } catch { return String(d).slice(0, 10); }
}

function DaysBadge({ days }: { days: number }) {
  if (days >= 28) return <Badge className="bg-red-600 text-white text-xs">{days}d</Badge>;
  if (days >= 21) return <Badge className="bg-orange-500 text-white text-xs">{days}d</Badge>;
  if (days >= 14) return <Badge className="bg-yellow-500 text-black text-xs">{days}d</Badge>;
  return <Badge className="bg-green-600 text-white text-xs">{days}d</Badge>;
}

function StatusBadge({ status, adjNet }: { status: string; adjNet?: number }) {
  if (status === "Profitable") {
    return (
      <Badge className="bg-green-600 text-white text-xs gap-1">
        <TrendingUp className="h-3 w-3" /> Profitable
      </Badge>
    );
  }
  if (status === "Marginal") {
    return (
      <Badge className="bg-yellow-500 text-black text-xs gap-1">
        <Minus className="h-3 w-3" /> Marginal
      </Badge>
    );
  }
  if (status === "Underwater") {
    return (
      <Badge className="bg-red-600 text-white text-xs gap-1">
        <TrendingDown className="h-3 w-3" /> Underwater
      </Badge>
    );
  }
  return <Badge variant="secondary" className="text-xs">No Data</Badge>;
}

function SortBtn({ field, sort, onSort }: { field: string; sort: { field: string; dir: "asc" | "desc" }; onSort: (f: string) => void }) {
  const active = sort.field === field;
  return (
    <button className="ml-1 opacity-50 hover:opacity-100" onClick={() => onSort(field)}>
      {active ? (
        sort.dir === "asc" ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />
      ) : (
        <ChevronUp className="h-3 w-3 inline opacity-30" />
      )}
    </button>
  );
}

interface ProfitData {
  hasData: boolean;
  daysOpen: number;
  completes: number;
  totalSos: number;
  totalRevenue: number;
  laborRevenue: number;
  partsRevenue: number;
  otherRevenue: number;
  laborDirect: number;
  laborBenefits: number;
  partsCogs: number;
  partsShipping: number;
  truckExpense: number;
  pptProfit: number;
  rentalCost: number;
  fuelEst: number;
  adjNet: number;
  status: string;
}

interface RentalRow {
  vehicleNumber: string;
  vehicleNumberPadded?: string;
  renterName: string;
  enterpriseId: string | null;
  enterpriseIdSource?: string | null;
  ticketNumber?: string | null;
  poNumber?: string | null;
  rentalVendor?: string | null;
  originalStartDate?: string | null;
  rentalStartDate?: string | null;
  daysOpen: number;
  source: string;
  profit?: ProfitData | null;
}

export default function TechProfitability() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "adjNet", dir: "asc" });
  const [statusFilter, setStatusFilter] = useState<"all" | "Profitable" | "Marginal" | "Underwater" | "No Data">("all");

  const fetchJson = async (url: string) => {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t}`); }
    return r.json();
  };

  const { data: openData, isLoading: loadingOpen, isError: openError, refetch: refetchOpen } = useQuery<{ data: RentalRow[]; total: number }>({
    queryKey: ["/api/rental-ops/open", "business", true],
    queryFn: () => fetchJson("/api/rental-ops/open?includeOos=true"),
    staleTime: 5 * 60 * 1000,
  });

  const techsParam = useMemo(() => {
    if (!openData?.data) return null;
    const techs = openData.data
      .filter(r => r.enterpriseId && r.daysOpen > 0)
      .map(r => ({ id: r.enterpriseId!.toUpperCase(), daysOpen: r.daysOpen }));
    if (techs.length === 0) return null;
    return JSON.stringify(techs);
  }, [openData]);

  const { data: profitData, isLoading: loadingProfit, isError: profitError, refetch: refetchProfit } = useQuery<{ profitability: Record<string, ProfitData> }>({
    queryKey: ["/api/rental-ops/profitability", techsParam],
    queryFn: () => fetchJson(`/api/rental-ops/profitability?techs=${encodeURIComponent(techsParam!)}`),
    enabled: !!techsParam,
    staleTime: 5 * 60 * 1000,
  });

  const merged: RentalRow[] = useMemo(() => {
    if (!openData?.data) return [];
    const pMap = profitData?.profitability ?? {};
    return openData.data.map(r => {
      const eid = r.enterpriseId?.toUpperCase() ?? null;
      const profit = eid ? (pMap[eid] ?? null) : null;
      return { ...r, profit };
    });
  }, [openData, profitData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return merged.filter(r => {
      const matchSearch = !q
        || (r.vehicleNumber || "").toLowerCase().includes(q)
        || (r.renterName || "").toLowerCase().includes(q)
        || (r.enterpriseId || "").toLowerCase().includes(q)
        || (r.poNumber || "").toLowerCase().includes(q)
        || (r.ticketNumber || "").toLowerCase().includes(q);
      const status = r.profit?.status ?? "No Data";
      const matchStatus = statusFilter === "all" || status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [merged, search, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: any, bv: any;
      switch (sort.field) {
        case "vehicleNumber": av = a.vehicleNumber || ""; bv = b.vehicleNumber || ""; break;
        case "renterName": av = a.renterName || ""; bv = b.renterName || ""; break;
        case "enterpriseId": av = a.enterpriseId || ""; bv = b.enterpriseId || ""; break;
        case "daysOpen": av = a.daysOpen || 0; bv = b.daysOpen || 0; break;
        case "totalRevenue": av = a.profit?.totalRevenue ?? -Infinity; bv = b.profit?.totalRevenue ?? -Infinity; break;
        case "pptProfit": av = a.profit?.pptProfit ?? -Infinity; bv = b.profit?.pptProfit ?? -Infinity; break;
        case "rentalCost": av = a.profit?.rentalCost ?? -Infinity; bv = b.profit?.rentalCost ?? -Infinity; break;
        case "truckExpense": av = a.profit?.truckExpense ?? -Infinity; bv = b.profit?.truckExpense ?? -Infinity; break;
        case "adjNet": av = a.profit?.adjNet ?? -Infinity; bv = b.profit?.adjNet ?? -Infinity; break;
        case "status": av = a.profit?.status ?? "No Data"; bv = b.profit?.status ?? "No Data"; break;
        default: av = a.renterName || ""; bv = b.renterName || "";
      }
      if (typeof av === "string") return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sort.dir === "asc" ? (av - bv) : (bv - av);
    });
  }, [filtered, sort]);

  function handleSort(field: string) {
    setSort(prev => prev.field === field
      ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { field, dir: "asc" }
    );
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/open"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rental-ops/profitability"] });
    refetchOpen();
  }

  const counts = useMemo(() => {
    const all = merged;
    return {
      total: all.length,
      profitable: all.filter(r => r.profit?.status === "Profitable").length,
      marginal: all.filter(r => r.profit?.status === "Marginal").length,
      underwater: all.filter(r => r.profit?.status === "Underwater").length,
      noData: all.filter(r => !r.profit || r.profit.status === "No Data").length,
    };
  }, [merged]);

  const isLoading = loadingOpen;

  return (
    <TooltipProvider>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tech Profitability</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Open rental cost vs. technician revenue — Method B (Adj Net = PPT + Truck − Fuel − Rental)
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total Renters", value: counts.total, color: "text-foreground", bg: "bg-card", onClick: () => setStatusFilter("all") },
            { label: "Profitable", value: counts.profitable, color: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30", onClick: () => setStatusFilter("Profitable") },
            { label: "Marginal", value: counts.marginal, color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/30", onClick: () => setStatusFilter("Marginal") },
            { label: "Underwater", value: counts.underwater, color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", onClick: () => setStatusFilter("Underwater") },
            { label: "No Data", value: counts.noData, color: "text-muted-foreground", bg: "bg-muted/40", onClick: () => setStatusFilter("No Data") },
          ].map(c => (
            <button
              key={c.label}
              onClick={c.onClick}
              className={`rounded-lg border p-3 text-left transition-all hover:ring-2 hover:ring-primary/30 ${c.bg} ${statusFilter === (c.label === "Total Renters" ? "all" : c.label) ? "ring-2 ring-primary" : ""}`}
            >
              <div className={`text-2xl font-bold ${c.color}`}>
                {isLoading ? <Skeleton className="h-7 w-10" /> : c.value}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search vehicle, renter, ID..."
                  className="pl-9 h-9"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {statusFilter !== "all" && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setStatusFilter("all")}
                >
                  {statusFilter} ×
                </Badge>
              )}
              {loadingProfit && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading profitability…
                </div>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {sorted.length} of {merged.length} rows
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {openError ? (
              <div className="p-8 text-center text-red-500 flex items-center justify-center gap-2">
                <AlertTriangle className="h-5 w-5" /> Failed to load open rentals data
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="whitespace-nowrap">Vehicle #<SortBtn field="vehicleNumber" sort={sort} onSort={handleSort} /></TableHead>
                      <TableHead className="whitespace-nowrap">Tech / Renter<SortBtn field="renterName" sort={sort} onSort={handleSort} /></TableHead>
                      <TableHead className="whitespace-nowrap">Enterprise ID<SortBtn field="enterpriseId" sort={sort} onSort={handleSort} /></TableHead>
                      <TableHead className="whitespace-nowrap">Ticket / PO</TableHead>
                      <TableHead className="whitespace-nowrap">Start Date</TableHead>
                      <TableHead className="whitespace-nowrap">Days Open<SortBtn field="daysOpen" sort={sort} onSort={handleSort} /></TableHead>
                      <TableHead className="whitespace-nowrap">Source</TableHead>
                      <TableHead className="whitespace-nowrap border-l">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Total Rev<Info className="h-3 w-3 inline ml-1 opacity-50" /></span>
                          </TooltipTrigger>
                          <TooltipContent>Total revenue from SOs within the rental period</TooltipContent>
                        </Tooltip>
                        <SortBtn field="totalRevenue" sort={sort} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">PPT Profit<Info className="h-3 w-3 inline ml-1 opacity-50" /></span>
                          </TooltipTrigger>
                          <TooltipContent>Revenue − Labor − Benefits − Parts − Shipping − Truck</TooltipContent>
                        </Tooltip>
                        <SortBtn field="pptProfit" sort={sort} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Rental Cost<Info className="h-3 w-3 inline ml-1 opacity-50" /></span>
                          </TooltipTrigger>
                          <TooltipContent>$80/day × Days Open</TooltipContent>
                        </Tooltip>
                        <SortBtn field="rentalCost" sort={sort} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Truck Exp<Info className="h-3 w-3 inline ml-1 opacity-50" /></span>
                          </TooltipTrigger>
                          <TooltipContent>Total truck allocation expense from IHR unit economics</TooltipContent>
                        </Tooltip>
                        <SortBtn field="truckExpense" sort={sort} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Adj Net<Info className="h-3 w-3 inline ml-1 opacity-50" /></span>
                          </TooltipTrigger>
                          <TooltipContent>PPT + Truck − (Completes × $10 fuel) − Rental Cost</TooltipContent>
                        </Tooltip>
                        <SortBtn field="adjNet" sort={sort} onSort={handleSort} />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Status<SortBtn field="status" sort={sort} onSort={handleSort} />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 13 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : sorted.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center text-muted-foreground py-12">
                          No rows match your search
                        </TableCell>
                      </TableRow>
                    ) : (
                      sorted.map((r, i) => {
                        const p = r.profit;
                        const startDate = r.originalStartDate || r.rentalStartDate;
                        const hasProfit = p && p.hasData;
                        const adjNetColor = !hasProfit ? "" :
                          p!.adjNet < 0 ? "text-red-600 dark:text-red-400 font-semibold" :
                          p!.adjNet <= 5000 ? "text-yellow-700 dark:text-yellow-400 font-semibold" :
                          "text-green-700 dark:text-green-400 font-semibold";
                        return (
                          <TableRow key={i} className="text-xs hover:bg-muted/40">
                            <TableCell className="font-mono">{r.vehicleNumber || "—"}</TableCell>
                            <TableCell className="max-w-[160px]">
                              <span className="truncate block">{r.renterName || "—"}</span>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.enterpriseId || "—"}</TableCell>
                            <TableCell className="font-mono text-xs max-w-[120px] truncate">
                              {r.ticketNumber || r.poNumber || "—"}
                            </TableCell>
                            <TableCell>{formatDate(startDate ?? null)}</TableCell>
                            <TableCell><DaysBadge days={r.daysOpen || 0} /></TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                                {r.source === "enterprise" ? "Enterprise" : r.source === "holman_non_enterprise" ? "Holman" : r.source}
                              </Badge>
                            </TableCell>
                            {/* Profitability columns */}
                            <TableCell className="border-l font-mono">
                              {loadingProfit ? <Skeleton className="h-4 w-14" /> : hasProfit ? fmt$(p!.totalRevenue) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono">
                              {loadingProfit ? <Skeleton className="h-4 w-14" /> : hasProfit ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={p!.pptProfit < 0 ? "text-red-600 dark:text-red-400" : ""}>{fmt$(p!.pptProfit)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="space-y-1 text-xs min-w-[200px]">
                                    <div className="font-semibold mb-1">PPT Waterfall</div>
                                    <div className="flex justify-between gap-4"><span>Revenue</span><span>{fmtFull$(p!.totalRevenue)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Labor Direct</span><span>{fmtFull$(-p!.laborDirect)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Benefits</span><span>{fmtFull$(-p!.laborBenefits)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Parts COGS</span><span>{fmtFull$(-p!.partsCogs)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Shipping</span><span>{fmtFull$(-p!.partsShipping)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Truck</span><span>{fmtFull$(-p!.truckExpense)}</span></div>
                                    <div className="flex justify-between gap-4 font-semibold border-t pt-1"><span>= PPT Profit</span><span>{fmtFull$(p!.pptProfit)}</span></div>
                                    <div className="text-muted-foreground pt-1">{p!.completes} complete SOs / {p!.totalSos} total SOs</div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono text-muted-foreground">
                              {loadingProfit ? <Skeleton className="h-4 w-14" /> : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{fmt$(r.daysOpen * DAILY_RENTAL_COST)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {r.daysOpen} days × ${DAILY_RENTAL_COST}/day = {fmtFull$(r.daysOpen * DAILY_RENTAL_COST)}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell className="font-mono">
                              {loadingProfit ? <Skeleton className="h-4 w-14" /> : hasProfit ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{fmt$(p!.truckExpense)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Fuel est: {fmtFull$(p!.fuelEst)} ({p!.completes} × $10)<br/>
                                    Truck − Fuel: {fmtFull$(p!.truckExpense - p!.fuelEst)}
                                  </TooltipContent>
                                </Tooltip>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className={`font-mono ${adjNetColor}`}>
                              {loadingProfit ? <Skeleton className="h-4 w-16" /> : hasProfit ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{fmt$(p!.adjNet)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="space-y-1 text-xs min-w-[220px]">
                                    <div className="font-semibold mb-1">Method B Adj Net</div>
                                    <div className="flex justify-between gap-4"><span>PPT Profit</span><span>{fmtFull$(p!.pptProfit)}</span></div>
                                    <div className="flex justify-between gap-4"><span>+ Truck Expense</span><span>{fmtFull$(p!.truckExpense)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Fuel Est ({p!.completes}×$10)</span><span>{fmtFull$(-p!.fuelEst)}</span></div>
                                    <div className="flex justify-between gap-4"><span>− Rental Cost</span><span>{fmtFull$(-p!.rentalCost)}</span></div>
                                    <div className="flex justify-between gap-4 font-semibold border-t pt-1"><span>= Adj Net</span><span>{fmtFull$(p!.adjNet)}</span></div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {loadingProfit
                                ? <Skeleton className="h-5 w-20" />
                                : <StatusBadge status={p?.status ?? "No Data"} adjNet={p?.adjNet} />
                              }
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>Source: <code className="bg-muted px-1 rounded">FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS</code> — filtered to each tech's rental window</p>
          <p>Rental cost = $80/day × Days Open · Fuel Est = Completed SOs × $10 · Adj Net = PPT + Truck − Fuel − Rental (Method B)</p>
          <p>Status: Profitable &gt; $5,000 · Marginal $0–$5,000 · Underwater &lt; $0</p>
        </div>
      </div>
    </TooltipProvider>
  );
}
