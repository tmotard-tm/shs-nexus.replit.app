import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MapPin, Car, Truck, CheckCircle, XCircle, X, Filter, ZoomIn, ZoomOut, RotateCcw, Compass } from "lucide-react";
import { activeVehicles, type FleetVehicle } from "@/data/fleetData";
import L from "leaflet";

interface VehicleMapProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// State coordinates for positioning vehicles on map (lat, lng)
const stateCoordinates: { [key: string]: { lat: number; lng: number } } = {
  "AL": { lat: 32.3, lng: -86.8 }, "AK": { lat: 64.2, lng: -154.0 }, "AZ": { lat: 34.0, lng: -112.1 },
  "AR": { lat: 34.7, lng: -92.2 }, "CA": { lat: 36.8, lng: -119.4 }, "CO": { lat: 39.0, lng: -105.5 },
  "CT": { lat: 41.6, lng: -72.7 }, "DE": { lat: 39.3, lng: -75.5 }, "FL": { lat: 27.8, lng: -81.5 },
  "GA": { lat: 32.2, lng: -83.5 }, "HI": { lat: 21.3, lng: -157.8 }, "ID": { lat: 44.2, lng: -114.7 },
  "IL": { lat: 40.0, lng: -89.4 }, "IN": { lat: 39.8, lng: -86.1 }, "IA": { lat: 41.6, lng: -93.6 },
  "KS": { lat: 38.5, lng: -98.5 }, "KY": { lat: 37.8, lng: -84.9 }, "LA": { lat: 30.4, lng: -92.2 },
  "ME": { lat: 44.3, lng: -69.8 }, "MD": { lat: 39.0, lng: -76.5 }, "MA": { lat: 42.2, lng: -71.5 },
  "MI": { lat: 43.3, lng: -84.5 }, "MN": { lat: 45.1, lng: -95.0 }, "MS": { lat: 32.7, lng: -89.4 },
  "MO": { lat: 38.4, lng: -92.6 }, "MT": { lat: 47.1, lng: -110.4 }, "NE": { lat: 41.1, lng: -99.9 },
  "NV": { lat: 38.3, lng: -117.1 }, "NH": { lat: 43.4, lng: -71.5 }, "NJ": { lat: 40.3, lng: -74.7 },
  "NM": { lat: 34.8, lng: -106.2 }, "NY": { lat: 42.2, lng: -74.9 }, "NC": { lat: 35.8, lng: -79.0 },
  "ND": { lat: 47.5, lng: -100.8 }, "OH": { lat: 40.4, lng: -82.8 }, "OK": { lat: 35.5, lng: -97.5 },
  "OR": { lat: 44.9, lng: -122.1 }, "PA": { lat: 40.3, lng: -77.2 }, "RI": { lat: 41.7, lng: -71.4 },
  "SC": { lat: 33.8, lng: -80.9 }, "SD": { lat: 44.5, lng: -99.9 }, "TN": { lat: 35.7, lng: -86.7 },
  "TX": { lat: 31.1, lng: -97.8 }, "UT": { lat: 40.2, lng: -111.9 }, "VT": { lat: 44.0, lng: -72.6 },
  "VA": { lat: 37.7, lng: -78.2 }, "WA": { lat: 47.4, lng: -121.5 }, "WV": { lat: 38.5, lng: -80.9 },
  "WI": { lat: 44.3, lng: -89.6 }, "WY": { lat: 42.8, lng: -107.3 }, "PR": { lat: 18.2, lng: -66.5 }
};

// Vehicle status categories with colors (per Mapbox requirements)
const vehicleStatuses = {
  "assigned": { label: "Assigned", color: "#3b82f6" },      // Blue
  "maintenance": { label: "In Repair", color: "#ef4444" }, // Red  
  "available": { label: "Available", color: "#22c55e" },   // Green
  "reserved": { label: "Reserved", color: "#06b6d4" },     // Light Blue
  "declined": { label: "Declined", color: "#f97316" },     // Orange
  "auction": { label: "Sent to Auction", color: "#f59e0b" } // Amber
};

// Data safety: Clean and validate coordinates
const validateCoordinates = (lat: number, lng: number): { lat: number; lng: number } => {
  // If longitude is positive but looks like US/PR/Hawaii, make it negative
  if (lng > 0 && lng >= 50 && lng <= 180) {
    lng = -lng;
  }
  
  // If values look swapped (lat around -100, lng around 20-50), swap them
  if (lat < -90 && lng > 20 && lng < 50) {
    [lat, lng] = [lng, lat];
  }
  
  return { lat, lng };
};

export function VehicleMap({ open, onOpenChange }: VehicleMapProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // Assign vehicle status based on various conditions
  const getVehicleStatus = (vehicle: FleetVehicle) => {
    if (vehicle.outOfServiceDate) return "auction";
    if (vehicle.tuneStatus === "Needs Repair") return "maintenance"; 
    if (vehicle.tuneStatus === "Declined") return "declined";
    if (!vehicle.outOfServiceDate && vehicle.branding === "Sears") return "assigned";
    if (vehicle.branding === "Reserved") return "reserved";
    return "available";
  };

  // Enhanced geocoding system to convert delivery addresses to map coordinates  
  const getDeliveryAddressPosition = (vehicle: FleetVehicle) => {
    const stateCoord = stateCoordinates[vehicle.state];
    if (!stateCoord) return { lat: 39.8, lng: -98.5 }; // Default center US position
    
    // Start with base state coordinates
    let baseLat = stateCoord.lat;
    let baseLng = stateCoord.lng;
    
    // Add randomization based on delivery address to spread vehicles within the state
    const addressHash = vehicle.deliveryAddress.split('').reduce((hash, char) => {
      return char.charCodeAt(0) + ((hash << 5) - hash);
    }, 0);
    
    // Use hash to create consistent but varied positioning within state bounds
    const spreadLat = (addressHash % 100) / 100 * 0.5 - 0.25; // ±0.25° spread
    const spreadLng = ((addressHash >> 8) % 100) / 100 * 0.5 - 0.25; // ±0.25° spread
    
    const coordinates = {
      lat: baseLat + spreadLat,
      lng: baseLng + spreadLng
    };
    
    // Apply data safety validation
    return validateCoordinates(coordinates.lat, coordinates.lng);
  };

  // Process vehicles with validated coordinates
  const vehiclePositions = activeVehicles
    .map(vehicle => {
      const position = getDeliveryAddressPosition(vehicle);
      const status = getVehicleStatus(vehicle);
      
      // Drop any row with missing/invalid lat/lng
      if (!position.lat || !position.lng || 
          Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
        return null;
      }
      
      return {
        ...vehicle,
        position,
        status,
        id: vehicle.vin,
        label: `${vehicle.city}, ${vehicle.state}`
      };
    })
    .filter(Boolean) as (FleetVehicle & { 
      position: { lat: number; lng: number }; 
      status: string;
      id: string;
      label: string;
    })[];

  // Apply filters
  const filteredVehicles = vehiclePositions.filter(vehicle => {
    if (statusFilter !== "all" && vehicle.status !== statusFilter) return false;
    if (brandingFilter !== "all" && vehicle.branding !== brandingFilter) return false;
    if (regionFilter !== "all" && vehicle.region !== regionFilter) return false;
    return true;
  });

  // Group vehicles by status for counts
  const statusCounts = Object.keys(vehicleStatuses).reduce((acc, status) => {
    acc[status] = filteredVehicles.filter(v => v.status === status).length;
    return acc;
  }, {} as Record<string, number>);

  // Get unique values for filters (filter out empty/null values)
  const brandingOptions = Array.from(new Set(activeVehicles.map(v => v.branding).filter(b => b && b.trim()))).sort();
  const regionOptions = Array.from(new Set(activeVehicles.map(v => v.region).filter(r => r && r.trim()))).sort();

  // Initialize professional OpenStreetMap
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current || !open) return;

    const timer = setTimeout(() => {
      if (!mapRef.current) return;

      try {
        // Create map with professional dark-themed tiles
        const map = L.map(mapRef.current, {
          zoomControl: false,
          attributionControl: true,
        }).setView([39.8, -98.5], 4);

        // Use CartoDB Dark Matter for professional dark appearance
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap contributors © CARTO',
          maxZoom: 19,
          minZoom: 3
        }).addTo(map);

        // Add professional zoom control with custom styling
        const zoomControl = L.control.zoom({ position: 'topleft' }).addTo(map);

        // Create markers layer
        const markersLayer = L.layerGroup().addTo(map);

        leafletMapRef.current = map;
        markersRef.current = markersLayer;

        // Auto-fit to all vehicles with padding
        setTimeout(() => {
          map.invalidateSize();
          if (filteredVehicles.length > 0) {
            const group = new L.FeatureGroup(filteredVehicles.map(vehicle => 
              L.marker([vehicle.position.lat, vehicle.position.lng])
            ));
            map.fitBounds(group.getBounds().pad(0.05));
          }
        }, 100);

      } catch (error) {
        console.error('Error initializing map:', error);
      }
    }, 100);

    return () => {
      if (timer) clearTimeout(timer);
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markersRef.current = null;
      }
    };
  }, [open]);

  // Update markers when vehicles or filters change
  useEffect(() => {
    if (!leafletMapRef.current || !markersRef.current) return;

    // Clear existing markers
    markersRef.current.clearLayers();

    // Add new professional markers
    filteredVehicles.forEach((vehicle) => {
      const status = vehicleStatuses[vehicle.status as keyof typeof vehicleStatuses];
      if (!status) return;

      // Create professional marker with dark theme styling
      const icon = L.divIcon({
        html: `<div style="
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background-color: ${status.color};
          border: 2px solid #000;
          box-shadow: 0 0 6px rgba(0,0,0,0.8);
          transition: all 0.2s;
        "></div>`,
        className: 'vehicle-marker-professional',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      // Professional popup styling
      const marker = L.marker([vehicle.position.lat, vehicle.position.lng], { icon })
        .bindPopup(`
          <div style="
            min-width: 200px; 
            font-family: system-ui, sans-serif;
            background: #1a1a1a;
            color: #fff;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid #333;
          ">
            <strong style="color: ${status.color};">${vehicle.id}</strong><br/>
            <strong>Status:</strong> ${status.label}<br/>
            <strong>Location:</strong> ${vehicle.label}<br/>
            <small style="opacity: 0.7;">Click for more details</small>
          </div>
        `, {
          className: 'professional-popup'
        })
        .on('click', () => setSelectedVehicle(vehicle));

      markersRef.current?.addLayer(marker);
    });

    // Auto-fit bounds when vehicles change
    if (filteredVehicles.length > 0 && leafletMapRef.current) {
      const group = new L.FeatureGroup(
        filteredVehicles.map(vehicle => 
          L.marker([vehicle.position.lat, vehicle.position.lng])
        )
      );
      leafletMapRef.current.fitBounds(group.getBounds().pad(0.05));
    }
  }, [filteredVehicles]);

  const handleZoomIn = () => {
    if (leafletMapRef.current) {
      leafletMapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (leafletMapRef.current) {
      leafletMapRef.current.zoomOut();
    }
  };

  const handleResetView = () => {
    if (leafletMapRef.current && filteredVehicles.length > 0) {
      const group = new L.FeatureGroup(
        filteredVehicles.map(vehicle => 
          L.marker([vehicle.position.lat, vehicle.position.lng])
        )
      );
      leafletMapRef.current.fitBounds(group.getBounds().pad(0.05));
    } else if (leafletMapRef.current) {
      leafletMapRef.current.setView([39.8, -98.5], 4);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            TRUCK STATUS
          </DialogTitle>
          <DialogDescription>
            Interactive fleet tracking with real-time status updates
          </DialogDescription>
        </DialogHeader>

        {/* Status Legend Bar */}
        <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg border">
          {Object.entries(vehicleStatuses).map(([key, status]) => (
            <div key={key} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: status.color }}
              ></div>
              <span className="text-sm font-medium">{status.label}</span>
              <span className="text-sm text-muted-foreground">({statusCounts[key] || 0})</span>
            </div>
          ))}
        </div>
        
        <div className="flex gap-4 h-[75vh]">
          {/* Interactive Map Container */}
          <div className="flex-1 relative rounded-lg overflow-hidden border">
            {/* Zoom Controls */}
            <div className="absolute top-4 left-4 z-[1000] bg-white rounded-lg shadow-md border">
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none rounded-t-lg px-2 py-1"
                  onClick={handleZoomIn}
                  data-testid="button-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none px-2 py-1"
                  onClick={handleZoomOut}
                  data-testid="button-zoom-out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none rounded-b-lg px-2 py-1 border-t"
                  onClick={handleResetView}
                  data-testid="button-reset-view"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Leaflet Map */}
            <div 
              ref={mapRef} 
              className="w-full h-full"
              style={{ 
                zIndex: 1,
                minHeight: '600px',
                width: '100%',
                height: '100%'
              }}
            />
          </div>

          {/* Filter Panel */}
          <Card className="w-80 h-fit">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4" />
                <span className="font-medium">Filter Options</span>
              </div>

              <div>
                <Label htmlFor="status-filter" className="text-sm font-medium">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger id="status-filter" className="w-full">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(vehicleStatuses).map(([key, status]) => (
                      <SelectItem key={key} value={key}>{status.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="branding-filter" className="text-sm font-medium">Branding</Label>
                <Select value={brandingFilter} onValueChange={setBrandingFilter}>
                  <SelectTrigger id="branding-filter" className="w-full">
                    <SelectValue placeholder="All Branding" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branding</SelectItem>
                    {brandingOptions.map(branding => (
                      <SelectItem key={branding} value={branding}>{branding}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="region-filter" className="text-sm font-medium">Region</Label>
                <Select value={regionFilter} onValueChange={setRegionFilter}>
                  <SelectTrigger id="region-filter" className="w-full">
                    <SelectValue placeholder="All Regions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Regions</SelectItem>
                    {regionOptions.map(region => (
                      <SelectItem key={region} value={region}>{region}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4 space-y-2">
                <div className="text-sm font-medium">Fleet Summary</div>
                <div className="text-sm text-muted-foreground">
                  Total Vehicles: {filteredVehicles.length}
                </div>
                <div className="text-sm text-muted-foreground">
                  Active on Map: {filteredVehicles.length}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Vehicle Details Dialog */}
        {selectedVehicle && (
          <Dialog open={!!selectedVehicle} onOpenChange={() => setSelectedVehicle(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-primary" />
                  {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
                </DialogTitle>
                <DialogDescription>
                  Vehicle details and current status
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">VIN</Label>
                    <div className="text-sm">{selectedVehicle.vin}</div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Status</Label>
                    <div className="text-sm flex items-center gap-2">
                      <div 
                        className="w-2 h-2 rounded-full" 
                        style={{ 
                          backgroundColor: vehicleStatuses[getVehicleStatus(selectedVehicle) as keyof typeof vehicleStatuses]?.color 
                        }}
                      />
                      {vehicleStatuses[getVehicleStatus(selectedVehicle) as keyof typeof vehicleStatuses]?.label}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Location</Label>
                    <div className="text-sm">{selectedVehicle.city}, {selectedVehicle.state}</div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Mileage</Label>
                    <div className="text-sm">{selectedVehicle.odometerDelivery?.toLocaleString() || 'N/A'} miles</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Branding</Label>
                    <div className="text-sm">{selectedVehicle.branding || 'None'}</div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Region</Label>
                    <div className="text-sm">{selectedVehicle.region || 'N/A'}</div>
                  </div>
                </div>

                {selectedVehicle.tuneStatus && (
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Tune Status</Label>
                    <div className="text-sm">{selectedVehicle.tuneStatus}</div>
                  </div>
                )}

                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Delivery Address</Label>
                  <div className="text-sm">{selectedVehicle.deliveryAddress}</div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}