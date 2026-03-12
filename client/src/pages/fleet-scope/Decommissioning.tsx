import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, Search, Trash2, Loader2, FileSpreadsheet, RefreshCw, Download } from "lucide-react";
import * as XLSX from "xlsx";

interface DecommissioningVehicle {
  id: number;
  truckNumber: string;
  vin: string | null;
  address: string | null;
  zipCode: string | null;
  phone: string | null;
  comments: string | null;
  stillNotSold: boolean;
  // Persisted tech data from Snowflake
  enterpriseId: string | null;
  fullName: string | null;
  mobilePhone: string | null;
  primaryZip: string | null;
  managerEntId: string | null;
  managerName: string | null;
  managerZip: string | null;
  // Distance calculations
  managerDistance: number | null;
  lastManagerZipForDistance: string | null;
  techDistance: number | null;
  lastTechZipForDistance: string | null;
  decomDone: boolean;
  sentToProcurement: boolean;
  techMatchSource: string | null; // 'truck' for direct match, 'manager_zip_fallback' for nearest manager ZIP match
  isAssigned: boolean; // Whether truck # is currently found in TPMS_EXTRACT
  withRental: boolean; // Whether truck # exists in Rentals Dashboard
  partsCount: number | null; // Sum of ON_HAND from NTAO_FIELD_VIEW_ASSORTMENT
  partsSpace: number | null; // CURRENT_TRUCK_CUFT from NTAO_FIELD_VIEW_ASSORTMENT
  partsCountSyncedAt: string | null;
  techDataSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function Decommissioning() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pasteData, setPasteData] = useState("");
  const [editingCell, setEditingCell] = useState<{ id: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Column filters
  const [dateFilter, setDateFilter] = useState<string>("");
  const [techDistanceFilter, setTechDistanceFilter] = useState<boolean>(false);
  const [managerDistanceFilter, setManagerDistanceFilter] = useState<boolean>(false);
  const [assignedFilter, setAssignedFilter] = useState<string>("all"); // "all", "yes", "no"

  const { data: vehicles = [], isLoading } = useQuery<DecommissioningVehicle[]>({
    queryKey: ["/api/fs/decommissioning"],
  });

  // Sync tech data from Snowflake
  const syncTechDataMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/fs/decommissioning/sync-tech-data");
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: "Tech Data Synced",
        description: `Updated: ${result.synced}, Preserved: ${result.preserved}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync tech data from Snowflake",
        variant: "destructive",
      });
    },
  });

  // Sync parts count from Snowflake
  const syncPartsCountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/fs/decommissioning/sync-parts-count");
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: "Parts Count Synced",
        description: `Updated: ${result.synced} of ${result.total} vehicles`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync parts count from Snowflake",
        variant: "destructive",
      });
    },
  });

  // Sync from POs with "Decline and Submit for Sale"
  const syncFromPOsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/fs/decommissioning/sync-from-pos");
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: "Synced from POs",
        description: `Added: ${result.added}, Already exists: ${result.alreadyExists}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync from POs",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<DecommissioningVehicle> }) => {
      return apiRequest("PATCH", `/api/decommissioning/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update vehicle",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/decommissioning/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: "Success",
        description: "Vehicle removed from decommissioning list",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete vehicle",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any[]) => {
      return apiRequest("POST", "/api/fs/decommissioning/import", { data });
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/decommissioning"] });
      toast({
        title: "Import Complete",
        description: `Inserted: ${result.inserted}, Updated: ${result.updated}`,
      });
      setImportDialogOpen(false);
      setPasteData("");
    },
    onError: (error: any) => {
      toast({
        title: "Import Error",
        description: error.message || "Failed to import data",
        variant: "destructive",
      });
    },
  });

  const handleImport = () => {
    if (!pasteData.trim()) {
      toast({
        title: "Error",
        description: "Please paste data to import",
        variant: "destructive",
      });
      return;
    }

    const lines = pasteData.trim().split("\n");
    if (lines.length < 2) {
      toast({
        title: "Error",
        description: "Data must have a header row and at least one data row",
        variant: "destructive",
      });
      return;
    }

    const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());
    const truckColIndex = headers.findIndex((h) => h.includes("truck") || h === "#");
    const addressColIndex = headers.findIndex((h) => h.includes("address") || h.includes("repair shop"));
    const zipColIndex = headers.findIndex((h) => h.includes("zip"));
    const phoneColIndex = headers.findIndex((h) => h.includes("phone"));
    const commentsColIndex = headers.findIndex((h) => h.includes("comment"));
    const stillNotSoldColIndex = headers.findIndex((h) => h.includes("still") || h.includes("sold"));

    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      const truckNumber = cols[truckColIndex >= 0 ? truckColIndex : 0]?.trim();
      
      if (!truckNumber) continue;

      data.push({
        truckNumber,
        address: addressColIndex >= 0 ? cols[addressColIndex]?.trim() || null : null,
        zipCode: zipColIndex >= 0 ? cols[zipColIndex]?.trim() || null : null,
        phone: phoneColIndex >= 0 ? cols[phoneColIndex]?.trim() || null : null,
        comments: commentsColIndex >= 0 ? cols[commentsColIndex]?.trim() || null : null,
        stillNotSold: stillNotSoldColIndex >= 0 ? cols[stillNotSoldColIndex]?.trim() : "Yes",
      });
    }

    if (data.length === 0) {
      toast({
        title: "Error",
        description: "No valid data rows found",
        variant: "destructive",
      });
      return;
    }

    importMutation.mutate(data);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        if (jsonData.length < 2) {
          toast({
            title: "Error",
            description: "File must have a header row and at least one data row",
            variant: "destructive",
          });
          return;
        }

        const headers = jsonData[0].map((h: any) => String(h || "").toLowerCase().trim());
        const truckColIndex = headers.findIndex((h: string) => h.includes("truck") || h === "#");
        const addressColIndex = headers.findIndex((h: string) => h.includes("address") || h.includes("repair") || h.includes("shop"));
        const zipColIndex = headers.findIndex((h: string) => h.includes("zip"));
        const phoneColIndex = headers.findIndex((h: string) => h.includes("phone"));
        const commentsColIndex = headers.findIndex((h: string) => h.includes("comment"));
        const stillNotSoldColIndex = headers.findIndex((h: string) => h.includes("still") || h.includes("sold"));

        const importData = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          const truckNumber = String(row[truckColIndex >= 0 ? truckColIndex : 0] || "").trim();
          
          if (!truckNumber || truckNumber === "0" || truckNumber === "") continue;

          importData.push({
            truckNumber,
            address: addressColIndex >= 0 ? String(row[addressColIndex] || "").trim() : "",
            zipCode: zipColIndex >= 0 ? String(row[zipColIndex] || "").trim() : "",
            phone: phoneColIndex >= 0 ? String(row[phoneColIndex] || "").trim() : "",
            comments: commentsColIndex >= 0 ? String(row[commentsColIndex] || "").trim() : "",
            stillNotSold: stillNotSoldColIndex >= 0 ? String(row[stillNotSoldColIndex] || "Yes").trim() : "Yes",
          });
        }

        if (importData.length === 0) {
          toast({
            title: "Error",
            description: "No valid data rows found in file",
            variant: "destructive",
          });
          return;
        }

        importMutation.mutate(importData);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to parse file",
          variant: "destructive",
        });
      }
    };
    reader.readAsBinaryString(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCellEdit = (id: number, field: string, currentValue: string | null) => {
    setEditingCell({ id, field });
    setEditValue(currentValue || "");
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    
    updateMutation.mutate({
      id: editingCell.id,
      updates: { [editingCell.field]: editValue || null },
    });
    setEditingCell(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCellSave();
    } else if (e.key === "Escape") {
      setEditingCell(null);
      setEditValue("");
    }
  };

  const handleDecomDoneToggle = (id: number, currentValue: boolean) => {
    updateMutation.mutate({
      id,
      updates: { decomDone: !currentValue },
    });
  };

  const handleSentToProcurementToggle = (id: number, currentValue: boolean) => {
    updateMutation.mutate({
      id,
      updates: { sentToProcurement: !currentValue },
    });
  };

  const handleExport = () => {
    const exportData = filteredVehicles.map((v) => ({
      "Truck #": v.truckNumber,
      "VIN": v.vin || "",
      "Assigned": v.isAssigned ? "Yes" : "No",
      "With Rental": v.withRental ? "Yes" : "No",
      "Date Added": v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "",
      "Address": v.address || "",
      "Zip Code": v.zipCode || "",
      "Phone": v.phone || "",
      "Enterprise ID": v.enterpriseId || "",
      "Tech Name": v.fullName || "",
      "Mobile Phone": v.mobilePhone || "",
      "Tech ZIP": v.primaryZip || "",
      "Tech Distance": v.techDistance !== null ? `${v.techDistance} mi` : "",
      "Manager Ent ID": v.managerEntId || "",
      "Manager Name": v.managerName || "",
      "Manager ZIP": v.managerZip || "",
      "Manager Distance": v.managerDistance !== null ? `${v.managerDistance} mi` : "",
      "Parts Count": v.partsCount !== null ? v.partsCount : "",
      "Parts Cu.Ft": v.partsSpace !== null ? v.partsSpace : "",
      "Decom Done": v.decomDone ? "Yes" : "No",
      "Sent to Procurement": v.sentToProcurement ? "Yes" : "No",
      "Comments": v.comments || "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Decommissioning");
    
    const date = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `Decommissioning_${date}.xlsx`);
    
    toast({
      title: "Export Complete",
      description: `Exported ${exportData.length} vehicles to Excel`,
    });
  };

  const filteredVehicles = vehicles.filter((v) => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesSearch = 
        v.truckNumber.toLowerCase().includes(search) ||
        v.vin?.toLowerCase().includes(search) ||
        v.address?.toLowerCase().includes(search) ||
        v.zipCode?.toLowerCase().includes(search) ||
        v.phone?.toLowerCase().includes(search) ||
        v.comments?.toLowerCase().includes(search);
      if (!matchesSearch) return false;
    }
    
    // Date filter
    if (dateFilter) {
      const vehicleDate = v.createdAt ? new Date(v.createdAt).toISOString().split('T')[0] : '';
      if (vehicleDate !== dateFilter) return false;
    }
    
    // Tech Distance < 160 miles filter
    if (techDistanceFilter) {
      if (v.techDistance === null || v.techDistance >= 160) return false;
    }
    
    // Manager Distance < 160 miles filter
    if (managerDistanceFilter) {
      if (v.managerDistance === null || v.managerDistance >= 160) return false;
    }
    
    // Assigned filter
    if (assignedFilter !== "all") {
      if (assignedFilter === "yes" && !v.isAssigned) return false;
      if (assignedFilter === "no" && v.isAssigned) return false;
    }
    
    return true;
  });

  return (
    <div className="container mx-auto p-4 max-w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Decommissioning</h1>
          <span className="text-muted-foreground">
            {filteredVehicles.length} vehicle{filteredVehicles.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 w-64"
              data-testid="input-search"
            />
          </div>

          <Button
            variant="outline"
            onClick={() => syncTechDataMutation.mutate()}
            disabled={syncTechDataMutation.isPending || vehicles.length === 0}
            data-testid="button-sync-tech"
          >
            {syncTechDataMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Tech Data
          </Button>

          <Button
            variant="outline"
            onClick={() => syncPartsCountMutation.mutate()}
            disabled={syncPartsCountMutation.isPending || vehicles.length === 0}
            data-testid="button-sync-parts"
          >
            {syncPartsCountMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync Parts Count
          </Button>

          <Button
            variant="outline"
            onClick={() => syncFromPOsMutation.mutate()}
            disabled={syncFromPOsMutation.isPending}
            data-testid="button-sync-from-pos"
          >
            {syncFromPOsMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync from POs
          </Button>

          <Button
            variant="outline"
            onClick={handleExport}
            disabled={filteredVehicles.length === 0}
            data-testid="button-export"
          >
            <Download className="h-4 w-4 mr-2" />
            Export XLSX
          </Button>

          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Decommissioning Vehicles</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/30">
                  <FileSpreadsheet className="h-8 w-8 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium">Upload Excel/CSV File</p>
                    <p className="text-sm text-muted-foreground">
                      Expected columns: Truck #, Address, Zip Code, Phone, Comments
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    data-testid="input-file-upload"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importMutation.isPending}
                    data-testid="button-upload-file"
                  >
                    {importMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                    )}
                    Choose File
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or paste data</span>
                  </div>
                </div>

                <Textarea
                  placeholder="Paste tab-separated data here..."
                  value={pasteData}
                  onChange={(e) => setPasteData(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                  data-testid="textarea-import"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setImportDialogOpen(false)}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={importMutation.isPending || !pasteData.trim()}
                    data-testid="button-confirm-import"
                  >
                    {importMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Import Pasted Data
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchTerm ? "No vehicles match your search" : "No decommissioning vehicles yet. Click Import to add data."}
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-280px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-24">Truck #</TableHead>
                    <TableHead className="w-40">VIN</TableHead>
                    <TableHead className="w-24">
                      <div className="flex flex-col gap-1">
                        <span>Assigned</span>
                        <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                          <SelectTrigger className="h-7 text-xs" data-testid="filter-assigned">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableHead>
                    <TableHead className="w-24 text-center">With Rental</TableHead>
                    <TableHead className="w-32">
                      <div className="flex flex-col gap-1">
                        <span>Date Added</span>
                        <Input
                          type="date"
                          value={dateFilter}
                          onChange={(e) => setDateFilter(e.target.value)}
                          className="h-7 text-xs"
                          data-testid="filter-date-added"
                        />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[300px]">Address</TableHead>
                    <TableHead className="w-24">Zip Code</TableHead>
                    <TableHead className="w-32">Phone</TableHead>
                    <TableHead className="w-28">Enterprise ID</TableHead>
                    <TableHead className="w-36">Tech Name</TableHead>
                    <TableHead className="w-32">Mobile Phone</TableHead>
                    <TableHead className="w-24">Tech ZIP</TableHead>
                    <TableHead className="w-32 bg-amber-100/50 dark:bg-amber-900/30">
                      <div className="flex flex-col gap-1">
                        <span>Tech Distance</span>
                        <label className="flex items-center gap-1 text-xs font-normal cursor-pointer">
                          <Checkbox
                            checked={techDistanceFilter}
                            onCheckedChange={(checked) => setTechDistanceFilter(checked === true)}
                            data-testid="filter-tech-distance"
                          />
                          <span>&lt; 160 mi</span>
                        </label>
                      </div>
                    </TableHead>
                    <TableHead className="w-28">Manager Ent ID</TableHead>
                    <TableHead className="w-36">Manager Name</TableHead>
                    <TableHead className="w-28">Manager ZIP</TableHead>
                    <TableHead className="w-32 bg-amber-100/50 dark:bg-amber-900/30">
                      <div className="flex flex-col gap-1">
                        <span>Manager Distance</span>
                        <label className="flex items-center gap-1 text-xs font-normal cursor-pointer">
                          <Checkbox
                            checked={managerDistanceFilter}
                            onCheckedChange={(checked) => setManagerDistanceFilter(checked === true)}
                            data-testid="filter-manager-distance"
                          />
                          <span>&lt; 160 mi</span>
                        </label>
                      </div>
                    </TableHead>
                    <TableHead className="w-24 text-center">Parts Count</TableHead>
                    <TableHead className="w-24 text-center">Parts Cu.Ft</TableHead>
                    <TableHead className="w-24 text-center">Decom Done</TableHead>
                    <TableHead className="w-32 text-center">Sent to Procurement</TableHead>
                    <TableHead className="min-w-[200px]">Comments</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVehicles.map((vehicle) => (
                    <TableRow key={vehicle.id} data-testid={`row-vehicle-${vehicle.truckNumber}`} className={vehicle.sentToProcurement ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}>
                      <TableCell className="font-mono font-medium">
                        {vehicle.truckNumber}
                        {vehicle.sentToProcurement && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">Sent to auction</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {vehicle.vin || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-center">
                        <span className={vehicle.isAssigned ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}>
                          {vehicle.isAssigned ? "Yes" : "No"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-center" data-testid={`cell-with-rental-${vehicle.id}`}>
                        <span className={vehicle.withRental ? "text-blue-600 dark:text-blue-400 font-medium" : "text-muted-foreground"}>
                          {vehicle.withRental ? "Yes" : "No"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {vehicle.createdAt ? new Date(vehicle.createdAt).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCellEdit(vehicle.id, "address", vehicle.address)}
                        data-testid={`cell-address-${vehicle.id}`}
                      >
                        {editingCell?.id === vehicle.id && editingCell?.field === "address" ? (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full"
                          />
                        ) : (
                          <span className="text-sm">{vehicle.address || "-"}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCellEdit(vehicle.id, "zipCode", vehicle.zipCode)}
                        data-testid={`cell-zipcode-${vehicle.id}`}
                      >
                        {editingCell?.id === vehicle.id && editingCell?.field === "zipCode" ? (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-24"
                          />
                        ) : (
                          <span className="text-sm font-mono">{vehicle.zipCode || "-"}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCellEdit(vehicle.id, "phone", vehicle.phone)}
                        data-testid={`cell-phone-${vehicle.id}`}
                      >
                        {editingCell?.id === vehicle.id && editingCell?.field === "phone" ? (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-32"
                          />
                        ) : (
                          <span className="text-sm">{vehicle.phone || "-"}</span>
                        )}
                      </TableCell>
                      {/* Persisted Snowflake TPMS_EXTRACT columns - orange text for manager ZIP fallback matches */}
                      <TableCell className={`text-sm font-mono ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.enterpriseId || "-"}
                      </TableCell>
                      <TableCell className={`text-sm ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.fullName || "-"}
                        {vehicle.techMatchSource === 'manager_zip_fallback' && vehicle.fullName && (
                          <span className="ml-1 text-xs">(nearest mgr)</span>
                        )}
                      </TableCell>
                      <TableCell className={`text-sm ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.mobilePhone || "-"}
                      </TableCell>
                      <TableCell className={`text-sm font-mono ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.primaryZip || "-"}
                      </TableCell>
                      <TableCell className="text-sm font-mono bg-amber-50/50 dark:bg-amber-900/20">
                        {vehicle.techDistance !== null ? `${vehicle.techDistance} mi` : "-"}
                      </TableCell>
                      <TableCell className={`text-sm font-mono ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.managerEntId || "-"}
                      </TableCell>
                      <TableCell className={`text-sm ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.managerName || "-"}
                        {vehicle.techMatchSource === 'manager_zip_fallback' && vehicle.managerName && (
                          <span className="ml-1 text-xs">(nearest mgr)</span>
                        )}
                      </TableCell>
                      <TableCell className={`text-sm font-mono ${vehicle.techMatchSource === 'manager_zip_fallback' ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                        {vehicle.managerZip || "-"}
                      </TableCell>
                      <TableCell className="text-sm font-mono bg-amber-50/50 dark:bg-amber-900/20">
                        {vehicle.managerDistance !== null ? `${vehicle.managerDistance} mi` : "-"}
                      </TableCell>
                      <TableCell className="text-center text-sm font-mono" data-testid={`cell-parts-count-${vehicle.id}`}>
                        {vehicle.partsCount !== null ? vehicle.partsCount : "-"}
                      </TableCell>
                      <TableCell className="text-center text-sm font-mono" data-testid={`cell-parts-space-${vehicle.id}`}>
                        {vehicle.partsSpace !== null ? vehicle.partsSpace : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={vehicle.decomDone}
                          onCheckedChange={() => handleDecomDoneToggle(vehicle.id, vehicle.decomDone)}
                          data-testid={`checkbox-decom-done-${vehicle.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={vehicle.sentToProcurement}
                          onCheckedChange={() => handleSentToProcurementToggle(vehicle.id, vehicle.sentToProcurement)}
                          data-testid={`checkbox-sent-to-procurement-${vehicle.id}`}
                        />
                      </TableCell>
                      <TableCell
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCellEdit(vehicle.id, "comments", vehicle.comments)}
                        data-testid={`cell-comments-${vehicle.id}`}
                      >
                        {editingCell?.id === vehicle.id && editingCell?.field === "comments" ? (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full"
                          />
                        ) : (
                          <span className="text-sm">{vehicle.comments || "-"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(vehicle.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${vehicle.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
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
  );
}
