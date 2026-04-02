import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Database, Truck, Users, Plus, Search, Trash2, RefreshCw, AlertCircle, CheckCircle, Edit } from "lucide-react";

const createTruckSchema = z.object({
  name: z.string().min(1, "Name is required"),
  locationId: z.string().min(1, "Location ID is required"),
  description: z.string().optional(),
  subsidiary: z.string().optional(),
  parentLocation: z.string().optional(),
  isActive: z.boolean().default(true),
});

const assignmentSchema = z.object({
  techId: z.string().min(1, "Tech ID is required"),
  truckId: z.string().min(1, "Truck ID is required"),
});

type CreateTruckForm = z.infer<typeof createTruckSchema>;
type AssignmentForm = z.infer<typeof assignmentSchema>;

function parseApiError(err: unknown, fallback: string): string {
  const message = (err instanceof Error ? err.message : String(err)) || "";
  const bodyPart = message.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(bodyPart);
    return parsed?.message || parsed?.error || fallback;
  } catch {
    return bodyPart || fallback;
  }
}

function ConfigStatus() {
  const { isLoading, isError, error } = useQuery<{ success: boolean; data?: any[]; message?: string }>({
    queryKey: ["/api/wms/trucks"],
    retry: false,
  });

  if (isLoading) return null;

  const isNotConfigured =
    isError &&
    (() => {
      const msg = (error instanceof Error ? error.message : String(error)) || "";
      return msg.startsWith("503") || msg.toLowerCase().includes("not configured");
    })();

  if (!isNotConfigured) return null;

  return (
    <Alert className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
      <AlertCircle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-700 dark:text-amber-400">
        <strong>WMS Engine not configured.</strong> Set the{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">WMS_ENGINE_BASE_URL</code> and{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">WMS_ENGINE_TOKEN</code> environment
        variables to enable this integration.
      </AlertDescription>
    </Alert>
  );
}

function TruckLocationsTab() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTruck, setEditTruck] = useState<any | null>(null);

  const form = useForm<CreateTruckForm>({
    resolver: zodResolver(createTruckSchema),
    defaultValues: {
      name: "",
      locationId: "",
      description: "",
      subsidiary: "",
      parentLocation: "",
      isActive: true,
    },
  });

  const editForm = useForm<CreateTruckForm>({
    resolver: zodResolver(createTruckSchema),
    defaultValues: {
      name: "",
      locationId: "",
      description: "",
      subsidiary: "",
      parentLocation: "",
      isActive: true,
    },
  });

  const { data: trucksData, isLoading, refetch } = useQuery<{ success: boolean; data: any[] }>({
    queryKey: ["/api/wms/trucks"],
    retry: false,
  });

  const trucks = trucksData?.success ? (trucksData.data || []) : [];

  const createMutation = useMutation({
    mutationFn: (data: CreateTruckForm) =>
      apiRequest("POST", "/api/wms/trucks", data),
    onSuccess: async (res: any) => {
      const json = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/wms/trucks"] });
      setCreateOpen(false);
      form.reset();
      const netsuiteId = json?.data?.netsuiteId;
      toast({
        title: "Truck location created",
        description: netsuiteId ? `NetSuite ID: ${netsuiteId}` : "Successfully created in NetSuite",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to create truck location"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ truckId, data }: { truckId: string; data: CreateTruckForm }) =>
      apiRequest("POST", `/api/wms/trucks/${encodeURIComponent(truckId)}`, data),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wms/trucks"] });
      setEditTruck(null);
      toast({ title: "Truck location updated" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to update truck location"), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (truckId: string) =>
      apiRequest("DELETE", `/api/wms/trucks/${encodeURIComponent(truckId)}`),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wms/trucks"] });
      toast({ title: "Truck disabled in NetSuite" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to disable truck"), variant: "destructive" });
    },
  });

  function openEdit(truck: any) {
    setEditTruck(truck);
    editForm.reset({
      name: truck.name || "",
      locationId: truck.id || "",
      description: truck.description || "",
      subsidiary: truck.subsidiary || "",
      parentLocation: truck.parentLocation || "",
      isActive: !truck.isInactive,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Truck Locations</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage truck locations in NetSuite via the WMS Engine API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Truck Location
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Truck Location</DialogTitle>
                <DialogDescription>
                  Creates a new truck location in NetSuite. Returns a NetSuite ID upon success.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((data) => createMutation.mutate(data))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Delivery Truck A" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="locationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location ID <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="TRUCK-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Main delivery truck for Zone A" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="subsidiary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subsidiary</FormLabel>
                          <FormControl>
                            <Input placeholder="1093" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="parentLocation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Parent Location</FormLabel>
                          <FormControl>
                            <Input placeholder="Main Warehouse" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel>Active</FormLabel>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Creating..." : "Create"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          Loading trucks...
        </div>
      ) : trucks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
          <Truck className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No truck locations found</p>
          <p className="text-xs mt-1">Create one above to get started</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location ID</TableHead>
                <TableHead>NetSuite ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trucks.map((truck: any, i: number) => (
                <TableRow key={truck.id || truck.truckId || i}>
                  <TableCell className="font-medium">{truck.name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{truck.id || truck.locationId || "—"}</TableCell>
                  <TableCell>{truck.netsuiteId || "—"}</TableCell>
                  <TableCell>
                    {truck.isInactive ? (
                      <Badge variant="secondary">Inactive</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(truck)}
                        title="Edit truck"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending}
                            title="Disable truck in NetSuite"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Disable Truck Location</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will disable{" "}
                              <strong>{truck.name}</strong> in NetSuite, including all inventory
                              associations. This action cannot be undone from Nexus.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() =>
                                deleteMutation.mutate(truck.id || truck.truckId)
                              }
                            >
                              Disable
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editTruck} onOpenChange={(open) => !open && setEditTruck(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Truck Location</DialogTitle>
            <DialogDescription>Update details for {editTruck?.name}</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) =>
                updateMutation.mutate({ truckId: editTruck?.id || editTruck?.truckId, data })
              )}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="locationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location ID <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="subsidiary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subsidiary</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="parentLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent Location</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={editForm.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditTruck(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TechAssignmentsTab() {
  const { toast } = useToast();
  const [lookupTechId, setLookupTechId] = useState("");
  const [lookedUpTech, setLookedUpTech] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [updateTechId, setUpdateTechId] = useState<string | null>(null);

  const assignForm = useForm<AssignmentForm>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: { techId: "", truckId: "" },
  });

  const updateForm = useForm<AssignmentForm>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: { techId: "", truckId: "" },
  });

  const { data: assignmentData, isLoading: lookupLoading, refetch: refetchAssignment } = useQuery<{
    success: boolean;
    data?: any;
    message?: string;
  }>({
    queryKey: ["/api/wms/assignments", lookedUpTech],
    enabled: !!lookedUpTech,
    retry: false,
  });

  const assignment = assignmentData?.success ? assignmentData.data : null;

  function handleLookup() {
    const id = lookupTechId.trim();
    if (!id) return;
    setLookedUpTech(id);
  }

  const createMutation = useMutation({
    mutationFn: (data: AssignmentForm) => apiRequest("POST", "/api/wms/assignments", data),
    onSuccess: async (res: any) => {
      const json = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/wms/assignments"] });
      setAssignOpen(false);
      assignForm.reset();
      if (json?.data?.techId) {
        setLookedUpTech(json.data.techId);
        setLookupTechId(json.data.techId);
      }
      toast({
        title: "Assignment created",
        description: json?.data?.netsuiteId ? `NetSuite ID: ${json.data.netsuiteId}` : "Assignment processed successfully",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to create assignment"), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ techId, data }: { techId: string; data: AssignmentForm }) =>
      apiRequest("PUT", `/api/wms/assignments/${encodeURIComponent(techId)}`, data),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wms/assignments", lookedUpTech] });
      setUpdateTechId(null);
      toast({ title: "Assignment updated" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to update assignment"), variant: "destructive" });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (techId: string) =>
      apiRequest("DELETE", `/api/wms/assignments/${encodeURIComponent(techId)}`),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wms/assignments", lookedUpTech] });
      setLookedUpTech(null);
      setLookupTechId("");
      toast({ title: "Tech unassigned from truck" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to unassign tech"), variant: "destructive" });
    },
  });

  function openUpdate() {
    if (!assignment) return;
    const techId = assignment.techEnterpriseId || lookedUpTech || "";
    const truckId = assignment.name || assignment.id || "";
    setUpdateTechId(techId);
    updateForm.reset({ techId, truckId });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tech Assignments</h2>
          <p className="text-sm text-muted-foreground">
            Assign technicians to truck locations in NetSuite, or look up and manage existing assignments.
          </p>
        </div>
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Assign Tech to Truck
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Tech-to-Truck Assignment</DialogTitle>
              <DialogDescription>
                Assigns a technician to a truck location in NetSuite via the WMS Engine.
              </DialogDescription>
            </DialogHeader>
            <Form {...assignForm}>
              <form
                onSubmit={assignForm.handleSubmit((data) => createMutation.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={assignForm.control}
                  name="techId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tech ID (Enterprise ID) <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="SFESSHA" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={assignForm.control}
                  name="truckId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Truck ID <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="46493" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Assigning..." : "Assign"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Separator />

      <div>
        <h3 className="text-sm font-medium mb-2">Look Up Assignment by Tech ID</h3>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter Tech Enterprise ID"
            value={lookupTechId}
            onChange={(e) => setLookupTechId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={handleLookup} disabled={!lookupTechId.trim()}>
            <Search className="h-4 w-4 mr-1" />
            Look Up
          </Button>
          {lookedUpTech && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLookedUpTech(null);
                setLookupTechId("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {lookedUpTech && (
        <div>
          {lookupLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Looking up assignment for <strong>{lookedUpTech}</strong>...
            </div>
          ) : assignment ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Assignment Found
                    </CardTitle>
                    <CardDescription>Tech: {lookedUpTech}</CardDescription>
                  </div>
                  <Badge className={assignment.isInactive ? "bg-secondary" : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"}>
                    {assignment.isInactive ? "Inactive" : "Active"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {assignment.id && (
                    <>
                      <span className="text-muted-foreground">NetSuite ID</span>
                      <span className="font-mono">{assignment.id}</span>
                    </>
                  )}
                  {assignment.name && (
                    <>
                      <span className="text-muted-foreground">Truck Name</span>
                      <span>{assignment.name}</span>
                    </>
                  )}
                  {assignment.techEnterpriseId && (
                    <>
                      <span className="text-muted-foreground">Tech Enterprise ID</span>
                      <span className="font-mono">{assignment.techEnterpriseId}</span>
                    </>
                  )}
                  {assignment.locationType && (
                    <>
                      <span className="text-muted-foreground">Location Type</span>
                      <span>{assignment.locationType}</span>
                    </>
                  )}
                  {assignment.useBins !== undefined && (
                    <>
                      <span className="text-muted-foreground">Uses Bins</span>
                      <span>{assignment.useBins ? "Yes" : "No"}</span>
                    </>
                  )}
                  {assignment.bins && assignment.bins.length > 0 && (
                    <>
                      <span className="text-muted-foreground">Bins</span>
                      <span>{assignment.bins.map((b: any) => b.binNumber).join(", ")}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchAssignment()}
                    disabled={lookupLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${lookupLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  <Button variant="outline" size="sm" onClick={openUpdate}>
                    <Edit className="h-4 w-4 mr-1" />
                    Update Assignment
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        disabled={unassignMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Unassign
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unassign Tech from Truck</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove the truck assignment for tech{" "}
                          <strong>{lookedUpTech}</strong> in NetSuite. This cannot be undone from Nexus.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => unassignMutation.mutate(lookedUpTech!)}
                        >
                          Unassign
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4 border rounded-lg px-4">
              <AlertCircle className="h-4 w-4" />
              No assignment found for tech <strong className="ml-1">{lookedUpTech}</strong>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!updateTechId} onOpenChange={(open) => !open && setUpdateTechId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Assignment</DialogTitle>
            <DialogDescription>Update the truck assignment for tech {updateTechId}</DialogDescription>
          </DialogHeader>
          <Form {...updateForm}>
            <form
              onSubmit={updateForm.handleSubmit((data) =>
                updateMutation.mutate({ techId: updateTechId!, data })
              )}
              className="space-y-4"
            >
              <FormField
                control={updateForm.control}
                name="techId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tech ID <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={updateForm.control}
                name="truckId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Truck ID <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setUpdateTechId(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Updating..." : "Update Assignment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WmsEngine() {
  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">WMS Engine</h1>
          <Badge variant="outline" className="text-xs">Development</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Standalone interface for the WMS Engine API — manage NetSuite truck locations and
          technician-to-truck assignments. Use case: <code className="text-xs bg-muted px-1 rounded">TECHHUB</code>
        </p>
      </div>

      <ConfigStatus />

      <Tabs defaultValue="trucks">
        <TabsList className="mb-6">
          <TabsTrigger value="trucks" className="gap-2">
            <Truck className="h-4 w-4" />
            Truck Locations
          </TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2">
            <Users className="h-4 w-4" />
            Tech Assignments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trucks">
          <TruckLocationsTab />
        </TabsContent>

        <TabsContent value="assignments">
          <TechAssignmentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
