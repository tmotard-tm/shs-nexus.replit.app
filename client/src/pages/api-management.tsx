import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ApiConfiguration } from "@shared/schema";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { Plus, Settings, Trash2, TestTube, Database, ArrowRight, Plug, Check, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

export default function ApiManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    endpoint: "",
    apiKey: "",
    isActive: true,
  });

  const { data: configurations, isLoading } = useQuery({
    queryKey: ["/api/configurations"],
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
        title="Integrations Management" 
        breadcrumbs={["Home", "Integrations Management"]}
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
                <Plug className="h-4 w-4 text-[hsl(var(--chart-2))]" />
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
                <Check className="h-4 w-4 text-[hsl(var(--chart-2))]" />
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
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-error-apis">{apiStats.errors}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Fleet Integrations */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle data-testid="text-fleet-integrations-title">Data Integrations</CardTitle>
            <CardDescription>
              Access fleet management systems, data warehouses, and third-party integrations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/holman-integration" data-testid="link-holman-integration">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary hover:bg-accent transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Database className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                      Holman API
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Manage vehicles, contacts, maintenance records, and odometer data
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
            
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
