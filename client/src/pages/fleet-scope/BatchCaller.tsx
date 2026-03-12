import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Phone,
  PhoneCall,
  Loader2,
  Search,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  PhoneOff,
  Filter,
  ChevronDown,
} from "lucide-react";
import type { Truck, CallLog, MainStatus } from "@shared/fleet-scope-schema";
import { MAIN_STATUSES } from "@shared/fleet-scope-schema";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";

const mainStatusColors: Record<string, string> = {
  "Confirming Status": "bg-status-amber text-status-amber-fg",
  "Decision Pending": "bg-status-red text-status-red-fg",
  "Repairing": "bg-status-amber text-status-amber-fg",
  "Declined Repair": "bg-status-red text-status-red-fg",
  "Approved for sale": "bg-status-amber text-status-amber-fg",
  "Tags": "bg-status-amber text-status-amber-fg",
  "Scheduling": "bg-status-green text-status-green-fg",
  "PMF": "bg-status-amber text-status-amber-fg",
  "In Transit": "bg-status-green text-status-green-fg",
  "On Road": "bg-status-green text-status-green-fg",
  "Needs truck assigned": "bg-status-amber text-status-amber-fg",
  "Available to be assigned": "bg-status-green text-status-green-fg",
  "Relocate Van": "bg-status-amber text-status-amber-fg",
  "NLWC - Return Rental": "bg-status-red text-status-red-fg",
  "Truck Swap": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
};

type BatchResult = {
  truckId: string;
  truckNumber: string;
  status: string;
  conversationId?: string;
  error?: string;
};

type BatchStatus = {
  id: string;
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  cancelled: boolean;
  results: BatchResult[];
  done: boolean;
};

export default function BatchCaller() {
  const { toast } = useToast();
  const [callType, setCallType] = useState<"shop" | "tech">("shop");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const { data: trucks = [], isLoading: trucksLoading } = useQuery<Truck[]>({
    queryKey: ["/api/fs/trucks"],
  });

  const { data: followUps = [], isLoading: followUpsLoading } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/follow-ups"],
    refetchInterval: 60000,
  });

  const { data: recentLogs = [] } = useQuery<CallLog[]>({
    queryKey: ["/api/fs/call-logs"],
    refetchInterval: activeBatchId ? 5000 : 30000,
  });

  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>();
    trucks.forEach((t) => {
      if (t.mainStatus) statuses.add(t.mainStatus);
    });
    return Array.from(statuses).sort();
  }, [trucks]);

  const filteredTrucks = useMemo(() => {
    let result = trucks.filter((t) => {
      const hasPhone = callType === "tech" ? t.techPhone?.trim() : t.repairPhone?.trim();
      return !!hasPhone;
    });

    if (selectedStatuses.size > 0) {
      result = result.filter((t) => t.mainStatus && selectedStatuses.has(t.mainStatus));
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (t) =>
          t.truckNumber?.toLowerCase().includes(term) ||
          t.repairAddress?.toLowerCase().includes(term) ||
          t.techName?.toLowerCase().includes(term)
      );
    }

    return result;
  }, [trucks, selectedStatuses, callType, searchTerm]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredTrucks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTrucks.map((t) => t.id)));
    }
  };

  const startBatch = async () => {
    if (selectedIds.size === 0) {
      toast({ title: "No vehicles selected", variant: "destructive" });
      return;
    }
    setIsStarting(true);
    try {
      const res = await apiRequest("POST", "/api/fs/batch-call/start", {
        truckIds: Array.from(selectedIds),
        callType,
      });
      const data = await res.json();
      setActiveBatchId(data.batchId);
      toast({ title: `Batch started: ${data.total} calls queued` });
      pollBatch(data.batchId);
    } catch (err: any) {
      toast({ title: "Failed to start batch", description: err.message, variant: "destructive" });
    } finally {
      setIsStarting(false);
    }
  };

  const pollBatch = async (batchId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/fs/batch-call/status/${batchId}`);
        const status: BatchStatus = await res.json();
        setBatchStatus(status);
        if (!status.done) {
          setTimeout(poll, 3000);
        } else {
          setActiveBatchId(null);
          toast({ title: `Batch complete: ${status.completed} called, ${status.failed} failed` });
        }
      } catch {
        setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const cancelBatch = async () => {
    if (!activeBatchId) return;
    try {
      await apiRequest("POST", `/api/fs/batch-call/cancel/${activeBatchId}`);
      toast({ title: "Batch cancelled" });
    } catch (err: any) {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    }
  };

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) return null;
    switch (outcome) {
      case "VEHICLE_READY":
        return <Badge variant="default" className="bg-green-600 text-white no-default-hover-elevate"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
      case "VEHICLE_NOT_READY":
        return <Badge variant="default" className="bg-yellow-600 text-white no-default-hover-elevate"><Clock className="w-3 h-3 mr-1" />Not Ready</Badge>;
      case "CALL_FAILED":
        return <Badge variant="default" className="bg-red-600 text-white no-default-hover-elevate"><PhoneOff className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="secondary">{outcome}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Phone className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-semibold" data-testid="text-batch-caller-title">Batch Caller</h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">Vehicle Selection</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={callType} onValueChange={(v: string) => { setCallType(v as "shop" | "tech"); setSelectedIds(new Set()); }}>
              <SelectTrigger className="w-[140px]" data-testid="select-call-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shop">Call Shops</SelectItem>
                <SelectItem value="tech">Call Techs</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-between" data-testid="button-status-filter">
                  <span className="flex items-center gap-1.5 truncate">
                    <Filter className="h-3.5 w-3.5 shrink-0" />
                    {selectedStatuses.size === 0
                      ? "All Statuses"
                      : `${selectedStatuses.size} status${selectedStatuses.size > 1 ? "es" : ""}`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[220px] p-2" align="start">
                <div className="flex flex-col gap-0.5 max-h-[280px] overflow-auto">
                  {availableStatuses.map((s) => {
                    const colorClass = mainStatusColors[s] || "bg-muted text-muted-foreground";
                    return (
                      <label
                        key={s}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate cursor-pointer text-sm"
                        data-testid={`filter-status-${s}`}
                      >
                        <Checkbox
                          checked={selectedStatuses.has(s)}
                          onCheckedChange={() => {
                            setSelectedStatuses((prev) => {
                              const next = new Set(prev);
                              if (next.has(s)) next.delete(s);
                              else next.add(s);
                              return next;
                            });
                          }}
                        />
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass} border-0 whitespace-nowrap`}>
                          {s}
                        </span>
                      </label>
                    );
                  })}
                  {selectedStatuses.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full text-xs"
                      onClick={() => setSelectedStatuses(new Set())}
                      data-testid="button-clear-statuses"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[200px]"
                data-testid="input-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trucksLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTrucks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No vehicles with {callType === "shop" ? "shop" : "tech"} phone numbers found
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <span className="text-sm text-muted-foreground">
                  {filteredTrucks.length} vehicles · {selectedIds.size} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAll} data-testid="button-select-all">
                    {selectedIds.size === filteredTrucks.length ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={startBatch}
                    disabled={selectedIds.size === 0 || isStarting || !!activeBatchId}
                    data-testid="button-start-calling"
                  >
                    {isStarting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PhoneCall className="h-4 w-4 mr-1" />}
                    Start Calling ({selectedIds.size})
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === filteredTrucks.length && filteredTrucks.length > 0}
                          onCheckedChange={toggleAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead>Truck #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{callType === "shop" ? "Shop / Address" : "Tech"}</TableHead>
                      <TableHead>Phone</TableHead>
                      {callType === "tech" && <TableHead>Shop Call Result</TableHead>}
                      <TableHead>Last Call</TableHead>
                      <TableHead>Last Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTrucks.map((truck) => {
                      const phone = callType === "shop" ? truck.repairPhone : truck.techPhone;
                      const name = callType === "shop" ? (truck.repairAddress || "—") : truck.techName;
                      const lastStatus = callType === "shop" ? truck.lastCallStatus : truck.lastTechCallStatus;
                      const lastDate = callType === "shop" ? truck.lastCallDate : truck.lastTechCallDate;

                      return (
                        <TableRow
                          key={truck.id}
                          className="cursor-pointer"
                          onClick={() => toggleSelect(truck.id)}
                          data-testid={`row-truck-${truck.truckNumber}`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(truck.id)}
                              onCheckedChange={() => toggleSelect(truck.id)}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`checkbox-truck-${truck.truckNumber}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{truck.truckNumber}</TableCell>
                          <TableCell>
                            <StatusBadge status={truck.mainStatus || "Unknown"} mainStatus={truck.mainStatus} />
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{name || "—"}</TableCell>
                          <TableCell className="text-sm">{phone || "—"}</TableCell>
                          {callType === "tech" && (
                            <TableCell>
                              {truck.lastCallStatus ? (
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    truck.lastCallStatus === "Ready"
                                      ? "bg-green-600/15 text-green-700 dark:text-green-400"
                                      : truck.lastCallStatus === "No Answer" || truck.lastCallStatus === "Call Failed" || truck.lastCallStatus === "Failed"
                                      ? "bg-red-600/15 text-red-700 dark:text-red-400"
                                      : "bg-yellow-600/15 text-yellow-700 dark:text-yellow-400"
                                  }`}
                                >
                                  {truck.lastCallStatus}
                                </Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            {lastDate ? new Date(lastDate).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>
                            {lastStatus ? (
                              <Badge
                                variant="secondary"
                                className={`text-xs ${
                                  lastStatus === "Ready" || lastStatus === "Will Pick Up"
                                    ? "bg-green-600/15 text-green-700 dark:text-green-400"
                                    : lastStatus === "No Answer" || lastStatus === "Call Failed" || lastStatus === "Failed"
                                    ? "bg-red-600/15 text-red-700 dark:text-red-400"
                                    : "bg-yellow-600/15 text-yellow-700 dark:text-yellow-400"
                                }`}
                              >
                                {lastStatus}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {(activeBatchId || batchStatus) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneCall className="h-4 w-4" />
              Batch Progress
              {activeBatchId && <Loader2 className="h-4 w-4 animate-spin" />}
            </CardTitle>
            {activeBatchId && (
              <Button variant="destructive" size="sm" onClick={cancelBatch} data-testid="button-cancel-batch">
                <XCircle className="h-4 w-4 mr-1" />Cancel
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {batchStatus && (
              <>
                <div className="flex items-center gap-4 mb-3 flex-wrap">
                  <div className="flex items-center gap-1 text-sm">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-medium">{batchStatus.total}</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    <span>{batchStatus.completed} called</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span>{batchStatus.failed} failed</span>
                  </div>
                  {batchStatus.inProgress > 0 && (
                    <div className="flex items-center gap-1 text-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{batchStatus.inProgress} in progress</span>
                    </div>
                  )}
                  {batchStatus.done && (
                    <Badge variant="secondary" className="bg-green-600/15 text-green-700 dark:text-green-400">Complete</Badge>
                  )}
                </div>

                <div className="w-full bg-muted rounded-full h-2 mb-4">
                  <div
                    className="bg-primary rounded-full h-2 transition-all"
                    style={{ width: `${((batchStatus.completed + batchStatus.failed) / batchStatus.total) * 100}%` }}
                  />
                </div>

                {batchStatus.results.length > 0 && (
                  <div className="border rounded-md overflow-auto max-h-[250px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Truck #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {batchStatus.results.map((r, i) => (
                          <TableRow key={i} data-testid={`row-result-${r.truckNumber}`}>
                            <TableCell className="font-medium">{r.truckNumber}</TableCell>
                            <TableCell>
                              {r.status === "in_progress" ? (
                                <Badge variant="secondary" className="bg-blue-600/15 text-blue-700 dark:text-blue-400">
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />Calling
                                </Badge>
                              ) : r.status === "failed" ? (
                                <Badge variant="secondary" className="bg-red-600/15 text-red-700 dark:text-red-400">
                                  <XCircle className="h-3 w-3 mr-1" />Failed
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-green-600/15 text-green-700 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3 mr-1" />Sent
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {r.error || (r.conversationId ? `ID: ${r.conversationId.slice(0, 12)}...` : "—")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending Follow-Ups
            {followUps.length > 0 && (
              <Badge variant="secondary" className="bg-yellow-600/15 text-yellow-700 dark:text-yellow-400">
                {followUps.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {followUpsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : followUps.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No pending follow-ups
            </div>
          ) : (
            <div className="border rounded-md overflow-auto max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Truck #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Last Outcome</TableHead>
                    <TableHead>Follow-Up Date</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {followUps.map((log) => (
                    <TableRow key={log.id} data-testid={`row-followup-${log.truckNumber}`}>
                      <TableCell className="font-medium">{log.truckNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{log.callType}</Badge>
                      </TableCell>
                      <TableCell>{getOutcomeBadge(log.outcome)}</TableCell>
                      <TableCell className="text-sm">{log.nextFollowUpDate || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                        {log.shopNotes || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {recentLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Recent Call Logs
              <Badge variant="secondary">{recentLogs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-auto max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Truck #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLogs.slice(0, 50).map((log) => (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {log.callTimestamp ? new Date(log.callTimestamp).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{log.truckNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{log.callType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.phoneNumber || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            log.status === "completed"
                              ? "bg-green-600/15 text-green-700 dark:text-green-400"
                              : log.status === "failed"
                              ? "bg-red-600/15 text-red-700 dark:text-red-400"
                              : "bg-blue-600/15 text-blue-700 dark:text-blue-400"
                          }`}
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{getOutcomeBadge(log.outcome)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[250px] truncate">
                        {log.shopNotes || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
