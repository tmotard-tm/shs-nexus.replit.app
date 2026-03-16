import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RegConversations } from "@/components/fleet-scope/RegConversations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Search, 
  RefreshCw, 
  Download,
  FileSpreadsheet,
  ClipboardPaste,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  AlertCircle,
  CheckCircle2,
  Clock,
  TruckIcon,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Send,
  CalendarCheck,
  Building2,
  PackageCheck,
} from "lucide-react";
import * as XLSX from "xlsx";

const DISTRICT_OWNER_MAP: Record<string, string> = {
  '3132': 'Rob',
  '3580': 'Cheryl',
  '4766': 'Rob',
  '6141': 'Cheryl',
  '7084': 'Rob',
  '7088': 'Carol',
  '7108': 'Carol',
  '7323': 'Cheryl',
  '7435': 'Rob',
  '7670': 'Rob',
  '7744': 'Rob',
  '7983': 'Rob',
  '7995': 'Carol',
  '8035': 'Rob',
  '8096': 'Cheryl',
  '8107': 'Carol',
  '8147': 'Carol',
  '8158': 'Carol',
  '8162': 'Cheryl',
  '8169': 'Carol',
  '8175': 'Rob',
  '8184': 'Carol',
  '8206': 'Cheryl',
  '8220': 'Cheryl',
  '8228': 'Carol',
  '8309': 'Cheryl',
  '8366': 'Carol',
  '8380': 'Rob',
  '8420': 'Cheryl',
  '8555': 'Cheryl',
  '8935': 'Cheryl',
};

function getOwnerFromDistrict(district: string): string {
  if (!district) return '-';
  const last4 = district.slice(-4);
  return DISTRICT_OWNER_MAP[last4] || '-';
}

interface RegistrationTruck {
  truckNumber: string;
  tagState: string;
  district: string;
  assignmentStatus: 'Assigned' | 'Unassigned';
  regExpDate: string;
  state: string;
  ldap: string;
  techName: string;
  techPhone: string;
  techAddress: string;
  initialTextSent: boolean;
  timeSlotConfirmed: boolean;
  timeSlotValue: string;
  submittedToHolman: boolean;
  submittedToHolmanAt: string | null;
  alreadySent: boolean;
  comments: string;
  techLeadName: string;
  techLeadPhone: string;
  inRepairShop: boolean;
}

interface RegistrationResponse {
  trucks: RegistrationTruck[];
  declinedTrucks: string[];
  summary: {
    total: number;
    assigned: number;
    unassigned: number;
  };
}

// Declined repair vehicles - normalized to 6-digit format with leading zeros
const DECLINED_TRUCKS = new Set([
  '006611', '021526', '021547', '023150', '023254', '023796', '023966', '036023', '036031', '036040',
  '036185', '036568', '036597', '036605', '036606', '036770', '036845', '036902', '036988', '037032',
  '046153', '046307', '046313', '046371', '046528', '046546', '046643', '046748', '046838', '046873',
  '046957', '046961', '046972', '046976', '047078', '047091', '047135', '047154', '047163', '047209',
  '047252', '047280', '047315', '061100', '061192', '061208', '061212', '061257', '061306', '061360',
  '061370', '061432', '061462', '061564', '061607', '061679', '061688', '061755', '061784', '061865',
  '061544', '022360', '023282', '061307', '061786', '047075', '046453', '246091', '021148', '046159',
  '037139', '061687', '061475', '061272', '047344', '046136', '061465', '036674', '061265', '061603',
  '046866', '021705', '036667', '022380', '061546', '061569', '021704', '037125', '021537', '061137',
  '061768', '036628', '061311', '037002', '036464', '047287', '022090', '061849', '023780', '047079',
  '021696', '037041', '023004', '061578', '021380', '006588', '046658', '037256', '061629', '047169',
  '047037', '037082', '036345', '046716', '061823', '022391', '021190', '036676', '023170', '047087',
  '046990', '046880', '046502', '046245', '046106', '036269', '046551', '047291', '023823', '047052',
  '036096', '036024', '023302'
]);

export default function Registration() {
  const [activeView, setActiveView] = useState<"table" | "conversations">("table");
  const [convTruck, setConvTruck] = useState<string | null>(null);
  const [processFlowCollapsed, setProcessFlowCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [truckNumberFilter, setTruckNumberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Assigned" | "Unassigned">("all");
  const [ownerFilter, setOwnerFilter] = useState<"all" | string>("all");
  const [stateFilters, setStateFilters] = useState<Set<string> | null>(null); // null = all selected (initial state)
  const [tagStateFilters, setTagStateFilters] = useState<Set<string> | null>(null);
  const [expiryMonthFilter, setExpiryMonthFilter] = useState<string | null>(null);
  const [daysToExpirySort, setDaysToExpirySort] = useState<"none" | "asc" | "desc">("none");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pasteData, setPasteData] = useState("");
  const { toast } = useToast();

  // Refs for synchronized scrollbar
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const isScrollingSynced = useRef(false);

  // Sync scroll positions between top scrollbar and table
  const handleTopScroll = useCallback(() => {
    if (isScrollingSynced.current) return;
    isScrollingSynced.current = true;
    if (topScrollRef.current && tableContainerRef.current) {
      tableContainerRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => { isScrollingSynced.current = false; });
  }, []);

  const handleTableScroll = useCallback(() => {
    if (isScrollingSynced.current) return;
    isScrollingSynced.current = true;
    if (topScrollRef.current && tableContainerRef.current) {
      topScrollRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
    requestAnimationFrame(() => { isScrollingSynced.current = false; });
  }, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery<RegistrationResponse>({
    queryKey: ["/api/fs/registration"],
  });

  const { data: pmfStickersData } = useQuery<{ success: boolean; assetIds: string[] }>({
    queryKey: ["/api/fs/pmf/registration-stickers-needed"],
  });

  const pmfStickerAssetIds = useMemo(() => {
    if (!pmfStickersData?.assetIds) return new Set<string>();
    return new Set(pmfStickersData.assetIds.map(id => String(id)));
  }, [pmfStickersData]);

  const isPmfStickersNeeded = (truckNumber: string): boolean => {
    const assetId = truckNumber.replace(/^0+/, '');
    return pmfStickerAssetIds.has(assetId);
  };

  // Update scroll width when table content changes
  useEffect(() => {
    const updateScrollWidth = () => {
      if (tableContainerRef.current) {
        setScrollWidth(tableContainerRef.current.scrollWidth);
      }
    };
    updateScrollWidth();
    const resizeObserver = new ResizeObserver(updateScrollWidth);
    if (tableContainerRef.current) {
      resizeObserver.observe(tableContainerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [data]);

  const importMutation = useMutation({
    mutationFn: async (data: string) => {
      const response = await apiRequest("POST", "/api/fs/registration/import", { data });
      return response.json();
    },
    onSuccess: (result) => {
      const parts = [];
      if (result.updated > 0) parts.push(`Updated ${result.updated}`);
      if (result.created > 0) parts.push(`Created ${result.created}`);
      if (result.skipped > 0) parts.push(`Skipped ${result.skipped} (already have dates)`);
      toast({
        title: "Import Complete",
        description: parts.join('. ') || 'No changes made',
      });
      setImportDialogOpen(false);
      setPasteData("");
      queryClient.invalidateQueries({ queryKey: ["/api/fs/registration"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const trackingMutation = useMutation({
    mutationFn: async ({ truckNumber, ...data }: { truckNumber: string; initialTextSent?: boolean; timeSlotConfirmed?: boolean; timeSlotValue?: string; submittedToHolman?: boolean; alreadySent?: boolean; comments?: string }) => {
      const response = await apiRequest("PATCH", `/api/fs/registration/tracking/${truckNumber}`, data);
      return response.json();
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/fs/registration"] });
      const previousData = queryClient.getQueryData(["/api/fs/registration"]);
      queryClient.setQueryData(["/api/fs/registration"], (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((truck: any) => {
          if (truck.truckNumber === variables.truckNumber) {
            const updated = { ...truck };
            if (variables.initialTextSent !== undefined) updated.initialTextSent = variables.initialTextSent;
            if (variables.timeSlotConfirmed !== undefined) updated.timeSlotConfirmed = variables.timeSlotConfirmed;
            if (variables.timeSlotValue !== undefined) updated.timeSlotValue = variables.timeSlotValue;
            if (variables.submittedToHolman !== undefined) updated.submittedToHolman = variables.submittedToHolman;
            if (variables.alreadySent !== undefined) updated.alreadySent = variables.alreadySent;
            if (variables.comments !== undefined) updated.comments = variables.comments;
            return updated;
          }
          return truck;
        });
      });
      return { previousData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/registration"] });
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/fs/registration"], context.previousData);
      }
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Export to XLSX with two tabs
  const handleExportXlsx = () => {
    if (!filteredTrucks.length) {
      toast({
        title: "No Data",
        description: "No vehicles to export",
        variant: "destructive",
      });
      return;
    }

    // Separate trucks into two categories
    const repairShopTrucks = filteredTrucks.filter(t => t.inRepairShop);
    const otherParkingTrucks = filteredTrucks.filter(t => !t.inRepairShop);

    // Define columns for export
    const formatRow = (truck: RegistrationTruck) => ({
      'Truck #': truck.truckNumber,
      'Tag State': truck.tagState,
      'District': truck.district,
      'Owner': getOwnerFromDistrict(truck.district),
      'Assignment Status': truck.assignmentStatus,
      'State': truck.state,
      'Reg Exp Date': truck.regExpDate,
      'Days to Expiry': calculateDaysToExpiry(truck.regExpDate) ?? '',
      'Initial Text Sent': truck.initialTextSent ? 'Yes' : 'No',
      'Time Slot Confirmed': truck.timeSlotConfirmed ? 'Yes' : 'No',
      'Time Slot': truck.timeSlotValue,
      'Submitted to Holman': truck.submittedToHolman ? 'Yes' : 'No',
      'Already Sent': truck.alreadySent ? 'Yes' : 'No',
      'PMF Filter': isPmfStickersNeeded(truck.truckNumber) ? 'Yes' : 'No',
      'LDAP': truck.ldap,
      'Tech Name': truck.techName,
      'Tech Phone': truck.techPhone,
      'Tech Address': truck.techAddress,
      'Tech Lead': truck.techLeadName,
      'Tech Lead Phone': truck.techLeadPhone,
      'Comments': truck.comments,
    });

    // Create workbook with two sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Other Parking Locations
    const otherParkingData = otherParkingTrucks.map(formatRow);
    const ws1 = XLSX.utils.json_to_sheet(otherParkingData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Other Parking Locations');

    // Sheet 2: In Repair Shops
    const repairShopData = repairShopTrucks.map(formatRow);
    const ws2 = XLSX.utils.json_to_sheet(repairShopData);
    XLSX.utils.book_append_sheet(wb, ws2, 'In Repair Shops');

    // Download
    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Registration_Export_${date}.xlsx`);

    toast({
      title: "Export Complete",
      description: `Exported ${otherParkingTrucks.length} other parking + ${repairShopTrucks.length} in repair shops`,
    });
  };

  // Calculate days until registration expiry
  const calculateDaysToExpiry = (regExpDate: string | null): number | null => {
    if (!regExpDate) return null;
    const expDate = new Date(regExpDate);
    if (isNaN(expDate.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expDate.setHours(0, 0, 0, 0);
    const diffTime = expDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Get unique states for filter dropdown
  const uniqueStates = useMemo(() => {
    if (!data?.trucks) return [];
    const states = new Set<string>();
    data.trucks.forEach(truck => {
      if (truck.state) {
        states.add(truck.state);
      }
    });
    return Array.from(states).sort();
  }, [data?.trucks]);

  const uniqueTagStates = useMemo(() => {
    if (!data?.trucks) return [];
    const states = new Set<string>();
    data.trucks.forEach(truck => {
      if (truck.tagState && truck.tagState.trim() !== "") {
        states.add(truck.tagState.trim());
      }
    });
    return Array.from(states).sort();
  }, [data?.trucks]);

  const filteredTrucks = useMemo(() => {
    if (!data?.trucks) return [];
    
    let result = data.trucks.filter(truck => {
      const matchesSearch = searchTerm === "" || 
        truck.truckNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        truck.techName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        truck.techPhone.includes(searchTerm) ||
        truck.techAddress.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Truck number filter (separate from general search)
      const matchesTruckNumber = truckNumberFilter === "" || 
        truck.truckNumber.toLowerCase().includes(truckNumberFilter.toLowerCase());
      
      const matchesStatus = statusFilter === "all" || truck.assignmentStatus === statusFilter;
      
      const matchesOwner = ownerFilter === "all" || getOwnerFromDistrict(truck.district) === ownerFilter;
      
      const matchesState = stateFilters === null || stateFilters.has(truck.state);
      const matchesTagState = tagStateFilters === null || tagStateFilters.has(truck.tagState?.trim() || "");
      
      // Filter out trucks starting with "088"
      if (truck.truckNumber.startsWith('088')) {
        return false;
      }
      
      // Filter by expiry month if selected
      let matchesExpiryMonth = true;
      if (expiryMonthFilter && truck.regExpDate) {
        const expDate = new Date(truck.regExpDate);
        if (!isNaN(expDate.getTime())) {
          // Special handling for January 2026: show trucks with ALREADY expired registrations
          if (expiryMonthFilter === '2026-01') {
            const jan2026Start = new Date(2026, 0, 1);
            matchesExpiryMonth = expDate < jan2026Start;
          } else {
            const truckMonthKey = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}`;
            matchesExpiryMonth = truckMonthKey === expiryMonthFilter;
          }
        }
      } else if (expiryMonthFilter && !truck.regExpDate) {
        matchesExpiryMonth = false;
      }
      
      return matchesSearch && matchesTruckNumber && matchesStatus && matchesOwner && matchesState && matchesTagState && matchesExpiryMonth;
    });
    
    // Apply Days to Expiry sort
    if (daysToExpirySort !== "none") {
      result = [...result].sort((a, b) => {
        const daysA = calculateDaysToExpiry(a.regExpDate);
        const daysB = calculateDaysToExpiry(b.regExpDate);
        
        // Handle nulls - push them to the end
        if (daysA === null && daysB === null) return 0;
        if (daysA === null) return 1;
        if (daysB === null) return -1;
        
        return daysToExpirySort === "asc" ? daysA - daysB : daysB - daysA;
      });
    }
    
    return result;
  }, [data?.trucks, searchTerm, truckNumberFilter, statusFilter, ownerFilter, stateFilters, tagStateFilters, expiryMonthFilter, daysToExpirySort]);

  const toggleStateFilter = (state: string, allStates: string[]) => {
    setStateFilters(prev => {
      // If null (all selected), create set with all states except the one being toggled off
      if (prev === null) {
        const next = new Set(allStates);
        next.delete(state);
        return next;
      }
      
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  const selectAllStates = () => {
    setStateFilters(null); // null means all selected
  };
  
  const clearStateFilters = () => {
    setStateFilters(new Set());
  };

  const toggleTagStateFilter = (state: string, allStates: string[]) => {
    setTagStateFilters(prev => {
      if (prev === null) {
        const next = new Set(allStates);
        next.delete(state);
        return next;
      }
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  const selectAllTagStates = () => {
    setTagStateFilters(null);
  };

  const clearTagStateFilters = () => {
    setTagStateFilters(new Set());
  };

  // Calculate monthly expiry counts for assigned trucks
  const monthlyExpiryCounts = useMemo(() => {
    if (!data?.trucks) return [];
    
    const counts: Record<string, number> = {};
    const today = new Date();
    
    // Special handling for January 2026: count trucks with ALREADY expired registrations
    const jan2026Start = new Date(2026, 0, 1); // January 1, 2026
    const jan2026Key = '2026-01';
    let jan2026ExpiredCount = 0;
    
    data.trucks
      .filter(truck => truck.assignmentStatus === 'Assigned' && truck.regExpDate && !truck.truckNumber.startsWith('088'))
      .forEach(truck => {
        const expDate = new Date(truck.regExpDate);
        if (!isNaN(expDate.getTime())) {
          // For January 2026, count trucks that expired BEFORE January 2026
          if (expDate < jan2026Start) {
            jan2026ExpiredCount++;
          }
          // Regular counting for other months
          const monthKey = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}`;
          counts[monthKey] = (counts[monthKey] || 0) + 1;
        }
      });
    
    // Override January 2026 with already-expired count
    counts[jan2026Key] = jan2026ExpiredCount;
    
    // Get current month start and 12 months ahead
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const twelveMonthsAhead = new Date(today.getFullYear(), today.getMonth() + 12, 1);
    
    // Sort by date - include all past months with data, plus up to 12 months ahead
    const sortedMonths = Object.entries(counts)
      .filter(([_, count]) => count > 0) // Only include months with trucks
      .map(([key, count]) => {
        const [year, month] = key.split('-').map(Number);
        const date = new Date(year, month - 1, 1);
        const isJan2026 = key === jan2026Key;
        return {
          key,
          count,
          date,
          label: isJan2026 ? 'Jan 2026 (Expired)' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          isPast: date < currentMonthStart,
          isCurrent: date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth(),
          isExpiredCount: isJan2026, // Flag to indicate this is an "already expired" count
        };
      })
      .filter(month => month.date <= twelveMonthsAhead) // Only limit future months, keep all past months
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    
    return sortedMonths;
  }, [data?.trucks]);

  const processFlowData = useMemo(() => {
    if (!data?.trucks) return [];

    const assignedTrucks = data.trucks.filter(
      truck => truck.assignmentStatus === 'Assigned' && truck.regExpDate && !truck.truckNumber.startsWith('088')
    );

    const monthBuckets: Record<string, {
      label: string;
      total: number;
      initialTextSent: number;
      timeSlotConfirmed: number;
      submittedToHolman: number;
      alreadySent: number;
      date: Date;
    }> = {};

    const today = new Date();
    const jan2026Start = new Date(2026, 0, 1);

    assignedTrucks.forEach(truck => {
      const expDate = new Date(truck.regExpDate);
      if (isNaN(expDate.getTime())) return;

      let monthKey: string;
      let label: string;
      if (expDate < jan2026Start) {
        monthKey = '2026-01';
        label = 'Jan 2026 (Expired)';
      } else {
        monthKey = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}`;
        label = expDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }

      if (!monthBuckets[monthKey]) {
        monthBuckets[monthKey] = { label, total: 0, initialTextSent: 0, timeSlotConfirmed: 0, submittedToHolman: 0, alreadySent: 0, date: expDate < jan2026Start ? jan2026Start : new Date(expDate.getFullYear(), expDate.getMonth(), 1) };
      }

      const bucket = monthBuckets[monthKey];
      bucket.total++;

      const implicitlyDone = truck.alreadySent || truck.submittedToHolman;

      if (truck.initialTextSent || implicitlyDone) bucket.initialTextSent++;
      if (truck.timeSlotConfirmed || implicitlyDone) bucket.timeSlotConfirmed++;
      if (truck.submittedToHolman || truck.alreadySent) bucket.submittedToHolman++;
      if (truck.alreadySent) bucket.alreadySent++;
    });

    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const twelveMonthsAhead = new Date(today.getFullYear(), today.getMonth() + 12, 1);

    return Object.entries(monthBuckets)
      .filter(([_, b]) => b.total > 0)
      .map(([key, b]) => ({ key, ...b }))
      .filter(b => b.date <= twelveMonthsAhead)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [data?.trucks]);

  const riskSummary = useMemo(() => {
    if (!data?.trucks) return {
      total: 0,
      expired: { assigned: 0, unassigned: 0 },
      expiringSoon: { assigned: 0, unassigned: 0 },
      upToDate: { assigned: 0, unassigned: 0 },
      noDate: { assigned: 0, unassigned: 0 },
    };
    const expired = { assigned: 0, unassigned: 0 };
    const expiringSoon = { assigned: 0, unassigned: 0 };
    const upToDate = { assigned: 0, unassigned: 0 };
    const noDate = { assigned: 0, unassigned: 0 };
    const trucks = data.trucks.filter(t => !t.truckNumber.startsWith('088'));
    for (const t of trucks) {
      const key = t.assignmentStatus === 'Assigned' ? 'assigned' : 'unassigned';
      const days = calculateDaysToExpiry(t.regExpDate);
      if (days === null) { noDate[key]++; }
      else if (days < 0) { expired[key]++; }
      else if (days <= 30) { expiringSoon[key]++; }
      else { upToDate[key]++; }
    }
    return { total: trucks.length, expired, expiringSoon, upToDate, noDate };
  }, [data?.trucks]);

  const handleExport = () => {
    if (!filteredTrucks.length) return;

    const exportData = filteredTrucks.map(truck => {
      const daysToExpiry = calculateDaysToExpiry(truck.regExpDate);
      return {
        'Truck Number': truck.truckNumber,
        'Assignment Status': truck.assignmentStatus,
        'State': truck.state || '',
        'Reg. Exp. Date': truck.regExpDate || '',
        'Days to Expiry': daysToExpiry !== null ? daysToExpiry : '',
        'Tech Name': truck.techName,
        'Tech Phone': truck.techPhone,
        'Tech Address': truck.techAddress
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Registration");
    XLSX.writeFile(workbook, `registration_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="p-6">
            <p className="text-destructive">Error loading registration data: {(error as Error).message}</p>
            <Button onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Registration</h1>
          {/* View toggle */}
          <div className="flex items-center border rounded-md overflow-hidden">
            <Button
              variant={activeView === "table" ? "default" : "ghost"}
              size="sm"
              onClick={() => { setActiveView("table"); setConvTruck(null); }}
              className="rounded-none border-0"
              data-testid="button-view-table"
            >
              <TruckIcon className="w-3.5 h-3.5 mr-1.5" />
              Vehicles Table
            </Button>
            <Button
              variant={activeView === "conversations" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveView("conversations")}
              className="rounded-none border-0 border-l"
              data-testid="button-view-conversations"
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Conversations
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                data-testid="button-import-registration"
              >
                <ClipboardPaste className="w-4 h-4 mr-2" />
                Import Dates
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Registration Dates</DialogTitle>
                <DialogDescription>
                  Paste tab-separated data with Vehicle Number and Registration Renewal Date columns.
                  Dates should be in M/D/YYYY format. Missing dates will be populated for matching trucks.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                placeholder="Vehicle Number&#9;Registration Renewal Date&#10;61546&#9;3/31/2026&#10;46836&#9;10/31/2026"
                value={pasteData}
                onChange={(e) => setPasteData(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
                data-testid="textarea-paste-data"
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setImportDialogOpen(false);
                    setPasteData("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => importMutation.mutate(pasteData)}
                  disabled={!pasteData.trim() || importMutation.isPending}
                  data-testid="button-submit-import"
                >
                  {importMutation.isPending ? "Importing..." : "Import"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-registration"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!filteredTrucks.length}
            data-testid="button-export-registration"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Conversations view */}
      {activeView === "conversations" && (
        <RegConversations registrationData={data?.trucks || []} initialTruckNumber={convTruck ?? undefined} />
      )}

      {activeView === "table" && data?.trucks && data.trucks.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="registration-risk-cards">
          <Card className="p-3 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20" data-testid="card-reg-total">
            <div className="flex items-center gap-2 mb-1">
              <TruckIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Total Tracked</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{riskSummary.total}</p>
              <span className="text-[10px] text-blue-600/50 dark:text-blue-400/50 leading-tight">
                Raw AMS export incl. declined repairs/auction
              </span>
            </div>
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
              {data.summary?.assigned ?? 0} assigned
            </p>
          </Card>
          <Card className="p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20" data-testid="card-reg-expired">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-xs font-medium text-red-700 dark:text-red-300">Expired</span>
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{riskSummary.expired.assigned}</p>
            <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">assigned vehicles</p>
          </Card>
          <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="card-reg-expiring">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Expiring Soon</span>
            </div>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{riskSummary.expiringSoon.assigned}</p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">within 30 days</p>
          </Card>
          <Card className="p-3 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" data-testid="card-reg-valid">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-xs font-medium text-green-700 dark:text-green-300">Up to Date</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{riskSummary.upToDate.assigned}</p>
            <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-0.5">valid registration</p>
          </Card>
          <Card className="p-3 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20" data-testid="card-reg-nodate">
            <div className="flex items-center gap-2 mb-1">
              <FileSpreadsheet className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">No Date</span>
            </div>
            <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{riskSummary.noDate.assigned}</p>
            <p className="text-xs text-slate-600/70 dark:text-slate-400/70 mt-0.5">missing expiry data</p>
          </Card>
        </div>
      )}

      {/* Monthly Registration Expiry Scorecard */}
      {activeView === "table" && monthlyExpiryCounts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4" />
              Assigned Truck Registrations Expiring by Month
              {expiryMonthFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs ml-2"
                  onClick={() => setExpiryMonthFilter(null)}
                  data-testid="button-clear-month-filter"
                >
                  Clear Filter
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {monthlyExpiryCounts.map(month => (
                <div
                  key={month.key}
                  onClick={() => {
                    if (expiryMonthFilter === month.key) {
                      setExpiryMonthFilter(null);
                    } else {
                      setExpiryMonthFilter(month.key);
                      setStatusFilter("Assigned");
                    }
                  }}
                  className={`flex flex-col items-center p-3 rounded-lg border min-w-[90px] cursor-pointer transition-all ${
                    expiryMonthFilter === month.key
                      ? 'ring-2 ring-primary ring-offset-2 bg-primary/10 border-primary'
                      : month.isPast 
                        ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 hover:ring-1 hover:ring-red-400' 
                        : month.isCurrent 
                          ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 hover:ring-1 hover:ring-amber-400'
                          : 'bg-muted/50 hover:ring-1 hover:ring-muted-foreground/30'
                  }`}
                  data-testid={`scorecard-month-${month.key}`}
                >
                  <span className="text-xs text-muted-foreground">{month.label}</span>
                  <span className={`text-2xl font-bold ${
                    expiryMonthFilter === month.key
                      ? 'text-primary'
                      : month.isPast 
                        ? 'text-red-600 dark:text-red-400' 
                        : month.isCurrent 
                          ? 'text-amber-600 dark:text-amber-400'
                          : ''
                  }`}>
                    {month.count}
                  </span>
                  {month.isPast && (
                    <Badge variant="destructive" className="text-xs mt-1">Overdue</Badge>
                  )}
                  {month.isCurrent && (
                    <Badge variant="secondary" className="text-xs mt-1 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">This Month</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeView === "table" && processFlowData.length > 0 && (
        <Card data-testid="process-flow-diagram">
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => setProcessFlowCollapsed(c => !c)}
            data-testid="button-toggle-process-flow"
          >
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <PackageCheck className="w-4 h-4" />
                Registration Renewal Process Flow
              </span>
              <ChevronDown
                className="w-4 h-4 text-muted-foreground transition-transform duration-200"
                style={{ transform: processFlowCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
              />
            </CardTitle>
            {!processFlowCollapsed && (
              <p className="text-xs text-muted-foreground mt-1">
                Assigned trucks expiring by month. If &quot;Already Sent&quot; or &quot;Submitted to Holman&quot; is checked, earlier steps are considered done.
              </p>
            )}
          </CardHeader>
          {!processFlowCollapsed && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="process-flow-table">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">Month</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">Total</th>
                    <th className="text-center py-2 px-1 w-6"></th>
                    <th className="text-center py-2 px-3 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-0.5">
                        <Send className="w-3.5 h-3.5 text-blue-500" />
                        <span className="font-medium text-muted-foreground">Initial Text</span>
                      </div>
                    </th>
                    <th className="text-center py-2 px-1 w-6"></th>
                    <th className="text-center py-2 px-3 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-0.5">
                        <CalendarCheck className="w-3.5 h-3.5 text-amber-500" />
                        <span className="font-medium text-muted-foreground">Time Slot</span>
                      </div>
                    </th>
                    <th className="text-center py-2 px-1 w-6"></th>
                    <th className="text-center py-2 px-3 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-0.5">
                        <Building2 className="w-3.5 h-3.5 text-purple-500" />
                        <span className="font-medium text-muted-foreground">Submitted to Holman</span>
                      </div>
                    </th>
                    <th className="text-center py-2 px-1 w-6"></th>
                    <th className="text-center py-2 px-3 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        <span className="font-medium text-muted-foreground">Already Sent</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processFlowData.map((month) => {
                    const pctInitial = month.total > 0 ? Math.round((month.initialTextSent / month.total) * 100) : 0;
                    const pctTimeSlot = month.total > 0 ? Math.round((month.timeSlotConfirmed / month.total) * 100) : 0;
                    const pctHolman = month.total > 0 ? Math.round((month.submittedToHolman / month.total) * 100) : 0;
                    const pctSent = month.total > 0 ? Math.round((month.alreadySent / month.total) * 100) : 0;

                    const barColor = (pct: number) =>
                      pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : pct > 0 ? 'bg-red-400' : 'bg-muted';

                    return (
                      <tr key={month.key} className="border-t" data-testid={`flow-row-${month.key}`}>
                        <td className="py-2.5 px-3 font-medium whitespace-nowrap">{month.label}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="font-bold text-base">{month.total}</span>
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-blue-600 dark:text-blue-400">{month.initialTextSent}<span className="text-xs text-muted-foreground font-normal">/{month.total}</span></span>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                              <div className={`h-full rounded-full transition-all ${barColor(pctInitial)}`} style={{ width: `${pctInitial}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{pctInitial}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-amber-600 dark:text-amber-400">{month.timeSlotConfirmed}<span className="text-xs text-muted-foreground font-normal">/{month.total}</span></span>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                              <div className={`h-full rounded-full transition-all ${barColor(pctTimeSlot)}`} style={{ width: `${pctTimeSlot}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{pctTimeSlot}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-purple-600 dark:text-purple-400">{month.submittedToHolman}<span className="text-xs text-muted-foreground font-normal">/{month.total}</span></span>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                              <div className={`h-full rounded-full transition-all ${barColor(pctHolman)}`} style={{ width: `${pctHolman}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{pctHolman}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-1 text-center">
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-green-600 dark:text-green-400">{month.alreadySent}<span className="text-xs text-muted-foreground font-normal">/{month.total}</span></span>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                              <div className={`h-full rounded-full transition-all ${barColor(pctSent)}`} style={{ width: `${pctSent}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{pctSent}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {activeView === "table" && <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Vehicle Registration
              {filteredTrucks.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {filteredTrucks.length.toLocaleString()} vehicles
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search truck, tech, phone, address..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full sm:w-[300px]"
                  data-testid="input-search-registration"
                />
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleExportXlsx}
                data-testid="button-export-registration"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Top scrollbar that syncs with table */}
              <div
                ref={topScrollRef}
                onScroll={handleTopScroll}
                className="overflow-x-auto overflow-y-hidden border border-b-0 rounded-t-md"
                style={{ height: '16px' }}
              >
                <div style={{ width: scrollWidth, height: '1px' }} />
              </div>
              <div 
                ref={tableContainerRef}
                onScroll={handleTableScroll}
                className="rounded-b-md border border-t-0 overflow-x-auto max-h-[600px]"
              >
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[120px]">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 p-0 font-medium hover:bg-muted/50"
                            data-testid="button-truck-header-filter"
                          >
                            <Filter className={`h-3 w-3 mr-1 ${truckNumberFilter ? "text-primary" : ""}`} />
                            <span>Truck #</span>
                            {truckNumberFilter && (
                              <Badge variant="secondary" className="ml-1 text-xs">1</Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="start">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <span className="text-sm font-medium">Filter by Truck #</span>
                              {truckNumberFilter && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setTruckNumberFilter("")}
                                  data-testid="button-clear-truck-filter"
                                >
                                  Clear
                                </Button>
                              )}
                            </div>
                            <Input
                              placeholder="Enter truck #..."
                              value={truckNumberFilter}
                              onChange={(e) => setTruckNumberFilter(e.target.value)}
                              className="h-8"
                              data-testid="input-truck-filter"
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="w-[120px]">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 p-0 font-medium hover:bg-muted/50"
                            data-testid="button-tag-state-header-filter"
                          >
                            <Filter className={`h-3 w-3 mr-1 ${tagStateFilters !== null && tagStateFilters.size < uniqueTagStates.length ? "text-primary" : ""}`} />
                            <span>Tag State</span>
                            {tagStateFilters !== null && tagStateFilters.size < uniqueTagStates.length && (
                              <Badge variant="secondary" className="ml-1 text-xs">
                                {tagStateFilters.size}/{uniqueTagStates.length}
                              </Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="start">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <span className="text-sm font-medium">Filter by Tag State</span>
                            </div>
                            <div className="max-h-[200px] overflow-y-auto space-y-1">
                              <label
                                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer border-b pb-1 mb-1"
                              >
                                <Checkbox
                                  checked={tagStateFilters === null || (tagStateFilters.size > 0 && tagStateFilters.size === uniqueTagStates.length)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      selectAllTagStates();
                                    } else {
                                      clearTagStateFilters();
                                    }
                                  }}
                                  data-testid="checkbox-select-all-tag-states"
                                />
                                <span className="text-sm font-medium">Select All</span>
                              </label>
                              {uniqueTagStates.map(state => (
                                <label
                                  key={state}
                                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer"
                                >
                                  <Checkbox
                                    checked={tagStateFilters === null || tagStateFilters.has(state)}
                                    onCheckedChange={() => toggleTagStateFilter(state, uniqueTagStates)}
                                    data-testid={`checkbox-tag-state-${state}`}
                                  />
                                  <span className="text-sm">{state}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="w-[100px]">District</TableHead>
                    <TableHead className="w-[160px]">
                      <Select
                        value={ownerFilter}
                        onValueChange={(value) => setOwnerFilter(value)}
                      >
                        <SelectTrigger className="h-8 border-0 bg-transparent p-0 font-medium hover:bg-muted/50" data-testid="select-owner-header-filter">
                          <div className="flex items-center gap-1">
                            <Filter className="h-3 w-3" />
                            <span>Owner</span>
                            {ownerFilter !== "all" && (
                              <Badge variant="secondary" className="ml-1 text-xs">{ownerFilter}</Badge>
                            )}
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Owners</SelectItem>
                          <SelectItem value="Rob">Rob</SelectItem>
                          <SelectItem value="Cheryl">Cheryl</SelectItem>
                          <SelectItem value="Carol">Carol</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="w-[140px]">
                      <Select
                        value={statusFilter}
                        onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
                      >
                        <SelectTrigger className="h-8 border-0 bg-transparent p-0 font-medium hover:bg-muted/50" data-testid="select-status-header-filter">
                          <div className="flex items-center gap-1">
                            <Filter className="h-3 w-3" />
                            <span>Status</span>
                            {statusFilter !== "all" && (
                              <Badge variant="secondary" className="ml-1 text-xs">{statusFilter}</Badge>
                            )}
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="Assigned">Assigned</SelectItem>
                          <SelectItem value="Unassigned">Unassigned</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                    <TableHead className="w-[120px]">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 p-0 font-medium hover:bg-muted/50"
                            data-testid="button-state-header-filter"
                          >
                            <Filter className={`h-3 w-3 mr-1 ${stateFilters !== null && stateFilters.size < uniqueStates.length ? "text-primary" : ""}`} />
                            <span>State</span>
                            {stateFilters !== null && stateFilters.size < uniqueStates.length && (
                              <Badge variant="secondary" className="ml-1 text-xs">
                                {stateFilters.size}/{uniqueStates.length}
                              </Badge>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="start">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between pb-2 border-b">
                              <span className="text-sm font-medium">Filter by State</span>
                            </div>
                            <div className="max-h-[200px] overflow-y-auto space-y-1">
                              <label
                                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer border-b pb-1 mb-1"
                              >
                                <Checkbox
                                  checked={stateFilters === null || (stateFilters.size > 0 && stateFilters.size === uniqueStates.length)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      selectAllStates();
                                    } else {
                                      clearStateFilters();
                                    }
                                  }}
                                  data-testid="checkbox-select-all-states"
                                />
                                <span className="text-sm font-medium">Select All</span>
                              </label>
                              {uniqueStates.map(state => (
                                <label
                                  key={state}
                                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer"
                                >
                                  <Checkbox
                                    checked={stateFilters === null || stateFilters.has(state)}
                                    onCheckedChange={() => toggleStateFilter(state, uniqueStates)}
                                    data-testid={`checkbox-state-${state}`}
                                  />
                                  <span className="text-sm">{state}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead className="w-[120px]">Reg. Exp. Date</TableHead>
                    <TableHead className="w-[140px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 p-0 font-medium hover:bg-muted/50"
                        onClick={() => {
                          if (daysToExpirySort === "none") setDaysToExpirySort("asc");
                          else if (daysToExpirySort === "asc") setDaysToExpirySort("desc");
                          else setDaysToExpirySort("none");
                        }}
                        data-testid="button-sort-days-expiry"
                      >
                        <span>Days to Expiry</span>
                        {daysToExpirySort === "none" && <ArrowUpDown className="ml-1 h-3 w-3" />}
                        {daysToExpirySort === "asc" && <ArrowUp className="ml-1 h-3 w-3" />}
                        {daysToExpirySort === "desc" && <ArrowDown className="ml-1 h-3 w-3" />}
                      </Button>
                    </TableHead>
                    <TableHead className="w-[100px] text-center">Initial Text Sent</TableHead>
                    <TableHead className="w-[180px]">Time Slot</TableHead>
                    <TableHead className="w-[120px] text-center">Submitted to Holman</TableHead>
                    <TableHead className="w-[100px] text-center">Already Sent</TableHead>
                    <TableHead className="w-[100px] text-center">PMF Filter</TableHead>
                    <TableHead className="w-[100px]">LDAP</TableHead>
                    <TableHead className="w-[200px]">Tech Name</TableHead>
                    <TableHead className="w-[150px]">Tech Phone</TableHead>
                    <TableHead>Tech Address</TableHead>
                    <TableHead className="w-[150px]">Tech Lead</TableHead>
                    <TableHead className="w-[150px]">Tech Lead Phone</TableHead>
                    <TableHead className="w-[350px]">Comments</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrucks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={18} className="text-center py-8 text-muted-foreground">
                        No trucks found matching your search
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTrucks.map((truck) => {
                      const daysToExpiry = calculateDaysToExpiry(truck.regExpDate);
                      return (
                        <TableRow key={truck.truckNumber} data-testid={`row-truck-${truck.truckNumber}`}>
                          <TableCell className="font-mono font-medium">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <button
                                  title="Open conversation"
                                  data-testid={`button-open-conv-${truck.truckNumber}`}
                                  onClick={(e) => { e.stopPropagation(); setConvTruck(truck.truckNumber); setActiveView("conversations"); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', flexShrink: 0, borderRadius: '4px', backgroundColor: 'rgb(219 234 254)', color: 'rgb(37 99 235)', cursor: 'pointer', border: 'none', padding: 0 }}
                                >
                                  <MessageSquare style={{ width: '13px', height: '13px' }} />
                                </button>
                                <span>{truck.truckNumber}</span>
                              </div>
                              {(DECLINED_TRUCKS.has(truck.truckNumber) || data?.declinedTrucks?.includes(truck.truckNumber)) && (
                                <span className="text-xs text-red-600 dark:text-red-400 font-normal">Declined</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {truck.tagState || '-'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {truck.district || '-'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {getOwnerFromDistrict(truck.district)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={truck.assignmentStatus === 'Assigned' ? 'default' : 'destructive'}
                              className={truck.assignmentStatus === 'Assigned' ? 'bg-green-600' : ''}
                            >
                              {truck.assignmentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {truck.state || '-'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {truck.regExpDate || '-'}
                          </TableCell>
                          <TableCell>
                            {daysToExpiry !== null ? (
                              <Badge
                                variant={daysToExpiry >= 90 ? 'default' : 'destructive'}
                                className={daysToExpiry >= 90 ? 'bg-green-600' : daysToExpiry >= 0 ? 'bg-amber-500' : ''}
                              >
                                {daysToExpiry >= 0 ? `${daysToExpiry} days` : `${daysToExpiry} days`}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={truck.initialTextSent}
                              onCheckedChange={(checked) => {
                                trackingMutation.mutate({
                                  truckNumber: truck.truckNumber,
                                  initialTextSent: !!checked,
                                });
                              }}
                              data-testid={`checkbox-text-sent-${truck.truckNumber}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={truck.timeSlotConfirmed}
                                onCheckedChange={(checked) => {
                                  trackingMutation.mutate({
                                    truckNumber: truck.truckNumber,
                                    timeSlotConfirmed: !!checked,
                                  });
                                }}
                                data-testid={`checkbox-time-slot-${truck.truckNumber}`}
                              />
                              <Input
                                placeholder="MM/DD-HH"
                                defaultValue={truck.timeSlotValue || ''}
                                onBlur={(e) => {
                                  const value = e.target.value;
                                  if (value !== truck.timeSlotValue) {
                                    trackingMutation.mutate({
                                      truckNumber: truck.truckNumber,
                                      timeSlotValue: value,
                                    });
                                  }
                                }}
                                className="h-7 w-24 text-xs"
                                data-testid={`input-time-slot-${truck.truckNumber}`}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Checkbox
                                checked={truck.submittedToHolman}
                                onCheckedChange={(checked) => {
                                  trackingMutation.mutate({
                                    truckNumber: truck.truckNumber,
                                    submittedToHolman: !!checked,
                                  });
                                }}
                                data-testid={`checkbox-submitted-holman-${truck.truckNumber}`}
                              />
                              {truck.submittedToHolman && truck.submittedToHolmanAt && (
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  {new Date(truck.submittedToHolmanAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={truck.alreadySent}
                              onCheckedChange={(checked) => {
                                trackingMutation.mutate({
                                  truckNumber: truck.truckNumber,
                                  alreadySent: !!checked,
                                });
                              }}
                              data-testid={`checkbox-already-sent-${truck.truckNumber}`}
                            />
                          </TableCell>
                          <TableCell className="text-center" data-testid={`pmf-filter-${truck.truckNumber}`}>
                            {isPmfStickersNeeded(truck.truckNumber) ? (
                              <Badge variant="default" className="bg-green-600 text-white no-default-hover-elevate">Yes</Badge>
                            ) : (
                              <span className="text-muted-foreground">No</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{truck.ldap || '-'}</TableCell>
                          <TableCell>{truck.techName || '-'}</TableCell>
                          <TableCell>{truck.techPhone || '-'}</TableCell>
                          <TableCell className="max-w-[400px] truncate" title={truck.techAddress}>
                            {truck.techAddress || '-'}
                          </TableCell>
                          <TableCell>{truck.techLeadName || '-'}</TableCell>
                          <TableCell>{truck.techLeadPhone || '-'}</TableCell>
                          <TableCell>
                            <Input
                              type="text"
                              defaultValue={truck.comments || ''}
                              maxLength={250}
                              placeholder="Add comment..."
                              className="h-8 text-sm w-[320px]"
                              onBlur={(e) => {
                                const newValue = e.target.value.trim();
                                if (newValue !== (truck.comments || '')) {
                                  trackingMutation.mutate({
                                    truckNumber: truck.truckNumber,
                                    comments: newValue
                                  });
                                }
                              }}
                              data-testid={`input-comments-${truck.truckNumber}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>}
    </div>
  );
}
