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
  Hash, Calendar
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

const ENDPOINTS = [
  { method: "POST", path: "{{base_url}}", label: "Login", description: "Authenticate with MD5 password, returns session_id" },
  { method: "POST", path: "{{base_url}}", label: "Logout", description: "Invalidate the current session" },
  { method: "POST", path: "{{base_url}}", label: "Get OnBoarding List", description: "List all OnBoarding records (get_entry_list)" },
  { method: "POST", path: "{{base_url}}", label: "Filter OnBoarding", description: "Filter OnBoarding records by query string (get_entry_list)" },
  { method: "POST", path: "{{base_url}}", label: "Get OnBoarding Entry", description: "Get a single OnBoarding record by ID (get_entry)" },
  { method: "POST", path: "{{base_url}}", label: "Create OnBoarding Record", description: "Create a new OnBoarding record (set_entry)" },
  { method: "POST", path: "{{base_url}}", label: "Update OnBoarding Record", description: "Update an existing OnBoarding record (set_entry with id)" },
];

const NEXUS_ROUTES = [
  { method: "GET",   path: "/api/segno/status",                          label: "Connection Status" },
  { method: "POST",  path: "/api/segno/test",                            label: "Test Connection" },
  { method: "GET",   path: "/api/segno/onboarding",                      label: "List OnBoarding Records" },
  { method: "GET",   path: "/api/segno/onboarding/search?q=",            label: "Search OnBoarding" },
  { method: "GET",   path: "/api/segno/onboarding/by-employee/:id",      label: "Lookup by Employee ID" },
  { method: "GET",   path: "/api/segno/onboarding/by-enterprise/:id",    label: "Lookup by Enterprise ID" },
  { method: "GET",   path: "/api/segno/onboarding/:id",                  label: "Get OnBoarding by Record ID" },
  { method: "POST",  path: "/api/segno/onboarding",                      label: "Create OnBoarding Record" },
  { method: "PATCH", path: "/api/segno/onboarding/:id",                  label: "Update OnBoarding Record" },
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

function RecordDetail({ record }: { record: Record<string, any> }) {
  return (
    <div className="rounded-md border p-3 space-y-1.5 bg-muted/30 text-sm">
      {ONBOARDING_FIELDS.map(({ key, label }) => {
        const val = record[key];
        if (!val) return null;
        return (
          <div key={key} className="flex items-start gap-2">
            <span className="font-medium text-muted-foreground min-w-[140px] text-xs">{label}</span>
            <span className="text-xs font-mono break-all">{String(val)}</span>
          </div>
        );
      })}
      {record.id && (
        <div className="flex items-start gap-2 border-t pt-1.5 mt-1">
          <span className="font-medium text-muted-foreground min-w-[140px] text-xs">Record ID</span>
          <span className="text-xs font-mono text-muted-foreground">{record.id}</span>
        </div>
      )}
    </div>
  );
}

export default function SegnoIntegration() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchType, setSearchType] = useState<"name" | "employee" | "enterprise" | "record">("name");
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  const [onboardingOffset, setOnboardingOffset] = useState(0);
  const [onboardingSearch, setOnboardingSearch] = useState("");

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

  const searchMutation = useMutation({
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
        if (data.record) {
          setSearchResults([data.record]);
          setSelectedRecord(data.record);
        } else {
          setSearchResults(data.records || []);
          setSelectedRecord(null);
        }
        if ((data.records || [data.record].filter(Boolean)).length === 0) {
          toast({ title: "No Results", description: "No matching records found" });
        }
      } else {
        toast({ title: "Search Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Search Failed", description: error.message, variant: "destructive" });
    },
  });

  const records = onboardingData?.records || [];
  const filteredRecords = records.filter(r => {
    if (!onboardingSearch) return true;
    const q = onboardingSearch.toLowerCase();
    return (
      (r.name || "").toLowerCase().includes(q) ||
      (r.employee_id || "").toLowerCase().includes(q) ||
      (r.enterprise_id || "").toLowerCase().includes(q) ||
      (r.district || "").toLowerCase().includes(q)
    );
  });

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    searchMutation.mutate({ type: searchType, query: searchQuery.trim() });
  };

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
              <p className="text-muted-foreground text-sm">SugarCRM-based OnBoarding workflow management</p>
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
            <TabsTrigger value="onboarding"><UserPlus className="h-4 w-4 mr-1.5" />OnBoarding</TabsTrigger>
            <TabsTrigger value="lookup"><Search className="h-4 w-4 mr-1.5" />Lookup</TabsTrigger>
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
                    <span className="text-xs font-mono font-medium">Session (MD5 Password)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Protocol</span>
                    <span className="text-xs font-mono font-medium">SugarCRM REST v4.1</span>
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
                    <UserPlus className="h-4 w-4 mr-1 text-blue-500" />OnBoarding Module
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ONBOARDING_FIELDS.slice(0, 7).map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between py-1 border-b last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-xs font-mono text-muted-foreground">{key}</span>
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
                    { label: "SEGNO_BASE_URL", desc: "API endpoint URL" },
                    { label: "SEGNO_USERNAME", desc: "Login username" },
                    { label: "SEGNO_PASSWORD", desc: "Login password (MD5-hashed on send)" },
                  ].map(({ label, desc }) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-xs font-mono font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  ))}
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Set these in the Replit Secrets panel to enable this integration.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Nexus Routes</CardTitle>
                <CardDescription>Backend proxy routes available for this integration</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {NEXUS_ROUTES.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                      <MethodBadge method={r.method} />
                      <span className="text-xs font-mono text-muted-foreground flex-1">{r.path}</span>
                      <span className="text-xs text-muted-foreground">{r.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* OnBoarding Tab */}
          <TabsContent value="onboarding" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserPlus className="h-4 w-4" />OnBoarding Records
                    </CardTitle>
                    <CardDescription>
                      All OnBoarding records from Segno{onboardingData?.totalCount ? ` (${onboardingData.totalCount} total)` : ""}
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
                    <Input
                      placeholder="Filter by name, employee ID, enterprise ID, district..."
                      value={onboardingSearch}
                      onChange={(e) => setOnboardingSearch(e.target.value)}
                      className="pl-8 h-8 text-sm"
                    />
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
                    {!statusData?.configured && (
                      <p className="text-xs text-amber-600 mt-2">Connection not configured — add secrets to get started</p>
                    )}
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
                          {filteredRecords.slice(0, 200).map((r: any, i: number) => (
                            <TableRow
                              key={r.id || i}
                              className="cursor-pointer hover:bg-accent/50"
                              onClick={() => {
                                setSelectedRecord(r);
                                setSearchQuery(r.id);
                                setSearchType("record");
                                setSearchResults([r]);
                                setActiveTab("lookup");
                              }}
                            >
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Showing {Math.min(200, filteredRecords.length)} of {filteredRecords.length} results. Click a row to view full detail.
                      </p>
                      {onboardingData?.nextOffset && onboardingData.nextOffset > 0 && (
                        <Button variant="outline" size="sm" onClick={() => { setOnboardingOffset(onboardingData.nextOffset); refetchOnboarding(); }}>
                          Load More
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lookup Tab */}
          <TabsContent value="lookup" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="h-4 w-4" />OnBoarding Lookup
                </CardTitle>
                <CardDescription>Search for an OnBoarding record by name, employee ID, enterprise ID, or record ID</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex gap-1 flex-wrap">
                    {(["name", "employee", "enterprise", "record"] as const).map(type => (
                      <Button
                        key={type}
                        size="sm"
                        variant={searchType === type ? "default" : "outline"}
                        onClick={() => setSearchType(type)}
                        className="text-xs"
                      >
                        {type === "name" ? "Name / Keyword" :
                          type === "employee" ? "Employee ID" :
                          type === "enterprise" ? "Enterprise ID" : "Record ID"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-1 gap-2">
                    <Input
                      placeholder={
                        searchType === "name" ? "Search by name or keyword..." :
                        searchType === "employee" ? "Enter employee ID..." :
                        searchType === "enterprise" ? "Enter enterprise ID..." :
                        "Enter Segno record ID..."
                      }
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="flex-1"
                    />
                    <Button onClick={handleSearch} disabled={!searchQuery.trim() || searchMutation.isPending}>
                      {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {searchMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching Segno...
                  </div>
                )}

                {!searchMutation.isPending && searchResults.length > 0 && (
                  <div className="space-y-3">
                    {searchResults.length > 1 && (
                      <div className="rounded-md border overflow-auto max-h-48">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Employee ID</TableHead>
                              <TableHead>Enterprise ID</TableHead>
                              <TableHead>Start Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {searchResults.map((r, i) => (
                              <TableRow
                                key={r.id || i}
                                className={`cursor-pointer hover:bg-accent/50 ${selectedRecord?.id === r.id ? "bg-accent" : ""}`}
                                onClick={() => setSelectedRecord(r)}
                              >
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
                    {selectedRecord && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {searchResults.length > 1 ? "Selected Record" : "Record Detail"}
                        </p>
                        <RecordDetail record={selectedRecord} />
                      </div>
                    )}
                  </div>
                )}

                {!searchMutation.isPending && searchResults.length === 0 && searchQuery && !searchMutation.isIdle && (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No records found</p>
                  </div>
                )}

                {searchResults.length === 0 && searchMutation.isIdle && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Enter a search term above, or click a row in the OnBoarding tab</p>
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
                  <List className="h-4 w-4" />Segno API Methods
                </CardTitle>
                <CardDescription>
                  All Segno API calls are POST requests to a single endpoint using SugarCRM REST v4.1 protocol
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 mb-6">
                  {ENDPOINTS.map((ep, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                      <MethodBadge method={ep.method} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{ep.label}</p>
                        <p className="text-xs text-muted-foreground">{ep.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-sm font-semibold mb-3">Nexus Proxy Routes</p>
                  <div className="space-y-1">
                    {NEXUS_ROUTES.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                        <MethodBadge method={r.method} />
                        <span className="text-xs font-mono text-muted-foreground flex-1">{r.path}</span>
                        <span className="text-xs text-muted-foreground">{r.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-violet-500" />Authentication Flow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">Segno uses SugarCRM session-based authentication:</p>
                <ol className="space-y-2 list-decimal list-inside text-muted-foreground text-sm">
                  <li>POST to <code className="font-mono text-xs bg-muted px-1 rounded">base_url</code> with <code className="font-mono text-xs bg-muted px-1 rounded">method=login</code></li>
                  <li>Provide <code className="font-mono text-xs bg-muted px-1 rounded">user_name</code> and <code className="font-mono text-xs bg-muted px-1 rounded">password</code> (MD5-hashed) in <code className="font-mono text-xs bg-muted px-1 rounded">user_auth</code></li>
                  <li>Receive a <code className="font-mono text-xs bg-muted px-1 rounded">session_id</code> in the response</li>
                  <li>Include <code className="font-mono text-xs bg-muted px-1 rounded">session</code> in all subsequent <code className="font-mono text-xs bg-muted px-1 rounded">rest_data</code> payloads</li>
                  <li>Nexus auto-refreshes the session on expiry (55-minute TTL)</li>
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
