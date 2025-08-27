import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface BackButtonProps {
  href?: string;
  className?: string;
}

export function BackButton({ href = "/", className = "" }: BackButtonProps) {
  const [, setLocation] = useLocation();

  const handleBack = () => {
    // Try to go back in browser history first, fallback to href
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation(href);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className={`mb-4 ${className}`}
      data-testid="button-back"
    >
      <ChevronLeft className="h-4 w-4 mr-2" />
      Back
    </Button>
  );
}