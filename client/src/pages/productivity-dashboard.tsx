import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackButton } from "@/components/ui/back-button";
import { TrendingUp, Clock, Users, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

interface DepartmentStats {
  name: string;
  description: string;
  completedToday: number;
  avgResponseTime: number;
  activeStaff: number;
}

interface ProductivityStats {
  ntao: DepartmentStats;
  assets: DepartmentStats;
  inventory: DepartmentStats;
  fleet: DepartmentStats;
}

export default function ProductivityDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect non-superadmin users
  useEffect(() => {
    if (user && user.role !== 'superadmin') {
      setLocation('/');
    }
  }, [user, setLocation]);

  // Don't render if user is not superadmin
  if (!user || user.role !== 'superadmin') {
    return null;
  }

  const { data: productivityStats, isLoading, error } = useQuery<ProductivityStats>({
    queryKey: ["/api/productivity-stats"],
  });

  const formatResponseTime = (hours: number) => {
    if (hours === 0) return "N/A";
    if (hours < 1) return `${Math.round(hours * 60)}min`;
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };

  const renderDepartmentCard = (key: keyof ProductivityStats, departmentData: DepartmentStats) => {
    const colors = {
      ntao: "1", // Blue
      assets: "2", // Green  
      inventory: "3", // Purple
      fleet: "4" // Orange
    };

    const icons = {
      ntao: Clock,
      assets: TrendingUp, 
      inventory: Users,
      fleet: CheckCircle
    };

    const Icon = icons[key];
    const colorClass = colors[key];

    return (
      <Card key={key} className="relative overflow-hidden" data-testid={`card-department-${key}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div 
              className={`w-8 h-8 rounded-lg flex items-center justify-center bg-[hsl(var(--chart-${colorClass})/.1)]`}
            >
              <Icon className={`h-4 w-4 text-[hsl(var(--chart-${colorClass}))]`} />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold" data-testid={`text-${key}-name`}>
                {departmentData.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground" data-testid={`text-${key}-description`}>
                {departmentData.description}
              </p>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Completed Today */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Completed Today</span>
            </div>
            <div className="flex items-center gap-2">
              <span 
                className={`text-2xl font-bold text-[hsl(var(--chart-${colorClass}))]`}
                data-testid={`text-${key}-completed-today`}
              >
                {isLoading ? "..." : departmentData.completedToday}
              </span>
              <TrendingUp className={`h-4 w-4 text-[hsl(var(--chart-${colorClass}))]`} />
            </div>
          </div>

          {/* Average Response Time */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Avg. Response Time</span>
            </div>
            <div className="flex items-center gap-2">
              <span 
                className="text-xl font-semibold"
                data-testid={`text-${key}-avg-response-time`}
              >
                {isLoading ? "..." : formatResponseTime(departmentData.avgResponseTime)}
              </span>
            </div>
          </div>

          {/* Active Staff */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Active Staff</span>
            </div>
            <div className="flex items-center gap-2">
              <span 
                className="text-xl font-semibold"
                data-testid={`text-${key}-active-staff`}
              >
                {isLoading ? "..." : departmentData.activeStaff}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (error) {
    return (
      <div className="p-6">
        <BackButton href="/" />
        <div className="text-center py-8">
          <h2 className="text-xl font-semibold text-destructive mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have permission to view productivity statistics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar 
        title="Department Productivity Dashboard" 
        breadcrumbs={["Home", "Dashboard", "Productivity"]} 
      />
      
      <main className="p-6">
        <BackButton href="/dashboard" />
        
        {/* Loading State */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mt-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-muted rounded-lg"></div>
                    <div>
                      <div className="h-5 bg-muted rounded w-24 mb-1"></div>
                      <div className="h-3 bg-muted rounded w-32"></div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-6 bg-muted rounded w-8"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-4 bg-muted rounded w-28"></div>
                    <div className="h-5 bg-muted rounded w-12"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-4 bg-muted rounded w-20"></div>
                    <div className="h-5 bg-muted rounded w-6"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Department Cards */}
        {!isLoading && productivityStats && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mt-6">
            {Object.entries(productivityStats).map(([key, departmentData]) =>
              renderDepartmentCard(key as keyof ProductivityStats, departmentData)
            )}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !productivityStats && (
          <div className="text-center py-8 mt-6">
            <h3 className="text-lg font-semibold mb-2">No Data Available</h3>
            <p className="text-muted-foreground">
              Productivity statistics will appear here once queue data is available.
            </p>
          </div>
        )}

        {/* Footer Info */}
        {!isLoading && productivityStats && (
          <div className="mt-8 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground text-center">
              Statistics are updated in real-time. Completed Today reflects tasks finished since midnight. 
              Response Time averages the last 30 days of completed tasks.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}