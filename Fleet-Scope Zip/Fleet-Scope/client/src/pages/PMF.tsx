import { useState, useRef, useMemo, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PMFMap } from "@/components/PMFMap";
import { PMFWeeklyTracker } from "@/components/PMFWeeklyTracker";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  TruckIcon,
  Upload,
  Cloud,
  XCircle,
  Filter,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  Package,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Activity,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Wrench,
  Download,
  GitBranch,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface PMFRecord {
  assetId: string;
  status: string;
  [key: string]: string;
}

interface ActivityEntry {
  action: string;
  activity: string;
  activityDate: string;
}

interface AggregatedAsset {
  assetId: string;
  status: string;
  activities: ActivityEntry[];
  otherFields: Record<string, string>;
}

interface ParqActivityLog {
  id: string;
  vehicleId: number;
  assetId: string;
  activityDate: string;
  action: string;
  activityType: number;
  typeDescription: string;
  workOrderId: number | null;
  syncedAt: string;
}

interface ActivitySyncMeta {
  id: string;
  lastSyncAt: string;
  vehiclesSynced: number;
  logsFetched: number;
  syncStatus: string;
  errorMessage: string | null;
}

interface DaysInStatusData {
  lockedDownSince: string;
  daysInStatus: number;
}

interface ToolAuditItem {
  toolName: string;
  systemNumber: string | null;
  section: string;
  count: number | null;
  hasPhoto: boolean;
  isFailure: boolean | null;
}

interface ToolAuditData {
  assetId: string;
  vehicleId: number;
  reportDate: string;
  tools: ToolAuditItem[];
}

export default function PMF() {
  const { currentUser } = useUser();
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [pmfData, setPmfData] = useState<PMFRecord[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [activityHeaders, setActivityHeaders] = useState<{action: string; activity: string; activityDate: string}>({ action: '', activity: '', activityDate: '' });
  const [uniqueStatuses, setUniqueStatuses] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [activityLogs, setActivityLogs] = useState<Record<string, ParqActivityLog[]>>({});
  const [loadingActivityFor, setLoadingActivityFor] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [mapStatusFilter, setMapStatusFilter] = useState<string | null>(null);
  const [toolAuditDialogOpen, setToolAuditDialogOpen] = useState(false);
  const [toolAuditData, setToolAuditData] = useState<ToolAuditData | null>(null);
  const [loadingToolAudit, setLoadingToolAudit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Fetch days in status data
  const { data: daysInStatusData } = useQuery<{ success: boolean; data: Record<string, DaysInStatusData> }>({
    queryKey: ['/api/pmf/days-in-status'],
  });

  // Fetch activity sync metadata
  const { data: activitySyncMeta } = useQuery<{ success: boolean; meta: ActivitySyncMeta | null }>({
    queryKey: ['/api/pmf/activity-sync-meta'],
  });

  const { data: pmfSummary } = useQuery<{
    totalVehicles: number;
    byStatus: Record<string, number>;
    pipelineFlow: { status: string; count: number; filterStatuses?: string[] }[];
  }>({
    queryKey: ['/api/pmf/summary'],
  });

  // Sync activity logs mutation
  const syncActivityMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/pmf/sync-activity-logs', {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/pmf/activity-sync-meta'] });
      // Clear cached logs so they'll be refetched
      setActivityLogs({});
      toast({
        title: "Activity Logs Synced",
        description: `Synced ${data.logsFetched} activity logs for ${data.vehiclesSynced} vehicles`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // State for bulk tool audit export
  const [isExportingToolAudit, setIsExportingToolAudit] = useState(false);

  // Export bulk tool audit data for all PMF vehicles
  const exportBulkToolAudit = async () => {
    try {
      setIsExportingToolAudit(true);
      toast({
        title: "Exporting Tool Audit Data",
        description: "This may take a few minutes for all vehicles...",
      });

      const response = await fetch('/api/pmf/tool-audit/bulk-export');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to export tool audit data');
      }

      const { data, summary } = result;

      if (data.length === 0) {
        toast({
          title: "No Tool Audit Data",
          description: "No tool audit data found for any PMF vehicles.",
          variant: "destructive",
        });
        return;
      }

      // Prepare data for XLSX
      const exportData = data.map((row: any) => ({
        'Asset ID': row.assetId,
        'VIN': row.vin,
        'Section': row.section,
        'Tool Name': row.toolName,
        'SKU_ID': row.systemNumber,
        'Count': row.count,
        'Has Photo': row.hasPhoto,
        'Photo URL': row.photoUrl,
        'Status': row.status,
        'Tool Present': row.toolPresent,
        'Notes': row.notes,
      }));

      // Create workbook
      const wb = XLSX.utils.book_new();
      
      // Add tools sheet
      const toolsWs = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, toolsWs, 'Tool Audit');

      // Add summary sheet
      const summaryData = [
        { 'Metric': 'Export Date', 'Value': new Date().toLocaleString() },
        { 'Metric': 'Vehicles Processed', 'Value': summary.vehiclesProcessed },
        { 'Metric': 'Vehicles with Errors', 'Value': summary.vehiclesWithErrors },
        { 'Metric': 'Total Tools', 'Value': summary.totalTools },
        { 'Metric': 'Tools Present', 'Value': summary.toolsPresent },
        { 'Metric': 'Tools Not Present', 'Value': summary.toolsNotPresent },
        { 'Metric': 'Unknown Status', 'Value': summary.toolsUnknown },
      ];
      const summaryWs = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

      // Generate filename with date
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `PMF_ToolAudit_All_${dateStr}.xlsx`;

      // Download
      XLSX.writeFile(wb, filename);

      toast({
        title: "Export Complete",
        description: `Exported ${summary.totalTools} tools from ${summary.vehiclesProcessed} vehicles`,
      });
    } catch (error: any) {
      console.error('Bulk tool audit export failed:', error);
      toast({
        title: "Export Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsExportingToolAudit(false);
    }
  };

  // Toggle row expansion and fetch activity logs if needed
  const toggleRowExpansion = async (assetId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
        // Fetch activity logs if not already cached
        if (!activityLogs[assetId]) {
          fetchActivityLogs(assetId);
        }
      }
      return next;
    });
  };

  // State for tracking failed activity log fetches
  const [activityFetchErrors, setActivityFetchErrors] = useState<Record<string, string>>({});

  // Fetch activity logs for a specific asset
  const fetchActivityLogs = async (assetId: string) => {
    try {
      setLoadingActivityFor(assetId);
      setActivityFetchErrors(prev => {
        const { [assetId]: _, ...rest } = prev;
        return rest;
      });
      const response = await fetch(`/api/pmf/activity-logs/${encodeURIComponent(assetId)}`);
      const data = await response.json();
      if (data.success) {
        setActivityLogs(prev => ({ ...prev, [assetId]: data.logs }));
      } else {
        setActivityFetchErrors(prev => ({ ...prev, [assetId]: data.error || 'Failed to fetch activity logs' }));
      }
    } catch (error) {
      console.error("Error fetching activity logs:", error);
      setActivityFetchErrors(prev => ({ ...prev, [assetId]: 'Network error - please try again' }));
    } finally {
      setLoadingActivityFor(null);
    }
  };

  // Fetch tool audit data from condition report
  const fetchToolAudit = async (assetId: string, vehicleId: number) => {
    try {
      setLoadingToolAudit(true);
      const response = await fetch(`/api/pmf/conditionreport/${vehicleId}`);
      const data = await response.json();
      
      if (data.success && data.conditionreport?.length > 0) {
        const report = data.conditionreport[0];
        const tools: ToolAuditItem[] = [];
        
        // Parse the answers to extract tool information
        if (report.answers) {
          for (const answer of report.answers) {
            if (answer.questionTitle) {
              // Extract tool name and system number
              const systemNumberMatch = answer.questionTitle.match(/([A-Z]{2}-\d{3})$/);
              const toolName = answer.questionTitle
                .replace(/Count the number of items and mark how many '([^']+)' there are inside of the asset\.?/, '$1')
                .replace(/\s*[A-Z]{2}-\d{3}$/, '')
                .trim();
              
              tools.push({
                toolName: toolName || answer.questionTitle,
                systemNumber: systemNumberMatch ? systemNumberMatch[1] : null,
                section: answer.sectionTitle || 'General',
                count: answer.multipleChoiceValue?.length > 0 
                  ? parseInt(answer.multipleChoiceValue[0]) || null 
                  : null,
                hasPhoto: !!answer.pictureUrl,
                isFailure: answer.dropdownValue?.isFailure ?? null
              });
            }
          }
        }
        
        setToolAuditData({
          assetId,
          vehicleId,
          reportDate: report.createdDate,
          tools
        });
        setToolAuditDialogOpen(true);
      } else {
        toast({
          title: "No Tool Audit Data",
          description: "No condition report found for this vehicle.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error fetching tool audit:", error);
      toast({
        title: "Error",
        description: "Failed to fetch tool audit data.",
        variant: "destructive"
      });
    } finally {
      setLoadingToolAudit(false);
    }
  };

  // Format date for display
  const formatActivityDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  const setColumnFilter = (column: string, value: string) => {
    setColumnFilters(prev => {
      if (value === "" || value === "all") {
        const { [column]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [column]: value };
    });
  };

  const clearAllFilters = () => {
    setColumnFilters({});
  };

  const activeFilterCount = Object.keys(columnFilters).length;

  // Type for persisted PMF data from API
  interface PersistedPmfData {
    import: {
      id: string;
      originalFilename: string | null;
      headers: string[];
      activityHeaders: { action: string; activity: string; activityDate: string } | null;
      importedAt: string;
      importedBy: string | null;
      rowCount: number | null;
    };
    rows: Array<{
      id: string;
      importId: string | null;
      assetId: string | null;
      status: string | null;
      rawRow: Record<string, string>;
      createdAt: string | null;
    }>;
    uniqueStatuses: string[];
  }

  // Fetch persisted PMF data on load
  const { data: persistedData, isLoading: isLoadingPersistedData } = useQuery<PersistedPmfData | null>({
    queryKey: ['/api/pmf'],
    retry: false,
  });

  // Import mutation to save CSV data to the database
  const importMutation = useMutation({
    mutationFn: async (payload: {
      filename: string;
      headers: string[];
      activityHeaders: { action: string; activity: string; activityDate: string };
      rows: Array<{ assetId: string; status: string; rawRow: Record<string, string> }>;
      importedBy?: string;
    }) => {
      const response = await apiRequest('POST', '/api/pmf/import', payload);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/pmf'] });
      if (data.uniqueStatuses) {
        setUniqueStatuses(data.uniqueStatuses);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving data",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // PARQ API sync mutation
  const syncParqMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/pmf/parq/sync', {
        importedBy: currentUser || "PARQ API",
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/pmf'] });
      if (data.uniqueStatuses) {
        setUniqueStatuses(data.uniqueStatuses);
      }
      toast({
        title: "Synced from PARQ API",
        description: `Loaded ${data.vehicleCount} vehicles from Park My Fleet API`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Load persisted data when it becomes available
  useEffect(() => {
    if (persistedData && persistedData.rows) {
      const loadedHeaders = persistedData.import?.headers || [];
      const loadedActivityHeaders = persistedData.import?.activityHeaders || { action: '', activity: '', activityDate: '' };
      
      setHeaders(loadedHeaders);
      setActivityHeaders(loadedActivityHeaders);
      setUniqueStatuses(persistedData.uniqueStatuses || []);
      setColumnFilters({}); // Reset all column filters when loading new data
      
      // Convert persisted rows back to PMFRecord format
      // rawRow is already parsed by the API response
      const records: PMFRecord[] = persistedData.rows.map((row) => {
        const rawRow = typeof row.rawRow === 'string' ? JSON.parse(row.rawRow) : (row.rawRow || {});
        return {
          assetId: row.assetId || '',
          status: row.status || '',
          ...rawRow,
        };
      });
      
      setPmfData(records);
    }
  }, [persistedData]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as Record<string, string>[];
        
        if (data.length === 0) {
          toast({
            title: "Empty file",
            description: "The CSV file contains no data",
            variant: "destructive",
          });
          setIsUploading(false);
          return;
        }

        const csvHeaders = results.meta.fields || [];
        setHeaders(csvHeaders);

        const assetIdField = csvHeaders.find(h => 
          h.toLowerCase().includes('asset') && h.toLowerCase().includes('id')
        ) || csvHeaders.find(h => h.toLowerCase() === 'assetid') || csvHeaders[0];
        
        const statusField = csvHeaders.find(h => 
          h.toLowerCase() === 'status'
        ) || csvHeaders.find(h => h.toLowerCase().includes('status'));

        const actionField = csvHeaders.find(h => 
          h.toLowerCase() === 'action'
        ) || csvHeaders.find(h => h.toLowerCase().includes('action')) || '';
        
        const activityField = csvHeaders.find(h => 
          h.toLowerCase() === 'activity' && !h.toLowerCase().includes('date')
        ) || '';
        
        const activityDateField = csvHeaders.find(h => 
          h.toLowerCase().includes('activity') && h.toLowerCase().includes('date')
        ) || csvHeaders.find(h => h.toLowerCase() === 'activitydate') || '';

        const newActivityHeaders = {
          action: actionField,
          activity: activityField,
          activityDate: activityDateField,
        };
        setActivityHeaders(newActivityHeaders);

        const records: PMFRecord[] = data.map(row => ({
          assetId: row[assetIdField] || '',
          status: statusField ? (row[statusField] || '') : '',
          ...row,
        }));

        // Extract unique statuses
        const statusSet = new Set<string>();
        records.forEach(r => {
          if (r.status && r.status.trim()) {
            statusSet.add(r.status.trim());
          }
        });
        setUniqueStatuses(Array.from(statusSet).sort());

        setPmfData(records);
        setColumnFilters({}); // Reset all column filters on new import
        
        // Save to database
        try {
          await importMutation.mutateAsync({
            filename: file.name,
            headers: csvHeaders,
            activityHeaders: newActivityHeaders,
            rows: records.map(r => ({
              assetId: r.assetId,
              status: r.status,
              rawRow: r,
            })),
            importedBy: currentUser || undefined,
          });
          
          toast({
            title: "CSV Imported",
            description: `Loaded and saved ${records.length} records from ${file.name}`,
          });
        } catch (error) {
          // Data is still loaded locally even if save fails
          toast({
            title: "CSV Loaded (not saved)",
            description: `Loaded ${records.length} records but failed to persist to database`,
            variant: "destructive",
          });
        }

        setIsUploading(false);

        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      error: (error) => {
        toast({
          title: "Error parsing CSV",
          description: error.message,
          variant: "destructive",
        });
        setIsUploading(false);
      },
    });
  };

  const aggregatedAssets = useMemo(() => {
    if (pmfData.length === 0) return [];

    const assetMap = new Map<string, AggregatedAsset>();
    const excludeFromOther = new Set(['assetId', 'status', activityHeaders.action, activityHeaders.activity, activityHeaders.activityDate].filter(Boolean));

    pmfData.forEach(record => {
      const assetId = record.assetId;
      if (!assetId) return;

      const activity: ActivityEntry = {
        action: activityHeaders.action ? (record[activityHeaders.action] || '') : '',
        activity: activityHeaders.activity ? (record[activityHeaders.activity] || '') : '',
        activityDate: activityHeaders.activityDate ? (record[activityHeaders.activityDate] || '') : '',
      };

      if (assetMap.has(assetId)) {
        const existing = assetMap.get(assetId)!;
        
        if (!existing.status && record.status) {
          existing.status = record.status;
        }
        
        headers.forEach(header => {
          if (!excludeFromOther.has(header) && !existing.otherFields[header] && record[header]) {
            existing.otherFields[header] = record[header];
          }
        });
        
        if (activity.action || activity.activity || activity.activityDate) {
          existing.activities.push(activity);
        }
      } else {
        const otherFields: Record<string, string> = {};
        headers.forEach(header => {
          if (!excludeFromOther.has(header)) {
            otherFields[header] = record[header] || '';
          }
        });

        assetMap.set(assetId, {
          assetId,
          status: record.status || '',
          activities: (activity.action || activity.activity || activity.activityDate) ? [activity] : [],
          otherFields,
        });
      }
    });

    return Array.from(assetMap.values());
  }, [pmfData, headers, activityHeaders]);

  const filteredAggregatedAssets = useMemo(() => {
    let filtered = aggregatedAssets;
    
    // Apply all column filters
    Object.entries(columnFilters).forEach(([column, filterValue]) => {
      if (!filterValue) return;
      
      const query = filterValue.toLowerCase();
      
      if (column === "Asset ID") {
        filtered = filtered.filter(asset => 
          asset.assetId.toLowerCase().includes(query)
        );
      } else if (column === "Status") {
        if (filterValue.startsWith("__pipeline__")) {
          const pipelineName = filterValue.replace("__pipeline__", "");
          const pipelineStep = pmfSummary?.pipelineFlow?.find(s => s.status === pipelineName);
          if (pipelineStep?.filterStatuses) {
            filtered = filtered.filter(asset => pipelineStep.filterStatuses!.includes(asset.status));
          } else {
            filtered = filtered.filter(asset => asset.status === pipelineName);
          }
        } else {
          filtered = filtered.filter(asset => asset.status === filterValue);
        }
      } else {
        filtered = filtered.filter(asset => {
          const fieldValue = asset.otherFields[column] || '';
          return fieldValue.toLowerCase().includes(query);
        });
      }
    });
    
    // Apply sorting
    if (sortColumn === 'daysInStatus' && daysInStatusData?.data) {
      const daysData = daysInStatusData.data;
      filtered = [...filtered].sort((a, b) => {
        const daysA = daysData[a.assetId]?.daysInStatus ?? -1;
        const daysB = daysData[b.assetId]?.daysInStatus ?? -1;
        return sortDirection === 'asc' ? daysA - daysB : daysB - daysA;
      });
    }
    
    return filtered;
  }, [aggregatedAssets, columnFilters, sortColumn, sortDirection, daysInStatusData]);

  const toggleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };


  const statusMetrics = useMemo(() => {
    if (pmfData.length === 0) return { total: 0, statuses: {} as Record<string, number> };

    const uniqueAssetsByStatus: Record<string, Set<string>> = {};
    const allUniqueAssets = new Set<string>();

    pmfData.forEach(record => {
      const assetId = record.assetId;
      // Normalize status: trim whitespace and handle case variations
      const rawStatus = record.status || 'Unknown';
      const status = rawStatus.trim();
      
      if (assetId) {
        allUniqueAssets.add(assetId);
        
        if (!uniqueAssetsByStatus[status]) {
          uniqueAssetsByStatus[status] = new Set();
        }
        uniqueAssetsByStatus[status].add(assetId);
      }
    });

    const statusCounts: Record<string, number> = {};
    Object.entries(uniqueAssetsByStatus).forEach(([status, assetSet]) => {
      statusCounts[status] = assetSet.size;
    });

    return {
      total: allUniqueAssets.size,
      statuses: statusCounts,
    };
  }, [pmfData]);

  // Status styling config by status name for resilient mapping
  const statusConfig: Record<string, { icon: JSX.Element; color: string; bgColor: string }> = {
    "Available": {
      icon: <Package className="w-5 h-5" />,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-900/20"
    },
    "Locked Down Local": {
      icon: <Clock className="w-5 h-5" />,
      color: "text-cyan-600 dark:text-cyan-400",
      bgColor: "bg-cyan-50 dark:bg-cyan-900/20"
    },
    "Locked down local": {
      icon: <Clock className="w-5 h-5" />,
      color: "text-cyan-600 dark:text-cyan-400",
      bgColor: "bg-cyan-50 dark:bg-cyan-900/20"
    },
    "Locked down off lot": {
      icon: <Clock className="w-5 h-5" />,
      color: "text-cyan-700 dark:text-cyan-300",
      bgColor: "bg-cyan-50 dark:bg-cyan-900/20"
    },
    "Pending Arrival": {
      icon: <CheckCircle2 className="w-5 h-5" />,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-900/20"
    },
    "In Process": {
      icon: <Clock className="w-5 h-5" />,
      color: "text-cyan-600 dark:text-cyan-400",
      bgColor: "bg-cyan-50 dark:bg-cyan-900/20"
    },
    "Approved for Pick Up": {
      icon: <CheckCircle2 className="w-5 h-5" />,
      color: "text-teal-600 dark:text-teal-400",
      bgColor: "bg-teal-50 dark:bg-teal-900/20"
    },
    "Pending Pickup": {
      icon: <AlertTriangle className="w-5 h-5" />,
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-50 dark:bg-amber-900/20"
    },
    "Check Out": {
      icon: <Package className="w-5 h-5" />,
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-50 dark:bg-orange-900/20"
    },
    "Checked Out": {
      icon: <Package className="w-5 h-5" />,
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-50 dark:bg-orange-900/20"
    },
    "In-Transit": {
      icon: <TruckIcon className="w-5 h-5" />,
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-50 dark:bg-purple-900/20"
    },
    "Deployed": {
      icon: <TruckIcon className="w-5 h-5" />,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-50 dark:bg-emerald-900/20"
    },
    "Approved to Pick Up": {
      icon: <CheckCircle2 className="w-5 h-5" />,
      color: "text-teal-600 dark:text-teal-400",
      bgColor: "bg-teal-50 dark:bg-teal-900/20"
    },
    "Reserved": {
      icon: <Package className="w-5 h-5" />,
      color: "text-indigo-600 dark:text-indigo-400",
      bgColor: "bg-indigo-50 dark:bg-indigo-900/20"
    }
  };

  const defaultConfig = {
    icon: <Package className="w-5 h-5" />,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-900/20"
  };

  // Display name mapping for status labels
  const statusDisplayNames: Record<string, string> = {
    "Locked down local": "In Process",
    "Locked Down Local": "In Process"
  };

  const getStatusDisplayName = (status: string) => {
    return statusDisplayNames[status] || status;
  };

  const getStatusIcon = (status: string) => {
    return (statusConfig[status] || defaultConfig).icon;
  };

  const getStatusColor = (status: string) => {
    return (statusConfig[status] || defaultConfig).color;
  };

  const getStatusBgColor = (status: string) => {
    return (statusConfig[status] || defaultConfig).bgColor;
  };

  return (
    <div className="h-full bg-background">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Park My Fleet</h1>
      </div>

      {pmfSummary && pmfSummary.pipelineFlow && pmfSummary.pipelineFlow.length > 0 && (
        <div className="px-4 pt-4">
          <Card>
            <CardContent className="py-3 px-4">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <GitBranch className="w-4 h-4" />
                Processing Pipeline
              </h3>
              <div className="flex items-center gap-1 overflow-x-auto">
                {pmfSummary.pipelineFlow.map((step, index) => {
                  const stepStyle = statusConfig[step.status] || defaultConfig;
                  return (
                    <div key={step.status} className="flex items-center" data-testid={`pipeline-step-${index}`}>
                      <button
                        className={`flex flex-col items-center px-3 py-2 rounded-md min-w-[100px] cursor-pointer hover-elevate ${stepStyle.bgColor} ${columnFilters["Status"] === step.status || columnFilters["Status"] === `__pipeline__${step.status}` ? "ring-2 ring-primary ring-offset-1" : ""}`}
                        onClick={() => {
                          setColumnFilters(prev => {
                            const currentFilter = prev["Status"];
                            const pipelineKey = step.filterStatuses ? `__pipeline__${step.status}` : step.status;
                            if (currentFilter === pipelineKey || currentFilter === step.status) {
                              const { Status, ...rest } = prev;
                              return rest;
                            }
                            return { ...prev, Status: pipelineKey };
                          });
                        }}
                        data-testid={`button-pipeline-${step.status.replace(/\s+/g, '-').toLowerCase()}`}
                      >
                        <div className={`${stepStyle.color}`}>
                          {stepStyle.icon}
                        </div>
                        <span className="text-xs font-medium mt-1 whitespace-nowrap">{step.status}</span>
                        <span className={`text-lg font-bold ${stepStyle.color}`}>{step.count}</span>
                      </button>
                      {index < pmfSummary.pipelineFlow.length - 1 && (
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mx-1" />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <main className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TruckIcon className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground" data-testid="text-record-count">
              {pmfData.length > 0 
                ? `${filteredAggregatedAssets.length} of ${aggregatedAssets.length} unique assets (${pmfData.length} total records)`
                : 'No data loaded'}
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            {activeFilterCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="gap-1"
                data-testid="button-clear-filters"
              >
                <X className="w-3 h-3" />
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </Button>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="pmf-csv-upload"
              data-testid="input-pmf-csv"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || importMutation.isPending || syncParqMutation.isPending}
              variant="outline"
              data-testid="button-upload-csv"
            >
              {isUploading || importMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {isUploading || importMutation.isPending ? 'Importing...' : 'Upload CSV'}
            </Button>
            
            <Button 
              onClick={() => syncParqMutation.mutate()}
              disabled={isUploading || importMutation.isPending || syncParqMutation.isPending}
              data-testid="button-sync-parq"
            >
              {syncParqMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Cloud className="w-4 h-4 mr-2" />
              )}
              {syncParqMutation.isPending ? 'Syncing...' : 'Sync from PARQ API'}
            </Button>
            
            <Button 
              onClick={() => syncActivityMutation.mutate()}
              disabled={syncActivityMutation.isPending}
              variant="outline"
              data-testid="button-sync-activity"
            >
              {syncActivityMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {syncActivityMutation.isPending ? 'Syncing...' : 'Sync Activity'}
            </Button>
            
            <Button 
              onClick={exportBulkToolAudit}
              disabled={isExportingToolAudit}
              variant="outline"
              data-testid="button-export-tool-audit"
            >
              {isExportingToolAudit ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {isExportingToolAudit ? 'Exporting...' : 'Export Tool Audit'}
            </Button>
          </div>
        </div>
        
        {/* Activity sync status indicator */}
        {activitySyncMeta?.meta && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="w-3 h-3" />
            <span>
              Activity logs: {activitySyncMeta.meta.logsFetched} entries from {activitySyncMeta.meta.vehiclesSynced} vehicles
              {' · '}Last synced {new Date(activitySyncMeta.meta.lastSyncAt).toLocaleString()}
            </span>
          </div>
        )}


        {/* US Map showing vehicle counts by state */}
        {pmfData.length > 0 && (
          <PMFMap 
            data={pmfData} 
            statusFilter={mapStatusFilter}
            onStatusFilterChange={setMapStatusFilter}
          />
        )}

        {/* Weekly Status Flow Tracker */}
        {aggregatedAssets.length > 0 && (
          <PMFWeeklyTracker aggregatedAssets={aggregatedAssets} />
        )}

        {pmfData.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Cloud className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Data Loaded</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                Sync vehicle data from the Park My Fleet (PARQ) API, or upload a CSV file.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button 
                  onClick={() => syncParqMutation.mutate()}
                  disabled={syncParqMutation.isPending}
                  data-testid="button-sync-parq-empty"
                >
                  {syncParqMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Cloud className="w-4 h-4 mr-2" />
                  )}
                  {syncParqMutation.isPending ? 'Syncing...' : 'Sync from PARQ API'}
                </Button>
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  data-testid="button-upload-csv-empty"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <CardTitle className="text-sm font-medium">PMF Vehicle Records (One row per Asset)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs font-medium uppercase whitespace-nowrap w-10 p-0">
                        <div className="px-2 py-2 flex items-center justify-center">
                          <Activity className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase whitespace-nowrap min-w-[100px] p-0">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button 
                              className={`flex items-center gap-1 w-full px-4 py-2 text-left hover:bg-muted/50 ${columnFilters["Asset ID"] ? "text-primary" : ""}`}
                              data-testid="filter-asset-id"
                            >
                              Asset ID
                              <ChevronDown className="w-3 h-3 opacity-50" />
                              {columnFilters["Asset ID"] && <Filter className="w-3 h-3 text-primary" />}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" align="start">
                            <div className="space-y-2">
                              <Input
                                placeholder="Filter Asset ID..."
                                value={columnFilters["Asset ID"] || ""}
                                onChange={(e) => setColumnFilter("Asset ID", e.target.value)}
                                className="h-8 text-sm"
                                data-testid="input-filter-asset-id"
                              />
                              {columnFilters["Asset ID"] && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="w-full h-7 text-xs"
                                  onClick={() => setColumnFilter("Asset ID", "")}
                                >
                                  Clear filter
                                </Button>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase whitespace-nowrap min-w-[120px] p-0">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button 
                              className={`flex items-center gap-1 w-full px-4 py-2 text-left hover:bg-muted/50 ${columnFilters["Status"] ? "text-primary" : ""}`}
                              data-testid="filter-status"
                            >
                              Status
                              <ChevronDown className="w-3 h-3 opacity-50" />
                              {columnFilters["Status"] && <Filter className="w-3 h-3 text-primary" />}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-2" align="start">
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                              {uniqueStatuses.filter(s => s && s.trim()).map((status) => {
                                const count = aggregatedAssets.filter(a => a.status === status).length;
                                const isSelected = columnFilters["Status"] === status;
                                return (
                                  <button
                                    key={status}
                                    className={`flex items-center justify-between w-full px-2 py-1.5 text-sm rounded hover:bg-muted ${isSelected ? "bg-primary/10 text-primary font-medium" : ""}`}
                                    onClick={() => setColumnFilter("Status", isSelected ? "" : status)}
                                    data-testid={`filter-status-option-${status.toLowerCase().replace(/\s+/g, '-')}`}
                                  >
                                    <span>{status}</span>
                                    <span className="text-xs text-muted-foreground">({count})</span>
                                  </button>
                                );
                              })}
                              {columnFilters["Status"] && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="w-full h-7 text-xs mt-2"
                                  onClick={() => setColumnFilter("Status", "")}
                                >
                                  Clear filter
                                </Button>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase whitespace-nowrap min-w-[140px] p-0">
                        <button 
                          className={`flex items-center gap-1 w-full px-4 py-2 text-left hover:bg-muted/50 ${sortColumn === 'daysInStatus' ? "text-primary" : ""}`}
                          onClick={() => toggleSort('daysInStatus')}
                          data-testid="sort-days-locked-down-local"
                        >
                          Days In Process
                          {sortColumn === 'daysInStatus' ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="w-3 h-3" />
                            ) : (
                              <ArrowDown className="w-3 h-3" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-50" />
                          )}
                        </button>
                      </TableHead>
                      {headers.filter(h => h !== "Asset ID" && h !== "Status").map((field, index) => (
                        <TableHead 
                          key={index} 
                          className="text-xs font-medium uppercase whitespace-nowrap p-0"
                        >
                          <Popover>
                            <PopoverTrigger asChild>
                              <button 
                                className={`flex items-center gap-1 w-full px-4 py-2 text-left hover:bg-muted/50 ${columnFilters[field] ? "text-primary" : ""}`}
                                data-testid={`filter-${field.toLowerCase().replace(/\s+/g, '-')}`}
                              >
                                {field}
                                <ChevronDown className="w-3 h-3 opacity-50" />
                                {columnFilters[field] && <Filter className="w-3 h-3 text-primary" />}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-2" align="start">
                              <div className="space-y-2">
                                <Input
                                  placeholder={`Filter ${field}...`}
                                  value={columnFilters[field] || ""}
                                  onChange={(e) => setColumnFilter(field, e.target.value)}
                                  className="h-8 text-sm"
                                  data-testid={`input-filter-${field.toLowerCase().replace(/\s+/g, '-')}`}
                                />
                                {columnFilters[field] && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="w-full h-7 text-xs"
                                    onClick={() => setColumnFilter(field, "")}
                                  >
                                    Clear filter
                                  </Button>
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAggregatedAssets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={headers.filter(h => h !== "Asset ID" && h !== "Status").length + 4} className="text-center py-8">
                          <XCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                          <p className="text-sm text-muted-foreground">No matching records found</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredAggregatedAssets.slice(0, 500).map((asset, rowIndex) => (
                        <>
                          <TableRow key={asset.assetId} data-testid={`row-pmf-${rowIndex}`} className="align-top">
                            <TableCell className="w-10 p-1">
                              <button
                                onClick={() => toggleRowExpansion(asset.assetId)}
                                className="p-1 rounded hover:bg-muted/50 flex items-center justify-center"
                                data-testid={`button-expand-${rowIndex}`}
                              >
                                {loadingActivityFor === asset.assetId ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                ) : expandedRows.has(asset.assetId) ? (
                                  <ChevronDown className="w-4 h-4 text-primary" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell 
                              className="text-sm font-medium whitespace-nowrap"
                              data-testid={`cell-assetid-${rowIndex}`}
                            >
                              {asset.assetId}
                            </TableCell>
                            <TableCell 
                              className="text-sm whitespace-nowrap"
                              data-testid={`cell-status-${rowIndex}`}
                            >
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                {asset.status || '—'}
                              </span>
                            </TableCell>
                            <TableCell 
                              className="text-sm whitespace-nowrap text-center"
                              data-testid={`cell-days-in-status-${rowIndex}`}
                            >
                              {daysInStatusData?.data?.[asset.assetId]?.daysInStatus !== undefined ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  daysInStatusData.data[asset.assetId].daysInStatus > 30 
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                    : daysInStatusData.data[asset.assetId].daysInStatus > 14
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                }`}>
                                  {daysInStatusData.data[asset.assetId].daysInStatus} days
                                </span>
                              ) : '—'}
                            </TableCell>
                            {headers.filter(h => h !== "Asset ID" && h !== "Status").map((field, colIndex) => (
                              <TableCell 
                                key={colIndex} 
                                className="text-sm whitespace-nowrap"
                                data-testid={`cell-${field.toLowerCase().replace(/\s+/g, '-')}-${rowIndex}`}
                              >
                                {asset.otherFields[field] || '—'}
                              </TableCell>
                            ))}
                          </TableRow>
                          {expandedRows.has(asset.assetId) && (
                            <TableRow key={`${asset.assetId}-activity`} className="bg-muted/30">
                              <TableCell colSpan={headers.filter(h => h !== "Asset ID" && h !== "Status").length + 4} className="p-0">
                                <div className="p-4 border-t border-b">
                                  <div className="flex items-center gap-4 mb-3">
                                    <div className="flex items-center gap-2">
                                      <Activity className="w-4 h-4 text-primary" />
                                      <span className="text-sm font-medium">Activity Log</span>
                                      <span className="text-xs text-muted-foreground">
                                        ({activityLogs[asset.assetId]?.length || 0} entries)
                                      </span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => window.open(`/pmf/tool-audit/${encodeURIComponent(asset.assetId)}`, '_blank')}
                                        data-testid={`button-tool-audit-${asset.assetId}`}
                                      >
                                        <Wrench className="w-4 h-4 mr-2" />
                                        View Tool Audit
                                      </Button>
                                  </div>
                                  {loadingActivityFor === asset.assetId ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Loading activity logs...
                                    </div>
                                  ) : activityFetchErrors[asset.assetId] ? (
                                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 py-2">
                                      <AlertTriangle className="w-4 h-4" />
                                      {activityFetchErrors[asset.assetId]}
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => fetchActivityLogs(asset.assetId)}
                                        className="ml-2"
                                      >
                                        Retry
                                      </Button>
                                    </div>
                                  ) : activityLogs[asset.assetId]?.length ? (
                                    <div className="border rounded-md overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50">
                                          <tr>
                                            <th className="px-3 py-2 text-left font-medium text-xs uppercase">Activity Date</th>
                                            <th className="px-3 py-2 text-left font-medium text-xs uppercase">Approved Date</th>
                                            <th className="px-3 py-2 text-left font-medium text-xs uppercase">Activity</th>
                                            <th className="px-3 py-2 text-left font-medium text-xs uppercase">State</th>
                                            <th className="px-3 py-2 text-left font-medium text-xs uppercase">Type</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {activityLogs[asset.assetId].map((log, logIndex) => {
                                            const actionParts = log.action.split(' - ');
                                            const activity = actionParts[0] || log.action;
                                            const state = actionParts.slice(1).join(' - ') || '';
                                            
                                            // Determine approved date based on state
                                            // If this entry is "Approved", use its activity date
                                            // If this entry is "Complete" or "In Progress", look for earlier "Approved" entry with same work order
                                            let approvedDate = '';
                                            const stateLC = state.toLowerCase();
                                            const isApproved = stateLC.includes('approved');
                                            const isComplete = stateLC.includes('complete');
                                            const isInProgress = stateLC.includes('in progress') || stateLC.includes('inprogress');
                                            
                                            if (isApproved) {
                                              // This entry itself is the approval
                                              approvedDate = formatActivityDate(log.activityDate);
                                            } else if ((isComplete || isInProgress) && log.workOrderId) {
                                              // Look for an "Approved" entry with the same work order ID
                                              const approvalEntry = activityLogs[asset.assetId].find(
                                                (otherLog) => 
                                                  otherLog.workOrderId === log.workOrderId &&
                                                  otherLog.action.toLowerCase().includes('approved')
                                              );
                                              if (approvalEntry) {
                                                approvedDate = formatActivityDate(approvalEntry.activityDate);
                                              }
                                            }
                                            
                                            // Show completion date when state is "complete"
                                            const stateDisplay = isComplete 
                                              ? `${state} (${formatActivityDate(log.activityDate)})`
                                              : state;
                                            return (
                                              <tr key={log.id} className={logIndex % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                  {formatActivityDate(log.activityDate)}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                                  {approvedDate || '-'}
                                                </td>
                                                <td className="px-3 py-2">{activity}</td>
                                                <td className="px-3 py-2">{stateDisplay}</td>
                                                <td className="px-3 py-2">
                                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                    log.typeDescription === 'Work Order' 
                                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                                  }`}>
                                                    {log.typeDescription}
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="text-sm text-muted-foreground py-2">
                                      No activity logs found for this vehicle. Click "Sync Activity Logs" to fetch the latest data.
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))
                    )}
                  </TableBody>
                </Table>
                {filteredAggregatedAssets.length > 500 && (
                  <div className="p-3 text-center text-sm text-muted-foreground border-t">
                    Showing first 500 of {filteredAggregatedAssets.length} unique assets
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Tool Audit Dialog */}
      <Dialog open={toolAuditDialogOpen} onOpenChange={setToolAuditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Tool Audit - Asset {toolAuditData?.assetId}
            </DialogTitle>
            {toolAuditData?.reportDate && (
              <p className="text-sm text-muted-foreground">
                Report Date: {new Date(toolAuditData.reportDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            )}
          </DialogHeader>
          
          <div className="flex-1 overflow-auto">
            {toolAuditData?.tools && toolAuditData.tools.length > 0 ? (
              <div className="space-y-4">
                {/* Group tools by section */}
                {Object.entries(
                  toolAuditData.tools.reduce((acc, tool) => {
                    if (!acc[tool.section]) acc[tool.section] = [];
                    acc[tool.section].push(tool);
                    return acc;
                  }, {} as Record<string, ToolAuditItem[]>)
                ).map(([section, sectionTools]) => (
                  <div key={section} className="border rounded-lg p-3">
                    <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                        {section}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        ({sectionTools.length} items)
                      </span>
                    </h3>
                    <div className="space-y-1">
                      {sectionTools.map((tool, idx) => (
                        <div 
                          key={idx} 
                          className={`flex items-center justify-between py-1.5 px-2 rounded text-sm ${
                            tool.isFailure === true 
                              ? 'bg-red-50 dark:bg-red-900/20' 
                              : tool.isFailure === false 
                              ? 'bg-green-50 dark:bg-green-900/20'
                              : 'bg-muted/30'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="truncate">{tool.toolName}</span>
                            {tool.systemNumber && (
                              <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono shrink-0">
                                {tool.systemNumber}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {tool.hasPhoto && (
                              <span className="text-xs text-muted-foreground">📷</span>
                            )}
                            {tool.isFailure === true && (
                              <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded text-xs">
                                Missing
                              </span>
                            )}
                            {tool.isFailure === false && (
                              <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded text-xs">
                                Present
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No tool audit data available for this vehicle.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
