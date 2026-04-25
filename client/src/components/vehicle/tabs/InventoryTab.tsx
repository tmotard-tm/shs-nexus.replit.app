import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package, DollarSign, Boxes, Search, Filter,
  AlertCircle, Loader2, Inbox, Undo2, ChevronDown, ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toCanonical } from "@shared/vehicle-number-utils";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Inventory tab — Phase 2A.3.
 *
 * Three sections:
 *   1. On-Truck Inventory (Snowflake — current parts snapshot, NS_AVG_COST)
 *      via /api/truck-inventory/summary/:truck (replaces ViewInventoryButton)
 *   2. Receive Tasks (WMS engine)
 *      via /api/wms/trucks/:truckId/receive-tasks
 *   3. Return Tasks (WMS engine)
 *      via /api/wms/trucks/:truckId/return-tasks
 *
 * Both WMS calls go through the three-layer adapter (server/wms-engine-service.ts)
 * which normalizes the `useCase` vs `useCaseId` spelling split per 2A.3.note2.
 */

interface InventoryItem {
  sku: string;
  partNo: string;
  partDesc: string;
  qty: number;
  unitCost: number;
  extCost: number;
  bin: string;
  category: string;
}

interface InventorySummary {
  truck: string;
  totalPieces: number;
  totalAvgCost: string;
  itemCount: number;
  extractDate: string | null;
  items: InventoryItem[];
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "N/A";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
  return dateStr;
}

function OnTruckInventory({ truckNumber }: { truckNumber: string }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: inventory, isLoading, error } = useQuery<InventorySummary>({
    queryKey: ["/api/truck-inventory/summary", truckNumber],
    enabled: !!truckNumber,
    staleTime: 5 * 60 * 1000,
  });

  const categories = useMemo(() => {
    if (!inventory?.items) return [];
    const set = new Set(inventory.items.map((i) => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [inventory?.items]);

  const filteredItems = useMemo(() => {
    if (!inventory?.items) return [];
    return inventory.items.filter((item) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        item.sku?.toLowerCase().includes(term) ||
        item.partNo?.toLowerCase().includes(term) ||
        item.partDesc?.toLowerCase().includes(term);
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [inventory?.items, searchTerm, categoryFilter]);

  const filteredTotals = useMemo(() => {
    const totalPieces = filteredItems.reduce((s, i) => s + i.qty, 0);
    const totalCost = filteredItems.reduce((s, i) => s + i.extCost, 0);
    return { totalPieces, totalCost };
  }, [filteredItems]);

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive py-3 px-3 border rounded-md bg-destructive/5">
        <AlertCircle className="w-4 h-4" />
        <span className="text-sm">Failed to load on-truck inventory</span>
      </div>
    );
  }
  if (!inventory || inventory.itemCount === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground border rounded-md">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No on-truck inventory data</p>
        <p className="text-xs mt-1">Run a Snowflake sync to refresh</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Pieces</p>
                <p className="text-lg font-bold leading-tight" data-testid="inventory-total-pieces">
                  {inventory.totalPieces.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-green-600" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Ext Cost</p>
                <p className="text-lg font-bold leading-tight" data-testid="inventory-total-cost">
                  ${parseFloat(inventory.totalAvgCost).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>{inventory.itemCount.toLocaleString()} unique SKUs</span>
        {inventory.extractDate && (
          <span>Data as of {formatDate(inventory.extractDate)}</span>
        )}
      </div>

      <div className="border rounded-md">
        <div className="bg-muted px-2 py-2 border-b flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="Search SKU / Part..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-7 h-7 text-xs"
              data-testid="input-inventory-search"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-category-filter">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(searchTerm || categoryFilter !== "all") && (
          <div className="px-2 py-1 text-xs text-muted-foreground border-b bg-muted/40">
            Showing {filteredItems.length} of {inventory.items.length} •{" "}
            {filteredTotals.totalPieces} pcs •{" "}
            ${filteredTotals.totalCost.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        )}

        <ScrollArea className="h-[260px]">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">SKU / Part</th>
                <th className="text-left px-2 py-1.5 font-medium">Cat</th>
                <th className="text-right px-2 py-1.5 font-medium">Qty</th>
                <th className="text-right px-2 py-1.5 font-medium">Ext</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-muted-foreground">
                    No items match your filters
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <tr
                    key={`${item.sku}-${item.bin}-${idx}`}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-xs">{item.sku}</div>
                      <div
                        className="text-[10px] text-muted-foreground truncate max-w-[160px]"
                        title={item.partDesc}
                      >
                        {item.partDesc || item.partNo}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[80px]">
                      <span title={item.category}>{item.category || "—"}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">{item.qty}</td>
                    <td className="px-2 py-1.5 text-right font-medium text-green-700 dark:text-green-400">
                      ${item.extCost.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
}

function WmsTaskSection({
  title,
  icon,
  truckNumber,
  endpointPath,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  truckNumber: string;
  endpointPath: "receive-tasks" | "return-tasks";
  testId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, error } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/wms/trucks", truckNumber, endpointPath],
    enabled: !!truckNumber,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const payload = data?.data;
  const taskList = useMemo<any[]>(() => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.tasks)) return payload.tasks;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }, [payload]);

  const count = taskList.length;
  const hasUnknownShape = !!payload && taskList.length === 0 && typeof payload === "object";

  return (
    <section>
      <button
        type="button"
        className="w-full flex items-center gap-1.5 text-sm font-semibold mb-2 hover:text-foreground/80"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`${testId}-toggle`}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        {icon}
        {title}
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-1" />
        ) : error ? (
          <Badge variant="outline" className="ml-auto text-xs text-destructive border-destructive/40">
            error
          </Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto text-xs" data-testid={`${testId}-count`}>
            {count}{hasUnknownShape ? " ?" : ""}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="rounded-md border p-3 text-xs">
          {error ? (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{(error as Error).message || "Failed to load WMS tasks"}</span>
            </div>
          ) : isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : count > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {taskList.slice(0, 50).map((t, i) => (
                <pre
                  key={i}
                  className="bg-muted/40 rounded p-2 text-[10px] font-mono leading-snug overflow-x-auto"
                  data-testid={`${testId}-row-${i}`}
                >
                  {JSON.stringify(t, null, 2)}
                </pre>
              ))}
              {taskList.length > 50 && (
                <p className="text-muted-foreground text-center pt-1">
                  …and {taskList.length - 50} more
                </p>
              )}
            </div>
          ) : hasUnknownShape ? (
            <div className="space-y-2">
              <p className="text-muted-foreground italic">
                WMS responded but the payload shape is not yet recognized; showing raw response:
              </p>
              <pre className="bg-muted/40 rounded p-2 text-[10px] font-mono leading-snug overflow-x-auto max-h-40">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-muted-foreground italic" data-testid={`${testId}-empty`}>
              No {title.toLowerCase()} on file.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function InventoryTab({ truck }: { truck: TruckPanelData }) {
  const truckNumberCanonical = toCanonical(truck.truckNumber || "");

  if (!truckNumberCanonical) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Package className="w-6 h-6 mx-auto mb-2 text-muted-foreground/60" />
        <div>Vehicle number is required to load inventory.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Boxes className="w-4 h-4 text-muted-foreground" />
          On-Truck Inventory
          <span className="text-xs text-muted-foreground font-normal ml-1">
            (Snowflake · NS_AVG_COST)
          </span>
        </h3>
        <OnTruckInventory truckNumber={truckNumberCanonical} />
      </section>

      <WmsTaskSection
        title="Receive Tasks"
        icon={<Inbox className="w-4 h-4 text-muted-foreground" />}
        truckNumber={truckNumberCanonical}
        endpointPath="receive-tasks"
        testId="wms-receive-tasks"
      />

      <WmsTaskSection
        title="Return Tasks"
        icon={<Undo2 className="w-4 h-4 text-muted-foreground" />}
        truckNumber={truckNumberCanonical}
        endpointPath="return-tasks"
        testId="wms-return-tasks"
      />

      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
        WMS task payload shapes will be tightened once the first real responses are observed in dev.
      </div>
    </div>
  );
}
