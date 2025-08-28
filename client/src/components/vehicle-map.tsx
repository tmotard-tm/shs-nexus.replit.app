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

  // Individual sub-map states
  const [hawaiiZoom, setHawaiiZoom] = useState(1);
  const [hawaiiPanX, setHawaiiPanX] = useState(0);
  const [hawaiiPanY, setHawaiiPanY] = useState(0);
  const [puertoRicoZoom, setPuertoRicoZoom] = useState(1);
  const [puertoRicoPanX, setPuertoRicoPanX] = useState(0);
  const [puertoRicoPanY, setPuertoRicoPanY] = useState(0);
  const [alaskaZoom, setAlaskaZoom] = useState(1);
  const [alaskaPanX, setAlaskaPanX] = useState(0);
  const [alaskaPanY, setAlaskaPanY] = useState(0);

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
          <div className="flex-1 relative rounded-lg overflow-hidden border" style={{ backgroundColor: '#1a1a1a' }}>
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
              {/* Professional Dark US Map */}
              <svg 
                className="absolute inset-0 w-full h-full" 
                viewBox="0 0 1000 700" 
                style={{ zIndex: 1 }}
              >
                {/* Dark Background */}
                <rect width="1000" height="700" fill="#1a1a1a" />
                
                {/* US State Boundaries */}
                <g fill="none" stroke="#404040" strokeWidth="1" opacity="0.8">
                  {/* Individual State Outlines */}
                  
                  {/* California */}
                  <path d="M 20 180 L 50 160 L 80 170 L 90 200 L 95 250 L 90 300 L 85 350 L 80 400 L 70 430 L 50 440 L 30 435 L 25 420 L 15 380 L 10 340 L 15 300 L 20 260 L 25 220 Z" />
                  
                  {/* Texas */}
                  <path d="M 280 320 L 380 310 L 420 320 L 460 330 L 480 350 L 490 390 L 480 430 L 460 460 L 420 470 L 380 465 L 340 460 L 310 450 L 290 430 L 280 400 L 275 380 L 280 350 Z" />
                  
                  {/* Florida */}
                  <path d="M 620 430 L 670 425 L 710 430 L 740 440 L 760 460 L 770 480 L 780 510 L 770 530 L 750 540 L 720 545 L 690 540 L 660 535 L 640 520 L 625 500 L 620 480 L 618 455 Z" />
                  
                  {/* New York */}
                  <path d="M 710 220 L 750 215 L 780 220 L 800 230 L 810 250 L 805 270 L 795 285 L 780 290 L 760 285 L 740 280 L 720 270 L 710 250 Z" />
                  
                  {/* Pennsylvania */}
                  <path d="M 670 260 L 720 255 L 750 260 L 760 270 L 755 285 L 740 295 L 720 300 L 700 295 L 680 290 L 665 280 L 665 270 Z" />
                  
                  {/* Illinois */}
                  <path d="M 520 260 L 550 255 L 570 260 L 575 280 L 580 310 L 575 340 L 570 360 L 565 380 L 550 385 L 530 380 L 520 360 L 515 340 L 520 310 L 525 280 Z" />
                  
                  {/* Ohio */}
                  <path d="M 580 280 L 620 275 L 650 280 L 655 300 L 650 320 L 645 340 L 630 345 L 610 340 L 590 335 L 580 320 L 575 300 Z" />
                  
                  {/* Michigan */}
                  <path d="M 540 220 L 570 215 L 590 220 L 600 240 L 595 260 L 580 270 L 560 265 L 545 250 L 540 235 Z" />
                  <path d="M 580 180 L 600 175 L 610 185 L 605 200 L 590 205 L 580 195 Z" />
                  
                  {/* Georgia */}
                  <path d="M 640 350 L 680 345 L 700 350 L 710 370 L 705 390 L 700 410 L 685 420 L 665 415 L 645 410 L 635 390 L 635 370 Z" />
                  
                  {/* North Carolina */}
                  <path d="M 660 320 L 720 315 L 760 320 L 770 330 L 765 345 L 750 350 L 720 345 L 690 340 L 665 335 Z" />
                  
                  {/* Virginia */}
                  <path d="M 680 300 L 730 295 L 750 300 L 755 315 L 740 320 L 715 315 L 690 310 L 680 305 Z" />
                  
                  {/* Arizona */}
                  <path d="M 150 300 L 200 295 L 220 300 L 225 340 L 220 380 L 215 420 L 200 425 L 180 420 L 160 415 L 150 380 L 145 340 Z" />
                  
                  {/* Nevada */}
                  <path d="M 100 220 L 150 215 L 170 220 L 175 260 L 170 300 L 165 340 L 150 345 L 130 340 L 115 320 L 105 280 L 100 240 Z" />
                  
                  {/* Colorado */}
                  <path d="M 230 280 L 300 275 L 320 280 L 325 320 L 320 360 L 300 365 L 270 360 L 240 355 L 230 320 Z" />
                  
                  {/* New Mexico */}
                  <path d="M 230 360 L 280 355 L 300 360 L 305 400 L 300 440 L 280 445 L 250 440 L 230 435 L 225 400 Z" />
                  
                  {/* Utah */}
                  <path d="M 180 240 L 230 235 L 250 240 L 255 280 L 250 320 L 230 325 L 210 320 L 190 315 L 180 280 Z" />
                  
                  {/* Washington */}
                  <path d="M 50 120 L 120 115 L 150 120 L 155 140 L 150 160 L 120 165 L 80 160 L 50 155 L 45 140 Z" />
                  
                  {/* Oregon */}
                  <path d="M 50 160 L 120 155 L 150 160 L 155 180 L 150 200 L 120 205 L 80 200 L 50 195 L 45 180 Z" />
                  
                  {/* Idaho */}
                  <path d="M 150 140 L 180 135 L 200 140 L 205 180 L 200 220 L 180 225 L 160 220 L 155 180 L 150 160 Z" />
                  
                  {/* Montana */}
                  <path d="M 200 120 L 300 115 L 320 120 L 325 160 L 320 200 L 300 205 L 220 200 L 200 195 L 195 160 Z" />
                  
                  {/* Wyoming */}
                  <path d="M 200 200 L 280 195 L 300 200 L 305 240 L 300 280 L 280 285 L 220 280 L 200 275 L 195 240 Z" />
                  
                  {/* North Dakota */}
                  <path d="M 320 120 L 380 115 L 400 120 L 405 160 L 400 200 L 380 205 L 340 200 L 320 195 L 315 160 Z" />
                  
                  {/* South Dakota */}
                  <path d="M 320 200 L 380 195 L 400 200 L 405 240 L 400 280 L 380 285 L 340 280 L 320 275 L 315 240 Z" />
                  
                  {/* Nebraska */}
                  <path d="M 320 280 L 420 275 L 440 280 L 445 320 L 440 360 L 420 365 L 360 360 L 320 355 L 315 320 Z" />
                  
                  {/* Kansas */}
                  <path d="M 340 360 L 440 355 L 460 360 L 465 400 L 460 440 L 440 445 L 380 440 L 340 435 L 335 400 Z" />
                  
                  {/* Oklahoma */}
                  <path d="M 340 440 L 460 435 L 480 440 L 485 480 L 480 520 L 460 525 L 400 520 L 340 515 L 335 480 Z" />
                  
                  {/* Minnesota */}
                  <path d="M 400 120 L 460 115 L 480 120 L 485 180 L 480 240 L 460 245 L 420 240 L 400 235 L 395 180 Z" />
                  
                  {/* Iowa */}
                  <path d="M 440 280 L 500 275 L 520 280 L 525 320 L 520 360 L 500 365 L 460 360 L 440 355 L 435 320 Z" />
                  
                  {/* Missouri */}
                  <path d="M 460 360 L 540 355 L 560 360 L 565 420 L 560 480 L 540 485 L 480 480 L 460 475 L 455 420 Z" />
                  
                  {/* Arkansas */}
                  <path d="M 480 480 L 540 475 L 560 480 L 565 520 L 560 560 L 540 565 L 500 560 L 480 555 L 475 520 Z" />
                  
                  {/* Louisiana */}
                  <path d="M 480 560 L 540 555 L 560 560 L 565 600 L 560 640 L 540 645 L 500 640 L 480 635 L 475 600 Z" />
                  
                  {/* Wisconsin */}
                  <path d="M 520 200 L 560 195 L 580 200 L 585 260 L 580 320 L 560 325 L 540 320 L 520 315 L 515 260 Z" />
                  
                  {/* Indiana */}
                  <path d="M 560 320 L 600 315 L 620 320 L 625 380 L 620 440 L 600 445 L 580 440 L 560 435 L 555 380 Z" />
                  
                  {/* Kentucky */}
                  <path d="M 580 380 L 650 375 L 680 380 L 685 420 L 680 460 L 650 465 L 600 460 L 580 455 L 575 420 Z" />
                  
                  {/* Tennessee */}
                  <path d="M 600 460 L 680 455 L 720 460 L 725 500 L 720 540 L 680 545 L 640 540 L 600 535 L 595 500 Z" />
                  
                  {/* Mississippi */}
                  <path d="M 540 560 L 580 555 L 600 560 L 605 620 L 600 680 L 580 685 L 560 680 L 540 675 L 535 620 Z" />
                  
                  {/* Alabama */}
                  <path d="M 600 540 L 640 535 L 660 540 L 665 600 L 660 660 L 640 665 L 620 660 L 600 655 L 595 600 Z" />
                  
                  {/* South Carolina */}
                  <path d="M 720 380 L 760 375 L 780 380 L 785 420 L 780 460 L 760 465 L 740 460 L 720 455 L 715 420 Z" />
                  
                  {/* West Virginia */}
                  <path d="M 680 320 L 720 315 L 740 320 L 745 360 L 740 400 L 720 405 L 700 400 L 680 395 L 675 360 Z" />
                  
                  {/* Maryland */}
                  <path d="M 720 300 L 760 295 L 780 300 L 785 320 L 780 340 L 760 345 L 740 340 L 720 335 L 715 320 Z" />
                  
                  {/* Delaware */}
                  <path d="M 760 300 L 780 295 L 785 315 L 780 335 L 775 340 L 765 335 L 760 315 Z" />
                  
                  {/* New Jersey */}
                  <path d="M 760 260 L 790 255 L 795 295 L 790 335 L 785 340 L 765 335 L 760 295 Z" />
                  
                  {/* Connecticut */}
                  <path d="M 780 240 L 810 235 L 815 255 L 810 275 L 805 280 L 785 275 L 780 255 Z" />
                  
                  {/* Rhode Island */}
                  <path d="M 810 235 L 820 230 L 825 245 L 820 260 L 815 265 L 810 250 Z" />
                  
                  {/* Massachusetts */}
                  <path d="M 780 220 L 830 215 L 835 235 L 830 255 L 825 260 L 785 255 L 780 235 Z" />
                  
                  {/* Vermont */}
                  <path d="M 760 200 L 780 195 L 785 235 L 780 275 L 775 280 L 765 275 L 760 235 Z" />
                  
                  {/* New Hampshire */}
                  <path d="M 780 180 L 810 175 L 815 215 L 810 255 L 805 260 L 785 255 L 780 215 Z" />
                  
                  {/* Maine */}
                  <path d="M 810 140 L 850 135 L 855 195 L 850 255 L 845 260 L 815 255 L 810 195 Z" />
                </g>

                {/* State Labels */}
                <g fill="#8e8e93" fontSize="10" textAnchor="middle" fontWeight="normal">
                  <text x="55" y="310">California</text>
                  <text x="137" y="280">Nevada</text>
                  <text x="265" y="330">Colorado</text>
                  <text x="380" y="380">Texas</text>
                  <text x="90" y="145">Washington</text>
                  <text x="90" y="175">Oregon</text>
                  <text x="250" y="145">Montana</text>
                  <text x="390" y="380">New Mexico</text>
                  <text x="185" y="285">Utah</text>
                  <text x="175" y="175">Idaho</text>
                  <text x="440" y="145">North Dakota</text>
                  <text x="440" y="240">South Dakota</text>
                  <text x="380" y="320">Nebraska</text>
                  <text x="400" y="400">Kansas</text>
                  <text x="400" y="480">Oklahoma</text>
                  <text x="440" y="175">Minnesota</text>
                  <text x="480" y="320">Iowa</text>
                  <text x="510" y="420">Missouri</text>
                  <text x="520" y="520">Arkansas</text>
                  <text x="520" y="600">Louisiana</text>
                  <text x="550" y="260">Wisconsin</text>
                  <text x="590" y="380">Indiana</text>
                  <text x="632" y="420">Kentucky</text>
                  <text x="660" y="500">Tennessee</text>
                  <text x="570" y="620">Mississippi</text>
                  <text x="630" y="600">Alabama</text>
                  <text x="672" y="380">Georgia</text>
                  <text x="750" y="420">South Carolina</text>
                  <text x="712" y="335">North Carolina</text>
                  <text x="717" y="310">Virginia</text>
                  <text x="710" y="360">West Virginia</text>
                  <text x="617" y="310">Ohio</text>
                  <text x="712" y="280">Pennsylvania</text>
                  <text x="750" y="320">Maryland</text>
                  <text x="772" y="318">DE</text>
                  <text x="777" y="295">NJ</text>
                  <text x="760" y="250">New York</text>
                  <text x="797" y="245">CT</text>
                  <text x="817" y="242">RI</text>
                  <text x="807" y="235">Massachusetts</text>
                  <text x="772" y="235">VT</text>
                  <text x="797" y="215">NH</text>
                  <text x="832" y="195">Maine</text>
                  <text x="550" y="240">Michigan</text>
                  <text x="720" y="470">Florida</text>
                </g>

                {/* Interactive Hawaii Inset */}
                <g transform="translate(150,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="#2a2a2a" stroke="#555" strokeWidth="1"/>
                  <text x="75" y="12" fontSize="10" fill="#8e8e93" textAnchor="middle">Hawaii</text>
                  
                  {/* Hawaii Zoom Controls */}
                  <g transform="translate(5, 15)">
                    <rect width="20" height="50" fill="#333" stroke="#555" strokeWidth="0.5" rx="2"/>
                    <rect x="2" y="2" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setHawaiiZoom(Math.min(hawaiiZoom * 1.2, 3))}/>
                    <text x="10" y="10" fontSize="8" fill="#8e8e93" textAnchor="middle">+</text>
                    <rect x="2" y="16" width="16" height="12" fill="#333" stroke="#555" strokeWidth="0.5"/>
                    <text x="10" y="24" fontSize="6" fill="#8e8e93" textAnchor="middle">{Math.round(hawaiiZoom * 100)}%</text>
                    <rect x="2" y="30" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setHawaiiZoom(Math.max(hawaiiZoom / 1.2, 0.5))}/>
                    <text x="10" y="38" fontSize="8" fill="#8e8e93" textAnchor="middle">-</text>
                    <rect x="2" y="44" width="16" height="4" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => { setHawaiiZoom(1); setHawaiiPanX(0); setHawaiiPanY(0); }}/>
                    <text x="10" y="47" fontSize="5" fill="#8e8e93" textAnchor="middle">↺</text>
                  </g>
                  
                  {/* Hawaii Map Content */}
                  <g transform={`translate(${hawaiiPanX}, ${hawaiiPanY}) scale(${hawaiiZoom})`} style={{ transformOrigin: '75px 40px' }}>
                    {/* Detailed Hawaiian Islands */}
                    <g fill="#3a3a3a" stroke="#555" strokeWidth="0.5">
                      {/* Kauai */}
                      <path d="M 50 30 Q 55 28 60 30 Q 65 32 62 36 Q 58 38 54 36 Q 50 34 50 30 Z"/>
                      <text x="55" y="50" fontSize="5" fill="#8e8e93" textAnchor="middle">Kauai</text>
                      
                      {/* Oahu */}
                      <path d="M 65 32 Q 72 30 78 33 Q 82 36 80 40 Q 76 42 70 40 Q 65 37 65 32 Z"/>
                      <text x="72" y="52" fontSize="5" fill="#8e8e93" textAnchor="middle">Oahu</text>
                      
                      {/* Molokai */}
                      <path d="M 80 31 Q 88 30 94 32 Q 96 34 94 36 Q 88 37 82 35 Q 80 33 80 31 Z"/>
                      <text x="87" y="48" fontSize="5" fill="#8e8e93" textAnchor="middle">Molokai</text>
                      
                      {/* Lanai */}
                      <circle cx="85" cy="38" r="3" />
                      <text x="85" y="53" fontSize="4" fill="#8e8e93" textAnchor="middle">Lanai</text>
                      
                      {/* Maui */}
                      <path d="M 92 35 Q 100 33 106 36 Q 110 40 106 44 Q 100 46 94 43 Q 92 39 92 35 Z"/>
                      <text x="99" y="56" fontSize="5" fill="#8e8e93" textAnchor="middle">Maui</text>
                      
                      {/* Big Island (Hawaii) */}
                      <path d="M 115 30 Q 125 28 135 32 Q 140 38 138 45 Q 135 52 125 54 Q 115 52 112 45 Q 112 38 115 30 Z"/>
                      <text x="125" y="62" fontSize="5" fill="#8e8e93" textAnchor="middle">Big Island</text>
                    </g>
                    
                    {/* Hawaii Vehicle Pins */}
                    {filteredVehicles.filter(v => v.state === "HI").map((vehicle, idx) => {
                      const status = vehicleStatuses[getVehicleStatus(vehicle) as keyof typeof vehicleStatuses];
                      if (!status) return null;
                      // Distribute vehicles across Hawaiian islands
                      const islandPositions = [
                        { x: 72, y: 35 }, // Oahu (most populated)
                        { x: 125, y: 42 }, // Big Island
                        { x: 99, y: 38 }, // Maui
                        { x: 55, y: 33 }, // Kauai
                        { x: 87, y: 33 }, // Molokai
                        { x: 85, y: 38 }  // Lanai
                      ];
                      const pos = islandPositions[idx % islandPositions.length];
                      return (
                        <circle
                          key={`hawaii-${vehicle.vin}`}
                          cx={pos.x + (Math.random() - 0.5) * 4}
                          cy={pos.y + (Math.random() - 0.5) * 3}
                          r="1.5"
                          fill={status.color}
                          stroke="white"
                          strokeWidth="0.3"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVehicle(vehicle);
                          }}
                        />
                      );
                    })}
                  </g>
                </g>

                {/* Interactive Alaska Inset */}
                <g transform="translate(350,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="#2a2a2a" stroke="#555" strokeWidth="1"/>
                  <text x="75" y="12" fontSize="10" fill="#8e8e93" textAnchor="middle">Alaska</text>
                  
                  {/* Alaska Zoom Controls */}
                  <g transform="translate(5, 15)">
                    <rect width="20" height="50" fill="#333" stroke="#555" strokeWidth="0.5" rx="2"/>
                    <rect x="2" y="2" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setAlaskaZoom(Math.min(alaskaZoom * 1.2, 3))}/>
                    <text x="10" y="10" fontSize="8" fill="#8e8e93" textAnchor="middle">+</text>
                    <rect x="2" y="16" width="16" height="12" fill="#333" stroke="#555" strokeWidth="0.5"/>
                    <text x="10" y="24" fontSize="6" fill="#8e8e93" textAnchor="middle">{Math.round(alaskaZoom * 100)}%</text>
                    <rect x="2" y="30" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setAlaskaZoom(Math.max(alaskaZoom / 1.2, 0.5))}/>
                    <text x="10" y="38" fontSize="8" fill="#8e8e93" textAnchor="middle">-</text>
                    <rect x="2" y="44" width="16" height="4" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => { setAlaskaZoom(1); setAlaskaPanX(0); setAlaskaPanY(0); }}/>
                    <text x="10" y="47" fontSize="5" fill="#8e8e93" textAnchor="middle">↺</text>
                  </g>
                  
                  {/* Alaska Map Content */}
                  <g transform={`translate(${alaskaPanX}, ${alaskaPanY}) scale(${alaskaZoom})`} style={{ transformOrigin: '75px 40px' }}>
                    {/* Detailed Alaska */}
                    <g fill="#3a3a3a" stroke="#555" strokeWidth="0.5">
                      {/* Alaska Mainland */}
                      <path d="M 30 25 L 50 20 Q 70 18 90 22 Q 110 25 125 30 Q 135 35 140 42 Q 138 50 130 56 Q 110 60 85 58 Q 60 56 40 52 Q 25 48 20 42 Q 18 35 25 28 L 30 25 Z"/>
                      
                      {/* Aleutian Islands Chain */}
                      <g fill="#3a3a3a" stroke="#555" strokeWidth="0.3">
                        <ellipse cx="30" cy="58" rx="3" ry="1.5"/>
                        <ellipse cx="40" cy="60" rx="2.5" ry="1"/>
                        <ellipse cx="50" cy="61" rx="2" ry="1"/>
                        <ellipse cx="60" cy="62" rx="2" ry="1"/>
                        <ellipse cx="70" cy="62" rx="1.5" ry="0.8"/>
                        <ellipse cx="80" cy="63" rx="1.5" ry="0.8"/>
                      </g>
                      
                      {/* Southeast Alaska Islands */}
                      <g fill="#3a3a3a" stroke="#555" strokeWidth="0.3">
                        <ellipse cx="125" cy="48" rx="4" ry="2"/>
                        <ellipse cx="135" cy="50" rx="3" ry="1.5"/>
                        <ellipse cx="140" cy="45" rx="2" ry="1"/>
                      </g>
                    </g>
                    
                    {/* Alaska Vehicle Pins */}
                    {filteredVehicles.filter(v => v.state === "AK").map((vehicle, idx) => {
                      const status = vehicleStatuses[getVehicleStatus(vehicle) as keyof typeof vehicleStatuses];
                      if (!status) return null;
                      // Distribute vehicles across Alaska regions
                      const alaskaPositions = [
                        { x: 80, y: 35 }, // Anchorage area
                        { x: 95, y: 40 }, // Interior Alaska
                        { x: 125, y: 48 }, // Southeast Alaska
                        { x: 65, y: 45 }, // Southwest Alaska
                        { x: 110, y: 30 }, // Northern Alaska
                        { x: 50, y: 58 }  // Aleutian Islands
                      ];
                      const pos = alaskaPositions[idx % alaskaPositions.length];
                      return (
                        <circle
                          key={`alaska-${vehicle.vin}`}
                          cx={pos.x + (Math.random() - 0.5) * 6}
                          cy={pos.y + (Math.random() - 0.5) * 4}
                          r="1.5"
                          fill={status.color}
                          stroke="white"
                          strokeWidth="0.3"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVehicle(vehicle);
                          }}
                        />
                      );
                    })}
                  </g>
                </g>

                {/* Interactive Puerto Rico Inset */}
                <g transform="translate(550,580)">
                  <rect x="-5" y="-5" width="160" height="80" fill="#2a2a2a" stroke="#555" strokeWidth="1"/>
                  <text x="75" y="12" fontSize="10" fill="#8e8e93" textAnchor="middle">Puerto Rico</text>
                  
                  {/* Puerto Rico Zoom Controls */}
                  <g transform="translate(5, 15)">
                    <rect width="20" height="50" fill="#333" stroke="#555" strokeWidth="0.5" rx="2"/>
                    <rect x="2" y="2" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setPuertoRicoZoom(Math.min(puertoRicoZoom * 1.2, 3))}/>
                    <text x="10" y="10" fontSize="8" fill="#8e8e93" textAnchor="middle">+</text>
                    <rect x="2" y="16" width="16" height="12" fill="#333" stroke="#555" strokeWidth="0.5"/>
                    <text x="10" y="24" fontSize="6" fill="#8e8e93" textAnchor="middle">{Math.round(puertoRicoZoom * 100)}%</text>
                    <rect x="2" y="30" width="16" height="12" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => setPuertoRicoZoom(Math.max(puertoRicoZoom / 1.2, 0.5))}/>
                    <text x="10" y="38" fontSize="8" fill="#8e8e93" textAnchor="middle">-</text>
                    <rect x="2" y="44" width="16" height="4" fill="#444" stroke="#666" strokeWidth="0.5" rx="1" className="cursor-pointer" onClick={() => { setPuertoRicoZoom(1); setPuertoRicoPanX(0); setPuertoRicoPanY(0); }}/>
                    <text x="10" y="47" fontSize="5" fill="#8e8e93" textAnchor="middle">↺</text>
                  </g>
                  
                  {/* Puerto Rico Map Content */}
                  <g transform={`translate(${puertoRicoPanX}, ${puertoRicoPanY}) scale(${puertoRicoZoom})`} style={{ transformOrigin: '75px 40px' }}>
                    {/* Detailed Puerto Rico */}
                    <g fill="#3a3a3a" stroke="#555" strokeWidth="0.5">
                      {/* Main Puerto Rico Island */}
                      <path d="M 35 35 Q 50 32 75 33 Q 100 34 115 36 Q 125 38 130 40 Q 132 42 130 44 Q 125 46 115 47 Q 100 48 75 47 Q 50 46 35 43 Q 30 41 30 39 Q 32 36 35 35 Z"/>
                      <text x="80" y="55" fontSize="6" fill="#8e8e93" textAnchor="middle">Puerto Rico</text>
                      
                      {/* Vieques */}
                      <ellipse cx="135" cy="42" rx="6" ry="2" />
                      <text x="135" y="52" fontSize="4" fill="#8e8e93" textAnchor="middle">Vieques</text>
                      
                      {/* Culebra */}
                      <ellipse cx="140" cy="35" rx="3" ry="1.5" />
                      <text x="140" y="32" fontSize="4" fill="#8e8e93" textAnchor="middle">Culebra</text>
                      
                      {/* Smaller Islands */}
                      <circle cx="32" cy="36" r="1" />
                      <circle cx="145" cy="40" r="1" />
                    </g>
                    
                    {/* Puerto Rico Vehicle Pins */}
                    {filteredVehicles.filter(v => v.state === "PR").map((vehicle, idx) => {
                      const status = vehicleStatuses[getVehicleStatus(vehicle) as keyof typeof vehicleStatuses];
                      if (!status) return null;
                      // Distribute vehicles across Puerto Rico regions
                      const prPositions = [
                        { x: 65, y: 40 }, // San Juan area
                        { x: 90, y: 42 }, // Central Puerto Rico
                        { x: 115, y: 43 }, // Eastern Puerto Rico
                        { x: 135, y: 42 }, // Vieques
                        { x: 50, y: 41 }, // Western Puerto Rico
                        { x: 140, y: 35 }  // Culebra
                      ];
                      const pos = prPositions[idx % prPositions.length];
                      return (
                        <circle
                          key={`pr-${vehicle.vin}`}
                          cx={pos.x + (Math.random() - 0.5) * 4}
                          cy={pos.y + (Math.random() - 0.5) * 2}
                          r="1.5"
                          fill={status.color}
                          stroke="white"
                          strokeWidth="0.3"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVehicle(vehicle);
                          }}
                        />
                      );
                    })}
                  </g>
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
                    {/* Colored Circle Pin */}
                    <div 
                      className="w-3 h-3 rounded-full border border-white shadow-lg"
                      style={{ backgroundColor: status.color }}
                    ></div>
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
            <div className="absolute bottom-2 left-2 text-xs text-gray-400 bg-black/60 px-2 py-1 rounded">
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