import { fleetScopeStorage } from './fleet-scope-storage';
import { toCanonical } from './vehicle-number-utils';

export const TOOLS_OWNER = {
  id: "joefree.semilla@transformco.com",
  name: "Joefree Semilla"
};

export const BYOV_BLOCKED_ACTIONS = ['issue_qr_codes', 'coordinate_audit'] as const;

export type ByovBlockedAction = typeof BYOV_BLOCKED_ACTIONS[number];

export interface ToolsTaskStatus {
  status: 'ROUTING_RECEIVED' | 'AWAITING_ROUTING';
  routingPath: string | null;
  blockedActions: ByovBlockedAction[];
  isByov: boolean;
  vehicleType: 'company' | 'byov' | 'rental';
}

export function detectByov(truckNumber: string | null | undefined): boolean {
  return !!truckNumber && truckNumber.startsWith('88');
}

export async function detectRental(truckNumber: string | null | undefined): Promise<boolean> {
  if (!truckNumber) return false;
  try {
    const canonical = toCanonical(truckNumber);
    const truck =
      (await fleetScopeStorage.getTruckByNumber(truckNumber)) ||
      (canonical !== truckNumber ? await fleetScopeStorage.getTruckByNumber(canonical) : undefined);
    return !!truck;
  } catch (err: any) {
    console.warn(`[detectRental] Failed to look up truck ${truckNumber} in fs_trucks — defaulting to non-rental:`, err?.message || err);
    return false;
  }
}

export function getInitialToolsTaskStatus(truckNumber: string | null | undefined): ToolsTaskStatus {
  const isByov = detectByov(truckNumber);
  
  if (isByov) {
    return {
      status: 'ROUTING_RECEIVED',
      routingPath: 'BYOV',
      blockedActions: [],
      isByov: true,
      vehicleType: 'byov',
    };
  }
  
  return {
    status: 'AWAITING_ROUTING',
    routingPath: null,
    blockedActions: [...BYOV_BLOCKED_ACTIONS],
    isByov: false,
    vehicleType: 'company',
  };
}

export async function getInitialToolsTaskStatusAsync(truckNumber: string | null | undefined): Promise<ToolsTaskStatus> {
  const isByov = detectByov(truckNumber);
  
  if (isByov) {
    return {
      status: 'ROUTING_RECEIVED',
      routingPath: 'BYOV',
      blockedActions: [],
      isByov: true,
      vehicleType: 'byov',
    };
  }

  const isRental = await detectRental(truckNumber);
  if (isRental) {
    return {
      status: 'AWAITING_ROUTING',
      routingPath: null,
      blockedActions: [...BYOV_BLOCKED_ACTIONS],
      isByov: false,
      vehicleType: 'rental',
    };
  }

  return {
    status: 'AWAITING_ROUTING',
    routingPath: null,
    blockedActions: [...BYOV_BLOCKED_ACTIONS],
    isByov: false,
    vehicleType: 'company',
  };
}

export interface FleetTaskInfo {
  status: string;
  fleetRoutingDecision?: string | null;
}

export async function getToolsTaskCurrentStatus(
  isByov: boolean,
  fleetTask: FleetTaskInfo | undefined
): Promise<ToolsTaskStatus> {
  if (isByov) {
    return {
      status: 'ROUTING_RECEIVED',
      routingPath: 'BYOV',
      blockedActions: [],
      isByov: true,
      vehicleType: 'byov',
    };
  }
  
  if (!fleetTask || fleetTask.status !== 'completed') {
    return {
      status: 'AWAITING_ROUTING',
      routingPath: null,
      blockedActions: [...BYOV_BLOCKED_ACTIONS],
      isByov: false,
      vehicleType: 'company',
    };
  }
  
  return {
    status: 'ROUTING_RECEIVED',
    routingPath: fleetTask.fleetRoutingDecision || 'Fleet Routing',
    blockedActions: [],
    isByov: false,
    vehicleType: 'company',
  };
}
