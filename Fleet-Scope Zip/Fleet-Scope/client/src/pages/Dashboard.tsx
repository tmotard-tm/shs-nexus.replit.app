import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Truck } from "@shared/schema";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusReminder, useStatusReminder } from "@/components/StatusReminder";
import { IssueIndicator, useIssueStats } from "@/components/IssueIndicator";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { computeTruckIssues } from "@/lib/truckIssues";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Search, 
  Plus, 
  ExternalLink,
  Filter,
  X,
  AlertCircle,
  TruckIcon,
  CheckCircle2,
  User,
  BarChart3,
  Building2,
  Package,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Upload,
  FileUp,
  FileSpreadsheet,
  Download,
  RefreshCw,
  Database,
  CalendarCheck,
  PhoneCall,
  PhoneForwarded,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/schema";
import Papa from "papaparse";
import { Badge } from "@/components/ui/badge";
import { TruckDetailPanel } from "@/components/TruckDetailPanel";

type OwnerType = "Oscar S" | "John C" | "Mandy R" | "Rob A" | "Bob B" | "Jenn D." | "Samantha W" | "Cheryl" | "Final Actioned";

const ownerColors: Record<OwnerType, string> = {
  "Oscar S": "bg-amber-100 text-amber-700 border-amber-200",
  "Rob A": "bg-purple-100 text-purple-700 border-purple-200",
  "Bob B": "bg-orange-100 text-orange-700 border-orange-200",
  "John C": "bg-blue-100 text-blue-700 border-blue-200",
  "Mandy R": "bg-green-100 text-green-700 border-green-200",
  "Jenn D.": "bg-pink-100 text-pink-700 border-pink-200",
  "Samantha W": "bg-cyan-100 text-cyan-700 border-cyan-200",
  "Cheryl": "bg-rose-100 text-rose-700 border-rose-200",
  "Final Actioned": "bg-gray-100 text-gray-600 border-gray-200",
};

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

const REGION_COLORS: Record<string, string> = {
  "East Coast & Southeast": "bg-blue-500",
  "Central & Midwest": "bg-amber-500",
  "West Coast & Deep South": "bg-emerald-500",
};

const PRESET_OWNERS = [
  "Oscar S",
  "Rob A", 
  "Bob B",
  "John C",
  "Mandy R",
  "Jenn D.",
  "Samantha W",
  "Cheryl",
  "Luca B",
  "Sean C",
];

// Normalize owner names to prevent duplicates from spacing/capitalization differences
function normalizeOwnerName(name: string | null | undefined): string {
  if (!name || name.trim() === "") return "Oscar S"; // Default blank to Oscar S
  let normalized = name.trim();
  // Remove trailing periods for consistency (e.g., "Oscar S." -> "Oscar S")
  if (normalized.endsWith(".") && !normalized.includes(" ")) {
    normalized = normalized.slice(0, -1);
  }
  // Fix common variations - but keep Rob A, Rob C, Rob D, Rob G as separate people
  const nameMap: Record<string, string> = {
    "oscar s": "Oscar S",
    "oscar": "Oscar S",
    "john c": "John C",
    "mandy r": "Mandy R",
    "bob b": "Bob B",
    "jenn d": "Jenn D.",
    "jenn d.": "Jenn D.",
    "samantha w": "Samantha W",
    "cheryl": "Cheryl",
    "rob a": "Rob A",
    "rob c": "Rob C",
    "rob d": "Rob D", 
    "rob g": "Rob G",
    "luca b": "Luca B",
    "sean c": "Sean C",
  };
  const lowerName = normalized.toLowerCase();
  if (nameMap[lowerName]) {
    return nameMap[lowerName];
  }
  return normalized;
}

function determineOwner(truck: Truck): OwnerType {
  const mainStatus = truck.mainStatus;
  const subStatus = truck.subStatus;

  if (mainStatus === "On Road") {
    return "Final Actioned";
  }
  if (mainStatus === "Declined Repair" && subStatus === "Vehicle was sold") {
    return "Final Actioned";
  }
  if (truck.vanPickedUp) {
    return "Final Actioned";
  }

  if (mainStatus === "Decision Pending" && subStatus === "Estimate received, needs review") {
    return "Rob A";
  }

  if (mainStatus === "Declined Repair" && subStatus !== "Vehicle was sold") {
    return "Bob B";
  }
  if (mainStatus === "PMF") {
    return "Bob B";
  }

  // Approved for sale - owner assignment based on substatus
  if (mainStatus === "Approved for sale") {
    if (subStatus === "Clearing Softeon Inventory" || subStatus === "Vehicle Termination Form completed") {
      return "Jenn D.";
    }
    if (subStatus === "Fleet Administrator review" || subStatus === "Procurement to transfer form to leadership") {
      return "Bob B";
    }
    if (subStatus === "Leadership to approve Docusign") {
      return "Samantha W";
    }
    // For other substatuses (Termination Form Approved, Declined Docusign), default to Oscar S
    return "Oscar S";
  }

  if (mainStatus === "Tags") {
    return "John C";
  }

  if (mainStatus === "Scheduling") {
    return "Mandy R";
  }

  return "Oscar S";
}
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";

// localStorage key for dashboard filters
const DASHBOARD_FILTERS_KEY = "dashboard-filters";

// Type for stored filter state
type StoredFilters = {
  searchQuery: string;
  mainStatusFilter: string;
  subStatusFilter: string;
  issueFilter: "all" | "with-issues" | "critical" | "clean";
  truckNumberFilter: string;
  columnStatusFilter: string[];
  callStatusFilter: string[];
  ownerFilter: string[];
  regStickerFilter: string[];
  completedFilter: string[];
  amsFilter: string[];
  regExpiryFilter: string[];
  assignedFilter: string[];
  upsStatusFilter: string[];
  pickSlotFilter: string[];
  gaveHolmanFilter: string[];
  holmanStatusFilter: string[];
  spareVanFilter: string[];
  regTestSlotFilter: string[];
  stateFilter: string[];
  regionFilter: string[];
  byovFilter: string[];
  regExpirySortOrder: 'asc' | 'desc' | null;
  dateRepairSortOrder: 'asc' | 'desc' | null;
  billPaidSortOrder: 'asc' | 'desc' | null;
};

function InlineTextInput({ value, maxLength, onSave, className, "data-testid": testId }: { value: string; maxLength?: number; onSave: (val: string) => void; className?: string; "data-testid"?: string }) {
  const [localVal, setLocalVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current !== document.activeElement) {
      setLocalVal(value);
    }
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      maxLength={maxLength}
      className={className || "h-7 w-24 text-xs border rounded px-1 bg-transparent text-center"}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        if (localVal !== value) {
          onSave(localVal);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      data-testid={testId}
    />
  );
}

function InlineWrappingTextInput({ value, maxLength, onSave, "data-testid": testId }: { value: string; maxLength?: number; onSave: (val: string) => void; "data-testid"?: string }) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        maxLength={maxLength}
        className="w-full text-[11px] leading-tight border rounded px-1 py-0.5 bg-transparent text-center"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (localVal !== value) {
            onSave(localVal);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setLocalVal(value);
            setEditing(false);
          }
        }}
        data-testid={testId}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="block text-[11px] leading-snug text-center break-words cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 min-h-[1.25rem]"
      title="Click to edit"
      data-testid={testId}
    >
      {value || "—"}
    </span>
  );
}

function InlineDateInput({ value, onSave, "data-testid": testId }: { value: string; onSave: (val: string) => void; "data-testid"?: string }) {
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  return (
    <input
      type="date"
      className="h-7 w-28 text-xs border rounded px-1 bg-transparent text-center"
      value={localVal}
      onChange={(e) => {
        const newVal = e.target.value;
        setLocalVal(newVal);
        onSave(newVal);
      }}
      data-testid={testId}
    />
  );
}

// Load filters from localStorage
function loadStoredFilters(): Partial<StoredFilters> {
  try {
    const stored = localStorage.getItem(DASHBOARD_FILTERS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to load dashboard filters from localStorage:", e);
  }
  return {};
}

// Save filters to localStorage
function saveFiltersToStorage(filters: StoredFilters): void {
  try {
    localStorage.setItem(DASHBOARD_FILTERS_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to save dashboard filters to localStorage:", e);
  }
}

export default function Dashboard() {
  const { currentUser } = useUser();
  
  // Load stored filters on initial render
  const storedFilters = useMemo(() => loadStoredFilters(), []);
  
  const [searchQuery, setSearchQuery] = useState(storedFilters.searchQuery ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(storedFilters.searchQuery ?? "");
  const [mainStatusFilter, setMainStatusFilter] = useState<string>(storedFilters.mainStatusFilter ?? "all");
  const [subStatusFilter, setSubStatusFilter] = useState<string>(storedFilters.subStatusFilter ?? "all");
  const [issueFilter, setIssueFilter] = useState<"all" | "with-issues" | "critical" | "clean">(storedFilters.issueFilter ?? "all");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResults, setImportResults] = useState<{success: number; errors: string[]} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCallImportDialogOpen, setIsCallImportDialogOpen] = useState(false);
  const [callImportFile, setCallImportFile] = useState<File | null>(null);
  const [callImportResults, setCallImportResults] = useState<{updated: number; notFound: number; errors: string[]} | null>(null);
  const callImportFileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Column header filters (multi-select arrays - empty array means "all selected")
  const [truckNumberFilter, setTruckNumberFilter] = useState(storedFilters.truckNumberFilter ?? "");
  const [columnStatusFilter, setColumnStatusFilter] = useState<string[]>(storedFilters.columnStatusFilter ?? []);
  const [callStatusFilter, setCallStatusFilter] = useState<string[]>(storedFilters.callStatusFilter ?? []);
  const [ownerFilter, setOwnerFilter] = useState<string[]>(storedFilters.ownerFilter ?? []);

  // Multi-select column filters for REG. STICKER, COMPLETED, AMS, REG. EXPIRY, ASSIGNED (dropdown style like Status column)
  const [regStickerFilter, setRegStickerFilter] = useState<string[]>(storedFilters.regStickerFilter ?? []);
  const [completedFilter, setCompletedFilter] = useState<string[]>(storedFilters.completedFilter ?? []);
  const [amsFilter, setAmsFilter] = useState<string[]>(storedFilters.amsFilter ?? []);
  const [regExpiryFilter, setRegExpiryFilter] = useState<string[]>(storedFilters.regExpiryFilter ?? []);
  const [assignedFilter, setAssignedFilter] = useState<string[]>(storedFilters.assignedFilter ?? []);
  const [pickSlotFilter, setPickSlotFilter] = useState<string[]>(storedFilters.pickSlotFilter ?? []);

  // Options for dropdown filters
  const REG_STICKER_OPTIONS = ["Yes", "Expired", "Shop would not check", "Mailed Tag", "Contacted tech", "Ordered duplicates", "Started Renewal", "Texted Reg", "(Blank)"];
  const BOOLEAN_OPTIONS = ["Yes", "No", "(Blank)"];
  const REG_EXPIRY_OPTIONS = ["Has Date", "After Today", "(Blank)"];
  const PICK_SLOT_OPTIONS = ["Has Value", "(Blank)"];
  const UPS_STATUS_OPTIONS = ["Delivered", "In Transit", "Picked Up", "Exception", "Not Found", "Error", "(Blank)"];

  // UPS filter state
  const [upsStatusFilter, setUpsStatusFilter] = useState<string[]>(storedFilters.upsStatusFilter ?? []);
  
  // Gave Holman filter state
  const [gaveHolmanFilter, setGaveHolmanFilter] = useState<string[]>(storedFilters.gaveHolmanFilter ?? []);
  const GAVE_HOLMAN_OPTIONS = ["Yes", "No", "(Blank)"];
  
  // Holman Status filter state (scraper)
  const [holmanStatusFilter, setHolmanStatusFilter] = useState<string[]>(storedFilters.holmanStatusFilter ?? []);

  // Spare Van filter state
  const [spareVanFilter, setSpareVanFilter] = useState<string[]>(storedFilters.spareVanFilter ?? []);
  const SPARE_VAN_OPTIONS = ["Yes", "(Blank)"];
  
  // Reg. Test Slot filter state
  const [regTestSlotFilter, setRegTestSlotFilter] = useState<string[]>(storedFilters.regTestSlotFilter ?? []);
  
  // State filter (for tech state - the state shown under truck number)
  const [stateFilter, setStateFilter] = useState<string[]>(storedFilters.stateFilter ?? []);

  // Region filter
  const [regionFilter, setRegionFilter] = useState<string[]>(storedFilters.regionFilter ?? []);
  const [byovFilter, setByovFilter] = useState<string[]>(storedFilters.byovFilter ?? []);

  // Sorting state for Reg. Expiry column (null = no sort, 'asc' = oldest first, 'desc' = newest first)
  const [regExpirySortOrder, setRegExpirySortOrder] = useState<'asc' | 'desc' | null>(storedFilters.regExpirySortOrder ?? null);
  
  // Sorting state for Date In Repair column
  const [dateRepairSortOrder, setDateRepairSortOrder] = useState<'asc' | 'desc' | null>(storedFilters.dateRepairSortOrder ?? null);
  
  // Sorting state for Bill Paid column
  const [billPaidSortOrder, setBillPaidSortOrder] = useState<'asc' | 'desc' | null>(storedFilters.billPaidSortOrder ?? null);
  
  // Save filters to localStorage whenever they change
  useEffect(() => {
    saveFiltersToStorage({
      searchQuery,
      mainStatusFilter,
      subStatusFilter,
      issueFilter,
      truckNumberFilter,
      columnStatusFilter,
      callStatusFilter,
      ownerFilter,
      regStickerFilter,
      completedFilter,
      amsFilter,
      regExpiryFilter,
      assignedFilter,
      upsStatusFilter,
      pickSlotFilter,
      gaveHolmanFilter,
      holmanStatusFilter,
      spareVanFilter,
      regTestSlotFilter,
      stateFilter,
      regionFilter,
      byovFilter,
      regExpirySortOrder,
      dateRepairSortOrder,
      billPaidSortOrder,
    });
  }, [searchQuery, mainStatusFilter, subStatusFilter, issueFilter, truckNumberFilter, columnStatusFilter, callStatusFilter, ownerFilter, regStickerFilter, completedFilter, amsFilter, regExpiryFilter, assignedFilter, upsStatusFilter, pickSlotFilter, gaveHolmanFilter, holmanStatusFilter, spareVanFilter, regTestSlotFilter, stateFilter, regionFilter, byovFilter, regExpirySortOrder, dateRepairSortOrder, billPaidSortOrder]);

  // Check if any column filters are active
  const hasActiveColumnFilters = regStickerFilter.length > 0 || completedFilter.length > 0 || amsFilter.length > 0 || regExpiryFilter.length > 0 || assignedFilter.length > 0 || upsStatusFilter.length > 0 || pickSlotFilter.length > 0 || gaveHolmanFilter.length > 0 || holmanStatusFilter.length > 0 || spareVanFilter.length > 0 || regTestSlotFilter.length > 0 || stateFilter.length > 0 || regionFilter.length > 0 || callStatusFilter.length > 0 || byovFilter.length > 0;

  // Clear all column filters
  const clearColumnFilters = () => {
    setRegStickerFilter([]);
    setCompletedFilter([]);
    setAmsFilter([]);
    setRegExpiryFilter([]);
    setAssignedFilter([]);
    setUpsStatusFilter([]);
    setPickSlotFilter([]);
    setGaveHolmanFilter([]);
    setHolmanStatusFilter([]);
    setSpareVanFilter([]);
    setRegTestSlotFilter([]);
    setStateFilter([]);
    setRegionFilter([]);
    setCallStatusFilter([]);
    setByovFilter([]);
  };

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{truckId: string; field: string} | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [editValue, setEditValue] = useState<string>("");
  
  // Owner editing state
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const [customOwnerInput, setCustomOwnerInput] = useState<string>("");

  // Snowflake sync state
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [isRefreshingUps, setIsRefreshingUps] = useState(false);
  const [upsRefreshResults, setUpsRefreshResults] = useState<{
    updated: number;
    failed: number;
    total: number;
    errors?: string[];
  } | null>(null);
  const [isUpsDialogOpen, setIsUpsDialogOpen] = useState(false);
  
  // Truck consolidation dialog state
  const [isConsolidateDialogOpen, setIsConsolidateDialogOpen] = useState(false);
  const [consolidatePasteText, setConsolidatePasteText] = useState("");
  const [consolidateResults, setConsolidateResults] = useState<{
    added: string[];
    removed: string[];
    addedCount: number;
    removedCount: number;
    unchangedCount: number;
  } | null>(null);
  
  const [syncResults, setSyncResults] = useState<{
    updated: number;
    trucksChecked: number;
    snowflakeRecordsFound: number;
    details: Array<{
      truckNumber: string;
      techNameUpdated: boolean;
      techPhoneUpdated: boolean;
      newTechName: string | null;
      newTechPhone: string | null;
    }>;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [callingTruckId, setCallingTruckId] = useState<string | null>(null);
  const [callingTechTruckId, setCallingTechTruckId] = useState<string | null>(null);

  // Bulk sync state
  const [isBulkSyncDialogOpen, setIsBulkSyncDialogOpen] = useState(false);
  const [bulkSyncInput, setBulkSyncInput] = useState("");
  const [bulkSyncResults, setBulkSyncResults] = useState<{
    added: number;
    removed: number;
    kept: number;
    message: string;
  } | null>(null);
  const [bulkSyncPreview, setBulkSyncPreview] = useState<{
    toAdd: string[];
    toRemove: string[];
    toKeep: number;
  } | null>(null);

  // Status change reminder
  const { showReminder, hideReminder, shouldShowReminder } = useStatusReminder();

  // Pagination state - show 50 trucks per page for better performance
  const [currentPage, setCurrentPage] = useState(1);
  const TRUCKS_PER_PAGE = 50;

  // Get available sub-statuses based on selected main status
  const availableSubStatuses = mainStatusFilter !== "all" 
    ? SUB_STATUSES[mainStatusFilter as MainStatus] 
    : [];

  // Track if this is the initial mount (to prevent resetting subStatus when loading from localStorage)
  const isInitialMount = useRef(true);
  
  // Reset sub-status when main status changes (but not on initial mount when loading from localStorage)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setSubStatusFilter("all");
  }, [mainStatusFilter]);

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, mainStatusFilter, subStatusFilter, issueFilter, truckNumberFilter, columnStatusFilter, ownerFilter, regStickerFilter, completedFilter, amsFilter, regExpiryFilter, upsStatusFilter, regExpirySortOrder]);

  // Debounce search with 300ms delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: trucks, isLoading, error } = useQuery<Truck[]>({
    queryKey: ["/api/trucks"],
  });

  const { data: pickupsThisWeek } = useQuery<{
    count: number;
    label: string;
  }>({
    queryKey: ["/api/pickups-scheduled-this-week"],
  });



  const { data: scraperStatusMap } = useQuery<Record<string, { status: string; lastScraped: string; location: string; primaryIssue: string; priority: string }>>({
    queryKey: ["/api/trucks/scraper-status"],
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
              recommendation: v.recommendation || '',
            };
          }
          return vehicleMap;
        }
      } catch (e) {
        console.log("[Scraper] Direct fetch failed, falling back to server proxy");
      }
      const res = await fetch("/api/trucks/scraper-status");
      if (!res.ok) throw new Error("Failed to fetch scraper status");
      return res.json();
    },
  });

  const { data: byovEnrollmentMap } = useQuery<Record<string, boolean>>({
    queryKey: ["/api/byov-enrollment-status"],
  });

  const HOLMAN_STATUS_OPTIONS = useMemo(() => {
    if (!scraperStatusMap) return [];
    const statuses = new Set<string>();
    Object.values(scraperStatusMap).forEach(v => {
      if (v.status) statuses.add(v.status.replace(/_/g, ' '));
    });
    const sorted = Array.from(statuses).sort();
    sorted.push("(No Data)");
    return sorted;
  }, [scraperStatusMap]);

  const { data: rentalSummary } = useQuery<{
    totalActive: number;
    totalRentals: number;
    averageDurationDays: number;
    overdueCount: number;
    returnedThisWeek: number;
    byRegion: Record<string, number>;
  }>({
    queryKey: ["/api/rentals/summary"],
  });

  // Get unique owners for owner filter dropdown - based on actual shsOwner values
  const uniqueOwners = useMemo(() => {
    if (!trucks) return PRESET_OWNERS;
    const ownerSet = new Set<string>();
    trucks.forEach(truck => {
      const normalized = normalizeOwnerName(truck.shsOwner);
      ownerSet.add(normalized);
    });
    // Sort with preset owners first, then any additional owners alphabetically
    const sorted = Array.from(ownerSet).sort((a, b) => {
      const aIndex = PRESET_OWNERS.indexOf(a);
      const bIndex = PRESET_OWNERS.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [trucks]);

  const uniqueCallStatuses = useMemo(() => {
    if (!trucks) return [];
    const statusSet = new Set<string>();
    trucks.forEach(truck => {
      if (truck.callStatus && truck.callStatus.trim()) {
        statusSet.add(truck.callStatus.trim());
      }
    });
    return ["(Blank)", ...Array.from(statusSet).sort()];
  }, [trucks]);

  // Get unique states for state filter dropdown - based on actual techState values
  const uniqueStates = useMemo(() => {
    if (!trucks) return [];
    const stateSet = new Set<string>();
    trucks.forEach(truck => {
      if (truck.techState && truck.techState.trim() !== "") {
        stateSet.add(truck.techState.trim().toUpperCase());
      }
    });
    // Sort alphabetically
    return Array.from(stateSet).sort((a, b) => a.localeCompare(b));
  }, [trucks]);

  // Helper function to check if truck matches state filter
  const matchesStateMultiFilter = (truck: Truck, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    const truckState = truck.techState?.trim().toUpperCase() || "";
    const isBlank = truckState === "";
    
    if (isBlank) return selectedValues.includes("(Blank)");
    return selectedValues.includes(truckState);
  };

  // Helper function to check if truck matches multi-select reg sticker filter
  const matchesRegStickerMultiFilter = (truck: Truck, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    const truckValue = truck.registrationStickerValid;
    const isBlank = !truckValue || truckValue === "";
    
    if (isBlank) return selectedValues.includes("(Blank)");
    return selectedValues.includes(truckValue);
  };

  // Helper function to check if truck matches multi-select boolean filter
  const matchesBooleanMultiFilter = (value: boolean | null | undefined, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    if (value === true) return selectedValues.includes("Yes");
    if (value === false) return selectedValues.includes("No");
    return selectedValues.includes("(Blank)");
  };
  
  // Helper function for Gave Holman filter (text field: Yes, No, or blank)
  const matchesGaveHolmanMultiFilter = (value: string | null | undefined, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    if (value === "Yes") return selectedValues.includes("Yes");
    if (value === "No") return selectedValues.includes("No");
    return selectedValues.includes("(Blank)");
  };
  
  // Helper function for Spare Van filter (boolean field: Yes = true, Blank = false/null/undefined)
  const matchesSpareVanMultiFilter = (value: boolean | null | undefined, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    if (value === true) return selectedValues.includes("Yes");
    return selectedValues.includes("(Blank)");
  };

  // Helper function to check if truck matches reg expiry filter (Has Date, After Today, or Blank)
  // Uses holmanRegExpiry field which is displayed in the Reg. Expiry column
  const matchesRegExpiryMultiFilter = (truck: Truck, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    const hasDate = truck.holmanRegExpiry && truck.holmanRegExpiry.trim() !== "";
    
    if (!hasDate) return selectedValues.includes("(Blank)");
    
    // Check "After Today" filter - expiry date is in the future
    if (selectedValues.includes("After Today")) {
      const expiryDate = new Date(truck.holmanRegExpiry!);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset to start of day for accurate comparison
      if (expiryDate > today) return true;
    }
    
    // Check "Has Date" filter
    if (selectedValues.includes("Has Date")) return true;
    
    return false;
  };

  // Helper function to check if truck matches UPS status filter
  const matchesUpsStatusMultiFilter = (truck: any, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    const upsStatus = truck.upsStatus;
    const isBlank = !upsStatus || upsStatus === "";
    
    if (isBlank) return selectedValues.includes("(Blank)");
    
    // Map UPS status codes to display names
    if (upsStatus === "D") return selectedValues.includes("Delivered");
    if (upsStatus === "I") return selectedValues.includes("In Transit");
    if (upsStatus === "P") return selectedValues.includes("Picked Up");
    if (upsStatus === "X") return selectedValues.includes("Exception");
    if (upsStatus === "NOT_FOUND") return selectedValues.includes("Not Found");
    if (upsStatus === "NO_DATA" || upsStatus === "UNKNOWN") return selectedValues.includes("Error");
    
    // Fallback: Check if any error-like status should match "Error" filter
    if (typeof upsStatus === "string" && upsStatus.includes("_")) {
      return selectedValues.includes("Error");
    }
    
    return false;
  };

  // Helper function to check if truck matches Pick Slot filter (Has Value vs Blank)
  // "Has Value" = true (slot is booked)
  // "(Blank)" = false, null, or undefined (slot is NOT booked or never set)
  const matchesPickSlotMultiFilter = (value: boolean | null | undefined, selectedValues: string[]): boolean => {
    if (selectedValues.length === 0) return true; // No filter = all selected
    const NONE_MARKER = "__NONE_SELECTED__";
    if (selectedValues[0] === NONE_MARKER) return false;
    
    // Only true = "Has Value" (slot is booked)
    // Everything else (false, null, undefined) = "(Blank)" (not booked)
    if (value === true) {
      return selectedValues.includes("Has Value") || selectedValues.includes("Yes");
    }
    return selectedValues.includes("(Blank)") || selectedValues.includes("No");
  };

  const filteredTrucks = useMemo(() => {
    const filtered = trucks?.filter((truck) => {
      const matchesSearch = truck.truckNumber
        .toLowerCase()
        .includes(debouncedSearch.toLowerCase());
      
      const matchesMainStatus = mainStatusFilter === "all" || truck.mainStatus === mainStatusFilter;
      const matchesSubStatus = subStatusFilter === "all" || truck.subStatus === subStatusFilter;

      // Column header filters (empty array means "all selected")
      const matchesTruckNumberFilter = truckNumberFilter === "" || 
        truck.truckNumber.toLowerCase().includes(truckNumberFilter.toLowerCase());
      // Handle "none selected" state (special marker means nothing matches)
      const NONE_MARKER = "__NONE_SELECTED__";
      const matchesColumnStatusFilter = columnStatusFilter.length === 0 || 
        (columnStatusFilter[0] !== NONE_MARKER && truck.mainStatus && columnStatusFilter.includes(truck.mainStatus));
      // Filter by actual shsOwner field (normalized), not calculated owner
      const normalizedOwner = normalizeOwnerName(truck.shsOwner);
      const matchesOwnerFilter = ownerFilter.length === 0 || 
        (ownerFilter[0] !== NONE_MARKER && ownerFilter.includes(normalizedOwner));

      let matchesIssueFilter = true;
      if (issueFilter !== "all") {
        const issueResult = computeTruckIssues(truck);
        if (issueFilter === "with-issues") {
          matchesIssueFilter = issueResult.count > 0;
        } else if (issueFilter === "critical") {
          matchesIssueFilter = issueResult.severity === "critical";
        } else if (issueFilter === "clean") {
          matchesIssueFilter = issueResult.count === 0;
        }
      }

      // Multi-select column filters (dropdown style)
      const matchesRegStickerFilter = matchesRegStickerMultiFilter(truck, regStickerFilter);
      const matchesCompletedFilter = matchesBooleanMultiFilter(truck.repairCompleted, completedFilter);
      const matchesAmsFilter = matchesBooleanMultiFilter(truck.inAms, amsFilter);
      const matchesRegExpiryFilter = matchesRegExpiryMultiFilter(truck, regExpiryFilter);
      const matchesAssignedFilter = matchesBooleanMultiFilter(truck.snowflakeAssigned, assignedFilter);
      const matchesUpsFilter = matchesUpsStatusMultiFilter(truck, upsStatusFilter);
      const matchesPickSlotFilter = matchesPickSlotMultiFilter(truck.pickUpSlotBooked, pickSlotFilter);
      const matchesGaveHolman = matchesGaveHolmanMultiFilter(truck.gaveHolman, gaveHolmanFilter);
      const matchesHolmanStatus = holmanStatusFilter.length === 0 || (() => {
        const NONE_MARKER = "__NONE_SELECTED__";
        if (holmanStatusFilter[0] === NONE_MARKER) return false;
        const truckNum = truck.truckNumber?.toString().padStart(6, '0') || '';
        const scraperData = scraperStatusMap?.[truckNum];
        const displayStatus = scraperData?.status ? scraperData.status.replace(/_/g, ' ') : null;
        if (!displayStatus) return holmanStatusFilter.includes("(No Data)");
        return holmanStatusFilter.includes(displayStatus);
      })();
      const matchesSpareVan = matchesSpareVanMultiFilter(truck.spareVanAssignmentInProcess, spareVanFilter);
      const matchesRegTestSlot = matchesPickSlotMultiFilter(truck.regTestSlotBooked, regTestSlotFilter);
      const matchesState = matchesStateMultiFilter(truck, stateFilter);
      const matchesRegion = regionFilter.length === 0 || (() => {
        const NONE_MARKER = "__NONE_SELECTED__";
        if (regionFilter[0] === NONE_MARKER) return false;
        const truckState = truck.techState?.trim().toUpperCase() || "";
        const region = truckState ? STATE_TO_REGION[truckState] : undefined;
        return region ? regionFilter.includes(region) : false;
      })();
      const matchesCallStatus = callStatusFilter.length === 0 || 
        (callStatusFilter.includes("(Blank)") && (!truck.callStatus || !truck.callStatus.trim())) ||
        (truck.callStatus && callStatusFilter.includes(truck.callStatus.trim()));
      const matchesByov = byovFilter.length === 0 || (() => {
        const normalizedNum = truck.truckNumber.replace(/^0+/, '') || '0';
        const isEnrolled = !!byovEnrollmentMap?.[normalizedNum];
        if (byovFilter.includes("BYOV") && isEnrolled) return true;
        if (byovFilter.includes("Non-BYOV") && !isEnrolled) return true;
        return false;
      })();

      return matchesSearch && matchesMainStatus && matchesSubStatus && matchesIssueFilter && 
             matchesTruckNumberFilter && matchesColumnStatusFilter && matchesOwnerFilter &&
             matchesRegStickerFilter && matchesCompletedFilter && matchesAmsFilter && matchesRegExpiryFilter && matchesAssignedFilter && matchesUpsFilter && matchesPickSlotFilter && matchesGaveHolman && matchesHolmanStatus && matchesSpareVan && matchesRegTestSlot && matchesState && matchesRegion && matchesCallStatus && matchesByov;
    }) || [];
    
    // Helper function to parse date strings (handles formats like "M/D/YYYY", "MM/DD/YYYY", "YYYY-MM-DD")
    const parseDate = (dateStr: string | null | undefined): number | null => {
      if (!dateStr || dateStr.trim() === "") return null;
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date.getTime();
    };

    // Multi-column sorting - both sorts can be active simultaneously
    // Primary sort is Date In Repair, secondary sort is Reg. Expiry (or vice versa if only one is active)
    return filtered.sort((a, b) => {
      // First apply Date In Repair sort if active
      if (dateRepairSortOrder) {
        const dateA = parseDate(a.datePutInRepair);
        const dateB = parseDate(b.datePutInRepair);
        
        // Put nulls at the end regardless of sort order
        if (dateA === null && dateB !== null) return 1;
        if (dateA !== null && dateB === null) return -1;
        
        if (dateA !== null && dateB !== null && dateA !== dateB) {
          return dateRepairSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        }
      }
      
      // Then apply Bill Paid sort if active
      if (billPaidSortOrder) {
        const dateA = parseDate(a.billPaidDate);
        const dateB = parseDate(b.billPaidDate);
        
        // Put nulls at the end regardless of sort order
        if (dateA === null && dateB !== null) return 1;
        if (dateA !== null && dateB === null) return -1;
        
        if (dateA !== null && dateB !== null && dateA !== dateB) {
          return billPaidSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        }
      }
      
      // Then apply Reg. Expiry sort if active (as secondary sort or primary if date repair is not active)
      if (regExpirySortOrder) {
        const dateA = parseDate(a.holmanRegExpiry);
        const dateB = parseDate(b.holmanRegExpiry);
        
        // Put nulls at the end regardless of sort order
        if (dateA === null && dateB !== null) return 1;
        if (dateA !== null && dateB === null) return -1;
        
        if (dateA !== null && dateB !== null && dateA !== dateB) {
          return regExpirySortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        }
      }
      
      // Default sort by date in repair (earliest first) if no sorts are active
      if (!dateRepairSortOrder && !billPaidSortOrder && !regExpirySortOrder) {
        const dateA = a.datePutInRepair ? new Date(a.datePutInRepair).getTime() : Infinity;
        const dateB = b.datePutInRepair ? new Date(b.datePutInRepair).getTime() : Infinity;
        return dateA - dateB;
      }
      
      return 0;
    });
  }, [trucks, debouncedSearch, mainStatusFilter, subStatusFilter, issueFilter, truckNumberFilter, columnStatusFilter, callStatusFilter, ownerFilter, regStickerFilter, completedFilter, amsFilter, regExpiryFilter, assignedFilter, upsStatusFilter, pickSlotFilter, gaveHolmanFilter, holmanStatusFilter, scraperStatusMap, spareVanFilter, regTestSlotFilter, stateFilter, regionFilter, byovFilter, byovEnrollmentMap, regExpirySortOrder, dateRepairSortOrder, billPaidSortOrder]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredTrucks.length / TRUCKS_PER_PAGE);
  const startIndex = (currentPage - 1) * TRUCKS_PER_PAGE;
  const endIndex = startIndex + TRUCKS_PER_PAGE;
  const paginatedTrucks = useMemo(() => 
    filteredTrucks.slice(startIndex, endIndex),
    [filteredTrucks, startIndex, endIndex]
  );

  const issueStats = useIssueStats(trucks);

  const hasActiveFilters = searchQuery !== "" || mainStatusFilter !== "all" || subStatusFilter !== "all" || issueFilter !== "all" || 
                           truckNumberFilter !== "" || columnStatusFilter.length > 0 || ownerFilter.length > 0 ||
                           hasActiveColumnFilters || regExpirySortOrder !== null || dateRepairSortOrder !== null || billPaidSortOrder !== null;

  const clearFilters = () => {
    setSearchQuery("");
    setMainStatusFilter("all");
    setSubStatusFilter("all");
    setIssueFilter("all");
    setTruckNumberFilter("");
    setColumnStatusFilter([]);
    setOwnerFilter([]);
    setRegExpirySortOrder(null);
    setDateRepairSortOrder(null);
    setBillPaidSortOrder(null);
    clearColumnFilters();
    // Clear stored filters from localStorage
    localStorage.removeItem(DASHBOARD_FILTERS_KEY);
  };

  const bulkImportMutation = useMutation({
    mutationFn: async (trucks: any[]) => {
      const res = await apiRequest("POST", "/api/trucks/bulk-import", { trucks });
      return await res.json();
    },
    onSuccess: (data: { imported: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setImportResults({
        success: data.imported || 0,
        errors: data.errors || [],
      });
      setImportFile(null);
      toast({
        title: "Import completed",
        description: `Successfully imported ${data.imported} trucks${data.errors?.length ? ` with ${data.errors.length} errors` : ""}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import trucks",
        variant: "destructive",
      });
    },
  });

  const callImportMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      const res = await apiRequest("POST", "/api/trucks/call-import", { rows });
      return await res.json();
    },
    onSuccess: (data: { updated: number; notFound: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setCallImportResults(data);
      setCallImportFile(null);
      toast({
        title: "Call import completed",
        description: `Updated ${data.updated} trucks${data.notFound ? `, ${data.notFound} not found` : ""}${data.errors?.length ? `, ${data.errors.length} errors` : ""}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Call import failed",
        description: error.message || "Failed to import call data",
        variant: "destructive",
      });
    },
  });

  // Bulk sync mutation
  const bulkSyncMutation = useMutation({
    mutationFn: async (truckNumbers: string[]) => {
      const res = await apiRequest("POST", "/api/trucks/bulk-sync", { 
        truckNumbers,
        syncedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: (data: { added: number; removed: number; kept: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setBulkSyncResults(data);
      toast({
        title: "Bulk sync completed",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Bulk sync failed",
        description: error.message || "Failed to sync trucks",
        variant: "destructive",
      });
    },
  });

  const calculateBulkSyncPreview = () => {
    const inputNumbers = bulkSyncInput
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s);
    
    if (inputNumbers.length === 0) {
      toast({
        title: "No truck numbers",
        description: "Please enter at least one truck number",
        variant: "destructive",
      });
      return;
    }
    
    const uniqueInput = Array.from(new Set(inputNumbers));
    const existingNumbers = new Set(trucks?.map(t => t.truckNumber) || []);
    const inputSet = new Set(uniqueInput);
    
    const toRemove = trucks?.filter(t => !inputSet.has(t.truckNumber)).map(t => t.truckNumber) || [];
    const toAdd = uniqueInput.filter(n => !existingNumbers.has(n));
    const toKeep = uniqueInput.filter(n => existingNumbers.has(n)).length;
    
    setBulkSyncPreview({ toAdd, toRemove, toKeep });
  };

  const handleBulkSync = () => {
    const truckNumbers = bulkSyncInput
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s);
    
    bulkSyncMutation.mutate(truckNumbers);
  };

  const resetBulkSyncDialog = () => {
    setBulkSyncResults(null);
    setBulkSyncInput("");
    setBulkSyncPreview(null);
    setIsBulkSyncDialogOpen(false);
  };

  // Truck consolidation mutation
  const consolidateMutation = useMutation({
    mutationFn: async (entries: Array<{ truckNumber: string; dateInRepair?: string }>) => {
      const res = await apiRequest("POST", "/api/trucks/consolidate", { 
        entries,
        consolidatedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: (data: { added: string[]; removed: string[]; addedCount: number; removedCount: number; unchangedCount: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setConsolidateResults({
        added: data.added,
        removed: data.removed,
        addedCount: data.addedCount,
        removedCount: data.removedCount,
        unchangedCount: data.unchangedCount,
      });
      toast({
        title: "Consolidation completed",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Consolidation failed",
        description: error.message || "Failed to consolidate trucks",
        variant: "destructive",
      });
    },
  });

  // Parse pasted 2-column data (truck # and date in repair)
  const parseConsolidateInput = (text: string): Array<{ truckNumber: string; dateInRepair?: string }> => {
    const lines = text.split('\n').filter(line => line.trim());
    const entries: Array<{ truckNumber: string; dateInRepair?: string }> = [];
    
    for (const line of lines) {
      // Split by tab or multiple spaces
      const parts = line.split(/\t+|\s{2,}/).map(p => p.trim()).filter(p => p);
      if (parts.length >= 1) {
        const truckNumber = parts[0];
        const dateInRepair = parts.length >= 2 ? parts[1] : undefined;
        if (truckNumber) {
          entries.push({ truckNumber, dateInRepair });
        }
      }
    }
    
    return entries;
  };

  const handleConsolidate = () => {
    const entries = parseConsolidateInput(consolidatePasteText);
    if (entries.length === 0) {
      toast({
        title: "No truck numbers",
        description: "Please paste at least one truck number",
        variant: "destructive",
      });
      return;
    }
    consolidateMutation.mutate(entries);
  };

  const resetConsolidateDialog = () => {
    setConsolidateResults(null);
    setConsolidatePasteText("");
    setIsConsolidateDialogOpen(false);
  };

  // Sync declined repairs mutation - updates trucks with "Decline and Submit for Sale" POs to "Declined Repair" status
  const syncDeclinedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/pos/sync-declined-repairs', {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/trucks'] });
      
      const skippedNote = data.skippedApprovedForSale > 0 
        ? ` (${data.skippedApprovedForSale} skipped - already "Approved for sale")` 
        : '';
      
      if (data.updated > 0) {
        toast({
          title: "Sync Complete",
          description: `Updated ${data.updated} truck(s) to "Declined Repair" status. ${data.alreadyDeclined} already had this status.${skippedNote}`,
        });
      } else if (data.alreadyDeclined > 0 || data.skippedApprovedForSale > 0) {
        toast({
          title: "Already Synced",
          description: `${data.alreadyDeclined} trucks already have "Declined Repair" status.${skippedNote}`,
        });
      } else {
        toast({
          title: "No Matches Found",
          description: `Found ${data.totalDeclinedPOs} records with "Decline and Submit for Sale" but none matched trucks in Dashboard.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Inline edit mutation
  const inlineEditMutation = useMutation({
    mutationFn: async ({ truckId, field, value }: { truckId: string; field: string; value: any }) => {
      const res = await apiRequest("PATCH", `/api/trucks/${truckId}`, { 
        [field]: value,
        lastUpdatedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setEditingCell(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update truck",
        variant: "destructive",
      });
    },
  });

  // Start inline editing
  const startEditing = (truckId: string, field: string, currentValue: any) => {
    setEditingCell({ truckId, field });
    setEditValue(currentValue === null || currentValue === undefined ? "" : String(currentValue));
  };

  // Save inline edit
  const saveEdit = (truckId: string, field: string, value: any) => {
    // When mainStatus changes to "Approved for sale", auto-set subStatus to "Clearing Softeon Inventory" and owner to "Jenn D."
    if (field === "mainStatus" && value === "Approved for sale") {
      apiRequest("PATCH", `/api/trucks/${truckId}`, { 
        mainStatus: value,
        subStatus: "Clearing Softeon Inventory",
        shsOwner: "Jenn D.",
        lastUpdatedBy: currentUser || "User"
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
        hideReminder(truckId);
      }).catch((error: any) => {
        toast({
          title: "Update failed",
          description: error.message || "Failed to update truck",
          variant: "destructive",
        });
      });
      return;
    }
    
    // When registrationStickerValid changes to "Ordered duplicates", auto-set subStatus to "Ordering duplicate tags"
    if (field === "registrationStickerValid" && value === "Ordered duplicates") {
      // Find the truck to get its current mainStatus (required for subStatus validation)
      const truck = trucks?.find(t => t.id === truckId);
      const currentMainStatus = truck?.mainStatus || "Confirming Status";
      
      apiRequest("PATCH", `/api/trucks/${truckId}`, { 
        registrationStickerValid: value,
        mainStatus: currentMainStatus, // Include current mainStatus to satisfy validation
        subStatus: "Ordering duplicate tags",
        lastUpdatedBy: currentUser || "User"
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
        showReminder(truckId);
        toast({
          title: "Status Updated",
          description: "Substatus automatically changed to 'Ordering duplicate tags'",
        });
      }).catch((error: any) => {
        toast({
          title: "Update failed",
          description: error.message || "Failed to update truck",
          variant: "destructive",
        });
      });
      return;
    }
    
    inlineEditMutation.mutate({ truckId, field, value });
    // Show reminder for non-status field changes
    if (field !== "mainStatus" && field !== "subStatus") {
      showReminder(truckId);
    } else {
      hideReminder(truckId);
    }
  };

  // Helper function to determine owner for "Approved for sale" substatus
  const getOwnerForApprovedForSale = (subStatus: string | null): string | null => {
    if (subStatus === "Clearing Softeon Inventory" || subStatus === "Vehicle Termination Form completed") {
      return "Jenn D.";
    }
    if (subStatus === "Fleet Administrator review" || subStatus === "Procurement to transfer form to leadership") {
      return "Bob B.";
    }
    if (subStatus === "Leadership to approve Docusign") {
      return "Samantha W";
    }
    return null; // Don't change owner for other substatuses
  };

  // Save sub-status with mainStatus included (required for validation)
  const saveSubStatus = (truckId: string, mainStatus: string, subStatus: string | null) => {
    const updates: Record<string, any> = { mainStatus, subStatus };
    
    // Auto-set owner for "Approved for sale" substatuses
    if (mainStatus === "Approved for sale") {
      const newOwner = getOwnerForApprovedForSale(subStatus);
      if (newOwner) {
        updates.shsOwner = newOwner;
      }
    }
    
    apiRequest("PATCH", `/api/trucks/${truckId}`, { 
      ...updates,
      lastUpdatedBy: currentUser || "User"
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      hideReminder(truckId);
    }).catch((error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update truck",
        variant: "destructive",
      });
    });
  };

  // Handle boolean field change
  const handleBooleanChange = (truckId: string, field: string, value: string) => {
    let boolValue: boolean | null = null;
    if (value === "true") boolValue = true;
    else if (value === "false") boolValue = false;
    saveEdit(truckId, field, boolValue);
  };

  // Format date string to consistent M/D/YYYY format
  const formatDateString = (dateStr: string): string | null => {
    if (!dateStr || !dateStr.trim()) return null;
    
    const trimmed = dateStr.trim();
    
    // Handle ISO format (YYYY-MM-DD) from date input
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [year, month, day] = trimmed.split('-');
      return `${parseInt(month)}/${parseInt(day)}/${year}`;
    }
    
    // Handle various date formats and normalize to M/D/YYYY
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
    }
    
    // If can't parse, return as-is
    return trimmed;
  };

  // Convert M/D/YYYY to YYYY-MM-DD for date input
  const toDateInputValue = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    
    // Try to parse M/D/YYYY format
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Try to parse as date
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    
    return '';
  };

  // Handle text field save
  const handleTextSave = (truckId: string, field: string) => {
    saveEdit(truckId, field, editValue.trim() || null);
    setEditingCell(null);
  };

  // Handle date field save with formatting
  const handleDateSave = (truckId: string, field: string) => {
    const formattedDate = formatDateString(editValue);
    saveEdit(truckId, field, formattedDate);
    setEditingCell(null);
  };

  // Owner editing functions
  const startEditingOwner = (truckId: string, currentOwner: string | null) => {
    setEditingOwner(truckId);
    setCustomOwnerInput(currentOwner || "");
  };

  const saveOwner = (truckId: string, ownerValue: string) => {
    inlineEditMutation.mutate({ truckId, field: "shsOwner", value: ownerValue.trim() || null });
    showReminder(truckId);
    setEditingOwner(null);
    setCustomOwnerInput("");
  };

  const handleOwnerKeyDown = (e: React.KeyboardEvent, truckId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveOwner(truckId, customOwnerInput);
    } else if (e.key === "Escape") {
      setEditingOwner(null);
      setCustomOwnerInput("");
    }
  };

  // Get display owner - use shsOwner if set, otherwise calculate from status
  const getDisplayOwner = (truck: Truck): string => {
    if (truck.shsOwner) {
      return truck.shsOwner;
    }
    return determineOwner(truck);
  };

  // Get color for owner - returns default style for custom names
  const getOwnerColor = (owner: string): string => {
    if (owner in ownerColors) {
      return ownerColors[owner as OwnerType];
    }
    // Custom owner - use a neutral style
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResults(null);
    }
  };

  // Snowflake sync function
  const handleSnowflakeSync = async () => {
    setIsSyncing(true);
    setSyncResults(null);
    try {
      const response = await apiRequest("POST", "/api/snowflake/sync-tech-data", {});
      const data = await response.json();
      setSyncResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      toast({
        title: "Sync Complete",
        description: `Updated ${data.updated} trucks with tech data from Snowflake`,
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync tech data from Snowflake",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCallRepairShop = async (truckId: string) => {
    setCallingTruckId(truckId);
    try {
      await apiRequest("POST", `/api/trucks/${truckId}/call-repair-shop`, {});
      toast({
        title: "Call initiated",
        description: "The repair shop is being called now.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to start call",
        description: error.message || "Could not initiate call to repair shop.",
        variant: "destructive",
      });
    } finally {
      setCallingTruckId(null);
    }
  };

  const handleCallTechnician = async (truckId: string) => {
    setCallingTechTruckId(truckId);
    try {
      await apiRequest("POST", `/api/trucks/${truckId}/call-technician`, {});
      toast({
        title: "Call initiated",
        description: "The technician is being called now.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to start call",
        description: error.message || "Could not initiate call to technician.",
        variant: "destructive",
      });
    } finally {
      setCallingTechTruckId(null);
    }
  };

  const resetSyncDialog = () => {
    setSyncResults(null);
    setIsSyncDialogOpen(false);
  };

  const handleUpsRefresh = async () => {
    setIsRefreshingUps(true);
    setUpsRefreshResults(null);
    try {
      const response = await apiRequest("POST", "/api/tracking/refresh-all", {});
      const data = await response.json();
      setUpsRefreshResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      toast({
        title: "UPS Refresh Complete",
        description: `Updated ${data.updated} tracking records`,
      });
    } catch (error: any) {
      toast({
        title: "UPS refresh failed",
        description: error.message || "Failed to refresh UPS tracking",
        variant: "destructive",
      });
    } finally {
      setIsRefreshingUps(false);
    }
  };

  const resetUpsDialog = () => {
    setUpsRefreshResults(null);
    setIsUpsDialogOpen(false);
  };

  const handleImportCSV = () => {
    if (!importFile) return;

    Papa.parse(importFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const trucks = results.data.map((row: any) => {
          const getValue = (field: string, ...alternates: string[]) => {
            const value = row[field] || alternates.reduce((acc, alt) => acc || row[alt], "");
            const trimmed = typeof value === "string" ? value.trim() : value;
            return trimmed || undefined;
          };
          
          const getBoolValue = (field: string, ...alternates: string[]) => {
            const value = row[field] || alternates.reduce((acc, alt) => acc || row[alt], "");
            if (value == null || String(value).trim() === "") return undefined;
            const lower = typeof value === "string" ? value.toLowerCase().trim() : "";
            if (value === true || lower === "true" || lower === "yes" || lower === "y" || lower === "1") {
              return true;
            }
            if (value === false || lower === "false" || lower === "no" || lower === "n" || lower === "0") {
              return false;
            }
            return undefined;
          };
          
          const getRegistrationValid = () => {
            const value = getValue("Registration sticker valid", "registrationStickerValid", "registration_sticker_valid");
            if (!value) return undefined;
            return value;
          };
          
          return {
            truckNumber: getValue("Truck Number", "truckNumber", "truck_number") || "",
            status: getValue("STATUS", "status", "Status") || "Confirming Status",
            datePutInRepair: getValue("Date put in Repair", "datePutInRepair", "Date Put in Repair", "date_put_in_repair") || "",
            shsOwner: getValue("SHS Ownership", "shsOwner", "SHS Owner", "shs_owner"),
            dateLastMarkedAsOwned: getValue("Date last marked as owned", "dateLastMarkedAsOwned"),
            registrationStickerValid: getRegistrationValid(),
            repairAddress: getValue("Repair Address", "repairAddress", "repair_address"),
            repairPhone: getValue("Repair Addres Ph#", "repairPhone", "Repair Phone", "repair_phone"),
            contactName: getValue("Local Repair Contact Name", "contactName", "Contact Name", "contact_name"),
            confirmedSetOfExpiredTags: getBoolValue("Confirmed set of expired tags", "confirmedSetOfExpiredTags", "Confirmed Set of Expired Tags"),
            repairCompleted: getBoolValue("Completed (Y/N)", "repairCompleted", "Repair Completed", "Completed"),
            inAms: getBoolValue("AMS Documented (Y/N)", "inAms", "In AMS", "AMS Documented"),
            vanPickedUp: getBoolValue("Van Picked Up [Y/N]", "vanPickedUp", "Van Picked Up"),
            comments: getValue("Comments", "comments", "Virtual Comments", "notes", "Notes"),
            techPhone: getValue("Tech Phone Number", "techPhone", "Tech Phone"),
            techName: getValue("Tech name", "techName", "Tech Name"),
            pickUpSlotBooked: getBoolValue("Pick up slot booked [Mandy]", "pickUpSlotBooked", "Pick Up Slot Booked"),
            timeBlockedToPickUpVan: getValue("Time block to pick up van [Mandy]", "timeBlockedToPickUpVan", "Time Blocked To Pick Up Van"),
            rentalReturned: getBoolValue("Rental returned [Y/N]", "rentalReturned", "Rental Returned"),
            newTruckAssigned: getBoolValue("Does Tech Need New Truck Assigned?", "newTruckAssigned", "New Truck Assigned"),
            confirmedDeclinedRepair: getValue("Confirmed Declined repair", "confirmedDeclinedRepair", "Confirmed Declined Repair"),
            registrationRenewalInProcess: getBoolValue("Registration renewal in process [Yes/No]", "registrationRenewalInProcess", "Registration Renewal In Process"),
            spareVanAssignmentInProcess: getBoolValue("Spare van assignment in process", "spareVanAssignmentInProcess", "Spare Van Assignment In Process"),
            spareVanInProcessToShip: getBoolValue("Spare Van is located and in process to ship", "spareVanInProcessToShip", "Spare Van In Process to Ship"),
            lastUpdatedBy: "CSV Import",
          };
        });

        bulkImportMutation.mutate(trucks);
      },
      error: (error) => {
        toast({
          title: "CSV parsing failed",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const resetImportDialog = () => {
    setImportFile(null);
    setImportResults(null);
    setIsImportDialogOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const resetCallImportDialog = () => {
    setCallImportFile(null);
    setCallImportResults(null);
    setIsCallImportDialogOpen(false);
    if (callImportFileRef.current) {
      callImportFileRef.current.value = "";
    }
  };

  const handleCallImportFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCallImportFile(file);
    }
  };

  const normalizeDate = (value: any): string => {
    if (!value) return "";
    const str = String(value).trim();
    if (!str) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (typeof value === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + value * 86400000);
      if (!isNaN(date.getTime())) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
    }
    return "";
  };

  const handleCallImport = () => {
    if (!callImportFile) return;

    const ext = callImportFile.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target?.result, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false });
          processCallImportData(jsonData);
        } catch (err: any) {
          toast({ title: "Failed to parse file", description: err.message, variant: "destructive" });
        }
      };
      reader.readAsArrayBuffer(callImportFile);
    } else {
      Papa.parse(callImportFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processCallImportData(results.data);
        },
        error: (error) => {
          toast({ title: "CSV parsing failed", description: error.message, variant: "destructive" });
        },
      });
    }
  };

  const processCallImportData = (data: any[]) => {
    const rows = data.map((row: any) => {
      const lcRow: Record<string, any> = {};
      for (const key of Object.keys(row)) {
        lcRow[key.toLowerCase().trim()] = row[key];
      }
      const getValue = (...fields: string[]) => {
        for (const f of fields) {
          const val = lcRow[f.toLowerCase()];
          if (val !== undefined && val !== null && String(val).trim() !== "") {
            return String(val).trim();
          }
        }
        return "";
      };

      const truckNumber = getValue("truck #", "truck number", "trucknumber", "truck_number", "truck#");
      const callStatus = getValue("call status", "callstatus", "call_status");
      const eta = getValue("eta");
      const lastDateCalled = normalizeDate(lcRow["last called"] ?? lcRow["last call"] ?? lcRow["last date called"] ?? lcRow["lastdatecalled"] ?? lcRow["last_date_called"] ?? lcRow["lastcalled"] ?? "");

      return { truckNumber, callStatus, eta, lastDateCalled };
    }).filter((r: any) => r.truckNumber);

    if (rows.length === 0) {
      toast({ title: "No valid rows found", description: "Make sure the file has a 'Truck #' column", variant: "destructive" });
      return;
    }

    callImportMutation.mutate(rows);
  };

  const exportToCSV = () => {
    if (!filteredTrucks || filteredTrucks.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply filters or wait for data to load",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Truck Number",
      "SHS Owner",
      "Main Status",
      "Sub-Status",
      "Status (Combined)",
      "Registration Sticker Valid",
      "Date Put in Repair",
      "Repair Completed",
      "AMS Documented",
      "Repair Address",
      "Repair Phone",
      "Local Repair Contact Name",
      "Confirmed Set of Expired Tags",
      "Confirmed Declined Repair",
      "Tech Name",
      "Tech Phone",
      "Pick Up Slot Booked",
      "Time Blocked To Pick Up Van",
      "Rental Returned",
      "Van Picked Up",
      "Comments",
      "New Truck Assigned",
      "Registration Renewal In Process",
      "Spare Van Assignment In Process",
      "Spare Van In Process to Ship",
      "Last Updated",
      "Last Updated By",
    ];

    const rows = filteredTrucks.map((truck) => [
      truck.truckNumber,
      truck.shsOwner || "",
      truck.mainStatus || "",
      truck.subStatus || "",
      truck.status,
      truck.registrationStickerValid ? "Yes" : "No",
      truck.datePutInRepair,
      truck.repairCompleted === true ? "Yes" : truck.repairCompleted === false ? "No" : "",
      truck.inAms ? "Yes" : "No",
      truck.repairAddress || "",
      truck.repairPhone || "",
      truck.contactName || "",
      truck.confirmedSetOfExpiredTags ? "Yes" : "No",
      truck.confirmedDeclinedRepair || "",
      truck.techName || "",
      truck.techPhone || "",
      truck.pickUpSlotBooked ? "Yes" : "No",
      truck.timeBlockedToPickUpVan || "",
      truck.rentalReturned ? "Yes" : "No",
      truck.vanPickedUp ? "Yes" : "No",
      truck.comments || "",
      truck.newTruckAssigned ? "Yes" : "No",
      truck.registrationRenewalInProcess ? "Yes" : "No",
      truck.spareVanAssignmentInProcess ? "Yes" : "No",
      truck.spareVanInProcessToShip ? "Yes" : "No",
      truck.lastUpdatedAt ? format(new Date(truck.lastUpdatedAt), "yyyy-MM-dd HH:mm:ss") : "",
      truck.lastUpdatedBy || "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `fleet-scope-${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Export successful",
      description: `Exported ${filteredTrucks.length} trucks to CSV`,
    });
  };

  const exportToExcel = async () => {
    if (!filteredTrucks || filteredTrucks.length === 0) {
      toast({
        title: "No data to export",
        description: "Apply filters or wait for data to load",
        variant: "destructive",
      });
      return;
    }

    let techSpecialties: Record<string, string | null> = {};
    let techEnterpriseIds: Record<string, string | null> = {};
    try {
      const truckNumbers = filteredTrucks.map(t => t.truckNumber);
      if (truckNumbers.length > 0) {
        const res = await apiRequest("POST", "/api/tech-specialty/batch", { truckNumbers });
        const data = await res.json();
        techSpecialties = data.specialties || {};
        techEnterpriseIds = data.enterpriseIds || {};
      }
    } catch (e) {
      console.error("Failed to fetch tech specialties for export:", e);
    }

    const worksheetData = filteredTrucks.map((truck) => ({
      "Truck Number": truck.truckNumber,
      "State": truck.techState || "",
      "SHS Owner": truck.shsOwner || "",
      "Main Status": truck.mainStatus || "",
      "Sub-Status": truck.subStatus || "",
      "Status (Combined)": truck.status,
      "Registration Sticker Valid": truck.registrationStickerValid ? "Yes" : "No",
      "Date Put in Repair": truck.datePutInRepair,
      "Repair Completed": truck.repairCompleted === true ? "Yes" : truck.repairCompleted === false ? "No" : "",
      "AMS Documented": truck.inAms ? "Yes" : "No",
      "Repair Address": truck.repairAddress || "",
      "Repair Phone": truck.repairPhone || "",
      "Local Repair Contact Name": truck.contactName || "",
      "Confirmed Set of Expired Tags": truck.confirmedSetOfExpiredTags ? "Yes" : "No",
      "Confirmed Declined Repair": truck.confirmedDeclinedRepair || "",
      "Assigned": truck.snowflakeAssigned === true ? "Yes" : truck.snowflakeAssigned === false ? "No" : "",
      "Tech Name": truck.techName || "",
      "Enterprise ID": techEnterpriseIds[truck.truckNumber] || "",
      "Tech Specialty": techSpecialties[truck.truckNumber] || "",
      "Tech Phone": truck.techPhone || "",
      "Pick Up Slot Booked": truck.pickUpSlotBooked ? "Yes" : "No",
      "Time Blocked To Pick Up Van": truck.timeBlockedToPickUpVan || "",
      "Rental Returned": truck.rentalReturned ? "Yes" : "No",
      "Van Picked Up": truck.vanPickedUp ? "Yes" : "No",
      "Comments": truck.comments || "",
      "New Truck Assigned": truck.newTruckAssigned ? "Yes" : "No",
      "Registration Renewal In Process": truck.registrationRenewalInProcess ? "Yes" : "No",
      "Spare Van Assignment In Process": truck.spareVanAssignmentInProcess ? "Yes" : "No",
      "Spare Van In Process to Ship": truck.spareVanInProcessToShip ? "Yes" : "No",
      "Last Updated": truck.lastUpdatedAt ? format(new Date(truck.lastUpdatedAt), "yyyy-MM-dd HH:mm:ss") : "",
      "Last Updated By": truck.lastUpdatedBy || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fleet Trucks");

    const colWidths = [
      { wch: 15 }, // Truck Number
      { wch: 10 }, // State
      { wch: 25 }, // SHS Owner
      { wch: 25 }, // Main Status
      { wch: 35 }, // Sub-Status
      { wch: 45 }, // Status (Combined)
      { wch: 25 }, // Registration Sticker Valid
      { wch: 18 }, // Date Put in Repair
      { wch: 18 }, // Repair Completed
      { wch: 18 }, // AMS Documented
      { wch: 50 }, // Repair Address
      { wch: 15 }, // Repair Phone
      { wch: 25 }, // Local Repair Contact Name
      { wch: 28 }, // Confirmed Set of Expired Tags
      { wch: 30 }, // Confirmed Declined Repair
      { wch: 12 }, // Assigned
      { wch: 20 }, // Tech Name
      { wch: 15 }, // Enterprise ID
      { wch: 25 }, // Tech Specialty
      { wch: 15 }, // Tech Phone
      { wch: 20 }, // Pick Up Slot Booked
      { wch: 28 }, // Time Blocked To Pick Up Van
      { wch: 18 }, // Rental Returned
      { wch: 15 }, // Van Picked Up
      { wch: 50 }, // Comments
      { wch: 20 }, // New Truck Assigned
      { wch: 30 }, // Registration Renewal In Process
      { wch: 35 }, // Spare Van Assignment In Process
      { wch: 30 }, // Spare Van In Process to Ship
      { wch: 20 }, // Last Updated
      { wch: 18 }, // Last Updated By
    ];
    worksheet["!cols"] = colWidths;

    XLSX.writeFile(workbook, `fleet-scope-${format(new Date(), "yyyy-MM-dd")}.xlsx`);

    toast({
      title: "Export successful",
      description: `Exported ${filteredTrucks.length} trucks to Excel`,
    });
  };

  return (
    <div className="bg-background">

      <main className="px-4 lg:px-8 py-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h1 className="text-xl font-semibold mr-auto">Rentals Dashboard</h1>
          
          <Button 
            variant="outline" 
            size="sm"
            onClick={exportToExcel}
            disabled={!filteredTrucks || filteredTrucks.length === 0}
            data-testid="button-export-excel"
          >
            <Download className="w-3 h-3 mr-1" />
            Export
          </Button>
          
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-import-csv">
                <Upload className="w-3 h-3 mr-1" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Import Trucks from CSV</DialogTitle>
                <DialogDescription>
                  Upload a CSV file with truck data. Supported columns: truckNumber, status, datePutInRepair, repairAddress, and more.
                </DialogDescription>
              </DialogHeader>
              
              {importResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Import Complete</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm">
                      <strong>{importResults.success}</strong> trucks imported successfully
                    </p>
                    {importResults.errors.length > 0 && (
                      <div>
                        <p className="text-sm text-destructive font-medium mb-1">
                          {importResults.errors.length} errors:
                        </p>
                        <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1 bg-muted p-2 rounded">
                          {importResults.errors.map((error, i) => (
                            <div key={i}>{error}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button onClick={resetImportDialog} className="w-full" data-testid="button-close-import">
                    Close
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="csv-upload"
                      data-testid="input-csv-file"
                    />
                    <label htmlFor="csv-upload" className="cursor-pointer">
                      <FileUp className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        {importFile ? importFile.name : "Click to upload CSV"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        or drag and drop
                      </p>
                    </label>
                  </div>
                  
                  <Button
                    onClick={handleImportCSV}
                    disabled={!importFile || bulkImportMutation.isPending}
                    className="w-full"
                    data-testid="button-start-import"
                  >
                    {bulkImportMutation.isPending ? "Importing..." : "Import Trucks"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={isCallImportDialogOpen} onOpenChange={setIsCallImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-call-import">
                <Upload className="w-3 h-3 mr-1" />
                Call Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Call Import</DialogTitle>
                <DialogDescription>
                  Upload an XLSX or CSV file to update Call Status, ETA, and Last Called for existing trucks.
                </DialogDescription>
              </DialogHeader>

              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                <p className="font-medium text-sm">Required column format:</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="font-mono font-medium">Truck #</span>
                  <span className="text-muted-foreground">Truck number (e.g. 036096)</span>
                  <span className="font-mono font-medium">Call Status</span>
                  <span className="text-muted-foreground">Text, max 50 characters</span>
                  <span className="font-mono font-medium">ETA</span>
                  <span className="text-muted-foreground">Text (e.g. "Next Week", "2/15")</span>
                  <span className="font-mono font-medium">Last Called</span>
                  <span className="text-muted-foreground">Date (MM/DD/YYYY or YYYY-MM-DD)</span>
                </div>
                <p className="text-muted-foreground pt-1">Only provided columns will be updated. Blank cells are skipped.</p>
              </div>

              {callImportResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Import Complete</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm">
                      <strong>{callImportResults.updated}</strong> trucks updated
                      {callImportResults.notFound > 0 && (
                        <>, <strong>{callImportResults.notFound}</strong> not found</>
                      )}
                    </p>
                    {callImportResults.errors.length > 0 && (
                      <div>
                        <p className="text-sm text-destructive font-medium mb-1">
                          {callImportResults.errors.length} errors:
                        </p>
                        <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground space-y-1 bg-muted p-2 rounded">
                          {callImportResults.errors.map((error, i) => (
                            <div key={i}>{error}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button onClick={resetCallImportDialog} className="w-full" data-testid="button-close-call-import">
                    Close
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <input
                      ref={callImportFileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleCallImportFileSelect}
                      className="hidden"
                      id="call-import-upload"
                      data-testid="input-call-import-file"
                    />
                    <label htmlFor="call-import-upload" className="cursor-pointer">
                      <FileUp className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        {callImportFile ? callImportFile.name : "Click to upload XLSX or CSV"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        .xlsx, .xls, or .csv
                      </p>
                    </label>
                  </div>
                  
                  <Button
                    onClick={handleCallImport}
                    disabled={!callImportFile || callImportMutation.isPending}
                    className="w-full"
                    data-testid="button-start-call-import"
                  >
                    {callImportMutation.isPending ? "Importing..." : "Import Call Data"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          
          <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-sync-snowflake">
                <Database className="w-4 h-4 mr-2" />
                Sync Tech Data
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Sync Tech Data from Snowflake</DialogTitle>
                <DialogDescription>
                  Update tech name, phone, and TPMS assignment status using data from the Snowflake TPMS_EXTRACT table.
                </DialogDescription>
              </DialogHeader>
              
              {syncResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Sync Complete</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm">
                      <strong>{syncResults.updated}</strong> trucks updated
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Checked {syncResults.trucksChecked} trucks with blank fields, found {syncResults.snowflakeRecordsFound} matches in Snowflake
                    </p>
                    {syncResults.details.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-1">Updated trucks:</p>
                        <div className="max-h-48 overflow-y-auto text-xs space-y-1 bg-muted p-2 rounded">
                          {syncResults.details.map((detail, i) => (
                            <div key={i} className="flex flex-wrap gap-1">
                              <span className="font-mono font-medium">{detail.truckNumber}:</span>
                              {detail.techNameUpdated && (
                                <span className="text-green-600">Name: {detail.newTechName}</span>
                              )}
                              {detail.techPhoneUpdated && (
                                <span className="text-blue-600">Phone: {detail.newTechPhone}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button onClick={resetSyncDialog} className="w-full" data-testid="button-close-sync">
                    Close
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p className="mb-2">This will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Match all trucks against Snowflake TPMS_EXTRACT by truck number</li>
                      <li>Set TPMS to "Assigned" if found, "Unassigned" if not found</li>
                      <li>Populate tech name and phone from TPMS_EXTRACT for assigned trucks</li>
                    </ul>
                  </div>
                  
                  <Button
                    onClick={handleSnowflakeSync}
                    disabled={isSyncing}
                    className="w-full"
                    data-testid="button-start-sync"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Database className="w-4 h-4 mr-2" />
                        Start Sync
                      </>
                    )}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          
          <Dialog open={isUpsDialogOpen} onOpenChange={setIsUpsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-refresh-ups">
                <Package className="w-4 h-4 mr-2" />
                Refresh UPS
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Refresh All UPS Tracking</DialogTitle>
                <DialogDescription>
                  Fetch the latest tracking status for all active (non-delivered) UPS shipments.
                </DialogDescription>
              </DialogHeader>
              
              {upsRefreshResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Refresh Complete</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm">
                      <strong>{upsRefreshResults.updated}</strong> tracking records updated
                    </p>
                    {upsRefreshResults.failed > 0 && (
                      <p className="text-sm text-amber-600">
                        {upsRefreshResults.failed} failed to refresh
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Total active records: {upsRefreshResults.total}
                    </p>
                  </div>
                  <Button onClick={resetUpsDialog} className="w-full" data-testid="button-close-ups">
                    Close
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p className="mb-2">This will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Fetch all active (non-delivered) tracking records</li>
                      <li>Query UPS API for latest status on each shipment</li>
                      <li>Update tracking status, location, and estimated delivery</li>
                    </ul>
                    <p className="mt-2 text-xs">Note: UPS tracking also auto-refreshes every 30 minutes.</p>
                  </div>
                  
                  <Button
                    onClick={handleUpsRefresh}
                    disabled={isRefreshingUps}
                    className="w-full"
                    data-testid="button-start-ups-refresh"
                  >
                    {isRefreshingUps ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Refreshing UPS...
                      </>
                    ) : (
                      <>
                        <Package className="w-4 h-4 mr-2" />
                        Refresh All Tracking
                      </>
                    )}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          
          <Dialog open={isConsolidateDialogOpen} onOpenChange={setIsConsolidateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-consolidate">
                <RefreshCw className="w-3 h-3 mr-1" />
                Consolidate
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Weekly Truck Consolidation</DialogTitle>
                <DialogDescription>
                  Paste your 2-column list (Truck # and Date in Repair). Trucks in your list but not in the dashboard will be added. Trucks in the dashboard but not in your list will be removed.
                </DialogDescription>
              </DialogHeader>
              
              {consolidateResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Consolidation Complete</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{consolidateResults.addedCount}</p>
                      <p className="text-xs text-green-700">Added</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg">
                      <p className="text-2xl font-bold text-red-600">{consolidateResults.removedCount}</p>
                      <p className="text-xs text-red-700">Removed</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{consolidateResults.unchangedCount}</p>
                      <p className="text-xs text-blue-700">Unchanged</p>
                    </div>
                  </div>
                  {consolidateResults.removed.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-red-700 mb-2">Trucks Removed:</p>
                      <div className="max-h-24 overflow-y-auto text-xs font-mono text-red-600">
                        {consolidateResults.removed.join(", ")}
                      </div>
                    </div>
                  )}
                  {consolidateResults.added.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-green-700 mb-2">Trucks Added:</p>
                      <div className="max-h-24 overflow-y-auto text-xs font-mono text-green-600">
                        {consolidateResults.added.join(", ")}
                      </div>
                    </div>
                  )}
                  <Button onClick={resetConsolidateDialog} className="w-full" data-testid="button-close-consolidate">
                    Close
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={consolidatePasteText}
                    onChange={(e) => setConsolidatePasteText(e.target.value)}
                    placeholder="Paste 2-column data here (Truck # and Date in Repair)&#10;Example:&#10;12345    01/15/2025&#10;67890    01/16/2025"
                    className="w-full h-48 p-3 border rounded-lg text-sm font-mono resize-none"
                    data-testid="textarea-consolidate"
                  />
                  <p className="text-xs text-muted-foreground">
                    {parseConsolidateInput(consolidatePasteText).length} truck entries detected
                  </p>
                  <Button
                    onClick={handleConsolidate}
                    disabled={!consolidatePasteText.trim() || consolidateMutation.isPending}
                    className="w-full"
                    data-testid="button-run-consolidate"
                  >
                    {consolidateMutation.isPending ? "Consolidating..." : "Run Consolidation"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          
          <Dialog open={isBulkSyncDialogOpen} onOpenChange={setIsBulkSyncDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-bulk-sync">
                <RefreshCw className="w-3 h-3 mr-1" />
                Bulk Sync
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Bulk Sync Trucks</DialogTitle>
                <DialogDescription>
                  Paste truck numbers (one per line or comma-separated). Trucks NOT on this list will be removed. Missing trucks will be added with "Confirming Status / SHS Confirming".
                </DialogDescription>
              </DialogHeader>
              
              {bulkSyncResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Sync Complete</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{bulkSyncResults.added}</p>
                      <p className="text-xs text-green-700">Added</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg">
                      <p className="text-2xl font-bold text-red-600">{bulkSyncResults.removed}</p>
                      <p className="text-xs text-red-700">Removed</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{bulkSyncResults.kept}</p>
                      <p className="text-xs text-blue-700">Kept</p>
                    </div>
                  </div>
                  <Button onClick={resetBulkSyncDialog} className="w-full" data-testid="button-close-bulk-sync">
                    Close
                  </Button>
                </div>
              ) : bulkSyncPreview ? (
                <div className="space-y-4">
                  <div className="text-sm font-medium">Preview of changes:</div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{bulkSyncPreview.toAdd.length}</p>
                      <p className="text-xs text-green-700">Will Add</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg">
                      <p className="text-2xl font-bold text-red-600">{bulkSyncPreview.toRemove.length}</p>
                      <p className="text-xs text-red-700">Will Remove</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{bulkSyncPreview.toKeep}</p>
                      <p className="text-xs text-blue-700">Will Keep</p>
                    </div>
                  </div>
                  {bulkSyncPreview.toRemove.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-red-700 mb-2">Trucks to be REMOVED:</p>
                      <div className="max-h-24 overflow-y-auto text-xs font-mono text-red-600">
                        {bulkSyncPreview.toRemove.join(", ")}
                      </div>
                    </div>
                  )}
                  {bulkSyncPreview.toAdd.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-green-700 mb-2">Trucks to be ADDED:</p>
                      <div className="max-h-24 overflow-y-auto text-xs font-mono text-green-600">
                        {bulkSyncPreview.toAdd.join(", ")}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setBulkSyncPreview(null)} 
                      className="flex-1"
                      data-testid="button-back-bulk-sync"
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleBulkSync}
                      disabled={bulkSyncMutation.isPending}
                      className="flex-1"
                      data-testid="button-confirm-bulk-sync"
                    >
                      {bulkSyncMutation.isPending ? "Syncing..." : "Confirm Sync"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={bulkSyncInput}
                    onChange={(e) => {
                      setBulkSyncInput(e.target.value);
                      setBulkSyncPreview(null);
                    }}
                    placeholder="Paste truck numbers here (one per line or comma-separated)..."
                    className="w-full h-48 p-3 border rounded-lg text-sm font-mono resize-none"
                    data-testid="textarea-bulk-sync"
                  />
                  <p className="text-xs text-muted-foreground">
                    {bulkSyncInput.split(/[\n,]+/).filter(s => s.trim()).length} truck numbers detected
                  </p>
                  <Button
                    onClick={calculateBulkSyncPreview}
                    disabled={!bulkSyncInput.trim()}
                    className="w-full"
                    data-testid="button-preview-bulk-sync"
                  >
                    Preview Changes
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncDeclinedMutation.mutate()}
            disabled={syncDeclinedMutation.isPending}
            data-testid="button-sync-declined"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${syncDeclinedMutation.isPending ? "animate-spin" : ""}`} />
            {syncDeclinedMutation.isPending ? "Syncing..." : "Sync Declined"}
          </Button>

          <Link href="/trucks/new">
            <Button data-testid="button-add-truck">
              <Plus className="w-4 h-4 mr-2" />
              Add Truck
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4" data-testid="rental-summary-cards">
          <Card className="p-3 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20" data-testid="card-total-rentals">
            <div className="flex items-center gap-2 mb-1">
              <TruckIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Total Rentals</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{rentalSummary?.totalRentals ?? trucks?.length ?? 0}</p>
          </Card>
          <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="card-avg-duration">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Avg Duration</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{rentalSummary?.averageDurationDays ?? 0}d</p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">
              across active rentals
            </p>
          </Card>
          {/* Pickups Scheduled card moved to Fleet Overview page */}
          <Card className="p-3 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20" data-testid="card-regions">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Top 5 States</span>
            </div>
            {rentalSummary?.byRegion ? (
              <div className="space-y-0.5">
                {Object.entries(rentalSummary.byRegion)
                  .filter(([k]) => k !== 'Unknown')
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 5)
                  .map(([state, count]) => (
                    <div key={state} className="flex items-center justify-between gap-2" data-testid={`region-row-${state}`}>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{state}</span>
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{count}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">0</p>
            )}
          </Card>
        </div>

        <Card className="p-6">
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-sm" data-testid="outstanding-rentals-count">
              <span className="text-muted-foreground">Outstanding Rentals:</span>
              <Badge variant="secondary" className="font-semibold">
                {trucks ? trucks.length : 0}
              </Badge>
              <span className="text-xs text-muted-foreground italic">(manual imported data)</span>
            </div>
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search by truck number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              
              <Select value={mainStatusFilter} onValueChange={setMainStatusFilter}>
                <SelectTrigger className="w-full md:w-[200px]" data-testid="select-main-status-filter">
                  <SelectValue placeholder="Main Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Main Statuses</SelectItem>
                  {MAIN_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {availableSubStatuses.length > 0 && (
                <Select value={subStatusFilter} onValueChange={setSubStatusFilter}>
                  <SelectTrigger className="w-full md:w-[280px]" data-testid="select-sub-status-filter">
                    <SelectValue placeholder="Sub-Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sub-Statuses</SelectItem>
                    {availableSubStatuses.map((subStatus) => (
                      <SelectItem key={subStatus} value={subStatus}>
                        {subStatus}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              
              <Select value={issueFilter} onValueChange={(value) => setIssueFilter(value as typeof issueFilter)}>
                <SelectTrigger className="w-full md:w-[180px]" data-testid="select-issue-filter">
                  <SelectValue placeholder="Filter by Issues" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Trucks</SelectItem>
                  <SelectItem value="with-issues">
                    With Issues ({issueStats.withIssues})
                  </SelectItem>
                  <SelectItem value="critical">
                    Critical Issues ({issueStats.critical})
                  </SelectItem>
                  <SelectItem value="clean">
                    No Issues ({issueStats.clean})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground ml-auto"
                  data-testid="button-clear-filters"
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load trucks. Please try again later.
              </AlertDescription>
            </Alert>
          ) : isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : trucks && trucks.length === 0 ? (
            <div className="text-center py-12">
              <TruckIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No trucks yet</h3>
              <p className="text-muted-foreground mb-4">
                Get started by adding your first truck to the system
              </p>
              <Link href="/trucks/new">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Truck
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-6 px-6">
                <div className="inline-block min-w-full align-middle">
                  <div className="overflow-hidden border rounded-md">
                    <div className="max-h-[calc(100vh-20rem)] overflow-y-auto">
                      <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted sticky top-0 z-10 shadow-sm border-b">
                          <tr>
                            <th className="pl-2 pr-0 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground" style={{width: '28px', minWidth: '28px', maxWidth: '28px'}}>
                              ID
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-labels text-muted-foreground">
                              <div className="space-y-1">
                                <span>Truck #</span>
                                <Input
                                  type="text"
                                  placeholder="Filter..."
                                  value={truckNumberFilter}
                                  onChange={(e) => setTruckNumberFilter(e.target.value)}
                                  className="h-7 text-xs w-24"
                                  data-testid="filter-truck-number"
                                />
                                <div className="flex gap-1">
                                  <MultiSelectFilter
                                    options={[...uniqueStates, "(Blank)"]}
                                    selectedValues={stateFilter}
                                    onSelectionChange={setStateFilter}
                                    label="State"
                                    className="w-[52px]"
                                    data-testid="filter-state"
                                  />
                                  <MultiSelectFilter
                                    options={REGION_OPTIONS}
                                    selectedValues={regionFilter}
                                    onSelectionChange={setRegionFilter}
                                    label="Region"
                                    showSearch={false}
                                    className="w-[68px]"
                                    optionColors={REGION_COLORS}
                                    data-testid="filter-region"
                                  />
                                </div>
                              </div>
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-labels text-muted-foreground hidden sm:table-cell" data-testid="header-tech-name">
                              <div className="space-y-1">
                                <span>Tech Name</span>
                                <MultiSelectFilter
                                  options={["BYOV", "Non-BYOV"]}
                                  selectedValues={byovFilter}
                                  onSelectionChange={setByovFilter}
                                  label="BYOV"
                                  showSearch={false}
                                  className="w-[60px]"
                                  data-testid="filter-byov"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-labels text-muted-foreground">
                              <div className="space-y-1">
                                <span>Status</span>
                                <MultiSelectFilter
                                  options={[...MAIN_STATUSES]}
                                  selectedValues={columnStatusFilter}
                                  onSelectionChange={setColumnStatusFilter}
                                  label="Status"
                                  className="w-36"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-labels text-muted-foreground hidden sm:table-cell">
                              <div className="space-y-1">
                                <span>Assigned To</span>
                                <MultiSelectFilter
                                  options={uniqueOwners}
                                  selectedValues={ownerFilter}
                                  onSelectionChange={setOwnerFilter}
                                  label="Assigned To"
                                  className="w-36"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden sm:table-cell" title="Found in Snowflake TPMS">
                              <div className="space-y-1">
                                <span>TPMS</span>
                                <MultiSelectFilter
                                  options={BOOLEAN_OPTIONS}
                                  selectedValues={assignedFilter}
                                  onSelectionChange={setAssignedFilter}
                                  label="Assigned"
                                  showSearch={false}
                                  className="w-20"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden sm:table-cell" title="Date Put In Repair - Click to sort">
                              <button
                                className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto"
                                onClick={() => {
                                  if (dateRepairSortOrder === null) {
                                    setDateRepairSortOrder('asc'); // First click: oldest first
                                  } else if (dateRepairSortOrder === 'asc') {
                                    setDateRepairSortOrder('desc'); // Second click: newest first
                                  } else {
                                    setDateRepairSortOrder(null); // Third click: clear sort
                                  }
                                }}
                                data-testid="button-sort-date-repair"
                              >
                                <span>Date In Repair</span>
                                {dateRepairSortOrder === null && <ArrowUpDown className="w-3 h-3 opacity-50" />}
                                {dateRepairSortOrder === 'asc' && <ArrowUp className="w-3 h-3 text-primary" />}
                                {dateRepairSortOrder === 'desc' && <ArrowDown className="w-3 h-3 text-primary" />}
                              </button>
                            </th>
                            {/* Call Status, ETA, and Last Called columns hidden */}
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden md:table-cell" title="Registration Expiry Date from Holman - Click to sort">
                              <div className="space-y-1">
                                <button
                                  className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto"
                                  onClick={() => {
                                    if (regExpirySortOrder === null) {
                                      setRegExpirySortOrder('desc'); // First click: newest first (most recent)
                                    } else if (regExpirySortOrder === 'desc') {
                                      setRegExpirySortOrder('asc'); // Second click: oldest first (least recent)
                                    } else {
                                      setRegExpirySortOrder(null); // Third click: clear sort
                                    }
                                  }}
                                  data-testid="button-sort-reg-expiry"
                                >
                                  <span>Reg. Expiry</span>
                                  {regExpirySortOrder === null && <ArrowUpDown className="w-3 h-3 opacity-50" />}
                                  {regExpirySortOrder === 'desc' && <ArrowDown className="w-3 h-3 text-primary" />}
                                  {regExpirySortOrder === 'asc' && <ArrowUp className="w-3 h-3 text-primary" />}
                                </button>
                                <MultiSelectFilter
                                  options={REG_EXPIRY_OPTIONS}
                                  selectedValues={regExpiryFilter}
                                  onSelectionChange={setRegExpiryFilter}
                                  label="Reg Expiry"
                                  showSearch={false}
                                  className="w-24"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden md:table-cell">
                              <div className="space-y-1">
                                <span>Repaired</span>
                                <MultiSelectFilter
                                  options={BOOLEAN_OPTIONS}
                                  selectedValues={completedFilter}
                                  onSelectionChange={setCompletedFilter}
                                  label="Completed"
                                  showSearch={false}
                                  className="w-20"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden md:table-cell" title="AMS Documented">
                              <div className="space-y-1">
                                <span>AMS</span>
                                <MultiSelectFilter
                                  options={BOOLEAN_OPTIONS}
                                  selectedValues={amsFilter}
                                  onSelectionChange={setAmsFilter}
                                  label="AMS"
                                  showSearch={false}
                                  className="w-20"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden lg:table-cell" title="Pick Up Slot Booked">
                              <div className="space-y-1">
                                <span>Pick Slot</span>
                                <MultiSelectFilter
                                  options={PICK_SLOT_OPTIONS}
                                  selectedValues={pickSlotFilter}
                                  onSelectionChange={setPickSlotFilter}
                                  label="Pick Slot"
                                  showSearch={false}
                                  className="w-20"
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden lg:table-cell" title="Rental Returned">
                              Rental Returned
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden lg:table-cell" title="Van Picked Up">
                              Van Picked Up
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground hidden lg:table-cell" title="Holman Repair Status" data-testid="header-holman-status">
                              <div className="flex flex-col items-center gap-1">
                                <span>Holman Status</span>
                                <MultiSelectFilter
                                  options={HOLMAN_STATUS_OPTIONS}
                                  selectedValues={holmanStatusFilter}
                                  onSelectionChange={setHolmanStatusFilter}
                                  label="Holman Status"
                                  showSearch={false}
                                  optionColors={{
                                    'REPAIR COMPLETE': 'bg-green-500',
                                    'IN REPAIR': 'bg-blue-500',
                                    'IN AUTHORIZATION': 'bg-amber-500',
                                    'DECLINED': 'bg-red-500',
                                    'DISPUTED': 'bg-orange-500',
                                    'ABANDONED': 'bg-red-800',
                                    'UNKNOWN': 'bg-gray-400',
                                    '(No Data)': 'bg-gray-300',
                                  }}
                                />
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground">
                              Actions
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-labels text-muted-foreground">
                              Issues
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-background divide-y divide-border">
                          {filteredTrucks.length === 0 ? (
                            <tr>
                              <td colSpan={20} className="px-4 py-12 text-center">
                                <Filter className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                                <h3 className="text-base font-medium mb-2">No matching trucks</h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                  Adjust your filters above to see results
                                </p>
                                <Button variant="outline" size="sm" onClick={clearFilters}>
                                  Clear All Filters
                                </Button>
                              </td>
                            </tr>
                          ) : paginatedTrucks.map((truck, index) => (
                            <tr
                              key={truck.id}
                              className={`hover-elevate transition-colors cursor-pointer ${
                                index % 2 === 0 ? "bg-background" : "bg-muted/30"
                              }`}
                              data-testid={`row-truck-${startIndex + index}`}
                              onClick={(e) => {
                                const target = e.target as HTMLElement;
                                const interactive = target.closest('button, select, input, [role="combobox"], [role="listbox"], [data-radix-collection-item], a');
                                if (interactive) return;
                                setSelectedTruckId(truck.id);
                                setDetailPanelOpen(true);
                              }}
                            >
                              <td className="pl-2 pr-0 py-2 text-center text-xs text-muted-foreground" style={{width: '28px', minWidth: '28px', maxWidth: '28px'}} data-testid={`text-row-id-${index}`}>
                                {startIndex + index + 1}
                              </td>
                              <td className="px-2 py-2">
                                <div className="flex items-start gap-1">
                                  <div className="flex flex-col">
                                    <span className="font-mono font-medium text-[15px]" data-testid={`text-truck-number-${index}`}>
                                      {truck.truckNumber}
                                    </span>
                                    {truck.techState && (
                                      <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1" data-testid={`text-tech-state-${index}`}>
                                        {STATE_TO_REGION[truck.techState.trim().toUpperCase()] && (
                                          <span
                                            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${REGION_COLORS[STATE_TO_REGION[truck.techState.trim().toUpperCase()]] || ""}`}
                                            title={STATE_TO_REGION[truck.techState.trim().toUpperCase()]}
                                          />
                                        )}
                                        {truck.techState}
                                        {truck.techStateSource === "AMS" && (
                                          <span className="ml-0.5 text-[9px] text-amber-600 dark:text-amber-400" title="State from AMS (not in TPMS)">(AMS)</span>
                                        )}
                                        {truck.techStateSource === "XLS" && (
                                          <span className="ml-0.5 text-[9px] text-blue-600 dark:text-blue-400" title="State from AMS XLS Exports">(XLS)</span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                  {truck.comments && truck.comments.trim() !== "" && (
                                    <HoverCard openDelay={300} closeDelay={150}>
                                      <HoverCardTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5 p-0 text-muted-foreground hover:text-primary"
                                          aria-label={`View comments for truck ${truck.truckNumber}`}
                                          data-testid={`btn-notes-hover-${index}`}
                                        >
                                          <MessageSquare className="w-3.5 h-3.5" />
                                        </Button>
                                      </HoverCardTrigger>
                                      <HoverCardContent className="w-80 max-w-[90vw] text-sm bg-card border shadow-lg z-[9999]" side="right" align="start" sideOffset={5}>
                                        <div className="space-y-2">
                                          <div className="flex items-center gap-2">
                                            <MessageSquare className="w-4 h-4 text-muted-foreground" />
                                            <span className="font-medium">Comments</span>
                                          </div>
                                          <p className="text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                                            {truck.comments.length > 500 
                                              ? truck.comments.substring(0, 500) + "..." 
                                              : truck.comments}
                                          </p>
                                          {truck.comments.length > 500 && (
                                            <p className="text-xs text-muted-foreground italic">
                                              View full comments in truck details
                                            </p>
                                          )}
                                        </div>
                                      </HoverCardContent>
                                    </HoverCard>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-sm hidden sm:table-cell" data-testid={`text-tech-name-${index}`}>
                                <div>
                                  {truck.techName || <span className="text-muted-foreground">—</span>}
                                  {byovEnrollmentMap?.[truck.truckNumber.replace(/^0+/, '') || '0'] && (
                                    <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mt-0.5" data-testid={`text-byov-${index}`}>BYOV</div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                <div className="flex items-start gap-2">
                                  <div className="flex flex-col gap-1">
                                    <Select
                                      value={truck.mainStatus || "Confirming Status"}
                                      onValueChange={(value) => saveEdit(truck.id, "mainStatus", value)}
                                    >
                                      <SelectTrigger className="h-auto p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 [&>svg]:hidden" data-testid={`select-status-${index}`}>
                                        <StatusBadge 
                                          status={truck.status as any} 
                                          mainStatus={truck.mainStatus}
                                          subStatus={truck.subStatus}
                                          showSubStatusOnly={false}
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {MAIN_STATUSES.map((status) => (
                                          <SelectItem key={status} value={status}>{status}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {truck.mainStatus && SUB_STATUSES[truck.mainStatus as MainStatus]?.length > 0 && (
                                      <Select
                                        value={truck.subStatus || "_none_"}
                                        onValueChange={(value) => saveSubStatus(truck.id, truck.mainStatus!, value === "_none_" ? null : value)}
                                      >
                                        <SelectTrigger className="h-6 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto max-w-[180px] [&>svg]:hidden" data-testid={`select-substatus-${index}`}>
                                          <SelectValue>{truck.subStatus || "Select sub-status..."}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="_none_">No sub-status</SelectItem>
                                          {SUB_STATUSES[truck.mainStatus as MainStatus]?.map((sub) => (
                                            <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </div>
                                  <StatusReminder 
                                    show={shouldShowReminder(truck.id)} 
                                    onDismiss={() => hideReminder(truck.id)}
                                    position="inline"
                                  />
                                </div>
                              </td>
                              <td className="px-2 py-2 text-sm hidden sm:table-cell" data-testid={`text-owner-${index}`}>
                                {editingOwner === truck.id ? (
                                  <div className="flex flex-col gap-1 min-w-[160px]">
                                    <div className="flex flex-wrap gap-1">
                                      {PRESET_OWNERS.map((preset) => (
                                        <Badge
                                          key={preset}
                                          variant="outline"
                                          className={`text-xs cursor-pointer hover-elevate ${getOwnerColor(preset)} ${customOwnerInput === preset ? 'ring-2 ring-primary' : ''}`}
                                          onClick={() => saveOwner(truck.id, preset)}
                                          data-testid={`btn-owner-preset-${preset.replace(/\s+/g, '-')}`}
                                        >
                                          {preset}
                                        </Badge>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                      <Input
                                        value={customOwnerInput}
                                        onChange={(e) => setCustomOwnerInput(e.target.value)}
                                        onKeyDown={(e) => handleOwnerKeyDown(e, truck.id)}
                                        placeholder="Or type a name..."
                                        className="h-6 text-xs px-2 flex-1"
                                        autoFocus
                                        data-testid={`input-custom-owner-${index}`}
                                      />
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2"
                                        onClick={() => saveOwner(truck.id, customOwnerInput)}
                                        data-testid={`btn-save-owner-${index}`}
                                      >
                                        <CheckCircle2 className="w-3 h-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2"
                                        onClick={() => { setEditingOwner(null); setCustomOwnerInput(""); }}
                                        data-testid={`btn-cancel-owner-${index}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Badge 
                                    variant="outline"
                                    className={`text-xs font-medium whitespace-nowrap cursor-pointer hover-elevate ${getOwnerColor(getDisplayOwner(truck))}`}
                                    onClick={() => startEditingOwner(truck.id, truck.shsOwner)}
                                    data-testid={`badge-owner-${index}`}
                                  >
                                    {getDisplayOwner(truck)}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-2 py-2 text-center hidden sm:table-cell" data-testid={`text-assigned-${index}`}>
                                <Select
                                  value={truck.snowflakeAssigned === true ? "true" : truck.snowflakeAssigned === false ? "false" : "_blank_"}
                                  onValueChange={(value) => handleBooleanChange(truck.id, "snowflakeAssigned", value)}
                                >
                                  <SelectTrigger className="h-7 p-0 px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden w-auto min-w-[70px]" data-testid={`select-assigned-${index}`}>
                                    {truck.snowflakeAssigned === true ? (
                                      <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">Assigned</span>
                                    ) : truck.snowflakeAssigned === false ? (
                                      <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Unassigned</span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_blank_">—</SelectItem>
                                    <SelectItem value="true">Assigned</SelectItem>
                                    <SelectItem value="false">Unassigned</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-2 text-center text-sm hidden sm:table-cell" data-testid={`text-date-in-repair-${index}`}>
                                {editingCell?.truckId === truck.id && editingCell?.field === "datePutInRepair" ? (
                                  <Input
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => handleTextSave(truck.id, "datePutInRepair")}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleTextSave(truck.id, "datePutInRepair");
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    className="h-7 text-sm px-1 w-24"
                                    autoFocus
                                    data-testid={`input-date-in-repair-${index}`}
                                  />
                                ) : (
                                  <span 
                                    className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-muted-foreground"
                                    onClick={() => startEditing(truck.id, "datePutInRepair", truck.datePutInRepair)}
                                    data-testid={`edit-date-in-repair-${index}`}
                                  >
                                    {truck.datePutInRepair || "—"}
                                  </span>
                                )}
                              </td>
                              {/* Call Status, ETA, and Last Called cells hidden */}
                              <td className="px-2 py-2 text-center text-sm hidden md:table-cell" data-testid={`text-reg-expiry-${index}`}>
                                {editingCell?.truckId === truck.id && editingCell?.field === "holmanRegExpiry" ? (
                                  <Input
                                    type="date"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={() => handleDateSave(truck.id, "holmanRegExpiry")}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleDateSave(truck.id, "holmanRegExpiry");
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    className="h-7 text-sm px-1 w-32"
                                    autoFocus
                                    data-testid={`input-reg-expiry-${index}`}
                                  />
                                ) : (
                                  <span 
                                    className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-muted-foreground"
                                    onClick={() => {
                                      setEditingCell({ truckId: truck.id, field: "holmanRegExpiry" });
                                      setEditValue(toDateInputValue(truck.holmanRegExpiry));
                                    }}
                                    data-testid={`edit-reg-expiry-${index}`}
                                  >
                                    {truck.holmanRegExpiry || "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-center hidden md:table-cell" data-testid={`text-completed-${index}`}>
                                <Select
                                  value={truck.repairCompleted === true ? "true" : truck.repairCompleted === false ? "false" : "_blank_"}
                                  onValueChange={(value) => handleBooleanChange(truck.id, "repairCompleted", value)}
                                >
                                  <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-completed-${index}`}>
                                    {truck.repairCompleted === true ? (
                                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                    ) : truck.repairCompleted === false ? (
                                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] font-bold pt-px">N</span>
                                    ) : (
                                      <span className="text-muted-foreground">&nbsp;</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_blank_">—</SelectItem>
                                    <SelectItem value="true">Yes</SelectItem>
                                    <SelectItem value="false">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-2 text-center hidden md:table-cell" data-testid={`text-ams-${index}`}>
                                <Select
                                  value={truck.inAms === true ? "true" : truck.inAms === false ? "false" : "_blank_"}
                                  onValueChange={(value) => handleBooleanChange(truck.id, "inAms", value)}
                                >
                                  <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-ams-${index}`}>
                                    {truck.inAms === true ? (
                                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                    ) : (
                                      <span className="text-muted-foreground">&nbsp;</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_blank_">—</SelectItem>
                                    <SelectItem value="true">Yes</SelectItem>
                                    <SelectItem value="false">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-1 text-center hidden lg:table-cell" data-testid={`text-pickup-slot-${index}`}>
                                {(() => {
                                  const needsAttention = truck.repairCompleted === true && 
                                    truck.registrationStickerValid?.toLowerCase() === "yes" && 
                                    truck.pickUpSlotBooked !== true;
                                  return (
                                    <div className="flex flex-col items-center gap-0">
                                      <Select
                                        value={truck.pickUpSlotBooked === true ? "true" : truck.pickUpSlotBooked === false ? "false" : "_blank_"}
                                        onValueChange={(value) => handleBooleanChange(truck.id, "pickUpSlotBooked", value)}
                                      >
                                        <SelectTrigger className="h-6 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-pickup-slot-${index}`}>
                                          {truck.pickUpSlotBooked === true ? (
                                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                          ) : (
                                            <span className="text-muted-foreground">&nbsp;</span>
                                          )}
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="_blank_">—</SelectItem>
                                          <SelectItem value="true">Yes</SelectItem>
                                          <SelectItem value="false">No</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      {truck.pickUpSlotBooked === true && truck.timeBlockedToPickUpVan && (
                                        <span className="text-[9px] text-muted-foreground leading-tight max-w-[80px] truncate" title={truck.timeBlockedToPickUpVan}>
                                          {truck.timeBlockedToPickUpVan}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-2 py-2 text-center hidden lg:table-cell" data-testid={`text-rental-returned-${index}`}>
                                <Select
                                  value={truck.rentalReturned === true ? "true" : truck.rentalReturned === false ? "false" : "_blank_"}
                                  onValueChange={(value) => handleBooleanChange(truck.id, "rentalReturned", value)}
                                >
                                  <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-rental-returned-${index}`}>
                                    {truck.rentalReturned === true ? (
                                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                    ) : (
                                      <span className="text-muted-foreground">&nbsp;</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_blank_">—</SelectItem>
                                    <SelectItem value="true">Yes</SelectItem>
                                    <SelectItem value="false">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-2 text-center hidden lg:table-cell" data-testid={`text-van-picked-up-${index}`}>
                                <Select
                                  value={truck.vanPickedUp === true ? "true" : truck.vanPickedUp === false ? "false" : "_blank_"}
                                  onValueChange={(value) => handleBooleanChange(truck.id, "vanPickedUp", value)}
                                >
                                  <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-van-picked-up-${index}`}>
                                    {truck.vanPickedUp === true ? (
                                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                    ) : (
                                      <span className="text-muted-foreground">&nbsp;</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_blank_">—</SelectItem>
                                    <SelectItem value="true">Yes</SelectItem>
                                    <SelectItem value="false">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-1 text-center hidden lg:table-cell" data-testid={`text-holman-status-${index}`}>
                                {(() => {
                                  const truckNum = truck.truckNumber?.toString().padStart(6, '0') || '';
                                  const scraperData = scraperStatusMap?.[truckNum];
                                  if (!scraperData || !scraperData.status) return <span className="text-muted-foreground">—</span>;
                                  const statusColors: Record<string, string> = {
                                    'REPAIR_COMPLETE': 'text-green-700 dark:text-green-400',
                                    'IN_REPAIR': 'text-blue-700 dark:text-blue-400',
                                    'IN_AUTHORIZATION': 'text-amber-700 dark:text-amber-400',
                                    'DECLINED': 'text-red-700 dark:text-red-400',
                                    'DISPUTED': 'text-orange-700 dark:text-orange-400',
                                    'ABANDONED': 'text-red-800 dark:text-red-300',
                                  };
                                  const displayStatus = scraperData.status.replace(/_/g, ' ');
                                  const colorClass = statusColors[scraperData.status] || 'text-foreground';
                                  const lastScraped = scraperData.lastScraped ? new Date(scraperData.lastScraped).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                                  return (
                                    <div title={scraperData.primaryIssue || ''}>
                                      <span className={`text-xs font-medium ${colorClass}`}>{displayStatus}</span>
                                      {lastScraped && <div className="text-[10px] text-muted-foreground leading-tight">{lastScraped}</div>}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-2 py-2 text-center">
                                {(() => {
                                  const statusBadgeClasses = (s: string) => {
                                    const lower = s.toLowerCase();
                                    if (lower.includes("ready") || lower.includes("will pick up"))
                                      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800";
                                    if (lower.includes("failed") || lower.includes("no answer"))
                                      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800";
                                    if (lower.includes("repair") || lower.includes("parts") || lower.includes("authorization"))
                                      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
                                    return "bg-muted text-muted-foreground border-border";
                                  };
                                  const shopStatus = truck.lastCallStatus;
                                  const techStatus = truck.lastTechCallStatus;

                                  return (
                                    <div data-testid={`call-actions-${index}`}>
                                      <div className="flex items-center justify-center gap-1">
                                        <Link href={`/trucks/${truck.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                          <Button variant="ghost" size="sm" data-testid={`button-view-${index}`}>
                                            <ExternalLink className="w-4 h-4 mr-1" />
                                            <span className="hidden sm:inline">View</span>
                                          </Button>
                                        </Link>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                data-testid={`button-call-${index}`}
                                                disabled={!truck.repairPhone || callingTruckId === truck.id}
                                                onClick={(e: React.MouseEvent) => {
                                                  e.stopPropagation();
                                                  handleCallRepairShop(truck.id);
                                                }}
                                                className={!truck.repairPhone ? "opacity-30" : "text-green-600 dark:text-green-400"}
                                              >
                                                {callingTruckId === truck.id ? (
                                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                  <PhoneCall className="w-4 h-4" />
                                                )}
                                              </Button>
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {truck.repairPhone ? `Call Shop: ${truck.repairPhone}` : "No shop phone"}
                                          </TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                data-testid={`button-call-tech-${index}`}
                                                disabled={!truck.techPhone || callingTechTruckId === truck.id}
                                                onClick={(e: React.MouseEvent) => {
                                                  e.stopPropagation();
                                                  handleCallTechnician(truck.id);
                                                }}
                                                className={!truck.techPhone ? "opacity-30" : "text-blue-600 dark:text-blue-400"}
                                              >
                                                {callingTechTruckId === truck.id ? (
                                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                                ) : (
                                                  <PhoneForwarded className="w-4 h-4" />
                                                )}
                                              </Button>
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {truck.techPhone ? `Call Tech: ${truck.techPhone}` : "No tech phone"}
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                      {(shopStatus || techStatus) && (
                                        <div className="flex items-center justify-end gap-1 mt-0.5 pr-0.5">
                                          {shopStatus && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div className={`text-[9px] leading-none font-medium px-1.5 py-0.5 rounded border cursor-default whitespace-nowrap ${statusBadgeClasses(shopStatus)}`}>
                                                  {shopStatus}
                                                </div>
                                              </TooltipTrigger>
                                              <TooltipContent side="bottom" className="max-w-[300px]">
                                                <p className="text-xs font-medium mb-0.5">Shop Call</p>
                                                <p className="text-xs">{truck.lastCallSummary || "No details available"}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                          {techStatus && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div className={`text-[9px] leading-none font-medium px-1.5 py-0.5 rounded border cursor-default whitespace-nowrap ${statusBadgeClasses(techStatus)}`}>
                                                  {techStatus}
                                                </div>
                                              </TooltipTrigger>
                                              <TooltipContent side="bottom" className="max-w-[300px]">
                                                <p className="text-xs font-medium mb-0.5">Tech Call</p>
                                                <p className="text-xs">{truck.lastTechCallSummary || "No details available"}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <IssueIndicator truck={truck} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-sm text-muted-foreground flex items-center justify-between flex-wrap gap-2">
                <span>
                  Showing {startIndex + 1}-{Math.min(endIndex, filteredTrucks.length)} of {filteredTrucks.length} trucks
                  {filteredTrucks.length !== (trucks?.length || 0) && ` (filtered from ${trucks?.length || 0} total)`}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      data-testid="button-page-first"
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      data-testid="button-page-prev"
                    >
                      Prev
                    </Button>
                    <span className="px-2 text-sm font-medium">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      data-testid="button-page-next"
                    >
                      Next
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      data-testid="button-page-last"
                    >
                      Last
                    </Button>
                  </div>
                )}
                {debouncedSearch !== searchQuery && (
                  <span className="text-xs text-muted-foreground">Searching...</span>
                )}
              </div>
            </>
          )}
        </Card>
      </main>

      <TruckDetailPanel
        truckId={selectedTruckId}
        open={detailPanelOpen}
        onOpenChange={setDetailPanelOpen}
      />
    </div>
  );
}
