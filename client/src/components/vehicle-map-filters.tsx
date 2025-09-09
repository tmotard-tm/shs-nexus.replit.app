import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { activeVehicles, FleetVehicle } from '@/data/fleetData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HawaiiMap } from './hawaii-map';
import { PuertoRicoMap } from './puerto-rico-map';

interface FilteredMapProps {
  isOpen: boolean;
}

interface MapFilters {
  status: string;
  branding: string;
  region: string;
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

// City coordinates for vehicle positioning
const cityCoordinates: Record<string, [number, number]> = {
  'PHILADELPHIA': [39.9526, -75.1652],
  'CHICAGO': [41.8781, -87.6298],
  'NEW YORK': [40.7128, -74.0060],
  'LOS ANGELES': [34.0522, -118.2437],
  'HOUSTON': [29.7604, -95.3698],
  'PHOENIX': [33.4484, -112.0740],
  'SAN ANTONIO': [29.4241, -98.4936],
  'SAN DIEGO': [32.7157, -117.1611],
  'DALLAS': [32.7767, -96.7970],
  'DETROIT': [42.3314, -83.0458],
  'SAN JOSE': [37.3382, -121.8863],
  'AUSTIN': [30.2672, -97.7431],
  'JACKSONVILLE': [30.3322, -81.6557],
  'FORT WORTH': [32.7555, -97.3308],
  'COLUMBUS': [39.9612, -82.9988],
  'CHARLOTTE': [35.2271, -80.8431],
  'INDIANAPOLIS': [39.7684, -86.1581],
  'SEATTLE': [47.6062, -122.3321],
  'DENVER': [39.7392, -104.9903],
  'BOSTON': [42.3601, -71.0589],
  'EL PASO': [31.7619, -106.4850],
  'NASHVILLE': [36.1627, -86.7816],
  'BALTIMORE': [39.2904, -76.6122],
  'OKLAHOMA CITY': [35.4676, -97.5164],
  'PORTLAND': [45.5152, -122.6784],
  'LAS VEGAS': [36.1699, -115.1398],
  'MILWAUKEE': [43.0389, -87.9065],
  'ALBUQUERQUE': [35.0844, -106.6504],
  'TUCSON': [32.2226, -110.9747],
  'FRESNO': [36.7378, -119.7871],
  'SACRAMENTO': [38.5816, -121.4944],
  'MESA': [33.4152, -111.8315],
  'KANSAS CITY': [39.0997, -94.5786],
  'ATLANTA': [33.7490, -84.3880],
  'LONG BEACH': [33.7701, -118.1937],
  'COLORADO SPRINGS': [38.8339, -104.8214],
  'RALEIGH': [35.7796, -78.6382],
  'MIAMI': [25.7617, -80.1918],
  'VIRGINIA BEACH': [36.8529, -75.9780],
  'OMAHA': [41.2565, -95.9345],
  'OAKLAND': [37.8044, -122.2712],
  'MINNEAPOLIS': [44.9778, -93.2650],
  'TULSA': [36.1540, -95.9928],
  'ARLINGTON': [32.7357, -97.1081],
  'NEW ORLEANS': [29.9511, -90.0715],
  'WICHITA': [37.6872, -97.3301],
  'CLEVELAND': [41.4993, -81.6944],
  'TAMPA': [27.9506, -82.4572],
  'HONOLULU': [21.3099, -157.8581], // Hawaii
  'SAN JUAN': [18.4655, -66.1057]   // Puerto Rico
};

export function FilteredMap({ isOpen }: FilteredMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  
  // Filter state
  const [filters, setFilters] = useState<MapFilters>({
    status: 'all',
    branding: 'all',
    region: 'all'
  });
  
  // Get unique filter options
  const brandingOptions = Array.from(new Set(activeVehicles.map(v => v.branding).filter(Boolean))).sort();
  const regionOptions = Array.from(new Set(activeVehicles.map(v => v.region).filter(Boolean))).sort();
  
  // Filter vehicles based on current filters
  const filteredVehicles = activeVehicles.filter(vehicle => {
    if (filters.branding !== 'all' && vehicle.branding !== filters.branding) return false;
    if (filters.region !== 'all' && vehicle.region !== filters.region) return false;
    return true;
  });

  // Initialize map
  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstance.current) return;

    try {
      // Create Leaflet map
      const map = L.map(mapRef.current).setView([39.8, -98.5], 4);
      
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

  // Function to update markers
  const updateMarkers = () => {
    if (!mapInstance.current) return;
    
    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    
    // Add filtered markers
    let markersAdded = 0;
    const maxMarkersToShow = 1000;
    
    filteredVehicles.slice(0, maxMarkersToShow).forEach((vehicle) => {
      const coordinates = cityCoordinates[vehicle.city.toUpperCase()];
      if (!coordinates) return;
      
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
  };

  return (
    <div className="flex gap-4">
      {/* Filter Sidebar */}
      <Card className="w-64 flex-shrink-0">
        <CardHeader>
          <CardTitle className="text-sm">Filter Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
      <div className="flex-1 space-y-4">
        {/* Main Continental US Map */}
        <div className="bg-gray-100 rounded-lg overflow-hidden">
          <div className="bg-gray-800 text-white px-3 py-1 text-sm font-medium">
            Continental United States
          </div>
          <div 
            ref={mapRef} 
            style={{ 
              height: '400px',
              width: '100%'
            }}
          />
        </div>
        
        {/* Hawaii and Puerto Rico Maps */}
        <div className="grid grid-cols-2 gap-4">
          <HawaiiMap filteredVehicles={filteredVehicles} />
          <PuertoRicoMap filteredVehicles={filteredVehicles} />
        </div>
      </div>
    </div>
  );
}