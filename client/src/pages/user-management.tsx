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
import { Plus, Edit, Trash2, Shield, Users, UserCheck, Key, Settings, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInsertSchema } from "drizzle-zod";
import { users } from "@shared/schema";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

// Form validation schema
const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
const createUserSchema = insertUserSchema.extend({
  confirmPassword: z.string().min(6),
  departmentAccess: z.array(z.string()).optional(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type CreateUserFormData = z.infer<typeof createUserSchema>;
type User = typeof users.$inferSelect;

export default function UserManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [roleManagementUser, setRoleManagementUser] = useState<User | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
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

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: ({ id, ...userData }: { id: string } & Partial<User>) =>
      apiRequest("PATCH", `/api/users/${id}`, userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingUser(null);
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

  // Admin role management mutation
  const roleUpdateMutation = useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: { role?: string; department?: string; departmentAccess?: string[] } }) =>
      apiRequest("POST", `/api/users/${userId}/update-role`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setRoleManagementUser(null);
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

  // Form setup
  const form = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "field",
      departmentAccess: [],
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

  const roleManagementForm = useForm<{ role: string; department: string | null; departmentAccess: string[] }>({
    resolver: zodResolver(z.object({
      role: z.enum(["superadmin", "agent", "field", "approver", "requester"]),
      department: z.string().nullable(),
      departmentAccess: z.array(z.string())
    })),
  });

  const onSubmit = (data: CreateUserFormData) => {
    const { confirmPassword, ...userData } = data;
    createUserMutation.mutate(userData);
  };

  const onEditSubmit = (data: Partial<User>) => {
    if (editingUser) {
      updateUserMutation.mutate({ id: editingUser.id, ...data });
    }
  };

  const onPasswordResetSubmit = (data: { temporaryPassword: string; confirmPassword: string }) => {
    if (passwordResetUser) {
      passwordResetMutation.mutate({ userId: passwordResetUser.id, temporaryPassword: data.temporaryPassword });
    }
  };

  const onRoleManagementSubmit = (data: { role: string; department: string | null; departmentAccess: string[] }) => {
    if (roleManagementUser) {
      roleUpdateMutation.mutate({ 
        userId: roleManagementUser.id, 
        updates: {
          ...data,
          department: data.department || undefined
        }
      });
    }
  };

  // Get current user info to check if superadmin
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'superadmin';

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'destructive';
      case 'agent':
        return 'default';
      case 'field':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'superadmin':
        return <Shield className="h-4 w-4" />;
      case 'agent':
        return <UserCheck className="h-4 w-4" />;
      case 'field':
        return <Users className="h-4 w-4" />;
      default:
        return <Users className="h-4 w-4" />;
    }
  };

  // Filter users by department
  const filteredUsers = departmentFilter === "all" 
    ? allUsers 
    : departmentFilter === "no-department"
    ? allUsers.filter((u: User) => !u.department)
    : allUsers.filter((u: User) => u.department === departmentFilter);

  // Statistics
  const userStats = {
    total: allUsers.length,
    superadmin: allUsers.filter((u: User) => u.role === 'superadmin').length,
    agent: allUsers.filter((u: User) => u.role === 'agent').length,
    field: allUsers.filter((u: User) => u.role === 'field').length,
  };

  // Department statistics
  const departmentStats = {
    ntao: allUsers.filter((u: User) => u.department === 'NTAO').length,
    assets: allUsers.filter((u: User) => u.department === 'Assets Management').length,
    inventory: allUsers.filter((u: User) => u.department === 'Inventory Control').length,
    fleet: allUsers.filter((u: User) => u.department === 'Fleet Management').length,
    decommissions: allUsers.filter((u: User) => u.department === 'Decommissions').length,
    noDepartment: allUsers.filter((u: User) => !u.department).length,
  };

  // Initialize role management form when user is selected
  const handleRoleManagementOpen = (user: User) => {
    setRoleManagementUser(user);
    roleManagementForm.reset({
      role: user.role as any,
      department: user.department,
      departmentAccess: user.departmentAccess || []
    });
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
                <Select value={form.watch("role") || "agent"} onValueChange={(value) => form.setValue("role", value as "superadmin" | "agent" | "field")}>
                  <SelectTrigger data-testid="select-role" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="superadmin">Super Admin</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="field">Field User</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.role && (
                  <p className="text-sm text-red-500">{form.formState.errors.role.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="department">Department</Label>
                <Select value={form.watch("department") || "forms-only"} onValueChange={(value) => form.setValue("department", value === "forms-only" ? null : value)}>
                  <SelectTrigger data-testid="select-department" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                    <SelectValue placeholder="Select department (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="forms-only">Forms Only</SelectItem>
                    <SelectItem value="NTAO" title="NTAO — National Truck Assortment">NTAO</SelectItem>
                    <SelectItem value="Assets Management">Assets Management</SelectItem>
                    <SelectItem value="Inventory Control">Inventory Control</SelectItem>
                    <SelectItem value="Fleet Management">Fleet Management</SelectItem>
                    <SelectItem value="Decommissions">Decommissions</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.department && (
                  <p className="text-sm text-red-500">{form.formState.errors.department.message}</p>
                )}
              </div>
              <div>
                <Label>Department Access Permissions</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[
                    { code: 'NTAO', label: 'NTAO — National Truck Assortment' },
                    { code: 'ASSETS', label: 'Assets Management' },
                    { code: 'INVENTORY', label: 'Inventory Control' },
                    { code: 'FLEET', label: 'Fleet Management' }
                  ].map(dept => (
                    <div key={dept.code} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`dept-${dept.code}`}
                        checked={form.watch("departmentAccess")?.includes(dept.code) || false}
                        onChange={(e) => {
                          const currentAccess = form.watch("departmentAccess") || [];
                          if (e.target.checked) {
                            form.setValue("departmentAccess", [...currentAccess, dept.code]);
                          } else {
                            form.setValue("departmentAccess", currentAccess.filter(d => d !== dept.code));
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
                  Select which queue departments this user can access
                </p>
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

      {/* Role Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-users">{userStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Super Admins</CardTitle>
            <Shield className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="stat-superadmin-users">{userStats.superadmin}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agents</CardTitle>
            <UserCheck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" data-testid="stat-agent-users">{userStats.agent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Field Users</CardTitle>
            <Users className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-field-users">{userStats.field}</div>
          </CardContent>
        </Card>
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
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>Manage user accounts and permissions</CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="w-48" data-testid="select-department-filter">
                  <SelectValue placeholder="Filter by department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  <SelectItem value="NTAO" title="NTAO — National Truck Assortment">NTAO</SelectItem>
                  <SelectItem value="Assets Management">Assets Management</SelectItem>
                  <SelectItem value="Inventory Control">Inventory Control</SelectItem>
                  <SelectItem value="Fleet Management">Fleet Management</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Queue Access</TableHead>
                  <TableHead>Created</TableHead>
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
                        {user.role === 'superadmin' ? 'Super Admin' : user.role === 'agent' ? 'Agent' : 'Field User'}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-department-${user.id}`}>
                      {user.department ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900 dark:text-blue-100">
                          {user.department}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Forms Only</span>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-queue-access-${user.id}`}>
                      {user.departmentAccess && user.departmentAccess.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.departmentAccess.map((dept: string) => (
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isSuperAdmin && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePasswordResetOpen(user)}
                              data-testid={`button-reset-password-${user.id}`}
                              title="Reset Password"
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRoleManagementOpen(user)}
                              data-testid={`button-manage-role-${user.id}`}
                              title="Manage Role & Access"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingUser(user);
                            editForm.reset({
                              username: user.username,
                              email: user.email,
                              role: user.role,
                              department: user.department,
                            });
                          }}
                          data-testid={`button-edit-${user.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteUserMutation.mutate(user.id)}
                          className="text-red-600 hover:text-red-700"
                          data-testid={`button-delete-${user.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
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
            <div>
              <Label htmlFor="edit-role">Role</Label>
              <Select 
                value={editForm.watch("role")} 
                onValueChange={(value) => editForm.setValue("role", value as "superadmin" | "agent" | "field")}
              >
                <SelectTrigger data-testid="select-edit-role" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">Super Admin</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="field">Field User</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-department">Department</Label>
              <Select 
                value={editForm.watch("department") || "forms-only"} 
                onValueChange={(value) => editForm.setValue("department", value === "forms-only" ? null : value)}
              >
                <SelectTrigger data-testid="select-edit-department" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue placeholder="Select department (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forms-only">Forms Only</SelectItem>
                  <SelectItem value="NTAO" title="NTAO — National Truck Assortment">NTAO</SelectItem>
                  <SelectItem value="Assets Management">Assets Management</SelectItem>
                  <SelectItem value="Inventory Control">Inventory Control</SelectItem>
                  <SelectItem value="Fleet Management">Fleet Management</SelectItem>
                  <SelectItem value="Decommissions">Decommissions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department Access Permissions</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[
                  { code: 'NTAO', label: 'NTAO' },
                  { code: 'ASSETS', label: 'Assets Management' },
                  { code: 'INVENTORY', label: 'Inventory Control' },
                  { code: 'FLEET', label: 'Fleet Management' }
                ].map(dept => (
                  <div key={dept.code} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`edit-dept-${dept.code}`}
                      checked={editForm.watch("departmentAccess")?.includes(dept.code) || false}
                      onChange={(e) => {
                        const currentAccess = editForm.watch("departmentAccess") || [];
                        if (e.target.checked) {
                          editForm.setValue("departmentAccess", [...currentAccess, dept.code]);
                        } else {
                          editForm.setValue("departmentAccess", currentAccess.filter(d => d !== dept.code));
                        }
                      }}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      data-testid={`checkbox-edit-dept-${dept.code.toLowerCase()}`}
                    />
                    <Label htmlFor={`edit-dept-${dept.code}`} className="text-sm font-normal">
                      {dept.label}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Select which queue departments this user can access
              </p>
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateUserMutation.isPending} data-testid="button-update-user">
                {updateUserMutation.isPending ? "Updating..." : "Update User"}
              </Button>
            </div>
          </form>
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

      {/* Admin Role Management Dialog */}
      <Dialog open={!!roleManagementUser} onOpenChange={() => setRoleManagementUser(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Manage User Role & Access</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Update role and department access for {roleManagementUser?.username}
            </p>
          </DialogHeader>
          <form onSubmit={roleManagementForm.handleSubmit(onRoleManagementSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="role">User Role</Label>
              <Select 
                value={roleManagementForm.watch("role")} 
                onValueChange={(value) => roleManagementForm.setValue("role", value as any)}
              >
                <SelectTrigger data-testid="select-manage-role" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">Super Admin</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="field">Field User</SelectItem>
                  <SelectItem value="approver">Approver</SelectItem>
                  <SelectItem value="requester">Requester</SelectItem>
                </SelectContent>
              </Select>
              {roleManagementForm.formState.errors.role && (
                <p className="text-sm text-red-500">{roleManagementForm.formState.errors.role.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="department">Primary Department</Label>
              <Select 
                value={roleManagementForm.watch("department") || "forms-only"} 
                onValueChange={(value) => roleManagementForm.setValue("department", value === "forms-only" ? null : value)}
              >
                <SelectTrigger data-testid="select-manage-department" className="bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-100">
                  <SelectValue placeholder="Select primary department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forms-only">Forms Only</SelectItem>
                  <SelectItem value="NTAO" title="NTAO — National Truck Assortment">NTAO</SelectItem>
                  <SelectItem value="Assets Management">Assets Management</SelectItem>
                  <SelectItem value="Inventory Control">Inventory Control</SelectItem>
                  <SelectItem value="Fleet Management">Fleet Management</SelectItem>
                  <SelectItem value="Decommissions">Decommissions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Queue Access Permissions</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select which queues this user can access and work on
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { code: 'NTAO', label: 'NTAO' },
                  { code: 'ASSETS', label: 'Assets Management' },
                  { code: 'INVENTORY', label: 'Inventory Control' },
                  { code: 'FLEET', label: 'Fleet Management' }
                ].map(dept => (
                  <div key={dept.code} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`manage-dept-${dept.code}`}
                      checked={roleManagementForm.watch("departmentAccess")?.includes(dept.code) || false}
                      onChange={(e) => {
                        const currentAccess = roleManagementForm.watch("departmentAccess") || [];
                        if (e.target.checked) {
                          roleManagementForm.setValue("departmentAccess", [...currentAccess, dept.code]);
                        } else {
                          roleManagementForm.setValue("departmentAccess", currentAccess.filter(d => d !== dept.code));
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
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoleManagementUser(null)}
                data-testid="button-cancel-role-management"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={roleUpdateMutation.isPending}
                data-testid="button-confirm-role-management"
              >
                {roleUpdateMutation.isPending ? "Updating..." : "Update Role & Access"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}