import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FleetVehicleTable } from "@/components/FleetVehicleTable";
import { USMapVehicles, type MapSelection, type MapFilters, type CategoryKey } from "@/components/USMapVehicles";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import { format, getISOWeek, getISOWeekYear } from "date-fns";
import { 
  Package,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Car,
  Wrench,
  Users,
  RefreshCw,
  Calendar,
  MapPin,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  X,
  CalendarCheck,
  Radio,
} from "lucide-react";

// Extract US state abbreviation from BYOV location string (e.g., "Deatsville, AL" -> "AL")
const extractStateFromLocation = (location: string): string => {
  if (!location) return '';
  // Match 2-letter state code at the end (e.g., ", AL" or " AL")
  const match = location.match(/,?\s*([A-Z]{2})$/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return '';
};

interface VehicleTableRow {
  vehicleNumber: string;
  assignmentStatus: string;
  generalStatus: string;
  subStatus: string;
  lastKnownLocation: string;
  locationSource: string;
  locationUpdatedAt: string | null;
  locationState: string;
  district: string;
  vin: string;
  makeName: string;
  modelName: string;
  interior: string;
  inventoryProductCategory: string;
  odometer: number | null;
  odometerDate: string | null;
}

interface AllVehiclesResponse {
  data: Array<{
    VEHICLE_NUMBER: string;
    VIN?: string;
    MAKE_NAME?: string;
    MODEL_NAME?: string;
    TRUCK_STATUS?: string;
    TRUCK_DISTRICT?: string;
    TPMS_ASSIGNED?: string;
  }>;
  vehicles?: VehicleTableRow[];
  totalCount: number;
  assignedCount: number;
  unassignedCount: number;
  pmf?: {
    totalInPmf: number;
    assigned: number;
    unassigned: number;
    matchedInFleet: number;
    notFoundInFleet?: number;
    notFoundByStatus?: Record<string, number>;
    assignedByStatus?: Record<string, number>;
    unassignedByStatus?: Record<string, number>;
    otherLocalParking?: {
      total: number;
      assigned: number;
      unassigned: number;
      declinedRepairs?: number;
    };
  };
  repairShop?: {
    total: number;
    assigned: number;
    unassigned: number;
    notInFleet: number;
    matchedInFleet: number;
    assignedByStatus?: Record<string, number>;
    unassignedByStatus?: Record<string, number>;
    categories?: {
      requiringEstimate: { assigned: number; unassigned: number };
      needEstimateApproval: { assigned: number; unassigned: number };
      awaitingPickup: { assigned: number; unassigned: number };
      undergoingRepairs: { assigned: number; unassigned: number };
      caseByCaseTroubleshooting: { assigned: number; unassigned: number };
      approvedForSale: { assigned: number; unassigned: number };
    };
  };
  byov?: {
    totalEnrolled: number;
    assigned: number;
    unassigned: number;
    notInFleet: number;
    tpmsAssigned: number;
    tpmsNotFound: number;
    technicians: Array<{
      name: string;
      truckId: string;
      location: string;
      enrollmentStatus: string;
      assignedInFleet: boolean;
      inTpms: boolean;
    }>;
  };
  rentalCount?: number;
  rentalTruckNumbers?: string[];
}

interface ByovWeeklySnapshot {
  id: string;
  capturedAt: string;
  capturedBy: string;
  weekNumber: number;
  weekYear: number;
  totalEnrolled: number;
  assignedInFleet: number;
  notInFleet: number;
}

interface ByovSnapshotsResponse {
  snapshots: ByovWeeklySnapshot[];
}

interface FleetWeeklySnapshot {
  id: string;
  capturedAt: string;
  capturedBy: string;
  weekNumber: number;
  weekYear: number;
  totalFleet: number;
  assignedCount: number;
  unassignedCount: number;
  pmfCount: number;
}

interface FleetSnapshotsResponse {
  snapshots: FleetWeeklySnapshot[];
}

interface PmfStatusWeeklySnapshot {
  id: string;
  capturedAt: string;
  capturedBy: string;
  weekNumber: number;
  weekYear: number;
  totalPmf: number;
  pendingArrival: number;
  lockedDownLocal: number;
  available: number;
  pendingPickup: number;
  checkedOut: number;
  otherStatus: number;
}

interface PmfStatusSnapshotsResponse {
  snapshots: PmfStatusWeeklySnapshot[];
}

interface RepairWeeklySnapshot {
  id: string;
  capturedAt: string;
  capturedBy: string;
  weekNumber: number;
  weekYear: number;
  totalInRepair: number;
  activeRepairs: number;
  completedThisWeek: number;
}

interface RepairSnapshotsResponse {
  snapshots: RepairWeeklySnapshot[];
}

const ACTIVE_DECLINED_REPAIRS = new Set([
  "61546","46838","46528","46794","46837","47135","61547","46880","21953","46546",
  "21960","36271","23070","36303","36144","61482","47154","61377","61015","36191",
  "61102","46539","46551","46502","61307","61317","46486","36024","36031","46482",
  "61100","61462","36023","36040","61312","61423","61478","36568","36572","21102",
  "46453","46396","37404","24009","21573","22311","61513","61607","61508","61143",
  "21195","61516","46437","61241","61126","46643","61551","46607","23466","21775",
  "37243","21705","47344","23674","47087","47022","47078","61746","47075","36422",
  "61569","47020","47023","37309","47072","36349","61747","61566","61784","47052",
  "47076","36387","61026","46741","61465","61203","61208","23221","61149","37233",
  "33001","33002","33003","33004","33005","46272","23207","46263","37223","46282",
  "46264","46279","46330","46249","61216","61212","61202","246091","21190","47163",
  "61406","61360","23474","46708","61232","23101","6214","46716","21528","21769",
  "21174","23470","46871","61368","61093","61726","47189","46866","61786","23535",
  "46949","21526","46845","46562","24107","46307","46371","46313","36096","36676",
  "36770","33006","61146","46363","21803","24097","21791","61688","46229","61681",
  "61682","61696","61683","36893","21808","61679","61684","23302","23743","46106",
  "46114","36988","47291","61188","61472","37000","23282","61192","88072","21079",
  "46015","46972","46990","36269","46755","23453","46748","47370","23823","36263",
  "22176","46957","46810","37059","36310","21672","21176","46797","61432","6610",
  "23254","36606","61351","47352","61330","46026","61453","37139","46873","61654",
  "37125","23467","23150","36665","46944","22412","36674","46066","47336","21187",
  "46905","21537","61721","36597","47252","36845","61272","47209","61223","23800",
  "47280","22391","46122","23740","21148","36726","36787","21448","6611","37350",
  "46027","24023","46079","21155","61823","61766","61257","23966","46245","61475",
  "61370","47315","47363","23680","21866","61792","61470","61265","61790","22380",
  "46559","36605","61365","61290",
]);

export default function AllVehicles() {
  const { currentUser } = useUser();
  const { toast } = useToast();
  const [weeklyTrendsOpen, setWeeklyTrendsOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<{generalStatus?: string; subStatus?: string; excludePmf?: boolean; isRental?: boolean; label: string} | null>(null);
  const [mapSelections, setMapSelections] = useState<MapSelection[]>([]);
  const [visibleMapCategories, setVisibleMapCategories] = useState<Set<CategoryKey>>(
    new Set(['onRoad', 'repairShop', 'pmf', 'byov', 'confirmedSpare', 'needsReconfirmation'] as CategoryKey[])
  );

  const handleMapFiltersChange = useCallback((filters: MapFilters) => {
    setMapSelections(filters.selections);
    setVisibleMapCategories(filters.visibleCategories);
  }, []);

  const { data, isLoading, error, refetch, isFetching } = useQuery<AllVehiclesResponse>({
    queryKey: ["/api/all-vehicles"],
  });

  const { data: byovSnapshots } = useQuery<ByovSnapshotsResponse>({
    queryKey: ["/api/byov/weekly-snapshots"],
  });

  const { data: fleetSnapshots } = useQuery<FleetSnapshotsResponse>({
    queryKey: ["/api/fleet/weekly-snapshots"],
  });

  const { data: pmfStatusSnapshots } = useQuery<PmfStatusSnapshotsResponse>({
    queryKey: ["/api/pmf-status/weekly-snapshots"],
  });

  const { data: repairSnapshots } = useQuery<RepairSnapshotsResponse>({
    queryKey: ["/api/repair/weekly-snapshots"],
  });

  const { data: weeklyRentalStats } = useQuery<Array<{weekYear: number; weekNumber: number; newRentals: number; rentalsReturned: number; totalImports: number}>>({
    queryKey: ["/api/rentals/weekly-stats"],
  });

  const { data: pickupsThisWeek } = useQuery<{ count: number; label: string }>({
    queryKey: ["/api/pickups-scheduled-this-week"],
  });

  const { data: pickupSnapshots } = useQuery<Array<{ id: string; captured_at: string; week_number: number; week_year: number; pickups_scheduled: number; week_label: string | null; truck_numbers: string[] | null }>>({
    queryKey: ["/api/pickup-weekly-snapshots"],
  });

  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingSnapshotValue, setEditingSnapshotValue] = useState<string>("");

  const updateSnapshotMutation = useMutation({
    mutationFn: async ({ id, pickupsScheduled }: { id: string; pickupsScheduled: number }) => {
      await apiRequest("PATCH", `/api/pickup-weekly-snapshots/${id}`, { pickupsScheduled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pickup-weekly-snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pickups-scheduled-this-week"] });
      setEditingSnapshotId(null);
      toast({ title: "Snapshot updated" });
    },
    onError: () => {
      toast({ title: "Failed to update snapshot", variant: "destructive" });
    },
  });

  const now = new Date();
  const currentWeek = { year: getISOWeekYear(now), week: getISOWeek(now) };
  const [manualWeekYear, setManualWeekYear] = useState(currentWeek.year);
  const [manualWeekNumber, setManualWeekNumber] = useState(currentWeek.week);
  const [manualNewRentals, setManualNewRentals] = useState<string>("");
  const [manualReturned, setManualReturned] = useState<string>("");
  const [showRentalInput, setShowRentalInput] = useState(false);

  const saveManualRentalMutation = useMutation({
    mutationFn: async (data: { weekYear: number; weekNumber: number; newRentals: number; rentalsReturned: number }) => {
      const response = await apiRequest("POST", "/api/rentals/weekly-manual", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rentals/weekly-stats"] });
      toast({ title: "Saved", description: `W${manualWeekNumber} data saved successfully` });
      setManualNewRentals("");
      setManualReturned("");
      setShowRentalInput(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const { data: pmfData } = useQuery<{ rows: Array<{ status: string; assetId: string }> }>({
    queryKey: ["/api/pmf"],
  });

  const captureSnapshotMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/byov/capture-snapshot", { capturedBy: currentUser });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/byov/weekly-snapshots"] });
      toast({ title: "Snapshot captured", description: "BYOV weekly snapshot saved successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const pmfPipelineCounts = useMemo(() => {
    if (!pmfData?.rows) return null;
    const statusCounts: Record<string, number> = {};
    for (const v of pmfData.rows) {
      const s = v.status || 'Unknown';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    const excludedStatuses = ["Unavailable"];
    const displayOrder = [
      { key: "Pending Arrival", label: "Pending Arrival" },
      { key: "Locked down local", label: "In Process" },
      { key: "Available", label: "Available" },
      { key: "Approved to Pick Up", label: "Approved to Pick Up" },
    ];
    const breakdown = displayOrder
      .map(({ key, label }) => ({ label, count: statusCounts[key] || 0 }))
      .filter(item => item.count > 0);
    const otherCount = Object.entries(statusCounts)
      .filter(([s]) => !displayOrder.some(d => d.key === s) && !excludedStatuses.includes(s))
      .reduce((sum, [, c]) => sum + c, 0);
    if (otherCount > 0) {
      breakdown.push({ label: "Other", count: otherCount });
    }
    const totalExcludingDeployed = Object.entries(statusCounts)
      .filter(([s]) => !excludedStatuses.includes(s))
      .reduce((sum, [, c]) => sum + c, 0);
    return { total: totalExcludingDeployed, breakdown };
  }, [pmfData?.rows]);

  const locationCounts = useMemo(() => {
    if (!data?.vehicles) return null;
    const vehicles = data.vehicles;
    
    let onRoad = 0;
    let repairShop = 0;
    let pmfTotal = 0;
    let otherParking = 0;
    
    const repairStatuses: Record<string, number> = {};
    
    for (const v of vehicles) {
      if (v.generalStatus === 'On Road') {
        onRoad++;
      } else if (v.generalStatus === 'Vehicles in a repair shop') {
        repairShop++;
        const sub = v.subStatus || 'Unknown';
        repairStatuses[sub] = (repairStatuses[sub] || 0) + 1;
      } else if (v.generalStatus === 'PMF') {
        pmfTotal++;
      } else if (v.generalStatus === 'Vehicles in storage') {
        const lower = (v.subStatus || '').toLowerCase();
        const isPmf = lower.includes('pmf') || lower.includes('process at pmf') || lower.includes('available to redeploy') || lower.includes('pending pickup') || lower.includes('pending arrival') || lower.includes('locked down');
        if (isPmf) {
          pmfTotal++;
        } else {
          otherParking++;
        }
      } else {
        onRoad++;
      }
    }
    
    return { onRoad, repairShop, pmfTotal, otherParking, repairStatuses, total: vehicles.length };
  }, [data?.vehicles]);

  const rentalTruckSet = useMemo(() => {
    if (!data?.rentalTruckNumbers) return new Set<string>();
    return new Set(data.rentalTruckNumbers.map(n => n.toString().padStart(6, '0')));
  }, [data?.rentalTruckNumbers]);

  const rentalCountInFleet = useMemo(() => {
    if (!data?.vehicles || rentalTruckSet.size === 0) return 0;
    return data.vehicles.filter(v => rentalTruckSet.has(v.vehicleNumber?.toString().padStart(6, '0'))).length;
  }, [data?.vehicles, rentalTruckSet]);

  const rentalsByState = useMemo(() => {
    if (!data?.vehicles || rentalTruckSet.size === 0) return {};
    const byState: Record<string, number> = {};
    for (const v of data.vehicles) {
      if (rentalTruckSet.has(v.vehicleNumber?.toString().padStart(6, '0'))) {
        const state = v.locationState?.toUpperCase().trim();
        if (state) {
          byState[state] = (byState[state] || 0) + 1;
        }
      }
    }
    return byState;
  }, [data?.vehicles, rentalTruckSet]);

  const rentalChartData = useMemo(() => {
    if (!weeklyRentalStats) return [];
    return weeklyRentalStats
      .slice(0, 8)
      .reverse()
      .map(w => ({
        name: `W${w.weekNumber}`,
        weekNumber: w.weekNumber,
        weekYear: w.weekYear,
        newRentals: w.newRentals,
        rentalsReturned: w.rentalsReturned,
      }));
  }, [weeklyRentalStats]);

  const samsaraStats = useMemo(() => {
    if (!data?.vehicles) return null;
    const counts = { active: 0, inactive: 0, unplugged: 0, notInstalled: 0, total: 0 };
    for (const v of data.vehicles) {
      counts.total++;
      const status = (v as any).samsaraStatus || 'Not Installed';
      if (status === 'Active') counts.active++;
      else if (status === 'Inactive') counts.inactive++;
      else if (status === 'Inactive/Unplugged') counts.unplugged++;
      else counts.notInstalled++;
    }
    const installed = counts.active + counts.inactive + counts.unplugged;
    const penetration = counts.total > 0 ? Math.round((installed / counts.total) * 1000) / 10 : 0;
    return { ...counts, installed, penetration };
  }, [data?.vehicles]);

  const handleCrackdownExport = useCallback(() => {
    if (!data?.vehicles) return;
    const vehicles = data.vehicles as any[];
    const unplugged = vehicles.filter((v: any) => v.samsaraStatus === 'Inactive/Unplugged');

    const getDaysDark = (v: any) => {
      if (!v.lastSamsaraSignal) return 9999;
      return Math.floor((Date.now() - new Date(v.lastSamsaraSignal).getTime()) / 86400000);
    };

    const onRoadAssigned = unplugged.filter((v: any) =>
      v.assignmentStatus === 'Assigned' && v.generalStatus === 'On Road'
    );
    const bucket1 = onRoadAssigned.filter((v: any) => getDaysDark(v) >= 90).map((v: any) => ({ ...v, bucket: 1, bucketLabel: '1 - Immediate Contact Required (On Road + Assigned + 90d+)' }));
    const bucket2 = onRoadAssigned.filter((v: any) => { const d = getDaysDark(v); return d >= 30 && d < 90; }).map((v: any) => ({ ...v, bucket: 2, bucketLabel: '2 - Follow Up Required (On Road + Assigned + 30-90d)' }));
    const bucket3 = onRoadAssigned.filter((v: any) => { const d = getDaysDark(v); return d >= 7 && d < 30; }).map((v: any) => ({ ...v, bucket: 3, bucketLabel: '3 - Recent Drop-off (On Road + Assigned + 7-30d)' }));
    const complianceRows = [...bucket1, ...bucket2, ...bucket3].sort((a, b) => a.bucket - b.bucket || getDaysDark(b) - getDaysDark(a));

    const repairShop = unplugged.filter((v: any) =>
      v.generalStatus?.toLowerCase() === 'vehicles in a repair shop'
    );

    const fleetCoord = unplugged.filter((v: any) =>
      v.generalStatus?.toLowerCase() === 'vehicles in storage' && getDaysDark(v) >= 90
    );

    const districtCounts: Record<string, number> = {};
    bucket1.forEach((v: any) => { districtCounts[v.district || 'Unknown'] = (districtCounts[v.district || 'Unknown'] || 0) + 1; });
    const top5Districts = Object.entries(districtCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const wb = XLSX.utils.book_new();

    const headerStyle = { font: { bold: true, color: { rgb: 'FFFFFF' }, name: 'Arial', sz: 10 }, fill: { fgColor: { rgb: '1F3864' } } };

    const summaryData = [
      ['Samsara Crackdown Report', format(new Date(), 'yyyy-MM-dd')],
      [],
      ['Metric', 'Count'],
      ['Total Inactive/Unplugged Devices', unplugged.length],
      ['On Road with Assigned Tech (Buckets 1-3)', complianceRows.length],
      ['In Repair Shop (Bucket 5)', repairShop.length],
      ['Unassigned Storage (Bucket 4)', fleetCoord.length],
      ['Devices Dark 90+ Days', unplugged.filter((v: any) => getDaysDark(v) >= 90).length],
      [],
      ['Bucket Breakdown', ''],
      ['Bucket 1 - Immediate (90d+)', bucket1.length],
      ['Bucket 2 - Follow Up (30-90d)', bucket2.length],
      ['Bucket 3 - Recent (7-30d)', bucket3.length],
      ['Bucket 4 - Fleet Coordinator (Storage 90d+)', fleetCoord.length],
      ['Bucket 5 - Repair Shop', repairShop.length],
      [],
      ['Top 5 Districts by Bucket 1', ''],
      ...top5Districts.map(([d, c]) => [d, c]),
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 45 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    const compHeaders = ['Priority', 'Tech Name', 'Phone', 'Vehicle #', 'Tech ID', 'District', 'State', 'Category', 'Status', 'Sub Status', 'Days Dark', 'Last Signal'];
    const compData = [compHeaders, ...complianceRows.map((v: any) => [
      v.bucketLabel, v.technicianName || '', v.technicianPhone || '', v.vehicleNumber || '',
      v.technicianNo || '', v.district || '', v.locationState || '', v.inventoryProductCategory || '',
      v.generalStatus || '', v.subStatus || '', getDaysDark(v), v.lastSamsaraSignal ? format(new Date(v.lastSamsaraSignal), 'yyyy-MM-dd HH:mm') : ''
    ])];
    const wsComp = XLSX.utils.aoa_to_sheet(compData);
    wsComp['!cols'] = compHeaders.map(h => ({ wch: h === 'Priority' ? 55 : h === 'Last Signal' ? 18 : 15 }));
    wsComp['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: compData.length - 1, c: compHeaders.length - 1 } }) };
    const bucketColors: Record<number, string> = { 1: 'FFCCCC', 2: 'FFE5CC', 3: 'FFFACC' };
    complianceRows.forEach((v, i) => {
      const rowIdx = i + 1;
      compHeaders.forEach((_, ci) => {
        const cell = wsComp[XLSX.utils.encode_cell({ r: rowIdx, c: ci })];
        if (cell) cell.s = { fill: { fgColor: { rgb: bucketColors[v.bucket] } }, font: { name: 'Arial', sz: 10 } };
      });
    });
    compHeaders.forEach((_, ci) => {
      const cell = wsComp[XLSX.utils.encode_cell({ r: 0, c: ci })];
      if (cell) cell.s = headerStyle;
    });
    XLSX.utils.book_append_sheet(wb, wsComp, 'Compliance Action');

    const repHeaders = ['Vehicle #', 'Tech Name', 'Phone', 'Tech ID', 'District', 'State', 'Category', 'Sub Status', 'Days Dark', 'Last Signal'];
    const repData = [repHeaders, ...repairShop.map((v: any) => [
      v.vehicleNumber || '', v.technicianName || '', v.technicianPhone || '', v.technicianNo || '',
      v.district || '', v.locationState || '', v.inventoryProductCategory || '',
      v.subStatus || '', getDaysDark(v), v.lastSamsaraSignal ? format(new Date(v.lastSamsaraSignal), 'yyyy-MM-dd HH:mm') : ''
    ])];
    const wsRep = XLSX.utils.aoa_to_sheet(repData);
    wsRep['!cols'] = repHeaders.map(() => ({ wch: 18 }));
    wsRep['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: repData.length - 1, c: repHeaders.length - 1 } }) };
    repairShop.forEach((_, i) => {
      const rowIdx = i + 1;
      repHeaders.forEach((__, ci) => {
        const cell = wsRep[XLSX.utils.encode_cell({ r: rowIdx, c: ci })];
        if (cell) cell.s = { fill: { fgColor: { rgb: 'D4EDDA' } }, font: { name: 'Arial', sz: 10 } };
      });
    });
    repHeaders.forEach((_, ci) => {
      const cell = wsRep[XLSX.utils.encode_cell({ r: 0, c: ci })];
      if (cell) cell.s = headerStyle;
    });
    XLSX.utils.book_append_sheet(wb, wsRep, 'Repair Shop');

    const fleetHeaders = ['Priority', 'Vehicle #', 'District', 'State', 'Category', 'General Status', 'Sub Status', 'Days Dark', 'Last Signal'];
    const fleetData = [fleetHeaders, ...fleetCoord.sort((a: any, b: any) => getDaysDark(b) - getDaysDark(a)).map((v: any) => [
      'Storage 90d+ - Fleet Coordinator Review', v.vehicleNumber || '', v.district || '', v.locationState || '',
      v.inventoryProductCategory || '', v.generalStatus || '', v.subStatus || '',
      getDaysDark(v), v.lastSamsaraSignal ? format(new Date(v.lastSamsaraSignal), 'yyyy-MM-dd HH:mm') : ''
    ])];
    const wsFleet = XLSX.utils.aoa_to_sheet(fleetData);
    wsFleet['!cols'] = fleetHeaders.map(h => ({ wch: h === 'Priority' ? 40 : 18 }));
    wsFleet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: fleetData.length - 1, c: fleetHeaders.length - 1 } }) };
    fleetCoord.forEach((_, i) => {
      const rowIdx = i + 1;
      fleetHeaders.forEach((__, ci) => {
        const cell = wsFleet[XLSX.utils.encode_cell({ r: rowIdx, c: ci })];
        if (cell) cell.s = { fill: { fgColor: { rgb: 'CCE0FF' } }, font: { name: 'Arial', sz: 10 } };
      });
    });
    fleetHeaders.forEach((_, ci) => {
      const cell = wsFleet[XLSX.utils.encode_cell({ r: 0, c: ci })];
      if (cell) cell.s = headerStyle;
    });
    XLSX.utils.book_append_sheet(wb, wsFleet, 'Fleet Coordinator');

    const fileName = `samsara_crackdown_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }, [data?.vehicles]);

  return (
    <div className="bg-background">
      <main className="p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-page-title">All Vehicles</h1>
              <p className="text-sm text-muted-foreground">
                Vehicle assignment status from REPLIT_ALL_VEHICLES
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              {isFetching ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {error && (
            <Card className="border-destructive mb-4">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">Error loading vehicle data: {(error as Error).message}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="grid gap-4 grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              {categoryFilter && (
                <div className="flex items-center gap-2" data-testid="category-filter-indicator">
                  <span className="text-sm text-muted-foreground">Filtering table by:</span>
                  <Badge variant="secondary" className="gap-1">
                    {categoryFilter.label}
                    <button
                      onClick={() => setCategoryFilter(null)}
                      className="ml-1"
                      data-testid="button-clear-category-filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                </div>
              )}

              {/* Row 1: Total Fleet + 4 Location Cards */}
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
                {/* Card A - Total Fleet */}
                <Card data-testid="card-total-fleet">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Total Fleet</p>
                        <div className="text-2xl font-bold" data-testid="text-total-count">
                          {data.totalCount.toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Excludes Declined/Auction vehicles
                        </p>
                        <div className="text-2xl font-bold mt-2" data-testid="text-active-declined-repairs">
                          {ACTIVE_DECLINED_REPAIRS.size.toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Declined Repairs
                        </p>
                      </div>
                      <Car className="h-8 w-8 text-muted-foreground opacity-50" />
                    </div>
                  </CardContent>
                </Card>

                {/* Card B - On Road */}
                {locationCounts && (
                  <Card
                    className={`cursor-pointer hover-elevate border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 ${categoryFilter?.label === 'On Road' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setCategoryFilter({ generalStatus: 'On Road', label: 'On Road' })}
                    data-testid="card-on-road"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-green-700 dark:text-green-400">On Road</p>
                      <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-on-road-count">
                        {locationCounts.onRoad.toLocaleString()}
                      </div>
                      <p className="text-xs text-green-600 dark:text-green-500">
                        {((locationCounts.onRoad / locationCounts.total) * 100).toFixed(1)}% of total
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Card C - Repair Shop */}
                {locationCounts && (
                  <Card
                    className={`cursor-pointer hover-elevate border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 ${categoryFilter?.label === 'Repair Shop' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setCategoryFilter({ generalStatus: 'Vehicles in a repair shop', label: 'Repair Shop' })}
                    data-testid="card-repair-shop"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Repair Shop</p>
                      <div className="text-2xl font-bold text-amber-700 dark:text-amber-400" data-testid="text-repair-shop-count">
                        {locationCounts.repairShop.toLocaleString()}
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        {((locationCounts.repairShop / locationCounts.total) * 100).toFixed(1)}% of total
                      </p>
                      {Object.keys(locationCounts.repairStatuses).length > 0 && (
                        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-700 space-y-0.5">
                          {Object.entries(locationCounts.repairStatuses)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 6)
                            .map(([status, count]) => (
                              <div
                                key={status}
                                className="flex justify-between text-xs text-amber-600 dark:text-amber-500 cursor-pointer hover-elevate rounded px-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCategoryFilter({ generalStatus: 'Vehicles in a repair shop', subStatus: status, label: `Repair: ${status}` });
                                }}
                                data-testid={`filter-repair-${status.replace(/\s+/g, '-').toLowerCase()}`}
                              >
                                <span className="truncate">{status}</span>
                                <span className="font-medium ml-2">{count}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Card D - PMF */}
                {pmfPipelineCounts && (
                  <Card
                    className={`cursor-pointer hover-elevate border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 ${categoryFilter?.label === 'PMF Vehicles' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setCategoryFilter({ generalStatus: 'PMF', label: 'PMF Vehicles' })}
                    data-testid="card-pmf"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">PMF</p>
                      <div className="text-2xl font-bold text-blue-700 dark:text-blue-400" data-testid="text-pmf-count">
                        {pmfPipelineCounts.total.toLocaleString()}
                      </div>
                      <p className="text-xs text-blue-600 dark:text-blue-500">
                        {locationCounts ? ((pmfPipelineCounts.total / locationCounts.total) * 100).toFixed(1) : '0.0'}% of total
                      </p>
                      {pmfPipelineCounts.breakdown.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700 space-y-0.5">
                          {pmfPipelineCounts.breakdown.map(({ label, count }) => (
                            <div
                              key={label}
                              className="flex justify-between gap-1 text-xs text-blue-600 dark:text-blue-500"
                              data-testid={`filter-pmf-${label.replace(/\s+/g, '-').toLowerCase()}`}
                            >
                              <span className="truncate">{label}</span>
                              <span className="font-medium ml-2">{count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Card E - Other Parking */}
                {locationCounts && (
                  <Card
                    className={`cursor-pointer hover-elevate border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 ${categoryFilter?.label === 'Other Parking' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setCategoryFilter({ generalStatus: 'Vehicles in storage', excludePmf: true, label: 'Other Parking' })}
                    data-testid="card-other-parking"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-purple-700 dark:text-purple-400">Other Parking</p>
                      <div className="text-2xl font-bold text-purple-700 dark:text-purple-400" data-testid="text-other-parking-count">
                        {locationCounts.otherParking.toLocaleString()}
                      </div>
                      <p className="text-xs text-purple-600 dark:text-purple-500">
                        {((locationCounts.otherParking / locationCounts.total) * 100).toFixed(1)}% of total
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Card F - Rentals */}
                {data.rentalCount !== undefined && data.rentalCount > 0 && (
                  <Card
                    className={`cursor-pointer hover-elevate border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 ${categoryFilter?.label === 'Rentals' ? 'ring-2 ring-primary' : ''}`}
                    onClick={() => setCategoryFilter({ isRental: true, label: 'Rentals' })}
                    data-testid="card-rentals"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs font-medium text-rose-700 dark:text-rose-400">Rentals</p>
                      <div className="text-2xl font-bold text-rose-700 dark:text-rose-400" data-testid="text-rental-count-card">
                        {rentalCountInFleet.toLocaleString()}
                      </div>
                      <p className="text-xs text-rose-600 dark:text-rose-500">
                        {locationCounts ? ((rentalCountInFleet / locationCounts.total) * 100).toFixed(1) : '0.0'}% of total
                      </p>
                      {data.rentalCount > rentalCountInFleet && (
                        <p className="text-[10px] text-rose-500 dark:text-rose-600 mt-1">
                          {data.rentalCount} total ({data.rentalCount - rentalCountInFleet} declined and not in active total fleet)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Row 2: Rental Trend Chart + BYOV */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Rental Vehicles Outstanding + Trend Chart */}
                {data.rentalCount !== undefined && data.rentalCount > 0 && (
                  <Card data-testid="card-rental-section">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Car className="w-4 h-4 text-purple-600" />
                          Rental Vehicles Outstanding
                        </CardTitle>
                        <div className="text-2xl font-bold text-purple-700 dark:text-purple-400" data-testid="text-rental-count">
                          {data.rentalCount.toLocaleString()}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Total vehicles currently in the repair dashboard (rentals outstanding)
                      </p>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      {rentalChartData.length > 0 && (
                        <div data-testid="chart-rental-trends" style={{ width: '100%', height: 200 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={rentalChartData}
                              margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                              onClick={(state) => {
                                if (state?.activePayload?.[0]?.payload) {
                                  const clicked = state.activePayload[0].payload;
                                  setManualWeekNumber(clicked.weekNumber);
                                  setManualWeekYear(clicked.weekYear);
                                  setManualNewRentals(String(clicked.newRentals || ""));
                                  setManualReturned(String(clicked.rentalsReturned || ""));
                                  setShowRentalInput(true);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} />
                              <Tooltip />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Bar dataKey="newRentals" name="New Rentals" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                              <Bar dataKey="rentalsReturned" name="Returned" fill="#22c55e" radius={[2, 2, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          <p className="text-[10px] text-muted-foreground text-center mt-1">Click a bar to edit its data</p>
                        </div>
                      )}
                      {showRentalInput && (
                        <div className="border-t pt-3 mt-3" data-testid="rental-input-panel">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Edit W{manualWeekNumber} / {manualWeekYear}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setShowRentalInput(false)}
                              data-testid="button-close-rental-input"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Week #</label>
                              <Input
                                type="number"
                                min={1}
                                max={53}
                                value={manualWeekNumber}
                                onChange={(e) => setManualWeekNumber(parseInt(e.target.value) || 1)}
                                className="h-8 w-16 text-xs"
                                data-testid="input-manual-week"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Year</label>
                              <Input
                                type="number"
                                min={2024}
                                max={2030}
                                value={manualWeekYear}
                                onChange={(e) => setManualWeekYear(parseInt(e.target.value) || 2026)}
                                className="h-8 w-20 text-xs"
                                data-testid="input-manual-year"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-blue-600">New Rentals</label>
                              <Input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={manualNewRentals}
                                onChange={(e) => setManualNewRentals(e.target.value)}
                                className="h-8 w-20 text-xs"
                                data-testid="input-manual-new-rentals"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-green-600">Returned</label>
                              <Input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={manualReturned}
                                onChange={(e) => setManualReturned(e.target.value)}
                                className="h-8 w-20 text-xs"
                                data-testid="input-manual-returned"
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={saveManualRentalMutation.isPending}
                              onClick={() => {
                                saveManualRentalMutation.mutate({
                                  weekYear: manualWeekYear,
                                  weekNumber: manualWeekNumber,
                                  newRentals: parseInt(manualNewRentals) || 0,
                                  rentalsReturned: parseInt(manualReturned) || 0,
                                });
                              }}
                              data-testid="button-save-manual-rental"
                            >
                              {saveManualRentalMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* BYOV Weekly Enrollment History */}
                {byovSnapshots?.snapshots && byovSnapshots.snapshots.length > 0 && (
                  <Card data-testid="card-byov-section">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Users className="w-4 h-4 text-teal-600" />
                          BYOV Weekly Enrollment History
                        </CardTitle>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => captureSnapshotMutation.mutate()}
                          disabled={captureSnapshotMutation.isPending}
                          className="gap-1 h-7 text-xs"
                          data-testid="button-capture-byov-snapshot"
                        >
                          {captureSnapshotMutation.isPending ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Calendar className="w-3 h-3" />
                          )}
                          Capture Week
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs" data-testid="table-byov-weekly">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 px-2 font-medium">Week</th>
                              <th className="text-right py-1 px-2 font-medium">Enrolled</th>
                              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Captured</th>
                            </tr>
                          </thead>
                          <tbody>
                            {byovSnapshots.snapshots.map((snapshot) => (
                              <tr key={snapshot.id} className="border-b border-muted/50 hover:bg-muted/30">
                                <td className="py-1.5 px-2 font-medium">
                                  Week {snapshot.weekNumber}, {snapshot.weekYear}
                                </td>
                                <td className="py-1.5 px-2 text-right font-semibold text-teal-600">
                                  {snapshot.totalEnrolled}
                                </td>
                                <td className="py-1.5 px-2 text-right text-muted-foreground">
                                  {new Date(snapshot.capturedAt).toLocaleDateString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Pickups Scheduled This Week - For rental return */}
                <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" data-testid="card-pickups-scheduled">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <CalendarCheck className="w-4 h-4 text-green-600" />
                        Pickups Scheduled This Week - For rental return
                      </CardTitle>
                      <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-pickups-count">
                        {pickupsThisWeek?.count ?? 0}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Unique vehicles with pickup slot booked &amp; time set ({pickupsThisWeek?.label ?? "Sat–Fri"})
                    </p>
                  </CardHeader>
                  {pickupSnapshots && pickupSnapshots.length > 0 && (
                    <CardContent className="px-4 pb-3 pt-0">
                      <div className="mt-2 border-t border-green-200 dark:border-green-800 pt-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Weekly History</p>
                        <div className="max-h-40 overflow-y-auto">
                          <table className="w-full text-xs" data-testid="table-pickup-weekly-history">
                            <thead>
                              <tr className="text-muted-foreground border-b border-muted/50">
                                <th className="text-left py-1 font-medium">Week</th>
                                <th className="text-left py-1 font-medium">Dates</th>
                                <th className="text-right py-1 font-medium">Scheduled</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pickupSnapshots.map((snapshot) => (
                                <tr key={snapshot.id} className="border-b border-muted/50 hover:bg-muted/30">
                                  <td className="py-1">W{snapshot.week_number} {snapshot.week_year}</td>
                                  <td className="py-1">{snapshot.week_label || "—"}</td>
                                  <td className="py-1 text-right font-semibold text-green-700 dark:text-green-400">
                                    {editingSnapshotId === snapshot.id ? (
                                      <span className="inline-flex items-center gap-1">
                                        <Input
                                          type="number"
                                          value={editingSnapshotValue}
                                          onChange={(e) => setEditingSnapshotValue(e.target.value)}
                                          className="w-14 h-6 text-xs text-right p-1"
                                          data-testid={`input-edit-snapshot-${snapshot.id}`}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const val = parseInt(editingSnapshotValue);
                                              if (!isNaN(val) && val >= 0) {
                                                updateSnapshotMutation.mutate({ id: snapshot.id, pickupsScheduled: val });
                                              }
                                            }
                                            if (e.key === 'Escape') setEditingSnapshotId(null);
                                          }}
                                          autoFocus
                                        />
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-5 w-5"
                                          onClick={() => {
                                            const val = parseInt(editingSnapshotValue);
                                            if (!isNaN(val) && val >= 0) {
                                              updateSnapshotMutation.mutate({ id: snapshot.id, pickupsScheduled: val });
                                            }
                                          }}
                                          data-testid={`button-save-snapshot-${snapshot.id}`}
                                        >
                                          <CheckCircle className="w-3 h-3" />
                                        </Button>
                                      </span>
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:underline"
                                        onClick={() => {
                                          setEditingSnapshotId(snapshot.id);
                                          setEditingSnapshotValue(String(snapshot.pickups_scheduled));
                                        }}
                                        title="Click to edit count"
                                        data-testid={`text-snapshot-count-${snapshot.id}`}
                                      >
                                        {snapshot.pickups_scheduled}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {samsaraStats && (
                  <Card data-testid="card-samsara-penetration">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Radio className="w-4 h-4 text-indigo-600" />
                          Samsara Penetration
                        </CardTitle>
                        <div className="text-2xl font-bold text-indigo-700 dark:text-indigo-400" data-testid="text-samsara-penetration">
                          {samsaraStats.penetration}%
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {samsaraStats.installed.toLocaleString()} of {samsaraStats.total.toLocaleString()} vehicles have Samsara installed
                      </p>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                            <span>Active</span>
                          </div>
                          <span className="font-semibold text-green-600" data-testid="text-samsara-active">{samsaraStats.active.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                            <span>Inactive</span>
                          </div>
                          <span className="font-semibold text-amber-600" data-testid="text-samsara-inactive">{samsaraStats.inactive.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                            <span>Inactive / Unplugged</span>
                          </div>
                          <span className="font-semibold text-red-600" data-testid="text-samsara-unplugged">{samsaraStats.unplugged.toLocaleString()}</span>
                        </div>
                        <div className="border-t pt-2 mt-2">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0" />
                              <span>Not Installed</span>
                            </div>
                            <span className="font-semibold text-muted-foreground" data-testid="text-samsara-not-installed">{samsaraStats.notInstalled.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2">
                          <div className="h-full flex">
                            {samsaraStats.total > 0 && (
                              <>
                                <div
                                  className="bg-green-500 h-full"
                                  style={{ width: `${(samsaraStats.active / samsaraStats.total) * 100}%` }}
                                  title={`Active: ${samsaraStats.active}`}
                                />
                                <div
                                  className="bg-amber-500 h-full"
                                  style={{ width: `${(samsaraStats.inactive / samsaraStats.total) * 100}%` }}
                                  title={`Inactive: ${samsaraStats.inactive}`}
                                />
                                <div
                                  className="bg-red-500 h-full"
                                  style={{ width: `${(samsaraStats.unplugged / samsaraStats.total) * 100}%` }}
                                  title={`Inactive/Unplugged: ${samsaraStats.unplugged}`}
                                />
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-3"
                          onClick={handleCrackdownExport}
                          data-testid="button-crackdown-export"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Crackdown Export ({samsaraStats.unplugged.toLocaleString()} unplugged)
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Weekly Tracker Tables - Fleet, PMF Status, Repair (Collapsible) */}
              <Collapsible open={weeklyTrendsOpen} onOpenChange={setWeeklyTrendsOpen} className="mt-4">
                <CollapsibleTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between"
                    data-testid="button-toggle-weekly-trends"
                  >
                    <span className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Weekly Trends (Fleet, PMF Status, Repairs)
                      <span className="text-xs text-muted-foreground italic">— in development</span>
                    </span>
                    {weeklyTrendsOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
                {/* Fleet Weekly Trends */}
                {fleetSnapshots?.snapshots && fleetSnapshots.snapshots.length > 0 && (
                  <Card data-testid="card-fleet-weekly">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Car className="w-4 h-4 text-blue-600" />
                        Fleet Weekly Trends
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs" data-testid="table-fleet-weekly">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 px-2 font-medium">Week</th>
                              <th className="text-right py-1 px-2 font-medium text-green-600">Assigned</th>
                              <th className="text-right py-1 px-2 font-medium text-orange-600">Unassigned</th>
                              <th className="text-right py-1 px-2 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fleetSnapshots.snapshots.map((snapshot) => (
                              <tr key={snapshot.id} className="border-b border-muted/50 hover:bg-muted/30">
                                <td className="py-1.5 px-2 font-medium">
                                  Wk {snapshot.weekNumber}
                                </td>
                                <td className="py-1.5 px-2 text-right text-green-600">
                                  {snapshot.assignedCount.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-2 text-right text-orange-600">
                                  {snapshot.unassignedCount.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-2 text-right font-semibold">
                                  {snapshot.totalFleet.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* PMF Status Weekly History */}
                {pmfStatusSnapshots?.snapshots && pmfStatusSnapshots.snapshots.length > 0 && (
                  <Card data-testid="card-pmf-weekly">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Package className="w-4 h-4 text-purple-600" />
                        PMF Status Weekly
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs" data-testid="table-pmf-weekly">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 px-1 font-medium">Week</th>
                              <th className="text-right py-1 px-1 font-medium text-amber-600" title="Pending Arrival">PA</th>
                              <th className="text-right py-1 px-1 font-medium text-blue-600" title="Locked Down">LD</th>
                              <th className="text-right py-1 px-1 font-medium text-green-600" title="Available">Avl</th>
                              <th className="text-right py-1 px-1 font-medium text-orange-600" title="Pending Pickup">PP</th>
                              <th className="text-right py-1 px-1 font-medium text-gray-600" title="Checked Out">Out</th>
                              <th className="text-right py-1 px-1 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pmfStatusSnapshots.snapshots.map((snapshot) => (
                              <tr key={snapshot.id} className="border-b border-muted/50 hover:bg-muted/30">
                                <td className="py-1.5 px-1 font-medium">
                                  Wk {snapshot.weekNumber}
                                </td>
                                <td className="py-1.5 px-1 text-right text-amber-600">
                                  {snapshot.pendingArrival}
                                </td>
                                <td className="py-1.5 px-1 text-right text-blue-600">
                                  {snapshot.lockedDownLocal}
                                </td>
                                <td className="py-1.5 px-1 text-right text-green-600">
                                  {snapshot.available}
                                </td>
                                <td className="py-1.5 px-1 text-right text-orange-600">
                                  {snapshot.pendingPickup}
                                </td>
                                <td className="py-1.5 px-1 text-right text-gray-600">
                                  {snapshot.checkedOut}
                                </td>
                                <td className="py-1.5 px-1 text-right font-semibold">
                                  {snapshot.totalPmf}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Repair Weekly History */}
                {repairSnapshots?.snapshots && repairSnapshots.snapshots.length > 0 && (
                  <Card data-testid="card-repair-weekly">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-red-600" />
                        Repairs Weekly
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs" data-testid="table-repair-weekly">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 px-2 font-medium">Week</th>
                              <th className="text-right py-1 px-2 font-medium text-orange-600" title="In Progress">Active</th>
                              <th className="text-right py-1 px-2 font-medium text-green-600" title="Picked Up">Done</th>
                              <th className="text-right py-1 px-2 font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {repairSnapshots.snapshots.map((snapshot) => (
                              <tr key={snapshot.id} className="border-b border-muted/50 hover:bg-muted/30">
                                <td className="py-1.5 px-2 font-medium">
                                  Wk {snapshot.weekNumber}
                                </td>
                                <td className="py-1.5 px-2 text-right text-orange-600">
                                  {snapshot.activeRepairs}
                                </td>
                                <td className="py-1.5 px-2 text-right text-green-600">
                                  {snapshot.completedThisWeek}
                                </td>
                                <td className="py-1.5 px-2 text-right font-semibold">
                                  {snapshot.totalInRepair}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
                </CollapsibleContent>
              </Collapsible>

              {/* US Map showing vehicle distribution by state */}
              {data.vehicles && data.vehicles.length > 0 && (
                <USMapVehicles 
                  vehicles={data.vehicles}
                  byovTechnicians={data.byov?.technicians?.map(tech => ({
                    name: tech.name,
                    truckId: tech.truckId,
                    location: tech.location,
                    state: extractStateFromLocation(tech.location)
                  })) || []}
                  rentalsByState={rentalsByState}
                  onMapFiltersChange={handleMapFiltersChange}
                  activeSelections={mapSelections}
                  visibleCategories={visibleMapCategories}
                />
              )}

              {/* Fleet Vehicle Table */}
              <FleetVehicleTable 
                vehicles={data.vehicles || []} 
                isLoading={isLoading}
                categoryFilter={categoryFilter}
                onClearCategoryFilter={() => setCategoryFilter(null)}
                mapSelections={mapSelections}
                visibleMapCategories={visibleMapCategories}
                onMapFiltersChange={handleMapFiltersChange}
                rentalTruckNumbers={rentalTruckSet}
              />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
