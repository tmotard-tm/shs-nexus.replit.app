import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Shield, Users, Save, RefreshCw, Settings } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { RolePermissionSettings } from "@shared/schema";
import { DEFAULT_SUPERADMIN_PERMISSIONS, DEFAULT_AGENT_PERMISSIONS } from "@/lib/role-permissions";

interface RolePermission {
  id: string;
  role: string;
  permissions: RolePermissionSettings;
  createdAt: string;
  updatedAt: string;
}

interface PermissionNode {
  key: string;
  label: string;
  description?: string;
  children?: PermissionNode[];
}

const PERMISSION_TREE: PermissionNode[] = [
  {
    key: "homePage",
    label: "Home Page",
    description: "Access to the main home page",
  },
  {
    key: "quickActions",
    label: "Quick Action Icons",
    description: "Control visibility of quick action buttons on home page",
    children: [
      { key: "taskQueue", label: "Task Queue", description: "Access to Task Queue quick action" },
      { key: "offboarding", label: "Offboarding", description: "Access to Offboarding quick action" },
      { key: "onboarding", label: "Onboarding", description: "Access to Onboarding quick action" },
      { key: "assignVehicle", label: "Assign or Update Vehicle", description: "Access to Vehicle Assignment quick action" },
      { key: "createVehicle", label: "Create New Vehicle", description: "Access to Create Vehicle quick action" },
    ],
  },
  {
    key: "sidebar",
    label: "Sidebar Navigation",
    description: "Control visibility of sidebar sections",
    children: [
      {
        key: "dashboards",
        label: "Dashboards Section",
        description: "Dashboard navigation group",
        children: [
          { key: "dashboard", label: "Main Dashboard", description: "Overview dashboard with key metrics" },
          { key: "vehicleAssignmentDash", label: "Vehicle Assignment Dashboard", description: "Vehicle assignment overview" },
          { key: "operationsDash", label: "Operations Dashboard", description: "Operations and productivity dashboard" },
        ],
      },
      {
        key: "queues",
        label: "Queues Section",
        description: "Queue management navigation group",
        children: [
          { key: "queueManagement", label: "Queue Management", description: "Unified queue management interface" },
          { key: "ntaoQueue", label: "NTAO Queue", description: "NTAO department queue" },
          { key: "assetsQueue", label: "Assets Queue", description: "Assets department queue" },
          { key: "inventoryQueue", label: "Inventory Queue", description: "Inventory department queue" },
          { key: "fleetQueue", label: "Fleet Queue", description: "Fleet department queue" },
        ],
      },
      {
        key: "management",
        label: "Management Section",
        description: "User management, templates, and system settings",
        children: [
          { key: "storageSpots", label: "Storage Spots", description: "Manage storage spot locations" },
          { key: "approvals", label: "Approvals", description: "Request approvals and reviews" },
          { key: "integrations", label: "Integrations", description: "API integrations and connections" },
          { key: "userManagement", label: "User Management", description: "Create and manage user accounts" },
          { key: "templateManagement", label: "Template Management", description: "Manage workflow templates" },
          { key: "rolePermissions", label: "Role Permissions", description: "Configure role-based access control" },
          { key: "vehicleAssignments", label: "Vehicle Assignments", description: "Manage vehicle assignments to technicians" },
          { key: "snowflakeIntegration", label: "Snowflake Integration", description: "Snowflake data warehouse settings" },
          { key: "techRoster", label: "Tech Roster", description: "View technician roster from Snowflake" },
        ],
      },
      {
        key: "activities",
        label: "Activities Section",
        description: "Activity logs and audit trail",
        children: [
          { key: "activityLogs", label: "Activity Logs", description: "View user activity and audit logs" },
        ],
      },
      {
        key: "account",
        label: "Account Section",
        description: "Account settings and preferences",
        children: [
          { key: "changePassword", label: "Change Password", description: "Allow users to change their password" },
        ],
      },
      {
        key: "helpAndTutorial",
        label: "Help & Tutorial Section",
        description: "Help documentation and onboarding",
        children: [
          { key: "tutorial", label: "Tutorial", description: "Interactive onboarding tutorial" },
        ],
      },
    ],
  },
  {
    key: "pageFeatures",
    label: "Page Features",
    description: "Granular control over features within individual pages",
    children: [
      {
        key: "queueManagement",
        label: "Queue Management Page",
        description: "Controls for Queue Management page elements",
        children: [
          {
            key: "filters",
            label: "Filters Section",
            description: "Control filter and search elements",
            children: [
              { key: "queueCheckboxes", label: "Queue Checkboxes", description: "Show/hide department queue checkboxes" },
              { key: "statusCards", label: "Status Cards", description: "Show/hide status filter cards (New, In Progress, etc.)" },
              { key: "employeeSearch", label: "Employee Search", description: "Show/hide employee search combobox" },
              { key: "workflowTypeFilter", label: "Workflow Type Filter", description: "Show/hide workflow type dropdown" },
              { key: "assignedAgentFilter", label: "Assigned Agent Filter", description: "Show/hide assigned agent dropdown" },
              { key: "dateFilters", label: "Date Filters", description: "Show/hide date from/to pickers" },
              { key: "sortOrder", label: "Sort Order", description: "Show/hide sort order dropdown" },
            ],
          },
          {
            key: "taskActions",
            label: "Task Actions",
            description: "Control action buttons on task items",
            children: [
              { key: "viewTask", label: "View Task", description: "Show/hide View button" },
              { key: "startWork", label: "Start Work", description: "Show/hide Start Work button" },
              { key: "continueWork", label: "Continue Work", description: "Show/hide Continue Work button" },
              { key: "pickUpForMe", label: "Pick Up For Me", description: "Show/hide Pick Up For Me button" },
              { key: "assignToOther", label: "Assign To Other", description: "Show/hide Assign To Other button" },
            ],
          },
          {
            key: "adminActions",
            label: "Admin Actions",
            description: "Control admin-only actions in task view dialog",
            children: [
              { key: "releaseTask", label: "Release Task", description: "Show/hide Release Task button" },
              { key: "reassignTask", label: "Reassign Task", description: "Show/hide Reassign Task button" },
            ],
          },
        ],
      },
      {
        key: "userManagement",
        label: "User Management Page",
        description: "Controls for User Management page elements",
        children: [
          { key: "createUser", label: "Create User", description: "Show/hide Create User button" },
          { key: "editUser", label: "Edit User", description: "Show/hide Edit User button" },
          { key: "deleteUser", label: "Delete User", description: "Show/hide Delete User button" },
          { key: "resetPassword", label: "Reset Password", description: "Show/hide Reset Password button" },
          { key: "changeRole", label: "Change Role", description: "Show/hide role change functionality" },
        ],
      },
      {
        key: "templateManagement",
        label: "Template Management Page",
        description: "Controls for Template Management page elements",
        children: [
          { key: "createTemplate", label: "Create Template", description: "Show/hide Create Template button" },
          { key: "editTemplate", label: "Edit Template", description: "Show/hide Edit Template button" },
          { key: "deleteTemplate", label: "Delete Template", description: "Show/hide Delete Template button" },
          { key: "toggleStatus", label: "Toggle Status", description: "Show/hide template status toggle" },
        ],
      },
      {
        key: "vehicleAssignments",
        label: "Vehicle Assignments Page",
        description: "Controls for Vehicle Assignments page elements",
        children: [
          { key: "viewAssignments", label: "View Assignments", description: "Show/hide assignment view" },
          { key: "createAssignment", label: "Create Assignment", description: "Show/hide Create Assignment button" },
          { key: "editAssignment", label: "Edit Assignment", description: "Show/hide Edit Assignment button" },
          { key: "deleteAssignment", label: "Delete Assignment", description: "Show/hide Delete Assignment button" },
          { key: "syncFromTPMS", label: "Sync from TPMS", description: "Show/hide TPMS sync button" },
        ],
      },
      {
        key: "storageSpots",
        label: "Storage Spots Page",
        description: "Controls for Storage Spots page elements",
        children: [
          { key: "createSpot", label: "Create Spot", description: "Show/hide Create Spot button" },
          { key: "editSpot", label: "Edit Spot", description: "Show/hide Edit Spot button" },
          { key: "deleteSpot", label: "Delete Spot", description: "Show/hide Delete Spot button" },
        ],
      },
    ],
  },
];

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
}: {
  role: string;
  initialPermissions: RolePermissionSettings;
  onSave: (permissions: RolePermissionSettings) => void;
  isSaving: boolean;
}) {
  const [permissions, setPermissions] = useState<RolePermissionSettings>(initialPermissions);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setPermissions(initialPermissions);
    setHasChanges(false);
  }, [initialPermissions]);

  const handleChange = (path: string[], value: boolean) => {
    setPermissions((prev) => setNestedValue(prev, path, value));
    setHasChanges(true);
  };

  const handleReset = () => {
    const defaults = role === 'superadmin' ? DEFAULT_SUPERADMIN_PERMISSIONS : DEFAULT_AGENT_PERMISSIONS;
    setPermissions(defaults);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(permissions);
    setHasChanges(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={role === 'superadmin' ? 'default' : 'secondary'}>
            {role === 'superadmin' ? 'Super Admin' : 'Agent'}
          </Badge>
          {hasChanges && (
            <Badge variant="outline" className="text-amber-600 border-amber-600">
              Unsaved Changes
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} data-testid={`btn-reset-${role}`}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset to Default
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges || isSaving} data-testid={`btn-save-${role}`}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
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
  const [selectedRole, setSelectedRole] = useState<string>("superadmin");

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

  if (user?.role !== 'superadmin') {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Access Denied</h3>
              <p className="text-muted-foreground">Only superadmins can manage role permissions.</p>
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
    const defaults = role === 'superadmin' ? DEFAULT_SUPERADMIN_PERMISSIONS : DEFAULT_AGENT_PERMISSIONS;
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
        <div className="flex items-center gap-3 mb-2">
          <Settings className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold" data-testid="page-title">Role Permissions</h1>
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
            Select a role tab to view and modify its permissions. Each checkbox controls access to a specific feature.
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
            <Tabs value={selectedRole} onValueChange={setSelectedRole}>
              <TabsList className="mb-4">
                <TabsTrigger value="superadmin" data-testid="tab-superadmin">
                  <Shield className="h-4 w-4 mr-2" />
                  Super Admin
                </TabsTrigger>
                <TabsTrigger value="agent" data-testid="tab-agent">
                  <Users className="h-4 w-4 mr-2" />
                  Agent
                </TabsTrigger>
              </TabsList>

              <TabsContent value="superadmin">
                <RolePermissionsEditor
                  role="superadmin"
                  initialPermissions={getPermissionsForRole('superadmin')}
                  onSave={(perms) => updateMutation.mutate({ role: 'superadmin', permissions: perms })}
                  isSaving={updateMutation.isPending}
                />
              </TabsContent>

              <TabsContent value="agent">
                <RolePermissionsEditor
                  role="agent"
                  initialPermissions={getPermissionsForRole('agent')}
                  onSave={(perms) => updateMutation.mutate({ role: 'agent', permissions: perms })}
                  isSaving={updateMutation.isPending}
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
