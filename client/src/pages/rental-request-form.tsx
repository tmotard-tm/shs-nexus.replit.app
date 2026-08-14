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
 *
 * TWO DOORS, ONE FORM:
 *
 *   /rental-request         open. The permanent link the field is given. No
 *                           token; identity is proven by LDAP + truck against
 *                           the roster. This is the door a technician standing
 *                           next to a dead van can actually use, because it is
 *                           the only one that does not require somebody to have
 *                           handed them a link first.
 *   /rental-request/:token  personal. Fleet or a supervisor issues it for
 *                           planned work.
 *
 * Both post the same fields and produce one record with one schema.
 */
import { useEffect, useState } from "react";
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
import { Loader2, CheckCircle, AlertCircle, Truck } from "lucide-react";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

// Three, in Tyler's order (2026-08-14), new hire first. Decommission folds
// into breakdown; scheduled maintenance is no longer offered as a category at
// all, though acknowledgement 1 still has the technician attest it is not one.
const CATEGORIES: Array<[string, string]> = [
  ["new_hire_awaiting_vehicle", "New hire, no work van assigned to me yet"],
  ["breakdown", "Breakdown: my work van will not run or drive, or has been decommissioned"],
  ["accident", "Accident or collision"],
];

// The first five are one consolidated agreement: a single checkbox attests to
// all of them, listed as bullets beneath it (Tyler, 2026-08-14). The stored
// record still carries each statement individually.
const CORE_ACKS: Array<[string, string]> = [
  ["ackNotMaintenance",
   "This is not scheduled maintenance. I understand rentals are not provided for oil changes, tires, preventive maintenance or inspections."],
  ["ackCannotDriveSafely", "My vehicle cannot be driven safely to complete my route."],
  ["ackHasAppointment", "I have a confirmed shop appointment for the date entered above."],
  ["ackReturnOneDay",
   "I will return the rental within 1 working day of my vehicle being ready, and I understand failing to do so is a cost to the business."],
  ["ackAccurate", "The information above is accurate and may be verified against shop records."],
];

// The four with a consequence attached stay individual: each one is its own
// tick, so nobody agrees to a disciplinary term inside a bundle.
const INDIVIDUAL_ACKS: Array<[string, string]> = [
  ["ackWorkingHoursOnly",
   "I understand the rental is only for use while working. Off the clock use is not allowed, "
   + "and I will not drive it outside of my working hours."],
  ["ackReturnBeforeTimeOff",
   "I understand I must turn the rental in before any time off of more than 3 days, "
   + "including vacation or a leave of absence."],
  ["ackExtensionWeekly",
   "I understand I must request a rental extension from Fleet every 7 days for as long as "
   + "I keep the rental."],
  ["ackDiscipline",
   "I understand any violation of these terms can result in disciplinary action, up to and "
   + "including termination."],
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

/**
 * Drop-off times the branch is actually open for.
 *
 * The appointment used to be a bare date input, so every reservation reached
 * ETD as T00:00:00 and asked Enterprise for a midnight pickup. A date without
 * an hour is not a booking.
 */
const DROP_TIMES: Array<[string, string]> = [
  ["07:00", "7:00 AM"], ["08:00", "8:00 AM"], ["09:00", "9:00 AM"],
  ["10:00", "10:00 AM"], ["11:00", "11:00 AM"], ["12:00", "12:00 PM"],
  ["13:00", "1:00 PM"], ["14:00", "2:00 PM"], ["15:00", "3:00 PM"],
  ["16:00", "4:00 PM"],
];

export default function RentalRequestForm() {
  const [, params] = useRoute("/rental-request/:token");
  const token = params?.token || "";
  /** No token means the open front door. */
  const openMode = !token;
  const api = openMode
    ? "/api/public/rental-request/open"
    : `/api/public/rental-request/${encodeURIComponent(token)}`;

  const [step, setStep] = useState<"verify" | "form" | "done">("verify");

  // The admin app is class-based dark mode and sets .dark on <html>, which a
  // technician opening this PUBLIC page then inherits: dark cards under this
  // form's explicit light text, unreadable. The form is light, always. This
  // also covers the Radix dropdowns, which portal to <body> outside any
  // wrapper class.
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, []);
  const [ldap, setLdap] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [resume, setResume] = useState<{
    requestNo?: number; status?: string; missingText?: string[]; note?: string | null;
  } | null>(null);
  const [result, setResult] = useState<{ decision?: string; message?: string; requestNo?: number } | null>(null);

  const [identityOk, setIdentityOk] = useState<"" | "yes" | "no">("");
  const [identityCorrection, setIdentityCorrection] = useState("");

  const [problemCategory, setProblemCategory] = useState("");
  const [symptom, setSymptom] = useState("");
  const [isDrivable, setIsDrivable] = useState("");
  const [isSafeToDrive, setIsSafeToDrive] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [isTowed, setIsTowed] = useState("");

  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [shopState, setShopState] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [nearestBranch, setNearestBranch] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("08:00");

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Maintenance used to end the form on the spot with a denial script. It does
  // not any more: Tyler decides every request, so every request is completed and
  // submitted. Kept as a category because the denial mix still needs to count it.
  const isNoVan = problemCategory === "new_hire_awaiting_vehicle";
  const coreAcks = CORE_ACKS.filter(([k]) =>
    (k !== "ackHasAppointment" || !(identity?.isByov || isNoVan))
    && (k !== "ackCannotDriveSafely" || !isNoVan));
  const coreAll = coreAcks.every(([k]) => !!acks[k]);
  const clearErr = (k: string) =>
    setFieldErrors((p) => { if (!(k in p)) return p; const n = { ...p }; delete n[k]; return n; });

  const { data: linkInfo, isLoading } = useQuery<{ valid: boolean; completed?: boolean; message?: string }>({
    queryKey: [api, "start"],
    queryFn: async () => (await fetch(openMode ? `${api}/start` : api)).json(),
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () => postJson(`${api}/verify`, { ldap }),
    onSuccess: (d: any) => {
      setVerifyError("");
      setIdentity(d.identity);
      // A send-back that makes someone retype everything is a send-back they
      // abandon, and an abandoned request becomes a phone call to Fleet, which
      // is the cost this whole process exists to remove. Give them back what
      // they already told us and ask only for the gap.
      const a = d.resume?.answers;
      if (a) {
        setProblemCategory(a.problemCategory || "");
        setSymptom(a.symptom || "");
        setIsDrivable(a.isDrivable || "");
        setIsSafeToDrive(a.isSafeToDrive || "");
        setIsTowed(a.isTowed || "");
        setShopName(a.shopName || "");
        setShopAddress(a.shopAddress || "");
        setShopCity(a.shopCity || "");
        setShopState(a.shopState || "");
        setShopPhone(a.shopPhone || "");
        setNearestBranch(a.nearestBranch || "");
        setAppointmentDate(a.appointmentDate || "");
        setAppointmentTime(a.appointmentTime || "08:00");
      }
      setResume(d.resume || null);
      setStep("form");
    },
    onError: (e: any) => setVerifyError(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson(`${api}/submit`, payload),
    onSuccess: (d: any) => { setResult(d); setStep("done"); },
    onError: (e: any) => setSubmitError(e.message),
  });

  /** ETD needs an hour, not just a day. */
  const appointmentAt = appointmentDate ? `${appointmentDate}T${appointmentTime || "08:00"}` : "";

  const validate = () => {
    const e: Record<string, string> = {};
    if (!identityOk) e.identityOk = "Please confirm your details.";
    if (identityOk === "no" && !identityCorrection.trim()) e.identityCorrection = "Tell us what is wrong.";
    if (!problemCategory) e.problemCategory = "Please choose what is going on.";
    if (!symptom.trim()) e.symptom = "Describe the problem in your own words.";
    if (!isNoVan) {
      if (!isDrivable) e.isDrivable = "Please answer.";
      if (!isSafeToDrive) e.isSafeToDrive = "Please answer.";
      if (!isTowed) e.isTowed = "Please answer.";
      if (!occurredAt) e.occurredAt = "When did the problem start?";
    }
    if (isNoVan) {
      if (!appointmentDate) e.appointmentAt = "When do you need the rental from?";
      if (!nearestBranch.trim()) e.nearestBranch = "We need the closest Enterprise branch. Google it if you are not sure.";
    }
    if (!identity?.isByov && !isNoVan) {
      if (!shopName.trim()) e.shopName = "Which shop?";
      if (!shopAddress.trim()) e.shopAddress = "We need the shop's street address.";
      if (!shopCity.trim()) e.shopCity = "Shop city?";
      if (!shopState) e.shopState = "State?";
      // Fleet dials this number to chase the repair. Ten digits or it is not
      // a phone number we can call.
      if (shopPhone.replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "").length !== 10) {
        e.shopPhone = "Enter the shop's 10-digit phone number.";
      }
      if (!appointmentDate) e.appointmentAt = "When is it going in?";
      if (!appointmentTime) e.appointmentAt = "What time are you dropping it?";
      if (!nearestBranch.trim()) e.nearestBranch = "We need the Enterprise location for your reservation. Google it if you are not sure.";
    }
    if (!coreAll || INDIVIDUAL_ACKS.some(([k]) => !acks[k])) e.acks = "Please tick every box.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = () => {
    setSubmitError("");
    if (!validate()) return;
    submitMutation.mutate({
      ldap,
      district: identity?.district, homeState: identity?.homeState,
      identityCorrected: identityOk === "no",
      identityCorrection,
      problemCategory, symptom, isDrivable, isSafeToDrive, isTowed,
      occurredAt: occurredAt || null,
      shopName, shopAddress, shopCity, shopState, shopPhone, nearestBranch,
      noVehicle: isNoVan,
      appointmentAt: appointmentAt || null,
      ...acks,
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>;
  }

  if (!linkInfo?.valid) {
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
    // One outcome, because the form decides nothing. Telling a technician
    // "approved" before a person has looked would be a commitment in Fleet's
    // name that nothing keeps.
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <CardTitle className="text-lg">Request received</CardTitle>
            </div>
            <CardDescription>
              {result?.message
                || "Fleet has your request and will review it. You will get a text as soon as it is decided."}
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
              <CardDescription>
                {openMode
                  ? "Start here if your work van is down, or you need a rental and do not have "
                    + "a van yet. Enter your LDAP to begin."
                  : "Enter your LDAP to start."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ldap">Your LDAP</Label>
                <Input id="ldap" autoCapitalize="characters" value={ldap}
                       onChange={(e) => setLdap(e.target.value)} placeholder="e.g. JSMITH1" />
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
            {resume?.missingText?.length ? (
              <Card className="border-amber-300 bg-amber-50">
                <CardHeader>
                  <div className="flex items-center gap-2 text-amber-900">
                    <AlertCircle className="h-5 w-5" />
                    <CardTitle className="text-base">We need a bit more</CardTitle>
                  </div>
                  <CardDescription className="text-amber-900">
                    Your answers are saved below. To approve a rental we still need:
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                    {resume.missingText.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                  {resume.note && (
                    <p className="rounded-md bg-white/70 p-2 text-sm text-amber-900">{resume.note}</p>
                  )}
                </CardContent>
              </Card>
            ) : null}

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
              <CardHeader>
                <CardTitle className="text-base">
                  {isNoVan ? "What is going on?" : "What is wrong with your work van?"}
                </CardTitle>
                <CardDescription>
                  {isNoVan
                    ? "Pick the closest match, then tell us your situation in your own words."
                    : "Pick the closest match, then tell us what happened in your own words."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select value={problemCategory} onValueChange={(v) => { setProblemCategory(v); clearErr("problemCategory"); }}>
                  <SelectTrigger><SelectValue placeholder="Select one" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                {fieldErrors.problemCategory && <p className="text-sm text-red-600">{fieldErrors.problemCategory}</p>}

                <>
                    {!isNoVan && (<>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Can your van still be driven?</Label>
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
                    <p className="text-xs text-slate-500">
                      These are two different questions. A van can still move and
                      not be safe to drive, and a van can be safe to sit in and
                      not move at all.
                    </p>
                    {(fieldErrors.isDrivable || fieldErrors.isSafeToDrive) &&
                      <p className="text-sm text-red-600">Please answer both.</p>}
                    <div className="space-y-2">
                      <Label>Is your van being towed?</Label>
                      <Select value={isTowed} onValueChange={(v) => { setIsTowed(v); clearErr("isTowed"); }}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldErrors.isTowed && <p className="text-sm text-red-600">{fieldErrors.isTowed}</p>}
                    </div>
                    </>)}
                    <div className="space-y-2">
                      <Label htmlFor="symptom">
                        {isNoVan ? "Tell us your situation" : "Describe the issue you are experiencing, in as much detail as possible"}
                      </Label>
                      <Textarea id="symptom" rows={3} value={symptom}
                                onChange={(e) => { setSymptom(e.target.value); clearErr("symptom"); }} />
                      {fieldErrors.symptom && <p className="text-sm text-red-600">{fieldErrors.symptom}</p>}
                    </div>
                    {!isNoVan && (
                    <div className="space-y-2">
                      <Label htmlFor="when">Problem start date</Label>
                      <Input id="when" type="date" value={occurredAt}
                             onChange={(e) => { setOccurredAt(e.target.value); clearErr("occurredAt"); }} />
                      {fieldErrors.occurredAt && <p className="text-sm text-red-600">{fieldErrors.occurredAt}</p>}
                    </div>
                    )}
                </>
              </CardContent>
            </Card>

            {/* No van yet: no shop to name, but the reservation still needs a
                start date and a location. Same columns the booking chain reads. */}
            {isNoVan && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Your rental</CardTitle>
                  <CardDescription>
                    You have no work van yet, so we just need when and where.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="need">When do you need it from?</Label>
                      <Input id="need" type="date" value={appointmentDate}
                             onChange={(e) => { setAppointmentDate(e.target.value); clearErr("appointmentAt"); }} />
                    </div>
                    <div className="space-y-2">
                      <Label>Pickup time</Label>
                      <Select value={appointmentTime}
                              onValueChange={(v) => { setAppointmentTime(v); clearErr("appointmentAt"); }}>
                        <SelectTrigger><SelectValue placeholder="Time" /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {DROP_TIMES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {fieldErrors.appointmentAt && <p className="text-sm text-red-600">{fieldErrors.appointmentAt}</p>}
                  <div className="space-y-2">
                    <Label htmlFor="branch2">Which Enterprise location do you need the reservation to be made? (no airports, if possible)</Label>
                    <Input id="branch2" value={nearestBranch}
                           placeholder="e.g. Enterprise, 2841 Airline Blvd, Portsmouth"
                           onChange={(e) => { setNearestBranch(e.target.value); clearErr("nearestBranch"); }} />
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                      <p className="font-semibold">This is where your rental will be. It has to be right.</p>
                      <p className="mt-1">
                        Your reservation is sent to this location and this is where you pick the
                        car up. If you do not know it, stop and Google{" "}
                        <span className="font-semibold">&quot;Enterprise Rent-A-Car near me&quot;</span>{" "}
                        right now, and type in the name and street of the closest branch.
                      </p>
                    </div>
                    {fieldErrors.nearestBranch && <p className="text-sm text-red-600">{fieldErrors.nearestBranch}</p>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Section C — where it is going. Not applicable to BYOV or no-van. */}
            {!identity?.isByov && !isNoVan && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Where is your work van being repaired?</CardTitle>
                  <CardDescription>
                    Your rental starts on the day your van goes into the shop, not today,
                    so we need the shop and the appointment before we can book anything.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="sname">Name of the repair shop</Label>
                        <Input id="sname" value={shopName}
                               onChange={(e) => { setShopName(e.target.value); clearErr("shopName"); }} />
                        {fieldErrors.shopName && <p className="text-sm text-red-600">{fieldErrors.shopName}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="saddr">Street address of the shop</Label>
                        <Input id="saddr" value={shopAddress} placeholder="Street and number"
                               onChange={(e) => { setShopAddress(e.target.value); clearErr("shopAddress"); }} />
                        {fieldErrors.shopAddress && <p className="text-sm text-red-600">{fieldErrors.shopAddress}</p>}
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
                          <Select value={shopState} onValueChange={(v) => { setShopState(v); clearErr("shopState"); }}>
                            <SelectTrigger><SelectValue placeholder="ST" /></SelectTrigger>
                            <SelectContent className="max-h-64">
                              {STATES.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {fieldErrors.shopState && <p className="text-sm text-red-600">{fieldErrors.shopState}</p>}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sphone">Phone number for the shop</Label>
                        <Input id="sphone" inputMode="tel" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} />
                        <p className="text-xs text-slate-500">
                          Fleet calls the shop to check on your van, so this one needs to be right.
                        </p>
                        {fieldErrors.shopPhone && <p className="text-sm text-red-600">{fieldErrors.shopPhone}</p>}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="appt">Date your van goes into the shop</Label>
                          <Input id="appt" type="date" value={appointmentDate}
                                 onChange={(e) => { setAppointmentDate(e.target.value); clearErr("appointmentAt"); }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Drop-off time</Label>
                          <Select value={appointmentTime}
                                  onValueChange={(v) => { setAppointmentTime(v); clearErr("appointmentAt"); }}>
                            <SelectTrigger><SelectValue placeholder="Time" /></SelectTrigger>
                            <SelectContent className="max-h-64">
                              {DROP_TIMES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        Your rental starts at this time, so it needs to be when you actually
                        drop the van off.
                      </p>
                      {fieldErrors.appointmentAt && <p className="text-sm text-red-600">{fieldErrors.appointmentAt}</p>}
                      <div className="space-y-2">
                        <Label htmlFor="branch">Which Enterprise location do you need the reservation to be made? (no airports, if possible)</Label>
                        <Input id="branch" value={nearestBranch}
                               placeholder="e.g. Enterprise, 2841 Airline Blvd, Portsmouth"
                               onChange={(e) => { setNearestBranch(e.target.value); clearErr("nearestBranch"); }} />
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                          <p className="font-semibold">This is where your rental will be. It has to be right.</p>
                          <p className="mt-1">
                            Your reservation is sent to this location and this is where you pick the
                            car up. If you do not know it, stop and Google{" "}
                            <span className="font-semibold">
                              &quot;Enterprise Rent-A-Car near {shopCity.trim() || "the shop"}&quot;
                            </span>{" "}
                            right now, and type in the name and street of the closest branch.
                          </p>
                        </div>
                        {fieldErrors.nearestBranch && <p className="text-sm text-red-600">{fieldErrors.nearestBranch}</p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Section D — acknowledgements */}
            {(
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Before you submit</CardTitle>
                  <CardDescription>
                    The first box covers the request statements. The four terms of use
                    are agreed to one by one. All are recorded with your request.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-start gap-3 text-sm font-medium text-slate-800">
                    <Checkbox checked={coreAll}
                              onCheckedChange={(v) => {
                                const on = v === true;
                                setAcks((p) => {
                                  const nx = { ...p };
                                  for (const [k] of coreAcks) nx[k] = on;
                                  return nx;
                                });
                                clearErr("acks");
                              }} />
                    <span>I acknowledge and agree to all of the following:</span>
                  </label>
                  <ul className="ml-10 list-disc space-y-1.5 text-sm text-slate-600">
                    {coreAcks.map(([k, text]) => <li key={k}>{text}</li>)}
                  </ul>
                  <div className="space-y-3 border-t border-slate-200 pt-4">
                    {INDIVIDUAL_ACKS.map(([k, text]) => (
                      <label key={k} className="flex items-start gap-3 text-sm text-slate-700">
                        <Checkbox checked={!!acks[k]}
                                  onCheckedChange={(v) => { setAcks((p) => ({ ...p, [k]: v === true })); clearErr("acks"); }} />
                        <span>{text}</span>
                      </label>
                    ))}
                  </div>
                  {fieldErrors.acks && <p className="text-sm text-red-600">{fieldErrors.acks}</p>}
                </CardContent>
              </Card>
            )}

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            {(
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
