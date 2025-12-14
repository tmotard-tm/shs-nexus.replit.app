import { createContext, useContext, ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePreviewRole } from "@/hooks/use-preview-role";
import { getDefaultPermissions } from "@/lib/role-permissions";
import type { RolePermissionSettings, UserRole } from "@shared/schema";

function setAllBooleans(obj: any, value: boolean): any {
  if (typeof obj === 'boolean') {
    return value;
  }
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[key] = setAllBooleans(obj[key], value);
  }
  return result;
}

function deepMergePermissions(defaults: any, stored: any, inheritedEnabled?: boolean): any {
  if (typeof defaults !== 'object' || defaults === null) {
    if (stored !== undefined) return stored;
    if (inheritedEnabled !== undefined) return inheritedEnabled;
    return defaults;
  }
  if (typeof stored === 'boolean') {
    return setAllBooleans(defaults, stored);
  }
  if (typeof stored !== 'object' || stored === null) {
    if (inheritedEnabled !== undefined) {
      return setAllBooleans(defaults, inheritedEnabled);
    }
    return defaults;
  }
  const parentEnabled = typeof stored.enabled === 'boolean' ? stored.enabled : inheritedEnabled;
  const result: any = {};
  for (const key of Object.keys(defaults)) {
    if (key in stored) {
      result[key] = deepMergePermissions(defaults[key], stored[key], parentEnabled);
    } else {
      if (parentEnabled !== undefined && typeof defaults[key] === 'boolean') {
        result[key] = parentEnabled;
      } else if (parentEnabled !== undefined && typeof defaults[key] === 'object') {
        result[key] = setAllBooleans(defaults[key], parentEnabled);
      } else {
        result[key] = defaults[key];
      }
    }
  }
  return result;
}

interface RolePermission {
  id: string;
  role: string;
  permissions: RolePermissionSettings;
  createdAt: string;
  updatedAt: string;
}

interface PermissionsContextType {
  permissions: RolePermissionSettings;
  isLoading: boolean;
  refetch: () => void;
  effectiveRole: UserRole;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { previewRole, previewUser } = usePreviewRole();

  const { data: allPermissions, isLoading, refetch } = useQuery<RolePermission[]>({
    queryKey: ['/api/role-permissions'],
    enabled: !!user && user.role === 'superadmin',
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: rolePermission } = useQuery<RolePermission>({
    queryKey: ['/api/role-permissions', user?.role],
    enabled: !!user && user.role !== 'superadmin',
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const effectiveRole = useMemo(() => {
    if (user?.role === 'superadmin' && previewUser) {
      return previewUser.role;
    }
    if (user?.role === 'superadmin' && previewRole) {
      return previewRole;
    }
    return (user?.role as UserRole) || 'agent';
  }, [user?.role, previewRole, previewUser]);

  const getPermissions = (): RolePermissionSettings => {
    if (!user) {
      return getDefaultPermissions('agent');
    }

    const userRole = user.role as UserRole;
    
    if (userRole === 'superadmin' && previewUser && allPermissions) {
      const previewDefaults = getDefaultPermissions(previewUser.role);
      const found = allPermissions.find(p => p.role === previewUser.role);
      if (found) {
        return deepMergePermissions(previewDefaults, found.permissions);
      }
      return previewDefaults;
    }
    
    if (userRole === 'superadmin' && previewRole && allPermissions) {
      const previewDefaults = getDefaultPermissions(previewRole);
      const found = allPermissions.find(p => p.role === previewRole);
      if (found) {
        return deepMergePermissions(previewDefaults, found.permissions);
      }
      return previewDefaults;
    }

    const defaults = getDefaultPermissions(userRole);

    if (userRole === 'superadmin' && allPermissions) {
      const found = allPermissions.find(p => p.role === 'superadmin');
      if (found) {
        return deepMergePermissions(defaults, found.permissions);
      }
    }

    if (userRole !== 'superadmin' && rolePermission) {
      return deepMergePermissions(defaults, rolePermission.permissions);
    }

    return defaults;
  };

  return (
    <PermissionsContext.Provider value={{
      permissions: getPermissions(),
      isLoading: isAuthLoading || isLoading,
      refetch,
      effectiveRole,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error("usePermissions must be used within a PermissionsProvider");
  }
  return context;
}

export function useHasPermission(permissionPath: string): boolean {
  const { permissions } = usePermissions();
  
  const pathParts = permissionPath.split('.');
  let current: any = permissions;
  
  for (const part of pathParts) {
    if (current === undefined || current === null) return false;
    if (typeof current === 'boolean') return current;
    current = current[part];
  }
  
  if (typeof current === 'boolean') return current;
  if (current?.enabled !== undefined) return current.enabled;
  
  return false;
}
