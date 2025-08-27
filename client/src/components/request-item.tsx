import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Request } from "@shared/schema";
import { ChevronRight } from "lucide-react";

interface RequestItemProps {
  request: Request & { requesterName?: string };
  onView?: (request: Request) => void;
}

const statusColors = {
  pending: "1", // chart-1 orange
  approved: "2", // chart-2 green
  denied: "destructive",
};

const typeIcons = {
  api_access: "fas fa-file-alt",
  snowflake_query: "fas fa-database",
  system_config: "fas fa-cog",
  user_permission: "fas fa-key",
};

export function RequestItem({ request, onView }: RequestItemProps) {
  const getStatusColor = (status: string) => {
    return statusColors[status as keyof typeof statusColors] || "secondary";
  };

  const getTypeIcon = (type: string) => {
    return typeIcons[type as keyof typeof typeIcons] || "fas fa-file-alt";
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Less than an hour ago";
    if (diffInHours === 1) return "1 hour ago";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  return (
    <div 
      className="flex items-center justify-between p-4 border border-border rounded-lg"
      data-testid={`request-item-${request.id}`}
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center">
          <i className={`${getTypeIcon(request.type)} text-secondary-foreground`}></i>
        </div>
        <div>
          <p className="font-medium" data-testid={`text-title-${request.id}`}>
            {request.title}
          </p>
          <p className="text-sm text-muted-foreground" data-testid={`text-meta-${request.id}`}>
            {request.requesterName || "Unknown"} • {formatTimeAgo(request.createdAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge 
          variant={getStatusColor(request.status) === "destructive" ? "destructive" : "secondary"}
          className={
            getStatusColor(request.status) !== "destructive" 
              ? `bg-[hsl(var(--chart-${getStatusColor(request.status)})/.1)] text-[hsl(var(--chart-${getStatusColor(request.status)}))]`
              : ""
          }
          data-testid={`badge-status-${request.id}`}
        >
          {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onView?.(request)}
          data-testid={`button-view-${request.id}`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
