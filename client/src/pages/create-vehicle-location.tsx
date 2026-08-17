import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useHasPermission } from "@/hooks/use-permissions";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Car, User, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2, History, Download, Eye, ClipboardCheck, ExternalLink, ShieldAlert, RefreshCw, Clock, Lock, LockOpen, MinusCircle, HelpCircle, FlaskConical, Ban } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ByovCreationAuditEntry } from "@shared/schema";
import {
  IDLE_VERDICT,
  applyRetryResponse,
  combinePreflight,
  createNumberPreflight,
  createVinPreflight,
  describeGate,
  describeNumberHold,
  describeOutcome,
  describeRefusal,
  getJson,
  postJson,
  runNumberCheck,
  type CheckVerdict,
  type GateState,
  type NumberHold,
  type RefusalBody,
  type SubmitResponse,
  type SystemRow,
} from "@/lib/vehicle-create-preflight";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const PLATE_TYPES = ["PAS", "COM"];

interface FormState {
  vehicleClass: string;
  vehicleNumber: string;
  vin: string;
  assetType: string;
  modelYear: string;
  make: string;
  model: string;
  district: string;
  deliveryAddress: string;
  deliveryAddress2: string;
  deliveryAddress3: string;
  city: string;
  state: string;
  zip: string;
  deliveryDate: string;
  onRoadDate: string;
  firstName: string;
  lastName: string;
  enterpriseId: string;
  phone: string;
  licensePlate: string;
  plateState: string;
  plateType: string;
  regRenewalDate: string;
}

/**
 * The create/retry endpoints answer with the Task #636 contract: per-system
 * results that can be `pending` (submitted, acceptance not established), a
 * `summary` of what was actually attempted, a `requestId` for support, and a
 * rehearsal shape that reports what WOULD have been sent.
 */
type SubmitResult = SubmitResponse;

const today = new Date().toISOString().split("T")[0];

const emptyForm: FormState = {
  vehicleClass: "byov",
  vehicleNumber: "",
  vin: "",
  assetType: "",
  modelYear: String(new Date().getFullYear()),
  make: "",
  model: "",
  district: "",
  deliveryAddress: "",
  deliveryAddress2: "",
  deliveryAddress3: "",
  city: "",
  state: "",
  zip: "",
  deliveryDate: today,
  onRoadDate: today,
  firstName: "",
  lastName: "",
  enterpriseId: "",
  phone: "",
  licensePlate: "",
  plateState: "",
  plateType: "",
  regRenewalDate: "",
};

export default function CreateVehicle() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canBackfill = user?.role === "developer" || user?.role === "admin";
  const [backfilling, setBackfilling] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  // Preflight: one verdict per check, mirroring the fail-closed server gate.
  const [numberVerdict, setNumberVerdict] = useState<CheckVerdict>(IDLE_VERDICT);
  // The value numberVerdict actually describes, so a verdict for a number the
  // user has since edited is never mistaken for a verdict on the current one.
  const [numberCheckedValue, setNumberCheckedValue] = useState("");
  const [vinVerdict, setVinVerdict] = useState<CheckVerdict>(IDLE_VERDICT);
  // The suggested number is a real reservation, not a recommendation.
  const [numberHold, setNumberHold] = useState<NumberHold | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [lastSubmittedForm, setLastSubmittedForm] = useState<FormState | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [holmanOnlyMode, setHolmanOnlyMode] = useState(false);
  const [holmanProbe, setHolmanProbe] = useState<{ checking: boolean; result: string | null }>({
    checking: false,
    result: null,
  });
  // A rehearsed retry sent nothing, so it must never be folded into the real
  // outcome above it — it is reported separately, as a rehearsal.
  const [retryRehearsal, setRetryRehearsal] = useState<{ label: string; response: SubmitResult } | null>(null);

  // ── Creation gate (Task #636) ────────────────────────────────────────────────
  // Fail-safe OFF on the server, so the form says up front whether a submission
  // will be accepted at all, or will only be rehearsed.
  const gateQuery = useQuery<GateState>({
    queryKey: ["/api/admin/vehicle-create/gate"],
    queryFn: async () => {
      const resp = await getJson<GateState>("/api/admin/vehicle-create/gate");
      if (!resp.ok || !resp.body) throw new Error("Could not read the vehicle-creation gate");
      return { enabled: !!resp.body.enabled, rehearsalMode: !!resp.body.rehearsalMode };
    },
    staleTime: 60_000,
  });
  const gateBanner = describeGate(gateQuery.data ?? null, gateQuery.isError);
  const creationDisabled = gateBanner.submissionsRefused;
  const rehearsalMode = gateBanner.kind === "rehearsal";

  const [exportFrom, setExportFrom] = useState(() => {
    try { return localStorage.getItem("byov-export-from") ?? ""; } catch { return ""; }
  });
  const [exportTo, setExportTo] = useState(() => {
    try { return localStorage.getItem("byov-export-to") ?? ""; } catch { return ""; }
  });
  const [exportPreset, setExportPreset] = useState(() => {
    try { return localStorage.getItem("byov-export-preset") ?? ""; } catch { return ""; }
  });
  const [selectedAuditEntry, setSelectedAuditEntry] = useState<ByovCreationAuditEntry | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("byov-export-from", exportFrom);
      localStorage.setItem("byov-export-to", exportTo);
      localStorage.setItem("byov-export-preset", exportPreset);
    } catch {}
  }, [exportFrom, exportTo, exportPreset]);

  const auditLogQueryParams = new URLSearchParams();
  if (exportFrom) auditLogQueryParams.set("from", exportFrom);
  if (exportTo) auditLogQueryParams.set("to", exportTo);
  const auditLogQs = auditLogQueryParams.toString();
  const auditLogUrl = `/api/byov/audit-log${auditLogQs ? `?${auditLogQs}` : ""}`;

  const auditLogQuery = useQuery<ByovCreationAuditEntry[]>({
    queryKey: ["/api/byov/audit-log", exportFrom, exportTo],
    queryFn: () => fetch(auditLogUrl, { credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error(`Failed to load audit log (${r.status})`);
      return r.json();
    }),
    staleTime: 30_000,
  });

  const handleVehicleNumberClick = async (vehicleNumber: string) => {
    if (navigatingTo === vehicleNumber) return;
    setNavigatingTo(vehicleNumber);
    try {
      const resp = await fetch(`/api/fs/trucks/by-number/${encodeURIComponent(vehicleNumber)}`, {
        credentials: "include",
      });
      if (resp.ok) {
        const data = await resp.json();
        navigate(`/fleet-scope/trucks/${data.id}`);
      } else if (resp.status === 404) {
        toast({
          title: "Vehicle not in fleet",
          description: `Vehicle ${vehicleNumber} was not found in the fleet list. It may still be pending.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Lookup failed",
          description: "Could not look up the fleet record. Please try again.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Lookup failed",
        description: "Could not reach the server. Please try again.",
        variant: "destructive",
      });
    } finally {
      setNavigatingTo(null);
    }
  };

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const setSelect = (field: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Auto-fill Model Year, Make, Model, and Asset Type from the VIN, and run the
  // VIN half of the preflight at the same time.
  const [decodingVin, setDecodingVin] = useState(false);
  const lastDecodedVinRef = useRef<string>("");
  const decodeSeqRef = useRef(0);
  useEffect(() => {
    const vin = form.vin.trim().toUpperCase();
    if (vin.length !== 17) {
      setDecodingVin(false);
      return;
    }
    if (lastDecodedVinRef.current === vin) return;
    lastDecodedVinRef.current = vin;
    const seq = ++decodeSeqRef.current;
    const isCurrent = () => decodeSeqRef.current === seq;
    (async () => {
      setDecodingVin(true);
      try {
        const decodeResp = await apiRequest("GET", `/api/vin/decode/${encodeURIComponent(vin)}`);
        const data = await decodeResp.json();
        if (!isCurrent()) return;
        if (data?.decoded) {
          setForm((prev) => ({
            ...prev,
            make: data.make || prev.make,
            model: data.model || prev.model,
            modelYear: data.modelYear || prev.modelYear,
            assetType: data.assetType || prev.assetType,
          }));
          toast({
            title: "Details filled from VIN",
            description: data.assetType
              ? "Model year, make, model, and asset type were auto-filled."
              : "Model year, make, and model were auto-filled — please pick the asset type.",
          });
        } else {
          toast({
            title: "Couldn't read this VIN",
            description: data?.error || "Please enter the vehicle details manually.",
            variant: "destructive",
          });
        }
      } catch {
        if (isCurrent()) {
          lastDecodedVinRef.current = ""; // allow a retry
          // Note: the VIN gate is NOT touched here. Decoding is a convenience;
          // losing it must not discard a duplicate or format verdict.
          toast({
            title: "VIN lookup failed",
            description: "Could not reach the VIN service. Please enter the details manually.",
            variant: "destructive",
          });
        }
      } finally {
        if (isCurrent()) setDecodingVin(false);
      }
    })();
  }, [form.vin]);

  useEffect(() => {
    const allowedKeys = [
      "vehicleNumber","vin","assetType","modelYear","make","model",
      "district","deliveryAddress","deliveryAddress2","deliveryAddress3","city","state","zip",
      "deliveryDate","onRoadDate",
      "firstName","lastName","enterpriseId","phone",
      "licensePlate","plateState","plateType","regRenewalDate",
    ];
    const prefill = getPrefillParams(allowedKeys);
    if (Object.keys(prefill).length > 0) {
      const processed: Partial<FormState> = {};
      if (prefill.vehicleNumber) processed.vehicleNumber = commonValidators.vehicleNumber(prefill.vehicleNumber);
      if (prefill.vin) processed.vin = commonValidators.vin(prefill.vin);
      if (prefill.firstName) processed.firstName = commonValidators.employeeName(prefill.firstName);
      if (prefill.lastName) processed.lastName = commonValidators.employeeName(prefill.lastName);
      if (prefill.phone) processed.phone = commonValidators.phone(prefill.phone);
      if (prefill.deliveryDate) processed.deliveryDate = commonValidators.date(prefill.deliveryDate) || today;
      if (prefill.onRoadDate) processed.onRoadDate = commonValidators.date(prefill.onRoadDate) || today;
      if (prefill.regRenewalDate) processed.regRenewalDate = commonValidators.date(prefill.regRenewalDate) || "";
      if (prefill.zip) processed.zip = commonValidators.zipCode(prefill.zip);
      if (prefill.licensePlate) processed.licensePlate = commonValidators.licensePlate(prefill.licensePlate);
      if (prefill.plateState) processed.plateState = commonValidators.stateAbbr(prefill.plateState);
      if (prefill.state) processed.state = commonValidators.stateAbbr(prefill.state);
      if (prefill.modelYear) processed.modelYear = String(parseInt(prefill.modelYear, 10) || new Date().getFullYear());
      if (prefill.assetType) processed.assetType = prefill.assetType;
      if (prefill.make) processed.make = prefill.make;
      if (prefill.model) processed.model = prefill.model;
      if (prefill.district) {
        // Normalize to the natural district number (strip leading zeros) so a known
        // district pre-selects in the dropdown, whose option values are natural numbers.
        const normalized = String(prefill.district).replace(/\D/g, "").replace(/^0+/, "");
        processed.district = normalized || String(prefill.district);
      }
      if (prefill.deliveryAddress) processed.deliveryAddress = prefill.deliveryAddress;
      if (prefill.deliveryAddress2) processed.deliveryAddress2 = prefill.deliveryAddress2;
      if (prefill.deliveryAddress3) processed.deliveryAddress3 = prefill.deliveryAddress3;
      if (prefill.city) processed.city = prefill.city;
      if (prefill.plateType) processed.plateType = prefill.plateType;
      if (prefill.enterpriseId) processed.enterpriseId = prefill.enterpriseId;
      setForm((prev) => ({ ...prev, ...processed }));
    }
  }, []);

  /**
   * The two halves of the preflight. Each is sequenced, so a slow answer for a
   * value the user has since changed is dropped rather than published, and each
   * always publishes a verdict for the current value — a field edited to
   * something invalid and back again is re-judged, never left showing the stale
   * verdict.
   */
  const numberPreflight = useRef(
    createNumberPreflight({
      publish: (verdict, input) => {
        setNumberVerdict(verdict);
        setNumberCheckedValue(input);
      },
    }),
  ).current;
  const vinPreflight = useRef(createVinPreflight({ publish: setVinVerdict })).current;

  const checkVehicleNumber = (vehicleNumber: string) => numberPreflight.run(vehicleNumber);

  // The VIN gate runs on its own, independent of the optional VIN decode above:
  // a decode outage must never discard a duplicate verdict.
  useEffect(() => {
    void vinPreflight.run(form.vin);
  }, [form.vin]);

  /**
   * The number check costs a Holman round-trip, so it is debounced rather than
   * fired on every keystroke — but it does run while typing. Waiting for blur
   * left a manually typed number unchecked if the user submitted with Enter
   * straight from the field.
   */
  // Runs for auto-assigned and URL-prefilled numbers too, not just typed ones,
  // so the field always carries a verdict for whatever is actually in it.
  useEffect(() => {
    const timer = setTimeout(() => void numberPreflight.run(form.vehicleNumber), 400);
    return () => clearTimeout(timer);
  }, [form.vehicleNumber]);

  /** True while the displayed verdict belongs to an older value of the field. */
  const numberVerdictStale = form.vehicleNumber.trim() !== numberCheckedValue;

  const rerunPreflight = async () => {
    await Promise.all([numberPreflight.run(form.vehicleNumber), vinPreflight.run(form.vin)]);
  };

  const canManualNumber = useHasPermission("pageFeatures.createVehicle.manualVehicleNumberEntry");
  const { items: costCenters, lookupCostCenter } = useCostCenters();
  const [loadingNextNumber, setLoadingNextNumber] = useState(false);

  const classLabel =
    form.vehicleClass === "enterprise" ? "Enterprise" : form.vehicleClass === "holman" ? "Holman" : "BYOV";

  /**
   * The suggestion endpoint HOLDS the number it hands back (tied to this
   * session, expiring on abandonment), so the form reports it as a reservation
   * with a countdown rather than as a recommendation.
   */
  const fetchNextNumber = async (cls: string) => {
    setLoadingNextNumber(true);
    try {
      const resp = await getJson<{
        padded?: string;
        recommended?: string;
        held?: boolean;
        holdId?: number | null;
        holdExpiresAt?: string | null;
        scannedSources?: string[];
        error?: string;
        sources?: Array<{ name: string; ok: boolean; error?: string }>;
      }>(`/api/byov/next-number?class=${encodeURIComponent(cls)}`);

      if (resp.ok && resp.body?.padded) {
        const padded = resp.body.padded;
        setForm((prev) => ({ ...prev, vehicleNumber: padded }));
        setNumberHold(
          resp.body.held
            ? {
                number: padded,
                holdId: resp.body.holdId ?? null,
                expiresAt: resp.body.holdExpiresAt ?? null,
                scannedSources: resp.body.scannedSources ?? [],
              }
            : null,
        );
        setNowMs(Date.now());
        void checkVehicleNumber(padded);
        return;
      }

      // A refusal here is specific and worth repeating verbatim: an incomplete
      // source scan (503) must never be rounded off to "try again".
      const unreachable = (resp.body?.sources || []).filter((s) => !s.ok).map((s) => s.name);
      toast({
        title: resp.status === 503 ? "Number allocation is unavailable" : "Could not get next number",
        description:
          resp.body?.error ||
          resp.transportError ||
          "Please try again or enter a number manually." +
            (unreachable.length ? ` Unreachable: ${unreachable.join(", ")}.` : ""),
        variant: "destructive",
      });
    } finally {
      setLoadingNextNumber(false);
    }
  };

  const handleVehicleClassChange = (value: string) => {
    setForm((prev) => ({ ...prev, vehicleClass: value }));
    fetchNextNumber(value);
  };

  // Auto-suggest (and hold) a number for the default class on first load, unless
  // a number was prefilled via URL — a prefilled number is still preflighted.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefilled = params.get("vehicleNumber");
    if (prefilled) {
      void checkVehicleNumber(prefilled);
      return;
    }
    fetchNextNumber(emptyForm.vehicleClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick while a hold is live so the countdown — and the lapsed state — are real.
  const holdStatus = describeNumberHold({ hold: numberHold, currentNumber: form.vehicleNumber, nowMs });
  const holdCountingDown = holdStatus.state === "held" || holdStatus.state === "expiring";
  useEffect(() => {
    if (!holdCountingDown) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [holdCountingDown]);

  const preflight = combinePreflight(numberVerdict, vinVerdict);

  // One source of truth for "can this be submitted", so the button state, its
  // tooltip and the warning text can never disagree.
  const outcome = describeOutcome(submitResult);
  const submitBlockedReason = showConfirmDialog
    ? "Confirm or cancel the dialog above"
    : creationDisabled
      ? gateBanner.detail
      : preflight.blocked
        ? preflight.blockingReasons.join(" ")
        : preflight.checking
          ? "Waiting for the duplicate checks to finish"
          : // A number typed but not yet checked must not slip through, e.g. by
            // submitting with Enter straight from the field.
            numberVerdictStale && form.vehicleNumber.trim()
            ? "Checking vehicle number — one moment"
            : undefined;

  /**
   * A server refusal is a first-class outcome, not an exception: it is pinned to
   * the check it belongs to so the inline verdict, the submit button and the
   * toast all say the same thing, and a lost number hold is shown as lost.
   */
  const handleRefusal = (fallbackTitle: string, status: number, body: RefusalBody | null, transportError?: string) => {
    if (status === 0) {
      toast({
        title: fallbackTitle,
        description: transportError || "The request could not be sent. Check your connection and try again.",
        variant: "destructive",
      });
      return;
    }
    const refusal = describeRefusal(status, body);
    toast({ title: refusal.title || fallbackTitle, description: refusal.detail, variant: "destructive" });

    // The server's refusal outranks any advisory check still in flight.
    if (refusal.attachTo === "vin") {
      vinPreflight.invalidate();
      setVinVerdict({
        status: body?.code === "duplicate_check_unavailable" ? "warn" : "block",
        title: refusal.title,
        detail: refusal.detail,
      });
    } else if (refusal.attachTo === "vehicleNumber") {
      numberPreflight.invalidate();
      setNumberVerdict({
        status: body?.code === "number_check_unavailable" ? "warn" : "block",
        title: refusal.title,
        detail: refusal.detail,
      });
    }
    if (refusal.holdLost) setNumberHold(null);
    if (body?.code === "vehicle_create_disabled") {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vehicle-create/gate"] });
    }
  };

  const createMutation = useMutation({
    mutationFn: (payload: FormState) => postJson<SubmitResult & RefusalBody>("/api/byov/create", payload),
    onSuccess: (resp, payload) => {
      if (!resp.ok || !resp.body) {
        handleRefusal("Submission Blocked", resp.status, resp.body, resp.transportError);
        return;
      }
      const data = resp.body;
      setLastSubmittedForm(payload);
      setSubmitResult(data);

      if (data.rehearsal) {
        toast({
          title: "Rehearsal complete — nothing was created",
          description: "Every gate passed. See exactly what would have been sent below.",
        });
        return;
      }

      const outcome = describeOutcome(data);
      toast({
        title: outcome?.headline ?? "Submission complete",
        description: outcome?.detail || `${classLabel} vehicle — see per-system results below.`,
        variant: outcome?.kind === "success" ? "default" : "destructive",
      });
      // The number is spent (or released) — the hold no longer applies.
      setNumberHold(null);
      queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Submission Failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  const retryWmsMutation = useMutation({
    mutationFn: (payload: FormState) => postJson<SubmitResult & RefusalBody>("/api/byov/create-wms-only", payload),
    onSuccess: (resp) => {
      if (!resp.ok || !resp.body) {
        handleRefusal("WMS Retry Failed", resp.status, resp.body, resp.transportError);
        return;
      }
      const data = resp.body;
      const applied = applyRetryResponse(submitResult, data, "WMS retry", "wms");
      setSubmitResult(applied.submitResult);
      setRetryRehearsal(applied.retryRehearsal);
      if (data.rehearsal) {
        toast({
          title: "Rehearsal — nothing was retried",
          description: "Rehearsal mode is on, so nothing was sent to WMS or TPMS. See what would have been sent below.",
        });
      } else if (data.wms?.success) {
        toast({ title: "WMS Retry Succeeded", description: "Truck record created in WMS successfully." });
      } else {
        toast({ title: "WMS Retry Failed", description: data.wms?.error || "WMS truck creation failed.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "WMS Retry Failed", description: err.message || "An unexpected error occurred.", variant: "destructive" });
    },
  });

  const retryHolmanMutation = useMutation({
    mutationFn: (payload: FormState) => postJson<SubmitResult & RefusalBody>("/api/byov/create-holman-only", payload),
    onSuccess: (resp) => {
      if (!resp.ok || !resp.body) {
        handleRefusal("Holman Retry Failed", resp.status, resp.body, resp.transportError);
        return;
      }
      const data = resp.body;
      const applied = applyRetryResponse(submitResult, data, "Holman retry", "holman");
      setSubmitResult(applied.submitResult);
      setRetryRehearsal(applied.retryRehearsal);
      if (data.rehearsal) {
        toast({
          title: "Rehearsal — nothing was retried",
          description: "Rehearsal mode is on, so nothing was sent to Holman. See what would have been sent below.",
        });
      } else if (data.holman?.pending) {
        toast({
          title: "Holman did not confirm the retry",
          description: "The record was submitted but acceptance was not established. Verify in Holman before trying again.",
          variant: "destructive",
        });
      } else if (data.holman?.success) {
        toast({ title: "Holman Retry Succeeded", description: "Vehicle registered in Holman successfully. Fleet Management will reflect this on the next sync." });
        queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] });
      } else {
        toast({ title: "Holman Retry Failed", description: data.holman?.error || "Holman submission failed.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Holman Retry Failed", description: err.message || "An unexpected error occurred.", variant: "destructive" });
    },
  });

  const holmanOnlyMutation = useMutation({
    mutationFn: (payload: FormState) => postJson<SubmitResult & RefusalBody>("/api/byov/create-holman-only", payload),
    onSuccess: (resp, payload) => {
      if (!resp.ok || !resp.body) {
        handleRefusal("Holman Submission Blocked", resp.status, resp.body, resp.transportError);
        return;
      }
      const data = resp.body;
      setLastSubmittedForm(payload);
      // WMS/TPMS were deliberately not targeted — report them as skipped rather
      // than inventing a success for a system nothing was sent to.
      setSubmitResult({
        ...data,
        holman: data.holman,
        wms: { success: false, skipped: true, detail: "Holman-only mode — WMS was not touched." },
        tpms: { success: false, skipped: true, detail: "Holman-only mode — TPMS was not touched." },
      });
      if (data.rehearsal) {
        toast({ title: "Rehearsal complete — nothing was created", description: "Rehearsal mode is on, so nothing was sent to Holman." });
      } else if (data.holman?.pending) {
        toast({
          title: "Submitted — pending verification",
          description: "Holman accepted the request but did not confirm it. Verify before re-submitting — a retry could create a duplicate.",
          variant: "destructive",
        });
      } else if (data.holman?.success) {
        toast({ title: "Holman Registration Complete", description: "Vehicle submitted to Holman. Fleet Management will reflect this on the next sync." });
      } else {
        toast({ title: "Holman Submission Failed", description: data.holman?.error || "Holman submission failed.", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] });
    },
    onError: (err: Error) => {
      toast({ title: "Holman Submission Failed", description: err.message || "An unexpected error occurred.", variant: "destructive" });
    },
  });

  /**
   * Recovery action for a pending Holman submission: read Holman back instead of
   * re-submitting, because a retry on an unconfirmed create is how duplicates
   * get made.
   */
  const probeHolmanForNumber = async (vehicleNumber: string) => {
    setHolmanProbe({ checking: true, result: null });
    const verdict = await runNumberCheck(vehicleNumber);
    const landed = verdict.status === "block"; // "already exists" here means it landed
    setHolmanProbe({
      checking: false,
      result:
        verdict.status === "warn"
          ? `Still cannot reach Holman to verify ${vehicleNumber}. Try again shortly — do not re-submit.`
          : landed
            ? `Confirmed: vehicle ${vehicleNumber} now exists in Holman. Nothing further is needed.`
            : `Holman still has no record of ${vehicleNumber}. It may not have landed — retry Holman only, or check again in a few minutes.`,
    });
    toast({
      title: landed ? "Confirmed in Holman" : "Not confirmed yet",
      description: landed
        ? `Vehicle ${vehicleNumber} is present in Holman.`
        : `Holman has no record of ${vehicleNumber} yet.`,
      variant: landed ? "default" : "destructive",
    });
  };

  const REQUIRED_FIELDS: { key: keyof FormState; label: string }[] = [
    { key: "vehicleNumber", label: "Vehicle number" },
    { key: "vin", label: "VIN" },
    { key: "make", label: "Make" },
    { key: "model", label: "Model" },
    { key: "modelYear", label: "Model year" },
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "enterpriseId", label: "Enterprise ID" },
    { key: "deliveryAddress", label: "Delivery address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "ZIP code" },
    { key: "district", label: "District" },
    { key: "licensePlate", label: "License plate" },
    { key: "plateState", label: "Plate state" },
    { key: "assetType", label: "Asset type" },
    { key: "plateType", label: "Plate type" },
    { key: "regRenewalDate", label: "Registration renewal date" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creationDisabled) {
      toast({ title: gateBanner.title, description: gateBanner.detail, variant: "destructive" });
      return;
    }
    // The number check normally runs as the user types, but a submit can land
    // before the debounce fires — pressing Enter straight from the field. Settle
    // it here rather than letting an unchecked number reach the server.
    if (numberVerdictStale && form.vehicleNumber.trim()) {
      const verdict = await numberPreflight.run(form.vehicleNumber);
      if (verdict.status === "block") {
        toast({ title: verdict.title, description: verdict.detail, variant: "destructive" });
        return;
      }
    }
    // Any blocking verdict blocks — not just the vehicle-number one.
    if (preflight.blocked) {
      toast({
        title: "Submission blocked",
        description: preflight.blockingReasons.join(" "),
        variant: "destructive",
      });
      return;
    }
    if (preflight.checking) {
      toast({ title: "Checks still running", description: "Give the duplicate checks a moment to finish." });
      return;
    }
    const missing = REQUIRED_FIELDS.filter(({ key }) => !form[key] || String(form[key]).trim() === "");
    if (missing.length > 0) {
      toast({
        title: "Required fields missing",
        description: `Please fill in: ${missing.map((f) => f.label).join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    setShowConfirmDialog(true);
  };

  const handleConfirm = () => {
    setShowConfirmDialog(false);
    setSubmitResult(null);
    setRetryRehearsal(null);
    setHolmanProbe({ checking: false, result: null });
    if (holmanOnlyMode) {
      holmanOnlyMutation.mutate(form);
    } else {
      createMutation.mutate(form);
    }
  };

  const handleReset = () => {
    setForm(emptyForm);
    setSubmitResult(null);
    setNumberVerdict(IDLE_VERDICT);
    setVinVerdict(IDLE_VERDICT);
    setNumberHold(null);
    setHolmanProbe({ checking: false, result: null });
    setRetryRehearsal(null);
    setLastSubmittedForm(null);
    setHolmanOnlyMode(false);
    lastDecodedVinRef.current = "";
    fetchNextNumber(emptyForm.vehicleClass);
  };

  const applyExportPreset = (preset: string) => {
    setExportPreset(preset);
    const now = new Date();
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    if (preset === "all") {
      setExportFrom("");
      setExportTo("");
      return;
    }
    if (preset === "last7") {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      setExportFrom(fmt(from));
      setExportTo(fmt(now));
      return;
    }
    if (preset === "last30") {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      setExportFrom(fmt(from));
      setExportTo(fmt(now));
      return;
    }
    if (preset === "thisMonth") {
      setExportFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
      setExportTo(fmt(now));
      return;
    }
    if (preset === "lastMonth") {
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      setExportFrom(fmt(firstOfLastMonth));
      setExportTo(fmt(lastOfLastMonth));
      return;
    }
    if (preset === "thisQuarter") {
      const quarterStart = Math.floor(now.getMonth() / 3) * 3;
      setExportFrom(fmt(new Date(now.getFullYear(), quarterStart, 1)));
      setExportTo(fmt(now));
      return;
    }
  };

  const paddedVehicleNumber = form.vehicleNumber.trim().padStart(6, "0");
  // Cost center comes from the District Cost Centers cross-reference, not a formula.
  // Fall back to a 5-digit pad only if the district has no mapping yet.
  const wmsCostCenter = lookupCostCenter(form.district) ?? (form.district.trim() ? form.district.trim().padStart(5, "0") : "");

  return (
    <MainContent>
      <TopBar title="Create Vehicle" breadcrumbs={["Home", "Create Vehicle"]} />

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {holmanOnlyMode ? "Holman-Only" : classLabel} Submission</AlertDialogTitle>
            <AlertDialogDescription>
              {holmanOnlyMode
                ? "Review the details below. Only Holman will be updated — WMS and TPMS will not be touched."
                : "Review the details below before submitting to Holman and WMS. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-2 rounded-lg border bg-muted/40 divide-y text-sm">
            <ConfirmRow label="Vehicle Class" value={classLabel} />
            <ConfirmRow label="Vehicle Number" value={paddedVehicleNumber} note="zero-padded 6-digit" />
            <ConfirmRow label="VIN" value={form.vin.toUpperCase()} />
            <ConfirmRow label="Make / Model" value={`${form.modelYear} ${form.make} ${form.model}`} />
            <ConfirmRow label="Asset Type" value={form.assetType} />
            <ConfirmRow label="Tech Name" value={`${form.firstName} ${form.lastName}`} />
            <ConfirmRow label="Enterprise ID" value={form.enterpriseId} />
            <ConfirmRow label="District" value={form.district} />
            <ConfirmRow label="WMS Cost Center" value={wmsCostCenter} note="from District Cost Centers" />
            <ConfirmRow label="Delivery Date" value={form.deliveryDate} />
            <ConfirmRow label="License Plate" value={`${form.licensePlate.toUpperCase()} (${form.plateState})`} />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={createMutation.isPending}>Go Back &amp; Edit</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={createMutation.isPending || holmanOnlyMutation.isPending}>
              {(createMutation.isPending || holmanOnlyMutation.isPending)
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin inline" />Submitting…</>
                : holmanOnlyMode ? "Submit to Holman Only" : "Submit to Holman & WMS"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle>New Vehicle</CardTitle>
                  <CardDescription>
                    Creates the vehicle record in Holman, WMS, and TPMS. Pick a vehicle class to auto-assign the next number.
                  </CardDescription>
                </div>
                <CopyLinkButton variant="icon" preserveQuery preserveHash className="shrink-0" />
              </div>

              {/* Say up front whether a submission will actually be accepted. */}
              {gateBanner.kind && (
                <Alert
                  variant={gateBanner.kind === "off" ? "destructive" : "default"}
                  className={`mt-3 ${
                    gateBanner.kind === "rehearsal"
                      ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
                      : gateBanner.kind === "unreadable"
                        ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                        : ""
                  }`}
                  data-testid="banner-create-gate"
                >
                  {gateBanner.kind === "off" ? (
                    <Ban className="h-4 w-4" />
                  ) : gateBanner.kind === "rehearsal" ? (
                    <FlaskConical className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                  <AlertTitle>{gateBanner.title}</AlertTitle>
                  <AlertDescription className="text-sm">{gateBanner.detail}</AlertDescription>
                </Alert>
              )}
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-8">

                {/* Section 1: Tech / Employee Info */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Tech / Employee Info
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name <span className="text-destructive">*</span></Label>
                      <Input id="firstName" value={form.firstName} onChange={set("firstName")} placeholder="John" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name <span className="text-destructive">*</span></Label>
                      <Input id="lastName" value={form.lastName} onChange={set("lastName")} placeholder="Doe" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="enterpriseId">Enterprise ID <span className="text-destructive">*</span></Label>
                      <Input id="enterpriseId" value={form.enterpriseId} onChange={set("enterpriseId")} placeholder="ENT12345" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="(555) 123-4567" />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Section 2: Vehicle Info */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                      <Car className="h-5 w-5" />
                      Vehicle Info
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void rerunPreflight()}
                      disabled={preflight.checking}
                      data-testid="button-rerun-preflight"
                    >
                      {preflight.checking ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      )}
                      Re-run checks
                    </Button>
                  </div>

                  {/* Preflight: the same checks the server enforces, run up front. */}
                  <div
                    className={`rounded-md border p-3 space-y-2 ${
                      preflight.blocked
                        ? "border-destructive/50 bg-destructive/5"
                        : preflight.warnings.length
                          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                          : "bg-muted/40"
                    }`}
                    data-testid="panel-preflight"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Duplicate checks
                    </p>
                    <CheckVerdictRow label="Vehicle number" verdict={numberVerdict} testId="verdict-vehicle-number" />
                    <CheckVerdictRow label="VIN" verdict={vinVerdict} testId="verdict-vin" />
                    {preflight.blocked && (
                      <p className="text-xs text-destructive font-medium pt-1">
                        Submission is blocked until this is resolved.
                      </p>
                    )}
                    {!preflight.blocked && preflight.warnings.length > 0 && (
                      <p className="text-xs text-amber-800 dark:text-amber-300 pt-1">
                        You can still submit — the server re-runs these checks and will refuse if it finds a duplicate.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Vehicle Class <span className="text-destructive">*</span></Label>
                      <Select value={form.vehicleClass} onValueChange={handleVehicleClassChange}>
                        <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="byov">BYOV</SelectItem>
                          <SelectItem value="holman" disabled>Holman (coming soon)</SelectItem>
                          <SelectItem value="enterprise" disabled>Enterprise (coming soon)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Picks the recommended next number automatically
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vehicleNumber">
                        Vehicle Number <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="vehicleNumber"
                            value={form.vehicleNumber}
                            onChange={
                              canManualNumber
                                ? (e) => {
                                    setForm((prev) => ({ ...prev, vehicleNumber: e.target.value }));
                                    // This check runs on blur, so clear the old
                                    // verdict and drop any answer still in
                                    // flight for the previous number.
                                    numberPreflight.invalidate();
                                    setNumberVerdict(IDLE_VERDICT);
                                  }
                                : undefined
                            }
                            onBlur={canManualNumber ? (e) => void checkVehicleNumber(e.target.value) : undefined}
                            readOnly={!canManualNumber}
                            placeholder="e.g. 088095"
                            className={`${numberVerdict.status === "block" ? "border-destructive pr-9" : numberVerdict.status === "checking" ? "pr-9" : ""} ${!canManualNumber ? "bg-muted cursor-not-allowed" : ""}`}
                          />
                          {numberVerdict.status === "checking" && (
                            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0"
                          onClick={() => fetchNextNumber(form.vehicleClass)}
                          disabled={loadingNextNumber}
                          title="Get a fresh held number"
                        >
                          {loadingNextNumber ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </Button>
                      </div>

                      {/* The hold is a real reservation with a real clock — say so. */}
                      {holdStatus.state !== "none" && (
                        <div
                          className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                            holdStatus.state === "held"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                              : holdStatus.state === "expiring"
                                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                                : holdStatus.state === "lapsed"
                                  ? "border-destructive/50 bg-destructive/5 text-destructive"
                                  : "bg-muted/40 text-muted-foreground"
                          }`}
                          data-testid="status-number-hold"
                        >
                          {holdStatus.state === "held" ? (
                            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          ) : holdStatus.state === "expiring" ? (
                            <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          ) : (
                            <LockOpen className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          )}
                          <div className="space-y-1">
                            <p className="font-medium">
                              {holdStatus.title}
                              {holdStatus.remainingLabel ? ` — ${holdStatus.remainingLabel} left` : ""}
                            </p>
                            <p className="opacity-90">{holdStatus.detail}</p>
                            {(holdStatus.state === "lapsed" || holdStatus.state === "expiring") && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 mt-1"
                                onClick={() => fetchNextNumber(form.vehicleClass)}
                                disabled={loadingNextNumber}
                                data-testid="button-fresh-number"
                              >
                                {loadingNextNumber && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                                Get a fresh number
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground">
                        {canManualNumber
                          ? "Auto-assigned and held from the selected class — edit if needed. Zero-padded to 6 digits."
                          : "Auto-assigned and held from the selected class. Zero-padded to 6 digits."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="vin">VIN <span className="text-destructive">*</span></Label>
                      <div className="relative">
                        <Input
                          id="vin"
                          value={form.vin}
                          // The VIN gate effect is the sole publisher of this
                          // verdict, so editing does not clear it here — it is
                          // re-judged for the new value on the next render.
                          onChange={set("vin")}
                          placeholder="17-character VIN"
                          maxLength={17}
                          className={`uppercase ${decodingVin ? "pr-9" : ""} ${vinVerdict.status === "block" ? "border-destructive" : vinVerdict.status === "warn" ? "border-amber-500" : ""}`}
                        />
                        {decodingVin && (
                          <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {vinVerdict.status === "block" ? (
                        <Alert variant="destructive" className="py-2" data-testid="alert-vin-blocked">
                          <Ban className="h-4 w-4" />
                          <AlertDescription className="text-sm">
                            {vinVerdict.detail || vinVerdict.title} This VIN cannot be submitted.
                          </AlertDescription>
                        </Alert>
                      ) : vinVerdict.status === "warn" ? (
                        <Alert className="py-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
                            {vinVerdict.detail || vinVerdict.title}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Enter all 17 characters to auto-fill model year, make, model, and asset type.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Asset Type <span className="text-destructive">*</span></Label>
                      <Select value={form.assetType} onValueChange={setSelect("assetType")}>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CAR">CAR</SelectItem>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="TRUCK LD">TRUCK LD</SelectItem>
                          <SelectItem value="TRUCK MD">TRUCK MD</SelectItem>
                          <SelectItem value="TRUCK HD">TRUCK HD</SelectItem>
                          <SelectItem value="VAN">VAN</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="modelYear">Model Year <span className="text-destructive">*</span></Label>
                      <Input
                        id="modelYear"
                        type="text"
                        value={form.modelYear}
                        onChange={set("modelYear")}
                        placeholder={String(new Date().getFullYear())}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="make">Make <span className="text-destructive">*</span></Label>
                      <Input id="make" value={form.make} onChange={set("make")} placeholder="e.g. Ford" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="model">Model <span className="text-destructive">*</span></Label>
                      <Input id="model" value={form.model} onChange={set("model")} placeholder="e.g. Transit" />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="district">District <span className="text-destructive">*</span></Label>
                      <Select value={form.district} onValueChange={setSelect("district")}>
                        <SelectTrigger id="district" data-testid="select-district">
                          <SelectValue placeholder="Select a district…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {[...costCenters]
                            .sort((a, b) => a.district.localeCompare(b.district, undefined, { numeric: true }))
                            .map((item) => {
                              const natural = item.district.replace(/^0+/, "") || item.district;
                              return (
                                <SelectItem key={item.district} value={natural}>
                                  {natural} · CC {item.costCenter}
                                </SelectItem>
                              );
                            })}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Cost center is set automatically from the District Cost Centers list.</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddress">Delivery Address <span className="text-destructive">*</span></Label>
                    <Input id="deliveryAddress" value={form.deliveryAddress} onChange={set("deliveryAddress")} placeholder="Street address (line 1)" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="deliveryAddress2">Address Line 2</Label>
                      <Input id="deliveryAddress2" value={form.deliveryAddress2} onChange={set("deliveryAddress2")} placeholder="Apt, suite, unit (optional)" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deliveryAddress3">Address Line 3</Label>
                      <Input id="deliveryAddress3" value={form.deliveryAddress3} onChange={set("deliveryAddress3")} placeholder="Additional address info (optional)" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City <span className="text-destructive">*</span></Label>
                      <Input id="city" value={form.city} onChange={set("city")} placeholder="City" />
                    </div>
                    <div className="space-y-2">
                      <Label>State <span className="text-destructive">*</span></Label>
                      <Select value={form.state} onValueChange={setSelect("state")}>
                        <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip">ZIP Code <span className="text-destructive">*</span></Label>
                      <Input id="zip" value={form.zip} onChange={set("zip")} placeholder="e.g. 60601" maxLength={10} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="deliveryDate">Delivery Date</Label>
                      <Input id="deliveryDate" type="date" value={form.deliveryDate} onChange={set("deliveryDate")} />
                      <p className="text-xs text-muted-foreground">Defaults to today if left blank</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="onRoadDate">On-Road Date</Label>
                      <Input id="onRoadDate" type="date" value={form.onRoadDate} onChange={set("onRoadDate")} />
                      <p className="text-xs text-muted-foreground">Defaults to today if left blank</p>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Section 3: Registration & Licensing */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Registration &amp; Licensing
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="licensePlate">License Plate <span className="text-destructive">*</span></Label>
                      <Input id="licensePlate" value={form.licensePlate} onChange={set("licensePlate")} placeholder="ABC1234" className="uppercase" />
                    </div>
                    <div className="space-y-2">
                      <Label>Plate State <span className="text-destructive">*</span></Label>
                      <Select value={form.plateState} onValueChange={setSelect("plateState")}>
                        <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Plate Type <span className="text-destructive">*</span></Label>
                      <Select value={form.plateType} onValueChange={setSelect("plateType")}>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        <SelectContent>
                          {PLATE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="regRenewalDate">Registration Renewal Date <span className="text-destructive">*</span></Label>
                      <Input id="regRenewalDate" type="date" value={form.regRenewalDate} onChange={set("regRenewalDate")} />
                    </div>
                  </div>
                </div>

                {/* Holman-only mode toggle — for vehicles already in WMS/TPMS that need Holman registration */}
                <div className="pt-2">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary cursor-pointer"
                      checked={holmanOnlyMode}
                      onChange={(e) => setHolmanOnlyMode(e.target.checked)}
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium group-hover:text-primary transition-colors">Holman-only mode</div>
                      <div className="text-xs text-muted-foreground">
                        Vehicle already exists in WMS/TPMS — submit to Holman only. Use this to register a vehicle that was missed in Holman during the original creation.
                      </div>
                    </div>
                  </label>
                  {holmanOnlyMode && (
                    <Alert className="mt-2 border-amber-400 dark:border-amber-500">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <AlertDescription className="text-xs">
                        <strong>Holman-only mode active.</strong> WMS and TPMS will not be modified. The vehicle must already exist in both systems.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  {showConfirmDialog && (
                    <span id="confirm-dialog-hint" className="sr-only">
                      Confirm or cancel the dialog above before submitting.
                    </span>
                  )}
                  <div
                    aria-live="polite"
                    aria-atomic="true"
                    className="sr-only"
                  >
                    {(createMutation.isPending || holmanOnlyMutation.isPending) ? "Submitting vehicle, please wait…" : ""}
                  </div>
                  <span className="flex-1" title={submitBlockedReason}>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={
                        createMutation.isPending ||
                        holmanOnlyMutation.isPending ||
                        showConfirmDialog ||
                        !!submitBlockedReason
                      }
                      aria-describedby={showConfirmDialog ? "confirm-dialog-hint" : undefined}
                      data-testid="button-submit-vehicle"
                    >
                      {(createMutation.isPending || holmanOnlyMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {(createMutation.isPending || holmanOnlyMutation.isPending)
                        ? "Submitting…"
                        : creationDisabled
                          ? "Vehicle creation is off"
                          : preflight.blocked
                            ? "Blocked — resolve the checks above"
                            : rehearsalMode
                              ? holmanOnlyMode ? "Rehearse Holman registration" : "Rehearse Create Vehicle"
                              : holmanOnlyMode ? "Register in Holman" : "Create Vehicle"}
                    </Button>
                  </span>
                  <Button type="button" variant="outline" onClick={handleReset}>
                    Reset
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Results Panel */}
          {submitResult && outcome && (
            <Card data-testid="panel-submission-results">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      {outcome.kind === "success" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : outcome.kind === "pending" ? (
                        <Clock className="h-4 w-4 text-amber-600" />
                      ) : outcome.kind === "rehearsal" ? (
                        <FlaskConical className="h-4 w-4 text-sky-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      )}
                      {outcome.headline}
                    </CardTitle>
                    <CardDescription>{outcome.detail}</CardDescription>
                  </div>
                  {submitResult.requestId && (
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]" title="Quote this when asking for help">
                      {submitResult.requestId}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {outcome.rows.map((row) => (
                  <SystemResultRow key={row.system} row={row} />
                ))}

                {/* Rehearsal: show what WOULD have been sent, never imply a create. */}
                {submitResult.rehearsal && (
                  <div className="rounded-md border border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30 p-3 space-y-2 text-sm">
                    <p className="font-medium text-sky-900 dark:text-sky-200">
                      {submitResult.message || "Rehearsal mode — no external system was contacted."}
                    </p>
                    {submitResult.gates && (
                      <ul className="text-xs text-sky-900/90 dark:text-sky-200/90 space-y-0.5">
                        {Object.entries(submitResult.gates).map(([gate, verdict]) => (
                          <li key={gate}>
                            <span className="font-medium">{gate}</span>: {String(verdict)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {submitResult.wouldSend && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-sky-800 dark:text-sky-300">
                          What would have been sent
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/70 p-2 text-[11px]">
                          {JSON.stringify(submitResult.wouldSend, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* A rehearsed retry: reported on its own, never merged above. */}
                {retryRehearsal && (
                  <div
                    className="rounded-md border border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30 p-3 space-y-2 text-sm"
                    data-testid="panel-retry-rehearsal"
                  >
                    <p className="font-medium text-sky-900 dark:text-sky-200 flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" />
                      {retryRehearsal.label} was rehearsed — nothing was sent
                    </p>
                    <p className="text-xs text-sky-900/90 dark:text-sky-200/90">
                      {retryRehearsal.response.message ||
                        "Rehearsal mode is on, so the retry ran its gates and stopped. The result above is unchanged."}
                    </p>
                    {retryRehearsal.response.gates && (
                      <ul className="text-xs text-sky-900/90 dark:text-sky-200/90 space-y-0.5">
                        {Object.entries(retryRehearsal.response.gates).map(([gate, verdict]) => (
                          <li key={gate}>
                            <span className="font-medium">{gate}</span>: {String(verdict)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {retryRehearsal.response.wouldSend && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-sky-800 dark:text-sky-300">
                          What would have been sent
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-background/70 p-2 text-[11px]">
                          {JSON.stringify(retryRehearsal.response.wouldSend, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Recovery: one action per outcome, spelled out. */}
                {!submitResult.rehearsal && lastSubmittedForm && (
                  <>
                    {outcome.rows.some((r) => r.system === "Holman" && r.status === "pending") && (
                      <Alert className="border-amber-400 dark:border-amber-500">
                        <Clock className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="space-y-2">
                          <div className="flex items-center justify-between gap-4">
                            <span>
                              Holman took the submission but never confirmed it. Check whether the record landed before
                              doing anything else — re-submitting an unconfirmed create can produce a duplicate vehicle.
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              disabled={holmanProbe.checking}
                              onClick={() => void probeHolmanForNumber(lastSubmittedForm.vehicleNumber)}
                              data-testid="button-check-holman"
                            >
                              {holmanProbe.checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Check Holman now
                            </Button>
                          </div>
                          {holmanProbe.result && <p className="text-xs font-medium">{holmanProbe.result}</p>}
                        </AlertDescription>
                      </Alert>
                    )}

                    {outcome.rows.some((r) => r.system === "WMS" && r.status === "failed") && (
                      <Alert className="border-amber-400 dark:border-amber-500">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="flex items-center justify-between gap-4">
                          <span>
                            {outcome.rows.some((r) => r.system === "Holman" && r.status === "success")
                              ? "Holman succeeded but WMS failed. Retry just the WMS step — Holman will not be re-submitted."
                              : "WMS failed. Retry just the WMS step — Holman will not be re-submitted."}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={retryWmsMutation.isPending}
                            onClick={() => retryWmsMutation.mutate(lastSubmittedForm)}
                            data-testid="button-retry-wms"
                          >
                            {retryWmsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Retry WMS only
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {outcome.rows.some((r) => r.system === "Holman" && r.status === "failed") && (
                      <Alert className="border-amber-400 dark:border-amber-500">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="flex items-center justify-between gap-4">
                          <span>
                            Holman failed outright — nothing was registered there. Retry just the Holman step; WMS and
                            TPMS won't be touched.
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={retryHolmanMutation.isPending}
                            onClick={() => retryHolmanMutation.mutate(lastSubmittedForm)}
                            data-testid="button-retry-holman"
                          >
                            {retryHolmanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Retry Holman only
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Audit History Panel */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Submission History
                  </CardTitle>
                  <CardDescription>
                    {exportFrom || exportTo
                      ? `Filtered results — newest first`
                      : `Last 100 BYOV creation attempts — newest first`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Select value={exportPreset} onValueChange={applyExportPreset}>
                    <SelectTrigger className="h-8 text-xs w-36">
                      <SelectValue placeholder="Quick range…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="last7">Last 7 days</SelectItem>
                      <SelectItem value="last30">Last 30 days</SelectItem>
                      <SelectItem value="thisMonth">This month</SelectItem>
                      <SelectItem value="lastMonth">Last month</SelectItem>
                      <SelectItem value="thisQuarter">This quarter</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="exportFrom" className="text-xs text-muted-foreground whitespace-nowrap shrink-0">From</Label>
                    <Input
                      id="exportFrom"
                      type="date"
                      value={exportFrom}
                      onChange={(e) => { setExportFrom(e.target.value); setExportPreset(""); }}
                      className="h-8 text-xs w-36"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="exportTo" className="text-xs text-muted-foreground whitespace-nowrap shrink-0">To</Label>
                    <Input
                      id="exportTo"
                      type="date"
                      value={exportTo}
                      onChange={(e) => { setExportTo(e.target.value); setExportPreset(""); }}
                      className="h-8 text-xs w-36"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!(exportFrom && exportTo && exportFrom > exportTo)}
                    title={exportFrom && exportTo && exportFrom > exportTo ? "'From' date must be before 'To' date" : undefined}
                    onClick={() => {
                      const params = new URLSearchParams();
                      if (exportFrom) params.set("from", exportFrom);
                      if (exportTo) params.set("to", exportTo);
                      const qs = params.toString();
                      window.location.href = `/api/byov/audit-log/export${qs ? `?${qs}` : ""}`;
                    }}
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Export
                  </Button>
                  {canBackfill && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={backfilling}
                            onClick={async () => {
                              if (!confirm("This will create historical audit records for all BYOV vehicles that existed before the audit log was introduced (~180 vehicles). Rows will be labeled 'Pre-audit' and marked as unverified in WMS. Run once — it is idempotent. Proceed?")) return;
                              setBackfilling(true);
                              try {
                                const resp = await fetch("/api/byov/audit-log/backfill", {
                                  method: "POST",
                                  credentials: "include",
                                });
                                const data = await resp.json();
                                if (!resp.ok) {
                                  toast({ title: "Backfill failed", description: data.error || "Unknown error", variant: "destructive" });
                                } else {
                                  toast({ title: "Backfill complete", description: data.message });
                                  queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] });
                                }
                              } catch {
                                toast({ title: "Backfill failed", description: "Network error", variant: "destructive" });
                              } finally {
                                setBackfilling(false);
                              }
                            }}
                          >
                            {backfilling ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <History className="h-4 w-4 mr-1.5" />}
                            Backfill History
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Admin only: stamps pre-audit records for all ~180 BYOV vehicles that existed before the audit log was deployed.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] })}
                    disabled={auditLogQuery.isFetching}
                  >
                    {auditLogQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {auditLogQuery.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading history…
                </div>
              ) : auditLogQuery.isError ? (
                <p className="text-sm text-destructive py-4 text-center">Failed to load history.</p>
              ) : !auditLogQuery.data || auditLogQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {exportFrom || exportTo
                    ? "No submissions found in this date range."
                    : "No submissions recorded yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Vehicle #</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Vehicle</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">District</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Submitted By</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Date</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Holman</th>
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">WMS</th>
                        <th className="pb-2 font-medium whitespace-nowrap"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogQuery.data.map((row) => {
                        const isBlocked = !!row.blockedSource;
                        const isBackfill = row.blockedSource === "backfill";
                        const isFailed = row.blockedSource === "failed";
                        const isVinDuplicate = row.blockedSource === "vin_duplicate";
                        const isDuplicate = isBlocked && !isBackfill && !isFailed && !isVinDuplicate;
                        return (
                          <tr key={row.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors${isDuplicate ? " bg-amber-50/40 dark:bg-amber-950/20" : isFailed ? " bg-red-50/30 dark:bg-red-950/10" : isBackfill ? " bg-blue-50/20 dark:bg-blue-950/10" : isVinDuplicate ? " bg-orange-50/40 dark:bg-orange-950/20" : ""}`}>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleVehicleNumberClick(row.vehicleNumber)}
                                disabled={navigatingTo === row.vehicleNumber}
                                className="font-mono font-medium text-primary hover:underline inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                title="Open fleet record"
                              >
                                {navigatingTo === row.vehicleNumber
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <ExternalLink className="h-3 w-3 opacity-50" />
                                }
                                {row.vehicleNumber}
                              </button>
                            </td>
                            <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                              {[row.modelYear, row.make, row.model].filter(Boolean).join(" ") || "—"}
                            </td>
                            <td className="py-2 pr-4 whitespace-nowrap">{row.district || "—"}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">{row.submittedBy}</td>
                            <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                              {new Date(row.submittedAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            {isDuplicate ? (
                              <td className="py-2 pr-4" colSpan={2}>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                                  Blocked — duplicate ({row.blockedSource === "live" ? "live lookup" : "cache"})
                                </span>
                              </td>
                            ) : isBackfill ? (
                              <td className="py-2 pr-4" colSpan={2}>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                  <History className="h-3.5 w-3.5 shrink-0" />
                                  Pre-audit (Holman ✓ · WMS unverified)
                                </span>
                              </td>
                            ) : isFailed ? (
                              <td className="py-2 pr-4" colSpan={2}>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                                  Failed — not created in any system
                                </span>
                              </td>
                            ) : isVinDuplicate ? (
                              <td className="py-2 pr-4" colSpan={2}>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  VIN duplicate — retire in affected systems
                                </span>
                              </td>
                            ) : (
                              <>
                                <td className="py-2 pr-4">
                                  <AuditBadge success={row.holmanSuccess} error={row.holmanError} />
                                </td>
                                <td className="py-2 pr-4">
                                  <AuditBadge success={row.wmsSuccess} error={row.wmsError} />
                                </td>
                              </>
                            )}
                            <td className="py-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setSelectedAuditEntry(row)}
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Details
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* BYOV Submission Detail Dialog */}
      <Dialog open={!!selectedAuditEntry} onOpenChange={(open) => { if (!open) setSelectedAuditEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-blue-500" />
              BYOV Submission Details
            </DialogTitle>
          </DialogHeader>
          {selectedAuditEntry && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="text-muted-foreground">Vehicle #</div>
                <div className="font-medium">
                  <button
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 hover:underline focus:outline-none"
                    onClick={() => handleVehicleNumberClick(selectedAuditEntry.vehicleNumber)}
                  >
                    <ExternalLink className="h-3 w-3 opacity-50" />
                    {selectedAuditEntry.vehicleNumber}
                  </button>
                </div>

                {selectedAuditEntry.vin && (
                  <>
                    <div className="text-muted-foreground">VIN</div>
                    <div className="font-medium font-mono text-xs">{selectedAuditEntry.vin}</div>
                  </>
                )}

                {(selectedAuditEntry.make || selectedAuditEntry.model || selectedAuditEntry.modelYear) && (
                  <>
                    <div className="text-muted-foreground">Vehicle</div>
                    <div className="font-medium">
                      {[selectedAuditEntry.modelYear, selectedAuditEntry.make, selectedAuditEntry.model].filter(Boolean).join(" ") || "—"}
                    </div>
                  </>
                )}

                {selectedAuditEntry.assetType && (
                  <>
                    <div className="text-muted-foreground">Asset Type</div>
                    <div className="font-medium">{selectedAuditEntry.assetType}</div>
                  </>
                )}

                {selectedAuditEntry.district && (
                  <>
                    <div className="text-muted-foreground">District</div>
                    <div className="font-medium">{selectedAuditEntry.district}</div>
                  </>
                )}

                <div className="text-muted-foreground">Submitted By</div>
                <div className="font-medium">{selectedAuditEntry.submittedBy}</div>

                <div className="text-muted-foreground">Submitted At</div>
                <div className="font-medium">
                  {new Date(selectedAuditEntry.submittedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              {selectedAuditEntry.blockedSource ? (
                <div className="border-t pt-3">
                  {selectedAuditEntry.blockedSource === "backfill" ? (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 dark:border-blue-700 dark:bg-blue-950/30">
                      <History className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div>
                        <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">Pre-audit record (historical backfill)</div>
                        <div className="text-xs text-blue-700 dark:text-blue-400">
                          This vehicle existed before the audit log was introduced. Holman status is confirmed. Run the BYOV Drift Check to verify WMS.
                        </div>
                      </div>
                    </div>
                  ) : selectedAuditEntry.blockedSource === "failed" ? (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-700 dark:bg-red-950/30">
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                      <div>
                        <div className="text-xs font-semibold text-red-800 dark:text-red-300">Submission failed — not created in any system</div>
                        <div className="text-xs text-red-700 dark:text-red-400">
                          Both Holman and WMS returned errors. The vehicle number was released for reuse.
                        </div>
                      </div>
                    </div>
                  ) : selectedAuditEntry.blockedSource === "vin_duplicate" ? (
                    <div className="flex items-start gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 dark:border-orange-700 dark:bg-orange-950/30">
                      <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-orange-800 dark:text-orange-300">VIN duplicate — external action required</div>
                        <div className="text-xs text-orange-700 dark:text-orange-400">
                          This vehicle number shares its VIN with another. It must be retired from any downstream systems it was registered in before the VIN guard existed.
                        </div>
                        {selectedAuditEntry.holmanError && (
                          <div className="text-xs text-orange-700 dark:text-orange-400 mt-1 font-mono">{selectedAuditEntry.holmanError}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30">
                      <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <div>
                        <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Submission blocked — duplicate vehicle</div>
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          Detected via: {selectedAuditEntry.blockedSource === "live" ? "live Holman API lookup" : "local Holman cache"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : canBackfill ? (
                <div className="border-t pt-3">
                  <MarkVinDuplicateButton
                    auditId={selectedAuditEntry.id}
                    vehicleNumber={selectedAuditEntry.vehicleNumber}
                    onSuccess={() => {
                      setSelectedAuditEntry(null);
                      queryClient.invalidateQueries({ queryKey: ["/api/byov/audit-log"] });
                    }}
                  />
                </div>
              ) : null}

              <div className="border-t pt-3 space-y-2">
                <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">System Results</div>
                <div className="flex items-start gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${selectedAuditEntry.holmanSuccess ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                    {selectedAuditEntry.holmanSuccess ? "✓" : "✗"} Holman
                  </span>
                  {!selectedAuditEntry.holmanSuccess && selectedAuditEntry.holmanError && (
                    <span className="text-xs text-muted-foreground">{selectedAuditEntry.holmanError}</span>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${selectedAuditEntry.wmsSuccess ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                    {selectedAuditEntry.wmsSuccess ? "✓" : "✗"} WMS
                  </span>
                  {!selectedAuditEntry.wmsSuccess && selectedAuditEntry.wmsError && (
                    <span className="text-xs text-muted-foreground">{selectedAuditEntry.wmsError}</span>
                  )}
                </div>
                {!selectedAuditEntry.holmanSuccess && selectedAuditEntry.wmsSuccess && !selectedAuditEntry.blockedSource && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30 mt-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Holman registration incomplete</span>
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      This vehicle is in WMS/TPMS but missing from Holman and Fleet Management. To fix: go to{" "}
                      <button
                        type="button"
                        className="underline font-medium hover:text-amber-900 dark:hover:text-amber-200"
                        onClick={() => {
                          setSelectedAuditEntry(null);
                          const params = new URLSearchParams();
                          if (selectedAuditEntry.vehicleNumber) params.set("vehicleNumber", selectedAuditEntry.vehicleNumber);
                          if (selectedAuditEntry.vin) params.set("vin", selectedAuditEntry.vin);
                          if (selectedAuditEntry.make) params.set("make", selectedAuditEntry.make);
                          if (selectedAuditEntry.model) params.set("model", selectedAuditEntry.model);
                          if (selectedAuditEntry.modelYear) params.set("modelYear", selectedAuditEntry.modelYear);
                          if (selectedAuditEntry.assetType) params.set("assetType", selectedAuditEntry.assetType);
                          if (selectedAuditEntry.district) params.set("district", selectedAuditEntry.district);
                          window.location.href = `/create-vehicle-location?${params.toString()}`;
                        }}
                      >
                        Create Vehicle
                      </button>
                      , enable <strong>Holman-only mode</strong>, fill in the remaining fields, and submit.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedAuditEntry(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}

function ConfirmRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-all">
        {value}
        {note && <span className="ml-1 text-xs text-muted-foreground font-normal">({note})</span>}
      </span>
    </div>
  );
}

function AuditBadge({ success, error }: { success: boolean; error?: string | null }) {
  if (success) {
    return (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-green-700 dark:text-green-400">OK</span>
      </div>
    );
  }

  const tooltipText = error || "Registration failed";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-default">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-destructive">Failed</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-line">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function MarkVinDuplicateButton({
  auditId,
  vehicleNumber,
  onSuccess,
}: {
  auditId: number;
  vehicleNumber: string;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleClick = async () => {
    const canonical = prompt(
      `Mark ${vehicleNumber} as a VIN duplicate.\n\nStep 1 of 2 — Enter the canonical vehicle number (the real one to keep), or leave blank:`,
    );
    if (canonical === null) return; // user cancelled

    const systems = prompt(
      `Step 2 of 2 — Which systems did ${vehicleNumber} actually register in?\n\nExamples: "TPMS, WMS"  |  "Holman, WMS"  |  "TPMS only"\nLeave blank if unknown:`,
    );
    if (systems === null) return; // user cancelled

    setLoading(true);
    try {
      const resp = await fetch(`/api/byov/audit-log/${auditId}/mark-vin-duplicate`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalVehicleNumber: canonical || undefined,
          presentInSystems: systems || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Failed", description: data.error || "Could not mark row", variant: "destructive" });
      } else {
        const where = systems ? ` Remove it from: ${systems}.` : "";
        toast({ title: "Marked as VIN duplicate", description: `${vehicleNumber} is now flagged.${where}` });
        onSuccess();
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="text-xs border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400" disabled={loading} onClick={handleClick}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />}
      Mark as VIN duplicate
    </Button>
  );
}

/**
 * A system row has five honest states. "Pending" is the important one: Holman
 * answers 2xx for everything, so a submission it never confirmed is reported as
 * unverified rather than as a success.
 */
function SystemResultRow({ row }: { row: SystemRow }) {
  const chrome = {
    success: {
      icon: <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />,
      label: "Success",
      badge: "default" as const,
    },
    pending: {
      icon: <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
      label: "Pending verification",
      badge: "outline" as const,
    },
    failed: {
      icon: <XCircle className="h-5 w-5 text-destructive" />,
      label: "Failed",
      badge: "destructive" as const,
    },
    skipped: {
      icon: <MinusCircle className="h-5 w-5 text-muted-foreground" />,
      label: "Not attempted",
      badge: "secondary" as const,
    },
    rehearsal: {
      icon: <FlaskConical className="h-5 w-5 text-sky-600 dark:text-sky-400" />,
      label: "Rehearsed",
      badge: "outline" as const,
    },
  }[row.status];

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        row.status === "pending" ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : "bg-muted/30"
      }`}
      data-testid={`row-result-${row.system.toLowerCase()}`}
    >
      <div className="mt-0.5">{chrome.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{row.system}</span>
          <Badge variant={chrome.badge} className="text-xs">{chrome.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1 break-words">{row.message}</p>
      </div>
    </div>
  );
}

/** One preflight check, rendered with the verdict the server would reach. */
function CheckVerdictRow({ label, verdict, testId }: { label: string; verdict: CheckVerdict; testId: string }) {
  const icon =
    verdict.status === "checking" ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : verdict.status === "clear" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
    ) : verdict.status === "block" ? (
      <Ban className="h-4 w-4 text-destructive" />
    ) : verdict.status === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
    ) : (
      <HelpCircle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <div className="flex items-start gap-2 text-sm" data-testid={testId}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <span className="font-medium">{label}:</span>{" "}
        <span
          className={
            verdict.status === "block"
              ? "text-destructive"
              : verdict.status === "warn"
                ? "text-amber-800 dark:text-amber-300"
                : "text-muted-foreground"
          }
        >
          {verdict.title}
        </span>
        {verdict.detail && <p className="text-xs text-muted-foreground mt-0.5 break-words">{verdict.detail}</p>}
      </div>
    </div>
  );
}
