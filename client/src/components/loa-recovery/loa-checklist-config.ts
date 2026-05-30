// LOA Recovery — checklist item definitions, gate/applies logic

import type { LoaVehicleType, LoaQueueName } from './loa-types';

export interface ChecklistItem {
  id: string;
  queue: LoaQueueName;
  lane: 'manual' | 'auto';
  label: string;
  hint: string | ((vehicle: LoaVehicleType) => string);
  applies: (vehicle: LoaVehicleType) => 'active' | 'na' | 'auto-na';
  gate?: (vehicle: LoaVehicleType, days: number) => { note: string } | null;
}

export const LOA_CHECKLIST: ChecklistItem[] = [
  // ======================== FLEET ========================
  {
    id: 'recover_company',
    queue: 'fleet',
    lane: 'manual',
    label: 'Recover company vehicle (LOA 30+ days)',
    hint: 'Keep under 30 days; recover at Day 30+. Flag vehicle as "LOA recovery" in the fleet system.',
    applies: (v) => v === 'Company' ? 'active' : 'na',
    gate: (v, days) => {
      if (v !== 'Company') return null;
      if (days < 30) return { note: `Keep — recover at Day 30 (${30 - days}d)` };
      return null;
    },
  },
  {
    id: 'return_rental',
    queue: 'fleet',
    lane: 'manual',
    label: 'Return rental vehicle immediately',
    hint: 'Rentals return regardless of LOA length to stop the daily cost.',
    applies: (v) => v === 'Rental' ? 'active' : 'na',
  },
  {
    id: 'byov_na',
    queue: 'fleet',
    lane: 'manual',
    label: 'Mark BYOV vehicle recovery N/A',
    hint: 'No company vehicle to recover — non-vehicle assets still follow the SOP.',
    applies: (v) => v === 'BYOV' ? 'auto-na' : 'na',
  },
  {
    id: 'personal_tools',
    queue: 'fleet',
    lane: 'manual',
    label: 'Confirm technician has removed personal tools',
    hint: "Verify the tech's personal tools are already out of the vehicle (removed at Day 1). If unable for 30+ days, Fleet documents & stores them.",
    applies: (v) => (v === 'Company' || v === 'Rental') ? 'active' : 'na',
  },
  {
    id: 'return_plan',
    queue: 'fleet',
    lane: 'manual',
    label: 'Confirm vehicle available for return',
    hint: "Guarantee a vehicle (or rental) for the tech's Day 1 return. Tech gives 5–7 business days' advance notice.",
    applies: () => 'active',
  },

  // ======================== ASSETS ========================
  {
    id: 'phone_stays',
    queue: 'assets',
    lane: 'manual',
    label: 'Handset stays with technician',
    hint: 'The physical phone remains with the tech during LOA — only the line/plan is suspended.',
    applies: () => 'active',
  },
  {
    id: 'suspend_phone',
    queue: 'assets',
    lane: 'manual',
    label: 'Suspend phone line / cell plan',
    hint: 'Suspend service in both tiers; keep the number reserved.',
    applies: () => 'active',
  },
  {
    id: 'suspend_card',
    queue: 'assets',
    lane: 'manual',
    label: 'Suspend credit card / P-card (LOA 30+ days)',
    hint: 'Keep under 30 days; suspend at 30+.',
    applies: () => 'active',
    gate: (_v, days) => days < 30 ? { note: `Keep — suspend at Day 30 (${30 - days}d)` } : null,
  },

  // ======================== INVENTORY ========================
  {
    id: 'company_tools',
    queue: 'inventory',
    lane: 'manual',
    label: 'Recover company tools / parts',
    hint: (v) =>
      v === 'Rental'
        ? 'Remove and post company tools/parts to the Lawrence, KS facility.'
        : 'Stay in vehicle under 30 days. If the truck is reassigned at 30+, tools merge to the new tech.',
    applies: (v) => (v === 'Company' || v === 'Rental') ? 'active' : 'na',
    gate: (v, days) => (v === 'Company' && days < 30) ? { note: 'Stay in vehicle until recovery' } : null,
  },
  {
    id: 'cancel_orders',
    queue: 'inventory',
    lane: 'auto',
    label: 'Cancel open orders / pending shipments at Day 1',
    hint: 'Cancel in-flight parts orders at LOA start (both tiers).',
    applies: () => 'active',
  },
];

export function itemsForQueue(queue: LoaQueueName): ChecklistItem[] {
  return LOA_CHECKLIST.filter((it) => it.queue === queue);
}

export function activeItemsForQueue(vehicle: LoaVehicleType, queue: LoaQueueName): ChecklistItem[] {
  return itemsForQueue(queue).filter((it) => it.applies(vehicle) === 'active');
}

export function getHint(item: ChecklistItem, vehicle: LoaVehicleType): string {
  return typeof item.hint === 'function' ? item.hint(vehicle) : item.hint;
}
