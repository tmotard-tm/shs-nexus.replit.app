import { type Action } from "@shared/fleet-scope-schema";
import { format } from "date-fns";
import { Clock } from "lucide-react";

interface ActionTimelineProps {
  actions: Action[];
}

export function ActionTimeline({ actions }: ActionTimelineProps) {
  if (actions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No action history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((action, index) => (
        <div
          key={action.id}
          className="relative pl-6 py-2 border-l-2 border-muted"
          data-testid={`timeline-action-${index}`}
        >
          <div className="absolute left-0 top-3 w-2 h-2 -ml-[5px] rounded-full bg-primary" />
          
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-labels text-muted-foreground">
                {action.actionType}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {format(new Date(action.actionTime), "MMM d, yyyy h:mm a")}
              </span>
            </div>
            
            <div className="text-sm text-foreground">
              <span className="font-medium">{action.actionBy}</span>
            </div>
            
            {action.actionNote && (
              <div className="mt-1 text-sm text-muted-foreground bg-muted/50 rounded px-2 py-1">
                {action.actionNote}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
