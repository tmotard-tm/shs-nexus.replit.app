import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { RequestItem } from "@/components/request-item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Request } from "@shared/schema";
import { Plus } from "lucide-react";

export default function RequesterInterface() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    type: "",
    priority: "medium",
    targetApi: "",
  });

  const { data: requests, isLoading } = useQuery({
    queryKey: ["/api/requests"],
    select: (data: Request[]) => data.filter(req => req.requesterId === user?.id),
  });

  const createRequestMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/requests", {
        ...data,
        requesterId: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Success",
        description: "Request submitted successfully",
      });
      setIsDialogOpen(false);
      setFormData({
        title: "",
        description: "",
        type: "",
        priority: "medium",
        targetApi: "",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit request",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.description || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    createRequestMutation.mutate(formData);
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="flex-1 ml-64">
      <TopBar 
        title="Requester Interface" 
        breadcrumbs={["Home", "Requester"]}
        onNewRequest={() => setIsDialogOpen(true)}
      />
      
      <main className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* My Requests */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-my-requests-title">My Requests</CardTitle>
                <CardDescription>
                  View and track all your submitted requests
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : requests && requests.length > 0 ? (
                  <div className="space-y-4">
                    {requests.map((request) => (
                      <RequestItem
                        key={request.id}
                        request={{ ...request, requesterName: user?.username }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4" data-testid="text-no-requests">
                      You haven't submitted any requests yet
                    </p>
                    <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-request">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Request
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Info */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-request-types-title">Request Types</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                    <i className="fas fa-file-alt text-primary text-sm"></i>
                  </div>
                  <div>
                    <p className="font-medium text-sm">API Access</p>
                    <p className="text-xs text-muted-foreground">Request access to external APIs</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                    <i className="fas fa-database text-primary text-sm"></i>
                  </div>
                  <div>
                    <p className="font-medium text-sm">Snowflake Query</p>
                    <p className="text-xs text-muted-foreground">Access data warehouse queries</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                    <i className="fas fa-cog text-primary text-sm"></i>
                  </div>
                  <div>
                    <p className="font-medium text-sm">System Config</p>
                    <p className="text-xs text-muted-foreground">System configuration changes</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                    <i className="fas fa-key text-primary text-sm"></i>
                  </div>
                  <div>
                    <p className="font-medium text-sm">User Permissions</p>
                    <p className="text-xs text-muted-foreground">Change user access levels</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle data-testid="text-request-tips-title">Request Tips</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>• Be specific about what you need access to</p>
                <p>• Include business justification</p>
                <p>• Set appropriate priority level</p>
                <p>• Provide contact information for questions</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* New Request Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle data-testid="text-new-request-title">Create New Request</DialogTitle>
              <DialogDescription>
                Submit a new request for approval by administrators
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Request Type *</Label>
                  <Select 
                    value={formData.type} 
                    onValueChange={(value) => handleInputChange("type", value)}
                    data-testid="select-request-type"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select request type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api_access" data-testid="option-api-access">API Access Request</SelectItem>
                      <SelectItem value="snowflake_query" data-testid="option-snowflake">Snowflake Query Access</SelectItem>
                      <SelectItem value="system_config" data-testid="option-system-config">System Configuration</SelectItem>
                      <SelectItem value="user_permission" data-testid="option-user-permission">User Permission Change</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select 
                    value={formData.priority} 
                    onValueChange={(value) => handleInputChange("priority", value)}
                    data-testid="select-priority"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low" data-testid="option-low">Low</SelectItem>
                      <SelectItem value="medium" data-testid="option-medium">Medium</SelectItem>
                      <SelectItem value="high" data-testid="option-high">High</SelectItem>
                      <SelectItem value="critical" data-testid="option-critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleInputChange("title", e.target.value)}
                  placeholder="Brief description of the request"
                  data-testid="input-title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  placeholder="Detailed explanation of what you need..."
                  rows={4}
                  data-testid="textarea-description"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetApi">Target API (if applicable)</Label>
                <Select 
                  value={formData.targetApi} 
                  onValueChange={(value) => handleInputChange("targetApi", value)}
                  data-testid="select-target-api"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target API" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salesforce" data-testid="option-salesforce">Salesforce API</SelectItem>
                    <SelectItem value="hubspot" data-testid="option-hubspot">HubSpot CRM</SelectItem>
                    <SelectItem value="snowflake" data-testid="option-snowflake-data">Snowflake Data</SelectItem>
                    <SelectItem value="internal" data-testid="option-internal">Internal Systems</SelectItem>
                  </SelectContent>
                </Select>
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
                  disabled={createRequestMutation.isPending}
                  data-testid="button-submit-request"
                >
                  {createRequestMutation.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
