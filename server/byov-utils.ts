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
}

export function detectByov(truckNumber: string | null | undefined): boolean {
  return !!truckNumber && truckNumber.startsWith('88');
}

export function getInitialToolsTaskStatus(truckNumber: string | null | undefined): ToolsTaskStatus {
  const isByov = detectByov(truckNumber);
  
  if (isByov) {
    return {
      status: 'ROUTING_RECEIVED',
      routingPath: 'BYOV',
      blockedActions: [],
      isByov: true
    };
  }
  
  return {
    status: 'AWAITING_ROUTING',
    routingPath: null,
    blockedActions: [...BYOV_BLOCKED_ACTIONS],
    isByov: false
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
      isByov: true
    };
  }
  
  if (!fleetTask || fleetTask.status !== 'completed') {
    return {
      status: 'AWAITING_ROUTING',
      routingPath: null,
      blockedActions: [...BYOV_BLOCKED_ACTIONS],
      isByov: false
    };
  }
  
  return {
    status: 'ROUTING_RECEIVED',
    routingPath: fleetTask.fleetRoutingDecision || 'Fleet Routing',
    blockedActions: [],
    isByov: false
  };
}
