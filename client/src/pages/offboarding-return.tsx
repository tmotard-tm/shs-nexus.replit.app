import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Truck, Smartphone, Package, AlertTriangle, Clock, ShieldAlert, Info, CheckCircle2, type LucideIcon } from "lucide-react";

interface ReturnStep {
  step: number;
  title: string;
  description: string;
  instruction: string;
}

interface ReturnData {
  techName: string;
  separationDate: string | null;
  lane: "PRE" | "WARM" | "LATE" | "COLD";
  tokenId: string;
  firstVisit: boolean;
  returnSteps: ReturnStep[];
}

const URGENCY_CONFIG = {
  PRE: {
    icon: Info,
    className: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200",
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
    title: "Upcoming Separation",
    message: "Your separation date is coming up — here's what to prepare. Please review the steps below so you're ready to return your items on your last day.",
  },
  WARM: {
    icon: Clock,
    className: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-200",
    badgeClass: "bg-orange-100 text-orange-700 border-orange-200",
    title: "Action Needed",
    message: "Please return your items within your first week after separation. Completing these steps promptly helps ensure a smooth transition.",
  },
  LATE: {
    icon: AlertTriangle,
    className: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    title: "Items Overdue",
    message: "Your items are overdue — please complete these steps within 3 business days. Failure to return company property may result in further action.",
  },
  COLD: {
    icon: ShieldAlert,
    className: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200",
    badgeClass: "bg-red-100 text-red-700 border-red-200",
    title: "Immediate Action Required",
    message: "Immediate action required — unresolved items may be referred to collections. Please complete all return steps below as soon as possible to avoid escalation.",
  },
};

const STEP_ICONS: Record<number, { icon: LucideIcon; bgClass: string; iconClass: string; tipBg: string; tipBorder: string; tipText: string }> = {
  1: { icon: ClipboardList, bgClass: "bg-blue-100 dark:bg-blue-900", iconClass: "text-blue-600 dark:text-blue-400", tipBg: "bg-blue-50 dark:bg-blue-950", tipBorder: "border-blue-200 dark:border-blue-800", tipText: "text-blue-800 dark:text-blue-200" },
  2: { icon: Truck, bgClass: "bg-green-100 dark:bg-green-900", iconClass: "text-green-600 dark:text-green-400", tipBg: "bg-green-50 dark:bg-green-950", tipBorder: "border-green-200 dark:border-green-800", tipText: "text-green-800 dark:text-green-200" },
  3: { icon: Smartphone, bgClass: "bg-purple-100 dark:bg-purple-900", iconClass: "text-purple-600 dark:text-purple-400", tipBg: "bg-purple-50 dark:bg-purple-950", tipBorder: "border-purple-200 dark:border-purple-800", tipText: "text-purple-800 dark:text-purple-200" },
  4: { icon: Package, bgClass: "bg-amber-100 dark:bg-amber-900", iconClass: "text-amber-600 dark:text-amber-400", tipBg: "bg-amber-50 dark:bg-amber-950", tipBorder: "border-amber-200 dark:border-amber-800", tipText: "text-amber-800 dark:text-amber-200" },
};

const DEFAULT_STEP_STYLE = { icon: Package, bgClass: "bg-gray-100 dark:bg-gray-900", iconClass: "text-gray-600 dark:text-gray-400", tipBg: "bg-gray-50 dark:bg-gray-950", tipBorder: "border-gray-200 dark:border-gray-800", tipText: "text-gray-800 dark:text-gray-200" };

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not specified";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Not specified";
  }
}

export default function OffboardingReturn() {
  const [data, setData] = useState<ReturnData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const visitLogged = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setError("No token provided. Please use the link from your email or text message.");
      setLoading(false);
      return;
    }

    fetch(`/api/offboarding/return/validate?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || "Invalid or expired link");
        }
        return res.json();
      })
      .then((result: ReturnData) => {
        setData(result);
        setLoading(false);

        if (!visitLogged.current) {
          visitLogged.current = true;
          fetch("/api/offboarding/return/log-visit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }).catch(() => {});
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Verifying your link...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Unable to Access Page</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {error || "Something went wrong. Please try again."}
            </p>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium mb-1">Need help?</p>
              <p>Contact your supervisor for assistance.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const urgency = URGENCY_CONFIG[data.lane];
  const UrgencyIcon = urgency.icon;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Equipment Return</h1>
            <Badge variant="outline" className={urgency.badgeClass}>{data.lane}</Badge>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Welcome, <span className="font-medium text-gray-900 dark:text-gray-100">{data.techName}</span>
            {data.separationDate && (
              <span> &middot; Separation date: {formatDate(data.separationDate)}</span>
            )}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <Alert className={`border ${urgency.className}`}>
          <UrgencyIcon className="h-5 w-5" />
          <AlertDescription>
            <span className="font-semibold">{urgency.title}:</span> {urgency.message}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {data.returnSteps.map((returnStep) => {
            const style = STEP_ICONS[returnStep.step] || DEFAULT_STEP_STYLE;
            const StepIcon = style.icon;
            return (
              <Card key={returnStep.step}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className={`w-8 h-8 ${style.bgClass} rounded-full flex items-center justify-center flex-shrink-0`}>
                      <StepIcon className={`w-4 h-4 ${style.iconClass}`} />
                    </div>
                    <span>Step {returnStep.step}: {returnStep.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-gray-600 dark:text-gray-400 mb-3">
                    {returnStep.description}
                  </p>
                  <div className={`${style.tipBg} border ${style.tipBorder} rounded-lg p-3`}>
                    <p className={`text-sm ${style.tipText}`}>
                      <CheckCircle2 className="w-4 h-4 inline mr-1" />
                      {returnStep.instruction}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-center text-sm text-gray-600 dark:text-gray-400 mt-6">
          <p className="font-medium mb-1">Questions?</p>
          <p>Contact your supervisor for assistance.</p>
        </div>
      </div>
    </div>
  );
}
