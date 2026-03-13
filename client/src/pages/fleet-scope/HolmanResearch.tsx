import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { type Truck, getCombinedStatus, MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";

import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { StatusReminder, useStatusReminder } from "@/components/fleet-scope/StatusReminder";
import { useUser } from "@/context/FleetScopeUserContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ArrowLeft,
  Search,
  Building2,
  TruckIcon,
  ExternalLink,
  Calendar,
  MapPin,
  AlertCircle,
  BarChart3,
  Check,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function HolmanResearch() {
  const { currentUser } = useUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCell, setEditingCell] = useState<{truckId: string; field: string} | null>(null);
  const [editValue, setEditValue] = useState("");
  const { toast } = useToast();
  
  // Status change reminder
  const { showReminder, hideReminder, shouldShowReminder } = useStatusReminder();

  const { data: trucks, isLoading, error } = useQuery<Truck[]>({
    queryKey: ["/api/fs/trucks"],
  });

  const holmanTrucks = useMemo(() => {
    if (!trucks) return [];
    
    return trucks.filter(truck => 
      truck.mainStatus === "Confirming Status" && 
      truck.subStatus === "Holman Confirming"
    ).sort((a, b) => {
      const dateA = a.datePutInRepair ? new Date(a.datePutInRepair).getTime() : Infinity;
      const dateB = b.datePutInRepair ? new Date(b.datePutInRepair).getTime() : Infinity;
      return dateA - dateB;
    });
  }, [trucks]);

  const filteredTrucks = useMemo(() => {
    if (!searchQuery.trim()) return holmanTrucks;
    
    const query = searchQuery.toLowerCase();
    return holmanTrucks.filter(truck => 
      truck.truckNumber?.toLowerCase().includes(query) ||
      truck.techName?.toLowerCase().includes(query) ||
      truck.repairAddress?.toLowerCase().includes(query)
    );
  }, [holmanTrucks, searchQuery]);

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "—";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Generalized inline edit mutation
  const inlineEditMutation = useMutation({
    mutationFn: async ({ truckId, updates }: { truckId: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { 
        ...updates,
        lastUpdatedBy: currentUser || "User"
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setEditingCell(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update truck",
        variant: "destructive",
      });
    },
  });

  const startEditing = (truckId: string, field: string, currentValue: any) => {
    setEditingCell({ truckId, field });
    setEditValue(currentValue === null || currentValue === undefined ? "" : String(currentValue));
  };

  const saveEdit = (truckId: string, field: string, value: any) => {
    inlineEditMutation.mutate({ truckId, updates: { [field]: value } });
    // Show reminder for non-status field changes
    if (field !== "mainStatus" && field !== "subStatus") {
      showReminder(truckId);
    } else {
      hideReminder(truckId);
    }
  };

  const handleBooleanChange = (truckId: string, field: string, value: string) => {
    let boolValue: boolean | null = null;
    if (value === "true") boolValue = true;
    else if (value === "false") boolValue = false;
    saveEdit(truckId, field, boolValue);
  };

  const handleTextSave = (truckId: string, field: string) => {
    saveEdit(truckId, field, editValue.trim() || null);
    setEditingCell(null);
  };

  const handleStatusChange = (truckId: string, newMainStatus: string, currentSubStatus: string | null) => {
    const validSubs = SUB_STATUSES[newMainStatus as MainStatus] || [];
    const newSubStatus = validSubs.includes(currentSubStatus || "") ? currentSubStatus : null;
    
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { mainStatus: newMainStatus, subStatus: newSubStatus }
    });
    hideReminder(truckId);
  };

  const handleSubStatusChange = (truckId: string, mainStatus: string, newSubStatus: string) => {
    inlineEditMutation.mutate({ 
      truckId, 
      updates: { mainStatus, subStatus: newSubStatus === "_none_" ? null : newSubStatus } 
    });
    hideReminder(truckId);
  };

  if (isLoading) {
    return (
      <div className="bg-background">
        <main className="container mx-auto px-4 py-6">
          <Skeleton className="h-32 w-full mb-6" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background">
        <main className="container mx-auto px-4 py-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load trucks. Please try again later.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <main className="container mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-6" data-testid="text-page-title">Holman Research</h1>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Holman Research</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {holmanTrucks.length} vehicle{holmanTrucks.length !== 1 ? 's' : ''} awaiting research from Holman
                  </p>
                </div>
              </div>
              <div className="relative w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by unit, VIN, tech..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-holman"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredTrucks.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  {searchQuery ? "No matching vehicles found" : "No vehicles currently with Holman"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery 
                    ? "Try adjusting your search criteria" 
                    : "When vehicles are sent to Holman for research, they will appear here"
                  }
                </p>
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Truck #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tech Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Date In Repair</TableHead>
                      <TableHead className="text-center">Reg. Sticker</TableHead>
                      <TableHead className="text-center">Completed</TableHead>
                      <TableHead className="text-center">AMS</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTrucks.map((truck, index) => (
                      <TableRow key={truck.id} data-testid={`row-holman-truck-${truck.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <TruckIcon className="w-4 h-4 text-muted-foreground" />
                            {truck.truckNumber || "—"}
                          </div>
                        </TableCell>
                        {/* Status column with inline editing */}
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <div className="flex flex-col gap-1">
                              <Select
                                value={truck.mainStatus || ""}
                                onValueChange={(value) => handleStatusChange(truck.id, value, truck.subStatus)}
                              >
                                <SelectTrigger className="h-auto p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 [&>svg]:hidden" data-testid={`select-status-${index}`}>
                                  <StatusBadge 
                                    status={getCombinedStatus(truck.mainStatus || "", truck.subStatus)} 
                                    mainStatus={truck.mainStatus}
                                    subStatus={truck.subStatus}
                                    showSubStatusOnly={false}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {MAIN_STATUSES.map((status) => (
                                    <SelectItem key={status} value={status}>{status}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {truck.mainStatus && SUB_STATUSES[truck.mainStatus as MainStatus]?.length > 0 && (
                                <Select
                                  value={truck.subStatus || "_none_"}
                                  onValueChange={(value) => handleSubStatusChange(truck.id, truck.mainStatus || "", value)}
                                >
                                  <SelectTrigger className="h-6 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto max-w-[180px] [&>svg]:hidden" data-testid={`select-substatus-${index}`}>
                                    <SelectValue>{truck.subStatus || "No sub-status"}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_none_">No sub-status</SelectItem>
                                    {SUB_STATUSES[truck.mainStatus as MainStatus]?.map((sub) => (
                                      <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                            <StatusReminder 
                              show={shouldShowReminder(truck.id)} 
                              onDismiss={() => hideReminder(truck.id)}
                              position="inline"
                            />
                          </div>
                        </TableCell>
                        <TableCell>{truck.techName || "—"}</TableCell>
                        {/* Location column with inline editing */}
                        <TableCell>
                          {editingCell?.truckId === truck.id && editingCell?.field === "repairAddress" ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleTextSave(truck.id, "repairAddress");
                                  if (e.key === "Escape") setEditingCell(null);
                                }}
                                onBlur={() => handleTextSave(truck.id, "repairAddress")}
                                className="h-7 text-sm min-w-[200px]"
                                autoFocus
                                placeholder="Enter location..."
                                data-testid={`input-location-${truck.id}`}
                              />
                              {inlineEditMutation.isPending && (
                                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              )}
                            </div>
                          ) : (
                            <div 
                              className="flex items-center gap-1 text-sm cursor-pointer hover:bg-muted/50 px-2 py-1 rounded -mx-2 -my-1"
                              onClick={() => startEditing(truck.id, "repairAddress", truck.repairAddress)}
                              data-testid={`edit-location-${truck.id}`}
                            >
                              <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              <span className={truck.repairAddress ? "" : "text-muted-foreground italic"}>
                                {truck.repairAddress || "Click to add location"}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        {/* Date In Repair column with inline editing */}
                        <TableCell>
                          {editingCell?.truckId === truck.id && editingCell?.field === "datePutInRepair" ? (
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => handleTextSave(truck.id, "datePutInRepair")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleTextSave(truck.id, "datePutInRepair");
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              className="h-7 text-sm px-1 w-24"
                              autoFocus
                              data-testid={`input-date-in-repair-${index}`}
                            />
                          ) : (
                            <span 
                              className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-muted-foreground"
                              onClick={() => startEditing(truck.id, "datePutInRepair", truck.datePutInRepair)}
                              data-testid={`edit-date-in-repair-${index}`}
                            >
                              {truck.datePutInRepair || "—"}
                            </span>
                          )}
                        </TableCell>
                        {/* Reg. Sticker column with inline editing */}
                        <TableCell className="text-center">
                          <Select
                            value={truck.registrationStickerValid || "_blank_"}
                            onValueChange={(value) => saveEdit(truck.id, "registrationStickerValid", value === "_blank_" ? null : value)}
                          >
                            <SelectTrigger className="h-7 text-xs px-1 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 w-auto min-w-[60px] [&>svg]:hidden" data-testid={`select-reg-sticker-${index}`}>
                              <SelectValue>{truck.registrationStickerValid || "—"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_blank_">—</SelectItem>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="Expired">Expired</SelectItem>
                              <SelectItem value="Shop would not check">Shop would not check</SelectItem>
                              <SelectItem value="Mailed Tag">Mailed Tag</SelectItem>
                              <SelectItem value="Contacted tech">Contacted tech</SelectItem>
                              <SelectItem value="Ordered duplicates">Ordered duplicates</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        {/* Completed column with inline editing */}
                        <TableCell className="text-center">
                          <Select
                            value={truck.repairCompleted === true ? "true" : truck.repairCompleted === false ? "false" : "_blank_"}
                            onValueChange={(value) => handleBooleanChange(truck.id, "repairCompleted", value)}
                          >
                            <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-completed-${index}`}>
                              {truck.repairCompleted === true ? (
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                              ) : (
                                <span className="text-muted-foreground">&nbsp;</span>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_blank_">—</SelectItem>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        {/* AMS column with inline editing */}
                        <TableCell className="text-center">
                          <Select
                            value={truck.inAms === true ? "true" : truck.inAms === false ? "false" : "_blank_"}
                            onValueChange={(value) => handleBooleanChange(truck.id, "inAms", value)}
                          >
                            <SelectTrigger className="h-7 w-12 p-0 border-0 bg-transparent shadow-none hover:bg-muted/50 focus:ring-0 justify-center [&>svg]:hidden" data-testid={`select-ams-${index}`}>
                              {truck.inAms === true ? (
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[10px] font-bold pt-px">Y</span>
                              ) : (
                                <span className="text-muted-foreground">&nbsp;</span>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_blank_">—</SelectItem>
                              <SelectItem value="true">Yes</SelectItem>
                              <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/fleet-scope/trucks/${truck.id}`}>
                            <Button variant="ghost" size="sm" data-testid={`button-view-${truck.id}`}>
                              <ExternalLink className="w-4 h-4 mr-1" />
                              View Details
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">About Holman Research</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              When SHS cannot locate or confirm status of a vehicle, it may be sent to Holman for research. 
              Holman has access to additional vehicle tracking systems and can help determine:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Current vehicle location</li>
              <li>Registration and title status</li>
              <li>Lease/ownership details</li>
              <li>Vehicle history and disposition</li>
            </ul>
            <p className="mt-3">
              Once Holman provides the research results, update the vehicle status to move it to the next workflow stage.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
