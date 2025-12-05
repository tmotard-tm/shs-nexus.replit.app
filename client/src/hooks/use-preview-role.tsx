import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { UserRole } from "@shared/schema";

interface PreviewRoleContextType {
  previewRole: UserRole | null;
  setPreviewRole: (role: UserRole | null) => void;
  isPreviewMode: boolean;
  exitPreviewMode: () => void;
}

const PreviewRoleContext = createContext<PreviewRoleContextType | undefined>(undefined);

const PREVIEW_ROLE_KEY = "preview_role";

export function PreviewRoleProvider({ children }: { children: ReactNode }) {
  const [previewRole, setPreviewRoleState] = useState<UserRole | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(PREVIEW_ROLE_KEY);
    if (stored) {
      try {
        setPreviewRoleState(stored as UserRole);
      } catch {
        sessionStorage.removeItem(PREVIEW_ROLE_KEY);
      }
    }
  }, []);

  const setPreviewRole = (role: UserRole | null) => {
    setPreviewRoleState(role);
    if (role) {
      sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
    } else {
      sessionStorage.removeItem(PREVIEW_ROLE_KEY);
    }
  };

  const exitPreviewMode = () => {
    setPreviewRole(null);
  };

  return (
    <PreviewRoleContext.Provider
      value={{
        previewRole,
        setPreviewRole,
        isPreviewMode: previewRole !== null,
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
