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
  const [resetStep, setResetStep] = useState<"email" | "token" | "done">("email");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

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
      setResetStep("token");
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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!resetToken.trim()) {
      toast({ title: "Token Required", description: "Please enter the reset token from your email", variant: "destructive" });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      toast({ title: "Invalid Password", description: "Password must be at least 8 characters long", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords Don't Match", description: "Please make sure both passwords match", variant: "destructive" });
      return;
    }

    setResetLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", {
        resetToken: resetToken.trim(),
        newPassword,
      });
      setResetStep("done");
      toast({ title: "Password Reset", description: "Your password has been reset successfully. You can now log in." });
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Invalid or expired token. Please request a new one.",
        variant: "destructive",
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotPasswordDialogChange = (open: boolean) => {
    if (!open) {
      setForgotPasswordEmail("");
      setForgotPasswordSent(false);
      setResetStep("email");
      setResetToken("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowNewPassword(false);
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
          <CardTitle className="text-2xl" data-testid="text-login-title">Nexus</CardTitle>
          <CardDescription data-testid="text-login-description" className="text-sm text-muted-foreground leading-relaxed">
            Enterprise task management operations platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems.
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
            <button
              type="button"
              className="text-sm text-primary hover:underline cursor-pointer"
              data-testid="link-forgot-password"
              onClick={() => setShowForgotPassword(true)}
            >
              Forgot Password?
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Forgot Password Dialog */}
      <Dialog open={showForgotPassword} onOpenChange={handleForgotPasswordDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetStep === "email" && "Enter your email address and we'll send you a reset code."}
              {resetStep === "token" && "Enter the reset code from your email and choose a new password."}
              {resetStep === "done" && "Your password has been reset successfully."}
            </DialogDescription>
          </DialogHeader>
          
          {resetStep === "email" && (
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
                    "Send Reset Code"
                  )}
                </Button>
              </div>
            </form>
          )}

          {resetStep === "token" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  A reset code has been sent to <strong>{forgotPasswordEmail}</strong>. Check your inbox and spam folder.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-token">Reset Code</Label>
                <Input
                  id="reset-token"
                  type="text"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste the reset code from your email"
                  required
                  disabled={resetLoading}
                  data-testid="input-reset-token"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    disabled={resetLoading}
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirm New Password</Label>
                <Input
                  id="confirm-new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  required
                  disabled={resetLoading}
                  data-testid="input-confirm-new-password"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => { setResetStep("email"); setForgotPasswordSent(false); }}
                  className="flex-1"
                  disabled={resetLoading}
                >
                  Back
                </Button>
                <Button 
                  type="submit"
                  className="flex-1"
                  disabled={resetLoading}
                  data-testid="button-reset-password"
                >
                  {resetLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </div>
            </form>
          )}

          {resetStep === "done" && (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Your password has been updated. You can now sign in with your new password.
                </p>
              </div>
              <Button 
                onClick={() => handleForgotPasswordDialogChange(false)} 
                className="w-full"
                data-testid="button-close-forgot-password"
              >
                Back to Login
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
