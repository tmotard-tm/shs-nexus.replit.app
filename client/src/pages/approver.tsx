import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Request } from "@shared/schema";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { CheckCircle, XCircle, Clock } from "lucide-react";

export default function ApproverInterface() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allRequests, isLoading } = useQuery({
    queryKey: ["/api/requests"],
  });

  const pendingRequests = (allRequests as Request[])?.filter(req => req.status === "pending") || [];
  const approvedRequests = (allRequests as Request[])?.filter(req => req.status === "approved") || [];
  const deniedRequests = (allRequests as Request[])?.filter(req => req.status === "denied") || [];

  const updateRequestMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/requests/${id}`, {
        status,
        approverId: user?.id,
      });
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requests"] });
      toast({
        title: "Success",
        description: `Request ${variables.status} successfully`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update request",
        variant: "destructive",
      });
    },
  });

  const handleApprove = (requestId: string) => {
    updateRequestMutation.mutate({ id: requestId, status: "approved" });
  };

  const handleDeny = (requestId: string) => {
    updateRequestMutation.mutate({ id: requestId, status: "denied" });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-[hsl(var(--chart-1)/.1)] text-[hsl(var(--chart-1))]";
      case "approved": return "bg-[hsl(var(--chart-2)/.1)] text-[hsl(var(--chart-2))]";
      case "denied": return "bg-destructive/10 text-destructive";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "api_access": return "fas fa-file-alt";
      case "snowflake_query": return "fas fa-database";
      case "system_config": return "fas fa-cog";
      case "user_permission": return "fas fa-key";
      default: return "fas fa-file-alt";
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Less than an hour ago";
    if (diffInHours === 1) return "1 hour ago";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  const RequestCard = ({ request }: { request: Request }) => (
    <Card key={request.id} className="mb-4">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
              <i className={`${getTypeIcon(request.type)} text-secondary-foreground`}></i>
            </div>
            <div>
              <CardTitle className="text-base" data-testid={`text-request-title-${request.id}`}>
                {request.title}
              </CardTitle>
              <CardDescription data-testid={`text-request-meta-${request.id}`}>
                {formatTimeAgo(request.createdAt)} • Priority: {request.priority}
              </CardDescription>
            </div>
          </div>
          <Badge className={getStatusColor(request.status)} data-testid={`badge-status-${request.id}`}>
            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4" data-testid={`text-request-description-${request.id}`}>
          {request.description}
        </p>
        {request.targetApi && (
          <p className="text-sm mb-4">
            <strong>Target API:</strong> {request.targetApi}
          </p>
        )}
        {request.status === "pending" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleApprove(request.id)}
              disabled={updateRequestMutation.isPending}
              data-testid={`button-approve-${request.id}`}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleDeny(request.id)}
              disabled={updateRequestMutation.isPending}
              data-testid={`button-deny-${request.id}`}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Deny
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <MainContent>
      <TopBar 
        title="Approver Interface" 
        breadcrumbs={["Home", "Approver"]}
      />
      
      <main className="p-6">
        <BackButton href="/" />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="flex items-center p-6">
              <Clock className="h-8 w-8 text-[hsl(var(--chart-1))] mr-4" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-pending-count">{pendingRequests.length}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <CheckCircle className="h-8 w-8 text-[hsl(var(--chart-2))] mr-4" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-approved-count">{approvedRequests.length}</p>
                <p className="text-sm text-muted-foreground">Approved</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <XCircle className="h-8 w-8 text-destructive mr-4" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-denied-count">{deniedRequests.length}</p>
                <p className="text-sm text-muted-foreground">Denied</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center p-6">
              <i className="fas fa-list text-[hsl(var(--chart-4))] text-2xl mr-4"></i>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-count">
                  {(allRequests as Request[])?.length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending ({pendingRequests.length})
            </TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">
              Approved ({approvedRequests.length})
            </TabsTrigger>
            <TabsTrigger value="denied" data-testid="tab-denied">
              Denied ({deniedRequests.length})
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All Requests
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-muted rounded-lg animate-pulse"></div>
                ))}
              </div>
            ) : pendingRequests.length > 0 ? (
              pendingRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-pending">
                    No pending requests
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="approved" className="mt-6">
            {approvedRequests.length > 0 ? (
              approvedRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-approved">
                    No approved requests
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="denied" className="mt-6">
            {deniedRequests.length > 0 ? (
              deniedRequests.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-denied">
                    No denied requests
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="all" className="mt-6">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-muted rounded-lg animate-pulse"></div>
                ))}
              </div>
            ) : (allRequests as Request[])?.length > 0 ? (
              (allRequests as Request[]).map((request) => (
                <RequestCard key={request.id} request={request} />
              ))
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-requests">
                    No requests found
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </MainContent>
  );
}
