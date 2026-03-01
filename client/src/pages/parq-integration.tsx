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
  Search, MapPin, List, Activity, Wrench, TestTube, Tag, FileText,
  ClipboardCheck, AlertCircle
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const ENDPOINTS = [
  { method: "GET",  path: "/api/public/v1/vehicle",                   label: "List All Vehicles",              description: "Returns all vehicles in the fleet" },
  { method: "GET",  path: "/api/public/v1/vehicle/statuses",           label: "Vehicle Statuses",               description: "Returns all vehicle status options" },
  { method: "GET",  path: "/api/public/v1/vehicle/types",              label: "Vehicle Types",                  description: "Returns all vehicle type options" },
  { method: "GET",  path: "/api/public/v1/vehicle/datapointtypes",     label: "Vehicle Datapoint Types",        description: "Returns extended data point type definitions" },
  { method: "GET",  path: "/api/public/v1/vehicle/{id}",               label: "Get Vehicle By ID",              description: "Returns a single vehicle by its ID" },
  { method: "GET",  path: "/api/public/v1/vehicle/{id}/activitylog",   label: "Vehicle Activity Log",           description: "Returns the activity history for a vehicle" },
  { method: "GET",  path: "/api/public/v1/vehicle/{id}/conditionreport", label: "Vehicle Condition Report",     description: "Returns condition reports for a vehicle" },
  { method: "GET",  path: "/api/public/v1/vehicle/{id}/checkin",       label: "Vehicle Check-In Form",          description: "Returns the check-in form for a vehicle" },
  { method: "GET",  path: "/api/public/v1/lot",                        label: "List All Lots",                  description: "Returns all parking/storage lots" },
  { method: "GET",  path: "/api/public/v1/lot/types",                  label: "Lot Types",                      description: "Returns all lot type options" },
  { method: "GET",  path: "/api/public/v1/lot/timezones",              label: "Lot Timezones",                  description: "Returns timezone options for lots" },
  { method: "GET",  path: "/api/public/v1/ticket/categories",          label: "Ticket Categories",              description: "Returns ticket category options" },
  { method: "GET",  path: "/api/public/v1/ticket/priorities",          label: "Ticket Priorities",              description: "Returns ticket priority options" },
  { method: "GET",  path: "/api/public/v1/ticket/statuses",            label: "Ticket Statuses",                description: "Returns ticket status options" },
  { method: "GET",  path: "/api/public/v1/workorder",                  label: "List All Work Orders",           description: "Returns all work orders" },
  { method: "GET",  path: "/api/public/v1/workorder/{id}",             label: "Get Work Order By ID",           description: "Returns a single work order by its ID" },
  { method: "GET",  path: "/api/public/v1/workorder/{id}/pricing",     label: "Work Order Pricing",             description: "Returns pricing details for a work order" },
  { method: "GET",  path: "/api/v1/loadpricingconfig",                 label: "Load Pricing Config",            description: "Returns pricing configuration for a client" },
  { method: "POST", path: "/api/v1/loadpricingconfig",                 label: "Create Pricing Config",          description: "Creates multiple load pricing config entries" },
  { method: "GET",  path: "/api/v1/loadpricingconfig/params",          label: "Pricing Config Params",          description: "Returns pricing config parameter options" },
  { method: "GET",  path: "/api/v1/loadpricingconfig/charge",          label: "Pricing Config Charge",          description: "Returns charge calculation for a pricing config" },
  { method: "POST", path: "/connect/token",                            label: "Auth Token",                     description: "OAuth2 client credentials authentication" },
];

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    POST:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PUT:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    DELETE: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${colors[method] || colors.GET}`}>
      {method}
    </span>
  );
}

function DataGrid({ data }: { data: Record<string, any> }) {
  return (
    <div className="rounded-md border p-3 space-y-1.5 bg-muted/30 text-sm">
      {Object.entries(data)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .slice(0, 24)
        .map(([k, v]) => (
          <div key={k} className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground min-w-[130px] text-xs">{k}</span>
            <span className="text-xs font-mono break-all">
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
    </div>
  );
}

export default function ParqIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const [vehicleIdInput, setVehicleIdInput] = useState("");
  const [vehicleResult, setVehicleResult] = useState<any>(null);
  const [activityLogResult, setActivityLogResult] = useState<any[]>([]);
  const [conditionReportResult, setConditionReportResult] = useState<any>(null);

  const [workOrderIdInput, setWorkOrderIdInput] = useState("");
  const [workOrderResult, setWorkOrderResult] = useState<any>(null);
  const [workOrderPricing, setWorkOrderPricing] = useState<any>(null);

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [workOrderSearch, setWorkOrderSearch] = useState("");

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

  const { data: workOrdersData, isLoading: workOrdersLoading, refetch: refetchWorkOrders } = useQuery<{ success: boolean; workorders: any[] }>({
    queryKey: ["/api/pmf/workorders"],
    enabled: false,
  });

  const { data: vehicleStatusesData } = useQuery<{ success: boolean; statuses: any[] }>({
    queryKey: ["/api/pmf/vehicle-statuses"],
    enabled: statusData?.configured,
  });

  const { data: vehicleTypesData } = useQuery<{ success: boolean; types: any[] }>({
    queryKey: ["/api/pmf/vehicle-types"],
    enabled: statusData?.configured,
  });

  const { data: ticketCategoriesData } = useQuery<{ success: boolean; categories: any[] }>({
    queryKey: ["/api/pmf/ticket-categories"],
    enabled: statusData?.configured,
  });

  const { data: ticketPrioritiesData } = useQuery<{ success: boolean; priorities: any[] }>({
    queryKey: ["/api/pmf/ticket-priorities"],
    enabled: statusData?.configured,
  });

  const { data: ticketStatusesData } = useQuery<{ success: boolean; statuses: any[] }>({
    queryKey: ["/api/pmf/ticket-statuses"],
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
        setActivityLogResult([]);
        setConditionReportResult(null);
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
      if (data.success) setActivityLogResult(data.log || []);
      else toast({ title: "Not Found", description: data.message, variant: "destructive" });
    },
    onError: (error: any) => {
      toast({ title: "Activity Log Failed", description: error.message, variant: "destructive" });
    },
  });

  const lookupConditionReportMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/pmf/vehicle/${id}/conditionreport`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) setConditionReportResult(data.report);
      else toast({ title: "Not Found", description: data.message, variant: "destructive" });
    },
    onError: (error: any) => {
      toast({ title: "Condition Report Failed", description: error.message, variant: "destructive" });
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
        setWorkOrderPricing(null);
      } else {
        toast({ title: "Not Found", description: data.message, variant: "destructive" });
        setWorkOrderResult(null);
      }
    },
    onError: (error: any) => {
      toast({ title: "Lookup Failed", description: error.message, variant: "destructive" });
    },
  });

  const lookupWorkOrderPricingMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/pmf/workorder/${id}/pricing`);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) setWorkOrderPricing(data.pricing);
      else toast({ title: "Not Found", description: data.message, variant: "destructive" });
    },
    onError: (error: any) => {
      toast({ title: "Pricing Failed", description: error.message, variant: "destructive" });
    },
  });

  const vehicles = vehiclesData?.vehicles || [];
  const lots = lotsData?.lots || [];
  const workOrders = workOrdersData?.workorders || [];

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

  const filteredWorkOrders = workOrders.filter(w => {
    if (!workOrderSearch) return true;
    const q = workOrderSearch.toLowerCase();
    return JSON.stringify(w).toLowerCase().includes(q);
  });

  return (
    <MainContent>
      <TopBar title="PARQ My Fleet" breadcrumbs={["Home", "Integrations", "PARQ My Fleet"]} />
      <main className="p-6">
        <BackButton href="/integrations" />

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <Truck className="h-7 w-7 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">PARQ My Fleet</h1>
              <p className="text-muted-foreground text-sm">Vehicle fleet management, lots, work orders, and ticketing</p>
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
              {testConnectionMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview"><Database className="h-4 w-4 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="vehicles"><Truck className="h-4 w-4 mr-1.5" />Vehicles</TabsTrigger>
            <TabsTrigger value="lots"><MapPin className="h-4 w-4 mr-1.5" />Lots</TabsTrigger>
            <TabsTrigger value="workorders"><Wrench className="h-4 w-4 mr-1.5" />Work Orders</TabsTrigger>
            <TabsTrigger value="lookup"><Search className="h-4 w-4 mr-1.5" />Lookup</TabsTrigger>
            <TabsTrigger value="endpoints"><List className="h-4 w-4 mr-1.5" />API Reference</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-500" />Connection Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : statusData?.configured
                      ? <span className="text-sm font-medium text-green-600">Connected</span>
                      : <span className="text-sm font-medium text-red-600">Disconnected</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Auth Method</span>
                    <span className="text-xs font-mono font-medium">OAuth2 Client Credentials</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Endpoints</span>
                    <Badge variant="secondary">{ENDPOINTS.length}</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-500" />Vehicle Statuses
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {(vehicleStatusesData?.statuses || []).length > 0
                    ? (vehicleStatusesData?.statuses || []).map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between py-1 border-b last:border-0">
                          <span className="text-sm">{s.name}</span>
                          <Badge variant="outline" className="text-xs font-mono">{s.id}</Badge>
                        </div>
                      ))
                    : <p className="text-sm text-muted-foreground">{statusData?.configured ? "No data" : "Connect to load"}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <List className="h-4 w-4 text-purple-500" />Vehicle Types
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {(vehicleTypesData?.types || []).length > 0
                    ? (vehicleTypesData?.types || []).map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between py-1 border-b last:border-0">
                          <span className="text-sm">{t.name}</span>
                          <Badge variant="outline" className="text-xs font-mono">{t.id}</Badge>
                        </div>
                      ))
                    : <p className="text-sm text-muted-foreground">{statusData?.configured ? "No data" : "Connect to load"}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Tag className="h-4 w-4 text-orange-500" />Ticket Reference Data
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Categories</p>
                    {(ticketCategoriesData?.categories || []).length > 0
                      ? (ticketCategoriesData?.categories || []).slice(0, 4).map((c: any) => (
                          <div key={c.id} className="flex justify-between py-0.5">
                            <span className="text-xs">{c.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{c.id}</span>
                          </div>
                        ))
                      : <p className="text-xs text-muted-foreground">{statusData?.configured ? "No data" : "Connect to load"}</p>}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Priorities</p>
                    {(ticketPrioritiesData?.priorities || []).length > 0
                      ? (ticketPrioritiesData?.priorities || []).map((p: any) => (
                          <div key={p.id} className="flex justify-between py-0.5">
                            <span className="text-xs">{p.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{p.id}</span>
                          </div>
                        ))
                      : <p className="text-xs text-muted-foreground">{statusData?.configured ? "No data" : "Connect to load"}</p>}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Statuses</p>
                    {(ticketStatusesData?.statuses || []).length > 0
                      ? (ticketStatusesData?.statuses || []).slice(0, 4).map((s: any) => (
                          <div key={s.id} className="flex justify-between py-0.5">
                            <span className="text-xs">{s.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{s.id}</span>
                          </div>
                        ))
                      : <p className="text-xs text-muted-foreground">{statusData?.configured ? "No data" : "Connect to load"}</p>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Integration Coverage</CardTitle>
                <CardDescription>All 22 schema endpoints proxied through Nexus</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                  {[
                    { label: "Vehicle", value: "9" },
                    { label: "Lot", value: "3" },
                    { label: "Ticket", value: "3" },
                    { label: "Work Order", value: "3" },
                    { label: "Pricing Config", value: "4" },
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
                      <Truck className="h-4 w-4" />Fleet Vehicles
                    </CardTitle>
                    <CardDescription>
                      All vehicles in PARQ My Fleet{vehicles.length > 0 && ` (${vehicles.length} total)`}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchVehicles()} disabled={vehiclesLoading}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${vehiclesLoading ? "animate-spin" : ""}`} />
                    {vehiclesLoading ? "Loading..." : "Load Vehicles"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {vehicles.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search by asset ID, VIN, status, site, state..." value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} className="pl-8 h-8 text-sm" />
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
                            <TableRow
                              key={v.assetId || i}
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => {
                                if (v.id || v.assetId) {
                                  setVehicleIdInput(String(v.id || v.assetId));
                                  setVehicleResult(null);
                                  setActivityLogResult([]);
                                  setConditionReportResult(null);
                                  setActiveTab("lookup");
                                }
                              }}
                            >
                              <TableCell className="font-mono text-xs">{v.assetId || "-"}</TableCell>
                              <TableCell className="font-mono text-xs">{v.vin || v.descriptor || "-"}</TableCell>
                              <TableCell>
                                <Badge variant={v.status?.toLowerCase() === "available" ? "default" : "secondary"} className="text-xs">
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
                      Showing {Math.min(100, filteredVehicles.length)} of {filteredVehicles.length} results. Click a row to look up full detail.
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
                      <MapPin className="h-4 w-4" />Storage Lots
                    </CardTitle>
                    <CardDescription>All parking and storage lots{lots.length > 0 && ` (${lots.length} total)`}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchLots()} disabled={lotsLoading}>
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

          {/* Work Orders Tab */}
          <TabsContent value="workorders" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="h-4 w-4" />Work Orders
                    </CardTitle>
                    <CardDescription>All work orders in PARQ My Fleet{workOrders.length > 0 && ` (${workOrders.length} total)`}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchWorkOrders()} disabled={workOrdersLoading}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${workOrdersLoading ? "animate-spin" : ""}`} />
                    {workOrdersLoading ? "Loading..." : "Load Work Orders"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {workOrders.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search work orders..." value={workOrderSearch} onChange={(e) => setWorkOrderSearch(e.target.value)} className="pl-8 h-8 text-sm" />
                  </div>
                )}
                {workOrdersLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading work orders...</span>
                  </div>
                ) : workOrders.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Wrench className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load Work Orders" to fetch data from PARQ</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border overflow-auto max-h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {workOrders[0] && Object.keys(workOrders[0]).slice(0, 6).map(k => (
                              <TableHead key={k} className="text-xs">{k}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredWorkOrders.slice(0, 100).map((wo: any, i: number) => (
                            <TableRow
                              key={wo.id || i}
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => {
                                if (wo.id) {
                                  setWorkOrderIdInput(String(wo.id));
                                  setWorkOrderResult(null);
                                  setWorkOrderPricing(null);
                                  setActiveTab("lookup");
                                }
                              }}
                            >
                              {Object.values(wo).slice(0, 6).map((v: any, ci) => (
                                <TableCell key={ci} className="text-xs font-mono">
                                  {typeof v === "object" ? JSON.stringify(v) : String(v ?? "-")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Showing {Math.min(100, filteredWorkOrders.length)} of {filteredWorkOrders.length} results. Click a row to look up full detail.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lookup Tab */}
          <TabsContent value="lookup" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vehicle Lookup */}
              <div className="space-y-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Truck className="h-4 w-4" />Vehicle Lookup
                    </CardTitle>
                    <CardDescription>Look up a vehicle by its PARQ asset ID</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input placeholder="Enter vehicle ID..." value={vehicleIdInput} onChange={(e) => setVehicleIdInput(e.target.value)} className="flex-1" />
                      <Button
                        onClick={() => { setVehicleResult(null); setActivityLogResult([]); setConditionReportResult(null); lookupVehicleMutation.mutate(vehicleIdInput.trim()); }}
                        disabled={!vehicleIdInput.trim() || lookupVehicleMutation.isPending}
                      >
                        {lookupVehicleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                      </Button>
                    </div>
                    {vehicleResult && (
                      <>
                        <DataGrid data={vehicleResult} />
                        <div className="flex gap-2 flex-wrap">
                          <Button variant="outline" size="sm" onClick={() => lookupActivityLogMutation.mutate(vehicleIdInput.trim())} disabled={lookupActivityLogMutation.isPending}>
                            {lookupActivityLogMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Activity className="h-3 w-3 mr-1" />}
                            Activity Log
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => lookupConditionReportMutation.mutate(vehicleIdInput.trim())} disabled={lookupConditionReportMutation.isPending}>
                            {lookupConditionReportMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ClipboardCheck className="h-3 w-3 mr-1" />}
                            Condition Report
                          </Button>
                        </div>
                      </>
                    )}
                    {activityLogResult.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Activity Log ({activityLogResult.length} entries)</p>
                        <div className="rounded-md border overflow-auto max-h-48">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {Object.keys(activityLogResult[0]).map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
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
                      </div>
                    )}
                    {conditionReportResult && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Condition Report</p>
                        <DataGrid data={typeof conditionReportResult === "object" ? conditionReportResult : { result: conditionReportResult }} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Work Order Lookup */}
              <div className="space-y-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="h-4 w-4" />Work Order Lookup
                    </CardTitle>
                    <CardDescription>Look up a work order by its ID</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input placeholder="Enter work order ID..." value={workOrderIdInput} onChange={(e) => setWorkOrderIdInput(e.target.value)} className="flex-1" />
                      <Button
                        onClick={() => { setWorkOrderResult(null); setWorkOrderPricing(null); lookupWorkOrderMutation.mutate(workOrderIdInput.trim()); }}
                        disabled={!workOrderIdInput.trim() || lookupWorkOrderMutation.isPending}
                      >
                        {lookupWorkOrderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
                      </Button>
                    </div>
                    {workOrderResult && (
                      <>
                        <DataGrid data={workOrderResult} />
                        <Button variant="outline" size="sm" onClick={() => lookupWorkOrderPricingMutation.mutate(workOrderIdInput.trim())} disabled={lookupWorkOrderPricingMutation.isPending}>
                          {lookupWorkOrderPricingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
                          Load Pricing
                        </Button>
                        {workOrderPricing && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Pricing</p>
                            <DataGrid data={typeof workOrderPricing === "object" ? workOrderPricing : { result: workOrderPricing }} />
                          </div>
                        )}
                      </>
                    )}
                    {!workOrderResult && (
                      <div className="text-center py-8 text-muted-foreground">
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Enter a work order ID to look it up, or click a row in the Work Orders tab</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* API Reference Tab */}
          <TabsContent value="endpoints" className="space-y-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <List className="h-4 w-4" />API Endpoints
                </CardTitle>
                <CardDescription>
                  All {ENDPOINTS.length} endpoints from the PARQ My Fleet OpenAPI schema — all proxied through Nexus at <span className="font-mono">/api/pmf/...</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(["Vehicle", "Lot", "Ticket", "Work Order", "Pricing Config", "Auth"] as const).map(group => {
                  const groupEndpoints = ENDPOINTS.filter(ep => {
                    if (group === "Vehicle") return ep.path.includes("/vehicle");
                    if (group === "Lot") return ep.path.includes("/lot");
                    if (group === "Ticket") return ep.path.includes("/ticket");
                    if (group === "Work Order") return ep.path.includes("/workorder");
                    if (group === "Pricing Config") return ep.path.includes("/loadpricingconfig");
                    if (group === "Auth") return ep.path.includes("/connect");
                    return false;
                  });
                  return (
                    <div key={group} className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</p>
                      <div className="space-y-1">
                        {groupEndpoints.map((ep, i) => (
                          <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                            <MethodBadge method={ep.method} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{ep.label}</p>
                              <p className="text-xs text-muted-foreground font-mono truncate">{ep.path}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
