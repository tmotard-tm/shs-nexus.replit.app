import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

interface UserContextType {
  currentUser: string | null;
  setCurrentUser: (name: string | null) => void;
  isProfileSet: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const currentUser = user?.name ?? user?.username ?? null;

  const setCurrentUser = (_name: string | null) => {
  };

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
