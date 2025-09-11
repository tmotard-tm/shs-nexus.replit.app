import { User } from "@shared/schema";

// Form access mapping - defines which roles can access which forms
export const FORM_ACCESS_MAP = {
  'create-vehicle': ['superadmin', 'agent'], // Vehicle creation requires admin/agent privileges
  'assign-vehicle': ['superadmin', 'agent'], // Vehicle assignment requires admin/agent privileges
  'onboarding': ['superadmin', 'agent'], // Employee onboarding requires admin/agent privileges
  'offboarding': ['superadmin', 'agent'], // Employee offboarding requires admin/agent privileges
  'byov-enrollment': ['superadmin', 'agent', 'field'], // BYOV enrollment can be done by field workers too
} as const;

export type FormKey = keyof typeof FORM_ACCESS_MAP;

// Check if a user has access to a specific form
export function checkFormAccess(user: User | null, formKey: string): boolean {
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
};

// Get forms accessible by a user's role
export function getAccessibleForms(user: User | null): FormKey[] {
  if (!user || !user.role) {
    return [];
  }

  return Object.entries(FORM_ACCESS_MAP)
    .filter(([, roles]) => roles.includes(user.role as any))
    .map(([formKey]) => formKey as FormKey);
}

// Get role-friendly error messages
export function getAccessDeniedMessage(formKey: string): string {
  const formName = FORM_DISPLAY_NAMES[formKey as FormKey] || formKey;
  return `You don't have permission to access the ${formName} form. Contact your administrator if you need access.`;
}