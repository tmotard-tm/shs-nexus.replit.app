/**
 * Technician schedule viewer.
 *
 * Reads `GET /api/vrm/tech-schedule/:ldap`, which is backed by Mauricio
 * Marino's tech-shifts feed (see `server/tech-shifts-client.ts`). This is the
 * first schedule UI in Nexus — before it, the only way to know whether a
 * technician works a given day was to ask, or to read a one-sentence Friday /
 * Saturday hint on the rental-approval drawer.
 *
 * Styling follows the VRM convention: inline styles over the `--vrm-*` CSS
 * variables, which are defined for both light and dark in `index.css`. That
 * makes this component safe to drop on a non-VRM page too.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CalendarOff, Loader2, Truck, X } from "lucide-react";

import { colors, fonts } from "@/pages/vehicle-rental-management/lib/constants";

// ---------------------------------------------------------------- types
// Mirrors the server's TechSchedule / TechDay in server/tech-shifts-client.ts.

export type DayState = "working" | "partial" | "activity" | "off";

export interface TechDay {
  date: string;
  state: DayState;
  /** null when the feed said "OFF" — the API never sends that string onward. */
  hours: number | null;
  shiftName: string | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  activityType: string | null;
  activityHours: number | null;
  activityStartTime: string | null;
  activityEndTime: string | null;
  isFleetActivity: boolean;
  isWorking: boolean;
}

export interface TechSchedule {
  ldap: string;
  techName: string | null;
  district: string | null;
  iru: string | null;
  teamName: string | null;
  shiftName: string | null;
  patternWeek: number | null;
  startDate: string;
  endDate: string;
  days: TechDay[];
  workingDays: number;
  offDays: number;
  activities: string[];
  found: boolean;
  /**
   * Present when the lookup FAILED rather than came back empty.
   * `found:false` with no `error` means the feed was asked and knows
   * nothing about this technician. `found:false` WITH an error means we
   * never got an answer, which must never be rendered as "no schedule".
   */
  error?: string;
  roster?: { name: string | null; jobTitle: string | null; district: string | null } | null;
}

// ------------------------------------------------------------- date utils
// Everything is UTC date-only arithmetic. Parsing "2026-08-23" with the local
// Date constructor shifts it a day west of UTC, which silently mislabels
// every column of the grid.

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeekISO(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysISO(iso, dow === 0 ? -6 : 1 - dow);
}

export function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/**
 * Shared fetch. Everything that reads a schedule goes through this so the
 * queryKey — which IS the URL under this app's queryClient — stays identical
 * across the drawer, the modal and the standalone page, and one fetch serves
 * all three.
 */
export function useTechSchedule(ldap: string, start: string, end: string, enabled = true) {
  const normalized = (ldap || "").trim().toUpperCase();
  return useQuery<TechSchedule>({
    queryKey: [`/api/vrm/tech-schedule/${normalized}?start=${start}&end=${end}`],
    enabled: enabled && !!normalized && isIsoDate(start) && isIsoDate(end),
    // The global default is staleTime: Infinity. A schedule genuinely changes
    // during the day (an absence lands, a Vehicle - Change block is filed), so
    // these views opt back in to refetching.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Split an error thrown by queryClient (`${status}: ${body}`) into something showable. */
/**
 * queryClient throws `${status}: ${body}`. The status alone is NOT enough to
 * conclude the feed is unconfigured: the session middleware in front of
 * /api/vrm also answers 503 on a transient auth-backend blip, and telling an
 * operator to add a secret that is already set sends them to fix the one
 * thing that is correct. Require the route's own machine-readable signal.
 */
export function describeScheduleError(error: unknown): { notConfigured: boolean; message: string } {
  const raw = String((error as Error)?.message ?? error ?? "");
  let notConfigured = /TECHS?_SHIFTS_API_KEY/.test(raw);
  if (!notConfigured) {
    const body = raw.slice(raw.indexOf(":") + 1).trim();
    try {
      const parsed = JSON.parse(body);
      notConfigured = parsed?.code === "CONFIG_MISSING" || parsed?.configured === false;
    } catch {
      // Not JSON (an HTML error page, a proxy timeout). Then it is not a
      // configuration answer and must not be reported as one.
    }
  }
  return { notConfigured, message: raw };
}

function dayNum(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

// ------------------------------------------------------------- state style

const STATE_STYLE: Record<DayState, { fg: string; bg: string; label: string }> = {
  working: { fg: colors.green, bg: colors.greenLight, label: "Working" },
  partial: { fg: colors.blue, bg: colors.blueLight, label: "Working + activity" },
  activity: { fg: colors.amber, bg: colors.amberLight, label: "Absent / activity" },
  off: { fg: colors.inkMuted, bg: colors.background, label: "Off" },
};

function hoursLabel(d: TechDay): string {
  if (d.state === "off") return "OFF";
  if (d.hours == null) return "—";
  return `${d.hours}h`;
}

// ------------------------------------------------------------------ pieces

function Pill({ text, fg, bg, title }: { text: string; fg: string; bg: string; title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontFamily: fonts.dmSans,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "1px 6px",
        borderRadius: 4,
        color: fg,
        backgroundColor: bg,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "100%",
      }}
    >
      {text}
    </span>
  );
}

function DayCell({ day, iso, highlight }: { day: TechDay | undefined; iso: string; highlight: boolean }) {
  const state: DayState = day?.state ?? "off";
  const style = STATE_STYLE[state];
  const isToday = iso === todayET();

  return (
    <div
      title={
        day
          ? [
              iso,
              style.label,
              day.shiftName ?? "",
              day.shiftStartTime && day.shiftEndTime ? `${day.shiftStartTime}–${day.shiftEndTime}` : "",
              day.activityType ? `${day.activityType} (${day.activityHours ?? 0}h)` : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : `${iso} · no data`
      }
      style={{
        minHeight: 74,
        padding: "6px 7px",
        borderRadius: 8,
        border: `1px solid ${highlight ? colors.accent : colors.rule}`,
        outline: highlight ? `2px solid ${colors.accent}` : "none",
        outlineOffset: highlight ? 1 : 0,
        backgroundColor: day ? style.bg : colors.background,
        opacity: day ? 1 : 0.45,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
        <span
          style={{
            fontFamily: fonts.jetbrains,
            fontSize: 12,
            fontWeight: isToday ? 700 : 500,
            color: isToday ? colors.accent : colors.inkSoft,
          }}
        >
          {dayNum(iso)}
        </span>
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, fontWeight: 700, color: style.fg }}>
          {day ? hoursLabel(day) : "—"}
        </span>
      </div>

      {day && day.shiftStartTime && day.shiftEndTime ? (
        <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
          {day.shiftStartTime}–{day.shiftEndTime}
        </div>
      ) : null}

      {day?.activityType ? (
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
          {day.isFleetActivity ? <Truck size={10} style={{ color: colors.purple, flexShrink: 0 }} /> : null}
          <Pill
            text={day.activityType}
            title={`${day.activityType}${day.activityHours ? ` · ${day.activityHours}h` : ""}${
              day.activityStartTime ? ` · ${day.activityStartTime}–${day.activityEndTime ?? ""}` : ""
            }`}
            fg={day.isFleetActivity ? colors.purple : colors.amber}
            bg={day.isFleetActivity ? colors.purpleLight : colors.amberLight}
          />
        </div>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {(Object.keys(STATE_STYLE) as DayState[]).map((s) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: STATE_STYLE[s].bg,
              border: `1px solid ${STATE_STYLE[s].fg}`,
            }}
          />
          <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
            {STATE_STYLE[s].label}
          </span>
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Truck size={11} style={{ color: colors.purple }} />
        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
          Fleet-filed block
        </span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------ the main view

export interface TechScheduleViewProps {
  ldap: string;
  /** Falls back to whatever the feed or the roster knows. */
  name?: string | null;
  /** Ring this date — the rental pickup being decided, normally. */
  highlightDate?: string | null;
  /** How many Monday-anchored weeks to show. Default 2. */
  weeks?: number;
  /** First day of the first week. Defaults to the week containing `highlightDate`, else this week. */
  startDate?: string | null;
  /** Hide the identity header when the host already shows the technician. */
  hideHeader?: boolean;
}

export function TechScheduleView({
  ldap,
  name,
  highlightDate,
  weeks = 2,
  startDate,
  hideHeader = false,
}: TechScheduleViewProps) {
  const normalizedLdap = (ldap || "").trim().toUpperCase();

  // todayET() is read inside the memo, so it must also be a dependency or a
  // tab left open across midnight keeps rendering last week.
  const today = todayET();
  const start = useMemo(
    () => startOfWeekISO(startDate || highlightDate || today),
    [startDate, highlightDate, today],
  );
  const end = useMemo(() => addDaysISO(start, weeks * 7 - 1), [start, weeks]);

  const { data, isLoading, error } = useTechSchedule(normalizedLdap, start, end);

  const byDate = useMemo(() => {
    const m = new Map<string, TechDay>();
    for (const d of data?.days ?? []) m.set(d.date, d);
    return m;
  }, [data]);

  const grid = useMemo(() => {
    const out: string[][] = [];
    for (let w = 0; w < weeks; w += 1) {
      const week: string[] = [];
      for (let i = 0; i < 7; i += 1) week.push(addDaysISO(start, w * 7 + i));
      out.push(week);
    }
    return out;
  }, [start, weeks]);

  const displayName = data?.techName || data?.roster?.name || name || null;

  // -------------------------------------------------------------- loading
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 20,
          fontFamily: fonts.dmSans,
          fontSize: 13,
          color: colors.inkMuted,
        }}
      >
        <Loader2 size={15} className="animate-spin" />
        Loading schedule for {normalizedLdap}…
      </div>
    );
  }

  // ---------------------------------------------------------------- error
  if (error) {
    // queryClient throws `${status}: ${body}`; 503 is the not-configured case,
    // which is a setup task rather than a fault and should read that way.
    const { notConfigured, message: raw } = describeScheduleError(error);
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: `1px solid ${notConfigured ? colors.amber : colors.red}`,
          backgroundColor: notConfigured ? colors.amberLight : colors.redLight,
          fontFamily: fonts.dmSans,
          fontSize: 12.5,
          color: colors.ink,
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>
            {notConfigured ? "Schedule feed is not connected yet" : "Could not load the schedule"}
          </div>
          <div style={{ color: colors.inkSoft, fontSize: 11.5, wordBreak: "break-word" }}>
            {notConfigured
              ? "Add TECHS_SHIFTS_API_KEY to Replit Secrets to turn this on."
              : raw}
          </div>
        </div>
      </div>
    );
  }

  const highlighted = highlightDate ? byDate.get(highlightDate) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink }}>
            {displayName || normalizedLdap}
          </span>
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
            {normalizedLdap}
          </span>
          {data?.district || data?.roster?.district ? (
            <Pill
              text={`District ${data?.district || data?.roster?.district}`}
              fg={colors.inkSoft}
              bg={colors.background}
            />
          ) : null}
          {data?.shiftName ? (
            <Pill text={data.shiftName} fg={colors.inkSoft} bg={colors.background} title="Shift pattern" />
          ) : null}
        </div>
      )}

      {/* The verdict, stated before the grid. This is the whole reason an
          approver opens this panel, so it must not require reading a calendar. */}
      {highlightDate ? (
        <div
          style={{
            padding: "8px 11px",
            borderRadius: 8,
            border: `1px solid ${
              !data?.found ? colors.rule : highlighted?.isWorking ? colors.green : colors.red
            }`,
            backgroundColor: !data?.found
              ? colors.background
              : highlighted?.isWorking
                ? colors.greenLight
                : colors.redLight,
            fontFamily: fonts.dmSans,
            fontSize: 12.5,
            color: colors.ink,
          }}
        >
          {!data?.found ? (
            <>
              <strong>No schedule on file</strong> for {normalizedLdap}. The feed knows nothing about this
              technician in this window, which is not the same as a day off.
            </>
          ) : highlighted?.isWorking ? (
            <>
              <strong>Working {highlightDate}</strong>
              {highlighted.shiftStartTime && highlighted.shiftEndTime
                ? ` · ${highlighted.shiftStartTime}–${highlighted.shiftEndTime}`
                : ""}
              {highlighted.activityType ? ` · also ${highlighted.activityType}` : ""}
            </>
          ) : (
            <>
              <strong>
                {highlighted
                  ? highlighted.state === "off"
                    ? `Not scheduled ${highlightDate}`
                    : `${highlighted.activityType ?? "Absent"} on ${highlightDate}`
                  : `No shift row for ${highlightDate}`}
              </strong>
              {(() => {
                const next = (data?.days ?? []).find((d) => d.date >= highlightDate && d.isWorking);
                return next ? ` · next working day is ${next.date}` : " · no working day in this window";
              })()}
            </>
          )}
        </div>
      ) : null}

      {/* week grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* The weekday header carries the same 34px month-label spacer as each
            week row below it. Without it the header grid spans the full width
            while the day cells are inset, and every label sits ~40px left of
            the column it names. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 34, flexShrink: 0 }} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 6,
            }}
          >
            {DOW.map((d) => (
              <div
                key={d}
                style={{
                  fontFamily: fonts.dmSans,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: colors.inkMuted,
                  textAlign: "center",
                }}
              >
                {d}
              </div>
            ))}
          </div>
        </div>

        {grid.map((week) => (
          <div key={week[0]} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
            <div
              style={{
                width: 34,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                paddingRight: 2,
                fontFamily: fonts.dmSans,
                fontSize: 10,
                fontWeight: 600,
                color: colors.inkMuted,
                whiteSpace: "nowrap",
              }}
            >
              {monthLabel(week[0])}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {week.map((iso) => (
                <DayCell key={iso} iso={iso} day={byDate.get(iso)} highlight={iso === highlightDate} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* summary */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontFamily: fonts.dmSans,
          fontSize: 11.5,
          color: colors.inkSoft,
        }}
      >
        {data?.found ? (
          <span>
            <strong style={{ color: colors.ink }}>{data.workingDays}</strong> working ·{" "}
            <strong style={{ color: colors.ink }}>{data.offDays}</strong> off over {weeks * 7} days
          </span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <CalendarOff size={13} /> no rows for {normalizedLdap} in {start} → {end}
          </span>
        )}
        {data?.activities?.length ? <span>{data.activities.join(" · ")}</span> : null}
      </div>

      <Legend />
    </div>
  );
}

// ---------------------------------------------------------------- the modal
// Hand-rolled to match VRM's other overlays (see tech-text-modal.tsx), which
// do not use the shadcn Dialog.

export interface TechScheduleDialogProps extends TechScheduleViewProps {
  open: boolean;
  onClose: () => void;
}

export function TechScheduleDialog({ open, onClose, ...viewProps }: TechScheduleDialogProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: colors.surface,
          border: `1px solid ${colors.rule}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <span style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink }}>
            Technician schedule
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: colors.inkMuted,
              display: "flex",
              padding: 2,
            }}
          >
            <X size={18} />
          </button>
        </div>
        <TechScheduleView {...viewProps} />
      </div>
    </div>
  );
}

// ------------------------------------------------- the narrow inline check
/**
 * The rental-approval drawer is 520px wide, so the full grid does not belong
 * in it. This is the version that does: one sentence answering "can this
 * technician collect the car on the date in the field above", a seven-cell
 * strip for that week, and a button to the full two-week view.
 *
 * It renders nothing at all when there is no LDAP or no valid date — an
 * approver mid-edit should not see a red box because the date input is empty.
 */
export function TechSchedulePickupCheck({
  ldap,
  pickupDate,
  name,
}: {
  ldap: string;
  pickupDate: string | null | undefined;
  name?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const normalizedLdap = (ldap || "").trim().toUpperCase();
  const date = isIsoDate(pickupDate) ? pickupDate : null;

  const start = date ? startOfWeekISO(date) : "";
  const end = date ? addDaysISO(start, 6) : "";
  const { data, isLoading, error } = useTechSchedule(normalizedLdap, start, end, !!date);

  const week = useMemo(
    () => (start ? Array.from({ length: 7 }, (_, i) => addDaysISO(start, i)) : []),
    [start],
  );
  const byDate = useMemo(() => {
    const m = new Map<string, TechDay>();
    for (const d of data?.days ?? []) m.set(d.date, d);
    return m;
  }, [data]);

  if (!normalizedLdap || !date) return null;

  const wrap: React.CSSProperties = {
    marginBottom: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${colors.rule}`,
    background: colors.surface,
    fontFamily: fonts.dmSans,
    fontSize: 12,
  };

  if (isLoading) {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 6, color: colors.inkMuted }}>
        <Loader2 size={12} className="animate-spin" /> Checking {normalizedLdap}'s schedule…
      </div>
    );
  }

  if (error) {
    const { notConfigured, message } = describeScheduleError(error);
    return (
      <div
        style={{
          ...wrap,
          borderColor: colors.amber,
          background: colors.amberLight,
          color: colors.ink,
          display: "flex",
          gap: 6,
          alignItems: "flex-start",
        }}
      >
        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          {notConfigured
            ? "Schedule feed not connected (add TECHS_SHIFTS_API_KEY to Replit Secrets)."
            : `Schedule unavailable — ${message}`}
        </span>
      </div>
    );
  }

  const day = byDate.get(date) ?? null;
  const next = (data?.days ?? []).find((d) => d.date >= date && d.isWorking) ?? null;

  const tone = !data?.found
    ? { border: colors.rule, bg: colors.background, fg: colors.inkSoft }
    : day?.isWorking
      ? { border: colors.green, bg: colors.greenLight, fg: colors.green }
      : { border: colors.red, bg: colors.redLight, fg: colors.red };

  return (
    <>
      <div style={{ ...wrap, borderColor: tone.border, background: tone.bg }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: colors.ink }}>
            {!data?.found ? (
              <>
                <strong>No schedule on file</strong> for {normalizedLdap} — that is not the same as a day
                off.
              </>
            ) : day?.isWorking ? (
              <>
                <strong style={{ color: tone.fg }}>Works {date}</strong>
                {day.shiftStartTime && day.shiftEndTime ? ` · ${day.shiftStartTime}–${day.shiftEndTime}` : ""}
                {day.activityType ? ` · ${day.activityType}` : ""}
              </>
            ) : (
              <>
                <strong style={{ color: tone.fg }}>
                  {day
                    ? day.state === "off"
                      ? `Off ${date}`
                      : `${day.activityType ?? "Absent"} ${date}`
                    : `No shift row for ${date}`}
                </strong>
                {next ? ` · next works ${next.date}` : " · no working day this week"}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              fontFamily: fonts.dmSans,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 6,
              border: `1px solid ${colors.rule}`,
              background: colors.background,
              color: colors.inkSoft,
              cursor: "pointer",
            }}
          >
            <CalendarDays size={11} /> Full schedule
          </button>
        </div>

        <div
          style={{
            marginTop: 7,
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 3,
          }}
        >
          {week.map((iso, i) => {
            const d = byDate.get(iso);
            const s = STATE_STYLE[d?.state ?? "off"];
            const isPickup = iso === date;
            return (
              <div
                key={iso}
                title={
                  d
                    ? [iso, s.label, d.shiftStartTime && `${d.shiftStartTime}–${d.shiftEndTime}`, d.activityType]
                        .filter(Boolean)
                        .join(" · ")
                    : `${iso} · no data`
                }
                style={{
                  borderRadius: 5,
                  padding: "3px 2px",
                  textAlign: "center",
                  background: d ? s.bg : colors.background,
                  border: `1px solid ${isPickup ? colors.accent : d ? s.fg : colors.rule}`,
                  outline: isPickup ? `1px solid ${colors.accent}` : "none",
                  opacity: d ? 1 : 0.5,
                  overflow: "hidden",
                }}
              >
                <div style={{ fontFamily: fonts.dmSans, fontSize: 8.5, color: colors.inkMuted }}>
                  {DOW[i]}
                </div>
                <div
                  style={{
                    fontFamily: fonts.jetbrains,
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: s.fg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  {d?.isFleetActivity ? <Truck size={8} style={{ flexShrink: 0 }} /> : null}
                  {!d ? "—" : d.state === "off" ? "OFF" : d.hours != null ? `${d.hours}` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TechScheduleDialog
        open={open}
        onClose={() => setOpen(false)}
        ldap={normalizedLdap}
        name={name ?? data?.techName ?? null}
        highlightDate={date}
        weeks={2}
      />
    </>
  );
}

export default TechScheduleView;
