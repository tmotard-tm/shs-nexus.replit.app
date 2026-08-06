# Persona-Bucket Ops Queue — Approved Design

**Date:** 2026-08-05
**Status:** Approved by user (design sign-off in session; roster and owner-precedence confirmed via explicit answers)
**Authoritative input:** Rental Vehicle Reduction SOP v4.0 (2026-08-05, Tyler Morgan) — `attached_assets/0_Rental_Reduction_SOP_v4_1785908613801.docx`. Annex A of that document is the authoritative region model and is embedded below so implementation never needs the docx.

---

## 1. Summary

Replace the step-first Today's Queue (7 global steps, region filter, per-browser done-checkboxes) with a **person-first bucket queue in VRM Rental Operations**. Every open work item is stamped with an owner; each person clicks their bucket and sees their day's workload, ordered by the SOP's work priority (P1–P4) with business-day SLA clocks. Fleet Scope's Action Tracker merges into it; Fleet Scope's Today's Queue becomes a read-only mirror. The dead Holman web-scraper feed and its "Holman: ERROR" pill are deleted; row context comes from VRM's reconciled PO evidence instead. Bucket routing and notification routing share one Annex-A state module so "your bucket mirrors your emails" holds by construction.

## 2. Approved decisions (user answers)

1. **Owner precedence:** manually-set owner field decides (like Action Tracker today); Annex A state routing fills in only when no owner is set.
2. **Bucket roster (v1):** Olga Fernandez (East), Oscar Santana (Central), Sandeep Kalyani (West), Rob Anderson, Jennifer Dyer, Carol & Tasha (team), Cheryl & Monica (team), Rob D & Andrea (team). **No Tyler bucket** — rental-PO approve/deny stays on the New Rentals page and is NOT duplicated into buckets; unmatched-state investigation items route to Rob Anderson (single named owner, never broadcast).
3. Full design as presented (sections below) approved without adjustments.

## 3. Goals / non-goals

**Goals**
- One queue, bucketed by person/team, in VRM (VRM owns rental state; FS is downstream mirror — standing directive).
- Bucket contents mirror LUCA notification routing (same routing table, same vocabulary).
- SOP §7 priority order and §9 SLA clocks visible per item.
- Reconciled PO/shop/message-trail context on every row; retire the frozen scraper feed.
- Team-visible done semantics backed by real case-status writes, not localStorage.
- Fix region routing to Annex A state-based resolution everywhere in THIS repo.

**Non-goals (v1)**
- No changes on the LIVHR/fleetagents side (LUCA agent's own email routing — see §10 transitional note).
- No Mandy Riley bucket (scheduler-API escalation renders as a flag on the item).
- No Enterprise Mobility extension handling (SOP §10: unowned, manual).
- No autonomous pickup booking (SOP: PROPOSE ONLY).
- No snooze/reassignment-history features beyond daily dismiss + owner reassignment.
- Do not delete `fs_call_logs` data or read endpoints; Call History stays.

## 4. Routing model (authoritative — Annex A)

**Rule: route by technician home state, NEVER by district.** Three districts legitimately span two regions (4766 Ohio Valley, 8035 Atlanta, 8206 Mid South), so any district-based vote disagrees with the SOP. Resolution chain:

1. Manually-assigned owner on the case (wins always; agent/routing never overwrites).
2. Technician home state → Annex A region → regional owner.
3. Fallback: shop-address state, then plate state (in that order).
4. Unmatched after all three → item routes to **Rob Anderson** flagged `needs-routing` (bad data investigation). Never broadcast.

⚠ Technician home state must come from the technician roster join (`vrm_rental_identity_resolutions` → all_techs). The identity table's own `state` column is a **resolution status, not a US state** (SOP B.5) — joining it silently produces plausible-looking garbage.

### 4.1 State → region (52 entries; supersedes STATE_TO_REGION and the district-vote in `server/vrm/rental-operations/region.ts`)

- **East / Region 1 — Olga Fernandez (17):** CT, DC, DE, FL, GA, MA, MD, ME, NC, NH, NJ, NY, PA, RI, VA, VT, WV
- **Central / Region 2 — Oscar Santana (17):** IA, IL, IN, KS, KY, MI, MN, MO, ND, NE, OH, OK, PR, SD, TN, TX, WI
- **West / Region 3 — Sandeep Kalyani (18):** AK, AL, AR, AZ, CA, CO, HI, ID, LA, MS, MT, NM, NV, OR, SC, UT, WA, WY

Known corrections vs. today's deployed routing (SOP A.6): OH, KY, IN, MI move East→Central; SC moves East→West; AL, AR, LA, MS move Central→West; PR added (Central). ~15% of escalations are currently misrouted — expect visible bucket population shifts and say so in the rollout note.

### 4.2 District → fleet-ops team (tags/registration items only)

- **Carol & Tasha:** Mesa 7088, Los Angeles 7108, Dallas 7995, Houston 8107, San Antonio 8147, Hawaii 8158, Denver 8169, N. California 8184, Portland 8228, Mid-Pacific 8366
- **Cheryl & Monica:** Cleveland 6141, St Louis 7323, Heartland 8096, Upper Midwest 8162, Mid South 8206, Michigan 8220, Detroit 8309, Kansas City 8420, Chicago 8555, Puerto Rico 8935
- **Rob D & Andrea:** Ohio Valley 4766, Chesapeake 7084, Florida 7435, New England 7670, New York City 7744, Penn-Jersey 7983, Atlanta 8035, Virginia 8175, Wall 8380

(District routing is correct for TEAM assignment — teams are defined by district. Region assignment is state-only.)

One shared module (e.g. `server/vrm/rental-operations/annex-a-routing.ts`) exports both tables + the resolution chain. Consumers: bucket builder, Cases by Region page grouping, ready-for-pickup notification lane, shop-contact-missing lane. Two hardcoded copies is how the boards drift (SOP B.2's own warning about vocabularies applies here too).

## 5. Buckets and their work

| Bucket | Gets |
|---|---|
| Olga / Oscar / Sandeep | All regional-owner classifications (below) for their Annex A states, plus anything manually assigned to them |
| Rob Anderson | Authorization needed, stalled repairs (2 slipped ETAs or >60 days in shop), shop-record/PO corrections, `needs-routing` investigations |
| Jennifer Dyer | Decommission / approved-for-sale retrievals (location + key-contact handoff, confirm retrieval) |
| Carol & Tasha, Cheryl & Monica, Rob D & Andrea | Expired tags / registration holds, routed by the truck's district per §4.2 |

A truck can spawn **multiple items in different buckets** (e.g. declined repair: regional owner sources a replacement for the tech, Jennifer retrieves the vehicle). Within one bucket a truck appears once, at its highest-priority classification, with secondary classifications as chips.

## 6. Classification vocabulary, priorities, SLAs

Unified vocabulary merging the current 7 queue steps, SOP §9 escalation table, and LUCA outcome labels. SLA is business days from **classification onset** (see §7 anchor rule). Priorities are SOP §7.

| Priority | Classification | Owner rule | SLA |
|---|---|---|---|
| P1 | Declined repair / sent to auction → source replacement (keep 3-nearest-spares suggestions, link Fleet Finder) | Regional owner | 5d to sourcing decision |
| P1 | Retrieval pending (decommission / sold) | Jennifer Dyer | 5d to confirmed retrieval |
| P2 | LUCA escalated case (workbook `escalated` flag) | Regional owner | 2d |
| P2 | Unverified — confirm vehicle by phone | Regional owner | 2d |
| P2 | Ready-guard review (READY downgraded, confirm before dispatch) | Regional owner | 1d |
| P2 | Vehicle ready — schedule pickup (LUCA Ready confirmed, Holman repair complete, or ERD passed; feeds existing schedule-pickup flow) | Regional owner | 2d |
| P2 | Schedule tech pickup (Scheduling status; due/unscheduled/future — existing logic) | Regional owner | 2d |
| P2 | Confirm rental returned (return-scheduled/on-road/swap states; only Enterprise report closes) | Regional owner | — |
| P2 | Pickup follow-up (pickup date passed, confirm tech has vehicle) | Regional owner | — |
| P2 | Authorization needed | Rob Anderson | 1d |
| P2 | Stalled repair | Rob Anderson | 3d |
| P2 | Shop record fix (wrong phone on PO — every future call is wrong) | Rob Anderson | — |
| P2 | Truck mismatch, no qualifying PO → escalate closure, do NOT call | Regional owner | 2d |
| P2 | Needs tow | Regional owner | 2d |
| P2 | Shop does not have truck / relocated → locate | Regional owner | 3d |
| P2 | Technician unreachable (3 attempts / 2 days → TTL) | Regional owner | 3d, escalate day 4 |
| P2 | Tags / registration hold (suppress from calling queue) | District team | 7d |
| P3 | Aged open case (no other classification; sort oldest `date_put_in_repair` first) | Regional owner | — |
| P3 | Follow-up due (workbook follow-up date ≤ today) | Regional owner | — |
| P4 | Shop unreachable — human callback (no answer / no contact / call failed; LUCA leaves no voicemail) | Regional owner | 5d per truck |

Notes:
- The old step-5 wording "INITIATE LUCA AI CALL" is retired — there is no per-truck trigger; the human action is a manual callback (P4).
- "Confirm tags with Cheryl" is retired — tags route to the district's team, which may be any of the three teams.
- LUCA pill styling from the previous task carries over; new classification pills reuse it.
- Status vocabulary for workbook writes must be **consumed from the API, not copied** (SOP B.2).

## 7. Item model & data sources

**Derived builder** (like today's `buildTodaysQueue`), VRM-side, over: `vrm_rental_operations_cases` + append-only `vrm_rental_operation_actions` (current workbook state = newest row per case), `fs_trucks` (truck-level status/sub-status, LUCA last-call fields, scheduled pickup date), `fs_call_logs` (LUCA outcomes), reconciled PO evidence via the MasterRow `po_eff` logic (eff_status, open_evidence_at, shop_pick w/ phone+lock, portal_msg_count) — **factored into a shared reader** so queue and MasterRow cannot disagree, replacing the queue's raw Snowflake `HOLMAN_ETL_PO_DETAILS MIN(PO_DATE)` join.

**Row context chips:** effective PO status (+ source-health/data-age warning per SOP B.5), open-PO date, shop + phone (manual locks honored; phone shown for manual calls — call buttons stay gone), portal message-trail age, rental vendor/PO, days in rental, last LUCA outcome + date, scheduled pickup date, Samsara-health where already available.

**SLA anchor:** business-day clocks need a stable onset date. Use the underlying event date where the source provides one (escalation mark date, status-change date, ERD). Where the source can't say when a condition began, persist first-observed per (case, classification) — append-only action row of type `classification_observed` — so clocks don't reset on every rebuild.

**Known traps (memory):** Holman `PO_STATUS` has no 'Open' (open = APPROVED); 5-day loader window leaks POs; pad/format mismatches — always canonical truck-number match (strip non-digits → ltrim zeros); TTL caches over mirrors must respect the shared epoch; do not build against the empty tables listed in SOP B.4 (rental task projections, agent review-flags, VRM call-log, truck-level ready-for-pickup boolean, the retired open/closed/pickup marker).

## 8. Writes: ownership, done, dismiss

- **Manual owner:** append-only action row (`assign_owner`) on the case; actor from session; newest row wins; UI dropdown of the 8-bucket roster (+ "auto" to clear back to Annex A routing).
- **Seeding from Action Tracker:** `fs_trucks.shs_owner` seeds manual assignments **only where explicitly set** — the tracker *defaults* to "Oscar S", so a blanket copy would mass-assign Oscar. Verify against stored values/`fs_actions` history; when in doubt, don't seed (Annex A fills the gap).
- **Done = a real status write.** Completing an item advances the workbook status (append-only; human beats agent; only `returned and closed` closes a case). No parallel done-state that can disagree with the case.
- **Dismiss for today:** shared, team-visible, DB-backed (action row `dismissed_for_day` with ET business date); expires next business day; shown struck-through with who dismissed it. Replaces and removes both localStorage mechanisms (`vrm-ops-queue-done-*`, `fs-queue-done-*`).

## 9. UI

**VRM Ops Queue page (authoritative):**
- Top: 8 bucket cards + "Everyone" — name, role subtitle, open count, due-today, overdue; unrouted/`needs-routing` strip pinned when nonempty.
- Bucket view: items grouped P1 → P4, SLA chip (due in N business days / overdue in red), classification pill, context chips, actions: advance status (API-served vocabulary), reassign owner, dismiss-today, links (case detail, Fleet Finder on P1 sourcing items, Holman Insights).
- "Everyone" view keeps a step/classification grouping + region filter for supervisors.

**Fleet Scope Today's Queue:** read-only mirror of the same builder output (same buckets, no write actions). **Fleet Scope Action Tracker: retired** — page removed from nav/registry; its flag columns (Reg Sticker, AMS, Renewal, …) become chips/filters on queue items; its `getNextAction` texts fold into classification action text; redirect/tombstone pointing to the new queue.

## 10. Notification alignment

- `region.ts` district-vote is **replaced** by the Annex A module (state-based). Cases by Region grouping switches with it (SOP A.6 requires both).
- Ready-for-pickup lane (SOP §11: NOT ROUTING, blank recipients) → point at Annex A module so it reaches the regional owner; verify recipient config end-to-end in dev.
- Shop-contact-missing lane (SOP §11: MISROUTING, fans to all three) → single correct regional owner via the module.
- **Transitional caveat:** the LUCA agent itself (LIVHR side, out of scope) still routes 9 states wrong and lacks PR. Until LIVHR adopts Annex A, agent-sent escalation emails for those states will disagree with the (correct) bucket. Surface this to the user at rollout; the shared table is the reference implementation for the LIVHR fix.

## 11. Retirements (delete, don't strand)

1. `server/holman-scraper-cache.ts` + every consumer reference (todays-queue, fleet-scope-routes — re-grep for the full list; feed frozen since mid-July, all rows ERROR).
2. "Holman: ERROR" pill and `isHolmanRepairComplete` / `isHolmanInAuthorization` scraper-based checks → replaced by `po_eff`-based equivalents.
3. `STATE_TO_REGION` in todays-queue + district-vote in region.ts → Annex A module.
4. localStorage done-tracking (both UIs).
5. Action Tracker page (per §9).
6. Step wordings "INITIATE LUCA AI CALL" and "CONFIRM TAGS WITH CHERYL".

## 12. Verification criteria (acceptance)

1. Every open case/truck lands in exactly the buckets the rules say; the 9 corrected states + PR route per Annex A (spot-check one case per corrected state).
2. A case with a manually-assigned owner stays in that bucket regardless of state.
3. Unmatched-state case → Rob Anderson bucket with `needs-routing` flag; zero broadcasts.
4. Tags item in district 8206 (Mid South, spans regions) routes to Cheryl & Monica while its region still resolves by the tech's state — proving state/district separation.
5. Dismiss-today visible to a second session; gone next business day; done-advance writes an action row with session actor.
6. No reference to holman-scraper-cache remains; queue renders with scraper feed absent.
7. Ready-for-pickup + shop-contact-missing lanes deliver to exactly one correct owner in dev test.
8. Typecheck at 213-error baseline (no new); existing unit workflows green (schedule-pickup-unit, vrm-guard-unit, comms-lib-unit, cache-alignment-*); new unit tests for the routing module (all 52 entries + fallback chain + unmatched) and classification/SLA mapping.
9. FS Today's Queue renders identical bucket data read-only; Action Tracker gone from nav; no orphan routes.

## 13. References

- SOP v4 docx (above) — §3 roles, §7 priorities, §9 SLAs, §11 automation status, Annex A, Annex B engineering notes.
- Current builder: `server/todays-queue.ts` (`buildTodaysQueue`, `classifySchedulingDate`, STATE_TO_REGION).
- Region vote to replace: `server/vrm/rental-operations/region.ts`; ready lane: `server/vrm/rental-operations/../ready-notify.ts`, dispatcher: `server/vrm/notification-dispatcher.ts`.
- PO reconciliation to factor out: MasterRow `po_eff` CTE in `server/vrm/rental-operations/read-repository.ts`.
- Action Tracker: `client/src/pages/fleet-scope/ActionTracker.tsx` (`normalizeOwnerName`, `getNextAction`, flag columns), history via `fs_actions` on PATCH `/api/fs/trucks/:id`.
- Queue UIs: `client/src/pages/vehicle-rental-management/pages/OpsQueue.tsx`, `client/src/pages/fleet-scope/TodaysQueue.tsx`.
- LUCA vocab: `server/luca-writeback/mapper.ts`; pill styling added in the batch-caller removal task.
- Env/process: typecheck via workflow (baseline 213), tests via configured workflows, no migrations on deploy (boot-DDL/self-heal pattern), autoscale kills in-process timers.
