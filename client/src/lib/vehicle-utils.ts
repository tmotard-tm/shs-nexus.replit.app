export interface HolmanStatusInfo {
  code: number;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const HOLMAN_STATUS_MAP: Record<number, HolmanStatusInfo> = {
  0: { 
    code: 0, 
    label: 'New', 
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-300 dark:border-blue-700'
  },
  1: { 
    code: 1, 
    label: 'Active', 
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-300 dark:border-green-700'
  },
  2: { 
    code: 2, 
    label: 'Inactive/Out of Service', 
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    borderColor: 'border-amber-300 dark:border-amber-700'
  },
  3: { 
    code: 3, 
    label: 'Sold', 
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-900/30',
    borderColor: 'border-gray-300 dark:border-gray-700'
  },
  4: { 
    code: 4, 
    label: 'Sold', 
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-900/30',
    borderColor: 'border-gray-300 dark:border-gray-700'
  },
};

export function getHolmanStatus(statusCode: number | string | undefined | null): HolmanStatusInfo {
  const code = typeof statusCode === 'string' ? parseInt(statusCode, 10) : (statusCode ?? 1);
  return HOLMAN_STATUS_MAP[code] || { 
    code, 
    label: 'Unknown', 
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-muted'
  };
}

export type VehicleOwnershipType = 'BYOV' | 'Fleet';

export interface VehicleOwnershipInfo {
  type: VehicleOwnershipType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export function getVehicleOwnership(vehicleNumber: string | undefined | null): VehicleOwnershipInfo {
  if (!vehicleNumber) {
    return {
      type: 'Fleet',
      label: 'Fleet',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-700'
    };
  }

  const normalized = vehicleNumber.replace(/^0+/, '');
  const isBYOV = normalized.startsWith('88');

  if (isBYOV) {
    return {
      type: 'BYOV',
      label: 'BYOV',
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      borderColor: 'border-purple-300 dark:border-purple-700'
    };
  }

  return {
    type: 'Fleet',
    label: 'Fleet',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-300 dark:border-blue-700'
  };
}

export function isBYOV(vehicleNumber: string | undefined | null): boolean {
  if (!vehicleNumber) return false;
  const normalized = vehicleNumber.replace(/^0+/, '');
  return normalized.startsWith('88');
}
