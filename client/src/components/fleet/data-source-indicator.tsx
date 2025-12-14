import { Badge } from "@/components/ui/badge";

interface DataSources {
  snowflake: boolean;
  tpms: boolean;
  holman: boolean;
}

interface DataSourceIndicatorProps {
  sources?: DataSources;
  showLabels?: boolean;
}

export function DataSourceIndicator({ sources, showLabels = false }: DataSourceIndicatorProps) {
  if (!sources) return null;
  
  return (
    <div className="flex gap-1" title="Data sources">
      <Badge 
        variant={sources.snowflake ? "default" : "outline"} 
        className={`text-xs px-1 ${sources.snowflake ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : ''}`}
      >
        {showLabels ? 'Snowflake' : 'SF'}
      </Badge>
      <Badge 
        variant={sources.tpms ? "default" : "outline"} 
        className={`text-xs px-1 ${sources.tpms ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : ''}`}
      >
        TPMS
      </Badge>
      <Badge 
        variant={sources.holman ? "default" : "outline"} 
        className={`text-xs px-1 ${sources.holman ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : ''}`}
      >
        {showLabels ? 'Holman' : 'H'}
      </Badge>
    </div>
  );
}
