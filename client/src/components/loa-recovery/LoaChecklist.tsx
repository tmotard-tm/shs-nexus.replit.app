import { CheckCircle2, MinusCircle, Zap, Hand, PauseCircle } from 'lucide-react';
import type { LoaVehicleType, LoaTaskState, LoaQueueName } from './loa-types';
import { itemsForQueue, getHint, type ChecklistItem } from './loa-checklist-config';

// Day-30 recovery actions that are held when the case is paused (return
// confirmed within 7 days of Day 30) — see Task #437.
export const PAUSABLE_TASK_IDS = new Set<string>(['recover_company', 'suspend_card']);

// ---- single checklist item ----
function ChecklistRow({
  item,
  vehicle,
  days,
  checked,
  onToggle,
  recoveryPaused = false,
}: {
  item: ChecklistItem;
  vehicle: LoaVehicleType;
  days: number;
  checked: boolean;
  onToggle: (id: string) => void;
  recoveryPaused?: boolean;
}) {
  const state = item.applies(vehicle);
  const gate = item.gate ? item.gate(vehicle, days) : null;
  const hint = getHint(item, vehicle);

  // When paused, hold the 30-day recovery actions: show them as paused and
  // non-actionable until recovery resumes.
  if (recoveryPaused && state === 'active' && PAUSABLE_TASK_IDS.has(item.id)) {
    return (
      <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
        <span className="w-5 h-5 flex-none flex items-center justify-center mt-0.5">
          <PauseCircle className="w-5 h-5 text-amber-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{item.label}</p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 leading-snug">
            Recovery paused — return confirmed within 7 days of Day 30.
          </p>
        </div>
        <span className="flex-none text-xs font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full self-center whitespace-nowrap">
          Paused
        </span>
      </div>
    );
  }

  if (state === 'na') {
    return (
      <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg opacity-40">
        <span className="w-5 h-5 flex-none flex items-center justify-center text-gray-400 font-bold text-sm mt-0.5">
          —
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 line-through">{item.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            N/A for {vehicle === 'Unknown' ? 'this case' : `${vehicle} vehicle`}
          </p>
        </div>
        <span className="flex-none text-xs font-bold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full self-center">
          N/A
        </span>
      </div>
    );
  }

  if (state === 'auto-na') {
    return (
      <div className="flex items-start gap-3 py-2.5 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
        <div className="w-5 h-5 flex-none rounded bg-gray-500 flex items-center justify-center mt-0.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 line-through">{item.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
        </div>
        <span className="flex-none text-xs font-bold text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full self-center">
          Auto N/A
        </span>
      </div>
    );
  }

  // active item
  const isPending = !!gate;
  return (
    <div
      className={`flex items-start gap-3 py-2.5 px-3 rounded-lg transition-colors ${
        checked
          ? 'bg-green-50 dark:bg-green-950/30'
          : isPending
          ? 'bg-amber-50 dark:bg-amber-950/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <button
        type="button"
        disabled={isPending}
        onClick={() => !isPending && onToggle(item.id)}
        aria-label={item.label}
        className={`w-5 h-5 flex-none rounded border-2 flex items-center justify-center mt-0.5 transition-colors ${
          checked
            ? 'bg-green-600 border-green-600'
            : isPending
            ? 'border-gray-300 bg-white opacity-50 cursor-not-allowed'
            : 'border-gray-400 bg-white hover:border-blue-500 cursor-pointer'
        }`}
      >
        {checked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-semibold ${
            checked ? 'line-through text-gray-400' : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {item.label}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{hint}</p>
      </div>
      {isPending && gate && (
        <span className="flex-none text-xs font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full self-center whitespace-nowrap">
          {gate.note}
        </span>
      )}
    </div>
  );
}

// ---- lane header ----
function LaneHead({ lane }: { lane: 'auto' | 'manual' }) {
  if (lane === 'auto') {
    return (
      <div className="flex items-center gap-2 mb-1.5">
        <Zap className="w-3.5 h-3.5 text-blue-500" />
        <span className="text-xs font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
          Automated
        </span>
        <span className="text-xs font-medium text-gray-400 normal-case tracking-normal">System-driven</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <Hand className="w-3.5 h-3.5 text-orange-500" />
      <span className="text-xs font-bold tracking-wider text-orange-600 dark:text-orange-400 uppercase">
        Manual
      </span>
      <span className="text-xs font-medium text-gray-400 normal-case tracking-normal">Operator action</span>
    </div>
  );
}

// ---- main export ----
export function LoaChecklist({
  vehicle,
  days,
  taskState,
  onToggle,
  queue,
  compact = false,
  recoveryPaused = false,
}: {
  vehicle: LoaVehicleType;
  days: number;
  taskState: LoaTaskState;
  onToggle: (id: string) => void;
  queue: LoaQueueName;
  compact?: boolean;
  recoveryPaused?: boolean;
}) {
  const items = itemsForQueue(queue);
  const autoItems = items.filter((it) => it.lane === 'auto');
  const manualItems = items.filter((it) => it.lane === 'manual');

  const renderLane = (laneItems: ChecklistItem[], lane: 'auto' | 'manual') => {
    if (laneItems.length === 0) return null;
    return (
      <div className="space-y-1">
        <LaneHead lane={lane} />
        {laneItems.map((it) => (
          <ChecklistRow
            key={it.id}
            item={it}
            vehicle={vehicle}
            days={days}
            checked={!!taskState[it.id]}
            onToggle={onToggle}
            recoveryPaused={recoveryPaused}
          />
        ))}
      </div>
    );
  };

  if (compact) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        {autoItems.length > 0 && (
          <div>{renderLane(autoItems, 'auto')}</div>
        )}
        {manualItems.length > 0 && (
          <div>{renderLane(manualItems, 'manual')}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderLane(autoItems, 'auto')}
      {renderLane(manualItems, 'manual')}
    </div>
  );
}
