import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getDefaultPermissions } from "@/lib/role-permissions";
import type { RolePermissionSettings, UserRole } from "@shared/schema";

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
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();

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

  const getPermissions = (): RolePermissionSettings => {
    if (!user) {
      return getDefaultPermissions('agent');
    }

    const userRole = user.role as UserRole;

    if (userRole === 'superadmin' && allPermissions) {
      const found = allPermissions.find(p => p.role === 'superadmin');
      if (found) {
        return found.permissions;
      }
    }

    if (userRole !== 'superadmin' && rolePermission) {
      return rolePermission.permissions;
    }

    return getDefaultPermissions(userRole);
  };

  return (
    <PermissionsContext.Provider value={{
      permissions: getPermissions(),
      isLoading: isAuthLoading || isLoading,
      refetch,
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
