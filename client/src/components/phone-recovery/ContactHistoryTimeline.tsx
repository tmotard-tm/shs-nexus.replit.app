import { Phone, Mail, MessageSquare, Package, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ContactHistoryEntry } from "./utils";

interface ContactHistoryTimelineProps {
  contactHistory: ContactHistoryEntry[];
  shippingLabelSent: boolean;
  trackingNumber: string | null;
}

const METHOD_ICONS: Record<string, typeof Phone> = {
  Phone: Phone,
  Email: Mail,
  Text: MessageSquare,
};

function getOutcomeColor(outcome: string) {
  switch (outcome) {
    case "Reached":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "Voicemail":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
    case "No Response":
    case "Declined":
    case "Wrong Number":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ContactHistoryTimeline({
  contactHistory,
  shippingLabelSent,
  trackingNumber,
}: ContactHistoryTimelineProps) {
  const sortedHistory = [...contactHistory].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        Contact History
      </h3>

      {sortedHistory.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400 border rounded-lg bg-gray-50 dark:bg-gray-900">
          No contact attempts recorded yet.
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

          <div className="space-y-4">
            {sortedHistory.map((entry, index) => {
              const Icon = METHOD_ICONS[entry.method] || Phone;
              return (
                <div key={index} className="relative pl-10">
                  <div className="absolute left-2 top-1 w-5 h-5 rounded-full bg-white dark:bg-gray-800 border-2 border-blue-500 flex items-center justify-center">
                    <Icon className="h-3 w-3 text-blue-500" />
                  </div>

                  <div className="rounded-lg border p-3 bg-white dark:bg-gray-900">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {entry.method}
                        </span>
                        <Badge className={`text-xs ${getOutcomeColor(entry.outcome)}`}>
                          {entry.outcome}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(entry.date)}
                      </span>
                    </div>
                    {entry.notes && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border p-3 bg-gray-50 dark:bg-gray-900 space-y-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Shipping Label
          </span>
          <Badge
            className={
              shippingLabelSent
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }
          >
            {shippingLabelSent ? "Sent" : "Not Sent"}
          </Badge>
        </div>
        {trackingNumber && (
          <div className="flex items-center gap-2 pl-6">
            <Truck className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Tracking: <span className="font-mono">{trackingNumber}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
