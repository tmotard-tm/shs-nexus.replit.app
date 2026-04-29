import { useMemo, useState, useRef, useEffect } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Search, RefreshCw, Plus, ExternalLink, Loader2,
  Upload, Download, FileSpreadsheet, Database,
  TruckIcon, BarChart3, Building2, AlertCircle, CheckCircle2, X,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { TruckDetailPanel } from "@/components/fleet-scope/TruckDetailPanel";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { MultiSelectFilter } from "@/components/fleet-scope/MultiSelectFilter";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";

type SortDir = "asc" | "desc" | null;
const NONE_MARKER = "__NONE_SELECTED__";

const SORT_PREFS_KEY = "activeRentals_sortPrefs";
interface SortPrefs { dateInRepairSort: SortDir; regExpirySort: SortDir; dailyNetSort: SortDir; adjNetSort: SortDir; }
function readSortPrefs(): SortPrefs {
  try {
    const raw = localStorage.getItem(SORT_PREFS_KEY);
    if (raw) return JSON.parse(raw) as SortPrefs;
  } catch {}
  return { dateInRepairSort: null, regExpirySort: null, dailyNetSort: null, adjNetSort: null };
}

const FILTER_PREFS_KEY = "activeRentals_filterPrefs";
interface FilterPrefs {
  truckNumberFilter: string;
  stateFilter: string[];
  regionFilter: string[];
  byovFilter: string[];
  mainStatusMulti: string[];
  ownerFilter: string[];
  tpmsFilter: string[];
  repairedFilter: string[];
  amsFilter: string[];
  pickSlotFilter: string[];
  rentalReturnedFilter: string[];
  vanPickedUpFilter: string[];
  holmanStatusFilter: string[];
  regExpiryFilter: string[];
}
const DEFAULT_FILTER_PREFS: FilterPrefs = {
  truckNumberFilter: "",
  stateFilter: [],
  regionFilter: [],
  byovFilter: [],
  mainStatusMulti: [],
  ownerFilter: [],
  tpmsFilter: [],
  repairedFilter: [],
  amsFilter: [],
  pickSlotFilter: [],
  rentalReturnedFilter: [],
  vanPickedUpFilter: [],
  holmanStatusFilter: [],
  regExpiryFilter: [],
};
function readFilterPrefs(): FilterPrefs {
  try {
    const raw = localStorage.getItem(FILTER_PREFS_KEY);
    if (raw) return { ...DEFAULT_FILTER_PREFS, ...JSON.parse(raw) } as FilterPrefs;
  } catch {}
  return { ...DEFAULT_FILTER_PREFS };
}

/** True if the row's value passes a multi-select filter. Empty selection = no filter. */
function passesMulti(selected: string[], value: string | null | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  if (selected.length === 1 && selected[0] === NONE_MARKER) return false; // explicitly "none selected"
  return selected.includes(String(value ?? ""));
}
/** Y/N multi-select helper (boolean → "Y" / "N" / ""). */
function passesYn(selected: string[], v: boolean | null | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  if (selected.length === 1 && selected[0] === NONE_MARKER) return false;
  const label = v === true ? "Y" : v === false ? "N" : "";
  return selected.includes(label);
}

// ─── Types ────────────────────────────────────────────────────────────────────
// FS Truck shape — pulled from /api/fs/trucks. Every write goes back to the
// same row Fleet Scope reads, so changes here flow to FS automatically.

interface FSTruck {
  id: string;
  truckNumber: string;
  techState: string | null;
  techRegion: string | null;
  techName: string | null;
  techPhone: string | null;
  mainStatus: string | null;
  subStatus: string | null;
  shsOwner: string | null;
  snowflakeAssigned: boolean | null;
  datePutInRepair: string | null;
  holmanRegExpiry: string | null;
  repairCompleted: boolean | null;
  inAms: boolean | null;
  pickUpSlotBooked: boolean | null;
  rentalReturned: boolean | null;
  vanPickedUp: boolean | null;
  rentalStatus: string | null;
  expectedReturnDate: string | null;
  byov: boolean | null;
  [k: string]: any;
}

interface EnrichmentRow {
  enterpriseId: string;
  techName: string;
  techPhone: string | null;
  district: string | null;
  dailyNetWithRental: number | null;
  recommendation: string | null;
  scorecardScore: number | null;
  profitCheckedAt: string | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
}

interface SummaryResponse {
  totalActive: number;
  totalRentals: number;
  averageDurationDays: number;
  overdueCount: number;
  returnedThisWeek: number;
  byRegion: Record<string, number>;
  enrichment: {
    matchedToLdap: number;
    missingLdap: number;
    avgDailyNetWithRental: number | null;
    profitSampleSize: number;
    recommendationCounts: Record<string, number>;
  };
}

interface HolmanScraperStatus {
  status: string;
  lastScraped: string;
  location: string;
  primaryIssue: string;
  priority: string;
}

const ROWS_PER_PAGE = 50;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActiveRentalsDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lookupCostCenter } = useCostCenters();

  // Filters — top bar
  const [search, setSearch] = useState("");
  const [mainStatusFilter, setMainStatusFilter] = useState<string>("all");
  const [subStatusFilter, setSubStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Per-column header filters (mirror Fleet Scope's table-header MultiSelectFilters).
  // Initialized from localStorage so they survive navigation and refresh.
  const _initFilterPrefs = readFilterPrefs();
  const [truckNumberFilter, setTruckNumberFilter] = useState(_initFilterPrefs.truckNumberFilter);
  const [stateFilter, setStateFilter] = useState<string[]>(_initFilterPrefs.stateFilter);
  const [regionFilter, setRegionFilter] = useState<string[]>(_initFilterPrefs.regionFilter);
  const [byovFilter, setByovFilter] = useState<string[]>(_initFilterPrefs.byovFilter);
  const [mainStatusMulti, setMainStatusMulti] = useState<string[]>(_initFilterPrefs.mainStatusMulti);
  const [ownerFilter, setOwnerFilter] = useState<string[]>(_initFilterPrefs.ownerFilter);
  const [tpmsFilter, setTpmsFilter] = useState<string[]>(_initFilterPrefs.tpmsFilter);
  const [repairedFilter, setRepairedFilter] = useState<string[]>(_initFilterPrefs.repairedFilter);
  const [amsFilter, setAmsFilter] = useState<string[]>(_initFilterPrefs.amsFilter);
  const [pickSlotFilter, setPickSlotFilter] = useState<string[]>(_initFilterPrefs.pickSlotFilter);
  const [rentalReturnedFilter, setRentalReturnedFilter] = useState<string[]>(_initFilterPrefs.rentalReturnedFilter);
  const [vanPickedUpFilter, setVanPickedUpFilter] = useState<string[]>(_initFilterPrefs.vanPickedUpFilter);
  const [holmanStatusFilter, setHolmanStatusFilter] = useState<string[]>(_initFilterPrefs.holmanStatusFilter);
  const [regExpiryFilter, setRegExpiryFilter] = useState<string[]>(_initFilterPrefs.regExpiryFilter);
  // Sort directions on date columns (mirrors FS's per-column sort buttons)
  // Initialized from localStorage so they survive navigation and refresh.
  const _initSortPrefs = readSortPrefs();
  const [dateInRepairSort, setDateInRepairSort] = useState<SortDir>(_initSortPrefs.dateInRepairSort);
  const [regExpirySort, setRegExpirySort] = useState<SortDir>(_initSortPrefs.regExpirySort);
  const [dailyNetSort, setDailyNetSort] = useState<SortDir>(_initSortPrefs.dailyNetSort);
  const [adjNetSort, setAdjNetSort] = useState<SortDir>(_initSortPrefs.adjNetSort);
  useEffect(() => {
    localStorage.setItem(SORT_PREFS_KEY, JSON.stringify({ dateInRepairSort, regExpirySort, dailyNetSort, adjNetSort }));
  }, [dateInRepairSort, regExpirySort, dailyNetSort, adjNetSort]);
  useEffect(() => {
    localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({
      truckNumberFilter, stateFilter, regionFilter, byovFilter,
      mainStatusMulti, ownerFilter, tpmsFilter, repairedFilter,
      amsFilter, pickSlotFilter, rentalReturnedFilter, vanPickedUpFilter,
      holmanStatusFilter, regExpiryFilter,
    }));
  }, [
    truckNumberFilter, stateFilter, regionFilter, byovFilter,
    mainStatusMulti, ownerFilter, tpmsFilter, repairedFilter,
    amsFilter, pickSlotFilter, rentalReturnedFilter, vanPickedUpFilter,
    holmanStatusFilter, regExpiryFilter,
  ]);

  // Detail panel
  const [detailTruckId, setDetailTruckId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Toolbar dialog state — every dialog hits the SAME FS endpoint as the FS
  // Dashboard, so syncing on either side affects the same data.
  const [importDlgOpen, setImportDlgOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<any>(null);
  const [shopListDlgOpen, setShopListDlgOpen] = useState(false);
  const [shopListFile, setShopListFile] = useState<File | null>(null);
  const [shopListResults, setShopListResults] = useState<any>(null);
  const [syncTechDlgOpen, setSyncTechDlgOpen] = useState(false);
  const [syncTechResults, setSyncTechResults] = useState<any>(null);
  const [upsDlgOpen, setUpsDlgOpen] = useState(false);
  const [upsResults, setUpsResults] = useState<any>(null);
  const [consolidateDlgOpen, setConsolidateDlgOpen] = useState(false);
  const [consolidateText, setConsolidateText] = useState("");
  const [consolidateResults, setConsolidateResults] = useState<any>(null);
  const [bulkSyncDlgOpen, setBulkSyncDlgOpen] = useState(false);
  const [bulkSyncInput, setBulkSyncInput] = useState("");
  const [bulkSyncResults, setBulkSyncResults] = useState<any>(null);

  // ── Reads — same endpoints Fleet Scope itself reads ──
  const trucksQuery = useQuery<FSTruck[]>({
    queryKey: ["/api/fs/trucks"],
    refetchInterval: 60_000,
  });
  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ["/api/vrm/active-rentals-dashboard/summary"],
    refetchInterval: 60_000,
  });
  const enrichmentQuery = useQuery<{ byNormalizedTruckNumber: Record<string, EnrichmentRow> }>({
    queryKey: ["/api/vrm/active-rentals-dashboard/enrichment"],
    refetchInterval: 5 * 60_000,
  });
  const scraperStatusQuery = useQuery<Record<string, HolmanScraperStatus>>({
    queryKey: ["/api/fs/trucks/scraper-status"],
    refetchInterval: 5 * 60_000,
  });
  const shopListStatusQuery = useQuery<{
    processedAt: string; rowsProcessed: number; trucksUpdated: number;
    rowsSkipped: number; notFound: string[]; error: string | null;
  }>({
    queryKey: ["/api/fs/shop-list-status"],
    refetchInterval: 60_000,
  });

  const trucks = trucksQuery.data ?? [];
  const summary = summaryQuery.data;
  const enrichmentMap = enrichmentQuery.data?.byNormalizedTruckNumber ?? {};
  const scraperStatusMap = scraperStatusQuery.data ?? {};

  // ── Invalidate all FS + VRM caches after any mutation succeeds ──
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
    qc.invalidateQueries({ queryKey: ["/api/fs/rentals/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/active-rentals-dashboard/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/active-rentals-dashboard/enrichment"] });
    qc.invalidateQueries({ queryKey: ["/api/fs/shop-list-status"] });
  };

  // ── Inline edits — same PATCH route Fleet Scope uses ──
  const inlineEditMutation = useMutation({
    mutationFn: async ({ truckId, field, value }: { truckId: string; field: string; value: any }) => {
      const r = await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { [field]: value });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: invalidateAll,
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const saveField = (truckId: string, field: string, value: any) => {
    qc.setQueryData<FSTruck[]>(["/api/fs/trucks"], (prev) =>
      prev ? prev.map((t) => (t.id === truckId ? { ...t, [field]: value } : t)) : prev
    );
    inlineEditMutation.mutate({ truckId, field, value });
  };

  const saveMainStatus = (truck: FSTruck, newMain: string) => {
    saveField(truck.id, "mainStatus", newMain);
    if (newMain === "Approved for sale" && truck.shsOwner !== "Oscar S") {
      saveField(truck.id, "shsOwner", "Oscar S");
    }
  };

  // ── Sync mutations — every one hits the SAME FS endpoint, so a sync from
  //    here is identical to a sync from Fleet Scope's own dashboard. ──
  const syncRentalsMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/fs/rental-sync", {});
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => {
      invalidateAll();
      toast({ title: "Sync Rentals complete", description: d?.message ?? "Synced from Snowflake" });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const syncDeclinedMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/fs/pos/sync-declined-repairs", {});
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => {
      invalidateAll();
      toast({ title: "Sync Declined complete", description: `${d?.updated ?? 0} updated, ${d?.alreadyDeclined ?? 0} already declined` });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (trucks: any[]) => {
      const r = await apiRequest("POST", "/api/fs/trucks/bulk-import", { trucks });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setImportResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const shopListMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/fs/shop-list-import", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setShopListResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Shop List import failed", description: e.message, variant: "destructive" }),
  });

  const syncTechMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/fs/snowflake/sync-tech-data", {});
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setSyncTechResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Sync Tech Data failed", description: e.message, variant: "destructive" }),
  });

  const upsMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/fs/tracking/refresh-all", {});
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setUpsResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Refresh UPS failed", description: e.message, variant: "destructive" }),
  });

  const consolidateMutation = useMutation({
    mutationFn: async (entries: Array<{ truckNumber: string; dateInRepair?: string }>) => {
      const r = await apiRequest("POST", "/api/fs/trucks/consolidate", { entries, consolidatedBy: "Active Rentals Page" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setConsolidateResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Consolidate failed", description: e.message, variant: "destructive" }),
  });

  const bulkSyncMutation = useMutation({
    mutationFn: async (truckNumbers: string[]) => {
      const r = await apiRequest("POST", "/api/fs/trucks/bulk-sync", { truckNumbers, syncedBy: "Active Rentals Page" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (d: any) => { setBulkSyncResults(d); invalidateAll(); },
    onError: (e: any) => toast({ title: "Bulk sync failed", description: e.message, variant: "destructive" }),
  });

  // ── Derived ──
  const subOptionsForFilter = useMemo(() => {
    if (mainStatusFilter === "all") return [] as readonly string[];
    return (SUB_STATUSES as any)[mainStatusFilter as MainStatus] ?? [];
  }, [mainStatusFilter]);

  // Build option lists for column-header MultiSelectFilters from actual data.
  const columnOptions = useMemo(() => {
    const states = new Set<string>();
    const regions = new Set<string>();
    const owners = new Set<string>();
    const holmanStatuses = new Set<string>();
    const regExpiries = new Set<string>();
    for (const t of trucks) {
      if (t.techState) states.add(t.techState);
      if (t.techRegion) regions.add(t.techRegion);
      if (t.shsOwner) owners.add(t.shsOwner);
      const sc = scraperStatusMap[t.truckNumber];
      if (sc?.status) holmanStatuses.add(sc.status);
      if (t.holmanRegExpiry) regExpiries.add(t.holmanRegExpiry);
    }
    return {
      states: Array.from(states).sort(),
      regions: Array.from(regions).sort(),
      owners: Array.from(owners).sort(),
      holmanStatuses: Array.from(holmanStatuses).sort(),
      regExpiries: Array.from(regExpiries).sort(),
      byov: ["Yes", "No"],
      yn: ["Y", "N"],
      mainStatuses: [...MAIN_STATUSES],
    };
  }, [trucks, scraperStatusMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tnq = truckNumberFilter.trim().toLowerCase();
    const result = trucks.filter((t) => {
      // Top filter bar
      if (mainStatusFilter !== "all" && t.mainStatus !== mainStatusFilter) return false;
      if (subStatusFilter !== "all" && t.subStatus !== subStatusFilter) return false;
      // Column-header filters
      if (tnq && !(t.truckNumber ?? "").toLowerCase().includes(tnq)) return false;
      if (!passesMulti(stateFilter, t.techState)) return false;
      if (!passesMulti(regionFilter, t.techRegion)) return false;
      if (byovFilter.length > 0) {
        const isByov = !!t.byov;
        if (byovFilter.length === 1 && byovFilter[0] === NONE_MARKER) return false;
        if (!byovFilter.includes(isByov ? "Yes" : "No")) return false;
      }
      if (!passesMulti(mainStatusMulti, t.mainStatus)) return false;
      if (!passesMulti(ownerFilter, t.shsOwner)) return false;
      if (!passesYn(tpmsFilter, t.snowflakeAssigned)) return false;
      if (!passesYn(repairedFilter, t.repairCompleted)) return false;
      if (!passesYn(amsFilter, t.inAms)) return false;
      if (!passesYn(pickSlotFilter, t.pickUpSlotBooked)) return false;
      if (!passesYn(rentalReturnedFilter, t.rentalReturned)) return false;
      if (!passesYn(vanPickedUpFilter, t.vanPickedUp)) return false;
      if (!passesMulti(regExpiryFilter, t.holmanRegExpiry)) return false;
      const sc = scraperStatusMap[t.truckNumber];
      if (!passesMulti(holmanStatusFilter, sc?.status ?? "")) return false;
      // Free-text search across multiple fields
      if (!q) return true;
      const norm = (t.truckNumber ?? "").replace(/^0+/, "");
      const enr = enrichmentMap[norm];
      return (
        (t.truckNumber ?? "").toLowerCase().includes(q) ||
        (t.techName ?? "").toLowerCase().includes(q) ||
        (t.mainStatus ?? "").toLowerCase().includes(q) ||
        (t.subStatus ?? "").toLowerCase().includes(q) ||
        (t.shsOwner ?? "").toLowerCase().includes(q) ||
        (t.techState ?? "").toLowerCase().includes(q) ||
        (enr?.enterpriseId ?? "").toLowerCase().includes(q) ||
        (enr?.district ?? "").toLowerCase().includes(q)
      );
    });
    // Sort if a date-column sort is active. Date In Repair takes precedence
    // (Fleet Scope's behavior — last-clicked-sort wins).
    const cmpDate = (a: string | null | undefined, b: string | null | undefined, dir: SortDir) => {
      if (!dir) return 0;
      const av = a ? new Date(a).getTime() : 0;
      const bv = b ? new Date(b).getTime() : 0;
      return (av - bv) * (dir === "asc" ? 1 : -1);
    };
    const cmpNum = (a: number | null | undefined, b: number | null | undefined, dir: SortDir) => {
      if (!dir) return 0;
      const aNull = a == null || !Number.isFinite(a);
      const bNull = b == null || !Number.isFinite(b);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return ((a as number) - (b as number)) * (dir === "asc" ? 1 : -1);
    };
    if (dateInRepairSort) {
      result.sort((a, b) => cmpDate(a.datePutInRepair, b.datePutInRepair, dateInRepairSort));
    } else if (regExpirySort) {
      result.sort((a, b) => cmpDate(a.holmanRegExpiry, b.holmanRegExpiry, regExpirySort));
    } else if (dailyNetSort) {
      result.sort((a, b) => {
        const ae = enrichmentMap[(a.truckNumber ?? "").replace(/^0+/, "")];
        const be = enrichmentMap[(b.truckNumber ?? "").replace(/^0+/, "")];
        return cmpNum(ae?.dailyNetWithRental ?? null, be?.dailyNetWithRental ?? null, dailyNetSort);
      });
    } else if (adjNetSort) {
      result.sort((a, b) => {
        const ae = enrichmentMap[(a.truckNumber ?? "").replace(/^0+/, "")];
        const be = enrichmentMap[(b.truckNumber ?? "").replace(/^0+/, "")];
        const av = ae?.gate1AdjustedNet != null ? Number(ae.gate1AdjustedNet) : null;
        const bv = be?.gate1AdjustedNet != null ? Number(be.gate1AdjustedNet) : null;
        return cmpNum(av, bv, adjNetSort);
      });
    }
    return result;
  }, [
    trucks, search, mainStatusFilter, subStatusFilter, enrichmentMap, scraperStatusMap,
    truckNumberFilter, stateFilter, regionFilter, byovFilter, mainStatusMulti, ownerFilter,
    tpmsFilter, repairedFilter, amsFilter, pickSlotFilter, rentalReturnedFilter,
    vanPickedUpFilter, regExpiryFilter, holmanStatusFilter, dateInRepairSort, regExpirySort,
    dailyNetSort, adjNetSort,
  ]);

  const cycleSort = (cur: SortDir): SortDir => cur === null ? "asc" : cur === "asc" ? "desc" : null;
  const SortIcon = ({ dir }: { dir: SortDir }) =>
    dir === "asc" ? <ArrowUp className="w-3 h-3" />
    : dir === "desc" ? <ArrowDown className="w-3 h-3" />
    : <ArrowUpDown className="w-3 h-3 opacity-50" />;

  const clearAllColumnFilters = () => {
    setTruckNumberFilter(""); setStateFilter([]); setRegionFilter([]); setByovFilter([]);
    setMainStatusMulti([]); setOwnerFilter([]); setTpmsFilter([]); setRepairedFilter([]);
    setAmsFilter([]); setPickSlotFilter([]); setRentalReturnedFilter([]); setVanPickedUpFilter([]);
    setHolmanStatusFilter([]); setRegExpiryFilter([]); setDateInRepairSort(null); setRegExpirySort(null);
    setDailyNetSort(null); setAdjNetSort(null);
    localStorage.removeItem(FILTER_PREFS_KEY);
    localStorage.removeItem(SORT_PREFS_KEY);
  };
  const anyColumnFilterActive =
    !!truckNumberFilter || stateFilter.length > 0 || regionFilter.length > 0 || byovFilter.length > 0 ||
    mainStatusMulti.length > 0 || ownerFilter.length > 0 || tpmsFilter.length > 0 ||
    repairedFilter.length > 0 || amsFilter.length > 0 || pickSlotFilter.length > 0 ||
    rentalReturnedFilter.length > 0 || vanPickedUpFilter.length > 0 ||
    holmanStatusFilter.length > 0 || regExpiryFilter.length > 0 ||
    dateInRepairSort !== null || regExpirySort !== null || dailyNetSort !== null || adjNetSort !== null;

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * ROWS_PER_PAGE;
  const pageRows = filtered.slice(pageStart, pageStart + ROWS_PER_PAGE);

  const topStates = useMemo(() => {
    if (!summary?.byRegion) return [] as Array<[string, number]>;
    return Object.entries(summary.byRegion)
      .filter(([k]) => k !== "Unknown")
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
  }, [summary?.byRegion]);

  // ── Import / Shop List parsers ──
  const handleImportSubmit = async () => {
    if (!importFile) return;
    const Papa = (await import("papaparse")).default as any;
    const text = await importFile.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    importMutation.mutate(parsed.data ?? []);
  };

  // ── Render ──
  return (
    <TooltipProvider>
      <div className="p-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Active Rentals (Rentals Dashboard)</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Mirror of Fleet Scope's rental dashboard. Same data, same syncs — every action below uses the same Fleet Scope endpoint, so a change here flows to Fleet Scope and vice versa.
            </p>
          </div>
        </div>

        {/* Toolbar — same actions as Fleet Scope (LucaAI/call buttons skipped). */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button
            variant="outline" size="sm"
            onClick={() => syncRentalsMutation.mutate()}
            disabled={syncRentalsMutation.isPending}
            data-testid="button-sync-rentals"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${syncRentalsMutation.isPending ? "animate-spin" : ""}`} />
            Sync Rentals
          </Button>

          <Button variant="outline" size="sm" onClick={() => {
            const isFiltered = search.trim() !== "" || mainStatusFilter !== "all" || subStatusFilter !== "all" || truckNumberFilter !== "" || stateFilter.length > 0 || regionFilter.length > 0 || byovFilter.length > 0 || (mainStatusMulti ?? []).length > 0 || ownerFilter.length > 0 || tpmsFilter.length > 0 || repairedFilter.length > 0 || amsFilter.length > 0 || pickSlotFilter.length > 0 || rentalReturnedFilter.length > 0 || vanPickedUpFilter.length > 0 || holmanStatusFilter.length > 0 || regExpiryFilter.length > 0;
            exportToCsv(filtered, enrichmentMap, isFiltered);
          }} data-testid="button-export">
            <Download className="w-3 h-3 mr-1" /> Export
          </Button>

          {/* Import dialog — POST /api/fs/trucks/bulk-import */}
          <Dialog open={importDlgOpen} onOpenChange={setImportDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-import"><Upload className="w-3 h-3 mr-1" /> Import</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import trucks (CSV)</DialogTitle>
                <DialogDescription>Same endpoint Fleet Scope uses: <code className="text-xs">POST /api/fs/trucks/bulk-import</code></DialogDescription>
              </DialogHeader>
              <input type="file" accept=".csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="text-sm" />
              {importResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Imported: {importResults.imported ?? 0} · Errors: {importResults.errors?.length ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button onClick={handleImportSubmit} disabled={!importFile || importMutation.isPending}>
                  {importMutation.isPending ? "Importing…" : "Import"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Shop List dialog — POST /api/fs/shop-list-import (multipart) */}
          <Dialog open={shopListDlgOpen} onOpenChange={setShopListDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-shop-list"><FileSpreadsheet className="w-3 h-3 mr-1" /> Shop List</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Shop List Import (XLSX/CSV)</DialogTitle>
                <DialogDescription>Updates Repair Location + Enterprise ID for trucks in the file (last 7 days).</DialogDescription>
              </DialogHeader>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setShopListFile(e.target.files?.[0] ?? null)} className="text-sm" />
              {shopListResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Updated: {shopListResults.trucksUpdated ?? 0} · Rows: {shopListResults.rowsProcessed ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => shopListFile && shopListMutation.mutate(shopListFile)} disabled={!shopListFile || shopListMutation.isPending}>
                  {shopListMutation.isPending ? "Importing…" : "Import"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Sync Tech Data — POST /api/fs/snowflake/sync-tech-data */}
          <Dialog open={syncTechDlgOpen} onOpenChange={setSyncTechDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-sync-tech-data"><Database className="w-3 h-3 mr-1" /> Sync Tech Data</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Sync Tech Data from Snowflake</DialogTitle>
                <DialogDescription>Refreshes tech name, phone, and TPMS assignment from TPMS_EXTRACT.</DialogDescription>
              </DialogHeader>
              {syncTechResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Updated: {syncTechResults.updated ?? 0} · Checked: {syncTechResults.trucksChecked ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => syncTechMutation.mutate()} disabled={syncTechMutation.isPending}>
                  {syncTechMutation.isPending ? "Syncing…" : "Run sync"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Refresh UPS — POST /api/fs/tracking/refresh-all */}
          <Dialog open={upsDlgOpen} onOpenChange={setUpsDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-refresh-ups"><RefreshCw className="w-3 h-3 mr-1" /> Refresh UPS</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Refresh UPS tracking</DialogTitle>
                <DialogDescription>Polls UPS for the latest status on every active tracking record.</DialogDescription>
              </DialogHeader>
              {upsResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Updated: {upsResults.updated ?? 0} · Failed: {upsResults.failed ?? 0} · Total: {upsResults.total ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => upsMutation.mutate()} disabled={upsMutation.isPending}>
                  {upsMutation.isPending ? "Refreshing…" : "Refresh now"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Consolidate — POST /api/fs/trucks/consolidate */}
          <Dialog open={consolidateDlgOpen} onOpenChange={setConsolidateDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-consolidate"><CheckCircle2 className="w-3 h-3 mr-1" /> Consolidate</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Weekly Consolidate</DialogTitle>
                <DialogDescription>Paste 2-column data (Truck #, Date in Repair). Adds missing trucks, removes ones not in the list.</DialogDescription>
              </DialogHeader>
              <textarea
                value={consolidateText}
                onChange={(e) => setConsolidateText(e.target.value)}
                className="w-full h-40 p-2 border rounded font-mono text-xs"
                placeholder="46688\t2026-01-07&#10;37230\t2025-07-14&#10;..."
              />
              {consolidateResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Added: {consolidateResults.added ?? 0} · Removed: {consolidateResults.removed ?? 0} · Unchanged: {consolidateResults.unchanged ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button
                  onClick={() => consolidateMutation.mutate(parseConsolidateText(consolidateText))}
                  disabled={!consolidateText.trim() || consolidateMutation.isPending}
                >
                  {consolidateMutation.isPending ? "Running…" : "Run"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Bulk Sync — POST /api/fs/trucks/bulk-sync */}
          <Dialog open={bulkSyncDlgOpen} onOpenChange={setBulkSyncDlgOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-sync"><RefreshCw className="w-3 h-3 mr-1" /> Bulk Sync</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Bulk Sync truck numbers</DialogTitle>
                <DialogDescription>Adds missing trucks, removes ones not in your list.</DialogDescription>
              </DialogHeader>
              <textarea
                value={bulkSyncInput}
                onChange={(e) => setBulkSyncInput(e.target.value)}
                className="w-full h-40 p-2 border rounded font-mono text-xs"
                placeholder="One truck # per line, or comma-separated"
              />
              {bulkSyncResults && (
                <div className="text-sm bg-muted p-2 rounded">
                  Added: {bulkSyncResults.added?.length ?? 0} · Removed: {bulkSyncResults.removed?.length ?? 0}
                </div>
              )}
              <DialogFooter>
                <Button
                  onClick={() => {
                    const nums = bulkSyncInput.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
                    bulkSyncMutation.mutate(nums);
                  }}
                  disabled={!bulkSyncInput.trim() || bulkSyncMutation.isPending}
                >
                  {bulkSyncMutation.isPending ? "Syncing…" : "Sync"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            variant="outline" size="sm"
            onClick={() => syncDeclinedMutation.mutate()}
            disabled={syncDeclinedMutation.isPending}
            data-testid="button-sync-declined"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${syncDeclinedMutation.isPending ? "animate-spin" : ""}`} />
            Sync Declined
          </Button>

          <Link href="/fleet-scope/trucks/new">
            <Button data-testid="button-add-truck"><Plus className="w-4 h-4 mr-2" /> Add Truck</Button>
          </Link>
        </div>

        {shopListStatusQuery.data?.processedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <FileSpreadsheet className="w-3 h-3" />
            Shop List auto-sync:&nbsp;
            {shopListStatusQuery.data.error
              ? <span className="text-destructive font-medium">Failed — {shopListStatusQuery.data.error}</span>
              : <span>{shopListStatusQuery.data.trucksUpdated} updated · {shopListStatusQuery.data.rowsProcessed} rows · last run {fmtRelative(shopListStatusQuery.data.processedAt)}</span>
            }
          </div>
        )}

        {/* KPI cards — 3 wide, matching Fleet Scope's screenshot */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <Card className="p-3 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
            <div className="flex items-center gap-2 mb-1">
              <TruckIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Total Rentals</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary?.totalRentals ?? trucks.length}</p>
          </Card>
          <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Avg Duration</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{summary?.averageDurationDays ?? 0}d</p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">across active rentals</p>
          </Card>
          <Card className="p-3 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Top 5 States</span>
            </div>
            {topStates.length === 0 ? (
              <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">0</p>
            ) : (
              <div className="space-y-0.5">
                {topStates.map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{state}</span>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Outstanding Rentals + filter row */}
        <Card className="p-6">
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Outstanding Rentals:</span>
              <Badge variant="secondary" className="font-semibold">{trucks.length}</Badge>
              <span className="text-xs text-muted-foreground italic">(from Fleet Scope — source of truth)</span>
            </div>

            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search by truck number, tech, enterprise ID, district…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                  data-testid="input-search-active-rentals"
                />
              </div>

              <Select value={mainStatusFilter} onValueChange={(v) => { setMainStatusFilter(v); setSubStatusFilter("all"); setPage(1); }}>
                <SelectTrigger className="w-full md:w-[200px]" data-testid="select-main-status-filter">
                  <SelectValue placeholder="Main Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Main Statuses</SelectItem>
                  {MAIN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>

              {subOptionsForFilter.length > 0 && (
                <Select value={subStatusFilter} onValueChange={(v) => { setSubStatusFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-full md:w-[260px]" data-testid="select-sub-status-filter">
                    <SelectValue placeholder="Sub-Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sub-Statuses</SelectItem>
                    {subOptionsForFilter.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Table */}
          {trucksQuery.isLoading ? (
            <div className="text-center text-muted-foreground py-12">Loading fleet…</div>
          ) : trucksQuery.error ? (
            <div className="text-center text-destructive py-12">Failed to load: {(trucksQuery.error as Error).message}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 sticky top-0">
                    {/* Header row 1 — column labels */}
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 whitespace-nowrap">ID</th>
                      <th className="px-3 py-2 whitespace-nowrap">Truck #</th>
                      <th className="px-3 py-2 whitespace-nowrap">Tech Name</th>
                      <th className="px-3 py-2 whitespace-nowrap">Status</th>
                      <th className="px-3 py-2 whitespace-nowrap">Assigned To</th>
                      <th className="px-3 py-2 whitespace-nowrap">Enterprise ID</th>
                      <th className="px-3 py-2 whitespace-nowrap">District</th>
                      <th className="px-3 py-2 whitespace-nowrap">TPMS</th>
                      <th className="px-3 py-2 whitespace-nowrap">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => { setDateInRepairSort(cycleSort(dateInRepairSort)); setRegExpirySort(null); setDailyNetSort(null); setAdjNetSort(null); }}
                          data-testid="sort-date-in-repair"
                        >
                          Date In Repair <SortIcon dir={dateInRepairSort} />
                        </button>
                      </th>
                      <th className="px-3 py-2 whitespace-nowrap">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => { setRegExpirySort(cycleSort(regExpirySort)); setDateInRepairSort(null); setDailyNetSort(null); setAdjNetSort(null); }}
                          data-testid="sort-reg-expiry"
                        >
                          Reg. Expiry <SortIcon dir={regExpirySort} />
                        </button>
                      </th>
                      <th className="px-3 py-2 whitespace-nowrap">Repaired</th>
                      <th className="px-3 py-2 whitespace-nowrap">AMS</th>
                      <th className="px-3 py-2 whitespace-nowrap">Pick Slot</th>
                      <th className="px-3 py-2 whitespace-nowrap">Rental Returned</th>
                      <th className="px-3 py-2 whitespace-nowrap">Van Picked Up</th>
                      <th className="px-3 py-2 whitespace-nowrap">Holman Status</th>
                      <th className="px-3 py-2 whitespace-nowrap text-right">
                        <button
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => { setDailyNetSort(cycleSort(dailyNetSort)); setDateInRepairSort(null); setRegExpirySort(null); setAdjNetSort(null); }}
                          data-testid="sort-daily-net"
                        >
                          Daily Net w/ Rental <SortIcon dir={dailyNetSort} />
                        </button>
                      </th>
                      <th className="px-3 py-2 whitespace-nowrap text-right">
                        <button
                          className={`inline-flex items-center gap-1 hover:text-foreground ${adjNetSort === "asc" ? "text-red-600 font-semibold" : adjNetSort === "desc" ? "text-green-600 font-semibold" : ""}`}
                          onClick={() => { setAdjNetSort(cycleSort(adjNetSort)); setDateInRepairSort(null); setRegExpirySort(null); setDailyNetSort(null); }}
                          data-testid="sort-adj-net"
                        >
                          Adj. Net <SortIcon dir={adjNetSort} />
                        </button>
                      </th>
                      <th className="px-3 py-2 whitespace-nowrap text-right">Scorecard</th>
                      <th className="px-3 py-2 whitespace-nowrap">
                        {anyColumnFilterActive && (
                          <Button variant="ghost" size="sm" onClick={clearAllColumnFilters} className="h-6 px-1 text-[10px]" data-testid="button-clear-column-filters">
                            <X className="w-3 h-3" /> Clear
                          </Button>
                        )}
                      </th>
                    </tr>
                    {/* Header row 2 — per-column filters (mirror of Fleet Scope's MultiSelectFilters) */}
                    <tr className="bg-muted/20">
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1">
                        <div className="flex flex-col gap-1 min-w-[140px]">
                          <Input
                            value={truckNumberFilter}
                            onChange={(e) => { setTruckNumberFilter(e.target.value); setPage(1); }}
                            placeholder="Filter…"
                            className="h-6 text-xs"
                            data-testid="filter-truck-number"
                          />
                          <div className="flex gap-1">
                            <MultiSelectFilter options={columnOptions.states} selectedValues={stateFilter} onSelectionChange={(v) => { setStateFilter(v); setPage(1); }} placeholder="State" showSearch={false} className="text-[10px]" />
                            <MultiSelectFilter options={columnOptions.regions} selectedValues={regionFilter} onSelectionChange={(v) => { setRegionFilter(v); setPage(1); }} placeholder="Reg" showSearch={false} className="text-[10px]" />
                          </div>
                        </div>
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.byov} selectedValues={byovFilter} onSelectionChange={(v) => { setByovFilter(v); setPage(1); }} placeholder="BYOV" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.mainStatuses} selectedValues={mainStatusMulti} onSelectionChange={(v) => { setMainStatusMulti(v); setPage(1); }} placeholder="Main…" />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.owners} selectedValues={ownerFilter} onSelectionChange={(v) => { setOwnerFilter(v); setPage(1); }} placeholder="Owner" />
                      </th>
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={tpmsFilter} onSelectionChange={(v) => { setTpmsFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.regExpiries} selectedValues={regExpiryFilter} onSelectionChange={(v) => { setRegExpiryFilter(v); setPage(1); }} placeholder="Date" />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={repairedFilter} onSelectionChange={(v) => { setRepairedFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={amsFilter} onSelectionChange={(v) => { setAmsFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={pickSlotFilter} onSelectionChange={(v) => { setPickSlotFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={rentalReturnedFilter} onSelectionChange={(v) => { setRentalReturnedFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.yn} selectedValues={vanPickedUpFilter} onSelectionChange={(v) => { setVanPickedUpFilter(v); setPage(1); }} placeholder="Y/N" showSearch={false} />
                      </th>
                      <th className="px-2 py-1">
                        <MultiSelectFilter options={columnOptions.holmanStatuses} selectedValues={holmanStatusFilter} onSelectionChange={(v) => { setHolmanStatusFilter(v); setPage(1); }} placeholder="Holman" />
                      </th>
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1"></th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((t, idx) => {
                      const norm = (t.truckNumber ?? "").replace(/^0+/, "");
                      const enr = enrichmentMap[norm];
                      const subOptions: readonly string[] =
                        t.mainStatus && (SUB_STATUSES as any)[t.mainStatus]
                          ? (SUB_STATUSES as any)[t.mainStatus]
                          : [];
                      const scraper = scraperStatusMap[t.truckNumber] ?? null;
                      return (
                        <tr
                          key={t.id}
                          className="border-t hover:bg-muted/30 cursor-pointer"
                          onClick={() => { setDetailTruckId(t.id); setDetailOpen(true); }}
                          data-testid={`row-truck-${t.truckNumber}`}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground">{pageStart + idx + 1}</td>

                          {/* Truck # cell w/ state code under */}
                          <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                            <div className="font-mono font-semibold">{t.truckNumber}</div>
                            {t.techState && <div className="text-[10px] text-muted-foreground mt-0.5">{t.techState}</div>}
                          </td>

                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{t.techName ?? enr?.techName ?? "—"}</td>

                          {/* Combined Status pill — Main + Sub. Trigger is invisible
                              so the StatusBadge IS the editable element (mirror of
                              Fleet Scope's exact styling). The sub-status row below
                              is also borderless so it reads as a continuation of the
                              same pill, not a separate control. */}
                          <td className="px-3 py-2 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col gap-1">
                              <Select
                                value={t.mainStatus ?? "Confirming Status"}
                                onValueChange={(v) => saveMainStatus(t, v)}
                              >
                                <SelectTrigger className="h-auto p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 [&>svg]:hidden">
                                  {t.mainStatus
                                    ? <StatusBadge status={t.mainStatus} mainStatus={t.mainStatus} subStatus={t.subStatus} showSubStatusOnly={false} />
                                    : <span className="text-muted-foreground text-xs">—</span>}
                                </SelectTrigger>
                                <SelectContent>
                                  {MAIN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              {subOptions.length > 0 && (
                                <Select
                                  value={t.subStatus ?? "_none_"}
                                  onValueChange={(v) => saveField(t.id, "subStatus", v === "_none_" ? null : v)}
                                >
                                  <SelectTrigger className="h-6 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto max-w-[180px] [&>svg]:hidden">
                                    <SelectValue>{t.subStatus || "Select sub-status…"}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_none_">No sub-status</SelectItem>
                                    {subOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </td>

                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            {t.shsOwner
                              ? <Badge variant="outline" className={ownerColorClass(t.shsOwner)}>{t.shsOwner}</Badge>
                              : <span className="text-muted-foreground">—</span>}
                          </td>

                          <td className="px-3 py-2 font-mono text-xs" onClick={(e) => e.stopPropagation()}>{enr?.enterpriseId ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                            {enr?.district ? (enr.district.replace(/^0+/, "") || "0") : "—"}
                            {enr?.district && lookupCostCenter(enr.district) && (
                              <div className="text-xs text-muted-foreground font-sans">CC {lookupCostCenter(enr.district)}</div>
                            )}
                          </td>

                          <BoolCell truck={t} field="snowflakeAssigned" saveField={saveField} />
                          <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{fmtDate(t.datePutInRepair)}</td>
                          <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{fmtDate(t.holmanRegExpiry)}</td>
                          <BoolCell truck={t} field="repairCompleted" saveField={saveField} />
                          <BoolCell truck={t} field="inAms" saveField={saveField} />
                          <BoolCell truck={t} field="pickUpSlotBooked" saveField={saveField} />
                          <BoolCell truck={t} field="rentalReturned" saveField={saveField} />
                          <BoolCell truck={t} field="vanPickedUp" saveField={saveField} />

                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            {scraper
                              ? <span className={holmanStatusClass(scraper.status)}>{scraper.status}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </td>

                          <td className={`px-3 py-2 text-right font-mono ${
                            enr?.dailyNetWithRental == null ? "text-muted-foreground"
                            : enr.dailyNetWithRental < 0 ? "text-red-600 font-semibold"
                            : "text-green-600 font-semibold"
                          }`} onClick={(e) => e.stopPropagation()}>
                            {enr?.dailyNetWithRental == null ? "—" : fmtDollars(enr.dailyNetWithRental)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${
                            enr?.gate1AdjustedNet == null ? "text-muted-foreground"
                            : enr.gate1Classification === "underwater" ? "text-red-600 font-semibold"
                            : enr.gate1Classification === "marginal" ? "text-amber-600 font-semibold"
                            : enr.gate1Classification === "profitable" ? "text-green-600 font-semibold"
                            : "text-muted-foreground"
                          }`} onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const n = enr?.gate1AdjustedNet != null ? Number(enr.gate1AdjustedNet) : null;
                              if (n == null || !Number.isFinite(n)) return "—";
                              return `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString()}`;
                            })()}
                          </td>
                          <td className="px-3 py-2 text-right font-mono" onClick={(e) => e.stopPropagation()}>
                            {enr?.scorecardScore == null ? "—" : enr.scorecardScore.toFixed(2)}
                          </td>

                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => { setDetailTruckId(t.id); setDetailOpen(true); }} data-testid={`button-view-${t.truckNumber}`}>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open detail (same panel as Fleet Scope)</TooltipContent>
                            </Tooltip>
                          </td>
                        </tr>
                      );
                    })}
                    {pageRows.length === 0 && (
                      <tr><td colSpan={20} className="text-center text-muted-foreground py-8">No trucks match the current filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>Showing {pageRows.length === 0 ? 0 : pageStart + 1}–{pageStart + pageRows.length} of {filtered.length}</span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={safePage === 1}>First</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(safePage - 1)} disabled={safePage === 1}>Prev</Button>
                    <span className="px-2">{safePage} / {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(safePage + 1)} disabled={safePage === totalPages}>Next</Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>Last</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {/* Shared detail panel — exact same component Fleet Scope opens */}
        <TruckDetailPanel
          truckId={detailTruckId}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onUpdateAms={undefined as any}
          amsOpen={false}
        />

        {inlineEditMutation.isPending && (
          <div className="fixed bottom-4 right-4 bg-background border rounded-md px-3 py-2 shadow-lg flex items-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Saving…
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ─── Cell + helpers ───────────────────────────────────────────────────────────

function BoolCell({
  truck, field, saveField,
}: {
  truck: FSTruck; field: keyof FSTruck;
  saveField: (id: string, f: string, v: any) => void;
}) {
  const value = truck[field];
  return (
    <td className="px-3 py-2 min-w-[80px]" onClick={(e) => e.stopPropagation()}>
      <Select
        value={value === true ? "yes" : value === false ? "no" : ""}
        onValueChange={(v) => saveField(truck.id, String(field), v === "yes")}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Y</SelectItem>
          <SelectItem value="no">N</SelectItem>
        </SelectContent>
      </Select>
    </td>
  );
}

function ownerColorClass(owner: string): string {
  const map: Record<string, string> = {
    "Oscar S": "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
    "Cheryl":  "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300",
    "Jenn D":  "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300",
    "John C":  "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
    "Morgan":  "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
  };
  return map[owner] ?? "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-300";
}

function holmanStatusClass(status: string): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("COMPLETE")) return "text-xs font-semibold text-green-700 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded";
  if (s.includes("REPAIR")) return "text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded";
  if (s.includes("UNKNOWN")) return "text-xs font-medium text-slate-600 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded";
  return "text-xs font-medium text-muted-foreground";
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
}

function fmtDollars(n: number): string {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}$${abs.toFixed(2)}`;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function parseConsolidateText(text: string): Array<{ truckNumber: string; dateInRepair?: string }> {
  return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[\t]+|\s{2,}/).map(p => p.trim()).filter(Boolean);
    return { truckNumber: parts[0], dateInRepair: parts[1] };
  });
}

function exportToCsv(
  trucks: FSTruck[],
  enrichmentMap: Record<string, EnrichmentRow>,
  isFiltered = false,
) {
  const headers = [
    "Truck #", "Tech Name", "Enterprise ID", "District", "Main Status", "Sub-Status",
    "Assigned To", "Date In Repair", "Reg. Expiry", "Repaired", "AMS", "Pick Slot",
    "Rental Returned", "Van Picked Up", "Daily Net w/ Rental", "Adj. Net", "Scorecard",
  ];
  const lines = [headers.join(",")];
  for (const t of trucks) {
    const norm = (t.truckNumber ?? "").replace(/^0+/, "");
    const enr = enrichmentMap[norm];
    const adjNetRaw = enr?.gate1AdjustedNet != null ? Number(enr.gate1AdjustedNet) : null;
    const adjNetStr = adjNetRaw != null && Number.isFinite(adjNetRaw)
      ? `${adjNetRaw < 0 ? "-" : "+"}${Math.abs(adjNetRaw)}`
      : "";
    const cells = [
      t.truckNumber, t.techName ?? enr?.techName ?? "", enr?.enterpriseId ?? "",
      enr?.district ?? "", t.mainStatus ?? "", t.subStatus ?? "", t.shsOwner ?? "",
      t.datePutInRepair ?? "", t.holmanRegExpiry ?? "",
      yn(t.repairCompleted), yn(t.inAms), yn(t.pickUpSlotBooked), yn(t.rentalReturned), yn(t.vanPickedUp),
      enr?.dailyNetWithRental != null ? String(enr.dailyNetWithRental) : "",
      adjNetStr,
      enr?.scorecardScore != null ? String(enr.scorecardScore) : "",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = isFiltered ? `active-rentals-filtered-${new Date().toISOString().slice(0, 10)}.csv` : `active-rentals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function yn(v: boolean | null | undefined): string {
  return v === true ? "Y" : v === false ? "N" : "";
}
function csvEscape(s: any): string {
  const str = s == null ? "" : String(s);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
