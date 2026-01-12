import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Shield, Users, Save, RefreshCw, Settings, Plus, Trash2, UserCog } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { RolePermissionSettings } from "@shared/schema";
import { DEFAULT_SUPERADMIN_PERMISSIONS, DEFAULT_AGENT_PERMISSIONS } from "@/lib/role-permissions";
import { generatePermissionTree, type PermissionNode } from "@shared/page-registry";

interface RolePermission {
  id: string;
  role: string;
  permissions: RolePermissionSettings;
  createdAt: string;
  updatedAt: string;
}

const PERMISSION_TREE: PermissionNode[] = generatePermissionTree();

function getNestedValue(obj: any, path: string[]): boolean {
  let current = obj;
  for (const key of path) {
    if (current === undefined || current === null) return false;
    if (typeof current === 'boolean') return current;
    current = current[key];
  }
  return typeof current === 'boolean' ? current : Boolean(current?.enabled ?? current);
}

function setNestedValue(obj: any, path: string[], value: boolean): any {
  if (path.length === 0) return value;
  if (path.length === 1) {
    return { ...obj, [path[0]]: value };
  }
  const [first, ...rest] = path;
  return {
    ...obj,
    [first]: setNestedValue(obj[first] || {}, rest, value),
  };
}

function PermissionTreeNode({
  node,
  path,
  permissions,
  onChange,
  level = 0,
}: {
  node: PermissionNode;
  path: string[];
  permissions: RolePermissionSettings;
  onChange: (path: string[], value: boolean) => void;
  level?: number;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const fullPath = [...path, node.key];
  const hasChildren = node.children && node.children.length > 0;
  
  const getValue = (): boolean => {
    const value = getNestedValue(permissions, fullPath);
    return value;
  };

  const handleChange = (checked: boolean) => {
    onChange(fullPath, checked);
    if (hasChildren && fullPath[fullPath.length - 1] === 'enabled') {
    }
  };

  const isEnabled = getValue();

  return (
    <div className={`${level > 0 ? 'ml-6' : ''}`}>
      {hasChildren ? (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="flex items-center gap-2 py-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="p-0 h-6 w-6" data-testid={`toggle-${node.key}`}>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <Checkbox
              id={fullPath.join('-') + '-enabled'}
              checked={getNestedValue(permissions, [...fullPath, 'enabled'])}
              onCheckedChange={(checked) => onChange([...fullPath, 'enabled'], Boolean(checked))}
              data-testid={`checkbox-${node.key}-enabled`}
            />
            <div className="flex-1">
              <Label htmlFor={fullPath.join('-') + '-enabled'} className="font-medium cursor-pointer">
                {node.label}
              </Label>
              {node.description && (
                <p className="text-xs text-muted-foreground">{node.description}</p>
              )}
            </div>
          </div>
          <CollapsibleContent>
            <div className="border-l-2 border-muted pl-2 ml-3">
              {node.children?.map((child) => (
                <PermissionTreeNode
                  key={child.key}
                  node={child}
                  path={fullPath}
                  permissions={permissions}
                  onChange={onChange}
                  level={level + 1}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="flex items-center gap-2 py-2">
          <div className="w-6" />
          <Checkbox
            id={fullPath.join('-')}
            checked={isEnabled}
            onCheckedChange={(checked) => handleChange(Boolean(checked))}
            data-testid={`checkbox-${fullPath.join('-')}`}
          />
          <div className="flex-1">
            <Label htmlFor={fullPath.join('-')} className="cursor-pointer">
              {node.label}
            </Label>
            {node.description && (
              <p className="text-xs text-muted-foreground">{node.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RolePermissionsEditor({
  role,
  initialPermissions,
  onSave,
  isSaving,
  canEdit,
  editRestrictionMessage,
}: {
  role: string;
  initialPermissions: RolePermissionSettings;
  onSave: (permissions: RolePermissionSettings) => void;
  isSaving: boolean;
  canEdit: boolean;
  editRestrictionMessage?: string;
}) {
  const [permissions, setPermissions] = useState<RolePermissionSettings>(initialPermissions);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setPermissions(initialPermissions);
    setHasChanges(false);
  }, [initialPermissions]);

  const handleChange = (path: string[], value: boolean) => {
    if (!canEdit) return;
    setPermissions((prev) => setNestedValue(prev, path, value));
    setHasChanges(true);
  };

  const handleReset = () => {
    if (!canEdit) return;
    const defaults = role === 'developer' ? DEFAULT_SUPERADMIN_PERMISSIONS : DEFAULT_AGENT_PERMISSIONS;
    setPermissions(defaults);
    setHasChanges(true);
  };

  const roleDisplayName = role === 'developer' ? 'Developer' : 
                          role === 'agent' ? 'Agent' : 
                          role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  const handleSave = () => {
    if (!canEdit) return;
    onSave(permissions);
    setHasChanges(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={role === 'developer' ? 'default' : 'secondary'}>
            {roleDisplayName}
          </Badge>
          {hasChanges && (
            <Badge variant="outline" className="text-amber-600 border-amber-600">
              Unsaved Changes
            </Badge>
          )}
          {!canEdit && (
            <Badge variant="outline" className="text-muted-foreground border-muted-foreground">
              View Only
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!canEdit} data-testid={`btn-reset-${role}`}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset to Default
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canEdit || !hasChanges || isSaving} data-testid={`btn-save-${role}`}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {!canEdit && editRestrictionMessage && (
        <div className="bg-muted/50 border rounded-md p-3 text-sm text-muted-foreground">
          {editRestrictionMessage}
        </div>
      )}

      <Separator />

      <div className={`space-y-2 ${!canEdit ? 'opacity-60 pointer-events-none' : ''}`}>
        {PERMISSION_TREE.map((node) => (
          <PermissionTreeNode
            key={node.key}
            node={node}
            path={[]}
            permissions={permissions}
            onChange={handleChange}
          />
        ))}
      </div>
    </div>
  );
}

export default function RolePermissions() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedRole, setSelectedRole] = useState<string>("developer");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [deleteRole, setDeleteRole] = useState<string | null>(null);

  const { data: permissions, isLoading, error } = useQuery<RolePermission[]>({
    queryKey: ['/api/role-permissions'],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ role, permissions }: { role: string; permissions: RolePermissionSettings }) => {
      return apiRequest('PATCH', `/api/role-permissions/${role}`, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/role-permissions'] });
      toast({
        title: "Permissions Updated",
        description: "Role permissions have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
        variant: "destructive",
      });
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: async (roleName: string) => {
      return apiRequest('POST', '/api/role-permissions', { role: roleName });
    },
    onSuccess: (_, roleName) => {
      queryClient.invalidateQueries({ queryKey: ['/api/role-permissions'] });
      toast({
        title: "Role Created",
        description: `New role "${roleName}" has been created successfully.`,
      });
      setCreateDialogOpen(false);
      setNewRoleName("");
      setSelectedRole(roleName);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create role",
        variant: "destructive",
      });
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleName: string) => {
      return apiRequest('DELETE', `/api/role-permissions/${roleName}`);
    },
    onSuccess: (_, roleName) => {
      queryClient.invalidateQueries({ queryKey: ['/api/role-permissions'] });
      toast({
        title: "Role Deleted",
        description: `Role "${roleName}" has been deleted.`,
      });
      setDeleteRole(null);
      if (selectedRole === roleName) {
        setSelectedRole("developer");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete role",
        variant: "destructive",
      });
      setDeleteRole(null);
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/role-permissions/seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/role-permissions'] });
      toast({
        title: "Permissions Seeded",
        description: "Default role permissions have been created.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to seed permissions",
        variant: "destructive",
      });
    },
  });

  const handleCreateRole = () => {
    const trimmedName = newRoleName.trim().toLowerCase().replace(/\s+/g, '_');
    if (trimmedName) {
      createRoleMutation.mutate(trimmedName);
    }
  };

  const handleDeleteRole = (roleName: string) => {
    deleteRoleMutation.mutate(roleName);
  };

  const isCustomRole = (role: string) => role !== 'developer' && role !== 'agent' && role !== 'admin';

  const getRoleIcon = (role: string) => {
    if (role === 'developer') return <Shield className="h-4 w-4 mr-2" />;
    if (role === 'agent') return <Users className="h-4 w-4 mr-2" />;
    return <UserCog className="h-4 w-4 mr-2" />;
  };

  const getRoleLabel = (role: string) => {
    if (role === 'developer') return 'Developer';
    if (role === 'agent') return 'Agent';
    return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  // Permission hierarchy for editing roles:
  // - Developer (developer) can edit: ALL roles including their own
  // - Admin can edit: Agent and custom roles only (not Developer or Admin)
  const canEditRole = (targetRole: string): boolean => {
    const currentUserRole = user?.role;
    if (currentUserRole === 'developer') {
      // Developer can edit all roles including their own
      return true;
    }
    if (currentUserRole === 'admin') {
      // Admin can edit all roles except Admin and Developer
      return targetRole !== 'admin' && targetRole !== 'developer';
    }
    return false;
  };

  const getEditRestrictionMessage = (targetRole: string): string | undefined => {
    const currentUserRole = user?.role;
    if (currentUserRole === 'admin') {
      if (targetRole === 'developer') {
        return "Developer role permissions can only be modified by Developer users.";
      }
      if (targetRole === 'admin') {
        return "Admin role permissions can only be modified by Developer users.";
      }
    }
    return undefined;
  };

  const allRoles = (() => {
    const coreRoles = ['developer', 'agent'];
    const customRoles = permissions
      ?.map(p => p.role)
      .filter(r => !coreRoles.includes(r))
      .sort() || [];
    return [...coreRoles, ...customRoles];
  })();

  // Allow both developer and admin to access this page
  if (user?.role !== 'developer' && user?.role !== 'admin') {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Access Denied</h3>
              <p className="text-muted-foreground">Only Developer and Admin users can manage role permissions.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const setAllBooleans = (obj: any, value: boolean): any => {
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
  };

  const deepMerge = (defaults: any, stored: any, inheritedEnabled?: boolean): any => {
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
        result[key] = deepMerge(defaults[key], stored[key], parentEnabled);
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
  };

  const getPermissionsForRole = (role: string): RolePermissionSettings => {
    const defaults = role === 'developer' ? DEFAULT_SUPERADMIN_PERMISSIONS : DEFAULT_AGENT_PERMISSIONS;
    const rolePermission = permissions?.find(p => p.role === role);
    if (rolePermission) {
      return deepMerge(defaults, rolePermission.permissions) as RolePermissionSettings;
    }
    return defaults;
  };

  const hasPermissionsInDb = permissions && permissions.length > 0;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="page-title">Role Permissions</h1>
          </div>
          {(user?.role === 'developer' || user?.role === 'admin') && (
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="btn-create-role">
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Role</DialogTitle>
                  <DialogDescription>
                    Create a custom role with its own permission settings. The role name should be lowercase with no spaces (use underscores instead).
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="role-name">Role Name</Label>
                    <Input
                      id="role-name"
                      placeholder="e.g., team_lead, supervisor, viewer"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      data-testid="input-role-name"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use lowercase letters, numbers, and underscores only. The new role will start with Agent-level permissions.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreateRole} 
                    disabled={!newRoleName.trim() || createRoleMutation.isPending}
                    data-testid="btn-confirm-create-role"
                  >
                    {createRoleMutation.isPending ? 'Creating...' : 'Create Role'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <p className="text-muted-foreground">
          Configure which features and pages each role can access. Changes take effect immediately for all users with that role.
        </p>
      </div>

      {!hasPermissionsInDb && !isLoading && (
        <Card className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <h4 className="font-medium">No Permissions Configured</h4>
              <p className="text-sm text-muted-foreground">
                Click the button to set up default permissions for all roles.
              </p>
            </div>
            <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="btn-seed-permissions">
              {seedMutation.isPending ? 'Setting Up...' : 'Set Up Default Permissions'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Permission Settings by Role
          </CardTitle>
          <CardDescription>
            Select a role to view and modify its permissions. Each checkbox controls access to a specific feature.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              <p>Failed to load permissions. Please try again.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <Label htmlFor="role-select" className="text-sm font-medium whitespace-nowrap">Select Role:</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="w-[280px]" data-testid="select-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {allRoles.map((role) => (
                      <SelectItem key={role} value={role} data-testid={`option-${role}`}>
                        <div className="flex items-center">
                          {getRoleLabel(role)}
                          {isCustomRole(role) && (
                            <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">
                              Custom
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRole && (
                <div className="space-y-4">
                  {isCustomRole(selectedRole) && canEditRole(selectedRole) && (
                    <div className="flex justify-end">
                      <AlertDialog open={deleteRole === selectedRole} onOpenChange={(open) => setDeleteRole(open ? selectedRole : null)}>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" data-testid={`btn-delete-${selectedRole}`}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Role
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Role "{getRoleLabel(selectedRole)}"?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. This will permanently delete the role and its permission settings.
                              <br /><br />
                              <strong>Note:</strong> You cannot delete a role if there are users assigned to it. Reassign those users first.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleDeleteRole(selectedRole)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`btn-confirm-delete-${selectedRole}`}
                            >
                              {deleteRoleMutation.isPending ? 'Deleting...' : 'Delete Role'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                  <RolePermissionsEditor
                    role={selectedRole}
                    initialPermissions={getPermissionsForRole(selectedRole)}
                    onSave={(perms) => updateMutation.mutate({ role: selectedRole, permissions: perms })}
                    isSaving={updateMutation.isPending}
                    canEdit={canEditRole(selectedRole)}
                    editRestrictionMessage={getEditRestrictionMessage(selectedRole)}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
