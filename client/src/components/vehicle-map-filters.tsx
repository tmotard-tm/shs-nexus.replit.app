import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { type FleetVehicle } from '@/data/fleetData';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Filter, RotateCcw } from 'lucide-react';
import { expandedCityCoordinates } from '@/data/expanded-city-coordinates';
import { useQuery } from '@tanstack/react-query';

interface FilteredMapProps {
  isOpen: boolean;
}

interface MapFilters {
  make: string;
  state: string;
  assigned: string;
  zipCode: string;
}

const assignmentColors = {
  assigned: '#3B82F6',
  unassigned: '#EF4444',
  default: '#6B7280',
};

const cityCoordinates = expandedCityCoordinates;

export function FilteredMap({ isOpen }: FilteredMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState<MapFilters>({
    make: 'all',
    state: 'all',
    assigned: 'all',
    zipCode: '',
  });

  const { data: apiResponse } = useQuery<{ success: boolean; totalCount: number; vehicles: FleetVehicle[] }>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
  });

  const vehicles = apiResponse?.vehicles || [];

  const makeOptions = useMemo(() => Array.from(new Set(vehicles.map(v => v.makeName).filter(Boolean))).sort(), [vehicles]);
  const stateOptions = useMemo(() => Array.from(new Set(vehicles.map(v => v.state).filter(Boolean))).sort(), [vehicles]);

  const filteredVehicles = useMemo(() => vehicles.filter(vehicle => {
    if (filters.make !== 'all' && vehicle.makeName !== filters.make) return false;
    if (filters.state !== 'all' && vehicle.state !== filters.state) return false;
    if (filters.assigned === 'assigned' && !vehicle.tpmsAssignedTechId) return false;
    if (filters.assigned === 'unassigned' && vehicle.tpmsAssignedTechId) return false;
    if (filters.zipCode && !(vehicle.zip || '').includes(filters.zipCode)) return false;
    return true;
  }), [vehicles, filters]);

  const hasActiveFilters = filters.make !== 'all' || filters.state !== 'all' || filters.assigned !== 'all' || filters.zipCode !== '';

  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstance.current) return;

    try {
      const continentalUSBounds = L.latLngBounds(
        L.latLng(24.396308, -125.0),
        L.latLng(49.384358, -66.93457)
      );

      const map = L.map(mapRef.current, {
        maxBounds: continentalUSBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 4,
        maxZoom: 18,
      }).setView([39.8, -98.5], 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      mapInstance.current = map;
    } catch (error) {
      console.error('Error creating filtered map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!mapInstance.current || !isOpen) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    filteredVehicles.forEach((vehicle) => {
      const coordinates = cityCoordinates[(vehicle.city || '').toUpperCase()];
      if (!coordinates) return;

      const lat = coordinates[0] + (Math.random() - 0.5) * 0.1;
      const lng = coordinates[1] + (Math.random() - 0.5) * 0.1;

      const color = vehicle.tpmsAssignedTechId ? assignmentColors.assigned : assignmentColors.unassigned;

      const marker = L.circleMarker([lat, lng], {
        radius: 4,
        fillColor: color,
        color: '#000',
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.6,
      });

      const techInfo = vehicle.tpmsAssignedTechId
        ? `<strong>Tech:</strong> ${vehicle.tpmsAssignedTechName || vehicle.tpmsAssignedTechId}<br/>`
        : '<strong>Status:</strong> Unassigned<br/>';

      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 200px;">
          <strong>${vehicle.modelYear || ''} ${vehicle.makeName || ''} ${vehicle.modelName || ''}</strong><br/>
          <strong>Vehicle #:</strong> ${vehicle.vehicleNumber || 'N/A'}<br/>
          ${techInfo}
          <strong>Location:</strong> ${vehicle.city || ''}, ${vehicle.state || ''}<br/>
          <strong>Fuel:</strong> ${vehicle.fuelType || 'N/A'}
        </div>
      `);

      marker.addTo(mapInstance.current!);
      markersRef.current.push(marker);
    });

    if (markersRef.current.length > 0 && mapInstance.current) {
      const group = new L.FeatureGroup(markersRef.current);
      mapInstance.current.fitBounds(group.getBounds().pad(0.05));
    }
  }, [filteredVehicles, isOpen]);

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

  const resetFilters = () => setFilters({ make: 'all', state: 'all', assigned: 'all', zipCode: '' });

  return (
    <div className="relative h-full w-full">
      <div ref={mapRef} className="absolute inset-0 z-0 rounded-lg" />

      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="shadow-md gap-1.5"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <Badge variant="default" className="ml-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]">!</Badge>
          )}
        </Button>

        {showFilters && (
          <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 w-52 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Filters</span>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={resetFilters}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Reset
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Assignment</Label>
              <Select value={filters.assigned} onValueChange={(v) => setFilters(prev => ({ ...prev, assigned: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="assigned">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Assigned</span>
                  </SelectItem>
                  <SelectItem value="unassigned">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Unassigned</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Make</Label>
              <Select value={filters.make} onValueChange={(v) => setFilters(prev => ({ ...prev, make: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Makes</SelectItem>
                  {makeOptions.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">State</Label>
              <Select value={filters.state} onValueChange={(v) => setFilters(prev => ({ ...prev, state: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {stateOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Zip Code</Label>
              <Input
                className="h-7 text-xs"
                placeholder="Enter zip..."
                value={filters.zipCode}
                onChange={(e) => setFilters(prev => ({ ...prev, zipCode: e.target.value }))}
              />
            </div>

            <div className="pt-2 border-t text-[11px] text-muted-foreground">
              Showing {filteredVehicles.length.toLocaleString()} of {vehicles.length.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-3 right-3 z-[1000] flex gap-3 bg-background/90 backdrop-blur-sm rounded-md px-3 py-1.5 shadow text-[11px]">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-black/20" />Assigned</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-black/20" />Unassigned</span>
      </div>
    </div>
  );
}
