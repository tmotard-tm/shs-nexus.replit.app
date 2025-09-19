import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { getRoleDisplayName } from "@/lib/role-permissions";

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
      <Select defaultValue={user.role} onValueChange={handleRoleChange} data-testid="select-role" disabled>
        <SelectTrigger className="w-full" data-testid="trigger-role-selector">
          <SelectValue placeholder={getRoleDisplayName(user.role, user)} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={user.role} data-testid={`option-${user.role}`}>
            {getRoleDisplayName(user.role, user)}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
