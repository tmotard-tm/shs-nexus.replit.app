/**
 * Rental Technician Survey — results.
 *
 * Two views over the same responses, because a rental has two identities that
 * routinely disagree: the technician who is driving it, and the truck it is
 * billed against. "By Renter" answers who is in a rental. "By Truck" answers
 * which vehicle numbers are involved, and it lists a truck under BOTH the
 * number the rental was written against and the number the technician is
 * actually assigned, so a mismatch shows up on both sides instead of hiding.
 *
 * Table conventions per the standing standard: every header sorts (3-state),
 * every categorical filter is multi-select with live counts, "N shown of M",
 * search, and a CSV that exports the filtered and sorted view rather than the
 * raw set. Inline styles from ../lib/constants, matching the rest of VRM.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Search, Download, X,
} from "lucide-react";
import { colors, fonts } from "../lib/constants";

type SortDir = "asc" | "desc" | null;
type SortState = { col: string | null; dir: SortDir };

interface SurveyRow {
  id: string;
  ldap: string;
  tech_name: string | null;
  truck_number: string | null;
  has_rental: boolean | null;
  no_rental_reason: string | null;
  rental_company: string | null;
  rental_branch_name: string | null;
  rental_branch_city: string | null;
  rental_branch_state: string | null;
  rental_branch_phone: string | null;
  rental_vehicle_desc: string | null;
  rental_truck_number: string | null;
  assigned_truck_number: string | null;
  truck_mismatch: boolean | null;
  record_mismatch: boolean | null;
  van_status: string | null;
  shop_name: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_phone: string | null;
  promised_ready_date: string | null;
  truck_decommissioned: boolean | null;
  techhub_still_using: boolean | null;
  decomm_detail: string | null;
  blocker: string | null;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  phone: string | null;
  batch: string | null;
}

const VAN_STATUS_LABEL: Record<string, string> = {
  in_shop: "In a repair shop",
  decommissioned: "Turned in / decommissioned",
  totaled: "Totaled",
  with_me: "Still has it",
  unknown_escalate: "UNKNOWN — escalated",
};

const NO_RENTAL_LABEL: Record<string, string> = {
  returned_it: "Returned it",
  never_had_one: "Never had one",
  back_in_my_van: "Back in own van",
};

function makeSortComparator<T>(accessor: (r: T) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: T, b: T) => {
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

const thBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase",
  letterSpacing: "0.04em", textAlign: "left", padding: "7px 10px", whiteSpace: "nowrap",
  background: colors.surface, borderBottom: `1px solid ${colors.rule}`,
  position: "sticky", top: 0, zIndex: 2,
};

const tdBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink,
  padding: "8px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap",
  maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis",
};

const ctrl: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface,
  border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px",
};

function SortHeader({ col, text, sort, setSort, style }: {
  col: string; text: string; sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  style?: React.CSSProperties;
}) {
  const active = sort.col === col && sort.dir != null;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const onClick = () =>
    setSort((s) => (s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null }));
  return (
    <th style={{ ...thBase, ...style }}
        title={active ? `Sorted ${sort.dir === "asc" ? "ascending" : "descending"}` : `Sort by ${text}`}>
      <button type="button" onClick={onClick}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.accent : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: active ? 700 : undefined }}>
        <span>{text}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

function MultiSelect({ label, options, values, onChange }: {
  label: string; options: Array<[string, number]>; values: string[]; onChange: (n: string[]) => void;
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
        style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 250, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.length === 0 && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, padding: "6px 8px" }}>no values</div>}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 165, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return (
    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{text}</span>
  );
}

const counted = (rows: SurveyRow[], get: (r: SurveyRow) => string | null | undefined): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (get(r) ?? "").trim();
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  // Array.from, not a spread: this repo targets ES5 and iterator spreads do not compile.
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

const fmtDate = (v: string | null) => (v ? String(v).slice(0, 10) : "");

export default function RentalSurvey() {
  const [view, setView] = useState<"renter" | "truck">("renter");
  const [sort, setSort] = useState<SortState>({ col: null, dir: null });
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fCompany, setFCompany] = useState<string[]>([]);
  const [fState, setFState] = useState<string[]>([]);
  const [fFlag, setFFlag] = useState<string[]>([]);
  const [detail, setDetail] = useState<SurveyRow | null>(null);

  const { data, isLoading, error } = useQuery<{ responses: SurveyRow[] }>({
    queryKey: ["/api/vrm/forms/rental-survey/responses"],
    refetchInterval: 60_000,
  });
  const { data: stats } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-survey/stats"],
    refetchInterval: 60_000,
  });

  const rows = data?.responses ?? [];

  // "By Truck" explodes each response onto every distinct truck number it
  // references, so a mismatched pair appears under both numbers.
  type Row = SurveyRow & { _truck: string; _role?: string };
  const base: Row[] = useMemo(() => {
    if (view === "renter") {
      return rows.map((r) => ({ ...r, _truck: r.assigned_truck_number || r.truck_number || "" }));
    }
    const out: Row[] = [];
    for (const r of rows) {
      const a = (r.assigned_truck_number || "").trim();
      const b = (r.rental_truck_number || "").trim();
      const fallback = (r.truck_number || "").trim();
      const seen = new Set<string>();
      for (const [t, role] of [[a, "assigned"], [b, "rental"], [!a && !b ? fallback : "", "on file"]] as const) {
        const key = String(t).trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...r, _truck: key, _role: role });
      }
    }
    return out;
  }, [rows, view]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base.filter((r) => {
      if (fStatus.length && !fStatus.includes(VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status ?? "")) return false;
      if (fCompany.length && !fCompany.includes(r.rental_company ?? "")) return false;
      if (fState.length && !fState.includes(r.rental_branch_state ?? "")) return false;
      if (fFlag.length) {
        const flags: string[] = [];
        if (r.truck_mismatch) flags.push("Truck mismatch");
        if (r.van_status === "unknown_escalate") flags.push("Escalated");
        if (r.techhub_still_using === false) flags.push("No truck number");
        if (r.has_rental === false) flags.push("Out of rental");
        if (!flags.some((f) => fFlag.includes(f))) return false;
      }
      if (!needle) return true;
      return [r.ldap, r.tech_name, r._truck, r.rental_truck_number, r.assigned_truck_number,
              r.shop_name, r.rental_branch_city, r.rental_company]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [base, q, fStatus, fCompany, fState, fFlag]);

  const accessors: Record<string, (r: Row) => unknown> = {
    truck: (r) => r._truck,
    ldap: (r) => r.ldap,
    name: (r) => r.tech_name,
    rental: (r) => (r.has_rental == null ? "" : r.has_rental ? "Yes" : "No"),
    company: (r) => r.rental_company,
    branch: (r) => `${r.rental_branch_city ?? ""} ${r.rental_branch_state ?? ""}`.trim(),
    rtruck: (r) => r.rental_truck_number,
    atruck: (r) => r.assigned_truck_number,
    status: (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status,
    shop: (r) => r.shop_name,
    ready: (r) => r.promised_ready_date,
    submitted: (r) => r.created_at,
  };

  const sorted = useMemo(() => {
    const cmp = sort.col ? makeSortComparator<Row>(accessors[sort.col] ?? (() => ""), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const exportCsv = () => {
    const cols: Array<[string, (r: Row) => unknown]> = [
      ["truck", (r) => r._truck], ["ldap", (r) => r.ldap], ["tech_name", (r) => r.tech_name],
      ["in_rental", (r) => (r.has_rental == null ? "" : r.has_rental ? "Yes" : "No")],
      ["no_rental_reason", (r) => NO_RENTAL_LABEL[r.no_rental_reason ?? ""] ?? r.no_rental_reason],
      ["rental_company", (r) => r.rental_company],
      ["branch_city", (r) => r.rental_branch_city], ["branch_state", (r) => r.rental_branch_state],
      ["branch_name", (r) => r.rental_branch_name], ["branch_phone", (r) => r.rental_branch_phone],
      ["rental_vehicle", (r) => r.rental_vehicle_desc],
      ["rental_truck", (r) => r.rental_truck_number], ["assigned_truck", (r) => r.assigned_truck_number],
      ["truck_mismatch", (r) => (r.truck_mismatch ? "YES" : "")],
      ["van_status", (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status],
      ["shop_name", (r) => r.shop_name], ["shop_city", (r) => r.shop_city], ["shop_state", (r) => r.shop_state],
      ["shop_phone", (r) => r.shop_phone], ["promised_ready", (r) => r.promised_ready_date],
      ["techhub_still_using", (r) => (r.techhub_still_using == null ? "" : r.techhub_still_using ? "Yes" : "No")],
      ["blocker", (r) => r.blocker], ["submitted_at", (r) => r.created_at],
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => c[0]).join(","),
      ...sorted.map((r) => cols.map(([, f]) => esc(f(r))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental-survey-${view}-${sorted.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading survey responses…</div>;
  if (error) return <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>Failed to load: {String((error as any)?.message || error)}</div>;

  const s = stats ?? {};
  const submitted = Number(s.submitted ?? 0);
  const sent = Number(s.sent ?? 0);
  const rate = sent ? Math.round((submitted / sent) * 100) : 0;

  return (
    <div style={{ padding: "18px 22px 40px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Card label="Responses" value={String(submitted)} hint={sent ? `${rate}% of ${sent} sent` : "nothing sent yet"} />
        <Card label="Still in a rental" value={String(s.still_in_rental ?? 0)}
              hint={`${s.no_longer_in_rental ?? 0} say they are out`} fg={colors.amber} />
        <Card label="Truck mismatch" value={String(s.truck_mismatch ?? 0)}
              hint="rental truck ≠ assigned truck" fg={colors.red} />
        <Card label="Escalations" value={String(s.escalations ?? 0)}
              hint="van location unknown" fg={colors.redDeep} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
          {(["renter", "truck"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              style={{ ...ctrl, border: "none", borderRadius: 0, cursor: "pointer",
                       background: view === v ? colors.accent : colors.surface,
                       color: view === v ? "#fff" : colors.ink, fontWeight: view === v ? 700 : 400 }}>
              By {v === "renter" ? "Renter" : "Truck"}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", display: "inline-block" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: colors.inkMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ldap, name, truck, shop, city"
                 style={{ ...ctrl, paddingLeft: 26, minWidth: 240 }} />
        </div>

        <MultiSelect label="statuses" values={fStatus} onChange={setFStatus}
          options={counted(rows, (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status)} />
        <MultiSelect label="companies" values={fCompany} onChange={setFCompany}
          options={counted(rows, (r) => r.rental_company)} />
        <MultiSelect label="states" values={fState} onChange={setFState}
          options={counted(rows, (r) => r.rental_branch_state)} />
        <MultiSelect label="flags" values={fFlag} onChange={setFFlag}
          options={[
            ["Truck mismatch", rows.filter((r) => r.truck_mismatch).length],
            ["Escalated", rows.filter((r) => r.van_status === "unknown_escalate").length],
            ["No truck number", rows.filter((r) => r.techhub_still_using === false).length],
            ["Out of rental", rows.filter((r) => r.has_rental === false).length],
          ].filter((o) => (o[1] as number) > 0) as Array<[string, number]>} />

        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {sorted.length} shown of {base.length}
        </span>

        <button type="button" onClick={exportCsv}
          style={{ ...ctrl, cursor: "pointer", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {sorted.length === 0 ? (
        <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: "40px 0" }}>
          {rows.length === 0 ? "No survey responses yet." : "No rows match the current filters."}
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 300px)", border: `1px solid ${colors.rule}`, borderRadius: 12, background: colors.surface }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <SortHeader col="truck" text="Truck" sort={sort} setSort={setSort} />
                <SortHeader col="ldap" text="LDAP" sort={sort} setSort={setSort} />
                <SortHeader col="name" text="Technician" sort={sort} setSort={setSort} />
                <SortHeader col="rental" text="In rental" sort={sort} setSort={setSort} />
                <SortHeader col="company" text="Company" sort={sort} setSort={setSort} />
                <SortHeader col="branch" text="Pickup branch" sort={sort} setSort={setSort} />
                <SortHeader col="rtruck" text="Rental truck" sort={sort} setSort={setSort} />
                <SortHeader col="atruck" text="Assigned truck" sort={sort} setSort={setSort} />
                <SortHeader col="status" text="Van status" sort={sort} setSort={setSort} />
                <SortHeader col="shop" text="Shop" sort={sort} setSort={setSort} />
                <SortHeader col="ready" text="Promised" sort={sort} setSort={setSort} />
                <SortHeader col="submitted" text="Submitted" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.id}-${r._truck}-${i}`} onClick={() => setDetail(r)}
                    style={{ cursor: "pointer", background: r.truck_mismatch ? colors.redLight : undefined }}>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains, fontWeight: 600 }}>
                    {r._truck || "—"}
                    {r._role && <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 10.5, marginLeft: 6 }}>{r._role}</span>}
                  </td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.ldap}</td>
                  <td style={tdBase} title={r.tech_name ?? ""}>{r.tech_name || "—"}</td>
                  <td style={tdBase}>
                    {r.has_rental == null ? "—" : r.has_rental
                      ? <Pill text="Yes" fg={colors.amber} bg={colors.amberLight} />
                      : <Pill text={NO_RENTAL_LABEL[r.no_rental_reason ?? ""] ?? "No"} fg={colors.green} bg={colors.greenLight} />}
                  </td>
                  <td style={tdBase}>{r.rental_company || "—"}</td>
                  <td style={tdBase} title={r.rental_branch_name ?? ""}>
                    {r.rental_branch_city ? `${r.rental_branch_city}, ${r.rental_branch_state ?? ""}` : "—"}
                  </td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.rental_truck_number || "—"}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>
                    {r.assigned_truck_number || "—"}
                    {r.truck_mismatch && <span style={{ marginLeft: 6 }}><Pill text="mismatch" fg={colors.red} bg={colors.redLight} /></span>}
                  </td>
                  <td style={tdBase}>
                    {r.van_status === "unknown_escalate"
                      ? <Pill text="UNKNOWN" fg={colors.red} bg={colors.redLight} />
                      : (VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status ?? "—")}
                  </td>
                  <td style={tdBase} title={r.shop_name ?? ""}>{r.shop_name || "—"}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{fmtDate(r.promised_ready_date)}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div onClick={() => setDetail(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: 460, maxWidth: "92vw", height: "100%", overflowY: "auto", background: colors.background, borderLeft: `1px solid ${colors.rule}`, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink }}>
                {detail.tech_name || detail.ldap}
              </div>
              <button type="button" onClick={() => setDetail(null)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted }}>
                <X size={18} />
              </button>
            </div>
            {([
              ["LDAP", detail.ldap],
              ["In a rental", detail.has_rental == null ? "—" : detail.has_rental ? "Yes" : (NO_RENTAL_LABEL[detail.no_rental_reason ?? ""] ?? "No")],
              ["Rental company", detail.rental_company],
              ["Pickup branch", [detail.rental_branch_name, detail.rental_branch_city, detail.rental_branch_state].filter(Boolean).join(", ")],
              ["Branch phone", detail.rental_branch_phone],
              ["Driving", detail.rental_vehicle_desc],
              ["Rental truck #", detail.rental_truck_number],
              ["Assigned truck #", detail.assigned_truck_number],
              ["Truck mismatch", detail.truck_mismatch ? "YES" : "no"],
              ["Van status", VAN_STATUS_LABEL[detail.van_status ?? ""] ?? detail.van_status],
              ["Shop", [detail.shop_name, detail.shop_city, detail.shop_state].filter(Boolean).join(", ")],
              ["Shop phone", detail.shop_phone],
              ["Promised ready", fmtDate(detail.promised_ready_date)],
              ["Decommissioned", detail.truck_decommissioned ? "yes" : ""],
              ["Where it went", detail.decomm_detail],
              ["TechHub still using #", detail.techhub_still_using == null ? "" : detail.techhub_still_using ? "Yes" : "NO — no working truck number"],
              ["Blocker", detail.blocker],
              ["Texted", fmtDate(detail.sent_at)],
              ["Opened", fmtDate(detail.opened_at)],
              ["Submitted", fmtDate(detail.created_at)],
            ] as Array<[string, unknown]>)
              .filter(([, v]) => String(v ?? "").trim() !== "")
              .map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${colors.rule}` }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 150 }}>{k}</div>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, flex: 1, wordBreak: "break-word" }}>{String(v)}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
