import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { checkRouteAccess, getRoleAccessDeniedMessage, getRoleDisplayName } from "@/lib/role-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, ArrowLeft, Home } from "lucide-react";

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  redirectOnDenied?: boolean; // Whether to redirect or show inline message
}

export function RoleProtectedRoute({ 
  children, 
  redirectOnDenied = false 
}: RoleProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const { permissions, isLoading: permissionsLoading } = usePermissions();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [redirected, setRedirected] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    if (!isLoading && !permissionsLoading && !redirected && !accessChecked) {
      // First check if user is authenticated
      if (!user) {
        const path = window.location.pathname;
        const search = window.location.search || "";
        const hash = window.location.hash || "";
        setRedirected(true);
        setLocation(`/login?next=${encodeURIComponent(`${path}${search}${hash}`)}`);
        return;
      }

      // Then check role-based route access permissions using stored permissions
      const hasAccess = checkRouteAccess(user, location, permissions);
      if (!hasAccess) {
        if (redirectOnDenied) {
          // Redirect to home with toast notification
          toast({
            title: "Access Denied",
            description: getRoleAccessDeniedMessage(user.role, location),
            variant: "destructive",
          });
          setRedirected(true);
          setLocation("/");
        }
        // If not redirecting, we'll show inline access denied message
      }
      
      setAccessChecked(true);
    }
  }, [isLoading, permissionsLoading, user, location, redirectOnDenied, redirected, accessChecked, setLocation, toast, permissions]);

  // Loading state
  if (isLoading || permissionsLoading || !accessChecked) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </>
    );
  }

  // Not authenticated
  if (!user) {
    return null; // Redirect handling is in useEffect
  }

  // Check permissions using stored permissions
  const hasAccess = checkRouteAccess(user, location, permissions);
  
  // Access denied - show inline message
  if (!hasAccess && !redirectOnDenied) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <Card className="max-w-md w-full" data-testid="access-denied-card">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <ShieldX className="h-16 w-16 text-destructive" data-testid="icon-access-denied" />
              </div>
              <CardTitle className="text-2xl" data-testid="title-access-denied">
                Access Denied
              </CardTitle>
              <CardDescription data-testid="message-access-denied">
                {getRoleAccessDeniedMessage(user.role, location)}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <div className="text-sm text-muted-foreground" data-testid="current-role">
                Your current role: <span className="font-medium">{getRoleDisplayName(user.role)}</span>
              </div>
              <div className="flex flex-col gap-2">
                <Button 
                  variant="default"
                  onClick={() => setLocation("/")}
                  data-testid="button-home"
                >
                  <Home className="h-4 w-4 mr-2" />
                  Go to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Access denied and should redirect (handled by useEffect)
  if (!hasAccess && redirectOnDenied) {
    return null;
  }

  // Access granted - render the protected content
  return children;
}