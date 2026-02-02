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

  // Filter agents based on department and role
  const getEligibleAgents = () => {
    const filtered = users.filter(user => {
      // Always include developers and admins
      if (user.role === "developer" || user.role === "admin") {
        return true;
      }

      // For agents, check if they have access to this queue module via departments
      if (user.role === "agent" && queueModule) {
        if (user.departments && user.departments.length > 0) {
          const queueModuleMap: Record<QueueModule, string> = {
            ntao: "NTAO",
            assets: "ASSETS", 
            inventory: "INVENTORY",
            fleet: "FLEET",
            tools: "TOOLS"
          };
          return user.departments.includes(queueModuleMap[queueModule]);
        }
        return false;
      }

      // Include agents by default if no specific queue module
      return user.role === "agent";
    });
    
    // Always ensure the current user is included first
    if (currentUser && !filtered.some(u => u.id === currentUser.id)) {
      return [currentUser, ...filtered];
    }
    
    return filtered;
  };

  const eligibleAgents = getEligibleAgents();

  const handlePickUp = () => {
    if (selectedAgentId) {
      onPickUp(selectedAgentId);
      setSelectedAgentId("");
    }
  };

  const handleClose = () => {
    setSelectedAgentId("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-pick-up-request">
        <DialogHeader>
          <DialogTitle>Assign Task</DialogTitle>
          <DialogDescription>
            Select an agent to assign this task to. Only agents with access to this queue are shown.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="agent-select">Assign to Agent</Label>
            <Select 
              value={selectedAgentId} 
              onValueChange={setSelectedAgentId}
            >
              <SelectTrigger id="agent-select" data-testid="select-agent">
                <SelectValue placeholder="Select an agent..." />
              </SelectTrigger>
              <SelectContent>
                {eligibleAgents.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No eligible agents found
                  </SelectItem>
                ) : (
                  eligibleAgents.map(agent => (
                    <SelectItem 
                      key={agent.id} 
                      value={agent.id}
                      data-testid={`select-agent-${agent.id}`}
                    >
                      {agent.username} 
                      {agent.id === currentUser?.id && " (You)"}
                      {agent.role === "developer" && " (Admin)"}
                      {agent.departments && agent.departments.length > 0 && 
                        ` - ${agent.departments.join(", ")}`
                      }
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button 
            variant="outline" 
            onClick={handleClose}
            data-testid="button-cancel-pick-up"
          >
            Cancel
          </Button>
          <Button 
            onClick={handlePickUp}
            disabled={!selectedAgentId || isLoading}
            data-testid="button-confirm-pick-up"
          >
            {isLoading ? "Assigning..." : "Assign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
