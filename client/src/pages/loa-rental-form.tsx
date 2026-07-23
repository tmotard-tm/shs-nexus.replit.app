/**
 * LOA Rental self-service form (Task #543) — PUBLIC, tokenized, no login.
 * Step 1: tech verifies LDAP + Truck #. Step 2: the six tracking questions
 * from the LOA sidebar; answers write into vehicle_nexus_data via the public
 * API and stop the automated outreach for this tech.
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
import { Loader2, CheckCircle, AlertCircle, Truck } from "lucide-react";

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

export default function LoaRentalForm() {
  const [, params] = useRoute("/loa-form/:token");
  const token = params?.token || "";

  const [step, setStep] = useState<"verify" | "form" | "done">("verify");
  const [ldap, setLdap] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const [location, setLocation] = useState("");
  const [locationContact, setLocationContact] = useState("");
  const [keys, setKeys] = useState("");
  const [repaired, setRepaired] = useState("");
  const [comments, setComments] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // All fields except Comments are required (Task #547).
  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!location.trim()) errors.location = "Please enter the address where your truck is located.";
    if (!locationContact.trim()) errors.locationContact = "Please enter a contact number for this location.";
    if (!keys) errors.keys = "Please select an option for Keys.";
    if (!repaired) errors.repaired = "Please select your rental vehicle status.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const clearFieldError = (field: string) =>
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const { data: linkInfo, isLoading } = useQuery<{ valid: boolean; completed?: boolean; message?: string }>({
    queryKey: ["/api/public/loa-form", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/loa-form/${encodeURIComponent(token)}`);
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      postJson(`/api/public/loa-form/${encodeURIComponent(token)}/verify`, { ldap, truckNumber }),
    onSuccess: () => {
      setVerifyError("");
      setStep("form");
    },
    onError: (e: any) => setVerifyError(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      postJson(`/api/public/loa-form/${encodeURIComponent(token)}/submit`, {
        ldap,
        truckNumber,
        nexusNewLocation: location,
        nexusNewLocationContact: locationContact,
        keys,
        repaired,
        comments,
      }),
    onSuccess: () => {
      setSubmitError("");
      setStep("done");
    },
    onError: (e: any) => setSubmitError(e.message),
  });

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-start justify-center p-4 pt-8 sm:pt-16">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
            <Truck className="h-6 w-6 text-blue-600 dark:text-blue-300" />
          </div>
          <CardTitle>Sears Home Services</CardTitle>
          <CardDescription>Vehicle &amp; Rental Update</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );

  if (!token || (!isLoading && !linkInfo?.valid)) {
    return shell(
      <div className="text-center py-6 space-y-2">
        <AlertCircle className="h-8 w-8 mx-auto text-red-500" />
        <p className="text-sm text-muted-foreground">
          This link is invalid or has expired. Please contact the fleet team if you believe this is a mistake.
        </p>
      </div>,
    );
  }

  if (isLoading) {
    return shell(
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>,
    );
  }

  if (linkInfo?.completed || step === "done") {
    return shell(
      <div className="text-center py-6 space-y-2">
        <CheckCircle className="h-8 w-8 mx-auto text-green-500" />
        <p className="font-medium">Thank you!</p>
        <p className="text-sm text-muted-foreground">
          {step === "done"
            ? "Your information has been submitted. Our team will follow up with next steps."
            : "This form has already been submitted. No further action is needed."}
        </p>
      </div>,
    );
  }

  if (step === "verify") {
    return shell(
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          verifyMutation.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          Please verify your identity to continue.
        </p>
        <div>
          <Label htmlFor="loa-ldap">Your LDAP (Enterprise ID)</Label>
          <Input
            id="loa-ldap"
            value={ldap}
            onChange={(e) => setLdap(e.target.value)}
            placeholder="e.g. JSMITH1"
            autoCapitalize="characters"
            className="mt-1"
            data-testid="input-loa-ldap"
          />
        </div>
        <div>
          <Label htmlFor="loa-truck">Truck #</Label>
          <Input
            id="loa-truck"
            value={truckNumber}
            onChange={(e) => setTruckNumber(e.target.value)}
            placeholder="e.g. 12345"
            inputMode="numeric"
            className="mt-1"
            data-testid="input-loa-truck"
          />
        </div>
        {verifyError && <p className="text-sm text-red-500">{verifyError}</p>}
        <Button type="submit" className="w-full" disabled={verifyMutation.isPending || !ldap.trim() || !truckNumber.trim()} data-testid="button-loa-verify">
          {verifyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Continue
        </Button>
      </form>,
    );
  }

  const requiredMark = <span className="text-red-500" aria-hidden="true"> *</span>;

  return shell(
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!validateForm()) {
          setSubmitError("");
          return;
        }
        submitMutation.mutate();
      }}
    >
      <div>
        <Label htmlFor="loa-location">What is the address of where your Sears truck is located?{requiredMark}</Label>
        <Input
          id="loa-location"
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            clearFieldError("location");
          }}
          placeholder="Street, city, state, zip"
          className={`mt-1 ${fieldErrors.location ? "border-red-500" : ""}`}
          aria-invalid={!!fieldErrors.location}
          data-testid="input-loa-location"
        />
        {fieldErrors.location && (
          <p className="text-sm text-red-500 mt-1" data-testid="error-loa-location">{fieldErrors.location}</p>
        )}
      </div>
      <div>
        <Label htmlFor="loa-contact">What is the contact number for this location?{requiredMark}</Label>
        <Input
          id="loa-contact"
          value={locationContact}
          onChange={(e) => {
            setLocationContact(e.target.value);
            clearFieldError("locationContact");
          }}
          placeholder="Phone number"
          inputMode="tel"
          className={`mt-1 ${fieldErrors.locationContact ? "border-red-500" : ""}`}
          aria-invalid={!!fieldErrors.locationContact}
          data-testid="input-loa-contact"
        />
        {fieldErrors.locationContact && (
          <p className="text-sm text-red-500 mt-1" data-testid="error-loa-contact">{fieldErrors.locationContact}</p>
        )}
      </div>
      <div>
        <Label>Keys{requiredMark}</Label>
        <Select value={keys} onValueChange={(v) => { setKeys(v); clearFieldError("keys"); }}>
          <SelectTrigger
            className={`mt-1 ${fieldErrors.keys ? "border-red-500" : ""}`}
            aria-invalid={!!fieldErrors.keys}
            data-testid="select-loa-keys"
          >
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="present">Present</SelectItem>
            <SelectItem value="not_present">Not Present</SelectItem>
            <SelectItem value="unknown">Unknown/Would not Check</SelectItem>
          </SelectContent>
        </Select>
        {fieldErrors.keys && (
          <p className="text-sm text-red-500 mt-1" data-testid="error-loa-keys">{fieldErrors.keys}</p>
        )}
      </div>
      <div>
        <Label>Rental Vehicle Status{requiredMark}</Label>
        <Select value={repaired} onValueChange={(v) => { setRepaired(v); clearFieldError("repaired"); }}>
          <SelectTrigger
            className={`mt-1 ${fieldErrors.repaired ? "border-red-500" : ""}`}
            aria-invalid={!!fieldErrors.repaired}
            data-testid="select-loa-repaired"
          >
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="returned_it">I returned it</SelectItem>
            <SelectItem value="never_had_rental">I never had a rental before going on leave</SelectItem>
            <SelectItem value="hr_will_return">I received communication from HR and will be returning it</SelectItem>
            <SelectItem value="wont_return">I won't /can't return the rental</SelectItem>
          </SelectContent>
        </Select>
        {fieldErrors.repaired && (
          <p className="text-sm text-red-500 mt-1" data-testid="error-loa-repaired">{fieldErrors.repaired}</p>
        )}
      </div>
      <div>
        <Label htmlFor="loa-comments">Comments</Label>
        <Textarea
          id="loa-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value.slice(0, 400))}
          rows={3}
          maxLength={400}
          className="mt-1 resize-none"
          placeholder="Anything else we should know (optional)"
          data-testid="textarea-loa-comments"
        />
        <p className="text-xs text-muted-foreground text-right mt-1">{comments.length}/400</p>
      </div>
      {submitError && <p className="text-sm text-red-500">{submitError}</p>}
      <Button type="submit" className="w-full" disabled={submitMutation.isPending} data-testid="button-loa-submit">
        {submitMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Submit
      </Button>
    </form>,
  );
}
