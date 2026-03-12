import { type Truck } from "@shared/fleet-scope-schema";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { computeTruckIssues, getIssueSeverityColor } from "@/lib/truckIssues";

interface IssueIndicatorProps {
  truck: Truck;
}

export function IssueIndicator({ truck }: IssueIndicatorProps) {
  const result = computeTruckIssues(truck);
  const { issues, count, severity } = result;

  const Icon = severity === "none" ? CheckCircle : severity === "critical" ? AlertCircle : AlertTriangle;
  const colorClass = getIssueSeverityColor(severity);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
          data-testid={`issue-badge-${truck.id}`}
        >
          <Icon className="w-3 h-3 mr-1" />
          {count}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="max-w-xs p-3 z-[100]">
        {count === 0 ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-status-green" />
            <span className="text-sm font-medium">No issues found</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${severity === "critical" ? "text-status-red" : "text-status-amber"}`} />
              <span className="text-sm font-medium">
                {count} issue{count !== 1 ? "s" : ""} found
              </span>
            </div>
            <ul className="text-sm space-y-1 pl-1">
              {issues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2 text-muted-foreground">
                  <span className="text-xs mt-0.5">•</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function useIssueStats(trucks: Truck[] | undefined) {
  if (!trucks) return { withIssues: 0, critical: 0, warning: 0, clean: 0 };
  
  let withIssues = 0;
  let critical = 0;
  let warning = 0;
  let clean = 0;

  trucks.forEach(truck => {
    const result = computeTruckIssues(truck);
    if (result.severity === "critical") {
      critical++;
      withIssues++;
    } else if (result.severity === "warning") {
      warning++;
      withIssues++;
    } else {
      clean++;
    }
  });

  return { withIssues, critical, warning, clean };
}
