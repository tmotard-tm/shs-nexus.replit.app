/**
 * Tech Schedules — the standalone lookup page.
 *
 * Three modes:
 *   - Technician: type a name or LDAP, get a two-week grid.
 *   - District:   type a district number, get every technician's week as one
 *                 strip per person, so coverage and absences read at a glance.
 *   - List:       paste the LDAPs off a cutover batch, a rental wave or a
 *                 request queue and check the whole group's week at once. This
 *                 is the mode that would have caught the eight technicians who
 *                 held week-long reservations while having zero shifts.
 *
 * All three are served by `/api/vrm/tech-schedule/*`, which wraps Mauricio
 * Marino's tech-shifts feed. District is one upstream request; technician and
 * list are filtered server-side, so none of them pulls the ~3.6 MB whole-fleet
 * week.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  Search,
  Truck,
  Users,
} from "lucide-react";

import { colors, fonts } from "../lib/constants";
import { TechScheduleView, type TechSchedule } from "@/components/tech-schedule/TechScheduleView";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekISO(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysISO(iso, dow === 0 ? -6 : 1 - dow);
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pretty(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface SearchHit {
  ldap: string;
  name: string;
  jobTitle: string | null;
  district: string | null;
  employmentStatus: string | null;
}

const card: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: 12,
  padding: 18,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: fonts.dmSans,
  fontSize: 13,
  padding: "8px 10px 8px 30px",
  borderRadius: 8,
  border: `1px solid ${colors.rule}`,
  background: colors.background,
  color: colors.ink,
  outline: "none",
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** One technician as a single row of seven cells — the district roll-up unit. */
function WeekStrip({ schedule, days }: { schedule: TechSchedule; days: string[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, TechSchedule["days"][number]>();
    for (const d of schedule.days) m.set(d.date, d);
    return m;
  }, [schedule]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
      <div style={{ width: 210, flexShrink: 0, minWidth: 0 }}>
        <div
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 12.5,
            color: colors.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={schedule.techName ?? schedule.ldap}
        >
          {schedule.techName ?? schedule.ldap}
        </div>
        <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
          {schedule.ldap}
          {schedule.teamName ? ` · ${schedule.teamName}` : ""}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gap: 4,
        }}
      >
        {days.map((iso) => {
          const d = byDate.get(iso);
          const bg =
            !d ? colors.background
            : d.state === "working" ? colors.greenLight
            : d.state === "partial" ? colors.blueLight
            : d.state === "activity" ? colors.amberLight
            : colors.background;
          const fg =
            !d ? colors.inkMuted
            : d.state === "working" ? colors.green
            : d.state === "partial" ? colors.blue
            : d.state === "activity" ? colors.amber
            : colors.inkMuted;
          return (
            <div
              key={iso}
              title={
                d
                  ? [iso, d.state, d.shiftStartTime && `${d.shiftStartTime}–${d.shiftEndTime}`, d.activityType]
                      .filter(Boolean)
                      .join(" · ")
                  : `${iso} · no data`
              }
              style={{
                height: 28,
                borderRadius: 5,
                border: `1px solid ${d ? fg : colors.rule}`,
                background: bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                fontFamily: fonts.jetbrains,
                fontSize: 10,
                fontWeight: 600,
                color: fg,
                overflow: "hidden",
              }}
            >
              {d?.isFleetActivity ? <Truck size={10} style={{ flexShrink: 0 }} /> : null}
              {!d ? "—" : d.state === "off" ? "OFF" : d.hours != null ? `${d.hours}` : "—"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Shared roll-up renderer for the district and list modes. */
function RollUp({
  schedules,
  days,
  weekStart,
  weekEnd,
  caption,
}: {
  schedules: TechSchedule[];
  days: string[];
  weekStart: string;
  weekEnd: string;
  caption: string;
}) {
  // Surface the two states that cost money before the grid, because nobody
  // scans 77 rows looking for them.
  const noSchedule = schedules.filter((s) => !s.found);
  const zeroWorking = schedules.filter((s) => s.found && s.workingDays === 0);

  return (
    <>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, marginBottom: 8 }}>
        {caption} · {pretty(weekStart)} – {pretty(weekEnd)} · numbers are scheduled hours
      </div>

      {noSchedule.length || zeroWorking.length ? (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 11px",
            borderRadius: 8,
            border: `1px solid ${colors.amber}`,
            background: colors.amberLight,
            fontFamily: fonts.dmSans,
            fontSize: 12,
            color: colors.ink,
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {zeroWorking.length ? (
            <div>
              <strong>{zeroWorking.length} not working at all this week:</strong>{" "}
              {zeroWorking.map((s) => s.ldap).join(", ")}
            </div>
          ) : null}
          {noSchedule.length ? (
            <div>
              <strong>{noSchedule.length} with no schedule on file:</strong>{" "}
              {noSchedule.map((s) => s.ldap).join(", ")} — not the same as a day off.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 210, flexShrink: 0 }} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 4,
          }}
        >
          {DOW.map((d, i) => (
            <div
              key={d}
              style={{
                textAlign: "center",
                fontFamily: fonts.dmSans,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                color: days[i] === todayET() ? colors.accent : colors.inkMuted,
              }}
            >
              {d} {Number(days[i].slice(8, 10))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: 620, overflowY: "auto" }}>
        {schedules.map((s) => (
          <WeekStrip key={s.ldap} schedule={s} days={days} />
        ))}
      </div>
    </>
  );
}

export default function TechSchedules() {
  const [mode, setMode] = useState<"tech" | "district" | "list">("tech");
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(todayET()));

  // ------------------------------------------------------------ tech mode
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q.trim(), 250);
  const [selected, setSelected] = useState<SearchHit | null>(null);

  const searchQuery = useQuery<{ results: SearchHit[]; message?: string }>({
    queryKey: [`/api/vrm/tech-schedule/search?q=${encodeURIComponent(debouncedQ)}`],
    enabled: mode === "tech" && debouncedQ.length >= 2,
    staleTime: 60_000,
  });

  // -------------------------------------------------------- district mode
  const [districtInput, setDistrictInput] = useState("");
  const [district, setDistrict] = useState("");
  const districtEnd = addDaysISO(weekStart, 6);

  const districtQuery = useQuery<{ schedules: TechSchedule[]; count: number }>({
    queryKey: [
      `/api/vrm/tech-schedule/district/${encodeURIComponent(district)}?start=${weekStart}&end=${districtEnd}`,
    ],
    enabled: mode === "district" && district.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const districtDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)),
    [weekStart],
  );

  // ------------------------------------------------------------ list mode
  const [listInput, setListInput] = useState("");
  const [listLdaps, setListLdaps] = useState<string[]>([]);

  // Split on anything that is not part of an LDAP, so a pasted column, a CSV
  // row and a comma-separated line all work without the operator reformatting.
  const parsedList = useMemo(
    () =>
      Array.from(
        new Set(
          listInput
            .split(/[^A-Za-z0-9]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        ),
      ),
    [listInput],
  );

  const listQuery = useQuery<{ schedules: TechSchedule[]; requested: number }>({
    queryKey: [
      `/api/vrm/tech-schedule/batch?ldaps=${listLdaps.join(",")}&start=${weekStart}&end=${districtEnd}`,
    ],
    enabled: mode === "list" && listLdaps.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const tabButton = (value: "tech" | "district" | "list", label: string, Icon: typeof Users) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.dmSans,
        fontSize: 12.5,
        fontWeight: 600,
        padding: "6px 13px",
        borderRadius: 8,
        cursor: "pointer",
        border: `1px solid ${mode === value ? colors.accent : colors.rule}`,
        background: mode === value ? colors.accentLight : "transparent",
        color: mode === value ? colors.accent : colors.inkSoft,
      }}
    >
      <Icon size={13} />
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1180 }}>
      <div>
        <h1 style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 700, color: colors.ink, margin: 0 }}>
          Tech Schedules
        </h1>
        <p
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            color: colors.inkSoft,
            margin: "5px 0 0",
            maxWidth: 720,
          }}
        >
          Live shift patterns, days off and activities straight from the Tech Shift Calendar. Fleet-filed
          blocks (<Truck size={12} style={{ display: "inline", verticalAlign: -2, color: colors.purple }} />{" "}
          Vehicle&nbsp;-&nbsp;Change / Decommission / Pickup / Dropoff) read back here, so a route block can
          be confirmed against what the technician actually sees.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {tabButton("tech", "By technician", Users)}
        {tabButton("district", "By district", CalendarRange)}
        {tabButton("list", "By list", ClipboardList)}

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDaysISO(w, -7))}
            style={{
              display: "flex",
              padding: 6,
              borderRadius: 7,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeekISO(todayET()))}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 11px",
              borderRadius: 7,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Week of {pretty(weekStart)}
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDaysISO(w, 7))}
            style={{
              display: "flex",
              padding: 6,
              borderRadius: 7,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              cursor: "pointer",
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ tech mode */}
      {mode === "tech" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 16 }}>
          <div style={{ ...card, alignSelf: "start" }}>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: colors.inkMuted,
                }}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name or LDAP…"
                style={inputStyle}
              />
            </div>

            {debouncedQ.length < 2 ? (
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                Type at least 2 characters.
              </div>
            ) : searchQuery.isLoading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                  color: colors.inkMuted,
                }}
              >
                <Loader2 size={13} className="animate-spin" /> Searching…
              </div>
            ) : searchQuery.error ? (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                  color: colors.red,
                }}
              >
                <AlertTriangle size={13} /> {String((searchQuery.error as Error).message)}
              </div>
            ) : !searchQuery.data?.results?.length ? (
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                No active technician matches “{debouncedQ}”.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 460, overflowY: "auto" }}>
                {searchQuery.data.results.map((hit) => {
                  const active = selected?.ldap === hit.ldap;
                  return (
                    <button
                      key={hit.ldap}
                      type="button"
                      onClick={() => setSelected(hit)}
                      style={{
                        textAlign: "left",
                        padding: "7px 9px",
                        borderRadius: 7,
                        border: `1px solid ${active ? colors.accent : "transparent"}`,
                        background: active ? colors.accentLight : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
                        {hit.name}
                      </div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
                        {hit.ldap}
                        {hit.district ? ` · D${hit.district}` : ""}
                        {hit.employmentStatus && hit.employmentStatus !== "A"
                          ? ` · status ${hit.employmentStatus}`
                          : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={card}>
            {selected ? (
              <TechScheduleView
                key={`${selected.ldap}-${weekStart}`}
                ldap={selected.ldap}
                name={selected.name}
                startDate={weekStart}
                weeks={2}
              />
            ) : (
              <div
                style={{
                  padding: "44px 0",
                  textAlign: "center",
                  fontFamily: fonts.dmSans,
                  fontSize: 13,
                  color: colors.inkMuted,
                }}
              >
                Pick a technician to see their schedule.
              </div>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------- district mode */}
      {mode === "district" && (
        <div style={card}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setDistrict(districtInput.trim());
            }}
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}
          >
            <div style={{ position: "relative", width: 220 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: colors.inkMuted,
                }}
              />
              <input
                value={districtInput}
                onChange={(e) => setDistrictInput(e.target.value)}
                placeholder="District number, e.g. 8035"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              style={{
                fontFamily: fonts.dmSans,
                fontSize: 12.5,
                fontWeight: 600,
                padding: "8px 15px",
                borderRadius: 8,
                border: "none",
                background: colors.accent,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Load week
            </button>
          </form>

          {!district ? (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
              Enter a district to see everyone's week at once.
            </div>
          ) : districtQuery.isLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: fonts.dmSans,
                fontSize: 13,
                color: colors.inkMuted,
              }}
            >
              <Loader2 size={15} className="animate-spin" /> Loading district {district}…
            </div>
          ) : districtQuery.error ? (
            <div
              style={{
                display: "flex",
                gap: 7,
                fontFamily: fonts.dmSans,
                fontSize: 12.5,
                color: colors.red,
              }}
            >
              <AlertTriangle size={15} /> {String((districtQuery.error as Error).message)}
            </div>
          ) : !districtQuery.data?.schedules?.length ? (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
              No technicians on the schedule for district {district} in the week of {pretty(weekStart)}.
            </div>
          ) : (
            <RollUp
              schedules={districtQuery.data.schedules}
              days={districtDays}
              weekStart={weekStart}
              weekEnd={districtEnd}
              caption={`${districtQuery.data.count} technicians in district ${district}`}
            />
          )}
        </div>
      )}

      {/* ------------------------------------------------------ list mode */}
      {mode === "list" && (
        <div style={card}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setListLdaps(parsedList.slice(0, 60));
            }}
            style={{ marginBottom: 14 }}
          >
            <label
              style={{
                display: "block",
                fontFamily: fonts.dmSans,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: colors.inkMuted,
                marginBottom: 5,
              }}
            >
              Paste LDAPs
            </label>
            <textarea
              value={listInput}
              onChange={(e) => setListInput(e.target.value)}
              rows={4}
              placeholder={"GGILLIS, AAKBAR0, JLOCKE2\nor one per line — commas, tabs and spaces all work"}
              style={{
                width: "100%",
                fontFamily: fonts.jetbrains,
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${colors.rule}`,
                background: colors.background,
                color: colors.ink,
                outline: "none",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button
                type="submit"
                disabled={!parsedList.length}
                style={{
                  fontFamily: fonts.dmSans,
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "8px 15px",
                  borderRadius: 8,
                  border: "none",
                  background: parsedList.length ? colors.accent : colors.rule,
                  color: "#fff",
                  cursor: parsedList.length ? "pointer" : "not-allowed",
                }}
              >
                Check {parsedList.length || ""} {parsedList.length === 1 ? "technician" : "technicians"}
              </button>
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted }}>
                {parsedList.length > 60
                  ? `${parsedList.length} pasted — only the first 60 are checked per run`
                  : "Up to 60 at a time."}
              </span>
            </div>
          </form>

          {!listLdaps.length ? (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
              Paste a cutover batch, a rental wave or a request queue to check the whole group's week.
            </div>
          ) : listQuery.isLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: fonts.dmSans,
                fontSize: 13,
                color: colors.inkMuted,
              }}
            >
              <Loader2 size={15} className="animate-spin" /> Checking {listLdaps.length} technicians…
            </div>
          ) : listQuery.error ? (
            <div style={{ display: "flex", gap: 7, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.red }}>
              <AlertTriangle size={15} /> {String((listQuery.error as Error).message)}
            </div>
          ) : !listQuery.data?.schedules?.length ? (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
              Nothing came back for those LDAPs.
            </div>
          ) : (
            <RollUp
              schedules={listQuery.data.schedules}
              days={districtDays}
              weekStart={weekStart}
              weekEnd={districtEnd}
              caption={`${listQuery.data.schedules.length} of ${listQuery.data.requested} requested`}
            />
          )}
        </div>
      )}
    </div>
  );
}
