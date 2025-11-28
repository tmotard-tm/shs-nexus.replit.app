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
  const [tpmsLookupType, setTpmsLookupType] = useState<'enterprise' | 'truck'>('enterprise');

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

  const apiStats = {
    total: (configurations as ApiConfiguration[])?.length || 0,
    active: (configurations as ApiConfiguration[])?.filter(api => api.isActive).length || 0,
    healthy: (configurations as ApiConfiguration[])?.filter(api => api.healthStatus === "healthy").length || 0,
    errors: (configurations as ApiConfiguration[])?.filter(api => api.healthStatus === "error").length || 0,
  };

  return (
    <MainContent>
      <TopBar 
        title="Integrations" 
        breadcrumbs={["Home", "Integrations"]}
      />
      
      <main className="p-6">
        <BackButton href="/" />
        
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mr-4">
                <Settings className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-apis">{apiStats.total}</p>
                <p className="text-sm text-muted-foreground">Total APIs</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-[hsl(var(--chart-2))]/10 rounded-lg flex items-center justify-center mr-4">
                <CheckCircle className="h-4 w-4 text-[hsl(var(--chart-2))]" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-apis">{apiStats.active}</p>
                <p className="text-sm text-muted-foreground">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-[hsl(var(--chart-2))]/10 rounded-lg flex items-center justify-center mr-4">
                <CheckCircle className="h-4 w-4 text-[hsl(var(--chart-2))]" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-healthy-apis">{apiStats.healthy}</p>
                <p className="text-sm text-muted-foreground">Healthy</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <div className="w-8 h-8 bg-destructive/10 rounded-lg flex items-center justify-center mr-4">
                <XCircle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-error-apis">{apiStats.errors}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Data Integrations */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle data-testid="text-fleet-integrations-title">Data Integrations</CardTitle>
            <CardDescription>
              Access fleet management systems, data warehouses, and third-party integrations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Holman Integration - Links to separate page */}
            <Link href="/holman-integration" data-testid="link-holman-integration">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary hover:bg-accent transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Database className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      Holman Fleet Integration
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Manage vehicles, contacts, maintenance records, and odometer data
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
            
            {/* Snowflake Integration - Expandable inline */}
            <Collapsible open={snowflakeExpanded} onOpenChange={setSnowflakeExpanded}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-blue-500 hover:bg-accent transition-all cursor-pointer group">
                  <div className="flex items-center gap-4">
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
                  {snowflakeExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-blue-500 transition-all" />
                  )}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 ml-4 border-l-2 border-blue-500/20 pl-4 space-y-4">
                {/* Connection Test */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Connection Test</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => testSnowflakeMutation.mutate()}
                      disabled={!snowflakeStatus?.configured || testSnowflakeMutation.isPending}
                      data-testid="button-test-snowflake"
                    >
                      {testSnowflakeMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Database className="mr-2 h-4 w-4" />
                          Test Connection
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

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
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-orange-500 hover:bg-accent transition-all cursor-pointer group">
                  <div className="flex items-center gap-4">
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
                  {tpmsExpanded ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-orange-500 transition-all" />
                  )}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 ml-4 border-l-2 border-orange-500/20 pl-4 space-y-4">
                {/* Connection Test */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Connection Test</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button
                      onClick={() => testTpmsMutation.mutate()}
                      disabled={!tpmsStatus?.configured || testTpmsMutation.isPending}
                      data-testid="button-test-tpms"
                    >
                      {testTpmsMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Truck className="mr-2 h-4 w-4" />
                          Test Connection
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Tech/Truck Lookup */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Tech or Truck Assignment Lookup</CardTitle>
                    <CardDescription>Look up technician info by Enterprise ID or Truck Number</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="lookupType" 
                          value="enterprise" 
                          checked={tpmsLookupType === 'enterprise'}
                          onChange={() => setTpmsLookupType('enterprise')}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">Enterprise ID</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="lookupType" 
                          value="truck" 
                          checked={tpmsLookupType === 'truck'}
                          onChange={() => setTpmsLookupType('truck')}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">Truck Number</span>
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder={tpmsLookupType === 'enterprise' ? "Enter Enterprise ID (e.g., JSMITH)" : "Enter Truck Number (e.g., 123456)"}
                        value={tpmsTestId}
                        onChange={(e) => setTpmsTestId(tpmsLookupType === 'enterprise' ? e.target.value.toUpperCase() : e.target.value)}
                        className="flex-1"
                        data-testid="input-tpms-test-id"
                      />
                      <Button
                        onClick={() => lookupTpmsTechMutation.mutate({ id: tpmsTestId, type: tpmsLookupType })}
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

        {/* API Configurations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle data-testid="text-api-configs-title">API Configurations</CardTitle>
                <CardDescription>
                  Manage your external API connections and monitor their health
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
                    <div className="flex justify-end gap-3 pt-4">
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => setIsDialogOpen(false)}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={createConfigMutation.isPending}
                        data-testid="button-create-api"
                      >
                        {createConfigMutation.isPending ? "Creating..." : "Create API"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-24 bg-muted rounded-lg animate-pulse"></div>
                ))}
              </div>
            ) : (configurations as ApiConfiguration[])?.length > 0 ? (
              <div className="space-y-4">
                {(configurations as ApiConfiguration[]).map((config) => (
                  <Card key={config.id} className="border-l-4 border-l-primary">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div>
                              <h3 className="font-semibold" data-testid={`text-api-name-${config.id}`}>
                                {config.name}
                              </h3>
                              <p className="text-sm text-muted-foreground" data-testid={`text-api-endpoint-${config.id}`}>
                                {config.endpoint}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge 
                                className={getStatusColor(config.healthStatus)}
                                data-testid={`badge-health-${config.id}`}
                              >
                                {config.healthStatus}
                              </Badge>
                              <Badge 
                                variant={config.isActive ? "default" : "secondary"}
                                data-testid={`badge-status-${config.id}`}
                              >
                                {config.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Last checked: {new Date(config.lastChecked).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testApiConnection(config.id)}
                            disabled={testApiMutation.isPending}
                            data-testid={`button-test-${config.id}`}
                          >
                            <TestTube className="h-4 w-4 mr-2" />
                            Test
                          </Button>
                          <Switch
                            checked={config.isActive}
                            onCheckedChange={() => toggleApiStatus(config.id, config.isActive)}
                            disabled={updateConfigMutation.isPending}
                            data-testid={`switch-active-${config.id}`}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteApi(config.id)}
                            disabled={deleteConfigMutation.isPending}
                            data-testid={`button-delete-${config.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4" data-testid="text-no-apis">
                  No API configurations found
                </p>
                <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-first-api">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First API
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </MainContent>
  );
}
