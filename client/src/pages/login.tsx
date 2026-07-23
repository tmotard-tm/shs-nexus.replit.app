import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link, useLocation } from "wouter";
import { Settings, Shield, AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { PageSpinner } from "@/components/ui/page-spinner";

function getSsoErrorMessage(error: string | null): string | null {
  if (!error) return null;
  const messages: Record<string, string> = {
    sso_failed: "SSO authentication failed. Please try again or contact your administrator.",
    user_not_found: "Your enterprise account was not found in this application. Please contact your administrator.",
    sso_session_failed: "SSO sign-in completed but session could not be established. Please try again.",
    session_creation_failed: "An error occurred during sign-in. Please try again.",
  };
  return messages[error] || "An unexpected error occurred during sign-in.";
}

export default function Login() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const urlParams = new URLSearchParams(window.location.search);
  const ssoError = getSsoErrorMessage(urlParams.get("error"));

  useEffect(() => {
    if (!isLoading && user) {
      const next = urlParams.get("next");
      setLocation(next && next.startsWith("/") ? next : "/");
    }
  }, [isLoading, user, setLocation]);

  const handleSsoLogin = () => {
    const nextUrl = urlParams.get('next') || '/';
    const ssoUrl = `/auth/login?next=${encodeURIComponent(nextUrl)}`;
    // When running inside an embedded preview iframe (e.g. the Replit
    // workspace preview), the IdP's session cookie is treated as a
    // third-party cookie and blocked, producing a "missing cookie" error.
    // Break out to a top-level tab so the SSO flow can set its cookies.
    const isEmbedded = window.self !== window.top;
    if (isEmbedded) {
      window.open(`${window.location.origin}${ssoUrl}`, "_blank", "noopener");
      return;
    }
    window.location.href = ssoUrl;
  };

  if (isLoading || user) {
    return <PageSpinner />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
              <Settings className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl" data-testid="text-login-title">Nexus</CardTitle>
          <CardDescription data-testid="text-login-description" className="text-sm text-muted-foreground leading-relaxed">
            Enterprise task management operations platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ssoError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{ssoError}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleSsoLogin}
            className="w-full h-11"
            variant="default"
            data-testid="button-sso-login"
          >
            <Shield className="mr-2 h-4 w-4" />
            Sign In with Enterprise SSO
          </Button>

          {window.location.hostname.includes('.replit.dev') && (
            <div className="text-center pt-2">
              <Link href="/manual-login" className="text-sm text-muted-foreground hover:text-primary underline">
                SSO Login Dev Bypass Page
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
