import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Truck, normalizeOwnerName } from "@shared/fleet-scope-schema";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { useStatusReminder } from "@/components/fleet-scope/StatusReminder";
import { IssueIndicator, useIssueStats } from "@/components/fleet-scope/IssueIndicator";
import { MultiSelectFilter } from "@/components/fleet-scope/MultiSelectFilter";
import { computeTruckIssues } from "@/lib/truckIssues";
import { useUser } from "@/context/FleetScopeUserContext";
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
  Loader2,
  Pencil,
  Wrench,
  CheckCircle,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";
import Papa from "papaparse";
import { Badge } from "@/components/ui/badge";
import { TruckDetailPanel } from "@/components/fleet-scope/TruckDetailPanel";
import { DispatchLucaCallButton } from "@/components/fleet-scope/DispatchLucaCallButton";

type OwnerType = "Oscar S" | "Rob A" | "Bob B" | "Jenn D" | "Samantha W" | "Cheryl" | "Final Actioned";

const ownerColors: Record<OwnerType, string> = {
  "Oscar S": "bg-amber-100 text-amber-700 border-amber-200",
  "Rob A": "bg-purple-100 text-purple-700 border-purple-200",
  "Bob B": "bg-orange-100 text-orange-700 border-orange-200",
  "Jenn D": "bg-pink-100 text-pink-700 border-pink-200",
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
  "Jenn D",
  "Samantha W",
  "Cheryl",
  "Luca B",
  "Sean C",
];

// Owner-name normalization is shared with the server — see
// normalizeOwnerName in @shared/fleet-scope-schema (imported above).

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
      return "Jenn D";
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

  // Tags and Scheduling default to Oscar S (John C and Mandy R left the team, July 2026)
  return "Oscar S";
}
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, formatDistanceToNow } from "date-fns";
import ExcelJS from 'exceljs';
import { downloadExcelWorkbook, addJsonWorksheet } from '@/lib/xlsx-utils';

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
      const parsed: Partial<StoredFilters> = JSON.parse(stored);
      // Migrate previously saved owner filters to the canonical spellings
      // (e.g. an old saved "Jenn D." would otherwise silently match zero trucks)
      if (Array.isArray(parsed.ownerFilter)) {
        parsed.ownerFilter = Array.from(
          new Set(parsed.ownerFilter.map((o) => normalizeOwnerName(o)))
        );
      }
      return parsed;
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

function getAmsLookupLabel(item: any): string {
  if (!item) return "Unknown";
  const skip = new Set(["UniqueID", "uniqueID", "Id", "id"]);
  for (const [key, val] of Object.entries(item)) {
    if (skip.has(key)) continue;
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return String(item.UniqueID);
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
  const [isShopListDialogOpen, setIsShopListDialogOpen] = useState(false);
  const [shopListFile, setShopListFile] = useState<File | null>(null);
  const [shopListResults, setShopListResults] = useState<{processedAt: string; rowsProcessed: number; trucksUpdated: number; rowsSkipped: number; notFound: string[]; error: string | null} | null>(null);
  const shopListFileRef = useRef<HTMLInputElement>(null);
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
      spareVanFilter,
      regTestSlotFilter,
      stateFilter,
      regionFilter,
      byovFilter,
      regExpirySortOrder,
      dateRepairSortOrder,
      billPaidSortOrder,
    });
  }, [searchQuery, mainStatusFilter, subStatusFilter, issueFilter, truckNumberFilter, columnStatusFilter, callStatusFilter, ownerFilter, regStickerFilter, completedFilter, amsFilter, regExpiryFilter, assignedFilter, upsStatusFilter, pickSlotFilter, gaveHolmanFilter, spareVanFilter, regTestSlotFilter, stateFilter, regionFilter, byovFilter, regExpirySortOrder, dateRepairSortOrder, billPaidSortOrder]);

  // Check if any column filters are active
  const hasActiveColumnFilters = regStickerFilter.length > 0 || completedFilter.length > 0 || amsFilter.length > 0 || regExpiryFilter.length > 0 || assignedFilter.length > 0 || upsStatusFilter.length > 0 || pickSlotFilter.length > 0 || gaveHolmanFilter.length > 0 || spareVanFilter.length > 0 || regTestSlotFilter.length > 0 || stateFilter.length > 0 || regionFilter.length > 0 || callStatusFilter.length > 0 || byovFilter.length > 0;

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
    setSpareVanFilter([]);
    setRegTestSlotFilter([]);
    setStateFilter([]);
    setRegionFilter([]);
    setCallStatusFilter([]);
    setByovFilter([]);
  };

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{truckId: string; field: string} | null>(null);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [amsVehiclePanelOpen, setAmsVehiclePanelOpen] = useState(false);
  const [selectedTruckForAms, setSelectedTruckForAms] = useState<string | null>(null);
  const [selectedVinForAms, setSelectedVinForAms] = useState<string | null>(null);
  const [amsActiveModal, setAmsActiveModal] = useState<"amsEdit" | "amsRepair" | null>(null);
  const [amsEditColor, setAmsEditColor] = useState("");
  const [amsEditBranding, setAmsEditBranding] = useState("");
  const [amsEditInterior, setAmsEditInterior] = useState("");
  const [amsEditAddress, setAmsEditAddress] = useState("");
  const [amsEditAddressZip, setAmsEditAddressZip] = useState("");
  const [amsEditTruckStatus, setAmsEditTruckStatus] = useState("");
  const [amsEditTheftVerified, setAmsEditTheftVerified] = useState("");
  const [amsEditKeyAddress, setAmsEditKeyAddress] = useState("");
  const [amsEditKeyZip, setAmsEditKeyZip] = useState("");
  const [amsEditStorageCost, setAmsEditStorageCost] = useState("");
  const [amsEditVehicleRuns, setAmsEditVehicleRuns] = useState("");
  const [amsEditVehicleLooks, setAmsEditVehicleLooks] = useState("");
  const [amsRepairInRepair, setAmsRepairInRepair] = useState(false);
  const [amsRepairDate, setAmsRepairDate] = useState("");
  const [amsRepairReason, setAmsRepairReason] = useState("");
  const [amsRepairVendor, setAmsRepairVendor] = useState("");
  const [amsRepairETA, setAmsRepairETA] = useState("");
  const [amsRepairStatus, setAmsRepairStatus] = useState("");
  const [amsRepairEstimate, setAmsRepairEstimate] = useState("");
  const [amsRepairRentalCar, setAmsRepairRentalCar] = useState("");
  const [amsRepairRentalStart, setAmsRepairRentalStart] = useState("");
  const [amsRepairRentalEnd, setAmsRepairRentalEnd] = useState("");
  const [amsRepairFinalDisposition, setAmsRepairFinalDisposition] = useState("");
  const [amsRepairDispositionReason, setAmsRepairDispositionReason] = useState("");
  const [amsRepairFinalDate, setAmsRepairFinalDate] = useState("");
  const [amsNewComment, setAmsNewComment] = useState("");
  const [amsCommentDialogOpen, setAmsCommentDialogOpen] = useState(false);
  const [amsCommentsCollapsed, setAmsCommentsCollapsed] = useState(false);
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
  const { showReminder } = useStatusReminder();

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

  // Bootstrap: one round trip that pre-seeds the fast grid/summary queries below.
  // On success their caches are filled before they enable (so they read cache
  // instead of each firing its own request); on any failure they fall back to
  // fetching individually. No cache TTL — freshness is unchanged.
  const dashboardBootstrap = useQuery<Record<string, { ok: boolean; data?: any }>>({
    queryKey: ["/api/fs/dashboard-bootstrap"],
    retry: false,
    queryFn: async () => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch("/api/fs/dashboard-bootstrap", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`bootstrap ${res.status}`);
        const sections = await res.json();
        for (const [key, section] of Object.entries(sections)) {
          if (section && (section as any).ok) {
            queryClient.setQueryData([key], (section as any).data);
          }
        }
        return sections;
      } finally {
        clearTimeout(t);
      }
    },
  });
  const bootstrapReady = dashboardBootstrap.isFetched;

  const { data: trucks, isLoading, error } = useQuery<Truck[]>({
    queryKey: ["/api/fs/trucks"],
    enabled: bootstrapReady,
  });

  const { data: pickupsThisWeek } = useQuery<{
    count: number;
    label: string;
  }>({
    queryKey: ["/api/fs/pickups-scheduled-this-week"],
    enabled: bootstrapReady,
  });



  const { data: byovEnrollmentMap } = useQuery<Record<string, boolean>>({
    queryKey: ["/api/fs/byov-enrollment-status"],
  });

  const { data: rentalSummary } = useQuery<{
    totalActive: number;
    totalRentals: number;
    averageDurationDays: number;
    overdueCount: number;
    returnedThisWeek: number;
    byRegion: Record<string, number>;
  }>({
    queryKey: ["/api/fs/rentals/summary"],
    enabled: bootstrapReady,
  });

  // Fetch weekly offboarding name set for persistent "T" badge on tech name
  const { data: woNameSet } = useQuery<{ names: Array<{ raw: string; last: string; first: string }>; enterpriseIds: string[] }>({
    queryKey: ["/api/weekly-offboarding/name-set"],
    staleTime: 30 * 60 * 1000,
  });

  // Fetch HR tech status (L/P/S) for tech leave/suspension badges
  const { data: hrTechStatusMap } = useQuery<Record<string, string>>({
    queryKey: ["/api/hr/tech-status"],
    staleTime: 30 * 60 * 1000,
  });

  // Build uppercased enterprise ID set from offboarding roster for O(1) lookup
  const offboardingEidSet = useMemo(() => {
    return new Set<string>((woNameSet?.enterpriseIds ?? []).map(id => id.toUpperCase()));
  }, [woNameSet]);

  // Fetch open rental operations data to build terminated-vehicle lookup
  const { data: rentalOpenData } = useQuery<{ data: any[] }>({
    queryKey: ["/api/rental-ops/open"],
    queryFn: async () => {
      const res = await fetch("/api/rental-ops/open", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // Fetch AMS vehicle data by VIN for "Update AMS" 2nd panel
  const { data: amsVehicle, isLoading: amsFleetLoading } = useQuery<any>({
    queryKey: ["/api/ams/vehicles", selectedVinForAms],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${selectedVinForAms}`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return json || null;
    },
  });

  // AMS lookup tables (enabled when panel open + VIN known)
  const { data: amsLookupTruckStatus } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "truck-status"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupVehicleRuns } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "vehicle-runs"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupVehicleLooks } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "vehicle-looks"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupColors } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "colors"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupBranding } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "branding"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupInterior } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "interior"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupRepairReason } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "service-reasons"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupRepairStatus } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "repair-status"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupDisposition } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "repair-disposition"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupDispositionReason } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "disposition-reasons"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });
  const { data: amsLookupRentalCar } = useQuery<any[]>({
    queryKey: ["/api/ams/lookups", "rental-car"],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    staleTime: 10 * 60 * 1000,
  });

  const amsUserUpdateMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/ams/vehicles/${selectedVinForAms}/user-updates`, payload);
      return res.json();
    },
    onSuccess: () => {
      setAmsActiveModal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles", selectedVinForAms] });
      toast({ title: "AMS vehicle fields updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update AMS fields", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const amsRepairMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const isFinalizing = payload.finalDisposition !== undefined;
      const endpoint = isFinalizing
        ? `/api/ams/vehicles/${selectedVinForAms}/repair-disposition`
        : `/api/ams/vehicles/${selectedVinForAms}/repair-updates`;
      const res = await apiRequest("POST", endpoint, payload);
      return res.json();
    },
    onSuccess: () => {
      setAmsActiveModal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles", selectedVinForAms] });
      toast({ title: "Repair status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update repair status", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const { data: amsComments, isLoading: amsCommentsLoading } = useQuery<any[]>({
    queryKey: ["/api/ams/vehicles/comments", selectedVinForAms],
    enabled: amsVehiclePanelOpen && !!selectedVinForAms,
    queryFn: async () => {
      const res = await fetch(`/api/ams/vehicles/${selectedVinForAms}/comments`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      const arr = json.data || json.comments || json.rows || json.items || json.records || json.CommentList || json.Comments || json.Notes || json.notes;
      return Array.isArray(arr) ? arr : Array.isArray(json) ? json : [];
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (comment: string) => {
      const res = await apiRequest("POST", `/api/ams/vehicles/${selectedVinForAms}/comments`, { comment });
      return res.json();
    },
    onSuccess: () => {
      setAmsNewComment("");
      setAmsCommentDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/ams/vehicles/comments", selectedVinForAms] });
      toast({ title: "Comment added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  // Build set of normalized vehicle numbers whose tech is on the offboarding roster
  const terminatedVehicleSet = useMemo(() => {
    const set = new Set<string>();
    if (!offboardingEidSet.size) return set;
    for (const r of rentalOpenData?.data ?? []) {
      if (r.enterpriseId && offboardingEidSet.has(r.enterpriseId.toUpperCase())) {
        const raw = (r.vehicleNumber || r.vehicleNumberPadded || "").toString();
        const normalized = raw.replace(/^0+/, "") || "0";
        if (normalized !== "0") set.add(normalized);
      }
    }
    return set;
  }, [rentalOpenData, offboardingEidSet]);

  // Build map of normalized truck number → HR status (L/P/S) for trucks whose tech is on leave/suspended
  const hrStatusVehicleMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!hrTechStatusMap) return map;
    for (const r of rentalOpenData?.data ?? []) {
      if (r.enterpriseId) {
        const status = hrTechStatusMap[r.enterpriseId.toUpperCase()];
        if (status) {
          const raw = (r.vehicleNumber || r.vehicleNumberPadded || "").toString();
          const normalized = raw.replace(/^0+/, "") || "0";
          if (normalized !== "0") map.set(normalized, status);
        }
      }
    }
    return map;
  }, [rentalOpenData, hrTechStatusMap]);

  // Build last-name → first-names lookup from offboarding data
  const offboardingLastMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of woNameSet?.names ?? []) {
      const key = n.last.toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n.first.toUpperCase());
    }
    return map;
  }, [woNameSet]);

  // In-flight guard: prevents duplicate PATCH bursts during rapid refetch/re-render windows
  const offboardingFlagInFlight = useRef(new Set<string>());

  // When offboarding names load, flag any truck whose techName matches (write once, never cleared by sync)
  useEffect(() => {
    if (!trucks || offboardingLastMap.size === 0) return;
    const toFlag = trucks.filter(t => {
      if (t.offboardingFlagged || !t.techName || offboardingFlagInFlight.current.has(t.id)) return false;
      const name = t.techName.trim();
      let last: string, first: string;
      if (name.includes(',')) {
        const idx = name.indexOf(',');
        last = name.slice(0, idx).trim().toUpperCase();
        first = name.slice(idx + 1).trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      } else {
        const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'JR.', 'SR.']);
        let tokens = name.split(/\s+/).map((tok: string) => tok.toUpperCase());
        while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
        last = tokens[tokens.length - 1] ?? '';
        first = tokens[0] ?? '';
      }
      if (!last) return false;
      const candidates = offboardingLastMap.get(last);
      if (!candidates || candidates.length === 0) return false;
      if (candidates.length === 1) return true;
      if (!first) return false;
      return candidates.includes(first);
    });
    if (toFlag.length === 0) return;
    toFlag.forEach(t => offboardingFlagInFlight.current.add(t.id));
    Promise.all(
      toFlag.map(t => apiRequest("PATCH", `/api/fs/trucks/${t.id}`, { offboardingFlagged: true }))
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
    }).catch((err: any) => {
      toFlag.forEach(t => offboardingFlagInFlight.current.delete(t.id));
      console.error("[Offboarding badge] Failed to set flag:", err);
    });
  }, [trucks, offboardingLastMap]);

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
             matchesRegStickerFilter && matchesCompletedFilter && matchesAmsFilter && matchesRegExpiryFilter && matchesAssignedFilter && matchesUpsFilter && matchesPickSlotFilter && matchesGaveHolman && matchesSpareVan && matchesRegTestSlot && matchesState && matchesRegion && matchesCallStatus && matchesByov;
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
      // Always float terminated-tech trucks to the top — union of offboardingFlagged (DB field),
      // terminatedVehicleSet (rental-ops cross-reference, drives the T badge),
      // and hrStatusVehicleMap (L/P/S HR status badges)
      const aNorm = a.truckNumber?.replace(/^0+/, '') || '0';
      const bNorm = b.truckNumber?.replace(/^0+/, '') || '0';
      const aTerminated = a.offboardingFlagged || terminatedVehicleSet.has(aNorm) || hrStatusVehicleMap.has(aNorm);
      const bTerminated = b.offboardingFlagged || terminatedVehicleSet.has(bNorm) || hrStatusVehicleMap.has(bNorm);
      if (aTerminated !== bTerminated) {
        return aTerminated ? -1 : 1;
      }

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
  }, [trucks, debouncedSearch, mainStatusFilter, subStatusFilter, issueFilter, truckNumberFilter, columnStatusFilter, callStatusFilter, ownerFilter, regStickerFilter, completedFilter, amsFilter, regExpiryFilter, assignedFilter, upsStatusFilter, pickSlotFilter, gaveHolmanFilter, spareVanFilter, regTestSlotFilter, stateFilter, regionFilter, byovFilter, byovEnrollmentMap, regExpirySortOrder, dateRepairSortOrder, billPaidSortOrder, terminatedVehicleSet, hrStatusVehicleMap]);

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
      const res = await apiRequest("POST", "/api/fs/trucks/bulk-import", { trucks });
      return await res.json();
    },
    onSuccess: (data: { imported: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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

  // Shop List auto-sync status
  type ShopListStatus = { processedAt: string | null; rowsProcessed: number; trucksUpdated: number; rowsSkipped: number; notFound: string[]; error: string | null };
  const { data: shopListStatus } = useQuery<ShopListStatus>({
    queryKey: ["/api/fs/shop-list-status"],
    refetchInterval: 60000,
  });

  // Shop List manual upload mutation
  const shopListImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/fs/shop-list-import", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return await res.json() as ShopListStatus & { processedAt: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/shop-list-status"] });
      setShopListResults(data);
      setShopListFile(null);
      toast({
        title: "Shop List import complete",
        description: `Updated ${data.trucksUpdated} trucks from ${data.rowsProcessed} rows`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Shop List import failed", description: error.message || "Failed to import", variant: "destructive" });
    },
  });

  const resetShopListDialog = () => {
    setShopListFile(null);
    setShopListResults(null);
    setIsShopListDialogOpen(false);
    if (shopListFileRef.current) shopListFileRef.current.value = "";
  };

  const handleShopListFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setShopListFile(file);
  };

  const handleShopListImport = () => {
    if (!shopListFile) return;
    shopListImportMutation.mutate(shopListFile);
  };

  // Bulk sync mutation
  const bulkSyncMutation = useMutation({
    mutationFn: async (truckNumbers: string[]) => {
      const res = await apiRequest("POST", "/api/fs/trucks/bulk-sync", { 
        truckNumbers,
        syncedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: (data: { added: number; removed: number; kept: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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
      const res = await apiRequest("POST", "/api/fs/trucks/consolidate", { 
        entries,
        consolidatedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: (data: { added: string[]; removed: string[]; addedCount: number; removedCount: number; unchangedCount: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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

  const syncRentalsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/fs/rental-sync", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/rentals/summary"] });
      toast({
        title: "Rental sync complete",
        description: data.message || `${data.added} added, ${data.removed} removed`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Rental sync failed", description: err.message, variant: "destructive" });
    },
  });

  const syncDeclinedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/fs/pos/sync-declined-repairs', {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/fs/trucks'] });
      
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
      const res = await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { 
        [field]: value,
        lastUpdatedBy: currentUser || "User"
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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

  // Save inline edit. Main/sub status are VRM-owned (edited in VRM Rental
  // Operations, mirrored down) and are no longer sent from Fleet Scope.
  const saveEdit = (truckId: string, field: string, value: any) => {
    // When registrationStickerValid changes to "Ordered duplicates", the
    // SERVER auto-sets subStatus to "Ordering duplicate tags" (status fields
    // cannot be written from Fleet Scope clients anymore).
    if (field === "registrationStickerValid" && value === "Ordered duplicates") {
      apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { 
        registrationStickerValid: value,
        lastUpdatedBy: currentUser || "User"
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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
    showReminder(truckId);
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
      const response = await apiRequest("POST", "/api/fs/snowflake/sync-tech-data", {});
      const data = await response.json();
      setSyncResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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

  const resetSyncDialog = () => {
    setSyncResults(null);
    setIsSyncDialogOpen(false);
  };

  const handleUpsRefresh = async () => {
    setIsRefreshingUps(true);
    setUpsRefreshResults(null);
    try {
      const response = await apiRequest("POST", "/api/fs/tracking/refresh-all", {});
      const data = await response.json();
      setUpsRefreshResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
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
      "Renter",
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
      truck.renterName || "",
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
        const res = await apiRequest("POST", "/api/fs/tech-specialty/batch", { truckNumbers });
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
      "Renter": truck.renterName || "",
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

    const workbook = new ExcelJS.Workbook();
    const worksheet = addJsonWorksheet(workbook, worksheetData, "Fleet Trucks");

    const colWidths = [15, 10, 25, 25, 35, 45, 25, 18, 18, 18, 50, 15, 25, 28, 30, 12, 20, 15, 25, 15, 20, 28, 18, 15, 50, 20, 30, 35, 30, 20, 18];
    colWidths.forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });

    await downloadExcelWorkbook(workbook, `fleet-scope-${format(new Date(), "yyyy-MM-dd")}.xlsx`);

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
            onClick={() => syncRentalsMutation.mutate()}
            disabled={syncRentalsMutation.isPending}
            title="Pull latest open rentals from Snowflake — adds new trucks, removes returned ones, fills Date in Repair for new entries"
            data-testid="button-sync-rentals"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${syncRentalsMutation.isPending ? "animate-spin" : ""}`} />
            {syncRentalsMutation.isPending ? "Syncing…" : "Sync Rentals"}
          </Button>

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
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex w-full">
                        <Button
                          onClick={handleImportCSV}
                          disabled={!importFile || bulkImportMutation.isPending}
                          className="w-full"
                          data-testid="button-start-import"
                        >
                          {bulkImportMutation.isPending ? "Importing..." : "Import Trucks"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!importFile && <TooltipContent>Select a file above before importing</TooltipContent>}
                  </Tooltip>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Call Import removed 2026-08-04: call data flows exclusively from
              LUCA via VRM Rental Operations; Fleet Scope is a read-only mirror. */}
          
          <Dialog open={isShopListDialogOpen} onOpenChange={setIsShopListDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-shop-list">
                <FileSpreadsheet className="w-3 h-3 mr-1" />
                Shop List
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Shop List Import</DialogTitle>
                <DialogDescription>
                  Upload a Rental Extension Review file (.xlsx or .csv) to update Repair Location and Enterprise ID. Only rows within the last 7 days are processed.
                </DialogDescription>
              </DialogHeader>

              {shopListResults ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-medium">Import Complete</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p><strong>{shopListResults.rowsProcessed}</strong> rows processed</p>
                    <p><strong>{shopListResults.trucksUpdated}</strong> trucks updated</p>
                    <p><strong>{shopListResults.rowsSkipped}</strong> rows skipped</p>
                    {shopListResults.notFound.length > 0 && (
                      <div>
                        <p className="text-destructive font-medium mt-2">{shopListResults.notFound.length} truck(s) not found:</p>
                        <div className="max-h-24 overflow-y-auto text-xs text-muted-foreground bg-muted p-2 rounded mt-1">
                          {shopListResults.notFound.join(", ")}
                        </div>
                      </div>
                    )}
                    {shopListResults.error && (
                      <p className="text-destructive text-xs mt-1">{shopListResults.error}</p>
                    )}
                  </div>
                  <Button onClick={resetShopListDialog} className="w-full">Close</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <input
                      ref={shopListFileRef}
                      type="file"
                      accept=".xlsx,.csv"
                      onChange={handleShopListFileSelect}
                      className="hidden"
                      id="shop-list-upload"
                      data-testid="input-shop-list-file"
                    />
                    <label htmlFor="shop-list-upload" className="cursor-pointer">
                      <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        {shopListFile ? shopListFile.name : "Click to upload XLSX or CSV"}
                      </p>
                      <p className="text-xs text-muted-foreground">.xlsx or .csv</p>
                    </label>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex w-full">
                        <Button
                          onClick={handleShopListImport}
                          disabled={!shopListFile || shopListImportMutation.isPending}
                          className="w-full"
                          data-testid="button-start-shop-list-import"
                        >
                          {shopListImportMutation.isPending ? "Importing..." : "Import Shop List"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!shopListFile && <TooltipContent>Select a file above before importing</TooltipContent>}
                  </Tooltip>
                  {shopListStatus?.processedAt && (
                    <div className="text-xs text-muted-foreground border-t pt-3">
                      <p className="font-medium mb-1">Last auto-sync:</p>
                      <p>{format(new Date(shopListStatus.processedAt), "MMM d, yyyy h:mm a")}</p>
                      {shopListStatus.error ? (
                        <p className="text-destructive mt-1">Error: {shopListStatus.error}</p>
                      ) : (
                        <p className="mt-1">{shopListStatus.trucksUpdated} updated · {shopListStatus.rowsProcessed} rows · {shopListStatus.notFound.length} not found</p>
                      )}
                    </div>
                  )}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex w-full">
                        <Button
                          onClick={handleConsolidate}
                          disabled={!consolidatePasteText.trim() || consolidateMutation.isPending}
                          className="w-full"
                          data-testid="button-run-consolidate"
                        >
                          {consolidateMutation.isPending ? "Consolidating..." : "Run Consolidation"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!consolidatePasteText.trim() && <TooltipContent>Paste truck data into the field above before running</TooltipContent>}
                  </Tooltip>
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex w-full">
                        <Button
                          onClick={calculateBulkSyncPreview}
                          disabled={!bulkSyncInput.trim()}
                          className="w-full"
                          data-testid="button-preview-bulk-sync"
                        >
                          Preview Changes
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!bulkSyncInput.trim() && <TooltipContent>Enter truck numbers above before previewing</TooltipContent>}
                  </Tooltip>
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

          <Link href="/fleet-scope/trucks/new">
            <Button data-testid="button-add-truck">
              <Plus className="w-4 h-4 mr-2" />
              Add Truck
            </Button>
          </Link>
        </div>

        {shopListStatus?.processedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <FileSpreadsheet className="w-3 h-3" />
            <span>
              Shop List auto-sync:&nbsp;
              {shopListStatus.error ? (
                <span className="text-destructive font-medium">Failed — {shopListStatus.error}</span>
              ) : (
                <span>
                  {shopListStatus.trucksUpdated} updated · {shopListStatus.rowsProcessed} rows · last run {formatDistanceToNow(new Date(shopListStatus.processedAt), { addSuffix: true })}
                </span>
              )}
            </span>
          </div>
        )}

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
          ) : (isLoading || !bootstrapReady) ? (
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
              <Link href="/fleet-scope/trucks/new">
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
                                <span>Renter</span>
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
                              <td colSpan={19} className="px-4 py-12 text-center">
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
                                truck.offboardingFlagged
                                  ? "bg-red-50 dark:bg-red-950/20 border-l-2 border-l-red-400 dark:border-l-red-600"
                                  : index % 2 === 0 ? "bg-background" : "bg-muted/30"
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
                                    <span className="font-mono font-medium text-[15px] flex items-center gap-1" data-testid={`text-truck-number-${index}`}>
                                      {truck.truckNumber}
                                      {!truck.offboardingFlagged && terminatedVehicleSet.has(truck.truckNumber.replace(/^0+/, '') || '0') && (
                                        <span
                                          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-[10px] font-bold leading-none"
                                          title="Tech is in the Weekly Offboarding roster"
                                          data-testid={`badge-offboarding-vehicle-${index}`}
                                        >
                                          T
                                        </span>
                                      )}
                                      {(() => {
                                        const norm = truck.truckNumber.replace(/^0+/, '') || '0';
                                        const hrStatus = hrStatusVehicleMap.get(norm);
                                        if (!hrStatus) return null;
                                        return (
                                          <span
                                            className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold leading-none ${
                                              hrStatus === 'L'
                                                ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                                : hrStatus === 'P'
                                                  ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                                                  : 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300'
                                            }`}
                                            title={hrStatus === 'L' ? 'Tech is on Leave' : hrStatus === 'P' ? 'Tech is on Paid Leave' : 'Tech is Suspended'}
                                            data-testid={`badge-hr-status-vehicle-${index}`}
                                          >
                                            {hrStatus}
                                          </span>
                                        );
                                      })()}
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
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {editingCell?.truckId === truck.id && editingCell?.field === "renterName" ? (
                                      <Input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => handleTextSave(truck.id, "renterName")}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleTextSave(truck.id, "renterName");
                                          if (e.key === "Escape") setEditingCell(null);
                                        }}
                                        className="h-7 text-sm px-1 w-36"
                                        autoFocus
                                        data-testid={`input-renter-name-${index}`}
                                      />
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded"
                                        title={truck.renterNameManual ? "Renter (entered manually) - click to edit" : "Renter per the Rental Ops report - click to correct"}
                                        onClick={() => startEditing(truck.id, "renterName", truck.renterName)}
                                        data-testid={`edit-renter-name-${index}`}
                                      >
                                        {truck.renterName || <span className="text-muted-foreground italic">unknown - click to add</span>}
                                        {truck.renterNameManual ? <span className="ml-1 text-[10px] font-bold text-blue-600 dark:text-blue-400" title="Manually entered">M</span> : null}
                                        {truck.techName && truck.techName.trim() && truck.techName.trim() !== (truck.renterName || "").trim() ? (
                                          <span className="ml-1 text-[11px] text-muted-foreground">(TPMS: {truck.techName})</span>
                                        ) : null}
                                      </span>
                                    )}
                                    {truck.offboardingFlagged && (
                                      <span
                                        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-[10px] font-bold leading-none"
                                        title="Tech is in the Weekly Offboarding roster"
                                        data-testid={`badge-offboarding-${index}`}
                                      >
                                        T
                                      </span>
                                    )}
                                  </div>
                                  {byovEnrollmentMap?.[truck.truckNumber.replace(/^0+/, '') || '0'] && (
                                    <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 mt-0.5" data-testid={`text-byov-${index}`}>BYOV</div>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2">
                                {/* Status is VRM-owned: edited in VRM Rental Operations, mirrored here. */}
                                <div
                                  className="flex flex-col gap-1"
                                  title="Status is managed in VRM Rental Operations and mirrors to Fleet Scope automatically"
                                  data-testid={`status-display-${index}`}
                                >
                                  <StatusBadge 
                                    status={truck.status as any} 
                                    mainStatus={truck.mainStatus}
                                    subStatus={truck.subStatus}
                                    showSubStatusOnly={false}
                                  />
                                  {truck.subStatus && (
                                    <span className="text-xs text-muted-foreground px-1" data-testid={`text-substatus-${index}`}>
                                      {truck.subStatus}
                                    </span>
                                  )}
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
                                        <Link href={`/fleet-scope/trucks/${truck.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                          <Button variant="ghost" size="sm" data-testid={`button-view-${index}`}>
                                            <ExternalLink className="w-4 h-4 mr-1" />
                                            <span className="hidden sm:inline">View</span>
                                          </Button>
                                        </Link>
                                      </div>
                                      {/* LUCA works the shop side of active repairs — this hands
                                          the truck to the VRM dispatch path (never a direct dial). */}
                                      {(truck.mainStatus === "Repairing" || truck.mainStatus === "Confirming Status") && (
                                        <div className="flex items-center justify-center mt-0.5">
                                          <DispatchLucaCallButton
                                            caseKey={truck.truckNumber}
                                            truckNumber={truck.truckNumber}
                                            className="h-6 text-xs px-1.5"
                                          />
                                        </div>
                                      )}
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
        onOpenChange={(open) => {
          setDetailPanelOpen(open);
          if (!open) setAmsVehiclePanelOpen(false);
        }}
        onUpdateAms={(truckNumber, vin) => {
          setSelectedTruckForAms(truckNumber);
          setSelectedVinForAms(vin || null);
          setAmsVehiclePanelOpen(true);
        }}
        amsOpen={amsVehiclePanelOpen}
      />

      {/* AMS Vehicle 2nd Panel — renders in a portal so it sits above the Sheet overlay */}
      {amsVehiclePanelOpen && selectedTruckForAms && createPortal(
        <>
          {/* Backdrop — click anywhere outside the panel to close it */}
          <div
            className="fixed inset-0 z-[9998]"
            style={{ pointerEvents: "auto" }}
            onClick={() => setAmsVehiclePanelOpen(false)}
          />
          <div
            className="fixed top-0 right-[700px] h-full w-[560px] bg-background border-l shadow-2xl z-[9999] flex flex-col"
            style={{ animation: "slideInFromRight 0.2s ease-out", pointerEvents: "auto" }}
          >
          <style>{`@keyframes slideInFromRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 bg-blue-50 dark:bg-blue-950/20">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-sm">AMS — Truck {selectedTruckForAms}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 opacity-75 hover:opacity-100"
                onClick={() => window.open(`/fleet-management?openTruck=${selectedTruckForAms}`, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="w-3 h-3" />
                Fleet Mgmt
              </button>
              <button
                onClick={() => setAmsVehiclePanelOpen(false)}
                className="rounded-sm opacity-70 hover:opacity-100 transition-opacity p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {amsFleetLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-sm">Loading AMS vehicle data…</span>
              </div>
            ) : !selectedVinForAms ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Building2 className="w-10 h-10 opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium">VIN not available</p>
                  <p className="text-xs mt-1">Cannot load AMS data without a VIN. Open in Fleet Management to view details.</p>
                </div>
                <button
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                  onClick={() => window.open(`/fleet-management?openTruck=${selectedTruckForAms}`, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in Fleet Management
                </button>
              </div>
            ) : amsVehicle ? (
              <>
                {/* Vehicle header */}
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-semibold text-lg leading-none">
                        {selectedTruckForAms}
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        {[amsVehicle.Year, amsVehicle.Make, amsVehicle.Model].filter(Boolean).join(" ") || "Unknown vehicle"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {amsVehicle.TruckStatus != null && (() => {
                        const match = Array.isArray(amsLookupTruckStatus) ? amsLookupTruckStatus.find((item: any) => String(item.UniqueID) === String(amsVehicle.TruckStatus)) : undefined;
                        return (
                          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium bg-muted">
                            {match ? getAmsLookupLabel(match) : String(amsVehicle.TruckStatus)}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">VIN</p>
                      <p className="font-mono text-xs">{selectedVinForAms}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Odometer</p>
                      <p>{amsVehicle.CurOdometer != null ? `${Number(amsVehicle.CurOdometer).toLocaleString()} mi` : "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Ownership */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Ownership</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {amsVehicle.Tech && (
                      <div>
                        <Label className="text-xs text-muted-foreground">AMS Tech</Label>
                        <p className="font-mono text-xs">{amsVehicle.Tech}</p>
                        {amsVehicle.TechName && <p className="text-xs text-muted-foreground">{amsVehicle.TechName}</p>}
                      </div>
                    )}
                    {(amsVehicle.TFD || amsVehicle.TFDName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">TFD</Label>
                        <p className="text-xs font-mono">{amsVehicle.TFD || "—"}</p>
                        {amsVehicle.TFDName && <p className="text-xs text-muted-foreground">{amsVehicle.TFDName}</p>}
                      </div>
                    )}
                    {(amsVehicle.DSM || amsVehicle.DSMName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">DSM</Label>
                        <p className="text-xs font-mono">{amsVehicle.DSM || "—"}</p>
                        {amsVehicle.DSMName && <p className="text-xs text-muted-foreground">{amsVehicle.DSMName}</p>}
                      </div>
                    )}
                    {(amsVehicle.TM || amsVehicle.TMName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">TM</Label>
                        <p className="text-xs font-mono">{amsVehicle.TM || "—"}</p>
                        {amsVehicle.TMName && <p className="text-xs text-muted-foreground">{amsVehicle.TMName}</p>}
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Description */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Description</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {amsVehicle.ColorName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Color</Label>
                        <p>{amsVehicle.ColorName}</p>
                      </div>
                    )}
                    {amsVehicle.BrandingName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Branding</Label>
                        <p>{amsVehicle.BrandingName}</p>
                      </div>
                    )}
                    {amsVehicle.InteriorName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Interior</Label>
                        <p>{amsVehicle.InteriorName}</p>
                      </div>
                    )}
                    {amsVehicle.CurOdometer != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">AMS Odometer</Label>
                        <p>{Number(amsVehicle.CurOdometer).toLocaleString()} mi</p>
                        {amsVehicle.CurOdometerDate && <p className="text-xs text-muted-foreground">{amsVehicle.CurOdometerDate.slice(0, 10)}</p>}
                      </div>
                    )}
                    {amsVehicle.RemBookValue != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Book Value</Label>
                        <p>${Number(amsVehicle.RemBookValue).toLocaleString()}</p>
                      </div>
                    )}
                    {amsVehicle.LeaseEndDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Lease End</Label>
                        <p>{amsVehicle.LeaseEndDate}</p>
                      </div>
                    )}
                    {amsVehicle.OutofSvcDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Out of Service</Label>
                        <p>{amsVehicle.OutofSvcDate}</p>
                      </div>
                    )}
                    {amsVehicle.SaleDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Sale Date</Label>
                        <p>{amsVehicle.SaleDate}</p>
                      </div>
                    )}
                    {amsVehicle.RegRenewalDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Reg Renewal</Label>
                        <p>{amsVehicle.RegRenewalDate}</p>
                      </div>
                    )}
                    {amsVehicle.StorageCost != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Storage Cost</Label>
                        <p>${Number(amsVehicle.StorageCost).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Condition */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Condition</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Road Ready</Label>
                      <div className="mt-0.5">
                        {amsVehicle.RoadReady === "Y" || amsVehicle.RoadReady === "Yes" ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-none text-xs">Ready</Badge>
                        ) : amsVehicle.RoadReady ? (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-none text-xs">{amsVehicle.RoadReady}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Grade</Label>
                      <p>{amsVehicle.Grade || "N/A"}</p>
                      {amsVehicle.GradeDescription && <p className="text-xs text-muted-foreground">{amsVehicle.GradeDescription}</p>}
                    </div>
                    {amsVehicle.TruckStatus != null && (() => {
                      const match = Array.isArray(amsLookupTruckStatus) ? amsLookupTruckStatus.find((item: any) => String(item.UniqueID) === String(amsVehicle.TruckStatus)) : undefined;
                      return (
                        <div>
                          <Label className="text-xs text-muted-foreground">Truck Status</Label>
                          <p>{match ? getAmsLookupLabel(match) : String(amsVehicle.TruckStatus)}</p>
                        </div>
                      );
                    })()}
                    {amsVehicle.TheftVerified != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Theft Verified</Label>
                        <p>{amsVehicle.TheftVerified === "Y" || amsVehicle.TheftVerified === true ? "Yes" : "No"}</p>
                      </div>
                    )}
                    {amsVehicle.VehicleRuns != null && (() => {
                      const match = Array.isArray(amsLookupVehicleRuns) ? amsLookupVehicleRuns.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleRuns)) : undefined;
                      return (
                        <div className="col-span-2">
                          <Label className="text-xs text-muted-foreground">How Vehicle Runs</Label>
                          <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleRuns)}</p>
                        </div>
                      );
                    })()}
                    {amsVehicle.VehicleLooks != null && (() => {
                      const match = Array.isArray(amsLookupVehicleLooks) ? amsLookupVehicleLooks.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleLooks)) : undefined;
                      return (
                        <div className="col-span-2">
                          <Label className="text-xs text-muted-foreground">How Vehicle Looks</Label>
                          <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleLooks)}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <Separator />

                {/* Repair Updates */}
                {(() => {
                  const v: any = amsVehicle;
                  const irRaw = v.VehicleInRepair ?? v.InRepair;
                  const isInRepair = irRaw === true || irRaw === 1 || (typeof irRaw === "string" && ["y","yes","true","1","t"].includes(irRaw.trim().toLowerCase()));
                  const labelFor = (lookup: any[] | undefined, raw: any, nameField?: any): string | null => {
                    if (nameField) return String(nameField);
                    if (raw == null || raw === "") return null;
                    const match = Array.isArray(lookup) ? lookup.find((item: any) => String(item.UniqueID) === String(raw)) : undefined;
                    return match ? getAmsLookupLabel(match) : String(raw);
                  };
                  const fmtDate = (d: any): string | null => {
                    if (!d) return null;
                    const s = String(d);
                    return s.length > 10 ? s.slice(0, 10) : s;
                  };
                  const repairReason = labelFor(amsLookupRepairReason, v.RepairReason, v.RepairReasonName);
                  const repairStatus = labelFor(amsLookupRepairStatus, v.RepairStatus, v.RepairStatusName);
                  const rentalCar = labelFor(amsLookupRentalCar, v.RentalCar, v.RentalCarName);
                  const finalDispo = labelFor(amsLookupDisposition, v.FinalDisposition, v.FinalDispositionName);
                  const finalDispoReason = labelFor(amsLookupDispositionReason, v.FinalDispositionReason, v.FinalDispositionReasonName);
                  const repairDateStart = fmtDate(v.RepairDateStart ?? v.RepairStartDate);
                  const etaDate = fmtDate(v.RepairETADate ?? v.EtaDate ?? v.RepairEtaDate ?? v.RepairETA);
                  const rentalStart = fmtDate(v.RentalStartDate);
                  const rentalEnd = fmtDate(v.RentalEndDate);
                  const finalDate = fmtDate(v.FinalDispositionDate);
                  const vendor = v.Vendor ?? v.RepairVendor;
                  const estCost = v.EstimateCost ?? v.RepairEstimateCost;
                  const hasAnyRepairData =
                    irRaw != null || v.DaysInRepair != null ||
                    repairReason || repairStatus || rentalCar || finalDispo || finalDispoReason ||
                    repairDateStart || etaDate || rentalStart || rentalEnd || finalDate ||
                    vendor || estCost != null;
                  if (!hasAnyRepairData) return null;
                  return (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                          <Wrench className="h-3 w-3" /> Repair Updates
                        </p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          {irRaw != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">In Repair</Label>
                              <div className="mt-0.5">
                                {isInRepair ? (
                                  <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-none text-xs">Yes</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">No</Badge>
                                )}
                              </div>
                            </div>
                          )}
                          {v.DaysInRepair != null && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Days In Repair</Label>
                              <p>{v.DaysInRepair}</p>
                            </div>
                          )}
                          {repairDateStart && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Repair Date</Label>
                              <p>{repairDateStart}</p>
                            </div>
                          )}
                          {etaDate && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Repair ETA</Label>
                              <p>{etaDate}</p>
                            </div>
                          )}
                          {repairReason && (
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">Svc. Reason</Label>
                              <p className="text-xs">{repairReason}</p>
                            </div>
                          )}
                          {repairStatus && (
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">Repair Status</Label>
                              <p className="text-xs">{repairStatus}</p>
                            </div>
                          )}
                          {vendor && (
                            <div className="col-span-2">
                              <Label className="text-xs text-muted-foreground">Repair Vendor</Label>
                              <p className="text-xs">{vendor}</p>
                            </div>
                          )}
                          {estCost != null && estCost !== "" && !isNaN(Number(estCost)) && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Estimate Cost</Label>
                              <p>${Number(estCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </div>
                          )}
                          {rentalCar && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Rental Car</Label>
                              <p>{rentalCar}</p>
                            </div>
                          )}
                          {rentalStart && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Rental Start</Label>
                              <p>{rentalStart}</p>
                            </div>
                          )}
                          {rentalEnd && (
                            <div>
                              <Label className="text-xs text-muted-foreground">Rental End</Label>
                              <p>{rentalEnd}</p>
                            </div>
                          )}
                          {(finalDispo || finalDispoReason || finalDate) && (
                            <div className="col-span-2 border-t mt-1 pt-2 space-y-2">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Final Disposition</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                {finalDispo && (
                                  <div className="col-span-2">
                                    <Label className="text-xs text-muted-foreground">Disposition</Label>
                                    <p className="text-xs">{finalDispo}</p>
                                  </div>
                                )}
                                {finalDispoReason && (
                                  <div className="col-span-2">
                                    <Label className="text-xs text-muted-foreground">Disposition Reason</Label>
                                    <p className="text-xs">{finalDispoReason}</p>
                                  </div>
                                )}
                                {finalDate && (
                                  <div>
                                    <Label className="text-xs text-muted-foreground">Final Date</Label>
                                    <p>{finalDate}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <Separator />
                    </>
                  );
                })()}

                {/* Location */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Location</p>
                  <div className="space-y-1.5 text-sm">
                    {(amsVehicle.CurLocAddress || amsVehicle.CurLocCity) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Current Location</Label>
                        <p className="text-xs">
                          {[amsVehicle.CurLocAddress, amsVehicle.CurLocCity, amsVehicle.CurLocState].filter(Boolean).join(", ")}
                          {amsVehicle.CurLocZip ? ` ${amsVehicle.CurLocZip}` : ""}
                        </p>
                        {amsVehicle.UpdateDate && <p className="text-xs text-muted-foreground">Updated: {amsVehicle.UpdateDate}</p>}
                      </div>
                    )}
                    {(amsVehicle.DeliveryDate || amsVehicle.Address) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Delivery Location</Label>
                        <p className="text-xs">
                          {[amsVehicle.Address, amsVehicle.City, amsVehicle.State].filter(Boolean).join(", ")}
                          {amsVehicle.Zip ? ` ${amsVehicle.Zip}` : ""}
                        </p>
                        {amsVehicle.DeliveryDate && <p className="text-xs text-muted-foreground">Delivered: {amsVehicle.DeliveryDate}</p>}
                      </div>
                    )}
                    {((amsVehicle.KeyAddress || amsVehicle.keyAddress) || (amsVehicle.KeyZip || amsVehicle.keyZip)) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Key Location</Label>
                        <p className="text-xs">
                          {[(amsVehicle.KeyAddress || amsVehicle.keyAddress)].filter(Boolean).join(", ")}
                          {(amsVehicle.KeyZip || amsVehicle.keyZip) ? ` ${amsVehicle.KeyZip || amsVehicle.keyZip}` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {(amsVehicle.LastUpdate || amsVehicle.LastUpdateUser) && (
                  <p className="text-xs text-muted-foreground">
                    AMS last updated: {amsVehicle.LastUpdate || "N/A"}{amsVehicle.LastUpdateUser ? ` by ${amsVehicle.LastUpdateUser}` : ""}
                  </p>
                )}

                <Separator />

                {/* AMS Comments */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setAmsCommentsCollapsed(v => !v)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      AMS Comments
                      {amsCommentsLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin ml-0.5" />
                      ) : amsComments && amsComments.length > 0 ? (
                        <span className="text-xs text-muted-foreground">({amsComments.length})</span>
                      ) : null}
                      {amsCommentsCollapsed ? <ChevronDown className="h-3.5 w-3.5 ml-0.5" /> : <ChevronUp className="h-3.5 w-3.5 ml-0.5" />}
                    </button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAmsCommentDialogOpen(true)}>
                      + Add Comment
                    </Button>
                  </div>
                  {!amsCommentsCollapsed && (
                    amsCommentsLoading ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading comments...</div>
                    ) : !amsComments || amsComments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No AMS comments for this vehicle.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {[...amsComments]
                          .sort((a, b) => {
                            const da = new Date(a.Date || a.CommentDate || a.CreatedAt || a.UpdateDate || a.commentDate || a.createdAt || a.date || 0).getTime();
                            const db = new Date(b.Date || b.CommentDate || b.CreatedAt || b.UpdateDate || b.commentDate || b.createdAt || b.date || 0).getTime();
                            return db - da;
                          })
                          .map((comment: any, i: number) => (
                            <div key={i} className="rounded-md border bg-muted/30 px-3 py-2 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{comment.User || comment.Author || comment.author || comment.CreatedBy || comment.UpdatedBy || comment.user || "Unknown"}</span>
                                <span className="text-xs text-muted-foreground">{comment.Date || comment.CommentDate || comment.CreatedAt || comment.UpdateDate || comment.commentDate || comment.createdAt || comment.date || ""}</span>
                              </div>
                              <p className="text-xs leading-relaxed">{comment.Comment || comment.CommentText || comment.Note || comment.Text || comment.comment || comment.note || comment.text || "—"}</p>
                            </div>
                          ))
                        }
                      </div>
                    )
                  )}
                </div>

              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                <Building2 className="w-10 h-10 opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium">Vehicle not found in AMS</p>
                  <p className="text-xs mt-1">Truck {selectedTruckForAms} may not be in the AMS system.</p>
                </div>
                <button
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                  onClick={() => window.open(`/fleet-management?openTruck=${selectedTruckForAms}`, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Search in Fleet Management
                </button>
              </div>
            )}
          </div>

          {/* Sticky action buttons — always visible at bottom of panel */}
          {!amsFleetLoading && !!amsVehicle && (
            <div className="shrink-0 border-t px-5 py-3 flex gap-2 bg-background">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                const matchLookup = (lookup: any[] | undefined, raw: any): string => {
                  if (raw == null || !lookup?.length) return "";
                  const s = String(raw);
                  const byId = lookup.find(item => String(item.UniqueID) === s);
                  if (byId) return s;
                  const byLabel = lookup.find(item => getAmsLookupLabel(item).toLowerCase() === s.toLowerCase());
                  return byLabel ? String(byLabel.UniqueID) : "";
                };
                setAmsEditColor(matchLookup(amsLookupColors, amsVehicle?.Color));
                setAmsEditBranding(matchLookup(amsLookupBranding, amsVehicle?.Branding));
                setAmsEditInterior(matchLookup(amsLookupInterior, amsVehicle?.Interior));
                setAmsEditAddress(amsVehicle?.CurLocAddress || "");
                setAmsEditAddressZip(amsVehicle?.CurLocZip || "");
                setAmsEditTruckStatus(matchLookup(amsLookupTruckStatus, amsVehicle?.TruckStatus));
                const tv = amsVehicle?.TheftVerified;
                setAmsEditTheftVerified(tv === true || tv === "Y" ? "Y" : tv === false || tv === "N" ? "N" : "");
                setAmsEditKeyAddress(amsVehicle?.KeyLocAddress || amsVehicle?.KeyAddress || amsVehicle?.keyAddress || "");
                setAmsEditKeyZip(amsVehicle?.KeyLocZip || amsVehicle?.KeyZip || amsVehicle?.keyZip || "");
                setAmsEditStorageCost(amsVehicle?.StorageCost != null ? String(amsVehicle.StorageCost) : "");
                setAmsEditVehicleRuns(matchLookup(amsLookupVehicleRuns, amsVehicle?.VehicleRuns));
                setAmsEditVehicleLooks(matchLookup(amsLookupVehicleLooks, amsVehicle?.VehicleLooks));
                setAmsActiveModal("amsEdit");
              }}>
                <Pencil className="h-4 w-4 mr-1.5" />Edit Fields
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                const v: any = amsVehicle || {};
                const findField = (obj: any, ...names: string[]): any => {
                  for (const n of names) if (obj?.[n] != null) return obj[n];
                  const lcKeys = Object.keys(obj || {});
                  for (const n of names) {
                    const found = lcKeys.find(k => k.toLowerCase() === n.toLowerCase());
                    if (found && obj[found] != null) return obj[found];
                  }
                  return undefined;
                };
                const isTruthy = (val: any): boolean => {
                  if (val === true || val === 1) return true;
                  if (typeof val === "string") {
                    const s = val.trim().toLowerCase();
                    return s === "y" || s === "yes" || s === "true" || s === "1" || s === "t";
                  }
                  return false;
                };
                const ir = findField(v, "VehicleInRepair", "InRepair", "inRepair", "IsInRepair");
                setAmsRepairInRepair(isTruthy(ir));
                const fromAmsDate = (d: any): string => {
                  if (!d) return "";
                  const s = String(d);
                  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
                  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                  if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
                  return "";
                };
                const matchLookupRepair = (lookup: any[] | undefined, raw: any): string => {
                  if (raw == null || raw === "" || !lookup?.length) return "";
                  const s = String(raw);
                  const byId = lookup.find((item: any) => String(item.UniqueID) === s);
                  if (byId) return s;
                  const byLabel = lookup.find((item: any) => getAmsLookupLabel(item).toLowerCase() === s.toLowerCase());
                  return byLabel ? String(byLabel.UniqueID) : "";
                };
                setAmsRepairDate(fromAmsDate(v.RepairDateStart ?? v.RepairStartDate));
                setAmsRepairReason(matchLookupRepair(amsLookupRepairReason, v.RepairReason ?? v.RepairReasonName));
                setAmsRepairVendor(v.Vendor ?? v.RepairVendor ?? "");
                setAmsRepairETA(fromAmsDate(v.RepairETADate ?? v.EtaDate ?? v.RepairEtaDate ?? v.RepairETA));
                setAmsRepairStatus(matchLookupRepair(amsLookupRepairStatus, v.RepairStatus ?? v.RepairStatusName));
                setAmsRepairEstimate(v.EstimateCost != null ? String(v.EstimateCost) : (v.RepairEstimateCost != null ? String(v.RepairEstimateCost) : ""));
                setAmsRepairRentalCar(matchLookupRepair(amsLookupRentalCar, v.RentalCar ?? v.RentalCarName));
                setAmsRepairRentalStart(fromAmsDate(v.RentalStartDate));
                setAmsRepairRentalEnd(fromAmsDate(v.RentalEndDate));
                setAmsRepairFinalDisposition(matchLookupRepair(amsLookupDisposition, v.FinalDisposition ?? v.FinalDispositionName));
                setAmsRepairDispositionReason(matchLookupRepair(amsLookupDispositionReason, v.FinalDispositionReason ?? v.FinalDispositionReasonName));
                setAmsRepairFinalDate(fromAmsDate(v.FinalDispositionDate));
                setAmsActiveModal("amsRepair");
              }}>
                <Wrench className="h-4 w-4 mr-1.5" />Repair
              </Button>
            </div>
          )}

          {/* Add Comment Dialog — inside the portal panel */}
          <Dialog open={amsCommentDialogOpen} onOpenChange={(o) => { setAmsCommentDialogOpen(o); if (!o) setAmsNewComment(""); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Add AMS Comment
                </DialogTitle>
                <DialogDescription>
                  Add a comment to vehicle {selectedVinForAms} in AMS.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Textarea
                  placeholder="Add an AMS comment..."
                  value={amsNewComment}
                  onChange={(e) => setAmsNewComment(e.target.value)}
                  rows={5}
                  className="resize-none"
                  disabled={addCommentMutation.isPending}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setAmsCommentDialogOpen(false); setAmsNewComment(""); }} disabled={addCommentMutation.isPending}>
                  Cancel
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        onClick={() => amsNewComment.trim() && addCommentMutation.mutate(amsNewComment.trim())}
                        disabled={!amsNewComment.trim() || addCommentMutation.isPending}
                      >
                        {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                        Add Comment
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!amsNewComment.trim() && <TooltipContent>Type a comment above before submitting</TooltipContent>}
                </Tooltip>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </>,
        document.body
      )}

      {/* AMS Edit Fields Dialog */}
      <Dialog open={amsActiveModal === "amsEdit"} onOpenChange={(o) => { if (!o) setAmsActiveModal(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" />Edit AMS Fields — {selectedVinForAms}</DialogTitle>
            <DialogDescription>Update user-editable fields in the AMS system.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Color</Label>
                <Select value={amsEditColor} onValueChange={setAmsEditColor}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select color..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(amsLookupColors) ? amsLookupColors : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Branding</Label>
                <Select value={amsEditBranding} onValueChange={setAmsEditBranding}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select branding..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(amsLookupBranding) ? amsLookupBranding : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Interior</Label>
              <Select value={amsEditInterior} onValueChange={setAmsEditInterior}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select interior..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No change —</SelectItem>
                  {(Array.isArray(amsLookupInterior) ? amsLookupInterior : []).map((item: any) => (
                    <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Current Location</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Address</Label>
                <Input className="mt-1" value={amsEditAddress} onChange={e => setAmsEditAddress(e.target.value)} placeholder="Street address" />
              </div>
              <div>
                <Label className="text-xs">ZIP</Label>
                <Input className="mt-1" value={amsEditAddressZip} onChange={e => setAmsEditAddressZip(e.target.value)} placeholder="ZIP" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Status</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Truck Status</Label>
                <Select value={amsEditTruckStatus} onValueChange={setAmsEditTruckStatus}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select status..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(amsLookupTruckStatus) ? amsLookupTruckStatus : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Theft Verified</Label>
                <Select value={amsEditTheftVerified} onValueChange={setAmsEditTheftVerified}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    <SelectItem value="Y">Yes</SelectItem>
                    <SelectItem value="N">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Key Location</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Key Address</Label>
                <Input className="mt-1" value={amsEditKeyAddress} onChange={e => setAmsEditKeyAddress(e.target.value)} placeholder="Key pickup address" />
              </div>
              <div>
                <Label className="text-xs">Key ZIP</Label>
                <Input className="mt-1" value={amsEditKeyZip} onChange={e => setAmsEditKeyZip(e.target.value)} placeholder="ZIP" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Condition &amp; Financial</p>
            <div>
              <Label className="text-xs">Storage Cost ($)</Label>
              <Input className="mt-1" type="number" value={amsEditStorageCost} onChange={e => setAmsEditStorageCost(e.target.value)} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">How Vehicle Runs</Label>
                <Select value={amsEditVehicleRuns} onValueChange={setAmsEditVehicleRuns}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(amsLookupVehicleRuns) ? amsLookupVehicleRuns : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">How Vehicle Looks</Label>
                <Select value={amsEditVehicleLooks} onValueChange={setAmsEditVehicleLooks}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No change —</SelectItem>
                    {(Array.isArray(amsLookupVehicleLooks) ? amsLookupVehicleLooks : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-3 border-t">
            <Button variant="outline" onClick={() => setAmsActiveModal(null)}>Cancel</Button>
            <Button
              disabled={amsUserUpdateMutation.isPending}
              onClick={() => {
                const payload: Record<string, any> = { updateUser: currentUser || "nexus" };
                if (amsEditColor && amsEditColor !== "__none__") payload.color = amsEditColor;
                if (amsEditBranding && amsEditBranding !== "__none__") payload.branding = amsEditBranding;
                if (amsEditInterior && amsEditInterior !== "__none__") payload.interior = amsEditInterior;
                if (amsEditAddress) payload.address = amsEditAddress;
                if (amsEditAddressZip) payload.zip = amsEditAddressZip;
                if (amsEditTruckStatus && amsEditTruckStatus !== "__none__") payload.truckStatus = amsEditTruckStatus;
                if (amsEditTheftVerified && amsEditTheftVerified !== "__none__") payload.theftVerified = amsEditTheftVerified;
                if (amsEditKeyAddress) payload.keyAddress = amsEditKeyAddress;
                if (amsEditKeyZip) payload.keyZip = amsEditKeyZip;
                if (amsEditStorageCost !== "") payload.storageCost = parseFloat(amsEditStorageCost);
                if (amsEditVehicleRuns && amsEditVehicleRuns !== "__none__") payload.vehicleRuns = amsEditVehicleRuns;
                if (amsEditVehicleLooks && amsEditVehicleLooks !== "__none__") payload.vehicleLooks = amsEditVehicleLooks;
                amsUserUpdateMutation.mutate(payload);
              }}
            >
              {amsUserUpdateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AMS Repair Updates Dialog */}
      <Dialog open={amsActiveModal === "amsRepair"} onOpenChange={(o) => { if (!o) setAmsActiveModal(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />Repair Updates — Truck {selectedTruckForAms}</DialogTitle>
            <DialogDescription>Log or update repair status in AMS for this vehicle.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="flex items-center gap-3">
              <Label className="text-xs">In Repair</Label>
              <Switch checked={amsRepairInRepair} onCheckedChange={setAmsRepairInRepair} />
              <span className="text-xs text-muted-foreground">{amsRepairInRepair ? "Yes — vehicle is in repair" : "No — vehicle is not in repair"}</span>
            </div>

            {amsRepairInRepair && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Repair Date</Label>
                    <Input className="mt-1" type="date" value={amsRepairDate} onChange={e => setAmsRepairDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Repair ETA</Label>
                    <Input className="mt-1" type="date" value={amsRepairETA} onChange={e => setAmsRepairETA(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Svc. Reason</Label>
                  <Select value={amsRepairReason} onValueChange={setAmsRepairReason}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(amsLookupRepairReason) ? amsLookupRepairReason : []).map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Repair Status</Label>
                  <Select value={amsRepairStatus} onValueChange={setAmsRepairStatus}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select status..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(amsLookupRepairStatus) ? amsLookupRepairStatus : []).map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Repair Vendor</Label>
                  <Input className="mt-1" value={amsRepairVendor} onChange={e => setAmsRepairVendor(e.target.value)} placeholder="Vendor name / address" />
                </div>
                <div>
                  <Label className="text-xs">Estimate Cost ($)</Label>
                  <Input className="mt-1" type="number" value={amsRepairEstimate} onChange={e => setAmsRepairEstimate(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <Label className="text-xs">Rental Car</Label>
                  <Select value={amsRepairRentalCar} onValueChange={setAmsRepairRentalCar}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select —</SelectItem>
                      {(Array.isArray(amsLookupRentalCar) && amsLookupRentalCar.length > 0) ? amsLookupRentalCar.map((item: any) => (
                        <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                      )) : (
                        <>
                          <SelectItem value="1">Yes — Rental</SelectItem>
                          <SelectItem value="0">No Rental</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {amsRepairRentalCar === "1" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Rental Start</Label>
                      <Input className="mt-1" type="date" value={amsRepairRentalStart} onChange={e => setAmsRepairRentalStart(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Rental End</Label>
                      <Input className="mt-1" type="date" value={amsRepairRentalEnd} onChange={e => setAmsRepairRentalEnd(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Final Disposition (close repair)</p>
              <div>
                <Label className="text-xs">Disposition</Label>
                <Select value={amsRepairFinalDisposition} onValueChange={setAmsRepairFinalDisposition}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select disposition..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not closing —</SelectItem>
                    {(Array.isArray(amsLookupDisposition) ? amsLookupDisposition : []).map((item: any) => (
                      <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__" && (
                <>
                  <div>
                    <Label className="text-xs">Disposition Reason</Label>
                    <Select value={amsRepairDispositionReason} onValueChange={setAmsRepairDispositionReason}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Select —</SelectItem>
                        {(Array.isArray(amsLookupDispositionReason) ? amsLookupDispositionReason : []).map((item: any) => (
                          <SelectItem key={item.UniqueID} value={String(item.UniqueID)}>{getAmsLookupLabel(item)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Final Date</Label>
                    <Input className="mt-1" type="date" value={amsRepairFinalDate} onChange={e => setAmsRepairFinalDate(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter className="pt-3 border-t">
            <Button variant="outline" onClick={() => setAmsActiveModal(null)}>Cancel</Button>
            <Button
              disabled={amsRepairMutation.isPending}
              onClick={() => {
                const updateUser = currentUser || "nexus";
                const isFinalizing = amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__";
                const payload: Record<string, any> = {
                  inRepair: amsRepairInRepair,
                  updateUser,
                };
                if (amsRepairDate) payload.repairDateStart = amsRepairDate;
                if (amsRepairReason && amsRepairReason !== "__none__") payload.repairReason = parseInt(amsRepairReason);
                if (amsRepairStatus && amsRepairStatus !== "__none__") payload.repairStatus = parseInt(amsRepairStatus);
                if (amsRepairVendor) payload.vendor = amsRepairVendor;
                if (amsRepairETA) payload.etaDate = amsRepairETA;
                if (amsRepairEstimate) payload.estimateCost = parseFloat(amsRepairEstimate);
                if (amsRepairRentalCar && amsRepairRentalCar !== "__none__") payload.rentalCar = parseInt(amsRepairRentalCar);
                if (amsRepairRentalStart) payload.rentalStartDate = amsRepairRentalStart;
                if (amsRepairRentalEnd) payload.rentalEndDate = amsRepairRentalEnd;
                if (isFinalizing) {
                  payload.finalDisposition = parseInt(amsRepairFinalDisposition);
                  if (amsRepairDispositionReason && amsRepairDispositionReason !== "__none__") payload.finalDispositionReason = parseInt(amsRepairDispositionReason);
                  if (amsRepairFinalDate) payload.finalDispositionDate = amsRepairFinalDate;
                }
                amsRepairMutation.mutate(payload);
              }}
            >
              {amsRepairMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
              {amsRepairFinalDisposition && amsRepairFinalDisposition !== "__none__" ? "Close Repair" : "Save Repair Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
