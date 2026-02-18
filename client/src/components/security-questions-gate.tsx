import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, KeyRound, Loader2, LogOut } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PREDEFINED_SECURITY_QUESTIONS } from "@shared/schema";

export function SecurityQuestionsGate() {
  const { user, requiresSecurityQuestions, clearSecurityQuestionsRequirement, logout } = useAuth();
  const { toast } = useToast();

  const [selectedQuestions, setSelectedQuestions] = useState<Array<{ questionId: string; questionText: string; answer: string }>>([
    { questionId: "", questionText: "", answer: "" },
    { questionId: "", questionText: "", answer: "" },
    { questionId: "", questionText: "", answer: "" },
  ]);

  const saveMutation = useMutation({
    mutationFn: (questions: Array<{ questionId: string; questionText: string; answer: string }>) =>
      apiRequest("POST", "/api/auth/security-questions/setup", { questions }),
    onSuccess: () => {
      toast({ title: "Security Questions Saved", description: "Your account is now protected. You can proceed to use the application." });
      clearSecurityQuestionsRequirement();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (!user || !requiresSecurityQuestions) return null;

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
    <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4" data-testid="security-questions-gate">
      <Card className="w-full max-w-lg shadow-2xl border-2">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <Shield className="h-7 w-7 text-amber-600" />
          </div>
          <CardTitle className="text-xl">Security Questions Required</CardTitle>
          <CardDescription className="text-base">
            Before you can continue, you must set up at least 3 security questions to protect your account. If you forget your password, you'll be asked to answer 2 of them to verify your identity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedQuestions.map((sq, idx) => (
            <div key={idx} className="space-y-2 p-3 border rounded-lg bg-muted/30">
              <Label className="text-sm font-medium">Question {idx + 1}</Label>
              <Select
                value={sq.questionId}
                onValueChange={(val) => handleQuestionChange(idx, val)}
              >
                <SelectTrigger data-testid={`gate-select-sq-${idx}`}>
                  <SelectValue placeholder="Select a security question" />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
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
                data-testid={`gate-input-sq-answer-${idx}`}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Answers are not case-sensitive. Choose questions only you would know the answer to.
          </p>
          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              onClick={logout}
              data-testid="gate-button-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="gate-button-save-security-questions"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Save & Continue
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
