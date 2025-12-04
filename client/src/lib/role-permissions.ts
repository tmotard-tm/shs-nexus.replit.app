import { User, UserRole, RolePermissionSettings } from "@shared/schema";

// Default permission settings for each role
export const DEFAULT_SUPERADMIN_PERMISSIONS: RolePermissionSettings = {
  homePage: true,
  sidebar: {
    enabled: true,
    dashboards: {
      enabled: true,
      dashboard: true,
      vehicleAssignmentDash: true,
      operationsDash: true,
    },
    queues: {
      enabled: true,
      queueManagement: true,
      ntaoQueue: true,
      assetsQueue: true,
      inventoryQueue: true,
      fleetQueue: true,
    },
    management: {
      enabled: true,
      storageSpots: true,
      approvals: true,
      integrations: true,
      userManagement: true,
      templateManagement: true,
      rolePermissions: true,
      vehicleAssignments: true,
      snowflakeIntegration: true,
      techRoster: true,
    },
    activities: {
      enabled: true,
      activityLogs: true,
    },
    account: {
      enabled: true,
      changePassword: true,
    },
    helpAndTutorial: {
      enabled: true,
      tutorial: true,
    },
  },
};

export const DEFAULT_AGENT_PERMISSIONS: RolePermissionSettings = {
  homePage: true,
  sidebar: {
    enabled: true,
    dashboards: {
      enabled: false,
      dashboard: false,
      vehicleAssignmentDash: false,
      operationsDash: false,
    },
    queues: {
      enabled: true,
      queueManagement: true,
      ntaoQueue: true,
      assetsQueue: true,
      inventoryQueue: true,
      fleetQueue: true,
    },
    management: {
      enabled: false,
      storageSpots: false,
      approvals: false,
      integrations: false,
      userManagement: false,
      templateManagement: false,
      rolePermissions: false,
      vehicleAssignments: false,
      snowflakeIntegration: false,
      techRoster: false,
    },
    activities: {
      enabled: false,
      activityLogs: false,
    },
    account: {
      enabled: true,
      changePassword: true,
    },
    helpAndTutorial: {
      enabled: true,
      tutorial: true,
    },
  },
};

// Get default permissions for a role
export function getDefaultPermissions(role: UserRole): RolePermissionSettings {
  if (role === 'superadmin') {
    return DEFAULT_SUPERADMIN_PERMISSIONS;
  }
  return DEFAULT_AGENT_PERMISSIONS;
}

// Check if a user's role can access a specific route
export function checkRouteAccess(user: User | null, route: string, permissions?: RolePermissionSettings): boolean {
  if (!user || !user.role) {
    // Unauthenticated users can only access public routes
    const publicRoutes = ['/login', '/forms/*'];
    return publicRoutes.some(publicRoute => 
      publicRoute.endsWith('*') 
        ? route.startsWith(publicRoute.slice(0, -1))
        : route === publicRoute
    );
  }

  const userRole = user.role as UserRole;
  
  // Superadmin can access everything
  if (userRole === 'superadmin') {
    return true;
  }

  // Use provided permissions or fall back to defaults
  const perms = permissions || getDefaultPermissions(userRole);

  // Route permission mapping
  const routePermissions: Record<string, () => boolean> = {
    '/': () => perms.homePage,
    '/dashboard': () => perms.sidebar.dashboards.dashboard,
    '/analytics': () => perms.sidebar.dashboards.vehicleAssignmentDash,
    '/vehicle-assignments': () => perms.sidebar.management.vehicleAssignments,
    '/operations': () => perms.sidebar.dashboards.operationsDash,
    '/operations-dashboard': () => perms.sidebar.dashboards.operationsDash,
    '/queue-management': () => perms.sidebar.queues.queueManagement,
    '/ntao-queue': () => perms.sidebar.queues.ntaoQueue,
    '/fleet-queue': () => perms.sidebar.queues.fleetQueue,
    '/assets-queue': () => perms.sidebar.queues.assetsQueue,
    '/inventory-queue': () => perms.sidebar.queues.inventoryQueue,
    '/users': () => perms.sidebar.management.userManagement,
    '/user-management': () => perms.sidebar.management.userManagement,
    '/templates': () => perms.sidebar.management.templateManagement,
    '/template-management': () => perms.sidebar.management.templateManagement,
    '/storage-spots': () => perms.sidebar.management.storageSpots,
    '/approvals': () => perms.sidebar.management.approvals,
    '/integrations': () => perms.sidebar.management.integrations,
    '/snowflake-integration': () => perms.sidebar.management.snowflakeIntegration,
    '/tech-roster': () => perms.sidebar.management.techRoster,
    '/role-permissions': () => perms.sidebar.management.rolePermissions,
    '/activity': () => perms.sidebar.activities.activityLogs,
    '/activity-logs': () => perms.sidebar.activities.activityLogs,
    '/change-password': () => perms.sidebar.account.changePassword,
    '/help': () => perms.sidebar.helpAndTutorial.tutorial,
  };

  // Check exact route match
  if (routePermissions[route]) {
    return routePermissions[route]();
  }

  // Handle wildcard patterns for forms - all authenticated users can access forms
  if (route.startsWith('/forms/')) {
    return true;
  }

  // Default deny for unknown routes
  return false;
}

// Get accessible queue modules for a user based on their departments array
export function getAccessibleQueueModules(user: User | null): string[] {
  if (!user || !user.role) {
    return [];
  }

  const userRole = user.role as UserRole;
  
  // Superadmin gets all queues
  if (userRole === 'superadmin') {
    return ['ntao', 'assets', 'inventory', 'fleet'];
  }

  // For agents, determine access based on departments array
  if (user.departments && Array.isArray(user.departments)) {
    return user.departments.map(dept => {
      const deptLower = dept.toLowerCase();
      if (deptLower === 'assets') return 'assets';
      if (deptLower === 'fleet') return 'fleet';
      if (deptLower === 'inventory') return 'inventory';
      if (deptLower === 'ntao') return 'ntao';
      return null;
    }).filter(Boolean) as string[];
  }
  
  return [];
}

// Check if user can access a specific queue module
export function checkQueueModuleAccess(user: User | null, module: string): boolean {
  const accessibleModules = getAccessibleQueueModules(user);
  return accessibleModules.includes(module);
}

// Get user-friendly role display name
export function getRoleDisplayName(role: string, user?: User): string {
  if (role === 'superadmin') {
    return 'Super Admin';
  }
  
  // For agent users, show their primary department if available
  if (role === 'agent' && user?.departments?.length) {
    const primaryDept = user.departments[0];
    switch (primaryDept.toLowerCase()) {
      case 'assets':
        return 'Assets Agent';
      case 'fleet':
        return 'Fleet Agent';
      case 'inventory':
        return 'Inventory Agent';
      case 'ntao':
        return 'NTAO Agent';
      default:
        return `${primaryDept} Agent`;
    }
  }
  
  return 'Agent';
}

// Get appropriate landing page for user based on role and department access
export function getUserLandingPage(user: User | null): string {
  if (!user) {
    return '/login';
  }

  const userRole = user.role as UserRole;

  // Superadmin gets the home/dashboard
  if (userRole === 'superadmin') {
    return '/';
  }

  // For agent users, redirect to queue management
  if (userRole === 'agent') {
    return '/queue-management';
  }

  return '/';
}

// Get role-specific error messages
export function getRoleAccessDeniedMessage(role: string, attemptedRoute: string): string {
  const roleName = getRoleDisplayName(role);
  return `Your role (${roleName}) doesn't have permission to access this page. Contact your administrator if you need access.`;
}

// Get the appropriate app title based on user role
export function getAppTitle(user: User | null): string {
  if (!user) {
    return 'Operations Portal';
  }
  
  if (user.role === 'superadmin') {
    return 'Admin Platform';
  }
  
  return 'Operations Portal';
}

// Get the appropriate tutorial title based on user role
export function getTutorialTitle(user: User | null): string {
  if (!user) {
    return 'Portal Tutorial';
  }
  
  if (user.role === 'superadmin') {
    return 'Admin Tutorial';
  }
  
  return 'Agent Tutorial';
}
