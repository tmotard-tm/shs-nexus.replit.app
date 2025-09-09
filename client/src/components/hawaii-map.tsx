import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { FleetVehicle } from '@/data/fleetData';

interface HawaiiMapProps {
  filteredVehicles: FleetVehicle[];
}

const statusColors = {
  'AE Factory Service': '#3B82F6',
  'Sears': '#3B82F6',
  'Kenmore': '#10B981',
  'DieHard': '#F59E0B',
  'Craftsman': '#EF4444',
  'PartsDirect': '#8B5CF6',
  'default': '#6B7280'
};

import { expandedCityCoordinates } from '@/data/expanded-city-coordinates';

const hawaiiCoordinates = expandedCityCoordinates;

export function HawaiiMap({ filteredVehicles }: HawaiiMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);

  // Filter vehicles in Hawaii
  const hawaiiVehicles = filteredVehicles.filter(vehicle => 
    vehicle.state === 'HI' || 
    hawaiiCoordinates[vehicle.city.toUpperCase()]
  );

  useEffect(() => {
    if (!mapRef.current) return;

    // Clean up existing map
    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    try {
      // Create Hawaii-focused map
      const map = L.map(mapRef.current).setView([21.3099, -157.8581], 8);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstance.current = map;
      
      // Add Hawaii vehicle markers
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      
      hawaiiVehicles.forEach((vehicle) => {
        const coordinates = hawaiiCoordinates[vehicle.city.toUpperCase()];
        if (!coordinates) return;
        
        const lat = coordinates[0] + (Math.random() - 0.5) * 0.02;
        const lng = coordinates[1] + (Math.random() - 0.5) * 0.02;
        
        const color = statusColors[vehicle.branding as keyof typeof statusColors] || statusColors.default;
        
        const marker = L.circleMarker([lat, lng], {
          radius: 5,
          fillColor: color,
          color: '#000',
          weight: 1,
          opacity: 0.8,
          fillOpacity: 0.7
        });
        
        marker.bindPopup(`
          <div style="font-family: system-ui, sans-serif; min-width: 180px;">
            <strong>${vehicle.modelYear} ${vehicle.makeName}</strong><br/>
            <strong>VIN:</strong> ${vehicle.vin}<br/>
            <strong>Location:</strong> ${vehicle.city}, HI<br/>
            <strong>Status:</strong> ${vehicle.branding}
          </div>
        `);
        
        marker.addTo(map);
        markersRef.current.push(marker);
      });

    } catch (error) {
      console.error('Error creating Hawaii map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [hawaiiVehicles]);

  return (
    <div className="bg-gray-100 rounded-lg overflow-hidden">
      <div className="bg-gray-800 text-white px-3 py-1 text-sm font-medium flex justify-between">
        <span>Hawaii</span>
        <span className="text-xs opacity-75">{hawaiiVehicles.length} vehicles</span>
      </div>
      <div 
        ref={mapRef} 
        style={{ 
          height: '200px',
          width: '100%'
        }}
      />
    </div>
  );
}