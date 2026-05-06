import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { checkFormAccess, getAccessDeniedMessage } from "@/lib/form-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, ArrowLeft } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { PageSpinner } from "@/components/ui/page-spinner";

interface PermissionProtectedRouteProps {
  children: React.ReactNode;
  formKey: string; // The form key to check permissions for (e.g., 'create-vehicle')
  redirectOnDenied?: boolean; // Whether to redirect or show inline message
}

export function PermissionProtectedRoute({ 
  children, 
  formKey, 
  redirectOnDenied = false 
}: PermissionProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const { permissions, isLoading: permissionsLoading } = usePermissions();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [redirected, setRedirected] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    // Wait until both auth and permissions queries have settled. We do not
    // gate on `accessChecked` here so this effect re-evaluates whenever the
    // merged permissions matrix changes (e.g., after `/api/role-permissions`
    // or `/api/users/:id/permission-overrides` finishes loading or refetches).
    if (isLoading || permissionsLoading) return;
    if (redirected) return;

    // First check if user is authenticated
    if (!user) {
      const path = window.location.pathname;
      const search = window.location.search || "";
      const hash = window.location.hash || "";
      setRedirected(true);
      setLocation(`/login?next=${encodeURIComponent(`${path}${search}${hash}`)}`);
      return;
    }

    // Then check form access permissions using the merged effective
    // permissions (defaults -> stored role row -> user overrides) so the
    // route guard, sidebar, and API authorization stay in lock-step.
    const hasAccess = checkFormAccess(user, formKey, permissions);
    if (!hasAccess && redirectOnDenied) {
      toast({
        title: "Access Denied",
        description: getAccessDeniedMessage(formKey),
        variant: "destructive",
      });
      setRedirected(true);
      setLocation("/dashboard");
    }
    // Otherwise (denied + inline) the render path shows the access-denied card.

    setAccessChecked(true);
  }, [isLoading, permissionsLoading, permissions, user, formKey, redirectOnDenied, redirected, setLocation, toast]);

  // Loading state
  if (isLoading || permissionsLoading || !accessChecked) {
    return <PageSpinner />;
  }

  // Not authenticated
  if (!user) {
    return null; // Redirect handling is in useEffect
  }

  // Check permissions using effective merged permissions (matches API/sidebar)
  const hasAccess = checkFormAccess(user, formKey, permissions);
  
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
                {getAccessDeniedMessage(formKey)}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <div className="text-sm text-muted-foreground" data-testid="current-role">
                Your current role: <span className="font-medium capitalize">{user.role}</span>
              </div>
              <div className="flex flex-col gap-2">
                <Button 
                  variant="default"
                  onClick={() => setLocation("/dashboard")}
                  data-testid="button-back-dashboard"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Go to Dashboard
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setLocation("/")}
                  data-testid="button-home"
                >
                  Return Home
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
  return (
    <>
      <div className="min-h-screen bg-background flex">
        {children}
      </div>
    </>
  );
}