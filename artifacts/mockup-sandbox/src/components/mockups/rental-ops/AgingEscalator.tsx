import './_group.css';
import { useState, useMemo } from "react";
import { Search, PhoneCall, AlertCircle, Clock, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";

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
  id: string;
  vehicle_number: string;
  tech_name: string | null;
  employee_status: string | null;
  veh_desc: string | null;
  rental_class: string | null;
  daily_cost: number | null;
  cost_delta: number | null;
  cost_over: boolean;
  shop_name: string | null;
  shop_po_status: string | null;
  days_open: number | null;
  operator_mark: string | null;
  mark_at: string | null;
  callable: boolean;
}

const mk = (o: Partial<MasterRow>): MasterRow => ({
  id: Math.random().toString(36).substring(7),
  vehicle_number: "", tech_name: null, employee_status: "Active",
  veh_desc: null, rental_class: null, daily_cost: null, cost_delta: null, cost_over: false,
  shop_name: null, shop_po_status: null, days_open: null, operator_mark: null, mark_at: null, callable: false,
  ...o
});

const MOCK_ROWS: MasterRow[] = [
  mk({ vehicle_number: "61385", tech_name: "John Smith", days_open: 42, daily_cost: 95.50, cost_delta: 20.50, cost_over: true, rental_class: "Premium SUV", shop_name: "Bob's Auto", shop_po_status: "Awaiting Parts", callable: true, operator_mark: "Open", mark_at: new Date(Date.now() - 86400000).toISOString() }),
  mk({ vehicle_number: "40192", tech_name: "Bob Brown", days_open: 32, daily_cost: 110.00, cost_delta: 30.00, cost_over: true, rental_class: "Cargo Van", shop_name: "Fleet Services Inc", shop_po_status: "Pending Estimate", callable: true, operator_mark: "Open", mark_at: new Date(Date.now() - 172800000).toISOString() }),
  mk({ vehicle_number: "99214", tech_name: "Alice White", days_open: 17, daily_cost: 72.00, rental_class: "Standard Van", shop_name: "Quick Fix", shop_po_status: "Approved", callable: true }),
  mk({ vehicle_number: "22019", tech_name: "Sam Green", days_open: 15, daily_cost: 80.00, rental_class: "Standard Van", employee_status: "New Hire", shop_name: "Dealer Shop", callable: true }),
  mk({ vehicle_number: "82041", tech_name: "Jane Doe", days_open: 9, daily_cost: 65.00, rental_class: "Standard Van", employee_status: "Term/Leave", shop_name: "City Garage", shop_po_status: "Completed", callable: false }),
  mk({ vehicle_number: "33100", tech_name: "Tom Black", days_open: 8, daily_cost: 55.00, rental_class: "Compact SUV", shop_name: "PepBoys", callable: true }),
  mk({ vehicle_number: "11299", tech_name: "Lisa Ray", days_open: 4, daily_cost: 60.00, rental_class: "Compact SUV", shop_name: "Firestone", shop_po_status: "In Shop", callable: true }),
  mk({ vehicle_number: "55432", tech_name: "Dave Hill", days_open: 2, daily_cost: 65.00, rental_class: "Standard Van", shop_name: "Local Garage", callable: true }),
  // BYOV truck
  mk({ vehicle_number: "88217", tech_name: "Luis Herrera", days_open: 22, daily_cost: 46.00, rental_class: "Cargo Van", callable: false }),
  mk({ vehicle_number: "08819", tech_name: "Mark Evans", days_open: 5, daily_cost: 45.00, rental_class: "Compact SUV", callable: false }),
];

const money = (n: number | null) => n == null ? "" : `$${n.toFixed(2)}`;
const isByov = (v: string) => String(v).trim().startsWith("88") || String(v).trim().startsWith("088");

function fmtAgo(s: string | null) {
  if (!s) return "—";
  const t = Date.parse(s);
  if (isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

type Band = { id: string; label: string; min: number; max: number; color: string; bgColor: string };
const BANDS: Band[] = [
  { id: "critical", label: "Critical (30d+)", min: 30, max: 9999, color: colors.red, bgColor: colors.redLight },
  { id: "escalate", label: "Escalate (15–29d)", min: 15, max: 29, color: colors.amber, bgColor: colors.amberLight },
  { id: "watch", label: "Watch (7–14d)", min: 7, max: 14, color: colors.blue, bgColor: colors.blueLight },
  { id: "fresh", label: "Fresh (<7d)", min: 0, max: 6, color: colors.green, bgColor: colors.greenLight },
];

export function AgingEscalator() {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => MOCK_ROWS.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.vehicle_number.toLowerCase().includes(q) || (r.tech_name || "").toLowerCase().includes(q) || (r.shop_name || "").toLowerCase().includes(q);
  }), [search]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: colors.background, color: colors.ink, fontFamily: fonts.dmSans, display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "20px 32px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
            <Clock className="text-amber-600" />
            Aging Escalator
          </h1>
          <div style={{ fontSize: 13, color: colors.inkMuted, marginTop: 4 }}>
            Rentals grouped by days open
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative" }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: 10, color: colors.inkMuted }} />
            <input
              type="text"
              placeholder="Search by truck, tech, shop..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "8px 16px 8px 36px", fontSize: 14, borderRadius: 8, border: `1px solid ${colors.rule}`, outline: "none", width: 260 }}
            />
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: "32px", display: "flex", flexDirection: "column", gap: 24 }}>
        {BANDS.map(band => {
          const rows = filtered.filter(r => (r.days_open ?? 0) >= band.min && (r.days_open ?? 0) <= band.max);
          if (rows.length === 0) return null;
          
          const totalCost = rows.reduce((acc, r) => acc + (r.daily_cost || 0), 0);
          const isCollapsed = collapsed.has(band.id);

          return (
            <div key={band.id} style={{ backgroundColor: "#fff", borderRadius: 12, border: `1px solid ${band.color}`, overflow: "hidden", boxShadow: `0 4px 12px ${band.bgColor}40` }}>
              <button 
                onClick={() => toggleCollapse(band.id)}
                style={{ width: "100%", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: band.bgColor, borderBottom: isCollapsed ? "none" : `1px solid ${band.color}40`, cursor: "pointer", border: "none", outline: "none", textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {isCollapsed ? <ChevronRight size={20} color={band.color} /> : <ChevronDown size={20} color={band.color} />}
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: band.color, fontFamily: fonts.syne }}>{band.label}</h2>
                  <span style={{ fontSize: 13, fontWeight: 600, padding: "2px 8px", backgroundColor: "#fff", color: band.color, borderRadius: 12 }}>
                    {rows.length} {rows.length === 1 ? 'rental' : 'rentals'}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: band.color }}>
                    {money(totalCost)} / day
                  </div>
                </div>
              </button>
              
              {!isCollapsed && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${colors.rule}`, color: colors.inkMuted }}>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Truck</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Tech</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Days</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Cost</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Shop / Status</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600 }}>Mark</th>
                        <th style={{ padding: "12px 24px", fontWeight: 600, textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const byov = isByov(r.vehicle_number);
                        return (
                          <tr key={r.id} style={{ borderBottom: `1px solid ${colors.rule}`, transition: "background-color 0.2s" }} onMouseOver={e => e.currentTarget.style.backgroundColor = colors.surface} onMouseOut={e => e.currentTarget.style.backgroundColor = "transparent"}>
                            <td style={{ padding: "12px 24px", fontFamily: fonts.jetbrains, fontWeight: 500 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {r.vehicle_number}
                                {byov && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, backgroundColor: colors.rule, color: colors.inkMuted, fontWeight: 600, fontFamily: fonts.dmSans }}>BYOV</span>}
                              </div>
                            </td>
                            <td style={{ padding: "12px 24px" }}>
                              <div style={{ fontWeight: 500 }}>{r.tech_name || "Unknown"}</div>
                              <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 2, display: "flex", gap: 4 }}>
                                {r.employee_status === "Term/Leave" && <span style={{ color: colors.red }}>Term/Leave</span>}
                                {r.employee_status === "New Hire" && <span style={{ color: colors.green }}>New Hire</span>}
                                {r.employee_status === "Active" && <span>Active</span>}
                              </div>
                            </td>
                            <td style={{ padding: "12px 24px", fontFamily: fonts.jetbrains, fontWeight: 600, color: band.color }}>
                              {r.days_open}d
                            </td>
                            <td style={{ padding: "12px 24px", fontFamily: fonts.jetbrains }}>
                              <div style={{ fontWeight: 500 }}>{money(r.daily_cost)}</div>
                              {r.cost_over && <div style={{ fontSize: 11, color: colors.red, marginTop: 2 }}>+{money(r.cost_delta)}</div>}
                            </td>
                            <td style={{ padding: "12px 24px" }}>
                              {byov ? (
                                <div style={{ color: colors.inkMuted, fontStyle: "italic", fontSize: 12 }}>BYOV — repairs not tracked</div>
                              ) : (
                                <>
                                  <div style={{ fontWeight: 500 }}>{r.shop_name || "—"}</div>
                                  <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{r.shop_po_status || "—"}</div>
                                </>
                              )}
                            </td>
                            <td style={{ padding: "12px 24px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {r.operator_mark ? (
                                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.ink }}>{r.operator_mark}</span>
                                ) : (
                                  <span style={{ fontSize: 12, color: colors.inkMuted }}>None</span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>
                                {fmtAgo(r.mark_at)}
                              </div>
                            </td>
                            <td style={{ padding: "12px 24px", textAlign: "right" }}>
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                {(!byov && r.callable) && (
                                  <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, backgroundColor: colors.accent, color: "#fff", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                                    <PhoneCall size={14} /> Call
                                  </button>
                                )}
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
                                        fontSize: 12,
                                        fontWeight: 600
                                      }}
                                    >
                                      {m}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}

export default AgingEscalator;
