import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { FleetVehicle } from '@/data/fleetData';

interface PuertoRicoMapProps {
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

const puertoRicoCoordinates = expandedCityCoordinates;

export function PuertoRicoMap({ filteredVehicles }: PuertoRicoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Filter vehicles in Puerto Rico
  const puertoRicoVehicles = filteredVehicles.filter(vehicle => 
    vehicle.state === 'PR' || vehicle.state === 'Puerto Rico'
  );

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear container to prevent duplicates
    mapRef.current.innerHTML = '';

    try {
      // Create Puerto Rico-focused map
      const map = L.map(mapRef.current).setView([18.4655, -66.1057], 9);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstance.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);

      // Ensure proper sizing within wrapper
      setTimeout(() => {
        mapInstance.current?.invalidateSize();
        mapInstance.current?.setView([18.4655, -66.1057], 9);
      }, 100);

    } catch (error) {
      console.error('Error creating Puerto Rico map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Update markers when data changes
  useEffect(() => {
    if (!mapInstance.current || !markersLayerRef.current) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();
    
    // Add Puerto Rico vehicle markers
    puertoRicoVehicles.forEach((vehicle) => {
      const coordinates = puertoRicoCoordinates[vehicle.city.toUpperCase()];
      if (!coordinates) return;
      
      const lat = coordinates[0] + (Math.random() - 0.5) * 0.02;
      const lng = coordinates[1] + (Math.random() - 0.5) * 0.02;
      
      const color = statusColors[vehicle.branding as keyof typeof statusColors] || statusColors.default;
      
      // Create a custom icon for better visibility
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 20px;
          height: 20px;
          background-color: ${color};
          border: 3px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          z-index: 1000;
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      
      const marker = L.marker([lat, lng], { icon: customIcon });
      
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 180px;">
          <strong>${vehicle.modelYear} ${vehicle.makeName}</strong><br/>
          <strong>VIN:</strong> ${vehicle.vin}<br/>
          <strong>Location:</strong> ${vehicle.city}, PR<br/>
          <strong>Status:</strong> ${vehicle.branding}
        </div>
      `);
      
      markersLayerRef.current!.addLayer(marker);
    });
  }, [puertoRicoVehicles]);

  return (
    <div className="map-wrapper">
      <div 
        ref={mapRef} 
        className="absolute inset-0"
      />
    </div>
  );
}