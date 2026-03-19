import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import {
  CheckCircle, XCircle, Loader2, RefreshCw, Search,
  Database, Shield, Activity, Fuel, Zap, Clock, AlertTriangle,
  Info, Car, Users, CalendarDays, Gauge
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

const API_ROUTES = [
  { method: "GET",   source: "Status",    path: "/api/samsara/status",               desc: "Integration status (Snowflake + Live API flags)" },
  { method: "GET",   source: "Status",    path: "/api/samsara/test",                 desc: "Count Snowflake vehicles + optional live API ping" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/vehicles",             desc: "List vehicles — ?truckNumber, ?driverId" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/vehicles/:vehicleId",  desc: "Single vehicle by Samsara ID" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/drivers",              desc: "List drivers — ?ldap, ?status" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/drivers/:driverId",    desc: "Single driver by Samsara driver ID" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/assignments",          desc: "Daily assignments — ?date (default today), ?vehicleId, ?driverId" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/safety-scores",        desc: "Driver safety scores — ?driverId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/odometer",             desc: "Latest odometer per vehicle — ?vehicleId" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/trips",                desc: "Trip history — ?vehicleId, ?driverId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/maintenance",          desc: "DTC / maintenance alerts" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/fuel",                 desc: "Fuel & energy daily — ?vehicleId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/safety-events",        desc: "Harsh driving events — ?vehicleId, ?driverId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/speeding",             desc: "Speeding events — ?vehicleId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/idling",               desc: "Idling events — ?vehicleId, ?startDate, ?endDate" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/devices",              desc: "Device health from SAMSARA_DEVICES" },
  { method: "GET",   source: "Snowflake", path: "/api/samsara/gateways",             desc: "Gateway connectivity from SAMSARA_GATEWAYS" },
  { method: "GET",   source: "Both",      path: "/api/samsara/vehicle/:vehicleName", desc: "Single vehicle GPS — Snowflake + 4-hour staleness fallback to live API" },
  { method: "POST",  source: "Both",      path: "/api/samsara/vehicles/batch",       desc: "Batch GPS lookup for multiple vehicles" },
  { method: "GET",   source: "Live API",  path: "/api/samsara/live/vehicles",        desc: "Full fleet direct from Samsara API (all pages, tag-filtered)" },
  { method: "GET",   source: "Live API",  path: "/api/samsara/live/locations",       desc: "Real-time GPS for all vehicles (all pages)" },
  { method: "GET",   source: "Live API",  path: "/api/samsara/live/drivers",         desc: "All drivers direct from Samsara API (all pages)" },
  { method: "POST",  source: "Live API",  path: "/api/samsara/drivers",              desc: "Create driver in Samsara (live write)" },
  { method: "PATCH", source: "Live API",  path: "/api/samsara/drivers/:driverId",    desc: "Update driver in Samsara (live write)" },
];

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    Snowflake: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Live API": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    Both:      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    Status:    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return <Badge className={`${colors[source] || ""} border-none text-xs`}>{source}</Badge>;
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:   "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400",
    POST:  "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400",
    PATCH: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400",
  };
  return <Badge variant="outline" className={`font-mono text-xs ${colors[method] || ""}`}>{method}</Badge>;
}

function DriverStatusBadge({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase();
  if (s === "active") return <Badge className="bg-green-500 text-white text-xs">Active</Badge>;
  if (s === "inactive") return <Badge className="bg-slate-400 text-white text-xs">Inactive</Badge>;
  return <Badge variant="secondary" className="text-xs">{status || "Unknown"}</Badge>;
}

function SeverityBadge({ level }: { level: number | null }) {
  if (!level) return <Badge variant="secondary" className="text-xs">—</Badge>;
  if (level >= 3) return <Badge className="bg-red-500 text-white text-xs">High</Badge>;
  if (level === 2) return <Badge className="bg-amber-500 text-white text-xs">Medium</Badge>;
  return <Badge className="bg-yellow-400 text-black text-xs">Low</Badge>;
}

export default function SamsaraIntegration() {
  const [activeTab, setActiveTab] = useState("overview");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [assignmentDate, setAssignmentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [safetySearch, setSafetySearch] = useState("");

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    snowflake: boolean; liveApi: boolean; groupId: string | null; orgId: string | null; message: string;
  }>({ queryKey: ["/api/samsara/status"] });

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/vehicles"],
    enabled: activeTab === "fleet" || activeTab === "overview",
  });

  const { data: drivers = [], isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/drivers"],
    enabled: activeTab === "drivers" || activeTab === "overview",
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/assignments", assignmentDate],
    queryFn: () => fetch(`/api/samsara/assignments?date=${assignmentDate}`, { credentials: "include" }).then(async r => { if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t}`); } return r.json(); }),
    enabled: activeTab === "assignments" || activeTab === "overview",
  });

  const { data: safetyScores = [], isLoading: safetyScoresLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/safety-scores"],
    enabled: activeTab === "safety",
  });

  const { data: safetyEvents = [], isLoading: safetyEventsLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/safety-events"],
    enabled: activeTab === "safety",
  });

  const { data: fuelData = [], isLoading: fuelLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/fuel"],
    enabled: activeTab === "operations",
  });

  const { data: speedingData = [], isLoading: speedingLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/speeding"],
    enabled: activeTab === "operations",
  });

  const { data: idlingData = [], isLoading: idlingLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/idling"],
    enabled: activeTab === "operations",
  });

  const { data: devices = [] } = useQuery<any[]>({
    queryKey: ["/api/samsara/devices"],
    enabled: activeTab === "overview",
  });

  const filteredVehicles = vehicles.filter((v: any) =>
    (v.TRUCK_NUMBER || "").toLowerCase().includes(vehicleSearch.toLowerCase()) ||
    (v.VIN || "").toLowerCase().includes(vehicleSearch.toLowerCase()) ||
    (v.STATICASSIGNEDDRIVER_NAME || "").toLowerCase().includes(vehicleSearch.toLowerCase())
  );

  const filteredDrivers = drivers.filter((d: any) =>
    (d.DRIVER_NAME || "").toLowerCase().includes(driverSearch.toLowerCase()) ||
    (d.LDAP || "").toLowerCase().includes(driverSearch.toLowerCase())
  );

  const filteredSafetyScores = safetyScores.filter((s: any) =>
    String(s.DRIVER_ID || "").toLowerCase().includes(safetySearch.toLowerCase())
  );

  const devicesOnline = devices.filter((d: any) =>
    (d.HEALTH_HEALTHSTATUS || "").toLowerCase() === "ok"
  ).length;

  const fuelByVehicle = Object.values(
    fuelData.reduce((acc: any, row: any) => {
      const vid = row.VEHICLE_ID;
      if (!acc[vid]) acc[vid] = { VEHICLE_ID: vid, total: 0 };
      acc[vid].total += Number(row.FUEL_CONSUMED_GAL || 0);
      return acc;
    }, {})
  ).sort((a: any, b: any) => b.total - a.total).slice(0, 10) as any[];

  const idlingByVehicle = Object.values(
    idlingData.reduce((acc: any, row: any) => {
      const vid = row.VEHICLE_ID;
      if (!acc[vid]) acc[vid] = { VEHICLE_ID: vid, totalMin: 0, totalFuel: 0 };
      acc[vid].totalMin += Number(row.DURATION_MIN || 0);
      acc[vid].totalFuel += Number(row.FUEL_CONSUMPTION_GAL || 0);
      return acc;
    }, {})
  ).sort((a: any, b: any) => b.totalMin - a.totalMin).slice(0, 10) as any[];

  const speedingSeverity = speedingData.reduce((acc: any, row: any) => {
    const lvl = row.SEVERITYLEVEL;
    const key = lvl >= 3 ? "High" : lvl === 2 ? "Medium" : "Low";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <MainContent>
      <TopBar title="Samsara Integration" breadcrumbs={["Home", "Integrations", "Samsara"]} />
      <main className="p-6">
        <BackButton href="/integrations" />

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 font-bold text-xl">
              S
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Samsara Fleet Integration</h1>
              <p className="text-muted-foreground text-sm">Snowflake-first telematics — read from Snowflake, live API for GPS fallback and writes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-1 mr-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Snowflake:</span>
                {statusLoading ? <Loader2 className="h-3 w-3 animate-spin" /> :
                  status?.snowflake
                    ? <Badge className="bg-green-500 text-white text-xs"><CheckCircle className="h-3 w-3 mr-1" />Connected</Badge>
                    : <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Disconnected</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Live API:</span>
                {status?.liveApi
                  ? <Badge className="bg-green-500 text-white text-xs"><CheckCircle className="h-3 w-3 mr-1" />Active</Badge>
                  : <Badge variant="secondary" className="text-xs">Not Configured</Badge>}
              </div>
              {status?.groupId && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Group Filter:</span>
                  <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 dark:text-blue-400">Enabled</Badge>
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 grid grid-cols-4 md:grid-cols-7 h-auto gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="fleet">Fleet</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="api">API Ref</TabsTrigger>
          </TabsList>

          {/* ─── OVERVIEW ─── */}
          <TabsContent value="overview">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Car className="h-4 w-4" /> Total Vehicles</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{vehiclesLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : vehicles.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Database className="h-3 w-3" />SAMSARA_VEHICLES</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Users className="h-4 w-4" /> Drivers</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{driversLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : drivers.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Database className="h-3 w-3" />SAMSARA_DRIVERS</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Today's Assignments</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{assignmentsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : assignments.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Database className="h-3 w-3" />SAMSARA_VEHICLE_ASSIGN</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Gauge className="h-4 w-4" /> Devices Online</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">{devicesOnline}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Database className="h-3 w-3" />SAMSARA_DEVICES</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Data Architecture</CardTitle>
                  <CardDescription>How reads and writes flow through Nexus</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
                    <SourceBadge source="Snowflake" />
                    <div>
                      <p className="text-sm font-medium">Primary read source</p>
                      <p className="text-xs text-muted-foreground">16 replicated tables in <code className="bg-muted px-1 rounded">bi_analytics.app_samsara</code>. No rate-limit risk. All historical & fleet-wide queries go here.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30">
                    <SourceBadge source="Live API" />
                    <div>
                      <p className="text-sm font-medium">GPS fallback + writes</p>
                      <p className="text-xs text-muted-foreground">Called only when Snowflake GPS data is older than 4 hours, or for driver create/update operations.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Snowflake Table Map</CardTitle>
                  <CardDescription>Which table feeds each metric</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-xs">
                    {[
                      ["Fleet / Vehicles", "SAMSARA_VEHICLES"],
                      ["Driver Roster", "SAMSARA_DRIVERS"],
                      ["Daily Assignments", "SAMSARA_VEHICLE_ASSIGN"],
                      ["GPS / Location", "SAMSARA_STREAM"],
                      ["Safety Scores", "SAMSARA_DRIVER_SAFETY_SCORES"],
                      ["Harsh Events", "SAMSARA_SAFETY"],
                      ["Speeding", "SAMSARA_SPEEDING"],
                      ["Idling", "SAMSARA_IDLING"],
                      ["Fuel / Energy", "SAMSARA_FUEL_ENERGY_DAILY"],
                      ["Odometer", "SAMSARA_ODOMETER"],
                      ["Maintenance / DTC", "SAMSARA_MAINTENANCE"],
                      ["Device Health", "SAMSARA_DEVICES"],
                      ["Gateway Status", "SAMSARA_GATEWAYS"],
                    ].map(([label, table]) => (
                      <div key={table} className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
                        <span className="text-muted-foreground">{label}</span>
                        <code className="text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded text-[10px]">{table}</code>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── FLEET ─── */}
          <TabsContent value="fleet">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Vehicle Fleet</CardTitle>
                    <CardDescription>From SAMSARA_VEHICLES · {vehicles.length} total</CardDescription>
                  </div>
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search truck #, VIN, driver..." className="pl-8 h-9"
                      value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Truck #</TableHead>
                        <TableHead>Make / Model</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead className="font-mono">VIN</TableHead>
                        <TableHead>Static Driver</TableHead>
                        <TableHead>Vehicle ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vehiclesLoading ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : filteredVehicles.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          {vehicleSearch ? "No vehicles match your search" : "No vehicles in SAMSARA_VEHICLES"}
                        </TableCell></TableRow>
                      ) : filteredVehicles.map((v: any) => (
                        <TableRow key={v.VEHICLE_ID}>
                          <TableCell className="font-mono font-bold text-blue-600 dark:text-blue-400">{v.TRUCK_NUMBER || "—"}</TableCell>
                          <TableCell>{[v.MAKE, v.MODEL].filter(Boolean).join(" ") || "—"}</TableCell>
                          <TableCell>{v.YEAR || "—"}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{v.VIN || "—"}</TableCell>
                          <TableCell>{v.STATICASSIGNEDDRIVER_NAME || <span className="text-muted-foreground italic text-xs">Unassigned</span>}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{v.VEHICLE_ID}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {filteredVehicles.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing {filteredVehicles.length} of {vehicles.length} vehicles</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── DRIVERS ─── */}
          <TabsContent value="drivers">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Driver Roster</CardTitle>
                    <CardDescription>From SAMSARA_DRIVERS · {drivers.length} total</CardDescription>
                  </div>
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search name, LDAP..." className="pl-8 h-9"
                      value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>LDAP</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Assigned Vehicle</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Driver ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driversLoading ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : filteredDrivers.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          {driverSearch ? "No drivers match your search" : "No drivers in SAMSARA_DRIVERS"}
                        </TableCell></TableRow>
                      ) : filteredDrivers.map((d: any) => (
                        <TableRow key={d.DRIVER_ID}>
                          <TableCell className="font-medium">{d.DRIVER_NAME || "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{d.LDAP || "—"}</TableCell>
                          <TableCell className="text-xs">{d.PHONE || "—"}</TableCell>
                          <TableCell>{d.STATICASSIGNEDVEHICLE_NAME || <span className="text-muted-foreground italic text-xs">None</span>}</TableCell>
                          <TableCell><DriverStatusBadge status={d.DRIVER_STATUS} /></TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{d.DRIVER_ID}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {filteredDrivers.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing {filteredDrivers.length} of {drivers.length} drivers</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── ASSIGNMENTS ─── */}
          <TabsContent value="assignments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Daily Vehicle Assignments</CardTitle>
                    <CardDescription>Driver ↔ Vehicle pairings from SAMSARA_VEHICLE_ASSIGN</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <Input type="date" className="w-44 h-9"
                      value={assignmentDate}
                      onChange={(e) => setAssignmentDate(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run Time (UTC)</TableHead>
                        <TableHead>Driver LDAP</TableHead>
                        <TableHead>Vehicle Name</TableHead>
                        <TableHead>VIN</TableHead>
                        <TableHead>Driver ID</TableHead>
                        <TableHead>Vehicle ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignmentsLoading ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : assignments.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          No assignments found for {assignmentDate}
                        </TableCell></TableRow>
                      ) : assignments.map((a: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.RUN_DATE_UTC ? format(new Date(a.RUN_DATE_UTC), "yyyy-MM-dd HH:mm") : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{a.DRIVER_LDAP || "—"}</TableCell>
                          <TableCell className="font-mono font-bold">{a.VEHICLE_NAME || "—"}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{a.VIN || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.DRIVER_ID || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.VEHICLE_ID || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{assignments.length} assignment records for {assignmentDate}</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── SAFETY ─── */}
          <TabsContent value="safety" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-green-600" /> Safety Scores</CardTitle>
                    <div className="relative w-40">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <Input placeholder="Filter driver..." className="pl-7 h-8 text-xs"
                        value={safetySearch} onChange={(e) => setSafetySearch(e.target.value)} />
                    </div>
                  </div>
                  <CardDescription>SAMSARA_DRIVER_SAFETY_SCORES · last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[380px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Driver ID</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>Braking</TableHead>
                          <TableHead>Accel</TableHead>
                          <TableHead>Turning</TableHead>
                          <TableHead>Crashes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {safetyScoresLoading ? (
                          <TableRow><TableCell colSpan={6} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
                        ) : filteredSafetyScores.length === 0 ? (
                          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No safety score data for this period</TableCell></TableRow>
                        ) : filteredSafetyScores.map((s: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs font-mono">{s.DRIVER_ID}</TableCell>
                            <TableCell>
                              <Badge className={s.SAFETY_SCORE >= 90 ? "bg-green-500" : s.SAFETY_SCORE >= 70 ? "bg-amber-500" : "bg-red-500"}>
                                {s.SAFETY_SCORE ?? "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-center">{s.HARSH_BRAKING_COUNT ?? "—"}</TableCell>
                            <TableCell className="text-xs text-center">{s.HARSH_ACCEL_COUNT ?? "—"}</TableCell>
                            <TableCell className="text-xs text-center">{s.HARSH_TURNING_COUNT ?? "—"}</TableCell>
                            <TableCell className="text-xs text-center">{s.CRASH_COUNT ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /> Harsh Driving Events</CardTitle>
                  <CardDescription>SAMSARA_SAFETY · last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border max-h-[380px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time (UTC)</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>Vehicle</TableHead>
                          <TableHead>G-Force</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {safetyEventsLoading ? (
                          <TableRow><TableCell colSpan={4} className="text-center py-6"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
                        ) : safetyEvents.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">No harsh events in the last 30 days</TableCell></TableRow>
                        ) : safetyEvents.map((e: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs text-muted-foreground">
                              {e.TIME_UTC ? format(new Date(e.TIME_UTC), "MM/dd HH:mm") : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">{(e.LABEL || "—").replace(/_/g, " ")}</Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">{e.VEHICLE_ID || "—"}</TableCell>
                            <TableCell className="text-xs">{e.MAX_ACCEL_GFORCE != null ? `${Number(e.MAX_ACCEL_GFORCE).toFixed(2)}g` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── OPERATIONS ─── */}
          <TabsContent value="operations" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Fuel Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Fuel className="h-4 w-4 text-orange-500" /> Fuel / Energy</CardTitle>
                  <CardDescription className="text-xs">Top consumers · last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  {fuelLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : fuelByVehicle.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No fuel data available</p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {fuelByVehicle.map((v: any) => {
                        const max = fuelByVehicle[0]?.total || 1;
                        const pct = Math.round((v.total / max) * 100);
                        return (
                          <div key={v.VEHICLE_ID} className="space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-mono truncate max-w-[120px]">{v.VEHICLE_ID}</span>
                              <span className="text-xs font-medium">{v.total.toFixed(1)} gal</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Speeding Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Zap className="h-4 w-4 text-red-500" /> Speeding Events</CardTitle>
                  <CardDescription className="text-xs">By severity · last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  {speedingLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : speedingData.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No speeding events</p>
                  ) : (
                    <div className="space-y-4 mt-1">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {["High", "Medium", "Low"].map((lvl) => (
                          <div key={lvl} className={`rounded-lg p-2 ${lvl === "High" ? "bg-red-50 dark:bg-red-950/20" : lvl === "Medium" ? "bg-amber-50 dark:bg-amber-950/20" : "bg-yellow-50 dark:bg-yellow-950/20"}`}>
                            <div className={`text-xl font-bold ${lvl === "High" ? "text-red-600" : lvl === "Medium" ? "text-amber-600" : "text-yellow-600"}`}>
                              {speedingSeverity[lvl] || 0}
                            </div>
                            <div className="text-xs text-muted-foreground">{lvl}</div>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground text-center">
                        {speedingData.length} total events
                      </div>
                      <div className="rounded-md border max-h-[200px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Asset</TableHead>
                              <TableHead className="text-xs">Max MPH</TableHead>
                              <TableHead className="text-xs">Limit</TableHead>
                              <TableHead className="text-xs">Severity</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {speedingData.slice(0, 20).map((s: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{s.ASSETID || "—"}</TableCell>
                                <TableCell className="text-xs">{s.MAXSPEEDMILESPERHOUR ?? "—"}</TableCell>
                                <TableCell className="text-xs">{s.POSTEDSPEEDLIMITMILESPERHOUR ?? "—"}</TableCell>
                                <TableCell><SeverityBadge level={s.SEVERITYLEVEL} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Idling Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" /> Idling</CardTitle>
                  <CardDescription className="text-xs">Top idlers by duration · last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  {idlingLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : idlingByVehicle.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No idling data available</p>
                  ) : (
                    <div className="space-y-2 mt-1">
                      {idlingByVehicle.map((v: any) => {
                        const max = idlingByVehicle[0]?.totalMin || 1;
                        const pct = Math.round((v.totalMin / max) * 100);
                        const hrs = Math.floor(v.totalMin / 60);
                        const mins = Math.round(v.totalMin % 60);
                        return (
                          <div key={v.VEHICLE_ID} className="space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-mono truncate max-w-[110px]">{v.VEHICLE_ID}</span>
                              <div className="text-right">
                                <span className="text-xs font-medium">{hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`}</span>
                                <span className="text-[10px] text-muted-foreground ml-1">({v.totalFuel.toFixed(1)}gal)</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Summary row */}
            {!fuelLoading && !speedingLoading && !idlingLoading && (
              <div className="grid grid-cols-3 gap-4">
                <Card className="bg-orange-50/50 dark:bg-orange-950/10 border-orange-100 dark:border-orange-900/20">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Fuel (30d)</p>
                    <p className="text-xl font-bold text-orange-600">
                      {fuelData.reduce((s: number, r: any) => s + Number(r.FUEL_CONSUMED_GAL || 0), 0).toFixed(0)} gal
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-900/20">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Speeding Events (30d)</p>
                    <p className="text-xl font-bold text-red-600">{speedingData.length}</p>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50/50 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/20">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Idle Fuel Waste (30d)</p>
                    <p className="text-xl font-bold text-blue-600">
                      {idlingData.reduce((s: number, r: any) => s + Number(r.FUEL_CONSUMPTION_GAL || 0), 0).toFixed(1)} gal
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ─── API REFERENCE ─── */}
          <TabsContent value="api">
            <Card>
              <CardHeader>
                <CardTitle>Nexus API Reference</CardTitle>
                <CardDescription>All Samsara-specific backend routes · {API_ROUTES.length} endpoints</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Method</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead className="w-28">Source</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {API_ROUTES.map((route, i) => (
                        <TableRow key={i}>
                          <TableCell><MethodBadge method={route.method} /></TableCell>
                          <TableCell className="font-mono text-xs">{route.path}</TableCell>
                          <TableCell><SourceBadge source={route.source} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{route.desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 p-4 bg-muted rounded-lg flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    All routes require authentication. Snowflake read routes default to the last 30 days for time-series data.
                    GPS staleness threshold is 4 hours — if the newest SAMSARA_STREAM record for a vehicle is older than 4h,
                    the live Samsara API is called as fallback. Live write routes (POST/PATCH) require <strong>SAMSARA_API_TOKEN</strong>{" "}
                    and return 503 gracefully if not configured.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
