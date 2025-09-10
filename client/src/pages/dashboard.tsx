import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { StatsCard } from "@/components/stats-card";
import { RequestItem } from "@/components/request-item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { Request } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

export default function Dashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<{
    onboarding: { pending: number; inProgress: number; completed: number };
    vehicleAssignment: { pending: number; inProgress: number; completed: number };
    offboarding: { pending: number; inProgress: number; completed: number };
    decommission: { pending: number; inProgress: number; completed: number };
    activeUsers: number;
  }>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ["/api/requests"],
  });

  const { data: apiConfigurations } = useQuery<Array<{ isActive: boolean }>>({
    queryKey: ["/api/configurations"],
  });

  const recentRequests = (requests as Request[])?.slice(0, 4) || [];

  const systemServices = [
    { name: "API Gateway", status: "healthy" },
    { name: "Snowflake DB", status: "connected" },
    { name: "External APIs", status: apiConfigurations ? `${apiConfigurations.filter((api: any) => api.isActive).length}/${apiConfigurations.length} Active` : "Loading..." },
    { name: "Authentication", status: "online" },
  ];

  const quickActions = [
    { name: "Create Manual Entry", icon: "fas fa-plus" },
    { name: "Sync API Data", icon: "fas fa-sync" },
    { name: "Export Reports", icon: "fas fa-download" },
    { name: "Add New User", icon: "fas fa-user-plus" },
  ];

  const interfacePreviews = [
    {
      name: "Requester Interface",
      icon: "fas fa-user",
      description: "Submit and track requests",
      path: "/requester",
    },
    {
      name: "Approver Interface", 
      icon: "fas fa-check-circle",
      description: "Review and approve requests",
      path: "/approver",
    },
    {
      name: "API Management",
      icon: "fas fa-plug", 
      description: "Manage API connections",
      path: "/api-management",
    },
  ];

  return (
    <MainContent>
      <TopBar title="Administrator Dashboard" breadcrumbs={["Home", "Dashboard"]} />
      
      <main className="p-6">
        <BackButton href="/" />
        {/* Workflow Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          {/* Onboarding */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <i className="fas fa-user-plus text-[hsl(var(--chart-1))]"></i>
                Onboarding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending:</span>
                <span className="font-medium text-[hsl(var(--chart-1))]" data-testid="onboarding-pending">
                  {statsLoading ? "..." : stats?.onboarding?.pending || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">In Progress:</span>
                <span className="font-medium text-[hsl(var(--chart-2))]" data-testid="onboarding-in-progress">
                  {statsLoading ? "..." : stats?.onboarding?.inProgress || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed:</span>
                <span className="font-medium text-[hsl(var(--chart-3))]" data-testid="onboarding-completed">
                  {statsLoading ? "..." : stats?.onboarding?.completed || 0}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Vehicle Assignment */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <i className="fas fa-car text-[hsl(var(--chart-2))]"></i>
                Vehicle Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending:</span>
                <span className="font-medium text-[hsl(var(--chart-1))]" data-testid="vehicle-pending">
                  {statsLoading ? "..." : stats?.vehicleAssignment?.pending || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">In Progress:</span>
                <span className="font-medium text-[hsl(var(--chart-2))]" data-testid="vehicle-in-progress">
                  {statsLoading ? "..." : stats?.vehicleAssignment?.inProgress || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed:</span>
                <span className="font-medium text-[hsl(var(--chart-3))]" data-testid="vehicle-completed">
                  {statsLoading ? "..." : stats?.vehicleAssignment?.completed || 0}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Offboarding */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <i className="fas fa-user-minus text-[hsl(var(--chart-3))]"></i>
                Offboarding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending:</span>
                <span className="font-medium text-[hsl(var(--chart-1))]" data-testid="offboarding-pending">
                  {statsLoading ? "..." : stats?.offboarding?.pending || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">In Progress:</span>
                <span className="font-medium text-[hsl(var(--chart-2))]" data-testid="offboarding-in-progress">
                  {statsLoading ? "..." : stats?.offboarding?.inProgress || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed:</span>
                <span className="font-medium text-[hsl(var(--chart-3))]" data-testid="offboarding-completed">
                  {statsLoading ? "..." : stats?.offboarding?.completed || 0}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Decommission */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <i className="fas fa-trash text-[hsl(var(--chart-4))]"></i>
                Decommission
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending:</span>
                <span className="font-medium text-[hsl(var(--chart-1))]" data-testid="decommission-pending">
                  {statsLoading ? "..." : stats?.decommission?.pending || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">In Progress:</span>
                <span className="font-medium text-[hsl(var(--chart-2))]" data-testid="decommission-in-progress">
                  {statsLoading ? "..." : stats?.decommission?.inProgress || 0}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed:</span>
                <span className="font-medium text-[hsl(var(--chart-3))]" data-testid="decommission-completed">
                  {statsLoading ? "..." : stats?.decommission?.completed || 0}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Requests */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle data-testid="text-recent-requests-title">Recent Requests</CardTitle>
                  <Button variant="link" size="sm" data-testid="button-view-all-requests">
                    View All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {requestsLoading ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : recentRequests.length > 0 ? (
                  recentRequests.map((request) => (
                    <RequestItem
                      key={request.id}
                      request={{ ...request, requesterName: user?.username }}
                    />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground" data-testid="text-no-requests">
                    No requests found
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar Content */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-quick-actions-title">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {quickActions.map((action) => (
                  <Button
                    key={action.name}
                    variant="ghost"
                    className="w-full justify-start"
                    data-testid={`button-quick-${action.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <i className={`${action.icon} text-primary mr-3`}></i>
                    <span>{action.name}</span>
                  </Button>
                ))}
              </CardContent>
            </Card>

            {/* System Status */}
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-system-status-title">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {systemServices.map((service) => (
                  <div key={service.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-[hsl(var(--chart-2))] rounded-full"></div>
                      <span className="text-sm" data-testid={`text-service-${service.name.toLowerCase().replace(/\s+/g, '-')}`}>
                        {service.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground" data-testid={`text-status-${service.name.toLowerCase().replace(/\s+/g, '-')}`}>
                      {service.status}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Interface Previews */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-6" data-testid="text-interface-previews-title">
            Interface Previews
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {interfacePreviews.map((preview) => (
              <Card key={preview.name} className="overflow-hidden">
                <CardHeader className="bg-muted/50">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <i className={`${preview.icon} text-primary`}></i>
                    {preview.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3 mb-4">
                    <div className="h-3 bg-muted rounded w-3/4"></div>
                    <div className="h-8 bg-muted rounded"></div>
                    <div className="h-8 bg-muted rounded"></div>
                    <div className="h-6 bg-primary/20 rounded w-1/2"></div>
                  </div>
                  <Button variant="link" size="sm" className="p-0 h-auto" data-testid={`button-switch-${preview.name.toLowerCase().replace(/\s+/g, '-')}`}>
                    Switch to {preview.name.split(' ')[0]} →
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </MainContent>
  );
}
