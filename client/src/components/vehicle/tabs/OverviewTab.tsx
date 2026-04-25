import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Car, FileText, User, Phone, MapPin, Calendar, Clock, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  InfoRow,
  EditableInfoRow,
  EditableBoolRow,
  type TruckPanelData,
} from "@/components/vehicle/_helpers";

interface VehicleInfo {
  vehicleNumber: string;
  vin: string;
  licensePlate: string | null;
}

export function OverviewTab({ truck }: { truck: TruckPanelData }) {
  const { toast } = useToast();
  const [commentValue, setCommentValue] = useState(truck.comments || "");
  const [isEditingComment, setIsEditingComment] = useState(false);

  const { data: allVehiclesData } = useQuery<{ vehicles: VehicleInfo[] }>({
    queryKey: ["/api/fs/all-vehicles"],
  });

  const truckNum = (truck.truckNumber || "").toString().padStart(6, "0");
  const vehicleInfo = allVehiclesData?.vehicles?.find((v) => v.vehicleNumber === truckNum) || null;

  useEffect(() => {
    setCommentValue(truck.comments || "");
    setIsEditingComment(false);
  }, [truck.id, truck.comments]);

  const commentMutation = useMutation({
    mutationFn: async (comments: string) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truck.id}`, { comments });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truck.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditingComment(false);
      toast({ title: "Comments saved" });
    },
    onError: () => {
      toast({ title: "Failed to save comments", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Car className="w-4 h-4 text-muted-foreground" />
          Vehicle Information
        </h3>
        <div className="rounded-md border p-3">
          <div className="grid grid-cols-2 gap-x-4">
            <InfoRow
              label="VIN"
              value={vehicleInfo?.vin || "N/A"}
              icon={<FileText className="w-3.5 h-3.5" />}
              testId="panel-vehicle-vin"
            />
            <InfoRow
              label="License Plate"
              value={vehicleInfo?.licensePlate || "N/A"}
              icon={<Car className="w-3.5 h-3.5" />}
              testId="panel-vehicle-plate"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <User className="w-4 h-4 text-muted-foreground" />
          Tech Information
        </h3>
        <div className="rounded-md border p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <InfoRow label="Tech Name" value={truck.techName} icon={<User className="w-3.5 h-3.5" />} />
            <InfoRow label="Tech Phone" value={truck.techPhone} icon={<Phone className="w-3.5 h-3.5" />} />
            <div className="col-span-2 flex items-start gap-2 py-1.5" data-testid="panel-tech-address">
              <span className="text-muted-foreground mt-0.5 shrink-0">
                <MapPin className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">Tech Address</span>
                {truck.techAddress ? (
                  <p className="text-sm break-words">{truck.techAddress}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No address on file</p>
                )}
              </div>
            </div>
            <InfoRow label="Tech Lead" value={truck.techLeadName} icon={<User className="w-3.5 h-3.5" />} />
            <InfoRow
              label="Tech Lead Phone"
              value={truck.techLeadPhone}
              icon={<Phone className="w-3.5 h-3.5" />}
            />
            {truck.techState && (
              <InfoRow label="State" value={truck.techState} icon={<MapPin className="w-3.5 h-3.5" />} />
            )}
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Pickup Information
        </h3>
        <div className="rounded-md border p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <EditableBoolRow
              label="Pick Up Slot Booked"
              value={truck.pickUpSlotBooked}
              icon={<CheckCircle className="w-3.5 h-3.5" />}
              fieldName="pickUpSlotBooked"
              truckId={truck.id}
              testIdPrefix="panel-pickup-slot"
            />
            <EditableInfoRow
              label="Scheduled Pickup Time"
              value={truck.timeBlockedToPickUpVan}
              icon={<Clock className="w-3.5 h-3.5" />}
              fieldName="timeBlockedToPickUpVan"
              truckId={truck.id}
              placeholder="e.g., 11/28/2025 2:00 PM"
              testIdPrefix="panel-pickup-time"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-muted-foreground" />
          Comments
        </h3>
        <div className="rounded-md border p-3">
          {isEditingComment ? (
            <div className="space-y-2">
              <Textarea
                value={commentValue}
                onChange={(e) => setCommentValue(e.target.value)}
                className="text-sm min-h-[80px] resize-y"
                data-testid="textarea-panel-comments"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCommentValue(truck.comments || "");
                    setIsEditingComment(false);
                  }}
                  data-testid="button-cancel-comment"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => commentMutation.mutate(commentValue)}
                  disabled={commentMutation.isPending}
                  data-testid="button-save-comment"
                >
                  {commentMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="text-sm whitespace-pre-wrap cursor-pointer hover:bg-muted/50 rounded p-1 -m-1 min-h-[32px]"
              onClick={() => setIsEditingComment(true)}
              data-testid="text-panel-comments"
            >
              {truck.comments || (
                <span className="text-muted-foreground italic">Click to add comments...</span>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="text-xs text-muted-foreground">
        Last updated:{" "}
        {truck.lastUpdatedAt ? format(new Date(truck.lastUpdatedAt), "MMM d, yyyy h:mm a") : "—"} by{" "}
        {truck.lastUpdatedBy || "System"}
      </div>
    </div>
  );
}

export function OverviewTabSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
