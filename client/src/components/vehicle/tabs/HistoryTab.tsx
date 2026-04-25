import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionTimeline } from "@/components/fleet-scope/ActionTimeline";
import type { Action } from "@shared/fleet-scope-schema";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

export function HistoryTab({ truck }: { truck: TruckPanelData }) {
  const { data: actions, isLoading } = useQuery<Action[]>({
    queryKey: ["/api/fs/trucks", truck.id, "actions"],
    enabled: !!truck.id,
  });

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <Clock className="w-4 h-4 text-muted-foreground" />
        Action History
      </h3>
      <div className="rounded-md border p-3">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ActionTimeline actions={actions || []} />
        )}
      </div>
    </section>
  );
}
