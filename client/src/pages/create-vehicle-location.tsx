import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Car, User, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getPrefillParams, commonValidators } from "@/lib/prefill-params";

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
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        toast({ title: "Submission Blocked", description: data.error, variant: "destructive" });
        return;
      }
      setSubmitResult(data as SubmitResult);
      const bothOk = data.holman?.success && data.wms?.success;
      toast({
        title: bothOk ? "Vehicle Created" : "Partial Success",
        description: bothOk
          ? "BYOV vehicle submitted to Holman and WMS successfully."
          : "One or more systems had an error — see results below.",
        variant: bothOk ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Submission Failed",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
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
    setSubmitResult(null);
    createMutation.mutate(form);
  };

  const handleReset = () => {
    setForm(emptyForm);
    setSubmitResult(null);
    setVehicleExistsWarning(null);
  };

  return (
    <MainContent>
      <TopBar title="Create BYOV Vehicle" breadcrumbs={["Home", "Create BYOV Vehicle"]} />

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
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={createMutation.isPending || !!vehicleExistsWarning}
                  >
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {createMutation.isPending ? "Submitting…" : "Create BYOV Vehicle"}
                  </Button>
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
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </MainContent>
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
