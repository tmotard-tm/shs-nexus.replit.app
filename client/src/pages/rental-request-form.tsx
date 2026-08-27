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
 *   2. The default answer is NO — but a person says it, not the form. Choosing
 *      scheduled maintenance used to end the form on the spot; since 2026-08-16
 *      it submits like anything else, so Fleet SEES it and denies it with the
 *      standard response (maintenance is scheduled and waited on) instead of
 *      the attempt vanishing into a closed door and becoming a phone call.
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
import { useEffect, useRef, useState } from "react";
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

// In Tyler's order (2026-08-14), new hire first; decommission folds into
// breakdown. Scheduled maintenance came BACK on 2026-08-16 — not because it
// ever qualifies (it does not), but because a category the form refuses to
// offer becomes a phone call to Fleet. It submits like anything else and
// Fleet denies it with the standard wait-through-routing response.
const CATEGORIES: Array<[string, string]> = [
  ["new_hire_awaiting_vehicle", "New hire"],
  ["breakdown", "Breakdown: my work van will not run or drive, or has been decommissioned"],
  ["accident", "Accident or collision"],
  ["scheduled_maintenance", "Scheduled maintenance: oil change, tires, preventive maintenance or inspection"],
];

// The first five are one consolidated agreement: a single checkbox attests to
// all of them, listed as bullets beneath it (Tyler, 2026-08-14). The stored
// record still carries each statement individually.
const CORE_ACKS: Array<[string, string]> = [
  ["ackNotMaintenance",
   "This is not scheduled maintenance. I understand rentals are not provided for oil changes, tires, preventive maintenance or inspections."],
  ["ackCannotDriveSafely", "My vehicle cannot be driven safely to complete my route."],
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

/** Sears blue. The lockup is set type, deliberately: no official logo file
 * exists in this repo, and a hand-traced trademark would look less official
 * than a clean wordmark in the brand colour. Swap in the real asset when
 * marketing supplies one. */
function BrandHeader() {
  return (
    <div className="bg-gradient-to-r from-[#003A70] via-[#00529B] to-[#0A66B7] shadow-md">
      <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/25">
          <Truck className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-extrabold tracking-tight text-white">SEARS</span>
            <span className="text-[11px] font-semibold tracking-[0.18em] text-blue-100">HOME SERVICES</span>
          </div>
          <div className="text-xs text-blue-200">Fleet Operations · Rental Vehicle Request</div>
        </div>
      </div>
    </div>
  );
}

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
  const [correctedName, setCorrectedName] = useState("");
  const [correctedLdap, setCorrectedLdap] = useState("");
  const [correctedTruck, setCorrectedTruck] = useState("");
  const [correctedDistrict, setCorrectedDistrict] = useState("");
  const [correctedState, setCorrectedState] = useState("");
  const [correctedPhone, setCorrectedPhone] = useState("");
  const [identityCorrection, setIdentityCorrection] = useState("");
  const correctionSectionRef = useRef<HTMLDivElement>(null);
  const requestTypeSectionRef = useRef<HTMLDivElement>(null);

  // New rental vs extension of the current one. Defaulted from what the
  // system detects (an open rental-ops case => extension), but the technician
  // decides: the feed can lag, so a contradiction warns and asks for a line
  // of explanation rather than blocking.
  const [requestType, setRequestType] = useState<"" | "new" | "extension">("");
  const [detection, setDetection] = useState<{
    openRentals: number;
    currentRental: any | null;
    allowed: { new: boolean; extension: boolean };
    blocking: { new: any | null; extension: any | null };
  } | null>(null);
  const [typeMismatchExplanation, setTypeMismatchExplanation] = useState("");

  // The extension path's van status update.
  const [extRepairStatus, setExtRepairStatus] = useState("");
  const [extLastShopContact, setExtLastShopContact] = useState("");
  const [extShopSaid, setExtShopSaid] = useState("");
  const [extExpectedCompletion, setExtExpectedCompletion] = useState("");
  const [extTimeNeeded, setExtTimeNeeded] = useState("");

  const [problemCategory, setProblemCategory] = useState("");
  const [symptom, setSymptom] = useState("");
  const [isTowed, setIsTowed] = useState("");
  const [areYouOkay, setAreYouOkay] = useState("");
  const [isOver21, setIsOver21] = useState<"" | "yes" | "no">("");

  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [shopState, setShopState] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [nearestBranch, setNearestBranch] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");

  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Maintenance used to end the form on the spot with a denial script. It does
  // not any more: Tyler decides every request, so every request is completed and
  // submitted. Kept as a category because the denial mix still needs to count it.
  const isNoVan = problemCategory === "new_hire_awaiting_vehicle";
  // A maintenance submission cannot be bought with false attestations:
  // "this is not scheduled maintenance" and "my vehicle cannot be driven
  // safely" are both untrue when the category IS maintenance and the van is
  // fine. The server skips requiring them on this path; the form hides them.
  const isMaint = problemCategory === "scheduled_maintenance";
  const coreAcks = CORE_ACKS.filter(([k]) =>
    (k !== "ackHasAppointment" || !(identity?.isByov || isNoVan))
    && (k !== "ackCannotDriveSafely" || !(isNoVan || isMaint))
    && (k !== "ackNotMaintenance" || !isMaint));
  const coreAll = coreAcks.every(([k]) => !!acks[k]);
  const clearErr = (k: string) =>
    setFieldErrors((p) => { if (!(k in p)) return p; const n = { ...p }; delete n[k]; return n; });

  // A choice that contradicts detection. Soft: the rental-ops feed can lag,
  // so the technician proceeds with an explanation and Fleet sees the flag.
  const typeMismatch = !!detection && requestType !== "" &&
    (requestType === "extension" ? detection.openRentals === 0 : detection.openRentals > 0);
  // The extension re-signs the FULL set: all four core statements and all
  // four terms, every time — no category-based trimming.
  const extCoreAll = CORE_ACKS.every(([k]) => !!acks[k]);

  const { data: linkInfo, isLoading } = useQuery<{ valid: boolean; completed?: boolean; message?: string }>({
    queryKey: [api, "start"],
    queryFn: async () => (await fetch(openMode ? `${api}/start` : api)).json(),
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () => postJson(`${api}/verify`, { ldap }),
    onSuccess: (d: any) => {
      setVerifyError("");
      const verifiedIdentity = d.identity as Identity;
      setIdentity(verifiedIdentity);
      setCorrectedName(verifiedIdentity.techName || "");
      setCorrectedLdap(verifiedIdentity.ldap || "");
      setCorrectedTruck(verifiedIdentity.truckNumber || "");
      setCorrectedDistrict(verifiedIdentity.district || "");
      setCorrectedState(verifiedIdentity.homeState || "");
      setCorrectedPhone(verifiedIdentity.mobilePhone || "");
      // Detection drives the DEFAULT choice only. A tech with an open rental
      // case defaults to Extension; without one, to New. A resumed send-back
      // is a new-rental continuation, so it defaults to New regardless.
      const det = {
        openRentals: Number(d.openRentals ?? 0),
        currentRental: d.currentRental ?? null,
        allowed: { new: d.allowed?.new !== false, extension: d.allowed?.extension !== false },
        blocking: { new: d.blocking?.new ?? null, extension: d.blocking?.extension ?? null },
      };
      setDetection(det);
      let def: "new" | "extension" = d.resume ? "new" : det.openRentals > 0 ? "extension" : "new";
      if (def === "new" && !det.allowed.new && det.allowed.extension) def = "extension";
      if (def === "extension" && !det.allowed.extension && det.allowed.new) def = "new";
      setRequestType(def);
      // A send-back that makes someone retype everything is a send-back they
      // abandon, and an abandoned request becomes a phone call to Fleet, which
      // is the cost this whole process exists to remove. Give them back what
      // they already told us and ask only for the gap.
      const a = d.resume?.answers;
      if (a) {
        setProblemCategory(a.problemCategory || "");
        setSymptom(a.symptom || "");
        setIsTowed(a.isTowed || "");
        setAreYouOkay(a.areYouOkay || "");
        setIsOver21(a.isOver21 || "");
        setShopName(a.shopName || "");
        setShopAddress(a.shopAddress || "");
        setShopCity(a.shopCity || "");
        setShopState(a.shopState || "");
        setShopPhone(a.shopPhone || "");
        setNearestBranch(a.nearestBranch || "");
        setAppointmentDate(a.appointmentDate || "");
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
  const appointmentAt = appointmentDate ? `${appointmentDate}T08:00` : "";

  const reportedIdentityCorrection = () => {
    const changed = (before: string | undefined, after: string) =>
      String(before || "").trim() !== after.trim();
    const parts: string[] = [];
    if (changed(identity?.techName, correctedName)) {
      parts.push(`name: ${identity?.techName || "none"} -> ${correctedName.trim() || "none"}`);
    }
    if (changed(identity?.ldap, correctedLdap)) {
      parts.push(`LDAP: ${identity?.ldap || "none"} -> ${correctedLdap.trim() || "none"}`);
    }
    if (changed(identity?.district, correctedDistrict)) {
      parts.push(`district: ${identity?.district || "none"} -> ${correctedDistrict.trim() || "none"}`);
    }
    if (changed(identity?.homeState, correctedState)) {
      parts.push(`state: ${identity?.homeState || "none"} -> ${correctedState.trim() || "none"}`);
    }
    if (identityCorrection.trim()) parts.push(identityCorrection.trim());
    return parts.join("; ");
  };

  const focusSection = (ref: { current: HTMLDivElement | null }) => {
    requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!identityOk) e.identityOk = "Please confirm your details.";
    if (typeMismatch && !typeMismatchExplanation.trim()) {
      e.typeMismatchExplanation = "Tell us briefly why our records look wrong.";
    }
    if (!isOver21) {
      e.isOver21 = "Please answer.";
    } else if (isOver21 === "no") {
      e.isOver21 = "Enterprise cannot rent to drivers under 21. Contact Holman (ARI).";
    }
    if (identityOk === "no") {
      const digits = correctedPhone.replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
      if (correctedPhone.trim() && digits.length !== 10) e.correctedPhone = "Enter a 10-digit mobile number.";
      const tChanged = correctedTruck.trim() !== String(identity?.truckNumber || "").trim();
      const pChanged = digits !== String(identity?.mobilePhone || "").replace(/[^0-9]/g, "");
      if (!tChanged && !pChanged && !reportedIdentityCorrection()) {
        e.identityCorrection = "Update a detail below, or tell us what is wrong.";
      }
    }
    if (!problemCategory) e.problemCategory = "Please choose what is going on.";
    if (!isNoVan && !symptom.trim()) e.symptom = "Describe the problem in your own words.";
    if (!isNoVan) {
      if (problemCategory === "accident" && !areYouOkay) e.areYouOkay = "Please answer.";
      if (!isTowed) e.isTowed = "Please answer.";
    }
    if (isNoVan) {
      if (!appointmentDate) e.appointmentAt = "When is your first day on the road?";
      if (!nearestBranch.trim()) e.nearestBranch = "We need the closest Enterprise branch. Google it if you are not sure.";
    }
    if (identity?.isByov && !isNoVan && !nearestBranch.trim()) {
      e.nearestBranch = "We need the Enterprise pickup location for your reservation. Google it if you are not sure.";
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
      if (!nearestBranch.trim()) e.nearestBranch = "We need the Enterprise location for your reservation. Google it if you are not sure.";
    }
    if (!coreAll || INDIVIDUAL_ACKS.some(([k]) => !acks[k])) e.acks = "Please tick every box.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = () => {
    setSubmitError("");
    // Belt and braces. The button is not rendered at all when the answer is no,
    // so reaching here would mean the state changed underneath us.
    if (isOver21 === "no") return;
    if (!validate()) return;
    submitMutation.mutate({
      ldap,
      requestType: "new",
      typeMismatchExplanation: typeMismatch ? typeMismatchExplanation.trim() : null,
      district: identity?.district, homeState: identity?.homeState,
      identityCorrected: identityOk === "no",
      identityCorrection: reportedIdentityCorrection(),
      correctedTruck, correctedPhone,
      problemCategory, symptom, isTowed, areYouOkay,
      isOver21,
      shopName, shopAddress, shopCity, shopState, shopPhone, nearestBranch,
      noVehicle: isNoVan,
      appointmentAt: appointmentAt || null,
      // Only the acknowledgements the form actually showed. A stale true left
      // over from before a category switch would land in the audit trail as a
      // statement the technician never made.
      ...Object.fromEntries(Object.entries(acks).filter(([k]) =>
        coreAcks.some(([c]) => c === k) || INDIVIDUAL_ACKS.some(([c]) => c === k))),
    });
  };

  const validateExtension = () => {
    const e: Record<string, string> = {};
    if (!identityOk) e.identityOk = "Please confirm your details.";
    if (identityOk === "no") {
      const digits = correctedPhone.replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
      if (correctedPhone.trim() && digits.length !== 10) e.correctedPhone = "Enter a 10-digit mobile number.";
      const tChanged = correctedTruck.trim() !== String(identity?.truckNumber || "").trim();
      const pChanged = digits !== String(identity?.mobilePhone || "").replace(/[^0-9]/g, "");
      if (!tChanged && !pChanged && !reportedIdentityCorrection()) {
        e.identityCorrection = "Update a detail below, or tell us what is wrong.";
      }
    }
    if (typeMismatch && !typeMismatchExplanation.trim()) {
      e.typeMismatchExplanation = "Tell us briefly why our records look wrong.";
    }
    if (!extRepairStatus.trim()) e.extRepairStatus = "Tell us where the repair stands.";
    if (!extLastShopContact) e.extLastShopContact = "When did you last speak with the shop?";
    if (!extShopSaid.trim()) e.extShopSaid = "What did the shop tell you?";
    if (!extTimeNeeded.trim()) e.extTimeNeeded = "Roughly how much longer do you need the rental?";
    if (!extCoreAll || INDIVIDUAL_ACKS.some(([k]) => !acks[k])) e.acks = "Please tick every box.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmitExtension = () => {
    setSubmitError("");
    if (!validateExtension()) return;
    submitMutation.mutate({
      ldap,
      requestType: "extension",
      typeMismatchExplanation: typeMismatch ? typeMismatchExplanation.trim() : null,
      district: identity?.district, homeState: identity?.homeState,
      identityCorrected: identityOk === "no",
      identityCorrection: reportedIdentityCorrection(),
      correctedTruck, correctedPhone,
      extRepairStatus, extLastShopContact, extShopSaid,
      extExpectedCompletion: extExpectedCompletion || null,
      extTimeNeeded,
      // Every extension re-signs the FULL set, every time.
      ...Object.fromEntries([...CORE_ACKS, ...INDIVIDUAL_ACKS].map(([k]) => [k, !!acks[k]])),
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#EAF1F8]">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>;
  }

  if (!linkInfo?.valid) {
    return (
      <div className="min-h-screen bg-[#EAF1F8]">
        <BrandHeader />
        <div className="mx-auto w-full max-w-md p-4 pt-8">
        <Card className="w-full rounded-xl border-[#D8E2EE] shadow-sm"><CardHeader>
          <div className="flex items-center gap-2 text-red-600"><AlertCircle className="h-5 w-5" />
            <CardTitle className="text-lg">Link not valid</CardTitle></div>
          <CardDescription>{linkInfo?.message || "This link is invalid or has expired."}</CardDescription>
        </CardHeader></Card>
        </div>
      </div>
    );
  }

  if (step === "done" || linkInfo?.completed) {
    // One outcome, because the form decides nothing. Telling a technician
    // "approved" before a person has looked would be a commitment in Fleet's
    // name that nothing keeps.
    return (
      <div className="min-h-screen bg-[#EAF1F8]">
        <BrandHeader />
        <div className="mx-auto w-full max-w-md p-4 pt-8">
        <Card className="w-full rounded-xl border-[#D8E2EE] shadow-sm">
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
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#EAF1F8] pb-8">
      <BrandHeader />
      <div className="mx-auto w-full max-w-md space-y-4 p-4">

        {step === "verify" && (
          <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
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
              <Button className="w-full bg-[#00529B] hover:bg-[#003A70]" onClick={() => verifyMutation.mutate()} disabled={verifyMutation.isPending}>
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
            <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">1</span>Is this still right?</CardTitle>
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
                <div className="grid grid-cols-2 items-end gap-3">
                  <Button type="button" variant={identityOk === "yes" ? "default" : "outline"}
                          className={identityOk === "yes" ? "bg-[#00529B] hover:bg-[#003A70]" : ""}
                          onClick={() => {
                            setIdentityOk("yes");
                            setCorrectedName(identity?.techName || "");
                            setCorrectedLdap(identity?.ldap || "");
                            setCorrectedTruck(identity?.truckNumber || "");
                            setCorrectedDistrict(identity?.district || "");
                            setCorrectedState(identity?.homeState || "");
                            setCorrectedPhone(identity?.mobilePhone || "");
                            setIdentityCorrection("");
                            clearErr("identityOk");
                            clearErr("identityCorrection");
                            focusSection(requestTypeSectionRef);
                          }}>Correct</Button>
                  <Button type="button" variant={identityOk === "no" ? "default" : "outline"}
                          className={identityOk === "no" ? "bg-[#00529B] hover:bg-[#003A70]" : ""}
                          onClick={() => {
                            setIdentityOk("no");
                            // Hand them their own values to EDIT, not a blank prose box.
                            if (identityOk !== "no") {
                              setCorrectedName(identity?.techName || "");
                              setCorrectedLdap(identity?.ldap || "");
                              setCorrectedTruck(identity?.truckNumber || "");
                              setCorrectedDistrict(identity?.district || "");
                              setCorrectedState(identity?.homeState || "");
                              setCorrectedPhone(identity?.mobilePhone || "");
                            }
                            clearErr("identityOk");
                            focusSection(correctionSectionRef);
                          }}>Something&apos;s wrong</Button>
                </div>
                {identityOk === "yes" && (
                  <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm font-medium text-emerald-800">
                    Details confirmed. Continue below.
                  </p>
                )}
                {fieldErrors.identityOk && <p className="text-sm text-red-600">{fieldErrors.identityOk}</p>}
                {identityOk === "no" && (
                  <div
                    ref={correctionSectionRef}
                    data-testid="identity-correction-section"
                    tabIndex={-1}
                    aria-label="Report identity corrections"
                    className="space-y-3 rounded-lg border border-[#D8E2EE] bg-[#F4F8FC] p-3 outline-none focus:ring-2 focus:ring-[#00529B]"
                  >
                    <p className="text-sm font-medium text-slate-700">Fix what is wrong below.</p>
                    <p className="text-xs text-slate-600">
                      These changes go to Fleet for review. They do not directly change the technician roster.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="corrected-name">Name</Label>
                        <Input id="corrected-name" value={correctedName}
                               onChange={(e) => { setCorrectedName(e.target.value); clearErr("identityCorrection"); }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="corrected-ldap">LDAP</Label>
                        <Input id="corrected-ldap" autoCapitalize="characters" value={correctedLdap}
                               onChange={(e) => { setCorrectedLdap(e.target.value); clearErr("identityCorrection"); }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ctruck">Truck number</Label>
                        <Input id="ctruck" inputMode="numeric" value={correctedTruck}
                               onChange={(e) => { setCorrectedTruck(e.target.value); clearErr("identityCorrection"); }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="corrected-district">District</Label>
                        <Input id="corrected-district" value={correctedDistrict}
                               onChange={(e) => { setCorrectedDistrict(e.target.value); clearErr("identityCorrection"); }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="corrected-state">State</Label>
                        <Input id="corrected-state" maxLength={2} autoCapitalize="characters" value={correctedState}
                               onChange={(e) => { setCorrectedState(e.target.value); clearErr("identityCorrection"); }} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cphone">Mobile number</Label>
                        <Input id="cphone" inputMode="tel" value={correctedPhone}
                               onChange={(e) => { setCorrectedPhone(e.target.value); clearErr("correctedPhone"); clearErr("identityCorrection"); }} />
                        {fieldErrors.correctedPhone && <p className="text-sm text-red-600">{fieldErrors.correctedPhone}</p>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="corr">Anything else that is wrong? (optional)</Label>
                      <Textarea id="corr" rows={2} value={identityCorrection}
                                onChange={(e) => { setIdentityCorrection(e.target.value); clearErr("identityCorrection"); }} />
                    </div>
                    {fieldErrors.identityCorrection && <p className="text-sm text-red-600">{fieldErrors.identityCorrection}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section — what do you need? New rental vs more time on the one
                they already hold. Defaulted from detection, but the technician
                decides: the rental-ops feed can lag, so a contradiction warns
                and asks for one line instead of blocking. */}
            <div
              ref={requestTypeSectionRef}
              data-testid="request-type-section"
              tabIndex={-1}
              className="outline-none focus:ring-2 focus:ring-[#00529B]"
            >
              <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">What do you need?</CardTitle>
                <CardDescription>
                  {detection && detection.openRentals > 0
                    ? "Our records show you currently have a rental."
                    : "Our records do not show a current rental for you."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3">
                  <Button type="button" variant={requestType === "new" ? "default" : "outline"}
                          className={"h-auto justify-start whitespace-normal py-3 text-left "
                            + (requestType === "new" ? "bg-[#00529B] hover:bg-[#003A70]" : "")}
                          disabled={detection ? !detection.allowed.new : false}
                          onClick={() => { setRequestType("new"); clearErr("typeMismatchExplanation"); }}>
                    <span><span className="font-semibold">New rental</span> — I need a vehicle and do not
                      currently have a rental.</span>
                  </Button>
                  <Button type="button" variant={requestType === "extension" ? "default" : "outline"}
                          className={"h-auto justify-start whitespace-normal py-3 text-left "
                            + (requestType === "extension" ? "bg-[#00529B] hover:bg-[#003A70]" : "")}
                          disabled={detection ? !detection.allowed.extension : false}
                          onClick={() => { setRequestType("extension"); clearErr("typeMismatchExplanation"); }}>
                    <span><span className="font-semibold">Extension of my current rental</span> — I already
                      have a rental and need more time on it.</span>
                  </Button>
                </div>
                {detection && !detection.allowed.new && (
                  <p className="text-sm text-slate-500">
                    New rental is unavailable: you already have request
                    #{detection.blocking.new?.requestNo} ({detection.blocking.new?.status}) with Fleet.
                  </p>
                )}
                {detection && !detection.allowed.extension && (
                  <p className="text-sm text-slate-500">
                    Extension is unavailable: you already have request
                    #{detection.blocking.extension?.requestNo} ({detection.blocking.extension?.status}) with Fleet.
                  </p>
                )}
                {typeMismatch && (
                  <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="text-sm font-medium text-amber-900">
                      {requestType === "extension"
                        ? "Our records do not show a current rental for you. You can still continue — "
                          + "our rental feed can run behind — but tell us briefly what rental you have."
                        : "Our records show you currently have a rental. You can still request a NEW "
                          + "rental — our feed can run behind — but tell us briefly why."}
                    </p>
                    <Textarea rows={2} value={typeMismatchExplanation}
                              placeholder="One or two lines is fine"
                              onChange={(e) => { setTypeMismatchExplanation(e.target.value); clearErr("typeMismatchExplanation"); }} />
                    {fieldErrors.typeMismatchExplanation && (
                      <p className="text-sm text-red-600">{fieldErrors.typeMismatchExplanation}</p>
                    )}
                  </div>
                )}
              </CardContent>
              </Card>
            </div>

            {requestType === "new" && (<>
            {/* Enterprise will not rent to a driver under 21, so this is asked
                before the problem questions. An under-21 technician is stopped
                here and sent to Holman rather than filling in a whole form that
                could never become a reservation. */}
            <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Driver eligibility</CardTitle>
                <CardDescription>Enterprise requires every driver to be 21 or older.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Label>Are you 21 years of age or older?</Label>
                <Select value={isOver21} onValueChange={(v) => { setIsOver21(v as "yes" | "no"); clearErr("isOver21"); }}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                {fieldErrors.isOver21 && <p className="text-sm text-red-600">{fieldErrors.isOver21}</p>}
              </CardContent>
            </Card>

            {isOver21 === "no" ? (
              <Card className="rounded-xl border-red-300 bg-red-50 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base text-red-900">Stop. Fleet cannot book this rental.</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-red-900">
                  <p>
                    Enterprise does not rent to drivers under 21. This request cannot become a
                    reservation, no matter who approves it, so there is nothing further to fill in.
                  </p>
                  <p className="font-semibold">
                    Contact Holman (ARI). They are the only ones who can put you in a rental,
                    through Avis or Hertz.
                  </p>
                  <p>
                    If you are not sure how to reach Holman, call your supervisor and tell them
                    Enterprise refused on age.
                  </p>
                </CardContent>
              </Card>
            ) : (<>
            {/* Section B — the problem */}
            <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">2</span>{isNoVan ? "What is going on?" : "What issues are you having with your work van?"}
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
                    {problemCategory === "accident" && (
                    <div className="space-y-2">
                      <Label>Are you okay?</Label>
                      <Select value={areYouOkay} onValueChange={(v) => { setAreYouOkay(v); clearErr("areYouOkay"); }}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                      {areYouOkay === "no" && (
                        <p className="rounded-md bg-red-50 p-2 text-sm font-medium text-red-800">
                          If you are hurt, call 911 first, then your supervisor. This form can wait.
                        </p>
                      )}
                      {fieldErrors.areYouOkay && <p className="text-sm text-red-600">{fieldErrors.areYouOkay}</p>}
                    </div>
                    )}
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
                    {!isNoVan && (
                    <div className="space-y-2">
                      <Label htmlFor="symptom">Describe the issue you are experiencing, in as much detail as possible</Label>
                      <Textarea id="symptom" rows={3} value={symptom}
                                onChange={(e) => { setSymptom(e.target.value); clearErr("symptom"); }} />
                      {fieldErrors.symptom && <p className="text-sm text-red-600">{fieldErrors.symptom}</p>}
                    </div>
                    )}
                </>
              </CardContent>
            </Card>

            {/* No van/BYOV: no shop to name, but the reservation still needs
                an Enterprise pickup location. No-van also supplies its start
                date here. Same columns the booking chain reads. */}
            {(isNoVan || identity?.isByov) && (
              <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">3</span>Your rental</CardTitle>
                  <CardDescription>
                    {isNoVan
                      ? "You have no work van yet, so we just need when and where."
                      : "Because your work vehicle is BYOV, we need the Enterprise location where you will pick up the rental."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isNoVan && (<>
                  <div className="space-y-2">
                    <Label htmlFor="need">When is your first day on the road?</Label>
                    <Input id="need" type="date" value={appointmentDate}
                           onChange={(e) => { setAppointmentDate(e.target.value); clearErr("appointmentAt"); }} />
                  </div>
                  {fieldErrors.appointmentAt && <p className="text-sm text-red-600">{fieldErrors.appointmentAt}</p>}
                  </>)}
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
              <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">3</span>Where is your work van being repaired?</CardTitle>
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
                      <div className="grid grid-cols-3 items-end gap-3">
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="scity" className="flex min-h-10 items-end">City</Label>
                          <Input id="scity" value={shopCity}
                                 onChange={(e) => { setShopCity(e.target.value); clearErr("shopCity"); }} />
                          {fieldErrors.shopCity && <p className="text-sm text-red-600">{fieldErrors.shopCity}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label className="flex min-h-10 items-end">State</Label>
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
                      <div className="space-y-2">
                        <Label htmlFor="appt">Date your van goes into the shop</Label>
                        <Input id="appt" type="date" value={appointmentDate}
                               onChange={(e) => { setAppointmentDate(e.target.value); clearErr("appointmentAt"); }} />
                      </div>
                      <p className="text-xs text-slate-500">
                        Your rental starts on this date.
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
                            <span className="font-semibold">&quot;Enterprise Rent-A-Car near me&quot;</span>{" "}
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
              <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">4</span>Before you submit</CardTitle>
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

            <Button className="h-11 w-full bg-[#00529B] text-base hover:bg-[#003A70]" onClick={onSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit request"}
            </Button>
            </>)}
            </>)}

            {requestType === "extension" && (<>
            {/* The detected current rental, so the technician can see what the
                extension is FOR. Absent when detection found nothing — the
                mismatch box above already asked what they are driving. */}
            {detection?.currentRental && (
              <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Your current rental</CardTitle>
                  <CardDescription>From Fleet&apos;s rental records.</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="text-sm">
                    {([["Vehicle", detection.currentRental.veh_desc || detection.currentRental.rental_class],
                       ["Vendor", detection.currentRental.rental_vendor],
                       ["Started", detection.currentRental.rental_start_date],
                       ["Days so far", detection.currentRental.days_open],
                       ["Extensions so far", detection.currentRental.number_of_extensions],
                       ["Location", [detection.currentRental.renting_city, detection.currentRental.renting_state]
                         .filter(Boolean).join(", ")]] as Array<[string, unknown]>)
                      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-slate-100 py-1.5">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="font-medium text-slate-800">{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                </CardContent>
              </Card>
            )}

            {/* Section — the van status update. The extension doubles as a
                repair check-in: it validates the technician is keeping up with
                the shop, which is what Fleet reviews before granting time. */}
            <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">2</span>How is your van&apos;s repair going?</CardTitle>
                <CardDescription>
                  An extension is more time on the rental you already have. Fleet reviews
                  these answers before approving the extra time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="extstatus">What is the current status of your van&apos;s repair?</Label>
                  <Textarea id="extstatus" rows={3} value={extRepairStatus}
                            onChange={(e) => { setExtRepairStatus(e.target.value); clearErr("extRepairStatus"); }} />
                  {fieldErrors.extRepairStatus && <p className="text-sm text-red-600">{fieldErrors.extRepairStatus}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extcontact">When did you last speak with the shop?</Label>
                  <Input id="extcontact" type="date" value={extLastShopContact}
                         onChange={(e) => { setExtLastShopContact(e.target.value); clearErr("extLastShopContact"); }} />
                  {fieldErrors.extLastShopContact && <p className="text-sm text-red-600">{fieldErrors.extLastShopContact}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extsaid">What did the shop say?</Label>
                  <Textarea id="extsaid" rows={2} value={extShopSaid}
                            placeholder="e.g. waiting on a transmission part, due Thursday"
                            onChange={(e) => { setExtShopSaid(e.target.value); clearErr("extShopSaid"); }} />
                  {fieldErrors.extShopSaid && <p className="text-sm text-red-600">{fieldErrors.extShopSaid}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extdone">When does the shop expect the van to be done? (optional)</Label>
                  <Input id="extdone" type="date" value={extExpectedCompletion}
                         onChange={(e) => setExtExpectedCompletion(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exttime">Roughly how much longer do you need the rental?</Label>
                  <Input id="exttime" value={extTimeNeeded} placeholder="e.g. one more week"
                         onChange={(e) => { setExtTimeNeeded(e.target.value); clearErr("extTimeNeeded"); }} />
                  {fieldErrors.extTimeNeeded && <p className="text-sm text-red-600">{fieldErrors.extTimeNeeded}</p>}
                </div>
              </CardContent>
            </Card>

            {/* Section — acknowledgements. Every extension re-signs the FULL
                set: all four core statements and all four terms, every time. */}
            <Card className="rounded-xl border-[#D8E2EE] shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center text-base"><span className="mr-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#00529B] align-middle text-[11px] font-bold text-white">3</span>Before you submit</CardTitle>
                <CardDescription>
                  These apply to every week of the rental, so each extension signs them
                  again. All are recorded with your request.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-start gap-3 text-sm font-medium text-slate-800">
                  <Checkbox checked={extCoreAll}
                            onCheckedChange={(v) => {
                              const on = v === true;
                              setAcks((p) => {
                                const nx = { ...p };
                                for (const [k] of CORE_ACKS) nx[k] = on;
                                return nx;
                              });
                              clearErr("acks");
                            }} />
                  <span>I acknowledge and agree to all of the following:</span>
                </label>
                <ul className="ml-10 list-disc space-y-1.5 text-sm text-slate-600">
                  {CORE_ACKS.map(([k, text]) => <li key={k}>{text}</li>)}
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

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <Button className="h-11 w-full bg-[#00529B] text-base hover:bg-[#003A70]" onClick={onSubmitExtension} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit extension request"}
            </Button>
            </>)}
          </>
        )}
        <p className="pt-3 text-center text-[11px] font-medium tracking-[0.14em] text-slate-400">
          SEARS HOME SERVICES · FLEET OPERATIONS
        </p>
      </div>
    </div>
  );
}
