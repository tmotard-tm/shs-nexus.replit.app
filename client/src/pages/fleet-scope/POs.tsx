import { useState, useRef, useMemo, Fragment } from "react";
import { Link } from "wouter";
import { useUser } from "@/context/FleetScopeUserContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  Search,
  Upload,
  FileUp,
  FileSpreadsheet,
  Loader2,
  Package,
  ChevronDown,
  ChevronUp,
  Pencil,
  Download,
  Filter,
  X,
  RefreshCw,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface PORecord {
  id: string;
  poNumber: string;
  rawData: Record<string, any>;
  submittedInHolman: string | null;
  finalApproval: string | null;
  importedAt: string;
  importedBy: string | null;
}

interface POApiResponse {
  orders: PORecord[];
  meta: {
    id: string;
    headers: string[];
    lastImportedAt: string;
    lastImportedBy: string | null;
    totalRows: number | null;
  } | null;
}

const DEFAULT_FINAL_APPROVAL_OPTIONS = [
  "Actioned intermediary step - New PO will be submitted",
  "Decline and Submit for Sale",
  "Get additional information from shop",
  "Get estimate for only critical safety repairs, then resubmit for approval",
  "Proceed with repair (as scoped in approval decision)",
  "Transfer to alternative repair shop",
];

const FINAL_APPROVAL_DISPLAY_ORDER = [
  "Proceed with repair (as scoped in approval decision)",
  "Decline and Submit for Sale",
  "(Pending)",
  "Resubmit once research done",
  "Transfer to alternative repair shop",
  "Get additional information from shop",
];

const sortByApprovalOrder = (a: [string, number], b: [string, number]) => {
  const indexA = FINAL_APPROVAL_DISPLAY_ORDER.indexOf(a[0]);
  const indexB = FINAL_APPROVAL_DISPLAY_ORDER.indexOf(b[0]);
  if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0]);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
};

function FinalApprovalCell({ 
  order, 
  options 
}: { 
  order: PORecord; 
  options: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (finalApproval: string) => {
      const response = await apiRequest('PATCH', `/api/fs/pos/${order.id}/final-approval`, { finalApproval });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fs/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fs/pos/final-approval-options'] });
      setIsOpen(false);
      setShowCustomInput(false);
      setCustomValue("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const currentValue = order.finalApproval || "";
  const allOptions = Array.from(new Set([...options, ...DEFAULT_FINAL_APPROVAL_OPTIONS])).sort();

  const handleSelect = (value: string) => {
    if (value === "__custom__") {
      setShowCustomInput(true);
      setCustomValue(currentValue);
    } else if (value === "__clear__") {
      updateMutation.mutate("");
    } else {
      updateMutation.mutate(value);
    }
  };

  const handleCustomSubmit = () => {
    if (customValue.trim()) {
      updateMutation.mutate(customValue.trim());
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button 
          className="flex items-center gap-1 text-left hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer min-w-[120px] w-full"
          data-testid={`button-final-approval-${order.id}`}
        >
          <span className="flex-1 truncate text-sm">
            {currentValue || <span className="text-muted-foreground italic">Click to set</span>}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        {showCustomInput ? (
          <div className="space-y-2">
            <Input
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="Enter custom value..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") {
                  setShowCustomInput(false);
                  setCustomValue("");
                }
              }}
              data-testid="input-custom-approval"
            />
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleCustomSubmit}
                disabled={updateMutation.isPending}
                data-testid="button-save-custom"
              >
                {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => {
                  setShowCustomInput(false);
                  setCustomValue("");
                }}
                data-testid="button-cancel-custom"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {allOptions.map((option) => (
              <button
                key={option}
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${
                  currentValue === option ? "bg-primary/10 font-medium" : ""
                }`}
                onClick={() => handleSelect(option)}
                disabled={updateMutation.isPending}
                data-testid={`option-approval-${option.slice(0, 20)}`}
              >
                {option}
              </button>
            ))}
            <div className="border-t my-1" />
            <button
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center gap-2 text-muted-foreground"
              onClick={() => handleSelect("__custom__")}
              data-testid="option-custom"
            >
              <Pencil className="h-3 w-3" />
              Type custom value...
            </button>
            {currentValue && (
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-destructive/10 text-destructive"
                onClick={() => handleSelect("__clear__")}
                data-testid="option-clear"
              >
                Clear value
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const SUBMITTED_IN_HOLMAN_OPTIONS = ["Yes", "No"];

function SubmittedInHolmanCell({ order }: { order: PORecord }) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (submittedInHolman: string) => {
      const response = await apiRequest('PATCH', `/api/fs/pos/${order.id}/submitted-in-holman`, { submittedInHolman });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fs/pos'] });
      setIsOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const currentValue = order.submittedInHolman || "";

  const handleSelect = (value: string) => {
    if (value === "__clear__") {
      updateMutation.mutate("");
    } else {
      updateMutation.mutate(value);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button 
          className="flex items-center gap-1 text-left hover:bg-muted/50 px-1 py-0.5 rounded cursor-pointer min-w-[80px] w-full"
          data-testid={`button-submitted-holman-${order.id}`}
        >
          <span className="flex-1 truncate text-sm">
            {currentValue || <span className="text-muted-foreground italic">Click to set</span>}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-2" align="start">
        <div className="space-y-1">
          {SUBMITTED_IN_HOLMAN_OPTIONS.map((option) => (
            <button
              key={option}
              className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${
                currentValue === option ? "bg-primary/10 font-medium" : ""
              }`}
              onClick={() => handleSelect(option)}
              disabled={updateMutation.isPending}
              data-testid={`option-holman-${option}`}
            >
              {option}
            </button>
          ))}
          {currentValue && (
            <>
              <div className="border-t my-1" />
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-destructive/10 text-destructive"
                onClick={() => handleSelect("__clear__")}
                data-testid="option-holman-clear"
              >
                Clear value
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface POPriorityGroup {
  poNumber: string;
  rows: Record<string, any>[];
}

interface POPriorityResponse {
  groups: POPriorityGroup[];
  totalRows: number;
  totalGroups: number;
  columns: string[];
}

const PRIORITY_COLUMNS_ORDER = [
  'PRIORITY', 'PO_NUMBER', 'DECLINED_REPAIR', 'HAS_RENTAL', 'DATE_IN_REPAIR', 'PO_DATE', 'PO_STATUS', 'REPAIR_TYPE_DESCRIPTION', 'CLIENT_VEHICLE_NUMBER',
  'HOLMAN_VEHICLE_NUMBER', 'SERIAL_NO', 'VENDOR_NAME', 'VENDOR_ID',
  'PO_LINE_NUMBER', 'DESCRIPTION', 'LINE_ITEM_COST', 'TOTAL_LINE_ITEM_AMOUNT',
  'ATA_GROUP_DESC', 'ATA_CODE', 'YEAR', 'MAKE', 'MODEL', 'STATE', 'DISTRICT',
  'DRIVER_LAST_NAME', 'ASSIGNED_STATUS_DESCRIPTION', 'CURRENT_ODOMETER',
  'LIFETIME_MAINTENANCE_COST', 'VEHICLE_ESTIMATED_RESALE',
];

function formatColumnHeader(col: string): string {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCellValue(value: any, col: string): string {
  if (value === null || value === undefined) return '-';
  if (col.includes('DATE') && typeof value === 'string') {
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch { /* fall through */ }
  }
  if (col.includes('AMOUNT') || col.includes('TOTAL') || col.includes('COST') || col.includes('PRICE') || col.includes('RESALE')) {
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[,$]/g, ''));
    if (!isNaN(num)) {
      return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  return String(value);
}

function POPriorityView() {
  const [prioSearch, setPrioSearch] = useState("");
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());

  const { data: prioData, isLoading: prioLoading, error: prioError } = useQuery<POPriorityResponse>({
    queryKey: ['/api/fs/po-priority'],
  });

  const displayColumns = useMemo(() => {
    if (!prioData?.columns) return [];
    const ordered = PRIORITY_COLUMNS_ORDER.filter(c => prioData.columns.includes(c));
    const remaining = prioData.columns.filter(c => !PRIORITY_COLUMNS_ORDER.includes(c));
    return [...ordered, ...remaining];
  }, [prioData?.columns]);

  const filteredGroups = useMemo(() => {
    if (!prioData?.groups) return [];
    if (!prioSearch.trim()) return prioData.groups;
    const q = prioSearch.toLowerCase();
    return prioData.groups.filter(g => {
      if (g.poNumber.toLowerCase().includes(q)) return true;
      return g.rows.some(r =>
        Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(q))
      );
    });
  }, [prioData?.groups, prioSearch]);

  const toggleExpand = (poNumber: string) => {
    setExpandedPOs(prev => {
      const next = new Set(prev);
      if (next.has(poNumber)) next.delete(poNumber);
      else next.add(poNumber);
      return next;
    });
  };

  const exportToExcel = () => {
    if (!filteredGroups.length || !displayColumns.length) return;
    const allRows = filteredGroups.flatMap(g => g.rows);
    const exportData = allRows.map(row => {
      const obj: Record<string, any> = {};
      for (const col of displayColumns) {
        obj[formatColumnHeader(col)] = row[col] ?? '';
      }
      return obj;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'PO Priority');
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `PO_Priority_${dateStr}.xlsx`);
  };

  if (prioLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading PO Priority data from Holman...</span>
      </div>
    );
  }

  if (prioError) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="font-medium">Failed to load PO Priority data</p>
            <p className="text-sm text-muted-foreground mt-1">{(prioError as Error).message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search PO number, vendor, vehicle..."
              value={prioSearch}
              onChange={(e) => setPrioSearch(e.target.value)}
              className="pl-10 w-80"
              data-testid="input-po-priority-search"
            />
          </div>
          <span className="text-sm text-muted-foreground" data-testid="text-po-priority-summary">
            {filteredGroups.length} POs ({filteredGroups.reduce((s, g) => s + g.rows.length, 0)} line items)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToExcel}
            disabled={filteredGroups.length === 0}
            className="gap-2"
            data-testid="button-export-po-priority"
          >
            <Download className="h-4 w-4" />
            Export XLSX
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              Unpaid POs (PO Date from Dec 1, 2025 to present · Excludes Rentals)
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Source: HOLMAN_ETL_PO_DETAILS
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" data-testid="table-po-priority">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-3 font-medium w-8" />
                  <th className="text-left py-2 px-3 font-medium">Priority</th>
                  <th className="text-left py-2 px-3 font-medium">PO Number</th>
                  <th className="text-left py-2 px-3 font-medium">Declined</th>
                  <th className="text-left py-2 px-3 font-medium">Rental</th>
                  <th className="text-left py-2 px-3 font-medium">Date In Repair</th>
                  <th className="text-left py-2 px-3 font-medium">Line Items</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-left py-2 px-3 font-medium">PO Date</th>
                  <th className="text-left py-2 px-3 font-medium">Repair Type</th>
                  <th className="text-left py-2 px-3 font-medium">Vehicle</th>
                  <th className="text-left py-2 px-3 font-medium">Vendor</th>
                  <th className="text-left py-2 px-3 font-medium">Vendor Address</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((group) => {
                  const first = group.rows[0] || {};
                  const isExpanded = expandedPOs.has(group.poNumber);

                  return (
                    <Fragment key={group.poNumber}>
                      <tr
                        className="border-t cursor-pointer hover:bg-muted/30"
                        onClick={() => toggleExpand(group.poNumber)}
                        data-testid={`row-po-priority-${group.poNumber}`}
                      >
                        <td className="py-2 px-3">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90" />
                          )}
                        </td>
                        <td className="py-2 px-3" data-testid={`text-priority-${group.poNumber}`}>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            first.PRIORITY === 'P1' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                            first.PRIORITY === 'P2' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {first.PRIORITY || 'P3'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-medium" data-testid={`text-po-number-${group.poNumber}`}>
                          {group.poNumber}
                        </td>
                        <td className="py-2 px-3" data-testid={`text-declined-${group.poNumber}`}>
                          {first.DECLINED_REPAIR === 'Declined' && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                              Declined
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3" data-testid={`text-rental-${group.poNumber}`}>
                          {first.HAS_RENTAL === 'Yes' && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                              Yes
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground" data-testid={`text-date-in-repair-${group.poNumber}`}>
                          {first.DATE_IN_REPAIR ? formatCellValue(first.DATE_IN_REPAIR, 'DATE') : '-'}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 bg-muted rounded text-xs font-medium">
                            {group.rows.length}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            first.PO_STATUS === 'OPEN' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                            first.PO_STATUS === 'CLOSED' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' :
                            'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>
                            {first.PO_STATUS || '-'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {formatCellValue(first.PO_DATE, 'PO_DATE')}
                        </td>
                        <td className="py-2 px-3">{first.REPAIR_TYPE_DESCRIPTION || '-'}</td>
                        <td className="py-2 px-3 font-mono text-xs">{first.HOLMAN_VEHICLE_NUMBER || first.CLIENT_VEHICLE_NUMBER || '-'}</td>
                        <td className="py-2 px-3">{first.VENDOR_NAME || '-'}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground max-w-[250px] truncate" title={[first.VENDOR_ADDRESS_LINE_1, first.VENDOR_ADDRESS_LINE_2, first.VENDOR_CITY, first.VENDOR_STATE, first.VENDOR_ZIP].filter(Boolean).join(', ')}>
                          {[first.VENDOR_ADDRESS_LINE_1, first.VENDOR_ADDRESS_LINE_2, first.VENDOR_CITY, first.VENDOR_STATE, first.VENDOR_ZIP].filter(Boolean).join(', ') || '-'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={13} className="p-0">
                            <div className="bg-muted/20 border-t border-b px-6 py-3">
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr>
                                      {displayColumns.map(col => (
                                        <th key={col} className="text-left py-1.5 px-2 font-medium text-muted-foreground whitespace-nowrap">
                                          {formatColumnHeader(col)}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.rows.map((row, idx) => (
                                      <tr key={idx} className="border-t border-muted hover:bg-muted/30">
                                        {displayColumns.map(col => (
                                          <td key={col} className="py-1.5 px-2 whitespace-nowrap max-w-[200px] truncate">
                                            {col === 'PRIORITY' ? (
                                              <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                                                row[col] === 'P1' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                                row[col] === 'P2' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                                                'bg-muted text-muted-foreground'
                                              }`}>
                                                {row[col] || 'P3'}
                                              </span>
                                            ) : col === 'DECLINED_REPAIR' && row[col] === 'Declined' ? (
                                              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                                                Declined
                                              </span>
                                            ) : col === 'HAS_RENTAL' && row[col] === 'Yes' ? (
                                              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                                Yes
                                              </span>
                                            ) : formatCellValue(row[col], col)}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <tr>
                    <td colSpan={13} className="text-center py-8 text-muted-foreground">
                      {prioSearch ? 'No POs match your search.' : 'No unpaid POs found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function POs() {
  const { currentUser } = useUser();
  const [activeTab, setActiveTab] = useState<'purchase-orders' | 'po-priority'>('purchase-orders');
  const [searchQuery, setSearchQuery] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [showColumnDialog, setShowColumnDialog] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    rows: Record<string, any>[];
    headers: string[];
    filename: string;
  } | null>(null);
  const [selectedPoColumn, setSelectedPoColumn] = useState<string>("");
  const [robDecisionFilter, setRobDecisionFilter] = useState<string>("__all__");
  const [differenceFilter, setDifferenceFilter] = useState<string>("__all__");
  const [finalApprovalFilter, setFinalApprovalFilter] = useState<string>("__all__");
  const [submittedHolmanFilter, setSubmittedHolmanFilter] = useState<string>("__all__");
  const [vehicleNoFilter, setVehicleNoFilter] = useState<string>("");
  const [spareVanFilter, setSpareVanFilter] = useState<string>("__all__");
  const [approvalBreakdownOpen, setApprovalBreakdownOpen] = useState(true);
  const [importsTimePeriodOpen, setImportsTimePeriodOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: poData, isLoading } = useQuery<POApiResponse>({
    queryKey: ['/api/fs/pos'],
    retry: false,
  });

  const { data: approvalOptions = [] } = useQuery<string[]>({
    queryKey: ['/api/fs/pos/final-approval-options'],
    retry: false,
  });

  const importMutation = useMutation({
    mutationFn: async (payload: {
      rows: Record<string, any>[];
      headers: string[];
      poNumberColumn: string;
      importedBy?: string;
    }) => {
      const response = await apiRequest('POST', '/api/fs/pos/import', payload);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/fs/pos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fs/pos/final-approval-options'] });
      
      let message = `${data.created} records imported`;
      if (data.preservedApprovals > 0) {
        message += ` (${data.preservedApprovals} Final Approval values preserved)`;
      }
      
      toast({
        title: "Import successful",
        description: message,
      });
      setShowColumnDialog(false);
      setPendingImport(null);
      setSelectedPoColumn("");
      setIsUploading(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
      setIsUploading(false);
    },
  });

  const syncDeclinedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/fs/pos/sync-declined-repairs', {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/fs/trucks'] });
      
      const skippedNote = data.skippedApprovedForSale > 0 
        ? ` (${data.skippedApprovedForSale} skipped - already "Approved for sale")` 
        : '';
      
      if (data.updated > 0) {
        toast({
          title: "Sync Complete",
          description: `Updated ${data.updated} truck(s) to "Declined Repair" status. ${data.alreadyDeclined} already had this status.${skippedNote}`,
        });
      } else if (data.alreadyDeclined > 0 || data.skippedApprovedForSale > 0) {
        toast({
          title: "Already Synced",
          description: `${data.alreadyDeclined} trucks already have "Declined Repair" status.${skippedNote}`,
        });
      } else {
        toast({
          title: "No Matches Found",
          description: `Found ${data.totalDeclinedPOs} records with "Decline and Submit for Sale" but none matched trucks in Dashboard.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const filename = file.name;
    const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls');

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);
          
          if (jsonData.length === 0) {
            toast({
              title: "Empty file",
              description: "The Excel file contains no data",
              variant: "destructive",
            });
            setIsUploading(false);
            return;
          }

          const headers = Object.keys(jsonData[0]);
          setPendingImport({ rows: jsonData, headers, filename });
          setShowColumnDialog(true);
          setIsUploading(false);
        } catch (error: any) {
          toast({
            title: "Parse error",
            description: "Failed to parse Excel file: " + error.message,
            variant: "destructive",
          });
          setIsUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as Record<string, any>[];
          
          if (data.length === 0) {
            toast({
              title: "Empty file",
              description: "The CSV file contains no data",
              variant: "destructive",
            });
            setIsUploading(false);
            return;
          }

          const headers = Object.keys(data[0]);
          setPendingImport({ rows: data, headers, filename });
          setShowColumnDialog(true);
          setIsUploading(false);
        },
        error: (error) => {
          toast({
            title: "Parse error",
            description: "Failed to parse CSV: " + error.message,
            variant: "destructive",
          });
          setIsUploading(false);
        },
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = () => {
    if (!pendingImport || !selectedPoColumn) return;

    importMutation.mutate({
      rows: pendingImport.rows,
      headers: pendingImport.headers,
      poNumberColumn: selectedPoColumn,
      importedBy: currentUser || undefined,
    });
  };

  const handleExportExcel = () => {
    if (filteredOrders.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no records to export",
        variant: "destructive",
      });
      return;
    }

    // Build export data - always include core fields from order object, then rawData
    const exportData = filteredOrders.map(order => {
      const row: Record<string, any> = {};
      
      // Always include core fields first (these are the authoritative edited values)
      row["PO Number"] = order.poNumber || "";
      row["Final Approval"] = order.finalApproval || "";
      row["Submitted in Holman"] = order.submittedInHolman || "";
      row["Imported At"] = order.importedAt 
        ? new Date(order.importedAt).toLocaleString() 
        : "";
      
      // Then include all rawData columns (excluding duplicates of the core fields)
      // All entries are fully normalized (lowercase, no spaces or underscores)
      // Also skip __EMPTY columns which are Excel artifacts
      const skipColumns = new Set([
        "finalapproval", "finalappr",
        "submittedinholman",
        "ponumber", "pono",
        "id", "importedat",
        "__empty"
      ]);
      
      if (order.rawData) {
        Object.entries(order.rawData).forEach(([key, value]) => {
          const normalizedKey = key.toLowerCase().replace(/[_\s]/g, '');
          if (!skipColumns.has(normalizedKey)) {
            row[key] = value ?? "";
          }
        });
      }
      
      return row;
    });

    // Create workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "POs");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `POs-export-${timestamp}.xlsx`;

    // Download the file
    XLSX.writeFile(workbook, filename);

    toast({
      title: "Export successful",
      description: `${filteredOrders.length} records exported to ${filename}`,
    });
  };

  const orders = poData?.orders || [];
  const headers = poData?.meta?.headers || [];
  const rawHeaders = headers.length > 0 ? headers : (orders.length > 0 ? Object.keys(orders[0].rawData || {}) : []);

  const isRobDecisionColumn = (header: string) => {
    const h = header.toLowerCase();
    return h.includes("rob") && h.includes("unsubmitted") && h.includes("decision");
  };

  const isDifferenceColumn = (header: string) => {
    const h = header.toLowerCase();
    return h.includes("difference") && h.includes("rob");
  };

  const isFinalApprovalColumn = (header: string) => {
    const h = header.toLowerCase();
    return h.includes("final") && h.includes("appro");
  };

  const isVehicleNoColumn = (header: string) => {
    const h = header.toLowerCase().replace(/[_\s]/g, '');
    return h === 'vehicleno' || h === 'vehiclenumber' || h === 'vehicle_no';
  };

  const isSpareVanColumn = (header: string) => {
    const h = header.toLowerCase().replace(/[_\s]/g, '');
    return h === 'sparevan' || h === 'spare_van' || h === 'sparevehicle';
  };

  const robDecisionColumnName = useMemo(() => {
    return rawHeaders.find(h => isRobDecisionColumn(h)) || "";
  }, [rawHeaders]);

  const differenceColumnName = useMemo(() => {
    return rawHeaders.find(h => isDifferenceColumn(h)) || "";
  }, [rawHeaders]);

  const vehicleNoColumnName = useMemo(() => {
    return rawHeaders.find(h => isVehicleNoColumn(h)) || "";
  }, [rawHeaders]);

  const spareVanColumnName = useMemo(() => {
    return rawHeaders.find(h => isSpareVanColumn(h)) || "";
  }, [rawHeaders]);

  const filteredOrders = useMemo(() => {
    let result = orders;
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((order) => {
        const rawData = order.rawData || {};
        return Object.values(rawData).some((val) => 
          String(val).toLowerCase().includes(query)
        );
      });
    }
    
    if (robDecisionFilter !== "__all__" && robDecisionColumnName) {
      if (robDecisionFilter === "__blank__") {
        result = result.filter(order => {
          const val = String(order.rawData?.[robDecisionColumnName] ?? "").trim();
          return !val;
        });
      } else {
        result = result.filter(order => {
          const val = String(order.rawData?.[robDecisionColumnName] ?? "").trim();
          return val === robDecisionFilter;
        });
      }
    }
    
    if (differenceFilter !== "__all__" && differenceColumnName) {
      if (differenceFilter === "__blank__") {
        result = result.filter(order => {
          const val = String(order.rawData?.[differenceColumnName] ?? "").trim();
          return !val;
        });
      } else {
        result = result.filter(order => {
          const val = String(order.rawData?.[differenceColumnName] ?? "").trim();
          return val === differenceFilter;
        });
      }
    }
    
    if (finalApprovalFilter !== "__all__") {
      if (finalApprovalFilter === "__blank__") {
        result = result.filter(order => !order.finalApproval || order.finalApproval.trim() === "");
      } else {
        result = result.filter(order => (order.finalApproval || "").trim() === finalApprovalFilter);
      }
    }
    
    if (submittedHolmanFilter !== "__all__") {
      if (submittedHolmanFilter === "__blank__") {
        result = result.filter(order => !order.submittedInHolman || order.submittedInHolman.trim() === "");
      } else {
        result = result.filter(order => (order.submittedInHolman || "").trim() === submittedHolmanFilter);
      }
    }
    
    if (vehicleNoFilter.trim() && vehicleNoColumnName) {
      const query = vehicleNoFilter.toLowerCase().trim();
      result = result.filter(order => {
        const val = String(order.rawData?.[vehicleNoColumnName] ?? "").toLowerCase();
        return val.includes(query);
      });
    }
    
    if (spareVanFilter !== "__all__" && spareVanColumnName) {
      if (spareVanFilter === "__blank__") {
        result = result.filter(order => {
          const val = String(order.rawData?.[spareVanColumnName] ?? "").trim().toLowerCase();
          return !val || val === "";
        });
      } else if (spareVanFilter === "yes") {
        result = result.filter(order => {
          const val = String(order.rawData?.[spareVanColumnName] ?? "").trim().toLowerCase();
          return val === "yes" || val === "y";
        });
      }
    }
    
    return result;
  }, [orders, searchQuery, robDecisionFilter, differenceFilter, finalApprovalFilter, submittedHolmanFilter, vehicleNoFilter, spareVanFilter, robDecisionColumnName, differenceColumnName, vehicleNoColumnName, spareVanColumnName]);

  const displayHeaders = useMemo(() => {
    if (rawHeaders.length === 0) return [];
    
    const priorityGroup1 = [
      "Final_Reccomendation GPT",
      "Final_Recommendation GPT",
      "Final Recommendation GPT",
      "Rob's unsubmitted decision / differences if any to GPT",
      "Robs unsubmitted decision / differences if any to GPT",
      "Difference Rob would do",
      "Approval_Recommendation",
      "Approval Recommendation",
      "Final_Approval",
      "Final Approval",
    ];
    
    const priorityGroup2Start = "Context_economics";
    const priorityGroup2End = "High_Scost_Flags";
    
    const normalize = (s: string) => s.toLowerCase().replace(/[_\s]/g, '');
    
    const findIndex = (arr: string[], target: string) => {
      const normalizedTarget = normalize(target);
      return arr.findIndex(h => normalize(h) === normalizedTarget);
    };
    
    const group2StartIdx = rawHeaders.findIndex(h => 
      normalize(h) === normalize(priorityGroup2Start)
    );
    const group2EndIdx = rawHeaders.findIndex(h => 
      normalize(h) === normalize(priorityGroup2End)
    );
    
    const idColumn: string[] = [];
    const group1Columns: string[] = [];
    const group2Columns: string[] = [];
    const remainingColumns: string[] = [];
    
    const group1Set = new Set(priorityGroup1.map(normalize));
    
    rawHeaders.forEach((header, idx) => {
      const normalizedHeader = normalize(header);
      
      if (normalizedHeader === 'id') {
        idColumn.push(header);
      } else if (group1Set.has(normalizedHeader)) {
        group1Columns.push(header);
      } else if (group2StartIdx >= 0 && group2EndIdx >= 0 && idx >= group2StartIdx && idx <= group2EndIdx) {
        group2Columns.push(header);
      } else {
        remainingColumns.push(header);
      }
    });
    
    const sortedGroup1 = group1Columns.sort((a, b) => {
      const aIdx = priorityGroup1.findIndex(p => normalize(p) === normalize(a));
      const bIdx = priorityGroup1.findIndex(p => normalize(p) === normalize(b));
      return aIdx - bIdx;
    });
    
    // Add "Imported At" as a special column after ID, and "Submitted in Holman" after Final Approval
    // Insert "__SUBMITTED_IN_HOLMAN__" just after Final Approval columns in sortedGroup1
    const finalApprovalIdx = sortedGroup1.findIndex(h => 
      h.toLowerCase().includes("final_approval") || h.toLowerCase().includes("final approval")
    );
    
    let resultGroup1 = sortedGroup1;
    if (finalApprovalIdx >= 0) {
      resultGroup1 = [
        ...sortedGroup1.slice(0, finalApprovalIdx + 1),
        "__SUBMITTED_IN_HOLMAN__",
        ...sortedGroup1.slice(finalApprovalIdx + 1)
      ];
    } else {
      resultGroup1 = [...sortedGroup1, "__SUBMITTED_IN_HOLMAN__"];
    }
    
    return [...idColumn, "__IMPORTED_AT__", ...resultGroup1, ...group2Columns, ...remainingColumns];
  }, [rawHeaders]);

  const robDecisionOptions = useMemo(() => {
    if (!robDecisionColumnName) return [];
    const values = new Set<string>();
    orders.forEach(order => {
      const val = String(order.rawData?.[robDecisionColumnName] ?? "").trim();
      if (val) values.add(val);
    });
    return Array.from(values).sort();
  }, [orders, robDecisionColumnName]);

  const differenceOptions = useMemo(() => {
    if (!differenceColumnName) return [];
    const values = new Set<string>();
    orders.forEach(order => {
      const val = String(order.rawData?.[differenceColumnName] ?? "").trim();
      if (val) values.add(val);
    });
    return Array.from(values).sort();
  }, [orders, differenceColumnName]);

  const finalApprovalOptions = useMemo(() => {
    const values = new Set<string>();
    orders.forEach(order => {
      const val = (order.finalApproval || "").trim();
      if (val) values.add(val);
    });
    return Array.from(values).sort();
  }, [orders]);

  const shouldWrapColumn = (header: string) => {
    const h = header.toLowerCase();
    return h.includes("final_reccomendation") || 
           h.includes("final_recommendation") ||
           h.includes("final recommendation") ||
           h.includes("rob") ||
           h.includes("difference");
  };

  const isRobColumn = (header: string) => {
    const h = header.toLowerCase();
    return h.includes("rob") && h.includes("unsubmitted");
  };

  const getColumnHighlight = (header: string) => {
    if (isFinalApprovalColumn(header)) {
      return "bg-yellow-100 dark:bg-yellow-900/30";
    }
    if (isRobColumn(header)) {
      return "bg-blue-100 dark:bg-blue-900/30";
    }
    return "";
  };

  const pendingFinalApprovalCount = useMemo(() => {
    return orders.filter(order => !order.finalApproval || order.finalApproval.trim() === "").length;
  }, [orders]);

  const finalApprovalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(order => {
      const value = order.finalApproval?.trim() || "(Pending)";
      counts[value] = (counts[value] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const approvedRepairCount = useMemo(() => {
    return orders.filter(o => {
      const val = (o.finalApproval || "").trim();
      return val === "Proceed with repair (as scoped in approval decision)";
    }).length;
  }, [orders]);

  const declinedSaleCount = useMemo(() => {
    return orders.filter(o => {
      const val = (o.finalApproval || "").trim();
      return val === "Decline and Submit for Sale";
    }).length;
  }, [orders]);

  // Time-based analytics: count approvals by day/week/month
  const timeBasedAnalytics = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const analytics: {
      today: Record<string, number>;
      thisWeek: Record<string, number>;
      thisMonth: Record<string, number>;
    } = {
      today: {},
      thisWeek: {},
      thisMonth: {},
    };

    orders.forEach(order => {
      if (!order.importedAt) return;
      const importDate = new Date(order.importedAt);
      const status = order.finalApproval?.trim() || "(Pending)";

      // Check if imported today
      if (importDate >= today) {
        analytics.today[status] = (analytics.today[status] || 0) + 1;
      }
      
      // Check if imported this week
      if (importDate >= startOfWeek) {
        analytics.thisWeek[status] = (analytics.thisWeek[status] || 0) + 1;
      }
      
      // Check if imported this month
      if (importDate >= startOfMonth) {
        analytics.thisMonth[status] = (analytics.thisMonth[status] || 0) + 1;
      }
    });

    return analytics;
  }, [orders]);

  return (
    <div className="bg-background" data-testid="page-pos">
      <div className="px-4 pt-4">
        <h1 className="text-xl font-semibold mb-2" data-testid="text-page-title">Purchase Orders</h1>
      </div>
      <div className="border-b bg-card px-4">
        <div className="flex items-center gap-1">
          <Button
            variant={activeTab === 'purchase-orders' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('purchase-orders')}
            className="rounded-b-none gap-2"
            data-testid="tab-purchase-orders"
          >
            <Package className="h-4 w-4" />
            Purchase Orders
          </Button>
          <Button
            variant={activeTab === 'po-priority' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('po-priority')}
            className="rounded-b-none gap-2"
            data-testid="tab-po-priority"
          >
            <AlertCircle className="h-4 w-4" />
            PO Priority
          </Button>
        </div>
      </div>

      <main className="p-6">
        {activeTab === 'po-priority' ? (
          <POPriorityView />
        ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-80"
                  data-testid="input-search"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                data-testid="input-file-upload"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || importMutation.isPending}
                className="gap-2"
                data-testid="button-upload"
              >
                {(isUploading || importMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import CSV/XLSX
              </Button>
              <Button
                onClick={handleExportExcel}
                disabled={filteredOrders.length === 0}
                variant="outline"
                className="gap-2"
                data-testid="button-export"
              >
                <Download className="h-4 w-4" />
                Export Excel
              </Button>
              <Button
                onClick={() => syncDeclinedMutation.mutate()}
                disabled={syncDeclinedMutation.isPending}
                variant="outline"
                className="gap-2"
                data-testid="button-sync-declined"
              >
                {syncDeclinedMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync Declined to Dashboard
              </Button>
              <Link href="/fleet-scope/decommissioning">
                <Button variant="outline" className="gap-2" data-testid="button-decommissioning">
                  <Wrench className="h-4 w-4" />
                  Decommissioning
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="repairs-summary-cards">
            <Card className="p-3 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20" data-testid="card-total-pos">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Total POs</span>
              </div>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-total-pos">{orders.length}</p>
              <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                {filteredOrders.length} showing
              </p>
            </Card>
            <Card className="p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20" data-testid="card-pending-approval">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Pending Approval</span>
              </div>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-approval">{pendingFinalApprovalCount}</p>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-0.5">
                awaiting decision
              </p>
            </Card>
            <Card className="p-3 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20" data-testid="card-approved-repair">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700 dark:text-green-300">Approved</span>
              </div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{approvedRepairCount}</p>
              <p className="text-xs text-green-600/70 dark:text-green-400/70 mt-0.5">
                for repair
              </p>
            </Card>
            <Card className="p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20" data-testid="card-declined-sale">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span className="text-xs font-medium text-red-700 dark:text-red-300">Declined</span>
              </div>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{declinedSaleCount}</p>
              <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
                submit for sale
              </p>
            </Card>
            <Card className="p-3 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/20" data-testid="card-last-import">
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet className="w-4 h-4 text-slate-600" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Last Import</span>
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-1" data-testid="text-last-import">
                {poData?.meta?.lastImportedAt 
                  ? new Date(poData.meta.lastImportedAt).toLocaleString()
                  : "No imports"
                }
              </p>
              <p className="text-xs text-slate-600/70 dark:text-slate-400/70 mt-0.5">
                {poData?.meta?.lastImportedBy || ""}
              </p>
            </Card>
          </div>

          {orders.length > 0 && Object.keys(finalApprovalCounts).length > 0 && (
            <Collapsible open={approvalBreakdownOpen} onOpenChange={setApprovalBreakdownOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">In process - Following up</CardTitle>
                      {approvalBreakdownOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(finalApprovalCounts)
                        .filter(([status]) => 
                          status !== "Proceed with repair (as scoped in approval decision)" &&
                          status !== "Decline and Submit for Sale" &&
                          status !== "Actioned intermediary step - New PO will be submitted"
                        )
                        .sort((a, b) => {
                          if (a[0] === "(Pending)") return -1;
                          if (b[0] === "(Pending)") return 1;
                          return b[1] - a[1];
                        })
                        .map(([status, count]) => (
                          <div 
                            key={status} 
                            className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                              status === "(Pending)" 
                                ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800" 
                                : "bg-muted/50"
                            }`}
                            data-testid={`approval-count-${status.replace(/[^a-zA-Z0-9]/g, '-')}`}
                          >
                            <span className={`text-sm ${status === "(Pending)" ? "text-amber-700 dark:text-amber-400" : ""}`}>
                              {status}:
                            </span>
                            <span className={`font-bold ${status === "(Pending)" ? "text-amber-700 dark:text-amber-400" : ""}`}>
                              {count}
                            </span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {orders.length > 0 && (
            <Collapsible open={importsTimePeriodOpen} onOpenChange={setImportsTimePeriodOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Imports by Time Period</CardTitle>
                      {importsTimePeriodOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="border rounded-lg p-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">Running Total</h4>
                        {Object.keys(finalApprovalCounts).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No data</p>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(finalApprovalCounts)
                              .sort(sortByApprovalOrder)
                              .map(([status, count]) => (
                                <div key={status} className="flex justify-between text-sm">
                                  <span className={status === "(Pending)" ? "text-amber-600" : ""}>{status}</span>
                                  <span className="font-medium">{count}</span>
                                </div>
                              ))}
                            <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                              <span>Total</span>
                              <span>{Object.values(finalApprovalCounts).reduce((a, b) => a + b, 0)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="border rounded-lg p-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">This Week</h4>
                        {Object.keys(timeBasedAnalytics.thisWeek).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No imports this week</p>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(timeBasedAnalytics.thisWeek)
                              .sort(sortByApprovalOrder)
                              .map(([status, count]) => (
                                <div key={status} className="flex justify-between text-sm">
                                  <span className={status === "(Pending)" ? "text-amber-600" : ""}>{status}</span>
                                  <span className="font-medium">{count}</span>
                                </div>
                              ))}
                            <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                              <span>Total</span>
                              <span>{Object.values(timeBasedAnalytics.thisWeek).reduce((a, b) => a + b, 0)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="border rounded-lg p-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">This Month</h4>
                        {Object.keys(timeBasedAnalytics.thisMonth).length === 0 ? (
                          <p className="text-sm text-muted-foreground">No imports this month</p>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(timeBasedAnalytics.thisMonth)
                              .sort(sortByApprovalOrder)
                              .map(([status, count]) => (
                                <div key={status} className="flex justify-between text-sm">
                                  <span className={status === "(Pending)" ? "text-amber-600" : ""}>{status}</span>
                                  <span className="font-medium">{count}</span>
                                </div>
                              ))}
                            <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                              <span>Total</span>
                              <span>{Object.values(timeBasedAnalytics.thisMonth).reduce((a, b) => a + b, 0)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          <Card className="flex flex-col min-h-0" style={{ maxHeight: 'calc(100vh - 300px)', minHeight: '400px' }}>
            <CardHeader className="flex-shrink-0 border-b bg-card">
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Imported Data
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-12">
                  <FileUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Data</h3>
                  <p className="text-muted-foreground mb-4">
                    Import a CSV or Excel file to view data
                  </p>
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2"
                    data-testid="button-upload-empty"
                  >
                    <Upload className="h-4 w-4" />
                    Import CSV/XLSX
                  </Button>
                </div>
              ) : (
                <div className="overflow-auto" style={{ scrollbarWidth: 'thin', maxHeight: 'calc(100vh - 420px)' }}>
                  <table className="text-sm min-w-max border-collapse">
                    <thead>
                      <tr>
                          {displayHeaders.map((header, idx) => {
                            if (header === "__IMPORTED_AT__") {
                              return (
                                <th 
                                  key={header} 
                                  className="sticky top-0 z-10 font-semibold px-2 py-2 whitespace-nowrap bg-green-100 dark:bg-green-900/30 text-left border-b"
                                >
                                  Imported At
                                </th>
                              );
                            }
                            
                            if (header === "__SUBMITTED_IN_HOLMAN__") {
                              return (
                                <th 
                                  key={header} 
                                  className="sticky top-0 z-10 font-semibold px-2 py-2 whitespace-nowrap bg-purple-100 dark:bg-purple-900/30 text-left border-b"
                                >
                                  <div className="flex flex-col gap-1">
                                    <span>Submitted in Holman</span>
                                    <Select value={submittedHolmanFilter} onValueChange={setSubmittedHolmanFilter}>
                                      <SelectTrigger className="h-6 text-xs w-full min-w-[100px]" data-testid="filter-submitted-holman">
                                        <SelectValue placeholder="All" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">All</SelectItem>
                                        <SelectItem value="__blank__">(Pending/Blank)</SelectItem>
                                        <SelectItem value="Yes">Yes</SelectItem>
                                        <SelectItem value="No">No</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </th>
                              );
                            }
                            
                            const currentRequestedIdx = displayHeaders.findIndex(h => 
                              h.toLowerCase().includes("current") && h.toLowerCase().includes("requested")
                            );
                            const isAfterCurrentRequested = currentRequestedIdx >= 0 && idx > currentRequestedIdx;
                            const wrapThis = isAfterCurrentRequested || shouldWrapColumn(header);
                            const highlight = getColumnHighlight(header);
                            const bgClass = highlight || "bg-muted";
                            
                            const isFilterableRobDecision = isRobDecisionColumn(header);
                            const isFilterableDifference = isDifferenceColumn(header);
                            const isFilterableFinalApproval = isFinalApprovalColumn(header);
                            const isFilterableVehicleNo = isVehicleNoColumn(header);
                            const isFilterableSpareVan = isSpareVanColumn(header);
                            
                            return (
                              <th 
                                key={header} 
                                className={`sticky top-0 z-10 font-semibold px-2 py-2 text-left border-b ${wrapThis ? 'max-w-[200px]' : 'whitespace-nowrap'} ${bgClass}`}
                              >
                                <div className="flex flex-col gap-1">
                                  <span>{header}</span>
                                  {isFilterableVehicleNo && (
                                    <Input
                                      type="text"
                                      placeholder="Search..."
                                      value={vehicleNoFilter}
                                      onChange={(e) => setVehicleNoFilter(e.target.value)}
                                      className="h-6 text-xs w-full min-w-[100px]"
                                      data-testid="filter-vehicle-no"
                                    />
                                  )}
                                  {isFilterableSpareVan && (
                                    <Select value={spareVanFilter} onValueChange={setSpareVanFilter}>
                                      <SelectTrigger className="h-6 text-xs w-full min-w-[80px]" data-testid="filter-spare-van">
                                        <SelectValue placeholder="All" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">All</SelectItem>
                                        <SelectItem value="yes">Yes</SelectItem>
                                        <SelectItem value="__blank__">(Blank)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {isFilterableRobDecision && (
                                    <Select value={robDecisionFilter} onValueChange={setRobDecisionFilter}>
                                      <SelectTrigger className="h-6 text-xs w-full min-w-[120px]" data-testid="filter-rob-decision">
                                        <SelectValue placeholder="All" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">All</SelectItem>
                                        <SelectItem value="__blank__">(Blank)</SelectItem>
                                        {robDecisionOptions.map(opt => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {isFilterableDifference && (
                                    <Select value={differenceFilter} onValueChange={setDifferenceFilter}>
                                      <SelectTrigger className="h-6 text-xs w-full min-w-[120px]" data-testid="filter-difference">
                                        <SelectValue placeholder="All" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">All</SelectItem>
                                        <SelectItem value="__blank__">(Blank)</SelectItem>
                                        {differenceOptions.map(opt => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  {isFilterableFinalApproval && (
                                    <Select value={finalApprovalFilter} onValueChange={setFinalApprovalFilter}>
                                      <SelectTrigger className="h-6 text-xs w-full min-w-[120px]" data-testid="filter-final-approval">
                                        <SelectValue placeholder="All" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="__all__">All</SelectItem>
                                        <SelectItem value="__blank__">(Pending/Blank)</SelectItem>
                                        {finalApprovalOptions.map(opt => (
                                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((order, idx) => (
                        <tr key={order.id || idx} data-testid={`row-po-${idx}`} className="border-b hover:bg-muted/50">
                          {displayHeaders.map((header, colIdx) => {
                            // Handle special "__IMPORTED_AT__" column
                            if (header === "__IMPORTED_AT__") {
                              const importedAt = order.importedAt ? new Date(order.importedAt) : null;
                              const formattedDate = importedAt 
                                ? importedAt.toLocaleDateString('en-US', { 
                                    month: '2-digit', 
                                    day: '2-digit', 
                                    year: 'numeric' 
                                  })
                                : "";
                              return (
                                <td 
                                  key={header} 
                                  className="px-2 py-1.5 whitespace-nowrap bg-green-50 dark:bg-green-900/20"
                                >
                                  {formattedDate}
                                </td>
                              );
                            }
                            
                            // Handle special "__SUBMITTED_IN_HOLMAN__" column
                            if (header === "__SUBMITTED_IN_HOLMAN__") {
                              return (
                                <td 
                                  key={header} 
                                  className="px-2 py-1.5 whitespace-nowrap bg-purple-50 dark:bg-purple-900/20"
                                >
                                  <SubmittedInHolmanCell order={order} />
                                </td>
                              );
                            }
                            
                            const currentRequestedIdx = displayHeaders.findIndex(h => 
                              h.toLowerCase().includes("current") && h.toLowerCase().includes("requested")
                            );
                            const isAfterCurrentRequested = currentRequestedIdx >= 0 && colIdx > currentRequestedIdx;
                            const wrapThis = isAfterCurrentRequested || shouldWrapColumn(header);
                            const highlight = getColumnHighlight(header);
                            
                            if (isFinalApprovalColumn(header)) {
                              return (
                                <td 
                                  key={header} 
                                  className={`px-2 py-1.5 ${highlight}`}
                                >
                                  <FinalApprovalCell order={order} options={approvalOptions} />
                                </td>
                              );
                            }
                            
                            return (
                              <td 
                                key={header} 
                                className={`px-2 py-1.5 ${wrapThis ? 'max-w-[200px]' : 'whitespace-nowrap'} ${highlight}`}
                              >
                                {String(order.rawData?.[header] ?? "")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </main>

      <Dialog open={showColumnDialog} onOpenChange={setShowColumnDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select PO Number Column</DialogTitle>
            <DialogDescription>
              Choose which column identifies each record (used to preserve Final Approval values when re-importing).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedPoColumn} onValueChange={setSelectedPoColumn}>
              <SelectTrigger data-testid="select-po-column">
                <SelectValue placeholder="Select identifier column..." />
              </SelectTrigger>
              <SelectContent>
                {pendingImport?.headers.map((header) => (
                  <SelectItem key={header} value={header}>
                    {header}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pendingImport && (
              <p className="mt-2 text-sm text-muted-foreground">
                Found {pendingImport.rows.length} rows in {pendingImport.filename}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowColumnDialog(false);
                setPendingImport(null);
                setSelectedPoColumn("");
              }}
              data-testid="button-cancel-import"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmImport}
              disabled={!selectedPoColumn || importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
