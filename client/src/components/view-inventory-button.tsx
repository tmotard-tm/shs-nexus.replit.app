import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Package, DollarSign, Loader2, AlertCircle, Boxes } from "lucide-react";

interface InventorySummary {
  truck: string;
  totalPieces: number;
  totalAvgCost: string;
  itemCount: number;
  extractDate: string | null;
}

interface ViewInventoryButtonProps {
  vehicleNumber: string;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export function ViewInventoryButton({ 
  vehicleNumber, 
  variant = "outline", 
  size = "sm",
  className = ""
}: ViewInventoryButtonProps) {
  const [open, setOpen] = useState(false);

  const cleanVehicleNumber = vehicleNumber?.replace(/^0+/, '') || '';

  const { data: inventory, isLoading, error } = useQuery<InventorySummary>({
    queryKey: ['/api/truck-inventory/summary', cleanVehicleNumber],
    enabled: open && !!cleanVehicleNumber,
  });

  if (!vehicleNumber || vehicleNumber === 'TBD' || vehicleNumber === 'N/A') {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant={variant} 
          size={size} 
          className={className}
          data-testid={`btn-view-inventory-${cleanVehicleNumber}`}
        >
          <Package className="h-4 w-4 mr-1" />
          View Inventory
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            Truck {cleanVehicleNumber} Inventory
          </DialogTitle>
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
                        <p className="text-sm text-muted-foreground">Total Avg Cost</p>
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
                {inventory.extractDate && (
                  <div className="flex justify-between mt-1">
                    <span>Data as of:</span>
                    <span className="font-medium">{new Date(inventory.extractDate).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
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
