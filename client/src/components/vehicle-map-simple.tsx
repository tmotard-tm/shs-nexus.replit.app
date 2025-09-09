import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface SimpleMapProps {
  isOpen: boolean;
}

export function SimpleMap({ isOpen }: SimpleMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!isOpen || !mapRef.current || mapInstance.current) return;

    try {
      // Create simple Leaflet map
      const map = L.map(mapRef.current).setView([39.8, -98.5], 4);
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      // Add a sample marker
      L.marker([39.8, -98.5])
        .addTo(map)
        .bindPopup('Sample Vehicle Location');

      mapInstance.current = map;
      console.log('✅ Simple map created successfully');

    } catch (error) {
      console.error('❌ Error creating simple map:', error);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [isOpen]);

  return (
    <div 
      ref={mapRef} 
      style={{ 
        width: '100%', 
        height: '400px',
        backgroundColor: '#f0f0f0'
      }}
    />
  );
}