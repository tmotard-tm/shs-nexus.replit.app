import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, CheckCircle, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface HumanVerificationGateProps {
  onVerificationComplete: () => void;
  originalUrl: string;
}

export function HumanVerificationGate({ onVerificationComplete, originalUrl }: HumanVerificationGateProps) {
  const [isChecked, setIsChecked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStep, setVerificationStep] = useState<'initial' | 'processing' | 'success'>('initial');

  const handleVerify = async () => {
    if (!isChecked) return;

    setIsVerifying(true);
    setVerificationStep('processing');

    try {
      // Simple time-based verification - user must wait at least 2 seconds
      const startTime = Date.now();
      const minWaitTime = 2000;

      const response = await fetch('/api/forms/verify-human', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: startTime,
          originalUrl: originalUrl,
        }),
      });

      if (response.ok) {
        const elapsed = Date.now() - startTime;
        const remainingWait = Math.max(0, minWaitTime - elapsed);

        // Ensure minimum wait time for better user perception
        if (remainingWait > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingWait));
        }

        setVerificationStep('success');
        
        // Brief success display before proceeding
        setTimeout(() => {
          onVerificationComplete();
        }, 1000);
      } else {
        throw new Error('Verification failed');
      }
    } catch (error) {
      console.error('Human verification failed:', error);
      setIsVerifying(false);
      setVerificationStep('initial');
      // Reset checkbox on failure
      setIsChecked(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            {verificationStep === 'success' ? (
              <CheckCircle className="w-8 h-8 text-green-500" />
            ) : (
              <Shield className="w-8 h-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl">
            {verificationStep === 'success' ? 'Verification Complete!' : 'Human Verification Required'}
          </CardTitle>
          <CardDescription>
            {verificationStep === 'success' 
              ? 'Redirecting you to the form...' 
              : 'Please complete this quick verification to access the form'
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {verificationStep === 'initial' && (
            <>
              <div className="flex items-center space-x-3 p-4 bg-muted rounded-lg">
                <Checkbox
                  id="human-verification"
                  checked={isChecked}
                  onCheckedChange={(checked) => setIsChecked(checked === true)}
                  disabled={isVerifying}
                  data-testid="checkbox-human-verification"
                />
                <label 
                  htmlFor="human-verification" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  I'm not a robot
                </label>
              </div>

              <Button
                onClick={handleVerify}
                disabled={!isChecked || isVerifying}
                className="w-full"
                data-testid="button-verify"
              >
                {isVerifying ? 'Verifying...' : 'Verify & Continue'}
              </Button>
            </>
          )}

          {verificationStep === 'processing' && (
            <div className="text-center space-y-4">
              <div className="mx-auto w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4" />
                  Processing verification...
                </p>
                <p className="text-xs text-muted-foreground">This helps us prevent automated access</p>
              </div>
            </div>
          )}

          {verificationStep === 'success' && (
            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                Verification successful! Redirecting...
              </p>
            </div>
          )}

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              This verification helps protect our forms from automated access while maintaining easy access for humans.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}