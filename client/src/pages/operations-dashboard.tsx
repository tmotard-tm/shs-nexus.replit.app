import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useToast } from "@/hooks/use-toast";
import { 
  BarChart3, 
  Download, 
  FileSpreadsheet, 
  Filter, 
  CalendarIcon,
  Clock, 
  CheckCircle, 
  Users, 
  TrendingUp,
  AlertCircle,
  Activity
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface MetricsData {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  requester_id: string;
  department: string | null;
  team: string | null;
  type: string;
  data: string | null;
  metadata: string | null;
  notes: string | null;
  completed_at: string | null;
  started_at: string | null;
  first_response_at: string | null;
  created_at: string;
  updated_at: string;
  response_time_hours: number | null;
  first_response_time_hours: number | null;
  time_to_start_hours: number | null;
}

interface FilterState {
  dateFrom?: Date;
  dateTo?: Date;
  departments: string[];
  statuses: string[];
  assignees: string[];
}

const DEPARTMENTS = [
  { value: "NTAO", label: "NTAO — National Truck Assortment" },
  { value: "ASSETS", label: "Assets" },
  { value: "INVENTORY", label: "Inventory" },
  { value: "FLEET", label: "Fleet" }
];

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" }
];

const STATUS_COLORS = {
  pending: "#f59e0b",
  in_progress: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
  cancelled: "#6b7280"
};

const CHART_CONFIG = {
  requests: {
    label: "Requests",
    color: "hsl(var(--chart-1))",
  },
  completed: {
    label: "Completed",
    color: "hsl(var(--chart-2))",
  },
  pending: {
    label: "Pending", 
    color: "hsl(var(--chart-3))",
  },
  in_progress: {
    label: "In Progress",
    color: "hsl(var(--chart-4))",
  },
};

export default function OperationsDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [filters, setFilters] = useState<FilterState>({
    departments: [],
    statuses: [],
    assignees: []
  });

  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();

  // Fetch users for assignee dropdown
  const { data: users = [] } = useQuery<Array<{ id: string; username: string }>>({
    queryKey: ["/api/users"]
  });

  // Build query parameters from current filters
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    
    if (dateFrom) {
      params.append('from', dateFrom.toISOString());
    }
    if (dateTo) {
      params.append('to', dateTo.toISOString());
    }
    if (filters.departments.length > 0) {
      filters.departments.forEach(dept => params.append('departments', dept));
    }
    if (filters.statuses.length > 0) {
      filters.statuses.forEach(status => params.append('statuses', status));
    }
    if (filters.assignees.length > 0) {
      filters.assignees.forEach(assignee => params.append('assignees', assignee));
    }
    
    return params.toString();
  }, [filters, dateFrom, dateTo]);

  // Fetch metrics data
  const { data: metricsData = [], isLoading, error } = useQuery<MetricsData[]>({
    queryKey: ["/api/metrics", queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/metrics?${queryParams}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch metrics');
      return response.json();
    }
  });

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const total = metricsData.length;
    const completed = metricsData.filter(item => item.status === 'completed').length;
    const completionRate = total > 0 ? (completed / total * 100) : 0;
    
    const completedWithResponseTime = metricsData.filter(item => 
      item.status === 'completed' && item.response_time_hours !== null
    );
    const avgResponseTime = completedWithResponseTime.length > 0 
      ? completedWithResponseTime.reduce((sum, item) => sum + (item.response_time_hours || 0), 0) / completedWithResponseTime.length
      : 0;

    return {
      totalRequests: total,
      completionRate: Math.round(completionRate * 10) / 10,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10
    };
  }, [metricsData]);

  // Calculate department breakdown
  const departmentBreakdown = useMemo(() => {
    const breakdown = DEPARTMENTS.map(dept => {
      const deptData = metricsData.filter(item => item.department === dept.value);
      const completed = deptData.filter(item => item.status === 'completed').length;
      const inProgress = deptData.filter(item => item.status === 'in_progress').length;
      const pending = deptData.filter(item => item.status === 'pending').length;
      
      return {
        name: dept.label,
        value: dept.value,
        total: deptData.length,
        completed,
        in_progress: inProgress,
        pending,
        others: deptData.length - completed - inProgress - pending
      };
    }).filter(item => item.total > 0);
    
    return breakdown;
  }, [metricsData]);

  // Calculate assignee productivity metrics
  const assigneeMetrics = useMemo(() => {
    const assigneeMap = new Map();
    
    metricsData.forEach(item => {
      if (!item.assignee) return;
      
      if (!assigneeMap.has(item.assignee)) {
        assigneeMap.set(item.assignee, {
          assignee: item.assignee,
          total: 0,
          completed: 0,
          inProgress: 0,
          avgResponseTime: 0,
          totalResponseTime: 0,
          responseTimeCount: 0
        });
      }
      
      const metrics = assigneeMap.get(item.assignee);
      metrics.total += 1;
      
      if (item.status === 'completed') {
        metrics.completed += 1;
        if (item.response_time_hours !== null) {
          metrics.totalResponseTime += item.response_time_hours;
          metrics.responseTimeCount += 1;
        }
      } else if (item.status === 'in_progress') {
        metrics.inProgress += 1;
      }
    });
    
    // Calculate average response times and sort by productivity
    const result = Array.from(assigneeMap.values()).map(metrics => ({
      ...metrics,
      completionRate: metrics.total > 0 ? (metrics.completed / metrics.total * 100) : 0,
      avgResponseTime: metrics.responseTimeCount > 0 ? 
        Math.round((metrics.totalResponseTime / metrics.responseTimeCount) * 10) / 10 : 0
    })).sort((a, b) => b.completed - a.completed);
    
    return result;
  }, [metricsData]);

  // Calculate time series data for completed requests
  const timeSeriesData = useMemo(() => {
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return {
        date: date.toISOString().split('T')[0],
        completed: 0
      };
    });
    
    metricsData.forEach(item => {
      if (item.status === 'completed' && item.completed_at) {
        const completedDate = new Date(item.completed_at).toISOString().split('T')[0];
        const dayData = last30Days.find(day => day.date === completedDate);
        if (dayData) {
          dayData.completed += 1;
        }
      }
    });
    
    return last30Days;
  }, [metricsData]);

  // Export mutations
  const exportMutation = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const response = await fetch(`/api/exports/requests.${format}?${queryParams}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Export failed');
      }

      const filename = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 
        `operations_export_${new Date().toISOString().split('T')[0]}.${format}`;
      const blob = await response.blob();
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return { format, filename };
    },
    onSuccess: ({ format, filename }) => {
      toast({
        title: "Export Successful",
        description: `Operations data exported as ${filename}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleExport = (format: 'csv' | 'xlsx') => {
    exportMutation.mutate(format);
  };

  // Handle filter changes
  const handleDepartmentChange = (department: string, checked: boolean) => {
    setFilters(prev => ({
      ...prev,
      departments: checked 
        ? [...prev.departments, department]
        : prev.departments.filter(d => d !== department)
    }));
  };

  const handleStatusChange = (status: string, checked: boolean) => {
    setFilters(prev => ({
      ...prev,
      statuses: checked 
        ? [...prev.statuses, status]
        : prev.statuses.filter(s => s !== status)
    }));
  };

  const handleAssigneeChange = (assignees: string[]) => {
    setFilters(prev => ({ ...prev, assignees }));
  };

  const clearFilters = () => {
    setFilters({
      departments: [],
      statuses: [],
      assignees: []
    });
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const formatHours = (hours: number) => {
    if (hours === 0) return "N/A";
    if (hours < 1) return `${Math.round(hours * 60)}min`;
    if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
    return `${Math.round((hours / 24) * 10) / 10}d`;
  };

  // Check if user has permission to view operations dashboard
  if (!user || (user.role !== 'developer' && user.role !== 'admin')) {
    return (
      <MainContent>
        <TopBar title="Operations Dashboard" breadcrumbs={["Home", "Operations Dashboard"]} />
        <div className="p-6">
          <BackButton href="/dashboard" />
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-destructive mb-2">Access Denied</h2>
            <p className="text-muted-foreground">
              You don't have permission to view operations metrics.
            </p>
          </div>
        </div>
      </MainContent>
    );
  }

  if (error) {
    return (
      <MainContent>
        <TopBar title="Operations Dashboard" breadcrumbs={["Home", "Operations Dashboard"]} />
        <div className="p-6">
          <BackButton href="/dashboard" />
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-destructive mb-2">Error Loading Data</h2>
            <p className="text-muted-foreground">
              Failed to load operations metrics. Please try again later.
            </p>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <TopBar title="Operations Dashboard" breadcrumbs={["Home", "Operations Dashboard"]} />
      
      <main className="p-6 space-y-6">
        <BackButton href="/dashboard" />

        {/* Header with Export Actions */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-operations-title">
              Operations Dashboard
            </h1>
            <p className="text-muted-foreground" data-testid="text-operations-description">
              Comprehensive queue performance and productivity analytics
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleExport('csv')}
              disabled={exportMutation.isPending}
              data-testid="button-export-csv"
            >
              {exportMutation.isPending && exportMutation.variables === 'csv' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExport('xlsx')}
              disabled={exportMutation.isPending}
              data-testid="button-export-xlsx"
            >
              {exportMutation.isPending && exportMutation.variables === 'xlsx' ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 mr-2" />
              )}
              Export XLSX
            </Button>
          </div>
        </div>

        {/* Filters Section */}
        <Card data-testid="card-filters">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Date Range Filter */}
              <div className="space-y-2">
                <Label>Date Range</Label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}
                        data-testid="button-date-from"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateFrom ? format(dateFrom, "MMM dd") : "From"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={dateFrom}
                        onSelect={setDateFrom}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}
                        data-testid="button-date-to"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateTo ? format(dateTo, "MMM dd") : "To"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={dateTo}
                        onSelect={setDateTo}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Department Filter */}
              <div className="space-y-2">
                <Label>Departments</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {DEPARTMENTS.map((dept) => (
                    <div key={dept.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`dept-${dept.value}`}
                        checked={filters.departments.includes(dept.value)}
                        onCheckedChange={(checked) => handleDepartmentChange(dept.value, checked as boolean)}
                        data-testid={`checkbox-department-${dept.value.toLowerCase()}`}
                      />
                      <Label htmlFor={`dept-${dept.value}`} className="text-sm">
                        {dept.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {STATUSES.map((status) => (
                    <div key={status.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`status-${status.value}`}
                        checked={filters.statuses.includes(status.value)}
                        onCheckedChange={(checked) => handleStatusChange(status.value, checked as boolean)}
                        data-testid={`checkbox-status-${status.value}`}
                      />
                      <Label htmlFor={`status-${status.value}`} className="text-sm">
                        {status.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assignee Filter */}
              <div className="space-y-2">
                <Label>Assignees</Label>
                <Select
                  value={filters.assignees.join(',')}
                  onValueChange={(value) => handleAssigneeChange(value ? value.split(',') : [])}
                >
                  <SelectTrigger data-testid="select-assignee">
                    <SelectValue placeholder="Select assignees" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="h-4 w-4" />
                {isLoading ? "Loading..." : `${summaryMetrics.totalRequests} requests found`}
              </div>
              <Button variant="ghost" onClick={clearFilters} data-testid="button-clear-filters">
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card data-testid="card-summary-total">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[hsl(var(--chart-1))]" />
                Total Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-requests">
                {isLoading ? "..." : summaryMetrics.totalRequests.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Across all departments and statuses
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-completion">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-[hsl(var(--chart-2))]" />
                Completion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-completion-rate">
                {isLoading ? "..." : `${summaryMetrics.completionRate}%`}
              </div>
              <p className="text-xs text-muted-foreground">
                Percentage of completed requests
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-summary-response-time">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-[hsl(var(--chart-3))]" />
                Avg Response Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-avg-response-time">
                {isLoading ? "..." : formatHours(summaryMetrics.avgResponseTime)}
              </div>
              <p className="text-xs text-muted-foreground">
                Average time to completion
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Department Breakdown */}
          <Card data-testid="card-department-breakdown">
            <CardHeader>
              <CardTitle>Department Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {departmentBreakdown.map((dept) => (
                  <div key={dept.value} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{dept.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {dept.total} total
                      </span>
                    </div>
                    <div className="flex gap-1 h-2 bg-muted rounded">
                      {dept.completed > 0 && (
                        <div
                          className="bg-[hsl(var(--chart-2))] rounded-l"
                          style={{ width: `${(dept.completed / dept.total) * 100}%` }}
                          title={`${dept.completed} completed`}
                        />
                      )}
                      {dept.in_progress > 0 && (
                        <div
                          className="bg-[hsl(var(--chart-4))]"
                          style={{ width: `${(dept.in_progress / dept.total) * 100}%` }}
                          title={`${dept.in_progress} in progress`}
                        />
                      )}
                      {dept.pending > 0 && (
                        <div
                          className="bg-[hsl(var(--chart-3))]"
                          style={{ width: `${(dept.pending / dept.total) * 100}%` }}
                          title={`${dept.pending} pending`}
                        />
                      )}
                      {dept.others > 0 && (
                        <div
                          className="bg-[hsl(var(--chart-5))] rounded-r"
                          style={{ width: `${(dept.others / dept.total) * 100}%` }}
                          title={`${dept.others} other statuses`}
                        />
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>✅ {dept.completed}</span>
                      <span>🔄 {dept.in_progress}</span>
                      <span>⏳ {dept.pending}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Team Productivity Metrics */}
          <Card data-testid="card-team-productivity">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Team Productivity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-h-80 overflow-y-auto">
                {assigneeMetrics.slice(0, 10).map((assignee, index) => (
                  <div key={assignee.assignee} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium">#{index + 1}</span>
                      </div>
                      <div>
                        <div className="font-medium text-sm">{assignee.assignee}</div>
                        <div className="text-xs text-muted-foreground">
                          {assignee.total} total • {assignee.inProgress} active
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-[hsl(var(--chart-2))]">
                        {assignee.completed} completed
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatHours(assignee.avgResponseTime)} avg
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time Series Chart */}
        <Card data-testid="card-time-series">
          <CardHeader>
            <CardTitle>Completed Requests Trend (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={CHART_CONFIG} className="h-[300px]">
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => format(new Date(value), "MMM dd")}
                />
                <YAxis />
                <ChartTooltip 
                  content={<ChartTooltipContent />}
                  labelFormatter={(value) => format(new Date(value as string), "MMM dd, yyyy")}
                />
                <Line 
                  type="monotone" 
                  dataKey="completed" 
                  stroke="var(--color-completed)"
                  strokeWidth={2}
                  dot={{ fill: "var(--color-completed)" }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </main>
    </MainContent>
  );
}