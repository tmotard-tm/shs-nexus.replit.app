import { createContext, useContext, useState, ReactNode } from "react";
import type { UserRole, User } from "@shared/schema";

export interface PreviewUser {
  id: string | number;
  username: string;
  role: UserRole;
  departments: string[];
  permissionOverrides?: any;
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
  // Initialize synchronously from sessionStorage so the FIRST render already
  // reflects an active preview. A useEffect-based hydration left both values null
  // on the first render after a reload, which briefly rendered restricted,
  // username-gated UI (e.g. the VRM Holman approve/deny section) as the real
  // developer — and fired its query — before the preview identity took over.
  const [previewRole, setPreviewRoleState] = useState<UserRole | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = sessionStorage.getItem(PREVIEW_ROLE_KEY);
    return stored ? (stored as UserRole) : null;
  });
  const [previewUser, setPreviewUserState] = useState<PreviewUser | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = sessionStorage.getItem(PREVIEW_USER_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as PreviewUser;
    } catch {
      sessionStorage.removeItem(PREVIEW_USER_KEY);
      return null;
    }
  });

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
