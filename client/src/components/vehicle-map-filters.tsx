import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { activeVehicles, FleetVehicle } from '@/data/fleetData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { expandedCityCoordinates } from '@/data/expanded-city-coordinates';

interface FilteredMapProps {
  isOpen: boolean;
}

interface MapFilters {
  branding: string;
  region: string;
  status: string;
  zipCode: string;
}

// Vehicle status colors matching Tableau dashboard
const statusColors = {
  'AE Factory Service': '#3B82F6',  // Blue - Assigned to Tech
  'Sears': '#3B82F6',              // Blue - Assigned to Tech  
  'Kenmore': '#10B981',            // Green - In Use
  'DieHard': '#F59E0B',            // Orange - Declined Repair
  'Craftsman': '#EF4444',          // Red - In Repair
  'PartsDirect': '#8B5CF6',        // Purple - Spare
  'default': '#6B7280'             // Gray - Unknown
};

// Use expanded city coordinates to cover all 2,424 vehicles
const cityCoordinates = expandedCityCoordinates;

export function FilteredMap({ isOpen }: FilteredMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  
  // Filter state
  const [filters, setFilters] = useState<MapFilters>({
    branding: 'all',
    region: 'all',
    status: 'all',
    zipCode: ''
  });
  
  // Get unique filter options
  const brandingOptions = Array.from(new Set(activeVehicles.map(v => v.branding).filter(Boolean))).sort();
  const regionOptions = Array.from(new Set(activeVehicles.map(v => v.region).filter(Boolean))).sort();
  
  // Get actual status options from real branding data
  const actualBrandingValues = Array.from(new Set(activeVehicles.map(v => v.branding).filter(Boolean))).sort();
  const statusOptions = actualBrandingValues.map(branding => {
    switch(branding) {
      case 'AE Factory Service':
        return { value: branding, label: 'Assigned to Tech', color: '#3B82F6' };
      case 'Sears':
        return { value: branding, label: 'Assigned to Tech', color: '#3B82F6' };
      case 'Kenmore':
        return { value: branding, label: 'In Use', color: '#10B981' };
      case 'DieHard':
        return { value: branding, label: 'Declined Repair', color: '#F59E0B' };
      case 'Craftsman':
        return { value: branding, label: 'In Repair', color: '#EF4444' };
      case 'PartsDirect':
        return { value: branding, label: 'Spare', color: '#8B5CF6' };
      default:
        return { value: branding, label: branding, color: '#6B7280' };
    }
  });
  
  // Filter vehicles based on current filters
  const filteredVehicles = activeVehicles.filter(vehicle => {
    if (filters.branding !== 'all' && vehicle.branding !== filters.branding) return false;
    if (filters.region !== 'all' && vehicle.region !== filters.region) return false;
    if (filters.status !== 'all' && vehicle.branding !== filters.status) return false;
    if (filters.zipCode && !vehicle.zip.includes(filters.zipCode)) return false;
    return true;
  });

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstance.current) return;

    try {
      // Continental US bounds (excluding Alaska and Hawaii)
      const continentalUSBounds = L.latLngBounds(
        L.latLng(24.396308, -125.0), // Southwest corner
        L.latLng(49.384358, -66.93457) // Northeast corner
      );

      // Create Leaflet map limited to Continental US
      const map = L.map(mapRef.current, {
        maxBounds: continentalUSBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 4,
        maxZoom: 18
      }).setView([39.8, -98.5], 4);
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstance.current = map;
      console.log('✅ Filtered map initialized');

    } catch (error) {
      console.error('❌ Error creating filtered map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [isOpen]);

  // Update markers when filters change
  useEffect(() => {
    if (!mapInstance.current || !isOpen) return;
    
    updateMarkers();
  }, [filters, isOpen]);

  // Handle resize to keep map properly sized
  useEffect(() => {
    if (!mapRef.current || !mapInstance.current) return;
    
    const resizeObserver = new ResizeObserver(() => {
      mapInstance.current?.invalidateSize();
    });
    
    resizeObserver.observe(mapRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  // Function to update markers
  const updateMarkers = () => {
    if (!mapInstance.current) return;
    
    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    
    // Add all filtered markers
    let markersAdded = 0;
    
    filteredVehicles.forEach((vehicle) => {
      const coordinates = cityCoordinates[vehicle.city.toUpperCase()];
      if (!coordinates) {
        // Log missing cities to help expand coverage
        if (markersAdded < 10) { // Only log first 10 to avoid spam
          console.warn(`Missing coordinates for city: ${vehicle.city}, ${vehicle.state}`);
        }
        return;
      }
      
      // Add small random offset to prevent overlapping
      const lat = coordinates[0] + (Math.random() - 0.5) * 0.1;
      const lng = coordinates[1] + (Math.random() - 0.5) * 0.1;
      
      const color = statusColors[vehicle.branding as keyof typeof statusColors] || statusColors.default;
      
      const marker = L.circleMarker([lat, lng], {
        radius: 4,
        fillColor: color,
        color: '#000',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.6
      });
      
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 200px;">
          <strong>${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName}</strong><br/>
          <strong>VIN:</strong> ${vehicle.vin}<br/>
          <strong>Vehicle #:</strong> ${vehicle.vehicleNumber}<br/>
          <strong>Status:</strong> ${vehicle.branding}<br/>
          <strong>Location:</strong> ${vehicle.city}, ${vehicle.state}<br/>
          <strong>Region:</strong> ${vehicle.region}<br/>
          <strong>Mileage:</strong> ${vehicle.odometerDelivery?.toLocaleString() || 'N/A'}
        </div>
      `);
      
      marker.addTo(mapInstance.current!);
      markersRef.current.push(marker);
      markersAdded++;
    });
    
    console.log(`🔄 Updated map: ${markersAdded} vehicles shown from ${filteredVehicles.length} filtered (${activeVehicles.length} total)`);
    
    // Auto-fit map bounds to show all vehicles
    if (markersAdded > 0 && mapInstance.current) {
      const group = new L.FeatureGroup(markersRef.current);
      mapInstance.current.fitBounds(group.getBounds().pad(0.05));
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Filter Sidebar */}
      <Card className="w-full lg:w-56 flex-shrink-0">
        <CardHeader>
          <CardTitle className="text-sm">Filter Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Truck Status</Label>
            <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {statusOptions.map(status => (
                  <SelectItem key={status.value} value={status.value}>
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
            <Label className="text-xs font-medium">Branding</Label>
            <Select value={filters.branding} onValueChange={(value) => setFilters(prev => ({ ...prev, branding: value }))}>
              <SelectTrigger className="h-8">
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
          
          {/* Region Filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Region</Label>
            <Select value={filters.region} onValueChange={(value) => setFilters(prev => ({ ...prev, region: value }))}>
              <SelectTrigger className="h-8">
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
          
          {/* Zip Code Filter */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Zip Code</Label>
            <Input
              className="h-8"
              placeholder="Enter zip code..."
              value={filters.zipCode}
              onChange={(e) => setFilters(prev => ({ ...prev, zipCode: e.target.value }))}
            />
            {filters.zipCode && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-6 text-xs"
                onClick={() => setFilters(prev => ({ ...prev, zipCode: '' }))}
              >
                Clear Zip Code
              </Button>
            )}
          </div>
          
          {/* Fleet Summary */}
          <div className="pt-4 border-t">
            <div className="text-xs text-muted-foreground">
              <p><strong>Total Vehicles:</strong> {activeVehicles.length.toLocaleString()}</p>
              <p><strong>Active on Map:</strong> {filteredVehicles.length.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Multi-Region Maps */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Main Continental US Map */}
        <div className="bg-gray-100 rounded-lg overflow-hidden h-full">
          <div className="bg-gray-800 text-white px-3 py-1 text-sm font-medium">
            Continental United States
          </div>
          <div 
            ref={mapRef} 
            className="w-full h-[calc(100%-28px)]"
          />
        </div>
      </div>
    </div>
  );
}