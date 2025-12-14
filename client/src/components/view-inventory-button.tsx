import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, DollarSign, Loader2, AlertCircle, Boxes, Search, Filter } from "lucide-react";

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

interface ViewInventoryButtonProps {
  vehicleNumber: string;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  showSummary?: boolean;
}

export function ViewInventoryButton({ 
  vehicleNumber, 
  variant = "outline", 
  size = "sm",
  className = "",
  showSummary = false
}: ViewInventoryButtonProps) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const cleanVehicleNumber = vehicleNumber?.replace(/^0+/, '') || '';

  const { data: inventory, isLoading, error } = useQuery<InventorySummary>({
    queryKey: ['/api/truck-inventory/summary', cleanVehicleNumber],
    enabled: (showSummary || open) && !!cleanVehicleNumber,
  });

  const categories = useMemo(() => {
    if (!inventory?.items) return [];
    const catSet = new Set(inventory.items.map(i => i.category).filter(Boolean));
    return Array.from(catSet).sort();
  }, [inventory?.items]);

  const primaryCategory = useMemo(() => {
    if (!inventory?.items || inventory.items.length === 0) return null;
    const categoryCounts: Record<string, number> = {};
    inventory.items.forEach(item => {
      if (item.category) {
        categoryCounts[item.category] = (categoryCounts[item.category] || 0) + item.qty;
      }
    });
    let maxCategory = '';
    let maxCount = 0;
    Object.entries(categoryCounts).forEach(([cat, count]) => {
      if (count > maxCount) {
        maxCount = count;
        maxCategory = cat;
      }
    });
    return maxCategory || null;
  }, [inventory?.items]);

  const filteredItems = useMemo(() => {
    if (!inventory?.items) return [];
    
    return inventory.items.filter(item => {
      const matchesSearch = !searchTerm || 
        item.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.partNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.partDesc?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
  }, [inventory?.items, searchTerm, categoryFilter]);

  const filteredTotals = useMemo(() => {
    const totalPieces = filteredItems.reduce((sum, item) => sum + item.qty, 0);
    const totalCost = filteredItems.reduce((sum, item) => sum + item.extCost, 0);
    return { totalPieces, totalCost };
  }, [filteredItems]);

  if (!vehicleNumber || vehicleNumber === 'TBD' || vehicleNumber === 'N/A') {
    return null;
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }
    return dateStr;
  };

  const formatCurrency = (value: number | string | undefined | null) => {
    if (value === undefined || value === null || value === '') return '$0';
    let num: number;
    if (typeof value === 'string') {
      const cleanedValue = value.replace(/,/g, '');
      num = parseFloat(cleanedValue);
    } else {
      num = value;
    }
    if (isNaN(num)) return '$0';
    if (num >= 1000) {
      return `$${(num / 1000).toFixed(1)}k`;
    }
    return `$${num.toFixed(0)}`;
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchTerm("");
      setCategoryFilter("all");
    }
  };

  const renderButtonContent = () => {
    if (showSummary) {
      if (error) {
        return (
          <div className="flex items-center gap-3 text-left min-w-[180px]">
            <Package className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col">
              <span className="text-xs font-medium">View Inventory</span>
              <span className="text-xs text-red-500">Error loading</span>
            </div>
          </div>
        );
      }

      if (inventory) {
        const pieces = inventory.totalPieces || 0;
        const costValue = formatCurrency(inventory.totalAvgCost);
        return (
          <div className="flex items-center gap-3 text-left min-w-[180px]">
            <Package className="h-4 w-4 flex-shrink-0" />
            <div className="flex flex-col">
              <span className="text-xs font-medium">View Inventory</span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{pieces.toLocaleString()} pcs</span>
                <span>•</span>
                <span>{costValue}</span>
                {primaryCategory && (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[80px]" title={primaryCategory}>
                      {primaryCategory.length > 12 ? primaryCategory.substring(0, 10) + '...' : primaryCategory}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-center gap-3 text-left min-w-[180px]">
          <Package className="h-4 w-4 flex-shrink-0" />
          <div className="flex flex-col">
            <span className="text-xs font-medium">View Inventory</span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <Package className="h-4 w-4 mr-1" />
        View Inventory
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button 
          variant={variant} 
          size={showSummary ? "default" : size} 
          className={`${className} ${showSummary ? 'h-auto py-2 px-3' : ''}`}
          data-testid={`btn-view-inventory-${cleanVehicleNumber}`}
        >
          {renderButtonContent()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            Truck {cleanVehicleNumber} Inventory
          </DialogTitle>
          <DialogDescription>
            Parts and inventory on this truck (using NS_AVG_COST)
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          
          {error && (
            <div className="flex items-center gap-2 text-destructive py-4">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load inventory data</span>
            </div>
          )}
          
          {inventory && !isLoading && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                        <Package className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Pieces</p>
                        <p className="text-2xl font-bold" data-testid="inventory-total-pieces">
                          {inventory.totalPieces.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                        <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Ext Cost</p>
                        <p className="text-2xl font-bold" data-testid="inventory-total-cost">
                          ${parseFloat(inventory.totalAvgCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              <div className="text-sm text-muted-foreground border-t pt-3">
                <div className="flex justify-between">
                  <span>Unique SKUs:</span>
                  <span className="font-medium">{inventory.itemCount.toLocaleString()}</span>
                </div>
                {primaryCategory && (
                  <div className="flex justify-between mt-1">
                    <span>Primary Category:</span>
                    <span className="font-medium">{primaryCategory}</span>
                  </div>
                )}
                {inventory.extractDate && (
                  <div className="flex justify-between mt-1">
                    <span>Data as of:</span>
                    <span className="font-medium">{formatDate(inventory.extractDate)}</span>
                  </div>
                )}
              </div>

              {inventory.items && inventory.items.length > 0 && (
                <div className="border rounded-lg">
                  <div className="bg-muted px-3 py-2 border-b">
                    <div className="flex items-center justify-between gap-4">
                      <h4 className="text-sm font-semibold">Inventory Details</h4>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search SKU, Part..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 h-8 w-40 text-xs"
                            data-testid="input-inventory-search"
                          />
                        </div>
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                          <SelectTrigger className="h-8 w-40 text-xs" data-testid="select-category-filter">
                            <Filter className="h-3 w-3 mr-1" />
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
                    </div>
                    {(searchTerm || categoryFilter !== "all") && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Showing {filteredItems.length} of {inventory.items.length} items 
                        ({filteredTotals.totalPieces} pcs, ${filteredTotals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                      </div>
                    )}
                  </div>
                  <ScrollArea className="h-[280px]">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">SKU / Part</th>
                          <th className="text-left px-3 py-2 font-medium">Category</th>
                          <th className="text-right px-3 py-2 font-medium">Qty</th>
                          <th className="text-right px-3 py-2 font-medium">Unit Cost</th>
                          <th className="text-right px-3 py-2 font-medium">Ext Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-8 text-muted-foreground">
                              No items match your filters
                            </td>
                          </tr>
                        ) : (
                          filteredItems.map((item, idx) => (
                            <tr key={`${item.sku}-${item.bin}-${idx}`} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="px-3 py-2">
                                <div className="font-mono text-xs">{item.sku}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[180px]" title={item.partDesc}>
                                  {item.partDesc || item.partNo}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className="text-xs text-muted-foreground truncate block max-w-[100px]" title={item.category}>
                                  {item.category || '-'}
                                </span>
                              </td>
                              <td className="text-right px-3 py-2 font-medium">{item.qty}</td>
                              <td className="text-right px-3 py-2 text-muted-foreground">
                                ${item.unitCost.toFixed(2)}
                              </td>
                              <td className="text-right px-3 py-2 font-medium text-green-600 dark:text-green-400">
                                ${item.extCost.toFixed(2)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>
              )}
            </>
          )}
          
          {inventory && inventory.itemCount === 0 && !isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No inventory data available for this truck</p>
              <p className="text-xs mt-1">Run a Snowflake sync to update inventory data</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
