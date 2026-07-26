import './_group.css';
import { useState, useMemo } from "react";
import {
  Search, RefreshCw, AlertTriangle, PhoneCall, ChevronRight, Activity, Clock, FileWarning, Briefcase
} from "lucide-react";

const fonts = {
  syne: "'Syne', sans-serif",
  dmSans: "'DM Sans', sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};
const colors = {
  background: "var(--vrm-background)",
  surface: "var(--vrm-surface)",
  ink: "var(--vrm-ink)",
  inkSoft: "var(--vrm-ink-soft)",
  inkMuted: "var(--vrm-ink-muted)",
  rule: "var(--vrm-rule)",
  accent: "var(--vrm-accent)",
  accentLight: "var(--vrm-accent-light)",
  green: "var(--vrm-green)",
  greenLight: "var(--vrm-green-light)",
  amber: "var(--vrm-amber)",
  amberLight: "var(--vrm-amber-light)",
  red: "var(--vrm-red)",
  redLight: "var(--vrm-red-light)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
};

interface MasterRow {
  case_key: string; vehicle_number: string; source: string; rental_vendor: string | null; renter_name_raw: string; ticket_number: string | null; po_number: string | null; ticket_status: string | null; rental_start_date: string | null; po_date: string | null; days_open: number | null; days_authorized: number | null; number_of_extensions: number | null; repairs_complete: string | null; renting_city: string | null; renting_state: string | null; veh_desc: string | null; rental_class: string | null; daily_cost: number | null; class_bucket: string; actual_vehicle_type: string; actual_bucket: string; type_mismatch: boolean; class_median: number | null; cost_delta: number | null; cost_over: boolean; identity_state: string | null; identity_method: string | null; identity_confidence: string | null; employee_id: string | null; employee_status: string | null; employee_status_date: string | null; tech_name: string | null; tech_district: string | null; identity_reason: string | null; identity_is_override: boolean; has_open_repair: boolean | null; repair_cohort: string; open_po_count: number; po_count: number; last_rental_date: string | null; has_rental_auth: boolean; no_rental_auth: boolean; tpms_tech: string | null; renter_own_truck: string | null; wrong_truck: boolean; odometer: number | null; odometer_date: string | null; portal_msg_count: number | null; portal_shop_phone: string | null; has_portal: boolean; callable: boolean; shop_name: string | null; shop_address: string | null; shop_city: string | null; shop_state: string | null; shop_zip: string | null; shop_po_number: string | null; shop_po_status: string | null; shop_po_date: string | null; assigned_truck: string | null; assigned_truck_mismatch: boolean; assigned_truck_open_po_count: number; assigned_truck_has_repair_po: boolean | null; workload_bucket: "cannot_work" | "mismatch_no_po" | "workable"; redirect_to_assigned: boolean; call_target_truck: string | null; call_shop_name: string | null; call_shop_phone: string | null; call_shop_address: string | null; call_shop_po_number: string | null; call_shop_po_status: string | null; ams_status: string | null; ams_bucket: string; operator_mark: string | null; mark_note: string | null; mark_actor: string | null; mark_at: string | null; present_in_latest: boolean; last_seen_at: string | null;
}

const money = (n: number | null | undefined) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(s);
}
function fmtPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "");
}
function fmtAgo(s: string | null) {
    if (!s) return "";
    const t = Date.parse(s);
    if (isNaN(t)) return "";
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// BYOV = tech's own vehicle (truck number starts with 88 or 088). BYOV repairs are
// not tracked, so these rows never have shop info. Check the RAW number — never
// zero-pad first (padding "88144" to "088144" would break the prefix test).
function isByov(truckNo: string | null | undefined): boolean {
  const raw = String(truckNo ?? "").trim();
  return raw.startsWith("88") || raw.startsWith("088");
}

function mk(overrides: Partial<MasterRow>): MasterRow {
  return {
    case_key: "", vehicle_number: "", source: "holman_etl", rental_vendor: "Enterprise",
    renter_name_raw: "", ticket_number: null, po_number: null, ticket_status: "OPEN",
    rental_start_date: null, po_date: null, days_open: null, days_authorized: null,
    number_of_extensions: null, repairs_complete: null, renting_city: null, renting_state: null,
    veh_desc: null, rental_class: null, daily_cost: null, class_bucket: "SUV/VAN/TRUCK",
    actual_vehicle_type: "Cargo Van", actual_bucket: "SUV/VAN/TRUCK", type_mismatch: false,
    class_median: null, cost_delta: null, cost_over: false, identity_state: "confirmed",
    identity_method: "exact_name", identity_confidence: "high", employee_id: null,
    employee_status: "Active", employee_status_date: null, tech_name: null, tech_district: null,
    identity_reason: null, identity_is_override: false, has_open_repair: false,
    repair_cohort: "no_open_repair", open_po_count: 0, po_count: 0, last_rental_date: null,
    has_rental_auth: false, no_rental_auth: false, tpms_tech: null, renter_own_truck: null,
    wrong_truck: false, odometer: null, odometer_date: null, portal_msg_count: 0,
    portal_shop_phone: null, has_portal: false, callable: false, shop_name: null,
    shop_address: null, shop_city: null, shop_state: null, shop_zip: null, shop_po_number: null,
    shop_po_status: null, shop_po_date: null, assigned_truck: null, assigned_truck_mismatch: false,
    assigned_truck_open_po_count: 0, assigned_truck_has_repair_po: null, workload_bucket: "workable",
    redirect_to_assigned: false, call_target_truck: null, call_shop_name: null, call_shop_phone: null,
    call_shop_address: null, call_shop_po_number: null, call_shop_po_status: null,
    ams_status: null, ams_bucket: "unknown", operator_mark: null, mark_note: null,
    mark_actor: null, mark_at: null, present_in_latest: true, last_seen_at: null,
    ...overrides
  };
}

const MOCK_ROWS: MasterRow[] = [
  mk({
    case_key: "1", vehicle_number: "61385", renter_name_raw: "Smith, John",
    rental_start_date: "2026-06-15", days_open: 42, daily_cost: 95.50, class_median: 75.00,
    cost_delta: 20.50, cost_over: true, rental_class: "Premium SUV", tech_name: "John Smith",
    employee_status: "Active", ams_bucket: "in_repair", shop_name: "Bob's Auto", callable: true,
    has_portal: true, portal_msg_count: 3, call_shop_phone: "5551234567", shop_po_status: "Awaiting Parts",
    operator_mark: "open", mark_note: "Called shop, parts arriving tomorrow.", mark_actor: "Sarah J.",
    mark_at: new Date(Date.now() - 3600000).toISOString(), workload_bucket: "workable",
    has_open_repair: true
  }),
  mk({
    case_key: "2", vehicle_number: "82041", renter_name_raw: "Doe, Jane",
    rental_start_date: "2026-07-20", days_open: 7, daily_cost: 65.00, cost_over: false,
    rental_class: "Standard Van", tech_name: "Jane Doe", employee_status: "Term/Leave",
    ams_bucket: "in_use", shop_name: "City Garage", callable: false, has_portal: false,
    workload_bucket: "cannot_work", repair_cohort: "pended"
  }),
  mk({
    case_key: "3", vehicle_number: "40192", renter_name_raw: "Brown, Bob",
    rental_start_date: "2026-07-01", days_open: 26, daily_cost: 110.00, class_median: 80.00,
    cost_delta: 30.00, cost_over: true, type_mismatch: true, tech_name: "Bob Brown",
    employee_status: "Active", ams_bucket: "declined", shop_name: "Fleet Services Inc", callable: true,
    workload_bucket: "cannot_work"
  }),
  mk({
    case_key: "4", vehicle_number: "99214", renter_name_raw: "White, Alice",
    rental_start_date: "2026-07-10", days_open: 17, daily_cost: 72.00, cost_over: false,
    tech_name: "Alice White", employee_status: "Active", ams_bucket: "in_repair", shop_name: "Quick Fix",
    callable: true, workload_bucket: "workable", has_open_repair: true, repair_cohort: "pended"
  }),
  // BYOV truck (88-prefix): tech drives their own vehicle, repairs not tracked → no shop info, never callable
  mk({
    case_key: "5", vehicle_number: "88217", renter_name_raw: "Herrera, Luis",
    rental_start_date: "2026-07-15", days_open: 11, daily_cost: 46.00, cost_over: false,
    rental_class: "Cargo Van", tech_name: "Luis Herrera", employee_status: "Active",
    ams_bucket: "in_use", callable: false, workload_bucket: "workable"
  })
];

type TabId = "work_queue" | "waiting" | "cant_work" | "all";

export function WorkQueue() {
  const [tab, setTab] = useState<TabId>("work_queue");
  const [search, setSearch] = useState("");
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<string | null>(null);

  const toggleChip = (c: string) => {
    setChips(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const totals = useMemo(() => {
    let t_wq = 0, t_waiting = 0, t_cant = 0;
    let costOver = 0;
    for (const r of MOCK_ROWS) {
      const isWaiting = r.repair_cohort === "pended" || r.ams_bucket === "in_repair" || r.has_open_repair;
      const isCant = r.ams_bucket === "declined" || r.ams_bucket === "auction" || r.employee_status === "Term/Leave";
      
      if (r.workload_bucket === "workable" && r.callable) t_wq++;
      if (isWaiting) t_waiting++;
      if (isCant) t_cant++;
      if (r.cost_over) costOver++;
    }
    return { wq: t_wq, waiting: t_waiting, cant: t_cant, all: MOCK_ROWS.length, costOver };
  }, []);

  const filteredRows = useMemo(() => {
    return MOCK_ROWS.filter(r => {
      // Search
      if (search) {
        const q = search.toLowerCase();
        if (!r.vehicle_number.toLowerCase().includes(q) &&
            !(r.tech_name || "").toLowerCase().includes(q)) return false;
      }
      // Tab
      const isWaiting = r.repair_cohort === "pended" || r.ams_bucket === "in_repair" || r.has_open_repair;
      const isCant = r.ams_bucket === "declined" || r.ams_bucket === "auction" || r.employee_status === "Term/Leave";
      
      if (tab === "work_queue" && !(r.workload_bucket === "workable" && r.callable)) return false;
      if (tab === "waiting" && !isWaiting) return false;
      if (tab === "cant_work" && !isCant) return false;

      // Chips
      if (chips.has("mismatch") && !r.type_mismatch) return false;
      if (chips.has("no_portal") && r.has_portal) return false;
      if (chips.has("no_repair") && r.has_open_repair) return false;
      if (chips.has("new_hire") && r.employee_status !== "New Hire") return false;
      if (chips.has("term_leave") && r.employee_status !== "Term/Leave") return false;
      if (chips.has("byov") && !isByov(r.vehicle_number)) return false;

      return true;
    });
  }, [tab, search, chips]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: colors.background, color: colors.ink, fontFamily: fonts.dmSans, display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <header style={{ padding: "16px 24px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, margin: 0 }}>Rental Work Queue</h1>
          <div style={{ fontSize: 13, color: colors.inkMuted, marginTop: 4, display: "flex", gap: 16 }}>
            <span>Total open: <strong>{totals.all}</strong></span>
            <span>Workable: <strong>{totals.wq}</strong></span>
            <span>Cost over: <strong>{totals.costOver}</strong></span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: colors.inkMuted }} />
            <input
              type="text"
              placeholder="Search truck or tech..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "8px 12px 8px 32px", fontSize: 13, borderRadius: 6, border: `1px solid ${colors.rule}`, outline: "none", width: 220 }}
            />
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 13, borderRadius: 6, border: `1px solid ${colors.rule}`, backgroundColor: "#fff", cursor: "pointer" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: colors.green }} />
            Data health
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 24px" }}>
        
        {/* Tabs & Chips */}
        <div style={{ margin: "24px 0 16px" }}>
          <div style={{ display: "flex", gap: 24, borderBottom: `1px solid ${colors.rule}` }}>
            {(
              [
                { id: "work_queue", label: "Work queue", count: totals.wq },
                { id: "waiting", label: "Waiting", count: totals.waiting },
                { id: "cant_work", label: "Can't work", count: totals.cant },
                { id: "all", label: "All rentals", count: totals.all },
              ] as const
            ).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "0 4px 12px",
                  fontSize: 14,
                  fontWeight: tab === t.id ? 600 : 400,
                  color: tab === t.id ? colors.accent : colors.inkMuted,
                  borderBottom: `2px solid ${tab === t.id ? colors.accent : "transparent"}`,
                  background: "none",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}
              >
                {t.label}
                <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 99, backgroundColor: tab === t.id ? colors.accentLight : colors.rule, color: tab === t.id ? colors.accent : colors.inkMuted, fontFamily: fonts.jetbrains }}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Chips */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            {[
              { id: "mismatch", label: "Mismatch" },
              { id: "no_portal", label: "No portal history" },
              { id: "no_repair", label: "No open repair" },
              { id: "new_hire", label: "New hire" },
              { id: "term_leave", label: "Term/Leave" },
              { id: "byov", label: "BYOV" },
            ].map(c => (
              <button
                key={c.id}
                onClick={() => toggleChip(c.id)}
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  borderRadius: 16,
                  border: `1px solid ${chips.has(c.id) ? colors.accent : colors.rule}`,
                  backgroundColor: chips.has(c.id) ? colors.accentLight : "transparent",
                  color: chips.has(c.id) ? colors.accent : colors.inkMuted,
                  cursor: "pointer"
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, backgroundColor: "#fff", borderRadius: 8, border: `1px solid ${colors.rule}`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ overflowX: "auto", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Truck</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Tech</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Vehicle · Class</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Daily Cost</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Shop / PO Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Days Open</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Last Activity</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(r => (
                  <tr
                    key={r.case_key}
                    onClick={() => setSelectedRow(r.case_key)}
                    style={{
                      borderBottom: `1px solid ${colors.rule}`,
                      backgroundColor: selectedRow === r.case_key ? colors.surface : "#fff",
                      cursor: "pointer"
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontFamily: fonts.jetbrains }}>
                      {r.vehicle_number}
                      {isByov(r.vehicle_number) && (
                        <span style={{ marginLeft: 6, fontSize: 10, padding: "2px 5px", borderRadius: 4, backgroundColor: colors.blueLight, color: colors.blue, fontWeight: 600, fontFamily: fonts.dmSans }}>BYOV</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {r.tech_name || "Unknown"}
                        {r.employee_status === "Term/Leave" && (
                          <span style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, backgroundColor: colors.redLight, color: colors.red, fontWeight: 600 }}>Term</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ color: colors.ink }}>{r.veh_desc || "Unknown vehicle"}</div>
                      <div style={{ color: colors.inkMuted, fontSize: 11 }}>{r.rental_class}</div>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: fonts.jetbrains }}>
                      {money(r.daily_cost)}
                      {r.cost_delta ? (
                        <div style={{ color: colors.amber, fontSize: 11 }}>+{money(r.cost_delta)}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {isByov(r.vehicle_number) ? (
                        <div style={{ color: colors.inkMuted, fontStyle: "italic", fontSize: 12 }} title="BYOV trucks are the tech's own vehicle — repairs aren't tracked, so there is no shop to show or call.">BYOV — repairs not tracked</div>
                      ) : (<>
                        <div style={{ color: colors.ink }}>{r.shop_name || "—"}</div>
                        <div style={{ color: colors.inkMuted, fontSize: 11 }}>{r.shop_po_status || "—"}</div>
                      </>)}
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: fonts.jetbrains }}>
                      {r.days_open != null ? `${r.days_open}d` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ color: colors.ink }}>{r.operator_mark || "No mark"}</div>
                      <div style={{ color: colors.inkMuted, fontSize: 11 }}>{fmtAgo(r.mark_at)}</div>
                    </td>
                    <td style={{ padding: "12px 16px", display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
                      <button style={{ padding: "6px", borderRadius: 6, border: `1px solid ${colors.rule}`, backgroundColor: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: r.callable ? colors.accent : colors.inkMuted }} disabled={!r.callable}>
                        <PhoneCall size={14} /> Call
                      </button>
                      <div style={{ display: "flex", border: `1px solid ${colors.rule}`, borderRadius: 6, overflow: "hidden" }}>
                        {(["O", "C", "P"] as const).map(m => (
                          <button
                            key={m}
                            style={{
                              padding: "4px 8px",
                              border: "none",
                              backgroundColor: r.operator_mark?.[0]?.toUpperCase() === m ? colors.accentLight : "#fff",
                              color: r.operator_mark?.[0]?.toUpperCase() === m ? colors.accent : colors.inkMuted,
                              cursor: "pointer",
                              borderRight: m !== "P" ? `1px solid ${colors.rule}` : "none",
                              fontFamily: fonts.jetbrains,
                              fontSize: 12
                            }}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: "48px 0", textAlign: "center", color: colors.inkMuted }}>
                      No rentals match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default WorkQueue;
