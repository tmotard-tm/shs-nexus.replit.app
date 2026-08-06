# Plan B — Bucket Queue Builder (server) + Scraper Retirement

**Spec:** `docs/specs/2026-08-05-persona-bucket-queue-design.md` §5–§8, §11
**Depends on:** Plan A (imports `resolveOwnerRouting`, `teamForDistrict`, `OWNER_ROSTER` from `annex-a-routing.ts`).
**Goal:** `buildTodaysQueue()` output becomes person-first: every item stamped with owner/basis/region, classifications (P1–P4) with business-day SLA clocks, PO context from reconciled `po_eff` evidence, DB-backed dismiss-for-today, `buckets` rollup. Scraper feed deleted everywhere server-side. Both existing consumers (VRM `/rental-operations/queue`, FS `/queue/today`) keep working — additive shape, steps stay for the Everyone view.
**Architecture:** New pure module `server/vrm/rental-operations/bucket-classify.ts` (classification + SLA math — unit-testable, no DB). `server/todays-queue.ts` keeps building rows and calls into it. Owner/dismiss/observed state = append-only `vrm_rental_operation_actions` rows (existing table, no DDL). Item key: `caseKey` when present else canonical truck number (both fit `case_key VARCHAR(10)`).
**Verification:** new workflow `bucket-queue-unit`; existing `schedule-pickup-unit` + `vrm-guard-unit` stay green; typecheck workflow ≤ 213 baseline; `rg` proves zero scraper references; tsx live run of the builder against dev DB.

---

## Task B1 — `po_eff` context reader (shared with MasterRow)

**Files:** `server/vrm/rental-operations/read-repository.ts`

1. Export a new reader under the MasterRow section reusing the SAME CTE builders (never a parallel query — queue and MasterRow must not disagree):

```ts
export interface QueuePoContext {
  effStatus: string | null;        // portal-corrected effective status of the picked PO
  openPoCount: number;
  openEvidenceAt: string | null;   // replaces raw Snowflake MIN(PO_DATE) as repair-start anchor
  portalAt: string | null;
  shopName: string | null;
  shopPhone: string | null;
}

export async function loadQueuePoContext(): Promise<Map<string, QueuePoContext>> {
  const canon = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "") || "";
  const res = await db.execute(sql`
    WITH ${poEffectiveCte({})}, /* po_eff */ ${/* reuse PO_AGG_CTE + SHOP_PICK_CTE exactly as the master query composes them */ sql``}
    SELECT agg.truck_number, agg.open_po_count, agg.open_evidence_at, agg.portal_at,
           sp.eff_status, sp.shop_name, sp.shop_phone
    FROM po_agg agg LEFT JOIN shop_pick sp USING (truck_number)
  `);
  const out = new Map<string, QueuePoContext>();
  for (const r of (((res as any).rows ?? res) ?? []) as any[]) {
    out.set(canon(r.truck_number), {
      effStatus: r.eff_status ?? null,
      openPoCount: Number(r.open_po_count ?? 0),
      openEvidenceAt: r.open_evidence_at ? String(r.open_evidence_at) : null,
      portalAt: r.portal_at ? String(r.portal_at) : null,
      shopName: r.shop_name ?? null,
      shopPhone: r.shop_phone ?? null,
    });
  }
  return out;
}
```

2. Implementation detail (resolve while editing, the CTE names/columns are already in this file): compose the CTE list exactly like the master query does (`PO_EFFECTIVE_CTE` → `PO_AGG_CTE` → `SHOP_PICK_CTE`); select ONLY columns those CTEs already emit. If `shop_pick` does not emit `eff_status`, take it from the picked PO row the same way MasterRow's select does. No `scopeJoin` (full fleet — queue covers trucks without cases).
3. Shop state for routing fallback: `SHOP_PICK_CTE` has no state column → do NOT extend the CTE. The builder derives `shopState` by parsing `fs_trucks.repairAddress` with `/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/` (helper in B2).

**Verify:** `npx tsx -e "import('./server/vrm/rental-operations/read-repository.ts').then(async m => { const c = await m.loadQueuePoContext(); console.log(c.size, [...c.entries()].slice(0,3)); process.exit(0); })"` → nonzero size, plausible eff statuses (APPROVED/CLOSED…), no throw. Reminder: Holman vocabulary has no 'Open' — open = APPROVED.
**Commit:** `feat(vrm): shared po_eff context reader for the queue`

## Task B2 — Pure classification + SLA module

**Files:** create `server/vrm/rental-operations/bucket-classify.ts`

Full classification table (spec §6) as data, plus business-day math and the classify function. Verbatim skeleton (complete — the classify predicates reference the input struct only):

```ts
import { resolveOwnerRouting, teamForDistrict, UNROUTED_OWNER, type RoutingResult } from "./annex-a-routing";

export type Priority = 1 | 2 | 3 | 4;
export interface ClassificationDef {
  key: string; label: string; priority: Priority;
  slaBusinessDays: number | null;               // null = no clock
  ownerRule: "regional" | "rob" | "jennifer" | "district_team";
}
export const CLASSIFICATIONS: readonly ClassificationDef[] = [
  { key: "declined_repair_source_replacement", label: "Declined / auction — source replacement", priority: 1, slaBusinessDays: 5, ownerRule: "regional" },
  { key: "retrieval_pending", label: "Retrieval pending (decommission / sold)", priority: 1, slaBusinessDays: 5, ownerRule: "jennifer" },
  { key: "luca_escalated", label: "LUCA escalated", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "unverified_confirm", label: "Unverified — confirm by phone", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "ready_guard_review", label: "Ready-guard review", priority: 2, slaBusinessDays: 1, ownerRule: "regional" },
  { key: "vehicle_ready_schedule", label: "Vehicle ready — schedule pickup", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "schedule_tech_pickup", label: "Schedule tech pickup", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "confirm_rental_returned", label: "Confirm rental returned", priority: 2, slaBusinessDays: null, ownerRule: "regional" },
  { key: "pickup_follow_up", label: "Pickup follow-up", priority: 2, slaBusinessDays: null, ownerRule: "regional" },
  { key: "authorization_needed", label: "Authorization needed", priority: 2, slaBusinessDays: 1, ownerRule: "rob" },
  { key: "stalled_repair", label: "Stalled repair", priority: 2, slaBusinessDays: 3, ownerRule: "rob" },
  { key: "shop_record_fix", label: "Shop record fix", priority: 2, slaBusinessDays: null, ownerRule: "rob" },
  { key: "truck_mismatch_no_po", label: "Truck mismatch — no qualifying PO", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "needs_tow", label: "Needs tow", priority: 2, slaBusinessDays: 2, ownerRule: "regional" },
  { key: "shop_missing_truck", label: "Shop does not have truck / relocated", priority: 2, slaBusinessDays: 3, ownerRule: "regional" },
  { key: "tech_unreachable", label: "Technician unreachable", priority: 2, slaBusinessDays: 3, ownerRule: "regional" },
  { key: "tags_registration_hold", label: "Tags / registration hold", priority: 2, slaBusinessDays: 7, ownerRule: "district_team" },
  { key: "aged_open_case", label: "Aged open case", priority: 3, slaBusinessDays: null, ownerRule: "regional" },
  { key: "follow_up_due", label: "Follow-up due", priority: 3, slaBusinessDays: null, ownerRule: "regional" },
  { key: "shop_unreachable_callback", label: "Shop unreachable — call back", priority: 4, slaBusinessDays: 5, ownerRule: "regional" },
] as const;
export const CLASSIFICATION_BY_KEY = new Map(CLASSIFICATIONS.map(c => [c.key, c]));

// ---- business days (ET) ----
export function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
const DAY = 86_400_000;
function isBusinessDay(d: Date): boolean { const wd = d.getUTCDay(); return wd !== 0 && wd !== 6; }
export function addBusinessDays(isoDay: string, n: number): string {
  let d = new Date(`${isoDay}T00:00:00Z`); let left = n;
  while (left > 0) { d = new Date(d.getTime() + DAY); if (isBusinessDay(d)) left--; }
  return d.toISOString().slice(0, 10);
}
export function businessDaysLate(dueIsoDay: string, todayIsoDay: string): number {
  if (todayIsoDay <= dueIsoDay) return 0;
  let d = new Date(`${dueIsoDay}T00:00:00Z`); let late = 0;
  const end = new Date(`${todayIsoDay}T00:00:00Z`);
  while (d < end) { d = new Date(d.getTime() + DAY); if (isBusinessDay(d)) late++; }
  return late;
}

export function shopStateFromAddress(addr: string | null | undefined): string | null {
  const m = /,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec(String(addr ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

// ---- classify ----
export interface ClassifyInput {
  fleetScopeStatus: string; subStatus: string | null;
  lucaStatus: string | null;            // display label from fs_trucks.lastCallStatus / latest LUCA log
  lucaReady: boolean; latestCallUnresolved: boolean;
  workbookStatus: string | null;        // newest workbook state (API vocabulary)
  workbookFollowUpDue: boolean; escalated: boolean;
  erdPassed: boolean; poClosedWhileInRepair: boolean;
  schedulingDue: boolean; schedulingUnscheduled: boolean;
  pickupDatePassed: boolean; returnInFlight: boolean;
  etaSlips: number; daysInShop: number | null; daysSinceLastAttempt: number | null;
  callAttempts2d: number; tagsHold: boolean; noQualifyingPo: boolean;
  decommission: boolean; declinedOrAuction: boolean; readyGuardDowngraded: boolean;
  shopPhoneBad: boolean;
}
export function classify(x: ClassifyInput): string[] {
  const out: string[] = [];
  if (x.declinedOrAuction) out.push("declined_repair_source_replacement");
  if (x.decommission) out.push("retrieval_pending");
  if (x.escalated) out.push("luca_escalated");
  if (x.lucaStatus === "Unverified - confirm by phone") out.push("unverified_confirm");
  if (x.readyGuardDowngraded) out.push("ready_guard_review");
  if (x.lucaReady || x.erdPassed || x.poClosedWhileInRepair) out.push("vehicle_ready_schedule");
  if (x.schedulingDue || x.schedulingUnscheduled) out.push("schedule_tech_pickup");
  if (x.returnInFlight) out.push("confirm_rental_returned");
  if (x.pickupDatePassed) out.push("pickup_follow_up");
  if ((x.subStatus ?? "").toLowerCase().includes("authorization") || x.lucaStatus === "In Authorization") out.push("authorization_needed");
  if (x.etaSlips >= 2 || (x.daysInShop ?? 0) > 60) out.push("stalled_repair");
  if (x.shopPhoneBad) out.push("shop_record_fix");
  if (x.noQualifyingPo) out.push("truck_mismatch_no_po");
  if (x.lucaStatus === "Needs Tow") out.push("needs_tow");
  if (x.lucaStatus === "Shop Does Not Have Truck" || x.lucaStatus === "Relocated") out.push("shop_missing_truck");
  if (x.callAttempts2d >= 3) out.push("tech_unreachable");
  if (x.tagsHold) out.push("tags_registration_hold");
  if (x.workbookFollowUpDue) out.push("follow_up_due");
  if (x.latestCallUnresolved && !x.lucaReady) out.push("shop_unreachable_callback");
  if (out.length === 0) out.push("aged_open_case");
  // dedupe, priority order
  const seen = new Set<string>();
  return out.filter(k => !seen.has(k) && seen.add(k))
    .sort((a, b) => CLASSIFICATION_BY_KEY.get(a)!.priority - CLASSIFICATION_BY_KEY.get(b)!.priority);
}

export function ownerForClassification(def: ClassificationDef, routing: RoutingResult, district: string | null): { owner: string; needsRouting: boolean } {
  if (routing.basis === "manual") return { owner: routing.owner, needsRouting: false };
  switch (def.ownerRule) {
    case "jennifer": return { owner: "Jennifer Dyer", needsRouting: false };
    case "rob": return { owner: "Rob Anderson", needsRouting: false };
    case "district_team": {
      const t = teamForDistrict(district);
      return t ? { owner: t, needsRouting: false } : { owner: UNROUTED_OWNER, needsRouting: true };
    }
    default: return { owner: routing.owner, needsRouting: routing.needsRouting };
  }
}
```

Signal-source notes to apply in B3 (each maps to existing builder data): `escalated` = newest workbook status `escalated`; `erdPassed` = `expectedCompletion < todayET` while In Repair; `poClosedWhileInRepair` = `openPoCount === 0 && openEvidenceAt != null` while In Repair; `schedulingDue/Unscheduled` = existing `classifySchedulingDate`; `returnInFlight` = existing step-6/7 RENTAL_STATUSES branches; `tagsHold` = the Action Tracker registration flags on `fs_trucks` (grep `rg -n -i "sticker|registration|renewal" shared/fleet-scope-schema.ts` and use the same columns `ActionTracker.tsx` renders); `etaSlips` = count of distinct prior `eta` values in LUCA `fs_call_logs` metadata for the truck (0 when absent); `shopPhoneBad` = LUCA outcome `CALL_NO_CONTACT` with reason wrong-number in latest log metadata, else false; `callAttempts2d` = tech-outreach attempts from existing follow-up data (0 when source absent — classification simply won't fire); `readyGuardDowngraded` = existing ready-guard field on the case if present, else false. Where a listed source turns out not to exist during implementation, the input MUST be wired to a constant false/0 with a `// SOP: source not yet available` comment — never invent a proxy signal.

**Verify:** unit tests in B6 (pure, no DB).
**Commit:** `feat(vrm): classification vocabulary + business-day SLA engine`

## Task B3 — Rework `server/todays-queue.ts`

**Files:** `server/todays-queue.ts`

1. **Scraper out:** delete `fetchAllScraperData` import + `scraperData` fetch; delete `getHolmanStatus`'s scraper read (keep the 6-pad canonicalization where still needed); delete `isHolmanRepairComplete` / `isHolmanInAuthorization` (scraper-text matchers). Their two uses switch to `poClosedWhileInRepair` / subStatus-based signals (B2 note). `holmanStatus` field on items now carries `poCtx.effStatus` (rename NOT done — field name stays `holmanStatus` for UI compat, value is the effective PO status).
2. **Repair-start anchor:** replace the raw Snowflake `HOLMAN_ETL_PO_DETAILS MIN(PO_DATE)` map (`holmanRepairStartMap`) with `openEvidenceAt` from `loadQueuePoContext()`; the daysInStatus priority chain keeps its other links (fs_pmf_status_events → mainStatusChangedAt → semantic dates → lastUpdatedAt).
3. **New loads (parallel with existing ones):** `loadQueuePoContext()`; `loadTechHomeStates()` (import from where region-routes gets it); manual-owner map + dismiss set + observed map via one query each over `vrm_rental_operation_actions`:
   - manual owners: newest `action_type='assign_owner'` per `case_key` → `assigned_to` (row with `payload->>'auto'='true'` clears);
   - dismissed: `action_type='queue_dismiss'` where `payload->>'day' = todayET()`, newest per `(case_key, payload->>'itemKey')`, skip rows with `payload->>'undo'='true'`;
   - observed: `action_type='classification_observed'` → `MIN(created_at)` per `(case_key, payload->>'classification')`.
4. **Per item:** compute `routing = resolveOwnerRouting({ manualOwner, techHomeState, shopState: shopStateFromAddress(truck.repairAddress), plateState: rentingState })`; `classifications = classify(input)`; for each classification key attach `{ key, label, priority, owner, needsRouting, slaDueDate, businessDaysLate }` where the anchor = source event date if the signal has one (escalation mark date, status-change date, ERD) else the observed map's first-seen date (insert a `classification_observed` row when absent — batched inserts after build, fire-and-forget with error log, builder stays read-mostly).
5. **Item shape (additive):** keep every existing `QueueItem` field; add `owner: string`, `ownerBasis: RoutingBasis|"manual"`, `region: Region|null`, `needsRouting: boolean`, `classifications: ItemClassification[]`, `dismissedToday: { by: string } | null`, `contextChips: { effStatus, openPoDate, shopName, shopPhone, portalAt, lastLucaOutcome, lastLucaDate, daysInRental }`. The item's bucket owner = owner of its highest-priority classification (`ownerForClassification`).
6. **Response (additive):** add `buckets: Array<{ owner: string; open: number; dueToday: number; overdue: number; needsRouting: number }>` (all 8 roster owners always present, zero-filled) and `vocabulary.classifications = CLASSIFICATIONS`. Keep `items`/`noAction`/steps untouched otherwise.
7. **Step wording retirements (spec §11.6):** replace step-5 title "INITIATE LUCA AI CALL" → "SHOP UNREACHABLE — CALL BACK" and any "CONFIRM TAGS WITH CHERYL" action text → "Tags hold — routed to district team".

**Verify:** `npx tsx -e "import('./server/todays-queue.ts').then(async m => { const q = await m.buildTodaysQueue(); console.log(q.items.length, q.buckets, q.items[0]); process.exit(0); })"` (~1–4 min, Snowflake) → buckets sum to items, every item has owner, zero scraper refs (`rg -n "scraper" server/todays-queue.ts` → 0).
**Commit:** `feat(queue): person-first owner stamping, classifications, SLA clocks, po_eff context`

## Task B4 — Write endpoints + FS mirror passthrough

**Files:** `server/vrm/rental-operations/routes.ts`; `server/fleet-scope-routes.ts` (queue route only)

1. In `registerRentalOperationsRoutes`, next to the existing queue GET (line ~64):

```ts
// POST /rental-operations/queue/owner  { key: string; owner: string | "auto" }
router.post("/rental-operations/queue/owner", async (req, res) => {
  try {
    const key = String(req.body?.key ?? "").trim().slice(0, 10);
    const owner = String(req.body?.owner ?? "").trim();
    if (!key || !owner) return res.status(400).json({ success: false, error: "key and owner required" });
    if (owner !== "auto" && !(OWNER_ROSTER as readonly string[]).includes(owner))
      return res.status(400).json({ success: false, error: "owner not on roster" });
    await db.execute(sql`
      INSERT INTO vrm_rental_operation_actions (case_key, action_type, assigned_to, payload, actor)
      VALUES (${key}, 'assign_owner', ${owner === "auto" ? null : owner},
              ${JSON.stringify(owner === "auto" ? { auto: true } : {})}::jsonb, ${workbookActor(req)})
    `);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message || "assign failed" }); }
});

// POST /rental-operations/queue/dismiss  { key: string; itemKey: string; undo?: boolean }
router.post("/rental-operations/queue/dismiss", async (req, res) => {
  try {
    const key = String(req.body?.key ?? "").trim().slice(0, 10);
    const itemKey = String(req.body?.itemKey ?? "").trim();
    if (!key || !itemKey) return res.status(400).json({ success: false, error: "key and itemKey required" });
    const payload = { day: todayET(), itemKey, ...(req.body?.undo ? { undo: true } : {}) };
    await db.execute(sql`
      INSERT INTO vrm_rental_operation_actions (case_key, action_type, payload, actor)
      VALUES (${key}, 'queue_dismiss', ${JSON.stringify(payload)}::jsonb, ${workbookActor(req)})
    `);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e?.message || "dismiss failed" }); }
});
```

   (`workbookActor` already exists in `region-routes.ts` — export it from there or move it to `workbook.ts`; session actor wins over body.) `key` = caseKey when the item has one, else canonical truck number — same derivation the builder uses; document on the item as `item.key`.
2. Done-advance needs NO new endpoint — the UI posts the existing `POST workbook/:caseKey` (append-only, API-served vocabulary).
3. FS `/queue/today` (fleet-scope-routes.ts ~4296): no change needed (passes builder output through). Confirm it doesn't strip new fields.

**Verify:** with `Start application` running: `curl -s -X POST $REPLIT_DEV_DOMAIN/api/vrm/rental-operations/queue/owner -H 'Content-Type: application/json' -d '{"key":"<real caseKey>","owner":"Jennifer Dyer"}'` (authed session cookie or run via tsx against handlers) → row appears in `vrm_rental_operation_actions`; queue rebuild shows manual owner; **revert the dev-DB test row** (`DELETE ... WHERE action_type='assign_owner' AND case_key='<key>' AND actor=...` for the test row only).
**Commit:** `feat(vrm): queue owner-assign + dismiss-for-today endpoints (append-only)`

## Task B5 — `shs_owner` one-time seeding (boot self-heal)

**Files:** `server/vrm/rental-operations/schema.ts` (its ensure/init function)

1. Guarded by `app_settings` key `bucket_queue_shs_owner_seeded` (existing settings helpers): if set, skip.
2. Read RAW `fs_trucks.shs_owner` (no `normalizeOwnerName` default!): skip NULL/blank. Map explicit values → roster names: `Olga F`→Olga Fernandez, `Rob A`→Rob Anderson, `Jenn D`→Jennifer Dyer, `Sandeep`→Sandeep Kalyani, `Cheryl`→Cheryl & Monica, `Rob D`→Rob D & Andrea, `Carol`/`Tasha`→Carol & Tasha, `Oscar S`→Oscar Santana **only when the raw value explicitly contains "oscar"** (the tracker DEFAULTS blanks to "Oscar S" — a blanket copy would mass-assign Oscar; spec §8). Unmappable raw values (departed: `John C`, `Mandy R`, …) → skip (Annex A fills in).
3. For each mapped truck with a `present_in_latest` case: INSERT `assign_owner` row, `actor='seed:shs_owner'`, payload `{ seededFrom: rawValue }`. Then set the settings flag. Log counts.

**Verify:** boot log line `[bucket-queue] shs_owner seed: N assigned, M skipped (blank/default), K unmappable`; re-boot → `skip (already seeded)`. Spot-check one seeded case in dev DB.
**Commit:** `feat(vrm): one-time shs_owner → assign_owner seeding (explicit values only)`

## Task B6 — Scraper retirement (server)

**Files:** delete `server/holman-scraper-cache.ts`; edit `server/fleet-scope-routes.ts`

1. `fleet-scope-routes.ts`: remove import (line 29); delete `GET /trucks/scraper-status` (~4266–4292); delete `GET /trucks/scraper-detail/:truckNumber` (~4308 through its closing brace — it also fetches `SCRAPER_BASE_URL` directly); delete `autoPopulateFromScraper` (~9855+) AND whatever schedules/invokes it (grep `autoPopulateFromScraper` for the registration site; delete both).
2. Delete the file `server/holman-scraper-cache.ts`.
3. `rg -n "SCRAPER_BASE_URL|fetchAllScraperData|scraper" server/ --iglob '!**/node_modules/**'` → zero hits (client hits are Plan C's job; land Plan C in the same release so the removed endpoints aren't fetched by live UI for long).

**Verify:** grep zero (server); restart `Start application` → clean boot, queue endpoint 200.
**Commit:** `chore(fs): delete Holman scraper feed (frozen since mid-July, all rows ERROR)`

## Task B7 — Unit tests + workflow + typecheck

**Files:** create `tests/bucket-queue-classify.test.ts`; workflow `bucket-queue-unit` = `npx tsx --test tests/bucket-queue-classify.test.ts`

Cases: (1) every CLASSIFICATIONS key unique, priorities in {1..4}; (2) `classify` fires each classification from a minimal input (one test per row of the §6 table) and orders P1 first; (3) empty-signal input → `["aged_open_case"]`; (4) `ownerForClassification`: manual routing beats jennifer/rob/district rules; tags + district 8206 → Cheryl & Monica while regional routing of TN stays central (spec §12.4); tags + unknown district → Rob + needsRouting; (5) `addBusinessDays("2026-08-07", 2)` → `"2026-08-11"` (Fri+2 = Tue); `businessDaysLate("2026-08-07","2026-08-10")` → 1; (6) `shopStateFromAddress("123 Main St, Dallas, TX 75201")` → `"TX"`, junk → null.

**Verify:** restart `bucket-queue-unit` → pass; restart `schedule-pickup-unit`, `vrm-guard-unit`, `comms-lib-unit` → still green; typecheck workflow (`npm run check`) → ≤ 213 errors, none in new/touched files; B3's tsx live-run output pasted into the task log.
**Commit:** `test(queue): classification table, owner rules, business-day math`

---

## Self-review notes
- No DDL anywhere — everything rides existing `vrm_rental_operation_actions` (append-only pattern, deploys run no migrations). Seed + observed writes are value-guarded/idempotent, safe for autoscale multi-boot.
- `holmanStatus` keeps its name with a new value source; the FS UI renders it as a pill regardless — Plan C relabels it "PO". Risk: any UI string-matching on old scraper statuses ("ERROR") — Plan C task C4 greps for that.
- Builder writes (`classification_observed`) are the only writes in a read path; they're batched, fire-and-forget, and logged — a failure degrades to clock-reset-on-rebuild, not a 500.
- `caseless` trucks: key = canonical truck number → owner/dismiss work for them too; VARCHAR(10) fits (trucks ≤ 6 digits).
