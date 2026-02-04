import { useState } from "react";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { UserMinus, Search, RefreshCw, Clock, Calendar, AlertCircle, Download } from "lucide-react";
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
}

export default function WeeklyOffboarding() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: termRoster = [], isLoading, isRefetching } = useQuery<TermRosterEntry[]>({
    queryKey: ['/api/weekly-offboarding'],
  });

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

  const weekGroups = termRoster.reduce((acc, entry) => {
    const weekKey = getWeekKey(entry.effdt);
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
      entry.planningArea?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.contactPhone?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesWeek = weekFilter === "all" || getWeekKey(entry.effdt) === weekFilter;
    const matchesStatus = statusFilter === "all" || entry.emplStatus === statusFilter;
    
    return matchesSearch && matchesWeek && matchesStatus;
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
                <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-background">
                        <TableHead className="bg-background sticky top-0">Employee Name</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">Enterprise ID</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">Status</TableHead>
                        <TableHead className="w-[120px] bg-background sticky top-0">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            Effective Date
                          </div>
                        </TableHead>
                        <TableHead className="w-[130px] bg-background sticky top-0">Last Date Worked</TableHead>
                        <TableHead className="bg-background sticky top-0">Planning Area</TableHead>
                        <TableHead className="bg-background sticky top-0">Tech Specialty</TableHead>
                        <TableHead className="min-w-[200px] bg-background sticky top-0">Address</TableHead>
                        <TableHead className="min-w-[180px] bg-background sticky top-0">Contact Phone</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRoster.map((entry, index) => (
                        <TableRow key={`${entry.enterpriseId}-${index}`} data-testid={`row-term-${index}`}>
                          <TableCell className="font-medium">{entry.emplName || '-'}</TableCell>
                          <TableCell className="font-mono text-sm">{entry.enterpriseId?.toUpperCase() || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(entry.emplStatus)}>
                              {entry.emplStatus || 'Unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.effdt)}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(entry.lastDateWorked)}</TableCell>
                          <TableCell className="text-sm">{entry.planningArea || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.techSpecialty || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.address || '-'}</TableCell>
                          <TableCell className="text-sm">{entry.contactPhone || '-'}</TableCell>
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
    </MainContent>
  );
}
