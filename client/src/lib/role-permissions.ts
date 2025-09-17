import { User } from "@shared/schema";

// Role-based access control system
export type UserRole = 'assets' | 'fleet' | 'inventory' | 'ntao' | 'superadmin' | 'field';

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
};

// Define which queue modules each role can access
export const ROLE_QUEUE_ACCESS: Record<UserRole, string[]> = {
  assets: ['assets'],
  fleet: ['fleet'],
  inventory: ['inventory'],
  ntao: ['ntao'],
  field: [], // Field users don't access queues directly
  superadmin: ['ntao', 'assets', 'inventory', 'fleet'], // All queues
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

  // Check exact match or wildcard match
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
  return ROLE_QUEUE_ACCESS[userRole] || [];
}

// Check if user can access a specific queue module
export function checkQueueModuleAccess(user: User | null, module: string): boolean {
  const accessibleModules = getAccessibleQueueModules(user);
  return accessibleModules.includes(module);
}

// Get user-friendly role display name
export function getRoleDisplayName(role: string): string {
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
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

// Get role-specific error messages
export function getRoleAccessDeniedMessage(role: string, attemptedRoute: string): string {
  const roleName = getRoleDisplayName(role);
  return `Your role (${roleName}) doesn't have permission to access this page. Contact your administrator if you need access to ${attemptedRoute}.`;
}