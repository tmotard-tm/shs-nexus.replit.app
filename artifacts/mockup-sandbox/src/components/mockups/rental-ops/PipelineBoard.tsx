import './_group.css';
import { useState, useMemo } from "react";
import { Search, PhoneCall, MoreHorizontal, Clock, AlertCircle } from "lucide-react";

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
  amber: "var(--vrm-amber)",
  red: "var(--vrm-red)",
  redLight: "var(--vrm-red-light)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
};

interface MasterRow {
  case_key: string;
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
  // internal classification for this mockup
  pipeline_stage: "call_today" | "waiting" | "blocked" | "wrapping_up";
}

const mk = (overrides: Partial<MasterRow>): MasterRow => ({
  case_key: Math.random().toString(),
  vehicle_number: "",
  tech_name: "Unknown Tech",
  employee_status: "Active",
  veh_desc: "Cargo Van",
  rental_class: "Standard",
  daily_cost: 65.0,
  cost_delta: null,
  cost_over: false,
  shop_name: null,
  shop_po_status: null,
  days_open: 5,
  operator_mark: "O",
  mark_at: new Date().toISOString(),
  callable: false,
  pipeline_stage: "waiting",
  ...overrides
});

const MOCK_ROWS: MasterRow[] = [
  mk({
    case_key: "1", vehicle_number: "61385", tech_name: "John Smith", daily_cost: 95.50,
    cost_delta: 20.50, cost_over: true, shop_name: "Bob's Auto", shop_po_status: "Awaiting Parts",
    days_open: 42, callable: true, pipeline_stage: "call_today"
  }),
  mk({
    case_key: "2", vehicle_number: "82041", tech_name: "Jane Doe", employee_status: "Term/Leave",
    daily_cost: 65.00, shop_name: "City Garage", callable: false, pipeline_stage: "blocked"
  }),
  mk({
    case_key: "3", vehicle_number: "40192", tech_name: "Bob Brown", daily_cost: 110.00,
    cost_delta: 30.00, cost_over: true, shop_name: "Fleet Services Inc", callable: true, pipeline_stage: "call_today"
  }),
  mk({
    case_key: "4", vehicle_number: "99214", tech_name: "Alice White", daily_cost: 72.00,
    shop_name: "Quick Fix", shop_po_status: "Approved", days_open: 17, callable: false, pipeline_stage: "waiting"
  }),
  mk({
    case_key: "5", vehicle_number: "88217", tech_name: "Luis Herrera", daily_cost: 46.00,
    days_open: 11, callable: false, pipeline_stage: "waiting"
  }),
  mk({
    case_key: "6", vehicle_number: "77210", tech_name: "Marcus Johnson", employee_status: "New Hire",
    daily_cost: 55.00, shop_name: "Downtown Mechanics", shop_po_status: "Estimating", days_open: 2, callable: true, pipeline_stage: "call_today"
  }),
  mk({
    case_key: "7", vehicle_number: "55102", tech_name: "Sarah Jenkins", daily_cost: 60.00,
    shop_name: "Westside Auto", shop_po_status: "Repairs Complete", days_open: 8, callable: false, operator_mark: "P", pipeline_stage: "wrapping_up"
  }),
  mk({
    case_key: "8", vehicle_number: "33091", tech_name: "David Kim", daily_cost: 85.00, cost_delta: 15.00, cost_over: true,
    shop_name: "East End Garage", shop_po_status: "Pending Approval", days_open: 22, callable: true, pipeline_stage: "call_today"
  }),
  mk({
    case_key: "9", vehicle_number: "088144", tech_name: "Tom Barker", daily_cost: 50.00,
    days_open: 14, callable: false, pipeline_stage: "blocked", employee_status: "Term/Leave"
  }),
  mk({
    case_key: "10", vehicle_number: "22019", tech_name: "Emily Davis", daily_cost: 70.00,
    shop_name: "National Fleet Repair", shop_po_status: "In Shop", days_open: 19, callable: false, pipeline_stage: "waiting"
  }),
  mk({
    case_key: "11", vehicle_number: "11054", tech_name: "Michael Chen", daily_cost: 65.00,
    shop_name: "Cornerstone Auto", shop_po_status: "Repairs Complete", days_open: 6, callable: false, operator_mark: "C", pipeline_stage: "wrapping_up"
  }),
  mk({
    case_key: "12", vehicle_number: "44033", tech_name: "Rachel Moore", daily_cost: 68.00,
    shop_name: "Speedy Repair", shop_po_status: "Awaiting Auth", days_open: 12, callable: true, pipeline_stage: "call_today"
  })
];

const money = (n: number | null | undefined) => (n == null ? "" : `$${Number(n).toFixed(2)}`);

function isByov(truckNo: string | null | undefined): boolean {
  const raw = String(truckNo ?? "").trim();
  return raw.startsWith("88") || raw.startsWith("088");
}

const STAGES = [
  { id: "call_today", label: "Call today", color: colors.accent },
  { id: "waiting", label: "Waiting on shop", color: colors.amber },
  { id: "blocked", label: "Blocked / can't work", color: colors.red },
  { id: "wrapping_up", label: "Wrapping up", color: colors.green },
] as const;

export function PipelineBoard() {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!search) return MOCK_ROWS;
    const q = search.toLowerCase();
    return MOCK_ROWS.filter(r => 
      r.vehicle_number.toLowerCase().includes(q) || 
      (r.tech_name || "").toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: colors.background, color: colors.ink, fontFamily: fonts.dmSans, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ padding: "16px 24px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, margin: 0 }}>Rental Pipeline</h1>
          <div style={{ fontSize: 13, color: colors.inkMuted, marginTop: 4 }}>
            Manage daily operator workflow
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
        </div>
      </header>

      {/* Kanban Board */}
      <main style={{ flex: 1, padding: "24px", display: "flex", gap: 16, overflowX: "auto" }}>
        {STAGES.map(stage => {
          const stageRows = filteredRows.filter(r => r.pipeline_stage === stage.id);
          const totalCost = stageRows.reduce((sum, r) => sum + (r.daily_cost || 0), 0);
          
          return (
            <div key={stage.id} style={{ flex: "0 0 320px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Column Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: stage.color }} />
                  <h2 style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 600, margin: 0 }}>{stage.label}</h2>
                  <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 99, backgroundColor: colors.rule, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>
                    {stageRows.length}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>
                  {money(totalCost)}/d
                </div>
              </div>

              {/* Cards Container */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, paddingBottom: 24 }}>
                {stageRows.map(r => {
                  const byov = isByov(r.vehicle_number);
                  return (
                    <div key={r.case_key} style={{ backgroundColor: "#fff", borderRadius: 8, border: `1px solid ${colors.rule}`, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", gap: 12 }}>
                      {/* Card Header: Truck & Tech */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontFamily: fonts.jetbrains, fontWeight: 600, fontSize: 15 }}>{r.vehicle_number}</span>
                            {byov && (
                              <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, backgroundColor: colors.blueLight, color: colors.blue, fontWeight: 600 }}>BYOV</span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <span style={{ fontSize: 13, color: colors.ink }}>{r.tech_name}</span>
                            {r.employee_status === "Term/Leave" && (
                              <span style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, backgroundColor: colors.redLight, color: colors.red, fontWeight: 600 }}>Term</span>
                            )}
                            {r.employee_status === "New Hire" && (
                              <span style={{ fontSize: 10, padding: "2px 4px", borderRadius: 4, backgroundColor: colors.green, color: "#fff", fontWeight: 600 }}>New Hire</span>
                            )}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 13 }}>
                          <div>{money(r.daily_cost)}<span style={{color: colors.inkMuted, fontSize: 11}}>/d</span></div>
                          {r.cost_delta ? (
                            <div style={{ color: colors.amber, fontSize: 11, marginTop: 2 }}>+{money(r.cost_delta)}</div>
                          ) : null}
                        </div>
                      </div>

                      {/* Card Body: Details */}
                      <div style={{ fontSize: 12, color: colors.inkMuted, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                            <Clock size={12} /> Days Open
                          </div>
                          <div style={{ color: colors.ink, fontFamily: fonts.jetbrains }}>{r.days_open}d</div>
                        </div>
                        <div>
                          <div style={{ marginBottom: 2 }}>Shop Info</div>
                          {byov ? (
                            <div style={{ fontStyle: "italic", fontSize: 11 }}>BYOV — repairs not tracked</div>
                          ) : (
                            <div style={{ color: colors.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.shop_name || "—"}>
                              {r.shop_name || "—"}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, paddingTop: 12, borderTop: `1px dashed ${colors.rule}` }}>
                        <button style={{ 
                          padding: "6px 12px", 
                          borderRadius: 6, 
                          border: `1px solid ${r.callable && !byov ? colors.accent : colors.rule}`, 
                          backgroundColor: r.callable && !byov ? colors.accentLight : "#fafafa", 
                          color: r.callable && !byov ? colors.accent : colors.inkMuted,
                          cursor: r.callable && !byov ? "pointer" : "not-allowed",
                          display: "flex", 
                          alignItems: "center", 
                          gap: 6, 
                          fontSize: 13,
                          fontWeight: 500,
                          opacity: (byov || !r.callable) ? 0.5 : 1
                        }} disabled={!r.callable || byov}>
                          <PhoneCall size={14} /> {byov ? "Cannot Call" : "Call LUCA"}
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
                                fontSize: 12,
                                fontWeight: r.operator_mark?.[0]?.toUpperCase() === m ? 600 : 400
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {stageRows.length === 0 && (
                  <div style={{ padding: "32px 16px", textAlign: "center", border: `1px dashed ${colors.rule}`, borderRadius: 8, color: colors.inkMuted, fontSize: 13 }}>
                    No trucks in this stage
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}

export default PipelineBoard;
