// Plain-language labels for the case Activity log. Every row in
// vrm_rental_operation_actions (marks, ready verification, research, owner
// changes, dismissals, pickup texts, scheduling, fleet status, shop and
// identity edits…) renders through describeAction so the audit trail reads
// like a sentence, not a database row. Pure — unit-tested in
// tests/vrm-surface-alignment.test.ts (the log is shared by all three boards).

export interface ActionRow {
  id?: string;
  action_type: string;
  mark_value: string | null;
  note: string | null;
  assigned_to?: string | null;
  actor: string | null;
  created_at: string;
  payload?: any;
}

function payloadOf(a: ActionRow): Record<string, any> {
  const p = a.payload;
  if (!p) return {};
  if (typeof p === "string") {
    try { return JSON.parse(p) ?? {}; } catch { return {}; }
  }
  return typeof p === "object" ? p : {};
}

/** jsonb payloads store booleans as "true"/"false" strings in several writers. */
function flag(v: unknown): boolean {
  return v === true || v === "true";
}

function humanize(type: string): string {
  const t = type.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Action";
}

/**
 * One line per action: what happened (label) and the supporting detail, if
 * any. Unknown action types fall back to a humanized type + note so a new
 * writer can never render as a blank row.
 */
export function describeAction(a: ActionRow): { label: string; detail: string | null } {
  const p = payloadOf(a);
  const note = a.note?.trim() || null;
  switch (a.action_type) {
    case "mark":
      return a.mark_value && a.mark_value !== "none"
        ? { label: `Marked ${a.mark_value.replace(/_/g, " ").toUpperCase()}`, detail: note }
        : { label: "Operator mark cleared", detail: note };
    case "note":
      return { label: "Comment", detail: note };
    case "ready_verified":
      return flag(p.verified)
        ? { label: "Ready verified with the shop", detail: note }
        : { label: "Ready verification undone", detail: note };
    case "research_escalation":
      return flag(p.active)
        ? { label: "Escalated to research", detail: note }
        : { label: "Research escalation cleared", detail: note };
    case "assign_owner":
      return flag(p.auto) || !a.assigned_to
        ? { label: "Owner returned to automatic routing", detail: note }
        : { label: `Owner set to ${a.assigned_to}`, detail: note };
    case "queue_dismiss":
      return flag(p.undo)
        ? { label: "Queue dismissal undone", detail: p.day ? `for ${p.day}` : note }
        : { label: "Dismissed from today's queue", detail: p.day ? `for ${p.day}` : note };
    case "fleet_status": {
      const sub = typeof p.sub_status === "string" && p.sub_status ? ` — ${p.sub_status}` : "";
      return { label: `Fleet status → ${a.mark_value ?? "?"}${sub}`, detail: note };
    }
    case "schedule_pickup":
      return !a.mark_value || a.mark_value === "cleared"
        ? { label: "Pickup schedule cleared", detail: note }
        : {
            label: `Pickup scheduled for ${a.mark_value}`,
            detail: flag(p.route_block_requested) ? "route block requested" : note,
          };
    case "pickup_text": {
      const body = typeof p.body === "string" && p.body ? p.body : null;
      return { label: note || "Pickup text sent", detail: body };
    }
    case "identity_override":
      return flag(p.cleared)
        ? { label: "Renter identity override cleared", detail: note }
        : { label: note || `Renter identity pinned to ${p.tech_name || p.employee_id || "?"}`, detail: null };
    case "shop_phone_edit":
      return { label: "Shop phone edited", detail: note };
    case "shop_name_edit":
      return { label: "Shop name edited", detail: note };
    case "shop_llm_extract":
      return { label: "Shop read from Holman comments", detail: note };
    case "call_outcome":
      return { label: "Call outcome recorded", detail: note ?? a.mark_value };
    case "recovery_status":
      return { label: `Recovery status${a.mark_value ? ` → ${a.mark_value}` : " updated"}`, detail: note };
    case "classification_observed":
      return { label: "Queue classification recorded", detail: note ?? a.mark_value };
    case "setting":
      return { label: "Setting changed", detail: note };
    default:
      return { label: humanize(a.action_type), detail: note ?? a.mark_value };
  }
}
