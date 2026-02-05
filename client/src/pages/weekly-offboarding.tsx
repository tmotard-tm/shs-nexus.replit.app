import { useState, useEffect, useRef, useCallback } from "react";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { UserMinus, Search, RefreshCw, Clock, Calendar, AlertCircle, Download, Loader2, CheckCircle, Truck } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, getWeek, getYear } from "date-fns";

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
  truck: string;
}

export default function WeeklyOffboarding() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [manualStatusFilter, setManualStatusFilter] = useState<string>("all");
  const [selectedEntry, setSelectedEntry] = useState<TermRosterEntry | null>(null);
  
  // Nexus tracking fields
  const [nexusStatus, setNexusStatus] = useState("");
  const [nexusLocation, setNexusLocation] = useState("");
  const [nexusContact, setNexusContact] = useState("");
  const [nexusKeys, setNexusKeys] = useState("");
  const [nexusRepaired, setNexusRepaired] = useState("");
  const [nexusComments, setNexusComments] = useState("");

  // Refs for synchronized scrollbars
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);

  // Sync scroll positions between top scrollbar and table
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

  const { data: termRoster = [], isLoading, isRefetching } = useQuery<TermRosterEntry[]>({
    queryKey: ['/api/weekly-offboarding'],
  });

  // Collect all truck numbers from termRoster for batch fetch
  const truckNumbers = termRoster
    .map(entry => entry.truck)
    .filter((truck): truck is string => !!truck);

  // Batch fetch nexus data for all trucks in the list
  const { data: allNexusData = [] } = useQuery<{
    vehicleNumber: string;
    postOffboardedStatus: string | null;
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
    'not_found': 'Not found',
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

  // Update table width for top scrollbar
  useEffect(() => {
    const updateWidth = () => {
      if (tableScrollRef.current) {
        setTableWidth(tableScrollRef.current.scrollWidth);
      }
    };
    // Small delay to ensure table is rendered
    const timer = setTimeout(updateWidth, 100);
    window.addEventListener('resize', updateWidth);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateWidth);
    };
  }, [termRoster]);

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

  // Fetch nexus data when an entry with a truck is selected
  const { data: nexusData, isLoading: nexusDataLoading } = useQuery({
    queryKey: ['/api/vehicle-nexus-data', selectedEntry?.truck],
    queryFn: async () => {
      if (!selectedEntry?.truck) return null;
      const response = await fetch(`/api/vehicle-nexus-data/${selectedEntry.truck}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!selectedEntry?.truck,
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
    } else {
      setNexusStatus("");
      setNexusLocation("");
      setNexusContact("");
      setNexusKeys("");
      setNexusRepaired("");
      setNexusComments("");
    }
  }, [nexusData, selectedEntry]);

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
    }) => {
      return await apiRequest('PUT', `/api/vehicle-nexus-data/${data.vehicleNumber}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Nexus tracking data has been saved.",
      });
      if (selectedEntry?.truck) {
        queryClient.invalidateQueries({ queryKey: ['/api/vehicle-nexus-data', selectedEntry.truck] });
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
      entry.truck?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.planningArea?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.contactPhone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.owner?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesWeek = weekFilter === "all" || getWeekKey(entry.lastDateWorked) === weekFilter;
    const matchesStatus = statusFilter === "all" || entry.emplStatus === statusFilter;
    const matchesOwner = ownerFilter === "all" || entry.owner === ownerFilter;
    
    // Manual status filter - check nexus data for the truck
    const nexusInfo = entry.truck ? nexusDataMap.get(entry.truck) : null;
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

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    const upperStatus = (status || '').toUpperCase();
    if (upperStatus.includes('TERM') || upperStatus.includes('INACTIVE')) return 'destructive';
    if (upperStatus.includes('ACTIVE')) return 'default';
    return 'secondary';
  };

  return (
    <MainContent>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <UserMinus className="h-8 w-8 text-red-600" />
                Weekly Offboarding
              </h1>
              <p className="text-muted-foreground">
                Terminated employee roster from Snowflake
              </p>
            </div>
          </div>
        </div>

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
              <div className="grid grid-cols-3 gap-4">
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
                <Card className="bg-orange-50 dark:bg-orange-950">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Filtered Results</p>
                        <p className="text-2xl font-bold">{filteredRoster.length}</p>
                      </div>
                      <Search className="h-8 w-8 text-orange-600" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50 dark:bg-blue-950">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Unique Statuses</p>
                        <p className="text-2xl font-bold">{uniqueStatuses.length}</p>
                      </div>
                      <AlertCircle className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>
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
                      {uniqueManualStatuses.map((status) => (
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
                        <TableHead className="w-[120px] bg-background sticky top-0">Status</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            Effective Date
                          </div>
                        </TableHead>
                        <TableHead className="w-[130px] bg-background sticky top-0">Last Date Worked</TableHead>
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
                      {filteredRoster.map((entry, index) => (
                        <TableRow 
                          key={`${entry.enterpriseId}-${index}`} 
                          data-testid={`row-term-${index}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          <TableCell className="font-medium">{entry.emplName || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{entry.enterpriseId?.toUpperCase() || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{entry.truck || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(entry.emplStatus)}>
                              {entry.emplStatus || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.effdt)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.lastDateWorked)}</TableCell>
                          <TableCell className="text-sm">{entry.planningArea || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.owner || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.techSpecialty || '-'}</TableCell>
                          <TableCell className="text-sm">
                            {(() => {
                              const nexusInfo = entry.truck ? nexusDataMap.get(entry.truck) : null;
                              if (nexusInfo?.postOffboardedStatus) {
                                return (
                                  <div className="flex flex-col">
                                    <Badge variant="outline" className="text-xs mb-1 whitespace-nowrap">
                                      {manualStatusLabels[nexusInfo.postOffboardedStatus] || nexusInfo.postOffboardedStatus}
                                    </Badge>
                                    {nexusInfo.updatedBy && (
                                      <span className="text-xs text-muted-foreground">by {nexusInfo.updatedBy}</span>
                                    )}
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
                              const samsaraInfo = entry.truck ? samsaraData[entry.truck] || samsaraData[entry.truck?.replace(/^0+/, '')] : null;
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
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
                  {selectedEntry.enterpriseId?.toUpperCase()} • {selectedEntry.truck || 'No Truck'}
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

              {selectedEntry.truck && (
                <>
                  <Separator />

                  {/* Nexus Tracking Data */}
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Nexus Tracking
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
                              <SelectItem value="not_found">Not found</SelectItem>
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

                        <Button
                          onClick={() => saveNexusDataMutation.mutate({
                            vehicleNumber: selectedEntry.truck,
                            postOffboardedStatus: nexusStatus === '__none__' ? null : (nexusStatus || null),
                            nexusNewLocation: nexusLocation || null,
                            nexusNewLocationContact: nexusContact || null,
                            keys: nexusKeys === '__none__' ? null : (nexusKeys || null),
                            repaired: nexusRepaired === '__none__' ? null : (nexusRepaired || null),
                            comments: nexusComments || null,
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
                </>
              )}

              {!selectedEntry.truck && (
                <>
                  <Separator />
                  <div className="text-center py-4 text-muted-foreground">
                    <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No truck assigned to this employee.</p>
                    <p className="text-sm">Nexus tracking is only available for employees with assigned trucks.</p>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MainContent>
  );
}
