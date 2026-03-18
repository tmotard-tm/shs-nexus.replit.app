import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toCanonical, toDisplayNumber } from '@shared/vehicle-number-utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, MapPin, Car, X, ChevronDown, Filter, ArrowUpDown, ArrowUp, ArrowDown, Map } from 'lucide-react';
import type { MapSelection, MapFilters, CategoryKey } from '@/components/USMapVehicles';

interface Vehicle {
  vehicleNumber: string;
  assignmentStatus: string;
  generalStatus: string;
  subStatus: string;
  lastKnownLocation: string;
  locationSource: string;
  locationUpdatedAt: string | null;
  locationState: string;
  samsaraStatus?: string;
  lastSamsaraSignal?: string | null;
  secondaryLocation?: string;
  secondaryLocationSource?: string;
  secondaryLocationUpdatedAt?: string | null;
  district: string;
  vin: string;
  makeName: string;
  modelName: string;
  interior: string;
  inventoryProductCategory: string;
  technicianName?: string;
  technicianNo?: string;
  technicianPhone?: string;
  odometer?: number | null;
  odometerDate?: string | null;
  lifetimeMaintenance?: string;
  lifetimeMaintenanceNumeric?: number | null;
}

type SortDirection = 'asc' | 'desc' | null;
type SortColumn = 'odometer' | 'lifetimeMaintenance' | null;

interface CategoryFilter {
  generalStatus?: string;
  subStatus?: string;
  excludePmf?: boolean;
  isRental?: boolean;
  label: string;
}

const isPmfSubStatus = (subStatus: string): boolean => {
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

interface FleetVehicleTableProps {
  vehicles: Vehicle[];
  isLoading?: boolean;
  categoryFilter?: CategoryFilter | null;
  onClearCategoryFilter?: () => void;
  mapSelections?: MapSelection[];
  visibleMapCategories?: Set<CategoryKey>;
  onMapFiltersChange?: (filters: MapFilters) => void;
  rentalTruckNumbers?: Set<string>;
}

interface ColumnFilterPopoverProps {
  title: string;
  options: string[];
  selectedValues: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  testIdPrefix: string;
}

function ColumnFilterPopover({ title, options, selectedValues, onToggle, onClear, testIdPrefix }: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const hasActiveFilters = selectedValues.size > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-auto p-1 font-medium text-left justify-start gap-1 ${hasActiveFilters ? 'text-primary' : ''}`}
          data-testid={`button-filter-${testIdPrefix}`}
        >
          {title}
          {hasActiveFilters && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {selectedValues.size}
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-sm font-medium">{title}</span>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onClear}
              data-testid={`button-clear-${testIdPrefix}`}
            >
              Clear
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-2 space-y-1">
            {options.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                data-testid={`checkbox-${testIdPrefix}-${option.replace(/\s+/g, '-').toLowerCase()}`}
              >
                <Checkbox
                  checked={selectedValues.has(option)}
                  onCheckedChange={() => onToggle(option)}
                />
                <span className="flex-1 truncate">{option}</span>
                {option === 'Vehicles in storage' && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 whitespace-nowrap">
                    Sum of spares
                  </span>
                )}
              </label>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

interface VehicleSearchPopoverProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

function VehicleSearchPopover({ value, onChange, onClear }: VehicleSearchPopoverProps) {
  const [open, setOpen] = useState(false);
  const hasValue = value.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-auto p-1 font-medium text-left justify-start gap-1 ${hasValue ? 'text-primary' : ''}`}
          data-testid="button-filter-vehicle-number"
        >
          Vehicle #
          {hasValue && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              1
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-sm font-medium">Vehicle #</span>
          {hasValue && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              data-testid="button-clear-vehicle-search"
            >
              Clear
            </Button>
          )}
        </div>
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-vehicle-number-search"
              placeholder="Search vehicle #..."
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="pl-8 h-8"
              autoFocus
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FleetVehicleTable({ vehicles, isLoading, categoryFilter, onClearCategoryFilter, mapSelections = [], visibleMapCategories, onMapFiltersChange, rentalTruckNumbers = new Set() }: FleetVehicleTableProps) {
  const [search, setSearch] = useState('');
  const [vehicleNumberSearch, setVehicleNumberSearch] = useState('');
  const [assignmentFilters, setAssignmentFilters] = useState<Set<string>>(new Set());
  const [generalStatusFilters, setGeneralStatusFilters] = useState<Set<string>>(new Set());
  const [subStatusFilters, setSubStatusFilters] = useState<Set<string>>(new Set());
  const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
  const [samsaraStatusFilters, setSamsaraStatusFilters] = useState<Set<string>>(new Set());
  const [rentalFilter, setRentalFilter] = useState<string>('');

  // Rental Ops open vehicle set — cross-references Rental Operations page open rentals (Snowflake)
  const { data: rentalOpsData } = useQuery<{ vehicleNumbers: string[] }>({
    queryKey: ['/api/rental-ops/open-vehicle-numbers'],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const rentalOpsVehicleSet = useMemo(() => {
    const s = new Set<string>();
    if (!rentalOpsData?.vehicleNumbers) return s;
    for (const vn of rentalOpsData.vehicleNumbers) {
      s.add(vn);
      const canonical = toCanonical(vn);
      if (canonical) s.add(canonical);
      const display = toDisplayNumber(vn);
      if (display) s.add(display);
    }
    return s;
  }, [rentalOpsData]);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  
  // Toggle sort for a column
  const toggleSort = (column: SortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection('desc'); // Default to descending (highest first)
    } else if (sortDirection === 'desc') {
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortColumn(null);
      setSortDirection(null);
    }
  };
  
  // Get sort icon for a column
  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="w-3 h-3 ml-1" />;
    }
    return <ArrowDown className="w-3 h-3 ml-1" />;
  };
  
  // Refs for synchronized scrollbars
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  
  // Sync top and bottom scrollbars
  useEffect(() => {
    const tableContainer = tableContainerRef.current;
    const topScroll = topScrollRef.current;
    
    if (!tableContainer || !topScroll) return;
    
    let isSyncingFromTop = false;
    let isSyncingFromBottom = false;
    
    const handleTableScroll = () => {
      if (isSyncingFromTop) return;
      isSyncingFromBottom = true;
      topScroll.scrollLeft = tableContainer.scrollLeft;
      requestAnimationFrame(() => { isSyncingFromBottom = false; });
    };
    
    const handleTopScroll = () => {
      if (isSyncingFromBottom) return;
      isSyncingFromTop = true;
      tableContainer.scrollLeft = topScroll.scrollLeft;
      requestAnimationFrame(() => { isSyncingFromTop = false; });
    };
    
    tableContainer.addEventListener('scroll', handleTableScroll, { passive: true });
    topScroll.addEventListener('scroll', handleTopScroll, { passive: true });
    
    return () => {
      tableContainer.removeEventListener('scroll', handleTableScroll);
      topScroll.removeEventListener('scroll', handleTopScroll);
    };
  }, []);

  const uniqueAssignments = useMemo(() => {
    const values = new Set(vehicles.map(v => v.assignmentStatus).filter(Boolean));
    return Array.from(values).sort();
  }, [vehicles]);

  const uniqueGeneralStatuses = useMemo(() => {
    const statuses = new Set(vehicles.map(v => v.generalStatus).filter(Boolean));
    if (rentalTruckNumbers.size > 0) {
      statuses.add('Rental');
    }
    return Array.from(statuses).sort();
  }, [vehicles, rentalTruckNumbers]);

  const uniqueSubStatuses = useMemo(() => {
    const statuses = new Set(vehicles.map(v => v.subStatus).filter(Boolean));
    return Array.from(statuses).sort();
  }, [vehicles]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set(vehicles.map(v => v.inventoryProductCategory).filter(Boolean));
    return Array.from(categories).sort();
  }, [vehicles]);

  const uniqueSamsaraStatuses = useMemo(() => {
    const statuses = new Set(vehicles.map(v => v.samsaraStatus || 'Not Installed').filter(Boolean));
    return Array.from(statuses).sort();
  }, [vehicles]);

  const toggleFilter = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const newSet = new Set(set);
    if (newSet.has(value)) {
      newSet.delete(value);
    } else {
      newSet.add(value);
    }
    setter(newSet);
  };


  const clearAllFilters = () => {
    setAssignmentFilters(new Set());
    setGeneralStatusFilters(new Set());
    setSubStatusFilters(new Set());
    setCategoryFilters(new Set());
    setSamsaraStatusFilters(new Set());
    setRentalFilter('');
    setSearch('');
    setVehicleNumberSearch('');
  };

  const hasActiveFilters = assignmentFilters.size > 0 || generalStatusFilters.size > 0 || 
                           subStatusFilters.size > 0 || categoryFilters.size > 0 || 
                           samsaraStatusFilters.size > 0 || rentalFilter || search || vehicleNumberSearch;

  // Helper to parse maintenance value from string like "$36,871.91" to number
  const parseMaintenanceValue = (value: string | undefined): number | null => {
    if (!value) return null;
    const cleaned = value.replace(/[$,]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  };

  const getVehicleMapCategory = useCallback((v: Vehicle): CategoryKey | null => {
    const gs = v.generalStatus;
    const ss = v.subStatus || '';
    if (gs === 'On Road') return 'onRoad';
    if (gs === 'Vehicles in a repair shop') return 'repairShop';
    if (gs === 'Vehicles in storage') {
      if (isPmfSubStatus(ss)) return 'pmf';
      const src = (v.locationSource || '').toLowerCase();
      if (src === 'confirmed' || src === 'both') return 'confirmedSpare';
      return 'needsReconfirmation';
    }
    if (gs === 'PMF') return 'pmf';
    return 'onRoad';
  }, [rentalTruckNumbers]);

  const allCategoriesVisible = !visibleMapCategories || visibleMapCategories.size === 6;
  const hasMapFilters = mapSelections.length > 0 || !allCategoriesVisible;

  const preFilteredVehicles = useMemo(() => {
    let result = vehicles;
    if (categoryFilter) {
      result = result.filter(v => {
        if (categoryFilter.isRental) return rentalTruckNumbers.has(v.vehicleNumber?.toString().padStart(6, '0'));
        if (categoryFilter.generalStatus && v.generalStatus !== categoryFilter.generalStatus) return false;
        if (categoryFilter.subStatus && v.subStatus !== categoryFilter.subStatus) return false;
        if (categoryFilter.excludePmf && isPmfSubStatus(v.subStatus || '')) return false;
        return true;
      });
    }
    if (visibleMapCategories && visibleMapCategories.size < 6) {
      result = result.filter(v => {
        const cat = getVehicleMapCategory(v);
        return cat ? visibleMapCategories.has(cat) : false;
      });
    }
    if (mapSelections.length > 0) {
      result = result.filter(v => {
        const vState = v.locationState?.toUpperCase().trim();
        return mapSelections.some(sel => {
          if (vState !== sel.state) return false;
          if (sel.category) {
            return getVehicleMapCategory(v) === sel.category;
          }
          return true;
        });
      });
    }
    return result;
  }, [vehicles, categoryFilter, mapSelections, visibleMapCategories, getVehicleMapCategory, rentalTruckNumbers]);

  const filteredVehicles = useMemo(() => {
    let result = preFilteredVehicles.filter(vehicle => {
      const searchLower = search.toLowerCase();
      const matchesSearch = !search || 
        vehicle.vehicleNumber.toLowerCase().includes(searchLower) ||
        vehicle.vin.toLowerCase().includes(searchLower) ||
        vehicle.district.toLowerCase().includes(searchLower) ||
        vehicle.makeName.toLowerCase().includes(searchLower) ||
        vehicle.modelName.toLowerCase().includes(searchLower) ||
        vehicle.lastKnownLocation.toLowerCase().includes(searchLower) ||
        (vehicle.technicianName || '').toLowerCase().includes(searchLower) ||
        (vehicle.technicianNo || '').toLowerCase().includes(searchLower);
      
      const matchesVehicleNumber = !vehicleNumberSearch || 
        vehicle.vehicleNumber.toLowerCase().includes(vehicleNumberSearch.toLowerCase());
      
      const matchesAssignment = assignmentFilters.size === 0 || assignmentFilters.has(vehicle.assignmentStatus);
      const matchesGeneralStatus = generalStatusFilters.size === 0 || 
        generalStatusFilters.has(vehicle.generalStatus) || 
        (generalStatusFilters.has('Rental') && rentalTruckNumbers.has(vehicle.vehicleNumber?.toString().padStart(6, '0')));
      const matchesSubStatus = subStatusFilters.size === 0 || subStatusFilters.has(vehicle.subStatus);
      const matchesCategory = categoryFilters.size === 0 || categoryFilters.has(vehicle.inventoryProductCategory);
      const matchesSamsaraStatus = samsaraStatusFilters.size === 0 || samsaraStatusFilters.has(vehicle.samsaraStatus || 'Not Installed');
      const isRental = rentalTruckNumbers.has(vehicle.vehicleNumber?.toString().padStart(6, '0'));
      const matchesRental = !rentalFilter || (rentalFilter === 'Yes' ? isRental : !isRental);
      
      return matchesSearch && matchesVehicleNumber && matchesAssignment && matchesGeneralStatus && matchesSubStatus && matchesCategory && matchesSamsaraStatus && matchesRental;
    });
    
    // Apply sorting if a sort column is selected
    if (sortColumn && sortDirection) {
      result = [...result].sort((a, b) => {
        let aVal: number | null = null;
        let bVal: number | null = null;
        
        if (sortColumn === 'odometer') {
          aVal = a.odometer ?? null;
          bVal = b.odometer ?? null;
        } else if (sortColumn === 'lifetimeMaintenance') {
          // Use numeric value if available, otherwise parse from string
          aVal = a.lifetimeMaintenanceNumeric ?? parseMaintenanceValue(a.lifetimeMaintenance);
          bVal = b.lifetimeMaintenanceNumeric ?? parseMaintenanceValue(b.lifetimeMaintenance);
        }
        
        // Handle null values - push them to the end regardless of sort direction
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        
        // Apply sort direction
        const diff = aVal - bVal;
        return sortDirection === 'asc' ? diff : -diff;
      });
    }
    
    return result;
  }, [preFilteredVehicles, search, vehicleNumberSearch, assignmentFilters, generalStatusFilters, subStatusFilters, categoryFilters, samsaraStatusFilters, rentalFilter, rentalTruckNumbers, sortColumn, sortDirection]);

  const getAssignmentBadgeColor = (status: string) => {
    if (status === 'Assigned') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
  };

  const getGeneralStatusBadgeColor = (status: string) => {
    if (status === 'Vehicles in storage') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    if (status === 'Vehicles in a repair shop') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const getLocationSourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      'GPS': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
      'AMS': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
      'TPMS': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
      'Confirmed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
      'PMF': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
    };
    return colors[source] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const getSamsaraStatusBadgeColor = (status: string) => {
    const colors: Record<string, string> = {
      'Active': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      'Inactive': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      'Inactive/Unplugged': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      'Not Installed': 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
    };
    return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  };

  const formatSamsaraSignalDate = (timestamp: string | null | undefined) => {
    if (!timestamp) return '-';
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + 
             ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '-';
    }
  };

  if (isLoading) {
    return (
      <Card data-testid="card-fleet-table-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="w-5 h-5" />
            Fleet Vehicle Table
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-fleet-table">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="w-5 h-5" />
            Fleet Vehicle Table
            <Badge variant="secondary" className="ml-2">{filteredVehicles.length.toLocaleString()} vehicles</Badge>
          </CardTitle>
          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllFilters}
              data-testid="button-clear-filters"
              className="text-muted-foreground"
            >
              <X className="w-4 h-4 mr-1" />
              Clear all filters
            </Button>
          )}
        </div>
        
        <div className="flex items-center gap-3 mt-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-search-vehicles"
              placeholder="Search by vehicle #, VIN, district, technician..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Filter className="w-3 h-3" />
              <span>Click column headers to filter</span>
            </div>
          )}
        </div>
        {(categoryFilter || hasMapFilters) && (
          <div className="flex items-center gap-2 mt-2 flex-wrap" data-testid="active-filter-chips">
            <span className="text-xs text-muted-foreground">Showing:</span>
            {categoryFilter && onClearCategoryFilter && (
              <Badge 
                variant="secondary" 
                className="gap-1 cursor-pointer"
                onClick={onClearCategoryFilter}
                data-testid="button-clear-category-filter"
              >
                {categoryFilter.label}
                <X className="w-3 h-3" />
              </Badge>
            )}
            {!allCategoriesVisible && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Map className="w-3 h-3" />
                {visibleMapCategories?.size || 0} of 6 categories
              </Badge>
            )}
            {mapSelections.map((sel, idx) => (
              <Badge 
                key={`${sel.state}-${sel.category || 'all'}`}
                variant="secondary" 
                className="gap-1 cursor-pointer"
                onClick={() => {
                  if (onMapFiltersChange) {
                    const newSelections = mapSelections.filter((_, i) => i !== idx);
                    const cats = visibleMapCategories || new Set(['onRoad', 'repairShop', 'pmf', 'byov', 'confirmedSpare', 'needsReconfirmation'] as CategoryKey[]);
                    onMapFiltersChange({ selections: newSelections, visibleCategories: cats });
                  }
                }}
                data-testid={`chip-table-map-selection-${idx}`}
              >
                <Map className="w-3 h-3" />
                {sel.label}
                <X className="w-3 h-3" />
              </Badge>
            ))}
            {hasMapFilters && onMapFiltersChange && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => onMapFiltersChange({ 
                  selections: [], 
                  visibleCategories: new Set(['onRoad', 'repairShop', 'pmf', 'byov', 'confirmedSpare', 'needsReconfirmation'] as CategoryKey[])
                })}
                data-testid="button-clear-all-map-filters-table"
              >
                Clear Map Filters
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {/* Top scrollbar - synchronized with table */}
        <div 
          ref={topScrollRef}
          data-testid="top-scrollbar"
          className="overflow-x-scroll mx-4 mt-2"
          style={{ 
            WebkitOverflowScrolling: 'touch',
            overflowY: 'hidden',
            scrollbarWidth: 'auto',
          }}
        >
          <div style={{ width: '2000px', height: '1px' }} />
        </div>
        
        {/* Table wrapper with native horizontal scrollbar */}
        <div 
          ref={tableContainerRef}
          data-testid="table-scrollbar"
          className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] border rounded-lg mx-4 mb-4"
          style={{ 
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <Table className="min-w-[2000px]">
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="border-b-2 border-border">
                <TableHead className="whitespace-nowrap bg-muted">
                  <ColumnFilterPopover
                    title="Assignment"
                    options={uniqueAssignments}
                    selectedValues={assignmentFilters}
                    onToggle={(v) => toggleFilter(assignmentFilters, v, setAssignmentFilters)}
                    onClear={() => setAssignmentFilters(new Set())}
                    testIdPrefix="assignment"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Rental</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <ColumnFilterPopover
                    title="General Status"
                    options={uniqueGeneralStatuses}
                    selectedValues={generalStatusFilters}
                    onToggle={(v) => toggleFilter(generalStatusFilters, v, setGeneralStatusFilters)}
                    onClear={() => setGeneralStatusFilters(new Set())}
                    testIdPrefix="general-status"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <ColumnFilterPopover
                    title="Sub Status"
                    options={uniqueSubStatuses}
                    selectedValues={subStatusFilters}
                    onToggle={(v) => toggleFilter(subStatusFilters, v, setSubStatusFilters)}
                    onClear={() => setSubStatusFilters(new Set())}
                    testIdPrefix="sub-status"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap min-w-[250px] bg-muted">Last Known Location</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Last Samsara Signal</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <ColumnFilterPopover
                    title="Samsara Status"
                    options={uniqueSamsaraStatuses}
                    selectedValues={samsaraStatusFilters}
                    onToggle={(v) => toggleFilter(samsaraStatusFilters, v, setSamsaraStatusFilters)}
                    onClear={() => setSamsaraStatusFilters(new Set())}
                    testIdPrefix="samsara-status"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <VehicleSearchPopover
                    value={vehicleNumberSearch}
                    onChange={setVehicleNumberSearch}
                    onClear={() => setVehicleNumberSearch('')}
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <ColumnFilterPopover
                    title="Category"
                    options={uniqueCategories}
                    selectedValues={categoryFilters}
                    onToggle={(v) => toggleFilter(categoryFilters, v, setCategoryFilters)}
                    onClear={() => setCategoryFilters(new Set())}
                    testIdPrefix="category"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-auto p-1 font-medium text-left justify-start gap-1 ${rentalFilter ? 'text-primary' : ''}`}
                        data-testid="button-filter-rental"
                      >
                        Rental
                        <Filter className={`w-3 h-3 ${rentalFilter ? 'opacity-100' : 'opacity-50'}`} />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-36 p-2" align="start">
                      <div className="space-y-1">
                        <Button
                          variant={rentalFilter === '' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="w-full justify-start text-xs"
                          onClick={() => setRentalFilter('')}
                          data-testid="filter-rental-all"
                        >
                          All
                        </Button>
                        <Button
                          variant={rentalFilter === 'Yes' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="w-full justify-start text-xs"
                          onClick={() => setRentalFilter('Yes')}
                          data-testid="filter-rental-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          variant={rentalFilter === 'No' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="w-full justify-start text-xs"
                          onClick={() => setRentalFilter('No')}
                          data-testid="filter-rental-no"
                        >
                          No
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">District</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">VIN</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Make</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Model</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Interior</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Tech Name</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">Tech Phone</TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-auto p-1 font-medium text-left justify-start gap-0 ${sortColumn === 'odometer' ? 'text-primary' : ''}`}
                    onClick={() => toggleSort('odometer')}
                    data-testid="button-sort-odometer"
                  >
                    Odometer
                    {getSortIcon('odometer')}
                  </Button>
                </TableHead>
                <TableHead className="whitespace-nowrap bg-muted">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-auto p-1 font-medium text-left justify-start gap-0 ${sortColumn === 'lifetimeMaintenance' ? 'text-primary' : ''}`}
                    onClick={() => toggleSort('lifetimeMaintenance')}
                    data-testid="button-sort-lifetime-maintenance"
                  >
                    Lifetime Maintenance
                    {getSortIcon('lifetimeMaintenance')}
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={19} className="text-center py-8 text-muted-foreground">
                    No vehicles found matching your filters
                  </TableCell>
                </TableRow>
              ) : (
                filteredVehicles.slice(0, 500).map((vehicle, index) => {
                  const rowKey = `${vehicle.vehicleNumber}-${index}`;
                  
                  return (
                      <TableRow 
                        key={rowKey}
                        data-testid={`row-vehicle-${vehicle.vehicleNumber}`}
                        className={`transition-colors hover:bg-primary/5 ${index % 2 === 0 ? 'bg-background' : 'bg-muted/30'}`}
                      >
                        <TableCell>
                          <Badge className={getAssignmentBadgeColor(vehicle.assignmentStatus)}>
                            {vehicle.assignmentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {(rentalOpsVehicleSet.has(vehicle.vehicleNumber)
                            || rentalOpsVehicleSet.has(toCanonical(vehicle.vehicleNumber))
                            || rentalOpsVehicleSet.has(toDisplayNumber(vehicle.vehicleNumber))) && (
                            <Badge className="bg-orange-500 text-white text-xs border-none">Rental</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {vehicle.generalStatus && (
                            <Badge className={getGeneralStatusBadgeColor(vehicle.generalStatus)}>
                              {vehicle.generalStatus}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{vehicle.subStatus || '-'}</span>
                        </TableCell>
                        <TableCell>
                          {vehicle.lastKnownLocation ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-start gap-1">
                                <MapPin className="w-3 h-3 mt-1 text-muted-foreground shrink-0" />
                                <div>
                                  <span className="text-sm">{vehicle.lastKnownLocation}</span>
                                  {vehicle.locationSource && (
                                    <Badge className={`ml-2 text-[10px] px-1.5 py-0 ${getLocationSourceBadge(vehicle.locationSource)}`}>
                                      {vehicle.locationSource}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {vehicle.secondaryLocation && (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button 
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pl-4"
                                      data-testid={`button-secondary-location-${vehicle.vehicleNumber}`}
                                    >
                                      <ChevronDown className="w-3 h-3" />
                                      <span>2nd source</span>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-3" align="start">
                                    <div className="flex items-start gap-1">
                                      <MapPin className="w-3 h-3 mt-1 text-muted-foreground shrink-0" />
                                      <div>
                                        <span className="text-sm">{vehicle.secondaryLocation}</span>
                                        {vehicle.secondaryLocationSource && (
                                          <Badge className={`ml-2 text-[10px] px-1.5 py-0 ${getLocationSourceBadge(vehicle.secondaryLocationSource)}`}>
                                            {vehicle.secondaryLocationSource}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatSamsaraSignalDate(vehicle.lastSamsaraSignal)}
                        </TableCell>
                        <TableCell>
                          <Badge className={getSamsaraStatusBadgeColor(vehicle.samsaraStatus || 'Not Installed')}>
                            {vehicle.samsaraStatus || 'Not Installed'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{vehicle.vehicleNumber}</TableCell>
                        <TableCell>{vehicle.inventoryProductCategory || '-'}</TableCell>
                        <TableCell data-testid={`text-rental-${vehicle.vehicleNumber}`}>
                          {rentalTruckNumbers.has(vehicle.vehicleNumber?.toString().padStart(6, '0')) ? (
                            <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400">Yes</Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell>{vehicle.district || '-'}</TableCell>
                        <TableCell className="font-mono text-xs">{vehicle.vin || '-'}</TableCell>
                        <TableCell>{vehicle.makeName || '-'}</TableCell>
                        <TableCell>{vehicle.modelName || '-'}</TableCell>
                        <TableCell>{vehicle.interior || '-'}</TableCell>
                        <TableCell>
                          <span data-testid={`text-tech-name-${vehicle.vehicleNumber}`}>
                            {vehicle.technicianName || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span data-testid={`text-tech-phone-${vehicle.vehicleNumber}`}>
                            {vehicle.technicianPhone ? formatPhoneNumber(vehicle.technicianPhone) : '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col" data-testid={`text-odometer-${vehicle.vehicleNumber}`}>
                            {vehicle.odometer ? (
                              <>
                                <span className="text-sm font-medium">{vehicle.odometer.toLocaleString()}</span>
                                {vehicle.odometerDate && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(vehicle.odometerDate).toLocaleDateString()}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span 
                            className="text-sm font-medium whitespace-nowrap"
                            data-testid={`text-lifetime-maintenance-${vehicle.vehicleNumber}`}
                          >
                            {vehicle.lifetimeMaintenance || '-'}
                          </span>
                        </TableCell>
                      </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {filteredVehicles.length > 500 && (
            <div className="p-3 text-center text-sm text-muted-foreground border-t">
              Showing first 500 of {filteredVehicles.length.toLocaleString()} vehicles. Use filters to narrow down results.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
