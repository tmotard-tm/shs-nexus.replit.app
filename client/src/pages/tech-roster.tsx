import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Users, Search, Filter, ChevronDown, ChevronUp, RefreshCw, Clock, AlertCircle, CheckCircle } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { AllTech } from "@shared/schema";

export default function TechRoster() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const { data: techs = [], isLoading, refetch } = useQuery<AllTech[]>({
    queryKey: ['/api/all-techs'],
  });

  const { data: syncStatus } = useQuery<{
    termedTechs: { lastSync: string | null; status: string; recordCount: number };
    allTechs: { lastSync: string | null; status: string; recordCount: number };
  }>({
    queryKey: ['/api/snowflake/sync/status'],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/snowflake/sync/all-techs');
    },
    onSuccess: (result: any) => {
      toast({
        title: "Sync Complete",
        description: `Processed ${result.recordsProcessed} Employees (${result.recordsCreated} new, ${result.recordsUpdated} updated)`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/all-techs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/snowflake/sync/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Employee data",
        variant: "destructive",
      });
    },
  });

  const uniqueDistricts = Array.from(new Set(techs.map(t => t.districtNo).filter(Boolean))).sort() as string[];
  const uniqueStatuses = Array.from(new Set(techs.map(t => t.employmentStatus).filter(Boolean))).sort() as string[];

  const activeFiltersCount = [statusFilter, districtFilter].filter(f => f !== "all").length;

  const filteredTechs = techs.filter(tech => {
    const matchesSearch = !searchQuery || 
      tech.techName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tech.employeeId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tech.techRacfid?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tech.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || tech.employmentStatus === statusFilter;
    const matchesDistrict = districtFilter === "all" || tech.districtNo === districtFilter;
    
    return matchesSearch && matchesStatus && matchesDistrict;
  });

  const clearAllFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setDistrictFilter("all");
  };

  return (
    <MainContent>
      <TopBar 
        title="Employee Roster"
        breadcrumbs={["Home", "Fleet", "Employee Roster"]}
      />
      
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          <BackButton href="/" />

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Users className="h-6 w-6 text-blue-600" />
                    <div>
                      <CardTitle data-testid="text-roster-title">Employee Roster</CardTitle>
                      <CardDescription>
                        Complete list of Employees synced from Snowflake
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {syncStatus?.allTechs && (
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {syncStatus.allTechs.lastSync 
                          ? `Last synced: ${format(new Date(syncStatus.allTechs.lastSync), 'MMM d, yyyy h:mm a')}`
                          : 'Never synced'}
                      </div>
                    )}
                    <Button 
                      onClick={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending}
                      variant="outline"
                      data-testid="button-sync-techs"
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                      {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, employee ID, RACF ID, or job title..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-techs"
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
                        <label className="text-sm font-medium mb-1 block">Employment Status</label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger data-testid="select-status-filter">
                            <SelectValue placeholder="All Statuses" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            {uniqueStatuses.map(status => (
                              <SelectItem key={status} value={status!}>{status}</SelectItem>
                            ))}
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
                  <span>Showing {filteredTechs.length} of {techs.length} Employees</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">Loading Employees...</span>
                  </div>
                ) : filteredTechs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-semibold text-lg">No Employees Found</h3>
                    <p className="text-muted-foreground">
                      {techs.length === 0 
                        ? "Click 'Sync Now' to pull Employee data from Snowflake"
                        : "No Employees match your current filters"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Name</th>
                          <th className="text-left p-3 font-medium">Employee ID</th>
                          <th className="text-left p-3 font-medium">RACF ID</th>
                          <th className="text-left p-3 font-medium">Job Title</th>
                          <th className="text-left p-3 font-medium">District</th>
                          <th className="text-left p-3 font-medium">Planning Area</th>
                          <th className="text-left p-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTechs.map((tech) => (
                          <tr 
                            key={tech.id} 
                            className="border-b hover:bg-muted/30 transition-colors"
                            data-testid={`row-tech-${tech.employeeId}`}
                          >
                            <td className="p-3">
                              <div className="font-medium">{tech.techName}</div>
                              {tech.firstName && tech.lastName && tech.techName !== `${tech.firstName} ${tech.lastName}` && (
                                <div className="text-sm text-muted-foreground">
                                  {tech.firstName} {tech.lastName}
                                </div>
                              )}
                            </td>
                            <td className="p-3 font-mono text-sm">{tech.employeeId}</td>
                            <td className="p-3 font-mono text-sm">{tech.techRacfid}</td>
                            <td className="p-3 text-sm">{tech.jobTitle || '-'}</td>
                            <td className="p-3 text-sm">{tech.districtNo || '-'}</td>
                            <td className="p-3 text-sm">{tech.planningAreaName || '-'}</td>
                            <td className="p-3">
                              <Badge 
                                variant={tech.employmentStatus === 'A' ? 'default' : 'secondary'}
                                className={tech.employmentStatus === 'A' ? 'bg-green-100 text-green-800' : ''}
                              >
                                {tech.employmentStatus === 'A' ? 'Active' : tech.employmentStatus || 'Unknown'}
                              </Badge>
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
    </MainContent>
  );
}
