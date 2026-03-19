import { Link, useLocation } from "wouter";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RoleSelector } from "@/components/role-selector";
import { useAuth } from "@/hooks/use-auth";
import { useOnboarding } from "@/hooks/use-onboarding";
import { usePermissions } from "@/hooks/use-permissions";
import { usePreviewRole } from "@/hooks/use-preview-role";
import type { RolePermissionSettings, UserRole, RolePermission, User } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { 
  LogOut, 
  Settings, 
  Users, 
  FileText, 
  CheckCircle, 
  Activity, 
  BarChart3, 
  Home, 
  Clock, 
  MapPin, 
  Key, 
  FileCode, 
  HelpCircle,
  Menu,
  Database,
  Truck,
  Shield,
  Eye,
  User as UserIcon,
  Search,
  Wrench
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGES, CATEGORIES, getPagesByCategory, type PageCategory } from "@shared/page-registry";

type NavItem = {
  name: string;
  href: string;
  icon: typeof Home;
  category?: string;
};

type NavCategory = {
  name: string;
  icon: typeof Home;
  items: NavItem[];
};

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { startOnboarding, resetOnboarding } = useOnboarding();
  const { permissions, effectiveRole } = usePermissions();
  const { previewRole, setPreviewRole, previewUser, setPreviewUser, isPreviewMode, isUserPreviewMode, exitPreviewMode } = usePreviewRole();
  const [isOpen, setIsOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const { data: rolePermissions = [] } = useQuery<RolePermission[]>({
    queryKey: ['/api/role-permissions'],
    enabled: user?.role === 'developer',
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: user?.role === 'developer',
  });

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return allUsers.slice(0, 10);
    const search = userSearch.toLowerCase();
    return allUsers
      .filter(u => 
        u.username.toLowerCase().includes(search) || 
        u.email?.toLowerCase().includes(search) ||
        u.role.toLowerCase().includes(search)
      )
      .slice(0, 10);
  }, [allUsers, userSearch]);

  const availableRoles = useMemo(() => {
    return rolePermissions
      .filter(rp => rp.role !== 'developer')
      .map(rp => ({
        value: rp.role as UserRole,
        label: rp.role === 'admin' ? 'Admin' :
               rp.role === 'agent' ? 'Agent' : 
               rp.role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      }));
  }, [rolePermissions]);
  
  const handleStartTutorial = () => {
    resetOnboarding();
    setTimeout(() => startOnboarding(), 100);
    setIsOpen(false);
  };

  const handleNavClick = () => {
    setIsOpen(false);
  };

  const handlePreviewRoleChange = (role: string) => {
    if (role === 'none') {
      exitPreviewMode();
    } else {
      setPreviewRole(role as UserRole);
    }
    setIsOpen(false);
  };

  const handlePreviewUserSelect = (selectedUser: User) => {
    setPreviewUser({
      id: selectedUser.id,
      username: selectedUser.username,
      role: selectedUser.role as UserRole,
      departments: selectedUser.departments || [],
      permissionOverrides: (selectedUser as any).permissionOverrides || undefined,
    });
    setUserSearch("");
    setIsOpen(false);
  };

  if (!user) return null;

  const getNavigationForRole = (userRole: string, perms: RolePermissionSettings) => {
    const result: NavItem[] = [];
    
    if (perms?.homePage) {
      result.push({ name: "Home", href: "/", icon: Home, category: "main" });
    }
    
    const sidebarPerms = perms?.sidebar;
    
    for (const category of CATEGORIES) {
      const categoryPerms = sidebarPerms?.[category.permissionKey as keyof typeof sidebarPerms] as any;
      
      if (typeof categoryPerms === 'boolean') {
        if (categoryPerms) {
          const pagesInCategory = getPagesByCategory(category.key);
          for (const page of pagesInCategory) {
            if (page.hideFromNav) continue;
            result.push({
              name: page.label,
              href: page.path,
              icon: page.icon,
              category: category.key,
            });
          }
        }
      } else if (categoryPerms?.enabled) {
        const pagesInCategory = getPagesByCategory(category.key);
        for (const page of pagesInCategory) {
          if (page.hideFromNav) continue;
          if (categoryPerms[page.permissionKey]) {
            result.push({
              name: page.label,
              href: page.path,
              icon: page.icon,
              category: category.key,
            });
          }
        }
      }
    }
    
    return result;
  };

  const allNavItems = useMemo(() => getNavigationForRole(user.role, permissions), [user.role, permissions]);
  
  // Normalize location by stripping query strings and hash for accurate matching
  const normalizedLocation = location.split(/[?#]/)[0];
  // Filter out undefined items first, then exclude current location from navigation
  const filteredNavItems = allNavItems.filter(item => item && item.href !== normalizedLocation);

  const organizeByCategory = (items: NavItem[]): { standalone: NavItem[], categories: NavCategory[] } => {
    const categoryMap: Record<string, NavItem[]> = {};
    const standalone: NavItem[] = [];

    items.forEach(item => {
      if (item.category === 'main') {
        standalone.push(item);
      } else if (item.category) {
        if (!categoryMap[item.category]) {
          categoryMap[item.category] = [];
        }
        categoryMap[item.category].push(item);
      }
    });

    const categoryConfig: Record<string, { name: string; icon: typeof Home }> = {
      dashboards: { name: "Dashboards", icon: BarChart3 },
      queues: { name: "Queues", icon: Clock },
      management: { name: "Management", icon: Settings },
      activities: { name: "Activity", icon: Activity },
      account: { name: "Account", icon: Key },
      helpAndTutorial: { name: "Help", icon: HelpCircle },
      fleetScope: { name: "Fleet Scope", icon: Wrench },
      tpms: { name: "TPMS", icon: Database },
    };

    const categories: NavCategory[] = Object.entries(categoryMap)
      .filter(([_, items]) => items.length > 0)
      .map(([key, items]) => ({
        name: categoryConfig[key]?.name || key,
        icon: categoryConfig[key]?.icon || Settings,
        items,
      }));

    return { standalone, categories };
  };

  const { standalone, categories } = organizeByCategory(filteredNavItems);

  return (
    <div className="fixed top-4 left-4 z-50">
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 bg-background shadow-md"
            data-testid="button-hamburger-menu"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open navigation menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="start" 
          className="w-64 max-h-[calc(100vh-100px)] overflow-y-auto"
          sideOffset={8}
        >
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border mb-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Settings className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">Nexus</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>

          <div className="px-2 py-2 border-b border-border mb-2">
            <RoleSelector />
          </div>

          {standalone.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link
                  href={item.href}
                  onClick={handleNavClick}
                  className="flex items-center gap-3 cursor-pointer"
                  data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              </DropdownMenuItem>
            );
          })}

          {standalone.length > 0 && categories.length > 0 && (
            <DropdownMenuSeparator />
          )}

          {categories.map((category) => {
            const CategoryIcon = category.icon;
            return (
              <DropdownMenuSub key={category.name}>
                <DropdownMenuSubTrigger className="flex items-center gap-3" data-testid={`menu-category-${category.name.toLowerCase()}`}>
                  <CategoryIcon className="h-4 w-4" />
                  <span>{category.name}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-48">
                    {category.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem key={item.href} asChild>
                          <Link
                            href={item.href}
                            onClick={handleNavClick}
                            className="flex items-center gap-3 cursor-pointer"
                            data-testid={`link-nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <Icon className="h-4 w-4" />
                            {item.name}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            );
          })}

          <DropdownMenuSeparator />

          {/* View as Role - Super Admin Only */}
          {user.role === 'developer' && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-3" data-testid="menu-view-as-role">
                <Eye className="h-4 w-4" />
                <span>View as Role</span>
                {isPreviewMode && !isUserPreviewMode && (
                  <span className="ml-auto text-xs bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                    Active
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="min-w-48">
                  <DropdownMenuRadioGroup value={previewRole || 'none'} onValueChange={handlePreviewRoleChange}>
                    <DropdownMenuRadioItem value="none" data-testid="radio-view-as-developer">
                      Developer (My Role)
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {availableRoles.map((role) => (
                      <DropdownMenuRadioItem key={role.value} value={role.value} data-testid={`radio-view-as-${role.value}`}>
                        {role.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          {/* View as User - Super Admin Only */}
          {user.role === 'developer' && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-3" data-testid="menu-view-as-user">
                <UserIcon className="h-4 w-4" />
                <span>View as User</span>
                {isUserPreviewMode && (
                  <span className="ml-auto text-xs bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                    {previewUser?.username}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="min-w-64">
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="pl-8 h-8 text-sm"
                        data-testid="input-user-search"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setPreviewUser(null);
                      setUserSearch("");
                      setIsOpen(false);
                    }}
                    className="flex items-center gap-2"
                    data-testid="menu-exit-user-preview"
                  >
                    <span className={!isUserPreviewMode ? "font-medium" : ""}>
                      Exit User Preview
                    </span>
                    {!isUserPreviewMode && <CheckCircle className="h-3 w-3 ml-auto text-green-500" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="max-h-48 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                        No users found
                      </div>
                    ) : (
                      filteredUsers.map((u) => (
                        <DropdownMenuItem
                          key={u.id}
                          onClick={() => handlePreviewUserSelect(u)}
                          className="flex items-center justify-between gap-2"
                          data-testid={`menu-user-${u.username}`}
                        >
                          <div className="flex flex-col">
                            <span className={previewUser?.id === u.id ? "font-medium" : ""}>
                              {u.username}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {u.role} {u.departments?.length ? `• ${u.departments.join(', ')}` : ''}
                            </span>
                          </div>
                          {previewUser?.id === u.id && <CheckCircle className="h-3 w-3 text-green-500" />}
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                  {allUsers.length > 10 && !userSearch && (
                    <div className="px-2 py-1 text-xs text-muted-foreground text-center border-t">
                      Type to search {allUsers.length} users
                    </div>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />

          <div className="px-3 py-2 border-t border-border mt-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center">
                <Users className="h-4 w-4 text-secondary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" data-testid="text-user-name">
                  {user.username}
                </div>
                <div className="text-xs text-muted-foreground truncate" data-testid="text-user-email">
                  {user.email}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout();
                  setIsOpen(false);
                  setLocation("/login");
                }}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
