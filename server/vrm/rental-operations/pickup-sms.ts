/**
 * VRM Rental Operations V2 — "text the tech to pick up their van" SMS.
 *
 * Tyler 2026-07-29: LUCA already works the SHOP side on its own cadence. The
 * half nobody had a button for is the TECH side — the tech whose truck is out
 * of the shop still has our rental, and somebody has to tell them to go get
 * their van and hand the rental back. That message is what closes the rental
 * and stops the daily charge, so it is the single highest-value manual action
 * on this page.
 *
 * This module does NOT talk to Twilio. Every outbound text on this app goes
 * through the Master Fleet Communications pipeline (server/fleet-comms/
 * outbound.ts sendMessage), which owns the things that make texting a real
 * employee safe and legal:
 *   - STOP / opt-out enforcement
 *   - recipient-LOCAL quiet hours (outside the window it QUEUES, never drops)
 *   - the tech's thread, so replies land somewhere a human reads
 *   - per-message delivery callbacks and segment billing
 * Re-implementing any of that here would be a second, worse lane.
 *
 * Identity chain, and it is the part that bites:
 *   MasterRow.employee_id  ->  all_techs.tech_racfid  ->  fs_comms_contacts.ldap
 * `employee_id` is an 11-digit payroll id and is NEVER the comms key. The comms
 * key is the RACF id ("DKELLE4"). Do not trust the schema comment on
 * fs_comms_contacts.ldap that calls it "UPPER(TRIM(ENTERPRISE_ID))" — that is a
 * DIFFERENT enterprise id from the rental feed's ENTERPRISE_ID (which really is
 * the payroll number). Measured against prod 2026-07-29, joining the identity
 * rows to contacts:
 *     via all_techs.tech_racfid ... 406 matches
 *     via employee_id directly  ...   0 matches
 * with roster-vs-contact name agreement 8/8 on a spot check. So the RACF hop is
 * mandatory, and getting it wrong does not error — it silently texts nobody, or
 * worse, the wrong person. Of 424 identity rows, 409 have a RACF id, 406 reach
 * a contact, 399 of those have a phone: ~94% textable, and the remainder must
 * fail LOUDLY rather than silently no-op.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getRentalOpsMaster, type MasterRow } from "./read-repository";
import { sendMessage } from "../../fleet-comms/outbound";
import { getContactByLdap } from "../../fleet-comms/storage";
import { countSegments } from "../../fleet-comms/lib";

/** Every message this module sends is filed under the rental book. */
export const PICKUP_SMS_CATEGORY = "rental_management";

/** action_type written to vrm_rental_operation_actions so the page has a receipt. */
export const PICKUP_SMS_ACTION_TYPE = "pickup_text";

export interface PickupTarget {
  case_key: string;
  /**
   * The truck sitting at the shop — what the tech goes and COLLECTS.
   *
   * This is `case_key`, and getting it backwards is the trap. `case_key` is
   * `vrm_rental_operations_cases.vehicle_number`, and every repair join in the
   * read model hangs off it (holman_vehicles_cache, vrm_holman_portal_hist.
   * truck_no, po_agg.truck, shop_pick.truck). So it is the SEARS truck under
   * repair, NOT the rental unit. The rental is an Enterprise/vendor vehicle we
   * do not carry a truck number for at all — it is identified by vendor +
   * ticket. An earlier cut of this file said "return rental {case_key}", which
   * would have told the technician to hand back their own van.
   */
  repair_truck: string;
  /** Who the rental came from (Enterprise etc.) — how the tech identifies it. */
  rental_vendor: string | null;
  /** Rental agreement number. For the operator's context, not the tech's text. */
  ticket_number: string | null;
  /**
   * The renter's OWN assigned truck off the roster (all_techs.truck_lu). Equal
   * to repair_truck in the normal case. Only diverges on the wrong-truck /
   * declined-auction redirect cohort, where it is the truck actually being
   * repaired on the tech's behalf.
   */
  own_truck: string | null;
  tech_name: string | null;
  employee_id: string | null;
  /** RACF id — the comms key. Null means we cannot text this person at all. */
  ldap: string | null;
  phone: string | null;
  /** Payroll status off the rental read-model ('A' = active). */
  employee_status: string | null;
  /** Roster status off the comms contact; disagreements are worth showing. */
  contact_status: string | null;
  contact_active: boolean | null;
  shop_name: string | null;
  shop_city: string | null;
  shop_state: string | null;
  days_open: number | null;
  daily_cost: number | null;
}

/**
 * Reasons a send is blocked or needs an explicit "yes, anyway". Split rather
 * than a single boolean because the UI has to say WHICH one — "no phone on
 * file" and "this tech is termed" need different next actions from a human.
 */
export interface PickupWarning {
  code:
    | "no_employee_id"
    | "no_racfid"
    | "no_contact"
    | "no_phone"
    | "inactive_roster"
    | "on_leave";
  /** true = cannot send at all. false = allowed once the operator confirms. */
  blocking: boolean;
  message: string;
}

export interface PickupPreview {
  target: PickupTarget;
  body: string;
  segments: number;
  warnings: PickupWarning[];
  canSend: boolean;
  /** From a real dry-run through the send pipeline: would this go now or queue? */
  wouldQueue: boolean | null;
  /** Set when the dry-run refused outright (opt-out, unusable phone). */
  wouldSkipReason: string | null;
}

/**
 * The default message.
 *
 * Names the truck to COLLECT by number and the rental to RETURN by vendor,
 * because those are the two identifiers the technician actually holds. It never
 * puts a truck number on the rental: we do not have one (see PickupTarget.
 * repair_truck).
 *
 * Length is deliberate. GSM-7 SMS bills at 160 chars for a single segment and
 * 153/segment after that, so an unbounded shop name silently doubles the cost of
 * every send across the book. The city/state qualifier is the first thing
 * dropped, then the shop clause entirely, so a long vendor name degrades instead
 * of overflowing. The operator can still edit before sending; this is a starting
 * point, not a locked template.
 */
export function buildPickupBody(t: PickupTarget): string {
  const truck = t.repair_truck ? `Truck ${t.repair_truck}` : "Your truck";
  const rental = t.rental_vendor ? `your ${titleCaseVendor(t.rental_vendor)} rental` : "your rental";
  const tail = `Please pick it up and return ${rental}. Reply here with any issues.`;

  const full = t.shop_name && t.shop_city && t.shop_state
    ? `${t.shop_name} (${t.shop_city}, ${t.shop_state})`
    : t.shop_name || "";
  const short = t.shop_name || "";

  for (const where of [full, short, ""]) {
    const body =
      `Sears Fleet: ${truck} is ready for pickup${where ? ` at ${where}` : ""}. ${tail}`;
    if (body.length <= 160 || where === "") return body;
  }
  /* istanbul ignore next — the where === "" arm always returns */
  return `Sears Fleet: ${truck} is ready for pickup. ${tail}`;
}

/** Vendor names arrive SHOUTING from the feed; "ENTERPRISE" reads as a yell. */
function titleCaseVendor(v: string): string {
  const s = v.trim();
  if (!s) return s;
  return s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : s;
}

/** Resolve MasterRow -> a textable person. Never throws; absence is data. */
export async function resolvePickupTarget(row: MasterRow): Promise<{
  target: PickupTarget;
  warnings: PickupWarning[];
}> {
  const warnings: PickupWarning[] = [];
  // Declined / sent-to-auction redirect: the rental van is not coming back, and
  // the truck the tech actually collects is their ASSIGNED truck at ITS shop -
  // the same redirect the LUCA caller follows. Without this branch the text
  // named the case truck and the case truck's shop, which on this cohort is a
  // vehicle the tech will never pick up. (Review 2026-07-29.)
  const redirectToAssigned = !!(row.redirect_to_assigned && row.call_target_truck);
  const target: PickupTarget = {
    case_key: row.case_key,
    // The truck at the shop. Normally the case vehicle itself; on the redirect
    // cohort, the tech's assigned truck. See PickupTarget.
    repair_truck: redirectToAssigned ? String(row.call_target_truck) : row.case_key,
    rental_vendor: row.rental_vendor,
    ticket_number: row.ticket_number,
    // renter_own_truck is the renter's own assigned truck; assigned_truck is the
    // same idea reached through the identity join. Prefer the former, fall back.
    own_truck: row.renter_own_truck ?? row.assigned_truck ?? null,
    tech_name: row.tech_name,
    employee_id: row.employee_id,
    ldap: null,
    phone: null,
    employee_status: row.employee_status,
    contact_status: null,
    contact_active: null,
    // The redirect shop comes from the assigned truck's PO. Its address is one
    // opaque string, so city/state stay null there and buildPickupBody degrades
    // to the name-only form rather than guessing at a parse.
    shop_name: redirectToAssigned ? row.call_shop_name : row.shop_name,
    shop_city: redirectToAssigned ? null : row.shop_city,
    shop_state: redirectToAssigned ? null : row.shop_state,
    days_open: row.days_open ?? null,
    daily_cost: row.daily_cost ?? null,
  };

  if (!row.employee_id) {
    warnings.push({
      code: "no_employee_id",
      blocking: true,
      message:
        "No technician resolved on this rental — resolve the identity before texting anyone.",
    });
    return { target, warnings };
  }

  const r = await db.execute<{ tech_racfid: string | null; employment_status: string | null }>(sql`
    SELECT tech_racfid, employment_status
      FROM all_techs
     WHERE employee_id = ${row.employee_id}
     LIMIT 1
  `);
  const racf = (r.rows?.[0]?.tech_racfid || "").trim();
  // The roster's own word on whether this person is active. The contact table's
  // empl_status is a copy that can lag (its sync only flips `active` on
  // tombstone), so the fresher all_techs value backs it up below.
  const rosterStatus = (r.rows?.[0]?.employment_status || "").trim().toUpperCase();
  if (!racf) {
    warnings.push({
      code: "no_racfid",
      blocking: true,
      message: `No RACF id on the roster for employee ${row.employee_id} — Fleet Comms is keyed on RACF, so this tech cannot be texted from here.`,
    });
    return { target, warnings };
  }
  target.ldap = racf.toUpperCase();

  const contact = await getContactByLdap(target.ldap);
  if (!contact) {
    warnings.push({
      code: "no_contact",
      blocking: true,
      message: `${target.ldap} is not in fs_comms_contacts — the contact sync has not seen this tech.`,
    });
    return { target, warnings };
  }
  target.phone = contact.phone?.trim() || null;
  target.contact_status = contact.emplStatus ?? null;
  target.contact_active = contact.active ?? null;

  if (!target.phone) {
    warnings.push({
      code: "no_phone",
      blocking: true,
      message: `No phone on file for ${contact.name || target.ldap}.`,
    });
  }
  // Lifecycle: mirrors the warn-and-confirm the /comms/send route applies to
  // single sends. Non-blocking on purpose — a termed tech may well still be
  // sitting on our rental, and that is exactly the case worth chasing. But the
  // operator has to see it, because the ask ("go collect your truck") is wrong
  // for someone who no longer has one.
  if (contact.active === false) {
    warnings.push({
      code: "inactive_roster",
      blocking: false,
      message: `${contact.name || target.ldap} is no longer on the active roster (termed). The rental still needs to come back, but do not ask a termed tech to collect a truck.`,
    });
  } else if (contact.emplStatus && !["", "A"].includes(contact.emplStatus)) {
    warnings.push({
      code: "on_leave",
      blocking: false,
      message: `${contact.name || target.ldap} is on leave (status ${contact.emplStatus}).`,
    });
  } else if (rosterStatus && rosterStatus !== "A") {
    // The contact record says active but the roster disagrees. The roster wins
    // a warning: it is the direct feed, and this query already paid for the
    // column. (Review 2026-07-29: employment_status was selected and thrown
    // away, so a tech the roster had already marked termed or on leave could
    // pass through with no confirmation step.)
    warnings.push({
      code: "on_leave",
      blocking: false,
      message: `${contact.name || target.ldap} is not active on the roster (status ${rosterStatus}) even though the comms contact still reads active. Confirm before sending.`,
    });
  }
  return { target, warnings };
}

async function loadRow(caseKey: string): Promise<MasterRow | null> {
  const m = await getRentalOpsMaster({});
  return m.rows.find((r) => r.case_key === caseKey) ?? null;
}

/**
 * What WOULD happen, with zero side effects. Runs the real gates via the send
 * pipeline's own dryRun, so "will queue until the morning" here means the same
 * thing it will mean at send time.
 */
export async function previewPickupText(
  caseKey: string,
  bodyOverride?: string | null,
): Promise<PickupPreview> {
  const row = await loadRow(caseKey);
  if (!row) throw new Error(`case ${caseKey} not found`);

  const { target, warnings } = await resolvePickupTarget(row);
  const body = (bodyOverride && bodyOverride.trim()) || buildPickupBody(target);
  const canSend = !warnings.some((w) => w.blocking);

  let wouldQueue: boolean | null = null;
  let wouldSkipReason: string | null = null;
  if (canSend && target.ldap) {
    const dry = await sendMessage({
      ldap: target.ldap,
      category: PICKUP_SMS_CATEGORY,
      body,
      dryRun: true,
    });
    if (dry.status === "skipped") {
      wouldSkipReason = dry.reason ?? "the send pipeline refused this recipient";
    } else {
      wouldQueue = dry.status === "queued";
    }
  }

  return {
    target,
    body,
    segments: countSegments(body),
    warnings,
    canSend: canSend && !wouldSkipReason,
    wouldQueue,
    wouldSkipReason,
  };
}

/** Append the receipt. Never throws: a log failure must not hide a sent text. */
async function logPickupText(
  row: MasterRow,
  target: PickupTarget,
  body: string,
  result: { status: string; reason?: string | null; messageId?: string; queueId?: string; segments?: number },
  actor: string | null,
): Promise<void> {
  try {
    // target_truck stays NULL deliberately. It scopes an action to ONE vehicle,
    // and the case-level readers filter `target_truck IS NULL`. A pickup text is
    // a case-level act (it is about the rental coming back), so stamping the
    // tech's own truck here would hide the receipt from the case history that
    // needs to show it. The own-truck number is kept in the payload instead.
    await db.execute(sql`
      INSERT INTO vrm_rental_operation_actions
        (case_key, action_type, note, actor, payload)
      VALUES (
        ${row.case_key},
        ${PICKUP_SMS_ACTION_TYPE},
        ${`Pickup text ${result.status} to ${target.tech_name || target.ldap || "tech"}`},
        ${actor},
        ${JSON.stringify({
          ldap: target.ldap,
          tech_name: target.tech_name,
          own_truck: target.own_truck,
          repair_truck: target.repair_truck,
          rental_vendor: target.rental_vendor,
          ticket_number: target.ticket_number,
          status: result.status,
          reason: result.reason ?? null,
          message_id: result.messageId ?? null,
          queue_id: result.queueId ?? null,
          segments: result.segments ?? null,
          body,
        })}::jsonb
      )
    `);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] pickup-text log insert failed (non-fatal):", e?.message || e);
  }
}

export interface SendPickupResult {
  ok: boolean;
  status: "sent" | "queued" | "skipped" | "blocked";
  message: string;
  caseKey: string;
  ldap: string | null;
  segments: number | null;
}

/**
 * Send it for real.
 *
 * `confirmed` is required whenever a non-blocking warning is present, so a
 * termed or on-leave tech can never be texted by a single unthinking click.
 * `force` bypasses quiet hours; default false, which QUEUES instead.
 */
export async function sendPickupText(opts: {
  caseKey: string;
  actor: string | null;
  body?: string | null;
  confirmed?: boolean;
  force?: boolean;
}): Promise<SendPickupResult> {
  const { caseKey, actor } = opts;
  const row = await loadRow(caseKey);
  if (!row) return { ok: false, status: "blocked", message: `case ${caseKey} not found`, caseKey, ldap: null, segments: null };

  const { target, warnings } = await resolvePickupTarget(row);
  const blocking = warnings.find((w) => w.blocking);
  if (blocking || !target.ldap) {
    return {
      ok: false,
      status: "blocked",
      message: blocking?.message ?? "no reachable technician on this rental",
      caseKey,
      ldap: target.ldap,
      segments: null,
    };
  }
  const lifecycle = warnings.find((w) => !w.blocking);
  if (lifecycle && opts.confirmed !== true) {
    return {
      ok: false,
      status: "blocked",
      message: `${lifecycle.message} Confirm to send anyway.`,
      caseKey,
      ldap: target.ldap,
      segments: null,
    };
  }

  const body = (opts.body && opts.body.trim()) || buildPickupBody(target);
  const result = await sendMessage({
    ldap: target.ldap,
    category: PICKUP_SMS_CATEGORY,
    body,
    force: !!opts.force,
    sentBy: actor,
    senderName: actor,
  });

  await logPickupText(row, target, body, result, actor);

  const who = target.tech_name || target.ldap;
  return {
    ok: result.status !== "skipped",
    status: result.status,
    message:
      result.status === "sent"
        ? `Texted ${who}.`
        : result.status === "queued"
          ? `Queued for ${who} — outside their local send window, it goes out automatically when the window opens.`
          : `Not sent: ${result.reason || "the send pipeline refused this recipient"}.`,
    caseKey,
    ldap: target.ldap,
    segments: result.segments ?? countSegments(body),
  };
}
