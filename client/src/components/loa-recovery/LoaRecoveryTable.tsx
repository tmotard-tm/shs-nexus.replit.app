import { useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { CombinedQueueItem, QueueModule } from '@shared/schema';
import type { LoaQueueName } from './loa-types';
import {
  parseLoaData,
  inferVehicleType,
  daysOnLoa,
  getLastDayInfo,
  LOA_QUEUE_META,
  type LoaVehicleType,
} from './loa-types';
import { activeItemsForQueue } from './loa-checklist-config';
import { LoaDetailView } from './LoaDetailView';

const PER_PAGE = 8;

// ---- Activity tag ----
function ActivityTag({ activity }: { activity: string }) {
  const isLoa = activity?.toUpperCase() === 'LOA';
  return (
    <span
      className={`inline-block text-xs font-extrabold uppercase tracking-wider px-2.5 py-1 rounded ${
        isLoa
          ? 'bg-sky-400 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
      }`}
    >
      {activity || 'LOA'}
    </span>
  );
}

// ---- Vehicle pill ----
const VEHICLE_PILL: Record<LoaVehicleType, string> = {
  Company: 'border-blue-500 text-blue-700 dark:text-blue-400',
  Rental:  'border-purple-500 text-purple-700 dark:text-purple-400',
  BYOV:    'border-green-500 text-green-700 dark:text-green-400',
  Unknown: 'border-gray-400 text-gray-500',
};
function VehiclePill({ type }: { type: LoaVehicleType }) {
  return (
    <span className={`border rounded-full px-3 py-0.5 text-xs font-bold bg-white dark:bg-gray-900 ${VEHICLE_PILL[type]}`}>
      {type}
    </span>
  );
}

// ---- Status pill ----
const STATUS_STYLE: Record<string, { bg: string; dot: string; text: string }> = {
  pending:     { bg: 'bg-gray-100 dark:bg-gray-800', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400' },
  in_progress: { bg: 'bg-blue-50 dark:bg-blue-950/30', dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400' },
  paused:      { bg: 'bg-amber-50 dark:bg-amber-950/20', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  completed:   { bg: 'bg-green-50 dark:bg-green-950/30', dot: 'bg-green-600', text: 'text-green-700 dark:text-green-400' },
  cancelled:   { bg: 'bg-gray-100', dot: 'bg-gray-400', text: 'text-gray-500' },
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Open', in_progress: 'In Progress', paused: 'Paused', completed: 'Closed', cancelled: 'Cancelled',
};
function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-none ${s.dot}`} />
      {STATUS_LABEL[status] || 'Open'}
    </span>
  );
}

// ---- Last Day cell ----
const BADGE_STYLE: Record<string, string> = {
  upcoming: 'border border-blue-300 text-blue-700 bg-white',
  pre:      'bg-blue-100 text-blue-700',
  new:      'bg-green-100 text-green-700',
  past:     'bg-orange-100 text-orange-700',
};
function LastDayCell({ startDate }: { startDate: string | null | undefined }) {
  const info = getLastDayInfo(startDate);
  return (
    <div>
      <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{info.date}</div>
      {info.badges.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {info.badges.map((b) => (
            <span key={b.kind} className={`text-xs font-bold px-1.5 py-0 rounded-full ${BADGE_STYLE[b.kind]}`}>
              {b.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Task progress bar ----
function TaskProgress({ done, total, color }: { done: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done === total;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex-none">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: complete ? '#16a34a' : color }}
        />
      </div>
      <span className={`text-xs font-bold ${complete ? 'text-green-600' : 'text-gray-500'}`}>
        {done}/{total}
      </span>
    </div>
  );
}

// ---- column header ----
function ColHead({ children, center = false }: { children?: React.ReactNode; center?: boolean }) {
  return (
    <div className={`px-3 py-3 text-xs font-bold text-white uppercase tracking-wider ${center ? 'text-center' : ''}`}>
      {children}
    </div>
  );
}

// ---- row ----
function QueueRow({
  item,
  queue,
  allItems,
  expanded,
  onToggle,
}: {
  item: CombinedQueueItem;
  queue: LoaQueueName;
  allItems: CombinedQueueItem[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const data = parseLoaData(item);
  const vehicle = inferVehicleType(item);
  const days = daysOnLoa(data?.leave?.startDate);
  const activeItems = activeItemsForQueue(vehicle, queue);
  const loaTasks: Record<string, boolean> = data?.loaTasks || {};
  const done = activeItems.filter((it) => loaTasks[it.id]).length;
  const meta = LOA_QUEUE_META[queue];
  const isException = !!item.notes?.toLowerCase().includes('exception');

  return (
    <div className={`border-b border-gray-200 dark:border-gray-700 last:border-0 ${isException ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}>
      {/* Row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className={`grid items-center cursor-pointer transition-colors select-none ${
          expanded
            ? 'bg-blue-50/80 dark:bg-blue-950/20'
            : isException
            ? 'hover:bg-red-50 dark:hover:bg-red-950/20'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
        style={{ gridTemplateColumns: '44px 90px minmax(180px,1.5fr) 70px 130px 110px 100px 120px 120px' }}
      >
        {/* Chevron + exception flag */}
        <div className="px-3 py-3 flex items-center gap-1.5">
          <ChevronRight
            className={`w-4 h-4 text-gray-400 transition-transform flex-none ${expanded ? 'rotate-90 text-blue-500' : ''}`}
          />
          {isException && <AlertTriangle className="w-4 h-4 text-red-500 flex-none" />}
        </div>

        {/* Activity */}
        <div className="px-2 py-3 flex items-center justify-center">
          <ActivityTag activity={data?.lane?.includes('LOA') ? 'LOA' : (item.workflowType === 'loa_recovery' ? 'LOA' : 'LOA')} />
        </div>

        {/* Technician */}
        <div className="px-3 py-3">
          <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">
            {data?.techName || item.title}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 font-medium tracking-wide">
            {data?.enterpriseId || '—'}
          </div>
        </div>

        {/* District */}
        <div className="px-2 py-3 text-sm text-gray-500 font-semibold text-center">
          {(item as any).district || 'N/A'}
        </div>

        {/* Last Day */}
        <div className="px-3 py-3">
          <LastDayCell startDate={data?.leave?.startDate} />
        </div>

        {/* Vehicle */}
        <div className="px-2 py-3 flex items-center justify-center">
          <VehiclePill type={vehicle} />
        </div>

        {/* Disposition */}
        <div className="px-2 py-3 text-center">
          <span className="text-xs italic text-gray-400">Pending</span>
        </div>

        {/* Status */}
        <div className="px-2 py-3 flex items-center justify-center">
          <StatusPill status={item.status} />
        </div>

        {/* Tasks */}
        <div className="px-3 py-3 flex items-center justify-center">
          <TaskProgress done={done} total={activeItems.length} color={meta.color} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <LoaDetailView item={item} queue={queue} allItems={allItems} />
      )}
    </div>
  );
}

// ---- main table ----
export function LoaRecoveryTable({
  items,
  module,
  allItems,
}: {
  items: CombinedQueueItem[];
  module: QueueModule;
  allItems: CombinedQueueItem[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const queue = module as LoaQueueName;
  const meta = LOA_QUEUE_META[queue];
  if (!meta) return null;

  // Sort by leave start date descending (most recent first)
  const sorted = [...items].sort((a, b) => {
    const da = parseLoaData(a)?.leave?.startDate;
    const db = parseLoaData(b)?.leave?.startDate;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(db).getTime() - new Date(da).getTime();
  });

  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const curPage = Math.min(page, pages);
  const pageItems = sorted.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE);

  const headerCols = 'grid items-center';
  const gridStyle = { gridTemplateColumns: '44px 90px minmax(180px,1.5fr) 70px 130px 110px 100px 120px 120px' };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      {/* Table header */}
      <div
        className={headerCols}
        style={{ ...gridStyle, background: meta.color }}
      >
        <ColHead />
        <ColHead center>Activity</ColHead>
        <ColHead>Technician</ColHead>
        <ColHead center>District</ColHead>
        <ColHead>Last Day ▾</ColHead>
        <ColHead center>Vehicle</ColHead>
        <ColHead center>Disposition</ColHead>
        <ColHead center>Status</ColHead>
        <ColHead center>Tasks</ColHead>
      </div>

      {/* Rows */}
      <div>
        {pageItems.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            No LOA recovery cases in this queue matching the current filters.
          </div>
        ) : (
          pageItems.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              queue={queue}
              allItems={allItems}
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            />
          ))
        )}
      </div>

      {/* Footer / pager */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex-wrap gap-2">
        <span className="text-xs text-gray-500">
          {sorted.length === 0
            ? 'No cases'
            : `Showing ${(curPage - 1) * PER_PAGE + 1}–${Math.min(curPage * PER_PAGE, sorted.length)} of ${sorted.length} cases`}
        </span>
        {pages > 1 && (
          <div className="flex gap-1">
            <button
              type="button"
              disabled={curPage === 1}
              onClick={() => setPage(curPage - 1)}
              className="px-3 py-1 text-xs font-semibold border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:border-blue-400 transition-colors"
            >
              Previous
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                  p === curPage
                    ? 'text-white border-transparent'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400'
                }`}
                style={p === curPage ? { background: meta.color, borderColor: meta.color } : {}}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              disabled={curPage === pages}
              onClick={() => setPage(curPage + 1)}
              className="px-3 py-1 text-xs font-semibold border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:border-blue-400 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
