import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: string;
  color: string;
  change?: string;
  changeLabel?: string;
  testId?: string;
}

export function StatsCard({
  title,
  value,
  icon,
  color,
  change,
  changeLabel,
  testId
}: StatsCardProps) {
  return (
    <Card className="p-6" data-testid={testId}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground" data-testid={`text-${testId}-title`}>
            {title}
          </p>
          <p 
            className={cn("text-3xl font-bold", `text-[hsl(var(--chart-${color}))]`)}
            data-testid={`text-${testId}-value`}
          >
            {value}
          </p>
        </div>
        <div 
          className={cn(
            "w-12 h-12 rounded-lg flex items-center justify-center",
            `bg-[hsl(var(--chart-${color})/.1)]`
          )}
          data-testid={`icon-${testId}`}
        >
          <i className={cn(icon, `text-[hsl(var(--chart-${color}))]`)}></i>
        </div>
      </div>
      {change && changeLabel && (
        <div className="mt-4 flex items-center gap-2">
          <span 
            className={cn(
              "text-xs px-2 py-1 rounded-full",
              `bg-[hsl(var(--chart-${color})/.1)] text-[hsl(var(--chart-${color}))]`
            )}
            data-testid={`text-${testId}-change`}
          >
            {change}
          </span>
          <span className="text-xs text-muted-foreground" data-testid={`text-${testId}-change-label`}>
            {changeLabel}
          </span>
        </div>
      )}
    </Card>
  );
}
