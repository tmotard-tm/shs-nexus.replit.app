import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { CheckCircle, Loader2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusMessage {
  id: string;
  message: string;
  type: "info" | "success" | "error" | "loading";
  duration?: number;
}

interface StatusBarContextType {
  showStatus: (message: string, type?: StatusMessage["type"], duration?: number) => string;
  hideStatus: (id: string) => void;
  clearAll: () => void;
}

const StatusBarContext = createContext<StatusBarContextType | undefined>(undefined);

export function useStatusBar() {
  const context = useContext(StatusBarContext);
  if (!context) {
    throw new Error("useStatusBar must be used within a StatusBarProvider");
  }
  return context;
}

export function StatusBarProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  const showStatus = useCallback((message: string, type: StatusMessage["type"] = "info", duration: number = 5000): string => {
    const id = `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMessage: StatusMessage = { id, message, type, duration };
    
    setMessages(prev => [...prev, newMessage]);

    if (duration > 0 && type !== "loading") {
      setTimeout(() => {
        setMessages(prev => prev.filter(m => m.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const hideStatus = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <StatusBarContext.Provider value={{ showStatus, hideStatus, clearAll }}>
      {children}
      <StatusBar messages={messages} onDismiss={hideStatus} />
    </StatusBarContext.Provider>
  );
}

function StatusBar({ messages, onDismiss }: { messages: StatusMessage[]; onDismiss: (id: string) => void }) {
  if (messages.length === 0) return null;

  const latestMessage = messages[messages.length - 1];

  const getIcon = (type: StatusMessage["type"]) => {
    switch (type) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "loading":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  const getBgColor = (type: StatusMessage["type"]) => {
    switch (type) {
      case "success":
        return "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800";
      case "error":
        return "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800";
      case "loading":
        return "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800";
      default:
        return "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800";
    }
  };

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
      data-testid="status-bar-container"
    >
      <div className="flex justify-center p-4">
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-3 px-4 py-2 rounded-lg border shadow-lg transition-all duration-300 animate-in slide-in-from-bottom-4",
            getBgColor(latestMessage.type)
          )}
          data-testid="status-bar"
        >
          {getIcon(latestMessage.type)}
          <span className="text-sm font-medium text-foreground" data-testid="status-bar-message">
            {latestMessage.message}
          </span>
          {latestMessage.type !== "loading" && (
            <button
              onClick={() => onDismiss(latestMessage.id)}
              className="ml-2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              data-testid="status-bar-dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
