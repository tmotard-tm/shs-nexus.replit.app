import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import {
  CheckCircle, XCircle, Loader2, RefreshCw, Truck, Database,
  Search, MapPin, List, Activity, Wrench, TestTube, ChevronDown, ChevronRight
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const ENDPOINTS = [
  { method: "GET", path: "/api/public/v1/vehicle", label: "List All Vehicles", description: "Returns all vehicles in the fleet" },
  { method: "GET", path: "/api/public/v1/vehicle/statuses", label: "Vehicle Statuses", description: "Returns all vehicle status options" },
  { method: "GET", path: "/api/public/v1/vehicle/types", label: "Vehicle Types", description: "Returns all vehicle type options" },
  { method: "GET", path: "/api/public/v1/vehicle/:id", label: "Get Vehicle By ID", description: "Returns a single vehicle by its ID" },
  { method: "GET", path: "/api/public/v1/vehicle/:id/activitylog", label: "Vehicle Activity Log", description: "Returns the activity history for a vehicle" },
  { method: "GET", path: "/api/public/v1/vehicle/:id/conditionreport", label: "Vehicle Condition Report", description: "Returns condition report for a vehicle" },
  { method: "GET", path: "/api/public/v1/vehicle/:id/checkin", label: "Vehicle Check-In Form", description: "Returns the check-in form for a vehicle" },
  { method: "GET", path: "/api/public/v1/lot", label: "List All Lots", description: "Returns all parking/storage lots" },
  { method: "GET", path: "/api/public/v1/lot/types", label: "Lot Types", description: "Returns all lot type options" },
  { method: "GET", path: "/api/public/v1/lot/timezones", label: "Lot Timezones", description: "Returns timezone options for lots" },
  { method: "GET", path: "/api/public/v1/ticket/categories", label: "Ticket Categories", description: "Returns ticket category options" },
  { method: "GET", path: "/api/public/v1/ticket/priorities", label: "Ticket Priorities", description: "Returns ticket priority options" },
  { method: "GET", path: "/api/public/v1/ticket/statuses", label: "Ticket Statuses", description: "Returns ticket status options" },
  { method: "GET", path: "/api/public/v1/workorder/:id", label: "Get Work Order By ID", description: "Returns a single work order by its ID" },
  { method: "GET", path: "/api/v1/loadpricingconfig", label: "Load Pricing Config", description: "Returns pricing configuration for a client" },
  { method: "GET", path: "/api/v1/loadpricingconfig/params", label: "Pricing Config Params", description: "Returns pricing config parameter options" },
  { method: "POST", path: "/connect/token", label: "Auth Token", description: "OAuth2 client credentials authentication" },
];

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    POST: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PUT: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    DELETE: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${colors[method] || colors.GET}`}>
      {method}
    </span>
  );
}

export default function ParqIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [vehicleIdInput, setVehicleIdInput] = useState("");
  const [vehicleResult, setVehicleResult] = useState<any>(null);
  const [activityLogResult, setActivityLogResult] = useState<any[]>([]);
  const [workOrderIdInput, setWorkOrderIdInput] = useState("");
  const [workOrderResult, setWorkOrderResult] = useState<any>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/pmf/status"],
  });

  const { data: vehiclesData, isLoading: vehiclesLoading, refetch: refetchVehicles } = useQuery<{ success: boolean; vehicles: any[] }>({
    queryKey: ["/api/pmf/vehicles"],
    enabled: false,
  });

  const { data: lotsData, isLoading: lotsLoading, refetch: refetchLots } = useQuery<{ success: boolean; lots: any[] }>({
    queryKey: ["/api/pmf/lots"],
    enabled: false,
  });

  const { data: vehicleStatusesData, isLoading: vehicleStatusesLoading } = useQuery<{ success: boolean; statuses: any[] }>({
    queryKey: ["/api/pmf/vehicle-statuses"],
    enabled: statusData?.configured,
  });

  const { data: vehicleTypesData, isLoading: vehicleTypesLoading } = useQuery<{ success: boolean; types: any[] }>({
    queryKey: ["/api/pmf/vehicle-types"],
    enabled: statusData?.configured,
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/pmf/test");
      return response.json();
    },
    onSuccess: (data) => {
      refetchStatus();
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  const lookupVehicleMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/pmf/vehicle/${id}`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setVehicleResult(data.vehicle);
      } else {
        toast({ title: "Not Found", description: data.message, variant: "destructive" });
        setVehicleResult(null);
      }
    },
    onError: (error: any) => {
      toast({ title: "Lookup Failed", description: error.message, variant: "destructive" });
    },
  });

  const lookupActivityLogMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/pmf/vehicle/${id}/activitylog`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setActivityLogResult(data.log || []);
      } else {
        toast({ title: "Not Found", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Lookup Failed", description: error.message, variant: "destructive" });
    },
  });

  const lookupWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/pmf/workorder/${id}`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setWorkOrderResult(data.workorder);
      } else {
        toast({ title: "Not Found", description: data.message, variant: "destructive" });
        setWorkOrderResult(null);
      }
    },
    onError: (error: any) => {
      toast({ title: "Lookup Failed", description: error.message, variant: "destructive" });
    },
  });

  const vehicles = vehiclesData?.vehicles || [];
  const lots = lotsData?.lots || [];

  const filteredVehicles = vehicles.filter(v => {
    if (!vehicleSearch) return true;
    const q = vehicleSearch.toLowerCase();
    return (
      (v.assetId || "").toLowerCase().includes(q) ||
      (v.vin || v.descriptor || "").toLowerCase().includes(q) ||
      (v.status || "").toLowerCase().includes(q) ||
      (v.site || "").toLowerCase().includes(q) ||
      (v.state || "").toLowerCase().includes(q)
    );
  });

  return (
    <MainContent>
      <TopBar title="PARQ My Fleet" breadcrumbs={["Home", "Integrations", "PARQ My Fleet"]} />
      <main className="p-6">
        <BackButton href="/integrations" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <Truck className="h-7 w-7 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">PARQ My Fleet</h1>
              <p className="text-muted-foreground text-sm">Vehicle fleet management, lots, and work orders</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {statusLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : statusData?.configured ? (
              <Badge variant="default" className="flex items-center gap-1.5 text-sm px-3 py-1">
                <CheckCircle className="h-3.5 w-3.5" /> Connected
              </Badge>
            ) : (
              <Badge variant="destructive" className="flex items-center gap-1.5 text-sm px-3 py-1">
                <XCircle className="h-3.5 w-3.5" /> Not Configured
              </Badge>
            )}
            <Button
              variant="outline"
              onClick={() => testConnectionMutation.mutate()}
              disabled={testConnectionMutation.isPending}
            >
              {testConnectionMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TestTube className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview">
              <Database className="h-4 w-4 mr-1.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="vehicles">
              <Truck className="h-4 w-4 mr-1.5" /> Vehicles
            </TabsTrigger>
            <TabsTrigger value="lots">
              <MapPin className="h-4 w-4 mr-1.5" /> Lots
            </TabsTrigger>
            <TabsTrigger value="lookup">
              <Search className="h-4 w-4 mr-1.5" /> Lookup
            </TabsTrigger>
            <TabsTrigger value="endpoints">
              <List className="h-4 w-4 mr-1.5" /> API Reference
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-500" />
                    Connection Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {statusLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : statusData?.configured ? (
                      <span className="text-sm font-medium text-green-600">Connected</span>
                    ) : (
                      <span className="text-sm font-medium text-red-600">Disconnected</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Auth Method</span>
                    <span className="text-sm font-medium font-mono">OAuth2 Client Credentials</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Base URL</span>
                    <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">
                      {import.meta.env.VITE_PMF_BASE_URL || "Configured via env"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-500" />
                    Vehicle Statuses
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {vehicleStatusesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                    </div>
                  ) : (vehicleStatusesData?.statuses || []).length > 0 ? (
                    (vehicleStatusesData?.statuses || []).map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between py-1 border-b last:border-0">
                        <span className="text-sm">{s.name}</span>
                        <Badge variant="outline" className="text-xs font-mono">{s.id}</Badge>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {statusData?.configured ? "No statuses loaded" : "Connect to load statuses"}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <List className="h-4 w-4 text-purple-500" />
                    Vehicle Types
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {vehicleTypesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                    </div>
                  ) : (vehicleTypesData?.types || []).length > 0 ? (
                    (vehicleTypesData?.types || []).map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between py-1 border-b last:border-0">
                        <span className="text-sm">{t.name}</span>
                        <Badge variant="outline" className="text-xs font-mono">{t.id}</Badge>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {statusData?.configured ? "No types loaded" : "Connect to load types"}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Integration Summary</CardTitle>
                <CardDescription>
                  PARQ My Fleet provides fleet vehicle management including lot assignments, condition reports, and work orders.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  {[
                    { label: "Vehicle Endpoints", value: "9" },
                    { label: "Lot Endpoints", value: "3" },
                    { label: "Ticket Endpoints", value: "3" },
                    { label: "Work Order Endpoints", value: "1" },
                  ].map(stat => (
                    <div key={stat.label} className="p-3 rounded-lg bg-muted/50">
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Vehicles Tab */}
          <TabsContent value="vehicles" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Fleet Vehicles
                    </CardTitle>
                    <CardDescription>
                      All vehicles in the PARQ My Fleet system
                      {vehicles.length > 0 && ` (${vehicles.length} total)`}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchVehicles()}
                    disabled={vehiclesLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${vehiclesLoading ? "animate-spin" : ""}`} />
                    {vehiclesLoading ? "Loading..." : "Load Vehicles"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {vehicles.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search by asset ID, VIN, status, site, state..."
                      value={vehicleSearch}
                      onChange={(e) => setVehicleSearch(e.target.value)}
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                )}
                {vehiclesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading vehicles...</span>
                  </div>
                ) : vehicles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load Vehicles" to fetch fleet data from PARQ</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border overflow-auto max-h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset ID</TableHead>
                            <TableHead>VIN</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Site / Lot</TableHead>
                            <TableHead>State</TableHead>
                            <TableHead>License Plate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredVehicles.slice(0, 100).map((v: any, i: number) => (
                            <TableRow key={v.assetId || i}>
                              <TableCell className="font-mono text-xs">{v.assetId || "-"}</TableCell>
                              <TableCell className="font-mono text-xs">{v.vin || v.descriptor || "-"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={v.status?.toLowerCase() === "available" ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {v.status || "unknown"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{v.site || "-"}</TableCell>
                              <TableCell className="text-xs">{v.state || "-"}</TableCell>
                              <TableCell className="font-mono text-xs">{v.licensePlate || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Showing {Math.min(100, filteredVehicles.length)} of {filteredVehicles.length} results
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lots Tab */}
          <TabsContent value="lots" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Storage Lots
                    </CardTitle>
                    <CardDescription>
                      All parking and storage lots in PARQ My Fleet
                      {lots.length > 0 && ` (${lots.length} total)`}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchLots()}
                    disabled={lotsLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${lotsLoading ? "animate-spin" : ""}`} />
                    {lotsLoading ? "Loading..." : "Load Lots"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {lotsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading lots...</span>
                  </div>
                ) : lots.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MapPin className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load Lots" to fetch lot data from PARQ</p>
                  </div>
                ) : (
                  <div className="rounded-md border overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lots.map((lot: any, i: number) => (
                          <TableRow key={lot.id || i}>
                            <TableCell className="font-mono text-xs">{lot.id || "-"}</TableCell>
                            <TableCell className="text-sm font-medium">{lot.name || "-"}</TableCell>
                            <TableCell className="text-xs">{lot.lotType?.name || lot.type || "-"}</TableCell>
                            <TableCell className="text-xs">{lot.address || lot.streetAddress || "-"}</TableCell>
                            <TableCell className="text-xs">{lot.city || "-"}</TableCell>
                            <TableCell className="text-xs">{lot.state || lot.stateAbbreviation || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lookup Tab */}
          <TabsContent value="lookup" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vehicle Lookup */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Vehicle Lookup
                  </CardTitle>
                  <CardDescription>Look up a vehicle by its PARQ asset ID</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter vehicle ID..."
                      value={vehicleIdInput}
                      onChange={(e) => setVehicleIdInput(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => {
                        setVehicleResult(null);
                        setActivityLogResult([]);
                        lookupVehicleMutation.mutate(vehicleIdInput.trim());
                      }}
                      disabled={!vehicleIdInput.trim() || lookupVehicleMutation.isPending}
                    >
                      {lookupVehicleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                    </Button>
                  </div>
                  {vehicleResult && (
                    <div className="rounded-md border p-3 space-y-1.5 bg-muted/30 text-sm">
                      {Object.entries(vehicleResult)
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .slice(0, 20)
                        .map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2">
                            <span className="font-medium text-muted-foreground min-w-[120px] text-xs">{k}</span>
                            <span className="text-xs font-mono break-all">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => lookupActivityLogMutation.mutate(vehicleIdInput.trim())}
                        disabled={lookupActivityLogMutation.isPending}
                      >
                        {lookupActivityLogMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Activity className="h-3 w-3 mr-1" />
                        )}
                        Load Activity Log
                      </Button>
                    </div>
                  )}
                  {activityLogResult.length > 0 && (
                    <div className="rounded-md border overflow-auto max-h-48">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(activityLogResult[0]).map(k => (
                              <TableHead key={k} className="text-xs">{k}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activityLogResult.map((entry, i) => (
                            <TableRow key={i}>
                              {Object.values(entry).map((v: any, ci) => (
                                <TableCell key={ci} className="text-xs font-mono">
                                  {typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Work Order Lookup */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Work Order Lookup
                  </CardTitle>
                  <CardDescription>Look up a work order by its ID</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter work order ID..."
                      value={workOrderIdInput}
                      onChange={(e) => setWorkOrderIdInput(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => {
                        setWorkOrderResult(null);
                        lookupWorkOrderMutation.mutate(workOrderIdInput.trim());
                      }}
                      disabled={!workOrderIdInput.trim() || lookupWorkOrderMutation.isPending}
                    >
                      {lookupWorkOrderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                    </Button>
                  </div>
                  {workOrderResult && (
                    <div className="rounded-md border p-3 space-y-1.5 bg-muted/30 text-sm">
                      {Object.entries(workOrderResult)
                        .filter(([, v]) => v !== null && v !== undefined && v !== "")
                        .slice(0, 20)
                        .map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2">
                            <span className="font-medium text-muted-foreground min-w-[120px] text-xs">{k}</span>
                            <span className="text-xs font-mono break-all">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* API Reference Tab */}
          <TabsContent value="endpoints" className="space-y-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <List className="h-4 w-4" />
                  API Endpoints
                </CardTitle>
                <CardDescription>
                  All available endpoints from the PARQ My Fleet API (Postman collection)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {ENDPOINTS.map((ep, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                    <MethodBadge method={ep.method} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ep.label}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{ep.path}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
