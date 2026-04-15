import { useState, useEffect, useRef, useCallback } from "react";
import { toCanonical } from "@shared/vehicle-number-utils";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { UserMinus, Search, RefreshCw, Clock, Calendar, AlertCircle, Download, Loader2, CheckCircle, Truck, HelpCircle, Wrench, CarFront, Package, MapPin, Phone, PhoneOff, Home, Mail, PauseCircle } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, getWeek, getYear, differenceInDays } from "date-fns";

interface TermRosterEntry {
  emplName: string;
  enterpriseId: string;
  emplId: string;
  emplStatus: string;
  effdt: string;
  lastDateWorked: string;
  planningArea: string;
  techSpecialty: string;
  address: string;
  contactPhone: string;
  owner: string;
  lastKnownTruckLu: string;
  lastKnownTruckFileDate?: string | null;
  techActiveStatus?: 'active' | 'inactive' | null;
  truck?: string;
  source?: string;
}

interface ByovEnrollment {
  enterprise_id: string;
  full_name: string | null;
  truck_number: string | null;
  enrollment_type: string | null;
  in_rental: boolean;
  district: string | null;
  status: string;
  approved_date: string | null;
  created_at: string;
  updated_at: string;
  mobile_phone: string | null;
  home_address: string | null;
}

interface LoaTechEntry {
  fullName: string;
  enterpriseId: string;
  employmentStatus: string;
  employmentStatusLabel: string;
  jobTitle: string;
  district: string;
  planningArea: string;
  effectiveDate: string;
  lastDateWorked: string;
  tpmsPhone: string | null;
  tpmsAddress: string;
  lastKnownTruck: string;
  tpmsSource: string;
  personalNumber: string | null;
  dailyProfit: number | null;
  completes90d: number | null;
  totalRevenue90d: number | null;
}

export default function WeeklyOffboarding() {
  const { toast } = useToast();
  const [exportLoading, setExportLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [manualStatusFilter, setManualStatusFilter] = useState<string>("all");
  const [selectedEntry, setSelectedEntry] = useState<TermRosterEntry | null>(null);
  const [selectedByovEntry, setSelectedByovEntry] = useState<ByovEnrollment | null>(null);
  const [selectedLoaEntry, setSelectedLoaEntry] = useState<LoaTechEntry | null>(null);
  
  // Nexus tracking fields
  const [nexusStatus, setNexusStatus] = useState("");
  const [nexusLocation, setNexusLocation] = useState("");
  const [nexusContact, setNexusContact] = useState("");
  const [nexusKeys, setNexusKeys] = useState("");
  const [nexusRepaired, setNexusRepaired] = useState("");
  const [nexusComments, setNexusComments] = useState("");
  const [nexusPhoneRecovery, setNexusPhoneRecovery] = useState("");
  const [nexusToolsLocation, setNexusToolsLocation] = useState("");
  const [nexusPartsRecovery, setNexusPartsRecovery] = useState("");

  // BYOV nexus tracking fields
  const [byovNexusStatus, setByovNexusStatus] = useState("");
  const [byovNexusLocation, setByovNexusLocation] = useState("");
  const [byovNexusContact, setByovNexusContact] = useState("");
  const [byovNexusKeys, setByovNexusKeys] = useState("");
  const [byovNexusRepaired, setByovNexusRepaired] = useState("");
  const [byovNexusComments, setByovNexusComments] = useState("");
  const [manualTruck, setManualTruck] = useState("");

  const [loaNexusStatus, setLoaNexusStatus] = useState("");
  const [loaNexusLocation, setLoaNexusLocation] = useState("");
  const [loaNexusContact, setLoaNexusContact] = useState("");
  const [loaNexusKeys, setLoaNexusKeys] = useState("");
  const [loaNexusRepaired, setLoaNexusRepaired] = useState("");
  const [loaNexusComments, setLoaNexusComments] = useState("");
  const [loaManualTruck, setLoaManualTruck] = useState("");

  const { data: manualTruckOverrides = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/offboarding-truck-overrides'],
  });

  const saveTruckOverrideMutation = useMutation({
    mutationFn: async ({ enterpriseId, truckNumber }: { enterpriseId: string; truckNumber: string }) => {
      return await apiRequest('PUT', `/api/offboarding-truck-overrides/${enterpriseId}`, { truckNumber });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offboarding-truck-overrides'] });
    },
  });

  // Refs for synchronized scrollbars (Term Roster)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  // Refs for synchronized scrollbars (LOA table)
  const loaTopScrollRef = useRef<HTMLDivElement>(null);
  const loaTableScrollRef = useRef<HTMLDivElement>(null);
  const [loaTableWidth, setLoaTableWidth] = useState(0);

  // Sync scroll positions between top scrollbar and table (Term Roster)
  const handleTopScroll = useCallback(() => {
    if (topScrollRef.current && tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }, []);

  const handleTableScroll = useCallback(() => {
    if (topScrollRef.current && tableScrollRef.current) {
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    }
  }, []);

  // Sync scroll positions between top scrollbar and table (LOA)
  const handleLoaTopScroll = useCallback(() => {
    if (loaTopScrollRef.current && loaTableScrollRef.current) {
      loaTableScrollRef.current.scrollLeft = loaTopScrollRef.current.scrollLeft;
    }
  }, []);

  const handleLoaTableScroll = useCallback(() => {
    if (loaTopScrollRef.current && loaTableScrollRef.current) {
      loaTopScrollRef.current.scrollLeft = loaTableScrollRef.current.scrollLeft;
    }
  }, []);

  const { data: termRoster = [], isLoading, isRefetching } = useQuery<TermRosterEntry[]>({
    queryKey: ['/api/weekly-offboarding'],
  });

  // Fetch the set of Enterprise IDs currently in open rentals for the "Rental" badge
  const { data: openRentalEids } = useQuery<{ enterpriseIds: string[] }>({
    queryKey: ['/api/rental-ops/open-enterprise-ids'],
    staleTime: 5 * 60 * 1000,
  });
  const openRentalEidSet = new Set<string>((openRentalEids?.enterpriseIds || []).map(id => id.toUpperCase()));

  // Collect all truck numbers from termRoster for batch fetch (including manual overrides)
  const truckNumbers = Array.from(new Set([
    ...termRoster.map(entry => entry.lastKnownTruckLu ?? entry.truck).filter((truck): truck is string => !!truck),
    ...Object.values(manualTruckOverrides),
  ]));

  // Batch fetch nexus data for all trucks in the list
  const { data: allNexusData = [] } = useQuery<{
    vehicleNumber: string;
    postOffboardedStatus: string | null;
    phoneRecoveryInitiated: string | null;
    toolsPartsLocation: string | null;
    partsRecoveryInitiated: string | null;
    updatedBy: string | null;
  }[]>({
    queryKey: ['/api/vehicle-nexus-data/batch', truckNumbers],
    queryFn: async () => {
      if (truckNumbers.length === 0) return [];
      const response = await apiRequest('POST', '/api/vehicle-nexus-data/batch', { vehicleNumbers: truckNumbers });
      return response.json();
    },
    enabled: truckNumbers.length > 0,
  });

  // Create a lookup map for quick access
  const nexusDataMap = new Map(
    allNexusData.map(item => [item.vehicleNumber, item])
  );

  // Manual status labels for display
  const manualStatusLabels: Record<string, string> = {
    'reserved_for_new_hire': 'Reserved for new hire',
    'in_repair': 'In repair',
    'declined_repair': 'Declined repair',
    'available_for_rental_pmf': 'Available to assign or send to PMF',
    'sent_to_pmf': 'Sent to PMF',
    'assigned_to_tech_in_rental': 'Assigned to rental',
    'assigned_to_tech': 'Assigned to tech',
    'not_found': 'Not found',
    'sent_to_auction': 'Sent to auction',
    'already_picked_up': 'Already picked up',
    'unable_to_reach': 'Unable to reach',
    'byov': 'BYOV',
  };

  // Get unique manual statuses from nexus data
  const uniqueManualStatuses = Array.from(
    new Set(allNexusData.map(d => d.postOffboardedStatus).filter(Boolean) as string[])
  ).sort();

  // Batch fetch Samsara location data for all trucks in the list
  const { data: samsaraData = {} } = useQuery<Record<string, { vehicleName: string; address: string; lastUpdated: string }>>({
    queryKey: ['/api/samsara/vehicles/batch', truckNumbers],
    queryFn: async () => {
      if (truckNumbers.length === 0) return {};
      const response = await apiRequest('POST', '/api/samsara/vehicles/batch', { vehicleNames: truckNumbers });
      return response.json();
    },
    enabled: truckNumbers.length > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes since Samsara data doesn't change frequently
  });

  // Update table width for top scrollbar (Term Roster)
  useEffect(() => {
    const updateWidth = () => {
      if (tableScrollRef.current) {
        setTableWidth(tableScrollRef.current.scrollWidth);
      }
    };
    const timer = setTimeout(updateWidth, 100);
    window.addEventListener('resize', updateWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateWidth);
    };
  }, [termRoster]);

  // Update table width for top scrollbar (LOA)
  useEffect(() => {
    const updateWidth = () => {
      if (loaTableScrollRef.current) {
        setLoaTableWidth(loaTableScrollRef.current.scrollWidth);
      }
    };
    const timer = setTimeout(updateWidth, 100);
    window.addEventListener('resize', updateWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateWidth);
    };
  }, [filteredLoa]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/sync/weekly-offboarding');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/weekly-offboarding'] });
      toast({
        title: "Sync Complete",
        description: "Term roster data has been refreshed from Snowflake.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync term roster data",
        variant: "destructive",
      });
    },
  });

  // Effective truck: use entry's truck or manually entered one
  const effectiveTruck = (selectedEntry?.lastKnownTruckLu ?? selectedEntry?.truck) || (manualTruck.length === 5 ? manualTruck : null);

  // Fetch nexus data when an entry with a truck is selected
  const { data: nexusData, isLoading: nexusDataLoading } = useQuery({
    queryKey: ['/api/vehicle-nexus-data', effectiveTruck],
    queryFn: async () => {
      if (!effectiveTruck) return null;
      const response = await fetch(`/api/vehicle-nexus-data/${effectiveTruck}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!effectiveTruck,
  });

  // Reset nexus fields when selection changes
  useEffect(() => {
    if (nexusData) {
      setNexusStatus(nexusData.postOffboardedStatus || "");
      setNexusLocation(nexusData.nexusNewLocation || "");
      setNexusContact(nexusData.nexusNewLocationContact || "");
      setNexusKeys(nexusData.keys || "");
      setNexusRepaired(nexusData.repaired || "");
      setNexusComments(nexusData.comments || "");
      setNexusPhoneRecovery(nexusData.phoneRecoveryInitiated || "");
      setNexusToolsLocation(nexusData.toolsPartsLocation || "");
      setNexusPartsRecovery(nexusData.partsRecoveryInitiated || "");
    } else {
      setNexusStatus("");
      setNexusLocation("");
      setNexusContact("");
      setNexusKeys("");
      setNexusRepaired("");
      setNexusComments("");
      setNexusPhoneRecovery("");
      setNexusToolsLocation("");
      setNexusPartsRecovery("");
    }
  }, [nexusData, selectedEntry]);

  // Reset manual truck when selecting a new entry (pre-fill from overrides)
  useEffect(() => {
    if (selectedEntry && !(selectedEntry.lastKnownTruckLu ?? selectedEntry.truck) && selectedEntry.enterpriseId) {
      setManualTruck(manualTruckOverrides[selectedEntry.enterpriseId] || "");
    } else {
      setManualTruck("");
    }
  }, [selectedEntry]);

  // Save nexus tracking data mutation
  const saveNexusDataMutation = useMutation({
    mutationFn: async (data: {
      vehicleNumber: string;
      postOffboardedStatus: string | null;
      nexusNewLocation: string | null;
      nexusNewLocationContact: string | null;
      keys: string | null;
      repaired: string | null;
      comments: string | null;
      phoneRecoveryInitiated: string | null;
      toolsPartsLocation: string | null;
      partsRecoveryInitiated: string | null;
    }) => {
      return await apiRequest('PUT', `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Nexus tracking data has been saved.",
      });
      if (!(selectedEntry?.lastKnownTruckLu ?? selectedEntry?.truck) && manualTruck && selectedEntry?.enterpriseId) {
        saveTruckOverrideMutation.mutate({ enterpriseId: selectedEntry.enterpriseId, truckNumber: manualTruck });
      }
      const truckToInvalidate = (selectedEntry?.lastKnownTruckLu ?? selectedEntry?.truck) || manualTruck;
      if (truckToInvalidate) {
        queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', truckToInvalidate] });
        queryClient.invalidateQueries({ 
          predicate: (query) => 
            Array.isArray(query.queryKey) && 
            query.queryKey[0] === '/api/vehicle-nexus-data/batch'
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save nexus tracking data",
        variant: "destructive",
      });
    },
  });

  const getWeekKey = (dateStr: string): string => {
    if (!dateStr) return 'unknown';
    try {
      const date = parseISO(dateStr);
      const weekNum = getWeek(date, { weekStartsOn: 0 });
      const year = getYear(date);
      return `${year}-W${weekNum.toString().padStart(2, '0')}`;
    } catch {
      return 'unknown';
    }
  };

  const getWeekLabel = (weekKey: string): string => {
    if (weekKey === 'unknown') return 'Unknown Week';
    const [year, weekPart] = weekKey.split('-W');
    const weekNum = parseInt(weekPart);
    const jan1 = new Date(parseInt(year), 0, 1);
    const dayOffset = (7 - jan1.getDay()) % 7;
    const firstSunday = new Date(jan1.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const weekStart = new Date(firstSunday.getTime() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    return `Week ${weekNum}: ${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
  };

  const uniqueStatuses = Array.from(new Set(termRoster.map(e => e.emplStatus).filter(Boolean))).sort();
  const uniqueOwners = Array.from(new Set(termRoster.map(e => e.owner).filter(Boolean))).sort();

  const weekGroups = termRoster.reduce((acc, entry) => {
    const weekKey = getWeekKey(entry.lastDateWorked);
    if (!acc[weekKey]) {
      acc[weekKey] = { label: getWeekLabel(weekKey), count: 0 };
    }
    acc[weekKey].count++;
    return acc;
  }, {} as Record<string, { label: string; count: number }>);

  const weekOptions = Object.entries(weekGroups).sort((a, b) => b[0].localeCompare(a[0]));

  const filteredRoster = termRoster.filter(entry => {
    const matchesSearch = searchQuery === "" || 
      entry.emplName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.enterpriseId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.lastKnownTruckLu ?? entry.truck)?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.planningArea?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.contactPhone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.owner?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesWeek = weekFilter === "all" || getWeekKey(entry.lastDateWorked) === weekFilter;
    const matchesStatus = statusFilter === "all" || entry.emplStatus === statusFilter;
    const matchesOwner = ownerFilter === "all" || entry.owner === ownerFilter;
    
    // Manual status filter - check nexus data for the truck (including manual overrides)
    const filterTruck = (entry.lastKnownTruckLu ?? entry.truck) || (entry.enterpriseId ? manualTruckOverrides[entry.enterpriseId] : null);
    const nexusInfo = filterTruck ? nexusDataMap.get(filterTruck) : null;
    const matchesManualStatus = manualStatusFilter === "all" || 
      (manualStatusFilter === "__none__" ? !nexusInfo?.postOffboardedStatus : nexusInfo?.postOffboardedStatus === manualStatusFilter);
    
    return matchesSearch && matchesWeek && matchesStatus && matchesOwner && matchesManualStatus;
  });

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'N/A';
    try {
      return format(parseISO(dateStr), 'MMM d, yyyy');
    } catch {
      return dateStr;
    }
  };

  const postOffboardingCounts = (() => {
    const counts: Record<string, number> = {};
    for (const entry of filteredRoster) {
      const filterTruck = (entry.lastKnownTruckLu ?? entry.truck) || (entry.enterpriseId ? manualTruckOverrides[entry.enterpriseId] : null);
      const nexusInfo = filterTruck ? nexusDataMap.get(filterTruck) : null;
      const status = nexusInfo?.postOffboardedStatus || '__none__';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  })();

  const postOffboardingCardDefs: { key: string; label: string; icon: any; color: string; bg: string }[] = [
    { key: '__none__', label: 'Not yet confirmed', icon: HelpCircle, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-900' },
    { key: 'reserved_for_new_hire', label: 'Reserved for new hire', icon: UserMinus, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950' },
    { key: 'in_repair', label: 'In repair', icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950' },
    { key: 'declined_repair', label: 'Declined repair', icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950' },
    { key: 'available_for_rental_pmf', label: 'Available to assign or send to PMF', icon: Package, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950' },
    { key: 'sent_to_pmf', label: 'Sent to PMF', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950' },
    { key: 'assigned_to_tech_in_rental', label: 'Assigned to rental', icon: CarFront, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950' },
    { key: 'assigned_to_tech', label: 'Assigned to tech', icon: CheckCircle, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950' },
    { key: 'not_found', label: 'Not found', icon: Search, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950' },
    { key: 'sent_to_auction', label: 'Sent to auction', icon: Truck, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950' },
    { key: 'already_picked_up', label: 'Already picked up', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950' },
    { key: 'unable_to_reach', label: 'Unable to reach', icon: AlertCircle, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950' },
    { key: 'byov', label: 'BYOV', icon: CarFront, color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-950' },
  ];

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    const upperStatus = (status || '').toUpperCase();
    if (upperStatus.includes('TERM') || upperStatus.includes('INACTIVE')) return 'destructive';
    if (upperStatus.includes('ACTIVE')) return 'default';
    return 'secondary';
  };

  // ===== BYOV Tab state & data fetching =====
  const [byovSearch, setByovSearch] = useState("");

  const { data: byovEnrollments = [], isLoading: byovLoading, refetch: refetchByov } = useQuery<ByovEnrollment[]>({
    queryKey: ['/api/byov-enrollments'],
  });

  const backfillByovMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/byov-enrollments/backfill');
      return res.json() as Promise<{ success: boolean; upserted: number }>;
    },
    onSuccess: (data) => {
      toast({ title: 'Backfill complete', description: `${data.upserted ?? 0} records synced from BYOV app.` });
      queryClient.invalidateQueries({ queryKey: ['/api/byov-enrollments'] });
    },
    onError: (err: any) => {
      toast({ title: 'Backfill failed', description: err.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const byovLastSynced = byovEnrollments.length > 0
    ? byovEnrollments.reduce((latest, e) => {
        return new Date(e.created_at) > new Date(latest) ? e.created_at : latest;
      }, byovEnrollments[0].created_at)
    : null;

  // ===== LOA / Paid Leave / Suspended Tab state & data fetching =====
  const [loaSearch, setLoaSearch] = useState("");
  const [loaStatusFilter, setLoaStatusFilter] = useState<string>("all");

  const { data: loaTechs = [], isLoading: loaLoading, refetch: refetchLoa } = useQuery<LoaTechEntry[]>({
    queryKey: ['/api/loa-trucks-to-recover'],
  });

  const filteredLoa = loaTechs.filter(e => {
    if (loaStatusFilter !== "all" && e.employmentStatus !== loaStatusFilter) return false;
    if (!loaSearch.trim()) return true;
    const q = loaSearch.toLowerCase();
    return (
      (e.fullName || '').toLowerCase().includes(q) ||
      (e.enterpriseId || '').toLowerCase().includes(q) ||
      (e.lastKnownTruck || '').toLowerCase().includes(q) ||
      (e.tpmsAddress || '').toLowerCase().includes(q) ||
      (e.district || '').toLowerCase().includes(q) ||
      (e.personalNumber || '').toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    const now = new Date();
    const daysA = a.lastDateWorked ? differenceInDays(now, new Date(a.lastDateWorked)) : 0;
    const daysB = b.lastDateWorked ? differenceInDays(now, new Date(b.lastDateWorked)) : 0;
    const aOver30 = daysA >= 30;
    const bOver30 = daysB >= 30;
    if (aOver30 && !bOver30) return -1;
    if (!aOver30 && bOver30) return 1;
    if (aOver30 && bOver30) {
      const profA = a.dailyProfit ?? Infinity;
      const profB = b.dailyProfit ?? Infinity;
      if (profA !== profB) return profA - profB;
      return daysB - daysA;
    }
    const dateA = a.lastDateWorked ? new Date(a.lastDateWorked).getTime() : 0;
    const dateB = b.lastDateWorked ? new Date(b.lastDateWorked).getTime() : 0;
    return dateA - dateB;
  });

  const filteredByov = byovEnrollments.filter(e => {
    if (!byovSearch.trim()) return true;
    const q = byovSearch.toLowerCase();
    return (
      (e.enterprise_id || '').toLowerCase().includes(q) ||
      (e.full_name || '').toLowerCase().includes(q) ||
      (e.truck_number || '').toLowerCase().includes(q) ||
      (e.district || '').toLowerCase().includes(q) ||
      (e.mobile_phone || '').toLowerCase().includes(q) ||
      (e.home_address || '').toLowerCase().includes(q)
    );
  });

  const effectiveByovTruck = selectedByovEntry?.truck_number?.toString().trim() || null;

  const { data: byovNexusData, isLoading: byovNexusLoading } = useQuery({
    queryKey: ['/api/vehicle-nexus-data', effectiveByovTruck],
    queryFn: async () => {
      if (!effectiveByovTruck) return null;
      const response = await fetch(`/api/vehicle-nexus-data/${effectiveByovTruck}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!effectiveByovTruck,
  });

  useEffect(() => {
    if (byovNexusData) {
      setByovNexusStatus(byovNexusData.postOffboardedStatus || "");
      setByovNexusLocation(byovNexusData.nexusNewLocation || "");
      setByovNexusContact(byovNexusData.nexusNewLocationContact || "");
      setByovNexusKeys(byovNexusData.keys || "");
      setByovNexusRepaired(byovNexusData.repaired || "");
      setByovNexusComments(byovNexusData.comments || "");
    } else {
      setByovNexusStatus("");
      setByovNexusLocation("");
      setByovNexusContact("");
      setByovNexusKeys("");
      setByovNexusRepaired("");
      setByovNexusComments("");
    }
  }, [byovNexusData, selectedByovEntry]);

  const saveByovNexusMutation = useMutation({
    mutationFn: async (data: {
      vehicleNumber: string;
      postOffboardedStatus: string | null;
      nexusNewLocation: string | null;
      nexusNewLocationContact: string | null;
      keys: string | null;
      repaired: string | null;
      comments: string | null;
    }) => {
      return await apiRequest('PUT', `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Nexus tracking data has been saved and synced to Fleet Scope Spares.",
      });
      if (effectiveByovTruck) {
        queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', effectiveByovTruck] });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === '/api/vehicle-nexus-data/batch'
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save nexus tracking data",
        variant: "destructive",
      });
    },
  });

  const effectiveLoaTruck = selectedLoaEntry?.lastKnownTruck?.trim() || (loaManualTruck.length === 5 ? loaManualTruck : null) || (manualTruckOverrides[selectedLoaEntry?.enterpriseId || ''] && manualTruckOverrides[selectedLoaEntry?.enterpriseId || ''].length === 5 ? manualTruckOverrides[selectedLoaEntry?.enterpriseId || ''] : null);

  const { data: loaNexusData, isLoading: loaNexusLoading } = useQuery({
    queryKey: ['/api/vehicle-nexus-data', effectiveLoaTruck],
    queryFn: async () => {
      if (!effectiveLoaTruck) return null;
      const response = await fetch(`/api/vehicle-nexus-data/${effectiveLoaTruck}`, { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!effectiveLoaTruck,
  });

  useEffect(() => {
    if (loaNexusData) {
      setLoaNexusStatus(loaNexusData.postOffboardedStatus || "");
      setLoaNexusLocation(loaNexusData.nexusNewLocation || "");
      setLoaNexusContact(loaNexusData.nexusNewLocationContact || "");
      setLoaNexusKeys(loaNexusData.keys || "");
      setLoaNexusRepaired(loaNexusData.repaired || "");
      setLoaNexusComments(loaNexusData.comments || "");
    } else {
      setLoaNexusStatus("");
      setLoaNexusLocation("");
      setLoaNexusContact("");
      setLoaNexusKeys("");
      setLoaNexusRepaired("");
      setLoaNexusComments("");
    }
  }, [loaNexusData, selectedLoaEntry]);

  useEffect(() => {
    if (selectedLoaEntry && !selectedLoaEntry.lastKnownTruck && selectedLoaEntry.enterpriseId) {
      setLoaManualTruck(manualTruckOverrides[selectedLoaEntry.enterpriseId] || "");
    } else {
      setLoaManualTruck("");
    }
  }, [selectedLoaEntry]);

  const saveLoaNexusMutation = useMutation({
    mutationFn: async (data: {
      vehicleNumber: string;
      postOffboardedStatus: string | null;
      nexusNewLocation: string | null;
      nexusNewLocationContact: string | null;
      keys: string | null;
      repaired: string | null;
      comments: string | null;
    }) => {
      return await apiRequest('PUT', `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Nexus tracking data has been saved.",
      });
      if (!selectedLoaEntry?.lastKnownTruck && loaManualTruck && selectedLoaEntry?.enterpriseId) {
        saveTruckOverrideMutation.mutate({ enterpriseId: selectedLoaEntry.enterpriseId, truckNumber: loaManualTruck });
      }
      if (effectiveLoaTruck) {
        queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', effectiveLoaTruck] });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === '/api/vehicle-nexus-data/batch'
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save nexus tracking data",
        variant: "destructive",
      });
    },
  });

  return (
    <MainContent>
      <TopBar title="Weekly Offboarding" breadcrumbs={["Home", "Weekly Offboarding"]} />
      <div className="container mx-auto py-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserMinus className="h-8 w-8 text-red-600" />
            Weekly Offboarding
          </h1>
          <p className="text-muted-foreground">
            Terminated employee roster from Snowflake
          </p>
        </div>

        <Tabs defaultValue="term-roster" className="space-y-4">
          <TabsList>
            <TabsTrigger value="term-roster" className="flex items-center gap-1">
              <UserMinus className="h-4 w-4" />
              Term Roster
            </TabsTrigger>
            <TabsTrigger value="byov" className="flex items-center gap-1">
              <CarFront className="h-4 w-4" />
              BYOV Offboarding
            </TabsTrigger>
            <TabsTrigger value="loa" className="flex items-center gap-1">
              <PauseCircle className="h-4 w-4" />
              LOA, Paid Leave & Suspended
            </TabsTrigger>
          </TabsList>

          <TabsContent value="term-roster">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Term Roster
                </CardTitle>
                <CardDescription>
                  Employees from PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setExportLoading(true);
                    try {
                      const res = await fetch('/api/weekly-offboarding/export.xlsx', { credentials: 'include' });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({ message: `Server error ${res.status}` }));
                        throw new Error(err.message || `Server error ${res.status}`);
                      }
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      const timestamp = new Date().toISOString().split('T')[0];
                      a.href = url;
                      a.download = `weekly_offboarding_${timestamp}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err: any) {
                      toast({ title: 'Export failed', description: err.message || 'Could not generate the XLSX file. Please try again.', variant: 'destructive' });
                    } finally {
                      setExportLoading(false);
                    }
                  }}
                  disabled={isLoading || exportLoading}
                  data-testid="button-export-offboarding"
                >
                  {exportLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                  {exportLoading ? 'Exporting...' : 'Export XLSX'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || isRefetching}
                  data-testid="button-sync-offboarding"
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${syncMutation.isPending || isRefetching ? 'animate-spin' : ''}`} />
                  {syncMutation.isPending ? 'Syncing...' : 'Refresh'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 mb-6">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <Card className="bg-red-50 dark:bg-red-950">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Terminated</p>
                        <p className="text-2xl font-bold">{termRoster.length}</p>
                      </div>
                      <UserMinus className="h-8 w-8 text-red-600" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50 dark:bg-blue-950">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Statuses Set</p>
                        <p className="text-2xl font-bold">
                          {Object.entries(postOffboardingCounts)
                            .filter(([key]) => key !== '__none__' && key !== 'not_found')
                            .reduce((sum, [, count]) => sum + count, 0)}
                        </p>
                      </div>
                      <CheckCircle className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>
                {postOffboardingCardDefs.filter(def => (postOffboardingCounts[def.key] || 0) > 0).map(def => {
                  const IconComp = def.icon;
                  return (
                    <Card key={def.key} className={def.bg}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">{def.label}</p>
                            <p className="text-2xl font-bold">{postOffboardingCounts[def.key] || 0}</p>
                          </div>
                          <IconComp className={`h-8 w-8 ${def.color}`} />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="relative flex-1 max-w-sm min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, enterprise ID, or planning area..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-offboarding"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Select value={weekFilter} onValueChange={setWeekFilter}>
                    <SelectTrigger className="w-[280px]" data-testid="select-week-filter">
                      <SelectValue placeholder="Filter by week" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Weeks</SelectItem>
                      {weekOptions.map(([key, data]) => (
                        <SelectItem key={key} value={key}>
                          {data.label} ({data.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {uniqueStatuses.map((status) => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="w-[220px]" data-testid="select-owner-filter">
                      <SelectValue placeholder="Filter by owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Owners</SelectItem>
                      {uniqueOwners.map((owner) => (
                        <SelectItem key={owner} value={owner}>{owner}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={manualStatusFilter} onValueChange={setManualStatusFilter}>
                    <SelectTrigger className="w-[220px]" data-testid="select-manual-status-filter">
                      <SelectValue placeholder="Filter by manual status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Manual Statuses</SelectItem>
                      <SelectItem value="__none__">-- No Status Set --</SelectItem>
                      {Array.from(new Set([...uniqueManualStatuses, 'reserved_for_new_hire', 'in_repair', 'declined_repair', 'available_for_rental_pmf', 'sent_to_pmf', 'assigned_to_tech_in_rental', 'assigned_to_tech', 'not_found', 'sent_to_auction', 'already_picked_up', 'unable_to_reach', 'byov'])).sort().map((status) => (
                        <SelectItem key={status} value={status}>
                          {manualStatusLabels[status] || status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                <span className="text-muted-foreground">Loading term roster...</span>
              </div>
            ) : filteredRoster.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {termRoster.length === 0 ? (
                  <div>
                    <p>No terminated employees found.</p>
                    <p className="text-sm mt-2">Click Refresh to sync from Snowflake.</p>
                  </div>
                ) : (
                  <p>No results match your search criteria.</p>
                )}
              </div>
            ) : (
              <div className="rounded-md border">
                {/* Top scrollbar */}
                <div 
                  ref={topScrollRef}
                  onScroll={handleTopScroll}
                  className="overflow-x-auto overflow-y-hidden"
                  style={{ height: '12px' }}
                >
                  <div style={{ width: tableWidth, height: '1px' }} />
                </div>
                <div 
                  ref={tableScrollRef}
                  onScroll={handleTableScroll}
                  className="overflow-x-auto overflow-y-auto max-h-[600px]"
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-background">
                        <TableHead className="bg-background sticky top-0">Employee Name</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">Enterprise ID</TableHead>
                        <TableHead className="w-[100px] bg-background sticky top-0">Truck</TableHead>
                        <TableHead className="w-[80px] bg-background sticky top-0">Rental</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">Status</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            Effective Date
                          </div>
                        </TableHead>
                        <TableHead className="w-[130px] bg-background sticky top-0">Last Date Worked</TableHead>
                        <TableHead className="w-[100px] bg-background sticky top-0">Days Since</TableHead>
                        <TableHead className="bg-background sticky top-0">Planning Area</TableHead>
                        <TableHead className="bg-background sticky top-0">Owner</TableHead>
                        <TableHead className="bg-background sticky top-0">Tech Specialty</TableHead>
                        <TableHead className="min-w-[150px] bg-background sticky top-0">Manual Status</TableHead>
                        <TableHead className="min-w-[200px] bg-background sticky top-0">Address</TableHead>
                        <TableHead className="min-w-[180px] bg-background sticky top-0">Contact Phone</TableHead>
                        <TableHead className="min-w-[200px] bg-background sticky top-0">Samsara Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRoster.map((entry, index) => {
                        const rowTruck = (entry.lastKnownTruckLu ?? entry.truck) || (entry.enterpriseId ? manualTruckOverrides[entry.enterpriseId] : null);
                        return (
                        <TableRow 
                          key={`${entry.enterpriseId}-${index}`} 
                          data-testid={`row-term-${index}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          <TableCell className="font-medium">{entry.emplName || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{entry.enterpriseId?.toUpperCase() || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {rowTruck ? (
                              <span>
                                {rowTruck}
                                {!(entry.lastKnownTruckLu ?? entry.truck) && <span className="text-xs text-blue-600 ml-1">(manual)</span>}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {entry.enterpriseId && openRentalEidSet.has(entry.enterpriseId.toUpperCase()) ? (
                              <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700">
                                Rental
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(entry.emplStatus)}>
                              {entry.emplStatus || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.effdt)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.lastDateWorked)}</TableCell>
                          <TableCell className="text-sm">
                            {(() => {
                              if (!entry.lastDateWorked) return '-';
                              const nexusInfo = rowTruck ? nexusDataMap.get(rowTruck) : null;
                              const hasManualStatus = !!nexusInfo?.postOffboardedStatus;
                              try {
                                const lastWorked = parseISO(entry.lastDateWorked);
                                const daysSince = differenceInDays(new Date(), lastWorked);
                                const isPastDue = daysSince >= 2 && !hasManualStatus;
                                if (isPastDue) {
                                  return <span className="text-red-600 font-semibold whitespace-nowrap">2 days past</span>;
                                }
                                return daysSince;
                              } catch {
                                return '-';
                              }
                            })()}
                          </TableCell>
                          <TableCell className="text-sm">{entry.planningArea || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.owner || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.techSpecialty || '-'}</TableCell>
                          <TableCell className="text-sm">
                            {(() => {
                              const nexusInfo = rowTruck ? nexusDataMap.get(rowTruck) : null;
                              const phoneRecovery = nexusInfo?.phoneRecoveryInitiated?.toLowerCase() || null;
                              const toolsLoc = nexusInfo?.toolsPartsLocation || null;
                              const partsRecovery = nexusInfo?.partsRecoveryInitiated?.toLowerCase() || null;

                              const PhoneIcon = phoneRecovery === 'no'
                                ? <PhoneOff className="w-3 h-3 text-muted-foreground shrink-0" title="Phone recovery: No" />
                                : phoneRecovery === 'yes'
                                ? <Phone className="w-3 h-3 text-blue-500 shrink-0" title="Phone recovery: Yes" />
                                : null;

                              const ToolsIcon = toolsLoc === 'in_the_truck'
                                ? (
                                  <span className="inline-flex items-center gap-0.5 shrink-0">
                                    <span className="inline-flex items-center" title="Tools & parts: In the truck">
                                      <Wrench className="w-3 h-3 text-amber-600" />
                                      <Truck className="w-3 h-3 text-amber-600 -ml-px" />
                                    </span>
                                    {partsRecovery === 'yes' && (
                                      <Mail className="w-3 h-3 text-amber-600" title="Parts recovery initiated" />
                                    )}
                                  </span>
                                )
                                : toolsLoc === 'techs_home'
                                ? (
                                  <span className="inline-flex items-center gap-0.5 shrink-0">
                                    <span className="inline-flex items-center" title="Tools & parts: Tech's home">
                                      <Wrench className="w-3 h-3 text-violet-500" />
                                      <Home className="w-3 h-3 text-violet-500 -ml-px" />
                                    </span>
                                    {partsRecovery === 'yes' && (
                                      <Mail className="w-3 h-3 text-violet-500" title="Parts recovery initiated" />
                                    )}
                                  </span>
                                )
                                : partsRecovery === 'yes'
                                ? (
                                  <span className="inline-flex items-center shrink-0" title="Parts recovery initiated">
                                    <Mail className="w-3 h-3 text-muted-foreground" />
                                  </span>
                                )
                                : null;

                              const hasIcons = PhoneIcon || ToolsIcon;

                              if (nexusInfo?.postOffboardedStatus) {
                                return (
                                  <div className="flex items-start gap-1">
                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                      <Badge variant="outline" className="text-xs whitespace-nowrap w-fit">
                                        {manualStatusLabels[nexusInfo.postOffboardedStatus] || nexusInfo.postOffboardedStatus}
                                      </Badge>
                                      {nexusInfo.updatedBy && (
                                        <span className="text-xs text-muted-foreground">by {nexusInfo.updatedBy}</span>
                                      )}
                                    </div>
                                    {hasIcons && (
                                      <div className="flex flex-col gap-0.5 shrink-0">
                                        {ToolsIcon}
                                        {PhoneIcon}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              if (hasIcons) {
                                return (
                                  <div className="flex flex-col gap-0.5">
                                    {ToolsIcon}
                                    {PhoneIcon}
                                  </div>
                                );
                              }
                              return '-';
                            })()}
                          </TableCell>
                          <TableCell className="text-sm">{entry.address || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.contactPhone || '-'}</TableCell>
                          <TableCell className="text-sm">
                            {(() => {
                              const samsaraInfo = rowTruck ? samsaraData[rowTruck] || samsaraData[toCanonical(rowTruck)] : null;
                              if (samsaraInfo?.address) {
                                return (
                                  <div className="flex flex-col">
                                    <span className="text-sm">{samsaraInfo.address}</span>
                                    {samsaraInfo.lastUpdated && (
                                      <span className="text-xs text-muted-foreground">
                                        {samsaraInfo.lastUpdated.split(' ')[0] || samsaraInfo.lastUpdated}
                                      </span>
                                    )}
                                  </div>
                                );
                              }
                              return '-';
                            })()}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="byov">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CarFront className="h-5 w-5 text-blue-600" />
                      BYOV Offboarding
                    </CardTitle>
                    <CardDescription>
                      Bring-Your-Own-Vehicle enrollments requiring offboarding
                      {byovLastSynced && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          • Last synced {formatDate(byovLastSynced)}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchByov()}
                      disabled={byovLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${byovLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => backfillByovMutation.mutate()}
                      disabled={backfillByovMutation.isPending}
                    >
                      {backfillByovMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-1" />
                      )}
                      Backfill from BYOV App
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 px-3 py-2 text-xs text-blue-800 dark:text-blue-200">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Webhook URL for Tyler: </span>
                    <code className="font-mono">POST /public/byov-enrollment-webhook</code>
                    <span className="mx-1">·</span>
                    auth header: <code className="font-mono">x-api-key: FS_BYOV_WEBHOOK_SECRET</code>
                  </div>
                </div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, enterprise ID, truck, or district..."
                      value={byovSearch}
                      onChange={(e) => setByovSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {filteredByov.length} of {byovEnrollments.length} record{byovEnrollments.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {byovLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                    <span className="text-muted-foreground">Loading BYOV enrollments...</span>
                  </div>
                ) : filteredByov.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {byovEnrollments.length === 0 ? (
                      <div>
                        <p>No BYOV enrollments found.</p>
                        <p className="text-sm mt-2">Click "Backfill from BYOV App" to sync records.</p>
                      </div>
                    ) : (
                      <p>No results match your search.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Enterprise ID</TableHead>
                          <TableHead>Full Name</TableHead>
                          <TableHead>Truck</TableHead>
                          <TableHead>Enrollment Type</TableHead>
                          <TableHead>In Rental</TableHead>
                          <TableHead>District</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Approved Date</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Home Address</TableHead>
                          <TableHead>Manual Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredByov.map((e) => {
                          const byovTruck = e.truck_number?.toString().trim() || null;
                          const byovNexus = byovTruck ? nexusDataMap.get(byovTruck) : null;
                          return (
                          <TableRow key={e.enterprise_id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedByovEntry(e)}>
                            <TableCell className="font-mono text-sm">{e.enterprise_id.toUpperCase()}</TableCell>
                            <TableCell>{e.full_name || '-'}</TableCell>
                            <TableCell className="font-mono text-sm">{e.truck_number || '-'}</TableCell>
                            <TableCell className="text-sm capitalize">{e.enrollment_type?.replace(/_/g, ' ') || '-'}</TableCell>
                            <TableCell>
                              {e.in_rental ? (
                                <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300">Rental</Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">No</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{e.district || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={e.status === 'approved' ? 'default' : 'secondary'} className="text-xs capitalize">
                                {e.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{e.approved_date ? formatDate(e.approved_date) : '-'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap font-mono">
                              {e.mobile_phone || <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-sm max-w-[220px]">
                              {e.home_address || <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {byovNexus?.postOffboardedStatus ? (
                                <div className="flex flex-col gap-0.5">
                                  <Badge variant="outline" className="text-xs whitespace-nowrap w-fit">
                                    {manualStatusLabels[byovNexus.postOffboardedStatus] || byovNexus.postOffboardedStatus}
                                  </Badge>
                                  {byovNexus.updatedBy && (
                                    <span className="text-xs text-muted-foreground">by {byovNexus.updatedBy}</span>
                                  )}
                                </div>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="loa">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <PauseCircle className="h-5 w-5 text-amber-600" />
                      LOA, Paid Leave & Suspended trucks to recover
                    </CardTitle>
                    <CardDescription>
                      Technicians on Leave, Paid Leave, or Suspended status with trucks that may need recovery
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-100 border border-red-300 text-red-800 dark:bg-red-950/50 dark:border-red-700 dark:text-red-300">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm font-medium">Call and Recover all trucks for LOA Techs over 30 days</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLoa()}
                    disabled={loaLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${loaLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, enterprise ID, truck, or address..."
                      value={loaSearch}
                      onChange={(e) => setLoaSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={loaStatusFilter} onValueChange={setLoaStatusFilter}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="L">Leave of Absence</SelectItem>
                      <SelectItem value="P">Paid Leave</SelectItem>
                      <SelectItem value="S">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {filteredLoa.length} of {loaTechs.length} record{loaTechs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {loaLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
                    <span className="text-muted-foreground">Loading LOA / Paid Leave / Suspended techs...</span>
                  </div>
                ) : filteredLoa.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {loaTechs.length === 0 ? (
                      <p>No technicians found with LOA, Paid Leave, or Suspended status.</p>
                    ) : (
                      <p>No results match your search.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border">
                    {/* Top scrollbar */}
                    <div 
                      ref={loaTopScrollRef}
                      onScroll={handleLoaTopScroll}
                      className="overflow-x-auto overflow-y-hidden"
                      style={{ height: '12px' }}
                    >
                      <div style={{ width: loaTableWidth, height: '1px' }} />
                    </div>
                    <div 
                      ref={loaTableScrollRef}
                      onScroll={handleLoaTableScroll}
                      className="overflow-x-auto overflow-y-auto max-h-[600px]"
                    >
                    <Table style={{ minWidth: '1600px' }}>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>Employment Status</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Enterprise ID</TableHead>
                          <TableHead>Date Last Worked</TableHead>
                          <TableHead>Truck</TableHead>
                          <TableHead>District</TableHead>
                          <TableHead>Phone (TPMS)</TableHead>
                          <TableHead>Personal Number</TableHead>
                          <TableHead>Address (TPMS)</TableHead>
                          <TableHead>TPMS Source</TableHead>
                          <TableHead>Manual Status</TableHead>
                          <TableHead>Daily Profit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLoa.map((e) => {
                          const loaTruck = e.lastKnownTruck?.trim() || null;
                          const loaNexus = loaTruck ? nexusDataMap.get(loaTruck) : null;
                          const lastWorkedDate = e.lastDateWorked ? new Date(e.lastDateWorked) : null;
                          const daysSinceLastWorked = lastWorkedDate ? differenceInDays(new Date(), lastWorkedDate) : null;
                          const isOver30Days = daysSinceLastWorked !== null && daysSinceLastWorked >= 30;
                          const isLoaOver30 = isOver30Days && e.employmentStatus === 'L';
                          return (
                          <TableRow key={e.enterpriseId} className={`cursor-pointer ${isLoaOver30 ? 'bg-red-100 hover:bg-red-200 dark:bg-red-950/50 dark:hover:bg-red-950/70' : 'hover:bg-muted/50'}`} onClick={() => setSelectedLoaEntry(e)}>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-xs whitespace-nowrap ${
                                  e.employmentStatus === 'L' ? 'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-700' :
                                  e.employmentStatus === 'P' ? 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-700' :
                                  'bg-red-50 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-700'
                                }`}
                              >
                                {e.employmentStatusLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{e.fullName || '-'}</TableCell>
                            <TableCell className="font-mono text-sm">{e.enterpriseId}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {lastWorkedDate ? (
                                <div className="flex flex-col">
                                  <span className={isOver30Days ? 'font-semibold text-red-700 dark:text-red-400' : ''}>{format(lastWorkedDate, 'MM/dd/yyyy')}</span>
                                  <span className={`text-xs ${isOver30Days ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}>{daysSinceLastWorked}d ago</span>
                                </div>
                              ) : <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{e.lastKnownTruck || <span className="text-muted-foreground">-</span>}</TableCell>
                            <TableCell className="text-sm">{e.district || '-'}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap font-mono">
                              {e.tpmsPhone || <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap font-mono">
                              {e.personalNumber || <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-sm max-w-[280px]">
                              {e.tpmsAddress || <span className="text-muted-foreground">-</span>}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {e.tpmsSource === 'TPMS_EXTRACT' ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-700">Active</Badge>
                              ) : e.tpmsSource === 'TPMS_EXTRACT_LAST_ASSIGNED' ? (
                                <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-700">Last Assigned</Badge>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {loaNexus?.postOffboardedStatus ? (
                                <div className="flex flex-col gap-0.5">
                                  <Badge variant="outline" className="text-xs whitespace-nowrap w-fit">
                                    {manualStatusLabels[loaNexus.postOffboardedStatus] || loaNexus.postOffboardedStatus}
                                  </Badge>
                                  {loaNexus.updatedBy && (
                                    <span className="text-xs text-muted-foreground">by {loaNexus.updatedBy}</span>
                                  )}
                                </div>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-sm whitespace-nowrap">
                              {e.dailyProfit !== null ? (
                                <span className={`font-mono font-medium ${e.dailyProfit >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                  {e.dailyProfit >= 0 ? '+' : ''}${e.dailyProfit.toFixed(2)}/day
                                </span>
                              ) : <span className="text-muted-foreground text-xs">No data</span>}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Employee Detail Drawer */}
      <Sheet open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <SheetContent className="w-[450px] sm:max-w-[450px] overflow-y-auto" data-testid="sheet-employee-detail">
          {selectedEntry && (
            <div className="space-y-6">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <UserMinus className="h-5 w-5 text-red-600" />
                  {selectedEntry.emplName}
                </SheetTitle>
                <SheetDescription>
                  {selectedEntry.enterpriseId?.toUpperCase()} • {(selectedEntry.lastKnownTruckLu ?? selectedEntry.truck) || 'No Truck'}
                </SheetDescription>
              </SheetHeader>

              <Separator />

              {/* Employee Info */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">Employee Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={getStatusBadgeVariant(selectedEntry.emplStatus)} className="ml-2">
                      {selectedEntry.emplStatus}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Worked:</span>
                    <span className="ml-2">{formatDate(selectedEntry.lastDateWorked)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Planning Area:</span>
                    <span className="ml-2">{selectedEntry.planningArea || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Owner:</span>
                    <span className="ml-2">{selectedEntry.owner || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Address:</span>
                    <span className="ml-2">{selectedEntry.address || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Contact:</span>
                    <span className="ml-2">{selectedEntry.contactPhone || '-'}</span>
                  </div>
                </div>
              </div>

              {((selectedEntry.lastKnownTruckLu ?? selectedEntry.truck) || true) && (
                <>
                  <Separator />

                  {/* Manual truck entry for null trucks */}
                  {!(selectedEntry.lastKnownTruckLu ?? selectedEntry.truck) && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Assign Truck Number</Label>
                      <Input
                        value={manualTruck}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setManualTruck(val);
                        }}
                        placeholder="Enter 5-digit truck #"
                        className="font-mono"
                        maxLength={5}
                        data-testid="input-manual-truck"
                      />
                      {manualTruck.length > 0 && manualTruck.length < 5 && (
                        <p className="text-xs text-amber-600">Enter all 5 digits to enable tracking fields</p>
                      )}
                    </div>
                  )}

                  {/* Nexus Tracking Data */}
                  {effectiveTruck && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Nexus Tracking {!(selectedEntry.lastKnownTruckLu ?? selectedEntry.truck) && effectiveTruck && <span className="text-xs">— Truck {effectiveTruck}</span>}
                    </h4>
                    
                    {nexusDataLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Post-Offboarded Status</Label>
                          <Select value={nexusStatus} onValueChange={setNexusStatus}>
                            <SelectTrigger className="mt-1" data-testid="select-nexus-status">
                              <SelectValue placeholder="Select status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="reserved_for_new_hire">Reserved for new hire</SelectItem>
                              <SelectItem value="in_repair">In repair</SelectItem>
                              <SelectItem value="declined_repair">Declined repair</SelectItem>
                              <SelectItem value="available_for_rental_pmf">Available to assign or send to PMF</SelectItem>
                              <SelectItem value="sent_to_pmf">Sent to PMF</SelectItem>
                              <SelectItem value="assigned_to_tech_in_rental">Assigned to rental</SelectItem>
                              <SelectItem value="assigned_to_tech">Assigned to tech</SelectItem>
                              <SelectItem value="not_found">Not found</SelectItem>
                              <SelectItem value="sent_to_auction">Sent to auction</SelectItem>
                              <SelectItem value="already_picked_up">Already picked up</SelectItem>
                              <SelectItem value="unable_to_reach">Unable to reach</SelectItem>
                              <SelectItem value="byov">BYOV</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">New Location</Label>
                          <Input
                            value={nexusLocation}
                            onChange={(e) => setNexusLocation(e.target.value)}
                            placeholder="Address or location description..."
                            className="mt-1"
                            data-testid="input-nexus-location"
                          />
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">New Location Contact</Label>
                          <Input
                            value={nexusContact}
                            onChange={(e) => setNexusContact(e.target.value)}
                            placeholder="Phone number or contact info..."
                            className="mt-1"
                            data-testid="input-nexus-contact"
                          />
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Keys</Label>
                          <Select value={nexusKeys} onValueChange={setNexusKeys}>
                            <SelectTrigger className="mt-1" data-testid="select-nexus-keys">
                              <SelectValue placeholder="Select keys status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="present">Present</SelectItem>
                              <SelectItem value="not_present">Not Present</SelectItem>
                              <SelectItem value="unknown">Unknown/Would not Check</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Repaired</Label>
                          <Select value={nexusRepaired} onValueChange={setNexusRepaired}>
                            <SelectTrigger className="mt-1" data-testid="select-nexus-repaired">
                              <SelectValue placeholder="Select repair status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="complete">Complete</SelectItem>
                              <SelectItem value="in_process">In Process</SelectItem>
                              <SelectItem value="unknown_if_needed">Unknown if needed</SelectItem>
                              <SelectItem value="declined">Declined</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Comments</Label>
                          <Textarea
                            value={nexusComments}
                            onChange={(e) => setNexusComments(e.target.value.slice(0, 400))}
                            placeholder="Additional notes (max 400 characters)..."
                            className="mt-1 resize-none"
                            rows={3}
                            maxLength={400}
                            data-testid="textarea-nexus-comments"
                          />
                          <p className="text-xs text-muted-foreground text-right mt-1">{nexusComments.length}/400</p>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Where are the tools &amp; parts being left?</Label>
                          <Select value={nexusToolsLocation} onValueChange={setNexusToolsLocation}>
                            <SelectTrigger className="mt-1" data-testid="select-tools-parts-location">
                              <SelectValue placeholder="Select location..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="in_the_truck">In the truck</SelectItem>
                              <SelectItem value="techs_home">Tech's home</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Parts recovery initiated</Label>
                          <Select value={nexusPartsRecovery} onValueChange={setNexusPartsRecovery}>
                            <SelectTrigger className="mt-1" data-testid="select-parts-recovery">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Phone Recovery Initiated</Label>
                          <Select value={nexusPhoneRecovery} onValueChange={setNexusPhoneRecovery}>
                            <SelectTrigger className="mt-1" data-testid="select-phone-recovery">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <Button
                          onClick={() => saveNexusDataMutation.mutate({
                            vehicleNumber: effectiveTruck!,
                            postOffboardedStatus: nexusStatus === '__none__' ? null : (nexusStatus || null),
                            nexusNewLocation: nexusLocation || null,
                            nexusNewLocationContact: nexusContact || null,
                            keys: nexusKeys === '__none__' ? null : (nexusKeys || null),
                            repaired: nexusRepaired === '__none__' ? null : (nexusRepaired || null),
                            comments: nexusComments || null,
                            phoneRecoveryInitiated: nexusPhoneRecovery === '__none__' ? null : (nexusPhoneRecovery || null),
                            toolsPartsLocation: nexusToolsLocation === '__none__' ? null : (nexusToolsLocation || null),
                            partsRecoveryInitiated: nexusPartsRecovery === '__none__' ? null : (nexusPartsRecovery || null),
                          })}
                          disabled={saveNexusDataMutation.isPending}
                          className="w-full"
                          data-testid="button-save-nexus-data"
                        >
                          {saveNexusDataMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4 mr-2" />
                          )}
                          Save Tracking Data
                        </Button>
                      </div>
                    )}
                  </div>
                  )}
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* BYOV Detail Drawer */}
      <Sheet open={!!selectedByovEntry} onOpenChange={(open) => !open && setSelectedByovEntry(null)}>
        <SheetContent className="w-[450px] sm:max-w-[450px] overflow-y-auto" data-testid="sheet-byov-detail">
          {selectedByovEntry && (
            <div className="space-y-6">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <CarFront className="h-5 w-5 text-blue-600" />
                  {selectedByovEntry.full_name || 'Unknown'}
                </SheetTitle>
                <SheetDescription>
                  {selectedByovEntry.enterprise_id?.toUpperCase()} • Truck {selectedByovEntry.truck_number || 'N/A'}
                </SheetDescription>
              </SheetHeader>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">BYOV Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={selectedByovEntry.status === 'approved' ? 'default' : 'secondary'} className="ml-2 capitalize">
                      {selectedByovEntry.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type:</span>
                    <span className="ml-2 capitalize">{selectedByovEntry.enrollment_type?.replace(/_/g, ' ') || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">District:</span>
                    <span className="ml-2">{selectedByovEntry.district || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="ml-2 font-mono">{selectedByovEntry.mobile_phone || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Home Address:</span>
                    <span className="ml-2">{selectedByovEntry.home_address || '-'}</span>
                  </div>
                </div>
              </div>

              {effectiveByovTruck ? (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Nexus Tracking
                    </h4>

                    {byovNexusLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Post-Offboarded Status</Label>
                          <Select value={byovNexusStatus} onValueChange={setByovNexusStatus}>
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="reserved_for_new_hire">Reserved for new hire</SelectItem>
                              <SelectItem value="in_repair">In repair</SelectItem>
                              <SelectItem value="declined_repair">Declined repair</SelectItem>
                              <SelectItem value="available_for_rental_pmf">Available to assign or send to PMF</SelectItem>
                              <SelectItem value="sent_to_pmf">Sent to PMF</SelectItem>
                              <SelectItem value="assigned_to_tech_in_rental">Assigned to rental</SelectItem>
                              <SelectItem value="assigned_to_tech">Assigned to tech</SelectItem>
                              <SelectItem value="not_found">Not found</SelectItem>
                              <SelectItem value="sent_to_auction">Sent to auction</SelectItem>
                              <SelectItem value="already_picked_up">Already picked up</SelectItem>
                              <SelectItem value="unable_to_reach">Unable to reach</SelectItem>
                              <SelectItem value="byov">BYOV</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">New Location</Label>
                          <Input
                            value={byovNexusLocation}
                            onChange={(e) => setByovNexusLocation(e.target.value)}
                            placeholder="Address or location description..."
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">New Location Contact</Label>
                          <Input
                            value={byovNexusContact}
                            onChange={(e) => setByovNexusContact(e.target.value)}
                            placeholder="Phone number or contact info..."
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Keys</Label>
                          <Select value={byovNexusKeys} onValueChange={setByovNexusKeys}>
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select keys status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="present">Present</SelectItem>
                              <SelectItem value="not_present">Not Present</SelectItem>
                              <SelectItem value="unknown">Unknown/Would not Check</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Repaired</Label>
                          <Select value={byovNexusRepaired} onValueChange={setByovNexusRepaired}>
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select repair status..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">-- None --</SelectItem>
                              <SelectItem value="complete">Complete</SelectItem>
                              <SelectItem value="in_process">In Process</SelectItem>
                              <SelectItem value="unknown_if_needed">Unknown if needed</SelectItem>
                              <SelectItem value="declined">Declined</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs text-muted-foreground">Comments</Label>
                          <Textarea
                            value={byovNexusComments}
                            onChange={(e) => setByovNexusComments(e.target.value.slice(0, 400))}
                            placeholder="Additional notes (max 400 characters)..."
                            className="mt-1 resize-none"
                            rows={3}
                            maxLength={400}
                          />
                          <p className="text-xs text-muted-foreground text-right mt-1">{byovNexusComments.length}/400</p>
                        </div>

                        <Button
                          onClick={() => saveByovNexusMutation.mutate({
                            vehicleNumber: effectiveByovTruck!,
                            postOffboardedStatus: byovNexusStatus === '__none__' ? null : (byovNexusStatus || null),
                            nexusNewLocation: byovNexusLocation || null,
                            nexusNewLocationContact: byovNexusContact || null,
                            keys: byovNexusKeys === '__none__' ? null : (byovNexusKeys || null),
                            repaired: byovNexusRepaired === '__none__' ? null : (byovNexusRepaired || null),
                            comments: byovNexusComments || null,
                          })}
                          disabled={saveByovNexusMutation.isPending}
                          className="w-full"
                        >
                          {saveByovNexusMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4 mr-2" />
                          )}
                          Save Tracking Data
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Separator />
                  <div className="text-sm text-muted-foreground text-center py-4">
                    <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                    No truck number available for this enrollment. Nexus tracking requires a truck number.
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Sheet open={!!selectedLoaEntry} onOpenChange={(open) => !open && setSelectedLoaEntry(null)}>
        <SheetContent className="w-[450px] sm:max-w-[450px] overflow-y-auto" data-testid="sheet-loa-detail">
          {selectedLoaEntry && (
            <div className="space-y-6">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                  {selectedLoaEntry.fullName || 'Unknown'}
                </SheetTitle>
                <SheetDescription>
                  {selectedLoaEntry.enterpriseId} • Truck {selectedLoaEntry.lastKnownTruck || (loaManualTruck.length === 5 ? loaManualTruck : 'N/A')}
                </SheetDescription>
              </SheetHeader>

              <Separator />

              <div className="space-y-3">
                <h4 className="font-medium text-sm text-muted-foreground">Employee Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <Badge
                      variant="outline"
                      className={`ml-2 text-xs ${
                        selectedLoaEntry.employmentStatus === 'L' ? 'bg-yellow-50 text-yellow-800 border-yellow-300' :
                        selectedLoaEntry.employmentStatus === 'P' ? 'bg-blue-50 text-blue-800 border-blue-300' :
                        'bg-red-50 text-red-800 border-red-300'
                      }`}
                    >
                      {selectedLoaEntry.employmentStatusLabel}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">District:</span>
                    <span className="ml-2">{selectedLoaEntry.district || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Job Title:</span>
                    <span className="ml-2">{selectedLoaEntry.jobTitle || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Planning Area:</span>
                    <span className="ml-2">{selectedLoaEntry.planningArea || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Phone (TPMS):</span>
                    <span className="ml-2 font-mono">{selectedLoaEntry.tpmsPhone || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Personal Number:</span>
                    <span className="ml-2 font-mono">{selectedLoaEntry.personalNumber || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Address (TPMS):</span>
                    <span className="ml-2">{selectedLoaEntry.tpmsAddress || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">TPMS Source:</span>
                    <span className="ml-2">{selectedLoaEntry.tpmsSource === 'TPMS_EXTRACT' ? 'Active' : selectedLoaEntry.tpmsSource === 'TPMS_EXTRACT_LAST_ASSIGNED' ? 'Last Assigned' : '-'}</span>
                  </div>
                </div>
              </div>

              <Separator />

              {!selectedLoaEntry.lastKnownTruck && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Assign Truck Number</Label>
                  <Input
                    value={loaManualTruck}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                      setLoaManualTruck(val);
                    }}
                    placeholder="Enter 5-digit truck #"
                    className="font-mono"
                    maxLength={5}
                  />
                  {loaManualTruck.length > 0 && loaManualTruck.length < 5 && (
                    <p className="text-xs text-amber-600">Enter all 5 digits to enable tracking fields</p>
                  )}
                </div>
              )}

              {effectiveLoaTruck ? (
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Nexus Tracking {!selectedLoaEntry.lastKnownTruck && effectiveLoaTruck && <span className="text-xs">— Truck {effectiveLoaTruck}</span>}
                  </h4>

                  {loaNexusLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Post-Offboarded Status</Label>
                        <Select value={loaNexusStatus} onValueChange={setLoaNexusStatus}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select status..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">-- None --</SelectItem>
                            <SelectItem value="reserved_for_new_hire">Reserved for new hire</SelectItem>
                            <SelectItem value="in_repair">In repair</SelectItem>
                            <SelectItem value="declined_repair">Declined repair</SelectItem>
                            <SelectItem value="available_for_rental_pmf">Available to assign or send to PMF</SelectItem>
                            <SelectItem value="sent_to_pmf">Sent to PMF</SelectItem>
                            <SelectItem value="assigned_to_tech_in_rental">Assigned to rental</SelectItem>
                            <SelectItem value="assigned_to_tech">Assigned to tech</SelectItem>
                            <SelectItem value="not_found">Not found</SelectItem>
                            <SelectItem value="sent_to_auction">Sent to auction</SelectItem>
                            <SelectItem value="already_picked_up">Already picked up</SelectItem>
                            <SelectItem value="unable_to_reach">Unable to reach</SelectItem>
                            <SelectItem value="loa_hold">LOA / Leave Hold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">New Location</Label>
                        <Input
                          value={loaNexusLocation}
                          onChange={(e) => setLoaNexusLocation(e.target.value)}
                          placeholder="Address or location description..."
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">New Location Contact</Label>
                        <Input
                          value={loaNexusContact}
                          onChange={(e) => setLoaNexusContact(e.target.value)}
                          placeholder="Phone number or contact info..."
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">Keys</Label>
                        <Select value={loaNexusKeys} onValueChange={setLoaNexusKeys}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select keys status..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">-- None --</SelectItem>
                            <SelectItem value="present">Present</SelectItem>
                            <SelectItem value="not_present">Not Present</SelectItem>
                            <SelectItem value="unknown">Unknown/Would not Check</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">Repaired</Label>
                        <Select value={loaNexusRepaired} onValueChange={setLoaNexusRepaired}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select repair status..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">-- None --</SelectItem>
                            <SelectItem value="complete">Complete</SelectItem>
                            <SelectItem value="in_process">In Process</SelectItem>
                            <SelectItem value="unknown_if_needed">Unknown if needed</SelectItem>
                            <SelectItem value="declined">Declined</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">Comments</Label>
                        <Textarea
                          value={loaNexusComments}
                          onChange={(e) => setLoaNexusComments(e.target.value.slice(0, 400))}
                          placeholder="Additional notes (max 400 characters)..."
                          className="mt-1 resize-none"
                          rows={3}
                          maxLength={400}
                        />
                        <p className="text-xs text-muted-foreground text-right mt-1">{loaNexusComments.length}/400</p>
                      </div>

                      <Button
                        onClick={() => saveLoaNexusMutation.mutate({
                          vehicleNumber: effectiveLoaTruck!,
                          postOffboardedStatus: loaNexusStatus === '__none__' ? null : (loaNexusStatus || null),
                          nexusNewLocation: loaNexusLocation || null,
                          nexusNewLocationContact: loaNexusContact || null,
                          keys: loaNexusKeys === '__none__' ? null : (loaNexusKeys || null),
                          repaired: loaNexusRepaired === '__none__' ? null : (loaNexusRepaired || null),
                          comments: loaNexusComments || null,
                        })}
                        disabled={saveLoaNexusMutation.isPending}
                        className="w-full"
                      >
                        {saveLoaNexusMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-2" />
                        )}
                        Save Tracking Data
                      </Button>
                    </div>
                  )}
                </div>
              ) : !selectedLoaEntry.lastKnownTruck ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                  Enter a truck number above to enable Nexus tracking.
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MainContent>
  );
}
