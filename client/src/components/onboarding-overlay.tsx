import { useEffect, useState, useRef } from "react";
import { useOnboarding, OnboardingStep } from "@/hooks/use-onboarding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { X, ChevronLeft, ChevronRight, SkipForward, Sparkles, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowPosition: "top" | "bottom" | "left" | "right" | "none";
}

export function OnboardingOverlay() {
  const {
    isActive,
    currentStep,
    steps,
    nextStep,
    prevStep,
    skipOnboarding,
    endOnboarding,
  } = useOnboarding();

  const [spotlight, setSpotlight] = useState<SpotlightPosition | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0, arrowPosition: "none" });
  const [isAnimating, setIsAnimating] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep] as OnboardingStep | undefined;
  const progress = ((currentStep + 1) / steps.length) * 100;
  const isLastStep = currentStep === steps.length - 1;
  const isFirstStep = currentStep === 0;

  useEffect(() => {
    if (!isActive || !step) return;

    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 300);

    if (step.targetSelector) {
      const element = document.querySelector(step.targetSelector);
      if (element) {
        const rect = element.getBoundingClientRect();
        const padding = 8;
        
        setSpotlight({
          top: rect.top - padding + window.scrollY,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        });

        const tooltipWidth = 380;
        const tooltipHeight = 200;
        const margin = 16;

        let top = 0;
        let left = 0;
        let arrowPosition: "top" | "bottom" | "left" | "right" | "none" = "none";

        switch (step.position) {
          case "right":
            top = rect.top + window.scrollY + rect.height / 2 - tooltipHeight / 2;
            left = rect.right + margin;
            arrowPosition = "left";
            if (left + tooltipWidth > window.innerWidth - margin) {
              left = rect.left - tooltipWidth - margin;
              arrowPosition = "right";
            }
            break;
          case "left":
            top = rect.top + window.scrollY + rect.height / 2 - tooltipHeight / 2;
            left = rect.left - tooltipWidth - margin;
            arrowPosition = "right";
            if (left < margin) {
              left = rect.right + margin;
              arrowPosition = "left";
            }
            break;
          case "bottom":
            top = rect.bottom + window.scrollY + margin;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            arrowPosition = "top";
            break;
          case "top":
            top = rect.top + window.scrollY - tooltipHeight - margin;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            arrowPosition = "bottom";
            break;
          default:
            top = window.innerHeight / 2 - tooltipHeight / 2;
            left = window.innerWidth / 2 - tooltipWidth / 2;
            arrowPosition = "none";
        }

        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight + window.scrollY - tooltipHeight - margin));

        setTooltipPos({ top, left, arrowPosition });
      } else {
        setSpotlight(null);
        setTooltipPos({
          top: window.innerHeight / 2 - 100,
          left: window.innerWidth / 2 - 190,
          arrowPosition: "none",
        });
      }
    } else {
      setSpotlight(null);
      setTooltipPos({
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 190,
        arrowPosition: "none",
      });
    }

    return () => clearTimeout(timer);
  }, [isActive, step, currentStep]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      
      if (e.key === "Escape") {
        skipOnboarding();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        nextStep();
      } else if (e.key === "ArrowLeft" && !isFirstStep) {
        prevStep();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, isFirstStep, nextStep, prevStep, skipOnboarding]);

  if (!isActive || !step) return null;

  return (
    <div className="fixed inset-0 z-[100]" data-testid="onboarding-overlay">
      <div 
        className="absolute inset-0 bg-black/60 transition-opacity duration-300"
        onClick={skipOnboarding}
      />
      
      {spotlight && (
        <div
          className="absolute bg-transparent rounded-lg ring-4 ring-primary ring-offset-4 ring-offset-transparent transition-all duration-300 pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: `
              0 0 0 9999px rgba(0, 0, 0, 0.6),
              0 0 20px 5px rgba(var(--primary), 0.3)
            `,
          }}
        />
      )}

      <Card
        ref={cardRef}
        className={cn(
          "fixed w-[380px] shadow-2xl transition-all duration-300 z-[101]",
          isAnimating && "scale-95 opacity-80"
        )}
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
        }}
        data-testid="onboarding-card"
      >
        {tooltipPos.arrowPosition !== "none" && (
          <div
            className={cn(
              "absolute w-3 h-3 bg-card border rotate-45",
              tooltipPos.arrowPosition === "left" && "-left-1.5 top-1/2 -translate-y-1/2 border-l border-b",
              tooltipPos.arrowPosition === "right" && "-right-1.5 top-1/2 -translate-y-1/2 border-r border-t",
              tooltipPos.arrowPosition === "top" && "-top-1.5 left-1/2 -translate-x-1/2 border-l border-t",
              tooltipPos.arrowPosition === "bottom" && "-bottom-1.5 left-1/2 -translate-x-1/2 border-r border-b"
            )}
          />
        )}

        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                {isFirstStep ? (
                  <Sparkles className="h-4 w-4 text-primary" />
                ) : (
                  <HelpCircle className="h-4 w-4 text-primary" />
                )}
              </div>
              <CardTitle className="text-lg" data-testid="onboarding-step-title">
                {step.title}
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => skipOnboarding()}
              data-testid="button-close-onboarding"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          <p className="text-sm text-muted-foreground leading-relaxed" data-testid="onboarding-step-description">
            {step.description}
          </p>
          
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Step {currentStep + 1} of {steps.length}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </CardContent>

        <CardFooter className="flex justify-between gap-2 pt-0">
          <div className="flex gap-2">
            {!isFirstStep && (
              <Button
                variant="outline"
                size="sm"
                onClick={prevStep}
                data-testid="button-prev-step"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          
          <div className="flex gap-2">
            {!isLastStep && (
              <Button
                variant="ghost"
                size="sm"
                onClick={skipOnboarding}
                data-testid="button-skip-onboarding"
              >
                <SkipForward className="h-4 w-4 mr-1" />
                Skip
              </Button>
            )}
            <Button
              size="sm"
              onClick={nextStep}
              data-testid="button-next-step"
            >
              {isLastStep ? (
                "Get Started"
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-[101]">
        {steps.map((_, index) => (
          <button
            key={index}
            className={cn(
              "w-2 h-2 rounded-full transition-all duration-200",
              index === currentStep
                ? "bg-primary w-6"
                : index < currentStep
                ? "bg-primary/60"
                : "bg-muted-foreground/30"
            )}
            onClick={() => {
              if (index < currentStep) {
                const { goToStep } = useOnboarding();
              }
            }}
            data-testid={`onboarding-dot-${index}`}
          />
        ))}
      </div>
    </div>
  );
}
