import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { useAuth } from "@/hooks/use-auth";
import {
  CheckCircle, XCircle, Loader2, RefreshCw, Search,
  Database, Users, Truck, Activity, Server, Hash,
  AlertTriangle, Clock, Info
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API_ROUTES = [
  { method: "GET",  path: "/api/tpms/status",                       desc: "Integration status — returns configured flag and message" },
  { method: "GET",  path: "/api/tpms/test",                          desc: "Live connectivity test against TPMS auth + API endpoint" },
  { method: "GET",  path: "/api/tpms/techinfo/:enterpriseId",        desc: "Look up tech by Enterprise/LDAP ID (live or cache)" },
  { method: "GET",  path: "/api/tpms/truck/:enterpriseId",           desc: "Get truck assignment for a given enterprise ID" },
  { method: "GET",  path: "/api/tpms/lookup/truck/:truckNumber",     desc: "Reverse-lookup by truck number (cache-only — TPMS API has no truck-number endpoint)" },
  { method: "GET",  path: "/api/tpms/techs-updated-after/:timestamp","desc": "Calls TPMS /techsupdatedafter/:tstamp — ISO 8601 format e.g. 2026-02-27T00:00:00" },
  { method: "PUT",  path: "/api/tpms/techinfo",                      desc: "Update a tech info record in TPMS (live write)" },
  { method: "POST", path: "/api/tpms/temp-truck-assign",             desc: "Create a temporary truck assignment for a tech" },
  { method: "POST", path: "/api/tpms/cache/sync",                    desc: "Trigger full TPMS cache sync (developer only)" },
  { method: "GET",  path: "/api/tpms/cache/sync/progress",           desc: "Poll background sync progress and status" },
  { method: "GET",  path: "/api/tpms/cache/stats",                   desc: "Cache statistics — total, live, cached, stale, error counts" },
  { method: "GET",  path: "/api/tpms/fleet-sync/state",              desc: "Fleet sync state — whether initial sync is complete" },
  { method: "POST", path: "/api/tpms/fleet-sync/start",              desc: "Start initial fleet sync from Holman cache (developer only)" },
];

const METHOD_COLORS: Record<string, string> = {
  GET:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  POST:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  PUT:   "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  PATCH: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "N/A";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return phone;
}

export default function TpmsIntegration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState<any>(null);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{
    configured: boolean;
    message: string;
  }>({
    queryKey: ["/api/tpms/status"],
  });

  const { data: cacheStats, isLoading: cacheStatsLoading, refetch: refetchStats } = useQuery<{
    success: boolean;
    stats: { total: number; live: number; cached: number; error: number; stale: number };
  }>({
    queryKey: ["/api/tpms/cache/stats"],
    enabled: activeTab === "cache" || activeTab === "overview",
  });

  const { data: syncProgress, refetch: refetchProgress } = useQuery<{
    success: boolean;
    progress: {
      isRunning: boolean;
      totalTechs: number;
      processedTechs: number;
      successCount: number;
      errorCount: number;
      skippedCount: number;
      startedAt: string | null;
      estimatedCompletionAt: string | null;
    };
  }>({
    queryKey: ["/api/tpms/cache/sync/progress"],
    enabled: activeTab === "cache",
    refetchInterval: (query) => query.state.data?.progress?.isRunning ? 3000 : false,
  });

  const { data: fleetSyncState, isLoading: fleetStateLoading } = useQuery<{
    success: boolean;
    state: {
      initialSyncComplete: boolean;
      status: string;
      vehiclesSynced: number;
      totalVehiclesToSync: number;
      vehiclesWithAssignments: number;
      lastSyncAt: string | null;
    } | null;
  }>({
    queryKey: ["/api/tpms/fleet-sync/state"],
    enabled: activeTab === "cache",
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tpms/test", { credentials: "include" });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message || (data.success ? "TPMS API is reachable" : "Could not reach TPMS API"),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: () => {
      toast({ title: "Test Failed", description: "Could not reach TPMS API", variant: "destructive" });
    },
  });

  const lookupMutation = useMutation({
    mutationFn: async (input: string) => {
      const trimmed = input.trim();
      const isNumeric = /^\d+$/.test(trimmed);
      const lookupId = isNumeric ? trimmed.padStart(6, "0") : trimmed;
      const url = isNumeric
        ? `/api/tpms/lookup/truck/${lookupId}`
        : `/api/tpms/techinfo/${lookupId}`;
      const response = await fetch(url, { credentials: "include" });
      return response.json();
    },
    onSuccess: (data) => {
      setLookupResult(data);
      if (!data.success) {
        toast({ title: "No Record Found", description: data.error || "No matching tech or truck found", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Lookup Failed", description: "Error contacting TPMS API", variant: "destructive" });
    },
  });

  const cacheSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/tpms/cache/sync");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Cache Sync Started" : "Sync Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/cache/sync/progress"] });
    },
    onError: () => {
      toast({ title: "Sync Failed", description: "Could not start cache sync", variant: "destructive" });
    },
  });

  const fleetSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/tpms/fleet-sync/start");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Fleet Sync Started" : "Sync Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/fleet-sync/state"] });
    },
    onError: () => {
      toast({ title: "Sync Failed", description: "Could not start fleet sync", variant: "destructive" });
    },
  });

  const isDeveloper = user?.role === "developer";
  const stats = cacheStats?.stats;
  const progress = syncProgress?.progress;
  const fleetState = fleetSyncState?.state;

  return (
    <div className="flex flex-col h-screen">
      <TopBar title="TPMS Integration" />
      <MainContent>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackButton />
              <div>
                <h1 className="text-2xl font-bold">TPMS API Integration</h1>
                <p className="text-muted-foreground text-sm">
                  Technician Parts Management System — tech and truck assignment lookup
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {statusLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : status?.configured ? (
                <Badge className="flex items-center gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-none">
                  <CheckCircle className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Not Configured
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnectionMutation.mutate()}
                disabled={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Activity className="h-4 w-4 mr-1" />
                )}
                Test Connection
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { refetchStatus(); refetchStats(); }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="lookup">Tech Lookup</TabsTrigger>
              <TabsTrigger value="cache">Cache &amp; Sync</TabsTrigger>
              <TabsTrigger value="api">API Reference</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      Connection Status
                    </CardTitle>
                    <CardDescription>
                      TPMS API authentication and endpoint reachability
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">API Status</span>
                      <span className={`text-sm font-medium ${status?.configured ? "text-green-500" : "text-red-500"}`}>
                        {statusLoading ? "Checking..." : status?.configured ? "Healthy" : "Not Configured"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Auth Method</span>
                      <span className="text-sm font-medium">Basic Auth + Bearer Token</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">Cache Strategy</span>
                      <span className="text-sm font-medium">Live → Cached (24h TTL)</span>
                    </div>
                    {status?.message && (
                      <div className="p-2 bg-muted rounded text-xs text-muted-foreground">
                        {status.message}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Cache Statistics
                    </CardTitle>
                    <CardDescription>
                      Current state of the local TPMS assignment cache
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {cacheStatsLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading stats...
                      </div>
                    ) : stats ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-muted rounded-lg text-center">
                          <p className="text-2xl font-bold">{(stats.total ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Total Cached</p>
                        </div>
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{(stats.live ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Live (fresh)</p>
                        </div>
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{(stats.cached ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Cached</p>
                        </div>
                        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-center">
                          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{(stats.stale ?? 0).toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Stale (&gt;24h)</p>
                        </div>
                        {(stats.error ?? 0) > 0 && (
                          <div className="col-span-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{(stats.error ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">Errors</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No cache data available</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Available Endpoints
                  </CardTitle>
                  <CardDescription>
                    TPMS API operations exposed through Nexus
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[
                      { icon: <Users className="h-4 w-4" />, label: "Tech Lookup", desc: "Live TPMS API by Enterprise/LDAP ID" },
                      { icon: <Truck className="h-4 w-4" />, label: "Truck Lookup", desc: "Cache-only — TPMS API has no truck-number endpoint" },
                      { icon: <Database className="h-4 w-4" />, label: "Cache Sync", desc: "Sync all tech assignments from API" },
                      { icon: <Activity className="h-4 w-4" />, label: "Fleet Sync", desc: "Initial sync from Holman fleet cache" },
                      { icon: <Hash className="h-4 w-4" />, label: "Update Tech", desc: "PUT tech info back to TPMS" },
                      { icon: <Clock className="h-4 w-4" />, label: "Temp Assignment", desc: "Temporary truck-to-tech assignment" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-3 p-3 rounded-lg border">
                        <div className="text-orange-500">{item.icon}</div>
                        <div>
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tech Lookup Tab */}
            <TabsContent value="lookup" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Tech &amp; Truck Lookup
                  </CardTitle>
                  <CardDescription>
                    Enter an <strong>Enterprise/LDAP ID</strong> (e.g. <code className="text-xs bg-muted px-1 rounded">ABC1234</code>) to call the TPMS live API, or a numeric <strong>Truck Number</strong> (e.g. <code className="text-xs bg-muted px-1 rounded">123456</code>) for a cache-only lookup. The TPMS API only accepts LDAP IDs — truck number lookups resolve from the local cache populated during cache sync.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enterprise ID or Truck Number"
                      value={lookupInput}
                      onChange={(e) => setLookupInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && lookupInput.trim()) {
                          lookupMutation.mutate(lookupInput);
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => lookupMutation.mutate(lookupInput)}
                      disabled={!lookupInput.trim() || lookupMutation.isPending || !status?.configured}
                    >
                      {lookupMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4 mr-1" />
                      )}
                      Lookup
                    </Button>
                  </div>

                  {!status?.configured && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      TPMS API is not configured. Lookups may fall back to the local cache only.
                    </div>
                  )}

                  {lookupResult && (
                    <div className="space-y-4">
                      {lookupResult.success ? (
                        <>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium text-green-600 dark:text-green-400">Record found</span>
                            {lookupResult.source && (
                              <Badge variant="outline" className="text-xs">
                                Source: {lookupResult.source}
                                {lookupResult.cacheAge != null ? ` (${lookupResult.cacheAge.toFixed(1)}h ago)` : ""}
                              </Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Identity */}
                            <Card className="border-orange-200 dark:border-orange-900/40">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                  <Users className="h-3.5 w-3.5 text-orange-500" />
                                  Identity
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">Full Name</span>
                                  <span className="font-medium">
                                    {lookupResult.techInfo?.firstName || lookupResult.data?.firstName} {lookupResult.techInfo?.lastName || lookupResult.data?.lastName}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">Employee ID</span>
                                  <span className="font-medium font-mono">{lookupResult.techInfo?.techId || lookupResult.data?.techId || "N/A"}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">Enterprise ID</span>
                                  <span className="font-medium font-mono">{lookupResult.techInfo?.ldapId || lookupResult.data?.ldapId || "N/A"}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">District</span>
                                  <span className="font-medium">{lookupResult.techInfo?.districtNo || lookupResult.data?.districtNo || "N/A"}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-muted-foreground">Phone</span>
                                  <span className="font-medium">{formatPhoneNumber(lookupResult.techInfo?.contactNo || lookupResult.data?.contactNo)}</span>
                                </div>
                              </CardContent>
                            </Card>

                            {/* Truck Assignment */}
                            <Card className="border-orange-200 dark:border-orange-900/40">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                  <Truck className="h-3.5 w-3.5 text-orange-500" />
                                  Truck Assignment
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-1 text-sm">
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">Truck No.</span>
                                  <span className="font-medium font-mono text-lg">
                                    {lookupResult.techInfo?.truckNo || lookupResult.data?.truckNo || lookupResult.truckNo || "Unassigned"}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                  <span className="text-muted-foreground">Manager LDAP</span>
                                  <span className="font-medium font-mono">
                                    {lookupResult.techInfo?.techManagerLdapId || lookupResult.data?.techManagerLdapId || "N/A"}
                                  </span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="text-muted-foreground">Email</span>
                                  <span className="font-medium text-xs">
                                    {lookupResult.techInfo?.email || lookupResult.data?.email || "N/A"}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          </div>

                          {/* Addresses */}
                          {(lookupResult.techInfo?.addresses || lookupResult.data?.addresses)?.length > 0 && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm">Addresses</CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="space-y-3">
                                  {(lookupResult.techInfo?.addresses || lookupResult.data?.addresses).map((addr: any, idx: number) => (
                                    <div key={idx} className="p-3 bg-muted rounded-lg text-sm">
                                      <Badge variant="outline" className="text-xs mb-2">{addr.addressType}</Badge>
                                      <p>{addr.shipToName}</p>
                                      <p>{addr.addrLine1}{addr.addrLine2 ? `, ${addr.addrLine2}` : ""}</p>
                                      <p>{addr.city}, {addr.stateCd} {addr.zipCd}</p>
                                    </div>
                                  ))}
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 p-4 border border-destructive/30 bg-destructive/10 rounded-lg text-sm text-destructive">
                          <XCircle className="h-4 w-4 shrink-0" />
                          {lookupResult.error || "No record found for the provided identifier."}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cache & Sync Tab */}
            <TabsContent value="cache" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Cache Stats */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Cache Statistics
                    </CardTitle>
                    <CardDescription>Local assignment cache populated from live TPMS API calls</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {cacheStatsLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                      </div>
                    ) : stats ? (
                      <>
                        <Table>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Total cached records</TableCell>
                              <TableCell className="font-bold text-right">{(stats.total ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Live / Fresh (&lt;24h)</TableCell>
                              <TableCell className="text-green-600 font-bold text-right">{(stats.live ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Cached</TableCell>
                              <TableCell className="text-blue-600 font-bold text-right">{(stats.cached ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Stale (&gt;24h old)</TableCell>
                              <TableCell className="text-amber-600 font-bold text-right">{(stats.stale ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Errors</TableCell>
                              <TableCell className={`font-bold text-right ${(stats.error ?? 0) > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                {(stats.error ?? 0).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        <Button variant="outline" size="sm" onClick={() => refetchStats()}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Refresh Stats
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No cache data available</p>
                    )}
                  </CardContent>
                </Card>

                {/* Fleet Sync State */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Fleet Sync State
                    </CardTitle>
                    <CardDescription>State of the initial fleet-wide TPMS sync from Holman cache</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {fleetStateLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                      </div>
                    ) : fleetState ? (
                      <>
                        <Table>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Initial Sync</TableCell>
                              <TableCell className="text-right">
                                {fleetState.initialSyncComplete ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-none">Complete</Badge>
                                ) : (
                                  <Badge variant="outline">Pending</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Status</TableCell>
                              <TableCell className="font-medium text-right capitalize">{fleetState.status}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Vehicles Synced</TableCell>
                              <TableCell className="font-bold text-right">{(fleetState.vehiclesSynced ?? 0).toLocaleString()} / {(fleetState.totalVehiclesToSync ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">With Assignments</TableCell>
                              <TableCell className="font-bold text-right">{(fleetState.vehiclesWithAssignments ?? 0).toLocaleString()}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="text-muted-foreground">Last Sync</TableCell>
                              <TableCell className="text-right text-sm">
                                {fleetState.lastSyncAt ? new Date(fleetState.lastSyncAt).toLocaleString() : "Never"}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        {isDeveloper && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fleetSyncMutation.mutate()}
                            disabled={fleetSyncMutation.isPending || fleetState.status === "syncing"}
                          >
                            {fleetSyncMutation.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            {fleetState.status === "syncing" ? "Sync Running..." : "Start Fleet Sync"}
                          </Button>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No fleet sync state available</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Cache Sync */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Cache Sync (All Techs)
                  </CardTitle>
                  <CardDescription>
                    Sync tech assignments from live TPMS API into the local cache. Skips records updated in the last 24 hours.
                    {!isDeveloper && <span className="text-amber-600 ml-1">— Developer role required to trigger.</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {progress ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {progress.isRunning ? "Sync in progress..." : "Last sync results"}
                        </span>
                        {progress.isRunning && (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-none">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Running
                          </Badge>
                        )}
                      </div>
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableCell className="text-muted-foreground">Processed</TableCell>
                            <TableCell className="font-bold text-right">{(progress.processedTechs ?? 0).toLocaleString()} / {(progress.totalTechs ?? 0).toLocaleString()}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="text-muted-foreground">Succeeded</TableCell>
                            <TableCell className="text-green-600 font-bold text-right">{(progress.successCount ?? 0).toLocaleString()}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="text-muted-foreground">Skipped (recent)</TableCell>
                            <TableCell className="text-muted-foreground font-bold text-right">{(progress.skippedCount ?? 0).toLocaleString()}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="text-muted-foreground">Errors</TableCell>
                            <TableCell className={`font-bold text-right ${(progress.errorCount ?? 0) > 0 ? "text-red-600" : ""}`}>{(progress.errorCount ?? 0).toLocaleString()}</TableCell>
                          </TableRow>
                          {progress.startedAt && (
                            <TableRow>
                              <TableCell className="text-muted-foreground">Started</TableCell>
                              <TableCell className="text-right text-sm">{new Date(progress.startedAt).toLocaleString()}</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                      {progress.isRunning && (
                        <Button variant="outline" size="sm" onClick={() => refetchProgress()}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sync has been run in this session.</p>
                  )}

                  {isDeveloper && (
                    <Button
                      onClick={() => cacheSyncMutation.mutate()}
                      disabled={cacheSyncMutation.isPending || progress?.isRunning}
                      variant="default"
                      size="sm"
                    >
                      {cacheSyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      {progress?.isRunning ? "Sync Running..." : "Start Cache Sync"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* API Reference Tab */}
            <TabsContent value="api" className="mt-4 space-y-4">
              {/* Nexus Routes */}
              <Card>
                <CardHeader>
                  <CardTitle>Nexus API Reference</CardTitle>
                  <CardDescription>
                    All TPMS-related routes exposed through the Nexus backend
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Method</TableHead>
                        <TableHead>Path</TableHead>
                        <TableHead className="hidden md:table-cell">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {API_ROUTES.map((route) => (
                        <TableRow key={`${route.method}-${route.path}`}>
                          <TableCell>
                            <Badge className={`${METHOD_COLORS[route.method]} border-none text-xs font-mono`}>
                              {route.method}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{route.path}</code>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {route.desc}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Upstream TPMS API */}
              <Card>
                <CardHeader>
                  <CardTitle>Upstream TPMS API</CardTitle>
                  <CardDescription>
                    Actual TPMS API endpoints that Nexus proxies — from the official Postman collection
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Method</TableHead>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { method: "GET",  path: "{{auth_endpoint}}/token",       notes: "Auth — Basic Authorization header, returns XML with <ns2:token>" },
                        { method: "GET",  path: "/techinfo/:ldapId",              notes: "Tech lookup by LDAP/Enterprise ID only (e.g. JELMORE). Bearer token required." },
                        { method: "GET",  path: "/techsupdatedafter/:tstamp",     notes: "List techs updated after timestamp (ISO 8601, e.g. 2026-02-27T00:00:00). Bearer token required." },
                        { method: "PUT",  path: "/techinfo",                      notes: "Update tech info record. JSON body. Bearer token required." },
                        { method: "POST", path: "/temptruckassign",               notes: "Temp truck assignment. Body: {ldapId, distNo, truckNo}. Bearer token required." },
                      ].map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Badge className={`${METHOD_COLORS[r.method]} border-none text-xs font-mono`}>{r.method}</Badge>
                          </TableCell>
                          <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.path}</code></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.notes}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-lg flex items-start gap-2 text-sm">
                    <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <span className="text-amber-700 dark:text-amber-400">
                      The TPMS API has <strong>no truck-number lookup endpoint</strong>. All truck → tech reverse lookups must use the local Nexus cache,
                      which is populated by calling <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1 rounded">/techinfo/:ldapId</code> for each tech
                      during cache sync or the <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1 rounded">/techsupdatedafter</code> poll.
                    </span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </MainContent>
    </div>
  );
}
