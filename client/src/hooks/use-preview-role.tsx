import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { UserRole, User } from "@shared/schema";

export interface PreviewUser {
  id: string | number;
  username: string;
  role: UserRole;
  departments: string[];
}

interface PreviewRoleContextType {
  previewRole: UserRole | null;
  setPreviewRole: (role: UserRole | null) => void;
  previewUser: PreviewUser | null;
  setPreviewUser: (user: PreviewUser | null) => void;
  isPreviewMode: boolean;
  isUserPreviewMode: boolean;
  exitPreviewMode: () => void;
}

const PreviewRoleContext = createContext<PreviewRoleContextType | undefined>(undefined);

const PREVIEW_ROLE_KEY = "preview_role";
const PREVIEW_USER_KEY = "preview_user";

export function PreviewRoleProvider({ children }: { children: ReactNode }) {
  const [previewRole, setPreviewRoleState] = useState<UserRole | null>(null);
  const [previewUser, setPreviewUserState] = useState<PreviewUser | null>(null);

  useEffect(() => {
    const storedRole = sessionStorage.getItem(PREVIEW_ROLE_KEY);
    if (storedRole) {
      try {
        setPreviewRoleState(storedRole as UserRole);
      } catch {
        sessionStorage.removeItem(PREVIEW_ROLE_KEY);
      }
    }
    
    const storedUser = sessionStorage.getItem(PREVIEW_USER_KEY);
    if (storedUser) {
      try {
        setPreviewUserState(JSON.parse(storedUser));
      } catch {
        sessionStorage.removeItem(PREVIEW_USER_KEY);
      }
    }
  }, []);

  const setPreviewRole = (role: UserRole | null) => {
    setPreviewRoleState(role);
    if (role) {
      sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
      sessionStorage.removeItem(PREVIEW_USER_KEY);
      setPreviewUserState(null);
    } else {
      sessionStorage.removeItem(PREVIEW_ROLE_KEY);
    }
  };

  const setPreviewUser = (user: PreviewUser | null) => {
    setPreviewUserState(user);
    if (user) {
      sessionStorage.setItem(PREVIEW_USER_KEY, JSON.stringify(user));
      sessionStorage.removeItem(PREVIEW_ROLE_KEY);
      setPreviewRoleState(null);
    } else {
      sessionStorage.removeItem(PREVIEW_USER_KEY);
    }
  };

  const exitPreviewMode = () => {
    setPreviewRole(null);
    setPreviewUser(null);
  };

  return (
    <PreviewRoleContext.Provider
      value={{
        previewRole,
        setPreviewRole,
        previewUser,
        setPreviewUser,
        isPreviewMode: previewRole !== null || previewUser !== null,
        isUserPreviewMode: previewUser !== null,
        exitPreviewMode,
      }}
    >
      {children}
    </PreviewRoleContext.Provider>
  );
}

export function usePreviewRole() {
  const context = useContext(PreviewRoleContext);
  if (!context) {
    throw new Error("usePreviewRole must be used within a PreviewRoleProvider");
  }
  return context;
}
