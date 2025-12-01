import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Truck, Search, Filter, ChevronDown, ChevronUp, RefreshCw, AlertCircle, 
  CheckCircle, XCircle, Database, Loader2, Eye, UserX, Link2, History
} from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AggregatedVehicleAssignment, AllTech } from "@shared/schema";

interface ServiceStatus {
  configured: boolean;
  dataSources: {
    snowflake: boolean;
    tpms: boolean;
    holman: boolean;
  };
}

export default function VehicleAssignments() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [techLookup, setTechLookup] = useState("");
  const [truckLookup, setTruckLookup] = useState("");
  const [selectedAssignment, setSelectedAssignment] = useState<AggregatedVehicleAssignment | null>(null);
  const [unassignDialog, setUnassignDialog] = useState<{ open: boolean; techRacfid: string; techName: string }>({ open: false, techRacfid: '', techName: '' });
  const [unassignNotes, setUnassignNotes] = useState("");
  const [historyDialog, setHistoryDialog] = useState<{ open: boolean; techRacfid: string; techName: string }>({ open: false, techRacfid: '', techName: '' });

  const { data: assignmentsResponse, isLoading: assignmentsLoading, refetch: refetchAssignments } = useQuery<{ success: boolean; data: AggregatedVehicleAssignment[] }>({
    queryKey: ['/api/vehicle-assignments', statusFilter, districtFilter, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (districtFilter !== 'all') params.set('districtNo', districtFilter);
      if (searchQuery) params.set('search', searchQuery);
      const response = await fetch(`/api/vehicle-assignments?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch assignments');
      return response.json();
    },
  });

  const { data: serviceStatus } = useQuery<{ success: boolean; data: ServiceStatus }>({
    queryKey: ['/api/vehicle-assignments/status'],
  });

  const { data: techLookupResult, isLoading: techLookupLoading, refetch: doTechLookup } = useQuery<{ success: boolean; data: AggregatedVehicleAssignment }>({
    queryKey: ['/api/vehicle-assignments/tech', techLookup],
    enabled: false,
  });

  const { data: truckLookupResult, isLoading: truckLookupLoading, refetch: doTruckLookup } = useQuery<{ success: boolean; data: AggregatedVehicleAssignment }>({
    queryKey: ['/api/vehicle-assignments/truck', truckLookup],
    enabled: false,
  });

  const { data: historyResult, isLoading: historyLoading, refetch: refetchHistory } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ['/api/vehicle-assignments/history', historyDialog.techRacfid],
    enabled: historyDialog.open && !!historyDialog.techRacfid,
  });

  const syncMutation = useMutation({
    mutationFn: async (techRacfid: string) => {
      return await apiRequest('POST', `/api/vehicle-assignments/sync/tpms/${techRacfid}`);
    },
    onSuccess: (result: any) => {
      toast({
        title: "Sync Complete",
        description: "Vehicle assignment data synced from TPMS",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/vehicle-assignments'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync from TPMS",
        variant: "destructive",
      });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ techRacfid, notes }: { techRacfid: string; notes: string }) => {
      return await apiRequest('DELETE', `/api/vehicle-assignments/${techRacfid}`, { notes });
    },
    onSuccess: () => {
      toast({
        title: "Vehicle Unassigned",
        description: "The vehicle has been unassigned from the technician",
      });
      setUnassignDialog({ open: false, techRacfid: '', techName: '' });
      setUnassignNotes("");
      queryClient.invalidateQueries({ queryKey: ['/api/vehicle-assignments'] });
    },
    onError: (error: any) => {
      toast({
        title: "Unassign Failed",
        description: error.message || "Failed to unassign vehicle",
        variant: "destructive",
      });
    },
  });

  const assignments = assignmentsResponse?.data || [];
  const uniqueDistricts = Array.from(new Set(assignments.map(a => a.districtNo).filter(Boolean))).sort() as string[];
  const activeFiltersCount = [statusFilter, districtFilter].filter(f => f !== "all").length + (searchQuery ? 1 : 0);

  const clearAllFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setDistrictFilter("all");
  };

  const handleTechLookup = async () => {
    if (!techLookup.trim()) return;
    const response = await fetch(`/api/vehicle-assignments/tech/${techLookup.trim()}`);
    if (!response.ok) {
      toast({
        title: "Technician Not Found",
        description: `No assignment found for Enterprise ID: ${techLookup}`,
        variant: "destructive",
      });
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      setSelectedAssignment(result.data);
    }
  };

  const handleTruckLookup = async () => {
    if (!truckLookup.trim()) return;
    const response = await fetch(`/api/vehicle-assignments/truck/${truckLookup.trim()}`);
    if (!response.ok) {
      toast({
        title: "Vehicle Not Found",
        description: `No assignment found for Truck #: ${truckLookup}`,
        variant: "destructive",
      });
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      setSelectedAssignment(result.data);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Active</Badge>;
      case 'inactive':
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />Inactive</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const DataSourceIndicator = ({ sources }: { sources?: { snowflake: boolean; tpms: boolean; holman: boolean } }) => {
    if (!sources) return null;
    return (
      <div className="flex gap-1" title="Data sources">
        <Badge variant={sources.snowflake ? "default" : "outline"} className={`text-xs px-1 ${sources.snowflake ? 'bg-blue-100 text-blue-800' : ''}`}>SF</Badge>
        <Badge variant={sources.tpms ? "default" : "outline"} className={`text-xs px-1 ${sources.tpms ? 'bg-green-100 text-green-800' : ''}`}>TPMS</Badge>
        <Badge variant={sources.holman ? "default" : "outline"} className={`text-xs px-1 ${sources.holman ? 'bg-purple-100 text-purple-800' : ''}`}>H</Badge>
      </div>
    );
  };

  return (
    <MainContent>
      <TopBar 
        title="Vehicle Assignments"
        breadcrumbs={["Home", "Fleet", "Vehicle Assignments"]}
      />
      
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Data Source Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-around">
                    <div className="text-center">
                      <Database className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.snowflake ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Snowflake</span>
                    </div>
                    <div className="text-center">
                      <Link2 className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.tpms ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">TPMS</span>
                    </div>
                    <div className="text-center">
                      <Truck className={`h-6 w-6 mx-auto ${serviceStatus?.data?.dataSources?.holman ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="text-xs">Holman</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Lookup by Enterprise ID</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter Enterprise ID..."
                      value={techLookup}
                      onChange={(e) => setTechLookup(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && handleTechLookup()}
                      data-testid="input-tech-lookup"
                    />
                    <Button onClick={handleTechLookup} disabled={!techLookup.trim()} data-testid="button-tech-lookup">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="col-span-1">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Lookup by Truck #</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter Truck Number..."
                      value={truckLookup}
                      onChange={(e) => setTruckLookup(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTruckLookup()}
                      data-testid="input-truck-lookup"
                    />
                    <Button onClick={handleTruckLookup} disabled={!truckLookup.trim()} data-testid="button-truck-lookup">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Truck className="h-6 w-6 text-blue-600" />
                    <div>
                      <CardTitle data-testid="text-assignments-title">Vehicle Assignments</CardTitle>
                      <CardDescription>
                        Unified view of technician-to-vehicle assignments from Snowflake, TPMS, and Holman
                      </CardDescription>
                    </div>
                  </div>
                  <Button 
                    onClick={() => refetchAssignments()}
                    variant="outline"
                    data-testid="button-refresh-assignments"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${assignmentsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, employee ID, Enterprise ID, or truck #..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-assignments"
                    />
                  </div>
                  <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="flex items-center gap-2" data-testid="button-toggle-filters">
                        <Filter className="h-4 w-4" />
                        Filters
                        {activeFiltersCount > 0 && (
                          <Badge variant="secondary" className="ml-1">{activeFiltersCount}</Badge>
                        )}
                        {isFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                  </Collapsible>
                </div>

                <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Assignment Status</label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger data-testid="select-status-filter">
                            <SelectValue placeholder="All Statuses" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">District</label>
                        <Select value={districtFilter} onValueChange={setDistrictFilter}>
                          <SelectTrigger data-testid="select-district-filter">
                            <SelectValue placeholder="All Districts" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Districts</SelectItem>
                            {uniqueDistricts.map(district => (
                              <SelectItem key={district} value={district!}>{district}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 flex items-end">
                        <Button variant="ghost" onClick={clearAllFilters} className="text-sm" data-testid="button-clear-filters">
                          Clear All Filters
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Showing {assignments.length} assignments</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {assignmentsLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading assignments...</span>
                  </div>
                ) : assignments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-semibold text-lg">No Assignments Found</h3>
                    <p className="text-muted-foreground">
                      No vehicle assignments match your current filters
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Technician</th>
                          <th className="text-left p-3 font-medium">Enterprise ID</th>
                          <th className="text-left p-3 font-medium">Truck #</th>
                          <th className="text-left p-3 font-medium">Vehicle</th>
                          <th className="text-left p-3 font-medium">District</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-left p-3 font-medium">Sources</th>
                          <th className="text-left p-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map((assignment) => (
                          <tr 
                            key={assignment.id || assignment.techRacfid} 
                            className="border-b hover:bg-muted/30 transition-colors"
                            data-testid={`row-assignment-${assignment.techRacfid}`}
                          >
                            <td className="p-3">
                              <div className="font-medium">{assignment.techName || '-'}</div>
                              {assignment.firstName && assignment.lastName && (
                                <div className="text-sm text-muted-foreground">
                                  {assignment.firstName} {assignment.lastName}
                                </div>
                              )}
                            </td>
                            <td className="p-3 font-mono text-sm">{assignment.techRacfid}</td>
                            <td className="p-3 font-mono text-sm font-semibold">{assignment.truckNo || '-'}</td>
                            <td className="p-3 text-sm">
                              {assignment.vehicleYear && assignment.vehicleMake && assignment.vehicleModel 
                                ? `${assignment.vehicleYear} ${assignment.vehicleMake} ${assignment.vehicleModel}`
                                : assignment.holmanVehicleNumber || '-'}
                            </td>
                            <td className="p-3 text-sm">{assignment.districtNo || '-'}</td>
                            <td className="p-3">{getStatusBadge(assignment.assignmentStatus)}</td>
                            <td className="p-3"><DataSourceIndicator sources={assignment.dataSources} /></td>
                            <td className="p-3">
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedAssignment(assignment)}
                                  title="View Details"
                                  data-testid={`button-view-${assignment.techRacfid}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => syncMutation.mutate(assignment.techRacfid)}
                                  disabled={syncMutation.isPending}
                                  title="Sync from TPMS"
                                  data-testid={`button-sync-${assignment.techRacfid}`}
                                >
                                  <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setHistoryDialog({ open: true, techRacfid: assignment.techRacfid, techName: assignment.techName || assignment.techRacfid })}
                                  title="View History"
                                  data-testid={`button-history-${assignment.techRacfid}`}
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                                {assignment.truckNo && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setUnassignDialog({ open: true, techRacfid: assignment.techRacfid, techName: assignment.techName || assignment.techRacfid })}
                                    title="Unassign Vehicle"
                                    className="text-destructive hover:text-destructive"
                                    data-testid={`button-unassign-${assignment.techRacfid}`}
                                  >
                                    <UserX className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Dialog open={!!selectedAssignment} onOpenChange={(open) => !open && setSelectedAssignment(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assignment Details</DialogTitle>
            <DialogDescription>
              Complete vehicle assignment data from all sources
            </DialogDescription>
          </DialogHeader>
          {selectedAssignment && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-2">Technician Info (Snowflake)</h4>
                  <div className="space-y-1">
                    <p><span className="font-medium">Name:</span> {selectedAssignment.techName || '-'}</p>
                    <p><span className="font-medium">Enterprise ID:</span> {selectedAssignment.techRacfid}</p>
                    <p><span className="font-medium">Employee ID:</span> {selectedAssignment.employeeId || '-'}</p>
                    <p><span className="font-medium">District:</span> {selectedAssignment.districtNo || '-'}</p>
                    <p><span className="font-medium">Employment Status:</span> {selectedAssignment.employmentStatus || '-'}</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-2">Contact Info (TPMS)</h4>
                  <div className="space-y-1">
                    <p><span className="font-medium">Tech ID:</span> {selectedAssignment.techId || '-'}</p>
                    <p><span className="font-medium">Phone:</span> {selectedAssignment.contactNo || '-'}</p>
                    <p><span className="font-medium">Email:</span> {selectedAssignment.email || '-'}</p>
                    <p><span className="font-medium">Last TPMS Sync:</span> {selectedAssignment.lastTpmsSync || 'Never'}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-2">Vehicle Info (Holman)</h4>
                  <div className="space-y-1">
                    <p><span className="font-medium">Truck #:</span> {selectedAssignment.truckNo || '-'}</p>
                    <p><span className="font-medium">Holman Vehicle #:</span> {selectedAssignment.holmanVehicleNumber || '-'}</p>
                    <p><span className="font-medium">VIN:</span> {selectedAssignment.vehicleVin || '-'}</p>
                    <p><span className="font-medium">Year/Make/Model:</span> {
                      selectedAssignment.vehicleYear && selectedAssignment.vehicleMake 
                        ? `${selectedAssignment.vehicleYear} ${selectedAssignment.vehicleMake} ${selectedAssignment.vehicleModel || ''}`
                        : '-'
                    }</p>
                    <p><span className="font-medium">Vehicle Status:</span> {selectedAssignment.vehicleStatus || '-'}</p>
                    <p><span className="font-medium">Garaging Address:</span> {selectedAssignment.garagingAddress || '-'}</p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-muted-foreground mb-2">Assignment Status</h4>
                  <div className="space-y-1">
                    <p><span className="font-medium">Status:</span> {getStatusBadge(selectedAssignment.assignmentStatus)}</p>
                    <p><span className="font-medium">Data Sources:</span></p>
                    <DataSourceIndicator sources={selectedAssignment.dataSources} />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAssignment(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unassignDialog.open} onOpenChange={(open) => !open && setUnassignDialog({ open: false, techRacfid: '', techName: '' })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unassign Vehicle</DialogTitle>
            <DialogDescription>
              Are you sure you want to unassign the vehicle from {unassignDialog.techName}?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="unassign-notes">Notes (Optional)</Label>
              <Textarea
                id="unassign-notes"
                placeholder="Enter reason for unassignment..."
                value={unassignNotes}
                onChange={(e) => setUnassignNotes(e.target.value)}
                data-testid="textarea-unassign-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnassignDialog({ open: false, techRacfid: '', techName: '' })}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => unassignMutation.mutate({ techRacfid: unassignDialog.techRacfid, notes: unassignNotes })}
              disabled={unassignMutation.isPending}
              data-testid="button-confirm-unassign"
            >
              {unassignMutation.isPending ? 'Unassigning...' : 'Unassign Vehicle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDialog.open} onOpenChange={(open) => !open && setHistoryDialog({ open: false, techRacfid: '', techName: '' })}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assignment History</DialogTitle>
            <DialogDescription>
              Vehicle assignment history for {historyDialog.techName}
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center p-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : historyResult?.data && historyResult.data.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 text-sm font-medium">Date</th>
                    <th className="text-left p-2 text-sm font-medium">Change</th>
                    <th className="text-left p-2 text-sm font-medium">Truck</th>
                    <th className="text-left p-2 text-sm font-medium">Changed By</th>
                    <th className="text-left p-2 text-sm font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {historyResult.data.map((entry: any, index: number) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 text-sm">{new Date(entry.changedAt).toLocaleString()}</td>
                      <td className="p-2 text-sm">{entry.changeType}</td>
                      <td className="p-2 text-sm font-mono">
                        {entry.previousTruckNo && <span className="line-through text-muted-foreground mr-1">{entry.previousTruckNo}</span>}
                        {entry.newTruckNo || '-'}
                      </td>
                      <td className="p-2 text-sm">{entry.changedBy || '-'}</td>
                      <td className="p-2 text-sm">{entry.changeSource}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              No history records found
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialog({ open: false, techRacfid: '', techName: '' })}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
