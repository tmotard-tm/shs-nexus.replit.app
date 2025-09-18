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
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Filter vehicles in Hawaii
  const hawaiiVehicles = filteredVehicles.filter(vehicle => 
    vehicle.state === 'HI' || vehicle.state === 'Hawaii'
  );

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear container to prevent duplicates
    mapRef.current.innerHTML = '';

    try {
      // Create Hawaii-focused map
      const map = L.map(mapRef.current).setView([21.3099, -157.8581], 8);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstance.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);

      // Ensure proper sizing within wrapper
      setTimeout(() => {
        mapInstance.current?.invalidateSize();
        mapInstance.current?.setView([21.3099, -157.8581], 7);
      }, 100);

    } catch (error) {
      console.error('Error creating Hawaii map:', error);
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
    
    // Add Hawaii vehicle markers
    hawaiiVehicles.forEach((vehicle) => {
      const coordinates = hawaiiCoordinates[vehicle.city.toUpperCase()];
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
          <strong>Location:</strong> ${vehicle.city}, HI<br/>
          <strong>Status:</strong> ${vehicle.branding}
        </div>
      `);
      
      markersLayerRef.current!.addLayer(marker);
    });
    
    // Force map to refresh and ensure markers are visible
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 100);
  }, [hawaiiVehicles]);

  return (
    <div className="map-wrapper">
      <div 
        ref={mapRef} 
        className="absolute inset-0"
      />
    </div>
  );
}