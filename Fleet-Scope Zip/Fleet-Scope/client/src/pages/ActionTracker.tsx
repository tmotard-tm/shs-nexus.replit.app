import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Truck, getCombinedStatus, MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/schema";

import { StatusBadge } from "@/components/StatusBadge";
import { StatusReminder, useStatusReminder } from "@/components/StatusReminder";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  User,
  Users,
  TruckIcon,
  Eye,
  CheckCircle2,
  ClipboardList,
  Wrench,
  Tag,
  Package,
  DollarSign,
  AlertCircle,
  Filter,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Owner types for the Action Tracker (predefined owners, but shsOwner can have any value)
type OwnerType = string;

/**
 * Normalizes owner names for consistent grouping:
 * - Trims whitespace, removes trailing periods
 * - Keeps Rob A, Rob C, Rob D, Rob G as separate owners (different people)
 */
function normalizeOwnerName(owner: string | null | undefined): string {
  if (!owner || owner.trim() === '') {
    return 'Oscar S';  // Default owner
  }
  
  let normalized = owner.trim();
  
  // Handle Rob variations - keep them separate but normalize format
  if (normalized.match(/^Rob A[.\s]/i) || normalized.toLowerCase() === 'rob a.' || normalized.toLowerCase() === 'rob a') {
    return 'Rob A';
  }
  if (normalized.toLowerCase() === 'rob c.' || normalized.toLowerCase() === 'rob c') {
    return 'Rob C';
  }
  if (normalized.toLowerCase() === 'rob d.' || normalized.toLowerCase() === 'rob d') {
    return 'Rob D';
  }
  if (normalized.toLowerCase() === 'rob g.' || normalized.toLowerCase() === 'rob g') {
    return 'Rob G';
  }
  
  // Handle other known owners - normalize variations
  if (normalized.toLowerCase().includes('oscar')) return 'Oscar S';
  if (normalized.toLowerCase().startsWith('jenn d')) return 'Jenn D';
  if (normalized.toLowerCase().startsWith('john c')) return 'John C';
  if (normalized.toLowerCase().startsWith('samantha w')) return 'Samantha W';
  if (normalized.toLowerCase().startsWith('mandy r')) return 'Mandy R';
  if (normalized.toLowerCase().startsWith('cheryl')) return 'Cheryl';
  if (normalized.toLowerCase().startsWith('bob b')) return 'Bob B';
  
  // Remove trailing period for any remaining names
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1).trim();
  }
  
  return normalized;
}

interface OwnerInfo {
  name: string;
  icon: typeof User;
  description: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

const OWNERS: OwnerInfo[] = [
  {
    name: "Oscar S",
    icon: Wrench,
    description: "Research & Repair Coordination",
    colorClass: "text-amber-600",
    bgClass: "bg-amber-50 hover:bg-amber-100",
    borderClass: "border-amber-200",
  },
  {
    name: "John C",
    icon: Tag,
    description: "Tag & Registration",
    colorClass: "text-blue-600",
    bgClass: "bg-blue-50 hover:bg-blue-100",
    borderClass: "border-blue-200",
  },
  {
    name: "Mandy R",
    icon: Package,
    description: "Pickup Coordination",
    colorClass: "text-green-600",
    bgClass: "bg-green-50 hover:bg-green-100",
    borderClass: "border-green-200",
  },
  {
    name: "Rob A",
    icon: ClipboardList,
    description: "PO & Decision Review",
    colorClass: "text-purple-600",
    bgClass: "bg-purple-50 hover:bg-purple-100",
    borderClass: "border-purple-200",
  },
  {
    name: "Bob B",
    icon: DollarSign,
    description: "Vehicle Sales",
    colorClass: "text-orange-600",
    bgClass: "bg-orange-50 hover:bg-orange-100",
    borderClass: "border-orange-200",
  },
  {
    name: "Jenn D",
    icon: ClipboardList,
    description: "Softeon & Termination Forms",
    colorClass: "text-pink-600",
    bgClass: "bg-pink-50 hover:bg-pink-100",
    borderClass: "border-pink-200",
  },
  {
    name: "Samantha W",
    icon: ClipboardList,
    description: "DocuSign Leadership Approval",
    colorClass: "text-cyan-600",
    bgClass: "bg-cyan-50 hover:bg-cyan-100",
    borderClass: "border-cyan-200",
  },
  {
    name: "Final Actioned",
    icon: CheckCircle2,
    description: "Completed / Closed",
    colorClass: "text-gray-600",
    bgClass: "bg-gray-50 hover:bg-gray-100",
    borderClass: "border-gray-200",
  },
  {
    name: "Unassigned",
    icon: User,
    description: "No owner assigned",
    colorClass: "text-slate-600",
    bgClass: "bg-slate-50 hover:bg-slate-100",
    borderClass: "border-slate-200",
  },
];

// Determine the next action needed for a truck based on its current state
function getNextAction(truck: Truck): string {
  const mainStatus = truck.mainStatus;
  const subStatus = truck.subStatus;

  // On Road - Final
  if (mainStatus === "On Road") {
    return "Complete - Delivered to technician";
  }

  // Declined Repair - Vehicle was sold
  if (mainStatus === "Declined Repair" && subStatus === "Vehicle was sold") {
    return "Complete - Vehicle sold";
  }

  // Van picked up flag
  if (truck.vanPickedUp) {
    return "Complete - Van picked up";
  }

  // Confirming Status actions
  if (mainStatus === "Confirming Status") {
    if (subStatus === "SHS Confirming") return "Research vehicle location/status";
    if (subStatus === "Holman Confirming") return "Awaiting Holman research results";
    if (subStatus === "Location Unknown") return "Determine vehicle location";
    if (subStatus === "Awaiting Tech Response") return "Call tech for status update";
  }

  // Decision Pending actions
  if (mainStatus === "Decision Pending") {
    if (subStatus === "Awaiting estimate from shop") return "Follow up with shop for estimate";
    if (subStatus === "Estimate received, needs review") return "Run PO through GPT for decision";
    if (subStatus === "Repair approved") return "Update status to Repairing";
    if (subStatus === "Repair declined") return "Update status to Declined Repair";
  }

  // Repairing actions
  if (mainStatus === "Repairing") {
    if (subStatus === "Under repair at shop") return "Monitor repair progress";
    if (subStatus === "Waiting on repair completion") return "Follow up on repair completion";
  }

  // Declined Repair actions
  if (mainStatus === "Declined Repair") {
    if (subStatus === "Vehicle in process of being decommissioned") return "Process vehicle decommission";
    if (subStatus === "Vehicle submitted for sale") return "Prep vehicle for sale";
  }

  // Approved for sale actions
  if (mainStatus === "Approved for sale") {
    if (subStatus === "Clearing Softeon Inventory") return "Clear vehicle from Softeon inventory";
    if (subStatus === "Vehicle Termination Form completed") return "Submit termination form for approval";
    if (subStatus === "Termination Form Approved") return "Send to Fleet Administrator";
    if (subStatus === "Fleet Administrator review") return "Fleet Admin to review and process";
    if (subStatus === "Procurement to transfer form to leadership") return "Transfer form to leadership";
    if (subStatus === "Leadership to approve Docusign") return "Await leadership DocuSign approval";
    if (subStatus === "Declined Docusign") return "Review declined DocuSign and resubmit";
  }

  // Tags actions
  if (mainStatus === "Tags") {
    if (subStatus === "Needs tag/registration") return "Process tag/registration";
    if (subStatus === "Registration renewal in progress") return "Monitor registration renewal";
    if (subStatus === "Tags/registration complete") return "Update status to Scheduling";
  }

  // Scheduling actions
  if (mainStatus === "Scheduling") {
    if (subStatus === "To be scheduled for tech pickup") return "Schedule pickup slot";
    if (subStatus === "Scheduled, awaiting tech pickup") return "Coordinate tech pickup";
  }

  // PMF actions
  if (mainStatus === "PMF") {
    if (subStatus === "In transit to PMF") return "Track PMF transit";
    if (subStatus === "Undergoing work at PMF") return "Monitor PMF work progress";
    if (subStatus === "Ready for redeployment") return "Coordinate redeployment";
  }

  // In Transit actions
  if (mainStatus === "In Transit") {
    return "Track transport to technician";
  }

  return "Review and update status";
}

// Determine which owner is responsible for a truck based on the rules
function determineOwner(truck: Truck): OwnerType {
  const mainStatus = truck.mainStatus;
  const subStatus = truck.subStatus;

  // Priority 1: Final Actioned - On Road or Vehicle was sold
  if (mainStatus === "On Road") {
    return "Final Actioned";
  }
  if (mainStatus === "Declined Repair" && subStatus === "Vehicle was sold") {
    return "Final Actioned";
  }
  if (truck.vanPickedUp) {
    return "Final Actioned";
  }

  // Priority 2: Rob A - Decision Pending with estimate needing review
  if (mainStatus === "Decision Pending" && subStatus === "Estimate received, needs review") {
    return "Rob A";
  }

  // Priority 3: Bob B - Declined Repair (sales pipeline) or PMF
  if (mainStatus === "Declined Repair" && subStatus !== "Vehicle was sold") {
    return "Bob B";
  }
  if (mainStatus === "PMF") {
    return "Bob B";
  }

  // Approved for sale - owner assignment based on substatus
  if (mainStatus === "Approved for sale") {
    if (subStatus === "Clearing Softeon Inventory" || subStatus === "Vehicle Termination Form completed") {
      return "Jenn D.";
    }
    if (subStatus === "Fleet Administrator review" || subStatus === "Procurement to transfer form to leadership") {
      return "Bob B";
    }
    if (subStatus === "Leadership to approve Docusign") {
      return "Samantha W";
    }
    // For other substatuses (Termination Form Approved, Declined Docusign), default to Oscar S
    return "Oscar S";
  }

  // Priority 4: John C - Tags category
  if (mainStatus === "Tags") {
    return "John C";
  }

  // Priority 5: Mandy R - Scheduling category
  if (mainStatus === "Scheduling") {
    return "Mandy R";
  }

  // Priority 6: Oscar S - Everything else
  // Confirming Status, Decision Pending (except estimate review), Repairing, In Transit
  return "Oscar S";
}

// Filter configuration for each column with all possible values
type FilterField = "registrationStickerValid" | "repairCompleted" | "inAms" | 
  "registrationRenewalInProcess" | "pickUpSlotBooked" | "rentalReturned" | 
  "vanPickedUp" | "spareVanAssignmentInProcess";

interface FilterOption {
  value: string;
  label: string;
  shortLabel: string;
  color: string;
}

interface FilterConfig {
  field: FilterField;
  label: string;
  options: FilterOption[];
  getValue: (truck: Truck) => string;
}

// Define all filter configurations with their distinct values
const FILTER_CONFIGS: FilterConfig[] = [
  {
    field: "registrationStickerValid",
    label: "REG. STICKER",
    options: [
      { value: "Yes", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "Expired", label: "Expired", shortLabel: "Exp", color: "bg-red-600 hover:bg-red-700" },
      { value: "Shop would not check", label: "Shop would not check", shortLabel: "Shop", color: "bg-amber-600 hover:bg-amber-700" },
      { value: "Mailed Tag", label: "Mailed Tag", shortLabel: "Mail", color: "bg-blue-600 hover:bg-blue-700" },
      { value: "Contacted tech", label: "Contacted tech", shortLabel: "Tech", color: "bg-purple-600 hover:bg-purple-700" },
      { value: "Ordered duplicates", label: "Ordered duplicates", shortLabel: "Dup", color: "bg-cyan-600 hover:bg-cyan-700" },
      { value: "_blank_", label: "Blank", shortLabel: "—", color: "bg-gray-500 hover:bg-gray-600" },
    ],
    getValue: (truck) => truck.registrationStickerValid || "_blank_",
  },
  {
    field: "repairCompleted",
    label: "COMPLETED",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
      { value: "_blank_", label: "Blank", shortLabel: "—", color: "bg-gray-500 hover:bg-gray-600" },
    ],
    getValue: (truck) => truck.repairCompleted === true ? "true" : truck.repairCompleted === false ? "false" : "_blank_",
  },
  {
    field: "inAms",
    label: "AMS",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
      { value: "_blank_", label: "Blank", shortLabel: "—", color: "bg-gray-500 hover:bg-gray-600" },
    ],
    getValue: (truck) => truck.inAms === true ? "true" : truck.inAms === false ? "false" : "_blank_",
  },
  {
    field: "registrationRenewalInProcess",
    label: "REG. RENEWAL",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
    ],
    getValue: (truck) => truck.registrationRenewalInProcess === true ? "true" : "false",
  },
  {
    field: "pickUpSlotBooked",
    label: "PICK UP SLOT",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
    ],
    getValue: (truck) => truck.pickUpSlotBooked === true ? "true" : "false",
  },
  {
    field: "rentalReturned",
    label: "RENTAL RET.",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
    ],
    getValue: (truck) => truck.rentalReturned === true ? "true" : "false",
  },
  {
    field: "vanPickedUp",
    label: "VAN PICKED UP",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
    ],
    getValue: (truck) => truck.vanPickedUp === true ? "true" : "false",
  },
  {
    field: "spareVanAssignmentInProcess",
    label: "SPARE VAN",
    options: [
      { value: "true", label: "Yes", shortLabel: "Y", color: "bg-green-600 hover:bg-green-700" },
      { value: "false", label: "No", shortLabel: "N", color: "bg-red-600 hover:bg-red-700" },
    ],
    getValue: (truck) => truck.spareVanAssignmentInProcess === true ? "true" : "false",
  },
];

// Filter state type - stores "all" or the actual selected value
type FilterState = Record<FilterField, string>;

export default function ActionTracker() {
  const { currentUser } = useUser();
  // Persist selected owner to localStorage so it's remembered when returning from viewing a truck
  const [selectedOwner, setSelectedOwner] = useState<string | null>(() => {
    const saved = localStorage.getItem("actionTrackerSelectedOwner");
    return saved || null;
  });
  const { toast } = useToast();
  
  // Save selected owner to localStorage when it changes
  const handleOwnerSelect = (owner: string | null) => {
    setSelectedOwner(owner);
    if (owner) {
      localStorage.setItem("actionTrackerSelectedOwner", owner);
    } else {
      localStorage.removeItem("actionTrackerSelectedOwner");
    }
  };
  
  // Filter state - stores "all" or the actual selected value for each field
  const [filters, setFilters] = useState<FilterState>({
    registrationStickerValid: "all",
    repairCompleted: "all",
    inAms: "all",
    registrationRenewalInProcess: "all",
    pickUpSlotBooked: "all",
    rentalReturned: "all",
    vanPickedUp: "all",
    spareVanAssignmentInProcess: "all",
  });
  
  // Toggle filter - cycles through: all -> option1 -> option2 -> ... -> all
  const toggleFilter = (field: FilterField) => {
    const config = FILTER_CONFIGS.find(c => c.field === field);
    if (!config) return;
    
    setFilters(prev => {
      const current = prev[field];
      const options = config.options;
      
      if (current === "all") {
        return { ...prev, [field]: options[0].value };
      }
      
      const currentIndex = options.findIndex(o => o.value === current);
      if (currentIndex === -1 || currentIndex === options.length - 1) {
        return { ...prev, [field]: "all" };
      }
      
      return { ...prev, [field]: options[currentIndex + 1].value };
    });
  };
  
  const clearAllFilters = () => {
    setFilters({
      registrationStickerValid: "all",
      repairCompleted: "all",
      inAms: "all",
      registrationRenewalInProcess: "all",
      pickUpSlotBooked: "all",
      rentalReturned: "all",
      vanPickedUp: "all",
      spareVanAssignmentInProcess: "all",
    });
  };
  
  const hasActiveFilters = Object.values(filters).some(v => v !== "all");
  
  // Status change reminder
  const { showReminder, hideReminder, shouldShowReminder } = useStatusReminder();

  const { data: trucks, isLoading, error } = useQuery<Truck[]>({
    queryKey: ["/api/trucks"],
  });

  // Inline edit mutation for status changes
  const inlineEditMutation = useMutation({
    mutationFn: async ({ truckId, updates }: { truckId: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/trucks/${truckId}`, { 
        ...updates,
        lastUpdatedBy: currentUser || "User"
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update truck",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (truckId: string, newMainStatus: string, currentSubStatus: string | null) => {
    const validSubs = SUB_STATUSES[newMainStatus as MainStatus] || [];
    const newSubStatus = validSubs.includes(currentSubStatus || "") ? currentSubStatus : null;
    
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { mainStatus: newMainStatus, subStatus: newSubStatus }
    });
    hideReminder(truckId);
  };

  const handleSubStatusChange = (truckId: string, mainStatus: string, newSubStatus: string) => {
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { mainStatus, subStatus: newSubStatus === "_none_" ? null : newSubStatus }
    });
    hideReminder(truckId);
  };

  const handleBooleanChange = (truckId: string, field: string, value: string) => {
    let boolValue: boolean | null = null;
    if (value === "true") boolValue = true;
    else if (value === "false") boolValue = false;
    
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { [field]: boolValue }
    });
    showReminder(truckId);
  };

  const handleSelectChange = (truckId: string, field: string, value: string) => {
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { [field]: value === "_blank_" ? null : value }
    });
    showReminder(truckId);
  };

  // Group trucks by normalized shsOwner field value, with special handling for completed vehicles
  const trucksByOwner = useMemo(() => {
    if (!trucks) return new Map<string, Truck[]>();
    
    const grouped = new Map<string, Truck[]>();
    // Initialize with predefined owner names
    OWNERS.forEach(owner => grouped.set(owner.name, []));
    
    trucks.forEach(truck => {
      // Special rule: Override shsOwner for completed/closed vehicles
      // These go to "Final Actioned" regardless of their shsOwner field
      const isFinalActioned = 
        truck.mainStatus === "On Road" ||
        (truck.mainStatus === "Declined Repair" && truck.subStatus === "Vehicle was sold") ||
        truck.vanPickedUp === true;
      
      // Normalize owner name to prevent duplicates (e.g., "Oscar S." vs "Oscar S")
      const owner = isFinalActioned 
        ? "Final Actioned" 
        : normalizeOwnerName(truck.shsOwner);
      
      const ownerTrucks = grouped.get(owner) || [];
      ownerTrucks.push(truck);
      grouped.set(owner, ownerTrucks);
    });
    
    // Sort each owner's trucks by date in repair (earliest first)
    grouped.forEach((ownerTrucks, owner) => {
      ownerTrucks.sort((a, b) => {
        const dateA = a.datePutInRepair ? new Date(a.datePutInRepair).getTime() : Infinity;
        const dateB = b.datePutInRepair ? new Date(b.datePutInRepair).getTime() : Infinity;
        return dateA - dateB;
      });
      grouped.set(owner, ownerTrucks);
    });
    
    return grouped;
  }, [trucks]);

  // Calculate main status counts per owner
  const statusCountsByOwner = useMemo(() => {
    const countsByOwner = new Map<string, Map<string, number>>();
    
    trucksByOwner.forEach((ownerTrucks, ownerName) => {
      const statusCounts = new Map<string, number>();
      
      ownerTrucks.forEach(truck => {
        const mainStatus = truck.mainStatus || "Unknown";
        statusCounts.set(mainStatus, (statusCounts.get(mainStatus) || 0) + 1);
      });
      
      countsByOwner.set(ownerName, statusCounts);
    });
    
    return countsByOwner;
  }, [trucksByOwner]);

  // Get all unique owner names with trucks (for rendering cards)
  const allOwners = useMemo(() => {
    const ownersWithTrucks: { name: string; count: number; info: OwnerInfo | null; statusCounts: Map<string, number> }[] = [];
    
    trucksByOwner.forEach((ownerTrucks, ownerName) => {
      if (ownerTrucks.length > 0) {
        const predefinedInfo = OWNERS.find(o => o.name === ownerName) || null;
        const statusCounts = statusCountsByOwner.get(ownerName) || new Map();
        ownersWithTrucks.push({
          name: ownerName,
          count: ownerTrucks.length,
          info: predefinedInfo,
          statusCounts
        });
      }
    });
    
    // Sort: predefined owners first (in their defined order), then dynamic owners alphabetically
    ownersWithTrucks.sort((a, b) => {
      const aIndex = OWNERS.findIndex(o => o.name === a.name);
      const bIndex = OWNERS.findIndex(o => o.name === b.name);
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
    
    return ownersWithTrucks;
  }, [trucksByOwner, statusCountsByOwner]);

  // Get trucks for selected owner with filters applied
  // Filter directly by shsOwner field to show ALL records for that owner
  const selectedTrucks = useMemo(() => {
    if (!selectedOwner || !trucks) return [];
    
    // Special case: "Final Actioned" uses rule-based logic
    if (selectedOwner === "Final Actioned") {
      const finalActionedTrucks = trucks.filter(truck => 
        truck.mainStatus === "On Road" ||
        (truck.mainStatus === "Declined Repair" && truck.subStatus === "Vehicle was sold") ||
        truck.vanPickedUp === true
      );
      
      // Apply additional filters if active
      return finalActionedTrucks.filter(truck => {
        for (const config of FILTER_CONFIGS) {
          const filterValue = filters[config.field];
          if (filterValue === "all") continue;
          const truckValue = config.getValue(truck);
          if (truckValue !== filterValue) return false;
        }
        return true;
      });
    }
    
    // For all other owners: filter by shsOwner field directly
    // This shows ALL records for the owner regardless of status
    const ownerTrucks = trucks.filter(truck => {
      const normalizedTruckOwner = normalizeOwnerName(truck.shsOwner);
      return normalizedTruckOwner === selectedOwner;
    });
    
    // Sort by date in repair (earliest first)
    ownerTrucks.sort((a, b) => {
      const dateA = a.datePutInRepair ? new Date(a.datePutInRepair).getTime() : Infinity;
      const dateB = b.datePutInRepair ? new Date(b.datePutInRepair).getTime() : Infinity;
      return dateA - dateB;
    });
    
    // Apply additional filters if active
    return ownerTrucks.filter(truck => {
      for (const config of FILTER_CONFIGS) {
        const filterValue = filters[config.field];
        if (filterValue === "all") continue;
        const truckValue = config.getValue(truck);
        if (truckValue !== filterValue) return false;
      }
      return true;
    });
  }, [selectedOwner, trucks, filters]);

  // Calculate filter counts for each field - counts for each distinct value
  // Uses same logic as selectedTrucks - filter by shsOwner directly
  const filterCounts = useMemo(() => {
    if (!selectedOwner || !trucks) return null;
    
    // Get owner trucks using same logic as selectedTrucks
    let ownerTrucks: Truck[];
    if (selectedOwner === "Final Actioned") {
      ownerTrucks = trucks.filter(truck => 
        truck.mainStatus === "On Road" ||
        (truck.mainStatus === "Declined Repair" && truck.subStatus === "Vehicle was sold") ||
        truck.vanPickedUp === true
      );
    } else {
      ownerTrucks = trucks.filter(truck => {
        const normalizedTruckOwner = normalizeOwnerName(truck.shsOwner);
        return normalizedTruckOwner === selectedOwner;
      });
    }
    
    // Helper to check if a truck matches all OTHER filters (excluding the specified field)
    const matchesOtherFilters = (truck: Truck, excludeField: FilterField) => {
      for (const config of FILTER_CONFIGS) {
        if (config.field === excludeField) continue;
        const filterValue = filters[config.field];
        if (filterValue === "all") continue;
        
        const truckValue = config.getValue(truck);
        if (truckValue !== filterValue) return false;
      }
      return true;
    };
    
    // Initialize counts for each field with all its possible values
    const counts: Record<FilterField, Record<string, number>> = {} as any;
    for (const config of FILTER_CONFIGS) {
      counts[config.field] = {};
      for (const option of config.options) {
        counts[config.field][option.value] = 0;
      }
    }
    
    // Count trucks that match other filters for each field's values
    ownerTrucks.forEach(truck => {
      for (const config of FILTER_CONFIGS) {
        if (!matchesOtherFilters(truck, config.field)) continue;
        
        const truckValue = config.getValue(truck);
        if (counts[config.field][truckValue] !== undefined) {
          counts[config.field][truckValue]++;
        }
      }
    });
    
    return counts;
  }, [selectedOwner, trucks, filters]);

  if (isLoading) {
    return (
      <div className="bg-background">
        <main className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load trucks: {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-6" data-testid="text-page-title">Action Tracker</h1>
        <div className="mb-8 flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            <span className="font-medium">{trucks?.length || 0} Total Vehicles</span>
          </div>
          <div className="flex items-center gap-2">
            <TruckIcon className="w-5 h-5" />
            <span>
              {(trucks?.length || 0) - (trucksByOwner.get("Final Actioned")?.length || 0)} Active
            </span>
          </div>
        </div>

        {/* Owner Cards Grid - Shows all owners with trucks (from actual shsOwner values) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {allOwners.map((ownerData) => {
            const { name, count, info } = ownerData;
            const Icon = info?.icon || User;
            const isSelected = selectedOwner === name;
            const colorClass = info?.colorClass || "text-gray-600";
            const bgClass = info?.bgClass || "bg-gray-50 hover:bg-gray-100";
            const borderClass = info?.borderClass || "border-gray-200";
            const description = info?.description || "Assigned vehicles";
            
            // Get status breakdown sorted by MAIN_STATUSES order
            const statusBreakdown = Array.from(ownerData.statusCounts.entries())
              .sort((a, b) => {
                const aIndex = MAIN_STATUSES.indexOf(a[0] as any);
                const bIndex = MAIN_STATUSES.indexOf(b[0] as any);
                if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0]);
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
              });

            return (
              <Card
                key={name}
                className={`cursor-pointer transition-all duration-200 ${bgClass} ${borderClass} border-2 ${
                  isSelected ? "ring-2 ring-offset-2 ring-primary shadow-lg" : "hover:shadow-md"
                }`}
                onClick={() => handleOwnerSelect(isSelected ? null : name)}
                data-testid={`card-owner-${name.toLowerCase().replace(/\s+/g, "-").replace(/\./g, "")}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${colorClass} bg-white/50`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <CardTitle className={`text-lg ${colorClass}`}>{name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${colorClass}`} data-testid={`count-${name.toLowerCase().replace(/\s+/g, "-").replace(/\./g, "")}`}>
                        {count}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {count === 1 ? "vehicle" : "vehicles"}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {statusBreakdown.map(([status, statusCount]) => (
                      <div 
                        key={status} 
                        className="flex items-center gap-1"
                        data-testid={`status-count-${name.toLowerCase().replace(/\s+/g, "-").replace(/\./g, "")}-${status.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <span className="text-muted-foreground">{status}:</span>
                        <span className={`font-semibold ${colorClass}`}>{statusCount}</span>
                      </div>
                    ))}
                  </div>
                  {isSelected && (
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      Viewing
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Roles & Responsibilities */}
        <Card className="mb-8" data-testid="card-roles-responsibilities">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5" />
              Roles & Responsibilities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2 mb-2">
                  <Wrench className="w-4 h-4 text-amber-600" />
                  <span className="font-semibold text-amber-700">Oscar S</span>
                </div>
                <p className="text-xs text-amber-600 mb-2">Confirming Status, Decision Pending, Repairing, In Transit</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Research vehicle location/status</li>
                  <li>Track Holman research requests</li>
                  <li>Follow up with shops for estimates</li>
                  <li>Coordinate repairs at shop</li>
                  <li>Monitor repair progress</li>
                  <li>Track vehicle transport</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardList className="w-4 h-4 text-purple-600" />
                  <span className="font-semibold text-purple-700">Rob A</span>
                </div>
                <p className="text-xs text-purple-600 mb-2">Decision Pending (Estimate received)</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Review repair estimates</li>
                  <li>Run PO through GPT for decision</li>
                  <li>Approve or decline repairs</li>
                  <li>Make repair vs. sale decisions</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-orange-50 border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-orange-600" />
                  <span className="font-semibold text-orange-700">Bob B</span>
                </div>
                <p className="text-xs text-orange-600 mb-2">Declined Repair, PMF</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Process vehicle decommission</li>
                  <li>Prep vehicles for sale</li>
                  <li>Manage PMF transfers & work</li>
                  <li>Coordinate redeployment</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-blue-700">John C</span>
                </div>
                <p className="text-xs text-blue-600 mb-2">Tags</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Process tag/registration</li>
                  <li>Handle registration renewals</li>
                  <li>Manage expired tags</li>
                  <li>Track renewal progress</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-green-600" />
                  <span className="font-semibold text-green-700">Mandy R</span>
                </div>
                <p className="text-xs text-green-600 mb-2">Scheduling</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Schedule tech pickup slots</li>
                  <li>Coordinate with technicians</li>
                  <li>Manage pickup logistics</li>
                  <li>Track awaiting pickups</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-gray-600" />
                  <span className="font-semibold text-gray-700">Final Actioned</span>
                </div>
                <p className="text-xs text-gray-600 mb-2">On Road, Vehicle was sold</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>Delivered to technician</li>
                  <li>Vehicle was sold</li>
                  <li>Case closed - no further action</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selected Owner's Truck List */}
        {selectedOwner && (
          <Card className="overflow-hidden" data-testid="panel-truck-list">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between mb-3">
                <CardTitle className="flex items-center gap-2">
                  <TruckIcon className="w-5 h-5" />
                  {selectedOwner}'s Vehicles ({selectedTrucks.length})
                </CardTitle>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => handleOwnerSelect(null)}
                  data-testid="button-close-list"
                >
                  Close
                </Button>
              </div>
              
              {/* Filter Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filter:</span>
                </div>
                {FILTER_CONFIGS.map((config) => {
                  const filterValue = filters[config.field];
                  const isActive = filterValue !== "all";
                  const counts = filterCounts?.[config.field];
                  const selectedOption = config.options.find(o => o.value === filterValue);
                  
                  return (
                    <Button
                      key={config.field}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilter(config.field)}
                      className={`text-xs h-7 px-2 ${isActive && selectedOption ? selectedOption.color + " text-white" : ""}`}
                      data-testid={`filter-${config.field}`}
                    >
                      {config.label}
                      {filterValue === "all" && counts && (
                        <span className="ml-1.5 text-[10px] opacity-70">
                          ({config.options.map(o => counts[o.value] || 0).join("/")})
                        </span>
                      )}
                      {isActive && selectedOption && (
                        <span className="ml-1.5 font-bold">
                          = {selectedOption.shortLabel} <span className="font-normal text-[10px]">({counts?.[filterValue] || 0})</span>
                        </span>
                      )}
                    </Button>
                  );
                })}
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                    data-testid="button-clear-filters"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {selectedTrucks.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {hasActiveFilters ? (
                    <>
                      <Filter className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <p>No vehicles match the current filters</p>
                      <Button 
                        variant="ghost" 
                        onClick={clearAllFilters}
                        className="mt-2 text-primary underline-offset-4 hover:underline"
                        data-testid="button-clear-filters-empty"
                      >
                        Clear all filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <p>No vehicles currently assigned to {selectedOwner}</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="overflow-auto max-h-[calc(100vh-24rem)]">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-background">
                      <TableRow className="bg-muted/80 dark:bg-muted/50 border-b-2 border-border shadow-sm">
                        <TableHead className="w-[100px] font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50">Truck #</TableHead>
                        <TableHead className="font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50">Status</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Registration Sticker Valid">Reg. Sticker</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50">Completed</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="AMS Documented">AMS</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Registration Renewal In Process">Reg. Renewal</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Pick Up Slot Booked">Pick Up Slot Booked</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Rental Returned">Rental Returned</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Van Picked Up">Van Picked Up</TableHead>
                        <TableHead className="text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50" title="Spare Van Assignment In Process">Spare Van</TableHead>
                        <TableHead className="font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50">Next Action</TableHead>
                        <TableHead className="w-[80px] text-center font-semibold sticky top-0 bg-muted/80 dark:bg-muted/50">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedTrucks.map((truck, index) => (
                        <TableRow 
                          key={truck.id} 
                          className="hover:bg-muted/30"
                          data-testid={`row-truck-${truck.truckNumber}`}
                        >
                          <TableCell className="font-mono font-medium">
                            {truck.truckNumber}
                          </TableCell>
                          {/* Status column with inline editing */}
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Select
                                value={truck.mainStatus || ""}
                                onValueChange={(value) => handleStatusChange(truck.id, value, truck.subStatus)}
                              >
                                <SelectTrigger className="h-auto p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 [&>svg]:hidden" data-testid={`select-status-${index}`}>
                                  <StatusBadge 
                                    status={getCombinedStatus(truck.mainStatus || "", truck.subStatus)}
                                    mainStatus={truck.mainStatus}
                                    subStatus={truck.subStatus}
                                    showSubStatusOnly={false}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {MAIN_STATUSES.map((status) => (
                                    <SelectItem key={status} value={status}>{status}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {truck.mainStatus && SUB_STATUSES[truck.mainStatus as MainStatus]?.length > 0 && (
                                <div className="relative">
                                  <StatusReminder 
                                    show={shouldShowReminder(truck.id)} 
                                    onDismiss={() => hideReminder(truck.id)}
                                    position="top"
                                  />
                                  <Select
                                    value={truck.subStatus || "_none_"}
                                    onValueChange={(value) => handleSubStatusChange(truck.id, truck.mainStatus || "", value)}
                                  >
                                    <SelectTrigger className="h-6 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto max-w-[180px] [&>svg]:hidden" data-testid={`select-substatus-${index}`}>
                                      <SelectValue>{truck.subStatus || "No sub-status"}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_none_">No sub-status</SelectItem>
                                      {SUB_STATUSES[truck.mainStatus as MainStatus]?.map((sub) => (
                                        <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              {/* Show reminder even if no sub-statuses available */}
                              {(!truck.mainStatus || !SUB_STATUSES[truck.mainStatus as MainStatus]?.length) && (
                                <StatusReminder 
                                  show={shouldShowReminder(truck.id)} 
                                  onDismiss={() => hideReminder(truck.id)}
                                  position="top"
                                />
                              )}
                            </div>
                          </TableCell>
                          {/* Reg. Sticker */}
                          <TableCell className="text-center" data-testid={`text-reg-sticker-${index}`}>
                            <Select
                              value={truck.registrationStickerValid || "_blank_"}
                              onValueChange={(value) => handleSelectChange(truck.id, "registrationStickerValid", value)}
                            >
                              <SelectTrigger className="h-7 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto min-w-[60px] [&>svg]:hidden" data-testid={`select-reg-sticker-${index}`}>
                                <SelectValue>{truck.registrationStickerValid || "—"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="Yes">Yes</SelectItem>
                                <SelectItem value="Expired">Expired</SelectItem>
                                <SelectItem value="Shop would not check">Shop would not check</SelectItem>
                                <SelectItem value="Mailed Tag">Mailed Tag</SelectItem>
                                <SelectItem value="Contacted tech">Contacted tech</SelectItem>
                                <SelectItem value="Ordered duplicates">Ordered duplicates</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Completed */}
                          <TableCell className="text-center" data-testid={`text-completed-${index}`}>
                            <Select
                              value={truck.repairCompleted === true ? "true" : truck.repairCompleted === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "repairCompleted", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-completed-${index}`}>
                                {truck.repairCompleted === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* AMS */}
                          <TableCell className="text-center" data-testid={`text-ams-${index}`}>
                            <Select
                              value={truck.inAms === true ? "true" : truck.inAms === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "inAms", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-ams-${index}`}>
                                {truck.inAms === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Reg. Renewal */}
                          <TableCell className="text-center" data-testid={`text-reg-renewal-${index}`}>
                            <Select
                              value={truck.registrationRenewalInProcess === true ? "true" : truck.registrationRenewalInProcess === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "registrationRenewalInProcess", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-reg-renewal-${index}`}>
                                {truck.registrationRenewalInProcess === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Pick Up Slot Booked */}
                          <TableCell className="text-center" data-testid={`text-pickup-slot-${index}`}>
                            <Select
                              value={truck.pickUpSlotBooked === true ? "true" : truck.pickUpSlotBooked === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "pickUpSlotBooked", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-pickup-slot-${index}`}>
                                {truck.pickUpSlotBooked === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Rental Returned */}
                          <TableCell className="text-center" data-testid={`text-rental-returned-${index}`}>
                            <Select
                              value={truck.rentalReturned === true ? "true" : truck.rentalReturned === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "rentalReturned", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-rental-returned-${index}`}>
                                {truck.rentalReturned === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Van Picked Up */}
                          <TableCell className="text-center" data-testid={`text-van-picked-up-${index}`}>
                            <Select
                              value={truck.vanPickedUp === true ? "true" : truck.vanPickedUp === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "vanPickedUp", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-van-picked-up-${index}`}>
                                {truck.vanPickedUp === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Spare Van */}
                          <TableCell className="text-center" data-testid={`text-spare-van-${index}`}>
                            <Select
                              value={truck.spareVanAssignmentInProcess === true ? "true" : truck.spareVanAssignmentInProcess === false ? "false" : "_blank_"}
                              onValueChange={(value) => handleBooleanChange(truck.id, "spareVanAssignmentInProcess", value)}
                            >
                              <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-spare-van-${index}`}>
                                {truck.spareVanAssignmentInProcess === true ? (
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold pt-px">Y</span>
                                ) : (
                                  <span className="text-muted-foreground">&nbsp;</span>
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_blank_">—</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {/* Next Action */}
                          <TableCell className="text-sm">
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                              {getNextAction(truck)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Link href={`/trucks/${truck.id}?from=action-tracker`}>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                data-testid={`button-view-${truck.truckNumber}`}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Instructions when no owner selected */}
        {!selectedOwner && (
          <div className="text-center text-muted-foreground py-8">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Click on an owner card above to see their assigned vehicles</p>
            <p className="text-sm mt-2">Each vehicle is assigned to exactly one owner based on its current status</p>
          </div>
        )}
      </main>
    </div>
  );
}
