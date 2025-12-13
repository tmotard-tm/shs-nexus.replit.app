import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { FleetVehicle } from '@/data/fleetData';

interface AlaskaMapProps {
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

const alaskaCoordinates = expandedCityCoordinates;

export function AlaskaMap({ filteredVehicles }: AlaskaMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const alaskaVehicles = filteredVehicles.filter(vehicle => 
    vehicle.state === 'AK' || vehicle.state === 'Alaska'
  );

  useEffect(() => {
    if (!mapRef.current) return;

    mapRef.current.innerHTML = '';

    try {
      const map = L.map(mapRef.current, {
        minZoom: 3,
        maxZoom: 18
      }).setView([64.2, -152.5], 4);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstance.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);

      setTimeout(() => {
        mapInstance.current?.invalidateSize();
        mapInstance.current?.setView([64.2, -152.5], 4);
      }, 100);

    } catch (error) {
      console.error('Error creating Alaska map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    
    alaskaVehicles.forEach((vehicle) => {
      const coordinates = alaskaCoordinates[vehicle.city.toUpperCase()];
      if (!coordinates) return;
      
      const lat = coordinates[0] + (Math.random() - 0.5) * 0.02;
      const lng = coordinates[1] + (Math.random() - 0.5) * 0.02;
      
      const color = statusColors[vehicle.branding as keyof typeof statusColors] || statusColors.default;
      
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 24px;
          height: 24px;
          background-color: ${color};
          border: 4px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 4px 8px rgba(0,0,0,0.4);
          z-index: 1000 !important;
          position: relative !important;
          display: block !important;
        "></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      
      const marker = L.marker([lat, lng], { icon: customIcon });
      
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; min-width: 180px;">
          <strong>${vehicle.modelYear} ${vehicle.makeName}</strong><br/>
          <strong>VIN:</strong> ${vehicle.vin}<br/>
          <strong>Location:</strong> ${vehicle.city}, AK<br/>
          <strong>Status:</strong> ${vehicle.branding}
        </div>
      `);
      
      markersLayerRef.current!.addLayer(marker);
    });
    
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 100);
  }, [alaskaVehicles]);

  return (
    <div className="relative w-full h-full">
      <div 
        ref={mapRef} 
        className="absolute inset-0"
      />
    </div>
  );
}
