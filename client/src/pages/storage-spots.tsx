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
import { Plus, Edit, Trash2, MapPin, Building, Shield, Clock, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInsertSchema } from "drizzle-zod";
import { storageSpots } from "@shared/schema";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

// Form validation schema
const insertStorageSpotSchema = createInsertSchema(storageSpots).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

type CreateStorageSpotFormData = z.infer<typeof insertStorageSpotSchema>;
type StorageSpot = typeof storageSpots.$inferSelect;

export default function StorageSpots() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSpot, setEditingSpot] = useState<StorageSpot | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch storage spots
  const { data: allStorageSpots = [], isLoading } = useQuery<StorageSpot[]>({
    queryKey: ["/api/storage-spots"],
  });

  // Create storage spot mutation
  const createStorageSpotMutation = useMutation({
    mutationFn: (spotData: CreateStorageSpotFormData) =>
      apiRequest("POST", "/api/storage-spots", spotData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-spots"] });
      setIsCreateOpen(false);
      toast({
        title: "Success",
        description: "Storage spot created successfully.",
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

  // Update storage spot mutation
  const updateStorageSpotMutation = useMutation({
    mutationFn: ({ id, ...spotData }: { id: string } & Partial<StorageSpot>) =>
      apiRequest("PATCH", `/api/storage-spots/${id}`, spotData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-spots"] });
      setEditingSpot(null);
      toast({
        title: "Success",
        description: "Storage spot updated successfully.",
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

  // Delete storage spot mutation
  const deleteStorageSpotMutation = useMutation({
    mutationFn: (spotId: string) =>
      apiRequest("DELETE", `/api/storage-spots/${spotId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-spots"] });
      toast({
        title: "Success",
        description: "Storage spot deleted successfully.",
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
  const createForm = useForm<CreateStorageSpotFormData>({
    resolver: zodResolver(insertStorageSpotSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      status: "open",
      availableSpots: 0,
      totalCapacity: 0,
      notes: "",
      contactInfo: "",
      operatingHours: "",
      facilityType: "outdoor",
      securityLevel: "standard",
      accessInstructions: "",
    },
  });

  const editForm = useForm<CreateStorageSpotFormData>({
    resolver: zodResolver(insertStorageSpotSchema),
  });

  // Filter spots
  const filteredSpots = allStorageSpots.filter(spot => {
    if (statusFilter !== "all" && spot.status !== statusFilter) return false;
    if (stateFilter !== "all" && spot.state !== stateFilter) return false;
    return true;
  });

  // Statistics
  const totalSpots = allStorageSpots.length;
  const openSpots = allStorageSpots.filter(spot => spot.status === "open").length;
  const closedSpots = allStorageSpots.filter(spot => spot.status === "closed").length;
  const maintenanceSpots = allStorageSpots.filter(spot => spot.status === "maintenance").length;
  const totalCapacity = allStorageSpots.reduce((sum, spot) => sum + spot.totalCapacity, 0);
  const totalAvailable = allStorageSpots.reduce((sum, spot) => sum + spot.availableSpots, 0);

  // Unique states for filtering
  const uniqueStates = Array.from(new Set(allStorageSpots.map(spot => spot.state))).sort();

  const onCreateSubmit = (data: CreateStorageSpotFormData) => {
    createStorageSpotMutation.mutate(data);
  };

  const onEditSubmit = (data: CreateStorageSpotFormData) => {
    if (!editingSpot) return;
    updateStorageSpotMutation.mutate({ id: editingSpot.id, ...data });
  };

  const handleEdit = (spot: StorageSpot) => {
    setEditingSpot(spot);
    editForm.reset({
      name: spot.name,
      address: spot.address,
      city: spot.city,
      state: spot.state,
      zipCode: spot.zipCode,
      status: spot.status,
      availableSpots: spot.availableSpots,
      totalCapacity: spot.totalCapacity,
      notes: spot.notes || "",
      contactInfo: spot.contactInfo || "",
      operatingHours: spot.operatingHours || "",
      facilityType: spot.facilityType,
      securityLevel: spot.securityLevel,
      accessInstructions: spot.accessInstructions || "",
    });
  };

  const handleDelete = (spotId: string) => {
    if (confirm("Are you sure you want to delete this storage spot?")) {
      deleteStorageSpotMutation.mutate(spotId);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Open</Badge>;
      case "closed":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100">Closed</Badge>;
      case "maintenance":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">Maintenance</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getFacilityIcon = (facilityType: string) => {
    switch (facilityType) {
      case "indoor":
        return <Building className="h-4 w-4" />;
      case "covered":
        return <Shield className="h-4 w-4" />;
      default:
        return <MapPin className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return <div data-testid="loading-storage-spots">Loading storage spots...</div>;
  }

  return (
    <div className="space-y-6" data-testid="page-storage-spots">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground" data-testid="title-storage-spots">
            Storage Spots Management
          </h1>
          <p className="text-muted-foreground">
            Manage vehicle storage locations and capacity tracking
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-storage-spot">
              <Plus className="h-4 w-4 mr-2" />
              Add Storage Spot
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Storage Spot</DialogTitle>
            </DialogHeader>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    {...createForm.register("name")}
                    placeholder="Downtown Service Center"
                    data-testid="input-create-name"
                  />
                  {createForm.formState.errors.name && (
                    <p className="text-sm text-red-600">{createForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select value={createForm.watch("status")} onValueChange={(value) => createForm.setValue("status", value)}>
                    <SelectTrigger data-testid="select-create-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="address">Address *</Label>
                <Input
                  {...createForm.register("address")}
                  placeholder="123 Main Street"
                  data-testid="input-create-address"
                />
                {createForm.formState.errors.address && (
                  <p className="text-sm text-red-600">{createForm.formState.errors.address.message}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="city">City *</Label>
                  <Input
                    {...createForm.register("city")}
                    placeholder="Chicago"
                    data-testid="input-create-city"
                  />
                  {createForm.formState.errors.city && (
                    <p className="text-sm text-red-600">{createForm.formState.errors.city.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="state">State *</Label>
                  <Input
                    {...createForm.register("state")}
                    placeholder="IL"
                    maxLength={2}
                    data-testid="input-create-state"
                  />
                  {createForm.formState.errors.state && (
                    <p className="text-sm text-red-600">{createForm.formState.errors.state.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="zipCode">ZIP Code *</Label>
                  <Input
                    {...createForm.register("zipCode")}
                    placeholder="60601"
                    data-testid="input-create-zipcode"
                  />
                  {createForm.formState.errors.zipCode && (
                    <p className="text-sm text-red-600">{createForm.formState.errors.zipCode.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="availableSpots">Available Spots</Label>
                  <Input
                    {...createForm.register("availableSpots", { valueAsNumber: true })}
                    type="number"
                    min="0"
                    data-testid="input-create-available-spots"
                  />
                </div>
                <div>
                  <Label htmlFor="totalCapacity">Total Capacity *</Label>
                  <Input
                    {...createForm.register("totalCapacity", { valueAsNumber: true })}
                    type="number"
                    min="1"
                    data-testid="input-create-total-capacity"
                  />
                  {createForm.formState.errors.totalCapacity && (
                    <p className="text-sm text-red-600">{createForm.formState.errors.totalCapacity.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="facilityType">Facility Type</Label>
                  <Select value={createForm.watch("facilityType")} onValueChange={(value) => createForm.setValue("facilityType", value)}>
                    <SelectTrigger data-testid="select-create-facility-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="outdoor">Outdoor</SelectItem>
                      <SelectItem value="indoor">Indoor</SelectItem>
                      <SelectItem value="covered">Covered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="securityLevel">Security Level</Label>
                  <Select value={createForm.watch("securityLevel")} onValueChange={(value) => createForm.setValue("securityLevel", value)}>
                    <SelectTrigger data-testid="select-create-security-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="contactInfo">Contact Information</Label>
                <Input
                  {...createForm.register("contactInfo")}
                  placeholder="Manager: John Smith - (312) 555-0123"
                  data-testid="input-create-contact-info"
                />
              </div>

              <div>
                <Label htmlFor="operatingHours">Operating Hours</Label>
                <Input
                  {...createForm.register("operatingHours")}
                  placeholder="6:00 AM - 10:00 PM"
                  data-testid="input-create-operating-hours"
                />
              </div>

              <div>
                <Label htmlFor="accessInstructions">Access Instructions</Label>
                <Textarea
                  {...createForm.register("accessInstructions")}
                  placeholder="Use keycard at main entrance..."
                  data-testid="textarea-create-access-instructions"
                />
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  {...createForm.register("notes")}
                  placeholder="Additional notes..."
                  data-testid="textarea-create-notes"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createStorageSpotMutation.isPending}
                  data-testid="button-submit-create"
                >
                  {createStorageSpotMutation.isPending ? "Creating..." : "Create Storage Spot"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Storage Spots</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-spots">{totalSpots}</div>
            <p className="text-xs text-muted-foreground">
              Active facilities
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Facilities</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-open-spots">{openSpots}</div>
            <p className="text-xs text-muted-foreground">
              Available for parking
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Capacity</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-capacity">{totalCapacity}</div>
            <p className="text-xs text-muted-foreground">
              Total parking spaces
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Spots</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-available-spots">{totalAvailable}</div>
            <p className="text-xs text-muted-foreground">
              Currently available
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Storage Spots</CardTitle>
          <CardDescription>Filter by status or state to find specific storage locations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="status-filter">Filter by Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label htmlFor="state-filter">Filter by State</Label>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger data-testid="select-state-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {uniqueStates.map(state => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storage Spots Table */}
      <Card>
        <CardHeader>
          <CardTitle>Storage Spots ({filteredSpots.length})</CardTitle>
          <CardDescription>
            Manage all storage facility locations and capacity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Security</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSpots.map((spot) => (
                <TableRow key={spot.id} data-testid={`row-storage-spot-${spot.id}`}>
                  <TableCell>
                    <div className="font-medium">{spot.name}</div>
                    <div className="text-sm text-muted-foreground">{spot.operatingHours}</div>
                  </TableCell>
                  <TableCell>
                    <div>{spot.address}</div>
                    <div className="text-sm text-muted-foreground">
                      {spot.city}, {spot.state} {spot.zipCode}
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(spot.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{spot.availableSpots}</span>
                      <span className="text-muted-foreground">/ {spot.totalCapacity}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {spot.totalCapacity > 0 ? Math.round((spot.availableSpots / spot.totalCapacity) * 100) : 0}% available
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getFacilityIcon(spot.facilityType)}
                      <span className="capitalize">{spot.facilityType}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{spot.securityLevel}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(spot)}
                        data-testid={`button-edit-${spot.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(spot.id)}
                        className="text-red-600 hover:text-red-700"
                        data-testid={`button-delete-${spot.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingSpot} onOpenChange={() => setEditingSpot(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Storage Spot</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  {...editForm.register("name")}
                  placeholder="Downtown Service Center"
                  data-testid="input-edit-name"
                />
                {editForm.formState.errors.name && (
                  <p className="text-sm text-red-600">{editForm.formState.errors.name.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select value={editForm.watch("status")} onValueChange={(value) => editForm.setValue("status", value)}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="address">Address *</Label>
              <Input
                {...editForm.register("address")}
                placeholder="123 Main Street"
                data-testid="input-edit-address"
              />
              {editForm.formState.errors.address && (
                <p className="text-sm text-red-600">{editForm.formState.errors.address.message}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City *</Label>
                <Input
                  {...editForm.register("city")}
                  placeholder="Chicago"
                  data-testid="input-edit-city"
                />
                {editForm.formState.errors.city && (
                  <p className="text-sm text-red-600">{editForm.formState.errors.city.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="state">State *</Label>
                <Input
                  {...editForm.register("state")}
                  placeholder="IL"
                  maxLength={2}
                  data-testid="input-edit-state"
                />
                {editForm.formState.errors.state && (
                  <p className="text-sm text-red-600">{editForm.formState.errors.state.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="zipCode">ZIP Code *</Label>
                <Input
                  {...editForm.register("zipCode")}
                  placeholder="60601"
                  data-testid="input-edit-zipcode"
                />
                {editForm.formState.errors.zipCode && (
                  <p className="text-sm text-red-600">{editForm.formState.errors.zipCode.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="availableSpots">Available Spots</Label>
                <Input
                  {...editForm.register("availableSpots", { valueAsNumber: true })}
                  type="number"
                  min="0"
                  data-testid="input-edit-available-spots"
                />
              </div>
              <div>
                <Label htmlFor="totalCapacity">Total Capacity *</Label>
                <Input
                  {...editForm.register("totalCapacity", { valueAsNumber: true })}
                  type="number"
                  min="1"
                  data-testid="input-edit-total-capacity"
                />
                {editForm.formState.errors.totalCapacity && (
                  <p className="text-sm text-red-600">{editForm.formState.errors.totalCapacity.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="facilityType">Facility Type</Label>
                <Select value={editForm.watch("facilityType")} onValueChange={(value) => editForm.setValue("facilityType", value)}>
                  <SelectTrigger data-testid="select-edit-facility-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outdoor">Outdoor</SelectItem>
                    <SelectItem value="indoor">Indoor</SelectItem>
                    <SelectItem value="covered">Covered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="securityLevel">Security Level</Label>
                <Select value={editForm.watch("securityLevel")} onValueChange={(value) => editForm.setValue("securityLevel", value)}>
                  <SelectTrigger data-testid="select-edit-security-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="contactInfo">Contact Information</Label>
              <Input
                {...editForm.register("contactInfo")}
                placeholder="Manager: John Smith - (312) 555-0123"
                data-testid="input-edit-contact-info"
              />
            </div>

            <div>
              <Label htmlFor="operatingHours">Operating Hours</Label>
              <Input
                {...editForm.register("operatingHours")}
                placeholder="6:00 AM - 10:00 PM"
                data-testid="input-edit-operating-hours"
              />
            </div>

            <div>
              <Label htmlFor="accessInstructions">Access Instructions</Label>
              <Textarea
                {...editForm.register("accessInstructions")}
                placeholder="Use keycard at main entrance..."
                data-testid="textarea-edit-access-instructions"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                {...editForm.register("notes")}
                placeholder="Additional notes..."
                data-testid="textarea-edit-notes"
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setEditingSpot(null)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={updateStorageSpotMutation.isPending}
                data-testid="button-submit-edit"
              >
                {updateStorageSpotMutation.isPending ? "Updating..." : "Update Storage Spot"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}