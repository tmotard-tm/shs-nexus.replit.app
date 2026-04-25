import { UserCog } from "lucide-react";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Assignments tab — placeholder.
 *
 * Wired in Phase 2A.3+ once the TPMS adapter (system-of-record for
 * tech-to-truck assignments) and the WMS live-assignment GET are in
 * place. Conflict policy is vendor-wins (TPMS).
 */
export function AssignmentsTab({ truck: _truck }: { truck: TruckPanelData }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      <UserCog className="w-6 h-6 mx-auto mb-2 text-muted-foreground/60" />
      <div className="font-medium text-foreground mb-1">Assignments</div>
      <div className="text-xs">
        Tech-to-truck assignments via TPMS (system of record) + WMS live confirmation.
      </div>
      <div className="text-xs mt-3 italic">Wired in Phase 2A.3.</div>
    </div>
  );
}
