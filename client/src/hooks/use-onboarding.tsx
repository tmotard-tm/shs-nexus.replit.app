import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useAuth } from "./use-auth";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  action?: "click" | "navigate" | "info";
  path?: string;
}

interface OnboardingContextType {
  isActive: boolean;
  currentStep: number;
  steps: OnboardingStep[];
  hasCompletedOnboarding: boolean;
  startOnboarding: () => void;
  endOnboarding: (completed?: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => void;
  goToStep: (step: number) => void;
  resetOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = "admin_platform_onboarding_completed";

const getStepsForRole = (role: string, departments?: string[]): OnboardingStep[] => {
  const commonSteps: OnboardingStep[] = [
    {
      id: "welcome",
      title: "Welcome to Operations Portal!",
      description: "This quick tutorial will help you get started with the platform. We'll walk you through the main features and how to navigate around.",
      position: "center",
      action: "info",
    },
    {
      id: "sidebar",
      title: "Navigation Sidebar",
      description: "Use the sidebar to navigate between different sections of the platform. You can collapse it by clicking the arrow button for more screen space.",
      targetSelector: '[data-testid="button-toggle-sidebar"]',
      position: "right",
      action: "info",
    },
    {
      id: "theme",
      title: "Light & Dark Mode",
      description: "Click the theme toggle to switch between light and dark mode based on your preference.",
      targetSelector: '[data-testid="button-theme-toggle"]',
      position: "bottom",
      action: "info",
    },
  ];

  const agentSteps: OnboardingStep[] = [
    ...commonSteps,
    {
      id: "queue",
      title: "Task Queue",
      description: "This is where you'll find tasks in your assigned departments. New tasks appear here automatically, and you can pick them up to start working.",
      targetSelector: '[data-testid="link-nav-queue-management"]',
      position: "right",
      action: "info",
    },
    {
      id: "task-workflow",
      title: "Working on Tasks",
      description: "When you pick up a task, you'll be guided through a checklist of steps. Complete each step and mark your progress as you go.",
      position: "center",
      action: "info",
    },
    {
      id: "complete",
      title: "You're All Set!",
      description: "That's the basics! You can restart this tutorial anytime from the sidebar menu. Happy working!",
      position: "center",
      action: "info",
    },
  ];

  const superadminSteps: OnboardingStep[] = [
    ...commonSteps,
    {
      id: "dashboard",
      title: "Dashboard Overview",
      description: "The dashboard gives you a bird's eye view of all activities including onboarding, offboarding, and vehicle assignments across the organization.",
      targetSelector: '[data-testid="link-nav-dashboard"]',
      position: "right",
      action: "info",
    },
    {
      id: "analytics",
      title: "Analytics & Insights",
      description: "View detailed analytics and vehicle assignment dashboards to track performance and identify trends.",
      targetSelector: '[data-testid="link-nav-vehicle-assignment-dash"]',
      position: "right",
      action: "info",
    },
    {
      id: "queue-management",
      title: "Task Queue",
      description: "Manage work queues across all departments. Assign tasks, monitor progress, and ensure work is distributed efficiently.",
      targetSelector: '[data-testid="link-nav-queue-management"]',
      position: "right",
      action: "info",
    },
    {
      id: "user-management",
      title: "User Management",
      description: "Add new users, manage roles and permissions, and control access to different parts of the platform.",
      targetSelector: '[data-testid="link-nav-user-management"]',
      position: "right",
      action: "info",
    },
    {
      id: "integrations",
      title: "API Integrations",
      description: "Configure and monitor external API connections like Holman Fleet and Snowflake for seamless data synchronization.",
      targetSelector: '[data-testid="link-nav-integrations-management"]',
      position: "right",
      action: "info",
    },
    {
      id: "templates",
      title: "Template Management",
      description: "Create and manage workflow templates that define how tasks are structured and what steps agents need to complete.",
      targetSelector: '[data-testid="link-nav-template-management"]',
      position: "right",
      action: "info",
    },
    {
      id: "complete",
      title: "You're All Set!",
      description: "That covers the main features! You can restart this tutorial anytime from the help menu in the sidebar. Explore the platform and reach out if you have questions!",
      position: "center",
      action: "info",
    },
  ];

  const defaultSteps: OnboardingStep[] = [
    ...commonSteps,
    {
      id: "home",
      title: "Home Page",
      description: "The home page provides quick access to common actions like creating vehicles, onboarding employees, and starting offboarding processes.",
      targetSelector: '[data-testid="link-nav-home"]',
      position: "right",
      action: "info",
    },
    {
      id: "workflows",
      title: "Starting Workflows",
      description: "Click on any workflow card to start a new process. The system will guide you through each step with clear instructions.",
      position: "center",
      action: "info",
    },
    {
      id: "complete",
      title: "You're All Set!",
      description: "That's the basics! Feel free to explore and reach out if you need help. You can restart this tutorial anytime.",
      position: "center",
      action: "info",
    },
  ];

  if (role === 'superadmin') {
    return superadminSteps;
  }

  if (role === 'agent') {
    return agentSteps;
  }

  return defaultSteps;
};

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);

  useEffect(() => {
    if (user) {
      const storageKey = `${ONBOARDING_STORAGE_KEY}_${user.id}`;
      const completed = localStorage.getItem(storageKey) === "true";
      setHasCompletedOnboarding(completed);
      setSteps(getStepsForRole(user.role, user.departments ?? undefined));
      
      if (!completed) {
        const timer = setTimeout(() => {
          setIsActive(true);
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [user]);

  const startOnboarding = useCallback(() => {
    if (user) {
      setSteps(getStepsForRole(user.role, user.departments ?? undefined));
      setCurrentStep(0);
      setIsActive(true);
    }
  }, [user]);

  const endOnboarding = useCallback((completed = true) => {
    setIsActive(false);
    setCurrentStep(0);
    if (completed && user) {
      const storageKey = `${ONBOARDING_STORAGE_KEY}_${user.id}`;
      localStorage.setItem(storageKey, "true");
      setHasCompletedOnboarding(true);
    }
  }, [user]);

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      endOnboarding(true);
    }
  }, [currentStep, steps.length, endOnboarding]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const skipOnboarding = useCallback(() => {
    endOnboarding(true);
  }, [endOnboarding]);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < steps.length) {
      setCurrentStep(step);
    }
  }, [steps.length]);

  const resetOnboarding = useCallback(() => {
    if (user) {
      const storageKey = `${ONBOARDING_STORAGE_KEY}_${user.id}`;
      localStorage.removeItem(storageKey);
      setHasCompletedOnboarding(false);
      setCurrentStep(0);
    }
  }, [user]);

  return (
    <OnboardingContext.Provider
      value={{
        isActive,
        currentStep,
        steps,
        hasCompletedOnboarding,
        startOnboarding,
        endOnboarding,
        nextStep,
        prevStep,
        skipOnboarding,
        goToStep,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}
