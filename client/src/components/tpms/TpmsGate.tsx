import { useHasPermission } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TpmsGateProps {
  children: React.ReactNode;
}

export function TpmsGate({ children }: TpmsGateProps) {
  const hasTpmsAccess = useHasPermission("sidebar.tpms");
  const [, setLocation] = useLocation();

  if (!hasTpmsAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full" data-testid="tpms-access-denied-card">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <ShieldX className="h-16 w-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Access Denied</CardTitle>
            <CardDescription>
              You do not have permission to access the TPMS module. Contact your administrator to request access.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button variant="default" onClick={() => setLocation("/")}>
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
