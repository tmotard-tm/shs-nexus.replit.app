import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { User, QueueModule } from "@shared/schema";

interface PickUpRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPickUp: (agentId: string) => void;
  users: User[];
  queueModule?: QueueModule;
  department?: string;
  isLoading?: boolean;
  currentUser?: User;
}

export function PickUpRequestDialog({
  isOpen,
  onClose,
  onPickUp,
  users,
  queueModule,
  department,
  isLoading = false,
  currentUser,
}: PickUpRequestDialogProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  // Filter agents based on department, queue access, and role
  const getEligibleAgents = () => {
    const filtered = users.filter(user => {
      // Always include superadmins
      if (user.role === "superadmin") {
        return true;
      }

      // If we have a specific queue module, check user's department access
      if (queueModule) {
        if (user.departmentAccess && user.departmentAccess.length > 0) {
          const queueModuleMap: Record<QueueModule, string> = {
            ntao: "NTAO", // National Truck Assortment
            assets: "ASSETS", 
            inventory: "INVENTORY",
            fleet: "FLEET"
          };
          return user.departmentAccess.includes(queueModuleMap[queueModule]);
        }
        
        // Fallback to department-based filtering if no accessibleQueues
        const departmentMap: Record<QueueModule, string> = {
          ntao: "NTAO",
          assets: "Assets Management",
          inventory: "Inventory Control",
          fleet: "Fleet Management"
        };
        
        return user.department === departmentMap[queueModule];
      }

      // If we have a specific department, filter by department
      if (department) {
        return user.department === department;
      }

      // Include all department-based roles by default
      const validRoles = ["assets", "fleet", "inventory", "ntao", "superadmin", "field"];
      return validRoles.includes(user.role);
    });
    
    // Always ensure the current user is included first, even if they don't match filters
    if (currentUser && !filtered.some(u => u.id === currentUser.id)) {
      return [currentUser, ...filtered];
    }
    
    return filtered;
  };

  const eligibleAgents = getEligibleAgents();

  const handlePickUp = () => {
    if (selectedAgentId) {
      onPickUp(selectedAgentId);
      setSelectedAgentId(""); // Reset selection
      // Don't call onClose() immediately - let the assignment success handler close it
    }
  };

  const handleClose = () => {
    setSelectedAgentId(""); // Reset selection when closing
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-pick-up-request">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">Pick Up Request</DialogTitle>
          <DialogDescription data-testid="text-dialog-description">
            Select an agent to assign this request to.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="agent-select" data-testid="label-agent-name">
              Agent Name:
            </Label>
            <Select 
              value={selectedAgentId} 
              onValueChange={setSelectedAgentId}
              disabled={isLoading}
            >
              <SelectTrigger id="agent-select" data-testid="select-agent-name">
                <SelectValue placeholder="Select an agent..." />
              </SelectTrigger>
              <SelectContent data-testid="select-content-agents">
                {eligibleAgents.length === 0 ? (
                  <SelectItem value="no-agents" disabled data-testid="option-no-agents">
                    No eligible agents available
                  </SelectItem>
                ) : (
                  eligibleAgents.map((user) => {
                    const isCurrentUser = currentUser && user.id === currentUser.id;
                    return (
                      <SelectItem 
                        key={user.id} 
                        value={user.id} 
                        data-testid={`option-agent-${user.id}`}
                      >
                        {user.username} {isCurrentUser ? "(You)" : `(${user.department || "No Department"})`}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end space-x-2">
          <Button 
            variant="outline" 
            onClick={handleClose}
            disabled={isLoading}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button 
            onClick={handlePickUp}
            disabled={!selectedAgentId || selectedAgentId === "no-agents" || isLoading}
            data-testid="button-pick-up"
          >
            {isLoading ? "Picking Up..." : "Pick Up"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}