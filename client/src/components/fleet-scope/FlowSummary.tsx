import { type Truck } from "@shared/fleet-scope-schema";

export type FlowStage = 
  | "research" 
  | "location-confirmed" 
  | "location-to-be-determined" 
  | "tech-call" 
  | "vehicle-sold"
  | "tech-picked-up"
  | "park-my-fleet"
  | "holman-research";

export interface FlowStageInfo {
  id: FlowStage;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const FLOW_STAGES: FlowStageInfo[] = [
  { 
    id: "research", 
    label: "Research Required", 
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-900/40",
    borderColor: "border-amber-300 dark:border-amber-700"
  },
  { 
    id: "location-confirmed", 
    label: "Location Confirmed", 
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-100 dark:bg-green-900/40",
    borderColor: "border-green-300 dark:border-green-700"
  },
  { 
    id: "location-to-be-determined", 
    label: "Location TBD", 
    color: "text-orange-700 dark:text-orange-300",
    bgColor: "bg-orange-100 dark:bg-orange-900/40",
    borderColor: "border-orange-300 dark:border-orange-700"
  },
  { 
    id: "tech-call", 
    label: "Tech Call Needed", 
    color: "text-red-700 dark:text-red-300",
    bgColor: "bg-red-100 dark:bg-red-900/40",
    borderColor: "border-red-300 dark:border-red-700"
  },
  { 
    id: "vehicle-sold", 
    label: "Vehicle Sold", 
    color: "text-slate-700 dark:text-slate-300",
    bgColor: "bg-slate-100 dark:bg-slate-900/40",
    borderColor: "border-slate-300 dark:border-slate-700"
  },
  { 
    id: "tech-picked-up", 
    label: "Tech Picked Up", 
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-900/40",
    borderColor: "border-blue-300 dark:border-blue-700"
  },
  { 
    id: "park-my-fleet", 
    label: "Park My Fleet", 
    color: "text-purple-700 dark:text-purple-300",
    bgColor: "bg-purple-100 dark:bg-purple-900/40",
    borderColor: "border-purple-300 dark:border-purple-700"
  },
  { 
    id: "holman-research", 
    label: "Holman Research", 
    color: "text-teal-700 dark:text-teal-300",
    bgColor: "bg-teal-100 dark:bg-teal-900/40",
    borderColor: "border-teal-300 dark:border-teal-700"
  },
];

export function getFlowStage(truck: Truck): FlowStage {
  const mainStatus = truck.mainStatus || "";
  const status = truck.status || "";

  if (mainStatus === "Sent to Park My Fleet" || status.includes("Park My Fleet")) {
    return "park-my-fleet";
  }

  if (mainStatus === "Sent to Holman for research" || status.includes("Holman")) {
    return "holman-research";
  }

  if (mainStatus === "Tech Picked Up") {
    return "tech-picked-up";
  }

  if (mainStatus === "Vehicle was sold") {
    return "vehicle-sold";
  }

  if (mainStatus === "Need to call tech" || mainStatus === "Need transport to new tech") {
    return "tech-call";
  }

  if (mainStatus === "Location to be Determined" || status.startsWith("Location to be Determined")) {
    return "location-to-be-determined";
  }

  if (mainStatus === "Location confirmed" || status.startsWith("Location confirmed")) {
    return "location-confirmed";
  }

  if (mainStatus === "Research required" || status.startsWith("Research required")) {
    return "research";
  }

  return "research";
}

export function computeFlowCounts(trucks: Truck[]): Record<FlowStage, number> {
  const counts: Record<FlowStage, number> = {
    "research": 0,
    "location-confirmed": 0,
    "location-to-be-determined": 0,
    "tech-call": 0,
    "vehicle-sold": 0,
    "tech-picked-up": 0,
    "park-my-fleet": 0,
    "holman-research": 0,
  };

  trucks.forEach(truck => {
    const stage = getFlowStage(truck);
    counts[stage]++;
  });

  return counts;
}

interface FlowSummaryProps {
  trucks: Truck[];
  activeStage: FlowStage | null;
  onStageClick: (stage: FlowStage | null) => void;
}

export function FlowSummary({ trucks, activeStage, onStageClick }: FlowSummaryProps) {
  const counts = computeFlowCounts(trucks);
  const total = trucks.length;

  return (
    <div className="sticky bottom-0 z-40 bg-background/95 backdrop-blur border-t shadow-lg">
      <div className="px-4 lg:px-8 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Workflow Summary
          </h3>
          {activeStage && (
            <button
              onClick={() => onStageClick(null)}
              className="text-xs text-primary hover:underline"
              data-testid="button-clear-flow-filter"
            >
              Clear Filter
            </button>
          )}
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-3 lg:gap-4 w-full">
          {FLOW_STAGES.map((stage, index) => {
            const count = counts[stage.id];
            const isActive = activeStage === stage.id;
            const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
            
            return (
              <button
                key={stage.id}
                onClick={() => onStageClick(isActive ? null : stage.id)}
                className={`
                  flex flex-col items-center justify-center px-2 py-2 rounded-lg border-2 transition-all
                  hover:scale-[1.02] cursor-pointer flex-1 min-w-0
                  ${stage.bgColor} ${stage.borderColor}
                  ${isActive ? 'ring-2 ring-primary ring-offset-2 scale-[1.02]' : ''}
                `}
                data-testid={`flow-stage-${stage.id}`}
              >
                <span className={`text-2xl lg:text-3xl font-bold ${stage.color}`}>
                  {count}
                </span>
                <span className={`text-xs lg:text-sm font-medium ${stage.color} text-center leading-tight`}>
                  {stage.label}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {percentage}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
