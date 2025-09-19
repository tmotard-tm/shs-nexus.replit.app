import { User } from "@shared/schema";

// Role-based access control system
export type UserRole = 'assets' | 'fleet' | 'inventory' | 'ntao' | 'superadmin' | 'field' | 'agent' | 'approver' | 'requester';

// Define what routes each role can access
export const ROLE_ROUTES: Record<UserRole, string[]> = {
  assets: [
    '/',
    '/assets-queue',
    '/change-password', // All users can change their password
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle', 
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  fleet: [
    '/',
    '/fleet-queue',
    '/change-password', // All users can change their password
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding', 
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  inventory: [
    '/',
    '/inventory-queue',
    '/change-password', // All users can change their password
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding', 
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  ntao: [
    '/',
    '/ntao-queue',
    '/change-password', // All users can change their password
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes  
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  field: [
    '/',
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location', 
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
    '/change-password', // All users can change their password
  ],
  superadmin: [
    '*', // Superadmin can access everything
  ],
  agent: [
    // Agent access is handled dynamically based on department_access array
    // Base routes all agents can access
    '/',
    '/change-password',
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  approver: [
    // Approver access includes all agent routes plus approval-specific routes
    '/',
    '/change-password',
    '/approver', // Approval dashboard
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
  requester: [
    // Requester has basic form submission access
    '/',
    '/change-password',
    '/requester', // Requester dashboard
    // Form routes - all users can submit forms
    '/forms/create-vehicle',
    '/forms/assign-vehicle',
    '/forms/onboarding',
    '/forms/offboarding',
    '/forms/byov-enrollment',
    // Legacy form routes
    '/create-vehicle-location',
    '/assign-vehicle-location',
    '/onboard-hire',
    '/offboard-vehicle-location',
    '/sears-drive-enrollment',
  ],
};

// Define which queue modules each role can access
export const ROLE_QUEUE_ACCESS: Record<UserRole, string[]> = {
  assets: ['assets'],
  fleet: ['fleet'],
  inventory: ['inventory'],
  ntao: ['ntao'],
  field: [], // Field users don't access queues directly
  superadmin: ['ntao', 'assets', 'inventory', 'fleet'], // All queues
  agent: [], // Agent queue access is determined by department_access array
  approver: [], // Approver queue access is determined by department_access array
  requester: [], // Requesters have limited queue access
};

// Check if a user's role can access a specific route
export function checkRouteAccess(user: User | null, route: string): boolean {
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
  const allowedRoutes = ROLE_ROUTES[userRole] || [];

  // Superadmin can access everything
  if (allowedRoutes.includes('*')) {
    return true;
  }

  // For agents and approvers, check department-specific routes based on department_access
  if ((userRole === 'agent' || userRole === 'approver') && user.departmentAccess && Array.isArray(user.departmentAccess)) {
    // First check base routes defined in ROLE_ROUTES
    const hasBaseAccess = allowedRoutes.some(allowedRoute => {
      if (allowedRoute === route) {
        return true;
      }
      // Handle wildcard patterns like /forms/*
      if (allowedRoute.endsWith('*')) {
        return route.startsWith(allowedRoute.slice(0, -1));
      }
      return false;
    });

    if (hasBaseAccess) {
      return true;
    }

    // Check department-specific queue routes
    for (const dept of user.departmentAccess) {
      const deptLower = dept.toLowerCase();
      if (deptLower === 'assets' && route === '/assets-queue') return true;
      if (deptLower === 'fleet' && route === '/fleet-queue') return true;
      if (deptLower === 'inventory' && route === '/inventory-queue') return true;
      if (deptLower === 'ntao' && route === '/ntao-queue') return true;
    }
  }

  // Check exact match or wildcard match for regular roles
  return allowedRoutes.some(allowedRoute => {
    if (allowedRoute === route) {
      return true;
    }
    // Handle wildcard patterns like /forms/*
    if (allowedRoute.endsWith('*')) {
      return route.startsWith(allowedRoute.slice(0, -1));
    }
    return false;
  });
}

// Get accessible queue modules for a user
export function getAccessibleQueueModules(user: User | null): string[] {
  if (!user || !user.role) {
    return [];
  }

  const userRole = user.role as UserRole;
  
  // For agents and approvers, determine access based on department_access array
  if ((userRole === 'agent' || userRole === 'approver') && user.departmentAccess && Array.isArray(user.departmentAccess)) {
    return user.departmentAccess.map(dept => {
      const deptLower = dept.toLowerCase();
      if (deptLower === 'assets') return 'assets';
      if (deptLower === 'fleet') return 'fleet';
      if (deptLower === 'inventory') return 'inventory';
      if (deptLower === 'ntao') return 'ntao';
      return null;
    }).filter(Boolean) as string[];
  }
  
  return ROLE_QUEUE_ACCESS[userRole] || [];
}

// Check if user can access a specific queue module
export function checkQueueModuleAccess(user: User | null, module: string): boolean {
  const accessibleModules = getAccessibleQueueModules(user);
  return accessibleModules.includes(module);
}

// Get user-friendly role display name
export function getRoleDisplayName(role: string, user?: User): string {
  // For agent users, show their department instead of generic "Agent"
  if (role === 'agent' && user?.departmentAccess?.length) {
    const primaryDept = user.departmentAccess[0];
    switch (primaryDept.toLowerCase()) {
      case 'assets':
        return 'Assets Management';
      case 'fleet':
        return 'Fleet Management';
      case 'inventory':
        return 'Inventory Control';
      case 'ntao':
        return 'NTAO';
      default:
        return `${primaryDept} Agent`;
    }
  }
  
  switch (role) {
    case 'assets':
      return 'Assets Management';
    case 'fleet':
      return 'Fleet Management';
    case 'inventory':
      return 'Inventory Control';
    case 'ntao':
      return 'NTAO';
    case 'superadmin':
      return 'Super Admin';
    case 'field':
      return 'Field Worker';
    case 'agent':
      return 'Agent';
    case 'approver':
      return 'Approver';
    case 'requester':
      return 'Requester';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

// Get appropriate landing page for user based on role and department access
export function getUserLandingPage(user: User | null): string {
  if (!user) {
    return '/login';
  }

  const userRole = user.role as UserRole;

  // Superadmin gets the assistance selection (admin interface)
  if (userRole === 'superadmin') {
    return '/';
  }

  // For agent users, redirect to their primary department queue
  if (userRole === 'agent' && user.departmentAccess?.length) {
    const primaryDept = user.departmentAccess[0].toLowerCase();
    switch (primaryDept) {
      case 'assets':
        return '/assets-queue';
      case 'fleet':
        return '/fleet-queue';
      case 'inventory':
        return '/inventory-queue';
      case 'ntao':
        return '/ntao-queue';
      default:
        return '/'; // Fallback to assistance selection
    }
  }

  // For direct role assignments
  switch (userRole) {
    case 'assets':
      return '/assets-queue';
    case 'fleet':
      return '/fleet-queue';
    case 'inventory':
      return '/inventory-queue';
    case 'ntao':
      return '/ntao-queue';
    case 'approver':
      return '/approver';
    case 'requester':
      return '/requester';
    case 'field':
      return '/'; // Field workers get assistance selection for form access
    default:
      return '/'; // Fallback to assistance selection
  }
}

// Get role-specific error messages
export function getRoleAccessDeniedMessage(role: string, attemptedRoute: string): string {
  const roleName = getRoleDisplayName(role);
  return `Your role (${roleName}) doesn't have permission to access this page. Contact your administrator if you need access to ${attemptedRoute}.`;
}