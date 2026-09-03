/**
 * Kick LIVHR's rental mirror the moment a Holman scrape lands.
 *
 * WHY THIS EXISTS (Tyler, 2026-09-03)
 * "When I scrape and get new information, it should be automatically sent to
 * Luca immediately." LUCA already reads THIS board's own feed
 * (/api/vrm/rental-operations/luca-rental-list) as its source of truth, so
 * content parity is by design. The gap was cadence: LIVHR pulled the feed on
 * a daily 08:00 UTC tick, so a shop change scraped at 09:00 reached LUCA the
 * next morning.
 *
 * LIVHR exposes POST /api/sync/rentals, which pulls the feed and, by default,
 * kicks LUCA right after ("a manual trigger should kick LUCA so refreshed
 * rentals don't wait for the next scheduled cadence"). It is guarded by
 * dualAgentRunAuthorize, whose machine branch validates the `x-agent-token`
 * header against LIVHR's AGENT_RUN_SECRET.
 *
 * Uses the credential that has connected Nexus to LIVHR since LUCA launched:
 * AGENT_RUN_SECRET, present in both environments. No new secret is required.
 * Tyler, 2026-09-03: "Everything's already connected. I don't need to add any
 * more secrets."
 *
 * Fire-and-forget, never throws, never blocks the scrape.
 */

const LIVHR_BASE = (process.env.LIVHR_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.AGENT_RUN_SECRET || "";
let warnedOnce = false;

export async function kickLucaRentalSync(reason: string): Promise<void> {
  if (!LIVHR_BASE || !TOKEN) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[luca-sync-kick] LIVHR_BASE_URL or AGENT_RUN_SECRET not set - scrapes will NOT push to LUCA.",
      );
    }
    return;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${LIVHR_BASE}/api/sync/rentals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": TOKEN },
      body: JSON.stringify({ triggerLucaAfter: true }),
      signal: ctl.signal,
    });
    const text = (await res.text().catch(() => "")).slice(0, 200);
    if (res.ok) console.log(`[luca-sync-kick] ${reason}: LIVHR sync kicked (HTTP ${res.status})`);
    else console.warn(`[luca-sync-kick] ${reason}: LIVHR answered HTTP ${res.status} ${text}`);
  } catch (e: any) {
    console.warn(`[luca-sync-kick] ${reason}: ${e?.name === "AbortError" ? "timed out after 15s" : String(e?.message || e)}`);
  } finally {
    clearTimeout(timer);
  }
}
