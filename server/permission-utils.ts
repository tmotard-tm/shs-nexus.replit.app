import type { RolePermissionSettings } from "@shared/schema";
import {
  DEFAULT_SUPERADMIN_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_AGENT_PERMISSIONS,
} from "../client/src/lib/role-permissions";

function setAllBooleans(obj: any, value: boolean): any {
  if (typeof obj === 'boolean') return value;
  if (typeof obj !== 'object' || obj === null) return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[key] = setAllBooleans(obj[key], value);
  }
  return result;
}

export function deepMergePermissions(defaults: any, stored: any): any {
  if (typeof defaults !== 'object' || defaults === null) {
    return stored !== undefined ? stored : defaults;
  }
  if (typeof stored === 'boolean') {
    return setAllBooleans(defaults, stored);
  }
  if (typeof stored !== 'object' || stored === null) {
    return defaults;
  }
  const result: any = {};
  for (const key of Object.keys(defaults)) {
    if (key in stored) {
      result[key] = deepMergePermissions(defaults[key], stored[key]);
    } else {
      result[key] = defaults[key];
    }
  }
  for (const key of Object.keys(stored)) {
    if (!(key in defaults)) {
      result[key] = stored[key];
    }
  }
  return result;
}

/**
 * Returns the canonical default permission set for a role.
 *
 * Built-in roles map to their own defaults.
 * Every other role (i.e. custom roles created by admins) falls back to
 * DEFAULT_AGENT_PERMISSIONS — the same base used when the role was first
 * created.  This means any permission key added to the agent defaults after
 * a custom role was created (e.g. `byovBulkUpload`) will be backfilled with
 * the agent default value (false) the next time patchStoredRolePermissions
 * runs.  Admins can then toggle individual keys via the Role Permissions UI.
 */
export function getServerDefaultPermissions(role: string): RolePermissionSettings {
  if (role === 'developer') return DEFAULT_SUPERADMIN_PERMISSIONS;
  if (role === 'admin') return DEFAULT_ADMIN_PERMISSIONS;
  // 'agent' and all custom roles share the agent baseline
  return DEFAULT_AGENT_PERMISSIONS;
}

export function mergeRolePermissionWithDefaults(record: { role: string; permissions: any; [key: string]: any }) {
  const defaults = getServerDefaultPermissions(record.role);
  return { ...record, permissions: deepMergePermissions(defaults, record.permissions) };
}
