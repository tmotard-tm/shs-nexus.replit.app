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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Edit, 
  Trash2, 
  FileText, 
  Activity, 
  Database,
  ArrowLeft,
  Power,
  PowerOff,
  Search
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInsertSchema } from "drizzle-zod";
import { templates } from "@shared/schema";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

// Import shared schema for consistency between frontend and backend
import { insertTemplateSchema } from "@shared/schema";

// Form validation schema - extend shared schema with additional frontend validations
const createTemplateSchema = insertTemplateSchema.extend({
  content: z.string().min(1, "Content is required").refine((val) => {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, {
    message: "Content must be valid JSON",
  }),
});

type CreateTemplateFormData = z.infer<typeof createTemplateSchema>;
type Template = typeof templates.$inferSelect;

export default function TemplateManagement() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const handleBackClick = () => {
    setLocation("/");
  };

  // Fetch templates
  const { data: allTemplates = [], isLoading, isError, error } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to fetch templates: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: (templateData: CreateTemplateFormData) =>
      apiRequest("POST", "/api/templates", templateData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setIsCreateOpen(false);
      toast({
        title: "Success",
        description: "Template created successfully.",
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

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, ...templateData }: { id: string } & Partial<Template>) =>
      apiRequest("PATCH", `/api/templates/${id}`, templateData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setEditingTemplate(null);
      toast({
        title: "Success",
        description: "Template updated successfully.",
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

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest("DELETE", `/api/templates/${templateId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      setDeletingTemplate(null);
      toast({
        title: "Success",
        description: "Template deleted successfully.",
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

  // Toggle template status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest("PATCH", `/api/templates/${templateId}/toggle-status`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({
        title: "Success",
        description: "Template status updated successfully.",
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
  const form = useForm<CreateTemplateFormData>({
    resolver: zodResolver(createTemplateSchema),
    defaultValues: {
      name: "",
      department: "",
      workflowType: "",
      version: "",
      content: "",
      isActive: true,
    },
  });

  const editForm = useForm<Partial<Template>>({
    resolver: zodResolver(createTemplateSchema.partial()),
  });

  const onSubmit = (data: CreateTemplateFormData) => {
    createTemplateMutation.mutate(data);
  };

  const onEditSubmit = (data: Partial<Template>) => {
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, ...data });
    }
  };

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    editForm.reset({
      id: template.id,
      name: template.name,
      department: template.department,
      workflowType: template.workflowType,
      version: template.version,
      content: template.content,
      isActive: template.isActive,
    });
  };

  const handleDelete = (template: Template) => {
    setDeletingTemplate(template);
  };

  const confirmDelete = () => {
    if (deletingTemplate) {
      deleteTemplateMutation.mutate(deletingTemplate.id);
    }
  };

  const handleToggleStatus = (template: Template) => {
    toggleStatusMutation.mutate(template.id);
  };

  // Get current user info to check if superadmin
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'superadmin';

  // If not superadmin, show access denied
  if (!isSuperAdmin) {
    return (
      <div className="p-6 space-y-6">
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
            <h1 className="text-3xl font-bold">Template Management</h1>
            <p className="text-muted-foreground">Access Denied</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p>You do not have permission to access template management. Only superadmin users can manage templates.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusBadgeVariant = (isActive: boolean) => {
    return isActive ? 'default' : 'secondary';
  };

  const getDepartmentBadgeVariant = (department: string) => {
    switch (department) {
      case 'NTAO':
        return 'destructive';
      case 'ASSETS':
        return 'default';
      case 'INVENTORY':
        return 'secondary';
      case 'FLEET':
        return 'outline';
      default:
        return 'outline';
    }
  };

  // Filter templates by search, department and status
  const filteredTemplates = allTemplates.filter((template: Template) => {
    const matchesSearch = searchQuery === "" || 
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.workflowType.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesDepartment = departmentFilter === "all" || template.department === departmentFilter;
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "active" && template.isActive) ||
      (statusFilter === "inactive" && !template.isActive);
    
    return matchesSearch && matchesDepartment && matchesStatus;
  });

  // Statistics
  const templateStats = {
    total: allTemplates.length,
    active: allTemplates.filter((t: Template) => t.isActive).length,
    inactive: allTemplates.filter((t: Template) => !t.isActive).length,
  };

  // Department statistics
  const departmentStats = {
    ntao: allTemplates.filter((t: Template) => t.department === 'NTAO').length,
    assets: allTemplates.filter((t: Template) => t.department === 'ASSETS').length,
    inventory: allTemplates.filter((t: Template) => t.department === 'INVENTORY').length,
    fleet: allTemplates.filter((t: Template) => t.department === 'FLEET').length,
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
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
            <h1 className="text-3xl font-bold">Template Management</h1>
            <p className="text-muted-foreground">Loading templates...</p>
          </div>
        </div>
      </div>
    );
  }

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
            <h1 className="text-3xl font-bold">Template Management</h1>
            <p className="text-muted-foreground">Manage workflow templates and their configurations</p>
          </div>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-template">
              <Plus className="mr-2 h-4 w-4" />
              Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create New Template</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-template-name"
                          placeholder="e.g., Assets Onboarding Template"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-department">
                              <SelectValue placeholder="Select department" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ASSETS">Assets</SelectItem>
                            <SelectItem value="FLEET">Fleet</SelectItem>
                            <SelectItem value="INVENTORY">Inventory</SelectItem>
                            <SelectItem value="NTAO">NTAO</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="workflowType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Workflow Type</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-workflow-type"
                            placeholder="e.g., onboarding"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="version"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Version</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-version"
                          placeholder="e.g., 1.0"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Content (JSON)</FormLabel>
                      <FormControl>
                        <Textarea
                          data-testid="textarea-content"
                          placeholder='{"steps": [], "metadata": {}}'
                          className="min-h-[200px] font-mono text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          data-testid="checkbox-is-active"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          Active Template
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    data-testid="button-cancel-create"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createTemplateMutation.isPending}
                    data-testid="button-submit-create"
                  >
                    {createTemplateMutation.isPending ? "Creating..." : "Create Template"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Templates</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-templates">{templateStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Templates</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-active-templates">{templateStats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactive Templates</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-500" data-testid="stat-inactive-templates">{templateStats.inactive}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Department Distribution</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1">
              <div data-testid="stat-ntao-templates">NTAO: {departmentStats.ntao}</div>
              <div data-testid="stat-assets-templates">Assets: {departmentStats.assets}</div>
              <div data-testid="stat-inventory-templates">Inventory: {departmentStats.inventory}</div>
              <div data-testid="stat-fleet-templates">Fleet: {departmentStats.fleet}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates by name, ID, or workflow type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search"
            className="pl-8"
          />
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-department-filter">
            <SelectValue placeholder="Filter by department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            <SelectItem value="ASSETS">Assets</SelectItem>
            <SelectItem value="FLEET">Fleet</SelectItem>
            <SelectItem value="INVENTORY">Inventory</SelectItem>
            <SelectItem value="NTAO">NTAO</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[150px]" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Templates Table */}
      <Card>
        <CardHeader>
          <CardTitle>Templates ({filteredTemplates.length})</CardTitle>
          <CardDescription>
            Manage workflow templates and their configurations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead data-testid="header-id">ID</TableHead>
                <TableHead data-testid="header-name">Name</TableHead>
                <TableHead data-testid="header-department">Department</TableHead>
                <TableHead data-testid="header-workflow-type">Workflow Type</TableHead>
                <TableHead data-testid="header-version">Version</TableHead>
                <TableHead data-testid="header-status">Status</TableHead>
                <TableHead data-testid="header-created-at">Created At</TableHead>
                <TableHead data-testid="header-actions">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTemplates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {searchQuery || departmentFilter !== "all" || statusFilter !== "all" 
                      ? "No templates found matching your filters."
                      : "No templates found. Create your first template to get started."
                    }
                  </TableCell>
                </TableRow>
              ) : (
                filteredTemplates.map((template: Template) => (
                  <TableRow key={template.id} data-testid={`template-row-${template.id}`}>
                    <TableCell className="font-mono text-xs" data-testid={`template-id-${template.id}`}>
                      {template.id}
                    </TableCell>
                    <TableCell data-testid={`template-name-${template.id}`}>
                      {template.name}
                    </TableCell>
                    <TableCell data-testid={`template-department-${template.id}`}>
                      <Badge variant={getDepartmentBadgeVariant(template.department)}>
                        {template.department}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`template-workflow-type-${template.id}`}>
                      {template.workflowType}
                    </TableCell>
                    <TableCell data-testid={`template-version-${template.id}`}>
                      {template.version}
                    </TableCell>
                    <TableCell data-testid={`template-status-${template.id}`}>
                      <Badge variant={getStatusBadgeVariant(template.isActive)}>
                        {template.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`template-created-at-${template.id}`}>
                      {new Date(template.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleStatus(template)}
                          disabled={toggleStatusMutation.isPending}
                          data-testid={`button-toggle-status-${template.id}`}
                          title={template.isActive ? "Deactivate" : "Activate"}
                        >
                          {template.isActive ? (
                            <PowerOff className="h-3 w-3" />
                          ) : (
                            <Power className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(template)}
                          data-testid={`button-edit-${template.id}`}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(template)}
                          data-testid={`button-delete-${template.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Template Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Template ID</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-edit-template-id"
                            disabled
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-edit-template-name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-department">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ASSETS">Assets</SelectItem>
                            <SelectItem value="FLEET">Fleet</SelectItem>
                            <SelectItem value="INVENTORY">Inventory</SelectItem>
                            <SelectItem value="NTAO">NTAO</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="workflowType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Workflow Type</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-edit-workflow-type"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={editForm.control}
                  name="version"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Version</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-edit-version"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Template Content (JSON)</FormLabel>
                      <FormControl>
                        <Textarea
                          data-testid="textarea-edit-content"
                          className="min-h-[200px] font-mono text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          data-testid="checkbox-edit-is-active"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          Active Template
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingTemplate(null)}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={updateTemplateMutation.isPending}
                    data-testid="button-submit-edit"
                  >
                    {updateTemplateMutation.isPending ? "Updating..." : "Update Template"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingTemplate} onOpenChange={(open) => !open && setDeletingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the template 
              "{deletingTemplate?.name}" and all associated configurations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteTemplateMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteTemplateMutation.isPending ? "Deleting..." : "Delete Template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}