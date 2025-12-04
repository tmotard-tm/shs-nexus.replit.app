import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { getUserLandingPage } from "@/lib/role-permissions";
import AssistanceSelection from "@/pages/assistance-selection";

export function RoleBasedHome() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      const landingPage = getUserLandingPage(user);
      
      // Only redirect if it's not the current page (to avoid redirect loops)
      if (landingPage !== '/') {
        console.log(`Redirecting ${user.username} (role: ${user.role}, depts: ${user.departments}) to ${landingPage}`);
        setLocation(landingPage);
      }
    }
  }, [user, isLoading, setLocation]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If user should stay on home page (superadmin, field workers), show AssistanceSelection
  return <AssistanceSelection />;
}