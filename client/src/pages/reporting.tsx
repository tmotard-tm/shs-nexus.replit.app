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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <CardContent className="p-3 flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-blue-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{totalTasks}</p>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/70">Total Tasks</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <CardContent className="p-3 flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{totalInProgress}</p>
                <p className="text-xs text-amber-600/70 dark:text-amber-400/70">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
            <CardContent className="p-3 flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">{totalCompleted}</p>
                <p className="text-xs text-green-600/70 dark:text-green-400/70">Completed</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800">
            <CardContent className="p-3 flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-purple-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{completedToday}</p>
                <p className="text-xs text-purple-600/70 dark:text-purple-400/70">Completed Today</p>
              </div>
            </CardContent>
          </Card>
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
      </div>
    </div>
  );
}
