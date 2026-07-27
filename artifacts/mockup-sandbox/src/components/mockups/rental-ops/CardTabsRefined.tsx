import './_group.css';
import { useState, useMemo } from "react";
import {
  Search, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown,
  AlertTriangle, Wrench, PhoneCall, Filter,
  Clock, MapPin, Truck, List
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
  purple: "var(--vrm-purple)",
  purpleLight: "var(--vrm-purple-light)",
};

interface MasterRow {
  case_key: string;
  vehicle_number: string;
  source: string;
  rental_vendor: string | null;
  renter_name_raw: string;
  ticket_number: string | null;
  po_number: string | null;
  ticket_status: string | null;
  rental_start_date: string | null;
  po_date: string | null;
  days_open: number | null;
  days_authorized: number | null;
  number_of_extensions: number | null;
  repairs_complete: string | null;
  renting_city: string | null;
  renting_state: string | null;
  veh_desc: string | null;
  rental_class: string | null;
  daily_cost: number | null;
  class_bucket: string;
  actual_vehicle_type: string;
  actual_bucket: string;
  type_mismatch: boolean;
  class_median: number | null;
  cost_delta: number | null;
  cost_over: boolean;
  identity_state: string | null;
  identity_method: string | null;
  identity_confidence: string | null;
  employee_id: string | null;
  employee_status: string | null;
  employee_status_date: string | null;
  tech_name: string | null;
  tech_district: string | null;
  identity_reason: string | null;
  identity_is_override: boolean;
  has_open_repair: boolean | null;
  repair_cohort: string;
  open_po_count: number;
  po_count: number;
  last_rental_date: string | null;
  has_rental_auth: boolean;
  no_rental_auth: boolean;
  tpms_tech: string | null;
  renter_own_truck: string | null;
  wrong_truck: boolean;
  odometer: number | null;
  odometer_date: string | null;
  portal_msg_count: number | null;
  portal_shop_phone: string | null;
  has_portal: boolean;
  callable: boolean;
  shop_name: string | null;
  shop_address: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_zip: string | null;
  shop_po_number: string | null;
  shop_po_status: string | null;
  shop_po_date: string | null;
  assigned_truck: string | null;
  assigned_truck_mismatch: boolean;
  assigned_truck_open_po_count: number;
  assigned_truck_has_repair_po: boolean | null;
  workload_bucket: "cannot_work" | "mismatch_no_po" | "workable";
  redirect_to_assigned: boolean;
  call_target_truck: string | null;
  call_shop_name: string | null;
  call_shop_phone: string | null;
  call_shop_address: string | null;
  call_shop_po_number: string | null;
  call_shop_po_status: string | null;
  ams_status: string | null;
  ams_bucket: string;
  operator_mark: string | null;
  mark_note: string | null;
  mark_actor: string | null;
  mark_at: string | null;
  present_in_latest: boolean;
  last_seen_at: string | null;
}

function mk(overrides: Partial<MasterRow>): MasterRow {
  return {
    case_key: "", vehicle_number: "", source: "holman_etl", rental_vendor: "Enterprise",
    renter_name_raw: "", ticket_number: null, po_number: null, ticket_status: "OPEN",
    rental_start_date: null, po_date: null, days_open: null, days_authorized: null,
    number_of_extensions: null, repairs_complete: null, renting_city: null, renting_state: null,
    veh_desc: null, rental_class: null, daily_cost: null, class_bucket: "SUV/VAN/TRUCK",
    actual_vehicle_type: "Cargo Van", actual_bucket: "SUV/VAN/TRUCK", type_mismatch: false,
    class_median: null, cost_delta: null, cost_over: false, identity_state: "RESOLVED",
    identity_method: "exact", identity_confidence: "high", employee_id: null,
    employee_status: "Active", employee_status_date: null, tech_name: null, tech_district: null,
    identity_reason: null, identity_is_override: false, has_open_repair: null,
    repair_cohort: "no_open_repair", open_po_count: 0, po_count: 0, last_rental_date: null,
    has_rental_auth: true, no_rental_auth: false, tpms_tech: null, renter_own_truck: null,
    wrong_truck: false, odometer: null, odometer_date: null, portal_msg_count: null,
    portal_shop_phone: null, has_portal: false, callable: false, shop_name: null,
    shop_address: null, shop_city: null, shop_state: null, shop_zip: null,
    shop_po_number: null, shop_po_status: null, shop_po_date: null, assigned_truck: null,
    assigned_truck_mismatch: false, assigned_truck_open_po_count: 0, assigned_truck_has_repair_po: null,
    workload_bucket: "workable", redirect_to_assigned: false, call_target_truck: null,
    call_shop_name: null, call_shop_phone: null, call_shop_address: null,
    call_shop_po_number: null, call_shop_po_status: null, ams_status: null, ams_bucket: "other",
    operator_mark: null, mark_note: null, mark_actor: null, mark_at: null,
    present_in_latest: true, last_seen_at: null,
    ...overrides,
  };
}

const MOCK_ROWS: MasterRow[] = [
  mk({
    case_key: "023132", vehicle_number: "023132", renter_name_raw: "Marcus Delgado",
    tech_name: "Marcus Delgado", tpms_tech: "Marcus Delgado", employee_id: "T-40118",
    employee_status: "Active", employee_status_date: "2019-06-14",
    veh_desc: "2022 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 52.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Dallas NW", shop_po_status: "APPROVED", shop_city: "Dallas", shop_state: "TX",
    portal_shop_phone: "2145551987", has_portal: true, callable: true,
    call_target_truck: "023132", call_shop_name: "Enterprise - Dallas NW", call_shop_phone: "2145551987",
    open_po_count: 1, po_count: 3, days_open: 12, number_of_extensions: 1, last_rental_date: "2026-03-30",
    odometer: 84210,
  }),
  mk({
    case_key: "041877", vehicle_number: "041877", renter_name_raw: "Tyrone Baker",
    tech_name: "Tyrone Baker", tpms_tech: "Tyrone Baker", employee_id: "T-38820",
    employee_status: "Active", employee_status_date: "2021-02-01",
    veh_desc: "2021 Chevrolet Express 2500", rental_class: "CARGO VAN", daily_cost: 48.5,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Hertz - Phoenix Airport", shop_po_status: "APPROVED", shop_city: "Phoenix", shop_state: "AZ",
    portal_shop_phone: "6025554412", has_portal: true, callable: true,
    call_target_truck: "041877", call_shop_name: "Hertz - Phoenix Airport", call_shop_phone: "6025554412",
    open_po_count: 1, po_count: 2, days_open: 8, number_of_extensions: 0, last_rental_date: "2026-04-02",
    odometer: 61540,
  }),
  mk({
    case_key: "058204", vehicle_number: "058204", renter_name_raw: "Wei Chen",
    tech_name: "Wei Chen", tpms_tech: "Wei Chen", employee_id: "T-51022",
    employee_status: "Active", employee_status_date: "2026-02-01",
    identity_confidence: "medium", identity_state: "RESOLVED",
    veh_desc: "2023 Ford Transit 350 HD", rental_class: "CARGO VAN", daily_cost: 61.75,
    class_median: 47, cost_delta: 14.75, cost_over: true,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Sacramento", shop_po_status: "APPROVED", shop_city: "Sacramento", shop_state: "CA",
    portal_shop_phone: "9165553320", has_portal: true, callable: true,
    call_target_truck: "058204", call_shop_name: "Enterprise - Sacramento", call_shop_phone: "9165553320",
    open_po_count: 1, po_count: 4, days_open: 21, number_of_extensions: 2, last_rental_date: "2026-03-10",
    odometer: 22110,
  }),
  mk({
    case_key: "017640", vehicle_number: "017640", renter_name_raw: "Andre Wallace",
    tech_name: "Andre Wallace", tpms_tech: "Andre Wallace", employee_id: "T-29744",
    employee_status: "Active", employee_status_date: "2017-08-01",
    veh_desc: "2020 Ram ProMaster 1500", rental_class: "CARGO VAN", daily_cost: 44.0,
    ams_status: "Declined Repair", ams_bucket: "declined", repair_cohort: "no_open_repair",
    redirect_to_assigned: true, callable: true,
    assigned_truck: "092310", assigned_truck_has_repair_po: true, assigned_truck_open_po_count: 1,
    call_target_truck: "092310", call_shop_name: "Enterprise - Atlanta South", call_shop_phone: "4045557788",
    po_count: 2, days_open: 27, last_rental_date: "2026-02-14", odometer: 118920,
  }),
  mk({
    case_key: "008921", vehicle_number: "008921", renter_name_raw: "Roberto Nunez",
    tech_name: "Roberto Nunez", employee_id: "T-14003",
    employee_status: "Active", employee_status_date: "2015-05-01",
    identity_state: "EXCEPTION", identity_confidence: "low",
    veh_desc: "2019 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 39.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    po_count: 1, days_open: 55, last_rental_date: "2026-01-20", odometer: 142330,
  }),
  mk({
    case_key: "093455", vehicle_number: "093455", renter_name_raw: "Kimberly Foster",
    tech_name: "Kimberly Foster", tpms_tech: "Kimberly Foster", employee_id: "T-46610",
    employee_status: "Active", employee_status_date: "2020-09-01",
    veh_desc: "2020 GMC Savana 2500", rental_class: "CARGO VAN", daily_cost: 41.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    redirect_to_assigned: true, callable: true,
    assigned_truck: "071228", assigned_truck_has_repair_po: true, assigned_truck_open_po_count: 1,
    call_target_truck: "071228", call_shop_name: "Hertz - Denver Tech", call_shop_phone: "3035559901",
    po_count: 1, days_open: 33, last_rental_date: "2026-02-01", odometer: 99870,
  }),
  mk({
    case_key: "062119", vehicle_number: "062119", renter_name_raw: "Jamal Whitfield",
    tech_name: "Jamal Whitfield", employee_id: "T-49005", ticket_status: "PENDED",
    employee_status: "Active", employee_status_date: "2022-03-01",
    veh_desc: "2022 Nissan NV200", rental_class: "COMPACT CARGO", daily_cost: 38.0,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 30, number_of_extensions: 3, last_rental_date: "2026-04-01", odometer: 44120,
  }),
  mk({
    case_key: "029007", vehicle_number: "029007", renter_name_raw: "Sofia Ramirez",
    tech_name: "Sofia Ramirez", employee_id: "T-33218", ticket_status: "PENDED",
    employee_status: "Active", employee_status_date: "2019-11-01",
    veh_desc: "2018 Ford Transit 150", rental_class: "CARGO VAN", daily_cost: 43.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    po_count: 1, days_open: 44, last_rental_date: "2026-03-20", odometer: 156040,
  }),
  mk({
    case_key: "054832", vehicle_number: "054832", renter_name_raw: "Derek Coleman",
    tech_name: "Derek Coleman", tpms_tech: "Derek Coleman", employee_id: "T-41190",
    employee_status: "Active", employee_status_date: "2018-04-01",
    veh_desc: "2021 GMC Savana 2500", rental_class: "CARGO VAN", daily_cost: 50.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Chicago West", shop_po_status: "APPROVED", shop_city: "Chicago", shop_state: "IL",
    portal_shop_phone: null, has_portal: true, callable: false,
    open_po_count: 1, po_count: 2, days_open: 15, last_rental_date: "2026-03-25", odometer: 77650,
  }),
  mk({
    case_key: "011503", vehicle_number: "011503", renter_name_raw: "Gregory Paulsen",
    tech_name: "Gregory Paulsen", tpms_tech: "Gregory Paulsen", employee_id: "T-22087",
    employee_status: "Terminated", employee_status_date: "2026-03-15",
    no_rental_auth: true, has_rental_auth: false,
    veh_desc: "2020 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 46.0,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 40, last_rental_date: "2026-02-28", odometer: 103410,
  }),
  mk({
    case_key: "037291", vehicle_number: "037291", renter_name_raw: "Natalie Brooks",
    tech_name: "Natalie Brooks", tpms_tech: "Natalie Brooks", employee_id: "T-44560",
    employee_status: "On Leave", employee_status_date: "2026-04-10",
    veh_desc: "2022 Ram ProMaster 2500", rental_class: "CARGO VAN", daily_cost: 49.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Hertz - Seattle North", shop_po_status: "APPROVED", shop_city: "Seattle", shop_state: "WA",
    portal_shop_phone: "2065554567", has_portal: true, callable: true,
    call_target_truck: "037291", call_shop_name: "Hertz - Seattle North", call_shop_phone: "2065554567",
    open_po_count: 1, po_count: 1, days_open: 6, last_rental_date: "2026-04-15", odometer: 31220,
  }),
  mk({
    case_key: "048174", vehicle_number: "048174", renter_name_raw: "Victor Salinas",
    tech_name: "Victor Salinas", tpms_tech: "Victor Salinas", employee_id: "T-50781",
    employee_status: "Active", employee_status_date: "2024-11-05",
    identity_state: "REVIEW", identity_confidence: "medium",
    wrong_truck: true, renter_own_truck: "048012",
    veh_desc: "2021 Ford Transit 350", rental_class: "CARGO VAN", daily_cost: 47.0,
    actual_vehicle_type: "Sedan", actual_bucket: "SEDAN", type_mismatch: true,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 18, last_rental_date: "2026-03-05", odometer: 65980,
  }),
  mk({
    case_key: "070456", vehicle_number: "070456", renter_name_raw: "Hannah Kim",
    tech_name: "Hannah Kim", tpms_tech: "Hannah Kim", employee_id: "T-47733",
    employee_status: "Active", employee_status_date: "2023-01-15",
    veh_desc: "2019 Chevrolet Express 3500", rental_class: "CARGO VAN", daily_cost: 45.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "no_history",
    shop_name: "Enterprise - Portland East", shop_po_status: "APPROVED", shop_city: "Portland", shop_state: "OR",
    portal_shop_phone: null, has_portal: false, callable: false,
    open_po_count: 1, po_count: 1, days_open: 9, last_rental_date: "2026-04-05", odometer: 129440,
  }),
  mk({
    case_key: "046688", vehicle_number: "046688", renter_name_raw: "Curtis Bryant",
    tech_name: "Curtis Bryant", tpms_tech: "Curtis Bryant", employee_id: "T-39912",
    employee_status: "Active", employee_status_date: "2021-06-01",
    veh_desc: "2020 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 42.0,
    actual_vehicle_type: "Sedan", actual_bucket: "SEDAN", type_mismatch: true,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    workload_bucket: "mismatch_no_po",
    assigned_truck: "046012", assigned_truck_mismatch: true, assigned_truck_has_repair_po: false,
    po_count: 1, days_open: 23, last_rental_date: "2026-03-18", odometer: 91500,
  }),
  mk({
    case_key: "88217", vehicle_number: "88217", renter_name_raw: "Luis Herrera",
    tech_name: "Luis Herrera", tpms_tech: "Luis Herrera", employee_id: "T-52440",
    employee_status: "Active", employee_status_date: "2025-08-18",
    veh_desc: "2022 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 46.0,
    ams_status: null, ams_bucket: "other", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 11, last_rental_date: "2026-04-08", odometer: 58230,
  }),
];

function isDeclinedAuction(b: string) {
  return b === "declined" || b === "auction";
}

function isByov(truckNo: string | null | undefined): boolean {
  const raw = String(truckNo ?? "").trim();
  return raw.startsWith("88") || raw.startsWith("088");
}

function fmtPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "—");
}

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

function makeSortComparator(accessor: (r: MasterRow) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: MasterRow, b: MasterRow) => {
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

const useNoopMutation = () => ({ mutate: (_v?: any) => {}, isPending: false });

export function CardTabsRefined() {
  const [activeTab, setActiveTab] = useState<string>("luca_queue");
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [markOverrides, setMarkOverrides] = useState<Record<string, string | null>>({});

  const callMut = useNoopMutation();
  const callAllMut = useNoopMutation();
  const markMut = useNoopMutation();

  const doCall = (r: MasterRow) => { callMut.mutate(r.case_key); };
  const doCallAll = () => { if (visibleCallable.length) callAllMut.mutate(visibleCallable.map((r) => r.case_key)); };
  const doMark = (caseKey: string, mark: string, current: string | null) => {
    const next = current === mark ? null : mark;
    markMut.mutate({ caseKey, mark: next ?? "none" });
    setMarkOverrides(prev => ({ ...prev, [caseKey]: next }));
  };

  const pool = MOCK_ROWS;
  const openRepairCount = pool.filter(r => r.repair_cohort === "open_repair").length;
  const amsBadCount = pool.filter(r => isDeclinedAuction(r.ams_bucket)).length;
  const mismatchCount = pool.filter(r => r.type_mismatch).length;
  const lucaQueue = pool.filter(r => r.callable);

  const statesAvailable = useMemo(() => Array.from(new Set(pool.map(r => r.shop_state).filter(Boolean))), [pool]);

  const filtered = useMemo(() => {
    return pool.filter(r => {
      if (activeTab === "luca_queue" && !r.callable) return false;
      if (activeTab === "open_repair" && r.repair_cohort !== "open_repair") return false;
      if (activeTab === "ams_bad" && !isDeclinedAuction(r.ams_bucket)) return false;
      if (activeTab === "mismatch" && !r.type_mismatch) return false;
      
      if (filterState !== "all" && r.shop_state !== filterState) return false;
      
      const q = search.trim().toLowerCase();
      if (q) {
        const hay = `${r.case_key} ${r.renter_name_raw} ${r.shop_name || ""} ${r.veh_desc || ""} ${r.rental_class || ""} ${r.tech_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pool, activeTab, search, filterState]);

  const visibleCallable = useMemo(() => filtered.filter(r => r.callable), [filtered]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => Number(r.case_key), tech: (r) => r.renter_name_raw,
      veh: (r) => r.veh_desc, cls: (r) => r.rental_class,
      ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const thStyle: React.CSSProperties = { 
    fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: colors.inkMuted, 
    textTransform: "uppercase", letterSpacing: "0.04em", padding: "12px 16px", 
    textAlign: "left", borderBottom: `1px solid ${colors.rule}`, 
    backgroundColor: "#F9FAFC", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 
  };
  const tdStyle: React.CSSProperties = { 
    fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, padding: "12px 16px", 
    borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap", transition: "background 0.15s" 
  };

  const Th = ({ col, label, style }: { col: string; label: string; style?: React.CSSProperties }) => {
    const active = sort.col === col && sort.dir != null;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    const onClick = () => setSort((s) => s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null });
    return (
      <th style={{ ...thStyle, ...style }}>
        <button type="button" onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.ink : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: "inherit" }}>
          <span>{label}</span><Icon size={12} style={{ opacity: active ? 1 : 0.3, color: active ? colors.accent : "inherit" }} />
        </button>
      </th>
    );
  };

  const kpis = [
    { id: "all", label: "All rentals", value: pool.length, fg: colors.ink, bg: "#F1F5F9", border: colors.rule, icon: List },
    { id: "luca_queue", label: "LUCA Call Queue", value: lucaQueue.length, fg: colors.green, bg: colors.greenLight, border: "#86EFAC", icon: PhoneCall },
    { id: "open_repair", label: "Open repair ticket", value: openRepairCount, fg: colors.blue, bg: colors.blueLight, border: "#93C5FD", icon: Wrench },
    { id: "ams_bad", label: "Auction / Declined", value: amsBadCount, fg: colors.red, bg: colors.redLight, border: "#FCA5A5", icon: AlertTriangle },
    { id: "mismatch", label: "Type mismatch", value: mismatchCount, fg: colors.amber, bg: colors.amberLight, border: "#FCD34D", icon: Truck },
  ];

  const activeKpi = kpis.find(k => k.id === activeTab) || kpis[0];

  const getAmsStyles = (bucket: string) => {
    switch (bucket) {
      case 'in_repair': return { color: colors.blue, bg: colors.blueLight };
      case 'auction':
      case 'declined': return { color: colors.red, bg: colors.redLight };
      case 'in_use': return { color: colors.green, bg: colors.greenLight };
      default: return { color: colors.inkMuted, bg: colors.surface };
    }
  };

  return (
    <div className="min-h-screen" style={{ fontFamily: fonts.dmSans, color: colors.ink, background: colors.background, padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <h1 style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, margin: 0, color: colors.ink }}>Rental Operations</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, color: colors.inkMuted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Clock size={14} /> Last synced 7 min ago</span>
          <button style={{ display: "flex", alignItems: "center", gap: 6, color: colors.blue, cursor: "pointer", fontWeight: 600, background: "transparent", border: "none" }}>
            <RefreshCw size={14} /> Sync now
          </button>
        </div>
      </div>

      {/* KPI Cards as Tabs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 28 }}>
        {kpis.map((k) => {
          const isActive = activeTab === k.id;
          const isHovered = hoveredCard === k.id;
          const Icon = k.icon;
          
          return (
            <div 
              key={k.id}
              onClick={() => setActiveTab(k.id)}
              onMouseEnter={() => setHoveredCard(k.id)}
              onMouseLeave={() => setHoveredCard(null)}
              style={{ 
                background: isActive ? k.bg : (isHovered ? "#FFFFFF" : colors.surface), 
                border: `2px solid ${isActive ? k.fg : (isHovered ? colors.rule : "transparent")}`, 
                borderRadius: 12, 
                padding: "16px 20px",
                cursor: "pointer",
                boxShadow: isActive ? `0 4px 12px ${k.fg}15` : (isHovered ? "0 4px 12px rgba(0,0,0,0.03)" : "none"),
                transition: "all 0.2s ease",
                position: "relative",
                overflow: "hidden"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: isActive ? k.fg : colors.inkMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  {k.label}
                </div>
                <Icon size={16} style={{ color: isActive ? k.fg : colors.inkMuted, opacity: isActive ? 1 : 0.5 }} />
              </div>
              <div style={{ fontFamily: fonts.syne, fontSize: 32, fontWeight: 800, color: isActive ? k.fg : colors.ink, lineHeight: 1 }}>
                {k.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Contextual Action Line */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.inkMuted }} />
            <input 
              type="text" 
              placeholder="Search rentals..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              style={{ padding: "9px 12px 9px 36px", borderRadius: 8, border: `1px solid ${colors.rule}`, fontSize: 13, background: "#fff", width: 260, outline: "none", transition: "border-color 0.2s" }} 
              onFocus={(e) => e.target.style.borderColor = colors.accent}
              onBlur={(e) => e.target.style.borderColor = colors.rule}
            />
          </div>
          
          {/* State Filter Dropdown */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", background: "#fff", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "0 12px" }}>
            <MapPin size={15} style={{ color: colors.inkMuted, marginRight: 6 }} />
            <select
              value={filterState}
              onChange={e => setFilterState(e.target.value)}
              style={{ padding: "9px 0", border: "none", background: "transparent", fontSize: 13, fontWeight: 500, color: colors.ink, outline: "none", cursor: "pointer", appearance: "none", paddingRight: 20 }}
            >
              <option value="all">All States</option>
              {statesAvailable.map(st => (
                <option key={st} value={st as string}>{st}</option>
              ))}
            </select>
            <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <ArrowDown size={12} color={colors.inkMuted} />
            </div>
          </div>
          
          <div style={{ fontSize: 13, color: colors.inkMuted, fontWeight: 500, marginLeft: 8 }}>
            Showing {sorted.length} of {pool.length}
          </div>
        </div>
        
        {activeTab === "luca_queue" && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink }}><span style={{ color: colors.green }}>{visibleCallable.length}</span> shops verified</span>
            <button onClick={doCallAll} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 8, background: colors.green, color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", boxShadow: `0 2px 8px ${colors.green}40`, transition: "transform 0.1s" }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
            >
              <PhoneCall size={15} /> Call all with LUCA
            </button>
          </div>
        )}
      </div>

      {/* Grid with colored top border indicating the active tab */}
      <div style={{ 
        overflow: "auto", 
        border: `1px solid ${colors.rule}`, 
        borderTop: `4px solid ${activeKpi.fg}`,
        borderRadius: "12px 12px 12px 12px", 
        background: "#fff", 
        maxHeight: "calc(100vh - 280px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.03)"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40, textAlign: "center" }}>#</th>
              <Th col="trk" label="Truck" />
              <Th col="tech" label="Technician" />
              <Th col="veh" label="Vehicle" />
              <Th col="cls" label="Rental Class" />
              <Th col="ams" label="AMS Status" />
              <Th col="shop" label="Shop / Location" />
              <Th col="days" label="Days Open" style={{ textAlign: "right" }} />
              <th style={{ ...thStyle, width: 90, textAlign: "center" }}>LUCA</th>
              <th style={{ ...thStyle, width: 110, textAlign: "center" }}>Mark</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const isHovered = hoveredRow === r.case_key;
              const amsStyles = getAmsStyles(r.ams_bucket);
              const isByovRow = isByov(r.vehicle_number);
              
              // Tech & TPMS merge logic
              const hasTpmsMismatch = r.tpms_tech && r.tpms_tech !== r.renter_name_raw;
              const missingTpms = !r.tpms_tech;

              return (
                <tr 
                  key={r.case_key} 
                  onMouseEnter={() => setHoveredRow(r.case_key)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ 
                    cursor: "pointer", 
                    background: isHovered ? "#F8FAFC" : "transparent"
                  }}
                >
                  <td style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontWeight: 700, fontSize: 14 }}>
                    {r.case_key}
                    {isByovRow && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: colors.purple, background: colors.purpleLight, borderRadius: 4, padding: "2px 6px", fontFamily: fonts.dmSans, verticalAlign: "middle" }}>BYOV</span>}
                  </td>
                  <td style={{ ...tdStyle, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.renter_name_raw}</div>
                    {(missingTpms || hasTpmsMismatch) && (
                      <div style={{ fontSize: 11, color: colors.amber, fontWeight: 600, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={12} />
                        {missingTpms ? "TPMS unassigned" : `TPMS: ${r.tpms_tech}`}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: r.veh_desc ? colors.ink : colors.inkMuted }}>{r.veh_desc || "—"}</td>
                  <td style={{ ...tdStyle, fontSize: 13, color: r.rental_class ? colors.ink : colors.inkMuted }}>{r.rental_class || "—"}</td>
                  <td style={tdStyle}>
                    {r.ams_status ? (
                      <span style={{ 
                        display: "inline-flex", alignItems: "center", height: 22,
                        fontSize: 11, fontWeight: 700, color: amsStyles.color, 
                        background: amsStyles.bg, borderRadius: 6, padding: "0 8px", 
                        textTransform: "uppercase", letterSpacing: "0.02em" 
                      }}>
                        {r.ams_status}
                      </span>
                    ) : (
                      <span style={{ color: colors.inkMuted }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, minWidth: 220 }}>
                    {isByovRow ? (
                      <span style={{ color: colors.inkMuted, fontStyle: "italic", fontSize: 13 }} title="BYOV trucks are the tech's own vehicle — repairs aren't tracked.">BYOV — repairs not tracked</span>
                    ) : (
                      <>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{r.shop_name || "—"}</div>
                        {r.portal_shop_phone && (
                          <div style={{ fontSize: 12, color: colors.green, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", gap: 4 }}>
                            <PhoneCall size={10} /> {fmtPhone(r.portal_shop_phone)}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: 500 }}>
                    {r.days_open ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    {r.callable ? (
                      <button type="button" onClick={() => doCall(r)}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 700, color: colors.green, background: "transparent", border: `1px solid ${colors.green}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", transition: "all 0.15s", width: "100%" }}
                        onMouseEnter={e => { e.currentTarget.style.background = colors.green; e.currentTarget.style.color = "#fff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = colors.green; }}
                      >
                        <PhoneCall size={12} /> Call
                      </button>
                    ) : <span style={{ color: colors.inkMuted, fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", background: colors.surface, padding: 2, borderRadius: 8, border: `1px solid ${colors.rule}` }}>
                      {[
                        { id: "open", label: "Open", color: colors.green },
                        { id: "closed", label: "Closed", color: colors.inkMuted },
                        { id: "pickup", label: "Pickup", color: colors.amber }
                      ].map((m) => {
                        const cur = markOverrides[r.case_key] !== undefined ? markOverrides[r.case_key] : r.operator_mark;
                        const on = cur === m.id;
                        return (
                          <button 
                            key={m.id} 
                            type="button" 
                            title={on ? `Clear ${m.label} mark` : `Mark ${m.label}`}
                            onClick={() => doMark(r.case_key, m.id, cur)} 
                            style={{ 
                              width: 26, height: 26, borderRadius: 6, border: "none", 
                              background: on ? m.color : "transparent", 
                              color: on ? "#fff" : colors.inkMuted, 
                              cursor: "pointer", fontSize: 12, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "all 0.15s"
                            }}
                            onMouseEnter={e => { if (!on) e.currentTarget.style.color = colors.ink; }}
                            onMouseLeave={e => { if (!on) e.currentTarget.style.color = colors.inkMuted; }}
                          >
                            {m.id[0].toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: "60px 20px", textAlign: "center", color: colors.inkMuted }}>
                  <Filter size={32} style={{ opacity: 0.2, margin: "0 auto 12px" }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink }}>No rentals found</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Try adjusting your filters or search query.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
