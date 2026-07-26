# VRM Executive Summary Dashboard — Design

**Date:** 2026-07-26
**Status:** Approved approach (Approach A: live aggregation + thin daily rollup); content approved in brainstorming dialogue with two user corrections (vendor split, registration factor).

## Purpose

A top-level VRM page that tracks the rental program from every angle — how many rentals we have, how fast they're arriving and returning, what they cost, how the right-size initiative is progressing — and turns that data into concrete, prioritized recommendations for reducing the rental count. Audience is both leadership (read-only snapshot) and VRM operators (drill-down entry point into the working pages).

## Page

`/vehicle-rental-management/executive-summary` — new page in the VRM section, first item in VRM navigation. Uses the existing VRM color palette (`client/src/pages/vehicle-rental-management/lib/constants.ts`); no hardcoded hex values (dark-mode rule).

### Row 1 — Headline numbers (live)

- **Open rentals** — total, split by rental company: **Enterprise / Hertz / Avis** (normalized from `rental_vendor`, e.g. "HERTZ HLE" → Hertz, "AVIS RENT A CAR SYSTEM, INC" → Avis). Unknown/new vendors surface under their own normalized name — never silently lumped into "other". (Verified in dev data 2026-07-26: 371 Enterprise / 10 Hertz / 6 Avis.)
- **New this week** and **Returned this week** — with vs-prior-week deltas. New = cases with `rental_start_date` (fallback `first_seen_at`) in the window; Returned = cases with `dropped_from_feed_at` in the window.
- **Estimated daily spend** — SUM(`rate_authorized`) over open cases; beside it **potential daily savings** = SUM(max(0, `rate_authorized` − SEDAN_FLOOR)) where SEDAN_FLOOR = 54.99 (single source of truth moves to the backend — see "Existing-page simplification").
- **Average days open** + count of rentals past 30 days.
- **Right-size progress** — DONE / COMMITTED / outstanding (NON_RESPONDER + QUESTION + PUSHBACK) counts from `vrm_rightsize_techs`.

### Row 2 — Trends (from `vrm_exec_daily_metrics`, backfilled)

- Open rentals over time (line; stackable by vendor).
- New vs returned per week (bars) — the shrink/grow signal.
- Daily spend over time.
- Bucket mix over time (from `bucket_counts` — live rows only; backfill can't reconstruct historical person-status).
- Right-size stage mix over time (funnel shifting toward DONE).

Time ranges: 30 / 90 / 180 days / all.

### Row 3 — Rental buckets (the primary "why is it open" segmentation)

Every open rental is assigned to **exactly one** bucket, evaluated in this precedence order (person-status first, then truck state). Each bucket is a monitored count with trend + drill-down.

1. **TERMINATED renter** — renter's employment status is T (from `COALESCE(override_status, resolved_status)` on the case's identity resolution). A termed tech in a rental is a recovery case, whatever the truck says.
2. **LOA renter** — employment status L / P / S. Monitored alongside the existing LOA Recovery flow.
3. **New hire (≤ 60 days)** — renter's enterprise ID matches an `onboarding_hires` row (excluding stale-swept rows) with `service_date` within 60 days. Expected rentals while a van is located — **takes precedence over the Declined/Decommissioned bucket**, because new hires are sometimes parked under a truck number that shows Declined Repair / Sent to Auction. The card monitors *duration* (a new hire in a rental for 55 days is the signal, not the rental's existence).
4. **Declined Repair / Decommissioned truck** — truck's `fs_trucks` main status is terminal (Declined Repair, incl. Sent to Auction sub-status) or the truck is in decommissioning. The truck is never coming back; force the rental decision.
5. **In repair** — truck has an actively open repair-type PO (classified PO history; open = APPROVED status — the Holman feed has no literal "Open").
6. **Repair done — registration dead** — repair complete (`repairs_complete` affirmative OR repair-tracker/AMS completed) but the truck's registration is expired (`registration_sticker_valid`/`registration_expiry_date`/`holman_reg_expiry`) or renewal in process (`registration_in_progress` OR `registration_renewal_in_process`). Action: chase the renewal; shows how long the renewal has been pending (`registration_last_update`).
7. **Repair done — no blocker** — repair complete, registration fine, rental still open. Purest waste; first calls to make.
8. **No repair activity, no known reason** — nothing being repaired, no other explanation. The true "why does this rental exist?" cases.

**Unknown renter** (identity resolution state ≠ RESOLVED) is not a bucket of its own: person-status buckets (1–3) require a resolved renter, so unresolved cases classify by truck state only (buckets 4–8) and carry an **UNKNOWN RENTER badge** — plus a dedicated insight card below, since resolving identity unlocks the person-status buckets.

Secondary breakdowns (same row, smaller): by district/division (top 10), by rental class (van/minivan vs sedan — right-size angle). Vendor is a persistent filter across all buckets, breakdowns, and drill-downs.

### Row 4 — Insight cards (rule-based recommendations)

The action layer on top of the buckets. Each card: title, count, estimated daily-dollar impact, severity, and a drill-down that opens an **in-page case-list drawer** (truck #, tech, vendor, rate, days open, badges) — the existing Rental Operations page has no URL-driven filters and is out of scope for changes, so drill-downs stay self-contained on this page, with a per-case link into Rental Operations.

1. **Long-runners** — `days_open` > 45, ranked by `rate_authorized` (any bucket; bucket shown per row).
2. **Right-size candidates not in the campaign** — resolved renter paying van/minivan-class rate, not present in `vrm_rightsize_techs`.
3. **Right-size stalled** — COMMITTED > 14 days without RETURNED/DONE; plus NON_RESPONDER count.
4. **Extension pile-ups** — `number_of_extensions` ≥ 3 OR `days_behind` > 0.
5. **Unknown renter** — identity resolution state ≠ RESOLVED. Blocks bucket accuracy and every people-play; card links to the identity drawer.
6. **New-hire rentals aging out** — bucket-3 cases past 45 days: the van search is taking too long; escalate van sourcing rather than the rental itself.

**Registration badge everywhere:** every case row rendered by this dashboard (any card, any drill-down list) shows a REG flag when its truck's registration is dead or in renewal, so a long-runner or extension pile-up with a registration problem is never mistaken for tech foot-dragging.

### AI executive brief

- 2–3 paragraph narrative below the cards, generated from the exact metrics JSON served by the summary endpoint (no independent data reads), via the existing Bedrock helper (`invokeBedrock` in `server/vrm/rightsize/llm.ts` — the same AI path the right-size classifier already uses; no new keys or vendors).
- Generated at most once per day, cached (in `vrm_exec_daily_metrics.ai_brief` on today's row); admin-only "Regenerate" button.
- Fail-soft: if the AI call fails (quota, key, outage), the page renders everything else and hides the brief. Never blocks or errors the page. (Known gotcha: OpenAI keys degrade silently — out-of-quota passes key checks but 429s on completions.)

## Backend

### Endpoint

`GET /api/vrm/executive-summary` — one call returns headline numbers, breakdowns, insight cards (with case-key lists for drill-down), trend series, and the cached AI brief. Session-gated like other `/api/vrm/*` routes. Server-side cache ~5 minutes (in-memory, per instance — acceptable staleness; autoscale instances each warm their own).

`POST /api/vrm/executive-summary/brief` — admin-only regenerate of the AI brief.

### Metrics module

`server/vrm/executive-summary/` — new module: `metrics.ts` (pure SQL/aggregation functions, one exported function per metric group), `buckets.ts` (the bucket classifier — one pure function that takes a case's joined facts and returns exactly one bucket, applying the precedence order above), `insights.ts` (the 6 insight rules; each returns {count, caseKeys, dailyImpact}), `routes.ts` (thin), `brief.ts` (AI narrative). The classifier and insight rules are pure functions over query results so they are unit-testable with seeded data.

**Bucket data joins (all read-only):** person status from `vrm_rental_identity_resolutions` (`COALESCE(override_status, resolved_status)`); new-hire lookup from `onboarding_hires` by enterprise ID (`service_date` ≥ today − 60d, excluding `dropped_from_source_at` rows); truck terminal status + registration fields from `fs_trucks`; open repair POs from classified PO history.

**Truck-number join rule:** VRM `case_key` is a padded vehicle number; `fs_trucks.truck_number` may be unpadded. All joins between cases and `fs_trucks` (registration, terminal status) normalize by stripping leading zeros on BOTH sides. BYOV `88`-prefix checks (if ever needed) run on the raw/trimmed number before padding.

### Daily rollup table

`vrm_exec_daily_metrics` — one row per ET date:

- `metric_date` (DATE, PK)
- `open_total` INT, `open_by_vendor` JSONB
- `new_count` INT, `returned_count` INT
- `daily_spend` NUMERIC, `potential_savings` NUMERIC
- `avg_days_open` NUMERIC, `over_30_count` INT
- `rightsize_stages` JSONB (stage → count)
- `bucket_counts` JSONB (bucket id → count; drives the bucket-mix-over-time trend — e.g. "repair-done backlog shrinking", "terminated-renter rentals climbing")
- `insight_counts` JSONB (rule id → count)
- `ai_brief` TEXT NULL, `ai_brief_generated_at` TIMESTAMPTZ NULL
- `source` VARCHAR — `backfill` | `live`
- `created_at`, `updated_at`

Created by **idempotent raw-SQL boot DDL** in `server/vrm/init-schema.ts` (VRM regime — deploys run no migrations; never drizzle-kit push). Drizzle definition added to `shared/vrm-schema.ts` for type truth only.

### Writing today's row

Appended/updated by the existing rental-ops scheduled sync path (the internal-cron route the fleet-agents VM already pokes — no new scheduler, no new cron entry) after a completed ingest, plus lazily by the summary endpoint if today's row is missing (idempotent upsert on `metric_date`). No advisory lock needed beyond the upsert's ON CONFLICT (single-row, last-write-wins on identical inputs).

### One-time backfill

Reconstructs history, flag-guarded via `app_settings` key `vrm_exec_metrics_backfilled` so it runs exactly once (post-listen, never blocking boot — autoscale listen-first rule):

- **Open count per day:** from `vrm_rental_operations_import_runs` per-run totals (enterprise/holman counts, `started_at`); where runs are missing, interpolate from case lifecycles (`first_seen_at` → `dropped_from_feed_at`).
- **New/returned per day:** case `rental_start_date`/`first_seen_at` and `dropped_from_feed_at`.
- **Spend:** reconstructed from open-case sets × `rate_authorized` (rate treated as constant over the case's life — approximation, labeled `source='backfill'`).
- **Right-size stages over time:** replay `vrm_rightsize_events` transitions.
- Backfilled rows never overwrite `live` rows.

## Existing Rental Operations page — simplification recommendations (advisory; separate approval before any change)

1. Move summary/status duties to the exec dashboard; make the ops page purely a work queue.
2. Replace the cohort/identity/AMS filter maze with a default "next best action" sort driven by the same insight rules (repair-done-still-open first; unknown-renter flagged).
3. Collapse per-case detail (identity confidence, PO detail) into the drawer; fewer grid columns.
4. Remove duplicated cost-delta math from the UI; both pages read savings-vs-sedan-floor from the new backend module so the numbers always agree.

## Error handling

- Summary endpoint degrades per-section: if one metric group's query fails, that section returns an error marker and the rest render (no all-or-nothing 500). Transient Neon WS drops on this heavy aggregator serve the ≤5-min stale cache instead of erroring (known pattern).
- AI brief is fail-soft (above).
- Backfill failures leave the flag unset and log loudly; dashboard still works with live-only data.

## Verification

- Unit tests (tsx --test) for: the bucket classifier's precedence order against seeded cases (must include: new hire in a Sent-to-Auction truck → New Hire bucket; termed tech in a truck with an open PO → TERMINATED bucket; unresolved renter → truck-state bucket + unknown-renter flag; padded/unpadded truck-number joins; each registration sub-state), each insight rule, vendor normalization, weekly new/returned windows, backfill reconstruction against known import-run counts.
- `npm run check` — zero NEW type errors vs the ~224 baseline.
- Manual: every KPI and card drill-down opens the in-page drawer with the correctly filtered case list (badges included); AI brief renders, regenerates (admin), and hides cleanly when the key is disabled.
- Backfill sanity: spot-check `vrm_exec_daily_metrics` rows against `vrm_rental_operations_import_runs` totals for the same dates.

## Out of scope

- Any change to the existing Rental Operations page (recommendations only; separate cycle).
- New scheduled deployments or cron entries (reuses the existing wake-up-call path).
- Writes to `fs_trucks` or any FleetScope table (this feature is read-only outside its own `vrm_exec_daily_metrics` table).
- LUCA/outbound-call integration on insight cards (future idea).
