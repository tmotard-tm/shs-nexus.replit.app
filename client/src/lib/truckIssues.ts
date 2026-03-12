import { type Truck } from "@shared/fleet-scope-schema";

export interface TruckIssue {
  message: string;
  severity: "warning" | "critical";
}

export interface TruckIssueResult {
  issues: TruckIssue[];
  count: number;
  severity: "none" | "warning" | "critical";
}

function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) && d < new Date();
  } catch {
    return false;
  }
}

function isExpiringSoon(dateStr: string | null | undefined, days = 30): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return d > now && d <= threshold;
  } catch {
    return false;
  }
}

export function computeTruckIssues(truck: Truck): TruckIssueResult {
  const issues: TruckIssue[] = [];

  if (truck.registrationStickerValid === "Expired" || truck.registrationStickerValid === "No") {
    issues.push({ message: "Registration sticker expired or invalid", severity: "critical" });
  }

  if (isExpired(truck.holmanRegExpiry)) {
    issues.push({ message: "Holman registration expired", severity: "critical" });
  } else if (isExpiringSoon(truck.holmanRegExpiry)) {
    issues.push({ message: "Holman registration expiring soon", severity: "warning" });
  }

  if (isExpired(truck.registrationExpiryDate)) {
    issues.push({ message: "Registration tags expired", severity: "critical" });
  } else if (isExpiringSoon(truck.registrationExpiryDate)) {
    issues.push({ message: "Registration tags expiring soon", severity: "warning" });
  }

  if (truck.confirmedSetOfExpiredTags) {
    issues.push({ message: "Confirmed set of expired tags", severity: "warning" });
  }

  if (truck.awaitingTechDocuments) {
    issues.push({ message: "Awaiting tech documents for registration", severity: "warning" });
  }

  if (truck.mainStatus === "Declined Repair") {
    issues.push({ message: "Repair declined - pending sale/decommission", severity: "warning" });
  }

  let severity: "none" | "warning" | "critical" = "none";
  if (issues.some(i => i.severity === "critical")) {
    severity = "critical";
  } else if (issues.length > 0) {
    severity = "warning";
  }

  return { issues, count: issues.length, severity };
}

export function getIssueSeverityColor(severity: "none" | "warning" | "critical"): string {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    case "warning":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    case "none":
    default:
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  }
}
