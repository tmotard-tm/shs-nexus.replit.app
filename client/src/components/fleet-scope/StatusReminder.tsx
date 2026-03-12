import { useEffect, useState, useRef, useCallback } from "react";
import { AlertCircle } from "lucide-react";

interface StatusReminderProps {
  show: boolean;
  onDismiss?: () => void;
  autoHideDelay?: number;
  position?: "absolute" | "inline" | "top";
}

export function StatusReminder({ show, onDismiss, autoHideDelay = 5000, position = "absolute" }: StatusReminderProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (show) {
      setVisible(true);
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Only set auto-hide timer if delay is greater than 0
      if (autoHideDelay > 0) {
        timerRef.current = setTimeout(() => {
          setVisible(false);
          onDismiss?.();
        }, autoHideDelay);
      }
    } else {
      setVisible(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [show, autoHideDelay, onDismiss]);

  if (!visible) return null;

  const baseClasses = "px-2 py-1.5 bg-amber-50 border border-amber-300 rounded-md shadow-md text-xs text-amber-800 whitespace-nowrap flex items-center gap-1.5 animate-in fade-in duration-200";
  
  const getPositionClasses = () => {
    switch (position) {
      case "inline":
        return "flex-shrink-0";
      case "top":
        return "absolute z-50 left-0 bottom-full mb-1 slide-in-from-bottom-1";
      default:
        return "absolute z-50 left-0 top-full mt-1 slide-in-from-top-1";
    }
  };

  return (
    <div 
      className={`${baseClasses} ${getPositionClasses()}`}
      data-testid="status-reminder-popup"
    >
      <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
      <span>Don't forget to change the status if needed!</span>
    </div>
  );
}

export function useStatusReminder() {
  // Track multiple reminders by truck ID using a Set
  const [reminderTruckIds, setReminderTruckIds] = useState<Set<string>>(new Set());

  const showReminder = useCallback((truckId: string) => {
    setReminderTruckIds(prev => {
      const next = new Set(prev);
      next.add(truckId);
      return next;
    });
  }, []);

  const hideReminder = useCallback((truckId?: string) => {
    if (truckId) {
      // Hide specific truck's reminder
      setReminderTruckIds(prev => {
        const next = new Set(prev);
        next.delete(truckId);
        return next;
      });
    } else {
      // Clear all reminders (backward compatibility)
      setReminderTruckIds(new Set());
    }
  }, []);

  const shouldShowReminder = useCallback((truckId: string) => {
    return reminderTruckIds.has(truckId);
  }, [reminderTruckIds]);

  return {
    reminderTruckIds,
    showReminder,
    hideReminder,
    shouldShowReminder,
  };
}
