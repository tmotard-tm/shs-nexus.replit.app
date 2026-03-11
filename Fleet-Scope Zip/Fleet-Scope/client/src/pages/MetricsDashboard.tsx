import { useQuery, useMutation } from "@tanstack/react-query";
import { type MetricsSnapshot } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { 
  TruckIcon, 
  Calendar,
  Phone,
  Mail,
  Package,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  FileInput,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CurrentMetrics {
  metricDate: string;
  trucksOnRoad: number;
  trucksScheduled: number;
  regContactedTech: number;
  regMailedTag: number;
  regOrderedDuplicates: number;
  totalTrucks: number;
  trucksRepairing: number;
  trucksConfirmingStatus: number;
}

interface WeeklyMetrics {
  week: string;
  startDate: string;
  endDate: string;
  avgTrucksOnRoad: number;
  avgTrucksScheduled: number;
  avgRegContactedTech: number;
  avgRegMailedTag: number;
  avgRegOrderedDuplicates: number;
  snapshotCount: number;
}

interface RentalWeeklyStats {
  weekYear: number;
  weekNumber: number;
  newRentals: number;
  rentalsReturned: number;
  totalImports: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TrendIndicator({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <Minus className="w-4 h-4 text-muted-foreground" />;
  
  const diff = current - previous;
  const percentChange = Math.round((diff / previous) * 100);
  
  if (diff > 0) {
    return (
      <span className="flex items-center gap-1 text-green-600 text-sm">
        <TrendingUp className="w-4 h-4" />
        +{percentChange}%
      </span>
    );
  } else if (diff < 0) {
    return (
      <span className="flex items-center gap-1 text-red-600 text-sm">
        <TrendingDown className="w-4 h-4" />
        {percentChange}%
      </span>
    );
  }
  
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

export default function MetricsDashboard() {
  const { currentUser } = useUser();
  const { toast } = useToast();

  const { data: currentMetrics, isLoading: loadingCurrent } = useQuery<CurrentMetrics>({
    queryKey: ["/api/metrics/current"],
  });
  
  const { data: dailySnapshots, isLoading: loadingDaily } = useQuery<MetricsSnapshot[]>({
    queryKey: ["/api/metrics"],
  });
  
  const { data: weeklyMetrics, isLoading: loadingWeekly } = useQuery<WeeklyMetrics[]>({
    queryKey: ["/api/metrics/weekly"],
  });
  
  const { data: rentalWeeklyStats, isLoading: loadingRentalStats } = useQuery<RentalWeeklyStats[]>({
    queryKey: ["/api/rentals/weekly-stats"],
  });

  const captureMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/metrics/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capturedBy: currentUser }),
      });
      if (!response.ok) {
        throw new Error("Failed to capture metrics");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics/weekly"] });
      toast({
        title: "Metrics Captured",
        description: "Today's metrics snapshot has been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to capture metrics",
        variant: "destructive",
      });
    },
  });
  
  const isLoading = loadingCurrent || loadingDaily || loadingWeekly;
  
  const last7Days = dailySnapshots?.slice(0, 7) || [];
  const previousWeekData = dailySnapshots?.length && dailySnapshots.length > 7 
    ? dailySnapshots[7] 
    : null;

  if (isLoading) {
    return (
      <div className="bg-background">
        <main className="px-4 lg:px-8 py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-xl" />
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <main className="px-4 lg:px-8 py-6">
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <h1 className="text-xl font-semibold mr-auto" data-testid="text-page-title">Metrics Dashboard</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => captureMutation.mutate()}
            disabled={captureMutation.isPending}
            data-testid="button-capture-metrics"
          >
            {captureMutation.isPending ? (
              <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Capturing...</>
            ) : (
              "Capture Today's Metrics"
            )}
          </Button>
        </div>
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Current Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                  <TruckIcon className="w-4 h-4" />
                  On Road
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-green-600" data-testid="text-trucks-on-road">
                  {currentMetrics?.trucksOnRoad || 0}
                </p>
                {previousWeekData && (
                  <TrendIndicator 
                    current={currentMetrics?.trucksOnRoad || 0} 
                    previous={previousWeekData.trucksOnRoad} 
                  />
                )}
              </CardContent>
            </Card>

            <Card className="bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-teal-600 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Scheduled
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-teal-600" data-testid="text-trucks-scheduled">
                  {currentMetrics?.trucksScheduled || 0}
                </p>
                {previousWeekData && (
                  <TrendIndicator 
                    current={currentMetrics?.trucksScheduled || 0} 
                    previous={previousWeekData.trucksScheduled} 
                  />
                )}
              </CardContent>
            </Card>

            <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-amber-600 flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Contacted Tech
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-amber-600" data-testid="text-reg-contacted-tech">
                  {currentMetrics?.regContactedTech || 0}
                </p>
                {previousWeekData && (
                  <TrendIndicator 
                    current={currentMetrics?.regContactedTech || 0} 
                    previous={previousWeekData.regContactedTech} 
                  />
                )}
              </CardContent>
            </Card>

            <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Mailed Tag
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-600" data-testid="text-reg-mailed-tag">
                  {currentMetrics?.regMailedTag || 0}
                </p>
                {previousWeekData && (
                  <TrendIndicator 
                    current={currentMetrics?.regMailedTag || 0} 
                    previous={previousWeekData.regMailedTag} 
                  />
                )}
              </CardContent>
            </Card>

            <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Ordered Duplicates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-purple-600" data-testid="text-reg-ordered-duplicates">
                  {currentMetrics?.regOrderedDuplicates || 0}
                </p>
                {previousWeekData && (
                  <TrendIndicator 
                    current={currentMetrics?.regOrderedDuplicates || 0} 
                    previous={previousWeekData.regOrderedDuplicates} 
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Daily History Table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Daily History (Last 7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {last7Days.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No daily snapshots recorded yet.</p>
                  <p className="text-sm mt-2">Click "Capture Today's Metrics" to start tracking.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-center">On Road</TableHead>
                      <TableHead className="text-center">Scheduled</TableHead>
                      <TableHead className="text-center">Contacted</TableHead>
                      <TableHead className="text-center">Mailed</TableHead>
                      <TableHead className="text-center">Duplicates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {last7Days.map((snapshot) => (
                      <TableRow key={snapshot.id} data-testid={`row-daily-${snapshot.metricDate}`}>
                        <TableCell className="font-medium">
                          {formatDate(snapshot.metricDate)}
                        </TableCell>
                        <TableCell className="text-center text-green-600 font-semibold">
                          {snapshot.trucksOnRoad}
                        </TableCell>
                        <TableCell className="text-center text-teal-600 font-semibold">
                          {snapshot.trucksScheduled}
                        </TableCell>
                        <TableCell className="text-center text-amber-600 font-semibold">
                          {snapshot.regContactedTech}
                        </TableCell>
                        <TableCell className="text-center text-blue-600 font-semibold">
                          {snapshot.regMailedTag}
                        </TableCell>
                        <TableCell className="text-center text-purple-600 font-semibold">
                          {snapshot.regOrderedDuplicates}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Weekly Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Weekly Averages (Last 4 Weeks)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!weeklyMetrics || weeklyMetrics.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No weekly data available yet.</p>
                  <p className="text-sm mt-2">Capture daily metrics to build weekly trends.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead className="text-center">On Road</TableHead>
                      <TableHead className="text-center">Scheduled</TableHead>
                      <TableHead className="text-center">Contacted</TableHead>
                      <TableHead className="text-center">Mailed</TableHead>
                      <TableHead className="text-center">Duplicates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyMetrics.map((week, index) => (
                      <TableRow key={week.week} data-testid={`row-weekly-${week.week}`}>
                        <TableCell className="font-medium">
                          <span className="text-sm">
                            {formatDate(week.startDate)} - {formatDate(week.endDate)}
                          </span>
                          {index === 0 && (
                            <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                              Current
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-green-600 font-semibold">
                          {week.avgTrucksOnRoad}
                        </TableCell>
                        <TableCell className="text-center text-teal-600 font-semibold">
                          {week.avgTrucksScheduled}
                        </TableCell>
                        <TableCell className="text-center text-amber-600 font-semibold">
                          {week.avgRegContactedTech}
                        </TableCell>
                        <TableCell className="text-center text-blue-600 font-semibold">
                          {week.avgRegMailedTag}
                        </TableCell>
                        <TableCell className="text-center text-purple-600 font-semibold">
                          {week.avgRegOrderedDuplicates}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Additional Stats */}
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TruckIcon className="w-5 h-5" />
                Fleet Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <p className="text-3xl font-bold" data-testid="text-total-trucks">
                    {currentMetrics?.totalTrucks || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Trucks</p>
                </div>
                <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-3xl font-bold text-blue-600" data-testid="text-trucks-repairing">
                    {currentMetrics?.trucksRepairing || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">In Repair</p>
                </div>
                <div className="text-center p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                  <p className="text-3xl font-bold text-amber-600" data-testid="text-trucks-confirming">
                    {currentMetrics?.trucksConfirmingStatus || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Confirming Status</p>
                </div>
                <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-3xl font-bold text-green-600">
                    {currentMetrics ? Math.round((currentMetrics.trucksOnRoad / currentMetrics.totalTrucks) * 100) : 0}%
                  </p>
                  <p className="text-sm text-muted-foreground">On Road Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Rental Reconciliation Stats */}
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileInput className="w-5 h-5" />
                Rental Reconciliation (Weekly)
              </CardTitle>
              <p className="text-sm text-muted-foreground italic">Manual imports done near EOW</p>
            </CardHeader>
            <CardContent>
              {loadingRentalStats ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !rentalWeeklyStats || rentalWeeklyStats.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileInput className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No rental reconciliation data yet.</p>
                  <p className="text-sm mt-1">Import a rental truck list to start tracking.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead className="text-center">
                        <span className="flex items-center justify-center gap-1">
                          <ArrowUpRight className="w-4 h-4 text-green-600" />
                          New Rentals
                        </span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="flex items-center justify-center gap-1">
                          <ArrowDownRight className="w-4 h-4 text-red-600" />
                          Returned
                        </span>
                      </TableHead>
                      <TableHead className="text-center">
                        <span className="flex items-center justify-center gap-1">
                          Net Change
                        </span>
                      </TableHead>
                      <TableHead className="text-center">Imports</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rentalWeeklyStats.slice(0, 8).map((week) => {
                      const netChange = week.newRentals - week.rentalsReturned;
                      return (
                        <TableRow key={`${week.weekYear}-W${week.weekNumber}`}>
                          <TableCell className="font-medium">
                            {week.weekYear}-W{String(week.weekNumber).padStart(2, '0')}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-green-600 font-semibold">
                              +{week.newRentals}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-red-600 font-semibold">
                              -{week.rentalsReturned}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`font-semibold ${netChange > 0 ? 'text-green-600' : netChange < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {netChange > 0 ? '+' : ''}{netChange}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {week.totalImports}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
