import { useState, useMemo, memo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useUser } from "@/context/FleetScopeUserContext";
import { 
  TruckIcon, 
  Search,
  MapPin,
  Wrench,
  Copy,
  CheckCircle,
  CheckCircle2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Save,
  X,
  Loader2,
  ChevronDown,
  AlertCircle,
  Filter,
  Key,
  RefreshCw,
  Upload,
  Plus,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VehicleLocation {
  vehicleNumber: string;
  vin: string;
  make: string;
  model: string;
  district: string;
  truckStatus: string;
  status?: string;
  amsAddress: string;
  confirmedAddress: string;
  confirmedAddressUpdatedAt: string;
  samsaraAddress: string;
  samsaraTimestamp: string;
  hasConfirmedAddress: boolean;
  hasRecentSamsara: boolean;
  locationSource: 'confirmed' | 'samsara' | 'both';
  // New status fields
  keysStatus: 'Yes' | 'No' | 'Unconfirmed' | null;
  repairedStatus: 'Complete' | 'In Process' | 'Unknown if needed' | 'Declined' | null;
  registrationRenewalDate: string | null;
  contactNamePhone: string | null;
  generalComments: string | null;
  fleetTeamComments: string | null; // Can be predefined option or custom text (up to 150 chars)
  manualEditTimestamp: string | null;
  // Declined status from cross-referencing
  isDeclined?: boolean;
  declinedSources?: string[]; // Array of sources: 'Dashboard', 'Decommissioning', 'Repairs'
}

// Dropdown options
const KEYS_OPTIONS = ['Present', 'Not Present', 'Unknown/would not check'] as const;
const KEYS_ALL_VALUES = ['Present', 'Not Present', 'Unknown/would not check', 'Yes', 'No', 'Unconfirmed'] as const;

// Map stored database values to display values (for when API returns normalized values)
const KEYS_STORED_TO_DISPLAY: Record<string, string> = {
  'Yes': 'Present',
  'No': 'Not Present', 
  'Unconfirmed': 'Unknown/would not check',
  'Present': 'Present',
  'Not Present': 'Not Present',
  'Unknown/would not check': 'Unknown/would not check',
};
const REPAIRED_OPTIONS = ['Complete', 'In Process', 'Unknown if needed', 'Declined'] as const;
const FLEET_TEAM_OPTIONS = [
  'Declined repair',
  'Sent to PMF', 
  'Available to assign or send to PMF',
  'Available to assign to Rental',
  'In repair',
  'In use',
  'Sent to auction',
  'LOA',
  'Reserved for new hire',
  'Assigned to tech',
  'Assigned to rental',
  'Not found',
  'Repaired But need registration'
] as const;

interface SparesLocationResponse {
  success: boolean;
  otherLocations: VehicleLocation[];
  repairShopLocations: VehicleLocation[];
  counts: {
    otherLocations: number;
    repairShop: number;
    total: number;
  };
  addressBreakdown: {
    confirmedOnly: number;
    samsaraOnly: number;
    both: number;
    neither: number;
    totalWithConfirmed: number;
    totalWithSamsara: number;
  };
}

type SortColumn = 'confirmedDate' | 'samsaraDate' | null;
type SortDirection = 'asc' | 'desc' | null;

// Dual scroll container - adds a synchronized scrollbar at the top
function DualScrollContainer({ children }: { children: React.ReactNode }) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateWidth = () => {
      setContentWidth(content.scrollWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(content);
    return () => observer.disconnect();
  }, [children]);

  const syncScroll = (source: 'top' | 'content') => {
    const scrollLeft = source === 'top' ? topScrollRef.current?.scrollLeft : contentRef.current?.scrollLeft;
    if (scrollLeft === undefined) return;
    
    if (topScrollRef.current && source !== 'top') topScrollRef.current.scrollLeft = scrollLeft;
    if (contentRef.current && source !== 'content') contentRef.current.scrollLeft = scrollLeft;
  };

  return (
    <div className="relative">
      {/* Top scrollbar */}
      <div
        ref={topScrollRef}
        className="overflow-x-auto overflow-y-hidden sticky top-[56px] z-10 bg-background"
        style={{ height: '12px' }}
        onScroll={() => syncScroll('top')}
      >
        <div style={{ width: contentWidth, height: '1px' }} />
      </div>
      {/* Content with bottom scrollbar */}
      <div
        ref={contentRef}
        className="overflow-x-auto"
        onScroll={() => syncScroll('content')}
      >
        {children}
      </div>
    </div>
  );
}

// Fleet Team Comments Cell with dropdown + custom input (similar to FinalApprovalCell in POs)
const FleetTeamCommentsCell = memo(function FleetTeamCommentsCell({
  vehicleNumber,
  currentValue,
  onSave,
  isPending
}: {
  vehicleNumber: string;
  currentValue: string | null;
  onSave: (value: string | null) => void;
  isPending: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customValue, setCustomValue] = useState("");
  // Local state to show value immediately (optimistic update)
  const [displayValue, setDisplayValue] = useState<string | null>(currentValue);
  
  // Sync with prop changes (when server data refreshes)
  useEffect(() => {
    setDisplayValue(currentValue);
  }, [currentValue]);

  const handleSelect = (value: string) => {
    if (value === "__custom__") {
      setShowCustomInput(true);
      setCustomValue(displayValue || "");
    } else if (value === "__clear__") {
      setDisplayValue(null); // Optimistic update
      onSave(null);
      setIsOpen(false);
    } else {
      setDisplayValue(value); // Optimistic update
      onSave(value);
      setIsOpen(false);
    }
  };

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      const trimmedValue = customValue.trim().slice(0, 150);
      setDisplayValue(trimmedValue); // Optimistic update
      onSave(trimmedValue);
    }
    setIsOpen(false);
    setShowCustomInput(false);
    setCustomValue("");
  };

  const handleCancel = () => {
    setShowCustomInput(false);
    setCustomValue("");
  };

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        setShowCustomInput(false);
        setCustomValue("");
      }
    }}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 text-left hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer min-w-[120px] w-full text-xs"
          data-testid={`button-fleet-comments-${vehicleNumber}`}
          disabled={isPending}
        >
          <span className="flex-1 truncate">
            {displayValue || <span className="text-muted-foreground italic">Select...</span>}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        {showCustomInput ? (
          <div className="space-y-2">
            <Input
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value.slice(0, 150))}
              placeholder="Enter custom comment..."
              autoFocus
              maxLength={150}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") handleCancel();
              }}
              data-testid={`input-custom-fleet-comments-${vehicleNumber}`}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{customValue.length}/150</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCancel}
                  data-testid={`button-cancel-custom-${vehicleNumber}`}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCustomSubmit}
                  disabled={!customValue.trim() || isPending}
                  data-testid={`button-save-custom-${vehicleNumber}`}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            <button
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted text-muted-foreground italic"
              onClick={() => handleSelect("__clear__")}
              data-testid={`option-clear-${vehicleNumber}`}
            >
              - Clear -
            </button>
            {FLEET_TEAM_OPTIONS.map((option) => (
              <button
                key={option}
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${displayValue === option ? 'bg-muted font-medium' : ''}`}
                onClick={() => handleSelect(option)}
                data-testid={`option-${option.replace(/\s+/g, '-').toLowerCase()}-${vehicleNumber}`}
              >
                {option}
              </button>
            ))}
            <div className="border-t pt-1 mt-1">
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted text-primary"
                onClick={() => handleSelect("__custom__")}
                data-testid={`option-custom-${vehicleNumber}`}
              >
                + Enter custom comment...
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});

// Self-contained editable text cell - manages its own edit state to avoid full table re-renders
const EditableTextCell = memo(function EditableTextCell({
  vehicleNumber,
  currentValue,
  onSave,
  isPending,
  placeholder = "Click to add...",
  maxLength,
  inputType = "text",
  className = "",
  testIdPrefix,
  showDate,
  dateValue,
}: {
  vehicleNumber: string;
  currentValue: string | null;
  onSave: (value: string | null) => void;
  isPending: boolean;
  placeholder?: string;
  maxLength?: number;
  inputType?: "text" | "date" | "textarea";
  className?: string;
  testIdPrefix: string;
  showDate?: boolean;
  dateValue?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentValue || "");
  const hasSavedRef = useRef(false); // Prevent duplicate saves from Enter + blur

  // Sync editValue when currentValue changes externally (e.g., after save/refetch)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(currentValue || "");
    }
  }, [currentValue, isEditing]);

  const handleStartEdit = () => {
    if (isPending) return; // Don't allow editing when mutation is pending
    hasSavedRef.current = false;
    setEditValue(currentValue || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!isEditing || hasSavedRef.current) return;
    hasSavedRef.current = true;
    const newValue = inputType === 'date' ? (editValue || null) : (editValue.trim() || null);
    setIsEditing(false);
    if (newValue !== currentValue) {
      onSave(newValue);
    }
  };

  const handleCancel = () => {
    hasSavedRef.current = true; // Prevent blur from saving after cancel
    setIsEditing(false);
    setEditValue(currentValue || "");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputType !== 'textarea') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    if (inputType === 'textarea') {
      return (
        <Textarea
          value={editValue}
          onChange={(e) => setEditValue(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
          className={`text-xs min-h-[60px] ${className}`}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCancel();
          }}
          onBlur={handleSave}
          autoFocus
          data-testid={`input-${testIdPrefix}-${vehicleNumber}`}
        />
      );
    }
    return (
      <Input
        type={inputType}
        value={editValue}
        onChange={(e) => setEditValue(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
        className={`h-7 text-xs ${className}`}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        autoFocus
        data-testid={`input-${testIdPrefix}-${vehicleNumber}`}
      />
    );
  }

  return (
    <div 
      className="cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 text-xs"
      onClick={handleStartEdit}
      data-testid={`cell-${testIdPrefix}-${vehicleNumber}`}
    >
      {currentValue ? (
        <span style={inputType === 'textarea' ? { whiteSpace: 'pre-wrap', maxWidth: '280px', display: 'block', wordBreak: 'break-word' } : undefined}>
          {currentValue}
          {showDate && dateValue && (
            <span className="text-muted-foreground ml-2">({dateValue})</span>
          )}
        </span>
      ) : (
        <span className="text-muted-foreground italic">{placeholder}</span>
      )}
    </div>
  );
});

// Self-contained select cell - handles its own mutations
const EditableSelectCell = memo(function EditableSelectCell({
  vehicleNumber,
  currentValue,
  options,
  onSave,
  isPending,
  testIdPrefix,
  valueMap,
}: {
  vehicleNumber: string;
  currentValue: string | null;
  options: readonly string[];
  onSave: (value: string | null) => void;
  isPending: boolean;
  testIdPrefix: string;
  valueMap?: Record<string, string>;
}) {
  const handleChange = (value: string) => {
    const newValue = value === '__clear__' ? null : value;
    onSave(newValue);
  };

  // Convert stored value to display value if valueMap is provided
  const displayValue = currentValue && valueMap ? (valueMap[currentValue] || currentValue) : currentValue;

  return (
    <Select
      value={displayValue || undefined}
      onValueChange={handleChange}
      disabled={isPending}
    >
      <SelectTrigger className="h-7 text-xs" data-testid={`select-${testIdPrefix}-${vehicleNumber}`}>
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__clear__">- Clear -</SelectItem>
        {options.map(opt => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

export default function Spares() {
  const { toast } = useToast();
  const { currentUser } = useUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedVin, setCopiedVin] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  
  // Filter states for Fleet Team Comments - can be '' (all), a predefined option, or 'custom' for non-predefined values
  const [fleetTeamCommentsFilter, setFleetTeamCommentsFilter] = useState<string>('');
  
  // Filter state for Declined status
  const [declinedFilter, setDeclinedFilter] = useState<'all' | 'declined' | 'not_declined'>('all');
  
  // State for bulk import
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [importPreview, setImportPreview] = useState<{truckNumber: string; hasData: boolean}[]>([]);
  
  // State for add truck dialog
  const [addTruckOpen, setAddTruckOpen] = useState(false);
  const [newTruckNumber, setNewTruckNumber] = useState("");
  const [newTruckVin, setNewTruckVin] = useState("");
  const [newTruckAddress, setNewTruckAddress] = useState("");
  const [isCheckingAssignment, setIsCheckingAssignment] = useState(false);
  const [assignmentWarning, setAssignmentWarning] = useState<string | null>(null);
  const [isTruckAssigned, setIsTruckAssigned] = useState(false);
  const checkAbortControllerRef = useRef<AbortController | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<SparesLocationResponse>({
    queryKey: ["/api/fs/spares/locations"],
    staleTime: 5 * 60 * 1000,
  });

  const updateConfirmedAddressMutation = useMutation({
    mutationFn: async ({ vehicleNumber, confirmedAddress }: { vehicleNumber: string; confirmedAddress: string }) => {
      const response = await apiRequest("PATCH", "/api/fs/spares/confirmed-address", { vehicleNumber, confirmedAddress });
      return response.json();
    },
    onMutate: async ({ vehicleNumber, confirmedAddress }) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/fs/spares/locations"] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["/api/fs/spares/locations"]);
      
      // Optimistically update the cache
      const normalizedVehicleNumber = vehicleNumber.padStart(6, '0');
      queryClient.setQueryData(["/api/fs/spares/locations"], (old: any) => {
        if (!old) return old;
        
        const updateVehicles = (vehicles: VehicleLocation[]) => 
          vehicles.map(v => {
            const vNormalized = v.vehicleNumber.padStart(6, '0');
            if (vNormalized === normalizedVehicleNumber) {
              return {
                ...v,
                confirmedAddress: confirmedAddress || null,
                confirmedAddressUpdatedAt: new Date().toISOString(),
              };
            }
            return v;
          });
        
        return {
          ...old,
          otherLocations: updateVehicles(old.otherLocations || []),
          repairShopLocations: updateVehicles(old.repairShopLocations || []),
        };
      });
      
      return { previousData };
    },
    onError: (error: Error, _params, context) => {
      // Revert to previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(["/api/fs/spares/locations"], context.previousData);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      // Refetch after a delay to sync with server
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/fs/spares/locations"] });
      }, 2000);
    },
  });
  
  // Mutation for updating status fields with optimistic updates
  const updateStatusMutation = useMutation({
    mutationFn: async (params: { 
      vehicleNumber: string; 
      keysStatus?: string | null;
      repairedStatus?: string | null;
      registrationRenewalDate?: string | null;
      contactNamePhone?: string | null;
      generalComments?: string | null;
      fleetTeamComments?: string | null;
    }) => {
      const response = await apiRequest("PATCH", "/api/fs/spares/status", params);
      return response.json();
    },
    onMutate: async (params) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/fs/spares/locations"] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(["/api/fs/spares/locations"]);
      
      // Optimistically update the cache
      queryClient.setQueryData(["/api/fs/spares/locations"], (old: any) => {
        if (!old) return old;
        
        const normalizedVehicleNumber = params.vehicleNumber.padStart(6, '0');
        
        const updateVehicles = (vehicles: VehicleLocation[]) => 
          vehicles.map(v => {
            const vNormalized = v.vehicleNumber.padStart(6, '0');
            if (vNormalized === normalizedVehicleNumber) {
              return {
                ...v,
                keysStatus: params.keysStatus !== undefined ? params.keysStatus : v.keysStatus,
                repairedStatus: params.repairedStatus !== undefined ? params.repairedStatus : v.repairedStatus,
                registrationRenewalDate: params.registrationRenewalDate !== undefined ? params.registrationRenewalDate : v.registrationRenewalDate,
                contactNamePhone: params.contactNamePhone !== undefined ? params.contactNamePhone : v.contactNamePhone,
                generalComments: params.generalComments !== undefined ? params.generalComments : v.generalComments,
                fleetTeamComments: params.fleetTeamComments !== undefined ? params.fleetTeamComments : v.fleetTeamComments,
              };
            }
            return v;
          });
        
        return {
          ...old,
          otherLocations: updateVehicles(old.otherLocations || []),
          repairShopLocations: updateVehicles(old.repairShopLocations || []),
        };
      });
      
      return { previousData };
    },
    onError: (error: Error, _params, context) => {
      // Revert to previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(["/api/fs/spares/locations"], context.previousData);
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      // Refetch after a delay to sync with server, but don't override optimistic updates immediately
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/fs/spares/locations"] });
      }, 2000);
    },
  });
  
  // Bulk import mutation
  const bulkImportMutation = useMutation({
    mutationFn: async (data: Array<{
      truckNumber: string;
      registrationRenewalDate?: string | null;
      keys?: string | null;
      repaired?: string | null;
      confirmedAddress?: string | null;
      contactNamePhone?: string | null;
      generalComments?: string | null;
      fleetTeamComments?: string | null;
    }>) => {
      const response = await apiRequest("POST", "/api/fs/spares/bulk-import", { data });
      return response.json();
    },
    onSuccess: (result) => {
      toast({ 
        title: "Import Complete", 
        description: `Updated ${result.results.updated} vehicles, skipped ${result.results.skipped}${result.results.errors.length > 0 ? `, ${result.results.errors.length} errors` : ''}` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/spares/locations"] });
      setBulkImportOpen(false);
      setBulkImportText("");
      setImportPreview([]);
    },
    onError: (error: Error) => {
      const message = error.message.includes('fetch') || error.message.includes('network') 
        ? "Network error - please try again. If importing many records, try smaller batches."
        : error.message;
      toast({ title: "Import Error", description: message, variant: "destructive" });
    },
  });

  // Add manual truck mutation
  const addManualTruckMutation = useMutation({
    mutationFn: async (data: { truckNumber: string; vin?: string; confirmedAddress?: string }) => {
      const response = await apiRequest("POST", "/api/fs/spares/add-manual", data);
      return response.json();
    },
    onSuccess: (result) => {
      toast({ title: "Truck Added", description: `Truck ${result.vehicleNumber} added to spares` });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/spares/locations"] });
      setAddTruckOpen(false);
      setNewTruckNumber("");
      setNewTruckVin("");
      setNewTruckAddress("");
      setAssignmentWarning(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Check if truck is assigned
  const checkTruckAssignment = async (truckNum: string) => {
    // Cancel any pending check
    if (checkAbortControllerRef.current) {
      checkAbortControllerRef.current.abort();
    }
    
    if (!truckNum.trim()) {
      setAssignmentWarning(null);
      setIsTruckAssigned(false);
      return;
    }
    
    const abortController = new AbortController();
    checkAbortControllerRef.current = abortController;
    
    setIsCheckingAssignment(true);
    try {
      const response = await fetch(`/api/spares/check-assigned/${truckNum.trim()}`, {
        signal: abortController.signal
      });
      const data = await response.json();
      if (data.isAssigned) {
        setAssignmentWarning(data.message);
        setIsTruckAssigned(true);
      } else {
        setAssignmentWarning(null);
        setIsTruckAssigned(false);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error checking assignment:", error);
      }
    } finally {
      setIsCheckingAssignment(false);
    }
  };
  
  const cancelPendingCheck = () => {
    if (checkAbortControllerRef.current) {
      checkAbortControllerRef.current.abort();
      checkAbortControllerRef.current = null;
    }
    setIsCheckingAssignment(false);
  };

  const handleAddTruck = () => {
    if (!newTruckNumber.trim()) {
      toast({ title: "Error", description: "Please enter a truck number", variant: "destructive" });
      return;
    }
    
    addManualTruckMutation.mutate({
      truckNumber: newTruckNumber.trim(),
      vin: newTruckVin.trim() || undefined,
      confirmedAddress: newTruckAddress.trim() || undefined,
    });
  };

  // Parse tab-separated data with proper handling of quoted fields containing newlines
  const parseTsvWithQuotes = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];
      
      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // Escaped quote
            currentCell += '"';
            i++;
          } else {
            // End of quoted field
            inQuotes = false;
          }
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === '\t') {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
          if (char === '\r') i++; // Skip the \n in \r\n
        } else if (char !== '\r') {
          currentCell += char;
        }
      }
    }
    
    // Don't forget the last cell and row
    if (currentCell || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
    }
    
    return rows;
  };

  // Parse pasted data (tab-separated with quoted field support)
  const parseBulkImportData = (text: string) => {
    const rows = parseTsvWithQuotes(text);
    if (rows.length < 2) return []; // Need header + at least 1 data row
    
    const header = rows[0].map(h => h.toLowerCase());
    const data: Array<{
      truckNumber: string;
      registrationRenewalDate?: string | null;
      keys?: string | null;
      repaired?: string | null;
      confirmedAddress?: string | null;
      contactNamePhone?: string | null;
      generalComments?: string | null;
      fleetTeamComments?: string | null;
    }> = [];
    
    // Find column indices
    const truckIdx = header.findIndex(h => h.includes('truck') && h.includes('number'));
    const regDateIdx = header.findIndex(h => h.includes('registration') || h.includes('renewal'));
    const keysIdx = header.findIndex(h => h.includes('keys'));
    const repairedIdx = header.findIndex(h => h.includes('repaired'));
    const addressIdx = header.findIndex(h => h.includes('address') || h.includes('confirmed'));
    const contactIdx = header.findIndex(h => h.includes('contact') || h.includes('phone') || h.includes('name'));
    const generalCommentsIdx = header.findIndex(h => h.includes('general') && h.includes('comment'));
    const fleetCommentsIdx = header.findIndex(h => h.includes('fleet') && h.includes('comment'));
    
    if (truckIdx === -1) return [];
    
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      // Extract truck number and strip non-digits
      const rawTruckNumber = cols[truckIdx] || '';
      const truckNumber = rawTruckNumber.replace(/\D/g, '');
      if (!truckNumber) continue;
      
      data.push({
        truckNumber,
        registrationRenewalDate: regDateIdx >= 0 ? cols[regDateIdx] || null : null,
        keys: keysIdx >= 0 ? cols[keysIdx] || null : null,
        repaired: repairedIdx >= 0 ? cols[repairedIdx] || null : null,
        confirmedAddress: addressIdx >= 0 ? cols[addressIdx] || null : null,
        contactNamePhone: contactIdx >= 0 ? cols[contactIdx] || null : null,
        generalComments: generalCommentsIdx >= 0 ? cols[generalCommentsIdx] || null : null,
        fleetTeamComments: fleetCommentsIdx >= 0 ? cols[fleetCommentsIdx] || null : null,
      });
    }
    
    return data;
  };
  
  const handleBulkImport = () => {
    const text = bulkImportText.trim();
    if (!text) {
      toast({ title: "Error", description: "Please paste data to import.", variant: "destructive" });
      return;
    }
    
    // Check if there's a header row with truck number column
    const firstLine = text.split(/[\r\n]+/)[0]?.toLowerCase() || '';
    if (!firstLine.includes('truck') || !firstLine.includes('number')) {
      toast({ 
        title: "Missing Truck Number Column", 
        description: "Your data must include a header row with a 'Truck Number' column. Example: Truck Number\\tContact\\tAddress", 
        variant: "destructive" 
      });
      return;
    }
    
    const parsedData = parseBulkImportData(bulkImportText);
    if (parsedData.length === 0) {
      toast({ title: "Error", description: "No valid data rows found. Make sure your data has both a header row and data rows.", variant: "destructive" });
      return;
    }
    bulkImportMutation.mutate(parsedData);
  };
  
  const handlePreviewData = () => {
    const parsedData = parseBulkImportData(bulkImportText);
    setImportPreview(parsedData.map(d => ({
      truckNumber: d.truckNumber.padStart(6, '0'),
      hasData: Boolean(d.registrationRenewalDate || d.keys || d.repaired || d.confirmedAddress || d.contactNamePhone || d.generalComments || d.fleetTeamComments)
    })));
  };

  // Callback for saving confirmed address
  const handleSaveAddress = useCallback((vehicleNumber: string, confirmedAddress: string | null) => {
    updateConfirmedAddressMutation.mutate({ vehicleNumber, confirmedAddress: confirmedAddress || '' });
  }, [updateConfirmedAddressMutation]);
  
  // Callback for saving status fields (keys, repaired, regDate, contact, generalComments, fleetComments)
  const handleSaveStatus = useCallback((vehicleNumber: string, field: string, value: string | null) => {
    const params: { vehicleNumber: string; [key: string]: string | null } = { vehicleNumber };
    switch (field) {
      case 'keys': params.keysStatus = value; break;
      case 'repaired': params.repairedStatus = value; break;
      case 'regDate': params.registrationRenewalDate = value; break;
      case 'contact': params.contactNamePhone = value; break;
      case 'generalComments': params.generalComments = value; break;
      case 'fleetComments': params.fleetTeamComments = value; break;
    }
    updateStatusMutation.mutate(params);
  }, [updateStatusMutation]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      if (sortDirection === 'desc') {
        setSortDirection('asc');
      } else if (sortDirection === 'asc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortVehicles = (vehicles: VehicleLocation[]) => {
    if (!sortColumn || !sortDirection) return vehicles;
    
    return [...vehicles].sort((a, b) => {
      let dateA: Date | null = null;
      let dateB: Date | null = null;
      
      if (sortColumn === 'confirmedDate') {
        dateA = a.confirmedAddressUpdatedAt ? new Date(a.confirmedAddressUpdatedAt) : null;
        dateB = b.confirmedAddressUpdatedAt ? new Date(b.confirmedAddressUpdatedAt) : null;
      } else if (sortColumn === 'samsaraDate') {
        dateA = a.samsaraTimestamp ? new Date(a.samsaraTimestamp) : null;
        dateB = b.samsaraTimestamp ? new Date(b.samsaraTimestamp) : null;
      }
      
      // Nulls go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      
      const comparison = dateA.getTime() - dateB.getTime();
      return sortDirection === 'desc' ? -comparison : comparison;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedVin(text);
    toast({ title: "Copied!", description: `VIN ${text} copied to clipboard` });
    setTimeout(() => setCopiedVin(null), 2000);
  };

  const filteredOtherLocations = useMemo(() => {
    if (!data?.otherLocations) return [];
    let filtered = data.otherLocations;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v => 
        v.vehicleNumber.toLowerCase().includes(query) ||
        v.vin.toLowerCase().includes(query) ||
        v.confirmedAddress.toLowerCase().includes(query) ||
        v.samsaraAddress.toLowerCase().includes(query)
      );
    }
    
    // Filter by Fleet Team Comments
    if (fleetTeamCommentsFilter) {
      if (fleetTeamCommentsFilter === 'custom') {
        // Show only rows with custom (non-predefined) comments
        filtered = filtered.filter(v => 
          v.fleetTeamComments && 
          v.fleetTeamComments.trim() !== '' && 
          !FLEET_TEAM_OPTIONS.includes(v.fleetTeamComments as any)
        );
      } else {
        // Show only rows matching the selected predefined option
        filtered = filtered.filter(v => v.fleetTeamComments === fleetTeamCommentsFilter);
      }
    }
    
    // Filter by Declined status
    if (declinedFilter === 'declined') {
      filtered = filtered.filter(v => v.isDeclined === true);
    } else if (declinedFilter === 'not_declined') {
      filtered = filtered.filter(v => !v.isDeclined);
    }
    
    return sortVehicles(filtered);
  }, [data?.otherLocations, searchQuery, sortColumn, sortDirection, fleetTeamCommentsFilter, declinedFilter]);

  const filteredRepairShop = useMemo(() => {
    if (!data?.repairShopLocations) return [];
    let filtered = data.repairShopLocations;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v => 
        v.vehicleNumber.toLowerCase().includes(query) ||
        v.vin.toLowerCase().includes(query) ||
        v.confirmedAddress.toLowerCase().includes(query) ||
        v.samsaraAddress.toLowerCase().includes(query)
      );
    }
    
    // Filter by Fleet Team Comments
    if (fleetTeamCommentsFilter) {
      if (fleetTeamCommentsFilter === 'custom') {
        // Show only rows with custom (non-predefined) comments
        filtered = filtered.filter(v => 
          v.fleetTeamComments && 
          v.fleetTeamComments.trim() !== '' && 
          !FLEET_TEAM_OPTIONS.includes(v.fleetTeamComments as any)
        );
      } else {
        // Show only rows matching the selected predefined option
        filtered = filtered.filter(v => v.fleetTeamComments === fleetTeamCommentsFilter);
      }
    }
    
    // Filter by Declined status
    if (declinedFilter === 'declined') {
      filtered = filtered.filter(v => v.isDeclined === true);
    } else if (declinedFilter === 'not_declined') {
      filtered = filtered.filter(v => !v.isDeclined);
    }
    
    return sortVehicles(filtered);
  }, [data?.repairShopLocations, searchQuery, sortColumn, sortDirection, fleetTeamCommentsFilter, declinedFilter]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-background">
      <div className="flex flex-wrap items-center gap-2 mb-4 px-4 lg:px-8 pt-6">
        <Link href="/fleet-scope">
          <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-all-vehicles">
            <ArrowLeft className="h-4 w-4" />
            All Vehicles
          </Button>
        </Link>
        <h1 className="text-xl font-semibold mr-auto">Spare Vehicles</h1>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        
        <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-bulk-import">
              <Upload className="w-4 h-4 mr-2" />
              Paste Data
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Bulk Import Vehicle Data</DialogTitle>
              <DialogDescription>
                Paste tab-separated data from Excel or a spreadsheet. Include the header row.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Expected columns: Truck Number, Registration Renewal Date, Keys, Repaired, Confirmed Address, 
                  Name and Contact Phone Number, General Comments, Fleet Team Comments
                </p>
                <Textarea
                  value={bulkImportText}
                  onChange={(e) => setBulkImportText(e.target.value)}
                  placeholder="Paste your data here (tab-separated, include header row)..."
                  className="min-h-[200px] font-mono text-xs"
                  data-testid="textarea-bulk-import"
                />
              </div>
              
              {importPreview.length > 0 && (
                <div className="border rounded p-3">
                  <p className="text-sm font-medium mb-2">Preview: {importPreview.length} vehicles found</p>
                  <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                    {importPreview.slice(0, 20).map((v, i) => (
                      <span key={i} className="inline-block mr-2 mb-1">
                        {v.truckNumber}{v.hasData ? '' : ' (no data)'}
                        {i < Math.min(19, importPreview.length - 1) ? ',' : ''}
                      </span>
                    ))}
                    {importPreview.length > 20 && <span>... and {importPreview.length - 20} more</span>}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button 
                variant="outline" 
                onClick={handlePreviewData}
                disabled={!bulkImportText.trim()}
                data-testid="button-preview-import"
              >
                Preview
              </Button>
              <Button 
                onClick={handleBulkImport}
                disabled={!bulkImportText.trim() || bulkImportMutation.isPending}
                data-testid="button-confirm-import"
              >
                {bulkImportMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Data'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <Dialog open={addTruckOpen} onOpenChange={(open) => {
          setAddTruckOpen(open);
          if (!open) {
            cancelPendingCheck();
            setNewTruckNumber("");
            setNewTruckVin("");
            setNewTruckAddress("");
            setAssignmentWarning(null);
            setIsTruckAssigned(false);
          }
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-add-truck">
              <Plus className="w-4 h-4 mr-2" />
              Add Truck
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Spare Vehicle</DialogTitle>
              <DialogDescription>
                Add a truck that isn't currently in the spares list.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Truck Number *</label>
                <Input
                  value={newTruckNumber}
                  onChange={(e) => {
                    setNewTruckNumber(e.target.value);
                    setIsTruckAssigned(false);
                    setAssignmentWarning(null);
                  }}
                  onBlur={() => checkTruckAssignment(newTruckNumber)}
                  placeholder="e.g., 123456"
                  data-testid="input-new-truck-number"
                />
                {isCheckingAssignment && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Checking assignment...
                  </p>
                )}
                {assignmentWarning && (
                  <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{assignmentWarning}</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">VIN (optional)</label>
                <Input
                  value={newTruckVin}
                  onChange={(e) => setNewTruckVin(e.target.value)}
                  placeholder="Vehicle Identification Number"
                  maxLength={20}
                  data-testid="input-new-truck-vin"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Confirmed Address (optional)</label>
                <Textarea
                  value={newTruckAddress}
                  onChange={(e) => setNewTruckAddress(e.target.value)}
                  placeholder="Enter the vehicle's confirmed address"
                  className="min-h-[80px]"
                  data-testid="input-new-truck-address"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddTruckOpen(false)}
                data-testid="button-cancel-add-truck"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddTruck}
                disabled={!newTruckNumber.trim() || addManualTruckMutation.isPending || isCheckingAssignment || isTruckAssigned}
                data-testid="button-confirm-add-truck"
              >
                {addManualTruckMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : isCheckingAssignment ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : isTruckAssigned ? (
                  'Truck Already Assigned'
                ) : (
                  'Add Truck'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <main className="p-4 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="spares-summary-cards">
          <Card className="p-3 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20" data-testid="card-total-spares">
            <div className="flex items-center gap-2 mb-1">
              <TruckIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Total Vehicles</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-total-count">
              {isLoading ? <Skeleton className="h-8 w-16" /> : data?.counts.total || 0}
            </p>
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
              unassigned fleet
            </p>
          </Card>
          <Card className="p-3 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20" data-testid="card-other-locations">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Other Locations</span>
            </div>
            <p className="text-2xl font-bold text-slate-600 dark:text-slate-400" data-testid="text-other-locations-count">
              {isLoading ? <Skeleton className="h-8 w-16" /> : data?.counts.otherLocations || 0}
            </p>
            <p className="text-xs text-slate-600/70 dark:text-slate-400/70 mt-0.5">
              non-repair locations
            </p>
          </Card>
          <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="card-repair-shops">
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">In Repair Shops</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-repair-shop-count">
              {isLoading ? <Skeleton className="h-8 w-16" /> : data?.counts.repairShop || 0}
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">
              currently being repaired
            </p>
          </Card>
          <Card className="p-3 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" data-testid="card-keys-confirmed">
            <div className="flex items-center gap-2 mb-1">
              <Key className="w-4 h-4 text-green-600" />
              <span className="text-xs font-medium text-green-700 dark:text-green-300">Keys Present</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-keys-present-count">
              {isLoading ? <Skeleton className="h-8 w-16" /> : (() => {
                const vehicles = data?.vehicles || [];
                return vehicles.filter((v: VehicleLocation) => v.keysStatus === 'Yes').length;
              })()}
            </p>
            <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-0.5">
              keys confirmed
            </p>
          </Card>
          <Card className="p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20" data-testid="card-missing-address">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-xs font-medium text-red-700 dark:text-red-300">Missing Address</span>
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-missing-count">
              {isLoading ? <Skeleton className="h-6 w-12" /> : data?.addressBreakdown?.neither || 0}
            </p>
            <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
              no location data
            </p>
          </Card>
        </div>

        {/* Address Breakdown */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Confirmed Only</p>
              <p className="text-xl font-bold text-blue-600" data-testid="text-confirmed-only-count">
                {isLoading ? <Skeleton className="h-6 w-12 mx-auto" /> : data?.addressBreakdown?.confirmedOnly || 0}
              </p>
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Samsara Only</p>
              <p className="text-xl font-bold text-purple-600" data-testid="text-samsara-only-count">
                {isLoading ? <Skeleton className="h-6 w-12 mx-auto" /> : data?.addressBreakdown?.samsaraOnly || 0}
              </p>
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Both Addresses</p>
              <p className="text-xl font-bold text-green-600" data-testid="text-both-count">
                {isLoading ? <Skeleton className="h-6 w-12 mx-auto" /> : data?.addressBreakdown?.both || 0}
              </p>
            </div>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-md flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by truck number, VIN, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          
          {/* Declined Status Filter */}
          <Select value={declinedFilter} onValueChange={(value) => setDeclinedFilter(value as 'all' | 'declined' | 'not_declined')}>
            <SelectTrigger className="w-[180px]" data-testid="select-declined-filter">
              <SelectValue placeholder="Declined Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="option-declined-all">All Vehicles</SelectItem>
              <SelectItem value="declined" data-testid="option-declined-yes">
                <span className="flex items-center gap-1">
                  <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Declined</span>
                  Only
                </span>
              </SelectItem>
              <SelectItem value="not_declined" data-testid="option-declined-no">Not Declined</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Other Locations Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Other Parking Locations
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredOtherLocations.length} vehicles)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredOtherLocations.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No vehicles found</p>
            ) : (
              <DualScrollContainer>
                <table className="text-sm" style={{tableLayout: 'fixed', minWidth: '1600px', width: '1600px'}}>
                  <colgroup>
                    <col style={{width: '70px'}} />
                    <col style={{width: '160px'}} />
                    <col style={{width: '220px'}} />
                    <col style={{width: '200px'}} />
                    <col style={{width: '60px'}} />
                    <col style={{width: '100px'}} />
                    <col style={{width: '120px'}} />
                    <col style={{width: '110px'}} />
                    <col style={{width: '140px'}} />
                    <col style={{width: '200px'}} />
                    <col style={{width: '220px'}} />
                  </colgroup>
                  <thead className="bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium bg-background">Truck #</th>
                      <th className="text-left py-2 px-2 font-medium bg-background">VIN</th>
                      <th 
                        className="text-left py-2 px-2 font-medium cursor-pointer hover:bg-muted/50 select-none bg-background"
                        onClick={() => handleSort('confirmedDate')}
                        data-testid="header-confirmed-address-other"
                      >
                        <div className="flex items-center gap-1">
                          Confirmed Address
                          {sortColumn === 'confirmedDate' ? (
                            sortDirection === 'desc' ? (
                              <ArrowDown className="w-3 h-3" />
                            ) : (
                              <ArrowUp className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-2 px-2 font-medium cursor-pointer hover:bg-muted/50 select-none bg-background"
                        onClick={() => handleSort('samsaraDate')}
                        data-testid="header-samsara-address-other"
                      >
                        <div className="flex items-center gap-1">
                          Samsara Address
                          {sortColumn === 'samsaraDate' ? (
                            sortDirection === 'desc' ? (
                              <ArrowDown className="w-3 h-3" />
                            ) : (
                              <ArrowUp className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-2 px-2 font-medium min-w-[100px] bg-background">Source</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[100px] bg-background">Keys</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[130px] bg-background">Repaired</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[120px] bg-background">Reg. Renewal</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[150px] bg-background">Contact</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[200px] bg-background">General Comments</th>
                      <th 
                        className="text-left py-2 px-2 font-medium min-w-[180px] bg-background"
                        data-testid="header-fleet-team-comments-other"
                      >
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="flex items-center gap-1 hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer">
                              Fleet Team Comments
                              <Filter className={`w-3 h-3 ${fleetTeamCommentsFilter ? 'text-blue-600' : 'text-muted-foreground'}`} />
                              {fleetTeamCommentsFilter && <ChevronDown className="w-3 h-3 text-blue-600" />}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-1" align="start">
                            <div className="flex flex-col gap-0.5">
                              <button
                                className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${!fleetTeamCommentsFilter ? 'bg-muted font-medium' : ''}`}
                                onClick={() => setFleetTeamCommentsFilter('')}
                                data-testid="filter-fleet-all"
                              >
                                All
                              </button>
                              {FLEET_TEAM_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${fleetTeamCommentsFilter === option ? 'bg-muted font-medium' : ''}`}
                                  onClick={() => setFleetTeamCommentsFilter(option)}
                                  data-testid={`filter-fleet-${option.toLowerCase().replace(/\s+/g, '-')}`}
                                >
                                  {option}
                                </button>
                              ))}
                              <div className="border-t my-1" />
                              <button
                                className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${fleetTeamCommentsFilter === 'custom' ? 'bg-muted font-medium' : ''}`}
                                onClick={() => setFleetTeamCommentsFilter('custom')}
                                data-testid="filter-fleet-custom"
                              >
                                Custom Comments
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </th>
                      <th className="text-left py-2 px-2 font-medium min-w-[140px] bg-background" data-testid="header-last-edited-other">Last Edited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOtherLocations.map((vehicle) => (
                      <tr key={vehicle.vehicleNumber} className="border-b hover:bg-muted/50" data-testid={`row-other-${vehicle.vehicleNumber}`}>
                        <td className="py-2 px-2 font-medium">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1">
                              <span>{vehicle.vehicleNumber}</span>
                              {vehicle.isDeclined && (
                                <span 
                                  className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium"
                                  title={`Declined: ${vehicle.declinedSources?.join(', ')}`}
                                  data-testid={`badge-declined-${vehicle.vehicleNumber}`}
                                >
                                  Declined
                                </span>
                              )}
                            </div>
                            {vehicle.status === 'Manually Added' && (
                              <span className="text-[10px] text-blue-600 dark:text-blue-400 font-normal">Manual</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs">{vehicle.vin || '-'}</span>
                            {vehicle.vin && (
                              <button
                                onClick={() => copyToClipboard(vehicle.vin)}
                                className="p-1 hover:bg-muted rounded"
                                data-testid={`button-copy-vin-${vehicle.vehicleNumber}`}
                              >
                                {copiedVin === vehicle.vin ? (
                                  <CheckCircle className="w-3 h-3 text-green-600" />
                                ) : (
                                  <Copy className="w-3 h-3 text-muted-foreground" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 min-w-[250px]">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.confirmedAddress}
                            onSave={(value) => handleSaveAddress(vehicle.vehicleNumber, value)}
                            isPending={updateConfirmedAddressMutation.isPending}
                            placeholder="Click to add address"
                            testIdPrefix="confirmed-address"
                            showDate={true}
                            dateValue={vehicle.confirmedAddressUpdatedAt ? formatDate(vehicle.confirmedAddressUpdatedAt) : undefined}
                            className="w-60"
                          />
                        </td>
                        <td className="py-2 px-2">
                          {vehicle.samsaraAddress ? (
                            <div>
                              <span>{vehicle.samsaraAddress}</span>
                              {vehicle.samsaraTimestamp && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({formatDate(vehicle.samsaraTimestamp)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {vehicle.locationSource === 'both' && (
                            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded">Both</span>
                          )}
                          {vehicle.locationSource === 'confirmed' && (
                            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs rounded">Confirmed</span>
                          )}
                          {vehicle.locationSource === 'samsara' && (
                            <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs rounded">Samsara</span>
                          )}
                        </td>
                        {/* Keys Status */}
                        <td className="py-2 px-2">
                          <EditableSelectCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.keysStatus}
                            options={KEYS_OPTIONS}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'keys', value)}
                            isPending={updateStatusMutation.isPending}
                            testIdPrefix="keys"
                            valueMap={KEYS_STORED_TO_DISPLAY}
                          />
                        </td>
                        {/* Repaired Status */}
                        <td className="py-2 px-2">
                          <EditableSelectCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.repairedStatus}
                            options={REPAIRED_OPTIONS}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'repaired', value)}
                            isPending={updateStatusMutation.isPending}
                            testIdPrefix="repaired"
                          />
                        </td>
                        {/* Registration Renewal Date */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.registrationRenewalDate}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'regDate', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            inputType="date"
                            testIdPrefix="regdate"
                            className="w-32"
                          />
                        </td>
                        {/* Contact Name/Phone */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.contactNamePhone}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'contact', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            maxLength={60}
                            testIdPrefix="contact"
                            className="w-40"
                          />
                        </td>
                        {/* General Comments */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.generalComments}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'generalComments', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            maxLength={500}
                            inputType="textarea"
                            testIdPrefix="general-comments"
                            className="w-48"
                          />
                        </td>
                        {/* Fleet Team Comments */}
                        <td className="py-2 px-2">
                          <FleetTeamCommentsCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.fleetTeamComments}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'fleetComments', value)}
                            isPending={updateStatusMutation.isPending}
                          />
                        </td>
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-last-edited-${vehicle.vehicleNumber}`}>
                          {vehicle.manualEditTimestamp ? new Date(vehicle.manualEditTimestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DualScrollContainer>
            )}
          </CardContent>
        </Card>

        {/* Repair Shop Locations Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-amber-600" />
              In Repair Shops
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredRepairShop.length} vehicles)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredRepairShop.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No vehicles in repair shops</p>
            ) : (
              <DualScrollContainer>
                <table className="text-sm" style={{tableLayout: 'fixed', minWidth: '1600px', width: '1600px'}}>
                  <colgroup>
                    <col style={{width: '70px'}} />
                    <col style={{width: '160px'}} />
                    <col style={{width: '220px'}} />
                    <col style={{width: '200px'}} />
                    <col style={{width: '60px'}} />
                    <col style={{width: '100px'}} />
                    <col style={{width: '120px'}} />
                    <col style={{width: '110px'}} />
                    <col style={{width: '140px'}} />
                    <col style={{width: '200px'}} />
                    <col style={{width: '220px'}} />
                  </colgroup>
                  <thead className="bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium bg-background">Truck #</th>
                      <th className="text-left py-2 px-2 font-medium bg-background">VIN</th>
                      <th 
                        className="text-left py-2 px-2 font-medium cursor-pointer hover:bg-muted/50 select-none bg-background"
                        onClick={() => handleSort('confirmedDate')}
                        data-testid="header-confirmed-address-repair"
                      >
                        <div className="flex items-center gap-1">
                          Confirmed Address
                          {sortColumn === 'confirmedDate' ? (
                            sortDirection === 'desc' ? (
                              <ArrowDown className="w-3 h-3" />
                            ) : (
                              <ArrowUp className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </th>
                      <th 
                        className="text-left py-2 px-2 font-medium cursor-pointer hover:bg-muted/50 select-none bg-background"
                        onClick={() => handleSort('samsaraDate')}
                        data-testid="header-samsara-address-repair"
                      >
                        <div className="flex items-center gap-1">
                          Samsara Address
                          {sortColumn === 'samsaraDate' ? (
                            sortDirection === 'desc' ? (
                              <ArrowDown className="w-3 h-3" />
                            ) : (
                              <ArrowUp className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </th>
                      <th className="text-left py-2 px-2 font-medium min-w-[100px] bg-background">Source</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[100px] bg-background">Keys</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[130px] bg-background">Repaired</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[120px] bg-background">Reg. Renewal</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[150px] bg-background">Contact</th>
                      <th className="text-left py-2 px-2 font-medium min-w-[200px] bg-background">General Comments</th>
                      <th 
                        className="text-left py-2 px-2 font-medium min-w-[180px] bg-background"
                        data-testid="header-fleet-team-comments-repair"
                      >
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="flex items-center gap-1 hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer">
                              Fleet Team Comments
                              <Filter className={`w-3 h-3 ${fleetTeamCommentsFilter ? 'text-blue-600' : 'text-muted-foreground'}`} />
                              {fleetTeamCommentsFilter && <ChevronDown className="w-3 h-3 text-blue-600" />}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-1" align="start">
                            <div className="flex flex-col gap-0.5">
                              <button
                                className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${!fleetTeamCommentsFilter ? 'bg-muted font-medium' : ''}`}
                                onClick={() => setFleetTeamCommentsFilter('')}
                                data-testid="filter-fleet-all-repair"
                              >
                                All
                              </button>
                              {FLEET_TEAM_OPTIONS.map((option) => (
                                <button
                                  key={option}
                                  className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${fleetTeamCommentsFilter === option ? 'bg-muted font-medium' : ''}`}
                                  onClick={() => setFleetTeamCommentsFilter(option)}
                                  data-testid={`filter-fleet-repair-${option.toLowerCase().replace(/\s+/g, '-')}`}
                                >
                                  {option}
                                </button>
                              ))}
                              <div className="border-t my-1" />
                              <button
                                className={`text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${fleetTeamCommentsFilter === 'custom' ? 'bg-muted font-medium' : ''}`}
                                onClick={() => setFleetTeamCommentsFilter('custom')}
                                data-testid="filter-fleet-custom-repair"
                              >
                                Custom Comments
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </th>
                      <th className="text-left py-2 px-2 font-medium min-w-[140px] bg-background" data-testid="header-last-edited-repair">Last Edited</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRepairShop.map((vehicle) => (
                      <tr key={vehicle.vehicleNumber} className="border-b hover:bg-muted/50" data-testid={`row-repair-${vehicle.vehicleNumber}`}>
                        <td className="py-2 px-2 font-medium">
                          <div className="flex items-center gap-1">
                            <Link href={`/trucks/${vehicle.vehicleNumber}`}>
                              <span className="text-primary hover:underline cursor-pointer">{vehicle.vehicleNumber}</span>
                            </Link>
                            {vehicle.isDeclined && (
                              <span 
                                className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium"
                                title={`Declined: ${vehicle.declinedSources?.join(', ')}`}
                                data-testid={`badge-declined-repair-${vehicle.vehicleNumber}`}
                              >
                                Declined
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs">{vehicle.vin || '-'}</span>
                            {vehicle.vin && (
                              <button
                                onClick={() => copyToClipboard(vehicle.vin)}
                                className="p-1 hover:bg-muted rounded"
                                data-testid={`button-copy-vin-repair-${vehicle.vehicleNumber}`}
                              >
                                {copiedVin === vehicle.vin ? (
                                  <CheckCircle className="w-3 h-3 text-green-600" />
                                ) : (
                                  <Copy className="w-3 h-3 text-muted-foreground" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 min-w-[250px]">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.confirmedAddress}
                            onSave={(value) => handleSaveAddress(vehicle.vehicleNumber, value)}
                            isPending={updateConfirmedAddressMutation.isPending}
                            placeholder="Click to add address"
                            testIdPrefix="confirmed-address-repair"
                            showDate={true}
                            dateValue={vehicle.confirmedAddressUpdatedAt ? formatDate(vehicle.confirmedAddressUpdatedAt) : undefined}
                            className="w-60"
                          />
                        </td>
                        <td className="py-2 px-2">
                          {vehicle.samsaraAddress ? (
                            <div>
                              <span>{vehicle.samsaraAddress}</span>
                              {vehicle.samsaraTimestamp && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({formatDate(vehicle.samsaraTimestamp)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {vehicle.locationSource === 'both' && (
                            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded">Both</span>
                          )}
                          {vehicle.locationSource === 'confirmed' && (
                            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs rounded">Confirmed</span>
                          )}
                          {vehicle.locationSource === 'samsara' && (
                            <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs rounded">Samsara</span>
                          )}
                        </td>
                        {/* Keys Status */}
                        <td className="py-2 px-2">
                          <EditableSelectCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.keysStatus}
                            options={KEYS_OPTIONS}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'keys', value)}
                            isPending={updateStatusMutation.isPending}
                            testIdPrefix="keys-repair"
                            valueMap={KEYS_STORED_TO_DISPLAY}
                          />
                        </td>
                        {/* Repaired Status */}
                        <td className="py-2 px-2">
                          <EditableSelectCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.repairedStatus}
                            options={REPAIRED_OPTIONS}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'repaired', value)}
                            isPending={updateStatusMutation.isPending}
                            testIdPrefix="repaired-repair"
                          />
                        </td>
                        {/* Registration Renewal Date */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.registrationRenewalDate}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'regDate', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            inputType="date"
                            testIdPrefix="regdate-repair"
                            className="w-32"
                          />
                        </td>
                        {/* Contact Name/Phone */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.contactNamePhone}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'contact', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            maxLength={60}
                            testIdPrefix="contact-repair"
                            className="w-40"
                          />
                        </td>
                        {/* General Comments */}
                        <td className="py-2 px-2">
                          <EditableTextCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.generalComments}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'generalComments', value)}
                            isPending={updateStatusMutation.isPending}
                            placeholder="Click to add"
                            maxLength={500}
                            inputType="textarea"
                            testIdPrefix="general-comments-repair"
                            className="w-48"
                          />
                        </td>
                        {/* Fleet Team Comments */}
                        <td className="py-2 px-2">
                          <FleetTeamCommentsCell
                            vehicleNumber={vehicle.vehicleNumber}
                            currentValue={vehicle.fleetTeamComments}
                            onSave={(value) => handleSaveStatus(vehicle.vehicleNumber, 'fleetComments', value)}
                            isPending={updateStatusMutation.isPending}
                          />
                        </td>
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-last-edited-repair-${vehicle.vehicleNumber}`}>
                          {vehicle.manualEditTimestamp ? new Date(vehicle.manualEditTimestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DualScrollContainer>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
