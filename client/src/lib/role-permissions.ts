import { User, UserRole, RolePermissionSettings } from "@shared/schema";

// Default permission settings for each role
export const DEFAULT_SUPERADMIN_PERMISSIONS: RolePermissionSettings = {
  homePage: true,
  quickActions: {
    enabled: true,
    taskQueue: true,
    offboarding: true,
    onboarding: true,
    assignVehicle: true,
    weeklyOnboarding: true,
    weeklyOffboarding: true,
    createVehicle: true,
  },
  sidebar: {
    enabled: true,
    dashboards: {
      enabled: true,
      dashboard: true,
      vehicleAssignmentDash: true,
      operationsDash: true,
      rentalReductionDash: true,
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
      integrations: true,
      userManagement: true,
      templateManagement: true,
      rolePermissions: true,
      fleetManagement: true,
      weeklyOnboarding: true,
      weeklyOffboarding: true,
      vehicleAssignments: true,
      communicationHub: true,
      techRoster: true,
    },
    activities: {
      enabled: true,
      activityLogs: true,
      communicationHub: true,
    },
    account: {
      enabled: true,
      changePassword: true,
    },
    helpAndTutorial: {
      enabled: true,
      tutorial: true,
      about: true,
    },
  },
  pageFeatures: {
    queueManagement: {
      enabled: true,
      filters: {
        enabled: true,
        queueCheckboxes: true,
        statusCards: true,
        employeeSearch: true,
        workflowTypeFilter: true,
        assignedAgentFilter: true,
        dateFilters: true,
        sortOrder: true,
      },
      taskActions: {
        enabled: true,
        viewTask: true,
        startWork: true,
        continueWork: true,
        pickUpForMe: true,
        assignToOther: true,
      },
      adminActions: {
        enabled: true,
        releaseTask: true,
        reassignTask: true,
      },
    },
    userManagement: {
      enabled: true,
      createUser: true,
      editUser: true,
      deleteUser: true,
      resetPassword: true,
      changeRole: true,
    },
    templateManagement: {
      enabled: true,
      createTemplate: true,
      editTemplate: true,
      deleteTemplate: true,
      toggleStatus: true,
    },
    fleetManagement: {
      enabled: true,
      viewVehicles: true,
      syncToHolman: true,
      unassignVehicle: true,
      viewHistory: true,
    },
    vehicleAssignments: {
      enabled: true,
      viewAssignments: true,
      createAssignment: true,
      editAssignment: true,
      deleteAssignment: true,
      syncFromTPMS: true,
    },
    storageSpots: {
      enabled: true,
      createSpot: true,
      editSpot: true,
      deleteSpot: true,
    },
    communicationHub: {
      enabled: true,
      editTemplates: true,
      changeMode: true,
      manageWhitelist: true,
      viewLogs: true,
    },
  },
};

// Default permissions for Admin role - has most management features but not developer tools
export const DEFAULT_ADMIN_PERMISSIONS: RolePermissionSettings = {
  homePage: true,
  quickActions: {
    enabled: true,
    taskQueue: true,
    offboarding: true,
    onboarding: true,
    assignVehicle: true,
    weeklyOnboarding: true,
    weeklyOffboarding: true,
    createVehicle: true,
  },
  sidebar: {
    enabled: true,
    dashboards: {
      enabled: true,
      dashboard: true,
      vehicleAssignmentDash: true,
      operationsDash: true,
      rentalReductionDash: true,
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
      integrations: false,
      userManagement: true,
      templateManagement: true,
      rolePermissions: false,
      fleetManagement: true,
      weeklyOnboarding: true,
      weeklyOffboarding: true,
      vehicleAssignments: true,
      communicationHub: true,
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
      about: true,
    },
  },
  pageFeatures: {
    queueManagement: {
      enabled: true,
      filters: {
        enabled: true,
        queueCheckboxes: true,
        statusCards: true,
        employeeSearch: true,
        workflowTypeFilter: true,
        assignedAgentFilter: true,
        dateFilters: true,
        sortOrder: true,
      },
      taskActions: {
        enabled: true,
        viewTask: true,
        startWork: true,
        continueWork: true,
        pickUpForMe: true,
        assignToOther: true,
      },
      adminActions: {
        enabled: true,
        releaseTask: true,
        reassignTask: true,
      },
    },
    userManagement: {
      enabled: true,
      createUser: true,
      editUser: true,
      deleteUser: false,
      resetPassword: true,
      changeRole: false,
    },
    templateManagement: {
      enabled: true,
      createTemplate: true,
      editTemplate: true,
      deleteTemplate: false,
      toggleStatus: true,
    },
    fleetManagement: {
      enabled: true,
      viewVehicles: true,
      syncToHolman: true,
      unassignVehicle: true,
      viewHistory: true,
    },
    vehicleAssignments: {
      enabled: true,
      viewAssignments: true,
      createAssignment: true,
      editAssignment: true,
      deleteAssignment: false,
      syncFromTPMS: true,
    },
    storageSpots: {
      enabled: true,
      createSpot: true,
      editSpot: true,
      deleteSpot: false,
    },
    communicationHub: {
      enabled: true,
      editTemplates: true,
      changeMode: false,
      manageWhitelist: true,
      viewLogs: true,
    },
  },
};

export const DEFAULT_AGENT_PERMISSIONS: RolePermissionSettings = {
  homePage: true,
  quickActions: {
    enabled: true,
    taskQueue: true,
    offboarding: true,
    onboarding: true,
    assignVehicle: false,
    weeklyOnboarding: false,
    weeklyOffboarding: false,
    createVehicle: false,
  },
  sidebar: {
    enabled: true,
    dashboards: {
      enabled: false,
      dashboard: false,
      vehicleAssignmentDash: false,
      operationsDash: false,
      rentalReductionDash: false,
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
      integrations: false,
      userManagement: false,
      templateManagement: false,
      rolePermissions: false,
      fleetManagement: false,
      weeklyOnboarding: false,
      weeklyOffboarding: false,
      vehicleAssignments: false,
      communicationHub: false,
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
      about: true,
    },
  },
  pageFeatures: {
    queueManagement: {
      enabled: true,
      filters: {
        enabled: true,
        queueCheckboxes: true,
        statusCards: true,
        employeeSearch: true,
        workflowTypeFilter: true,
        assignedAgentFilter: false, // Agents can't filter by other agents
        dateFilters: true,
        sortOrder: true,
      },
      taskActions: {
        enabled: true,
        viewTask: true,
        startWork: true,
        continueWork: true,
        pickUpForMe: true,
        assignToOther: false, // Agents can only pick up for themselves
      },
      adminActions: {
        enabled: false, // Admin actions disabled for agents
        releaseTask: false,
        reassignTask: false,
      },
    },
    userManagement: {
      enabled: false,
      createUser: false,
      editUser: false,
      deleteUser: false,
      resetPassword: false,
      changeRole: false,
    },
    templateManagement: {
      enabled: false,
      createTemplate: false,
      editTemplate: false,
      deleteTemplate: false,
      toggleStatus: false,
    },
    fleetManagement: {
      enabled: false,
      viewVehicles: false,
      syncToHolman: false,
      unassignVehicle: false,
      viewHistory: false,
    },
    vehicleAssignments: {
      enabled: false,
      viewAssignments: false,
      createAssignment: false,
      editAssignment: false,
      deleteAssignment: false,
      syncFromTPMS: false,
    },
    storageSpots: {
      enabled: false,
      createSpot: false,
      editSpot: false,
      deleteSpot: false,
    },
    communicationHub: {
      enabled: false,
      editTemplates: false,
      changeMode: false,
      manageWhitelist: false,
      viewLogs: false,
    },
  },
};

// Get default permissions for a role
export function getDefaultPermissions(role: UserRole): RolePermissionSettings {
  if (role === 'developer') {
    return DEFAULT_SUPERADMIN_PERMISSIONS;
  }
  if (role === 'admin') {
    return DEFAULT_ADMIN_PERMISSIONS;
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
  
  // Developer can access everything
  if (userRole === 'developer') {
    return true;
  }
  
  // Admin can access most routes (permissions-based)
  if (userRole === 'admin') {
    // Admin-specific route restrictions
    const adminRestrictedRoutes = ['/role-permissions', '/integrations'];
    if (adminRestrictedRoutes.includes(route)) {
      return false;
    }
  }

  // Use provided permissions or fall back to defaults
  const perms = permissions || getDefaultPermissions(userRole);

  // Route permission mapping
  const routePermissions: Record<string, () => boolean> = {
    '/': () => perms.homePage,
    '/dashboard': () => perms.sidebar.dashboards.dashboard,
    '/analytics': () => perms.sidebar.dashboards.vehicleAssignmentDash,
    '/fleet-management': () => perms.sidebar.management.fleetManagement,
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
    '/integrations': () => perms.sidebar.management.integrations,
    '/tech-roster': () => perms.sidebar.management.techRoster,
    '/weekly-onboarding': () => perms.sidebar.management.weeklyOnboarding,
    '/weekly-offboarding': () => perms.sidebar.management.weeklyOffboarding,
    '/communication-hub': () => perms.sidebar.management.communicationHub,
    '/role-permissions': () => perms.sidebar.management.rolePermissions,
    '/holman-integration': () => perms.sidebar.management.integrations,
    '/field-mapping': () => perms.sidebar.management.integrations,
    '/decommissions-queue': () => perms.sidebar.queues.queueManagement,
    '/active-vehicles': () => perms.sidebar.management.fleetManagement,
    '/test-repair-results': () => perms.sidebar.management.integrations,
    '/activity': () => perms.sidebar.activities.activityLogs,
    '/activity-logs': () => perms.sidebar.activities.activityLogs,
    '/change-password': () => perms.sidebar.account.changePassword,
    '/help': () => perms.sidebar.helpAndTutorial.tutorial,
    '/about': () => perms.sidebar.helpAndTutorial.about,
    '/tutorial': () => perms.sidebar.helpAndTutorial.tutorial,
    '/fleet-distribution': () => perms.sidebar.dashboards.vehicleAssignmentDash,
    '/analytics-board': () => perms.sidebar.dashboards.vehicleAssignmentDash,
    '/rental-dashboard': () => perms.sidebar.dashboards.rentalReductionDash,
  };

  // Check exact route match
  if (routePermissions[route]) {
    return routePermissions[route]();
  }

  // Handle wildcard patterns for forms - all authenticated users can access forms
  if (route.startsWith('/forms/')) {
    return true;
  }

  // Handle task work routes - all authenticated users can access their assigned tasks
  if (route.startsWith('/tasks/')) {
    return true;
  }

  // Legacy form routes - all authenticated users can access these
  const legacyFormRoutes = [
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/update-vehicle',
    '/onboard-hire',
    '/offboard-technician',
    '/sears-drive-enrollment',
  ];
  if (legacyFormRoutes.includes(route)) {
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
  
  // Developer and Admin get all queues
  if (userRole === 'developer' || userRole === 'admin') {
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
  if (role === 'developer') {
    return 'Developer';
  }
  
  if (role === 'admin') {
    return 'Admin';
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

  // Developer gets the home/dashboard
  if (userRole === 'developer') {
    return '/';
  }

  // Admin gets the home/dashboard
  if (userRole === 'admin') {
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
  
  if (user.role === 'developer') {
    return 'Admin Platform';
  }
  
  return 'Operations Portal';
}

// Get the appropriate tutorial title based on user role
export function getTutorialTitle(user: User | null): string {
  if (!user) {
    return 'Portal Tutorial';
  }
  
  if (user.role === 'developer') {
    return 'Admin Tutorial';
  }
  
  return 'Agent Tutorial';
}
