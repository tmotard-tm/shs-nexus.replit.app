import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Eye, EyeOff, CheckCircle, KeyRound, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PREDEFINED_SECURITY_QUESTIONS } from "@shared/schema";

// Form validation schema
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters long"),
  confirmNewPassword: z.string().min(8, "Please confirm your new password")
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: "New passwords don't match",
  path: ["confirmNewPassword"],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export default function ChangePassword() {
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiRequest("POST", "/api/auth/change-password", data),
    onSuccess: () => {
      form.reset();
      toast({
        title: "Success",
        description: "Your password has been changed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Form setup
  const form = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const onSubmit = (data: ChangePasswordFormData) => {
    changePasswordMutation.mutate({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    });
  };

  // Password strength indicator
  const getPasswordStrength = (password: string) => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score < 3) return { strength: "Weak", color: "text-red-500" };
    if (score < 5) return { strength: "Medium", color: "text-yellow-500" };
    return { strength: "Strong", color: "text-green-500" };
  };

  const newPassword = form.watch("newPassword");
  const passwordStrength = getPasswordStrength(newPassword || "");

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold">Change Password</h1>
          <p className="text-muted-foreground">Update your account password for enhanced security</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Password Security
          </CardTitle>
          <CardDescription>
            Change your password for user: <strong>{user?.username}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  data-testid="input-current-password"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                  placeholder="Enter your current password"
                  {...form.register("currentPassword")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  data-testid="button-toggle-current-password"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {form.formState.errors.currentPassword && (
                <p className="text-sm text-red-500">{form.formState.errors.currentPassword.message}</p>
              )}
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  data-testid="input-new-password"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                  placeholder="Enter your new password (min 8 characters)"
                  {...form.register("newPassword")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  data-testid="button-toggle-new-password"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {newPassword && (
                <div className="flex items-center gap-2 text-sm">
                  <span>Password strength:</span>
                  <span className={passwordStrength.color}>{passwordStrength.strength}</span>
                </div>
              )}
              {form.formState.errors.newPassword && (
                <p className="text-sm text-red-500">{form.formState.errors.newPassword.message}</p>
              )}
            </div>

            {/* Confirm New Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmNewPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  data-testid="input-confirm-new-password"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                  placeholder="Confirm your new password"
                  {...form.register("confirmNewPassword")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  data-testid="button-toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {form.formState.errors.confirmNewPassword && (
                <p className="text-sm text-red-500">{form.formState.errors.confirmNewPassword.message}</p>
              )}
            </div>

            {/* Security Guidelines */}
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Password Requirements:</strong>
                <ul className="mt-2 list-disc list-inside space-y-1">
                  <li>At least 8 characters long</li>
                  <li>Mix of uppercase and lowercase letters</li>
                  <li>Include numbers and special characters</li>
                  <li>Different from your current password</li>
                  <li>Not found in data breaches (automatically checked)</li>
                </ul>
              </AlertDescription>
            </Alert>

            {/* Submit Button */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => form.reset()}
                data-testid="button-reset-form"
              >
                Clear Form
              </Button>
              <Button
                type="submit"
                disabled={changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending ? "Changing Password..." : "Change Password"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Security Questions Setup */}
      <SecurityQuestionsSetup />

      {/* Security Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Security Tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium text-green-600">✓ Do</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>Use a unique password for this account</li>
                <li>Use a password manager</li>
                <li>Change your password regularly</li>
                <li>Log out from shared computers</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-red-600">✗ Don't</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>Reuse passwords from other accounts</li>
                <li>Share your password with others</li>
                <li>Use personal information in passwords</li>
                <li>Write passwords on sticky notes</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityQuestionsSetup() {
  const { toast } = useToast();
  const [selectedQuestions, setSelectedQuestions] = useState<Array<{ questionId: string; questionText: string; answer: string }>>([
    { questionId: "", questionText: "", answer: "" },
    { questionId: "", questionText: "", answer: "" },
    { questionId: "", questionText: "", answer: "" },
  ]);

  const statusQuery = useQuery<{ hasSecurityQuestions: boolean }>({
    queryKey: ["/api/auth/security-questions/status"],
  });

  const saveMutation = useMutation({
    mutationFn: (questions: Array<{ questionId: string; questionText: string; answer: string }>) =>
      apiRequest("POST", "/api/auth/security-questions/setup", { questions }),
    onSuccess: () => {
      toast({ title: "Saved", description: "Security questions have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/security-questions/status"] });
      setSelectedQuestions([
        { questionId: "", questionText: "", answer: "" },
        { questionId: "", questionText: "", answer: "" },
        { questionId: "", questionText: "", answer: "" },
      ]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleQuestionChange = (index: number, questionId: string) => {
    const question = PREDEFINED_SECURITY_QUESTIONS.find(q => q.id === questionId);
    if (!question) return;
    setSelectedQuestions(prev => {
      const updated = [...prev];
      updated[index] = { questionId: question.id, questionText: question.text, answer: updated[index].answer };
      return updated;
    });
  };

  const handleAnswerChange = (index: number, answer: string) => {
    setSelectedQuestions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], answer };
      return updated;
    });
  };

  const handleSave = () => {
    const incomplete = selectedQuestions.some(q => !q.questionId || !q.answer.trim());
    if (incomplete) {
      toast({ title: "Incomplete", description: "Please select a question and provide an answer for each row.", variant: "destructive" });
      return;
    }
    const uniqueIds = new Set(selectedQuestions.map(q => q.questionId));
    if (uniqueIds.size !== selectedQuestions.length) {
      toast({ title: "Duplicate Questions", description: "Each security question must be different.", variant: "destructive" });
      return;
    }
    saveMutation.mutate(selectedQuestions);
  };

  const usedQuestionIds = selectedQuestions.map(q => q.questionId).filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Security Questions
        </CardTitle>
        <CardDescription>
          Set up at least 3 security questions. If you forget your password, you'll be asked to answer 2 of them.
          {statusQuery.data?.hasSecurityQuestions && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              Already set up
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            {statusQuery.data?.hasSecurityQuestions && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Your security questions are already set up. You can update them below by selecting new questions and answers.
                </AlertDescription>
              </Alert>
            )}
            {selectedQuestions.map((sq, idx) => (
              <div key={idx} className="space-y-2 p-4 border rounded-lg">
                <Label>Question {idx + 1}</Label>
                <Select
                  value={sq.questionId}
                  onValueChange={(val) => handleQuestionChange(idx, val)}
                >
                  <SelectTrigger data-testid={`select-sq-${idx}`}>
                    <SelectValue placeholder="Select a security question" />
                  </SelectTrigger>
                  <SelectContent>
                    {PREDEFINED_SECURITY_QUESTIONS.map(q => (
                      <SelectItem
                        key={q.id}
                        value={q.id}
                        disabled={usedQuestionIds.includes(q.id) && sq.questionId !== q.id}
                      >
                        {q.text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Your answer"
                  value={sq.answer}
                  onChange={(e) => handleAnswerChange(idx, e.target.value)}
                  data-testid={`input-sq-answer-${idx}`}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Answers are not case-sensitive. Choose questions only you would know the answer to.
            </p>
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                data-testid="button-save-security-questions"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  statusQuery.data?.hasSecurityQuestions ? "Update Security Questions" : "Save Security Questions"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}