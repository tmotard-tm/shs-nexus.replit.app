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
              {/* Detailed US Map with Hawaii and Puerto Rico */}
              <svg 
                className="absolute inset-0 w-full h-full" 
                viewBox="0 0 1000 700" 
                style={{ zIndex: 1 }}
              >
                {/* Ocean/Background */}
                <rect width="1000" height="700" fill="#a5b4fc" />
                
                {/* Individual State Shapes */}
                
                {/* California */}
                <path d="M 20 180 L 50 160 L 80 170 L 90 200 L 95 250 L 90 300 L 85 350 L 80 400 L 70 430 L 50 440 L 30 435 L 25 420 L 15 380 L 10 340 L 15 300 L 20 260 L 25 220 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="55" y="300" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">CA</text>

                {/* Texas */}
                <path d="M 280 320 L 380 310 L 420 320 L 460 330 L 480 350 L 490 390 L 480 430 L 460 460 L 420 470 L 380 465 L 340 460 L 310 450 L 290 430 L 280 400 L 275 380 L 280 350 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="380" y="390" fontSize="12" fill="#047857" textAnchor="middle" fontWeight="bold">TX</text>

                {/* Florida */}
                <path d="M 620 430 L 670 425 L 710 430 L 740 440 L 760 460 L 770 480 L 780 510 L 770 530 L 750 540 L 720 545 L 690 540 L 660 535 L 640 520 L 625 500 L 620 480 L 618 455 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="690" y="490" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">FL</text>

                {/* New York */}
                <path d="M 710 220 L 750 215 L 780 220 L 800 230 L 810 250 L 805 270 L 795 285 L 780 290 L 760 285 L 740 280 L 720 270 L 710 250 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="760" y="250" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">NY</text>

                {/* Pennsylvania */}
                <path d="M 670 260 L 720 255 L 750 260 L 760 270 L 755 285 L 740 295 L 720 300 L 700 295 L 680 290 L 665 280 L 665 270 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="712" y="280" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">PA</text>

                {/* Illinois */}
                <path d="M 520 260 L 550 255 L 570 260 L 575 280 L 580 310 L 575 340 L 570 360 L 565 380 L 550 385 L 530 380 L 520 360 L 515 340 L 520 310 L 525 280 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="547" y="320" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">IL</text>

                {/* Ohio */}
                <path d="M 580 280 L 620 275 L 650 280 L 655 300 L 650 320 L 645 340 L 630 345 L 610 340 L 590 335 L 580 320 L 575 300 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="617" y="310" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">OH</text>

                {/* Michigan */}
                <path d="M 540 220 L 570 215 L 590 220 L 600 240 L 595 260 L 580 270 L 560 265 L 545 250 L 540 235 Z M 580 180 L 600 175 L 610 185 L 605 200 L 590 205 L 580 195 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="572" y="240" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">MI</text>

                {/* Georgia */}
                <path d="M 640 350 L 680 345 L 700 350 L 710 370 L 705 390 L 700 410 L 685 420 L 665 415 L 645 410 L 635 390 L 635 370 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="672" y="380" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">GA</text>

                {/* North Carolina */}
                <path d="M 660 320 L 720 315 L 760 320 L 770 330 L 765 345 L 750 350 L 720 345 L 690 340 L 665 335 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="712" y="335" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">NC</text>

                {/* Virginia */}
                <path d="M 680 300 L 730 295 L 750 300 L 755 315 L 740 320 L 715 315 L 690 310 L 680 305 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="717" y="310" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">VA</text>

                {/* Arizona */}
                <path d="M 150 300 L 200 295 L 220 300 L 225 340 L 220 380 L 215 420 L 200 425 L 180 420 L 160 415 L 150 380 L 145 340 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="185" y="360" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">AZ</text>

                {/* Nevada */}
                <path d="M 100 220 L 150 215 L 170 220 L 175 260 L 170 300 L 165 340 L 150 345 L 130 340 L 115 320 L 105 280 L 100 240 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="137" y="280" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">NV</text>

                {/* Colorado */}
                <path d="M 230 280 L 300 275 L 320 280 L 325 320 L 320 360 L 300 365 L 270 360 L 240 355 L 230 320 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="277" y="320" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">CO</text>

                {/* New Mexico */}
                <path d="M 230 360 L 280 355 L 300 360 L 305 400 L 300 440 L 280 445 L 250 440 L 230 435 L 225 400 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="265" y="400" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">NM</text>

                {/* Utah */}
                <path d="M 180 240 L 230 235 L 250 240 L 255 280 L 250 320 L 230 325 L 210 320 L 190 315 L 180 280 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                <text x="217" y="280" fontSize="10" fill="#047857" textAnchor="middle" fontWeight="bold">UT</text>

                {/* Great Lakes */}
                <ellipse cx="580" cy="240" rx="25" ry="15" fill="#3b82f6" opacity="0.8"/>
                <ellipse cx="600" cy="260" rx="20" ry="12" fill="#3b82f6" opacity="0.8"/>
                <ellipse cx="620" cy="250" rx="15" ry="10" fill="#3b82f6" opacity="0.8"/>
                <ellipse cx="560" cy="255" rx="18" ry="8" fill="#3b82f6" opacity="0.8"/>
                <ellipse cx="540" cy="270" rx="12" ry="6" fill="#3b82f6" opacity="0.8"/>

                {/* Interstate Highways */}
                <g stroke="#6b7280" strokeWidth="1" fill="none" opacity="0.3">
                  <path d="M 100 350 L 800 300" /> {/* I-40 */}
                  <path d="M 200 200 L 750 250" /> {/* I-80 */}
                  <path d="M 400 150 L 400 500" /> {/* I-35 */}
                  <path d="M 700 200 L 700 450" /> {/* I-95 */}
                </g>

                {/* Major Cities */}
                <g fill="#dc2626" opacity="0.7">
                  <circle cx="55" cy="320" r="3"/>
                  <text x="65" y="325" fontSize="8" fill="#dc2626">LA</text>
                  
                  <circle cx="547" cy="300" r="3"/>
                  <text x="557" y="305" fontSize="8" fill="#dc2626">Chicago</text>
                  
                  <circle cx="760" cy="250" r="3"/>
                  <text x="770" y="255" fontSize="8" fill="#dc2626">NYC</text>
                  
                  <circle cx="380" cy="390" r="3"/>
                  <text x="390" y="395" fontSize="8" fill="#dc2626">Houston</text>
                  
                  <circle cx="690" cy="490" r="3"/>
                  <text x="700" y="495" fontSize="8" fill="#dc2626">Miami</text>
                </g>

                {/* Compass Rose */}
                <g transform="translate(50,50)">
                  <circle cx="0" cy="0" r="25" fill="white" stroke="#374151" strokeWidth="1" opacity="0.9" />
                  <path d="M 0,-20 L 5,0 L 0,20 L -5,0 Z" fill="#dc2626" />
                  <text x="0" y="-30" textAnchor="middle" fontSize="10" fill="#374151" fontWeight="bold">N</text>
                  <text x="30" y="5" textAnchor="middle" fontSize="8" fill="#374151">E</text>
                  <text x="0" y="40" textAnchor="middle" fontSize="8" fill="#374151">S</text>
                  <text x="-30" y="5" textAnchor="middle" fontSize="8" fill="#374151">W</text>
                </g>

                {/* Scale */}
                <g transform="translate(850,520)">
                  <text x="0" y="0" fontSize="8" fill="#374151">Scale: 1 inch = 200 miles</text>
                  <line x1="0" y1="10" x2="50" y2="10" stroke="#374151" strokeWidth="2"/>
                  <text x="25" y="25" fontSize="8" fill="#374151" textAnchor="middle">200 mi</text>
                </g>

                {/* Hawaii Inset Map */}
                <g transform="translate(150,580)">
                  {/* Hawaii Background Box */}
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#374151" strokeWidth="1" opacity="0.9"/>
                  <text x="75" y="10" fontSize="10" fill="#374151" textAnchor="middle" fontWeight="bold">Hawaii</text>
                  
                  {/* Hawaiian Islands */}
                  {/* Big Island (Hawaii) */}
                  <path d="M 120 30 L 135 28 L 145 35 L 140 45 L 130 50 L 115 48 L 110 40 L 115 32 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  <text x="127" y="42" fontSize="8" fill="#047857" textAnchor="middle">HI</text>
                  
                  {/* Maui */}
                  <ellipse cx="100" cy="35" rx="8" ry="5" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Oahu */}
                  <ellipse cx="85" cy="40" rx="6" ry="4" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Kauai */}
                  <ellipse cx="65" cy="45" rx="5" ry="3" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Molokai */}
                  <ellipse cx="90" cy="38" rx="4" ry="2" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Lanai */}
                  <ellipse cx="95" cy="40" rx="3" ry="2" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Scale for Hawaii */}
                  <line x1="10" y1="65" x2="40" y2="65" stroke="#374151" strokeWidth="1"/>
                  <text x="25" y="62" fontSize="6" fill="#374151" textAnchor="middle">100 mi</text>
                </g>

                {/* Puerto Rico Inset Map */}
                <g transform="translate(350,580)">
                  {/* Puerto Rico Background Box */}
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#374151" strokeWidth="1" opacity="0.9"/>
                  <text x="75" y="10" fontSize="10" fill="#374151" textAnchor="middle" fontWeight="bold">Puerto Rico</text>
                  
                  {/* Puerto Rico Main Island */}
                  <path d="M 30 35 L 120 30 L 130 35 L 135 40 L 130 45 L 120 50 L 35 48 L 25 45 L 25 40 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  <text x="80" y="42" fontSize="8" fill="#047857" textAnchor="middle">PR</text>
                  
                  {/* Vieques */}
                  <ellipse cx="140" cy="45" rx="6" ry="2" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Culebra */}
                  <ellipse cx="135" cy="35" rx="3" ry="2" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  
                  {/* Scale for Puerto Rico */}
                  <line x1="10" y1="65" x2="40" y2="65" stroke="#374151" strokeWidth="1"/>
                  <text x="25" y="62" fontSize="6" fill="#374151" textAnchor="middle">50 mi</text>
                </g>

                {/* Alaska Inset Map */}
                <g transform="translate(550,580)">
                  {/* Alaska Background Box */}
                  <rect x="-5" y="-5" width="160" height="80" fill="white" stroke="#374151" strokeWidth="1" opacity="0.9"/>
                  <text x="75" y="10" fontSize="10" fill="#374151" textAnchor="middle" fontWeight="bold">Alaska</text>
                  
                  {/* Alaska Mainland */}
                  <path d="M 20 25 L 60 20 L 90 25 L 110 30 L 130 35 L 135 45 L 125 55 L 100 60 L 70 58 L 40 55 L 20 50 L 15 40 L 18 30 Z" fill="#dcfce7" stroke="#059669" strokeWidth="1"/>
                  <text x="75" y="45" fontSize="8" fill="#047857" textAnchor="middle">AK</text>
                  
                  {/* Aleutian Islands (simplified) */}
                  <g fill="#dcfce7" stroke="#059669" strokeWidth="0.5">
                    <ellipse cx="35" cy="60" rx="3" ry="1"/>
                    <ellipse cx="45" cy="62" rx="2" ry="1"/>
                    <ellipse cx="55" cy="63" rx="2" ry="1"/>
                    <ellipse cx="65" cy="64" rx="2" ry="1"/>
                  </g>
                  
                  {/* Scale for Alaska */}
                  <line x1="10" y1="68" x2="50" y2="68" stroke="#374151" strokeWidth="1"/>
                  <text x="30" y="75" fontSize="6" fill="#374151" textAnchor="middle">400 mi</text>
                </g>
              </svg>
              
              {/* Vehicle Markers */}
              {filteredVehicles.map((vehicle, index) => {
                const status = vehicleStatuses[vehicle.status as keyof typeof vehicleStatuses];
                if (!status) return null;
                return (
                  <div
                    key={vehicle.vin}
                    className="absolute w-4 h-4 rounded-full cursor-pointer transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200 hover:scale-125 hover:z-20 shadow-lg border-2 border-white"
                    style={{
                      left: `${vehicle.position.x}%`,
                      top: `${vehicle.position.y}%`,
                      backgroundColor: status.color,
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