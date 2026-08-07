/**
 * Shared VRM case-model contract for the two boards (Rental Operations,
 * Cases by Region).
 *
 * ONE MasterRow type and ONE set of row derivations, so the boards cannot
 * drift apart field-by-field or rule-by-rule — before this file each page
 * carried its own verbatim copy of the interface and of every derivation
 * below, and they had to be kept in sync by hand.
 *
 * Mirrors the server contract (read-repository MasterRow + the route-attached
 * reconciledShop / workbook fields). If the server grows a field, add it HERE
 * and both boards pick it up together. The surface-alignment server test pins
 * the server side of this contract.
 */

/** Server-reconciled shop-of-record pick (the SAME value the queue cards and
 * the case drawer show — assembled once server-side by displayShopFor).
 * undefined = response predates the field; null = no qualifying repair PO and
 * no display fallback. `shopPhoneIsFallback` marks a phone that came from the
 * fs_trucks mirror (display-only fallback), not from the reconciled PO pick. */
export interface ReconciledShop {
  shopName: string | null;
  shopPhone: string | null;
  effStatus: string | null;
  shopPoDate: string | null;
  poNumber: string | null;
  openPoCount: number;
  portalAt: string | null;
  shopPhoneIsFallback?: boolean;
}

/** The board-row field contract (server read-repository MasterRow as served).
 * Rental Operations extends it with the workbook fields its route attaches. */
export interface MasterRow {
  case_key: string;
  reconciledShop?: ReconciledShop | null;
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
  tpms_own_truck: string | null;
  wrong_truck: boolean;
  odometer: number | null;
  odometer_date: string | null;
  portal_msg_count: number | null;
  portal_shop_phone: string | null;
  shop_phone_locked: boolean;
  shop_phone_source: string | null;
  shop_phone_edited_by: string | null;
  shop_phone_edited_at: string | null;
  assigned_phone_locked: boolean;
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
  /** Manual "verified ready with the shop" mark (shared with the Ops Queue). */
  ready_verified: boolean;
  ready_verified_by: string | null;
  ready_verified_at: string | null;
  /** "Escalated to research" mark (shop can't be validated from POs/calls). */
  research_active: boolean;
  research_by: string | null;
  research_at: string | null;
  present_in_latest: boolean;
  last_seen_at: string | null;
}

/** Whole days since a date string (calendar-agnostic, floor of elapsed time). */
export function daysSince(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export const isDeclinedAuction = (b: string) => b === "declined" || b === "auction";

/** THE workload derivation. Used by BOTH the chip counts and the row filter so a
 * chip can never advertise a number and then open a grid that disagrees.
 * cannot_work comes from ams_bucket (the same field the Declined/Auction chips
 * count). The server's workload_bucket only splits escalation out of the rest;
 * when the running server predates that field, rows fall through to workable and
 * the escalation chip renders "—" instead of a misleading 0. */
export type WorkloadBucket = "cannot_work" | "mismatch_no_po" | "workable";
export function workloadBucketOf(r: { ams_bucket: string; workload_bucket?: string | null }): WorkloadBucket {
  if (isDeclinedAuction(r.ams_bucket)) return "cannot_work";
  if (r.workload_bucket === "mismatch_no_po") return "mismatch_no_po";
  return "workable";
}

/** "New hire" as the boards define it: Active and in the first 270 days.
 * (The Executive Summary currently uses a 60-day window for its new-hire
 * callout — a DIFFERENT business definition under the same label; flagged to
 * Tyler rather than silently unified here.) */
export function isNewHire(r: { employee_status: string | null; employee_status_date: string | null }): boolean {
  const d = daysSince(r.employee_status_date);
  return r.employee_status === "Active" && d != null && d <= 270;
}

/** Employment states that make a rental case urgent regardless of repair state. */
export function isUrgentEmp(r: { employee_status: string | null }): boolean {
  return r.employee_status === "Terminated" || r.employee_status === "On Leave";
}
