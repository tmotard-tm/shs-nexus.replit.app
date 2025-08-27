import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus } from "lucide-react";

interface TopBarProps {
  title: string;
  breadcrumbs?: string[];
  onNewRequest?: () => void;
}

export function TopBar({ title, breadcrumbs = ["Home"], onNewRequest }: TopBarProps) {
  return (
    <header className="bg-card border-b border-border sticky top-0 z-30">
      <div className="flex items-center justify-between p-6">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-page-title">{title}</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            {breadcrumbs.map((crumb, index) => (
              <span key={index} className="flex items-center gap-2">
                <span data-testid={`text-breadcrumb-${index}`}>{crumb}</span>
                {index < breadcrumbs.length - 1 && <span>•</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="relative" data-testid="button-notifications">
            <Bell className="h-4 w-4" />
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-notification-count"
            >
              3
            </Badge>
          </Button>
          {onNewRequest && (
            <Button onClick={onNewRequest} data-testid="button-new-request">
              <Plus className="h-4 w-4 mr-2" />
              New Request
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
