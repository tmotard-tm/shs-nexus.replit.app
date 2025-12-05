import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  ArrowLeft, 
  Search, 
  Activity, 
  LogIn, 
  LogOut, 
  UserPlus, 
  Key, 
  ClipboardList,
  CheckCircle,
  PlayCircle,
  XCircle,
  Users,
  CalendarIcon,
  Download,
  FileSpreadsheet,
  FileText
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { ActivityLog, User } from "@shared/schema";

const ACTION_ICONS: Record<string, any> = {
  login_success: LogIn,
  login_failed: LogIn,
  logout: LogOut,
  user_registered: UserPlus,
  user_created: UserPlus,
  password_changed_self: Key,
  password_reset_admin: Key,
  queue_item_assigned: ClipboardList,
  queue_item_started: PlayCircle,
  queue_item_completed: CheckCircle,
  queue_item_cancelled: XCircle,
  role_updated: Users,
};

const ACTION_COLORS: Record<string, string> = {
  login_success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  login_failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  logout: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100",
  user_registered: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  user_created: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  password_changed_self: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  password_reset_admin: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100",
  queue_item_assigned: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100",
  queue_item_started: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100",
  queue_item_completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  queue_item_cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  role_updated: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
};

const ACTION_LABELS: Record<string, string> = {
  login_success: "Login Success",
  login_failed: "Login Failed",
  logout: "Logout",
  user_registered: "User Registered",
  user_created: "User Created",
  password_changed_self: "Password Changed",
  password_reset_admin: "Password Reset (Admin)",
  queue_item_assigned: "Queue Assigned",
  queue_item_started: "Queue Started",
  queue_item_completed: "Queue Completed",
  queue_item_cancelled: "Queue Cancelled",
  role_updated: "Role Updated",
};

const ENTITY_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "auth", label: "Authentication" },
  { value: "queue", label: "Queue Management" },
  { value: "user", label: "User Management" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "login_success", label: "Login Success" },
  { value: "login_failed", label: "Login Failed" },
  { value: "queue_item_assigned", label: "Queue Assigned" },
  { value: "queue_item_started", label: "Queue Started" },
  { value: "queue_item_completed", label: "Queue Completed" },
  { value: "queue_item_cancelled", label: "Queue Cancelled" },
  { value: "user_created", label: "User Created" },
  { value: "user_registered", label: "User Registered" },
  { value: "password_changed_self", label: "Password Changed" },
  { value: "password_reset_admin", label: "Password Reset" },
];

export default function ActivityLogs() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
  const [actionTypeFilter, setActionTypeFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [isExporting, setIsExporting] = useState(false);

  // Redirect non-superadmin users
  useEffect(() => {
    if (user && user.role !== "superadmin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  // Show nothing while checking auth or redirecting
  if (!user || user.role !== "superadmin") {
    return null;
  }

  // Fetch activity logs
  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity-logs"],
  });

  // Fetch users for the user filter dropdown
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Create a map of user IDs to usernames for display
  const userMap = users.reduce((acc, u) => {
    acc[u.id] = u.username;
    return acc;
  }, {} as Record<string, string>);

  // Filter logs based on search and filters
  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      searchQuery === "" ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      userMap[log.userId]?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesEntityType =
      entityTypeFilter === "all" || log.entityType === entityTypeFilter;

    const matchesActionType =
      actionTypeFilter === "all" || log.action === actionTypeFilter;

    const matchesUser =
      userFilter === "all" || log.userId === userFilter;

    // Date filter logic
    const logDate = new Date(log.createdAt);
    let matchesDateRange = true;
    if (fromDate && toDate) {
      matchesDateRange = isWithinInterval(logDate, {
        start: startOfDay(fromDate),
        end: endOfDay(toDate)
      });
    } else if (fromDate) {
      matchesDateRange = logDate >= startOfDay(fromDate);
    } else if (toDate) {
      matchesDateRange = logDate <= endOfDay(toDate);
    }

    return matchesSearch && matchesEntityType && matchesActionType && matchesUser && matchesDateRange;
  });

  const handleBackClick = () => {
    setLocation("/");
  };

  const getActionIcon = (action: string) => {
    const Icon = ACTION_ICONS[action] || Activity;
    return <Icon className="h-4 w-4" />;
  };

  const getActionBadge = (action: string) => {
    const colorClass = ACTION_COLORS[action] || "bg-gray-100 text-gray-800";
    const label = ACTION_LABELS[action] || action.replace(/_/g, " ");
    return (
      <Badge variant="outline" className={`${colorClass} flex items-center gap-1`}>
        {getActionIcon(action)}
        <span>{label}</span>
      </Badge>
    );
  };

  const formatDate = (date: Date | string) => {
    return format(new Date(date), "MMM dd, yyyy");
  };

  const formatTime = (date: Date | string) => {
    return format(new Date(date), "HH:mm:ss");
  };

  const formatTimestamp = (date: Date | string) => {
    return format(new Date(date), "MMM dd, yyyy HH:mm:ss");
  };

  // Clear date filters
  const clearDateFilters = () => {
    setFromDate(undefined);
    setToDate(undefined);
  };

  // Export to CSV
  const exportToCSV = () => {
    setIsExporting(true);
    try {
      const headers = ["Date", "Time", "User", "Action", "Entity Type", "Details"];
      const rows = filteredLogs.map(log => [
        formatDate(log.createdAt),
        formatTime(log.createdAt),
        log.userId === "system" ? "System" : userMap[log.userId] || log.userId,
        ACTION_LABELS[log.action] || log.action.replace(/_/g, " "),
        log.entityType,
        log.details || ""
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `activity-logs-${format(new Date(), "yyyy-MM-dd")}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Complete",
        description: `Exported ${filteredLogs.length} records to CSV`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export activity logs to CSV",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Export to XLSX
  const exportToXLSX = async () => {
    setIsExporting(true);
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Activity Logs");

      // Add headers
      worksheet.columns = [
        { header: "Date", key: "date", width: 15 },
        { header: "Time", key: "time", width: 12 },
        { header: "User", key: "user", width: 20 },
        { header: "Action", key: "action", width: 25 },
        { header: "Entity Type", key: "entityType", width: 15 },
        { header: "Details", key: "details", width: 50 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      // Add data rows
      filteredLogs.forEach(log => {
        worksheet.addRow({
          date: formatDate(log.createdAt),
          time: formatTime(log.createdAt),
          user: log.userId === "system" ? "System" : userMap[log.userId] || log.userId,
          action: ACTION_LABELS[log.action] || log.action.replace(/_/g, " "),
          entityType: log.entityType,
          details: log.details || "",
        });
      });

      // Generate file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `activity-logs-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export Complete",
        description: `Exported ${filteredLogs.length} records to Excel`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export activity logs to Excel",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Calculate stats
  const todayLogs = logs.filter((log) => {
    const logDate = new Date(log.createdAt);
    const today = new Date();
    return logDate.toDateString() === today.toDateString();
  });

  const loginAttempts = logs.filter(
    (log) => log.action === "login_success" || log.action === "login_failed"
  );
  const failedLogins = logs.filter((log) => log.action === "login_failed");
  const queueActions = logs.filter((log) => log.entityType === "queue");

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBackClick}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Activity Logs</h1>
            <p className="text-muted-foreground">
              Track user logins and system actions
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-today-count">
                {todayLogs.length}
              </div>
              <p className="text-xs text-muted-foreground">events recorded</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Login Attempts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-login-count">
                {loginAttempts.length}
              </div>
              <p className="text-xs text-muted-foreground">total attempts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Failed Logins
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600" data-testid="text-failed-logins">
                {failedLogins.length}
              </div>
              <p className="text-xs text-muted-foreground">security alerts</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Queue Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-queue-actions">
                {queueActions.length}
              </div>
              <p className="text-xs text-muted-foreground">queue operations</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
            <CardDescription>Search and filter activity logs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>

              <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
                <SelectTrigger data-testid="select-entity-type">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
                <SelectTrigger data-testid="select-action-type">
                  <SelectValue placeholder="Action Type" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger data-testid="select-user">
                  <SelectValue placeholder="User" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range Filters */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[180px] justify-start text-left font-normal"
                      data-testid="button-from-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fromDate ? format(fromDate, "MMM dd, yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromDate}
                      onSelect={setFromDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">To:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[180px] justify-start text-left font-normal"
                      data-testid="button-to-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {toDate ? format(toDate, "MMM dd, yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={toDate}
                      onSelect={setToDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {(fromDate || toDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearDateFilters}
                  data-testid="button-clear-dates"
                >
                  Clear Dates
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Activity Log
              </CardTitle>
              <CardDescription>
                Showing {filteredLogs.length} of {logs.length} log entries
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExporting || filteredLogs.length === 0} data-testid="button-export">
                  <Download className="mr-2 h-4 w-4" />
                  {isExporting ? "Exporting..." : "Export"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportToCSV} data-testid="menu-export-csv">
                  <FileText className="mr-2 h-4 w-4" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToXLSX} data-testid="menu-export-xlsx">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export as Excel (XLSX)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No activity logs found matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Date</TableHead>
                      <TableHead className="w-[100px]">Time</TableHead>
                      <TableHead className="w-[120px]">User</TableHead>
                      <TableHead className="w-[180px]">Action</TableHead>
                      <TableHead className="w-[100px]">Entity Type</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                        <TableCell className="font-mono text-sm">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatTime(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {log.userId === "system"
                              ? "System"
                              : userMap[log.userId] || log.userId}
                          </Badge>
                        </TableCell>
                        <TableCell>{getActionBadge(log.action)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {log.entityType}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md truncate" title={log.details || ""}>
                          {log.details || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
