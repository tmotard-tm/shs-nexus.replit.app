import { 
  Home, 
  BarChart3, 
  Activity, 
  Clock, 
  MapPin, 
  FileText, 
  CheckCircle, 
  Settings, 
  Users, 
  FileCode, 
  Shield, 
  Truck, 
  Key,
  Database,
  type LucideIcon
} from "lucide-react";

export type PageCategory = 
  | "main"
  | "dashboards"
  | "queues"
  | "management"
  | "activities"
  | "account"
  | "helpAndTutorial";

export type PermissionPath = string[];

export interface PageFeature {
  key: string;
  label: string;
  description: string;
}

export interface PageFeatureGroup {
  key: string;
  label: string;
  description: string;
  features: PageFeature[];
}

export interface PageDefinition {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  category: PageCategory;
  permissionKey: string;
  features?: (PageFeature | PageFeatureGroup)[];
}

export interface CategoryDefinition {
  key: PageCategory;
  label: string;
  description: string;
  icon: LucideIcon;
  permissionKey: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    key: "dashboards",
    label: "Dashboards Section",
    description: "Dashboard navigation group",
    icon: BarChart3,
    permissionKey: "dashboards",
  },
  {
    key: "queues",
    label: "Queues Section",
    description: "Queue management navigation group",
    icon: Clock,
    permissionKey: "queues",
  },
  {
    key: "management",
    label: "Management Section",
    description: "User management, templates, and system settings",
    icon: Settings,
    permissionKey: "management",
  },
  {
    key: "activities",
    label: "Activities Section",
    description: "Activity logs and audit trail",
    icon: Activity,
    permissionKey: "activities",
  },
  {
    key: "account",
    label: "Account Section",
    description: "Account settings and preferences",
    icon: Key,
    permissionKey: "account",
  },
  {
    key: "helpAndTutorial",
    label: "Help & Tutorial Section",
    description: "Help documentation and onboarding",
    icon: Settings,
    permissionKey: "helpAndTutorial",
  },
];

export const PAGES: PageDefinition[] = [
  {
    key: "dashboard",
    label: "Main Dashboard",
    description: "Overview dashboard with key metrics",
    path: "/dashboard",
    icon: BarChart3,
    category: "dashboards",
    permissionKey: "dashboard",
  },
  {
    key: "vehicleAssignmentDash",
    label: "Fleet Distribution",
    description: "Fleet distribution overview",
    path: "/fleet-distribution",
    icon: Activity,
    category: "dashboards",
    permissionKey: "vehicleAssignmentDash",
  },
  {
    key: "operationsDash",
    label: "Operations Dashboard",
    description: "Operations and productivity dashboard",
    path: "/operations",
    icon: BarChart3,
    category: "dashboards",
    permissionKey: "operationsDash",
  },
  {
    key: "queueManagement",
    label: "Queue Management",
    description: "Unified queue management interface",
    path: "/queue-management",
    icon: Clock,
    category: "queues",
    permissionKey: "queueManagement",
    features: [
      {
        key: "filters",
        label: "Filters Section",
        description: "Control filter and search elements",
        features: [
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
        features: [
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
        features: [
          { key: "releaseTask", label: "Release Task", description: "Show/hide Release Task button" },
          { key: "reassignTask", label: "Reassign Task", description: "Show/hide Reassign Task button" },
        ],
      },
    ],
  },
  {
    key: "ntaoQueue",
    label: "NTAO Queue",
    description: "NTAO department queue",
    path: "/ntao-queue",
    icon: Clock,
    category: "queues",
    permissionKey: "ntaoQueue",
  },
  {
    key: "assetsQueue",
    label: "Assets Queue",
    description: "Assets department queue",
    path: "/assets-queue",
    icon: Clock,
    category: "queues",
    permissionKey: "assetsQueue",
  },
  {
    key: "inventoryQueue",
    label: "Inventory Queue",
    description: "Inventory department queue",
    path: "/inventory-queue",
    icon: Clock,
    category: "queues",
    permissionKey: "inventoryQueue",
  },
  {
    key: "fleetQueue",
    label: "Fleet Queue",
    description: "Fleet department queue",
    path: "/fleet-queue",
    icon: Clock,
    category: "queues",
    permissionKey: "fleetQueue",
  },
  {
    key: "storageSpots",
    label: "Storage Spots",
    description: "Manage storage spot locations",
    path: "/storage-spots",
    icon: MapPin,
    category: "management",
    permissionKey: "storageSpots",
    features: [
      { key: "createSpot", label: "Create Spot", description: "Show/hide Create Spot button" },
      { key: "editSpot", label: "Edit Spot", description: "Show/hide Edit Spot button" },
      { key: "deleteSpot", label: "Delete Spot", description: "Show/hide Delete Spot button" },
    ],
  },
  {
    key: "integrations",
    label: "Integrations",
    description: "API integrations and connections",
    path: "/integrations",
    icon: Settings,
    category: "management",
    permissionKey: "integrations",
  },
  {
    key: "userManagement",
    label: "User Management",
    description: "Create and manage user accounts",
    path: "/users",
    icon: Users,
    category: "management",
    permissionKey: "userManagement",
    features: [
      { key: "createUser", label: "Create User", description: "Show/hide Create User button" },
      { key: "editUser", label: "Edit User", description: "Show/hide Edit User button" },
      { key: "deleteUser", label: "Delete User", description: "Show/hide Delete User button" },
      { key: "resetPassword", label: "Reset Password", description: "Show/hide Reset Password button" },
      { key: "changeRole", label: "Change Role", description: "Show/hide role change functionality" },
    ],
  },
  {
    key: "templateManagement",
    label: "Template Management",
    description: "Manage workflow templates",
    path: "/templates",
    icon: FileCode,
    category: "management",
    permissionKey: "templateManagement",
    features: [
      { key: "createTemplate", label: "Create Template", description: "Show/hide Create Template button" },
      { key: "editTemplate", label: "Edit Template", description: "Show/hide Edit Template button" },
      { key: "deleteTemplate", label: "Delete Template", description: "Show/hide Delete Template button" },
      { key: "toggleStatus", label: "Toggle Status", description: "Show/hide template status toggle" },
    ],
  },
  {
    key: "rolePermissions",
    label: "Role Permissions",
    description: "Configure role-based access control",
    path: "/role-permissions",
    icon: Shield,
    category: "management",
    permissionKey: "rolePermissions",
  },
  {
    key: "fleetManagement",
    label: "Fleet Management",
    description: "Unified fleet vehicle management - assignments, updates, and sync",
    path: "/fleet-management",
    icon: Truck,
    category: "management",
    permissionKey: "fleetManagement",
    features: [
      { key: "viewVehicles", label: "View Vehicles", description: "Show/hide vehicle list" },
      { key: "syncToHolman", label: "Sync to Holman", description: "Show/hide Sync to Holman button" },
      { key: "unassignVehicle", label: "Unassign Vehicle", description: "Show/hide Unassign button" },
      { key: "viewHistory", label: "View History", description: "Show/hide assignment history" },
    ],
  },
  {
    key: "techRoster",
    label: "Tech Roster",
    description: "View technician roster from Snowflake",
    path: "/tech-roster",
    icon: Users,
    category: "management",
    permissionKey: "techRoster",
  },
  {
    key: "activityLogs",
    label: "Activity Logs",
    description: "View user activity and audit logs",
    path: "/activity",
    icon: Activity,
    category: "activities",
    permissionKey: "activityLogs",
  },
  {
    key: "changePassword",
    label: "Change Password",
    description: "Allow users to change their password",
    path: "/change-password",
    icon: Key,
    category: "account",
    permissionKey: "changePassword",
  },
  {
    key: "tutorial",
    label: "Tutorial",
    description: "Interactive onboarding tutorial",
    path: "/tutorial",
    icon: Settings,
    category: "helpAndTutorial",
    permissionKey: "tutorial",
  },
];

export const QUICK_ACTIONS: PageFeature[] = [
  { key: "taskQueue", label: "Task Queue", description: "Access to Task Queue quick action" },
  { key: "offboarding", label: "Offboarding", description: "Access to Offboarding quick action" },
  { key: "onboarding", label: "Onboarding", description: "Access to Onboarding quick action" },
  { key: "assignVehicle", label: "Assign or Update Vehicle", description: "Access to Vehicle Assignment quick action" },
  { key: "createVehicle", label: "Create New Vehicle", description: "Access to Create Vehicle quick action" },
];

export function getPagesByCategory(category: PageCategory): PageDefinition[] {
  return PAGES.filter(page => page.category === category);
}

export function getPageByKey(key: string): PageDefinition | undefined {
  return PAGES.find(page => page.key === key);
}

export function getPageByPath(path: string): PageDefinition | undefined {
  return PAGES.find(page => page.path === path);
}

export function getCategoryByKey(key: PageCategory): CategoryDefinition | undefined {
  return CATEGORIES.find(cat => cat.key === key);
}

export interface PermissionNode {
  key: string;
  label: string;
  description?: string;
  children?: PermissionNode[];
}

function convertFeaturesToNodes(features: (PageFeature | PageFeatureGroup)[]): PermissionNode[] {
  return features.map(feature => {
    if ('features' in feature) {
      return {
        key: feature.key,
        label: feature.label,
        description: feature.description,
        children: feature.features.map(f => ({
          key: f.key,
          label: f.label,
          description: f.description,
        })),
      };
    }
    return {
      key: feature.key,
      label: feature.label,
      description: feature.description,
    };
  });
}

export function generatePermissionTree(): PermissionNode[] {
  const tree: PermissionNode[] = [];
  
  tree.push({
    key: "homePage",
    label: "Home Page",
    description: "Access to the main home page",
  });
  
  tree.push({
    key: "quickActions",
    label: "Quick Action Icons",
    description: "Control visibility of quick action buttons on home page",
    children: QUICK_ACTIONS.map(qa => ({
      key: qa.key,
      label: qa.label,
      description: qa.description,
    })),
  });
  
  const sidebarChildren: PermissionNode[] = [];
  
  for (const category of CATEGORIES) {
    const pagesInCategory = getPagesByCategory(category.key);
    if (pagesInCategory.length > 0) {
      sidebarChildren.push({
        key: category.permissionKey,
        label: category.label,
        description: category.description,
        children: pagesInCategory.map(page => ({
          key: page.permissionKey,
          label: page.label,
          description: page.description,
        })),
      });
    }
  }
  
  tree.push({
    key: "sidebar",
    label: "Sidebar Navigation",
    description: "Control visibility of sidebar sections",
    children: sidebarChildren,
  });
  
  const pageFeatureNodes: PermissionNode[] = [];
  
  for (const page of PAGES) {
    if (page.features && page.features.length > 0) {
      pageFeatureNodes.push({
        key: page.key,
        label: `${page.label} Page`,
        description: `Controls for ${page.label} page elements`,
        children: convertFeaturesToNodes(page.features),
      });
    }
  }
  
  if (pageFeatureNodes.length > 0) {
    tree.push({
      key: "pageFeatures",
      label: "Page Features",
      description: "Granular control over features within individual pages",
      children: pageFeatureNodes,
    });
  }
  
  return tree;
}
