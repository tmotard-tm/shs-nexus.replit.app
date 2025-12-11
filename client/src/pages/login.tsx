import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Settings, Eye, EyeOff, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

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
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);

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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!forgotPasswordEmail.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter your email address",
        variant: "destructive",
      });
      return;
    }

    setForgotPasswordLoading(true);

    try {
      await apiRequest("POST", "/api/auth/forgot-password", {
        email: forgotPasswordEmail.trim()
      });
      
      setForgotPasswordSent(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send password reset email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const handleForgotPasswordDialogChange = (open: boolean) => {
    if (!open) {
      // Only reset form state when closing
      setForgotPasswordEmail("");
      setForgotPasswordSent(false);
    }
    setShowForgotPassword(open);
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
          <CardTitle className="text-2xl" data-testid="text-login-title">SearsDrive Line Management</CardTitle>
          <CardDescription data-testid="text-login-description">
            <em>Where driving is made easy</em>
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  data-testid="input-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
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
          
          <div className="mt-4 text-center">
            <span
              className="text-sm text-muted-foreground cursor-not-allowed"
              data-testid="link-forgot-password"
              title="Password reset is temporarily unavailable. Please contact your supervisor or admin."
            >
              Forgot Password?
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Forgot Password Dialog */}
      <Dialog open={showForgotPassword} onOpenChange={handleForgotPasswordDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {forgotPasswordSent 
                ? "Check your email for password reset instructions."
                : "Enter your email address and we'll send you a password reset link."
              }
            </DialogDescription>
          </DialogHeader>
          
          {forgotPasswordSent ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  If an account exists with the email <strong>{forgotPasswordEmail}</strong>, you will receive a password reset email shortly.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Please check your inbox and spam folder. The reset link will expire in 1 hour.
              </p>
              <Button 
                onClick={() => handleForgotPasswordDialogChange(false)} 
                className="w-full"
                data-testid="button-close-forgot-password"
              >
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email Address</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  placeholder="Enter your email address"
                  required
                  disabled={forgotPasswordLoading}
                  data-testid="input-forgot-email"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => handleForgotPasswordDialogChange(false)}
                  className="flex-1"
                  disabled={forgotPasswordLoading}
                  data-testid="button-cancel-forgot-password"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  className="flex-1"
                  disabled={forgotPasswordLoading}
                  data-testid="button-submit-forgot-password"
                >
                  {forgotPasswordLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
