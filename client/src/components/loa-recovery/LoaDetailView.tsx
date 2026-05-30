import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CombinedQueueItem } from '@shared/schema';
import type { LoaQueueName, LoaTaskState } from './loa-types';
import {
  parseLoaData,
  inferVehicleType,
  daysOnLoa,
  LOA_QUEUE_META,
  type LoaVehicleType,
} from './loa-types';
import { activeItemsForQueue } from './loa-checklist-config';
import { LoaChecklist } from './LoaChecklist';

// ---- small helpers ----
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-xs font-semibold text-gray-500 flex-none pt-0.5">{label}</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 text-right flex items-center gap-1">
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-bold tracking-wider text-gray-500 uppercase">{children}</span>
      {right}
    </div>
  );
}

function InfoCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

// ---- vehicle type pill ----
const VEHICLE_COLORS: Record<LoaVehicleType, string> = {
  Company: 'border-blue-500 text-blue-700 dark:text-blue-400',
  Rental:  'border-purple-500 text-purple-700 dark:text-purple-400',
  BYOV:    'border-green-500 text-green-700 dark:text-green-400',
  Unknown: 'border-gray-400 text-gray-500',
};
const VEHICLE_DESC: Record<LoaVehicleType, string> = {
  Company: 'Company-owned fleet vehicle. Keep under 30 days; recover at Day 30+.',
  Rental:  'Rental vehicle. Return immediately regardless of LOA length; post tools to Lawrence, KS.',
  BYOV:    'Bring-Your-Own-Vehicle. No vehicle recovery; non-vehicle assets follow the SOP.',
  Unknown: 'Vehicle type not yet confirmed. Determine before proceeding.',
};

function VehiclePill({ type }: { type: LoaVehicleType }) {
  return (
    <span className={`inline-block border rounded-full px-3 py-0.5 text-sm font-bold bg-white dark:bg-gray-900 ${VEHICLE_COLORS[type]}`}>
      {type}
    </span>
  );
}

// ---- status pill ----
const STATUS_STYLE: Record<string, string> = {
  'Open':        'bg-gray-100 text-gray-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Paused':      'bg-amber-100 text-amber-700',
  'Closed':      'bg-green-100 text-green-700',
};
function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[status] || STATUS_STYLE['Open']}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

// ---- progress ring ----
function ProgressRing({ done, total, color }: { done: number; total: number; color: string }) {
  const r = 22, circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  return (
    <div className="flex items-center gap-2">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#E5E7EB" strokeWidth="6" />
        <circle
          cx="28" cy="28" r={r} fill="none"
          stroke={done === total && total > 0 ? '#16a34a' : color}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset .3s ease' }}
        />
      </svg>
      <div>
        <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100 leading-none">{done}/{total}</div>
        <div className="text-xs text-gray-500 font-semibold">tasks done</div>
      </div>
    </div>
  );
}

// ---- cross-queue strip ----
function CrossQueueStrip({
  item,
  allItems,
  queue,
  taskStates,
}: {
  item: CombinedQueueItem;
  allItems: CombinedQueueItem[];
  queue: LoaQueueName;
  taskStates: Record<string, LoaTaskState>;
}) {
  const siblings = allItems.filter(
    (i) => i.workflowId && i.workflowId === item.workflowId && i.id !== item.id
  );
  if (siblings.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-700">
      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">This case also spans:</span>
      {siblings.map((sib) => {
        const sibQueue = sib.module as LoaQueueName;
        const meta = LOA_QUEUE_META[sibQueue];
        if (!meta) return null;
        const sibVehicle = inferVehicleType(sib);
        const act = activeItemsForQueue(sibVehicle, sibQueue);
        const sibState = taskStates[sib.id] || {};
        const done = act.filter((it) => sibState[it.id]).length;
        return (
          <span
            key={sib.id}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1 rounded-full"
          >
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: meta.color }} />
            {meta.short}
            <strong className={done === act.length && act.length > 0 ? 'text-green-600' : 'text-gray-500'}>
              {done}/{act.length}
            </strong>
          </span>
        );
      })}
    </div>
  );
}

// ---- SOP timeline (read-only) ----
function SopTimeline({ accentColor }: { accentColor: string }) {
  const steps = [
    { when: '3 working days before start', what: 'Notify Inventory & Assets teams (dates, duration, return).' },
    { when: 'Pre Day 1', what: 'Send LOA letter to tech via email + SMS reminder.' },
    { when: 'Day 1', what: 'Tech removes personal tools. If LOA >30d, vehicle recovery initiated.' },
    { when: 'Ongoing', what: 'Monitor return-date changes. Pause recovery if return is within 7d of Day 30.' },
    { when: '3 working days before end', what: 'Notify teams of confirmed return; restore assets by Day 1 back.' },
  ];
  return (
    <InfoCard>
      <SectionTitle>SOP Timeline</SectionTitle>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="w-3 h-3 rounded-full flex-none mt-0.5" style={{ background: accentColor }} />
              {i < steps.length - 1 && <span className="w-0.5 flex-1 mt-1" style={{ background: '#E5E7EB' }} />}
            </div>
            <div className="pb-2">
              <div className="text-xs font-bold text-gray-800 dark:text-gray-200">{s.when}</div>
              <div className="text-xs text-gray-500 leading-snug mt-0.5">{s.what}</div>
            </div>
          </li>
        ))}
      </ol>
    </InfoCard>
  );
}

// ======================== MAIN COMPONENT ========================
export function LoaDetailView({
  item,
  queue,
  allItems,
}: {
  item: CombinedQueueItem;
  queue: LoaQueueName;
  allItems: CombinedQueueItem[];
}) {
  const { toast } = useToast();
  const data = parseLoaData(item);
  const meta = LOA_QUEUE_META[queue];

  // Local state for interactive fields
  const [vehicle, setVehicle] = useState<LoaVehicleType>(inferVehicleType(item));
  const [status, setStatus] = useState(item.status === 'pending' ? 'Open' : item.status === 'in_progress' ? 'In Progress' : item.status === 'completed' ? 'Closed' : 'Open');
  const [taskState, setTaskState] = useState<LoaTaskState>(() => {
    return data?.loaTasks || {};
  });
  const [notes, setNotes] = useState(item.notes || '');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Task states for cross-queue strip — need per-item states from all LOA items
  // We simplify by using each item's data.loaTasks directly from the allItems prop
  const taskStates: Record<string, LoaTaskState> = {};
  allItems.forEach((i) => {
    const d = parseLoaData(i);
    taskStates[i.id] = d?.loaTasks || {};
  });
  taskStates[item.id] = taskState; // current item uses local state

  // Mutation for persisting changes
  const updateMutation = useMutation({
    mutationFn: async (patch: {
      loaTasks?: LoaTaskState;
      status?: string;
      vehicleTypeOverride?: LoaVehicleType;
      notes?: string;
    }) => {
      const res = await apiRequest('PATCH', `/api/loa-recovery/${item.id}/update`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/queues'] });
    },
    onError: () => {
      toast({ title: 'Save failed', description: 'Could not save changes. Please try again.', variant: 'destructive' });
    },
  });

  const onToggleTask = useCallback(
    (id: string) => {
      setTaskState((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        updateMutation.mutate({ loaTasks: next });
        return next;
      });
    },
    [updateMutation],
  );

  const onStatusChange = (s: string) => {
    setStatus(s);
    const apiStatus = s === 'Open' ? 'pending' : s === 'In Progress' ? 'in_progress' : s === 'Closed' ? 'completed' : 'pending';
    updateMutation.mutate({ status: apiStatus });
  };

  const onVehicleOverride = (v: string) => {
    const vt = v as LoaVehicleType;
    setVehicle(vt);
    updateMutation.mutate({ vehicleTypeOverride: vt });
  };

  const onNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotes(val);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      updateMutation.mutate({ notes: val });
    }, 800);
  };

  const days = daysOnLoa(data?.leave?.startDate);
  const activeItems = activeItemsForQueue(vehicle, queue);
  const doneTasks = activeItems.filter((it) => taskState[it.id]).length;

  // ---- cards ----
  const loaDetailsCard = (
    <InfoCard>
      <SectionTitle>LOA Details</SectionTitle>
      <Field label="Enterprise ID">
        <code className="font-mono text-xs tracking-wide">{data?.enterpriseId || item.id}</code>
      </Field>
      <Field label="Leave Category">
        <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold px-2 py-0.5 rounded-full">
          Continuous leave
        </span>
      </Field>
      <div className="border-t border-gray-100 dark:border-gray-800 my-2" />
      <Field label="LOA Start Date">{data?.leave?.startDate || '—'}</Field>
      <Field label="Expected Return">{data?.leave?.endDate || 'TBD'}</Field>
      <Field label="Days on LOA">
        <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 text-xs font-bold px-2 py-0.5 rounded-full">
          {days} days
        </span>
      </Field>
      <div className="border-t border-gray-100 dark:border-gray-800 my-2" />
      <Field label="Owner Team">
        <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold px-2 py-0.5 rounded-full">
          {meta.label}
        </span>
      </Field>
      <p className="text-xs text-gray-400 italic mt-3 leading-snug">
        Leave reason & medical details restricted to HR / Leave Admin.
      </p>
    </InfoCard>
  );

  const vehicleStatusCard = (
    <InfoCard>
      <div className="space-y-1">
        <SectionTitle>Vehicle & Case Status</SectionTitle>

        {/* Vehicle disposition sub-section */}
        <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-1.5">Vehicle Disposition</p>
        <div className="flex items-center gap-2 mb-1">
          <VehiclePill type={vehicle} />
          <Select value={vehicle} onValueChange={onVehicleOverride}>
            <SelectTrigger className="h-7 text-xs border-dashed w-auto min-w-[90px]">
              <SelectValue placeholder="Override" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Company">Company</SelectItem>
              <SelectItem value="Rental">Rental</SelectItem>
              <SelectItem value="BYOV">BYOV</SelectItem>
              <SelectItem value="Unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-gray-500 mb-3 leading-snug">{VEHICLE_DESC[vehicle]}</p>

        <div className="border-t border-gray-100 dark:border-gray-800 my-2" />

        {/* Case status sub-section */}
        <p className="text-xs font-bold tracking-widest text-gray-400 uppercase mb-2">Case Status</p>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {['Open', 'In Progress', 'Paused', 'Closed'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                status === s
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Field label="Disposition"><span className="italic text-gray-500 text-xs">Pending</span></Field>
        <Field label="Owner Team">
          <span className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-bold px-2 py-0.5 rounded-full">
            {meta.label}
          </span>
        </Field>
      </div>
    </InfoCard>
  );

  const address = data?.tech?.address;
  const fullAddress = address
    ? [address.homeAddr1, address.homeAddr2, address.homeCity, address.homeState, address.homePostal]
        .filter(Boolean)
        .join(', ')
    : '—';

  const contactCard = (
    <InfoCard>
      <SectionTitle>Contact Details</SectionTitle>
      <Field label="Mobile Phone">{data?.tech?.phone || '—'}</Field>
      <Field label="Email">
        {data?.enterpriseId ? (
          <a href={`mailto:${data.enterpriseId.toLowerCase()}@sears.com`} className="text-blue-600 hover:underline text-xs">
            {data.enterpriseId.toLowerCase()}@sears.com
          </a>
        ) : '—'}
      </Field>
      <Field label="Address">
        <span className="text-right text-xs leading-snug">{fullAddress}</span>
      </Field>
      <div className="border-t border-gray-100 dark:border-gray-800 my-2" />
      <Field label="Truck Number">
        {data?.tech?.lastKnownTruck && data.tech.lastKnownTruck !== '—'
          ? data.tech.lastKnownTruck
          : <span className="text-gray-400 italic">Unknown</span>}
      </Field>
    </InfoCard>
  );

  const notesCard = (
    <InfoCard>
      <SectionTitle>Notes</SectionTitle>
      <textarea
        className="w-full border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 resize-y min-h-[80px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors placeholder:text-gray-400"
        placeholder="Add a note for this case…"
        value={notes}
        onChange={onNotesChange}
        rows={4}
      />
    </InfoCard>
  );

  const checklistCard = (
    <InfoCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold tracking-wider uppercase"
            style={{ color: meta.color }}
          >
            {meta.short}
          </span>
          <span className="text-xs font-bold tracking-wider text-gray-500 uppercase">Recovery Tasks</span>
        </div>
        <ProgressRing done={doneTasks} total={activeItems.length} color={meta.color} />
      </div>
      <LoaChecklist
        vehicle={vehicle}
        days={days}
        taskState={taskState}
        onToggle={onToggleTask}
        queue={queue}
        compact
      />
      <CrossQueueStrip item={item} allItems={allItems} queue={queue} taskStates={taskStates} />
    </InfoCard>
  );

  // Focus layout (2-col strip → full checklist → 2-col bottom → timeline)
  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 p-5 space-y-4">
      {/* Top strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loaDetailsCard}
        {vehicleStatusCard}
      </div>

      {/* Checklist */}
      {checklistCard}

      {/* Bottom strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {contactCard}
        {notesCard}
      </div>

      {/* SOP Timeline */}
      <SopTimeline accentColor={meta.color} />
    </div>
  );
}
