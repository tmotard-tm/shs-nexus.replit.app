import { useState, useEffect } from "react";
import { HumanVerificationGate } from "./human-verification-gate";

interface PublicFormRouteProps {
  children: React.ReactNode;
}

export function PublicFormRoute({ children }: PublicFormRouteProps) {
  const [isVerified, setIsVerified] = useState<boolean | null>(null); // null = loading
  const [originalUrl, setOriginalUrl] = useState("");

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    try {
      // Capture the full URL including query parameters and hash
      const fullUrl = window.location.pathname + window.location.search + window.location.hash;
      setOriginalUrl(fullUrl);

      const response = await fetch('/api/forms/verify-status', {
        credentials: 'include'
      });
      
      const data = await response.json();
      setIsVerified(data.verified || false);
    } catch (error) {
      console.error('Failed to check verification status:', error);
      setIsVerified(false);
    }
  };

  const handleVerificationComplete = () => {
    setIsVerified(true);
    // The verification is complete, user can now access the form
  };

  // Loading state
  if (isVerified === null) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Checking access...</p>
          </div>
        </div>
      </>
    );
  }

  // Show verification gate if not verified
  if (!isVerified) {
    return (
      <>
        <HumanVerificationGate 
          onVerificationComplete={handleVerificationComplete}
          originalUrl={originalUrl}
        />
      </>
    );
  }

  // User is verified, show the form
  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="w-full">
          {children}
        </div>
      </div>
    </>
  );
}