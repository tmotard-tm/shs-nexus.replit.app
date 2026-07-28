/**
 * Rental cases split by region — EAST, CENTRAL, WEST.
 *
 * Tyler, 2026-07-28: split the rental cases by region based on the location of
 * the tech, and keep districts grouped together inside their region.
 *
 * Region is resolved server-side (server/vrm/rental-operations/region.ts): every
 * district is assigned ONE region by a vote of its technicians' home states, and
 * a case inherits its district's region. That is what stops a district whose
 * technicians live either side of a region line from being scattered across two
 * tabs. Only a case with no district at all resolves per-case.
 *
 * Reads /api/vrm/rental-operations/by-region, which is built from the same
 * getRentalOpsMaster() model the Rental Operations page reads, so the two pages
 * cannot disagree about the population.
 *
 * Table conventions (sortable everything, multi-select filters with counts,
 * "N shown of M", search, filtered CSV, sticky header) follow RentalOperations.tsx.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Search, Download, Layers } from "lucide-react";
import { colors, fonts } from "../lib/constants";

// ── types ────────────────────────────────────────────────────────────────────
type RegionKey = "east" | "central" | "west";
type RegionBasis = "district" | "tech_state" | "shop_state" | "renting_state" | "unassigned";

interface RegionalRow {
  case_key: string;
  vehicle_number: string;
  renter_name_raw: string;
  tech_name: string | null;
  tech_district: string | null;
  identity_state: string | null;
  employee_status: string | null;
  days_open: number | null;
  daily_cost: number | null;
  ams_status: string | null;
  ticket_status: string | null;
  repairs_complete: string | null;
  shop_state: string | null;
  renting_state: string | null;
  region: RegionKey | null;
  region_label: string;
  region_basis: RegionBasis;
  district_split: boolean;
  district_inferred: boolean;
}

interface DistrictSummary {
  district: string;
  caseCount: number;
  dailyCostTotal: number;
  daysOpenMax: number | null;
  split: boolean;
  inferred: boolean;
}

interface RegionSummary {
  region: RegionKey | "unassigned";
  label: string;
  owner: string | null;
  caseCount: number;
  districtCount: number;
  dailyCostTotal: number;
  districts: DistrictSummary[];
}

interface RegionalModel {
  generatedAt: string | null;
  total: number;
  regions: RegionSummary[];
  unassigned: RegionSummary;
  coverageError: string | null;
  rows: RegionalRow[];
}

// ── helpers ──────────────────────────────────────────────────────────────────
type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

const money = (n: number | null | undefined) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
const money0 = (n: number | null | undefined) => (n == null ? "$0" : `$${Math.round(Number(n)).toLocaleString()}`);

function makeSortComparator(accessor: (r: RegionalRow) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: RegionalRow, b: RegionalRow) => {
    const av = accessor(a), bv = accessor(b);
    const aM = av == null || av === "", bM = bv == null || bv === "";
    if (aM && bM) return 0; if (aM) return 1; if (bM) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    const an = typeof av === "string" ? Number(av) : NaN, bn = typeof bv === "string" ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sign;
    const ad = typeof av === "string" ? Date.parse(av) : NaN, bd = typeof bv === "string" ? Date.parse(bv) : NaN;
    if (Number.isFinite(ad) && Number.isFinite(bd)) return (ad - bd) * sign;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true }) * sign;
  };
}

const chipBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, padding: "6px 12px", borderRadius: 999,
  border: `1px solid ${colors.rule}`, background: colors.surface, color: colors.inkSoft,
};

function MultiSelect({ label, options, values, onChange }: {
  label: string;
  options: Array<[string, number]>;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const toggle = (k: string) =>
    onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...chipBase, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, minWidth: 230, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1 }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 2, background: colors.surface,
  textAlign: "left", padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`,
  fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 600, color: colors.inkMuted,
  textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`,
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink,
  maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

// Column registry — one place, so header / sort / CSV can never drift apart.
const COLUMNS: Array<{ key: string; label: string; get: (r: RegionalRow) => unknown; render?: (r: RegionalRow) => React.ReactNode }> = [
  { key: "district", label: "District", get: (r) => r.tech_district ?? "" },
  { key: "truck", label: "Truck", get: (r) => r.vehicle_number },
  { key: "tech", label: "Tech", get: (r) => r.tech_name || r.renter_name_raw || "" },
  { key: "state", label: "Tech State", get: (r) => r.identity_state ?? "" },
  { key: "employment", label: "Employment", get: (r) => r.employee_status ?? "" },
  { key: "days_open", label: "Days Open", get: (r) => r.days_open },
  { key: "daily_cost", label: "Daily $", get: (r) => r.daily_cost, render: (r) => money(r.daily_cost) },
  { key: "ams", label: "AMS Status", get: (r) => r.ams_status ?? "" },
  { key: "ticket", label: "Ticket", get: (r) => r.ticket_status ?? "" },
  { key: "repairs", label: "Repairs Complete", get: (r) => r.repairs_complete ?? "" },
  { key: "basis", label: "Region Basis", get: (r) => r.region_basis },
];

export default function RegionalCases() {
  const { data, isLoading, error, isFetching } = useQuery<RegionalModel>({
    queryKey: ["/api/vrm/rental-operations/by-region"],
    refetchOnWindowFocus: true,
  });

  // Filter + sort state lives above the query result on purpose: a 30-minute
  // refetch must not reset what the lead is looking at.
  const [region, setRegion] = useState<RegionKey | "unassigned">("east");
  const [grouped, setGrouped] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [fDistrict, setFDistrict] = useState<string[]>([]);
  const [fAms, setFAms] = useState<string[]>([]);
  const [fTicket, setFTicket] = useState<string[]>([]);
  const [fEmployment, setFEmployment] = useState<string[]>([]);
  const [fRepairs, setFRepairs] = useState<string[]>([]);

  const allRows = data?.rows ?? [];
  const summaries: RegionSummary[] = useMemo(
    () => [...(data?.regions ?? []), ...(data?.unassigned && data.unassigned.caseCount > 0 ? [data.unassigned] : [])],
    [data],
  );

  // Everything in the selected region, before the column filters. This is the
  // denominator for both the filter option counts and "N shown of M".
  const regionPool = useMemo(
    () => allRows.filter((r) => (r.region ?? "unassigned") === region),
    [allRows, region],
  );

  const countsOf = (get: (r: RegionalRow) => string): Array<[string, number]> => {
    const m = new Map<string, number>();
    for (const r of regionPool) {
      const k = get(r) || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const districtOptions = useMemo(() => countsOf((r) => r.tech_district ?? ""), [regionPool]);
  const amsOptions = useMemo(() => countsOf((r) => r.ams_status ?? ""), [regionPool]);
  const ticketOptions = useMemo(() => countsOf((r) => r.ticket_status ?? ""), [regionPool]);
  const employmentOptions = useMemo(() => countsOf((r) => r.employee_status ?? ""), [regionPool]);
  const repairsOptions = useMemo(() => countsOf((r) => r.repairs_complete ?? ""), [regionPool]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (vals: string[], v: string) => vals.length === 0 || vals.includes(v || "—");
    return regionPool.filter((r) =>
      match(fDistrict, r.tech_district ?? "") &&
      match(fAms, r.ams_status ?? "") &&
      match(fTicket, r.ticket_status ?? "") &&
      match(fEmployment, r.employee_status ?? "") &&
      match(fRepairs, r.repairs_complete ?? "") &&
      (q === "" ||
        [r.vehicle_number, r.tech_name, r.renter_name_raw, r.tech_district, r.case_key]
          .some((f) => String(f ?? "").toLowerCase().includes(q))),
    );
  }, [regionPool, fDistrict, fAms, fTicket, fEmployment, fRepairs, search]);

  const col = COLUMNS.find((c) => c.key === sort.col);
  const cmp = col ? makeSortComparator(col.get, sort.dir) : null;

  const sorted = useMemo(() => (cmp ? [...filtered].sort(cmp) : filtered), [filtered, cmp]);

  /**
   * Districts stay together. Grouping is the default view and the whole point of
   * the page: the active column sort applies WITHIN each district, and districts
   * themselves are ordered by case count. Toggle it off for a flat sort across
   * the whole region.
   */
  const groups = useMemo(() => {
    if (!grouped) return null;
    const m = new Map<string, RegionalRow[]>();
    for (const r of sorted) {
      const k = (r.tech_district ?? "").trim() || "(no district)";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.entries())
      .map(([district, rows]) => ({
        district,
        rows,
        dailyCostTotal: rows.reduce((s, r) => s + (Number(r.daily_cost) || 0), 0),
        split: rows.some((r) => r.district_split),
        inferred: rows.some((r) => r.district_inferred),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.district.localeCompare(b.district));
  }, [sorted, grouped]);

  const exportCsv = () => {
    const headers = COLUMNS.map((c) => c.label);
    const body = sorted.map((r) =>
      COLUMNS.map((c) => {
        const v = c.get(r);
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }),
    );
    const csv = [headers.join(","), ...body.map((r) => r.join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental_cases_${region}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Th = ({ colKey, label, style }: { colKey: string; label: string; style?: React.CSSProperties }) => {
    const active = sort.col === colKey && sort.dir != null;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    const onClick = () =>
      setSort((s) => (s.col !== colKey ? { col: colKey, dir: "asc" } : s.dir === "asc" ? { col: colKey, dir: "desc" } : { col: null, dir: null }));
    return (
      <th style={{ ...thStyle, ...style }}>
        <button type="button" onClick={onClick}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }}>
          <span>{label}</span>
          <Icon size={11} style={{ opacity: active ? 1 : 0.4, color: active ? colors.accent : "inherit" }} />
        </button>
      </th>
    );
  };

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading regional cases…</div>;
  if (error) return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>
      Failed to load: {String((error as any)?.message || error)}
      <div style={{ color: colors.inkMuted, marginTop: 8, fontSize: 12 }}>
        If this persists, <code>/api/vrm/rental-operations/by-region</code> may not be deployed yet (restart/publish the server).
      </div>
    </div>
  );

  const activeSummary = summaries.find((s) => s.region === region);
  const anyFilter = fDistrict.length + fAms.length + fTicket.length + fEmployment.length + fRepairs.length > 0 || search.trim() !== "";

  return (
    <div>
      {data?.coverageError && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: colors.redLight, border: `1px solid ${colors.red}`, color: colors.red, fontFamily: fonts.dmSans, fontSize: 12.5 }}>
          Region state coverage is broken: {data.coverageError}. Cases are falling into Unassigned until it is fixed.
        </div>
      )}

      {/* Region tabs — EAST, CENTRAL, WEST, then Unassigned only when non-empty. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {summaries.map((s) => {
          const active = s.region === region;
          return (
            <button key={s.region} type="button" onClick={() => setRegion(s.region)}
              style={{
                ...chipBase, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
                ...(active ? { borderColor: colors.accent, color: colors.accent, background: colors.accentLight } : {}),
              }}>
              <span style={{ fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 11 }}>{s.caseCount}</span>
              <span style={{ color: colors.inkMuted, fontSize: 11 }}>
                {s.districtCount} {s.districtCount === 1 ? "district" : "districts"} · {money0(s.dailyCostTotal)}/day
              </span>
            </button>
          );
        })}
      </div>

      {activeSummary && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, marginBottom: 14 }}>
          <b style={{ color: colors.ink }}>{activeSummary.label}</b>
          {activeSummary.owner ? <> · recovery owner {activeSummary.owner}</> : null}
          {" · "}{activeSummary.caseCount} open cases across {activeSummary.districtCount} districts
          {" · "}{money0(activeSummary.dailyCostTotal)}/day
          {data?.generatedAt ? <span style={{ color: colors.inkMuted }}> · as of {new Date(data.generatedAt).toLocaleString()}</span> : null}
          {isFetching ? <span style={{ color: colors.amber }}> · refreshing…</span> : null}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <Search size={13} style={{ position: "absolute", left: 10, color: colors.inkMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search truck, tech, district…"
            style={{ ...chipBase, paddingLeft: 30, minWidth: 240, color: colors.ink }} />
        </div>
        <MultiSelect label="districts" options={districtOptions} values={fDistrict} onChange={setFDistrict} />
        <MultiSelect label="AMS" options={amsOptions} values={fAms} onChange={setFAms} />
        <MultiSelect label="tickets" options={ticketOptions} values={fTicket} onChange={setFTicket} />
        <MultiSelect label="employment" options={employmentOptions} values={fEmployment} onChange={setFEmployment} />
        <MultiSelect label="repairs" options={repairsOptions} values={fRepairs} onChange={setFRepairs} />

        <button type="button" onClick={() => setGrouped((g) => !g)}
          style={{ ...chipBase, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...(grouped ? { borderColor: colors.accent, color: colors.accent } : {}) }}
          title="Districts stay grouped together inside the region. Turn off for a flat sort.">
          <Layers size={12} /> {grouped ? "grouped by district" : "flat"}
        </button>

        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {sorted.length} shown of {regionPool.length}
          {anyFilter ? <> · <button type="button" onClick={() => { setFDistrict([]); setFAms([]); setFTicket([]); setFEmployment([]); setFRepairs([]); setSearch(""); }}
            style={{ background: "transparent", border: "none", color: colors.accent, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12, padding: 0 }}>clear all</button></> : null}
        </span>
        <button type="button" onClick={exportCsv}
          style={{ ...chipBase, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          title="Exports exactly what is on screen: current region, filters and sort.">
          <Download size={12} /> CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, overflow: "auto", maxHeight: "calc(100vh - 300px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{COLUMNS.map((c) => <Th key={c.key} colKey={c.key} label={c.label} />)}</tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} style={{ ...tdStyle, color: colors.inkMuted, textAlign: "center", padding: 28 }}>
                No cases match the current filters.
              </td></tr>
            )}

            {groups
              ? groups.map((g) => (
                  <Fragment key={g.district}>
                    <tr>
                      <td colSpan={COLUMNS.length}
                        style={{ padding: "8px 10px", background: colors.background, borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, fontSize: 11.5, fontWeight: 600, color: colors.inkSoft, position: "sticky", top: 34, zIndex: 1 }}>
                        District {g.district}
                        <span style={{ fontFamily: fonts.jetbrains, fontWeight: 400, color: colors.inkMuted, marginLeft: 8 }}>
                          {g.rows.length} {g.rows.length === 1 ? "case" : "cases"} · {money0(g.dailyCostTotal)}/day
                        </span>
                        {g.split && (
                          <span title="Technicians in this district resolve to more than one region. It is kept whole and filed under the region most of them are in."
                            style={{ marginLeft: 8, fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700, color: colors.amber, background: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 999, padding: "0 6px", textTransform: "uppercase" }}>
                            cross-region
                          </span>
                        )}
                        {g.inferred && (
                          <span title="No technician home state was available for this district. Region inferred from shop / renting state."
                            style={{ marginLeft: 6, fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700, color: colors.inkMuted, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 999, padding: "0 6px", textTransform: "uppercase" }}>
                            inferred
                          </span>
                        )}
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.case_key}>
                        {COLUMNS.map((c) => (
                          <td key={c.key} style={tdStyle} title={String(c.get(r) ?? "")}>
                            {c.render ? c.render(r) : String(c.get(r) ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))
              : sorted.map((r) => (
                  <tr key={r.case_key}>
                    {COLUMNS.map((c) => (
                      <td key={c.key} style={tdStyle} title={String(c.get(r) ?? "")}>
                        {c.render ? c.render(r) : String(c.get(r) ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
