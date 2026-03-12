import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp,
  Package,
  Lock,
  Truck,
  CheckCircle,
  Clock,
  ChevronRight,
  AlertCircle,
  ArrowRight,
  Activity,
  Calendar,
  CalendarDays,
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";

interface AggregatedAsset {
  assetId: string;
  status: string;
  activities: Array<{ action: string; activity: string; activityDate: string }>;
  otherFields: Record<string, string>;
}

interface PmfStatusEvent {
  id: string;
  assetId: string;
  status: string;
  previousStatus: string | null;
  effectiveAt: string;
  source: string;
}

interface PMFWeeklyTrackerProps {
  aggregatedAssets: AggregatedAsset[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: typeof Package; description: string; order: number }> = {
  "Pending Arrival": { 
    label: "Pending Arrival", 
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    icon: Clock,
    description: "Added to the system",
    order: 1,
  },
  "Locked Down Local": { 
    label: "Locked Down Local", 
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
    icon: Lock,
    description: "Being processed",
    order: 2,
  },
  "Available": { 
    label: "Available", 
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle,
    description: "Ready to deploy",
    order: 3,
  },
  "Pending Pickup": { 
    label: "Pending Pickup", 
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
    icon: Truck,
    description: "Pending deployment",
    order: 4,
  },
  "Checked Out": { 
    label: "Checked Out", 
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    icon: Package,
    description: "Deployed",
    order: 5,
  },
};

const TRACKED_STATUSES = ["Pending Arrival", "Locked Down Local", "Available", "Pending Pickup", "Checked Out"];

function normalizeStatus(status: string): string {
  if (!status) return "";
  const lower = status.toLowerCase().replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Use exact matching for "available" to avoid matching "unavailable"
  if (lower === 'available') return "Available";
  if (lower.includes('locked') && lower.includes('local')) return "Locked Down Local";
  if (lower.includes('pending') && lower.includes('pickup')) return "Pending Pickup";
  // Match both "check out" and "checked out" variations
  if (lower === 'check out' || lower === 'checked out') return "Checked Out";
  if (lower.includes('pending') && lower.includes('arrival')) return "Pending Arrival";
  
  return status;
}

export function PMFWeeklyTracker({ aggregatedAssets }: PMFWeeklyTrackerProps) {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  
  // Fetch status events for the past 30 days
  const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));
  const { data: statusEvents = [] } = useQuery<PmfStatusEvent[]>({
    queryKey: ['/api/pmf/status-events', thirtyDaysAgo.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/pmf/status-events?startDate=${thirtyDaysAgo.toISOString()}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const otherCount = { count: 0, statuses: new Set<string>() };
    
    TRACKED_STATUSES.forEach(status => {
      counts[status] = 0;
    });
    
    aggregatedAssets.forEach(asset => {
      const normalizedStatus = normalizeStatus(asset.status);
      if (TRACKED_STATUSES.includes(normalizedStatus)) {
        counts[normalizedStatus] = (counts[normalizedStatus] || 0) + 1;
      } else if (asset.status) {
        otherCount.count++;
        otherCount.statuses.add(asset.status);
      }
    });
    
    return { counts, other: otherCount };
  }, [aggregatedAssets]);

  // Aggregate status transitions by period
  const transitionStats = useMemo(() => {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    
    const periods = {
      today: { into: {} as Record<string, number>, outOf: {} as Record<string, number>, total: 0, newVehicles: 0 },
      thisWeek: { into: {} as Record<string, number>, outOf: {} as Record<string, number>, total: 0, newVehicles: 0 },
      thisMonth: { into: {} as Record<string, number>, outOf: {} as Record<string, number>, total: 0, newVehicles: 0 },
    };
    
    TRACKED_STATUSES.forEach(status => {
      periods.today.into[status] = 0;
      periods.today.outOf[status] = 0;
      periods.thisWeek.into[status] = 0;
      periods.thisWeek.outOf[status] = 0;
      periods.thisMonth.into[status] = 0;
      periods.thisMonth.outOf[status] = 0;
    });
    
    statusEvents.forEach(event => {
      const eventDate = new Date(event.effectiveAt);
      const normalizedStatus = normalizeStatus(event.status);
      const normalizedPrevStatus = event.previousStatus ? normalizeStatus(event.previousStatus) : null;
      
      // Helper to update period stats
      const updatePeriod = (period: typeof periods.today) => {
        period.total++;
        if (!normalizedPrevStatus) {
          period.newVehicles++;
        }
        if (TRACKED_STATUSES.includes(normalizedStatus)) {
          period.into[normalizedStatus] = (period.into[normalizedStatus] || 0) + 1;
        }
        if (normalizedPrevStatus && TRACKED_STATUSES.includes(normalizedPrevStatus)) {
          period.outOf[normalizedPrevStatus] = (period.outOf[normalizedPrevStatus] || 0) + 1;
        }
      };
      
      // Check which periods this event falls into
      if (eventDate >= todayStart && eventDate <= todayEnd) {
        updatePeriod(periods.today);
      }
      if (eventDate >= weekStart && eventDate <= weekEnd) {
        updatePeriod(periods.thisWeek);
      }
      if (eventDate >= monthStart && eventDate <= monthEnd) {
        updatePeriod(periods.thisMonth);
      }
    });
    
    return periods;
  }, [statusEvents]);

  // Compute daily breakdown for week/month view
  const dailyBreakdown = useMemo(() => {
    const today = new Date();
    const daysToShow = viewMode === 'week' ? 7 : 30;
    const startDate = startOfDay(subDays(today, daysToShow - 1));
    const endDate = endOfDay(today);
    
    // Generate array of days
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Initialize counts per day per status
    const dailyCounts: Array<{ date: Date; dateStr: string; counts: Record<string, number>; total: number }> = days.map(day => ({
      date: day,
      dateStr: format(day, 'MMM d'),
      counts: TRACKED_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {} as Record<string, number>),
      total: 0,
    }));
    
    // Count events per day per status
    statusEvents.forEach(event => {
      const eventDate = startOfDay(new Date(event.effectiveAt));
      const normalizedStatus = normalizeStatus(event.status);
      
      if (!TRACKED_STATUSES.includes(normalizedStatus)) return;
      
      const dayIndex = days.findIndex(d => startOfDay(d).getTime() === eventDate.getTime());
      if (dayIndex >= 0) {
        dailyCounts[dayIndex].counts[normalizedStatus]++;
        dailyCounts[dayIndex].total++;
      }
    });
    
    // Calculate totals per status
    const statusTotals = TRACKED_STATUSES.reduce((acc, status) => ({
      ...acc,
      [status]: dailyCounts.reduce((sum, day) => sum + day.counts[status], 0),
    }), {} as Record<string, number>);
    
    const grandTotal = Object.values(statusTotals).reduce((a, b) => a + b, 0);
    
    return { days: dailyCounts, statusTotals, grandTotal };
  }, [statusEvents, viewMode]);

  const totalTracked = Object.values(statusCounts.counts).reduce((a, b) => a + b, 0);
  const totalAll = aggregatedAssets.length;

  return (
    <Card>
      <CardContent className="pt-4 space-y-6">
        {/* Status Flow Tracking */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h4 className="text-sm font-semibold">Status Flow Tracking</h4>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {/* Today */}
            <Card className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">Today</span>
                  <Badge variant="outline" className="text-xs">{transitionStats.today.total} changes</Badge>
                </div>
                {transitionStats.today.total > 0 ? (
                  <div className="space-y-1.5">
                    {transitionStats.today.newVehicles > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-green-600 dark:text-green-400 font-medium">+{transitionStats.today.newVehicles}</span>
                        <span className="text-muted-foreground">new vehicles</span>
                      </div>
                    )}
                    {TRACKED_STATUSES.filter(s => (transitionStats.today.into[s] || 0) > 0).slice(0, 3).map(status => (
                      <div key={status} className="flex items-center gap-1.5 text-xs">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <span className="text-green-600 dark:text-green-400">+{transitionStats.today.into[status]}</span>
                        <span className="text-muted-foreground truncate">{status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No status changes today</p>
                )}
              </CardContent>
            </Card>

            {/* This Week */}
            <Card className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">This Week</span>
                  <Badge variant="outline" className="text-xs">{transitionStats.thisWeek.total} changes</Badge>
                </div>
                {transitionStats.thisWeek.total > 0 ? (
                  <div className="space-y-1.5">
                    {transitionStats.thisWeek.newVehicles > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-green-600 dark:text-green-400 font-medium">+{transitionStats.thisWeek.newVehicles}</span>
                        <span className="text-muted-foreground">new vehicles</span>
                      </div>
                    )}
                    {TRACKED_STATUSES.filter(s => (transitionStats.thisWeek.into[s] || 0) > 0).slice(0, 3).map(status => (
                      <div key={status} className="flex items-center gap-1.5 text-xs">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <span className="text-green-600 dark:text-green-400">+{transitionStats.thisWeek.into[status]}</span>
                        <span className="text-muted-foreground truncate">{status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No status changes this week</p>
                )}
              </CardContent>
            </Card>

            {/* This Month */}
            <Card className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">This Month</span>
                  <Badge variant="outline" className="text-xs">{transitionStats.thisMonth.total} changes</Badge>
                </div>
                {transitionStats.thisMonth.total > 0 ? (
                  <div className="space-y-1.5">
                    {transitionStats.thisMonth.newVehicles > 0 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-green-600 dark:text-green-400 font-medium">+{transitionStats.thisMonth.newVehicles}</span>
                        <span className="text-muted-foreground">new vehicles</span>
                      </div>
                    )}
                    {TRACKED_STATUSES.filter(s => (transitionStats.thisMonth.into[s] || 0) > 0).slice(0, 3).map(status => (
                      <div key={status} className="flex items-center gap-1.5 text-xs">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <span className="text-green-600 dark:text-green-400">+{transitionStats.thisMonth.into[status]}</span>
                        <span className="text-muted-foreground truncate">{status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No status changes this month</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Day-by-Day Breakdown Table */}
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Daily Status Breakdown</h4>
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <Button
                size="sm"
                variant={viewMode === 'week' ? 'default' : 'ghost'}
                className="h-7 px-3 text-xs"
                onClick={() => setViewMode('week')}
                data-testid="button-view-week"
              >
                <Calendar className="w-3 h-3 mr-1" />
                Week
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'month' ? 'default' : 'ghost'}
                className="h-7 px-3 text-xs"
                onClick={() => setViewMode('month')}
                data-testid="button-view-month"
              >
                <CalendarDays className="w-3 h-3 mr-1" />
                Month
              </Button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-daily-breakdown">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground sticky left-0 bg-background">Date</th>
                  {TRACKED_STATUSES.map(status => {
                    const config = STATUS_CONFIG[status];
                    return (
                      <th key={status} className="text-center py-2 px-2 font-medium">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={config?.color || ''}>{config?.label || status}</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {dailyBreakdown.days.slice().reverse().map((day, idx) => {
                  const isToday = format(day.date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                  return (
                    <tr 
                      key={day.dateStr} 
                      className={`border-b last:border-0 ${isToday ? 'bg-primary/5' : idx % 2 === 0 ? '' : 'bg-muted/30'}`}
                    >
                      <td className="py-2 px-2 font-medium sticky left-0 bg-inherit">
                        <div className="flex items-center gap-1.5">
                          {isToday && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                          <span>{day.dateStr}</span>
                          {isToday && <span className="text-muted-foreground">(today)</span>}
                        </div>
                      </td>
                      {TRACKED_STATUSES.map(status => {
                        const count = day.counts[status];
                        const config = STATUS_CONFIG[status];
                        return (
                          <td key={status} className="text-center py-2 px-2">
                            {count > 0 ? (
                              <Badge variant="outline" className={`${config?.bgColor || ''} border-0`}>
                                +{count}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/50">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-2 font-medium">
                        {day.total > 0 ? day.total : <span className="text-muted-foreground/50">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-medium bg-muted/50">
                  <td className="py-2 px-2 sticky left-0 bg-muted/50">Total</td>
                  {TRACKED_STATUSES.map(status => {
                    const total = dailyBreakdown.statusTotals[status];
                    const config = STATUS_CONFIG[status];
                    return (
                      <td key={status} className="text-center py-2 px-2">
                        {total > 0 ? (
                          <span className={config?.color || ''}>{total}</span>
                        ) : (
                          <span className="text-muted-foreground/50">0</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-center py-2 px-2">{dailyBreakdown.grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          
          {dailyBreakdown.grandTotal === 0 && (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No status changes recorded in the last {viewMode === 'week' ? '7' : '30'} days
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center p-2 border-t">
          Status flow is tracked automatically when data is imported or synced from PARQ API. The pipeline shows current distribution while the tracking section shows historical transitions.
        </div>
      </CardContent>
    </Card>
  );
}
