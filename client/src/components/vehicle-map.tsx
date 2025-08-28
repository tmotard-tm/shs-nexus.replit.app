import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MapPin, Car, Truck, CheckCircle, XCircle, X, Filter, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
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

// Vehicle status categories with colors
const vehicleStatuses = {
  "assigned": { label: "Assigned to Tech", color: "#3b82f6", bgColor: "bg-blue-500" },
  "maintenance": { label: "In Repair", color: "#ef4444", bgColor: "bg-red-500" },
  "available": { label: "Available", color: "#10b981", bgColor: "bg-emerald-500" },
  "reserved": { label: "Reserved for New Hire", color: "#22c55e", bgColor: "bg-green-500" },
  "auction": { label: "Sent to Auction", color: "#f59e0b", bgColor: "bg-amber-500" },
  "declined": { label: "Declined Repair", color: "#f97316", bgColor: "bg-orange-500" }
};

export function VehicleMap({ open, onOpenChange }: VehicleMapProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [hoveredVehicle, setHoveredVehicle] = useState<FleetVehicle | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandingFilter, setBrandingFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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
    if (!stateCoord) return { x: 50, y: 50 }; // Default center position
    
    // Start with base state coordinates
    let baseX = stateCoord.x;
    let baseY = stateCoord.y;
    
    // Create deterministic but varied positioning based on address
    const addressHash = vehicle.deliveryAddress + vehicle.city + vehicle.zip;
    let hash = 0;
    for (let i = 0; i < addressHash.length; i++) {
      const char = addressHash.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Use hash to create consistent positioning within city/region
    const normalizedHash = Math.abs(hash) / 2147483647; // Normalize to 0-1
    
    // Adjust coordinates based on city name for better distribution
    let cityOffsetX = 0;
    let cityOffsetY = 0;
    
    const cityLower = vehicle.city.toLowerCase();
    // Major city adjustments for better geographic accuracy
    if (cityLower.includes('los angeles') || cityLower.includes('la')) {
      cityOffsetX = -1.5; cityOffsetY = 0.5;
    } else if (cityLower.includes('san francisco') || cityLower.includes('oakland')) {
      cityOffsetX = -2; cityOffsetY = -1;
    } else if (cityLower.includes('new york') || cityLower.includes('bronx') || cityLower.includes('brooklyn')) {
      cityOffsetX = 1; cityOffsetY = -0.5;
    } else if (cityLower.includes('chicago')) {
      cityOffsetX = -1; cityOffsetY = -1.5;
    } else if (cityLower.includes('houston')) {
      cityOffsetX = -1.5; cityOffsetY = 1;
    } else if (cityLower.includes('phoenix')) {
      cityOffsetX = -2; cityOffsetY = 0.5;
    } else if (cityLower.includes('philadelphia')) {
      cityOffsetX = 0.8; cityOffsetY = -0.3;
    } else if (cityLower.includes('miami') || cityLower.includes('fort lauderdale')) {
      cityOffsetX = 0.5; cityOffsetY = 2;
    }
    
    // Apply city offset and address-specific variation
    const addressVariationX = (normalizedHash - 0.5) * 0.5; // ±0.25 degree variation
    const addressVariationY = ((normalizedHash * 7) % 1 - 0.5) * 0.5; // Different variation for Y
    
    const finalX = baseX + cityOffsetX + addressVariationX;
    const finalY = baseY + cityOffsetY + addressVariationY;
    
    // Convert to percentage for positioning on our map
    const x = ((finalX + 180) / 360) * 100;
    const y = ((90 - finalY) / 180) * 100;
    
    return { 
      x: Math.max(1, Math.min(99, x)), 
      y: Math.max(1, Math.min(99, y)) 
    };
  };

  const vehiclePositions = activeVehicles.map(vehicle => ({
    ...vehicle,
    position: getDeliveryAddressPosition(vehicle),
    status: getVehicleStatus(vehicle)
  }));

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

  // Zoom and pan handlers
  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.5, 0.5));
  const handleResetView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanX(e.clientX - dragStart.x);
    setPanY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
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
          <div className="flex-1 relative rounded-lg overflow-hidden border bg-blue-50">
            {/* Zoom Controls */}
            <div className="absolute top-4 left-4 z-20 bg-white rounded-lg shadow-md border">
              <div className="flex flex-col">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none rounded-t-lg px-2 py-1"
                  onClick={handleZoomIn}
                  disabled={zoom >= 3}
                  data-testid="button-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <div className="px-2 py-1 text-xs text-center border-t border-b bg-gray-50 min-w-[3rem]">
                  {Math.round(zoom * 100)}%
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none px-2 py-1"
                  onClick={handleZoomOut}
                  disabled={zoom <= 0.5}
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

            {/* Map Container with Pan and Zoom */}
            <div 
              className="w-full h-full relative cursor-move"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ 
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.2s ease-out'
              }}
            >
              {/* Clean US Map */}
              <svg 
                className="absolute inset-0 w-full h-full" 
                viewBox="0 0 1000 700" 
                style={{ zIndex: 1 }}
              >
                {/* Ocean/Background */}
                <rect width="1000" height="700" fill="#e0f7fa" />
                
                {/* United States Outline */}
                <path
                  d="M 150 200 L 200 180 L 280 170 L 350 165 L 420 160 L 490 155 L 560 160 L 630 165 L 700 175 L 750 190 L 800 210 L 820 250 L 815 290 L 800 330 L 780 370 L 750 400 L 700 430 L 650 450 L 600 460 L 550 465 L 500 470 L 450 465 L 400 460 L 350 450 L 300 440 L 250 425 L 200 405 L 170 380 L 150 350 L 145 320 L 150 290 L 155 260 L 150 230 Z"
                  fill="#f1f8e9"
                  stroke="#2e7d32"
                  strokeWidth="2"
                />
                
                {/* State Boundaries - Simple Grid */}
                <g stroke="#4caf50" strokeWidth="1" opacity="0.4" fill="none">
                  {/* Vertical Lines */}
                  <line x1="220" y1="170" x2="220" y2="450" />
                  <line x1="300" y1="165" x2="300" y2="460" />
                  <line x1="380" y1="160" x2="380" y2="465" />
                  <line x1="460" y1="155" x2="460" y2="470" />
                  <line x1="540" y1="160" x2="540" y2="465" />
                  <line x1="620" y1="165" x2="620" y2="450" />
                  <line x1="700" y1="175" x2="700" y2="430" />
                  
                  {/* Horizontal Lines */}
                  <line x1="150" y1="220" x2="800" y2="200" />
                  <line x1="155" y1="280" x2="810" y2="260" />
                  <line x1="150" y1="340" x2="790" y2="320" />
                  <line x1="170" y1="400" x2="760" y2="380" />
                </g>
                
                {/* Major Geographic Features */}
                {/* Great Lakes */}
                <ellipse cx="550" cy="230" rx="30" ry="18" fill="#1976d2" opacity="0.7" />
                <ellipse cx="520" cy="250" rx="20" ry="12" fill="#1976d2" opacity="0.7" />
                <ellipse cx="580" cy="245" rx="15" ry="10" fill="#1976d2" opacity="0.7" />
                
                {/* Florida */}
                <path d="M 680 430 L 720 435 L 750 450 L 760 480 L 750 500 L 720 505 L 690 500 L 680 470 Z" fill="#f1f8e9" stroke="#2e7d32" strokeWidth="1" />
                
                {/* State Labels */}
                <g fill="#1b5e20" fontSize="12" textAnchor="middle" fontWeight="bold">
                  <text x="180" y="320">CA</text>
                  <text x="260" y="350">NV</text>
                  <text x="340" y="340">CO</text>
                  <text x="420" y="370">TX</text>
                  <text x="500" y="320">KS</text>
                  <text x="580" y="300">IL</text>
                  <text x="660" y="290">OH</text>
                  <text x="740" y="270">NY</text>
                  <text x="720" y="470">FL</text>
                </g>

                {/* Compass Rose */}
                <g transform="translate(70,70)">
                  <circle cx="0" cy="0" r="30" fill="white" stroke="#2e7d32" strokeWidth="2" opacity="0.9" />
                  <path d="M 0,-25 L 6,0 L 0,25 L -6,0 Z" fill="#d32f2f" />
                  <text x="0" y="-40" textAnchor="middle" fontSize="12" fill="#2e7d32" fontWeight="bold">N</text>
                  <text x="40" y="5" textAnchor="middle" fontSize="10" fill="#2e7d32">E</text>
                  <text x="0" y="55" textAnchor="middle" fontSize="10" fill="#2e7d32">S</text>
                  <text x="-40" y="5" textAnchor="middle" fontSize="10" fill="#2e7d32">W</text>
                </g>

                {/* Hawaii Inset */}
                <g transform="translate(150,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#2e7d32" strokeWidth="1" opacity="0.95"/>
                  <text x="75" y="12" fontSize="11" fill="#1b5e20" textAnchor="middle" fontWeight="bold">Hawaii</text>
                  <circle cx="60" cy="40" r="4" fill="#f1f8e9" stroke="#2e7d32" />
                  <circle cx="80" cy="35" r="5" fill="#f1f8e9" stroke="#2e7d32" />
                  <circle cx="100" cy="38" r="3" fill="#f1f8e9" stroke="#2e7d32" />
                  <circle cx="120" cy="42" r="6" fill="#f1f8e9" stroke="#2e7d32" />
                  <text x="75" y="60" fontSize="8" fill="#1b5e20" textAnchor="middle">HI</text>
                </g>

                {/* Puerto Rico Inset */}
                <g transform="translate(350,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#2e7d32" strokeWidth="1" opacity="0.95"/>
                  <text x="75" y="12" fontSize="11" fill="#1b5e20" textAnchor="middle" fontWeight="bold">Puerto Rico</text>
                  <ellipse cx="75" cy="40" rx="40" ry="8" fill="#f1f8e9" stroke="#2e7d32" />
                  <text x="75" y="60" fontSize="8" fill="#1b5e20" textAnchor="middle">PR</text>
                </g>

                {/* Alaska Inset */}
                <g transform="translate(550,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#2e7d32" strokeWidth="1" opacity="0.95"/>
                  <text x="75" y="12" fontSize="11" fill="#1b5e20" textAnchor="middle" fontWeight="bold">Alaska</text>
                  <path d="M 30 25 L 80 20 L 120 25 L 130 40 L 120 55 L 80 60 L 40 55 L 25 40 Z" fill="#f1f8e9" stroke="#2e7d32" strokeWidth="1"/>
                  <text x="75" y="60" fontSize="8" fill="#1b5e20" textAnchor="middle">AK</text>
                </g>
              </svg>
              
              {/* Vehicle Markers */}
              {filteredVehicles.map((vehicle, index) => {
                const status = vehicleStatuses[vehicle.status as keyof typeof vehicleStatuses];
                if (!status) return null;
                return (
                  <div
                    key={vehicle.vin}
                    className="absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200 hover:scale-125 hover:z-20"
                    style={{
                      left: `${vehicle.position.x}%`,
                      top: `${vehicle.position.y}%`,
                      zIndex: hoveredVehicle?.vin === vehicle.vin ? 25 : 10
                    }}
                    onMouseEnter={() => setHoveredVehicle(vehicle)}
                    onMouseLeave={() => setHoveredVehicle(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedVehicle(vehicle);
                    }}
                    data-testid={`map-marker-${vehicle.vin}`}
                  >
                    {/* Pin Shape */}
                    <svg width="24" height="32" viewBox="0 0 24 32" className="drop-shadow-lg">
                      <path
                        d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20c0-6.627-5.373-12-12-12z"
                        fill={status.color}
                        stroke="white"
                        strokeWidth="2"
                      />
                      <circle cx="12" cy="12" r="4" fill="white" />
                    </svg>
                    {/* Hover Tooltip */}
                    {hoveredVehicle?.vin === vehicle.vin && (
                      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap z-30 pointer-events-none">
                        <div className="font-semibold">{vehicle.modelYear} {vehicle.makeName} {vehicle.modelName}</div>
                        <div>{vehicle.licensePlate}</div>
                        <div className="flex items-center gap-1">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: status.color }}
                          ></div>
                          <span style={{ color: status.color }}>{status.label}</span>
                        </div>
                        <div className="text-gray-300">{vehicle.deliveryAddress}</div>
                        <div className="text-gray-300">{vehicle.city}, {vehicle.state} {vehicle.zip}</div>
                        {/* Tooltip arrow */}
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/90"></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Map Info */}
            <div className="absolute bottom-2 left-2 text-xs text-gray-600 bg-white/80 px-2 py-1 rounded">
              © 2025 Fleet Tracking • {filteredVehicles.length} vehicles • Click and drag to pan
            </div>
          </div>

          {/* Filters Sidebar */}
          <div className="w-80 bg-white rounded-lg border shadow-sm">
            <div className="p-4 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </h3>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Status Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Vehicle Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(vehicleStatuses).map(([key, status]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: status.color }}
                          ></div>
                          {status.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Branding Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Vehicle Branding</Label>
                <Select value={brandingFilter} onValueChange={setBrandingFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All branding" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branding</SelectItem>
                    {brandingOptions.map(branding => (
                      <SelectItem key={branding} value={branding}>{branding}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Region Filter */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Region</Label>
                <Select value={regionFilter} onValueChange={setRegionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All regions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Regions</SelectItem>
                    {regionOptions.map(region => (
                      <SelectItem key={region} value={region}>{region}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Clear Filters */}
              {(statusFilter !== "all" || brandingFilter !== "all" || regionFilter !== "all") && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => {
                    setStatusFilter("all");
                    setBrandingFilter("all");
                    setRegionFilter("all");
                  }}
                >
                  Clear All Filters
                </Button>
              )}

              {/* Statistics */}
              <div className="pt-4 border-t space-y-3">
                <h4 className="font-medium text-sm">Fleet Statistics</h4>
                <div className="space-y-2">
                  {Object.entries(vehicleStatuses).map(([key, status]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full" 
                          style={{ backgroundColor: status.color }}
                        ></div>
                        <span className="text-gray-600">{status.label}</span>
                      </div>
                      <span className="font-medium">{statusCounts[key] || 0}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Total Vehicles</span>
                    <span>{filteredVehicles.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Details Sidebar (when vehicle selected) */}
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