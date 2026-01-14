import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { 
  BarChart3, 
  Download, 
  TrendingDown,
  TrendingUp,
  Clock, 
  Car,
  AlertTriangle,
  CheckCircle,
  Camera,
  Truck,
  Users
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { RentalReductionDashboardData, RentalAgingBucket, RentalListItem } from "@shared/schema";

const AGING_COLORS: Record<RentalAgingBucket, string> = {
  "28 plus days": "#ef4444",
  "21 plus days": "#f97316", 
  "14 plus days": "#eab308",
  "Less than 14 days": "#22c55e"
};

const CHART_CONFIG = {
  "28 plus days": { label: "28+ Days", color: "#ef4444" },
  "21 plus days": { label: "21+ Days", color: "#f97316" },
  "14 plus days": { label: "14+ Days", color: "#eab308" },
  "Less than 14 days": { label: "<14 Days", color: "#22c55e" },
  total: { label: "Total", color: "#3b82f6" },
  over14: { label: ">14 Days", color: "#ef4444" },
};

export default function RentalReductionDashboard() {
  const [filterType, setFilterType] = useState<"all" | "enterprise" | "nonEnterprise">("all");
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<RentalReductionDashboardData>({
    queryKey: ["/api/rental-reduction/dashboard"],
    refetchInterval: 5 * 60 * 1000,
  });

  // Snapshot capture mutation
  const captureSnapshotMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/rental-reduction/snapshot");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(errorData.message || `Failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Snapshot Captured",
        description: `Saved ${data.stats.grandTotal} rentals for ${data.snapshotDate}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rental-reduction/dashboard"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Snapshot Failed",
        description: error.message || "Could not capture snapshot. Ensure Snowflake is configured.",
        variant: "destructive",
      });
    },
  });

  // Check if snapshot capture is available (only for live data mode)
  const canCaptureSnapshot = data?.isLiveData === true;

  // Fleet Overview Statistics query
  interface FleetOverviewStats {
    isLiveData: boolean;
    lastUpdated: string;
    technicians: {
      totalActiveTechs: number;
      modifiedDutyTechs: number;
      activeRoutableTechs: number;
      byovTechnicians: number;
      techsRequiringTruck: number;
    };
    assignments: {
      trucksAssignedInTpms: number;
      trucksAssignedExclByov: number;
      techsWithNoTruck: number;
      modifiedDutyNoTruck: number;
      activeTechsNeedingTruck: number;
      techsWithDeclinedRepairTruck: number;
    };
    vehicles: {
      totalActiveHolmanVehicles: number;
      trucksAssigned: number;
      sentToAuction: number;
      declinedRepairUnassigned: number;
      totalSpares: number;
    };
  }

  const { data: fleetStats, isLoading: fleetStatsLoading } = useQuery<FleetOverviewStats>({
    queryKey: ["/api/fleet-overview/statistics"],
    refetchInterval: 5 * 60 * 1000,
  });

  const filteredDetails = useMemo(() => {
    if (!data?.rentalDetails) return [];
    if (filterType === "all") return data.rentalDetails;
    if (filterType === "enterprise") return data.rentalDetails.filter(r => r.isEnterprise);
    return data.rentalDetails.filter(r => !r.isEnterprise);
  }, [data?.rentalDetails, filterType]);

  const pieChartData = useMemo(() => {
    if (!data?.currentSnapshot?.summary) return [];
    return data.currentSnapshot.summary.map(s => ({
      name: s.bucket,
      value: s.rentalsOpen,
      fill: AGING_COLORS[s.bucket]
    }));
  }, [data?.currentSnapshot?.summary]);

  const trendChartData = useMemo(() => {
    if (!data?.progressHistory) return [];
    return data.progressHistory.map(snapshot => ({
      date: format(new Date(snapshot.date), "MM/dd"),
      total: snapshot.grandTotal,
      over14: snapshot.totalOver14Days,
      "28 plus days": snapshot.buckets.find(b => b.bucket === "28 plus days")?.rentalsOpen || 0,
      "21 plus days": snapshot.buckets.find(b => b.bucket === "21 plus days")?.rentalsOpen || 0,
      "14 plus days": snapshot.buckets.find(b => b.bucket === "14 plus days")?.rentalsOpen || 0,
      "Less than 14 days": snapshot.buckets.find(b => b.bucket === "Less than 14 days")?.rentalsOpen || 0,
    }));
  }, [data?.progressHistory]);

  if (error) {
    return (
      <MainContent>
        <TopBar title="Rental Reduction" breadcrumbs={["Home", "Dashboards", "Rental Reduction"]} />
        <main className="p-6">
          <BackButton />
          <Card className="border-destructive mt-4">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span>Failed to load rental data. Please try again later.</span>
              </div>
            </CardContent>
          </Card>
        </main>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <TopBar title="Rental Reduction Dashboard" breadcrumbs={["Home", "Dashboards", "Rental Reduction"]} />
      <main className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <BackButton />
            <div className="flex items-center gap-2">
              {data && !data.isLiveData && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
                  Sample Data
                </Badge>
              )}
              {canCaptureSnapshot && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => captureSnapshotMutation.mutate()}
                  disabled={captureSnapshotMutation.isPending}
                >
                  <Camera className={cn("h-4 w-4 mr-2", captureSnapshotMutation.isPending && "animate-pulse")} />
                  {captureSnapshotMutation.isPending ? "Saving..." : "Capture Snapshot"}
                </Button>
              )}
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[1,2,3,4].map(i => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-4 w-24" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : data ? (
            <>
              <div className="grid gap-4 md:grid-cols-5">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Open Rentals</CardTitle>
                    <Car className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{data.currentSnapshot.grandTotal}</div>
                    <p className="text-xs text-muted-foreground">
                      {data.currentSnapshot.enterpriseTotal} Enterprise, {data.currentSnapshot.nonEnterpriseTotal} Non-Enterprise
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-red-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">28+ Days</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {data.currentSnapshot.summary.find(s => s.bucket === "28 plus days")?.rentalsOpen || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((data.currentSnapshot.summary.find(s => s.bucket === "28 plus days")?.percentOfTotal || 0) * 100).toFixed(1)}% of total
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-orange-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">21-27 Days</CardTitle>
                    <Clock className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {data.currentSnapshot.summary.find(s => s.bucket === "21 plus days")?.rentalsOpen || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((data.currentSnapshot.summary.find(s => s.bucket === "21 plus days")?.percentOfTotal || 0) * 100).toFixed(1)}% of total
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-yellow-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">14-20 Days</CardTitle>
                    <Clock className="h-4 w-4 text-yellow-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-yellow-600">
                      {data.currentSnapshot.summary.find(s => s.bucket === "14 plus days")?.rentalsOpen || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((data.currentSnapshot.summary.find(s => s.bucket === "14 plus days")?.percentOfTotal || 0) * 100).toFixed(1)}% of total
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-green-200">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Under 14 Days</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {data.currentSnapshot.summary.find(s => s.bucket === "Less than 14 days")?.rentalsOpen || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((data.currentSnapshot.summary.find(s => s.bucket === "Less than 14 days")?.percentOfTotal || 0) * 100).toFixed(1)}% of total
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="summary" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="progress">Running Progress</TabsTrigger>
                  <TabsTrigger value="details">Rental Details</TabsTrigger>
                  <TabsTrigger value="fleet-overview">Fleet Overview</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Rental Distribution by Age</CardTitle>
                        <CardDescription>Current snapshot of open rentals by aging bucket</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={pieChartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''}`}
                                outerRadius={100}
                                dataKey="value"
                              >
                                {pieChartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Pie>
                              <Tooltip />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Summary Statistics</CardTitle>
                        <CardDescription>Breakdown by aging category</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {data.currentSnapshot.summary.map((item) => (
                            <div key={item.bucket} className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div 
                                  className="w-3 h-3 rounded-full" 
                                  style={{ backgroundColor: AGING_COLORS[item.bucket] }}
                                />
                                <span className="font-medium">{item.bucket}</span>
                              </div>
                              <div className="flex items-center gap-4 text-sm">
                                <span className="font-bold">{item.rentalsOpen}</span>
                                <span className="text-muted-foreground w-16 text-right">
                                  {(item.percentOfTotal * 100).toFixed(1)}%
                                </span>
                                <span className="text-muted-foreground w-20 text-right">
                                  Avg: {item.avgDaysOpen.toFixed(0)} days
                                </span>
                              </div>
                            </div>
                          ))}
                          <div className="border-t pt-4 flex items-center justify-between font-bold">
                            <span>Grand Total</span>
                            <span>{data.currentSnapshot.grandTotal}</span>
                          </div>
                          <div className="flex items-center justify-between text-destructive font-semibold">
                            <span>Total Over 14 Days</span>
                            <span>{data.currentSnapshot.totalOver14Days} ({(data.currentSnapshot.percentOver14Days * 100).toFixed(1)}%)</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Vendor Breakdown Section */}
                  {data.currentSnapshot.vendorBreakdown && data.currentSnapshot.vendorBreakdown.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Breakdown by Rental Vendor</CardTitle>
                        <CardDescription>Distribution of rentals across vendors (SOURCE)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left p-2 font-medium">Vendor</th>
                                <th className="text-right p-2 font-medium">Count</th>
                                <th className="text-right p-2 font-medium">% of Total</th>
                                <th className="text-right p-2 font-medium">Avg Days</th>
                                <th className="text-right p-2 font-medium">Over 14 Days</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.currentSnapshot.vendorBreakdown.map((vendor) => (
                                <tr key={vendor.vendor} className="border-b hover:bg-muted/50">
                                  <td className="p-2 font-medium">{vendor.vendor}</td>
                                  <td className="p-2 text-right">{vendor.count}</td>
                                  <td className="p-2 text-right">{(vendor.percentOfTotal * 100).toFixed(1)}%</td>
                                  <td className="p-2 text-right">{vendor.avgDaysOpen.toFixed(0)}</td>
                                  <td className={cn(
                                    "p-2 text-right",
                                    vendor.over14Days > 0 ? "text-destructive font-medium" : ""
                                  )}>
                                    {vendor.over14Days}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="progress" className="space-y-4">
                  {canCaptureSnapshot && data.progressHistory.length <= 1 && (
                    <Card className="border-amber-200 bg-amber-50/50">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-amber-800">
                            <Clock className="h-5 w-5" />
                            <span>No historical snapshots found. Click "Capture Snapshot" to start tracking trends over time.</span>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => captureSnapshotMutation.mutate()}
                            disabled={captureSnapshotMutation.isPending}
                            className="ml-4"
                          >
                            <Camera className={cn("h-4 w-4 mr-2", captureSnapshotMutation.isPending && "animate-pulse")} />
                            {captureSnapshotMutation.isPending ? "Saving..." : "Capture Now"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {canCaptureSnapshot && data.progressHistory.length > 1 && (
                    <Card className="border-green-200 bg-green-50/50">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 text-green-800">
                          <CheckCircle className="h-5 w-5" />
                          <span>Historical tracking enabled. Showing {data.progressHistory.length} snapshots over the past 30 days.</span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  <Card>
                    <CardHeader>
                      <CardTitle>Rental Reduction Trend</CardTitle>
                      <CardDescription>
                        {data.isLiveData && data.progressHistory.length <= 1 
                          ? "Current snapshot - historical tracking not yet enabled"
                          : "Track progress over time - comparing to benchmark"
                        }
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name="Total Rentals" />
                            <Line type="monotone" dataKey="over14" stroke="#ef4444" strokeWidth={2} name="Over 14 Days" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Aging Bucket Breakdown Over Time</CardTitle>
                      <CardDescription>Stacked view of rental categories</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="28 plus days" stackId="a" fill={AGING_COLORS["28 plus days"]} name="28+ Days" />
                            <Bar dataKey="21 plus days" stackId="a" fill={AGING_COLORS["21 plus days"]} name="21+ Days" />
                            <Bar dataKey="14 plus days" stackId="a" fill={AGING_COLORS["14 plus days"]} name="14+ Days" />
                            <Bar dataKey="Less than 14 days" stackId="a" fill={AGING_COLORS["Less than 14 days"]} name="<14 Days" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {data.progressHistory.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Running Progress Table</CardTitle>
                        <CardDescription>Detailed view matching the Holman Reporting format</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left p-2 font-medium">Row Labels</th>
                                {data.progressHistory.slice(-5).map((snapshot, idx) => (
                                  <th key={idx} colSpan={3} className="text-center p-2 font-medium border-l">
                                    {format(new Date(snapshot.date), "M/d")}
                                  </th>
                                ))}
                              </tr>
                              <tr className="border-b text-muted-foreground text-xs">
                                <th></th>
                                {data.progressHistory.slice(-5).map((_, idx) => (
                                  <Fragment key={`header-${idx}`}>
                                    <th className="p-2">Open</th>
                                    <th className="p-2">%</th>
                                    <th className="p-2">Chg</th>
                                  </Fragment>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(["28 plus days", "21 plus days", "14 plus days", "Less than 14 days"] as RentalAgingBucket[]).map(bucket => (
                                <tr key={bucket} className="border-b hover:bg-muted/50">
                                  <td className="p-2 font-medium">{bucket}</td>
                                  {data.progressHistory.slice(-5).map((snapshot, idx) => {
                                    const bucketData = snapshot.buckets.find(b => b.bucket === bucket);
                                    return (
                                      <Fragment key={`${bucket}-${idx}`}>
                                        <td className="p-2 text-center">{bucketData?.rentalsOpen || 0}</td>
                                        <td className="p-2 text-center">{((bucketData?.percentOfTotal || 0) * 100).toFixed(1)}%</td>
                                        <td className={cn(
                                          "p-2 text-center",
                                          (bucketData?.changeMtd || 0) > 0 ? "text-destructive" : (bucketData?.changeMtd || 0) < 0 ? "text-green-600" : ""
                                        )}>
                                          {(bucketData?.changeMtd || 0) > 0 ? "+" : ""}{bucketData?.changeMtd || 0}
                                        </td>
                                      </Fragment>
                                    );
                                  })}
                                </tr>
                              ))}
                              <tr className="border-t-2 font-bold">
                                <td className="p-2">Grand Total</td>
                                {data.progressHistory.slice(-5).map((snapshot, idx) => (
                                  <Fragment key={`total-${idx}`}>
                                    <td className="p-2 text-center">{snapshot.grandTotal}</td>
                                    <td className="p-2 text-center">100%</td>
                                    <td className="p-2 text-center">-</td>
                                  </Fragment>
                                ))}
                              </tr>
                              <tr className="bg-destructive/10 font-semibold">
                                <td className="p-2">Total &gt;14 Days</td>
                                {data.progressHistory.slice(-5).map((snapshot, idx) => (
                                  <Fragment key={`over14-${idx}`}>
                                    <td className="p-2 text-center">{snapshot.totalOver14Days}</td>
                                    <td className="p-2 text-center">{(snapshot.percentOver14Days * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-center">-</td>
                                  </Fragment>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="details" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>Rental Details</CardTitle>
                          <CardDescription>Individual rental records</CardDescription>
                        </div>
                        <Select value={filterType} onValueChange={(v: "all" | "enterprise" | "nonEnterprise") => setFilterType(v)}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Rentals</SelectItem>
                            <SelectItem value="enterprise">Enterprise Only</SelectItem>
                            <SelectItem value="nonEnterprise">Non-Enterprise Only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2 font-medium">Truck #</th>
                              <th className="text-left p-2 font-medium">Rental Start</th>
                              <th className="text-left p-2 font-medium">Aging</th>
                              <th className="text-left p-2 font-medium">Days Open</th>
                              <th className="text-left p-2 font-medium">Rental Under</th>
                              <th className="text-left p-2 font-medium">Enterprise ID</th>
                              <th className="text-left p-2 font-medium">Assigned To</th>
                              <th className="text-left p-2 font-medium">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredDetails.slice(0, 100).map((rental, idx) => (
                              <tr key={idx} className="border-b hover:bg-muted/50">
                                <td className="p-2 font-mono">{rental.truckNumber}</td>
                                <td className="p-2">
                                  {rental.rentalStartDate ? format(new Date(rental.rentalStartDate), "MM/dd/yyyy") : "-"}
                                </td>
                                <td className="p-2">
                                  <Badge 
                                    variant="outline" 
                                    style={{ 
                                      backgroundColor: `${AGING_COLORS[rental.rentalDays as RentalAgingBucket]}20`,
                                      borderColor: AGING_COLORS[rental.rentalDays as RentalAgingBucket],
                                      color: AGING_COLORS[rental.rentalDays as RentalAgingBucket]
                                    }}
                                  >
                                    {rental.rentalDays}
                                  </Badge>
                                </td>
                                <td className="p-2">{rental.daysOpen}</td>
                                <td className="p-2">{rental.rentalUnderName || "-"}</td>
                                <td className="p-2 font-mono">{rental.rentalTechEnterpriseId || "-"}</td>
                                <td className="p-2">{rental.truckAssignedToInTpms || "-"}</td>
                                <td className="p-2">
                                  <Badge variant={rental.isEnterprise ? "default" : "secondary"}>
                                    {rental.isEnterprise ? "Enterprise" : "Non-Enterprise"}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {filteredDetails.length > 100 && (
                          <p className="text-sm text-muted-foreground mt-4 text-center">
                            Showing first 100 of {filteredDetails.length} records. Export for full data.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="fleet-overview" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5" />
                            Fleet Overview Statistics
                          </CardTitle>
                          <CardDescription>
                            Technician and vehicle assignment summary from TPMS and Holman
                          </CardDescription>
                        </div>
                        {fleetStats && !fleetStats.isLiveData && (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
                            Sample Data
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {fleetStatsLoading ? (
                        <div className="space-y-4">
                          {[1,2,3].map(i => (
                            <Skeleton key={i} className="h-24 w-full" />
                          ))}
                        </div>
                      ) : fleetStats ? (
                        <div className="space-y-6">
                          <div className="grid md:grid-cols-3 gap-6">
                            <Card className="border-blue-200 bg-blue-50/30">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                  <Users className="h-4 w-4 text-blue-600" />
                                  Technician Summary
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <table className="w-full text-sm">
                                  <tbody>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold">Total Technicians in TPMS (Active Techs):</td>
                                      <td className="py-2 text-right font-bold text-blue-700">{fleetStats.technicians.totalActiveTechs.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">Service Tech - Modified Duty:</td>
                                      <td className="py-2 text-right">{fleetStats.technicians.modifiedDutyTechs}</td>
                                    </tr>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold">Active Routable Technicians (excl. Modified Duty):</td>
                                      <td className="py-2 text-right font-bold">{fleetStats.technicians.activeRoutableTechs.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">BYOV Technicians:</td>
                                      <td className="py-2 text-right">{fleetStats.technicians.byovTechnicians}</td>
                                    </tr>
                                    <tr>
                                      <td className="py-2 font-semibold">Total Techs requiring a truck assignment:</td>
                                      <td className="py-2 text-right font-bold">{fleetStats.technicians.techsRequiringTruck.toLocaleString()}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </CardContent>
                            </Card>

                            <Card className="border-green-200 bg-green-50/30">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                  <Truck className="h-4 w-4 text-green-600" />
                                  Assignment Status
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <table className="w-full text-sm">
                                  <tbody>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">Trucks Assigned in TPMS (incl. modified):</td>
                                      <td className="py-2 text-right">{fleetStats.assignments.trucksAssignedInTpms.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold">Trucks Assigned in TPMS (excl BYOV):</td>
                                      <td className="py-2 text-right font-bold">{fleetStats.assignments.trucksAssignedExclByov.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">No Truck Assigned (All Techs):</td>
                                      <td className="py-2 text-right">{fleetStats.assignments.techsWithNoTruck}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">Truck not assigned for modified duty tech:</td>
                                      <td className="py-2 text-right">{fleetStats.assignments.modifiedDutyNoTruck}</td>
                                    </tr>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold text-amber-700">Active techs needing truck (excl. mod duty):</td>
                                      <td className="py-2 text-right font-bold text-amber-700">{fleetStats.assignments.activeTechsNeedingTruck}</td>
                                    </tr>
                                    <tr>
                                      <td className="py-2 font-semibold text-red-700">Techs with declined repair truck:</td>
                                      <td className="py-2 text-right font-bold text-red-700">{fleetStats.assignments.techsWithDeclinedRepairTruck}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </CardContent>
                            </Card>

                            <Card className="border-purple-200 bg-purple-50/30">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                  <Car className="h-4 w-4 text-purple-600" />
                                  Holman Vehicles
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <table className="w-full text-sm">
                                  <tbody>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold">Total Active Holman Vehicles (excl BYOV):</td>
                                      <td className="py-2 text-right font-bold text-purple-700">{fleetStats.vehicles.totalActiveHolmanVehicles.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b">
                                      <td className="py-2 font-semibold">Trucks Assigned (excl BYOV):</td>
                                      <td className="py-2 text-right font-bold">{fleetStats.vehicles.trucksAssigned.toLocaleString()}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">Trucks marked "Sent to Auction":</td>
                                      <td className="py-2 text-right">{fleetStats.vehicles.sentToAuction}</td>
                                    </tr>
                                    <tr className="border-b text-muted-foreground">
                                      <td className="py-2 pl-4 italic">Unassigned trucks "Declined Repair":</td>
                                      <td className="py-2 text-right">{fleetStats.vehicles.declinedRepairUnassigned}</td>
                                    </tr>
                                    <tr>
                                      <td className="py-2 font-semibold">Total Spares (not declined/auction):</td>
                                      <td className="py-2 text-right font-bold text-green-700">{fleetStats.vehicles.totalSpares}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </CardContent>
                            </Card>
                          </div>

                          <Card className="border-amber-200 bg-amber-50/30">
                            <CardContent className="pt-4">
                              <div className="flex items-center gap-2 text-amber-800 text-sm">
                                <AlertTriangle className="h-4 w-4" />
                                <span>
                                  <strong>Note:</strong> "Sent to Auction" and "Declined Repair" counts require additional data sources (Holman status fields).
                                  Contact your administrator to configure these data sources.
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          Unable to load fleet statistics.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="text-xs text-muted-foreground text-right">
                Last updated: {data.lastUpdated ? format(new Date(data.lastUpdated), "MMM d, yyyy h:mm a") : "N/A"}
              </div>
            </>
          ) : null}
      </main>
    </MainContent>
  );
}
