import { Link, useLocation } from "wouter";
import { RoleSelector } from "@/components/role-selector";
import { useAuth } from "@/hooks/use-auth";
import { useSidebar } from "@/hooks/use-sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LogOut, Settings, Database, Users, FileText, CheckCircle, Activity, BarChart3, Home, ChevronLeft, ChevronRight, Clock, MapPin, TrendingUp, Key } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { isCollapsed, setIsCollapsed } = useSidebar();

  if (!user) return null;

  // Role-based navigation system
  const getNavigationForRole = (userRole: string) => {
    const baseItems = {
      home: { name: "Home", href: "/", icon: Home },
      dashboard: { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
      analytics: { name: "Analytics Board", href: "/analytics", icon: Activity },
      operations: { name: "Operations Dashboard", href: "/operations", icon: BarChart3 },
      queueManagement: { name: "Queue Management", href: "/queue-management", icon: Clock },
      ntaoQueue: { name: "NTAO — National Truck Assortment Queue", href: "/ntao-queue", icon: Clock },
      assetsQueue: { name: "Assets Queue", href: "/assets-queue", icon: Clock },
      inventoryQueue: { name: "Inventory Queue", href: "/inventory-queue", icon: Clock },
      fleetQueue: { name: "Fleet Queue", href: "/fleet-queue", icon: Clock },
      storageSpots: { name: "Storage Spots", href: "/storage-spots", icon: MapPin },
      requests: { name: "Requests", href: "/requests", icon: FileText },
      approvals: { name: "Approvals", href: "/approvals", icon: CheckCircle },
      apiManagement: { name: "API Management", href: "/api-management", icon: Settings },
      snowflake: { name: "Snowflake Config", href: "/snowflake", icon: Database },
      userManagement: { name: "User Management", href: "/users", icon: Users },
      activityLogs: { name: "Activity Logs", href: "/activity", icon: Activity },
      changePassword: { name: "Change Password", href: "/change-password", icon: Key },
    };

    switch (userRole) {
      case 'assets':
        return [baseItems.home, baseItems.assetsQueue, baseItems.changePassword];
      
      case 'fleet':
        return [baseItems.home, baseItems.fleetQueue, baseItems.changePassword];
      
      case 'inventory':
        return [baseItems.home, baseItems.inventoryQueue, baseItems.changePassword];
      
      case 'ntao':
        return [baseItems.home, baseItems.ntaoQueue, baseItems.changePassword];
      
      case 'field':
        return [baseItems.home, baseItems.changePassword]; // Field users can change their password
      
      case 'superadmin':
        return [
          baseItems.home,
          baseItems.dashboard,
          baseItems.analytics,
          baseItems.operations, // Operations dashboard with comprehensive metrics
          baseItems.queueManagement,
          baseItems.storageSpots,
          baseItems.requests,
          baseItems.approvals,
          baseItems.apiManagement,
          baseItems.snowflake,
          baseItems.userManagement,
          baseItems.activityLogs,
          baseItems.changePassword,
        ];
      
      default:
        // Legacy fallback for existing users
        return [
          baseItems.home,
          baseItems.dashboard,
          baseItems.analytics,
          baseItems.queueManagement,
          baseItems.storageSpots,
          baseItems.requests,
          baseItems.approvals,
        ];
    }
  };

  const navigation = getNavigationForRole(user.role);

  return (
    <div className={cn(
      "bg-card border-r border-border fixed h-full left-0 top-0 z-40 transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "fixed top-6 z-50 h-6 w-6 rounded-full border border-border bg-background transition-all duration-300",
          isCollapsed ? "left-14" : "left-60"
        )}
        data-testid="button-toggle-sidebar"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </Button>

      <div className={cn("p-6", isCollapsed && "p-3")}>
        <div className={cn("flex items-center gap-3 mb-8", isCollapsed && "justify-center mb-6")}>
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Settings className="h-4 w-4 text-primary-foreground" />
          </div>
          {!isCollapsed && (
            <h1 className="font-semibold text-lg" data-testid="text-app-title">Admin Platform</h1>
          )}
        </div>

        {!isCollapsed && <RoleSelector />}

        <nav className="space-y-2">
          {!isCollapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Navigation
            </div>
          )}
          {navigation.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg transition-colors",
                  isActive 
                    ? "bg-accent text-accent-foreground font-medium" 
                    : "hover:bg-accent hover:text-accent-foreground",
                  isCollapsed && "justify-center"
                )}
                data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                title={isCollapsed ? item.name : undefined}
              >
                <Icon className="h-4 w-4" />
                {!isCollapsed && item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className={cn(
        "absolute bottom-0 left-0 right-0 p-6 border-t border-border space-y-3",
        isCollapsed && "p-3"
      )}>
        {/* Theme Toggle */}
        <div className={cn("flex", isCollapsed ? "justify-center" : "justify-end")}>
          <ThemeToggle />
        </div>
        
        {/* User Section */}
        <div className={cn("flex items-center gap-3", isCollapsed && "justify-center")}>
          <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
            <Users className="h-4 w-4 text-secondary-foreground" />
          </div>
          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" data-testid="text-user-name">
                  {user.username}
                </div>
                <div className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
                  {user.email}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
          {isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="w-8 h-8 p-0 absolute bottom-2"
              data-testid="button-logout"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
