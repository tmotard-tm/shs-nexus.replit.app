import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Shield, Users, UserCheck, Key, Settings, ArrowLeft, Eye, EyeOff, Filter, ChevronDown, Search, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInsertSchema } from "drizzle-zod";
import { users, RolePermission } from "@shared/schema";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

// Form validation schema - simplified for developer/agent roles only
const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
const createUserSchema = insertUserSchema.extend({
  confirmPassword: z.string().min(6),
  departments: z.array(z.string()).optional(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type CreateUserFormData = z.infer<typeof createUserSchema>;
type User = typeof users.$inferSelect;

export default function UserManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [managingUser, setManagingUser] = useState<User | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const handleCreateDialogChange = (open: boolean) => {
    setIsCreateOpen(open);
    if (!open) {
      setShowPassword(false);
      setShowConfirmPassword(false);
    }
  };

  const handlePasswordResetDialogChange = (open: boolean) => {
    if (!open) {
      setPasswordResetUser(null);
      setShowResetPassword(false);
      setShowResetConfirmPassword(false);
    } else if (passwordResetUser) {
      setShowResetPassword(false);
      setShowResetConfirmPassword(false);
    }
  };

  const handleBackClick = () => {
    setLocation("/");
  };

  // Fetch users
  const { data: allUsers = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fetch all roles (including custom roles)
  const { data: rolePermissions = [] } = useQuery<RolePermission[]>({
    queryKey: ["/api/role-permissions"],
  });

  // Build list of available roles for dropdown
  const availableRoles = rolePermissions.map(rp => ({
    value: rp.role,
    label: rp.role === 'developer' ? 'Developer' : 
           rp.role === 'admin' ? 'Admin' :
           rp.role === 'agent' ? 'Agent' : 
           rp.role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }));

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: (userData: Omit<CreateUserFormData, 'confirmPassword'>) =>
      apiRequest("POST", "/api/users", userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      handleCreateDialogChange(false);
      toast({
        title: "Success",
        description: "User created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update user mutation (for profile: username, email)
  const updateUserMutation = useMutation({
    mutationFn: ({ id, ...userData }: { id: string } & Partial<User>) =>
      apiRequest("PATCH", `/api/users/${id}`, userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setManagingUser(null);
      toast({
        title: "Success",
        description: "User updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("DELETE", `/api/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "User deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Admin password reset mutation
  const passwordResetMutation = useMutation({
    mutationFn: ({ userId, temporaryPassword }: { userId: string; temporaryPassword: string }) =>
      apiRequest("POST", `/api/users/${userId}/reset-password`, { temporaryPassword }),
    onSuccess: (data: any) => {
      handlePasswordResetDialogChange(false);
      toast({
        title: "Success",
        description: `Password reset successfully for ${data.username}. User can now log in with the new temporary password.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Admin role management mutation (for access: role, departments)
  const roleUpdateMutation = useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: { role?: string; departments?: string[]; isActive?: boolean } }) =>
      apiRequest("POST", `/api/users/${userId}/update-role`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setManagingUser(null);
      toast({
        title: "Success",
        description: "User role and permissions updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Form setup - simplified for developer/agent roles only
  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "agent",
      departments: [],
    },
  });

  const editForm = useForm<Partial<User>>({
    resolver: zodResolver(insertUserSchema.partial()),
  });

  const passwordResetForm = useForm<{ temporaryPassword: string; confirmPassword: string }>({
    resolver: zodResolver(z.object({
      temporaryPassword: z.string().min(8, "Password must be at least 8 characters"),
      confirmPassword: z.string().min(8, "Password must be at least 8 characters")
    }).refine(data => data.temporaryPassword === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    })),
  });

  const roleManagementForm = useForm<{ role: string; departments: string[]; isActive: boolean }>({
    resolver: zodResolver(z.object({
      role: z.string().min(1, "Role is required"),
      departments: z.array(z.string()),
      isActive: z.boolean()
    })),
  });

  const onSubmit = (data: CreateUserFormData) => {
    const { confirmPassword, ...userData } = data;
    createUserMutation.mutate(userData);
  };

  const onEditSubmit = (data: Partial<User>) => {
    if (managingUser) {
      updateUserMutation.mutate({ id: managingUser.id, ...data });
    }
  };

  const onPasswordResetSubmit = (data: { temporaryPassword: string; confirmPassword: string }) => {
    if (passwordResetUser) {
      passwordResetMutation.mutate({ userId: passwordResetUser.id, temporaryPassword: data.temporaryPassword });
    }
  };

  const onRoleManagementSubmit = (data: { role: string; departments: string[]; isActive: boolean }) => {
    if (managingUser) {
      roleUpdateMutation.mutate({ 
        userId: managingUser.id, 
        updates: data
      });
    }
  };

  // Handle opening the consolidated manage user dialog
  const handleManageUserOpen = (user: User) => {
    setManagingUser(user);
    editForm.reset({
      username: user.username,
      email: user.email,
    });
    roleManagementForm.reset({
      role: user.role,
      departments: user.departments || [],
      isActive: user.isActive ?? true,
    });
  };

  // Get current user info to check role-based permissions
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'developer';
  const isAdmin = currentUser?.role === 'admin';
  const canManageAccess = isSuperAdmin || isAdmin;

  const assignableRoles = isSuperAdmin
    ? availableRoles
    : availableRoles.filter(r => r.value !== 'developer');

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'developer':
        return 'destructive';
      case 'agent':
        return 'default';
      case 'admin':
        return 'secondary';
      case 'field':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'developer':
        return <Shield className="h-4 w-4" />;
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'agent':
        return <UserCheck className="h-4 w-4" />;
      case 'field':
        return <Users className="h-4 w-4" />;
      default:
        return <Users className="h-4 w-4" />;
    }
  };

  // Format role name for display (e.g., "developer" -> "Developer", "my_custom_role" -> "My Custom Role")
  const formatRoleName = (role: string) => {
    if (role === 'developer') return 'Developer';
    if (role === 'admin') return 'Admin';
    if (role === 'agent') return 'Agent';
    return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const activeFilterCount = [
    searchQuery.length > 0,
    departmentFilter !== "all",
    roleFilter !== "all",
  ].filter(Boolean).length;

  const filteredUsers = allUsers.filter((u: User) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesUsername = u.username.toLowerCase().includes(query);
      const matchesEmail = u.email.toLowerCase().includes(query);
      if (!matchesUsername && !matchesEmail) return false;
    }
    if (departmentFilter !== "all") {
      if (departmentFilter === "no-department") {
        if (u.departments && u.departments.length > 0) return false;
      } else {
        if (!u.departments?.includes(departmentFilter)) return false;
      }
    }
    if (roleFilter !== "all") {
      if (u.role !== roleFilter) return false;
    }
    return true;
  });

  // Statistics - dynamically count users per role
  const userStats = {
    total: allUsers.length,
    byRole: availableRoles.reduce((acc, role) => {
      acc[role.value] = allUsers.filter((u: User) => u.role === role.value).length;
      return acc;
    }, {} as Record<string, number>),
  };

  // Define colors for role cards
  const roleCardStyles: Record<string, { iconColor: string; textColor: string; icon: typeof Shield }> = {
    developer: { iconColor: 'text-red-500', textColor: 'text-red-600', icon: Shield },
    admin: { iconColor: 'text-orange-500', textColor: 'text-orange-600', icon: Shield },
    agent: { iconColor: 'text-blue-500', textColor: 'text-blue-600', icon: UserCheck },
  };

  // Default style for custom roles
  const defaultRoleStyle = { iconColor: 'text-purple-500', textColor: 'text-purple-600', icon: Users };

  // Department statistics (based on departments array)
  const departmentStats = {
    ntao: allUsers.filter((u: User) => u.departments?.includes('NTAO')).length,
    assets: allUsers.filter((u: User) => u.departments?.includes('ASSETS')).length,
    inventory: allUsers.filter((u: User) => u.departments?.includes('INVENTORY')).length,
    fleet: allUsers.filter((u: User) => u.departments?.includes('FLEET')).length,
    noDepartment: allUsers.filter((u: User) => !u.departments || u.departments.length === 0).length,
  };

  // Initialize password reset form when user is selected
  const handlePasswordResetOpen = (user: User) => {
    setPasswordResetUser(user);
    passwordResetForm.reset({
      temporaryPassword: "",
      confirmPassword: ""
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={handleBackClick}
            data-testid="button-back"
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground">Manage system users and their permissions</p>
          </div>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={handleCreateDialogChange}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-user">
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300"
                  {...form.register("username")}
                />
                {form.formState.errors.username && (
                  <p className="text-sm text-red-500">{form.formState.errors.username.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="input-email"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-red-500">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={form.watch("role") || "agent"} onValueChange={(value) => form.setValue("role", value)}>
                  <SelectTrigger data-testid="select-role" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map(role => (
                      <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.role && (
                  <p className="text-sm text-red-500">{form.formState.errors.role.message}</p>
                )}
              </div>
              <div>
                <Label>Department Access</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { code: 'NTAO', label: 'NTAO' },
                    { code: 'ASSETS', label: 'Assets' },
                    { code: 'INVENTORY', label: 'Inventory' },
                    { code: 'FLEET', label: 'Fleet' }
                  ].map(dept => (
                    <div key={dept.code} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`dept-${dept.code}`}
                        checked={form.watch("departments")?.includes(dept.code) || false}
                        onChange={(e) => {
                          const currentDepts = form.watch("departments") || [];
                          if (e.target.checked) {
                            form.setValue("departments", [...currentDepts, dept.code]);
                          } else {
                            form.setValue("departments", currentDepts.filter(d => d !== dept.code));
                          }
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        data-testid={`checkbox-dept-${dept.code.toLowerCase()}`}
                      />
                      <Label htmlFor={`dept-${dept.code}`} className="text-sm font-normal">
                        {dept.label}
                      </Label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Select which department queues this user can access
                </p>
                {form.formState.errors.departments && (
                  <p className="text-sm text-red-500">{form.formState.errors.departments.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    data-testid="input-password"
                    className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                    {...form.register("password")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
                {form.formState.errors.password && (
                  <p className="text-sm text-red-500">{form.formState.errors.password.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    data-testid="input-confirm-password"
                    className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                    {...form.register("confirmPassword")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    data-testid="button-toggle-confirm-password"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
                {form.formState.errors.confirmPassword && (
                  <p className="text-sm text-red-500">{form.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => handleCreateDialogChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit-user">
                  {createUserMutation.isPending ? "Creating..." : "Create User"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Role Statistics Cards - Dynamic based on available roles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-users">{userStats.total}</div>
          </CardContent>
        </Card>
        {availableRoles.map((role) => {
          const style = roleCardStyles[role.value] || defaultRoleStyle;
          const IconComponent = style.icon;
          return (
            <Card key={role.value}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{role.label}</CardTitle>
                <IconComponent className={`h-4 w-4 ${style.iconColor}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${style.textColor}`} data-testid={`stat-${role.value}-users`}>
                  {userStats.byRole[role.value] || 0}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Team Access Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>Team Access Overview</CardTitle>
          <CardDescription>Users by department assignment</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium" title="NTAO — National Truck Assortment">NTAO</CardTitle>
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600" data-testid="stat-ntao-users">{departmentStats.ntao}</div>
                <p className="text-xs text-muted-foreground">team members</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Assets</CardTitle>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600" data-testid="stat-assets-users">{departmentStats.assets}</div>
                <p className="text-xs text-muted-foreground">team members</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Inventory</CardTitle>
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600" data-testid="stat-inventory-users">{departmentStats.inventory}</div>
                <p className="text-xs text-muted-foreground">team members</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Fleet</CardTitle>
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600" data-testid="stat-fleet-users">{departmentStats.fleet}</div>
                <p className="text-xs text-muted-foreground">team members</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>
                Manage user accounts and permissions
                {activeFilterCount > 0 && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400 font-medium">
                    ({filteredUsers.length} of {allUsers.length} shown)
                  </span>
                )}
              </CardDescription>
            </div>
          </div>

          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-toggle-filters" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <Badge variant="default" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                      {activeFilterCount}
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setDepartmentFilter("all");
                    setRoleFilter("all");
                  }}
                  data-testid="button-clear-filters"
                  className="text-muted-foreground hover:text-foreground gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </Button>
              )}
            </div>
            <CollapsibleContent className="mt-3">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by username or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-background"
                    data-testid="input-search-users"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      onClick={() => setSearchQuery("")}
                      data-testid="button-clear-search"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground font-medium">Department</Label>
                    <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                      <SelectTrigger className="w-48" data-testid="select-department-filter">
                        <SelectValue placeholder="Filter by department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        <SelectItem value="NTAO" title="NTAO — National Truck Assortment">NTAO</SelectItem>
                        <SelectItem value="ASSETS">Assets</SelectItem>
                        <SelectItem value="INVENTORY">Inventory</SelectItem>
                        <SelectItem value="FLEET">Fleet</SelectItem>
                        <SelectItem value="no-department">No Department</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground font-medium">Role</Label>
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
                      <SelectTrigger className="w-48" data-testid="select-role-filter">
                        <SelectValue placeholder="Filter by role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        {availableRoles.map(role => (
                          <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8">
              <Search className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No users found matching your filters.</p>
              {activeFilterCount > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setDepartmentFilter("all");
                    setRoleFilter("all");
                  }}
                  className="mt-1"
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Departments</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user: User) => (
                  <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                    <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>{user.username}</TableCell>
                    <TableCell data-testid={`text-email-${user.id}`}>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)} className="flex items-center gap-1 w-fit" data-testid={`badge-role-${user.id}`}>
                        {getRoleIcon(user.role)}
                        {formatRoleName(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-departments-${user.id}`}>
                      {user.departments && user.departments.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.departments.map((dept: string) => (
                            <Badge key={dept} variant="secondary" className="text-xs">
                              {dept}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">None</span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-created-${user.id}`}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {user.isActive === false ? (
                        <Badge variant="outline" className="text-red-500 border-red-300">Inactive</Badge>
                      ) : (
                        <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canManageAccess && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePasswordResetOpen(user)}
                            data-testid={`button-reset-password-${user.id}`}
                            title="Reset Password"
                          >
                            <Key className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleManageUserOpen(user)}
                          data-testid={`button-manage-user-${user.id}`}
                          title="Manage User"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        {isSuperAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteUserMutation.mutate(user.id)}
                            className="text-red-600 hover:text-red-700"
                            data-testid={`button-delete-${user.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Consolidated Manage User Dialog - Profile & Access */}
      <Dialog open={!!managingUser} onOpenChange={() => setManagingUser(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Manage User Settings</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Update settings for {managingUser?.username}
            </p>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Profile Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Profile</h3>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="edit-username">Username</Label>
                  <Input
                    id="edit-username"
                    data-testid="input-edit-username"
                    className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300"
                    {...editForm.register("username")}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    data-testid="input-edit-email"
                    className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300"
                    {...editForm.register("email")}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={updateUserMutation.isPending} data-testid="button-update-profile">
                    {updateUserMutation.isPending ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Access Section - Visible to developers and admins */}
            {canManageAccess && (
              <>
                <hr className="border-border" />
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Access Control</h3>
                  <form onSubmit={roleManagementForm.handleSubmit(onRoleManagementSubmit)} className="space-y-4">
                    <div>
                      <Label htmlFor="role">User Role</Label>
                      <Select 
                        value={roleManagementForm.watch("role")} 
                        onValueChange={(value) => roleManagementForm.setValue("role", value)}
                      >
                        <SelectTrigger data-testid="select-manage-role" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableRoles.map(role => (
                            <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Department Access</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Select which department queues this user can access
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { code: 'NTAO', label: 'NTAO' },
                          { code: 'ASSETS', label: 'Assets' },
                          { code: 'INVENTORY', label: 'Inventory' },
                          { code: 'FLEET', label: 'Fleet' }
                        ].map(dept => (
                          <div key={dept.code} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`manage-dept-${dept.code}`}
                              checked={roleManagementForm.watch("departments")?.includes(dept.code) || false}
                              onChange={(e) => {
                                const currentDepts = roleManagementForm.watch("departments") || [];
                                if (e.target.checked) {
                                  roleManagementForm.setValue("departments", [...currentDepts, dept.code]);
                                } else {
                                  roleManagementForm.setValue("departments", currentDepts.filter(d => d !== dept.code));
                                }
                              }}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              data-testid={`checkbox-manage-dept-${dept.code.toLowerCase()}`}
                            />
                            <Label htmlFor={`manage-dept-${dept.code}`} className="text-sm font-normal">
                              {dept.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label>Account Status</Label>
                      <div className="flex items-center space-x-3 mt-2 p-3 rounded-lg border bg-muted/30">
                        <input
                          type="checkbox"
                          id="manage-isActive"
                          checked={roleManagementForm.watch("isActive") ?? true}
                          onChange={(e) => roleManagementForm.setValue("isActive", e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          data-testid="checkbox-is-active"
                        />
                        <div>
                          <Label htmlFor="manage-isActive" className="text-sm font-medium cursor-pointer">
                            Active Account
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Inactive users will not be able to log in
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" disabled={roleUpdateMutation.isPending} data-testid="button-update-access">
                        {roleUpdateMutation.isPending ? "Saving..." : "Save Access"}
                      </Button>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => setManagingUser(null)} data-testid="button-close-manage-user">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Password Reset Dialog */}
      <Dialog open={!!passwordResetUser} onOpenChange={handlePasswordResetDialogChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Reset User Password</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Reset password for {passwordResetUser?.username}. The user will need to log in with the new temporary password.
            </p>
          </DialogHeader>
          <form onSubmit={passwordResetForm.handleSubmit(onPasswordResetSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="temporaryPassword">New Temporary Password</Label>
              <div className="relative">
                <Input
                  id="temporaryPassword"
                  type={showResetPassword ? "text" : "password"}
                  data-testid="input-temporary-password"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                  placeholder="Enter secure temporary password (min 8 characters)"
                  {...passwordResetForm.register("temporaryPassword")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  data-testid="button-toggle-reset-password"
                  aria-label={showResetPassword ? "Hide temporary password" : "Show temporary password"}
                >
                  {showResetPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
              {passwordResetForm.formState.errors.temporaryPassword && (
                <p className="text-sm text-red-500">{passwordResetForm.formState.errors.temporaryPassword.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showResetConfirmPassword ? "text" : "password"}
                  data-testid="input-confirm-password"
                  className="bg-blue-50 border-blue-300 text-blue-900 placeholder:text-blue-500 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100 dark:placeholder:text-blue-300 pr-10"
                  placeholder="Confirm the temporary password"
                  {...passwordResetForm.register("confirmPassword")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                  data-testid="button-toggle-reset-confirm-password"
                  aria-label={showResetConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showResetConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
              {passwordResetForm.formState.errors.confirmPassword && (
                <p className="text-sm text-red-500">{passwordResetForm.formState.errors.confirmPassword.message}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handlePasswordResetDialogChange(false)}
                data-testid="button-cancel-password-reset"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={passwordResetMutation.isPending}
                data-testid="button-confirm-password-reset"
              >
                {passwordResetMutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}