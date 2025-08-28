import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Car, Truck, CheckCircle, XCircle, X } from "lucide-react";
import { activeVehicles, type FleetVehicle } from "@/data/fleetData";

interface VehicleMapProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// State coordinates for positioning vehicles on map
const stateCoordinates: { [key: string]: { x: number; y: number } } = {
  "AL": { x: 86.8, y: 32.3 }, "AK": { x: 154.0, y: 64.2 }, "AZ": { x: 112.1, y: 34.0 },
  "AR": { x: 92.2, y: 34.7 }, "CA": { x: 119.4, y: 36.8 }, "CO": { x: 105.5, y: 39.0 },
  "CT": { x: 72.7, y: 41.6 }, "DE": { x: 75.5, y: 39.3 }, "FL": { x: 81.5, y: 27.8 },
  "GA": { x: 83.5, y: 32.2 }, "HI": { x: 157.8, y: 21.3 }, "ID": { x: 114.7, y: 44.2 },
  "IL": { x: 89.4, y: 40.0 }, "IN": { x: 86.1, y: 39.8 }, "IA": { x: 93.6, y: 41.6 },
  "KS": { x: 98.5, y: 38.5 }, "KY": { x: 84.9, y: 37.8 }, "LA": { x: 92.2, y: 30.4 },
  "ME": { x: 69.8, y: 44.3 }, "MD": { x: 76.5, y: 39.0 }, "MA": { x: 71.5, y: 42.2 },
  "MI": { x: 84.5, y: 43.3 }, "MN": { x: 95.0, y: 45.1 }, "MS": { x: 89.4, y: 32.7 },
  "MO": { x: 92.6, y: 38.4 }, "MT": { x: 110.4, y: 47.1 }, "NE": { x: 99.9, y: 41.1 },
  "NV": { x: 117.1, y: 38.3 }, "NH": { x: 71.5, y: 43.4 }, "NJ": { x: 74.7, y: 40.3 },
  "NM": { x: 106.2, y: 34.8 }, "NY": { x: 74.9, y: 42.2 }, "NC": { x: 79.0, y: 35.8 },
  "ND": { x: 100.8, y: 47.5 }, "OH": { x: 82.8, y: 40.4 }, "OK": { x: 97.5, y: 35.5 },
  "OR": { x: 122.1, y: 44.9 }, "PA": { x: 77.2, y: 40.3 }, "RI": { x: 71.4, y: 41.7 },
  "SC": { x: 80.9, y: 33.8 }, "SD": { x: 99.9, y: 44.5 }, "TN": { x: 86.7, y: 35.7 },
  "TX": { x: 97.8, y: 31.1 }, "UT": { x: 111.9, y: 40.2 }, "VT": { x: 72.6, y: 44.0 },
  "VA": { x: 78.2, y: 37.7 }, "WA": { x: 121.5, y: 47.4 }, "WV": { x: 80.9, y: 38.5 },
  "WI": { x: 89.6, y: 44.3 }, "WY": { x: 107.3, y: 42.8 }
};

export function VehicleMap({ open, onOpenChange }: VehicleMapProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [hoveredVehicle, setHoveredVehicle] = useState<FleetVehicle | null>(null);

  // Convert longitude/latitude to map coordinates (simplified projection)
  const getMapPosition = (vehicle: FleetVehicle) => {
    const stateCoord = stateCoordinates[vehicle.state];
    if (!stateCoord) return { x: 50, y: 50 }; // Default center position
    
    // Convert to percentage for positioning on our 800x500 map
    const x = ((stateCoord.x + 180) / 360) * 100;
    const y = ((90 - stateCoord.y) / 180) * 100;
    
    // Add some random offset to prevent overlapping markers in same state
    const offsetX = (Math.random() - 0.5) * 3;
    const offsetY = (Math.random() - 0.5) * 3;
    
    return { 
      x: Math.max(2, Math.min(98, x + offsetX)), 
      y: Math.max(2, Math.min(98, y + offsetY)) 
    };
  };

  const vehiclePositions = activeVehicles.map(vehicle => ({
    ...vehicle,
    position: getMapPosition(vehicle)
  }));

  const assignedVehicles = vehiclePositions.filter(v => !v.outOfServiceDate);
  const unassignedVehicles = vehiclePositions.filter(v => v.outOfServiceDate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Vehicle Locations Map
          </DialogTitle>
          <DialogDescription>
            View all active vehicles on the map. Green markers show assigned vehicles, red markers show unassigned vehicles.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex gap-4 h-[70vh]">
          {/* Map Container */}
          <div className="flex-1 relative bg-slate-100 rounded-lg overflow-hidden border">
            {/* Simple US Map Background */}
            <div 
              className="w-full h-full relative bg-gradient-to-b from-blue-100 to-green-100"
              style={{
                backgroundImage: `
                  radial-gradient(circle at 30% 40%, rgba(34, 139, 34, 0.1) 0%, transparent 50%),
                  radial-gradient(circle at 70% 30%, rgba(139, 69, 19, 0.1) 0%, transparent 50%),
                  radial-gradient(circle at 50% 70%, rgba(255, 215, 0, 0.1) 0%, transparent 50%)
                `
              }}
            >
              {/* Map Title */}
              <div className="absolute top-4 left-4 bg-white/90 px-3 py-2 rounded-lg shadow">
                <h3 className="text-sm font-semibold">United States Vehicle Distribution</h3>
                <p className="text-xs text-muted-foreground">
                  {assignedVehicles.length} Assigned • {unassignedVehicles.length} Unassigned
                </p>
              </div>

              {/* Legend */}
              <div className="absolute top-4 right-4 bg-white/90 px-3 py-2 rounded-lg shadow space-y-2">
                <h4 className="text-xs font-semibold">Legend</h4>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span>Assigned ({assignedVehicles.length})</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span>Unassigned ({unassignedVehicles.length})</span>
                </div>
              </div>
              
              {/* Vehicle Markers */}
              {vehiclePositions.map((vehicle, index) => {
                const isAssigned = !vehicle.outOfServiceDate;
                return (
                  <div
                    key={vehicle.vin}
                    className={`absolute w-4 h-4 rounded-full cursor-pointer transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200 hover:scale-125 hover:z-10 ${
                      isAssigned ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'
                    } shadow-lg border-2 border-white`}
                    style={{
                      left: `${vehicle.position.x}%`,
                      top: `${vehicle.position.y}%`,
                      zIndex: hoveredVehicle?.vin === vehicle.vin ? 20 : 10
                    }}
                    onMouseEnter={() => setHoveredVehicle(vehicle)}
                    onMouseLeave={() => setHoveredVehicle(null)}
                    onClick={() => setSelectedVehicle(vehicle)}
                    data-testid={`map-marker-${vehicle.vin}`}
                  >
                    {/* Hover Tooltip */}
                    {hoveredVehicle?.vin === vehicle.vin && (
                      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-xs px-3 py-2 rounded-lg shadow-lg whitespace-nowrap z-30 pointer-events-none">
                        <div className="font-semibold">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</div>
                        <div>{vehicle.licensePlate}</div>
                        <div className="flex items-center gap-1">
                          {isAssigned ? (
                            <>
                              <CheckCircle className="h-3 w-3 text-green-400" />
                              <span className="text-green-400">Assigned</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 text-red-400" />
                              <span className="text-red-400">Unassigned</span>
                            </>
                          )}
                        </div>
                        <div className="text-gray-300">{vehicle.city}, {vehicle.state}</div>
                        {/* Tooltip arrow */}
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/90"></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Vehicle Details Sidebar */}
          {selectedVehicle && (
            <div className="w-80 bg-white rounded-lg border shadow-sm">
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-semibold">Vehicle Details</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedVehicle(null)}
                  data-testid="button-close-vehicle-details"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Vehicle Info */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Vehicle #{selectedVehicle.vehicleNumber}</p>
                    <p>VIN: {selectedVehicle.vin}</p>
                    <p>License: {selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
                    <p>Color: {selectedVehicle.color}</p>
                  </div>
                </div>

                {/* Assignment Status */}
                <div className="p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-2">
                    {!selectedVehicle.outOfServiceDate ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium text-green-600">Assigned</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium text-red-600">Unassigned</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          Since: {new Date(selectedVehicle.outOfServiceDate).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Location Info */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">Location</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>{selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}</p>
                    <p>Region: {selectedVehicle.region}</p>
                    <p>District: {selectedVehicle.district}</p>
                  </div>
                </div>

                {/* Vehicle Specifications */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">Specifications</span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Branding: {selectedVehicle.branding}</p>
                    <p>Interior: {selectedVehicle.interior}</p>
                    <p>Tune Status: {selectedVehicle.tuneStatus}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}