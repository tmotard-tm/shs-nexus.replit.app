import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  login: (enterpriseId: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  requiresSecurityQuestions: boolean;
  clearSecurityQuestionsRequirement: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requiresSecurityQuestions, setRequiresSecurityQuestions] = useState(false);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          
          const response = await fetch(`/api/users/${parsedUser.id}`, {
            credentials: "include",
          });
          
          if (response.ok) {
            const freshUserData = await response.json();
            setUser(freshUserData);
            localStorage.setItem("user", JSON.stringify(freshUserData));

            try {
              const sqStatus = await fetch("/api/auth/security-questions/status", { credentials: "include" });
              if (sqStatus.ok) {
                const { hasSecurityQuestions } = await sqStatus.json();
                setRequiresSecurityQuestions(!hasSecurityQuestions);
              } else {
                console.warn("Security questions status check failed, prompting setup as fallback");
                setRequiresSecurityQuestions(true);
              }
            } catch (sqError) {
              console.warn("Security questions status check error, prompting setup as fallback:", sqError);
              setRequiresSecurityQuestions(true);
            }
          } else if (response.status === 401) {
            console.log("Session expired, clearing stored user");
            localStorage.removeItem("user");
            setUser(null);
          } else {
            console.warn("Error verifying session:", response.status, response.statusText);
            setUser(parsedUser);
          }
        }
      } catch (error) {
        console.error("Session verification error:", error);
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = async (enterpriseId: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId, password }),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        localStorage.setItem("user", JSON.stringify(data.user));
        setRequiresSecurityQuestions(!!data.requiresSecurityQuestions);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    setUser(null);
    setRequiresSecurityQuestions(false);
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  const clearSecurityQuestionsRequirement = () => {
    setRequiresSecurityQuestions(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, requiresSecurityQuestions, clearSecurityQuestionsRequirement }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
