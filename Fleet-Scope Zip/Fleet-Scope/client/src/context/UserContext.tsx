import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface UserContextType {
  currentUser: string | null;
  setCurrentUser: (name: string | null) => void;
  isProfileSet: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const STORAGE_KEY = "fleet-tracker-user";

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  const setCurrentUser = (name: string | null) => {
    setCurrentUserState(name);
    if (name) {
      localStorage.setItem(STORAGE_KEY, name);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setCurrentUserState(stored);
    }
  }, []);

  return (
    <UserContext.Provider value={{ 
      currentUser, 
      setCurrentUser, 
      isProfileSet: !!currentUser 
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
