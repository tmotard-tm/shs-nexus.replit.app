import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

interface RoleSelectorProps {
  onRoleChange?: (role: string) => void;
}

export function RoleSelector({ onRoleChange }: RoleSelectorProps) {
  const { user } = useAuth();

  const handleRoleChange = (role: string) => {
    onRoleChange?.(role);
  };

  if (!user) return null;

  return (
    <div className="mb-6">
      <Label className="text-sm font-medium text-muted-foreground mb-2 block">
        Current Role
      </Label>
      <Select defaultValue={user.role} onValueChange={handleRoleChange} data-testid="select-role">
        <SelectTrigger className="w-full" data-testid="trigger-role-selector">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin" data-testid="option-admin">Administrator</SelectItem>
          <SelectItem value="requester" data-testid="option-requester">Requester</SelectItem>
          <SelectItem value="approver" data-testid="option-approver">Approver</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
