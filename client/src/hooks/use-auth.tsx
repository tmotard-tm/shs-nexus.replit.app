import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  login: (enterpriseId: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        // Check for stored user session
        const storedUser = localStorage.getItem("user");
        if (storedUser) {
          // Verify the session is still valid on the server
          const response = await fetch("/api/users", {
            credentials: "include",
          });
          
          if (response.ok) {
            // Session is valid, keep the stored user
            setUser(JSON.parse(storedUser));
          } else if (response.status === 401) {
            // Session expired or invalid, clear storage
            console.log("Session expired, clearing stored user");
            localStorage.removeItem("user");
            setUser(null);
          } else {
            // Other error, still keep stored user but log the issue
            console.warn("Error verifying session:", response.status, response.statusText);
            setUser(JSON.parse(storedUser));
          }
        }
      } catch (error) {
        console.error("Session verification error:", error);
        // On error, keep stored user if it exists (offline tolerance)
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
        credentials: "include", // Include cookies in the request
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        localStorage.setItem("user", JSON.stringify(data.user));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("user");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
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
