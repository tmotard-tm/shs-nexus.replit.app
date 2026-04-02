import { Button } from "@/components/ui/button";
import { Plus, Home, ChevronLeft } from "lucide-react";
import { Link, useLocation } from "wouter";

interface TopBarProps {
  title: string;
  breadcrumbs?: string[];
  onNewRequest?: () => void;
  isHome?: boolean;
}

export function TopBar({ title, breadcrumbs = ["Home"], onNewRequest, isHome = false }: TopBarProps) {
  const [, setLocation] = useLocation();

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <header className="bg-card border-b border-border sticky top-0 z-30">
      {!isHome && (
        <div className="flex items-center gap-3 px-6 pt-3 pb-0">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-topbar-back"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <span className="text-muted-foreground text-xs">·</span>
          <Link href="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Home className="h-3.5 w-3.5" />
            <span>Nexus</span>
          </Link>
        </div>
      )}
      <div className="flex items-center justify-between px-6 py-4">
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
