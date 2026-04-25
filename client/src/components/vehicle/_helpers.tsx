import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Check, X } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Truck } from "@shared/fleet-scope-schema";

/**
 * Shared helpers for UniversalVehiclePanel tabs (Phase 2A.2).
 *
 * Mutations target /api/fs/trucks/:id (the FS Repair Tracker).
 * Generalization beyond fs_trucks is a 2B concern.
 */

export type TruckPanelData = Truck & { techAddress?: string };

export type OwnerName =
  | "Oscar S"
  | "Rob A"
  | "Bob B"
  | "John C"
  | "Mandy R"
  | "Final Actioned";

export function determineOwner(truck: Truck): OwnerName {
  const mainStatus = truck.mainStatus || "";
  const subStatus = truck.subStatus || "";
  if (truck.vanPickedUp || mainStatus === "On Road" || subStatus === "Vehicle was sold") {
    return "Final Actioned";
  }
  if (mainStatus === "Confirming Status") return "Oscar S";
  if (mainStatus === "Decision Pending") {
    if (subStatus === "Estimate received, needs review") return "Rob A";
    return "Oscar S";
  }
  if (mainStatus === "Repairing") return "Oscar S";
  if (mainStatus === "Declined Repair" || mainStatus === "PMF") return "Bob B";
  if (mainStatus === "Tags") return "John C";
  if (mainStatus === "Scheduling") return "Mandy R";
  if (mainStatus === "In Transit") return "Oscar S";
  return "Oscar S";
}

export const ownerColors: Record<OwnerName, string> = {
  "Oscar S": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Rob A": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "Bob B": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "John C": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Mandy R": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Final Actioned": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function InfoRow({
  label,
  value,
  icon,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  testId?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1.5" data-testid={testId}>
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">{value}</p>
      </div>
    </div>
  );
}

export function EditableInfoRow({
  label,
  value,
  icon,
  fieldName,
  truckId,
  placeholder,
  testIdPrefix,
}: {
  label: string;
  value: string | null | undefined;
  icon?: React.ReactNode;
  fieldName: string;
  truckId: string;
  placeholder?: string;
  testIdPrefix: string;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value || "");
    setIsEditing(false);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const mutation = useMutation({
    mutationFn: async (newValue: string) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { [fieldName]: newValue });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditing(false);
      toast({ title: `${label} updated` });
    },
    onError: () => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (mutation.isPending) return;
    if (editValue !== (value || "")) {
      mutation.mutate(editValue);
    } else {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value || "");
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  if (isEditing) {
    return (
      <div className="flex items-start gap-2 py-1">
        {icon && <span className="text-muted-foreground mt-2 shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm"
              placeholder={placeholder || `Enter ${label.toLowerCase()}...`}
              disabled={mutation.isPending}
              data-testid={`input-${testIdPrefix}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleSave}
              disabled={mutation.isPending}
              data-testid={`button-save-${testIdPrefix}`}
            >
              <Check className="w-3.5 h-3.5 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleCancel}
              disabled={mutation.isPending}
              data-testid={`button-cancel-${testIdPrefix}`}
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 py-1.5 group cursor-pointer rounded hover:bg-muted/50 px-1 -mx-1"
      onClick={() => setIsEditing(true)}
      data-testid={`editable-${testIdPrefix}`}
    >
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">
          {value || <span className="text-muted-foreground italic">Click to add...</span>}
        </p>
      </div>
      <Pencil className="w-3 h-3 text-muted-foreground invisible group-hover:visible mt-1 shrink-0" />
    </div>
  );
}

export function BoolRow({
  label,
  value,
}: {
  label: string;
  value: boolean | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value === true ? (
        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Yes</span>
      ) : value === false ? (
        <span className="text-xs text-muted-foreground">No</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

export function EditableBoolRow({
  label,
  value,
  icon,
  fieldName,
  truckId,
  testIdPrefix,
}: {
  label: string;
  value: boolean | null | undefined;
  icon?: React.ReactNode;
  fieldName: string;
  truckId: string;
  testIdPrefix: string;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      await apiRequest("PATCH", `/api/fs/trucks/${truckId}`, { [fieldName]: newValue });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks", truckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      setIsEditing(false);
      toast({ title: `${label} updated` });
    },
    onError: () => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, variant: "destructive" });
    },
  });

  if (isEditing) {
    return (
      <div className="flex items-start gap-2 py-1">
        {icon && <span className="text-muted-foreground mt-2 shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1 mt-0.5">
            <Select
              defaultValue={value ? "yes" : "no"}
              onValueChange={(val) => mutation.mutate(val === "yes")}
              disabled={mutation.isPending}
            >
              <SelectTrigger className="h-7 text-sm flex-1" data-testid={`select-${testIdPrefix}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setIsEditing(false)}
              disabled={mutation.isPending}
              data-testid={`button-cancel-${testIdPrefix}`}
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 py-1.5 group cursor-pointer rounded hover:bg-muted/50 px-1 -mx-1"
      onClick={() => setIsEditing(true)}
      data-testid={`editable-${testIdPrefix}`}
    >
      {icon && <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm break-words">
          {value ? (
            <span className="font-semibold text-green-600 dark:text-green-400">Yes</span>
          ) : (
            <span>No</span>
          )}
        </p>
      </div>
      <Pencil className="w-3 h-3 text-muted-foreground invisible group-hover:visible mt-1 shrink-0" />
    </div>
  );
}
