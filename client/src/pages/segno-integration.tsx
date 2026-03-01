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
  Database, Users, UserPlus, TestTube, AlertCircle, Activity,
  Hash, Calendar, Package, Clock, Filter
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const ONBOARDING_FIELDS = [
  { key: "name", label: "Name" },
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "district", label: "District" },
  { key: "job_code", label: "Job Code" },
  { key: "employee_id", label: "Employee ID" },
  { key: "enterprise_id", label: "Enterprise ID" },
  { key: "tech_id", label: "Tech ID" },
  { key: "type_of_hire", label: "Type of Hire" },
  { key: "start_date", label: "Start Date" },
  { key: "proposed_route_start_date", label: "Proposed Route Start" },
  { key: "date_entered", label: "Date Entered" },
];

const EVENT_STATUSES = ["pending", "completed", "in_review", "cancelled"];

const ALL_NEXUS_ROUTES = [
  { method: "GET",    module: "Connection",   path: "/api/segno/status",                           label: "Connection Status" },
  { method: "POST",   module: "Connection",   path: "/api/segno/test",                             label: "Test Connection" },
  { method: "GET",    module: "OnBoarding",   path: "/api/segno/onboarding",                       label: "List OnBoarding Records" },
  { method: "GET",    module: "OnBoarding",   path: "/api/segno/onboarding/search?q=",             label: "Search OnBoarding" },
  { method: "GET",    module: "OnBoarding",   path: "/api/segno/onboarding/by-employee/:id",       label: "Lookup by Employee ID" },
  { method: "GET",    module: "OnBoarding",   path: "/api/segno/onboarding/by-enterprise/:id",     label: "Lookup by Enterprise ID" },
  { method: "GET",    module: "OnBoarding",   path: "/api/segno/onboarding/:id",                   label: "Get OnBoarding by Record ID" },
  { method: "POST",   module: "OnBoarding",   path: "/api/segno/onboarding",                       label: "Create OnBoarding Record" },
  { method: "PATCH",  module: "OnBoarding",   path: "/api/segno/onboarding/:id",                   label: "Update OnBoarding Record" },
  { method: "DELETE", module: "OnBoarding",   path: "/api/segno/onboarding/:id",                   label: "Soft-Delete OnBoarding Record" },
  { method: "GET",    module: "FP_events",    path: "/api/segno/events",                           label: "List Events" },
  { method: "GET",    module: "FP_events",    path: "/api/segno/events/search?q=&status=",         label: "Search / Filter Events" },
  { method: "GET",    module: "FP_events",    path: "/api/segno/events/by-status/:status",         label: "Events by Status" },
  { method: "GET",    module: "FP_events",    path: "/api/segno/events/:id",                       label: "Get Event by ID" },
  { method: "POST",   module: "FP_events",    path: "/api/segno/events",                           label: "Create Event" },
  { method: "PATCH",  module: "FP_events",    path: "/api/segno/events/:id",                       label: "Update Event" },
  { method: "DELETE", module: "FP_events",    path: "/api/segno/events/:id",                       label: "Soft-Delete Event" },
  { method: "GET",    module: "Asset_Order",  path: "/api/segno/asset-orders",                     label: "List Asset Orders" },
  { method: "GET",    module: "Asset_Order",  path: "/api/segno/asset-orders/search?q=",           label: "Search Asset Orders" },
  { method: "GET",    module: "Asset_Order",  path: "/api/segno/asset-orders/:id",                 label: "Get Asset Order by ID" },
  { method: "POST",   module: "Asset_Order",  path: "/api/segno/asset-orders",                     label: "Create Asset Order" },
  { method: "PATCH",  module: "Asset_Order",  path: "/api/segno/asset-orders/:id",                 label: "Update Asset Order" },
  { method: "DELETE", module: "Asset_Order",  path: "/api/segno/asset-orders/:id",                 label: "Soft-Delete Asset Order" },
  { method: "GET",    module: "Users",        path: "/api/segno/users",                            label: "List Users" },
  { method: "GET",    module: "Users",        path: "/api/segno/users/search?q=",                  label: "Search Users" },
  { method: "GET",    module: "Users",        path: "/api/segno/users/:id",                        label: "Get User by ID" },
];

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    POST:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PATCH:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    DELETE: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold ${colors[method] || colors.GET}`}>
      {method}
    </span>
  );
}

function ModuleBadge({ module }: { module: string }) {
  const colors: Record<string, string> = {
    Connection:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    OnBoarding:  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    FP_events:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    Asset_Order: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    Users:       "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[module] || colors.Connection}`}>
      {module}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const colors: Record<string, string> = {
    pending:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    completed:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    cancelled:  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    in_review:  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[status] || "bg-slate-100 text-slate-700"}`}>
      {status}
    </span>
  );
}

function RecordDetail({ record, fields }: { record: Record<string, any>; fields: { key: string; label: string }[] }) {
  const allKeys = fields.length > 0 ? fields : Object.keys(record).filter(k => k !== 'id').map(k => ({ key: k, label: k }));
  return (
    <div className="rounded-md border p-3 space-y-1.5 bg-muted/30 text-sm">
      {allKeys.map(({ key, label }) => {
        const val = record[key];
        if (val === null || val === undefined || val === '') return null;
        return (
          <div key={key} className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground min-w-[160px] text-xs">{label}</span>
            <span className="text-xs font-mono break-all">{String(val)}</span>
          </div>
        );
      })}
      {record.id && (
        <div className="flex items-start gap-2 border-t pt-1.5 mt-1">
          <span className="font-medium text-muted-foreground min-w-[160px] text-xs">Record ID</span>
          <span className="text-xs font-mono text-muted-foreground">{record.id}</span>
        </div>
      )}
    </div>
  );
}

export default function SegnoIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  // OnBoarding lookup state
  const [obSearchQuery, setObSearchQuery] = useState("");
  const [obSearchResults, setObSearchResults] = useState<any[]>([]);
  const [obSearchType, setObSearchType] = useState<"name" | "employee" | "enterprise" | "record">("name");
  const [obSelectedRecord, setObSelectedRecord] = useState<any>(null);

  // Events state
  const [eventsStatusFilter, setEventsStatusFilter] = useState("");
  const [eventsNameFilter, setEventsNameFilter] = useState("");
  const [eventsResults, setEventsResults] = useState<any[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  // Asset Orders state
  const [aoSearchQuery, setAoSearchQuery] = useState("");
  const [aoResults, setAoResults] = useState<any[]>([]);
  const [aoLoaded, setAoLoaded] = useState(false);

  // OnBoarding list state
  const [onboardingOffset, setOnboardingOffset] = useState(0);
  const [onboardingFilter, setOnboardingFilter] = useState("");

  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/segno/status"],
  });

  const { data: onboardingData, isLoading: onboardingLoading, refetch: refetchOnboarding } = useQuery<{
    success: boolean; records: any[]; totalCount: number; nextOffset: number;
  }>({
    queryKey: ["/api/segno/onboarding", onboardingOffset],
    queryFn: () => fetch(`/api/segno/onboarding?offset=${onboardingOffset}&max=100`, { credentials: "include" }).then(r => r.json()),
    enabled: false,
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/segno/test");
      return res.json();
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

  const obSearchMutation = useMutation({
    mutationFn: async ({ type, query }: { type: string; query: string }) => {
      let url: string;
      if (type === "employee") url = `/api/segno/onboarding/by-employee/${encodeURIComponent(query)}`;
      else if (type === "enterprise") url = `/api/segno/onboarding/by-enterprise/${encodeURIComponent(query)}`;
      else if (type === "record") url = `/api/segno/onboarding/${encodeURIComponent(query)}`;
      else url = `/api/segno/onboarding/search?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        if (data.record) { setObSearchResults([data.record]); setObSelectedRecord(data.record); }
        else { setObSearchResults(data.records || []); setObSelectedRecord(null); }
        if ((data.records || [data.record].filter(Boolean)).length === 0) toast({ title: "No Results" });
      } else {
        toast({ title: "Search Failed", description: data.message, variant: "destructive" });
      }
    },
  });

  const eventsSearchMutation = useMutation({
    mutationFn: async ({ name, status }: { name: string; status: string }) => {
      const params = new URLSearchParams();
      if (name) params.set("q", name);
      if (status) params.set("status", status);
      const url = `/api/segno/events/search?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    onSuccess: (data) => {
      setEventsLoaded(true);
      if (data.success) setEventsResults(data.records || []);
      else toast({ title: "Events search failed", description: data.message, variant: "destructive" });
    },
  });

  const loadAllEventsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/segno/events?max=100", { credentials: "include" });
      return res.json();
    },
    onSuccess: (data) => {
      setEventsLoaded(true);
      if (data.success) setEventsResults(data.records || []);
      else toast({ title: "Failed to load events", description: data.message, variant: "destructive" });
    },
  });

  const aoLoadMutation = useMutation({
    mutationFn: async (q: string) => {
      const url = q.trim()
        ? `/api/segno/asset-orders/search?q=${encodeURIComponent(q.trim())}`
        : `/api/segno/asset-orders?max=100`;
      const res = await fetch(url, { credentials: "include" });
      return res.json();
    },
    onSuccess: (data) => {
      setAoLoaded(true);
      if (data.success) setAoResults(data.records || []);
      else toast({ title: "Failed to load asset orders", description: data.message, variant: "destructive" });
    },
  });

  const records = onboardingData?.records || [];
  const filteredOnboarding = records.filter(r => {
    if (!onboardingFilter) return true;
    const q = onboardingFilter.toLowerCase();
    return (r.name || "").toLowerCase().includes(q) ||
      (r.employee_id || "").toLowerCase().includes(q) ||
      (r.enterprise_id || "").toLowerCase().includes(q) ||
      (r.district || "").toLowerCase().includes(q);
  });

  return (
    <MainContent>
      <TopBar title="Segno" breadcrumbs={["Home", "Integrations", "Segno"]} />
      <main className="p-6">
        <BackButton href="/integrations" />

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-violet-500/10 rounded-xl flex items-center justify-center">
              <Users className="h-7 w-7 text-violet-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Segno</h1>
              <p className="text-muted-foreground text-sm">SugarCRM workflow management — OnBoarding, Events, Asset Orders, Users</p>
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
            <Button variant="outline" onClick={() => testConnectionMutation.mutate()} disabled={testConnectionMutation.isPending}>
              {testConnectionMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TestTube className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="overview"><Database className="h-4 w-4 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="onboarding"><UserPlus className="h-4 w-4 mr-1.5" />OnBoarding</TabsTrigger>
            <TabsTrigger value="lookup"><Search className="h-4 w-4 mr-1.5" />Lookup</TabsTrigger>
            <TabsTrigger value="events"><Calendar className="h-4 w-4 mr-1.5" />FP Events</TabsTrigger>
            <TabsTrigger value="asset-orders"><Package className="h-4 w-4 mr-1.5" />Asset Orders</TabsTrigger>
            <TabsTrigger value="endpoints"><List className="h-4 w-4 mr-1.5" />API Reference</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4 text-violet-500" />Connection Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                      statusData?.configured
                        ? <span className="text-sm font-medium text-green-600">Connected</span>
                        : <span className="text-sm font-medium text-red-600">Not Configured</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Auth Method</span>
                    <span className="text-xs font-mono font-medium">Session (MD5)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Protocol</span>
                    <span className="text-xs font-mono font-medium">SugarCRM REST v4.1</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">App Name</span>
                    <span className="text-xs font-mono font-medium">Segno_Workflow_API</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Session TTL</span>
                    <span className="text-xs font-mono font-medium">55 min (auto-refresh)</span>
                  </div>
                  {statusData?.message && (
                    <p className="text-xs text-muted-foreground border-t pt-2">{statusData.message}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-500" />Modules
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { name: "OnBoarding", icon: UserPlus, color: "text-violet-500", desc: "New hire truck assignments" },
                    { name: "FP_events", icon: Calendar, color: "text-blue-500", desc: "Workflow activity events" },
                    { name: "Asset_Order", icon: Package, color: "text-orange-500", desc: "Asset orders for new hires" },
                    { name: "Users", icon: Users, color: "text-green-500", desc: "Segno system users" },
                  ].map(({ name, icon: Icon, color, desc }) => (
                    <div key={name} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                      <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                      <div>
                        <p className="text-sm font-medium font-mono">{name}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Hash className="h-4 w-4 text-orange-500" />Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "SEGNO_BASE_URL", desc: "REST endpoint (e.g. /service/v4_1/rest.php)" },
                    { label: "SEGNO_USERNAME", desc: "Login username" },
                    { label: "SEGNO_PASSWORD", desc: "Plain text password — MD5-hashed on each request" },
                  ].map(({ label, desc }) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-xs font-mono font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      QA base URL: <code className="font-mono text-[10px]">hscmt.nonprod.mt.oh.transformco.com:2443</code>
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* OnBoarding List Tab */}
          <TabsContent value="onboarding" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserPlus className="h-4 w-4" />OnBoarding Records
                    </CardTitle>
                    <CardDescription>
                      All OnBoarding records{onboardingData?.totalCount ? ` (${onboardingData.totalCount} total)` : ""}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchOnboarding()} disabled={onboardingLoading}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${onboardingLoading ? "animate-spin" : ""}`} />
                    {onboardingLoading ? "Loading..." : "Load Records"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {records.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Filter by name, employee ID, enterprise ID, district..." value={onboardingFilter}
                      onChange={(e) => setOnboardingFilter(e.target.value)} className="pl-8 h-8 text-sm" />
                  </div>
                )}
                {onboardingLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading from Segno...</span>
                  </div>
                ) : records.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <UserPlus className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load Records" to fetch OnBoarding data from Segno</p>
                    {!statusData?.configured && <p className="text-xs text-amber-600 mt-2">Connection not configured — add secrets first</p>}
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border overflow-auto max-h-[480px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Employee ID</TableHead>
                            <TableHead>Enterprise ID</TableHead>
                            <TableHead>District</TableHead>
                            <TableHead>Job Code</TableHead>
                            <TableHead>Type of Hire</TableHead>
                            <TableHead>Start Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredOnboarding.slice(0, 200).map((r: any, i: number) => (
                            <TableRow key={r.id || i} className="cursor-pointer hover:bg-accent/50"
                              onClick={() => { setObSelectedRecord(r); setObSearchQuery(r.id); setObSearchType("record"); setObSearchResults([r]); setActiveTab("lookup"); }}>
                              <TableCell className="text-sm font-medium">{r.name || "-"}</TableCell>
                              <TableCell className="text-xs font-mono">{r.employee_id || "-"}</TableCell>
                              <TableCell className="text-xs font-mono">{r.enterprise_id || "-"}</TableCell>
                              <TableCell className="text-xs">{r.district || "-"}</TableCell>
                              <TableCell className="text-xs">{r.job_code || "-"}</TableCell>
                              <TableCell className="text-xs">{r.type_of_hire || "-"}</TableCell>
                              <TableCell className="text-xs">{r.start_date ? new Date(r.start_date).toLocaleDateString() : "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Showing {Math.min(200, filteredOnboarding.length)} of {filteredOnboarding.length} results. Click a row for full detail.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lookup Tab */}
          <TabsContent value="lookup" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4" />OnBoarding Lookup</CardTitle>
                <CardDescription>Search for an OnBoarding record by name, employee ID, enterprise ID, or record ID</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex gap-1 flex-wrap">
                    {(["name", "employee", "enterprise", "record"] as const).map(type => (
                      <Button key={type} size="sm" variant={obSearchType === type ? "default" : "outline"}
                        onClick={() => setObSearchType(type)} className="text-xs">
                        {type === "name" ? "Name / Keyword" : type === "employee" ? "Employee ID" : type === "enterprise" ? "Enterprise ID" : "Record ID"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-1 gap-2">
                    <Input
                      placeholder={obSearchType === "name" ? "Search by name..." : obSearchType === "employee" ? "Employee ID..." : obSearchType === "enterprise" ? "Enterprise ID..." : "Record ID..."}
                      value={obSearchQuery} onChange={(e) => setObSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && obSearchQuery.trim() && obSearchMutation.mutate({ type: obSearchType, query: obSearchQuery.trim() })}
                      className="flex-1" />
                    <Button onClick={() => obSearchMutation.mutate({ type: obSearchType, query: obSearchQuery.trim() })}
                      disabled={!obSearchQuery.trim() || obSearchMutation.isPending}>
                      {obSearchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {obSearchMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching Segno...
                  </div>
                )}

                {!obSearchMutation.isPending && obSearchResults.length > 0 && (
                  <div className="space-y-3">
                    {obSearchResults.length > 1 && (
                      <div className="rounded-md border overflow-auto max-h-48">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead><TableHead>Employee ID</TableHead><TableHead>Enterprise ID</TableHead><TableHead>Start Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {obSearchResults.map((r, i) => (
                              <TableRow key={r.id || i} className={`cursor-pointer hover:bg-accent/50 ${obSelectedRecord?.id === r.id ? "bg-accent" : ""}`}
                                onClick={() => setObSelectedRecord(r)}>
                                <TableCell className="text-sm font-medium">{r.name || "-"}</TableCell>
                                <TableCell className="text-xs font-mono">{r.employee_id || "-"}</TableCell>
                                <TableCell className="text-xs font-mono">{r.enterprise_id || "-"}</TableCell>
                                <TableCell className="text-xs">{r.start_date ? new Date(r.start_date).toLocaleDateString() : "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    {obSelectedRecord && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">{obSearchResults.length > 1 ? "Selected Record" : "Record Detail"}</p>
                        <RecordDetail record={obSelectedRecord} fields={ONBOARDING_FIELDS} />
                      </div>
                    )}
                  </div>
                )}

                {!obSearchMutation.isPending && obSearchResults.length === 0 && !obSearchMutation.isIdle && (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No records found</p>
                  </div>
                )}

                {obSearchResults.length === 0 && obSearchMutation.isIdle && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Enter a search term above, or click a row in the OnBoarding tab</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* FP Events Tab */}
          <TabsContent value="events" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4" />FP Events
                    </CardTitle>
                    <CardDescription>Workflow activity events — truck events, training, and status tracking</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => loadAllEventsMutation.mutate()} disabled={loadAllEventsMutation.isPending}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${loadAllEventsMutation.isPending ? "animate-spin" : ""}`} />
                    Load All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Filter by event name..." value={eventsNameFilter}
                      onChange={(e) => setEventsNameFilter(e.target.value)} className="pl-8 h-8 text-sm" />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Button size="sm" variant={eventsStatusFilter === "" ? "default" : "outline"} className="text-xs h-8"
                      onClick={() => setEventsStatusFilter("")}>All</Button>
                    {EVENT_STATUSES.map(s => (
                      <Button key={s} size="sm" variant={eventsStatusFilter === s ? "default" : "outline"} className="text-xs h-8 capitalize"
                        onClick={() => setEventsStatusFilter(s)}>{s}</Button>
                    ))}
                  </div>
                  <Button size="sm" onClick={() => eventsSearchMutation.mutate({ name: eventsNameFilter, status: eventsStatusFilter })}
                    disabled={eventsSearchMutation.isPending} className="h-8">
                    {eventsSearchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Filter className="h-3.5 w-3.5" />}
                    <span className="ml-1">Search</span>
                  </Button>
                </div>

                {(loadAllEventsMutation.isPending || eventsSearchMutation.isPending) ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading events from Segno...</span>
                  </div>
                ) : eventsLoaded && eventsResults.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No events found matching your filters</p>
                  </div>
                ) : eventsResults.length > 0 ? (
                  <div className="rounded-md border overflow-auto max-h-[480px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Event Code</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Date Entered</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eventsResults.map((r: any, i: number) => (
                          <TableRow key={r.id || i}>
                            <TableCell className="text-sm font-medium max-w-xs truncate">{r.name || "-"}</TableCell>
                            <TableCell className="text-xs font-mono">{r.event_code || "-"}</TableCell>
                            <TableCell><StatusBadge status={r.activity_status_type} /></TableCell>
                            <TableCell className="text-xs">{r.due_date ? new Date(r.due_date).toLocaleDateString() : "-"}</TableCell>
                            <TableCell className="text-xs">{r.date_entered ? new Date(r.date_entered).toLocaleDateString() : "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load All" or use the search filters above</p>
                    <p className="text-xs mt-1">FP_events tracks workflow activities like truck events, training sessions, and pending actions</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Asset Orders Tab */}
          <TabsContent value="asset-orders" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-4 w-4" />Asset Orders
                    </CardTitle>
                    <CardDescription>Asset orders for new hire equipment and supplies</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => aoLoadMutation.mutate("")} disabled={aoLoadMutation.isPending}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${aoLoadMutation.isPending ? "animate-spin" : ""}`} />
                    Load All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search by order name..." value={aoSearchQuery} onChange={(e) => setAoSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && aoLoadMutation.mutate(aoSearchQuery)} className="pl-8 h-8 text-sm" />
                  </div>
                  <Button size="sm" onClick={() => aoLoadMutation.mutate(aoSearchQuery)} disabled={aoLoadMutation.isPending} className="h-8">
                    {aoLoadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </div>

                {aoLoadMutation.isPending ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading asset orders...</span>
                  </div>
                ) : aoLoaded && aoResults.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No asset orders found</p>
                  </div>
                ) : aoResults.length > 0 ? (
                  <div className="rounded-md border overflow-auto max-h-[480px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Date Entered</TableHead>
                          <TableHead>Record ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aoResults.map((r: any, i: number) => (
                          <TableRow key={r.id || i}>
                            <TableCell className="text-sm font-medium">{r.name || "-"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{r.description || "-"}</TableCell>
                            <TableCell className="text-xs">{r.date_entered ? new Date(r.date_entered).toLocaleDateString() : "-"}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{r.id}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Click "Load All" or search by order name</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* API Reference Tab */}
          <TabsContent value="endpoints" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <List className="h-4 w-4" />Nexus Proxy Routes
                </CardTitle>
                <CardDescription>
                  All {ALL_NEXUS_ROUTES.length} backend routes across 4 Segno modules. All Segno API calls are proxied through a single authenticated session.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {["Connection", "OnBoarding", "FP_events", "Asset_Order", "Users"].map(mod => {
                  const modRoutes = ALL_NEXUS_ROUTES.filter(r => r.module === mod);
                  return (
                    <div key={mod} className="mb-5 last:mb-0">
                      <div className="flex items-center gap-2 mb-2">
                        <ModuleBadge module={mod} />
                        <span className="text-xs text-muted-foreground">{modRoutes.length} endpoint{modRoutes.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="space-y-1 pl-1">
                        {modRoutes.map((r, i) => (
                          <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                            <MethodBadge method={r.method} />
                            <span className="text-xs font-mono text-muted-foreground flex-1">{r.path}</span>
                            <span className="text-xs text-muted-foreground hidden sm:block">{r.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-500" />Authentication Flow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ol className="space-y-2 list-decimal list-inside text-muted-foreground text-sm">
                  <li>POST to <code className="font-mono text-xs bg-muted px-1 rounded">SEGNO_BASE_URL</code> with <code className="font-mono text-xs bg-muted px-1 rounded">method=login</code></li>
                  <li>Send <code className="font-mono text-xs bg-muted px-1 rounded">user_name</code> + <code className="font-mono text-xs bg-muted px-1 rounded">password</code> (MD5-hashed) in <code className="font-mono text-xs bg-muted px-1 rounded">user_auth</code></li>
                  <li>Set <code className="font-mono text-xs bg-muted px-1 rounded">application_name: "Segno_Workflow_API"</code></li>
                  <li>Receive <code className="font-mono text-xs bg-muted px-1 rounded">session_id</code> — include in all subsequent calls</li>
                  <li>Nexus auto-refreshes on expiry (55-minute TTL) and retries on session errors</li>
                </ol>
                <p className="text-xs text-muted-foreground pt-1">
                  Soft deletes are used across all modules — records are never hard-deleted. Sending <code className="font-mono bg-muted px-1 rounded">deleted: 1</code> via <code className="font-mono bg-muted px-1 rounded">set_entry</code> marks the record as deleted.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
