import { User } from "@shared/schema";

// Form access mapping - defines which roles can access which forms (preserved for backward compatibility)
export const FORM_ACCESS_MAP = {
  'create-vehicle': ['superadmin', 'assets', 'fleet', 'inventory', 'ntao'], // Vehicle creation requires admin or department privileges
  'assign-vehicle': ['superadmin', 'assets', 'fleet', 'inventory', 'ntao'], // Vehicle assignment requires admin or department privileges
  'onboarding': ['superadmin', 'assets', 'fleet', 'inventory', 'ntao'], // Employee onboarding requires admin or department privileges
  'offboarding': ['superadmin', 'assets', 'fleet', 'inventory', 'ntao'], // Employee offboarding requires admin or department privileges
  'byov-enrollment': ['superadmin', 'assets', 'fleet', 'inventory', 'ntao', 'field'], // BYOV enrollment can be done by department staff and field workers
  'user-management': ['superadmin'], // User management restricted to superadmin only
} as const;

export type FormKey = keyof typeof FORM_ACCESS_MAP;

// Public forms that are accessible to everyone without authentication
export const PUBLIC_FORMS = new Set<FormKey>(['create-vehicle', 'assign-vehicle', 'onboarding', 'offboarding', 'byov-enrollment']);

// Check if a user has access to a specific form
export function checkFormAccess(user: User | null, formKey: string): boolean {
  // Public forms are accessible to everyone without authentication
  if (PUBLIC_FORMS.has(formKey as FormKey)) {
    return true;
  }

  // For non-public forms, check user authentication and role
  if (!user || !user.role) {
    return false;
  }

  const allowedRoles = FORM_ACCESS_MAP[formKey as FormKey];
  if (!allowedRoles) {
    // If form key doesn't exist, deny access by default
    return false;
  }

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
};

// Get forms accessible by a user's role
export function getAccessibleForms(user: User | null): FormKey[] {
  // Start with public forms (accessible to everyone)
  const publicForms = Array.from(PUBLIC_FORMS) as FormKey[];

  // If no user, only return public forms
  if (!user || !user.role) {
    return publicForms;
  }

  // Add role-based forms that aren't already public (avoid duplicates)
  const roleBased = Object.entries(FORM_ACCESS_MAP)
    .filter(([formKey, roles]) => 
      !PUBLIC_FORMS.has(formKey as FormKey) && roles.includes(user.role as any)
    )
    .map(([formKey]) => formKey as FormKey);

  return [...publicForms, ...roleBased];
}

// Get role-friendly error messages
export function getAccessDeniedMessage(formKey: string): string {
  const formName = FORM_DISPLAY_NAMES[formKey as FormKey] || formKey;
  return `You don't have permission to access the ${formName} form. Contact your administrator if you need access.`;
}