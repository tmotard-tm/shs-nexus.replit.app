import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Settings } from "lucide-react";
import { useLocation } from "wouter";

// Validates the next URL parameter to prevent open redirect attacks
function validateNextUrl(next: string | null): string {
  if (!next) return '/';
  
  try {
    // Create absolute URL to test origin
    const url = new URL(next, window.location.origin);
    
    // Only allow same-origin paths
    if (url.origin !== window.location.origin) {
      return '/';
    }
    
    // Prevent redirect back to login
    if (url.pathname === '/login') {
      return '/';
    }
    
    // Return the validated path with query and hash
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Invalid URL format
    return '/';
  }
}

export default function Login() {
  const [enterpriseId, setEnterpriseId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const success = await login(enterpriseId, password);
      if (success) {
        // Read the next parameter from URL and redirect to intended destination
        const urlParams = new URLSearchParams(window.location.search);
        const nextUrl = urlParams.get('next');
        setLocation(validateNextUrl(nextUrl));
      } else {
        toast({
          title: "Login Failed",
          description: "Invalid username or password",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred during login",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
              <Settings className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl" data-testid="text-login-title">Sears Management Platform</CardTitle>
          <CardDescription data-testid="text-login-description">
            Sign in to access Sears Operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="enterpriseId">Enterprise ID</Label>
              <Input
                id="enterpriseId"
                type="text"
                value={enterpriseId}
                onChange={(e) => setEnterpriseId(e.target.value)}
                placeholder="Enter your Enterprise ID"
                required
                data-testid="input-enterprise-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                data-testid="input-password"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <p>Demo credentials:</p>
            <p><strong>Requesters:</strong> ENT1234</p>
            <p><strong>Approvers:</strong> ENT1235</p>
            <p><strong>Administrators:</strong> ADMIN123</p>
            <p><strong>Password:</strong> passwords</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
