/**
 * Rental technician survey — PUBLIC, tokenised, no login.
 *
 * Step 1 verifies identity (LDAP + truck number) so a response is trustworthy
 * enough to book a rental reservation against. Step 2 is the questionnaire.
 *
 * Two deliberate design rules, both from Tyler:
 *   * No "not sure" option anywhere. A technician is responsible for their van.
 *     Genuinely not knowing is an escalation, which is its own button, not a
 *     shrug hidden inside a dropdown.
 *   * The first question is the gate. Everything else is conditional on it, so a
 *     technician who is out of a rental answers two questions and is done.
 */
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle, Truck, AlertTriangle } from "lucide-react";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "Something went wrong. Please try again.");
  return data;
}

export default function RentalTechSurvey() {
  const [, params] = useRoute("/rental-survey/:token");
  const token = params?.token || "";

  const [step, setStep] = useState<"verify" | "form" | "done">("verify");
  const [ldap, setLdap] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [escalated, setEscalated] = useState(false);

  const [hasRental, setHasRental] = useState<"" | "yes" | "no">("");
  const [noRentalReason, setNoRentalReason] = useState("");
  const [rentalCompany, setRentalCompany] = useState("");
  const [rentalBranchName, setRentalBranchName] = useState("");
  const [rentalBranchCity, setRentalBranchCity] = useState("");
  const [rentalBranchState, setRentalBranchState] = useState("");
  const [rentalBranchPhone, setRentalBranchPhone] = useState("");
  const [rentalVehicleDesc, setRentalVehicleDesc] = useState("");
  const [rentalTruckNumber, setRentalTruckNumber] = useState("");
  const [assignedTruckNumber, setAssignedTruckNumber] = useState("");
  const [vanStatus, setVanStatus] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [shopState, setShopState] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [promisedReadyDate, setPromisedReadyDate] = useState("");
  const [decommDetail, setDecommDetail] = useState("");
  const [techhubStillUsing, setTechhubStillUsing] = useState("");
  const [blocker, setBlocker] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearErr = (k: string) =>
    setFieldErrors((prev) => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });

  const { data: linkInfo, isLoading } = useQuery<{
    valid: boolean; completed?: boolean; techName?: string; message?: string;
  }>({
    queryKey: ["/api/public/rental-survey", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/rental-survey/${encodeURIComponent(token)}`);
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      postJson(`/api/public/rental-survey/${encodeURIComponent(token)}/verify`, { ldap, truckNumber }),
    onSuccess: (data: any) => {
      setVerifyError("");
      const pre = data?.prefill || {};
      setRentalTruckNumber(pre.rentalTruckNumber || truckNumber || "");
      setAssignedTruckNumber(pre.assignedTruckNumber || "");
      setShopName(pre.shopName || "");
      setShopPhone(pre.shopPhone || "");
      setRentalCompany(pre.rentalCompany || "");
      setStep("form");
    },
    onError: (e: any) => setVerifyError(e.message),
  });

  const buildPayload = (override?: Record<string, unknown>) => ({
    ldap,
    truckNumber,
    hasRental,
    noRentalReason,
    rentalCompany,
    rentalBranchName,
    rentalBranchCity,
    rentalBranchState,
    rentalBranchPhone,
    rentalVehicleDesc,
    rentalTruckNumber,
    assignedTruckNumber,
    vanStatus,
    shopName,
    shopCity,
    shopState,
    shopPhone,
    promisedReadyDate,
    decommDetail,
    techhubStillUsing,
    blocker,
    ...override,
  });

  const submitMutation = useMutation({
    mutationFn: (override?: Record<string, unknown>) =>
      postJson(`/api/public/rental-survey/${encodeURIComponent(token)}/submit`, buildPayload(override)),
    onSuccess: (data: any) => {
      setEscalated(!!data?.escalated);
      setStep("done");
    },
    onError: (e: any) => setSubmitError(e.message),
  });

  // Mirrors the server rules exactly. Kept in sync by hand; the server is the
  // authority and will reject anything that slips past this.
  const validate = () => {
    const e: Record<string, string> = {};
    if (!hasRental) e.hasRental = "Please answer this.";
    if (hasRental === "no" && !noRentalReason) e.noRentalReason = "Please tell us what happened to it.";
    if (hasRental === "yes") {
      if (!rentalCompany) e.rentalCompany = "Please pick the rental company.";
      // Branch city/state and the assigned truck number are NOT gated. We
      // already hold the branch from the rental feed (RENTING_BRANCH maps to
      // the ETD branch code, verified 14/14), and a technician whose van was
      // totalled or turned in may have no current truck number to give. Making
      // them mandatory only converts "I don't know" into an abandoned form.
      if (!vanStatus) e.vanStatus = "Please tell us what is happening with your van.";
      if (vanStatus === "in_shop") {
        if (!shopName.trim()) e.shopName = "Please enter the shop name.";
        if (!shopCity.trim()) e.shopCity = "Please enter the shop city.";
      }
    }
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = () => {
    setSubmitError("");
    if (!validate()) return;
    submitMutation.mutate(undefined);
  };

  /** The honest-answer path. Records the escalation instead of forcing a guess. */
  const onEscalate = () => {
    setSubmitError("");
    if (!hasRental) {
      setFieldErrors({ hasRental: "Please answer the first question, then use this button." });
      return;
    }
    submitMutation.mutate({ vanStatus: "unknown_escalate", hasRental: hasRental || "yes" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!token || !linkInfo?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <CardTitle className="text-lg">Link not valid</CardTitle>
            </div>
            <CardDescription>
              {linkInfo?.message || "This link is invalid or has expired. Reply to the text you received and we will send a new one."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (step === "done" || linkInfo?.completed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <CardTitle className="text-lg">Got it. Thank you.</CardTitle>
            </div>
            <CardDescription>
              {escalated
                ? "We have flagged your van as unaccounted for. Someone from Fleet will contact you directly to track it down."
                : "Your answers are recorded. If anything needs to change we will reach out."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-center gap-2 pt-2 text-slate-700">
          <Truck className="h-5 w-5" />
          <span className="font-semibold">Sears Home Services Fleet</span>
        </div>

        {step === "verify" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Confirm it&apos;s you</CardTitle>
              <CardDescription>
                Enter your LDAP so we know these answers are yours. It is the same ID you
                use every day to log into Tech Hub to order parts. If you are not sure what
                it is, open Tech Hub and look under Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ldap">Your LDAP</Label>
                <Input
                  id="ldap"
                  autoCapitalize="characters"
                  value={ldap}
                  onChange={(e) => setLdap(e.target.value)}
                  placeholder="e.g. JSMITH1"
                />
              </div>
              {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
              <Button
                className="w-full"
                onClick={() => verifyMutation.mutate()}
                disabled={verifyMutation.isPending}
              >
                {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "form" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Are you currently in a rental?</CardTitle>
                <CardDescription>This is the only question everyone has to answer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={hasRental === "yes" ? "default" : "outline"}
                    onClick={() => { setHasRental("yes"); clearErr("hasRental"); }}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant={hasRental === "no" ? "default" : "outline"}
                    onClick={() => { setHasRental("no"); clearErr("hasRental"); }}
                  >
                    No
                  </Button>
                </div>
                {fieldErrors.hasRental && <p className="text-sm text-red-600">{fieldErrors.hasRental}</p>}
              </CardContent>
            </Card>

            {hasRental === "no" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">What happened to it?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select value={noRentalReason} onValueChange={(v) => { setNoRentalReason(v); clearErr("noRentalReason"); }}>
                    <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="returned_it">I returned it</SelectItem>
                      <SelectItem value="never_had_one">I never had one</SelectItem>
                      <SelectItem value="back_in_my_van">I&apos;m back in my own van</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldErrors.noRentalReason && <p className="text-sm text-red-600">{fieldErrors.noRentalReason}</p>}

                  {/* Asked on this path too. Out of a rental with a working van
                      is fine; out of a rental with the van still in a shop means
                      the technician has nothing to drive, and Fleet needs to
                      know that today rather than next week. */}
                  <div className="space-y-2">
                    <Label>Where is your van right now?</Label>
                    <Select value={vanStatus} onValueChange={setVanStatus}>
                      <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="with_me">I have it and it runs</SelectItem>
                        <SelectItem value="in_shop">Still in a repair shop</SelectItem>
                        <SelectItem value="decommissioned">Turned in / decommissioned</SelectItem>
                        <SelectItem value="totaled">Totaled in an accident</SelectItem>
                        <SelectItem value="new_hire_no_van">I&apos;m a new hire &mdash; no van assigned to me yet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="blocker-no">Anything else we should know?</Label>
                    <Textarea id="blocker-no" value={blocker} onChange={(e) => setBlocker(e.target.value)} rows={2} />
                  </div>
                </CardContent>
              </Card>
            )}

            {hasRental === "yes" && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Your rental</CardTitle>
                    <CardDescription>
                      We need the branch so we can set your rental up correctly going forward.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Rental company</Label>
                      <Select value={rentalCompany} onValueChange={(v) => { setRentalCompany(v); clearErr("rentalCompany"); }}>
                        <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Enterprise">Enterprise</SelectItem>
                          <SelectItem value="Avis">Avis</SelectItem>
                          <SelectItem value="Hertz">Hertz</SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldErrors.rentalCompany && <p className="text-sm text-red-600">{fieldErrors.rentalCompany}</p>}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="bcity">Branch city</Label>
                        <Input id="bcity" value={rentalBranchCity}
                          onChange={(e) => { setRentalBranchCity(e.target.value); clearErr("rentalBranchCity"); }} />
                        {fieldErrors.rentalBranchCity && <p className="text-sm text-red-600">{fieldErrors.rentalBranchCity}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>State</Label>
                        <Select value={rentalBranchState} onValueChange={(v) => { setRentalBranchState(v); clearErr("rentalBranchState"); }}>
                          <SelectTrigger><SelectValue placeholder="ST" /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {fieldErrors.rentalBranchState && <p className="text-sm text-red-600">{fieldErrors.rentalBranchState}</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bname">Branch name or street (if you know it)</Label>
                      <Input id="bname" value={rentalBranchName} onChange={(e) => setRentalBranchName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bphone">Branch phone (if you know it)</Label>
                      <Input id="bphone" inputMode="tel" value={rentalBranchPhone} onChange={(e) => setRentalBranchPhone(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="veh">What are you driving?</Label>
                      <Input id="veh" placeholder="e.g. white Ford Escape" value={rentalVehicleDesc}
                        onChange={(e) => setRentalVehicleDesc(e.target.value)} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Truck numbers</CardTitle>
                    <CardDescription>
                      These are often different, which is exactly what we are trying to find.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="rtruck">Truck number the rental was set up under</Label>
                      <Input id="rtruck" inputMode="numeric" value={rentalTruckNumber}
                        onChange={(e) => setRentalTruckNumber(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="atruck">Truck number assigned to you right now</Label>
                      <Input id="atruck" inputMode="numeric" value={assignedTruckNumber}
                        onChange={(e) => { setAssignedTruckNumber(e.target.value); clearErr("assignedTruckNumber"); }} />
                      {fieldErrors.assignedTruckNumber && <p className="text-sm text-red-600">{fieldErrors.assignedTruckNumber}</p>}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Where is your van?</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Select value={vanStatus} onValueChange={(v) => { setVanStatus(v); clearErr("vanStatus"); }}>
                      <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_shop">In a repair shop</SelectItem>
                        <SelectItem value="decommissioned">Turned in / decommissioned</SelectItem>
                        <SelectItem value="totaled">Totaled in an accident</SelectItem>
                        <SelectItem value="new_hire_no_van">I&apos;m a new hire &mdash; no van assigned to me yet</SelectItem>
                        <SelectItem value="with_me">I still have it</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldErrors.vanStatus && <p className="text-sm text-red-600">{fieldErrors.vanStatus}</p>}

                    {vanStatus === "in_shop" && (
                      <div className="space-y-4 rounded-md border border-slate-200 p-3">
                        <div className="space-y-2">
                          <Label htmlFor="shop">Shop name</Label>
                          <Input id="shop" value={shopName}
                            onChange={(e) => { setShopName(e.target.value); clearErr("shopName"); }} />
                          {fieldErrors.shopName && <p className="text-sm text-red-600">{fieldErrors.shopName}</p>}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2 space-y-2">
                            <Label htmlFor="scity">Shop city</Label>
                            <Input id="scity" value={shopCity}
                              onChange={(e) => { setShopCity(e.target.value); clearErr("shopCity"); }} />
                            {fieldErrors.shopCity && <p className="text-sm text-red-600">{fieldErrors.shopCity}</p>}
                          </div>
                          <div className="space-y-2">
                            <Label>State</Label>
                            <Select value={shopState} onValueChange={setShopState}>
                              <SelectTrigger><SelectValue placeholder="ST" /></SelectTrigger>
                              <SelectContent className="max-h-64">
                                {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sphone">Shop phone</Label>
                          <Input id="sphone" inputMode="tel" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ready">Date they promised it back</Label>
                          <Input id="ready" type="date" value={promisedReadyDate} onChange={(e) => setPromisedReadyDate(e.target.value)} />
                        </div>
                      </div>
                    )}

                    {vanStatus === "decommissioned" && (
                      <div className="space-y-4 rounded-md border border-slate-200 p-3">
                        <p className="text-sm text-slate-600">
                          If you have not been given a new truck number, leave the assigned truck number
                          above as your old one and answer this:
                        </p>
                        <div className="space-y-2">
                          <Label>Are you still using that truck number in TechHub for parts and inventory?</Label>
                          <Select value={techhubStillUsing} onValueChange={setTechhubStillUsing}>
                            <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes, still using it</SelectItem>
                              <SelectItem value="no">No, I have no working truck number</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="dd">Where did it go?</Label>
                          <Input id="dd" value={decommDetail} onChange={(e) => setDecommDetail(e.target.value)} />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="blocker">Anything blocking you?</Label>
                      <Textarea id="blocker" value={blocker} onChange={(e) => setBlocker(e.target.value)} rows={2} />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <Button className="w-full" onClick={onSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
            </Button>

            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-sm text-amber-900">
                    Genuinely don&apos;t know where your van is? Say so here instead of guessing.
                    Someone will call you to track it down.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-400 bg-white"
                  onClick={onEscalate}
                  disabled={submitMutation.isPending}
                >
                  I don&apos;t know where my van is
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
