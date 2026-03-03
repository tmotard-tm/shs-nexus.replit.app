import type { QueueItem } from "@shared/schema";

export interface ContactHistoryEntry {
  date: string;
  method: string;
  outcome: string;
  notes: string;
}

export type RecoveryStatus = "New" | "Contact Attempted" | "Label Sent" | "In Transit" | "Received";

export function deriveRecoveryStatus(task: QueueItem): RecoveryStatus {
  if (task.phoneDateReceived) {
    return "Received";
  }

  if (task.phoneTrackingNumber) {
    return "In Transit";
  }

  if (task.phoneShippingLabelSent) {
    return "Label Sent";
  }

  const history = (task.phoneContactHistory ?? []) as ContactHistoryEntry[];
  if (history.length > 0) {
    return "Contact Attempted";
  }

  return "New";
}

export function isEscalated(task: QueueItem): boolean {
  const history = (task.phoneContactHistory ?? []) as ContactHistoryEntry[];
  const failedCount = history.filter(
    (entry) => entry.outcome === "No Response" || entry.outcome === "Declined"
  ).length;
  return failedCount >= 3;
}

export type ReprovisioningStatus =
  | "Received"
  | "Inspecting"
  | "Wiping"
  | "Reprovisioning"
  | "Ready for Deployment"
  | "Assigned";

export function deriveReprovisioningStatus(task: QueueItem): ReprovisioningStatus {
  if (task.phoneAssignedToNewHire) {
    return "Assigned";
  }
  if (task.phoneServiceReinstated) {
    return "Ready for Deployment";
  }
  if (task.phoneReprovisionCompleted) {
    return "Reprovisioning";
  }
  if (task.phoneDataWipeCompleted) {
    return "Wiping";
  }
  if (task.phonePhysicalCondition) {
    return "Inspecting";
  }
  return "Received";
}
