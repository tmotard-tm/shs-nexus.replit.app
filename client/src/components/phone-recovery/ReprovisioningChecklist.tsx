import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  Eraser,
  Settings,
  Wifi,
  UserPlus,
  AlertTriangle,
  Loader2,
  Check,
} from "lucide-react";
import type { QueueItem } from "@shared/schema";

interface ReprovisioningChecklistProps {
  taskId: string;
  task: QueueItem;
  onSuccess?: () => void;
}

const PHYSICAL_CONDITIONS = ["Good", "Damaged", "Non-functional"] as const;
const WIPE_METHODS = ["Factory Reset", "Secure Erase", "MDM Remote Wipe"] as const;

const STEPS = [
  { label: "Receive & Inspect", icon: ClipboardCheck },
  { label: "Data Wipe", icon: Eraser },
  { label: "Reprovision", icon: Settings },
  { label: "Reinstate Service", icon: Wifi },
  { label: "Assign to New Hire", icon: UserPlus },
] as const;

function getCompletedSteps(task: QueueItem): boolean[] {
  return [
    !!task.phonePhysicalCondition,
    !!task.phoneDataWipeCompleted,
    !!task.phoneReprovisionCompleted,
    !!task.phoneServiceReinstated,
    !!task.phoneAssignedToNewHire,
  ];
}

export function ReprovisioningChecklist({ taskId, task, onSuccess }: ReprovisioningChecklistProps) {
  const { toast } = useToast();

  const [physicalCondition, setPhysicalCondition] = useState(task.phonePhysicalCondition || "");
  const [conditionNotes, setConditionNotes] = useState(task.phoneConditionNotes || "");
  const [wipeCompleted, setWipeCompleted] = useState(task.phoneDataWipeCompleted || false);
  const [wipeMethod, setWipeMethod] = useState(task.phoneWipeMethod || "");
  const [reprovisionCompleted, setReprovisionCompleted] = useState(task.phoneReprovisionCompleted || false);
  const [carrierLineDetails, setCarrierLineDetails] = useState(task.phoneCarrierLineDetails || "");
  const [serviceReinstated, setServiceReinstated] = useState(task.phoneServiceReinstated || false);
  const [assignedToNewHire, setAssignedToNewHire] = useState(task.phoneAssignedToNewHire || "");
  const [newHireDepartment, setNewHireDepartment] = useState(task.phoneNewHireDepartment || "");

  useEffect(() => {
    setPhysicalCondition(task.phonePhysicalCondition || "");
    setConditionNotes(task.phoneConditionNotes || "");
    setWipeCompleted(task.phoneDataWipeCompleted || false);
    setWipeMethod(task.phoneWipeMethod || "");
    setReprovisionCompleted(task.phoneReprovisionCompleted || false);
    setCarrierLineDetails(task.phoneCarrierLineDetails || "");
    setServiceReinstated(task.phoneServiceReinstated || false);
    setAssignedToNewHire(task.phoneAssignedToNewHire || "");
    setNewHireDepartment(task.phoneNewHireDepartment || "");
  }, [task]);

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue", taskId] });
  };

  const inspectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/phone-recovery/${taskId}/inspect`, {
        physicalCondition,
        conditionNotes: conditionNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateQueries();
      toast({ title: "Inspection saved", description: "Physical condition has been recorded." });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const reprovisionMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/phone-recovery/${taskId}/reprovisioning`, updates);
      return res.json();
    },
    onSuccess: () => {
      invalidateQueries();
      toast({ title: "Progress saved", description: "Reprovisioning checklist updated." });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const writeOffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/phone-recovery/${taskId}/write-off`);
      return res.json();
    },
    onSuccess: () => {
      invalidateQueries();
      toast({ title: "Device written off", description: "This device has been marked as a write-off." });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completedSteps = getCompletedSteps(task);
  const completedCount = completedSteps.filter(Boolean).length;
  const progressPercent = (completedCount / STEPS.length) * 100;
  const isWrittenOff = task.phoneWrittenOff;
  const isPending = inspectMutation.isPending || reprovisionMutation.isPending || writeOffMutation.isPending;
  const showConditionNotes = physicalCondition === "Damaged" || physicalCondition === "Non-functional";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide">
          Reprovisioning Checklist
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {completedCount}/{STEPS.length} complete
        </span>
      </div>

      {isWrittenOff && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm text-amber-700 dark:text-amber-300 font-medium">
            This device has been written off
          </span>
        </div>
      )}

      {task.phoneDateReady && (
        <div className="rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-300">
          Date ready: {new Date(task.phoneDateReady).toLocaleDateString()}
        </div>
      )}

      <div className="relative rounded-lg border bg-white dark:bg-gray-900 p-4">
        <div className="absolute left-[29px] top-8 bottom-8 w-0.5 bg-gray-200 dark:bg-gray-700" />
        <div
          className="absolute left-[29px] top-8 w-0.5 bg-purple-500 transition-all duration-300"
          style={{ height: `${progressPercent * 0.84}%` }}
        />

        <div className="space-y-6 relative">
          {/* Step 1: Receive & Inspect */}
          <div className="flex gap-3">
            <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10 ${
              completedSteps[0]
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            }`}>
              {completedSteps[0] && <Check className="h-3 w-3" />}
            </div>
            <div className="flex-1 space-y-3 -mt-0.5">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">Receive & Inspect</span>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Physical Condition</Label>
                <Select value={physicalCondition} onValueChange={setPhysicalCondition}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select condition..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PHYSICAL_CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showConditionNotes && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500">Condition Notes</Label>
                  <Textarea
                    value={conditionNotes}
                    onChange={(e) => setConditionNotes(e.target.value)}
                    placeholder="Describe the damage or issue..."
                    rows={2}
                    className="text-sm"
                  />
                </div>
              )}
              {physicalCondition === "Non-functional" && !isWrittenOff && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => writeOffMutation.mutate()}
                  disabled={writeOffMutation.isPending}
                >
                  {writeOffMutation.isPending ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing...</>
                  ) : (
                    <><AlertTriangle className="h-3 w-3 mr-1" />Mark as Write-Off</>
                  )}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => inspectMutation.mutate()}
                disabled={!physicalCondition || inspectMutation.isPending}
                className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-600 dark:text-purple-400 dark:hover:bg-purple-950"
              >
                {inspectMutation.isPending ? (
                  <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
                ) : "Save Inspection"}
              </Button>
            </div>
          </div>

          {/* Step 2: Data Wipe */}
          <div className="flex gap-3">
            <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10 ${
              completedSteps[1]
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            }`}>
              {completedSteps[1] && <Check className="h-3 w-3" />}
            </div>
            <div className="flex-1 space-y-3 -mt-0.5">
              <div className="flex items-center gap-2">
                <Eraser className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">Data Wipe</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="wipeCompleted"
                  checked={wipeCompleted}
                  onCheckedChange={(checked) => {
                    const val = checked === true;
                    setWipeCompleted(val);
                    reprovisionMutation.mutate({ phoneDataWipeCompleted: val });
                  }}
                />
                <Label htmlFor="wipeCompleted" className="text-sm cursor-pointer">
                  Data wipe completed
                </Label>
              </div>
              {wipeCompleted && (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500">Wipe Method</Label>
                  <Select
                    value={wipeMethod}
                    onValueChange={(val) => {
                      setWipeMethod(val);
                      reprovisionMutation.mutate({ phoneWipeMethod: val });
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select method..." />
                    </SelectTrigger>
                    <SelectContent>
                      {WIPE_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Reprovision */}
          <div className="flex gap-3">
            <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10 ${
              completedSteps[2]
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            }`}>
              {completedSteps[2] && <Check className="h-3 w-3" />}
            </div>
            <div className="flex-1 space-y-3 -mt-0.5">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">Reprovision</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="reprovisionCompleted"
                  checked={reprovisionCompleted}
                  onCheckedChange={(checked) => {
                    const val = checked === true;
                    setReprovisionCompleted(val);
                    reprovisionMutation.mutate({ phoneReprovisionCompleted: val });
                  }}
                />
                <Label htmlFor="reprovisionCompleted" className="text-sm cursor-pointer">
                  Reprovision completed
                </Label>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Carrier / Line Details</Label>
                <Input
                  value={carrierLineDetails}
                  onChange={(e) => setCarrierLineDetails(e.target.value)}
                  onBlur={() => {
                    if (carrierLineDetails !== (task.phoneCarrierLineDetails || "")) {
                      reprovisionMutation.mutate({ phoneCarrierLineDetails: carrierLineDetails });
                    }
                  }}
                  placeholder="Carrier and line details (optional)"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Step 4: Reinstate Service */}
          <div className="flex gap-3">
            <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10 ${
              completedSteps[3]
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            }`}>
              {completedSteps[3] && <Check className="h-3 w-3" />}
            </div>
            <div className="flex-1 space-y-3 -mt-0.5">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">Reinstate Service</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="serviceReinstated"
                  checked={serviceReinstated}
                  onCheckedChange={(checked) => {
                    const val = checked === true;
                    setServiceReinstated(val);
                    reprovisionMutation.mutate({ phoneServiceReinstated: val });
                  }}
                />
                <Label htmlFor="serviceReinstated" className="text-sm cursor-pointer">
                  Service reinstated
                </Label>
              </div>
            </div>
          </div>

          {/* Step 5: Assign to New Hire */}
          <div className="flex gap-3">
            <div className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10 ${
              completedSteps[4]
                ? "bg-purple-500 border-purple-500 text-white"
                : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            }`}>
              {completedSteps[4] && <Check className="h-3 w-3" />}
            </div>
            <div className="flex-1 space-y-3 -mt-0.5">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium">Assign to New Hire</span>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Assigned To (Name or Employee ID)</Label>
                <Input
                  value={assignedToNewHire}
                  onChange={(e) => setAssignedToNewHire(e.target.value)}
                  onBlur={() => {
                    if (assignedToNewHire !== (task.phoneAssignedToNewHire || "")) {
                      reprovisionMutation.mutate({ phoneAssignedToNewHire: assignedToNewHire });
                    }
                  }}
                  placeholder="Name or employee ID (optional)"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">New Hire Department</Label>
                <Input
                  value={newHireDepartment}
                  onChange={(e) => setNewHireDepartment(e.target.value)}
                  onBlur={() => {
                    if (newHireDepartment !== (task.phoneNewHireDepartment || "")) {
                      reprovisionMutation.mutate({ phoneNewHireDepartment: newHireDepartment });
                    }
                  }}
                  placeholder="Department (optional)"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {isPending && (
        <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
