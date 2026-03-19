import { useState, useRef, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/context/FleetScopeUserContext";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { 
  DollarSign, 
  Upload,
  FileSpreadsheet,
  Loader2,
  TrendingUp,
  Calendar,
  CalendarDays,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { readExcelFile } from '@/lib/xlsx-utils';

interface ForecastDetails {
  weeks: string[];
  values: number[];
  average: number;
}

interface FleetCostForecast {
  nextWeek: string;
  nextWeekDates: { start: string; end: string };
  byLineType: Record<string, number>;
  total: number;
  basedOnWeeks: string[];
  details: Record<string, ForecastDetails>;
}

interface FleetCostAnalytics {
  weekly: Record<string, Record<string, number>>;
  weeklyDates: Record<string, { start: string; end: string }>;
  weeklyVehicleCounts?: Record<string, number>;
  monthly: Record<string, Record<string, number>>;
  monthlyVehicleCounts?: Record<string, number>;
  annual: Record<string, Record<string, number>>;
  annualVehicleCounts?: Record<string, number>;
  lineTypes: string[];
  processedCount: number;
  skippedCount: number;
  forecast?: FleetCostForecast;
}

interface ApprovedCostForecast {
  nextWeek: string;
  nextWeekDates: { start: string; end: string };
  total: number;
  basedOnWeeks: string[];
}

interface ApprovedCostAnalytics {
  weekly: Record<string, { rental: number; other: number; total: number }>;
  weeklyDates: Record<string, { start: string; end: string }>;
  weeklyVehicleCounts?: Record<string, number>;
  monthly: Record<string, { rental: number; other: number; total: number }>;
  monthlyVehicleCounts?: Record<string, number>;
  annual: Record<string, { rental: number; other: number; total: number }>;
  annualVehicleCounts?: Record<string, number>;
  processedCount: number;
  forecast?: ApprovedCostForecast;
}

type AnalyticsViewType = 'paid' | 'approved';

export default function FleetCost() {
  const { currentUser } = useUser();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const approvedFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingApproved, setIsUploadingApproved] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [analyticsView, setAnalyticsView] = useState<AnalyticsViewType>('paid');

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<FleetCostAnalytics>({
    queryKey: ["/api/fs/fleet-cost/analytics"],
  });

  const { data: approvedAnalyticsData, isLoading: approvedAnalyticsLoading } = useQuery<ApprovedCostAnalytics>({
    queryKey: ["/api/fs/approved-cost/analytics"],
  });

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Get weeks that belong to a given month (YYYY-MM format)
  // Uses ISO week calculation to properly handle cross-year weeks
  const getWeeksForMonth = (monthKey: string, weeklyData?: Record<string, unknown>): string[] => {
    const dataToUse = weeklyData || (analyticsView === 'approved' ? approvedAnalyticsData?.weekly : analyticsData?.weekly);
    if (!dataToUse) return [];
    
    const [targetYear, targetMonth] = monthKey.split('-').map(Number);
    const weeks: string[] = [];
    
    // Helper to get the Sunday (start) of an ISO week
    // Fleet Cost uses Sunday-Saturday weeks
    const getWeekStartDate = (isoYear: number, isoWeek: number): Date => {
      // Get January 4th of the ISO year (always in week 1)
      const jan4 = new Date(isoYear, 0, 4);
      // Find the Monday of week 1
      const dayOfWeek = jan4.getDay();
      const mondayOfWeek1 = new Date(jan4);
      mondayOfWeek1.setDate(jan4.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      // Calculate the Sunday of the target week (Sunday = Monday - 1 day for Sunday-start weeks)
      const targetMonday = new Date(mondayOfWeek1);
      targetMonday.setDate(mondayOfWeek1.getDate() + (isoWeek - 1) * 7);
      // For Sunday-Saturday weeks, start is Sunday before the Monday
      const sunday = new Date(targetMonday);
      sunday.setDate(targetMonday.getDate() - 1);
      return sunday;
    };
    
    for (const weekKey of Object.keys(dataToUse)) {
      // Parse week key format: "2024-W52"
      const match = weekKey.match(/^(\d{4})-W(\d{1,2})$/);
      if (!match) continue;
      
      const [, isoYearStr, isoWeekStr] = match;
      const isoYear = parseInt(isoYearStr);
      const isoWeek = parseInt(isoWeekStr);
      
      // Get the start date of this week (Sunday)
      const weekStart = getWeekStartDate(isoYear, isoWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // Saturday
      
      // Assign week to ONE month only - use the week's END date (Saturday) as the determining factor
      // This ensures weeks like W49 that start in Nov but end in Dec appear in December
      const endMonth = weekEnd.getMonth() + 1; // 0-indexed to 1-indexed
      const endYear = weekEnd.getFullYear();
      
      if (endYear === targetYear && endMonth === targetMonth) {
        weeks.push(weekKey);
      }
    }
    
    return weeks.sort().reverse(); // Most recent first
  };

  // Toggle month expansion
  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(monthKey)) {
        newSet.delete(monthKey);
      } else {
        newSet.add(monthKey);
      }
      return newSet;
    });
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const pollJobStatus = async (jobId: string): Promise<void> => {
    const maxPolls = 600; // 10 minutes at 1 second intervals
    let polls = 0;
    
    while (polls < maxPolls) {
      try {
        const response = await fetch(`/api/fs/fleet-cost/job/${jobId}`);
        if (!response.ok) {
          throw new Error('Failed to check job status');
        }
        
        const job = await response.json();
        
        setUploadProgress(Math.max(30, job.progress));
        setUploadStatus(`Processing: ${job.processedRows?.toLocaleString() || 0} / ${job.totalRows?.toLocaleString() || '?'} rows (${job.progress || 0}%)`);
        
        if (job.status === 'completed') {
          setUploadProgress(100);
          queryClient.invalidateQueries({ queryKey: ["/api/fs/fleet-cost/records"] });
          queryClient.invalidateQueries({ queryKey: ["/api/fs/fleet-cost/analytics"] });
          
          toast({
            title: "Data saved successfully",
            description: `${job.inserted?.toLocaleString() || 0} new records added, ${job.updated?.toLocaleString() || 0} records updated.`,
          });
          return;
        }
        
        if (job.status === 'failed') {
          throw new Error(job.error || 'Processing failed');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        polls++;
      } catch (error) {
        throw error;
      }
    }
    
    throw new Error('Processing timed out after 10 minutes');
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an Excel file (.xlsx or .xls)",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setUploadStatus(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('importedBy', currentUser || "Unknown");

      setUploadProgress(20);
      setUploadStatus("Uploading file to server...");

      const response = await fetch('/api/fs/fleet-cost/upload-file', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      const result = await response.json();
      
      if (result.jobId) {
        setUploadProgress(30);
        setUploadStatus("Processing file in background...");
        await pollJobStatus(result.jobId);
      } else {
        setUploadProgress(100);
        queryClient.invalidateQueries({ queryKey: ["/api/fs/fleet-cost/records"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fs/fleet-cost/analytics"] });
        
        toast({
          title: "Data saved successfully",
          description: `${result.inserted?.toLocaleString() || 0} new records added, ${result.updated?.toLocaleString() || 0} records updated.`,
        });
      }

    } catch (error) {
      console.error("Error uploading file:", error);
      toast({
        title: "Error uploading file",
        description: error instanceof Error ? error.message : "Failed to upload the file.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleApprovedFileSelect = () => {
    approvedFileInputRef.current?.click();
  };

  const handleApprovedFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an Excel file (.xlsx or .xls)",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingApproved(true);
    setUploadProgress(10);
    setUploadStatus(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
      const arrayBuffer = await file.arrayBuffer();

      setUploadProgress(30);
      setUploadStatus("Parsing Excel file...");

      const jsonData = await readExcelFile(arrayBuffer) as Record<string, unknown>[];
      
      if (jsonData.length === 0) {
        throw new Error("No data found in the Excel file");
      }
      
      const headers = Object.keys(jsonData[0] || {});
      
      setUploadProgress(50);
      setUploadStatus(`Processing ${jsonData.length.toLocaleString()} rows...`);

      const response = await fetch('/api/fs/approved-cost/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: jsonData,
          headers,
          importedBy: currentUser || "Unknown",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }

      const result = await response.json();
      
      setUploadProgress(100);
      queryClient.invalidateQueries({ queryKey: ["/api/fs/approved-cost/analytics"] });
      
      toast({
        title: "Approved PO data saved successfully",
        description: `${result.inserted?.toLocaleString() || 0} new records added.`,
      });

    } catch (error) {
      console.error("Error uploading approved file:", error);
      toast({
        title: "Error uploading file",
        description: error instanceof Error ? error.message : "Failed to upload the file.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingApproved(false);
      setUploadProgress(0);
      setUploadStatus("");
      if (approvedFileInputRef.current) {
        approvedFileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="bg-background">
      <main className="p-4">
        <div className="max-w-7xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Fleet Cost</h1>
          {/* Upload Section - Two Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Paid POs Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Upload Paid POs (BILL_PAID_DATE)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".xlsx,.xls"
                    className="hidden"
                    data-testid="input-file-upload"
                  />
                  <Button
                    onClick={handleFileSelect}
                    disabled={isUploading}
                    className="gap-2"
                    data-testid="button-upload-xlsx"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {isUploading ? "Uploading..." : "Upload XLSX"}
                  </Button>
                </div>
                {isUploading && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">{uploadStatus}</span>
                      <span className="font-medium">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}
                <div className="mt-3 p-2 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">
                    Uses <strong>BILL_PAID_DATE</strong> and <strong>EXTENDED</strong> columns. Includes LINE_TYPE breakdown.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Approved POs Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="w-5 h-5 text-amber-600" />
                  Upload Approved POs (PO DATE)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    ref={approvedFileInputRef}
                    onChange={handleApprovedFileChange}
                    accept=".xlsx,.xls"
                    className="hidden"
                    data-testid="input-approved-file-upload"
                  />
                  <Button
                    onClick={handleApprovedFileSelect}
                    disabled={isUploadingApproved}
                    variant="outline"
                    className="gap-2"
                    data-testid="button-upload-approved-xlsx"
                  >
                    {isUploadingApproved ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {isUploadingApproved ? "Uploading..." : "Upload XLSX"}
                  </Button>
                </div>
                {isUploadingApproved && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">{uploadStatus}</span>
                      <span className="font-medium">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}
                <div className="mt-3 p-2 bg-muted rounded-md">
                  <p className="text-xs text-muted-foreground">
                    Uses <strong>PO DATE</strong> and <strong>AMOUNT</strong> columns. Shows totals only (no LINE_TYPE).
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Section with Toggle - Always show toggle so users can switch views */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4 flex-wrap">
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Cost Analytics
                  </CardTitle>
                  <Select value={analyticsView} onValueChange={(v) => setAnalyticsView(v as AnalyticsViewType)}>
                    <SelectTrigger className="w-[320px]" data-testid="select-analytics-view">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">
                        <span className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-green-600" />
                          Paid POs (Division 01 & RF)
                        </span>
                      </SelectItem>
                      <SelectItem value="approved">
                        <span className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-600" />
                          Approved POs - Pending Billing (Division 01 & RF)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm text-muted-foreground">
                  {analyticsView === 'paid' 
                    ? (analyticsLoading ? 'Loading...' : `${analyticsData?.processedCount?.toLocaleString() || 0} records`)
                    : (approvedAnalyticsLoading ? 'Loading...' : `${approvedAnalyticsData?.processedCount?.toLocaleString() || 0} records`)}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Loading state for paid analytics */}
              {analyticsView === 'paid' && analyticsLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
              
              {/* Loading state for approved analytics */}
              {analyticsView === 'approved' && approvedAnalyticsLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
              
              {/* No data state for paid analytics */}
              {analyticsView === 'paid' && !analyticsLoading && (!analyticsData || analyticsData.processedCount === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No paid PO data available. Upload an XLSX file to see analytics.</p>
                </div>
              )}
              
              {/* No data state for approved analytics */}
              {analyticsView === 'approved' && !approvedAnalyticsLoading && (!approvedAnalyticsData || approvedAnalyticsData.processedCount === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No approved PO data available. Upload an XLSX file to see analytics.</p>
                </div>
              )}
              
              {/* Paid Analytics View */}
              {analyticsView === 'paid' && !analyticsLoading && analyticsData && analyticsData.processedCount > 0 && (
                  <Tabs defaultValue="annual" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-4">
                      <TabsTrigger value="annual" className="gap-2" data-testid="tab-annual">
                        <Calendar className="w-4 h-4" />
                        Annual
                      </TabsTrigger>
                      <TabsTrigger value="monthly" className="gap-2" data-testid="tab-monthly">
                        <CalendarDays className="w-4 h-4" />
                        Monthly
                      </TabsTrigger>
                      <TabsTrigger value="weekly" className="gap-2" data-testid="tab-weekly">
                        <TrendingUp className="w-4 h-4" />
                        Weekly
                      </TabsTrigger>
                    </TabsList>

                  {/* Annual Tab */}
                  <TabsContent value="annual">
                    <div className="space-y-4">
                      {Object.entries(analyticsData.annual)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([year, lineTypeData]) => {
                          const total = Object.values(lineTypeData).reduce((sum, val) => sum + val, 0);
                          return (
                            <div key={year} className="border rounded-lg p-4">
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-lg">{year}</h3>
                                <span className="text-xl font-bold text-primary">{formatCurrency(total)}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {Object.entries(lineTypeData)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([lineType, amount]) => (
                                    <div key={lineType} className="bg-muted rounded-md p-2">
                                      <div className="text-xs text-muted-foreground truncate" title={lineType}>
                                        {lineType}
                                      </div>
                                      <div className="font-medium">{formatCurrency(amount)}</div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </TabsContent>

                  {/* Monthly Tab */}
                  <TabsContent value="monthly">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="font-semibold sticky left-0 bg-background">Month</TableHead>
                            {analyticsData.lineTypes.map(lt => (
                              <TableHead key={lt} className="text-right font-semibold min-w-[100px]">
                                {lt}
                              </TableHead>
                            ))}
                            <TableHead className="text-right font-semibold">Total</TableHead>
                            <TableHead className="text-right font-semibold min-w-[80px]">Vehicles</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Forecast Row at top of table */}
                          {analyticsData.forecast && analyticsData.forecast.nextWeek && (
                            <TableRow className="bg-primary/5 border-2 border-dashed border-primary/30">
                              <TableCell className="font-medium sticky left-0 bg-primary/5">
                                <span className="flex items-center gap-1">
                                  <TrendingUp className="w-4 h-4 text-primary" />
                                  <span className="text-primary">Next Week</span>
                                  <span className="text-xs text-primary">
                                    ({analyticsData.forecast.nextWeek})
                                  </span>
                                </span>
                              </TableCell>
                              {analyticsData.lineTypes.map(lt => (
                                <TableCell key={lt} className="text-right text-primary font-medium">
                                  {analyticsData.forecast!.byLineType[lt] ? formatCurrency(analyticsData.forecast!.byLineType[lt]) : '-'}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-bold text-primary">
                                {formatCurrency(analyticsData.forecast.total)}
                              </TableCell>
                              <TableCell className="text-right text-primary/60">-</TableCell>
                            </TableRow>
                          )}
                          {Object.entries(analyticsData.monthly)
                            .sort(([a], [b]) => b.localeCompare(a))
                            .slice(0, 24) // Show last 24 months
                            .map(([month, lineTypeData]) => {
                              const total = Object.values(lineTypeData).reduce((sum, val) => sum + val, 0);
                              const isExpanded = expandedMonths.has(month);
                              const weeksInMonth = getWeeksForMonth(month);
                              
                              return (
                                <Fragment key={month}>
                                  {/* Month Row - Clickable */}
                                  <TableRow 
                                    className="cursor-pointer hover-elevate"
                                    onClick={() => toggleMonth(month)}
                                    data-testid={`row-month-${month}`}
                                  >
                                    <TableCell className="font-medium sticky left-0 bg-background">
                                      <span className="flex items-center gap-2">
                                        {isExpanded ? (
                                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                        )}
                                        {month}
                                        {weeksInMonth.length > 0 && (
                                          <span className="text-xs text-muted-foreground">
                                            ({weeksInMonth.length} weeks)
                                          </span>
                                        )}
                                      </span>
                                    </TableCell>
                                    {analyticsData.lineTypes.map(lt => (
                                      <TableCell key={lt} className="text-right">
                                        {lineTypeData[lt] ? formatCurrency(lineTypeData[lt]) : '-'}
                                      </TableCell>
                                    ))}
                                    <TableCell className="text-right font-semibold">{formatCurrency(total)}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                      {analyticsData.monthlyVehicleCounts?.[month]?.toLocaleString() || '-'}
                                    </TableCell>
                                  </TableRow>
                                  
                                  {/* Expanded Week Rows */}
                                  {isExpanded && weeksInMonth.map((weekKey) => {
                                    const weekData = analyticsData.weekly[weekKey] || {};
                                    const weekTotal = Object.values(weekData).reduce((sum, val) => sum + val, 0);
                                    const dateRange = analyticsData.weeklyDates?.[weekKey];
                                    const year = weekKey.split('-')[0];
                                    
                                    return (
                                      <TableRow key={`${month}-${weekKey}`} className="bg-muted/30">
                                        <TableCell className="font-medium sticky left-0 bg-muted/30 pl-8">
                                          <span className="flex items-center gap-2 text-sm">
                                            <span className="text-muted-foreground">└</span>
                                            {weekKey}
                                            {dateRange && (
                                              <span className="text-xs text-muted-foreground">
                                                ({dateRange.start} - {dateRange.end}/{year.slice(2)})
                                              </span>
                                            )}
                                          </span>
                                        </TableCell>
                                        {analyticsData.lineTypes.map(lt => (
                                          <TableCell key={lt} className="text-right text-sm">
                                            {weekData[lt] ? formatCurrency(weekData[lt]) : '-'}
                                          </TableCell>
                                        ))}
                                        <TableCell className="text-right font-medium text-sm">{formatCurrency(weekTotal)}</TableCell>
                                        <TableCell className="text-right text-sm text-muted-foreground">
                                          {analyticsData.weeklyVehicleCounts?.[weekKey]?.toLocaleString() || '-'}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                  
                                  {/* Show message if no weeks found */}
                                  {isExpanded && weeksInMonth.length === 0 && (
                                    <TableRow key={`${month}-no-weeks`} className="bg-muted/30">
                                      <TableCell colSpan={analyticsData.lineTypes.length + 3} className="text-center text-muted-foreground text-sm py-2 pl-8">
                                        No weekly data available for this month
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </Fragment>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>

                  {/* Weekly Tab */}
                  <TabsContent value="weekly">
                    {/* Forecast Card */}
                    {analyticsData.forecast && analyticsData.forecast.nextWeek && (
                      <div className="mb-4 p-4 bg-primary/5 border-2 border-dashed border-primary/30 rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <TrendingUp className="w-5 h-5 text-primary" />
                          <h3 className="font-semibold text-lg">Next Week Forecast ({analyticsData.forecast.nextWeek})</h3>
                          <span className="text-sm text-muted-foreground">
                            {analyticsData.forecast.nextWeekDates.start} - {analyticsData.forecast.nextWeekDates.end}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm text-muted-foreground">
                            Based on 4-week rolling average ({analyticsData.forecast.basedOnWeeks.join(', ')})
                          </div>
                          <div className="text-2xl font-bold text-primary">
                            {formatCurrency(analyticsData.forecast.total)}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                          {Object.entries(analyticsData.forecast.byLineType)
                            .sort(([, a], [, b]) => b - a)
                            .map(([lineType, amount]) => (
                              <div key={lineType} className="bg-background rounded-md p-2 border">
                                <div className="text-xs text-muted-foreground truncate" title={lineType}>
                                  {lineType}
                                </div>
                                <div className="font-medium text-primary">{formatCurrency(amount)}</div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="font-semibold sticky left-0 bg-background">Week</TableHead>
                            <TableHead className="font-semibold">Date Range</TableHead>
                            {analyticsData.lineTypes.map(lt => (
                              <TableHead key={lt} className="text-right font-semibold min-w-[100px]">
                                {lt}
                              </TableHead>
                            ))}
                            <TableHead className="text-right font-semibold">Total</TableHead>
                            <TableHead className="text-right font-semibold min-w-[80px]">Vehicles</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* Forecast Row */}
                          {analyticsData.forecast && analyticsData.forecast.nextWeek && (
                            <TableRow className="bg-primary/5 border-2 border-dashed border-primary/30">
                              <TableCell className="font-medium sticky left-0 bg-primary/5">
                                <span className="flex items-center gap-1">
                                  <TrendingUp className="w-4 h-4 text-primary" />
                                  {analyticsData.forecast.nextWeek}
                                  <span className="text-xs text-primary ml-1">(Forecast)</span>
                                </span>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                                {analyticsData.forecast.nextWeekDates.start} - {analyticsData.forecast.nextWeekDates.end}
                              </TableCell>
                              {analyticsData.lineTypes.map(lt => (
                                <TableCell key={lt} className="text-right text-primary font-medium">
                                  {analyticsData.forecast!.byLineType[lt] ? formatCurrency(analyticsData.forecast!.byLineType[lt]) : '-'}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-bold text-primary">
                                {formatCurrency(analyticsData.forecast.total)}
                              </TableCell>
                              <TableCell className="text-right text-primary/60">-</TableCell>
                            </TableRow>
                          )}
                          {Object.entries(analyticsData.weekly)
                            .sort(([a], [b]) => b.localeCompare(a))
                            .slice(0, 52) // Show last 52 weeks
                            .map(([week, lineTypeData]) => {
                              const total = Object.values(lineTypeData).reduce((sum, val) => sum + val, 0);
                              const dateRange = analyticsData.weeklyDates?.[week];
                              const year = week.split('-')[0];
                              return (
                                <TableRow key={week}>
                                  <TableCell className="font-medium sticky left-0 bg-background">{week}</TableCell>
                                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                                    {dateRange ? `${dateRange.start} - ${dateRange.end}/${year.slice(2)}` : '-'}
                                  </TableCell>
                                  {analyticsData.lineTypes.map(lt => (
                                    <TableCell key={lt} className="text-right">
                                      {lineTypeData[lt] ? formatCurrency(lineTypeData[lt]) : '-'}
                                    </TableCell>
                                  ))}
                                  <TableCell className="text-right font-semibold">{formatCurrency(total)}</TableCell>
                                  <TableCell className="text-right text-muted-foreground">
                                    {analyticsData.weeklyVehicleCounts?.[week]?.toLocaleString() || '-'}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
              
              {/* Approved Analytics View */}
              {analyticsView === 'approved' && !approvedAnalyticsLoading && approvedAnalyticsData && approvedAnalyticsData.processedCount > 0 && (
                  <Tabs defaultValue="annual" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-4">
                      <TabsTrigger value="annual" className="gap-2" data-testid="tab-approved-annual">
                        <Calendar className="w-4 h-4" />
                        Annual
                      </TabsTrigger>
                      <TabsTrigger value="monthly" className="gap-2" data-testid="tab-approved-monthly">
                        <CalendarDays className="w-4 h-4" />
                        Monthly
                      </TabsTrigger>
                      <TabsTrigger value="weekly" className="gap-2" data-testid="tab-approved-weekly">
                        <TrendingUp className="w-4 h-4" />
                        Weekly
                      </TabsTrigger>
                    </TabsList>

                    {/* Annual Tab - Approved */}
                    <TabsContent value="annual">
                      <div className="space-y-4">
                        {Object.entries(approvedAnalyticsData.annual)
                          .sort(([a], [b]) => b.localeCompare(a))
                          .map(([year, data]) => (
                            <div key={year} className="border rounded-lg p-4">
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-lg">{year}</h3>
                                <span className="text-xl font-bold text-amber-600">{formatCurrency(data.total)}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="flex justify-between items-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                                  <span className="text-muted-foreground">Rental</span>
                                  <span className="font-semibold text-blue-600">{formatCurrency(data.rental || 0)}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded">
                                  <span className="text-muted-foreground">All other Fleet costs</span>
                                  <span className="font-semibold">{formatCurrency(data.other || 0)}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </TabsContent>

                    {/* Monthly Tab - Approved */}
                    <TabsContent value="monthly">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold sticky left-0 bg-background">Month</TableHead>
                              <TableHead className="text-right font-semibold text-blue-600">Rental</TableHead>
                              <TableHead className="text-right font-semibold">Other Fleet</TableHead>
                              <TableHead className="text-right font-semibold">Total</TableHead>
                              <TableHead className="text-right font-semibold min-w-[80px]">Vehicles</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Object.entries(approvedAnalyticsData.monthly)
                              .sort(([a], [b]) => b.localeCompare(a))
                              .slice(0, 24)
                              .map(([month, data]) => {
                                const isExpanded = expandedMonths.has(month);
                                const weeksInMonth = getWeeksForMonth(month);
                                
                                return (
                                  <Fragment key={month}>
                                    <TableRow 
                                      className="cursor-pointer hover-elevate"
                                      onClick={() => toggleMonth(month)}
                                      data-testid={`row-approved-month-${month}`}
                                    >
                                      <TableCell className="font-medium sticky left-0 bg-background">
                                        <span className="flex items-center gap-1">
                                          {isExpanded ? (
                                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                          )}
                                          {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-right font-semibold text-blue-600">{formatCurrency(data.rental || 0)}</TableCell>
                                      <TableCell className="text-right font-semibold">{formatCurrency(data.other || 0)}</TableCell>
                                      <TableCell className="text-right font-semibold text-amber-600">{formatCurrency(data.total)}</TableCell>
                                      <TableCell className="text-right text-muted-foreground">
                                        {approvedAnalyticsData.monthlyVehicleCounts?.[month]?.toLocaleString() || '-'}
                                      </TableCell>
                                    </TableRow>
                                    
                                    {/* Expanded week rows */}
                                    {isExpanded && weeksInMonth.map(weekKey => {
                                      const weekData = approvedAnalyticsData.weekly[weekKey];
                                      if (!weekData) return null;
                                      const dateRange = approvedAnalyticsData.weeklyDates?.[weekKey];
                                      const year = weekKey.split('-')[0];
                                      
                                      return (
                                        <TableRow key={`${month}-${weekKey}`} className="bg-muted/30">
                                          <TableCell className="font-medium sticky left-0 bg-muted/30 pl-8">
                                            <span className="text-sm text-muted-foreground">
                                              {weekKey} ({dateRange ? `${dateRange.start} - ${dateRange.end}/${year.slice(2)}` : ''})
                                            </span>
                                          </TableCell>
                                          <TableCell className="text-right text-sm text-blue-600">{formatCurrency(weekData.rental || 0)}</TableCell>
                                          <TableCell className="text-right text-sm">{formatCurrency(weekData.other || 0)}</TableCell>
                                          <TableCell className="text-right font-medium text-sm">{formatCurrency(weekData.total)}</TableCell>
                                          <TableCell className="text-right text-sm text-muted-foreground">
                                            {approvedAnalyticsData.weeklyVehicleCounts?.[weekKey]?.toLocaleString() || '-'}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>

                    {/* Weekly Tab - Approved */}
                    <TabsContent value="weekly">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold sticky left-0 bg-background">Week</TableHead>
                              <TableHead className="font-semibold">Date Range</TableHead>
                              <TableHead className="text-right font-semibold text-blue-600">Rental</TableHead>
                              <TableHead className="text-right font-semibold">Other Fleet</TableHead>
                              <TableHead className="text-right font-semibold">Total</TableHead>
                              <TableHead className="text-right font-semibold min-w-[80px]">Vehicles</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Object.entries(approvedAnalyticsData.weekly)
                              .sort(([a], [b]) => b.localeCompare(a))
                              .slice(0, 52)
                              .map(([week, data]) => {
                                const dateRange = approvedAnalyticsData.weeklyDates?.[week];
                                const year = week.split('-')[0];
                                return (
                                  <TableRow key={week}>
                                    <TableCell className="font-medium sticky left-0 bg-background">{week}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                                      {dateRange ? `${dateRange.start} - ${dateRange.end}/${year.slice(2)}` : '-'}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-blue-600">{formatCurrency(data.rental || 0)}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(data.other || 0)}</TableCell>
                                    <TableCell className="text-right font-semibold text-amber-600">{formatCurrency(data.total)}</TableCell>
                                    <TableCell className="text-right text-muted-foreground">
                                      {approvedAnalyticsData.weeklyVehicleCounts?.[week]?.toLocaleString() || '-'}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>
                  </Tabs>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
