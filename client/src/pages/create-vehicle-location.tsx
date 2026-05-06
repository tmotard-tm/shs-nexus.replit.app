import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Car, User, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2, History, Download, Eye, ClipboardCheck } from "lucide-react";
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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

const PLATE_TYPES = ["Standard", "Commercial", "Government", "Personalized", "Dealer", "Other"];

interface FormState {
  vehicleNumber: string;
  vin: string;
  assetType: string;
  modelYear: string;
  make: string;
  model: string;
  district: string;
  deliveryAddress: string;
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

interface SubmitResult {
  holman: { success: boolean; error?: string };
  wms: { success: boolean; error?: string };
  holmanOnly?: boolean;
}

const today = new Date().toISOString().split("T")[0];

const emptyForm: FormState = {
  vehicleNumber: "",
  vin: "",
  assetType: "",
  modelYear: String(new Date().getFullYear()),
  make: "",
  model: "",
  district: "",
  deliveryAddress: "",
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
  const [form, setForm] = useState<FormState>(emptyForm);
  const [vehicleExistsWarning, setVehicleExistsWarning] = useState<string | null>(null);
  const [checkingVehicle, setCheckingVehicle] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [lastSubmittedForm, setLastSubmittedForm] = useState<FormState | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportPreset, setExportPreset] = useState("");
  const [selectedAuditEntry, setSelectedAuditEntry] = useState<ByovCreationAuditEntry | null>(null);

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

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const setSelect = (field: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    const allowedKeys = [
      "vehicleNumber","vin","assetType","modelYear","make","model",
      "district","deliveryAddress","city","state","zip",
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
      if (prefill.district) processed.district = prefill.district;
      if (prefill.deliveryAddress) processed.deliveryAddress = prefill.deliveryAddress;
      if (prefill.city) processed.city = prefill.city;
      if (prefill.plateType) processed.plateType = prefill.plateType;
      if (prefill.enterpriseId) processed.enterpriseId = prefill.enterpriseId;
      setForm((prev) => ({ ...prev, ...processed }));
    }
  }, []);

  const checkVehicleExists = async (vehicleNumber: string) => {
    const trimmed = vehicleNumber.trim();
    if (!trimmed) { setVehicleExistsWarning(null); return; }
    setCheckingVehicle(true);
    try {
      const resp = await fetch(`/api/holman/vehicles/exists/${encodeURIComponent(trimmed)}`, {
        credentials: "include",
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.exists) {
          setVehicleExistsWarning(
            `Vehicle ${trimmed} already exists in Holman (canonical: ${data.canonical}). Please use a different number.`
          );
        } else {
          setVehicleExistsWarning(null);
        }
      } else {
        setVehicleExistsWarning(null);
      }
    } catch {
      setVehicleExistsWarning(null);
    } finally {
      setCheckingVehicle(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const resp = await apiRequest("POST", "/api/byov/create", payload);
      return (await resp.json()) as SubmitResult & { error?: string };
    },
    onSuccess: (data, payload) => {
      if ("error" in data && data.error) {
        toast({ title: "Submission Blocked", description: data.error, variant: "destructive" });
        return;
      }
      setLastSubmittedForm(payload);
      setSubmitResult(data as SubmitResult);
      const bothOk = data.holman?.success && data.wms?.success;
      toast({
        title: bothOk ? "Vehicle Created" : "Partial Success",
        description: bothOk
          ? "BYOV vehicle submitted to Holman and WMS successfully."
          : "One or more systems had an error — see results below.",
        variant: bothOk ? "default" : "destructive",
      });
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
    mutationFn: async (payload: FormState) => {
      const resp = await apiRequest("POST", "/api/byov/create-wms-only", payload);
      return (await resp.json()) as { wms: { success: boolean; error?: string }; error?: string };
    },
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        toast({ title: "WMS Retry Failed", description: data.error, variant: "destructive" });
        return;
      }
      setSubmitResult((prev) =>
        prev ? { ...prev, wms: data.wms, holmanOnly: !data.wms.success } : prev
      );
      if (data.wms.success) {
        toast({ title: "WMS Retry Succeeded", description: "Truck record created in WMS successfully." });
      } else {
        toast({ title: "WMS Retry Failed", description: data.wms.error || "WMS truck creation failed.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "WMS Retry Failed", description: err.message || "An unexpected error occurred.", variant: "destructive" });
    },
  });

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (vehicleExistsWarning) {
      toast({ title: "Duplicate Vehicle", description: vehicleExistsWarning, variant: "destructive" });
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
    createMutation.mutate(form);
  };

  const handleReset = () => {
    setForm(emptyForm);
    setSubmitResult(null);
    setVehicleExistsWarning(null);
    setLastSubmittedForm(null);
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
  const paddedCostCenter = form.district.trim().padStart(5, "0");

  return (
    <MainContent>
      <TopBar title="Create BYOV Vehicle" breadcrumbs={["Home", "Create BYOV Vehicle"]} />

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm BYOV Submission</AlertDialogTitle>
            <AlertDialogDescription>
              Review the details below before submitting to Holman and WMS. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-2 rounded-lg border bg-muted/40 divide-y text-sm">
            <ConfirmRow label="Vehicle Number" value={paddedVehicleNumber} note="zero-padded 6-digit" />
            <ConfirmRow label="VIN" value={form.vin.toUpperCase()} />
            <ConfirmRow label="Make / Model" value={`${form.modelYear} ${form.make} ${form.model}`} />
            <ConfirmRow label="Asset Type" value={form.assetType} />
            <ConfirmRow label="Tech Name" value={`${form.firstName} ${form.lastName}`} />
            <ConfirmRow label="Enterprise ID" value={form.enterpriseId} />
            <ConfirmRow label="District" value={form.district} />
            <ConfirmRow label="WMS Cost Center" value={paddedCostCenter} note="5-digit" />
            <ConfirmRow label="Delivery Date" value={form.deliveryDate} />
            <ConfirmRow label="License Plate" value={`${form.licensePlate.toUpperCase()} (${form.plateState})`} />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={createMutation.isPending}>Go Back &amp; Edit</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={createMutation.isPending}>
              {createMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin inline" />Submitting…</>
                : "Submit to Holman & WMS"}
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
                  <CardTitle>New BYOV Vehicle</CardTitle>
                  <CardDescription>
                    Creates the vehicle record in both Holman and WMS. Vehicle type is fixed to BYOV.
                  </CardDescription>
                </div>
                <CopyLinkButton variant="icon" preserveQuery preserveHash className="shrink-0" />
              </div>
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
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Vehicle Info
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vehicleNumber">
                        Vehicle Number <span className="text-destructive">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="vehicleNumber"
                          value={form.vehicleNumber}
                          onChange={(e) => {
                            setForm((prev) => ({ ...prev, vehicleNumber: e.target.value }));
                            setVehicleExistsWarning(null);
                          }}
                          onBlur={(e) => checkVehicleExists(e.target.value)}
                          placeholder="e.g. 88095"
                          className={vehicleExistsWarning ? "border-destructive pr-9" : checkingVehicle ? "pr-9" : ""}
                        />
                        {checkingVehicle && (
                          <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {vehicleExistsWarning && (
                        <Alert variant="destructive" className="py-2">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription className="text-sm">{vehicleExistsWarning}</AlertDescription>
                        </Alert>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Will be zero-padded to 6 digits (e.g. 88095 → 088095)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="vin">VIN <span className="text-destructive">*</span></Label>
                      <Input id="vin" value={form.vin} onChange={set("vin")} placeholder="17-character VIN" maxLength={17} className="uppercase" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Asset Type <span className="text-destructive">*</span></Label>
                      <Select value={form.assetType} onValueChange={setSelect("assetType")}>
                        <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="Truck">Truck</SelectItem>
                          <SelectItem value="Van">Van</SelectItem>
                          <SelectItem value="Sedan">Sedan</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="modelYear">Model Year <span className="text-destructive">*</span></Label>
                      <Input
                        id="modelYear"
                        type="number"
                        value={form.modelYear}
                        onChange={set("modelYear")}
                        min="1990"
                        max={new Date().getFullYear() + 2}
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
                      <Input id="district" value={form.district} onChange={set("district")} placeholder="e.g. 8206" />
                      <p className="text-xs text-muted-foreground">Used as prefix and WMS cost center</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deliveryAddress">Delivery Address <span className="text-destructive">*</span></Label>
                    <Input id="deliveryAddress" value={form.deliveryAddress} onChange={set("deliveryAddress")} placeholder="Street address" />
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
                    {createMutation.isPending ? "Submitting vehicle, please wait…" : ""}
                  </div>
                  <span
                    className="flex-1"
                    title={
                      showConfirmDialog
                        ? "Confirm or cancel the dialog above"
                        : vehicleExistsWarning
                        ? "Resolve the vehicle conflict above before submitting"
                        : undefined
                    }
                  >
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createMutation.isPending || showConfirmDialog || !!vehicleExistsWarning}
                      aria-describedby={showConfirmDialog ? "confirm-dialog-hint" : undefined}
                    >
                      {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {createMutation.isPending ? "Submitting…" : "Create BYOV Vehicle"}
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
          {submitResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Submission Results</CardTitle>
                <CardDescription>Per-system status for the most recent submission</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <SystemResultRow system="Holman" result={submitResult.holman} />
                <SystemResultRow system="WMS" result={submitResult.wms} />
                {submitResult.holmanOnly && lastSubmittedForm && (
                  <Alert className="border-amber-400 dark:border-amber-500">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <AlertDescription className="flex items-center justify-between gap-4">
                      <span>
                        Holman succeeded but WMS failed. You can retry just the WMS step without re-submitting to Holman.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={retryWmsMutation.isPending}
                        onClick={() => retryWmsMutation.mutate(lastSubmittedForm)}
                      >
                        {retryWmsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Retry WMS only
                      </Button>
                    </AlertDescription>
                  </Alert>
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
                <p className="text-sm text-muted-foreground py-4 text-center">No submissions recorded yet.</p>
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
                        const bothOk = row.holmanSuccess && row.wmsSuccess;
                        const noneOk = !row.holmanSuccess && !row.wmsSuccess;
                        return (
                          <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="py-2 pr-4 font-mono font-medium whitespace-nowrap">{row.vehicleNumber}</td>
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
                            <td className="py-2 pr-4">
                              <AuditBadge success={row.holmanSuccess} error={row.holmanError} />
                            </td>
                            <td className="py-2 pr-4">
                              <AuditBadge success={row.wmsSuccess} error={row.wmsError} />
                            </td>
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
                <div className="font-medium">{selectedAuditEntry.vehicleNumber}</div>

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
  return (
    <div className="flex items-center gap-1.5">
      {success
        ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
      <span className={success ? "text-green-700 dark:text-green-400" : "text-destructive"}>
        {success ? "OK" : "Failed"}
      </span>
      {!success && error && (
        <span className="text-muted-foreground truncate max-w-[200px]" title={error}>{error}</span>
      )}
    </div>
  );
}

function SystemResultRow({ system, result }: { system: string; result: { success: boolean; error?: string } }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
      <div className="mt-0.5">
        {result.success
          ? <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          : <XCircle className="h-5 w-5 text-destructive" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{system}</span>
          <Badge variant={result.success ? "default" : "destructive"} className="text-xs">
            {result.success ? "Success" : "Failed"}
          </Badge>
        </div>
        {!result.success && result.error && (
          <p className="text-sm text-muted-foreground mt-1 break-words">{result.error}</p>
        )}
        {result.success && (
          <p className="text-sm text-muted-foreground mt-1">Vehicle record created successfully.</p>
        )}
      </div>
    </div>
  );
}
