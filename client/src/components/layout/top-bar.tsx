import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

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
        {onNewRequest && (
          <Button onClick={onNewRequest} data-testid="button-new-request">
            <Plus className="h-4 w-4 mr-2" />
            New Request
          </Button>
        )}
      </div>
    </header>
  );
}
