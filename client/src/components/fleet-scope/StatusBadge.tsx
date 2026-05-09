import { forwardRef } from "react";
import { type MainStatus, MAIN_STATUSES, getOriginalCSVValue } from "@shared/fleet-scope-schema";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatusBadgeProps {
  status: string;
  mainStatus?: string | null;
  subStatus?: string | null;
  showSubStatusOnly?: boolean;
}

const mainStatusColors: Record<MainStatus, string> = {
  "Confirming Status": "bg-status-amber text-status-amber-fg",
  "Decision Pending": "bg-status-red text-status-red-fg",
  "Repairing": "bg-status-amber text-status-amber-fg",
  "Declined Repair": "bg-status-red text-status-red-fg",
  "Approved for sale": "bg-status-amber text-status-amber-fg",
  "Tags": "bg-status-amber text-status-amber-fg",
  "Scheduling": "bg-status-green text-status-green-fg",
  "PMF": "bg-status-amber text-status-amber-fg",
  "In Transit": "bg-status-green text-status-green-fg",
  "On Road": "bg-status-green text-status-green-fg",
  "Needs truck assigned": "bg-status-amber text-status-amber-fg",
  "Available to be assigned": "bg-status-green text-status-green-fg",
  "Relocate Van": "bg-status-amber text-status-amber-fg",
  "NLWC - Return Rental": "bg-status-red text-status-red-fg",
  "Truck Swap": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
};

const subStatusColors: Record<string, string> = {
  "Location Unknown": "bg-status-red text-status-red-fg",
  "Estimate received, needs review": "bg-status-red text-status-red-fg",
  "Repair declined": "bg-status-red text-status-red-fg",
  "Vehicle was sold": "bg-muted text-muted-foreground",
  "Delivered to technician": "bg-status-green text-status-green-fg",
  "Tags/registration complete": "bg-status-green text-status-green-fg",
  "Ready for redeployment": "bg-status-green text-status-green-fg",
  "Vehicle submitted for sale": "bg-status-red text-status-red-fg",
  "Declined Repair": "bg-status-red text-status-red-fg",
  "Estimate Pending Decision": "bg-status-red text-status-red-fg",
  "Scheduled, awaiting tech pickup": "bg-status-green text-status-green-fg",
  "Under repair at shop": "bg-status-amber text-status-amber-fg",
  "Waiting on repair completion": "bg-status-amber text-status-amber-fg",
};

function extractMainStatus(status: string): MainStatus | null {
  for (const ms of MAIN_STATUSES) {
    if (status === ms || status.startsWith(ms + ",") || status.startsWith(ms + " –")) {
      return ms;
    }
  }
  return null;
}

function extractSubStatus(status: string, mainStatus: string): string | null {
  if (status.startsWith(mainStatus + ", ")) {
    return status.substring(mainStatus.length + 2);
  }
  if (status.startsWith(mainStatus + " – ")) {
    return status.substring(mainStatus.length + 3);
  }
  return null;
}

export function StatusBadge({ status, mainStatus, subStatus, showSubStatusOnly = false }: StatusBadgeProps) {
  let colorClass = "bg-muted text-muted-foreground";

  const effectiveMainStatus = mainStatus || extractMainStatus(status);
  const effectiveSubStatus = subStatus || (effectiveMainStatus ? extractSubStatus(status, effectiveMainStatus) : null);
  
  if (effectiveMainStatus && MAIN_STATUSES.includes(effectiveMainStatus as MainStatus)) {
    colorClass = mainStatusColors[effectiveMainStatus as MainStatus] || colorClass;
    
    if (effectiveSubStatus && subStatusColors[effectiveSubStatus]) {
      colorClass = subStatusColors[effectiveSubStatus];
    }
  }

  // Display format: "Main Status, Sub-Status" or just sub-status if showSubStatusOnly
  let displayText: string;
  if (showSubStatusOnly && effectiveSubStatus) {
    displayText = effectiveSubStatus;
  } else if (effectiveMainStatus && effectiveSubStatus) {
    displayText = `${effectiveMainStatus}, ${effectiveSubStatus}`;
  } else if (effectiveMainStatus) {
    displayText = effectiveMainStatus;
  } else {
    displayText = status;
  }

  // Get original CSV value for tooltip
  const originalCSVValue = getOriginalCSVValue(effectiveSubStatus);

  // If there's an original CSV value, wrap in tooltip
  if (originalCSVValue) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${colorClass} border-0 whitespace-nowrap cursor-default`}
            data-testid={`badge-status-${displayText.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {displayText}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs font-medium">Original CSV Value:</p>
          <p className="text-xs text-muted-foreground">{originalCSVValue}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge 
      className={`rounded-full px-3 py-1 text-sm font-medium ${colorClass} border-0 whitespace-nowrap cursor-default`}
      data-testid={`badge-status-${displayText.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {displayText}
    </Badge>
  );
}
