import { User, UserRole, RolePermissionSettings } from "@shared/schema";
import { getDefaultPermissions } from "./role-permissions";

// Form access mapping - defines which roles can access which forms
// Roles: developer (full access), admin (management), agent (basic operations)
export const FORM_ACCESS_MAP = {
  'create-vehicle': ['developer', 'admin', 'agent'],
  'assign-vehicle': ['developer', 'admin', 'agent'],
  'onboarding': ['developer', 'admin', 'agent'],
  'offboarding': ['developer', 'admin', 'agent'],
  'byov-enrollment': ['developer', 'admin', 'agent'],
  'user-management': ['developer', 'admin'],
  'template-management': ['developer', 'admin'],
  'cost-center-management': ['developer', 'admin'],
} as const;

export type FormKey = keyof typeof FORM_ACCESS_MAP;

// Public forms that are accessible to everyone without authentication
export const PUBLIC_FORMS = new Set<FormKey>(['create-vehicle', 'assign-vehicle', 'onboarding', 'offboarding', 'byov-enrollment']);

// Forms that should consult the merged role-permission matrix instead of (or
// in addition to) the static FORM_ACCESS_MAP role list. The selector receives
// the user's effective `RolePermissionSettings` and returns whether access is
// granted. This keeps the frontend route protection consistent with the
// server-side check (e.g. /api/cost-centers uses the same matrix path).
export const FORM_PERMISSION_SELECTORS: Partial<Record<FormKey, (perms: RolePermissionSettings) => boolean>> = {
  'cost-center-management': (perms) => perms.sidebar.management.costCenterManagement,
};

// Build the user's effective permissions on the client by merging their
// per-user `permissionOverrides` on top of the role defaults. We intentionally
// keep this client-side merge shallow on `permissionOverrides` because the
// stored role-row is server-only; the API authorization layer handles the
// full defaults -> role row -> user override merge as the source of truth.
function getClientEffectivePermissions(user: User): RolePermissionSettings {
  const defaults = getDefaultPermissions(user.role as UserRole);
  const overrides = (user as User & { permissionOverrides?: Partial<RolePermissionSettings> | null })
    .permissionOverrides;
  if (!overrides) return defaults;
  return {
    ...defaults,
    ...overrides,
    sidebar: {
      ...defaults.sidebar,
      ...(overrides.sidebar ?? {}),
      management: {
        ...defaults.sidebar.management,
        ...(overrides.sidebar?.management ?? {}),
      },
      dashboards: {
        ...defaults.sidebar.dashboards,
        ...(overrides.sidebar?.dashboards ?? {}),
      },
      queues: {
        ...defaults.sidebar.queues,
        ...(overrides.sidebar?.queues ?? {}),
      },
    },
  };
}

// Check if a user has access to a specific form.
// If `effectivePermissions` is provided (typically from `usePermissions()` —
// which performs the full defaults -> stored role row -> user-overrides
// merge against `/api/role-permissions`), it will be used for forms that
// have a registered selector. Otherwise we fall back to a client-computed
// merge of role defaults + user-level overrides only. Callers in React
// components should pass effective permissions to keep the route guard,
// sidebar visibility, and API authorization consistent.
export function checkFormAccess(
  user: User | null,
  formKey: string,
  effectivePermissions?: RolePermissionSettings,
): boolean {
  // Public forms are accessible to everyone without authentication
  if (PUBLIC_FORMS.has(formKey as FormKey)) {
    return true;
  }

  // For non-public forms, check user authentication and role
  if (!user || !user.role) {
    return false;
  }

  // Prefer the merged permission matrix when a selector is registered. This
  // matches the server's permission-key based authorization so a user with a
  // role-override or per-user override sees consistent behavior across the
  // sidebar, route guard, and API.
  const selector = FORM_PERMISSION_SELECTORS[formKey as FormKey];
  if (selector) {
    const perms = effectivePermissions ?? getClientEffectivePermissions(user);
    return selector(perms);
  }

  const allowedRoles = FORM_ACCESS_MAP[formKey as FormKey];
  if (!allowedRoles) {
    return false;
  }

  // Check if user's role is allowed
  return allowedRoles.includes(user.role as any);
}

// Get user-friendly form names for display
export const FORM_DISPLAY_NAMES: Record<FormKey, string> = {
  'create-vehicle': 'Create Vehicle Location',
  'assign-vehicle': 'Assign Vehicle Location',
  'onboarding': 'Employee Onboarding',
  'offboarding': 'Employee Offboarding',
  'byov-enrollment': 'BYOV Enrollment',
  'user-management': 'User Management',
  'template-management': 'Template Management',
  'cost-center-management': 'District Cost Centers',
};

// Get forms accessible by a user. When `effectivePermissions` is provided,
// permission-key-driven forms are evaluated against the merged matrix so the
// list stays consistent with the route guard and API authorization.
export function getAccessibleForms(
  user: User | null,
  effectivePermissions?: RolePermissionSettings,
): FormKey[] {
  // Start with public forms (accessible to everyone)
  const publicForms = Array.from(PUBLIC_FORMS) as FormKey[];

  // If no user, only return public forms
  if (!user || !user.role) {
    return publicForms;
  }

  const perms = effectivePermissions ?? getClientEffectivePermissions(user);

  // Add role-based forms that aren't already public
  const roleBased = (Object.entries(FORM_ACCESS_MAP) as [FormKey, readonly string[]][])
    .filter(([formKey, roles]) => {
      if (PUBLIC_FORMS.has(formKey)) return false;
      const selector = FORM_PERMISSION_SELECTORS[formKey];
      if (selector) return selector(perms);
      return roles.includes(user.role as any);
    })
    .map(([formKey]) => formKey);

  return [...publicForms, ...roleBased];
}

// Get role-friendly error messages
export function getAccessDeniedMessage(formKey: string): string {
  const formName = FORM_DISPLAY_NAMES[formKey as FormKey] || formKey;
  return `You don't have permission to access the ${formName} form. Contact your administrator if you need access.`;
}
