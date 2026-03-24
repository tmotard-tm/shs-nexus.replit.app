import { useMemo, useState, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

interface PMFRecord {
  assetId: string;
  status: string;
  [key: string]: string;
}

interface LocationData {
  location: string;
  state: string;
  stateCode: string;
  available: number;
  lockedDownLocal: number;
  pendingArrival: number;
  approvedPickUp: number;
  total: number;
  lat: number;
  lng: number;
}

interface StateData {
  stateCode: string;
  stateName: string;
  available: number;
  lockedDownLocal: number;
  pendingArrival: number;
  approvedPickUp: number;
  total: number;
  locations: LocationData[];
}

const stateCodeToName: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia"
};

const stateCoordinates: Record<string, [number, number]> = {
  AL: [-86.9023, 32.3182], AK: [-152.4044, 61.3707], AZ: [-111.0937, 34.0489],
  AR: [-92.3731, 34.7465], CA: [-119.4179, 36.7783], CO: [-105.7821, 39.5501],
  CT: [-72.7554, 41.6032], DE: [-75.5277, 38.9108], FL: [-81.5158, 27.6648],
  GA: [-83.6487, 32.1656], HI: [-155.5828, 19.8968], ID: [-114.742, 44.0682],
  IL: [-89.3985, 40.6331], IN: [-86.1349, 40.2672], IA: [-93.0977, 41.878],
  KS: [-98.4842, 39.0119], KY: [-84.270, 37.8393], LA: [-91.9623, 30.9843],
  ME: [-69.4455, 45.2538], MD: [-76.6413, 39.0458], MA: [-71.3824, 42.4072],
  MI: [-84.5603, 44.3148], MN: [-94.6859, 46.7296], MS: [-89.3985, 32.3547],
  MO: [-91.8318, 37.9643], MT: [-110.3626, 46.8797], NE: [-99.9018, 41.4925],
  NV: [-116.4194, 38.8026], NH: [-71.5724, 43.1939], NJ: [-74.4057, 40.0583],
  NM: [-105.8701, 34.5199], NY: [-74.2179, 43.2994], NC: [-79.0193, 35.7596],
  ND: [-101.002, 47.5515], OH: [-82.9071, 40.4173], OK: [-97.0929, 35.0078],
  OR: [-120.5542, 43.8041], PA: [-77.1945, 41.2033], RI: [-71.4774, 41.5801],
  SC: [-80.9066, 33.8569], SD: [-99.9018, 43.9695], TN: [-86.5804, 35.5175],
  TX: [-99.9018, 31.9686], UT: [-111.0937, 39.3210], VT: [-72.5778, 44.5588],
  VA: [-78.1569, 37.4316], WA: [-120.7401, 47.7511], WV: [-80.4549, 38.5976],
  WI: [-89.6165, 43.7844], WY: [-107.2903, 43.0760], DC: [-77.0369, 38.9072]
};

function extractStateCode(locationAddress: string): string | null {
  if (!locationAddress) return null;
  const stateMatch = locationAddress.match(/,\s*([A-Z]{2})\s*\d{5}/);
  if (stateMatch) return stateMatch[1];
  const fallbackMatch = locationAddress.match(/,\s*([A-Z]{2})\s*$/);
  if (fallbackMatch) return fallbackMatch[1];
  return null;
}

interface PMFMapProps {
  data: PMFRecord[];
  statusFilter?: string | null;
  onStatusFilterChange?: (status: string | null) => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  state: StateData | null;
}

export function PMFMap({ data, statusFilter, onStatusFilterChange }: PMFMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    state: null,
  });

  const handleLegendClick = (status: string) => {
    if (onStatusFilterChange) {
      onStatusFilterChange(statusFilter === status ? null : status);
    }
  };

  const stateData = useMemo(() => {
    const stateMap = new Map<string, StateData>();
    // Track unique assets per state to avoid counting duplicates
    const seenAssetsByState = new Map<string, Set<string>>();
    const seenAssetsByStateStatus = new Map<string, Map<string, Set<string>>>();
    const seenAssetsByLocation = new Map<string, Set<string>>();
    const seenAssetsByLocationStatus = new Map<string, Map<string, Set<string>>>();

    data.forEach((record) => {
      const assetId = record.assetId;
      if (!assetId) return; // Skip records without asset ID
      
      const locationAddress = record["Location Address"] || "";
      const location = record["Location"] || "Unknown";
      const status = record.status?.toLowerCase() || "";
      const stateCode = extractStateCode(locationAddress);

      if (!stateCode || !stateCodeToName[stateCode]) return;
      
      // Skip "Checked Out" vehicles from all counts
      const statusLower = status.toLowerCase();
      if (statusLower.includes('checked out') || statusLower.includes('check out')) {
        return;
      }

      // Initialize tracking sets for this state
      if (!seenAssetsByState.has(stateCode)) {
        seenAssetsByState.set(stateCode, new Set());
        seenAssetsByStateStatus.set(stateCode, new Map());
      }
      
      const locationKey = `${stateCode}-${location}`;
      if (!seenAssetsByLocation.has(locationKey)) {
        seenAssetsByLocation.set(locationKey, new Set());
        seenAssetsByLocationStatus.set(locationKey, new Map());
      }

      if (!stateMap.has(stateCode)) {
        stateMap.set(stateCode, {
          stateCode,
          stateName: stateCodeToName[stateCode],
          available: 0,
          lockedDownLocal: 0,
          pendingArrival: 0,
          approvedPickUp: 0,
          total: 0,
          locations: [],
        });
      }

      const state = stateMap.get(stateCode)!;
      const stateAssets = seenAssetsByState.get(stateCode)!;
      const stateStatusAssets = seenAssetsByStateStatus.get(stateCode)!;
      
      // Track unique assets per state (total recalculated from status counts below)
      if (!stateAssets.has(assetId)) {
        stateAssets.add(assetId);
      }

      // Determine status category - use exact match (case-insensitive) to avoid "Unavailable" matching "available"
      let statusCategory = "";
      if (statusLower === "available") {
        statusCategory = "available";
      } else if (statusLower === "locked down local" || statusLower === "locked down – local") {
        statusCategory = "lockedDownLocal";
      } else if (statusLower === "pending arrival") {
        statusCategory = "pendingArrival";
      } else if (statusLower === "approved to pick up") {
        statusCategory = "approvedPickUp";
      }

      // Count status only if not already counted for this asset/state/status combo
      if (statusCategory) {
        if (!stateStatusAssets.has(statusCategory)) {
          stateStatusAssets.set(statusCategory, new Set());
        }
        const statusSet = stateStatusAssets.get(statusCategory)!;
        if (!statusSet.has(assetId)) {
          statusSet.add(assetId);
          if (statusCategory === "available") state.available++;
          else if (statusCategory === "lockedDownLocal") state.lockedDownLocal++;
          else if (statusCategory === "pendingArrival") state.pendingArrival++;
          else if (statusCategory === "approvedPickUp") state.approvedPickUp++;
        }
      }

      // Handle location data with unique counting
      let locationData = state.locations.find((l) => l.location === location);
      if (!locationData) {
        const coords = stateCoordinates[stateCode] || [-98.5795, 39.8283];
        locationData = {
          location,
          state: stateCodeToName[stateCode],
          stateCode,
          available: 0,
          lockedDownLocal: 0,
          pendingArrival: 0,
          approvedPickUp: 0,
          total: 0,
          lat: coords[1],
          lng: coords[0],
        };
        state.locations.push(locationData);
      }

      const locationAssets = seenAssetsByLocation.get(locationKey)!;
      const locationStatusAssets = seenAssetsByLocationStatus.get(locationKey)!;
      
      if (!locationAssets.has(assetId)) {
        locationAssets.add(assetId);
      }

      if (statusCategory) {
        if (!locationStatusAssets.has(statusCategory)) {
          locationStatusAssets.set(statusCategory, new Set());
        }
        const locStatusSet = locationStatusAssets.get(statusCategory)!;
        if (!locStatusSet.has(assetId)) {
          locStatusSet.add(assetId);
          if (statusCategory === "available") locationData.available++;
          else if (statusCategory === "lockedDownLocal") locationData.lockedDownLocal++;
          else if (statusCategory === "pendingArrival") locationData.pendingArrival++;
          else if (statusCategory === "approvedPickUp") locationData.approvedPickUp++;
        }
      }
    });

    for (const state of stateMap.values()) {
      state.total = state.available + state.lockedDownLocal + state.pendingArrival + state.approvedPickUp;
      for (const loc of state.locations) {
        loc.total = loc.available + loc.lockedDownLocal + loc.pendingArrival + loc.approvedPickUp;
      }
    }

    return Array.from(stateMap.values()).sort((a, b) => b.total - a.total);
  }, [data]);

  // Get filtered count based on status filter
  const getFilteredCount = (state: StateData): number => {
    if (!statusFilter) return state.total;
    const filterLower = statusFilter.toLowerCase();
    if (filterLower === "available") return state.available;
    if (filterLower === "locked down local" || filterLower === "locked down – local") return state.lockedDownLocal;
    if (filterLower === "pending arrival") return state.pendingArrival;
    if (filterLower === "approved to pick up") return state.approvedPickUp;
    return state.total;
  };

  const maxTotal = useMemo(() => {
    if (statusFilter) {
      return Math.max(...stateData.map((s) => getFilteredCount(s)), 1);
    }
    return Math.max(...stateData.map((s) => s.total), 1);
  }, [stateData, statusFilter]);

  const getMarkerSize = (state: StateData) => {
    const count = getFilteredCount(state);
    const minSize = 8;
    const maxSize = 24;
    return minSize + (count / maxTotal) * (maxSize - minSize);
  };

  const getStateColor = (stateCode: string) => {
    const state = stateData.find((s) => s.stateCode === stateCode);
    if (!state) return "#e5e7eb";
    const count = getFilteredCount(state);
    const intensity = Math.min(count / maxTotal, 1);
    
    // Use different colors based on filter
    if (statusFilter) {
      const filterLower = statusFilter.toLowerCase();
      if (filterLower === "available") {
        // Blue
        const r = Math.round(59 + (255 - 59) * (1 - intensity * 0.7));
        const g = Math.round(130 + (255 - 130) * (1 - intensity * 0.7));
        const b = Math.round(246 + (255 - 246) * (1 - intensity * 0.3));
        return `rgb(${r}, ${g}, ${b})`;
      } else if (filterLower === "locked down local" || filterLower === "locked down – local") {
        // Cyan
        const r = Math.round(6 + (255 - 6) * (1 - intensity * 0.7));
        const g = Math.round(182 + (255 - 182) * (1 - intensity * 0.5));
        const b = Math.round(212 + (255 - 212) * (1 - intensity * 0.3));
        return `rgb(${r}, ${g}, ${b})`;
      } else if (filterLower === "pending arrival") {
        // Amber
        const r = Math.round(245 + (255 - 245) * (1 - intensity * 0.3));
        const g = Math.round(158 + (255 - 158) * (1 - intensity * 0.5));
        const b = Math.round(11 + (255 - 11) * (1 - intensity * 0.7));
        return `rgb(${r}, ${g}, ${b})`;
      } else if (filterLower === "approved to pick up") {
        // Orange
        const r = Math.round(249 + (255 - 249) * (1 - intensity * 0.3));
        const g = Math.round(115 + (255 - 115) * (1 - intensity * 0.5));
        const b = Math.round(22 + (255 - 22) * (1 - intensity * 0.7));
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
    
    // Default blue gradient
    const r = Math.round(59 + (255 - 59) * (1 - intensity * 0.7));
    const g = Math.round(130 + (255 - 130) * (1 - intensity * 0.7));
    const b = Math.round(246 + (255 - 246) * (1 - intensity * 0.3));
    return `rgb(${r}, ${g}, ${b})`;
  };
  
  const getMarkerColor = () => {
    if (!statusFilter) return { fill: "rgba(59, 130, 246, 0.7)", stroke: "#1d4ed8" };
    const filterLower = statusFilter.toLowerCase();
    if (filterLower === "available") return { fill: "rgba(59, 130, 246, 0.7)", stroke: "#1d4ed8" };
    if (filterLower === "locked down local" || filterLower === "locked down – local") return { fill: "rgba(6, 182, 212, 0.7)", stroke: "#0891b2" };
    if (filterLower === "pending arrival") return { fill: "rgba(245, 158, 11, 0.7)", stroke: "#d97706" };
    if (filterLower === "approved to pick up") return { fill: "rgba(249, 115, 22, 0.7)", stroke: "#ea580c" };
    return { fill: "rgba(59, 130, 246, 0.7)", stroke: "#1d4ed8" };
  };

  const handleMarkerHover = (state: StateData, event: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setTooltip({
      visible: true,
      x,
      y,
      state,
    });
  };

  const handleMarkerLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4" data-testid="pmf-map-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Vehicle Locations by State
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-4">
          <div 
            ref={containerRef}
            className="flex-1 min-h-[300px] lg:min-h-[400px] relative" 
            data-testid="pmf-map-container"
          >
            <ComposableMap
              projection="geoAlbersUsa"
              projectionConfig={{ scale: 1000 }}
              style={{ width: "100%", height: "100%" }}
            >
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const stateCode = geo.properties.name
                      ? Object.entries(stateCodeToName).find(
                          ([, name]) => name === geo.properties.name
                        )?.[0]
                      : null;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={stateCode ? getStateColor(stateCode) : "#e5e7eb"}
                        stroke="#9ca3af"
                        strokeWidth={0.5}
                        style={{
                          default: { outline: "none" },
                          hover: { outline: "none", fill: "#93c5fd" },
                          pressed: { outline: "none" },
                        }}
                      />
                    );
                  })
                }
              </Geographies>

              {stateData.map((state) => {
                const coords = stateCoordinates[state.stateCode];
                if (!coords) return null;
                const filteredCount = getFilteredCount(state);
                // Hide markers with 0 count when filtering
                if (statusFilter && filteredCount === 0) return null;
                const size = getMarkerSize(state);
                const markerColors = getMarkerColor();

                return (
                  <Marker key={state.stateCode} coordinates={coords}>
                    <g
                      onMouseEnter={(e) => handleMarkerHover(state, e)}
                      onMouseMove={(e) => handleMarkerHover(state, e)}
                      onMouseLeave={handleMarkerLeave}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        r={size}
                        fill={markerColors.fill}
                        stroke={markerColors.stroke}
                        strokeWidth={2}
                        data-testid={`marker-${state.stateCode}`}
                      />
                      <text
                        textAnchor="middle"
                        y={4}
                        style={{
                          fontFamily: "system-ui",
                          fill: "#fff",
                          fontSize: size > 14 ? "10px" : "8px",
                          fontWeight: "bold",
                          pointerEvents: "none",
                        }}
                      >
                        {filteredCount}
                      </text>
                    </g>
                  </Marker>
                );
              })}
            </ComposableMap>

            {tooltip.visible && tooltip.state && (
              <div
                className="absolute z-50 bg-background border rounded-lg shadow-lg p-3 pointer-events-none"
                style={{
                  left: tooltip.x + 10,
                  top: tooltip.y - 10,
                  transform: tooltip.x > 400 ? "translateX(-100%)" : "none",
                }}
                data-testid={`tooltip-${tooltip.state.stateCode}`}
              >
                <div className="space-y-2">
                  <p className="font-semibold text-sm">{tooltip.state.stateName}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-blue-600 dark:text-blue-400">Available:</span>
                    <span className="font-medium">{tooltip.state.available}</span>
                    <span className="text-cyan-600 dark:text-cyan-400">Locked Down:</span>
                    <span className="font-medium">{tooltip.state.lockedDownLocal}</span>
                    <span className="text-amber-600 dark:text-amber-400">Pending Arrival:</span>
                    <span className="font-medium">{tooltip.state.pendingArrival}</span>
                    <span className="text-orange-600 dark:text-orange-400">Approved for Pick Up:</span>
                    <span className="font-medium">{tooltip.state.approvedPickUp}</span>
                  </div>
                  <div className="border-t pt-1 mt-1">
                    <span className="text-xs text-muted-foreground">Total: {tooltip.state.total}</span>
                  </div>
                  {tooltip.state.locations.length > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs font-medium mb-2">By Location:</p>
                      <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground mb-1 px-0.5">
                        <span className="text-blue-600 dark:text-blue-400">Avail</span>
                        <span className="text-cyan-600 dark:text-cyan-400">Locked</span>
                        <span className="text-amber-600 dark:text-amber-400">Arrival</span>
                        <span className="text-orange-600 dark:text-orange-400">Appr.</span>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {tooltip.state.locations
                          .sort((a, b) => b.total - a.total)
                          .slice(0, 5)
                          .map((loc) => (
                          <div key={loc.location} className="text-xs border-b border-border/50 pb-1 last:border-0">
                            <p className="font-medium truncate max-w-48" title={loc.location}>
                              {loc.location}
                            </p>
                            <div className="grid grid-cols-4 gap-1 mt-1">
                              <span className="text-blue-600 dark:text-blue-400 font-medium">
                                {loc.available}
                              </span>
                              <span className="text-cyan-600 dark:text-cyan-400 font-medium">
                                {loc.lockedDownLocal}
                              </span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                {loc.pendingArrival}
                              </span>
                              <span className="text-orange-600 dark:text-orange-400 font-medium">
                                {loc.approvedPickUp}
                              </span>
                            </div>
                          </div>
                        ))}
                        {tooltip.state.locations.length > 5 && (
                          <p className="text-xs text-muted-foreground pt-1">
                            +{tooltip.state.locations.length - 5} more locations
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="lg:w-64 space-y-2" data-testid="pmf-map-legend">
            <h4 className="font-medium text-sm mb-2">Top States</h4>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {stateData.slice(0, 10).map((state) => (
                <div
                  key={state.stateCode}
                  className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs"
                  data-testid={`legend-${state.stateCode}`}
                >
                  <span className="font-medium">{state.stateName}</span>
                  <div className="flex gap-2">
                    <span className="text-blue-600" title="Available">{state.available}</span>
                    <span className="text-cyan-600" title="Locked Down">{state.lockedDownLocal}</span>
                    <span className="text-amber-600" title="Pending Arrival">{state.pendingArrival}</span>
                    <span className="text-orange-600" title="Approved for Pick Up">{state.approvedPickUp}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t text-xs">
              <p className="text-muted-foreground mb-2">Click to filter map:</p>
              {statusFilter && (
                <button
                  onClick={() => onStatusFilterChange?.(null)}
                  className="mb-2 text-xs text-primary hover:underline"
                  data-testid="button-clear-map-filter"
                >
                  Clear filter
                </button>
              )}
              <div 
                className={`flex items-center gap-2 mb-1 p-1 rounded cursor-pointer hover:bg-muted/50 ${statusFilter === "Available" ? "bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-500" : ""}`}
                onClick={() => handleLegendClick("Available")}
                data-testid="legend-filter-available"
              >
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                <span className={statusFilter === "Available" ? "font-medium" : ""}>Available</span>
              </div>
              <div 
                className={`flex items-center gap-2 mb-1 p-1 rounded cursor-pointer hover:bg-muted/50 ${statusFilter === "Locked Down Local" ? "bg-cyan-100 dark:bg-cyan-900/30 ring-1 ring-cyan-500" : ""}`}
                onClick={() => handleLegendClick("Locked Down Local")}
                data-testid="legend-filter-locked-down"
              >
                <span className="w-3 h-3 rounded-full bg-cyan-500"></span>
                <span className={statusFilter === "Locked Down Local" ? "font-medium" : ""}>Locked Down Local</span>
              </div>
              <div 
                className={`flex items-center gap-2 mb-1 p-1 rounded cursor-pointer hover:bg-muted/50 ${statusFilter === "Pending Arrival" ? "bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-500" : ""}`}
                onClick={() => handleLegendClick("Pending Arrival")}
                data-testid="legend-filter-pending-arrival"
              >
                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                <span className={statusFilter === "Pending Arrival" ? "font-medium" : ""}>Pending Arrival</span>
              </div>
              <div 
                className={`flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-muted/50 ${statusFilter === "Approved to Pick Up" ? "bg-orange-100 dark:bg-orange-900/30 ring-1 ring-orange-500" : ""}`}
                onClick={() => handleLegendClick("Approved to Pick Up")}
                data-testid="legend-filter-approved-pickup"
              >
                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                <span className={statusFilter === "Approved to Pick Up" ? "font-medium" : ""}>Approved for Pick Up</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
