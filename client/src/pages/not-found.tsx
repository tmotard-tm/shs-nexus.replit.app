import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center text-center gap-4">
            <AlertCircle className="h-16 w-16 text-destructive" />
            <div>
              <h1 className="text-3xl font-bold text-foreground">404</h1>
              <p className="text-xl font-semibold text-foreground mt-1">Page Not Found</p>
            </div>
            <p className="text-sm text-muted-foreground">
              The page you're looking for doesn't exist or has been moved.
            </p>
            <div className="flex flex-col gap-2 w-full mt-2">
              <Button onClick={() => setLocation("/")} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                Go to Nexus Home
              </Button>
              <Button variant="outline" onClick={() => window.history.back()} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go Back
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
