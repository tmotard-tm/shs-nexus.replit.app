import { type Truck } from "@shared/schema";

export interface TruckIssue {
  field: string;
  message: string;
}

export interface TruckIssueResult {
  issues: TruckIssue[];
  count: number;
  severity: "none" | "warning" | "critical";
}

export function computeTruckIssues(truck: Truck): TruckIssueResult {
  const issues: TruckIssue[] = [];
  const mainStatus = truck.mainStatus || "";

  switch (mainStatus) {
    case "Research required":
      if (!truck.shsOwner?.trim()) {
        issues.push({ field: "shsOwner", message: "SHS owner is missing" });
      }
      if (!truck.datePutInRepair?.trim()) {
        issues.push({ field: "datePutInRepair", message: "Date put in repair is missing" });
      }
      if (!truck.truckNumber?.trim()) {
        issues.push({ field: "truckNumber", message: "Truck number is missing" });
      }
      break;

    case "Location confirmed":
      if (!truck.repairAddress?.trim()) {
        issues.push({ field: "repairAddress", message: "Repair address is missing" });
      }
      if (!truck.repairPhone?.trim()) {
        issues.push({ field: "repairPhone", message: "Repair phone is missing" });
      }
      if (!truck.contactName?.trim()) {
        issues.push({ field: "contactName", message: "Contact name is missing" });
      }
      if (truck.confirmedSetOfExpiredTags === null || truck.confirmedSetOfExpiredTags === undefined) {
        issues.push({ field: "confirmedSetOfExpiredTags", message: "Tag confirmation is missing" });
      }
      if (!truck.inAms) {
        issues.push({ field: "inAms", message: "AMS documentation is missing" });
      }
      break;

    case "Location unconfirmed":
      if (!truck.repairAddress?.trim()) {
        issues.push({ field: "repairAddress", message: "Repair address is missing" });
      }
      if (!truck.repairPhone?.trim()) {
        issues.push({ field: "repairPhone", message: "Repair phone is missing" });
      }
      break;

    case "Need to call tech":
      if (!truck.techName?.trim()) {
        issues.push({ field: "techName", message: "Tech name is missing" });
      }
      if (!truck.techPhone?.trim()) {
        issues.push({ field: "techPhone", message: "Tech phone is missing" });
      }
      break;

    case "Need transport to new tech":
      if (!truck.techName?.trim()) {
        issues.push({ field: "techName", message: "New tech name is missing" });
      }
      if (!truck.repairAddress?.trim()) {
        issues.push({ field: "repairAddress", message: "Current location is missing" });
      }
      break;

    case "Tech picked up":
      if (!truck.techName?.trim()) {
        issues.push({ field: "techName", message: "Tech name is missing" });
      }
      if (!truck.techPhone?.trim()) {
        issues.push({ field: "techPhone", message: "Tech phone is missing" });
      }
      if (!truck.vanPickedUp) {
        issues.push({ field: "vanPickedUp", message: "Pickup not confirmed" });
      }
      if (!truck.rentalReturned) {
        issues.push({ field: "rentalReturned", message: "Rental return not recorded" });
      }
      break;

    case "Vehicle was sold":
      if (!truck.confirmedDeclinedRepair?.trim()) {
        issues.push({ field: "confirmedDeclinedRepair", message: "Sale confirmation details missing" });
      }
      break;

    case "Sent to Park my Fleet":
      if (!truck.inAms) {
        issues.push({ field: "inAms", message: "AMS documentation not confirmed" });
      }
      break;
  }

  if (truck.subStatus?.includes("Waiting on repair") || truck.subStatus?.includes("Approved estimate")) {
    if (!truck.repairCompleted && !truck.inAms) {
      if (!issues.find(i => i.field === "inAms")) {
        issues.push({ field: "inAms", message: "AMS documentation is missing" });
      }
    }
  }

  if (truck.subStatus?.includes("Waiting on tech pickup") || truck.subStatus?.includes("Need tags")) {
    if (!truck.techName?.trim() && !issues.find(i => i.field === "techName")) {
      issues.push({ field: "techName", message: "Tech name is missing" });
    }
    if (!truck.techPhone?.trim() && !issues.find(i => i.field === "techPhone")) {
      issues.push({ field: "techPhone", message: "Tech phone is missing" });
    }
  }

  if (truck.pickUpSlotBooked && !truck.timeBlockedToPickUpVan?.trim()) {
    issues.push({ field: "timeBlockedToPickUpVan", message: "Pickup time slot is missing" });
  }

  if (truck.confirmedSetOfExpiredTags && !truck.registrationRenewalInProcess) {
    issues.push({ field: "registrationRenewalInProcess", message: "Registration renewal process not started" });
  }

  const count = issues.length;
  let severity: "none" | "warning" | "critical" = "none";
  if (count >= 3) {
    severity = "critical";
  } else if (count >= 1) {
    severity = "warning";
  }

  return { issues, count, severity };
}

export function getIssueSeverityColor(severity: "none" | "warning" | "critical"): string {
  switch (severity) {
    case "critical":
      return "bg-status-red text-status-red-fg";
    case "warning":
      return "bg-status-amber text-status-amber-fg";
    case "none":
      return "bg-status-green text-status-green-fg";
  }
}

export function getIssueSeverityDotColor(severity: "none" | "warning" | "critical"): string {
  switch (severity) {
    case "critical":
      return "bg-status-red";
    case "warning":
      return "bg-status-amber";
    case "none":
      return "bg-status-green";
  }
}
