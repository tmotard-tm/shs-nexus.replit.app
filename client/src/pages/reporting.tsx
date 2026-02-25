import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Users,
  Clock,
  CheckCircle,
  TrendingUp,
  RefreshCw,
  AlertCircle,
  Loader2,
  Activity,
  ListChecks,
  Calendar,
  Truck,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Key,
  Smartphone,
  Wrench,
  Package,
  MapPin,
} from "lucide-react";

interface QueueSummary {
  module: string;
  label: string;
  total: number;
  new: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  completedToday: number;
  completedThisWeek: number;
  completedThisMonth: number;
  avgResolutionHours: number;
}

interface Roadblock {
  type: string;
  severity: string;
  message: string;
  count: number;
}

interface ReportData {
  generatedAt: string;
  queueSummary: QueueSummary[];
  activityByDay: Record<string, number>;
  activityByAction: Record<string, number>;
  userStats: {
    totalActive: number;
    totalInactive: number;
    byRole: Record<string, number>;
  };
  topAgents: { username: string; completed: number }[];
  vehicleIntelligence: {
    nexusTracking: {
      totalTracked: number;
      byDisposition: Record<string, number>;
      byKeyStatus: Record<string, number>;
      byRepairStatus: Record<string, number>;
      phoneRecoveryInitiated: number;
    };
    holmanFleet: {
      totalVehicles: number;
      byStatus: Record<string, number>;
      byMake: Record<string, number>;
      byState: Record<string, number>;
      byFuelType: Record<string, number>;
    };
    fleetMetrics: {
      totalActive: number;
      outOfService: number;
      assigned: number;
      unassigned: number;
      assignmentMismatches: number;
      inRepair: number;
      estimateDeclines: number;
      spareAvailable: number;
    };
    assignments: {
      activeAssignments: number;
      totalAssignments: number;
    };
  };
  onboardingIntelligence: {
    totalHires: number;
    assignedCount: number;
    pendingCount: number;
    completedThisWeek: number;
    completedThisMonth: number;
    aged14Days: number;
    aged30Days: number;
    byEmploymentStatus: Record<string, number>;
    pendingByState: Record<string, number>;
    roadblocks: Roadblock[];
  };
  offboardingIntelligence: {
    totalCases: number;
    completed: number;
    inProgress: number;
    pending: number;
    completedThisWeek: number;
    completedThisMonth: number;
    aged14Days: number;
    aged30Days: number;
    taskCompletionRates: {
      toolsReturn: number;
      iphoneReturn: number;
      phoneDisconnect: number;
      mPaymentDeactivation: number;
      segnoOrders: number;
      shippingLabel: number;
    };
    vehicleDisposition: Record<string, number>;
    keyRecovery: Record<string, number>;
    phoneRecovery: { initiated: number; notInitiated: number };
    repairStatus: Record<string, number>;
    termedTechStats: {
      total: number;
      tasksCreated: number;
      unprocessed: number;
      fullyProcessed: number;
    };
    roadblocks: Roadblock[];
  };
}

function StatCard({ icon: Icon, label, value, color, subtext }: {
  icon: any;
  label: string;
  value: number | string;
  color: string;
  subtext?: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400",
    green: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400",
    amber: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400",
    red: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
    purple: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400",
    orange: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400",
    cyan: "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800 text-cyan-700 dark:text-cyan-400",
    slate: "bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400",
  };
  const iconColorMap: Record<string, string> = {
    blue: "text-blue-600", green: "text-green-600", amber: "text-amber-600",
    red: "text-red-600", purple: "text-purple-600", orange: "text-orange-600",
    cyan: "text-cyan-600", slate: "text-slate-600",
  };
  const subtextColorMap: Record<string, string> = {
    blue: "text-blue-600/70 dark:text-blue-400/70", green: "text-green-600/70 dark:text-green-400/70",
    amber: "text-amber-600/70 dark:text-amber-400/70", red: "text-red-600/70 dark:text-red-400/70",
    purple: "text-purple-600/70 dark:text-purple-400/70", orange: "text-orange-600/70 dark:text-orange-400/70",
    cyan: "text-cyan-600/70 dark:text-cyan-400/70", slate: "text-slate-600/70 dark:text-slate-400/70",
  };
  return (
    <Card className={colorMap[color] || colorMap.blue}>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`h-8 w-8 shrink-0 ${iconColorMap[color] || "text-blue-600"}`} />
        <div>
          <p className={`text-2xl font-bold ${colorMap[color]?.split(' ').find(c => c.startsWith('text-')) || ''}`}>{value}</p>
          <p className={`text-xs ${subtextColorMap[color] || ""}`}>{label}</p>
          {subtext && <p className={`text-[10px] ${subtextColorMap[color] || ""}`}>{subtext}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, gradient }: {
  icon: any;
  title: string;
  subtitle: string;
  gradient: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${gradient}`}>
        <Icon className="h-4.5 w-4.5 text-white" />
      </div>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ProgressBar({ label, value, color }: { label: string; value: number; color: string }) {
  const barColors: Record<string, string> = {
    green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500",
    blue: "bg-blue-500", purple: "bg-purple-500", cyan: "bg-cyan-500",
  };
  const effectiveColor = value >= 50 ? "green" : value >= 20 ? "amber" : "red";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColors[color] || barColors[effectiveColor]}`}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </div>
    </div>
  );
}

function RoadblocksCard({ roadblocks }: { roadblocks: Roadblock[] }) {
  if (!roadblocks || roadblocks.length === 0) return null;
  const severityIcon: Record<string, string> = {
    critical: "text-red-600",
    high: "text-orange-600",
    medium: "text-amber-600",
  };
  return (
    <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          Action Required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {roadblocks.map((rb, i) => (
          <div key={i} className="flex items-start gap-2 py-1.5 border-b border-red-200/50 dark:border-red-800/50 last:border-0">
            <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${severityIcon[rb.severity] || "text-amber-600"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{rb.message}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={rb.severity === 'critical' ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0">
                  {rb.severity}
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">{rb.count} item{rb.count !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatDisposition(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace('Pmf', 'PMF');
}

export default function Reporting() {
  const { user } = useAuth();

  const reportQuery = useQuery<ReportData>({
    queryKey: ["/api/reports"],
    enabled: user?.role === "developer",
    refetchInterval: 5 * 60 * 1000,
  });

  if (user?.role !== "developer") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">Reports are only available to developers.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reportQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-muted-foreground">Loading report data...</p>
        </div>
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Error Loading Data</h2>
            <p className="text-muted-foreground mb-4">Failed to load report data. Please try again.</p>
            <Button onClick={() => reportQuery.refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = reportQuery.data;
  const totalTasks = data?.queueSummary?.reduce((sum, q) => sum + q.total, 0) || 0;
  const totalCompleted = data?.queueSummary?.reduce((sum, q) => sum + q.completed, 0) || 0;
  const totalInProgress = data?.queueSummary?.reduce((sum, q) => sum + q.in_progress, 0) || 0;
  const completedToday = data?.queueSummary?.reduce((sum, q) => sum + q.completedToday, 0) || 0;
  const completedThisWeek = data?.queueSummary?.reduce((sum, q) => sum + q.completedThisWeek, 0) || 0;
  const completedThisMonth = data?.queueSummary?.reduce((sum, q) => sum + q.completedThisMonth, 0) || 0;
  const totalNew = data?.queueSummary?.reduce((sum, q) => sum + q.new, 0) || 0;
  const totalCancelled = data?.queueSummary?.reduce((sum, q) => sum + q.cancelled, 0) || 0;

  const sortedDays = data?.activityByDay
    ? Object.entries(data.activityByDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7)
    : [];

  const sortedActions = data?.activityByAction
    ? Object.entries(data.activityByAction).sort(([, a], [, b]) => b - a)
    : [];

  const fleet = data?.vehicleIntelligence?.fleetMetrics;
  const holman = data?.vehicleIntelligence?.holmanFleet;
  const nexus = data?.vehicleIntelligence?.nexusTracking;
  const onb = data?.onboardingIntelligence;
  const offb = data?.offboardingIntelligence;

  const topMakes = holman?.byMake
    ? Object.entries(holman.byMake).sort(([, a], [, b]) => b - a).slice(0, 8)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-h-screen overflow-y-auto">
      <div className="px-6 py-4 border-b bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Nexus Reports</h1>
              <p className="text-sm text-muted-foreground">Operations dashboard and metrics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge variant="outline" className="text-xs">
                Data as of {new Date(data.generatedAt).toLocaleTimeString()}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${reportQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-6">
        {/* Operations Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={BarChart3} label="Total Tasks" value={totalTasks} color="blue" />
          <StatCard icon={Clock} label="In Progress" value={totalInProgress} color="amber" />
          <StatCard icon={CheckCircle} label="Completed" value={totalCompleted} color="green" />
          <StatCard icon={TrendingUp} label="Completed Today" value={completedToday} color="purple" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-blue-500" />
                Queue Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.queueSummary?.map((q) => (
                <div key={q.module} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{q.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.new} new · {q.in_progress} active · {q.completed} done
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">{q.total}</Badge>
                </div>
              ))}
              {(!data?.queueSummary || data.queueSummary.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No queue data</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-500" />
                Completion Trends
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{completedToday}</p>
                  <p className="text-xs text-muted-foreground">Today</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{completedThisWeek}</p>
                  <p className="text-xs text-muted-foreground">This Week</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{completedThisMonth}</p>
                  <p className="text-xs text-muted-foreground">This Month</p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Status Distribution</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">New</span>
                    <span className="font-medium">{totalNew}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">In Progress</span>
                    <span className="font-medium">{totalInProgress}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-medium">{totalCompleted}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Cancelled</span>
                    <span className="font-medium">{totalCancelled}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-500" />
                Top Agents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data?.topAgents?.slice(0, 8).map((agent, i) => (
                <div key={agent.username} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground w-5">{i + 1}.</span>
                    <span className="text-sm">{agent.username}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">{agent.completed} done</Badge>
                </div>
              ))}
              {(!data?.topAgents || data.topAgents.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No agent data</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-500" />
                Recent Activity (7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sortedDays.map(([day, count]) => {
                const maxCount = Math.max(...sortedDays.map(([, c]) => c), 1);
                const pct = (count / maxCount) * 100;
                return (
                  <div key={day} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {sortedDays.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-500" />
                Activity by Type
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sortedActions.slice(0, 10).map(([action, count]) => (
                <div key={action} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <span className="text-sm text-muted-foreground capitalize">{action.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary" className="text-xs">{count}</Badge>
                </div>
              ))}
              {sortedActions.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No activity data</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" />
                User Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">{data?.userStats?.totalActive || 0}</p>
                  <p className="text-xs text-muted-foreground">Active</p>
                </div>
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{data?.userStats?.totalInactive || 0}</p>
                  <p className="text-xs text-muted-foreground">Inactive</p>
                </div>
              </div>
              {data?.userStats?.byRole && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">By Role</p>
                  {Object.entries(data.userStats.byRole).map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground capitalize">{role}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Fleet Intelligence */}
        {fleet && (
          <>
            <SectionHeader
              icon={Truck}
              title="Fleet Intelligence"
              subtitle="Vehicle fleet status, assignments, and health metrics"
              gradient="from-blue-600 to-cyan-500"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Truck} label="Total Active" value={fleet.totalActive.toLocaleString()} color="blue" />
              <StatCard icon={CheckCircle} label="Assigned" value={fleet.assigned.toLocaleString()} color="green" />
              <StatCard icon={AlertCircle} label="Unassigned" value={fleet.unassigned.toLocaleString()} color="amber" />
              <StatCard icon={AlertTriangle} label="Out of Service" value={fleet.outOfService} color="red" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Wrench} label="In Repair" value={fleet.inRepair} color="orange" />
              <StatCard icon={AlertCircle} label="Estimate Declines" value={fleet.estimateDeclines} color="red" />
              <StatCard icon={Package} label="Available / Spare" value={fleet.spareAvailable} color="cyan" />
              <StatCard icon={AlertTriangle} label="Assignment Mismatches" value={fleet.assignmentMismatches} color="amber" subtext="Holman vs TPMS" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    Vehicle Disposition
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {nexus?.byDisposition && Object.entries(nexus.byDisposition)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{formatDisposition(status)}</span>
                        <Badge variant="secondary" className="text-xs">{count}</Badge>
                      </div>
                    ))}
                  {!nexus?.byDisposition && <p className="text-sm text-muted-foreground text-center py-4">No data</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Truck className="h-4 w-4 text-cyan-500" />
                    Fleet by Make
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {topMakes.map(([make, count]) => {
                    const maxMake = topMakes[0]?.[1] || 1;
                    const pct = (count / maxMake) * 100;
                    return (
                      <div key={make} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{make}</span>
                          <span className="font-medium">{count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {topMakes.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No data</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-500" />
                    Key Recovery Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {nexus?.byKeyStatus && Object.entries(nexus.byKeyStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{formatDisposition(status)}</span>
                        <Badge
                          variant={status === 'present' ? 'default' : status === 'not_present' ? 'destructive' : 'outline'}
                          className="text-xs"
                        >
                          {count}
                        </Badge>
                      </div>
                    ))}
                  {!nexus?.byKeyStatus && <p className="text-sm text-muted-foreground text-center py-4">No data</p>}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Onboarding Intelligence */}
        {onb && (
          <>
            <SectionHeader
              icon={UserPlus}
              title="Onboarding Pipeline"
              subtitle="New hire vehicle assignments and pipeline health"
              gradient="from-green-600 to-emerald-500"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Users} label="Total Hires" value={onb.totalHires} color="blue" />
              <StatCard icon={CheckCircle} label="Assigned" value={onb.assignedCount} color="green" />
              <StatCard icon={Clock} label="Pending" value={onb.pendingCount} color="amber" />
              <StatCard icon={AlertTriangle} label="Aged 14+ Days" value={onb.aged14Days} color={onb.aged14Days > 0 ? "red" : "slate"} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard icon={Calendar} label="Completed This Week" value={onb.completedThisWeek} color="green" />
              <StatCard icon={Calendar} label="Completed This Month" value={onb.completedThisMonth} color="cyan" />
              <StatCard icon={AlertCircle} label="Aged 30+ Days" value={onb.aged30Days} color={onb.aged30Days > 0 ? "red" : "slate"} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-green-500" />
                    Employment Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {onb.byEmploymentStatus && Object.entries(onb.byEmploymentStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => {
                      const statusLabels: Record<string, string> = { A: 'Active', T: 'Terminated', L: 'Leave', P: 'Pre-hire' };
                      return (
                        <div key={status} className="flex items-center justify-between py-1.5 border-b last:border-0">
                          <span className="text-sm text-muted-foreground">{statusLabels[status] || status}</span>
                          <Badge
                            variant={status === 'A' ? 'default' : status === 'T' ? 'destructive' : 'outline'}
                            className="text-xs"
                          >
                            {count}
                          </Badge>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    Pending by State
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-48 overflow-y-auto">
                  {onb.pendingByState && Object.entries(onb.pendingByState)
                    .sort(([, a], [, b]) => b - a)
                    .map(([state, count]) => (
                      <div key={state} className="flex items-center justify-between py-1 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{state}</span>
                        <Badge variant="secondary" className="text-xs">{count}</Badge>
                      </div>
                    ))}
                  {(!onb.pendingByState || Object.keys(onb.pendingByState).length === 0) && (
                    <p className="text-sm text-green-600 text-center py-4">No pending hires</p>
                  )}
                </CardContent>
              </Card>

              <RoadblocksCard roadblocks={onb.roadblocks} />
            </div>
          </>
        )}

        {/* Offboarding Intelligence */}
        {offb && (
          <>
            <SectionHeader
              icon={UserMinus}
              title="Offboarding & Recovery"
              subtitle="Asset recovery, vehicle disposition, and termed tech processing"
              gradient="from-red-600 to-orange-500"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={ListChecks} label="Total Cases" value={offb.totalCases} color="blue" />
              <StatCard icon={CheckCircle} label="Completed" value={offb.completed} color="green" />
              <StatCard icon={Clock} label="In Progress" value={offb.inProgress} color="amber" />
              <StatCard icon={AlertCircle} label="Pending" value={offb.pending} color="orange" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard icon={Calendar} label="Completed This Month" value={offb.completedThisMonth} color="green" />
              <StatCard icon={AlertTriangle} label="Aged 14+ Days" value={offb.aged14Days} color={offb.aged14Days > 0 ? "amber" : "slate"} />
              <StatCard icon={AlertTriangle} label="Aged 30+ Days" value={offb.aged30Days} color={offb.aged30Days > 0 ? "red" : "slate"} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-blue-500" />
                    Task Completion Rates
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {offb.taskCompletionRates && (
                    <>
                      <ProgressBar label="Tools Return" value={offb.taskCompletionRates.toolsReturn} color="" />
                      <ProgressBar label="iPhone Return" value={offb.taskCompletionRates.iphoneReturn} color="" />
                      <ProgressBar label="Phone Disconnect" value={offb.taskCompletionRates.phoneDisconnect} color="" />
                      <ProgressBar label="mPayment Deactivation" value={offb.taskCompletionRates.mPaymentDeactivation} color="" />
                      <ProgressBar label="Segno Orders" value={offb.taskCompletionRates.segnoOrders} color="" />
                      <ProgressBar label="Shipping Label" value={offb.taskCompletionRates.shippingLabel} color="" />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-orange-500" />
                    Termed Techs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                      <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{offb.termedTechStats?.total || 0}</p>
                      <p className="text-xs text-muted-foreground">Total Termed</p>
                    </div>
                    <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30">
                      <p className="text-lg font-bold text-green-700 dark:text-green-400">{offb.termedTechStats?.tasksCreated || 0}</p>
                      <p className="text-xs text-muted-foreground">Tasks Created</p>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{offb.termedTechStats?.unprocessed || 0}</p>
                      <p className="text-xs text-muted-foreground">Unprocessed</p>
                    </div>
                    <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30">
                      <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{offb.termedTechStats?.fullyProcessed || 0}</p>
                      <p className="text-xs text-muted-foreground">Fully Processed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-500" />
                    Vehicle Disposition
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-64 overflow-y-auto">
                  {offb.vehicleDisposition && Object.entries(offb.vehicleDisposition)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <span className="text-sm text-muted-foreground">{formatDisposition(status)}</span>
                        <Badge variant="secondary" className="text-xs">{count}</Badge>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-purple-500" />
                    Phone & Repair Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Phone Recovery</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-center">
                        <p className="text-lg font-bold text-green-700 dark:text-green-400">{offb.phoneRecovery?.initiated || 0}</p>
                        <p className="text-xs text-muted-foreground">Initiated</p>
                      </div>
                      <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-center">
                        <p className="text-lg font-bold text-red-700 dark:text-red-400">{offb.phoneRecovery?.notInitiated || 0}</p>
                        <p className="text-xs text-muted-foreground">Not Initiated</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Repair Status</p>
                    {offb.repairStatus && Object.entries(offb.repairStatus)
                      .sort(([, a], [, b]) => b - a)
                      .map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between py-1 border-b last:border-0">
                          <span className="text-sm text-muted-foreground">{formatDisposition(status)}</span>
                          <Badge variant="outline" className="text-xs">{count}</Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              <RoadblocksCard roadblocks={offb.roadblocks} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
