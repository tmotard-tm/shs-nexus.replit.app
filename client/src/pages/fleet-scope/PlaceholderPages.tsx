import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Search, AlertTriangle } from "lucide-react";

interface PlaceholderProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function PlaceholderPage({ icon, title, description }: PlaceholderProps) {
  return (
    <div className="flex items-center justify-center h-full p-6" data-testid={`page-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div className="flex justify-center">{icon}</div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">Coming Soon</Badge>
      </Card>
    </div>
  );
}

export function TodaysQueue() {
  return (
    <PlaceholderPage
      icon={<ClipboardList className="w-12 h-12 text-muted-foreground" />}
      title="Today's Queue"
      description="Your daily action items across the fleet"
    />
  );
}

export function VehicleSearch() {
  return (
    <PlaceholderPage
      icon={<Search className="w-12 h-12 text-muted-foreground" />}
      title="Vehicle Search"
      description="Find available vehicles by ZIP code and specialty"
    />
  );
}

export function DiscrepancyFinder() {
  return (
    <PlaceholderPage
      icon={<AlertTriangle className="w-12 h-12 text-muted-foreground" />}
      title="Discrepancy Finder"
      description="Identify and resolve status conflicts across systems"
    />
  );
}
