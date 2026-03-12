import { useMemo, useState, useCallback } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, ZoomIn, ZoomOut, RotateCcw, X, ChevronDown, ChevronUp, Truck } from 'lucide-react';

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

interface Vehicle {
  vehicleNumber: string;
  assignmentStatus: string;
  generalStatus: string;
  subStatus: string;
  locationState: string;
  locationSource?: string;
}

interface ByovTechnician {
  name: string;
  truckId: string;
  location: string;
  state: string;
}

export interface MapSelection {
  state: string;
  category?: CategoryKey;
  label: string;
}

export interface MapFilters {
  selections: MapSelection[];
  visibleCategories: Set<CategoryKey>;
}

interface USMapVehiclesProps {
  vehicles: Vehicle[];
  byovTechnicians?: ByovTechnician[];
  onMapFiltersChange?: (filters: MapFilters) => void;
  activeSelections?: MapSelection[];
  visibleCategories?: Set<CategoryKey>;
  rentalsByState?: Record<string, number>;
}

export type CategoryKey = 'onRoad' | 'repairShop' | 'pmf' | 'byov' | 'confirmedSpare' | 'needsReconfirmation';

interface StateData {
  onRoad: number;
  repairShop: number;
  pmf: number;
  byov: number;
  confirmedSpare: number;
  needsReconfirmation: number;
}

const stateCoordinates: Record<string, [number, number]> = {
  'AL': [-86.9023, 32.3182],
  'AK': [-149.4937, 64.2008],
  'AZ': [-111.0937, 34.0489],
  'AR': [-92.3731, 34.7465],
  'CA': [-119.4179, 36.7783],
  'CO': [-105.3111, 39.0598],
  'CT': [-72.7554, 41.6032],
  'DE': [-75.5277, 38.9108],
  'FL': [-81.5158, 27.6648],
  'GA': [-83.6431, 32.1574],
  'HI': [-157.5, 20.5],
  'ID': [-114.7420, 44.0682],
  'IL': [-89.3985, 40.6331],
  'IN': [-86.1349, 40.2672],
  'IA': [-93.0977, 41.8780],
  'KS': [-98.4842, 39.0119],
  'KY': [-84.2700, 37.8393],
  'LA': [-91.9623, 30.9843],
  'ME': [-69.4455, 45.2538],
  'MD': [-76.6413, 39.0458],
  'MA': [-71.3824, 42.4072],
  'MI': [-84.5603, 44.3148],
  'MN': [-94.6859, 46.7296],
  'MS': [-89.3985, 32.3547],
  'MO': [-91.8318, 37.9643],
  'MT': [-110.3626, 46.8797],
  'NE': [-99.9018, 41.4925],
  'NV': [-116.4194, 38.8026],
  'NH': [-71.5724, 43.1939],
  'NJ': [-74.4057, 40.0583],
  'NM': [-105.8701, 34.5199],
  'NY': [-75.4999, 43.2994],
  'NC': [-79.0193, 35.7596],
  'ND': [-101.0020, 47.5515],
  'OH': [-82.9071, 40.4173],
  'OK': [-97.0929, 35.0078],
  'OR': [-120.5542, 43.8041],
  'PA': [-77.1945, 41.2033],
  'RI': [-71.4774, 41.5801],
  'SC': [-81.1637, 33.8361],
  'SD': [-99.9018, 43.9695],
  'TN': [-86.5804, 35.5175],
  'TX': [-99.9018, 31.9686],
  'UT': [-111.0937, 39.3210],
  'VT': [-72.5778, 44.5588],
  'VA': [-78.6569, 37.4316],
  'WA': [-120.7401, 47.7511],
  'WV': [-80.4549, 38.5976],
  'WI': [-89.6385, 43.7844],
  'WY': [-107.2903, 43.0760],
  'DC': [-77.0369, 38.9072],
};

const stateNameToAbbr: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  'District of Columbia': 'DC',
};

const offshoreStates: Record<string, { offshore: [number, number]; anchor: [number, number] }> = {
  'MA': { offshore: [-65.5, 42.5], anchor: [-70.5, 42.0] },
  'CT': { offshore: [-66.5, 41.0], anchor: [-72.0, 41.5] },
  'RI': { offshore: [-65.0, 40.0], anchor: [-71.4, 41.5] },
  'NH': { offshore: [-64.5, 44.0], anchor: [-71.0, 43.5] },
  'VT': { offshore: [-64.0, 45.5], anchor: [-72.0, 44.0] },
  'NJ': { offshore: [-67.0, 39.0], anchor: [-74.0, 40.0] },
  'DE': { offshore: [-68.0, 37.5], anchor: [-75.5, 39.0] },
  'MD': { offshore: [-69.0, 36.0], anchor: [-76.5, 39.0] },
  'DC': { offshore: [-70.0, 34.5], anchor: [-77.0, 38.9] },
};

const isPmfVehicle = (subStatus: string): boolean => {
  if (!subStatus) return false;
  const lower = subStatus.toLowerCase();
  return lower.includes('pmf') || 
         lower.includes('process at pmf') || 
         lower.includes('available to redeploy') || 
         lower.includes('unavailable') ||
         lower.includes('pending pickup') ||
         lower.includes('pending arrival') ||
         lower.includes('locked down');
};

const categoryLabels: Record<CategoryKey, string> = {
  onRoad: 'On Road',
  repairShop: 'Repair Shop',
  pmf: 'PMF',
  byov: 'BYOV',
  confirmedSpare: 'Confirmed Spare Location',
  needsReconfirmation: 'Needs Reconfirmation',
};

const categories: { key: CategoryKey; color: string; stroke: string; label: string; bgClass: string; borderClass: string; dotClass: string; textClass: string }[] = [
  { key: 'onRoad', color: 'rgba(34, 197, 94, 0.9)', stroke: '#16a34a', label: 'On Road', bgClass: 'bg-green-50 dark:bg-green-900/20', borderClass: 'border-green-200 dark:border-green-800', dotClass: 'bg-green-500', textClass: 'text-green-700 dark:text-green-300' },
  { key: 'repairShop', color: 'rgba(245, 158, 11, 0.9)', stroke: '#d97706', label: 'Repair Shop', bgClass: 'bg-amber-50 dark:bg-amber-900/20', borderClass: 'border-amber-200 dark:border-amber-800', dotClass: 'bg-amber-500', textClass: 'text-amber-700 dark:text-amber-300' },
  { key: 'pmf', color: 'rgba(59, 130, 246, 0.9)', stroke: '#2563eb', label: 'PMF', bgClass: 'bg-blue-50 dark:bg-blue-900/20', borderClass: 'border-blue-200 dark:border-blue-800', dotClass: 'bg-blue-500', textClass: 'text-blue-700 dark:text-blue-300' },
  { key: 'byov', color: 'rgba(20, 184, 166, 0.9)', stroke: '#0d9488', label: 'BYOV', bgClass: 'bg-teal-50 dark:bg-teal-900/20', borderClass: 'border-teal-200 dark:border-teal-800', dotClass: 'bg-teal-500', textClass: 'text-teal-700 dark:text-teal-300' },
  { key: 'confirmedSpare', color: 'rgba(147, 51, 234, 0.9)', stroke: '#7c3aed', label: 'Confirmed Spare Location', bgClass: 'bg-purple-50 dark:bg-purple-900/20', borderClass: 'border-purple-200 dark:border-purple-800', dotClass: 'bg-purple-500', textClass: 'text-purple-700 dark:text-purple-300' },
  { key: 'needsReconfirmation', color: 'rgba(236, 72, 153, 0.9)', stroke: '#db2777', label: 'Needs Reconfirmation', bgClass: 'bg-pink-50 dark:bg-pink-900/20', borderClass: 'border-pink-200 dark:border-pink-800', dotClass: 'bg-pink-500', textClass: 'text-pink-700 dark:text-pink-300' },
];

const DEFAULT_CENTER: [number, number] = [-96, 38];
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;

const regionMapping: Record<string, { name: string; colorClass: string }> = {
  'VA': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'FL': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'NY': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'GA': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'MD': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'NC': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'PA': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'MA': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'CT': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'DE': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'RI': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'NJ': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'WV': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'ME': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'SC': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'NH': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'VT': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' }, 'DC': { name: 'East', colorClass: 'text-blue-600 dark:text-blue-400' },
  'TX': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'IL': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'OH': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'KY': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'IN': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'MI': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'MO': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'TN': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'WI': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'IA': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'KS': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'OK': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'ND': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'NE': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'MN': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' }, 'SD': { name: 'Central', colorClass: 'text-amber-600 dark:text-amber-400' },
  'CA': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'AL': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'AR': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'CO': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'MS': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'WA': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'AZ': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'ID': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'LA': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'OR': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'UT': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'HI': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'NM': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'NV': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
  'MT': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' }, 'WY': { name: 'West', colorClass: 'text-green-600 dark:text-green-400' },
};

function RentalsByStatePanel({ rentalsByState }: { rentalsByState: Record<string, number> }) {
  const [expanded, setExpanded] = useState(false);

  const sortedStates = useMemo(() => {
    return Object.entries(rentalsByState)
      .sort((a, b) => b[1] - a[1]);
  }, [rentalsByState]);

  const totalRentals = useMemo(() => sortedStates.reduce((sum, [, count]) => sum + count, 0), [sortedStates]);

  const regionTotals = useMemo(() => {
    const totals: Record<string, number> = { East: 0, Central: 0, West: 0, Other: 0 };
    for (const [state, count] of sortedStates) {
      const region = regionMapping[state]?.name || 'Other';
      totals[region] += count;
    }
    return totals;
  }, [sortedStates]);

  return (
    <div 
      className="absolute bottom-3 right-3 z-10 bg-background/95 backdrop-blur-sm border rounded-md shadow-sm"
      style={{ maxWidth: '220px' }}
      data-testid="panel-rentals-by-state"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium hover-elevate rounded-md"
        data-testid="button-toggle-rentals-panel"
      >
        <span className="flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          <span>Rentals by State</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {totalRentals}
          </Badge>
        </span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-b pb-1.5 flex-wrap">
            <span className="text-blue-600 dark:text-blue-400 font-medium">East: {regionTotals.East}</span>
            <span className="text-amber-600 dark:text-amber-400 font-medium">Central: {regionTotals.Central}</span>
            <span className="text-green-600 dark:text-green-400 font-medium">West: {regionTotals.West}</span>
            {regionTotals.Other > 0 && <span className="font-medium">Other: {regionTotals.Other}</span>}
          </div>
          <div className="max-h-[280px] overflow-y-auto space-y-0.5" data-testid="list-rentals-by-state">
            {sortedStates.map(([state, count]) => {
              const region = regionMapping[state];
              return (
                <div 
                  key={state} 
                  className="flex items-center justify-between text-[11px] px-1 py-0.5 rounded"
                  data-testid={`rental-state-${state}`}
                >
                  <span className={`font-medium ${region?.colorClass || 'text-foreground'}`}>{state}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function USMapVehicles({ vehicles, byovTechnicians = [], onMapFiltersChange, activeSelections = [], visibleCategories: externalVisibleCategories, rentalsByState }: USMapVehiclesProps) {
  const allCategoryKeys = useMemo(() => new Set(categories.map(c => c.key)), []);
  const visibleCategories = externalVisibleCategories || allCategoryKeys;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);

  const toggleCategory = (key: CategoryKey) => {
    if (!onMapFiltersChange) return;
    const next = new Set(visibleCategories);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onMapFiltersChange({ selections: activeSelections, visibleCategories: next });
  };

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev * ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev / ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setCenter(DEFAULT_CENTER);
  }, []);

  const handleMoveEnd = useCallback((position: { coordinates: [number, number]; zoom: number }) => {
    setCenter(position.coordinates);
    setZoom(position.zoom);
  }, []);

  const isSelectionActive = useCallback((state: string, category?: CategoryKey): boolean => {
    return activeSelections.some(s => s.state === state && s.category === category);
  }, [activeSelections]);

  const handleBubbleClick = useCallback((state: string, categoryKey: CategoryKey, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onMapFiltersChange) return;
    const alreadySelected = isSelectionActive(state, categoryKey);
    let newSelections: MapSelection[];
    if (alreadySelected) {
      newSelections = activeSelections.filter(s => !(s.state === state && s.category === categoryKey));
    } else {
      newSelections = [...activeSelections, {
        state,
        category: categoryKey,
        label: `${state} - ${categoryLabels[categoryKey]}`,
      }];
    }
    onMapFiltersChange({ selections: newSelections, visibleCategories });
  }, [onMapFiltersChange, activeSelections, isSelectionActive, visibleCategories]);

  const handleStateClick = useCallback((stateName: string) => {
    if (!onMapFiltersChange) return;
    const abbr = stateNameToAbbr[stateName];
    if (!abbr) return;
    const alreadySelected = isSelectionActive(abbr, undefined);
    let newSelections: MapSelection[];
    if (alreadySelected) {
      newSelections = activeSelections.filter(s => !(s.state === abbr && !s.category));
    } else {
      newSelections = [...activeSelections, {
        state: abbr,
        label: `All vehicles in ${abbr}`,
      }];
    }
    onMapFiltersChange({ selections: newSelections, visibleCategories });
  }, [onMapFiltersChange, activeSelections, isSelectionActive, visibleCategories]);

  const byovVehicleNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const tech of byovTechnicians) {
      if (tech.truckId) {
        set.add(tech.truckId.toString().padStart(6, '0'));
      }
    }
    return set;
  }, [byovTechnicians]);

  const stateData = useMemo(() => {
    const data: Record<string, StateData> = {};
    const countedVehicleNumbers = new Set<string>();
    
    for (const vehicle of vehicles) {
      const state = vehicle.locationState?.toUpperCase().trim();
      if (!state || !stateCoordinates[state]) continue;
      
      if (!data[state]) {
        data[state] = { onRoad: 0, repairShop: 0, pmf: 0, byov: 0, confirmedSpare: 0, needsReconfirmation: 0 };
      }

      const vNum = vehicle.vehicleNumber?.toString().padStart(6, '0');
      countedVehicleNumbers.add(vNum);
      const isByov = byovVehicleNumbers.has(vNum);

      if (isByov) {
        data[state].byov++;
      } else if (vehicle.generalStatus === 'On Road') {
        data[state].onRoad++;
      } else if (vehicle.generalStatus === 'Vehicles in a repair shop') {
        data[state].repairShop++;
      } else if (vehicle.generalStatus === 'Vehicles in storage') {
        if (isPmfVehicle(vehicle.subStatus)) {
          data[state].pmf++;
        } else {
          const src = (vehicle.locationSource || '').toLowerCase();
          const hasConfirmedLocation = src === 'confirmed' || src === 'both';
          if (hasConfirmedLocation) {
            data[state].confirmedSpare++;
          } else {
            data[state].needsReconfirmation++;
          }
        }
      } else if (vehicle.generalStatus === 'PMF') {
        data[state].pmf++;
      } else {
        data[state].onRoad++;
      }
    }

    for (const tech of byovTechnicians) {
      const techState = tech.state?.toUpperCase().trim();
      if (!techState || !stateCoordinates[techState]) continue;
      const vNum = tech.truckId?.toString().padStart(6, '0');
      if (!countedVehicleNumbers.has(vNum)) {
        if (!data[techState]) {
          data[techState] = { onRoad: 0, repairShop: 0, pmf: 0, byov: 0, confirmedSpare: 0, needsReconfirmation: 0 };
        }
        data[techState].byov++;
      }
    }
    
    return data;
  }, [vehicles, byovVehicleNumbers, byovTechnicians]);

  const statesWithData = Object.keys(stateData);
  
  if (statesWithData.length === 0) {
    return null;
  }

  const totals: Record<CategoryKey, number> = {
    onRoad: 0, repairShop: 0, pmf: 0, byov: 0, confirmedSpare: 0, needsReconfirmation: 0
  };
  for (const s of Object.values(stateData)) {
    for (const key of Object.keys(totals) as CategoryKey[]) {
      totals[key] += s[key];
    }
  }

  const allKeys: CategoryKey[] = categories.map(c => c.key);
  const maxCount = Math.max(
    ...Object.values(stateData).flatMap(s => allKeys.map(k => s[k]))
  );
  
  const getRadius = (count: number) => {
    if (count === 0) return 0;
    return Math.max(5, Math.min(14, 5 + (count / maxCount) * 9));
  };

  const visibleCats = categories.filter(c => visibleCategories.has(c.key));

  return (
    <Card className="mb-4" data-testid="card-us-map-vehicles">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Vehicle Distribution by State
          </CardTitle>
          {(activeSelections.length > 0 || visibleCategories.size < categories.length) && onMapFiltersChange && (
            <div className="flex items-center gap-1 flex-wrap">
              {activeSelections.map((sel, idx) => (
                <Badge 
                  key={`${sel.state}-${sel.category || 'all'}`}
                  variant="secondary" 
                  className="gap-1 cursor-pointer text-xs"
                  onClick={() => {
                    const newSelections = activeSelections.filter((_, i) => i !== idx);
                    onMapFiltersChange({ selections: newSelections, visibleCategories });
                  }}
                  data-testid={`chip-map-selection-${idx}`}
                >
                  {sel.label}
                  <X className="w-3 h-3" />
                </Badge>
              ))}
              {(activeSelections.length > 0 || visibleCategories.size < categories.length) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground"
                  onClick={() => onMapFiltersChange({ selections: [], visibleCategories: new Set(categories.map(c => c.key)) })}
                  data-testid="button-clear-all-map-filters"
                >
                  Clear All
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {categories.map(cat => (
            <div
              key={cat.key}
              role="button"
              tabIndex={0}
              onClick={() => toggleCategory(cat.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCategory(cat.key); } }}
              className={`flex items-center gap-2 px-2.5 py-1 rounded-full border cursor-pointer select-none transition-opacity ${
                visibleCategories.has(cat.key)
                  ? `${cat.bgClass} ${cat.borderClass} opacity-100`
                  : 'bg-muted/30 border-muted opacity-50'
              }`}
              data-testid={`filter-map-${cat.key}`}
            >
              <Checkbox
                checked={visibleCategories.has(cat.key)}
                onCheckedChange={() => toggleCategory(cat.key)}
                className="h-3.5 w-3.5 pointer-events-none"
                data-testid={`checkbox-map-${cat.key}`}
              />
              <div className={`w-5 h-5 rounded-full ${visibleCategories.has(cat.key) ? cat.dotClass : 'bg-muted-foreground/30'} flex items-center justify-center text-white font-bold text-[7px] shadow-sm`}>
                {totals[cat.key].toLocaleString()}
              </div>
              <span className={`font-medium text-xs ${visibleCategories.has(cat.key) ? cat.textClass : 'text-muted-foreground'}`}>
                {cat.label}
              </span>
            </div>
          ))}
          <span className="text-xs text-muted-foreground">({statesWithData.length} states)</span>
        </div>
        {onMapFiltersChange && (
          <p className="text-xs text-muted-foreground mt-1">
            Click bubbles or states to filter the table below (multi-select supported)
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="w-full overflow-hidden relative" style={{ height: '650px' }}>
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1" data-testid="map-zoom-controls">
            <Button
              size="icon"
              variant="outline"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="bg-background/90 backdrop-blur-sm"
              data-testid="button-map-zoom-in"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="bg-background/90 backdrop-blur-sm"
              data-testid="button-map-zoom-out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={handleReset}
              disabled={zoom === DEFAULT_ZOOM && center[0] === DEFAULT_CENTER[0] && center[1] === DEFAULT_CENTER[1]}
              className="bg-background/90 backdrop-blur-sm"
              data-testid="button-map-reset"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
          {zoom > 1 && (
            <div className="absolute bottom-3 left-3 z-10 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-2 py-1 rounded" data-testid="text-map-zoom-level">
              {Math.round(zoom * 100)}%
            </div>
          )}
          {rentalsByState && Object.keys(rentalsByState).length > 0 && (
            <RentalsByStatePanel rentalsByState={rentalsByState} />
          )}
          <ComposableMap
            projection="geoAlbersUsa"
            projectionConfig={{ scale: 1300 }}
            style={{ width: '100%', height: '100%' }}
            data-testid="map-us-vehicles"
          >
            <ZoomableGroup
              center={center}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onMoveEnd={handleMoveEnd}
              translateExtent={[[-200, -100], [1200, 700]]}
            >
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const stateName = geo.properties?.name;
                    const abbr = stateName ? stateNameToAbbr[stateName] : undefined;
                    const isSelected = activeSelections.some(s => s.state === abbr && !s.category);
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={isSelected ? '#93c5fd' : '#e5e7eb'}
                        stroke={isSelected ? '#3b82f6' : '#9ca3af'}
                        strokeWidth={isSelected ? 1 : 0.5}
                        className={isSelected ? '' : 'dark:fill-zinc-700 dark:stroke-zinc-500'}
                        style={{
                          default: { outline: 'none', cursor: onMapFiltersChange ? 'pointer' : 'default' },
                          hover: { outline: 'none', fill: isSelected ? '#93c5fd' : '#d1d5db', cursor: onMapFiltersChange ? 'pointer' : 'default' },
                          pressed: { outline: 'none' },
                        }}
                        onClick={() => {
                          if (stateName) handleStateClick(stateName);
                        }}
                        data-testid={abbr ? `geo-state-${abbr}` : undefined}
                      />
                    );
                  })
                }
              </Geographies>
              
              {statesWithData.map((state) => {
                const offshoreData = offshoreStates[state];
                if (!offshoreData) return null;
                
                return (
                  <Marker key={`line-${state}`} coordinates={offshoreData.anchor}>
                    <line
                      x1={0}
                      y1={0}
                      x2={(offshoreData.offshore[0] - offshoreData.anchor[0]) * 15}
                      y2={(offshoreData.offshore[1] - offshoreData.anchor[1]) * -15}
                      stroke="#6b7280"
                      strokeWidth={1}
                      strokeDasharray="3,2"
                      opacity={0.6}
                    />
                  </Marker>
                );
              })}
              
              {statesWithData.map((state) => {
                const isOffshore = offshoreStates[state] !== undefined;
                const coords = isOffshore ? offshoreStates[state].offshore : stateCoordinates[state];
                const data = stateData[state];
                if (!coords) return null;
                
                const activeCategories = visibleCats.filter(c => data[c.key] > 0);
                const circleCount = activeCategories.length;
                
                if (circleCount === 0) return null;
                
                const spacing = isOffshore ? 0.7 : 0.85;
                
                const offsets: number[] = [];
                if (circleCount === 1) {
                  offsets.push(0);
                } else if (circleCount === 2) {
                  offsets.push(-spacing / 2, spacing / 2);
                } else if (circleCount === 3) {
                  offsets.push(-spacing, 0, spacing);
                } else if (circleCount === 4) {
                  offsets.push(-spacing * 1.5, -spacing * 0.5, spacing * 0.5, spacing * 1.5);
                } else if (circleCount === 5) {
                  offsets.push(-spacing * 2, -spacing, 0, spacing, spacing * 2);
                } else if (circleCount >= 6) {
                  const half = (circleCount - 1) / 2;
                  for (let i = 0; i < circleCount; i++) {
                    offsets.push((i - half) * spacing);
                  }
                }
                
                const leftmostOffset = offsets[0] || 0;
                const leftmostRadius = activeCategories.length > 0 ? getRadius(data[activeCategories[0].key]) : 5;
                const labelXOffset = leftmostOffset - (leftmostRadius / 12) - 0.5;
                
                return (
                  <g key={state}>
                    {isOffshore && (
                      <Marker coordinates={[coords[0] + labelXOffset, coords[1]]}>
                        <text
                          textAnchor="end"
                          y={3}
                          style={{
                            fontFamily: 'system-ui, sans-serif',
                            fontSize: '9px',
                            fontWeight: '600',
                            fill: '#374151',
                          }}
                        >
                          {state}
                        </text>
                      </Marker>
                    )}
                    
                    {activeCategories.map((cat, idx) => {
                      const count = data[cat.key];
                      const radius = getRadius(count);
                      const offset = offsets[idx] || 0;
                      const isActive = isSelectionActive(state, cat.key);
                      
                      return (
                        <Marker key={cat.key} coordinates={[coords[0] + offset, coords[1]]}>
                          <circle
                            r={radius}
                            fill={cat.color}
                            stroke={isActive ? '#ffffff' : cat.stroke}
                            strokeWidth={isActive ? 2 : 0.8}
                            style={{ cursor: onMapFiltersChange ? 'pointer' : 'default' }}
                            onClick={(e) => handleBubbleClick(state, cat.key, e)}
                            data-testid={`marker-${cat.key}-${state}`}
                          />
                          {isActive && (
                            <circle
                              r={radius + 2}
                              fill="none"
                              stroke={cat.stroke}
                              strokeWidth={1.5}
                              style={{ pointerEvents: 'none' }}
                            />
                          )}
                          <text
                            textAnchor="middle"
                            y={3}
                            style={{
                              fontFamily: 'system-ui, sans-serif',
                              fontSize: count > 999 ? '5px' : count > 99 ? '6px' : '7px',
                              fontWeight: 'bold',
                              fill: '#ffffff',
                              pointerEvents: 'none',
                            }}
                          >
                            {count}
                          </text>
                          <title>{`${state}: ${count} ${cat.label} — Click to filter table`}</title>
                        </Marker>
                      );
                    })}
                  </g>
                );
              })}
            </ZoomableGroup>
          </ComposableMap>
        </div>
      </CardContent>
    </Card>
  );
}
