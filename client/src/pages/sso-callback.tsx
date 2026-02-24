// SAML SSO INTEGRATION - SSO callback page
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export default function SsoCallback() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      const params = new URLSearchParams(window.location.search);
      const relay = params.get("relay") || "/";
      const destination = relay.startsWith("/") ? relay : "/";

      if (user) {
        window.location.href = destination;
      } else {
        window.location.href = "/login?error=sso_session_failed";
      }
    }
  }, [user, isLoading]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Completing sign-in...</p>
      </div>
    </div>
  );
}
