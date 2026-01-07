import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { UserPlus, Search, RefreshCw, Clock, Truck, Calendar, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, endOfWeek, getWeek, getYear, parseISO, isWithinInterval } from "date-fns";
import type { OnboardingHire } from "@shared/schema";

// District to Owner mapping based on last 4 digits
const districtOwnerMap: Record<string, string> = {
  '3132': 'Monica, Cheryl & Machell',
  '3580': 'Monica, Cheryl & Machell',
  '4766': 'Rob & Andrea',
  '6141': 'Monica, Cheryl & Machell',
  '7084': 'Rob & Andrea',
  '7088': 'Carol & Tasha',
  '7108': 'Carol & Tasha',
  '7323': 'Monica, Cheryl & Machell',
  '7435': 'Rob & Andrea',
  '7670': 'Rob & Andrea',
  '7744': 'Rob & Andrea',
  '7983': 'Rob & Andrea',
  '7995': 'Carol & Tasha',
  '8035': 'Rob & Andrea',
  '8096': 'Monica, Cheryl & Machell',
  '8107': 'Carol & Tasha',
  '8147': 'Carol & Tasha',
  '8158': 'Carol & Tasha',
  '8162': 'Monica, Cheryl & Machell',
  '8169': 'Carol & Tasha',
  '8175': 'Rob & Andrea',
  '8184': 'Carol & Tasha',
  '8206': 'Monica, Cheryl & Machell',
  '8220': 'Monica, Cheryl & Machell',
  '8228': 'Carol & Tasha',
  '8309': 'Monica, Cheryl & Machell',
  '8366': 'Carol & Tasha',
  '8380': 'Rob & Andrea',
  '8420': 'Monica, Cheryl & Machell',
  '8555': 'Monica, Cheryl & Machell',
  '8935': 'Monica, Cheryl & Machell',
};

// Get owner from district (uses last 4 digits)
function getOwnerFromDistrict(district: string | null | undefined): string {
  if (!district) return '-';
  const last4 = district.slice(-4);
  return districtOwnerMap[last4] || '-';
}

export default function WeeklyOnboarding() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAssignedOnly, setShowAssignedOnly] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [selectedHire, setSelectedHire] = useState<OnboardingHire | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [truckNumber, setTruckNumber] = useState("");
  const [notes, setNotes] = useState("");

  const { data: hires = [], isLoading } = useQuery<OnboardingHire[]>({
    queryKey: ['/api/onboarding-hires'],
  });

  const { data: syncLogs = [] } = useQuery<any[]>({
    queryKey: ['/api/sync-logs'],
  });

  const lastSync = syncLogs.find(log => log.syncType === 'onboarding_hires');

  const [syncFailed, setSyncFailed] = useState(false);

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/sync/onboarding-hires');
    },
    onSuccess: async (result: any) => {
      setSyncFailed(false);
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      queryClient.invalidateQueries({ queryKey: ['/api/sync-logs'] });
      // Also trigger enrichment after sync completes (in background)
      try {
        await apiRequest('POST', '/api/snowflake/enrich/onboarding-hires');
        queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      } catch (e) {
        console.log('[OnboardingHires] Background enrichment completed or skipped');
      }
    },
    onError: (error: any) => {
      setSyncFailed(true);
      console.error('[OnboardingHires] Sync failed:', error.message);
    },
  });

  // Auto-sync and enrich on page load
  useEffect(() => {
    syncMutation.mutate();
  }, []);

  const assignMutation = useMutation({
    mutationFn: async ({ id, truckAssigned, assignedTruckNo, notes }: { id: string; truckAssigned: boolean; assignedTruckNo: string; notes: string }) => {
      return await apiRequest('PATCH', `/api/onboarding-hires/${id}`, { truckAssigned, assignedTruckNo, notes });
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Truck assignment updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
      setAssignDialogOpen(false);
      setSelectedHire(null);
      setTruckNumber("");
      setNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update truck assignment",
        variant: "destructive",
      });
    },
  });

  const handleExportXlsx = async () => {
    try {
      const response = await fetch('/api/onboarding-hires/export', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weekly-onboarding-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Complete",
        description: "Excel file downloaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export data",
        variant: "destructive",
      });
    }
  };

  const enrichMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/enrich/onboarding-hires');
    },
    onSuccess: (data: any) => {
      toast({
        title: "Enrichment Complete",
        description: `Updated ${data.enrichedCount} records with Snowflake data`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding-hires'] });
    },
    onError: (error: any) => {
      toast({
        title: "Enrichment Failed",
        description: error.message || "Failed to enrich data from Snowflake",
        variant: "destructive",
      });
    },
  });

  // Generate week options from hires data
  const weekOptions = (() => {
    const weeks = new Map<string, { start: Date; end: Date; label: string }>();
    hires.forEach(hire => {
      if (hire.serviceDate) {
        const date = new Date(hire.serviceDate);
        const weekStart = startOfWeek(date, { weekStartsOn: 0 }); // Sunday start
        const weekEnd = endOfWeek(date, { weekStartsOn: 0 });
        const year = getYear(date);
        const week = getWeek(date, { weekStartsOn: 0 });
        const key = `${year}-W${week.toString().padStart(2, '0')}`;
        if (!weeks.has(key)) {
          weeks.set(key, {
            start: weekStart,
            end: weekEnd,
            label: `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')} (Week ${week})`
          });
        }
      }
    });
    // Sort by date ascending
    return Array.from(weeks.entries()).sort((a, b) => a[1].start.getTime() - b[1].start.getTime());
  })();

  const filteredHires = hires
    .filter(hire => {
      const matchesSearch = !searchQuery || 
        hire.employeeName?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesAssigned = !showAssignedOnly || hire.truckAssigned;
      const matchesUnassigned = !showUnassignedOnly || !hire.truckAssigned;
      
      // Week filter
      let matchesWeek = true;
      if (weekFilter !== "all" && hire.serviceDate) {
        const weekData = weekOptions.find(([key]) => key === weekFilter);
        if (weekData) {
          const date = new Date(hire.serviceDate);
          matchesWeek = isWithinInterval(date, { start: weekData[1].start, end: weekData[1].end });
        }
      } else if (weekFilter !== "all" && !hire.serviceDate) {
        matchesWeek = false;
      }
      
      return matchesSearch && matchesAssigned && matchesUnassigned && matchesWeek;
    })
    .sort((a, b) => {
      // Sort by service date ascending (oldest to newest)
      const dateA = a.serviceDate ? new Date(a.serviceDate).getTime() : 0;
      const dateB = b.serviceDate ? new Date(b.serviceDate).getTime() : 0;
      return dateA - dateB;
    });

  const assignedCount = hires.filter(h => h.truckAssigned).length;
  const unassignedCount = hires.filter(h => !h.truckAssigned).length;

  const handleOpenAssignDialog = (hire: OnboardingHire) => {
    setSelectedHire(hire);
    setTruckNumber(hire.assignedTruckNo || "");
    setNotes(hire.notes || "");
    setAssignDialogOpen(true);
  };

  const handleAssign = () => {
    if (!selectedHire) return;
    assignMutation.mutate({
      id: selectedHire.id,
      truckAssigned: !!truckNumber.trim(),
      assignedTruckNo: truckNumber.trim(),
      notes: notes.trim(),
    });
  };

  return (
    <MainContent>
      <TopBar 
        title="Weekly Onboarding Truck Assignment"
        breadcrumbs={["Home", "Fleet", "Weekly Onboarding"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <UserPlus className="h-6 w-6 text-purple-600" />
                    <div>
                      <CardTitle data-testid="text-onboarding-title">Weekly Onboarding Truck Assignment</CardTitle>
                      <CardDescription>
                        New tech hires starting from January 4, 2026 - assign trucks to new hires
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {syncMutation.isPending ? (
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Syncing from HR system...</span>
                      </div>
                    ) : syncFailed ? (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span className="text-yellow-600">Sync failed</span>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => syncMutation.mutate()}
                          data-testid="button-retry-sync"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      </div>
                    ) : lastSync?.completedAt ? (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>Last synced: {format(new Date(lastSync.completedAt), 'MMM d, yyyy h:mm a')}</span>
                      </div>
                    ) : null}
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => enrichMutation.mutate()}
                      disabled={enrichMutation.isPending}
                      data-testid="button-enrich-data"
                    >
                      {enrichMutation.isPending ? (
                        <>
                          <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                          Enriching...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Enrich from Snowflake
                        </>
                      )}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={handleExportXlsx}
                      data-testid="button-export-xlsx"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Export XLSX
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4 mb-6">
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="bg-blue-50 dark:bg-blue-950">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">Total New Hires</p>
                            <p className="text-2xl font-bold">{hires.length}</p>
                          </div>
                          <UserPlus className="h-8 w-8 text-blue-600" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-green-50 dark:bg-green-950">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">Trucks Assigned</p>
                            <p className="text-2xl font-bold">{assignedCount}</p>
                          </div>
                          <CheckCircle2 className="h-8 w-8 text-green-600" />
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-yellow-50 dark:bg-yellow-950">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">Pending Assignment</p>
                            <p className="text-2xl font-bold">{unassignedCount}</p>
                          </div>
                          <AlertCircle className="h-8 w-8 text-yellow-600" />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="relative flex-1 max-w-sm min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by employee name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-hires"
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
                            <SelectItem key={key} value={key}>{data.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="assigned" 
                          checked={showAssignedOnly}
                          onCheckedChange={(checked) => {
                            setShowAssignedOnly(checked as boolean);
                            if (checked) setShowUnassignedOnly(false);
                          }}
                        />
                        <label htmlFor="assigned" className="text-sm">Show assigned only</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="unassigned" 
                          checked={showUnassignedOnly}
                          onCheckedChange={(checked) => {
                            setShowUnassignedOnly(checked as boolean);
                            if (checked) setShowAssignedOnly(false);
                          }}
                        />
                        <label htmlFor="unassigned" className="text-sm">Show pending only</label>
                      </div>
                    </div>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredHires.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {hires.length === 0 ? (
                      <div>
                        <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No onboarding hires found.</p>
                        <p className="text-sm mt-2">Data syncs automatically from HR system.</p>
                      </div>
                    ) : (
                      <p>No results match your search criteria.</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border">
                    {/* Top scrollbar - synced with table scroll */}
                    <div 
                      className="overflow-x-auto scrollbar-thin"
                      onScroll={(e) => {
                        const target = e.target as HTMLDivElement;
                        const tableContainer = target.nextElementSibling as HTMLDivElement;
                        if (tableContainer) tableContainer.scrollLeft = target.scrollLeft;
                      }}
                    >
                      <div style={{ height: '1px', width: '2000px' }} />
                    </div>
                    <div 
                      className="overflow-x-auto"
                      onScroll={(e) => {
                        const target = e.target as HTMLDivElement;
                        const topScroller = target.previousElementSibling as HTMLDivElement;
                        if (topScroller) topScroller.scrollLeft = target.scrollLeft;
                      }}
                    >
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[110px]">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              Service Date
                            </div>
                          </TableHead>
                          <TableHead>Employee Name</TableHead>
                          <TableHead className="w-[100px]">Emp. Status</TableHead>
                          <TableHead className="w-[100px]">Enterprise ID</TableHead>
                          <TableHead className="w-[90px]">Status</TableHead>
                          <TableHead className="w-[100px]">
                            <div className="flex items-center gap-1">
                              <Truck className="h-4 w-4" />
                              Truck #
                            </div>
                          </TableHead>
                          <TableHead className="min-w-[200px]">Job Title</TableHead>
                          <TableHead className="w-[80px]">District</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead className="w-[80px]">Zipcode</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>Planning Area</TableHead>
                          <TableHead className="min-w-[200px]">Address</TableHead>
                          <TableHead>Specialties</TableHead>
                          <TableHead className="w-[60px]">State</TableHead>
                          <TableHead>Action Reason</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredHires.map((hire) => (
                          <TableRow key={hire.id} data-testid={`row-hire-${hire.id}`}>
                            <TableCell className="font-medium whitespace-nowrap">
                              {hire.serviceDate 
                                ? format(new Date(hire.serviceDate), 'MMM d, yyyy')
                                : 'N/A'}
                            </TableCell>
                            <TableCell className="font-medium">{hire.employeeName}</TableCell>
                            <TableCell className="text-sm">{hire.employmentStatus || '-'}</TableCell>
                            <TableCell className="font-mono text-sm">{hire.enterpriseId?.toUpperCase() || '-'}</TableCell>
                            <TableCell>
                              {hire.truckAssigned ? (
                                <Badge variant="default" className="bg-green-600">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Assigned
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{hire.assignedTruckNo || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.jobTitle || '-'}</TableCell>
                            <TableCell>{hire.district || '-'}</TableCell>
                            <TableCell className="text-sm">{getOwnerFromDistrict(hire.district)}</TableCell>
                            <TableCell>{hire.zipcode || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.locationCity || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.planningAreaName || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.address || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.specialties || '-'}</TableCell>
                            <TableCell>{hire.workState || '-'}</TableCell>
                            <TableCell className="text-sm">{hire.actionReasonDescr || '-'}</TableCell>
                            <TableCell>
                              <Button 
                                size="sm" 
                                variant={hire.truckAssigned ? "outline" : "default"}
                                onClick={() => handleOpenAssignDialog(hire)}
                                data-testid={`button-assign-${hire.id}`}
                              >
                                <Truck className="h-4 w-4 mr-1" />
                                {hire.truckAssigned ? 'Edit' : 'Assign'}
                              </Button>
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
        </div>
      </main>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Assign Truck to {selectedHire?.employeeName}
              </div>
            </DialogTitle>
            <DialogDescription>
              {selectedHire && (
                <span>Service Date: {format(new Date(selectedHire.serviceDate), 'MMM d, yyyy')}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="truckNumber">Truck Number</Label>
              <Input
                id="truckNumber"
                placeholder="Enter truck number..."
                value={truckNumber}
                onChange={(e) => setTruckNumber(e.target.value)}
                data-testid="input-truck-number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAssign}
              disabled={assignMutation.isPending}
              data-testid="button-confirm-assign"
            >
              {assignMutation.isPending ? 'Saving...' : 'Save Assignment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
