/**
 * Rental Request — technician-facing form. PUBLIC, tokenised, no login.
 *
 * Spec: Fleet/ETD/REQUEST_FORM.md. This is the front door that replaces the
 * technician's call to Holman.
 *
 * Two rules shape the whole thing:
 *
 *   1. Never ask for something we already know. Section A is CONFIRMED, not
 *      typed. A correction raises a data-quality flag instead of silently
 *      overwriting the roster.
 *   2. The default answer is NO, and the technician should find that out as
 *      early as possible. Choosing scheduled maintenance ends the form on the
 *      spot rather than letting someone fill in four sections before being told
 *      no.
 */
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle, Truck, XCircle, Clock } from "lucide-react";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const CATEGORIES: Array<[string, string]> = [
  ["breakdown", "Breakdown"],
  ["accident", "Accident"],
  ["awaiting_parts", "Awaiting parts"],
  ["new_hire_awaiting_vehicle", "New hire, no vehicle yet"],
  ["decom_replacement", "Decommission replacement"],
  ["scheduled_maintenance", "Scheduled maintenance (oil, tires, PM, inspection, recall)"],
];

const ACKS: Array<[string, string]> = [
  ["ackNotMaintenance",
   "This is not scheduled maintenance. I understand rentals are not provided for oil changes, tires, preventive maintenance, inspections or recalls."],
  ["ackCannotDriveSafely", "My vehicle cannot be driven safely to complete my route."],
  ["ackHasAppointment", "I have a confirmed shop appointment for the date entered above."],
  ["ackLastResort", "I understand a rental is approved only when the work cannot be resolved another way."],
  ["ackReturnOneDay",
   "I will return the rental within one business day of my vehicle being ready, and I understand failing to do so is a cost to the business."],
  ["ackAccurate", "The information above is accurate and may be verified against shop records."],
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

type Identity = {
  ldap: string; techName: string; truckNumber: string;
  district: string; homeState: string; mobilePhone: string; isByov: boolean;
};

export default function RentalRequestForm() {
  const [, params] = useRoute("/rental-request/:token");
  const token = params?.token || "";

  const [step, setStep] = useState<"verify" | "form" | "done">("verify");
  const [ldap, setLdap] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [result, setResult] = useState<{ decision?: string; message?: string; requestNo?: number } | null>(null);

  const [identityOk, setIdentityOk] = useState<"" | "yes" | "no">("");
  const [identityCorrection, setIdentityCorrection] = useState("");

  const [problemCategory, setProblemCategory] = useState("");
  const [symptom, setSymptom] = useState("");
  const [isDrivable, setIsDrivable] = useState("");
  const [isSafeToDrive, setIsSafeToDrive] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [jobsAffected, setJobsAffected] = useState("");
  const [whatWasTried, setWhatWasTried] = useState("");

  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [shopState, setShopState] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [hasAppointment, setHasAppointment] = useState("");
  const [appointmentAt, setAppointmentAt] = useState("");
  const [shopEstimatedDays, setShopEstimatedDays] = useState("");

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isMaintenance = problemCategory === "scheduled_maintenance";
  const clearErr = (k: string) =>
    setFieldErrors((p) => { if (!(k in p)) return p; const n = { ...p }; delete n[k]; return n; });

  const { data: linkInfo, isLoading } = useQuery<{ valid: boolean; completed?: boolean; message?: string }>({
    queryKey: ["/api/public/rental-request", token],
    queryFn: async () => (await fetch(`/api/public/rental-request/${encodeURIComponent(token)}`)).json(),
    enabled: !!token,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () => postJson(`/api/public/rental-request/${encodeURIComponent(token)}/verify`, { ldap, truckNumber }),
    onSuccess: (d: any) => { setVerifyError(""); setIdentity(d.identity); setStep("form"); },
    onError: (e: any) => setVerifyError(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      postJson(`/api/public/rental-request/${encodeURIComponent(token)}/submit`, payload),
    onSuccess: (d: any) => { setResult(d); setStep("done"); },
    onError: (e: any) => setSubmitError(e.message),
  });

  /** Maintenance short-circuits: submit it so the denial is on record, then stop. */
  const submitMaintenance = () => {
    submitMutation.mutate({
      ldap, truckNumber, problemCategory: "scheduled_maintenance",
      symptom, isDrivable, isSafeToDrive,
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!identityOk) e.identityOk = "Please confirm your details.";
    if (identityOk === "no" && !identityCorrection.trim()) e.identityCorrection = "Tell us what is wrong.";
    if (!problemCategory) e.problemCategory = "Please choose what is going on.";
    if (!symptom.trim()) e.symptom = "Describe the problem in your own words.";
    if (!isDrivable) e.isDrivable = "Please answer.";
    if (!isSafeToDrive) e.isSafeToDrive = "Please answer.";
    if (!identity?.isByov) {
      if (!hasAppointment) e.hasAppointment = "Please answer.";
      if (hasAppointment === "yes") {
        if (!shopName.trim()) e.shopName = "Which shop?";
        if (!shopCity.trim()) e.shopCity = "Shop city?";
        if (!appointmentAt) e.appointmentAt = "When is it going in?";
        if (!shopEstimatedDays.trim()) e.shopEstimatedDays = "How many days did the SHOP say?";
      }
    }
    for (const [k] of ACKS) if (!acks[k]) e.acks = "Please tick every box.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = () => {
    setSubmitError("");
    if (!validate()) return;
    submitMutation.mutate({
      ldap, truckNumber,
      district: identity?.district, homeState: identity?.homeState,
      mobilePhone: identity?.mobilePhone,
      identityCorrected: identityOk === "no",
      identityCorrection,
      problemCategory, symptom, isDrivable, isSafeToDrive,
      occurredAt: occurredAt || null, jobsAffected, whatWasTried,
      shopName, shopAddress, shopCity, shopState, shopPhone,
      hasAppointment, appointmentAt: appointmentAt || null, shopEstimatedDays,
      ...acks,
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>;
  }

  if (!token || !linkInfo?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md"><CardHeader>
          <div className="flex items-center gap-2 text-red-600"><AlertCircle className="h-5 w-5" />
            <CardTitle className="text-lg">Link not valid</CardTitle></div>
          <CardDescription>{linkInfo?.message || "This link is invalid or has expired."}</CardDescription>
        </CardHeader></Card>
      </div>
    );
  }

  if (step === "done" || linkInfo?.completed) {
    const d = result?.decision;
    const good = d === "APPROVE";
    const wait = d === "DEFER" || d === "REVIEW";
    const Icon = good ? CheckCircle : wait ? Clock : XCircle;
    const tone = good ? "text-green-600" : wait ? "text-amber-600" : "text-red-600";
    const title = good ? "Approved" : d === "DEFER" ? "Not yet" : d === "REVIEW" ? "Sent to Fleet" : "Not approved";
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className={`flex items-center gap-2 ${tone}`}><Icon className="h-5 w-5" />
              <CardTitle className="text-lg">{title}</CardTitle></div>
            <CardDescription>
              {result?.message
                || (good
                  ? "Your rental is approved. Fleet will send the reservation details shortly."
                  : "Your request is recorded. Fleet will follow up.")}
            </CardDescription>
          </CardHeader>
          {result?.requestNo && (
            <CardContent><p className="text-sm text-slate-500">Request #{result.requestNo}</p></CardContent>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="flex items-center gap-2 pt-2 text-slate-700">
          <Truck className="h-5 w-5" /><span className="font-semibold">Sears Home Services Fleet</span>
        </div>

        {step === "verify" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Rental request</CardTitle>
              <CardDescription>Enter your LDAP and truck number to start.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ldap">Your LDAP</Label>
                <Input id="ldap" autoCapitalize="characters" value={ldap}
                       onChange={(e) => setLdap(e.target.value)} placeholder="e.g. JSMITH1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="truck">Your truck number</Label>
                <Input id="truck" inputMode="numeric" value={truckNumber}
                       onChange={(e) => setTruckNumber(e.target.value)} placeholder="e.g. 61843" />
              </div>
              {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
              <Button className="w-full" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
                {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start"}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "form" && (
          <>
            {/* Section A — confirm, do not type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Is this still right?</CardTitle>
                <CardDescription>From our records. Tell us if anything is wrong.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="text-sm">
                  {([["Name", identity?.techName], ["LDAP", identity?.ldap],
                     ["Truck", identity?.truckNumber], ["District", identity?.district],
                     ["State", identity?.homeState], ["Mobile", identity?.mobilePhone]] as Array<[string, string | undefined]>)
                    .filter(([, v]) => (v ?? "").toString().trim() !== "")
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between border-b border-slate-100 py-1.5">
                        <dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-800">{v}</dd>
                      </div>
                    ))}
                </dl>
                {identity?.isByov && (
                  <p className="rounded-md bg-blue-50 p-2 text-sm text-blue-900">
                    Our records show you are on the BYOV programme, so this request will be
                    reviewed by a person rather than approved automatically.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant={identityOk === "yes" ? "default" : "outline"}
                          onClick={() => { setIdentityOk("yes"); clearErr("identityOk"); }}>Correct</Button>
                  <Button type="button" variant={identityOk === "no" ? "default" : "outline"}
                          onClick={() => { setIdentityOk("no"); clearErr("identityOk"); }}>Something&apos;s wrong</Button>
                </div>
                {fieldErrors.identityOk && <p className="text-sm text-red-600">{fieldErrors.identityOk}</p>}
                {identityOk === "no" && (
                  <div className="space-y-2">
                    <Label htmlFor="corr">What is wrong?</Label>
                    <Textarea id="corr" rows={2} value={identityCorrection}
                              onChange={(e) => { setIdentityCorrection(e.target.value); clearErr("identityCorrection"); }} />
                    {fieldErrors.identityCorrection && <p className="text-sm text-red-600">{fieldErrors.identityCorrection}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section B — the problem */}
            <Card>
              <CardHeader><CardTitle className="text-base">What is going on?</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Select value={problemCategory} onValueChange={(v) => { setProblemCategory(v); clearErr("problemCategory"); }}>
                  <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                {fieldErrors.problemCategory && <p className="text-sm text-red-600">{fieldErrors.problemCategory}</p>}

                {isMaintenance ? (
                  <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-900">
                      Rentals are not provided for oil changes, tires, preventive maintenance,
                      inspections or recalls. Schedule this as a wait through routing.
                    </p>
                    <p className="text-xs text-red-800">
                      We will still log it so Fleet can see the volume.
                    </p>
                    <Button variant="outline" className="w-full border-red-300 bg-white"
                            onClick={submitMaintenance} disabled={submitMutation.isPending}>
                      {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log it and close"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="symptom">In your own words, what is it doing?</Label>
                      <Textarea id="symptom" rows={3} value={symptom}
                                onChange={(e) => { setSymptom(e.target.value); clearErr("symptom"); }} />
                      {fieldErrors.symptom && <p className="text-sm text-red-600">{fieldErrors.symptom}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Can it be driven?</Label>
                        <Select value={isDrivable} onValueChange={(v) => { setIsDrivable(v); clearErr("isDrivable"); }}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Is it safe to drive?</Label>
                        <Select value={isSafeToDrive} onValueChange={(v) => { setIsSafeToDrive(v); clearErr("isSafeToDrive"); }}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {(fieldErrors.isDrivable || fieldErrors.isSafeToDrive) &&
                      <p className="text-sm text-red-600">Please answer both.</p>}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="when">When did it start?</Label>
                        <Input id="when" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="jobs">Calls at risk</Label>
                        <Input id="jobs" inputMode="numeric" value={jobsAffected}
                               onChange={(e) => setJobsAffected(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tried">What have you already tried?</Label>
                      <Textarea id="tried" rows={2} value={whatWasTried}
                                onChange={(e) => setWhatWasTried(e.target.value)} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Section C — where it is going. Not applicable to BYOV. */}
            {!isMaintenance && !identity?.isByov && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Where is it going?</CardTitle>
                  <CardDescription>
                    A rental starts when the van goes in, so we need the appointment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Do you have a confirmed shop appointment?</Label>
                    <Select value={hasAppointment} onValueChange={(v) => { setHasAppointment(v); clearErr("hasAppointment"); }}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">Not yet</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldErrors.hasAppointment && <p className="text-sm text-red-600">{fieldErrors.hasAppointment}</p>}
                  </div>

                  {hasAppointment === "no" && (
                    <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                      Book the appointment first. We will hold this request until you have a date.
                    </p>
                  )}

                  {hasAppointment === "yes" && (
                    <div className="space-y-4 rounded-md border border-slate-200 p-3">
                      <div className="space-y-2">
                        <Label htmlFor="sname">Shop name</Label>
                        <Input id="sname" value={shopName}
                               onChange={(e) => { setShopName(e.target.value); clearErr("shopName"); }} />
                        {fieldErrors.shopName && <p className="text-sm text-red-600">{fieldErrors.shopName}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="saddr">Shop address</Label>
                        <Input id="saddr" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="scity">City</Label>
                          <Input id="scity" value={shopCity}
                                 onChange={(e) => { setShopCity(e.target.value); clearErr("shopCity"); }} />
                          {fieldErrors.shopCity && <p className="text-sm text-red-600">{fieldErrors.shopCity}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label>State</Label>
                          <Select value={shopState} onValueChange={setShopState}>
                            <SelectTrigger><SelectValue placeholder="ST" /></SelectTrigger>
                            <SelectContent className="max-h-64">
                              {STATES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sphone">Shop phone</Label>
                        <Input id="sphone" inputMode="tel" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="appt">Date it goes in</Label>
                        <Input id="appt" type="date" value={appointmentAt}
                               onChange={(e) => { setAppointmentAt(e.target.value); clearErr("appointmentAt"); }} />
                        {fieldErrors.appointmentAt && <p className="text-sm text-red-600">{fieldErrors.appointmentAt}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="days">How many days did the SHOP say it needs?</Label>
                        <Input id="days" inputMode="numeric" value={shopEstimatedDays}
                               onChange={(e) => { setShopEstimatedDays(e.target.value); clearErr("shopEstimatedDays"); }} />
                        <p className="text-xs text-slate-500">
                          The shop&apos;s estimate, not yours. This sets your return date.
                        </p>
                        {fieldErrors.shopEstimatedDays && <p className="text-sm text-red-600">{fieldErrors.shopEstimatedDays}</p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Section D — acknowledgements */}
            {!isMaintenance && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Before you submit</CardTitle>
                  <CardDescription>Tick each one. These are recorded with your request.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ACKS.map(([k, text]) => (
                    <label key={k} className="flex items-start gap-3 text-sm text-slate-700">
                      <Checkbox checked={!!acks[k]}
                                onCheckedChange={(v) => { setAcks((p) => ({ ...p, [k]: v === true })); clearErr("acks"); }} />
                      <span>{text}</span>
                    </label>
                  ))}
                  {fieldErrors.acks && <p className="text-sm text-red-600">{fieldErrors.acks}</p>}
                </CardContent>
              </Card>
            )}

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            {!isMaintenance && (
              <Button className="w-full" onClick={onSubmit} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit request"}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
