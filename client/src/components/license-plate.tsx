import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LicensePlateProps {
  plateNumber: string;
  state?: string;
  renewalDate?: string;
  size?: 'sm' | 'md' | 'lg';
}

type RenewalStatus = 'good' | 'warning' | 'expired' | 'unknown';

function getRenewalStatus(renewalDate?: string): { status: RenewalStatus; daysUntil: number | null; label: string } {
  if (!renewalDate) {
    return { status: 'unknown', daysUntil: null, label: 'No renewal date' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const parts = renewalDate.split('/');
  if (parts.length !== 3) {
    return { status: 'unknown', daysUntil: null, label: 'Invalid date format' };
  }
  
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  
  const renewal = new Date(year, month, day);
  renewal.setHours(0, 0, 0, 0);
  
  const diffTime = renewal.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    return { 
      status: 'expired', 
      daysUntil: diffDays, 
      label: `Expired ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ago` 
    };
  } else if (diffDays <= 30) {
    return { 
      status: 'warning', 
      daysUntil: diffDays, 
      label: diffDays === 0 ? 'Expires today' : `Expires in ${diffDays} day${diffDays === 1 ? '' : 's'}` 
    };
  } else {
    return { 
      status: 'good', 
      daysUntil: diffDays, 
      label: `Valid for ${diffDays} days` 
    };
  }
}

const statusColors: Record<RenewalStatus, { border: string; bg: string; text: string }> = {
  good: {
    border: 'border-green-500',
    bg: 'bg-green-500/10',
    text: 'text-green-700 dark:text-green-400'
  },
  warning: {
    border: 'border-yellow-500',
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-700 dark:text-yellow-400'
  },
  expired: {
    border: 'border-red-500',
    bg: 'bg-red-500/10',
    text: 'text-red-700 dark:text-red-400'
  },
  unknown: {
    border: 'border-blue-500',
    bg: 'bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-400'
  }
};

const sizeClasses = {
  sm: {
    container: 'px-2 py-1',
    text: 'text-xs font-semibold',
    state: 'text-[10px]',
    screw: 'w-1 h-1'
  },
  md: {
    container: 'px-3 py-1.5',
    text: 'text-sm font-bold',
    state: 'text-xs',
    screw: 'w-1.5 h-1.5'
  },
  lg: {
    container: 'px-4 py-2',
    text: 'text-base font-bold',
    state: 'text-sm',
    screw: 'w-2 h-2'
  }
};

export function LicensePlate({ plateNumber, state, renewalDate, size = 'sm' }: LicensePlateProps) {
  const { status, label } = getRenewalStatus(renewalDate);
  const colors = statusColors[status];
  const sizes = sizeClasses[size];
  
  const plateContent = (
    <div 
      className={`
        relative inline-flex flex-col items-center justify-center
        ${sizes.container}
        ${colors.bg}
        border-2 ${colors.border}
        rounded-sm
        min-w-[60px]
      `}
      data-testid="license-plate-frame"
    >
      {/* Corner screws */}
      <div className={`absolute top-0.5 left-0.5 ${sizes.screw} rounded-full bg-gray-400 dark:bg-gray-500`} />
      <div className={`absolute top-0.5 right-0.5 ${sizes.screw} rounded-full bg-gray-400 dark:bg-gray-500`} />
      <div className={`absolute bottom-0.5 left-0.5 ${sizes.screw} rounded-full bg-gray-400 dark:bg-gray-500`} />
      <div className={`absolute bottom-0.5 right-0.5 ${sizes.screw} rounded-full bg-gray-400 dark:bg-gray-500`} />
      
      {/* Plate number */}
      <span className={`${sizes.text} ${colors.text} font-mono tracking-wider`}>
        {plateNumber || 'N/A'}
      </span>
      
      {/* State abbreviation */}
      {state && (
        <span className={`${sizes.state} ${colors.text} opacity-75`}>
          {state}
        </span>
      )}
    </div>
  );
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {plateContent}
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{label}</span>
            {renewalDate && (
              <span className="text-muted-foreground">Renewal: {renewalDate}</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { getRenewalStatus, type RenewalStatus };
