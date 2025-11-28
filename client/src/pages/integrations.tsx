import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ApiConfiguration } from "@shared/schema";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { 
  Plus, Settings, Trash2, TestTube, Database, ArrowRight, 
  ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Play, Truck
} from "lucide-react";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Integrations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [snowflakeExpanded, setSnowflakeExpanded] = useState(false);
  const [tpmsExpanded, setTpmsExpanded] = useState(false);
  const [sqlQuery, setSqlQuery] = useState("SELECT CURRENT_VERSION() as version, CURRENT_USER() as user, CURRENT_DATABASE() as database");
  const [queryResults, setQueryResults] = useState<any[] | null>(null);
  const [tpmsTestId, setTpmsTestId] = useState("");
  const [holmanEnabled, setHolmanEnabled] = useState(true);
  const [snowflakeEnabled, setSnowflakeEnabled] = useState(true);
  const [tpmsEnabled, setTpmsEnabled] = useState(true);

  const [formData, setFormData] = useState({
    name: "",
    endpoint: "",
    apiKey: "",
    isActive: true,
  });

  const { data: configurations, isLoading } = useQuery({
    queryKey: ["/api/configurations"],
  });

  const { data: snowflakeStatus, isLoading: snowflakeStatusLoading } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/snowflake/status"],
  });

  const { data: tpmsStatus, isLoading: tpmsStatusLoading } = useQuery<{ configured: boolean; message: string }>({
    queryKey: ["/api/tpms/status"],
  });

  const createConfigMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/configurations", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/configurations"] });
      toast({
        title: "Success",
        description: "API configuration created successfully",
      });
      setIsDialogOpen(false);
      setFormData({
        name: "",
        endpoint: "",
        apiKey: "",
        isActive: true,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create API configuration",
        variant: "destructive",
      });
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const response = await apiRequest("PATCH", `/api/configurations/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/configurations"] });
      toast({
        title: "Success",
        description: "API configuration updated successfully",
      });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/configurations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/configurations"] });
      toast({
        title: "Success",
        description: "API configuration deleted successfully",
      });
    },
  });

  const testApiMutation = useMutation({
    mutationFn: async (apiId: string) => {
      const response = await apiRequest("POST", "/api/integrations/test", { apiId });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/configurations"] });
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
  });

  const testSnowflakeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/snowflake/test");
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Test Failed",
        description: error.message || "Failed to test Snowflake connection",
        variant: "destructive",
      });
    },
  });

  const executeQueryMutation = useMutation({
    mutationFn: async (sql: string) => {
      const response = await apiRequest("POST", "/api/snowflake/query", { sql });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        setQueryResults(data.data);
        toast({
          title: "Query Executed Successfully",
          description: `Returned ${data.data.length} row(s).`,
        });
      } else {
        setQueryResults(null);
        toast({
          title: "Query Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Query Execution Failed",
        description: error.message || "Failed to execute query",
        variant: "destructive",
      });
    },
  });

  const testTpmsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tpms/test", { credentials: "include" });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.success ? "TPMS Connection Successful" : "TPMS Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "TPMS Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const lookupTpmsTechMutation = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: 'enterprise' | 'truck' }) => {
      const endpoint = type === 'enterprise' 
        ? `/api/tpms/techinfo/${id}` 
        : `/api/tpms/lookup/truck/${id}`;
      const response = await fetch(endpoint, { credentials: "include" });
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Tech Found",
          description: `${data.data.firstName} ${data.data.lastName} - Truck: ${data.data.truckNo || 'N/A'}`,
        });
      } else {
        toast({
          title: "Lookup Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "TPMS Lookup Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.endpoint) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createConfigMutation.mutate(formData);
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleApiStatus = (id: string, currentStatus: boolean) => {
    updateConfigMutation.mutate({
      id,
      updates: { isActive: !currentStatus }
    });
  };

  const testApiConnection = (apiId: string) => {
    testApiMutation.mutate(apiId);
  };

  const deleteApi = (id: string) => {
    if (confirm("Are you sure you want to delete this API configuration?")) {
      deleteConfigMutation.mutate(id);
    }
  };

  const handleExecuteQuery = () => {
    if (!sqlQuery.trim()) {
      toast({
        title: "Empty Query",
        description: "Please enter a SQL query",
        variant: "destructive",
      });
      return;
    }
    setQueryResults(null);
    executeQueryMutation.mutate(sqlQuery);
  };

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newValue = sqlQuery.substring(0, start) + '\t' + sqlQuery.substring(end);
      setSqlQuery(newValue);
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      }, 0);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))]";
      case "warning": return "bg-[hsl(var(--chart-1))]/10 text-[hsl(var(--chart-1))]";
      case "error": return "bg-destructive/10 text-destructive";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  const integrationStats = {
    total: 3,
    active: [holmanEnabled, snowflakeEnabled, tpmsEnabled].filter(Boolean).length,
    healthy: [true, snowflakeStatus?.configured, tpmsStatus?.configured].filter(Boolean).length,
    errors: [false, !snowflakeStatus?.configured, !tpmsStatus?.configured].filter(Boolean).length,
  };

  return (
    <MainContent>
      <TopBar 
        title="Integrations" 
        breadcrumbs={["Home", "Integrations"]}
      />
      
      <main className="p-6">
        <BackButton href="/" />

        {/* Data Integrations */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle data-testid="text-fleet-integrations-title">Data Integrations</CardTitle>
                  <CardDescription>
                    Access fleet management systems, data warehouses, and third-party integrations
                  </CardDescription>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-api">
                      <Plus className="h-4 w-4 mr-2" />
                      Add API
                    </Button>
                  </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle data-testid="text-add-api-title">Add API Configuration</DialogTitle>
                    <DialogDescription>
                      Configure a new external API connection
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => handleInputChange("name", e.target.value)}
                        placeholder="e.g., Salesforce API"
                        data-testid="input-api-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="endpoint">Endpoint *</Label>
                      <Input
                        id="endpoint"
                        value={formData.endpoint}
                        onChange={(e) => handleInputChange("endpoint", e.target.value)}
                        placeholder="https://api.example.com"
                        data-testid="input-api-endpoint"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="apiKey">API Key</Label>
                      <Input
                        id="apiKey"
                        type="password"
                        value={formData.apiKey}
                        onChange={(e) => handleInputChange("apiKey", e.target.value)}
                        placeholder="Enter API key"
                        data-testid="input-api-key"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="isActive"
                        checked={formData.isActive}
                        onCheckedChange={(value) => handleInputChange("isActive", value)}
                        data-testid="switch-is-active"
                      />
                      <Label htmlFor="isActive">Active</Label>
                    </div>
                    <Button type="submit" className="w-full" data-testid="button-submit-api">
                      Add Configuration
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
              </div>
              
              {/* Inline Stats */}
              <div className="flex items-center gap-6 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-primary/10 rounded flex items-center justify-center">
                    <Settings className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">Total:</span>
                  <span className="text-sm font-semibold" data-testid="text-total-apis">{integrationStats.total}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-[hsl(var(--chart-2))]/10 rounded flex items-center justify-center">
                    <CheckCircle className="h-3 w-3 text-[hsl(var(--chart-2))]" />
                  </div>
                  <span className="text-sm text-muted-foreground">Active:</span>
                  <span className="text-sm font-semibold" data-testid="text-active-apis">{integrationStats.active}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-[hsl(var(--chart-2))]/10 rounded flex items-center justify-center">
                    <CheckCircle className="h-3 w-3 text-[hsl(var(--chart-2))]" />
                  </div>
                  <span className="text-sm text-muted-foreground">Healthy:</span>
                  <span className="text-sm font-semibold" data-testid="text-healthy-apis">{integrationStats.healthy}</span>
                </div>
                {integrationStats.errors > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-destructive/10 rounded flex items-center justify-center">
                      <XCircle className="h-3 w-3 text-destructive" />
                    </div>
                    <span className="text-sm text-muted-foreground">Errors:</span>
                    <span className="text-sm font-semibold text-destructive" data-testid="text-error-apis">{integrationStats.errors}</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Holman Integration */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-all">
              <Link href="/holman-integration" data-testid="link-holman-integration" className="flex items-center gap-4 flex-1 cursor-pointer group">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Database className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      Holman Fleet Integration
                    </h3>
                    <Badge variant="default" className="flex items-center gap-1 text-xs">
                      <CheckCircle className="h-3 w-3" />
                      Connected
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Manage vehicles, contacts, maintenance records, and odometer data
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                <span className="text-sm text-green-500 font-medium">healthy</span>
                <Badge variant={holmanEnabled ? "default" : "secondary"} className="text-xs">
                  {holmanEnabled ? "Active" : "Inactive"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toast({ title: "Holman Test", description: "Connection test not yet implemented" })}
                  data-testid="button-test-holman"
                >
                  <TestTube className="h-4 w-4 mr-1" />
                  Test
                </Button>
                <Switch
                  checked={holmanEnabled}
                  onCheckedChange={setHolmanEnabled}
                  data-testid="switch-holman-enabled"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => toast({ title: "Delete", description: "Integration deletion not yet implemented", variant: "destructive" })}
                  data-testid="button-delete-holman"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Snowflake Integration - Expandable inline */}
            <Collapsible open={snowflakeExpanded} onOpenChange={setSnowflakeExpanded}>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-all">
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-4 flex-1 cursor-pointer group">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                      <Database className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg group-hover:text-blue-500 transition-colors">
                          Snowflake Data Warehouse
                        </h3>
                        {snowflakeStatusLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : snowflakeStatus?.configured ? (
                          <Badge variant="default" className="flex items-center gap-1 text-xs">
                            <CheckCircle className="h-3 w-3" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex items-center gap-1 text-xs">
                            <XCircle className="h-3 w-3" />
                            Not Configured
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Execute SQL queries with key pair authentication
                      </p>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                  <span className={`text-sm font-medium ${snowflakeStatus?.configured ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {snowflakeStatus?.configured ? 'healthy' : 'not configured'}
                  </span>
                  <Badge variant={snowflakeEnabled ? "default" : "secondary"} className="text-xs">
                    {snowflakeEnabled ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testSnowflakeMutation.mutate()}
                    disabled={!snowflakeStatus?.configured || testSnowflakeMutation.isPending}
                    data-testid="button-test-snowflake-inline"
                  >
                    {testSnowflakeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4 mr-1" />
                    )}
                    Test
                  </Button>
                  <Switch
                    checked={snowflakeEnabled}
                    onCheckedChange={setSnowflakeEnabled}
                    data-testid="switch-snowflake-enabled"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => toast({ title: "Delete", description: "Integration deletion not yet implemented", variant: "destructive" })}
                    data-testid="button-delete-snowflake"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CollapsibleContent className="mt-2 ml-4 border-l-2 border-blue-500/20 pl-4 space-y-4">
                {/* SQL Query */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">SQL Query</CardTitle>
                    <CardDescription>Execute SQL queries against Snowflake</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="sql-query">SQL Query</Label>
                      <Textarea
                        id="sql-query"
                        value={sqlQuery}
                        onChange={(e) => setSqlQuery(e.target.value)}
                        onKeyDown={handleTabKey}
                        placeholder="Enter your SQL query here..."
                        className="font-mono min-h-[120px]"
                        data-testid="textarea-sql-query"
                      />
                    </div>
                    <Button
                      onClick={handleExecuteQuery}
                      disabled={!snowflakeStatus?.configured || executeQueryMutation.isPending}
                      data-testid="button-execute-query"
                    >
                      {executeQueryMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Executing...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Execute Query
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Query Results */}
                {queryResults && queryResults.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Query Results</CardTitle>
                      <CardDescription>{queryResults.length} row(s) returned</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border overflow-auto max-h-[300px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(queryResults[0]).map((column) => (
                                <TableHead key={column} className="font-semibold">
                                  {column}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {queryResults.map((row, idx) => (
                              <TableRow key={idx}>
                                {Object.values(row).map((value: any, cellIdx) => (
                                  <TableCell key={cellIdx} className="font-mono text-sm">
                                    {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* TPMS Integration - Expandable inline */}
            <Collapsible open={tpmsExpanded} onOpenChange={setTpmsExpanded}>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-all">
                <CollapsibleTrigger asChild>
                  <div className="flex items-center gap-4 flex-1 cursor-pointer group">
                    <div className="w-12 h-12 bg-orange-500/10 rounded-lg flex items-center justify-center">
                      <Truck className="h-6 w-6 text-orange-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg group-hover:text-orange-500 transition-colors">
                          TPMS Integration
                        </h3>
                        {tpmsStatusLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : tpmsStatus?.configured ? (
                          <Badge variant="default" className="flex items-center gap-1 text-xs">
                            <CheckCircle className="h-3 w-3" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex items-center gap-1 text-xs">
                            <XCircle className="h-3 w-3" />
                            Not Configured
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Technician and truck lookup for offboarding workflow
                      </p>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                  <span className={`text-sm font-medium ${tpmsStatus?.configured ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {tpmsStatus?.configured ? 'healthy' : 'not configured'}
                  </span>
                  <Badge variant={tpmsEnabled ? "default" : "secondary"} className="text-xs">
                    {tpmsEnabled ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testTpmsMutation.mutate()}
                    disabled={!tpmsStatus?.configured || testTpmsMutation.isPending}
                    data-testid="button-test-tpms-inline"
                  >
                    {testTpmsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4 mr-1" />
                    )}
                    Test
                  </Button>
                  <Switch
                    checked={tpmsEnabled}
                    onCheckedChange={setTpmsEnabled}
                    data-testid="switch-tpms-enabled"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => toast({ title: "Delete", description: "Integration deletion not yet implemented", variant: "destructive" })}
                    data-testid="button-delete-tpms"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <CollapsibleContent className="mt-2 ml-4 border-l-2 border-orange-500/20 pl-4 space-y-4">

                {/* TPMS Lookup */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">TPMS Lookup</CardTitle>
                    <CardDescription>Look up technician info by Enterprise ID or Truck Number</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter Enterprise ID or Truck Number"
                        value={tpmsTestId}
                        onChange={(e) => setTpmsTestId(e.target.value.toUpperCase())}
                        className="flex-1"
                        data-testid="input-tpms-test-id"
                      />
                      <Button
                        onClick={() => {
                          const trimmedId = tpmsTestId.trim();
                          const isNumeric = /^\d+$/.test(trimmedId);
                          const lookupId = isNumeric ? trimmedId.padStart(6, '0') : trimmedId;
                          lookupTpmsTechMutation.mutate({ id: lookupId, type: isNumeric ? 'truck' : 'enterprise' });
                        }}
                        disabled={!tpmsStatus?.configured || !tpmsTestId || lookupTpmsTechMutation.isPending}
                        data-testid="button-lookup-tech"
                      >
                        {lookupTpmsTechMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Lookup"
                        )}
                      </Button>
                    </div>
                    {lookupTpmsTechMutation.data?.success && (
                      <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                        <p><strong>Name:</strong> {lookupTpmsTechMutation.data.data.firstName} {lookupTpmsTechMutation.data.data.lastName}</p>
                        <p><strong>Tech ID:</strong> {lookupTpmsTechMutation.data.data.techId}</p>
                        <p><strong>Enterprise ID:</strong> {lookupTpmsTechMutation.data.data.ldapId || 'N/A'}</p>
                        <p><strong>District:</strong> {lookupTpmsTechMutation.data.data.districtNo}</p>
                        <p><strong>Truck:</strong> {lookupTpmsTechMutation.data.data.truckNo || 'N/A'}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

      </main>
    </MainContent>
  );
}
