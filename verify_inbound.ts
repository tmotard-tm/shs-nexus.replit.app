import { db } from "./server/db";
import { sql } from "drizzle-orm";
(async () => {
  const list = await db.execute(sql`
    SELECT c.conversation_id, c.duration_secs, c.caller_phone,
           c.call_type, c.action_recommendation, c.priority_level,
           c.authorization_amount::float8 AS authorization_amount,
           to_char(c.call_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS call_at,
           c.shop_name, c.vehicle_year, c.vehicle_make_model, c.license_plate,
           c.unit_number, c.escalation_flags, c.next_steps,
           c.matched_truck, c.match_method, c.match_confidence, c.status,
           rc.renter_name_raw, rc.days_open, rc.ticket_status, rc.present_in_latest
    FROM vrm_inbound_calls c
    LEFT JOIN vrm_rental_operations_cases rc ON rc.case_key = c.matched_truck
    WHERE c.call_type <> 'JUNK'
    ORDER BY c.call_at DESC NULLS LAST LIMIT 4`);
  console.log("LIST QUERY OK, sample rows:");
  for (const r of list.rows as any[]) {
    console.log(`  ${r.call_at} | ${String(r.call_type).padEnd(16)} | truck=${r.matched_truck ?? "-"} (${r.match_method}) | rental=${r.renter_name_raw ?? "-"} days=${r.days_open ?? "-"} | ${String(r.shop_name ?? "-").slice(0,22)}`);
    console.log(`      amount=${r.authorization_amount} (${typeof r.authorization_amount}) flags=${JSON.stringify(r.escalation_flags)}`);
    console.log(`      next: ${String(r.next_steps ?? "").slice(0,96)}`);
  }
  const kpi = await db.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE call_type <> 'JUNK')::int AS real_calls,
           COUNT(*) FILTER (WHERE call_type='READY' AND status IN ('NEW','ACKNOWLEDGED'))::int AS ready_open,
           COUNT(*) FILTER (WHERE call_type='AUTHORIZATION' AND status IN ('NEW','ACKNOWLEDGED'))::int AS auth_open,
           COALESCE(SUM(authorization_amount) FILTER (WHERE call_type='AUTHORIZATION' AND status IN ('NEW','ACKNOWLEDGED')),0)::float8 AS auth_dollars,
           COUNT(*) FILTER (WHERE matched_truck IS NOT NULL AND call_type<>'JUNK')::int AS matched,
           COUNT(*) FILTER (WHERE matched_truck IS NULL AND call_type<>'JUNK')::int AS unmatched
    FROM vrm_inbound_calls`);
  console.log("\nKPI QUERY OK:", JSON.stringify((kpi.rows as any[])[0]));
  const j = await db.execute(sql`
    SELECT COUNT(*)::int AS with_rental
    FROM vrm_inbound_calls c JOIN vrm_rental_operations_cases rc ON rc.case_key=c.matched_truck
    WHERE rc.present_in_latest = true`);
  console.log("calls whose truck has a LIVE rental:", JSON.stringify((j.rows as any[])[0]));
  process.exit(0);
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });
