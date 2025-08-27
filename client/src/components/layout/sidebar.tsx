import { Link, useLocation } from "wouter";
import { RoleSelector } from "@/components/role-selector";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Database, Users, FileText, CheckCircle, Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  if (!user) return null;

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
    { name: "Requests", href: "/requests", icon: FileText },
    { name: "Approvals", href: "/approvals", icon: CheckCircle },
    { name: "API Management", href: "/api-management", icon: Settings },
    { name: "Snowflake Config", href: "/snowflake", icon: Database },
    { name: "User Management", href: "/users", icon: Users },
    { name: "Activity Logs", href: "/activity", icon: Activity },
  ];

  return (
    <div className="w-64 bg-card border-r border-border fixed h-full left-0 top-0 z-40">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Settings className="h-4 w-4 text-primary-foreground" />
          </div>
          <h1 className="font-semibold text-lg" data-testid="text-app-title">Admin Platform</h1>
        </div>

        <RoleSelector />

        <nav className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Navigation
          </div>
          {navigation.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link key={item.name} href={item.href}>
                <a
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg transition-colors",
                    isActive 
                      ? "bg-accent text-accent-foreground font-medium" 
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                  data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </a>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
            <Users className="h-4 w-4 text-secondary-foreground" />
          </div>
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
        </div>
      </div>
    </div>
  );
}
