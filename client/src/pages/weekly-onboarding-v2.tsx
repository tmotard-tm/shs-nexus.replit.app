// Weekly Onboarding Truck Assignment — v2 (week-grouped redesign, 2026-07).
// Visual + behavioral spec: Fleet/nexus-weekly-onboarding-redesign/mockup.html
// (v13) realized in Tailwind + shadcn. Behavioral spine (queries, mutations,
// toasts, badges, export) ported VERBATIM from weekly-onboarding.tsx (legacy,
// kept at /weekly-onboarding-legacy after activation). Truck assignment goes
// through POST /api/onboarding-hires/:id/assign — a self-contained route that
// fires the SAME fleetOpsService.assignTech as Fleet Management's Assign
// button and enforces the same district block. Fleet Management's code is
// untouched (Tyler 2026-07-18).
import { useState, useEffect, useMemo, useRef } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  UserPlus, Search, RefreshCw, Clock, Truck, CheckCircle2, AlertCircle,
  Download, Car, ChevronDown, IdCard, Filter, X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { OnboardingHire } from "@shared/schema";
import { deriveOnboardingStatus as deriveStatus } from "@shared/onboarding-status";
import { groupHiresByWeek, weekLabel, getWeekNum, parseLocalDate } from "@shared/onboarding-weeks";
import { usePendingAssignMap, setPendingAssign, clearPendingAssign } from "@/hooks/use-pending-assign";
import { expandedCityCoordinates } from "@/data/expanded-city-coordinates";

// A successful transport request stamps the hire's notes with
// "[PAL transport <id> requested <date> by <who>]" (see the server route). Pull
// the PAL id back out so rows and the record modal can badge an existing request.
function parseTransportId(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = String(notes).match(/\[PAL transport ([^\s\]]+)/);
  return m ? m[1] : null;
}

// PAL New Transport form, mirrored 1:1 so an onboarding request maps cleanly
// into the PAL record. status = pipeline urgency; the exception flags
// (action_required/cancelled/completed) are set on the PAL record elsewhere,
// never at creation, so they are intentionally not offered here.
const EMPTY_TFORM = {
  status: "standard", truck: "", vin: "",
  fromAddr: "", fromContactName: "", fromContact: "",
  toAddr: "", dropoffTechName: "", dropoffTechPhone: "",
  keysPresent: "", vanStarts: "", internalNotes: "",
};
// Labels + dot colors match PAL's STATUS_CONFIG. Note urgent renders as "Quickly".
const TRANSPORT_URGENCY: Array<{ key: string; label: string; dot: string }> = [
  { key: "standard", label: "Standard", dot: "#9ca3af" },
  { key: "urgent", label: "Quickly", dot: "#EAB308" },
  { key: "asap", label: "ASAP", dot: "#F97316" },
  { key: "hold", label: "Hold", dot: "#3B82F6" },
];

// Yes / No / Unknown toggle matching PAL's YNRadio, which stores YES/NO/UNKNOWN.
function YesNoUnknown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {([["YES", "Yes"], ["NO", "No"], ["UNKNOWN", "Unknown"]] as Array<[string, string]>).map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(value === val ? "" : val)}
          aria-pressed={value === val}
          className={`rounded-md border px-2.5 py-1 text-xs transition ${value === val ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// District to Owner mapping based on last 4 digits (ported verbatim from legacy)
const districtOwnerMap: Record<string, string> = {
  '3132': 'Rob & Andrea',
  '3580': 'Monica, Cheryl & Machell',
  '4766': 'Rob & Andrea',
  '6141': 'Monica, Cheryl & Machell',
  '7084': 'Rob & Andrea',
  '7088': 'Carol & Tasha',
  '7108': 'Carol & Tasha',
  '7323': 'Monica, Cheryl & Machell',
  '7435': 'Rob & Andrea',
  '7670': 'Rob & Andrea',
  '7744': 'Rob & Andrea',
  '7983': 'Rob & Andrea',
  '7995': 'Carol & Tasha',
  '8035': 'Rob & Andrea',
  '8096': 'Monica, Cheryl & Machell',
  '8107': 'Carol & Tasha',
  '8147': 'Carol & Tasha',
  '8158': 'Carol & Tasha',
  '8162': 'Monica, Cheryl & Machell',
  '8169': 'Carol & Tasha',
  '8175': 'Rob & Andrea',
  '8184': 'Carol & Tasha',
  '8206': 'Monica, Cheryl & Machell',
  '8220': 'Monica, Cheryl & Machell',
  '8228': 'Carol & Tasha',
  '8309': 'Monica, Cheryl & Machell',
  '8366': 'Carol & Tasha',
  '8380': 'Rob & Andrea',
  '8420': 'Monica, Cheryl & Machell',
  '8555': 'Monica, Cheryl & Machell',
  '8935': 'Monica, Cheryl & Machell',
};

function getOwnerFromDistrict(district: string | null | undefined): string {
  if (!district) return '-';
  const last4 = district.slice(-4);
  return districtOwnerMap[last4] || '-';
}

// ── Decision 10: city-centroid distance ranking for the PMF pool ──
// PMF gives each truck only a site/metro name + state (no address/ZIP), so
// city-to-city straight-line miles is the honest ceiling. Coordinates come
// from the dataset the vehicle maps already use; no API, no new dependency.
const NEARBY_RADIUS_MI = 100;

function cityCoord(city: string | null | undefined): [number, number] | null {
  const key = (city || "").toUpperCase().trim();
  return key && expandedCityCoordinates[key] ? expandedCityCoordinates[key] : null;
}

function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const R = 3958.8; // earth radius, miles
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

type RankedVehicle = { v: any; miles: number | null; withinRadius: boolean };

const excludedAssetIds = ['33001', '33002', '33003', '33004', '33005', '33006'];

// Compact numeric hire date for the row column (Tyler 2026-07-18: "just put
// 7/12/2026 or 7/12/26"). The record modal and week labels keep full format.
function fmtShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

// "just now"-aware ago label — formatDistanceToNow rounds anything under 60s
// UP to "1 minute ago", which reads stale for an indicator whose whole point
// is "this just started" (caught in the mockup 2026-07-18).
function pendingAgoLabel(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

// apiRequest throws Error("STATUS: raw-body"). Pull the server's message out
// of the JSON body when present so toasts read clean.
function parseApiError(error: any): string {
  const raw = String(error?.message ?? error ?? "Request failed");
  const stripped = raw.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed.message === "string") return parsed.message;
    // The all-systems-failed 500 returns the OperationResult (no top-level
    // message). Summarize the lanes instead of dumping raw JSON into the toast
    // (review fix 2026-07-18).
    if (parsed && typeof parsed === "object" && ("overallSuccess" in parsed || "tpms" in parsed)) {
      const lanes = ["tpms", "holman", "ams"]
        .map((s) => (parsed[s]?.status ? `${s.toUpperCase()} ${parsed[s].status}` : null))
        .filter(Boolean);
      return `Assignment failed, no system committed${lanes.length ? ` (${lanes.join(", ")})` : ""}.`;
    }
    if (parsed && typeof parsed === "object") return "The server returned an error without a readable message.";
  } catch { /* not JSON: fall through to the raw text */ }
  return stripped;
}

// Status + intent badges — exact JSX from legacy lines 795-843, testids kept.
function StatusBadge({ hire }: { hire: OnboardingHire }) {
  const s = deriveStatus(hire);
  if (s === 'byov') {
    return (
      <Badge variant="default" className="bg-blue-600" data-testid={`badge-status-byov-${hire.id}`}>
        <Car className="h-3 w-3 mr-1" />
        BYOV
      </Badge>
    );
  }
  if (s === 'assigned') {
    return (
      <Badge variant="default" className="bg-green-600" data-testid={`badge-status-assigned-${hire.id}`}>
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Assigned
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid={`badge-status-pending-${hire.id}`}>
      <AlertCircle className="h-3 w-3 mr-1" />
      Pending
    </Badge>
  );
}

function IntentBadge({ hire }: { hire: OnboardingHire }) {
  const s = deriveStatus(hire);
  if (s !== 'pending') {
    return <span className="text-xs text-muted-foreground">NA</span>;
  }
  if (hire.byovIntent === 'perm') {
    return (
      <Badge variant="default" className="bg-indigo-600" data-testid={`badge-intent-perm-${hire.id}`}>
        Perm
      </Badge>
    );
  }
  if (hire.byovIntent === 'training') {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid={`badge-intent-training-${hire.id}`}>
        Training
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground" data-testid={`badge-intent-na-${hire.id}`}>NA</span>;
}

function EmpPill({ status }: { status: string | null | undefined }) {
  const v = (status || "").trim().toUpperCase();
  if (!v) return <span className="text-muted-foreground text-xs">-</span>;
  const cls =
    v === "A" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
    v === "T" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
    v === "L" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
    "bg-muted text-muted-foreground";
  return (
    <span className={`inline-grid min-w-[22px] place-items-center rounded-md px-1 py-0.5 font-mono text-[11px] font-bold ${cls}`}>
      {v}
    </span>
  );
}

function LedgerCell({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${className ?? ""}`}>{value}</p>
    </div>
  );
}

// Shared 11-column grid for header + rows (mockup v13 exact values, incl. the
// 7px column-gap — LOAD-BEARING, see plan Task 4 Step 3).
const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "minmax(168px,1.3fr) 64px 46px minmax(124px,1.0fr) minmax(100px,.85fr) minmax(100px,.85fr) minmax(94px,.8fr) minmax(74px,.62fr) 84px minmax(74px,.62fr) 150px",
  columnGap: "7px",
  alignItems: "center",
  minWidth: "1131px",
};

type ColType = "text" | "set" | "tri" | "link-status" | "link-intent" | null;
interface ColDef {
  k: string;
  label: string;
  type: ColType;
  val?: (h: OnboardingHire) => string;
  sortVal?: (h: OnboardingHire) => string | number;
  fmt?: (v: string) => string;
  title?: string;
  triLabels?: [string, string, string];
}

export default function WeeklyOnboardingV2() {
  const { toast } = useToast();
  const { lookupCostCenter } = useCostCenters();

  // ── Filter/sort/view state (mockup parity; defaults = Tyler's view) ──
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  // DEFAULT VIEW (Tyler 2026-07-18): Emp status A with no truck assigned =
  // statusFilter "pending" + column filter es={A}. Perm-intent hires stay
  // Pending: a perm BYOV still needs its 88-prefix assignment.
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "assigned" | "byov">("pending");
  const [byovIntentFilter, setByovIntentFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ k: string | null; dir: 1 | -1 }>({ k: null, dir: 1 });
  const [colFilters, setColFilters] = useState<Record<string, Set<string> | string | null>>(
    () => ({ es: new Set(["A"]) }),
  );
  const [popKey, setPopKey] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  // Weeks the user explicitly collapsed; overrides the filter auto-open below so
  // a collapse sticks even while a filter is active (the default view is filtered).
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<number>>(new Set());
  const [paFilter, setPaFilter] = useState<string | null>(null);
  const [paPanelOpen, setPaPanelOpen] = useState(false); // collapsed by default (Decision 8)

  // ── Modal state (one record modal + one assign dialog; centered, no drawer) ──
  const [activeHireId, setActiveHireId] = useState<string | null>(null);
  const [pickedVehicle, setPickedVehicle] = useState<any | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [truckNumber, setTruckNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [assignResult, setAssignResult] = useState<any | null>(null);
  const [precheckTruck, setPrecheckTruck] = useState("");

  // ── Transport request state (Wave 2: PAL proxy). tForm mirrors PAL's New
  // Transport form field-for-field so the request maps 1:1 into the PAL record. ──
  const [transportDialogOpen, setTransportDialogOpen] = useState(false);
  const [tForm, setTForm] = useState({ ...EMPTY_TFORM });
  const setT = (k: string, v: string) => setTForm(prev => ({ ...prev, [k]: v }));

  const { user: authUser } = useAuth();
  const pendingMap = usePendingAssignMap();

  // ── Queries (legacy verbatim) ──
  const { data: hires = [], isLoading } = useQuery<OnboardingHire[]>({
    queryKey: ['/api/onboarding-hires'],
  });
  const { data: syncLogs = [] } = useQuery<any[]>({
    queryKey: ['/api/sync-logs'],
  });
  const { data: pmfData, isLoading: pmfLoading } = useQuery<{ success: boolean; vehicles: any[]; message?: string }>({
    queryKey: ['/api/pmf/vehicles/available'],
  });
  const availableVehicles = pmfData?.vehicles || [];
  const lastSync = syncLogs.find(log => log.syncType === 'onboarding_hires');
  const [syncFailed, setSyncFailed] = useState(false);

  // ── Mutations (legacy verbatim) ──
  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/sync/onboarding-hires');
    },
    onSuccess: async () => {
      setSyncFailed(false);
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync-logs'] });
      // Also trigger enrichment after sync completes (in background)
      try {
        await apiRequest('POST', '/api/snowflake/enrich/onboarding-hires');
        queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      } catch (e) {
        console.log('[OnboardingHires] Background enrichment completed or skipped');
      }
    },
    onError: (error: any) => {
      setSyncFailed(true);
      console.error('[OnboardingHires] Sync failed:', error.message);
    },
  });

  // Auto-sync and enrich on page load
  useEffect(() => {
    syncMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Legacy bookkeeping PATCH — kept for the notes-edit path on already-assigned
  // rows (record modal "Save notes"). NOT the assign path anymore.
  const assignMutation = useMutation({
    mutationFn: async ({ id, truckAssigned, assignedTruckNo, notes }: { id: string; truckAssigned: boolean; assignedTruckNo: string; notes: string }) => {
      return await apiRequest('PATCH', `/api/onboarding-hires/${id}`, { truckAssigned, assignedTruckNo, notes });
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Truck assignment updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update truck assignment",
        variant: "destructive",
      });
    },
  });

  const handleExportXlsx = async () => {
    try {
      const response = await fetch('/api/onboarding-hires/export', {
        credentials: 'include',
        headers: {
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.message || `Export failed: ${response.status}`);
        }
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weekly-onboarding-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export Complete",
        description: "Excel file downloaded successfully",
      });
    } catch (error: any) {
      console.error('[Export XLSX] Error:', error);
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export data",
        variant: "destructive",
      });
    }
  };

  const byovIntentSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/onboarding-hires/sync-byov-intent');
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.configured === false) {
        toast({
          title: "BYOV Dashboard Not Configured",
          description: "Set BYOV_DASHBOARD_URL and FS_BYOV_API_KEY to enable intent cross-check.",
          variant: "destructive",
        });
      } else if (data?.success === false || data?.upstreamOk === false) {
        const skipped = data?.hiresSkippedDueToFailure ?? 0;
        toast({
          title: "BYOV Intent Sync Partially Failed",
          description: `Upstream lookup failed for ${skipped} hires — their previous intent values were preserved. Updated ${data?.recordsUpdated ?? 0} records. ${data?.errors?.[0] ? `Error: ${data.errors[0]}` : ''}`.trim(),
          variant: "destructive",
        });
      } else {
        toast({
          title: "BYOV Intent Sync Complete",
          description: `Checked ${data?.hiresChecked ?? 0} hires, found ${data?.intentsFound ?? 0} enrollments, updated ${data?.recordsUpdated ?? 0} records.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
    },
    onError: (error: any) => {
      toast({
        title: "BYOV Intent Sync Failed",
        description: error.message || "Failed to sync BYOV intent from BYOV Dashboard",
        variant: "destructive",
      });
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      // .json() so onSuccess sees enrichedCount (legacy returned the raw
      // Response, giving "Updated undefined records" — review fix 2026-07-18).
      const res = await apiRequest('POST', '/api/snowflake/enrich/onboarding-hires');
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Enrichment Complete",
        description: `Updated ${data?.enrichedCount ?? 0} records with Snowflake data`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
    },
    onError: (error: any) => {
      toast({
        title: "Enrichment Failed",
        description: error.message || "Failed to enrich data from Snowflake",
        variant: "destructive",
      });
    },
  });

  // ── Holman verify poll (202-async) — after an assign returns holman pending ──
  const holmanPollRef = useRef<{ timer: ReturnType<typeof setInterval> | null; startedAt: number }>({ timer: null, startedAt: 0 });
  const stopHolmanPoll = () => {
    if (holmanPollRef.current.timer) {
      clearInterval(holmanPollRef.current.timer);
      holmanPollRef.current.timer = null;
    }
  };
  const startHolmanPoll = (submissionDbId: string) => {
    stopHolmanPoll();
    holmanPollRef.current.startedAt = Date.now();
    holmanPollRef.current.timer = setInterval(async () => {
      if (Date.now() - holmanPollRef.current.startedAt > 2 * 60 * 1000) {
        stopHolmanPoll();
        return;
      }
      try {
        const res = await fetch(`/api/holman/submissions/${submissionDbId}`, { credentials: 'include' });
        if (!res.ok) return;
        const sub = await res.json();
        const st = String(sub?.status ?? sub?.submission?.status ?? '').toLowerCase();
        if (st && st !== 'pending' && st !== 'submitted') {
          stopHolmanPoll();
          toast({
            title: `Holman verify: ${st}`,
            description: `Submission ${submissionDbId} settled.`,
          });
          queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
        }
      } catch { /* transient poll error — keep trying until timeout */ }
    }, 5000);
  };
  useEffect(() => stopHolmanPoll, []);

  // ── The one-call assign (Task 2 route) ──
  const onboardingAssignMutation = useMutation({
    mutationFn: async ({ id, truckNumber, notes }: { id: string; truckNumber: string; notes: string }) => {
      const res = await apiRequest("POST", `/api/onboarding-hires/${id}/assign`, { truckNumber, notes });
      return res.json(); // OperationResult + { hireStamped } (200 and 207 both land here)
    },
    // Fires synchronously BEFORE the request resolves — the row/modal must show
    // "in flight" the instant the click happens, not after assignTech's
    // multi-second TPMS+Holman+AMS round trip. localStorage-backed so it
    // survives unmount/reload (useMutation's own isPending does not).
    onMutate: async ({ id, truckNumber }) => {
      setPendingAssign(id, truckNumber);
    },
    onSuccess: (r: any, { id }) => {
      clearPendingAssign(id);
      setAssignResult(r);
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vehicle-assignments/status'] });
      // Do NOT invalidate any Holman fleet-vehicles query (202 lag would clobber fresher state).
      if (r.holman?.status === "pending" && r.holmanSubmissionDbId) startHolmanPoll(r.holmanSubmissionDbId);
      toast({
        title: r.overallSuccess ? "Assigned across all systems" : r.partialSuccess ? "Partial success (207)" : "Assignment failed",
        description: `TPMS ${r.tpms?.status ?? "-"} / Holman ${r.holman?.status ?? "-"} / AMS ${r.ams?.status ?? "-"}${r.hireStamped ? " / row updated" : ""}`,
        variant: r.overallSuccess ? undefined : "destructive",
      });
    },
    onError: (error: any, { id }) => {
      // Clear pending on failure too — a blocked request (400/404/409/422/500)
      // must NOT leave a stale "in progress" indicator. 409 = the district
      // guard (change the district first — intentional rule) or assignTech's
      // truck-scoped lock; surface whatever the server sent verbatim.
      clearPendingAssign(id);
      toast({ title: "Assignment blocked", description: parseApiError(error), variant: "destructive" });
    },
  });

  // ── Transport request → PAL proxy (Wave 2) ──
  const transportMutation = useMutation({
    mutationFn: async (vars: { id: string; form: typeof EMPTY_TFORM }) => {
      const res = await apiRequest("POST", `/api/onboarding-hires/${vars.id}/transport`, vars.form);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.configured === false) {
        toast({
          title: "Transport Not Configured",
          description: "Set PAL_TRANSPORT_URL and PAL_TRANSPORT_API_KEY in Nexus Secrets to enable transport requests.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Transport requested",
        description: `PAL request ${data?.palId || "created"}${data?.record?.truck ? ` · truck ${data.record.truck}` : ""} is on the transport board under your name.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      closeAllDialogs();
    },
    onError: (error: any) => {
      toast({ title: "Transport request failed", description: parseApiError(error), variant: "destructive" });
    },
  });

  // ── Vehicle-status pre-check chip (30s staleTime, debounced input) ──
  useEffect(() => {
    const t = setTimeout(() => setPrecheckTruck(truckNumber.trim()), 400);
    return () => clearTimeout(t);
  }, [truckNumber]);
  const { data: precheck, isError: precheckMiss } = useQuery<any>({
    queryKey: ['/api/fleet-ops/vehicle-status', precheckTruck],
    enabled: assignDialogOpen && !!precheckTruck,
    staleTime: 30_000,
    retry: false,
  });

  // ── Derived data ──
  const weekGroups = useMemo(() => groupHiresByWeek(hires, new Date()), [hires]);
  useEffect(() => {
    setExpandedWeeks(prev => {
      if (prev.size) return prev;
      return new Set(weekGroups.filter(g => g.isCurrent || g.isFuture).map(g => g.key));
    });
  }, [weekGroups]);

  // Legacy Available Vehicles filter, verbatim (state match + exclusions).
  const vehiclesForState = (workState: string | null | undefined) => {
    const hireState = (workState || '').toUpperCase().trim();
    if (!hireState) return [];
    return availableVehicles.filter((v: any) => {
      const vehiclePlateState = (v.plateState || '').toUpperCase().trim();
      const vehicleState = vehiclePlateState || (v.state || '').toUpperCase().trim();
      if (vehicleState !== hireState) return false;
      const make = (v.make || v.Make || '').toUpperCase();
      const model = (v.model || v.Model || '').toUpperCase();
      if (make.includes('RAM') || model.includes('RAM')) return false;
      if (make.includes('PROMASTER 3500') || model.includes('PROMASTER 3500')) return false;
      if (make.includes('PROMASTER') && make.includes('3500')) return false;
      if (model.includes('PROMASTER') && model.includes('3500')) return false;
      const assetId = String(v.assetId || v.asset_id || v.AssetId || '');
      if (excludedAssetIds.includes(assetId)) return false;
      return true;
    });
  };

  // Decision 10: per-hire ranked pool. miles === null = same-state truck whose
  // site city (or the hire's city) isn't in the coordinate set — kept, shown
  // after the ranked ones, flagged "same state · distance n/a". NEVER dropped.
  const rankedByHire = useMemo(() => {
    const m = new Map<string, RankedVehicle[]>();
    for (const h of hires) {
      const stateVehicles = vehiclesForState(h.workState);
      const hireCoord = cityCoord(h.locationCity);
      const ranked: RankedVehicle[] = stateVehicles.map((v: any) => {
        const site = v.site || v.lot || v.siteName || v.location || "";
        const vCoord = cityCoord(site);
        const miles = hireCoord && vCoord ? haversineMiles(hireCoord, vCoord) : null;
        return { v, miles, withinRadius: miles != null && miles <= NEARBY_RADIUS_MI };
      });
      ranked.sort((a, b) => {
        if (a.miles == null && b.miles == null) return 0;
        if (a.miles == null) return 1;
        if (b.miles == null) return -1;
        return a.miles - b.miles;
      });
      m.set(h.id, ranked);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hires, availableVehicles]);
  const rankedFor = (h: OnboardingHire): RankedVehicle[] => rankedByHire.get(h.id) ?? [];

  const assignedCount = hires.filter(h => h.truckAssigned).length;
  const unassignedCount = hires.filter(h => !h.truckAssigned).length;
  const totalAvailableVehicles = availableVehicles.length;

  const latestByovCheck = useMemo(() => {
    let latest: number | null = null;
    for (const h of hires) {
      if (h.byovIntentCheckedAt) {
        const t = new Date(h.byovIntentCheckedAt).getTime();
        if (latest === null || t > latest) latest = t;
      }
    }
    return latest;
  }, [hires]);

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    hires.forEach(hire => {
      const owner = getOwnerFromDistrict(hire.district);
      if (owner && owner !== '-') owners.add(owner);
    });
    return Array.from(owners).sort();
  }, [hires]);

  const paKey = (h: OnboardingHire) => (h.planningAreaName || "").trim() || "(no planning area)";

  // Need-by-Planning-Area rows (Decision 8 — state-level availability, caveat carried in the footnote)
  const paRows = useMemo(() => {
    const byPA = new Map<string, { need: number; states: Set<string> }>();
    for (const h of hires) {
      if (deriveStatus(h) !== "pending") continue;
      const key = paKey(h);
      let e = byPA.get(key);
      if (!e) { e = { need: 0, states: new Set() }; byPA.set(key, e); }
      e.need++;
      if (h.workState) e.states.add(h.workState.toUpperCase().trim());
    }
    return Array.from(byPA.entries())
      .map(([pa, e]) => {
        const states = Array.from(e.states);
        return {
          pa,
          need: e.need,
          states,
          avail: states.reduce((n, st) => n + vehiclesForState(st).length, 0),
        };
      })
      .sort((a, b) => b.need - a.need || a.pa.localeCompare(b.pa));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hires, availableVehicles]);

  // Planning-area dropdown options: compound labels {area} · D-{districts} · {city}
  const paOptions = useMemo(() => {
    const m = new Map<string, { districts: Set<string>; cities: Map<string, number> }>();
    for (const h of hires) {
      const key = paKey(h);
      let e = m.get(key);
      if (!e) { e = { districts: new Set(), cities: new Map() }; m.set(key, e); }
      if (h.district) e.districts.add(String(parseInt(String(h.district).replace(/\D/g, ""), 10)));
      if (h.locationCity) e.cities.set(h.locationCity, (e.cities.get(h.locationCity) || 0) + 1);
    }
    return Array.from(m.entries())
      .map(([pa, e]) => {
        const topCity = Array.from(e.cities.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
        const label = `${pa} · D-${Array.from(e.districts).sort().join("/") || "?"}${topCity && topCity !== pa ? ` · ${topCity}` : ""}`;
        return { value: pa, label };
      })
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [hires]);

  // ── Column model (mockup COLS ported; every header sorts + filters) ──
  const COLS: ColDef[] = [
    { k: "name", label: "Employee", type: "text", val: (h) => h.employeeName || "", sortVal: (h) => h.employeeName || "" },
    {
      k: "sd", label: "Hire Date", type: "set",
      val: (h) => h.serviceDate ? String(h.serviceDate).slice(0, 10) : "(none)",
      sortVal: (h) => h.serviceDate ? String(h.serviceDate).slice(0, 10) : "",
      fmt: (v) => (v === "(none)" ? "N/A" : fmtShortDate(parseLocalDate(v))),
    },
    { k: "es", label: "Emp", type: "set", val: (h) => ((h.employmentStatus || "").trim().toUpperCase() || "(blank)"), sortVal: (h) => (h.employmentStatus || "~") },
    { k: "jt", label: "Job Title", type: "set", val: (h) => h.jobTitle || "(blank)", sortVal: (h) => h.jobTitle || "" },
    {
      k: "d", label: "District / Owner", type: "set",
      val: (h) => h.district || "(blank)",
      sortVal: (h) => parseInt(String(h.district || "").replace(/\D/g, ""), 10) || 0,
      fmt: (v) => (v === "(blank)" ? v : `${v} · ${getOwnerFromDistrict(v)}`),
    },
    { k: "city", label: "Location", type: "set", val: (h) => ((h.workState || "").toUpperCase() || "(blank)"), sortVal: (h) => `${h.workState || ""} ${h.locationCity || ""}`, title: "Work state" },
    { k: "status", label: "Status", type: "link-status", sortVal: (h) => ({ pending: 0, assigned: 1, byov: 2 }[deriveStatus(h)]) },
    { k: "bi", label: "BYOV Intent", type: "link-intent", sortVal: (h) => (deriveStatus(h) === "pending" ? (h.byovIntent ?? "na") : "na") },
    {
      k: "avail", label: "Avail Nearby", type: "tri",
      val: (h) => (rankedFor(h).length > 0 ? "has" : "none"),
      // Most within-100mi first, then nearest single truck.
      sortVal: (h) => {
        const r = rankedFor(h);
        const within = r.filter(x => x.withinRadius).length;
        const nearest = r.length && r[0].miles != null ? r[0].miles : 500000;
        return -(within * 1_000_000) + nearest;
      },
      triLabels: ["Any", "Has stock in state", "None in state"],
    },
    { k: "tn", label: "Truck #", type: "tri", val: (h) => (h.assignedTruckNo ? "has" : "none"), sortVal: (h) => h.assignedTruckNo || "~", triLabels: ["Any", "Truck assigned", "No truck"] },
    { k: "act", label: "", type: null },
  ];

  const colFilterOn = (c: ColDef): boolean => {
    const f = colFilters[c.k];
    if (c.type === "text") return !!f;
    if (c.type === "set") return f instanceof Set && f.size > 0;
    if (c.type === "tri") return f === "has" || f === "none";
    if (c.type === "link-status") return statusFilter !== "all";
    if (c.type === "link-intent") return byovIntentFilter !== "all";
    return false;
  };
  const anyColFilter = () => COLS.some(colFilterOn);
  const filtersActive = () =>
    ownerFilter !== "all" || statusFilter !== "all" || byovIntentFilter !== "all" ||
    !!searchQuery || !!paFilter || anyColFilter();

  // Row filter — same semantics as legacy filteredHires, minus the week
  // dropdown (weeks are structure now) and with the checkbox pair folded into
  // statusFilter. Ported from the mockup's matches().
  const rowMatches = (h: OnboardingHire): boolean => {
    if (ownerFilter !== "all" && getOwnerFromDistrict(h.district) !== ownerFilter) return false;
    const s = deriveStatus(h);
    if (statusFilter !== "all" && s !== statusFilter) return false;
    if (byovIntentFilter !== "all") {
      const iv = s === "pending" ? (h.byovIntent ?? "na") : "na";
      if (iv !== byovIntentFilter) return false;
    }
    if (paFilter && paKey(h) !== paFilter) return false;
    if (searchQuery) {
      const hay = `${h.employeeName} ${h.enterpriseId || ""} ${h.assignedTruckNo || ""} ${h.district || ""} ${h.locationCity || ""} ${h.planningAreaName || ""}`.toLowerCase();
      if (!hay.includes(searchQuery.toLowerCase())) return false;
    }
    for (const c of COLS) {
      const f = colFilters[c.k];
      if (f == null) continue;
      if (c.type === "text") { if (f && c.val && !String(c.val(h)).toLowerCase().includes(String(f).toLowerCase())) return false; }
      // An empty Set = the "None" choice, which must match ZERO rows (review
      // fix 2026-07-18: previously `f.size` was falsy on empty, skipping the
      // filter so "None" showed everything).
      else if (c.type === "set" && f instanceof Set) { if (f.size === 0) return false; if (c.val && !f.has(c.val(h))) return false; }
      else if (c.type === "tri") { if ((f === "has" || f === "none") && c.val && c.val(h) !== f) return false; }
    }
    return true;
  };

  const sortRows = (rows: OnboardingHire[]): OnboardingHire[] => {
    const { k, dir } = sort;
    if (!k) return rows;
    const c = COLS.find((x) => x.k === k);
    if (!c || !c.sortVal) return rows;
    return [...rows].sort((a, b) => {
      const va = c.sortVal!(a), vb = c.sortVal!(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  };

  // View chip: names the active view (default = Pending + Emp A) and clears
  // every filter in one click so nothing hides silently.
  const viewChipParts = (): string[] => {
    const parts: string[] = [];
    if (statusFilter !== "all") parts.push(statusFilter === "pending" ? "Pending" : statusFilter === "assigned" ? "Assigned" : "BYOV");
    const esF = colFilters.es;
    if (esF instanceof Set && esF.size) parts.push(`Emp ${Array.from(esF).join("/")}`);
    for (const c of COLS) {
      if (c.k === "es" || c.type === "link-status" || c.type === "link-intent" || !c.type) continue;
      if (colFilterOn(c)) parts.push(c.label);
    }
    if (byovIntentFilter !== "all") parts.push(`Intent ${byovIntentFilter}`);
    if (paFilter) parts.push("Area");
    if (ownerFilter !== "all") parts.push(ownerFilter.split(" ")[0]);
    return parts;
  };
  const clearAllFilters = () => {
    setStatusFilter("all"); setByovIntentFilter("all"); setOwnerFilter("all");
    setPaFilter(null); setColFilters({}); setSort({ k: null, dir: 1 }); setSearchQuery("");
    setCollapsedWeeks(new Set());
  };

  // ── Modal helpers (one dialog visible at a time; assign replaces record in place) ──
  const activeHire = activeHireId ? hires.find(h => h.id === activeHireId) ?? null : null;
  function openRecord(hireId: string) {
    const h = hires.find(x => x.id === hireId);
    setPickedVehicle(null);
    setAssignDialogOpen(false);
    setTransportDialogOpen(false);
    setRecordNotes(h?.notes || "");
    setActiveHireId(hireId);
  }
  function openAssignDialog(hireId: string) {
    // does NOT reset pickedVehicle — a quick-pick chosen from the record modal carries over
    const h = hires.find(x => x.id === hireId);
    setTruckNumber(pickedVehicle?.assetId ? String(pickedVehicle.assetId) : (h?.assignedTruckNo || ""));
    setNotes(h?.notes || "");
    setAssignResult(null);
    setTransportDialogOpen(false);
    setAssignDialogOpen(true);
    setActiveHireId(hireId);
  }
  function openTransportDialog(hireId: string) {
    const h = hires.find(x => x.id === hireId);
    // Truck goes TO the new hire, so the hire's location is the DROP-OFF and the
    // hire is the drop-off contact; pickup is where the truck sits now (manual).
    setTForm({
      ...EMPTY_TFORM,
      truck: pickedVehicle?.assetId ? String(pickedVehicle.assetId) : (h?.assignedTruckNo || ""),
      toAddr: h ? [h.address, h.locationCity, h.workState, h.zipcode].filter(Boolean).join(", ") : "",
      dropoffTechName: h?.employeeName || "",
    });
    setAssignDialogOpen(false);
    setTransportDialogOpen(true);
    setActiveHireId(hireId);
  }
  function closeAllDialogs() {
    setActiveHireId(null);
    setPickedVehicle(null);
    setAssignDialogOpen(false);
    setAssignResult(null);
    setTruckNumber("");
    setNotes("");
    setTransportDialogOpen(false);
    setTForm({ ...EMPTY_TFORM });
  }

  const toggleWeek = (key: number) => {
    // Effective open state mirrors isOpen in render: (expanded OR auto-open when
    // filtering) AND not explicitly collapsed. A manual collapse must beat the
    // filter auto-open, else weeks can never close in the default filtered view.
    const open = (expandedWeeks.has(key) || filtersActive()) && !collapsedWeeks.has(key);
    if (open) {
      setCollapsedWeeks(prev => { const n = new Set(prev); n.add(key); return n; });
      setExpandedWeeks(prev => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      setCollapsedWeeks(prev => { const n = new Set(prev); n.delete(key); return n; });
      setExpandedWeeks(prev => { const n = new Set(prev); n.add(key); return n; });
    }
  };

  const cycleSort = (k: string) => {
    setSort(prev => {
      if (prev.k !== k) return { k, dir: 1 };
      if (prev.dir === 1) return { k, dir: -1 };
      return { k: null, dir: 1 };
    });
  };

  const distinctValues = (c: ColDef): string[] => {
    if (!c.val) return [];
    const s = new Set<string>();
    hires.forEach(h => s.add(c.val!(h)));
    return Array.from(s).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  };

  // Emp seg derived highlight (shares colFilters.es with the Emp column funnel)
  const esSet = colFilters.es;
  const empSegVal = !(esSet instanceof Set) || esSet.size === 0 ? "all" : esSet.size === 1 ? Array.from(esSet)[0] : "multi";

  // ── Header funnel popover content ──
  function popoverBody(c: ColDef) {
    if (c.type === "text") {
      return (
        <Input
          autoFocus
          placeholder={`Filter ${c.label}...`}
          value={(colFilters[c.k] as string) || ""}
          onChange={(e) => setColFilters(prev => ({ ...prev, [c.k]: e.target.value || null }))}
        />
      );
    }
    if (c.type === "set") {
      const values = distinctValues(c);
      const current = colFilters[c.k];
      const currentSet = current instanceof Set ? current : null;
      return (
        <div className="max-h-72 space-y-0.5 overflow-y-auto">
          {values.map(v => {
            const checked = currentSet ? currentSet.has(v) : true;
            return (
              <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(on) => {
                    setColFilters(prev => {
                      const base = prev[c.k] instanceof Set ? new Set(prev[c.k] as Set<string>) : new Set(values);
                      if (on) base.add(v); else base.delete(v);
                      return { ...prev, [c.k]: base.size === values.length ? null : base };
                    });
                  }}
                />
                <span className="truncate">{c.fmt ? c.fmt(v) : v}</span>
              </label>
            );
          })}
          <div className="mt-1 flex justify-between border-t pt-1">
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setColFilters(prev => ({ ...prev, [c.k]: null }))}>All</button>
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => setColFilters(prev => ({ ...prev, [c.k]: new Set<string>() }))}>None</button>
          </div>
        </div>
      );
    }
    if (c.type === "tri") {
      const cur = colFilters[c.k];
      const opts: Array<[string | null, string]> = [[null, c.triLabels?.[0] ?? "Any"], ["has", c.triLabels?.[1] ?? "Has"], ["none", c.triLabels?.[2] ?? "None"]];
      return (
        <div className="space-y-0.5">
          {opts.map(([v, l]) => (
            <button
              key={String(v)} type="button"
              className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${cur === v || (!v && cur == null) ? "font-semibold text-primary" : ""}`}
              onClick={() => { setColFilters(prev => ({ ...prev, [c.k]: v })); setPopKey(null); }}
            >
              {l}
            </button>
          ))}
        </div>
      );
    }
    if (c.type === "link-status") {
      const opts: Array<["all" | "pending" | "assigned" | "byov", string]> = [["all", "All"], ["pending", "Pending"], ["assigned", "Assigned"], ["byov", "BYOV"]];
      return (
        <div className="space-y-0.5">
          {opts.map(([v, l]) => (
            <button key={v} type="button"
              className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${statusFilter === v ? "font-semibold text-primary" : ""}`}
              onClick={() => { setStatusFilter(v); setPopKey(null); }}>
              {l}
            </button>
          ))}
        </div>
      );
    }
    if (c.type === "link-intent") {
      const opts: Array<[string, string]> = [["all", "All Intents"], ["perm", "Perm"], ["training", "Training"], ["na", "NA"]];
      return (
        <div className="space-y-0.5">
          {opts.map(([v, l]) => (
            <button key={v} type="button"
              className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${byovIntentFilter === v ? "font-semibold text-primary" : ""}`}
              onClick={() => { setByovIntentFilter(v); setPopKey(null); }}>
              {l}
            </button>
          ))}
        </div>
      );
    }
    return null;
  }

  // ── Row + header renderers ──
  function theadRow() {
    return (
      <div className="border-t px-4 py-2" style={GRID_STYLE}>
        {COLS.map((c) => {
          if (!c.type && !c.sortVal) return <span key={c.k} />;
          const sorted = sort.k === c.k;
          return (
            // LOAD-BEARING header structure (Tyler 2026-07-18 "headers blending"
            // fix): flex + min-w-0 fills the grid track instead of spilling past
            // it; the label wraps to a 2nd line; controls never shrink.
            <span key={c.k} className="flex min-w-0 items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <button
                type="button"
                className="min-w-0 cursor-pointer overflow-hidden whitespace-normal text-left leading-[1.18] hover:text-foreground"
                title={`Click to sort${c.title ? ` · filter: ${c.title}` : ""}`}
                onClick={() => cycleSort(c.k)}
              >
                {c.label}
              </button>
              <span className="inline-flex flex-shrink-0 items-center gap-0.5">
                {sorted && <i className="not-italic text-[8px] text-primary">{sort.dir > 0 ? "▲" : "▼"}</i>}
                <Popover open={popKey === c.k} onOpenChange={(o) => setPopKey(o ? c.k : null)}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Filter ${c.label}`}
                      className={`grid h-[15px] w-[15px] flex-shrink-0 place-items-center rounded-sm hover:bg-muted ${colFilterOn(c) ? "text-primary" : "text-muted-foreground"}`}
                    >
                      <Filter className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-2">
                    <p className="mb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label || c.k}</p>
                    {popoverBody(c)}
                  </PopoverContent>
                </Popover>
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  function hireRow(hire: OnboardingHire) {
    const pending = pendingMap[hire.id] ?? null;
    const ranked = rankedFor(hire);
    const within100 = ranked.filter(r => r.withinRadius).length;
    const inState = ranked.length;
    const hireState = (hire.workState || '').toUpperCase().trim();
    const nearest = ranked.length && ranked[0].miles != null ? ranked[0] : null;
    return (
      <div
        key={hire.id}
        data-testid={`row-hire-${hire.id}`}
        className="cursor-pointer border-t px-4 py-2.5 transition-colors hover:bg-muted/50"
        style={GRID_STYLE}
        onClick={() => openRecord(hire.id)}
      >
        {/* Employee */}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{hire.employeeName}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{hire.enterpriseId?.toUpperCase() || '-'}</div>
        </div>
        {/* Hire Date — compact numeric (Tyler 2026-07-18) */}
        <div className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
          {hire.serviceDate ? fmtShortDate(parseLocalDate(String(hire.serviceDate))) : 'N/A'}
        </div>
        {/* Emp pill */}
        <div><EmpPill status={hire.employmentStatus} /></div>
        {/* Job Title (+ techType) */}
        <div className="min-w-0 pr-1 text-[12.5px] leading-tight">
          <div>{hire.jobTitle || '-'}</div>
          {hire.techType && <div className="mt-0.5 text-[11px] text-muted-foreground">{hire.techType}</div>}
        </div>
        {/* District / CC / Owner */}
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold">{hire.district || '-'}</div>
          {hire.district && lookupCostCenter(hire.district) && (
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">CC {lookupCostCenter(hire.district)}</div>
          )}
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{getOwnerFromDistrict(hire.district)}</div>
        </div>
        {/* Location */}
        <div className="min-w-0 text-[12.5px] leading-tight">
          {hire.locationCity ? `${hire.locationCity}, ${hire.workState || ''}` : (hire.workState || '-')}
        </div>
        {/* Status */}
        <div><StatusBadge hire={hire} /></div>
        {/* BYOV Intent */}
        <div><IntentBadge hire={hire} /></div>
        {/* Avail Nearby (Decision 10: distance-ranked) */}
        <div
          className="whitespace-nowrap text-[11.5px]"
          title={nearest ? `Nearest: ${nearest.v.assetId || '?'} ~${Math.round(nearest.miles!)} mi` : undefined}
        >
          {pmfLoading ? (
            <span className="text-muted-foreground">…</span>
          ) : within100 > 0 ? (
            <span className="font-semibold text-green-600 dark:text-green-400">{within100} within 100mi</span>
          ) : inState > 0 ? (
            <span className="text-amber-600 dark:text-amber-400">0 ≤100mi · {inState} in {hireState}</span>
          ) : (
            <span className="text-muted-foreground">{hireState ? `0 in ${hireState}` : 'No state'}</span>
          )}
        </div>
        {/* Truck # (pending indicator first) */}
        <div className="font-mono text-[12.5px] font-semibold">
          {pending ? (
            <span
              className="inline-flex items-center gap-1.5 font-medium text-amber-500"
              title={`Assignment submitted ${pendingAgoLabel(pending.startedAt)} — writing to TPMS/Holman/AMS`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              {pending.tn}
            </span>
          ) : (
            <span className={hire.assignedTruckNo ? "" : "font-normal text-muted-foreground"}>{hire.assignedTruckNo || '-'}</span>
          )}
          {parseTransportId(hire.notes) && (
            <span
              className="ml-1.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1 py-0.5 align-middle text-[10px] font-normal text-blue-600 dark:bg-blue-950 dark:text-blue-300"
              title={`Transport requested (PAL ${parseTransportId(hire.notes)})`}
            >
              <Truck className="h-2.5 w-2.5" />{parseTransportId(hire.notes)}
            </span>
          )}
        </div>
        {/* Actions — fixed two-slot grid so Assign never drags Transport around */}
        <div
          className="grid items-center gap-1.5"
          style={{ gridTemplateColumns: "1fr 62px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="justify-self-end">
            {/* Transport → PAL proxy (Wave 2). Requests a vehicle move for this hire. */}
            <Button size="sm" variant="outline" onClick={() => openTransportDialog(hire.id)} title="Request vehicle transport for this hire" data-testid={`button-transport-${hire.id}`}>
              Transport
            </Button>
          </span>
          <span className="justify-self-stretch text-center">
            {pending ? (
              <Button size="sm" variant="ghost" disabled title="Assignment in progress" className="w-full">Wait</Button>
            ) : hire.truckAssigned ? (
              <Button size="sm" variant="ghost" className="w-full" onClick={() => openRecord(hire.id)} data-testid={`button-assign-${hire.id}`}>Edit</Button>
            ) : (
              <Button size="sm" variant="default" className="w-full" onClick={() => openAssignDialog(hire.id)} data-testid={`button-assign-${hire.id}`}>Assign</Button>
            )}
          </span>
        </div>
      </div>
    );
  }

  // ── Assign submit ──
  const activePending = activeHire ? pendingMap[activeHire.id] ?? null : null;
  const precheckBlocked = !!precheck?.isLocked;
  const canSubmitAssign =
    !!activeHire &&
    !!truckNumber.trim() &&
    !!(activeHire.enterpriseId ?? "").trim() &&
    !precheckBlocked &&
    !onboardingAssignMutation.isPending &&
    !activePending;

  const handleOneCallAssign = () => {
    if (!activeHire || !canSubmitAssign) return;
    onboardingAssignMutation.mutate({
      id: activeHire.id,
      truckNumber: truckNumber.trim(),
      notes: notes.trim(),
    });
  };

  // Transport form validation — mirrors PAL: truck plus a contact name AND phone
  // at BOTH ends (Premier needs someone to call at pickup and drop-off).
  const transportMissing = ([
    [!tForm.truck.trim(), "Truck #"],
    [!tForm.fromContactName.trim(), "Pickup contact name"],
    [!tForm.fromContact.trim(), "Pickup contact phone"],
    [!tForm.dropoffTechName.trim(), "Drop-off contact name"],
    [!tForm.dropoffTechPhone.trim(), "Drop-off contact phone"],
  ] as Array<[boolean, string]>).filter(([bad]) => bad).map(([, label]) => label);
  const transportCanCreate = transportMissing.length === 0;

  // ── Render ──
  const needTotal = paRows.reduce((n, r) => n + r.need, 0);
  const covered = paRows.filter(r => r.avail >= r.need).length;
  const short = paRows.filter(r => r.avail === 0).length;
  const anyFilters = filtersActive();
  const chipParts = viewChipParts();

  return (
    <MainContent>
      <TopBar
        title="Weekly Onboarding Truck Assignment"
        breadcrumbs={["Home", "Fleet", "Weekly Onboarding"]}
      />

      {/* Grey page background so the white cards have contrast in light mode
          (Tyler 2026-07-19: pure white was "blinding") — matches the mockup's
          light-mode --bg #f2f3f5; dark mode falls through to the app shell. */}
      <main className="min-h-screen bg-[#f2f3f5] p-6 dark:bg-transparent">
        <div className="mx-auto space-y-4" style={{ maxWidth: "min(1760px, 100vw - 40px)" }}>

          {/* Header card — sync line + action buttons, legacy copy verbatim */}
          <Card>
            <CardHeader>
              {/* Symmetric header (Tyler 2026-07-19): sync-status lives in the
                  LEFT title block like the mockup's top-sub; the button row is a
                  clean, evenly-sized group so nothing hangs lopsided. */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <UserPlus className="mt-0.5 h-6 w-6 shrink-0 text-purple-600" />
                  <div>
                    <CardTitle data-testid="text-onboarding-title">Weekly Onboarding Truck Assignment</CardTitle>
                    <CardDescription>
                      New tech hires starting from January 4, 2026 - assign trucks to new hires
                    </CardDescription>
                    {/* sync + BYOV status lines (moved out of the button row) */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                      {syncMutation.isPending ? (
                        <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Syncing from HR system...</span>
                      ) : syncFailed ? (
                        <span className="flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
                          <span className="text-yellow-600">Sync failed</span>
                          <Button size="sm" variant="ghost" className="h-6 px-2 py-0 text-[11.5px]" onClick={() => syncMutation.mutate()} data-testid="button-retry-sync">
                            <RefreshCw className="h-3 w-3 mr-1" />Retry
                          </Button>
                        </span>
                      ) : lastSync?.completedAt ? (
                        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Last synced: {format(new Date(lastSync.completedAt), 'MMM d, yyyy h:mm a')}</span>
                      ) : null}
                      {latestByovCheck && (
                        <span data-testid="text-byov-last-checked">BYOV checked {formatDistanceToNow(new Date(latestByovCheck), { addSuffix: true })}</span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Clean, evenly-sized button group (matches the mockup) */}
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => enrichMutation.mutate()} disabled={enrichMutation.isPending} data-testid="button-enrich-data">
                    {enrichMutation.isPending ? (
                      <><RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />Enriching...</>
                    ) : (
                      <><RefreshCw className="h-3 w-3 mr-1.5" />Enrich from Snowflake</>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => byovIntentSyncMutation.mutate()} disabled={byovIntentSyncMutation.isPending} data-testid="button-sync-byov-intent">
                    {byovIntentSyncMutation.isPending ? (
                      <><RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />Syncing BYOV...</>
                    ) : (
                      <><IdCard className="h-3 w-3 mr-1.5" />Sync BYOV Intent</>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportXlsx} data-testid="button-export-xlsx">
                    <Download className="h-3 w-3 mr-1.5" />Export XLSX
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Ledger strip (same four numbers + labels as the legacy stat cards) */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-5">
            <LedgerCell label="Total New Hires" value={hires.length} className="text-blue-600 dark:text-blue-400" />
            <LedgerCell label="Trucks Assigned" value={assignedCount} className="text-green-600 dark:text-green-400" />
            <LedgerCell label="Pending Assignment" value={unassignedCount} className="text-yellow-600 dark:text-yellow-500" />
            <LedgerCell label="PMF Available Vehicles" value={pmfLoading ? "..." : totalAvailableVehicles} className="text-purple-600 dark:text-purple-400" />
            <div className="col-span-2 flex flex-col justify-center gap-1.5 bg-background px-4 py-3 md:col-span-1">
              <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Assigned</span><span>{assignedCount} of {hires.length}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-muted">
                <div className="h-full rounded bg-green-600 transition-all" style={{ width: `${hires.length ? Math.round((assignedCount / hires.length) * 100) : 0}%` }} />
              </div>
            </div>
          </div>

          {/* PMF fetch failure surface (legacy verbatim) */}
          {!pmfLoading && pmfData && !pmfData.success && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="h-5 w-5" />
                  <span>Failed to load PMF vehicle data: {pmfData.message || 'Unknown error'}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Need by Planning Area (Decision 8; replaces the PMF by-state grid per Decision 5) */}
          <Card>
            <button
              type="button"
              onClick={() => setPaPanelOpen(o => !o)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40"
              aria-expanded={paPanelOpen}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Need by Planning Area</span>
                <span className="text-sm">
                  <span className="font-semibold text-red-600 dark:text-red-400">{needTotal} trucks needed</span>
                  {" "}across {paRows.length} areas · PMF stock covers <span className="font-semibold text-green-600 dark:text-green-400">{covered}</span> · {short} areas have nothing in-state
                </span>
              </div>
              <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${paPanelOpen ? "" : "-rotate-90"}`} />
            </button>
            {paPanelOpen && (
              <CardContent className="border-t pt-3">
                <div className="flex flex-wrap gap-1.5">
                  {paRows.map(r => (
                    <button
                      key={r.pa}
                      type="button"
                      onClick={() => setPaFilter(prev => prev === r.pa ? null : r.pa)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        paFilter === r.pa ? "border-primary font-semibold text-primary" :
                        r.avail === 0 ? "border-red-300 dark:border-red-800" :
                        r.avail >= r.need ? "border-green-300 dark:border-green-800" :
                        "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                      }`}
                      title={`${r.pa}: ${r.need} needed, ${r.avail} in-state PMF (${r.states.join(", ") || "no state"})`}
                    >
                      {r.pa} <span className="font-mono">{r.need}/{r.avail}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  need / in-state PMF stock · availability matched at STATE level for now; planning-area lot mapping + distance rule = open discussion
                </p>
              </CardContent>
            )}
          </Card>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by employee name, EID, truck, district..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-hires"
              />
            </div>
            {/* Owner tabs */}
            <div className="flex items-center gap-1 text-sm">
              {(["all", ...ownerOptions] as string[]).map(o => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOwnerFilter(o)}
                  className={`border-b-2 px-2 py-1 transition-colors ${ownerFilter === o ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {o === "all" ? "All Owners" : o}
                </button>
              ))}
            </div>
            {/* Status seg */}
            <div className="flex overflow-hidden rounded-md border text-sm">
              {([["all", "All"], ["pending", "Pending"], ["assigned", "Assigned"], ["byov", "BYOV"]] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStatusFilter(v)}
                  className={`px-3 py-1.5 transition-colors ${statusFilter === v ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {/* Employment-status seg (Tyler 2026-07-18: visible control, defaults
                Active; writes the SAME colFilters.es as the Emp column funnel) */}
            <div className="flex overflow-hidden rounded-md border text-sm" title="Employment status (defaults to Active)">
              {([["A", "Active"], ["T", "Terminated"], ["L", "LOA"], ["all", "All"]] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setColFilters(prev => ({ ...prev, es: v === "all" ? null : new Set([v]) }))}
                  className={`px-3 py-1.5 transition-colors ${empSegVal === v ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            {/* Intent select */}
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={byovIntentFilter}
              onChange={(e) => setByovIntentFilter(e.target.value)}
            >
              <option value="all">All Intents</option>
              <option value="perm">Perm</option>
              <option value="training">Training</option>
              <option value="na">NA</option>
            </select>
            {/* Planning-area select */}
            <select
              className="h-9 max-w-[280px] rounded-md border bg-background px-2 text-sm"
              value={paFilter ?? ""}
              onChange={(e) => setPaFilter(e.target.value || null)}
            >
              <option value="">All Planning Areas</option>
              {paOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {/* View chip */}
            {chipParts.length > 0 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary">
                View: {chipParts.join(" · ")}
                <button type="button" title="Show everything" onClick={clearAllFilters}><X className="h-3 w-3" /></button>
              </span>
            )}
          </div>

          {/* Week sections */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : hires.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <UserPlus className="mx-auto mb-4 h-12 w-12 opacity-50" />
              <p>No onboarding hires found.</p>
              <p className="mt-2 text-sm">Data syncs automatically from HR system.</p>
            </div>
          ) : (
            (() => {
              // Default within-week order = serviceDate ascending (matches the
              // legacy page; review fix 2026-07-18 — the query returns desc, so
              // without this v2 showed newest-first). An explicit column sort
              // overrides.
              const defaultSort = (rows: OnboardingHire[]) =>
                [...rows].sort((a, b) => {
                  const da = a.serviceDate ? String(a.serviceDate) : "";
                  const db = b.serviceDate ? String(b.serviceDate) : "";
                  return da < db ? -1 : da > db ? 1 : 0;
                });
              const sections = weekGroups
                .map(g => {
                  const matched = g.hires.filter(rowMatches);
                  return { g, visible: sort.k ? sortRows(matched) : defaultSort(matched) };
                })
                .filter(({ visible }) => !anyFilters || visible.length > 0);
              if (!sections.length) {
                return <div className="py-12 text-center text-muted-foreground"><p>No results match your search criteria.</p></div>;
              }
              return sections.map(({ g, visible }) => {
                const isOpen = (expandedWeeks.has(g.key) || anyFilters) && !collapsedWeeks.has(g.key);
                const wkAssigned = g.hires.filter(h => h.truckAssigned).length;
                return (
                  <section key={g.key} className="overflow-hidden rounded-lg border">
                    <button
                      type="button"
                      onClick={() => toggleWeek(g.key)}
                      aria-expanded={isOpen}
                      className="relative flex w-full items-center gap-4 bg-muted/40 px-4 py-2.5 text-left hover:bg-muted/70"
                    >
                      <div className="flex min-w-[64px] flex-col items-center border-r pr-4">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Week</span>
                        <span className={`text-lg font-bold tabular-nums ${g.isCurrent ? "text-amber-500" : ""}`}>{getWeekNum(g.start)}</span>
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold">Week of {format(g.start, "MMM d")}</h2>
                        <p className="font-mono text-[11px] text-muted-foreground">{weekLabel(g.start)}</p>
                      </div>
                      {/* punch-rail: one cell per hire; click opens the record modal */}
                      <div className="ml-2 hidden flex-wrap gap-[3px] lg:flex">
                        {g.hires.map(h => {
                          const s = deriveStatus(h);
                          return (
                            <span
                              key={h.id}
                              role="button"
                              title={`${h.employeeName}${h.assignedTruckNo ? ` (${h.assignedTruckNo})` : ""}`}
                              onClick={(e) => { e.stopPropagation(); openRecord(h.id); }}
                              className={`h-4 w-[11px] rounded-[3px] border transition-transform hover:-translate-y-0.5 ${
                                s === "assigned" ? "border-green-600 bg-green-600" : s === "byov" ? "border-blue-600 bg-blue-600" : "border-yellow-500"
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex-1" />
                      {g.isCurrent && (
                        <span className="rounded border border-amber-500 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-amber-500">CURRENT</span>
                      )}
                      <Badge variant={wkAssigned === g.hires.length ? "default" : "secondary"} className={wkAssigned === g.hires.length ? "bg-green-600" : ""}>
                        {wkAssigned} of {g.hires.length} assigned
                      </Badge>
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      <div className="absolute bottom-0 left-0 h-0.5 bg-green-600 transition-all" style={{ width: `${g.hires.length ? Math.round((wkAssigned / g.hires.length) * 100) : 0}%` }} />
                    </button>
                    {isOpen && (
                      <div className="overflow-x-auto">{/* horizontal scroll = small-window fallback only */}
                        {theadRow()}
                        {visible.map(hireRow)}
                        {!visible.length && (
                          <div className="border-t px-4 py-3 text-sm text-muted-foreground">No rows match the current filters in this week.</div>
                        )}
                      </div>
                    )}
                  </section>
                );
              });
            })()
          )}

          <p className="pb-8 text-[11px] leading-relaxed text-muted-foreground">
            Assign fires the same TPMS + Holman + AMS pipeline as Fleet Management's Assign button
            (POST /api/onboarding-hires/:id/assign) with the same district rules; the row updates in the same call.
            Distance is a city-to-city straight-line estimate (PMF gives each truck only a site city, not an address).
          </p>
        </div>
      </main>

      {/* ── Record modal (centered, wide; board stays visible behind) ── */}
      <Dialog open={!!activeHire && !assignDialogOpen && !transportDialogOpen} onOpenChange={(o) => { if (!o) closeAllDialogs(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[900px]">
          {activeHire && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <span className="flex flex-wrap items-center gap-2">
                    {activeHire.employeeName}
                    <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">{activeHire.enterpriseId?.toUpperCase() || "no EID"}</span>
                    <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">D {activeHire.district || "-"}</span>
                    <StatusBadge hire={activeHire} />
                    {deriveStatus(activeHire) === "pending" && activeHire.byovIntent && <IntentBadge hire={activeHire} />}
                    {parseTransportId(activeHire.notes) && (
                      <span className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] font-normal text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        <Truck className="h-3 w-3" /> TRANSPORT ✓ {parseTransportId(activeHire.notes)}
                      </span>
                    )}
                  </span>
                </DialogTitle>
                <DialogDescription>Hire record</DialogDescription>
              </DialogHeader>

              {/* Facts grid — full prod date format here (no width pressure) */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-3">
                {([
                  ["Service Date", activeHire.serviceDate ? format(parseLocalDate(String(activeHire.serviceDate)), "MMM d, yyyy") : "N/A"],
                  ["Emp. Status", activeHire.employmentStatus || "-"],
                  ["Tech Type", activeHire.techType || "-"],
                  ["Job Title", activeHire.jobTitle || "-"],
                  ["District", `${activeHire.district || "-"}${activeHire.district && lookupCostCenter(activeHire.district) ? ` · CC ${lookupCostCenter(activeHire.district)}` : ""}`],
                  ["Owner", getOwnerFromDistrict(activeHire.district)],
                  ["City / State", activeHire.locationCity ? `${activeHire.locationCity}, ${activeHire.workState || ""}` : (activeHire.workState || "-")],
                  ["Zip", activeHire.zipcode || "-"],
                  ["Planning Area", activeHire.planningAreaName || "-"],
                  ["Action Reason", activeHire.actionReasonDescr || "-"],
                  ["Enterprise ID", activeHire.enterpriseId?.toUpperCase() || "- (enrichment pending)"],
                  ["BYOV Intent", `${activeHire.byovIntent || "none recorded"}${activeHire.byovIntentCheckedAt ? ` · checked ${formatDistanceToNow(new Date(activeHire.byovIntentCheckedAt), { addSuffix: true })}` : ""}`],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k}>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                    <p className="mt-0.5">{v}</p>
                  </div>
                ))}
                {activeHire.address && (
                  <div className="col-span-2 sm:col-span-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Address</p>
                    <p className="mt-0.5 text-sm">{activeHire.address}</p>
                  </div>
                )}
                {activeHire.specialties && (
                  <div className="col-span-2 sm:col-span-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Specialties</p>
                    <p className="mt-0.5 text-sm">{activeHire.specialties}</p>
                  </div>
                )}
              </div>

              {/* Two-column body: assignment state | notes */}
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  {activePending ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                      <p className="font-semibold text-amber-700 dark:text-amber-400">Assignment in progress</p>
                      <p className="mt-1 text-amber-700/90 dark:text-amber-400/90">
                        Truck {activePending.tn} submitted {pendingAgoLabel(activePending.startedAt)} — writing to TPMS/Holman/AMS.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Stored on this browser only; refreshing keeps showing this until it settles or 2 minutes pass.
                      </p>
                    </div>
                  ) : activeHire.truckAssigned ? (
                    <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
                      <p className="font-semibold text-green-700 dark:text-green-400">
                        Truck {activeHire.assignedTruckNo}
                        {deriveStatus(activeHire) === "byov" ? " (BYOV, 88-prefix)" : ""}
                      </p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {[
                          activeHire.truckAssignmentSource ? `source: ${activeHire.truckAssignmentSource}` : null,
                          activeHire.assignedBy ? `by ${activeHire.assignedBy}` : null,
                          activeHire.assignedAt ? format(new Date(activeHire.assignedAt), "MMM d, yyyy h:mm a") : null,
                        ].filter(Boolean).join(" · ") || "No assignment metadata recorded"}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Available vehicles · PMF, nearest first
                      </p>
                      {(() => {
                        const ranked = rankedFor(activeHire);
                        const within = ranked.filter(r => r.withinRadius);
                        const rest = ranked.filter(r => !r.withinRadius);
                        const hireState = (activeHire.workState || "").toUpperCase().trim();
                        if (!ranked.length) {
                          return <p className="text-sm text-muted-foreground">0 in {hireState || "?"} · request a transport or source from Fleet Management</p>;
                        }
                        return (
                          <div className="space-y-1">
                            <p className={`text-sm font-semibold ${within.length ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {within.length
                                ? `${within.length} within 100 mi of ${activeHire.locationCity || hireState}`
                                : `0 within 100 mi · ${ranked.length} in ${hireState}`}
                            </p>
                            <div className="max-h-40 space-y-1 overflow-y-auto">
                              {(within.length ? within : rest).map((r, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setPickedVehicle(r.v)}
                                  className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left font-mono text-xs hover:bg-muted ${pickedVehicle?.assetId === r.v.assetId ? "border-primary" : ""}`}
                                >
                                  <span>{r.v.assetId || "?"} · {[r.v.year, r.v.make || r.v.Make, r.v.model || r.v.Model].filter(Boolean).join(" ")}{r.v.licensePlate ? ` · ${r.v.licensePlate}` : ""}</span>
                                  <span className="text-muted-foreground">{r.miles != null ? `~${Math.round(r.miles)} mi` : "same state · distance n/a"}</span>
                                </button>
                              ))}
                              {within.length > 0 && rest.length > 0 && (
                                <details>
                                  <summary className="cursor-pointer text-[11px] text-muted-foreground">Show {rest.length} more in {hireState} (over 100 mi / distance n/a)</summary>
                                  <div className="mt-1 space-y-1">
                                    {rest.map((r, i) => (
                                      <button
                                        key={i}
                                        type="button"
                                        onClick={() => setPickedVehicle(r.v)}
                                        className="flex w-full items-center justify-between rounded border px-2 py-1 text-left font-mono text-xs hover:bg-muted"
                                      >
                                        <span>{r.v.assetId || "?"} · {[r.v.year, r.v.make || r.v.Make, r.v.model || r.v.Model].filter(Boolean).join(" ")}</span>
                                        <span className="text-muted-foreground">{r.miles != null ? `~${Math.round(r.miles)} mi` : "same state · distance n/a"}</span>
                                      </button>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Distance is a city-to-city straight-line estimate (PMF gives each truck only a site city, not an address).
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="recordNotes" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Notes</Label>
                  <Textarea
                    id="recordNotes"
                    className="mt-1.5"
                    rows={5}
                    placeholder="Add any notes..."
                    value={recordNotes}
                    onChange={(e) => setRecordNotes(e.target.value)}
                  />
                  {recordNotes !== (activeHire.notes || "") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={assignMutation.isPending}
                      onClick={() => assignMutation.mutate({
                        id: activeHire.id,
                        truckAssigned: activeHire.truckAssigned,
                        assignedTruckNo: activeHire.assignedTruckNo || "",
                        notes: recordNotes.trim(),
                      })}
                    >
                      {assignMutation.isPending ? "Saving..." : "Save notes"}
                    </Button>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeAllDialogs}>Close</Button>
                <Button variant="outline" onClick={() => openTransportDialog(activeHire.id)} data-testid="button-transport-record">
                  {parseTransportId(activeHire.notes) ? "Request another transport" : "Request transport"}
                </Button>
                {activePending ? (
                  <Button disabled>Assignment in progress…</Button>
                ) : (
                  <Button onClick={() => openAssignDialog(activeHire.id)}>
                    {activeHire.truckAssigned
                      ? "Edit assignment…"
                      : `Assign truck${pickedVehicle?.assetId ? ` ${pickedVehicle.assetId}` : ""}…`}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Assign dialog (endpoint-backed; rich context so it reads as the NEW
             menu, matching the mockup — Tyler 2026-07-19: a bare truck#+notes
             form looked like the legacy dialog) ── */}
      <Dialog open={!!activeHire && assignDialogOpen} onOpenChange={(o) => { if (!o) closeAllDialogs(); }}>
        <DialogContent className="sm:max-w-[600px]">
          {activeHire && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <span className="flex items-center gap-2">
                    <Truck className="h-5 w-5" />
                    Assign Truck to {activeHire.employeeName}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  Service Date: {activeHire.serviceDate ? format(parseLocalDate(String(activeHire.serviceDate)), 'MMM d, yyyy') : 'N/A'}
                  {" · "}runs the same TPMS/Holman/AMS assign as Fleet Management
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* PMF quick-picks (nearest first) — always-present header + a
                    fallback line so the dialog never collapses to a bare form. */}
                <div>
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Available trucks · PMF, nearest first</p>
                  {(() => {
                    const ranked = rankedFor(activeHire).slice(0, 8);
                    const hireState = (activeHire.workState || "").toUpperCase().trim();
                    if (!ranked.length) {
                      return <p className="text-xs text-muted-foreground">No PMF trucks available in {hireState || "this state"} right now — type a truck number, or source one from Fleet Management.</p>;
                    }
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {ranked.map((r, i) => (
                          <button
                            key={i}
                            type="button"
                            title={`${[r.v.year, r.v.make || r.v.Make, r.v.model || r.v.Model].filter(Boolean).join(" ")}${r.v.licensePlate ? ` · ${r.v.licensePlate}` : ""}${r.miles != null ? ` · ~${Math.round(r.miles)} mi` : ""}`}
                            onClick={() => setTruckNumber(String(r.v.assetId || ""))}
                            className={`rounded border px-2 py-0.5 font-mono text-[11px] hover:bg-muted ${String(truckNumber) === String(r.v.assetId) ? "border-primary text-primary" : "text-primary/90"}`}
                          >
                            {r.v.assetId || "?"}{r.miles != null ? ` ~${Math.round(r.miles)}mi` : ""}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="truckNumber">Truck Number</Label>
                  <Input
                    id="truckNumber"
                    placeholder="Enter truck number..."
                    value={truckNumber}
                    onChange={(e) => setTruckNumber(e.target.value)}
                    data-testid="input-truck-number"
                  />
                  {/* Pre-check chip (30s staleTime; read-only cache lookup) */}
                  {precheckTruck && (
                    precheckMiss ? (
                      <p className="text-xs text-muted-foreground">Truck {precheckTruck}: not in Holman cache (may still be valid — server will verify)</p>
                    ) : precheck ? (
                      <p className={`text-xs ${precheck.isLocked ? "text-red-600 dark:text-red-400" : precheck.holmanTechAssigned ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                        {precheck.isLocked
                          ? `Locked: another operation on ${precheckTruck} is in progress (${precheck.lockedBy || "unknown"})`
                          : precheck.holmanTechAssigned
                            ? `Heads up: ${precheckTruck} shows assigned to ${precheck.holmanTechName || precheck.holmanTechAssigned} in Holman — assigning will reassign it`
                            : `${precheckTruck}: unassigned in Holman cache (status ${precheck.holmanAssignedStatusCd || "-"})`}
                      </p>
                    ) : null
                  )}
                </div>
                {/* Readonly context — WHO this assigns to and WHERE (matches the
                    mockup so the dialog reads as rich/new, not a bare form). */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Enterprise / LDAP ID</Label>
                    <Input readOnly value={activeHire.enterpriseId ? String(activeHire.enterpriseId).toUpperCase() : ""} placeholder="missing" className="bg-muted font-mono" />
                    <p className={`text-[11px] ${activeHire.enterpriseId ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                      {activeHire.enterpriseId ? "From the hire record; a new hire's TPMS profile is created on assign." : "No Enterprise ID yet (enrichment pending). Required, so assign is blocked."}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>District</Label>
                    <Input readOnly value={activeHire.district || ""} className="bg-muted font-mono" />
                    <p className="text-[11px] text-muted-foreground">Sent as districtNo; the same district guard as Fleet Management runs against it.</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assignNotes">Notes (optional)</Label>
                  <Textarea
                    id="assignNotes"
                    placeholder="Add any notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    data-testid="input-notes"
                  />
                </div>

                {/* After-assignment preview (matches the mockup; hidden once a real result lands) */}
                {!assignResult && (
                  <div className="rounded-lg border bg-muted/30 p-2.5 text-xs">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">After assignment</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>TPMS &rarr; <b>Assigned</b></span>
                      <span>Holman &rarr; <b>Assigned</b></span>
                      <span>AMS &rarr; <b>Assigned to Tech</b></span>
                      <span>Onboarding row &rarr; <b>stamped on TPMS success</b></span>
                    </div>
                  </div>
                )}

                {/* Result lanes after submit (TPMS / HOLMAN / AMS / WMS) */}
                {assignResult && (
                  <div className="space-y-1 rounded-lg border p-2 text-xs">
                    {(["tpms", "holman", "ams", "wms"] as const).map(sys => {
                      const lane = assignResult[sys];
                      if (!lane) return null;
                      const st = String(lane.status || "-");
                      const cls =
                        st === "success" ? "text-green-600 dark:text-green-400" :
                        st === "pending" ? "text-amber-600 dark:text-amber-400" :
                        st === "skipped" ? "text-muted-foreground" :
                        "text-red-600 dark:text-red-400";
                      return (
                        <div key={sys} className="flex items-start justify-between gap-3">
                          <span className="font-mono font-semibold uppercase">{sys}</span>
                          <span className={`text-right ${cls}`}>{st}{lane.message ? ` — ${lane.message}` : ""}</span>
                        </div>
                      );
                    })}
                    {"hireStamped" in assignResult && (
                      <div className="flex items-start justify-between gap-3 border-t pt-1">
                        <span className="font-mono font-semibold uppercase">Row</span>
                        <span className={assignResult.hireStamped ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                          {assignResult.hireStamped ? "updated" : "not updated (TPMS did not commit)"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeAllDialogs}>
                  {assignResult ? "Close" : "Cancel"}
                </Button>
                <Button
                  onClick={handleOneCallAssign}
                  disabled={!canSubmitAssign}
                  data-testid="button-confirm-assign"
                >
                  {onboardingAssignMutation.isPending ? "Assigning…" : "Assign to All Systems"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Transport request dialog — mirrors PAL's New Transport form so the
             request maps 1:1 into the PAL record (Urgency/status included) ── */}
      <Dialog open={!!activeHire && transportDialogOpen} onOpenChange={(o) => { if (!o) closeAllDialogs(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[720px]">
          {activeHire && (
            <>
              <DialogHeader>
                <DialogTitle>
                  <span className="flex items-center gap-2"><Truck className="h-5 w-5" /> New Transport Request — {activeHire.employeeName}</span>
                </DialogTitle>
                <DialogDescription>
                  Same fields as the PAL Transport form; the request lands on the PAL board under your name. Drop-off is prefilled to the hire's location.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-1">
                {/* Truck + VIN */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tf-truck">Truck # <span className="text-red-500">*</span></Label>
                    <Input id="tf-truck" value={tForm.truck} onChange={(e) => setT("truck", e.target.value)} placeholder="Truck number" data-testid="input-transport-truck" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tf-vin">VIN</Label>
                    <Input id="tf-vin" value={tForm.vin} onChange={(e) => setT("vin", e.target.value)} placeholder="VIN" />
                  </div>
                </div>

                {/* Urgency = PAL status (standard/urgent/asap/hold) */}
                <div className="space-y-1.5">
                  <Label>Urgency</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {TRANSPORT_URGENCY.map((u) => (
                      <button
                        key={u.key}
                        type="button"
                        onClick={() => setT("status", u.key)}
                        aria-pressed={tForm.status === u.key}
                        data-testid={`urgency-${u.key}`}
                        className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tForm.status === u.key ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-muted"}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: u.dot }} />
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pickup / Repair location + contacts */}
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-primary">Pickup / Repair Location</p>
                  <Input value={tForm.fromAddr} onChange={(e) => setT("fromAddr", e.target.value)} placeholder="Pickup address (street, city, state, zip)" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tf-fcn">Contact Name (Pickup) <span className="text-red-500">*</span></Label>
                      <Input id="tf-fcn" value={tForm.fromContactName} onChange={(e) => setT("fromContactName", e.target.value)} placeholder="Who to call at pickup" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tf-fc">Contact Phone (Pickup) <span className="text-red-500">*</span></Label>
                      <Input id="tf-fc" value={tForm.fromContact} onChange={(e) => setT("fromContact", e.target.value)} placeholder="Phone at pickup" />
                    </div>
                  </div>
                </div>

                {/* Drop-off location + contacts */}
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-primary">Drop-off Location</p>
                  <Input value={tForm.toAddr} onChange={(e) => setT("toAddr", e.target.value)} placeholder="Drop-off address" data-testid="input-transport-dropoff" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tf-dtn">Contact Name (Drop-off) <span className="text-red-500">*</span></Label>
                      <Input id="tf-dtn" value={tForm.dropoffTechName} onChange={(e) => setT("dropoffTechName", e.target.value)} placeholder="Who to call at drop-off" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tf-dtp">Contact Phone (Drop-off) <span className="text-red-500">*</span></Label>
                      <Input id="tf-dtp" value={tForm.dropoffTechPhone} onChange={(e) => setT("dropoffTechPhone", e.target.value)} placeholder="Phone at drop-off" />
                    </div>
                  </div>
                </div>

                {/* Keys / Van / Requested by */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Keys Present</Label>
                    <YesNoUnknown value={tForm.keysPresent} onChange={(v) => setT("keysPresent", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Van Starts</Label>
                    <YesNoUnknown value={tForm.vanStarts} onChange={(v) => setT("vanStarts", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Requested By</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">{authUser?.username || "you (signed-in)"}</div>
                  </div>
                </div>

                {/* Internal notes */}
                <div className="space-y-1.5">
                  <Label htmlFor="tf-notes">Internal Notes</Label>
                  <Textarea id="tf-notes" value={tForm.internalNotes} onChange={(e) => setT("internalNotes", e.target.value)} rows={2} placeholder="Internal team notes..." />
                </div>
              </div>

              <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                {!transportCanCreate && (
                  <span className="mr-auto text-[11px] text-amber-600 dark:text-amber-400">Required: {transportMissing.join(", ")}</span>
                )}
                <Button variant="outline" onClick={closeAllDialogs}>Cancel</Button>
                <Button
                  onClick={() => transportMutation.mutate({ id: activeHire.id, form: tForm })}
                  disabled={!transportCanCreate || transportMutation.isPending}
                  data-testid="button-send-transport"
                >
                  {transportMutation.isPending ? "Sending…" : "Create Transport"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
