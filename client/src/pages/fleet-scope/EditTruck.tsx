import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useParams, useLocation } from "wouter";
import { type Truck, insertTruckSchema, MAIN_STATUSES, SUB_STATUSES, type MainStatus, REGISTRATION_STICKER_OPTIONS } from "@shared/fleet-scope-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, User, Truck as TruckIcon, Wrench, Package, FileText } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function EditTruck() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === "new";

  const { data: truck, isLoading } = useQuery<Truck>({
    queryKey: ["/api/fs/trucks", id],
    enabled: !isNew,
  });

  const form = useForm({
    resolver: zodResolver(insertTruckSchema),
    defaultValues: {
      truckNumber: "",
      mainStatus: "Research required" as MainStatus,
      subStatus: null as string | null,
      shsOwner: "",
      registrationStickerValid: "",
      datePutInRepair: "",
      repairCompleted: false,
      inAms: false,
      repairAddress: "",
      repairPhone: "",
      contactName: "",
      confirmedDeclinedRepair: "",
      techName: "",
      techPhone: "",
      pickUpSlotBooked: false,
      timeBlockedToPickUpVan: "",
      rentalReturned: false,
      vanPickedUp: false,
      comments: "",
      newTruckAssigned: false,
      registrationRenewalInProcess: false,
      spareVanAssignmentInProcess: false,
      spareVanInProcessToShip: false,
      lastUpdatedBy: "User",
    },
  });

  // Watch main status to update available sub-statuses
  const watchedMainStatus = useWatch({ control: form.control, name: "mainStatus" });
  const availableSubStatuses = watchedMainStatus ? SUB_STATUSES[watchedMainStatus as MainStatus] || [] : [];

  // Update form when truck data is loaded
  useEffect(() => {
    if (truck && !isNew) {
      form.reset({
        truckNumber: truck.truckNumber,
        mainStatus: (truck.mainStatus || "Research required") as MainStatus,
        subStatus: truck.subStatus || null,
        shsOwner: truck.shsOwner || "",
        registrationStickerValid: truck.registrationStickerValid || "",
        datePutInRepair: truck.datePutInRepair || "",
        repairCompleted: truck.repairCompleted || false,
        inAms: truck.inAms || false,
        repairAddress: truck.repairAddress || "",
        repairPhone: truck.repairPhone || "",
        contactName: truck.contactName || "",
        confirmedDeclinedRepair: truck.confirmedDeclinedRepair || "",
        techName: truck.techName || "",
        techPhone: truck.techPhone || "",
        pickUpSlotBooked: truck.pickUpSlotBooked || false,
        timeBlockedToPickUpVan: truck.timeBlockedToPickUpVan || "",
        rentalReturned: truck.rentalReturned || false,
        vanPickedUp: truck.vanPickedUp || false,
        comments: truck.comments || "",
        newTruckAssigned: truck.newTruckAssigned || false,
        registrationRenewalInProcess: truck.registrationRenewalInProcess || false,
        spareVanAssignmentInProcess: truck.spareVanAssignmentInProcess || false,
        spareVanInProcessToShip: truck.spareVanInProcessToShip || false,
        lastUpdatedBy: "User",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truck, isNew]);

  // Reset sub-status when main status changes
  useEffect(() => {
    const currentSubStatus = form.getValues("subStatus");
    const validSubStatuses = SUB_STATUSES[watchedMainStatus as MainStatus] || [];
    
    // If current sub-status is not valid for the new main status, reset it
    if (currentSubStatus && !validSubStatuses.includes(currentSubStatus)) {
      form.setValue("subStatus", null);
    }
  }, [watchedMainStatus, form]);

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (isNew) {
        const res = await apiRequest("POST", "/api/fs/trucks", data);
        return res.json();
      } else {
        // Send full payload - server will compute diff
        const res = await apiRequest("PUT", `/api/fs/trucks/${id}`, data);
        return res.json();
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      
      // Use data.id for new trucks, route param id for updates
      const truckId = isNew ? data.id : id;
      
      // For updates, use truck number from loaded truck; for new, use response data
      const truckNumber = isNew ? data.truckNumber : (truck?.truckNumber || data.truckNumber);
      
      if (data.noChanges) {
        toast({
          title: "No changes made",
          description: "All fields already match the current values.",
        });
      } else {
        toast({
          title: isNew ? "Truck added" : "Truck updated",
          description: `Truck ${truckNumber} has been ${isNew ? "added" : "updated"} successfully.`,
        });
      }
      
      navigate(`/fleet-scope/trucks/${truckId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save truck",
        variant: "destructive",
      });
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    mutation.mutate(data);
  });

  if (isLoading && !isNew) {
    return (
      <div className="bg-background">
        <header className="border-b">
          <div className="container mx-auto px-4 lg:px-6 py-4">
            <Skeleton className="h-8 w-48" />
          </div>
        </header>
        <main className="container mx-auto px-4 lg:px-6 py-6 max-w-2xl">
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex h-16 items-center gap-3">
            <Link href={isNew ? "/fleet-scope" : `/fleet-scope/trucks/${id}`}>
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold">
                {isNew ? "Add New Truck" : `Edit Truck ${truck?.truckNumber}`}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isNew ? "Enter truck repair information" : "Update repair details"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 lg:px-6 py-6 max-w-2xl">
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* SHS Owner */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5" />
                  SHS Owner
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="shsOwner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Owner Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter SHS owner name"
                          data-testid="input-shs-owner"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Van Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TruckIcon className="w-5 h-5" />
                  Van Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="mainStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-main-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {MAIN_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {availableSubStatuses.length > 0 && (
                    <FormField
                      control={form.control}
                      name="subStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sub-Status</FormLabel>
                          <Select 
                            onValueChange={(value) => field.onChange(value === "_none_" ? null : value)} 
                            value={field.value || "_none_"}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-sub-status">
                                <SelectValue placeholder="Select sub-status (optional)" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="_none_">No sub-status</SelectItem>
                              {availableSubStatuses.map((subStatus) => (
                                <SelectItem key={subStatus} value={subStatus}>
                                  {subStatus}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="truckNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Truck Number *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., 46249"
                          className="font-mono"
                          data-testid="input-truck-number"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="registrationStickerValid"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration Sticker Valid</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-registration-sticker-valid">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REGISTRATION_STICKER_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Repair Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5" />
                  Repair Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="datePutInRepair"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Put In Repair *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., 5/19/2025"
                          data-testid="input-date-in-repair"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="repairCompleted"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Completed</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-repair-completed">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="inAms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>AMS Documented</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-in-ams">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="repairAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repair Address</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Enter full repair shop address"
                          rows={2}
                          data-testid="input-repair-address"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="repairPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repair Address Phone</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="(555) 123-4567"
                            className="font-mono"
                            data-testid="input-repair-phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Local Repair Contact Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Contact person"
                            data-testid="input-contact-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="confirmedDeclinedRepair"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmed Declined Repair</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Details about declined repair"
                          data-testid="input-declined-repair"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Pick Up Information */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Pick Up Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="techName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tech Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Technician name" data-testid="input-tech-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="techPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tech Phone Number</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="(555) 123-4567"
                            className="font-mono"
                            data-testid="input-tech-phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="pickUpSlotBooked"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pick Up Slot Booked</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-pickup-slot-booked">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="rentalReturned"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rental Returned</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-rental-returned">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="timeBlockedToPickUpVan"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time Blocked To Pick Up Van</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., 11/28/2025 2:00 PM"
                          data-testid="input-time-blocked-pickup"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vanPickedUp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Van Picked Up</FormLabel>
                      <Select 
                        onValueChange={(value) => field.onChange(value === "yes")} 
                        value={field.value ? "yes" : "no"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-van-picked-up">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Comments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Comments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="comments"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Any comments or notes about this truck"
                          rows={6}
                          data-testid="input-comments"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Additional Options (Legacy fields) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Additional Options</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="newTruckAssigned"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Truck Assigned</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-new-truck-assigned">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="registrationRenewalInProcess"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Registration Renewal In Process</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-registration-renewal">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="spareVanAssignmentInProcess"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Spare Van Assignment In Process</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-spare-van-assignment">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="spareVanInProcessToShip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Spare Van In Process to Ship</FormLabel>
                        <Select 
                          onValueChange={(value) => field.onChange(value === "yes")} 
                          value={field.value ? "yes" : "no"}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-spare-van-ship">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Link href={isNew ? "/fleet-scope" : `/fleet-scope/trucks/${id}`}>
                <Button 
                  variant="outline" 
                  type="button" 
                  disabled={mutation.isPending}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </Link>
              <Button 
                type="submit" 
                disabled={mutation.isPending || isLoading}
                data-testid="button-save"
              >
                {mutation.isPending ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Truck
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </main>
    </div>
  );
}
