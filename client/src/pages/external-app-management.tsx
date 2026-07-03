import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EXTERNAL_APPS_KEY } from "@/lib/query-keys";
import { insertExternalAppSchema, type ExternalApp } from "@shared/schema";
import { z } from "zod";

// Form uses the same zod schema as the server insert path so the client and
// server stay in lock-step (https-only url/logoUrl, name required, etc.).
type FormData = z.infer<typeof insertExternalAppSchema>;

export default function ExternalAppManagement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalApp | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExternalApp | null>(null);

  const { data: apps = [], isLoading } = useQuery<ExternalApp[]>({
    queryKey: EXTERNAL_APPS_KEY,
  });

  const sortedApps = [...apps].sort((a, b) => a.sortOrder - b.sortOrder);

  const form = useForm<FormData>({
    resolver: zodResolver(insertExternalAppSchema),
    defaultValues: {
      name: "",
      url: "",
      description: "",
      logoUrl: "",
      icon: "",
      color: "",
      sortOrder: 0,
      isActive: true,
      permissionKey: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      name: "",
      url: "",
      description: "",
      logoUrl: "",
      icon: "",
      color: "",
      sortOrder: apps.length,
      isActive: true,
      permissionKey: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (app: ExternalApp) => {
    setEditing(app);
    form.reset({
      name: app.name,
      url: app.url,
      description: app.description ?? "",
      logoUrl: app.logoUrl ?? "",
      icon: app.icon ?? "",
      color: app.color ?? "",
      sortOrder: app.sortOrder,
      isActive: app.isActive,
      permissionKey: app.permissionKey ?? "",
    });
    setDialogOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: EXTERNAL_APPS_KEY });
  };

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/external-apps", data),
    onSuccess: () => {
      toast({ title: "App created", description: "The launcher tile was added." });
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create app", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
    onSettled: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) =>
      apiRequest("PATCH", `/api/external-apps/${id}`, data),
    onSuccess: () => {
      toast({ title: "App updated", description: "The launcher tile was saved." });
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update app", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
    onSettled: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/external-apps/${id}`),
    onSuccess: () => {
      toast({ title: "App deleted", description: "The launcher tile was removed." });
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete app", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
    onSettled: () => invalidate(),
  });

  const reorderMutation = useMutation({
    mutationFn: (order: { id: string; sortOrder: number }[]) =>
      apiRequest("POST", "/api/external-apps/reorder", order),
    onError: (err: any) => {
      toast({ title: "Failed to reorder", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
    onSettled: () => invalidate(),
  });

  const onSubmit = (data: FormData) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  // Swap this app's sortOrder with its neighbor and persist the full ordering.
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedApps.length) return;
    const reordered = [...sortedApps];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    const order = reordered.map((a, i) => ({ id: a.id, sortOrder: i }));
    reorderMutation.mutate(order);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>App Launcher</CardTitle>
            <CardDescription>
              Manage the external app tiles shown on the dashboard. Tiles open in a new tab.
            </CardDescription>
          </div>
          <Button onClick={openCreate} data-testid="button-add-app">
            <Plus className="h-4 w-4 mr-2" />
            Add App
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : sortedApps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No apps yet. Click "Add App" to create the first launcher tile.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Logo</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedApps.map((app, index) => (
                  <TableRow key={app.id} data-testid={`row-app-${app.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-sm tabular-nums w-6">{app.sortOrder}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === 0 || reorderMutation.isPending}
                          onClick={() => move(index, -1)}
                          data-testid={`button-move-up-${app.id}`}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={index === sortedApps.length - 1 || reorderMutation.isPending}
                          onClick={() => move(index, 1)}
                          data-testid={`button-move-down-${app.id}`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-app-name-${app.id}`}>
                      {app.name}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        data-testid={`link-app-url-${app.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {app.url}
                      </a>
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-xs text-muted-foreground">
                      {app.logoUrl || "-"}
                    </TableCell>
                    <TableCell>
                      {app.isActive ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Hidden</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(app)}
                        data-testid={`button-edit-${app.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteTarget(app)}
                        data-testid={`button-delete-${app.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit App" : "Add App"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update this launcher tile." : "Create a new launcher tile."} URLs must
              start with https://.
            </DialogDescription>
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
                      <Input placeholder="VanGoNow" data-testid="input-name" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" data-testid="input-url" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo URL (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://example.com/logo.png"
                        data-testid="input-logo-url"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        data-testid="input-sort-order"
                        {...field}
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
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
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="mb-0">Active (visible on dashboard)</FormLabel>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-is-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save"
                >
                  {editing ? "Save Changes" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the launcher tile from the dashboard. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
