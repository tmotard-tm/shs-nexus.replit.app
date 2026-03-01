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
  CheckCircle, XCircle, Loader2, RefreshCw, Search, List,
  Database, Users, Car, MapPin, Shield, Activity,
  Fuel, Zap, Clock, AlertTriangle, Info
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";

const API_ROUTES = [
  { method: "GET",    source: "Status",    path: "/api/samsara/status",              desc: "Integration status (Snowflake + Live API flags)" },
  { method: "GET",    source: "Status",    path: "/api/samsara/test",                desc: "Count Snowflake vehicles + live API ping" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/vehicles",            desc: "List vehicles from SAMSARA_VEHICLES" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/vehicles/:vehicleId", desc: "Single vehicle by Samsara ID" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/drivers",             desc: "List drivers from SAMSARA_DRIVERS" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/drivers/:driverId",   desc: "Single driver by Samsara driver ID" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/assignments",         desc: "Daily assignments from SAMSARA_VEHICLE_ASSIGN" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/safety-scores",       desc: "Driver safety scores" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/odometer",            desc: "Vehicle odometer readings" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/trips",               desc: "Trip history" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/maintenance",         desc: "DTC / maintenance alerts" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/fuel",                desc: "Fuel & energy daily summaries" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/safety-events",       desc: "Harsh driving events" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/speeding",            desc: "Speeding events by severity" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/idling",              desc: "Idling events with fuel waste" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/devices",             desc: "Device health from SAMSARA_DEVICES" },
  { method: "GET",    source: "Snowflake", path: "/api/samsara/gateways",            desc: "Gateway connectivity from SAMSARA_GATEWAYS" },
  { method: "GET",    source: "Both",      path: "/api/samsara/vehicle/:vehicleName","desc": "Single vehicle GPS (Snowflake + live staleness fallback)" },
  { method: "POST",   source: "Both",      path: "/api/samsara/vehicles/batch",      desc: "Batch GPS lookup for multiple vehicles" },
  { method: "GET",    source: "Live API",  path: "/api/samsara/live/vehicles",       desc: "Full fleet from Samsara API (all pages, tag-filtered)" },
  { method: "GET",    source: "Live API",  path: "/api/samsara/live/locations",      desc: "Real-time GPS for all vehicles (all pages)" },
  { method: "GET",    source: "Live API",  path: "/api/samsara/live/drivers",        desc: "All drivers direct from Samsara API (all pages)" },
  { method: "POST",   source: "Live API",  path: "/api/samsara/drivers",             desc: "Create driver in Samsara (live write)" },
  { method: "PATCH",  source: "Live API",  path: "/api/samsara/drivers/:driverId",   desc: "Update driver in Samsara (live write)" },
];

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    Snowflake: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Live API": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    Both: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    Status: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return <Badge className={`${colors[source] || ""} border-none`}>{source}</Badge>;
}

export default function SamsaraIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    snowflake: boolean;
    liveApi: boolean;
    groupId: string | null;
    orgId: string | null;
    message: string;
  }>({
    queryKey: ["/api/samsara/status"],
  });

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/vehicles"],
    enabled: activeTab === "fleet" || activeTab === "overview",
  });

  const { data: drivers = [], isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/drivers"],
    enabled: activeTab === "drivers" || activeTab === "overview",
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/assignments"],
    enabled: activeTab === "assignments" || activeTab === "overview",
  });

  const { data: safetyScores = [], isLoading: safetyLoading } = useQuery<any[]>({
    queryKey: ["/api/samsara/safety-scores"],
    enabled: activeTab === "safety",
  });

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
              <p className="text-muted-foreground text-sm">Snowflake-first telematics data pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-1 mr-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Snowflake:</span>
                {status?.snowflake ? <Badge variant="default" className="bg-green-500">Connected</Badge> : <Badge variant="destructive">Disconnected</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Live API:</span>
                {status?.liveApi ? <Badge variant="default" className="bg-green-500">Active</Badge> : <Badge variant="secondary">Not Configured</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Group ID:</span>
                {status?.groupId ? <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:text-blue-400">Set</Badge> : <Badge variant="secondary" className="text-xs">Not Set</Badge>}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 grid grid-cols-4 md:grid-cols-7 h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="fleet">Fleet</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="api">API Ref</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Vehicles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{vehiclesLoading ? "..." : vehicles.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Database className="h-3 w-3" /> from SAMSARA_VEHICLES
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active Drivers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{driversLoading ? "..." : drivers.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Database className="h-3 w-3" /> from SAMSARA_DRIVERS
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Today's Assignments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{assignmentsLoading ? "..." : assignments.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Database className="h-3 w-3" /> from SAMSARA_VEHICLE_ASSIGN
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">System Health</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">Healthy</div>
                  <p className="text-xs text-muted-foreground mt-1">Snowflake sync active</p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Architecture Legend</CardTitle>
                <CardDescription>How data flows through the Samsara integration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-6 items-start">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <SourceBadge source="Snowflake" />
                      <span className="text-sm">Primary source for all historical and fleet-wide read operations.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SourceBadge source="Live API" />
                      <span className="text-sm">Used for write operations and real-time GPS fallback.</span>
                    </div>
                  </div>
                  <div className="bg-muted p-4 rounded-lg text-xs font-mono space-y-1">
                    <p className="text-muted-foreground">// Staleness Threshold</p>
                    <p>GPS_THRESHOLD = 4 hours</p>
                    <p>SYNC_INTERVAL = 24 hours (Snowflake)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fleet">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Vehicle Fleet</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Search vehicles..." 
                      className="pl-8 h-9" 
                      value={vehicleSearch}
                      onChange={(e) => setVehicleSearch(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Truck #</TableHead>
                        <TableHead>Make/Model</TableHead>
                        <TableHead>VIN</TableHead>
                        <TableHead>Driver</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vehiclesLoading ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : vehicles.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No vehicles found in SAMSARA_VEHICLES</TableCell></TableRow>
                      ) : vehicles.filter((v: any) => 
                        v.truckNumber?.toLowerCase().includes(vehicleSearch.toLowerCase()) || 
                        v.vin?.toLowerCase().includes(vehicleSearch.toLowerCase())
                      ).map((v: any) => (
                        <TableRow key={v.id}>
                          <TableCell className="font-mono font-bold">{v.truckNumber}</TableCell>
                          <TableCell>{v.make} {v.model} ({v.year})</TableCell>
                          <TableCell className="text-xs font-mono">{v.vin}</TableCell>
                          <TableCell>{v.staticDriverName || "Unassigned"}</TableCell>
                          <TableCell><Badge variant="outline">Active</Badge></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm"><MapPin className="h-4 w-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drivers">
             <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Driver Roster</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Search drivers..." 
                      className="pl-8 h-9" 
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                    />
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driversLoading ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : drivers.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No drivers found in SAMSARA_DRIVERS</TableCell></TableRow>
                      ) : drivers.filter((d: any) => 
                        d.name?.toLowerCase().includes(driverSearch.toLowerCase()) || 
                        d.ldap?.toLowerCase().includes(driverSearch.toLowerCase())
                      ).map((d: any) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell className="font-mono text-xs">{d.ldap}</TableCell>
                          <TableCell className="text-xs">{d.phone}</TableCell>
                          <TableCell>{d.staticVehicleName || "None"}</TableCell>
                          <TableCell>
                            <Badge className={d.status === 'active' ? 'bg-green-500' : 'bg-slate-500'}>
                              {d.status || 'unknown'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="assignments">
            <Card>
              <CardHeader>
                <CardTitle>Daily Vehicle Assignments</CardTitle>
                <CardDescription>Pairings synced from SAMSARA_VEHICLE_ASSIGN for {format(new Date(), 'MMM dd, yyyy')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time (UTC)</TableHead>
                        <TableHead>Driver</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>VIN Match</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignmentsLoading ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                      ) : assignments.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No assignments found for today</TableCell></TableRow>
                      ) : assignments.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs text-muted-foreground">{a.runDateUtc ? format(new Date(a.runDateUtc), 'HH:mm:ss') : "N/A"}</TableCell>
                          <TableCell>{a.driverName} <span className="text-xs text-muted-foreground">({a.driverLdap})</span></TableCell>
                          <TableCell className="font-mono font-bold text-blue-600">{a.vehicleName}</TableCell>
                          <TableCell><CheckCircle className="h-4 w-4 text-green-500" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="safety" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-green-600" /> Safety Scores</CardTitle>
                </CardHeader>
                <CardContent>
                   <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Driver</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>Distance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                         {safetyLoading ? (
                            <TableRow><TableCell colSpan={3} className="text-center py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
                          ) : safetyScores.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No score data</TableCell></TableRow>
                          ) : safetyScores.map((s: any) => (
                            <TableRow key={s.id}>
                              <TableCell className="text-sm">{s.driverName || s.driverId}</TableCell>
                              <TableCell>
                                <Badge className={s.safetyScore > 90 ? 'bg-green-500' : 'bg-amber-500'}>{s.safetyScore}</Badge>
                              </TableCell>
                              <TableCell className="text-xs">{s.distanceDrivenMiles} mi</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /> Recent Harsh Events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    Connect SAMSARA_SAFETY to view events
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="operations" className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
               <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Fuel className="h-4 w-4" /> Fuel/Energy</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Top fuel consumers (SAMSARA_FUEL_ENERGY_DAILY)</p>
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-xs"><span>No data available</span></div>
                  </div>
                </CardContent>
              </Card>
               <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Zap className="h-4 w-4" /> Speeding</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Severity breakdown (SAMSARA_SPEEDING)</p>
                   <div className="mt-4 flex items-center justify-center h-20 text-xs text-muted-foreground italic">
                    Feature coming soon
                  </div>
                </CardContent>
              </Card>
               <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4" /> Idling</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Top idlers (SAMSARA_IDLING)</p>
                   <div className="mt-4 flex items-center justify-center h-20 text-xs text-muted-foreground italic">
                    Feature coming soon
                  </div>
                </CardContent>
              </Card>
             </div>
          </TabsContent>

          <TabsContent value="api">
            <Card>
              <CardHeader>
                <CardTitle>Nexus API Reference</CardTitle>
                <CardDescription>Samsara-specific endpoints registered in the backend</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {API_ROUTES.map((route, i) => (
                        <TableRow key={i}>
                          <TableCell><Badge variant="outline">{route.method}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{route.path}</TableCell>
                          <TableCell><SourceBadge source={route.source} /></TableCell>
                          <TableCell className="text-sm">{route.desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-6 p-4 bg-muted rounded-lg flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-500 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    All Snowflake read routes require <strong>requireAuth</strong>. 
                    Live API write routes require a valid <strong>SAMSARA_API_TOKEN</strong> configured in environment variables. 
                    GPS fallback logic prioritizes Snowflake and only hits the Live API if data is older than 4 hours.
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
