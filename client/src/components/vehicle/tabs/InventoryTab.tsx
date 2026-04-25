import { Package } from "lucide-react";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Inventory tab — placeholder.
 *
 * Wired in Phase 2A.3 against the WMS engine three-layer adapter:
 *   GET /wms-engine/v1/trucks/:truckId/receive-tasks
 *   GET /wms-engine/v1/trucks/:truckId/return-tasks
 *   POST /wms-engine/v1/trucks/:truckId/inventory-count
 *
 * See `server/wms-engine-service.ts`.
 */
export function InventoryTab({ truck: _truck }: { truck: TruckPanelData }) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      <Package className="w-6 h-6 mx-auto mb-2 text-muted-foreground/60" />
      <div className="font-medium text-foreground mb-1">Inventory</div>
      <div className="text-xs">
        Receive tasks, return tasks, and inventory counts via WMS engine.
      </div>
      <div className="text-xs mt-3 italic">Wired in Phase 2A.3.</div>
    </div>
  );
}
