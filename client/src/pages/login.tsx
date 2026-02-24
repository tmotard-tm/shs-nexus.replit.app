import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Settings, Eye, EyeOff, Loader2, Shield, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";

function validateNextUrl(next: string | null): string {
  if (!next) return '/';
  
  try {
    const url = new URL(next, window.location.origin);
    
    if (url.origin !== window.location.origin) {
      return '/';
    }
    
    if (url.pathname === '/login') {
      return '/';
    }
    
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

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
  const [enterpriseId, setEnterpriseId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showManualLogin, setShowManualLogin] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetStep, setResetStep] = useState<"username" | "questions" | "done">("username");
  const [resetUsername, setResetUsername] = useState("");
  const [securityQuestions, setSecurityQuestions] = useState<Array<{ questionId: string; questionText: string }>>([]);
  const [securityAnswers, setSecurityAnswers] = useState<Record<string, string>>({});
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // SAML SSO INTEGRATION - Check for SSO error in URL
  const urlParams = new URLSearchParams(window.location.search);
  const ssoError = getSsoErrorMessage(urlParams.get("error"));

  const handleSsoLogin = () => {
    const nextUrl = urlParams.get('next') || '/';
    window.location.href = `/auth/login?next=${encodeURIComponent(nextUrl)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const success = await login(enterpriseId, password);
      if (success) {
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

  const parseApiError = (error: any, fallback: string): string => {
    try {
      const raw = error.message || "";
      const jsonPart = raw.includes("{") ? raw.substring(raw.indexOf("{")) : "";
      if (jsonPart) {
        const parsed = JSON.parse(jsonPart);
        if (parsed.message) return parsed.message;
      }
    } catch {}
    return fallback;
  };

  const handleLookupUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUsername.trim()) {
      toast({ title: "Username Required", description: "Please enter your Enterprise ID", variant: "destructive" });
      return;
    }

    setResetLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/security-questions/get-questions", {
        username: resetUsername.trim(),
      });
      const data = await res.json();
      setSecurityQuestions(data.questions);
      setSecurityAnswers({});
      setResetStep("questions");
    } catch (error: any) {
      toast({ title: "Unable to Reset", description: parseApiError(error, "Could not find account or security questions are not set up."), variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();

    const unanswered = securityQuestions.some(q => !securityAnswers[q.questionId]?.trim());
    if (unanswered) {
      toast({ title: "Answers Required", description: "Please answer all security questions", variant: "destructive" });
      return;
    }
    if (!newPassword || newPassword.length < 10) {
      toast({ title: "Invalid Password", description: "Password must be at least 10 characters long", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords Don't Match", description: "Please make sure both passwords match", variant: "destructive" });
      return;
    }

    setResetLoading(true);
    try {
      await apiRequest("POST", "/api/auth/security-questions/verify-and-reset", {
        username: resetUsername.trim(),
        answers: securityQuestions.map(q => ({ questionId: q.questionId, answer: securityAnswers[q.questionId] || "" })),
        newPassword,
      });
      setResetStep("done");
    } catch (error: any) {
      toast({ title: "Reset Failed", description: parseApiError(error, "Verification failed. Please check your answers."), variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotPasswordDialogChange = (open: boolean) => {
    if (!open) {
      setResetStep("username");
      setResetUsername("");
      setSecurityQuestions([]);
      setSecurityAnswers({});
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
        <CardContent className="space-y-4">
          {ssoError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{ssoError}</AlertDescription>
            </Alert>
          )}

          {/* SAML SSO INTEGRATION - Primary SSO login button */}
          <Button
            onClick={handleSsoLogin}
            className="w-full h-11"
            variant="default"
            data-testid="button-sso-login"
          >
            <Shield className="mr-2 h-4 w-4" />
            Sign In with Enterprise SSO
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {showManualLogin ? "or" : ""}
              </span>
            </div>
          </div>

          {!showManualLogin ? (
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                onClick={() => setShowManualLogin(true)}
                data-testid="link-manual-login"
              >
                Use Enterprise ID & Password instead
              </button>
            </div>
          ) : (
            <>
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
                  variant="outline"
                  data-testid="button-login"
                >
                  {isLoading ? "Signing in..." : "Sign In with Password"}
                </Button>
              </form>
              
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-primary hover:underline cursor-pointer"
                  data-testid="link-forgot-password"
                  onClick={() => setShowForgotPassword(true)}
                >
                  Forgot Password?
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Forgot Password Dialog - Security Questions Flow */}
      <Dialog open={showForgotPassword} onOpenChange={handleForgotPasswordDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              {resetStep === "username" && "Enter your Enterprise ID to look up your security questions."}
              {resetStep === "questions" && "Answer your security questions and set a new password."}
              {resetStep === "done" && "Your password has been reset successfully."}
            </DialogDescription>
          </DialogHeader>
          
          {resetStep === "username" && (
            <form onSubmit={handleLookupUsername} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-username">Enterprise ID</Label>
                <Input
                  id="reset-username"
                  type="text"
                  value={resetUsername}
                  onChange={(e) => setResetUsername(e.target.value)}
                  placeholder="Enter your Enterprise ID"
                  required
                  disabled={resetLoading}
                  data-testid="input-reset-username"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => handleForgotPasswordDialogChange(false)}
                  className="flex-1"
                  disabled={resetLoading}
                  data-testid="button-cancel-forgot-password"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  className="flex-1"
                  disabled={resetLoading}
                  data-testid="button-lookup-username"
                >
                  {resetLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Looking up...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
              </div>
            </form>
          )}

          {resetStep === "questions" && (
            <form onSubmit={handleVerifyAndReset} className="space-y-4">
              {securityQuestions.map((q, idx) => (
                <div key={q.questionId} className="space-y-2">
                  <Label htmlFor={`sq-${q.questionId}`}>{idx + 1}. {q.questionText}</Label>
                  <Input
                    id={`sq-${q.questionId}`}
                    type="text"
                    value={securityAnswers[q.questionId] || ""}
                    onChange={(e) => setSecurityAnswers(prev => ({ ...prev, [q.questionId]: e.target.value }))}
                    placeholder="Your answer"
                    required
                    disabled={resetLoading}
                    data-testid={`input-sq-${q.questionId}`}
                  />
                </div>
              ))}
              <hr className="border-border" />
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 10 characters"
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
                  onClick={() => { setResetStep("username"); setSecurityAnswers({}); setNewPassword(""); setConfirmNewPassword(""); }}
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
