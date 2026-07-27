import './_group.css';
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, Download, RefreshCw, Upload, ArrowUp, ArrowDown, ArrowUpDown,
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight, PhoneCall, CornerDownRight, Filter,
  List, CheckCircle2, UserX, X, FileText, MessageSquare, Plus, ChevronDown
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  redDeep: "var(--vrm-red-deep)",
  redDeepLight: "var(--vrm-red-deep-light)",
  greenDeep: "var(--vrm-green-deep)",
  greenDeepLight: "var(--vrm-green-deep-light)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
  blueDeep: "var(--vrm-blue-deep)",
  blueDeepLight: "var(--vrm-blue-deep-light)",
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
  // BYOV truck (88-prefix): tech drives their own vehicle, repairs not tracked → no shop info, never callable
  mk({
    case_key: "88217", vehicle_number: "88217", renter_name_raw: "Luis Herrera",
    tech_name: "Luis Herrera", tpms_tech: "Luis Herrera", employee_id: "T-52440",
    employee_status: "Active", employee_status_date: "2025-08-18",
    veh_desc: "2022 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 46.0,
    ams_status: null, ams_bucket: "other", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 11, last_rental_date: "2026-04-08", odometer: 58230,
  }),
];

interface LineItem { qty: number; description: string; repairType: string; ataGroup: string; cost: number; }
interface PO { poNumber: string; poDate: string; poStatus: string; vendorType: string; vendorName: string; vendorCity: string; vendorState: string; approver: string; odometer: number; repairDate: string; paidDate: string | null; poType: string; totalAmount: number; portalNote?: string; lineItems: LineItem[]; }
interface CallLogEntry { date: string; outcome: string; summary: string; }
interface NoteEntry { date: string; author: string; text: string; }

const MOCK_POS: Record<string, PO[]> = {
  "023132": [
    { poNumber:"H-482913", poDate:"2026-07-14", poStatus:"APPROVED", vendorType:"REPAIR", vendorName:"Precision Fleet Service", vendorCity:"Mesa", vendorState:"AZ", approver:"D. Kowalski", odometer:84120, repairDate:"2026-07-15", paidDate:null, poType:"REPAIR", totalAmount:2843.50, portalNote:"7/16 — Parts on order, ETA 7/21 per shop", lineItems:[ {qty:1, description:"Transmission service + solenoid replacement", repairType:"REPAIR", ataGroup:"27-TRANSMISSION", cost:2100.00}, {qty:2, description:"Fluid + filter kit", repairType:"PARTS", ataGroup:"27-TRANSMISSION", cost:486.00}, {qty:1, description:"Diagnostic labor", repairType:"LABOR", ataGroup:"00-GENERAL", cost:257.50} ] },
    { poNumber:"H-471002", poDate:"2026-06-02", poStatus:"PAID", vendorType:"MAINTENANCE", vendorName:"QuickLane 88", vendorCity:"Tempe", vendorState:"AZ", approver:"D. Kowalski", odometer:82655, repairDate:"2026-06-02", paidDate:"2026-06-12", poType:"PM", totalAmount:214.75, lineItems:[ {qty:1, description:"Lube-oil-filter + tire rotation", repairType:"PM", ataGroup:"01-PM", cost:214.75} ] }
  ],
  "041877": [ { poNumber:"H-479560", poDate:"2026-07-08", poStatus:"APPROVED", vendorType:"REPAIR", vendorName:"Metro Brake & Wheel", vendorCity:"Glendale", vendorState:"AZ", approver:"S. Whitmore", odometer:67230, repairDate:"2026-07-09", paidDate:null, poType:"REPAIR", totalAmount:1120.40, lineItems:[ {qty:1, description:"Front brake pads + rotors", repairType:"REPAIR", ataGroup:"13-BRAKES", cost:892.40}, {qty:1, description:"Brake fluid flush", repairType:"LABOR", ataGroup:"13-BRAKES", cost:228.00} ] } ],
  "092310": [ { poNumber:"H-490118", poDate:"2026-07-19", poStatus:"APPROVED", vendorType:"REPAIR", vendorName:"Desert Diesel Repair", vendorCity:"Chandler", vendorState:"AZ", approver:"S. Whitmore", odometer:112480, repairDate:"2026-07-20", paidDate:null, poType:"REPAIR", totalAmount:4310.00, portalNote:"Waiting on head gasket — shop est. 8-10 business days", lineItems:[ {qty:1, description:"Head gasket replacement", repairType:"REPAIR", ataGroup:"45-ENGINE", cost:3650.00}, {qty:1, description:"Coolant system flush", repairType:"LABOR", ataGroup:"42-COOLING", cost:660.00} ] } ],
  "071228": [ { poNumber:"H-488301", poDate:"2026-07-16", poStatus:"APPROVED", vendorType:"BODY SHOP", vendorName:"Sunline Collision", vendorCity:"Peoria", vendorState:"AZ", approver:"D. Kowalski", odometer:54900, repairDate:"2026-07-17", paidDate:null, poType:"BODY", totalAmount:2050.00, lineItems:[ {qty:1, description:"Right rear quarter panel repair + paint", repairType:"BODY", ataGroup:"98-BODY", cost:2050.00} ] } ]
};

const MOCK_CALL_LOG: Record<string, CallLogEntry[]> = {
  "023132": [ {date:"2026-07-18", outcome:"Reached shop", summary:"Shop confirmed parts arrived; repair completing ~7/22."}, {date:"2026-07-11", outcome:"Voicemail", summary:"Left message requesting repair status."} ],
  "041877": [ {date:"2026-07-17", outcome:"Reached shop", summary:"Brakes done; awaiting invoice upload."} ]
};

const MOCK_NOTES_INITIAL: Record<string, NoteEntry[]> = {
  "017640": [ {date:"2026-07-12", author:"jmorga1", text:"Tech says van was swapped at district lot 7/10 — investigating why rental still open."} ]
};

function isDeclinedAuction(b: string) {
  return b === "declined" || b === "auction";
}

// BYOV = tech's own vehicle (truck number starts with 88 or 088). BYOV repairs are
// not tracked, so these rows never have shop info. Check the RAW number — never
// zero-pad first (padding "88144" to "088144" would break the prefix test).
function isByov(truckNo: string | null | undefined): boolean {
  const raw = String(truckNo ?? "").trim();
  return raw.startsWith("88") || raw.startsWith("088");
}

function fmtPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "—");
}

function val(v: string | number | null | undefined): string {
  if (v == null || String(v).trim() === "") return "—";
  return String(v);
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

export function CardTabsContext() {
  const [activeTab, setActiveTab] = useState<string>("luca_queue");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [rows, setRows] = useState<MasterRow[]>(MOCK_ROWS);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<MasterRow | null>(null);
  const [drawerTargetTruck, setDrawerTargetTruck] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<"pos" | "calls" | "notes">("pos");
  const [notesState, setNotesState] = useState(MOCK_NOTES_INITIAL);
  const [newNote, setNewNote] = useState("");
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());

  const callMut = useNoopMutation();
  const callAllMut = useNoopMutation();
  const markMut = useNoopMutation();

  const doCall = (r: MasterRow) => { callMut.mutate(r.case_key); };
  const doCallAll = () => { if (visibleCallable.length) callAllMut.mutate(visibleCallable.map((r) => r.case_key)); };
  const doMark = (caseKey: string, mark: string, current: string | null) => {
    const next = current === mark ? null : mark;
    markMut.mutate({ caseKey, mark: next ?? "none" });
    setRows(rs => rs.map(r => r.case_key === caseKey ? { ...r, operator_mark: next } : r));
  };

  const openDrawer = (r: MasterRow) => {
    setSelectedRow(r);
    setDrawerTargetTruck(r.case_key);
    setDrawerTab("pos");
    setDrawerOpen(true);
    setExpandedPOs(new Set());
    setNewNote("");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => {
      setSelectedRow(null);
      setDrawerTargetTruck(null);
    }, 300);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawerOpen) closeDrawer();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const togglePO = (poNum: string) => {
    setExpandedPOs(prev => {
      const next = new Set(prev);
      if (next.has(poNum)) next.delete(poNum);
      else next.add(poNum);
      return next;
    });
  };

  const handleAddNote = () => {
    if (!newNote.trim() || !drawerTargetTruck) return;
    setNotesState(prev => ({
      ...prev,
      [drawerTargetTruck]: [
        ...(prev[drawerTargetTruck] || []),
        { date: new Date().toISOString().split('T')[0], author: "current_user", text: newNote.trim() }
      ]
    }));
    setNewNote("");
  };

  const pool = rows;
  const openRepairCount = pool.filter(r => r.repair_cohort === "open_repair").length;
  const amsBadCount = pool.filter(r => isDeclinedAuction(r.ams_bucket)).length;
  const mismatchCount = pool.filter(r => r.type_mismatch).length;
  
  const lucaQueue = pool.filter(r => r.callable);

  // Derived insights for tabs
  const openAvgDays = pool.filter(r => r.repair_cohort === "open_repair").reduce((acc, r) => acc + (r.days_open || 0), 0) / (openRepairCount || 1);
  const totalCost = pool.reduce((acc, r) => acc + (r.daily_cost || 0), 0);
  const mismatchDelta = pool.filter(r => r.type_mismatch).reduce((acc, r) => acc + (r.cost_delta || 0), 0);

  const filtered = useMemo(() => {
    return pool.filter(r => {
      if (activeTab === "luca_queue" && !r.callable) return false;
      if (activeTab === "open_repair" && r.repair_cohort !== "open_repair") return false;
      if (activeTab === "ams_bad" && !isDeclinedAuction(r.ams_bucket)) return false;
      if (activeTab === "mismatch" && !r.type_mismatch) return false;
      
      if (statusFilter !== "all" && r.ams_status !== statusFilter) return false;

      const q = search.trim().toLowerCase();
      if (q) {
        const hay = `${r.case_key} ${r.renter_name_raw} ${r.shop_name || ""} ${r.veh_desc || ""} ${r.rental_class || ""} ${r.tech_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pool, activeTab, search, statusFilter]);

  const visibleCallable = useMemo(() => filtered.filter(r => r.callable), [filtered]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => Number(r.case_key), tech: (r) => r.renter_name_raw,
      veh: (r) => r.veh_desc, cls: (r) => r.rental_class,
      ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open,
      tpms: (r) => r.tpms_tech,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const thStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "12px", textAlign: "left", borderBottom: `1px solid ${colors.rule}`, backgroundColor: colors.surface, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 };
  const tdStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, padding: "12px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap", transition: "background-color 0.15s" };

  const Th = ({ col, label, style }: { col: string; label: string; style?: React.CSSProperties }) => {
    const active = sort.col === col && sort.dir != null;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    const onClick = () => setSort((s) => s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null });
    
    // Subtly foreground the relevant column based on active tab
    const isForegrounded = 
      (activeTab === "mismatch" && col === "cls") ||
      (activeTab === "ams_bad" && col === "ams") ||
      (activeTab === "open_repair" && col === "days") ||
      (activeTab === "luca_queue" && col === "shop");

    return (
      <th style={{ ...thStyle, ...style, color: isForegrounded ? colors.ink : colors.inkMuted, fontWeight: isForegrounded ? 700 : 500 }}>
        <button type="button" onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }}>
          <span>{label}</span><Icon size={12} style={{ opacity: active ? 1 : 0.4, color: active ? colors.accent : "inherit" }} />
        </button>
      </th>
    );
  };

  const kpis = [
    { id: "all", label: "All rentals", value: pool.length, fg: colors.ink, icon: List, insight: `$${Math.round(totalCost)}/day run rate`, bg: "#fff", activeBg: "#fff" },
    { id: "luca_queue", label: "LUCA Call Queue", value: lucaQueue.length, fg: colors.green, icon: PhoneCall, insight: `${Math.round(lucaQueue.length / pool.length * 100)}% of fleet callable`, bg: colors.surface, activeBg: colors.greenLight },
    { id: "open_repair", label: "Open repair ticket", value: openRepairCount, fg: colors.blue, icon: Wrench, insight: `${Math.round(openAvgDays)} days avg age`, bg: colors.surface, activeBg: colors.blueLight },
    { id: "ams_bad", label: "Auction / Declined", value: amsBadCount, fg: colors.redDeep, icon: AlertTriangle, insight: "Needs reassignment", bg: colors.surface, activeBg: colors.redLight },
    { id: "mismatch", label: "Type mismatch", value: mismatchCount, fg: colors.amber, icon: CircleDollarSign, insight: `+$${Math.round(mismatchDelta)}/day waste`, bg: colors.surface, activeBg: colors.amberLight },
  ];

  const activeKpi = kpis.find(k => k.id === activeTab) || kpis[0];

  const tabContexts: Record<string, React.ReactNode> = {
    all: "Showing all open vehicle rentals across the enterprise.",
    luca_queue: `${lucaQueue.length} verified shops are ready for automated status checks.`,
    open_repair: "Rentals currently attached to an open repair ticket. Older tickets need escalation.",
    ams_bad: "Vehicles that failed repair or are marked for auction. Techs need immediate reassignment.",
    mismatch: "Techs renting vehicles larger or more expensive than their assigned class.",
  };

  // Unique AMS statuses for filter
  const uniqueStatuses = Array.from(new Set(pool.map(r => r.ams_status).filter(Boolean))) as string[];

  return (
    <TooltipProvider>
      <div className="min-h-screen" style={{ fontFamily: fonts.dmSans, color: colors.ink, background: colors.background, padding: 24, position: "relative", overflow: drawerOpen ? "hidden" : "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, margin: 0, color: colors.ink }}>Rental Operations</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, color: colors.inkMuted }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><RefreshCw size={12} /> Last synced 7 min ago</span>
            <span style={{ color: colors.blue, cursor: "pointer", fontWeight: 600 }}>Data health</span>
          </div>
        </div>

        {/* KPI Cards as Tabs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
          {kpis.map((k) => {
            const isActive = activeTab === k.id;
            return (
              <div 
                key={k.id}
                onClick={() => { setActiveTab(k.id); setSearch(""); setStatusFilter("all"); }}
                style={{ 
                  background: isActive ? k.activeBg : k.bg, 
                  border: `1px solid ${isActive ? k.fg : colors.rule}`, 
                  borderRadius: 12, 
                  padding: "16px 20px",
                  cursor: "pointer",
                  boxShadow: isActive ? `0 4px 16px ${k.fg}20` : "0 1px 3px rgba(0,0,0,0.02)",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  position: "relative",
                  overflow: "hidden"
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = colors.inkMuted;
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = colors.rule;
                    e.currentTarget.style.transform = "none";
                  }
                }}
              >
                {isActive && (
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: k.fg }} />
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ color: isActive ? k.fg : colors.inkMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                    {k.label}
                  </div>
                  <k.icon size={16} color={isActive ? k.fg : colors.inkMuted} style={{ opacity: isActive ? 1 : 0.5 }} />
                </div>
                <div style={{ fontFamily: fonts.syne, fontSize: 32, fontWeight: 800, color: isActive ? k.fg : colors.ink, lineHeight: 1 }}>
                  {k.value}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: isActive ? k.fg : colors.inkMuted, fontWeight: 500, opacity: isActive ? 0.9 : 0.7 }}>
                  {k.insight}
                </div>
              </div>
            );
          })}
        </div>

        {/* Contextual Action Line */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 14, color: colors.inkMuted, display: "flex", alignItems: "center", gap: 8 }}>
              {activeKpi.icon && <activeKpi.icon size={16} color={activeKpi.fg} />}
              <span style={{ color: activeKpi.fg, fontWeight: 600 }}>{activeKpi.label}</span>
              <span style={{ opacity: 0.5 }}>|</span>
              {tabContexts[activeTab]}
            </div>
            
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {/* Search */}
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.inkMuted }} />
                <input 
                  type="text" 
                  placeholder="Search..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)}
                  style={{ padding: "8px 12px 8px 36px", borderRadius: 8, border: `1px solid ${search ? activeKpi.fg : colors.rule}`, fontSize: 13, background: "#fff", width: 260, outline: "none", boxShadow: search ? `0 0 0 2px ${activeKpi.fg}20` : "none", transition: "all 0.2s" }} 
                />
              </div>
              
              {/* Filter Dropdown */}
              <div style={{ position: "relative" }}>
                <button 
                  onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${statusFilter !== 'all' ? activeKpi.fg : colors.rule}`, background: statusFilter !== 'all' ? activeKpi.activeBg : "#fff", fontSize: 13, fontWeight: 500, color: statusFilter !== 'all' ? activeKpi.fg : colors.ink, cursor: "pointer", transition: "all 0.2s" }}
                >
                  <Filter size={14} /> 
                  {statusFilter === 'all' ? 'Filter by AMS' : `AMS: ${statusFilter}`}
                </button>
                {filterDropdownOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", border: `1px solid ${colors.rule}`, borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.1)", zIndex: 10, minWidth: 200, padding: 8 }}>
                    <div 
                      onClick={() => { setStatusFilter("all"); setFilterDropdownOpen(false); }}
                      style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderRadius: 4, background: statusFilter === "all" ? colors.surface : "transparent", fontWeight: statusFilter === "all" ? 600 : 400 }}
                    >
                      All Statuses
                    </div>
                    {uniqueStatuses.map(s => (
                      <div 
                        key={s}
                        onClick={() => { setStatusFilter(s); setFilterDropdownOpen(false); }}
                        style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderRadius: 4, background: statusFilter === s ? colors.surface : "transparent", fontWeight: statusFilter === s ? 600 : 400 }}
                      >
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(search || statusFilter !== 'all') && (
                <div style={{ fontSize: 13, color: colors.inkMuted, fontWeight: 500 }}>
                  Showing {filtered.length} of {activeKpi.value}
                </div>
              )}
            </div>
          </div>
          
          {activeTab === "luca_queue" && (
            <button onClick={doCallAll} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 8, background: colors.green, color: "#fff", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", boxShadow: `0 4px 12px ${colors.green}40`, transition: "transform 0.1s, box-shadow 0.1s" }}
              onMouseDown={e => { e.currentTarget.style.transform = "translateY(1px)"; e.currentTarget.style.boxShadow = "none"; }}
              onMouseUp={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 4px 12px ${colors.green}40`; }}
            >
              <PhoneCall size={16} /> Call all {visibleCallable.length} with LUCA
            </button>
          )}
        </div>

        {/* Grid */}
        <div style={{ overflow: "auto", border: `1px solid ${colors.rule}`, borderRadius: 12, background: "#fff", maxHeight: "calc(100vh - 280px)", boxShadow: "0 4px 20px rgba(0,0,0,0.03)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 40, textAlign: "right" }}>#</th>
                <Th col="trk" label="Truck" />
                <Th col="tech" label="Tech" />
                <Th col="veh" label="Vehicle" />
                <Th col="cls" label="Rental Class" />
                <Th col="ams" label="AMS Status" />
                <Th col="shop" label="Shop Info" />
                <Th col="days" label="Days Open" style={{ textAlign: "right" }} />
                <th style={{ ...thStyle, textAlign: "center" }}>LUCA</th>
                <th style={{ ...thStyle, textAlign: "center", width: 120 }}>Operator Mark</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const isHovered = hoveredRow === r.case_key;
                
                // Color mapping for AMS pills
                let amsPillColor = colors.inkMuted;
                let amsPillBg = colors.surface;
                if (r.ams_bucket === 'in_repair') {
                  amsPillColor = colors.blueDeep;
                  amsPillBg = colors.blueLight;
                } else if (r.ams_bucket === 'auction' || r.ams_bucket === 'declined') {
                  amsPillColor = colors.redDeep;
                  amsPillBg = colors.redLight;
                } else if (r.ams_bucket === 'in_use') {
                  amsPillColor = colors.greenDeep;
                  amsPillBg = colors.greenLight;
                }

                // Tech vs TPMS signal
                const techMismatch = r.tech_name && r.tpms_tech && r.tech_name !== r.tpms_tech;
                const missingTpms = r.tech_name && !r.tpms_tech;

                return (
                  <tr 
                    key={r.case_key} 
                    onMouseEnter={() => setHoveredRow(r.case_key)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => openDrawer(r)}
                    style={{ 
                      cursor: "pointer", 
                      background: isHovered ? activeKpi.activeBg : "transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, background: "transparent", textAlign: "right", color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{i + 1}</td>
                    <td style={{ ...tdStyle, background: "transparent", fontFamily: fonts.jetbrains, fontWeight: 600 }}>
                      {r.case_key}
                      {isByov(r.vehicle_number) && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: colors.blueDeep, background: colors.blueLight, borderRadius: 4, padding: "2px 6px", fontFamily: fonts.dmSans }}>BYOV</span>}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{val(r.renter_name_raw)}</span>
                        {(techMismatch || missingTpms) && (
                          <span style={{ fontSize: 11, color: techMismatch ? colors.amber : colors.red, display: "flex", alignItems: "center", gap: 4 }}>
                            {techMismatch ? <AlertTriangle size={10} /> : <UserX size={10} />}
                            {techMismatch ? `TPMS: ${r.tpms_tech}` : "Missing TPMS"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, background: "transparent" }}>{val(r.veh_desc)}</td>
                    <td style={{ ...tdStyle, background: "transparent", fontSize: 12, fontWeight: activeTab === 'mismatch' ? 600 : 400, color: (activeTab === 'mismatch' && r.type_mismatch) ? colors.amber : colors.ink }}>
                      {val(r.rental_class)}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent" }}>
                      {r.ams_status ? (
                        <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: amsPillColor, background: amsPillBg, borderRadius: 6, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                          {r.ams_status}
                        </span>
                      ) : <span style={{ color: colors.inkMuted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent", fontSize: 12 }}>
                      {isByov(r.vehicle_number) ? (
                        <span style={{ color: colors.inkMuted, fontStyle: "italic", display: "flex", alignItems: "center", gap: 4 }}>
                          <CornerDownRight size={12} /> BYOV — repairs not tracked
                        </span>
                      ) : (<>
                        <div style={{ fontWeight: 500, color: (activeTab === 'luca_queue' && r.callable) ? colors.greenDeep : colors.ink }}>{val(r.shop_name)}</div>
                        {r.portal_shop_phone && <div style={{ fontSize: 11, color: colors.inkMuted, fontFamily: fonts.jetbrains, marginTop: 2 }}>{fmtPhone(r.portal_shop_phone)}</div>}
                      </>)}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent", textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: activeTab === 'open_repair' ? 600 : 400, color: activeTab === 'open_repair' ? colors.blueDeep : colors.ink }}>
                      {r.days_open ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      {r.callable ? (
                        <button type="button" onClick={() => doCall(r)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.greenDeep, background: colors.greenLight, border: `1px solid ${colors.greenDeep}40`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", transition: "all 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.background = colors.greenDeepLight}
                          onMouseLeave={e => e.currentTarget.style.background = colors.greenLight}
                        >
                          <PhoneCall size={12} /> Call
                        </button>
                      ) : <span style={{ color: colors.inkMuted, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, background: "transparent", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "inline-flex", gap: 4, background: colors.surface, padding: 3, borderRadius: 8 }}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button 
                              type="button" 
                              onClick={() => doMark(r.case_key, "open", r.operator_mark)} 
                              style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: r.operator_mark === "open" ? colors.green : "transparent", color: r.operator_mark === "open" ? "#fff" : colors.inkMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            >
                              <List size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Mark as Open</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button 
                              type="button" 
                              onClick={() => doMark(r.case_key, "closed", r.operator_mark)} 
                              style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: r.operator_mark === "closed" ? colors.ink : "transparent", color: r.operator_mark === "closed" ? "#fff" : colors.inkMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            >
                              <CheckCircle2 size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Mark as Closed</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button 
                              type="button" 
                              onClick={() => doMark(r.case_key, "pickup", r.operator_mark)} 
                              style={{ width: 26, height: 26, borderRadius: 6, border: "none", background: r.operator_mark === "pickup" ? colors.amber : "transparent", color: r.operator_mark === "pickup" ? "#fff" : colors.inkMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            >
                              <Wrench size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Mark as Pickup</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, background: "transparent", color: isHovered ? colors.accent : colors.inkMuted, transition: "color 0.15s" }}>
                      <ChevronRight size={16} />
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ ...tdStyle, background: "transparent", textAlign: "center", color: colors.inkMuted, padding: "40px 20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <Search size={32} style={{ opacity: 0.2 }} />
                      <div style={{ fontSize: 15, fontWeight: 500, color: colors.ink }}>No rentals found</div>
                      <div style={{ fontSize: 13, maxWidth: 300, margin: "0 auto" }}>Try adjusting your search or filter to find what you're looking for.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Drawer Overlay */}
        {drawerOpen && (
          <div 
            onClick={closeDrawer}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.3)", zIndex: 10, opacity: drawerOpen ? 1 : 0, transition: "opacity 0.3s" }}
          />
        )}

        {/* Drawer Panel */}
        <div style={{ 
          position: "absolute", top: 0, right: 0, bottom: 0, width: 600, background: "#fff", 
          boxShadow: "-4px 0 24px rgba(0,0,0,0.1)", zIndex: 20,
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          display: "flex", flexDirection: "column"
        }}>
          {selectedRow && drawerTargetTruck && (
            <>
              {/* Drawer Header */}
              <div style={{ padding: "24px 32px", borderBottom: `1px solid ${colors.rule}`, background: colors.background }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <h2 style={{ fontFamily: fonts.jetbrains, fontSize: 24, fontWeight: 700, margin: 0, color: colors.ink }}>{selectedRow.case_key}</h2>
                      {selectedRow.ams_status && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: colors.blueDeep, background: colors.blueLight, borderRadius: 6, padding: "4px 10px", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                          {selectedRow.ams_status}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: colors.inkSoft, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{selectedRow.renter_name_raw}</span>
                      <span style={{ color: colors.inkMuted }}>•</span>
                      <span>{selectedRow.shop_name || "No shop info"}</span>
                      {selectedRow.days_open && (
                        <>
                          <span style={{ color: colors.inkMuted }}>•</span>
                          <span style={{ color: colors.redDeep, fontWeight: 600 }}>{selectedRow.days_open} days open</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button onClick={closeDrawer} style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 4, borderRadius: 4 }}>
                    <X size={20} />
                  </button>
                </div>

                {/* Truck Switcher (if assigned mismatch) */}
                {selectedRow.assigned_truck && (
                  <div style={{ display: "flex", background: colors.surface, borderRadius: 8, padding: 4, marginTop: 16 }}>
                    <button 
                      onClick={() => setDrawerTargetTruck(selectedRow.case_key)}
                      style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: drawerTargetTruck === selectedRow.case_key ? "#fff" : "transparent", color: drawerTargetTruck === selectedRow.case_key ? colors.ink : colors.inkMuted, fontWeight: drawerTargetTruck === selectedRow.case_key ? 600 : 500, fontSize: 13, cursor: "pointer", boxShadow: drawerTargetTruck === selectedRow.case_key ? "0 1px 3px rgba(0,0,0,0.05)" : "none", transition: "all 0.15s" }}
                    >
                      Rental {selectedRow.case_key}
                    </button>
                    <button 
                      onClick={() => setDrawerTargetTruck(selectedRow.assigned_truck!)}
                      style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: drawerTargetTruck === selectedRow.assigned_truck ? "#fff" : "transparent", color: drawerTargetTruck === selectedRow.assigned_truck ? colors.ink : colors.inkMuted, fontWeight: drawerTargetTruck === selectedRow.assigned_truck ? 600 : 500, fontSize: 13, cursor: "pointer", boxShadow: drawerTargetTruck === selectedRow.assigned_truck ? "0 1px 3px rgba(0,0,0,0.05)" : "none", transition: "all 0.15s" }}
                    >
                      Assigned {selectedRow.assigned_truck}
                    </button>
                  </div>
                )}
              </div>

              {/* Drawer Tabs */}
              <div style={{ display: "flex", borderBottom: `1px solid ${colors.rule}`, padding: "0 32px" }}>
                {[
                  { id: "pos", label: "PO History", icon: FileText },
                  { id: "calls", label: "LUCA Call Log", icon: PhoneCall },
                  { id: "notes", label: "Operator Notes", icon: MessageSquare }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setDrawerTab(t.id as any)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px", background: "transparent", border: "none", borderBottom: `2px solid ${drawerTab === t.id ? colors.accent : "transparent"}`, color: drawerTab === t.id ? colors.ink : colors.inkMuted, fontWeight: drawerTab === t.id ? 600 : 500, fontSize: 14, cursor: "pointer", transition: "color 0.15s" }}
                  >
                    <t.icon size={16} /> {t.label}
                  </button>
                ))}
              </div>

              {/* Drawer Content */}
              <div style={{ flex: 1, overflow: "auto", padding: "32px", background: "#fff" }}>
                {drawerTab === "pos" && (
                  <div>
                    {isByov(drawerTargetTruck) ? (
                      <div style={{ textAlign: "center", padding: "60px 0", color: colors.inkMuted }}>
                        <FileText size={32} style={{ opacity: 0.2, margin: "0 auto 12px" }} />
                        <div style={{ fontSize: 15, fontWeight: 500, color: colors.ink, marginBottom: 8 }}>BYOV — repairs not tracked</div>
                        <div style={{ fontSize: 13 }}>No Holman PO history available for personal vehicles.</div>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const pos = MOCK_POS[drawerTargetTruck] || [];
                          if (pos.length === 0) {
                            return (
                              <div style={{ textAlign: "center", padding: "60px 0", color: colors.inkMuted }}>
                                <FileText size={32} style={{ opacity: 0.2, margin: "0 auto 12px" }} />
                                <div style={{ fontSize: 15, fontWeight: 500, color: colors.ink, marginBottom: 8 }}>No POs on file for this truck.</div>
                                <div style={{ fontSize: 13 }}>Holman has no repair records for {drawerTargetTruck}.</div>
                              </div>
                            );
                          }
                          const totalSpend = pos.reduce((acc, p) => acc + p.totalAmount, 0);
                          const latestDate = pos.map(p => p.poDate).sort().pop();
                          return (
                            <>
                              <div style={{ fontSize: 13, color: colors.inkMuted, marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 600, color: colors.ink }}>{pos.length} PO{pos.length !== 1 && 's'}</span>
                                <span>•</span>
                                <span style={{ fontWeight: 600, color: colors.ink }}>${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2 })} total</span>
                                <span>•</span>
                                <span>Last activity {latestDate}</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                {pos.map(po => {
                                  const isExpanded = expandedPOs.has(po.poNumber);
                                  return (
                                    <div key={po.poNumber} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
                                      <div 
                                        onClick={() => togglePO(po.poNumber)}
                                        style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: isExpanded ? colors.background : "#fff", cursor: "pointer", transition: "background 0.15s" }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                                          <ChevronDown size={16} style={{ color: colors.inkMuted, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                                          <div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                                              <span style={{ fontFamily: fonts.jetbrains, fontWeight: 700, fontSize: 14 }}>{po.poNumber}</span>
                                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: po.poStatus === "APPROVED" ? colors.blueLight : colors.greenLight, color: po.poStatus === "APPROVED" ? colors.blueDeep : colors.greenDeep }}>{po.poStatus}</span>
                                              <span style={{ fontSize: 13, color: colors.inkMuted }}>{po.poDate}</span>
                                            </div>
                                            <div style={{ fontSize: 13, color: colors.inkSoft, fontWeight: 500 }}>
                                              {po.vendorName} <span style={{ color: colors.inkMuted, fontWeight: 400 }}>({po.vendorType})</span>
                                            </div>
                                          </div>
                                        </div>
                                        <div style={{ fontFamily: fonts.jetbrains, fontWeight: 700, fontSize: 15, color: colors.ink }}>
                                          ${po.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </div>
                                      </div>
                                      
                                      {isExpanded && (
                                        <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${colors.rule}`, background: colors.background }}>
                                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "16px 0" }}>
                                            <div>
                                              <div style={{ fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", marginBottom: 4 }}>Location</div>
                                              <div style={{ fontSize: 13, fontWeight: 500 }}>{po.vendorCity}, {po.vendorState}</div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", marginBottom: 4 }}>Odometer</div>
                                              <div style={{ fontSize: 13, fontWeight: 500, fontFamily: fonts.jetbrains }}>{po.odometer.toLocaleString()}</div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", marginBottom: 4 }}>Repair Date</div>
                                              <div style={{ fontSize: 13, fontWeight: 500 }}>{po.repairDate}</div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", marginBottom: 4 }}>Approver</div>
                                              <div style={{ fontSize: 13, fontWeight: 500 }}>{po.approver}</div>
                                            </div>
                                          </div>
                                          
                                          {po.portalNote && (
                                            <div style={{ background: "#fff", padding: "12px 16px", borderRadius: 6, borderLeft: `3px solid ${colors.amber}`, marginBottom: 16 }}>
                                              <div style={{ fontSize: 11, color: colors.amber, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Holman Note</div>
                                              <div style={{ fontSize: 13, color: colors.ink }}>{po.portalNote}</div>
                                            </div>
                                          )}
                                          
                                          <div style={{ background: "#fff", borderRadius: 6, border: `1px solid ${colors.rule}`, overflow: "hidden" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                              <thead style={{ background: colors.surface }}>
                                                <tr>
                                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: colors.inkMuted, fontWeight: 600 }}>Qty</th>
                                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: colors.inkMuted, fontWeight: 600 }}>Description</th>
                                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: colors.inkMuted, fontWeight: 600 }}>Type</th>
                                                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: colors.inkMuted, fontWeight: 600 }}>ATA Group</th>
                                                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, color: colors.inkMuted, fontWeight: 600 }}>Cost</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {po.lineItems.map((item, idx) => (
                                                  <tr key={idx} style={{ borderTop: `1px solid ${colors.rule}` }}>
                                                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.jetbrains, color: colors.inkMuted }}>{item.qty}</td>
                                                    <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 500 }}>{item.description}</td>
                                                    <td style={{ padding: "8px 12px", fontSize: 12, color: colors.inkMuted }}>{item.repairType}</td>
                                                    <td style={{ padding: "8px 12px", fontSize: 12, color: colors.inkMuted }}>{item.ataGroup}</td>
                                                    <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12, fontFamily: fonts.jetbrains }}>${item.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                )}

                {drawerTab === "calls" && (
                  <div>
                    {(() => {
                      const calls = MOCK_CALL_LOG[drawerTargetTruck] || [];
                      if (calls.length === 0) {
                        return (
                          <div style={{ textAlign: "center", padding: "60px 0", color: colors.inkMuted }}>
                            <PhoneCall size={32} style={{ opacity: 0.2, margin: "0 auto 12px" }} />
                            <div style={{ fontSize: 15, fontWeight: 500, color: colors.ink, marginBottom: 8 }}>No LUCA calls yet.</div>
                            <div style={{ fontSize: 13 }}>LUCA hasn't called the shop for this truck.</div>
                          </div>
                        );
                      }
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          {calls.map((call, idx) => (
                            <div key={idx} style={{ display: "flex", gap: 16 }}>
                              <div style={{ width: 1, background: colors.rule, position: "relative", marginLeft: 8 }}>
                                <div style={{ position: "absolute", top: 0, left: -4, width: 9, height: 9, borderRadius: "50%", background: colors.green }} />
                              </div>
                              <div style={{ flex: 1, paddingBottom: 16 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink }}>{call.date}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: colors.greenLight, color: colors.greenDeep, textTransform: "uppercase" }}>{call.outcome}</span>
                                </div>
                                <div style={{ fontSize: 14, color: colors.inkSoft, background: colors.surface, padding: "12px 16px", borderRadius: 8 }}>
                                  {call.summary}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {drawerTab === "notes" && (
                  <div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
                      {(notesState[drawerTargetTruck] || []).map((note, idx) => (
                        <div key={idx} style={{ background: colors.surface, padding: "16px", borderRadius: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: colors.ink }}>{note.author}</span>
                            <span style={{ fontSize: 12, color: colors.inkMuted }}>{note.date}</span>
                          </div>
                          <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5 }}>
                            {note.text}
                          </div>
                        </div>
                      ))}
                      {(notesState[drawerTargetTruck] || []).length === 0 && (
                        <div style={{ textAlign: "center", padding: "40px 0", color: colors.inkMuted }}>
                          <MessageSquare size={32} style={{ opacity: 0.2, margin: "0 auto 12px" }} />
                          <div style={{ fontSize: 14, fontWeight: 500, color: colors.ink }}>No notes yet.</div>
                        </div>
                      )}
                    </div>
                    
                    <div style={{ borderTop: `1px solid ${colors.rule}`, paddingTop: 24 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add Note</div>
                      <textarea 
                        value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        placeholder="Type a note..."
                        style={{ width: "100%", height: 100, padding: 12, borderRadius: 8, border: `1px solid ${colors.rule}`, background: "#fff", fontSize: 14, resize: "none", marginBottom: 12, fontFamily: "inherit" }}
                      />
                      <button 
                        onClick={handleAddNote}
                        disabled={!newNote.trim()}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 6, background: newNote.trim() ? colors.accent : colors.surface, color: newNote.trim() ? "#fff" : colors.inkMuted, fontSize: 13, fontWeight: 600, border: "none", cursor: newNote.trim() ? "pointer" : "default", transition: "background 0.2s" }}
                      >
                        <Plus size={14} /> Add Note
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
