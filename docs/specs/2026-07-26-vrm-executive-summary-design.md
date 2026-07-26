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
- Right-size stage mix over time (funnel shifting toward DONE).

Time ranges: 30 / 90 / 180 days / all.

### Row 3 — Breakdowns (current-state)

- By district / division (top 10, from case fields).
- By rental class — van/minivan vs sedan mix (right-size angle).
- By "why is it open": in shop (open repair PO / repair-tracker active), repair complete, declined repair/decommission, registration blocker, no repair activity.
- Vendor is a persistent filter across all breakdowns and drill-downs.

### Row 4 — Insight cards (rule-based recommendations)

Each card: title, count, estimated daily-dollar impact, severity, and a drill-down link to the filtered Rental Operations case list.

1. **Repair done, rental still open** — case open AND (`repairs_complete` affirmative OR repair-tracker/AMS shows completed). Purest waste; first calls to make.
2. **Rental, no repair activity** — case open AND no open repair-type PO for the truck (via classified PO history). **Splits into two sub-groups with different plays:**
   - **Registration is the blocker** — truck's `fs_trucks` row shows registration expired (`registration_sticker_valid`/`registration_expiry_date`/`holman_reg_expiry`) or renewal in process (`registration_in_progress` OR `registration_renewal_in_process`). Action: chase the renewal; card shows how long the renewal has been pending (`registration_last_update`).
   - **No known reason** — registration fine, nothing being repaired. The true "why does this rental exist?" cases.
3. **Long-runners** — `days_open` > 45, ranked by `rate_authorized`.
4. **Right-size candidates not in the campaign** — resolved renter paying van/minivan-class rate, not present in `vrm_rightsize_techs`.
5. **Right-size stalled** — COMMITTED > 14 days without RETURNED/DONE; plus NON_RESPONDER count.
6. **Extension pile-ups** — `number_of_extensions` ≥ 3 OR `days_behind` > 0.
7. **Declined-repair / decommission trucks still holding rentals** — truck's main status is terminal (Declined Repair) or truck in decommissioning, rental still open. The truck is never coming back; force the rental decision.
8. **Unknown renter** — identity resolution state ≠ RESOLVED. Blocks every other play; card links to the identity drawer.

**Registration badge everywhere:** every case row rendered by this dashboard (any card, any drill-down list) shows a REG flag when its truck's registration is dead or in renewal, so a long-runner or extension pile-up with a registration problem is never mistaken for tech foot-dragging.

### AI executive brief

- 2–3 paragraph narrative below the cards, generated from the exact metrics JSON served by the summary endpoint (no independent data reads), via the already-configured OpenAI integration.
- Generated at most once per day, cached (in `vrm_exec_daily_metrics.ai_brief` on today's row); admin-only "Regenerate" button.
- Fail-soft: if the AI call fails (quota, key, outage), the page renders everything else and hides the brief. Never blocks or errors the page. (Known gotcha: OpenAI keys degrade silently — out-of-quota passes key checks but 429s on completions.)

## Backend

### Endpoint

`GET /api/vrm/executive-summary` — one call returns headline numbers, breakdowns, insight cards (with case-key lists for drill-down), trend series, and the cached AI brief. Session-gated like other `/api/vrm/*` routes. Server-side cache ~5 minutes (in-memory, per instance — acceptable staleness; autoscale instances each warm their own).

`POST /api/vrm/executive-summary/brief` — admin-only regenerate of the AI brief.

### Metrics module

`server/vrm/executive-summary/` — new module: `metrics.ts` (pure SQL/aggregation functions, one exported function per metric group), `insights.ts` (the 8 rules; each returns {count, caseKeys, dailyImpact}), `routes.ts` (thin), `brief.ts` (AI narrative). Insight rules are pure functions over query results so they are unit-testable with seeded data.

**Truck-number join rule:** VRM `case_key` is a padded vehicle number; `fs_trucks.truck_number` may be unpadded. All joins between cases and `fs_trucks` (registration, terminal status) normalize by stripping leading zeros on BOTH sides. BYOV `88`-prefix checks (if ever needed) run on the raw/trimmed number before padding.

### Daily rollup table

`vrm_exec_daily_metrics` — one row per ET date:

- `metric_date` (DATE, PK)
- `open_total` INT, `open_by_vendor` JSONB
- `new_count` INT, `returned_count` INT
- `daily_spend` NUMERIC, `potential_savings` NUMERIC
- `avg_days_open` NUMERIC, `over_30_count` INT
- `rightsize_stages` JSONB (stage → count)
- `insight_counts` JSONB (rule id → count; lets trends later show e.g. "repair-done backlog shrinking")
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

- Unit tests (tsx --test) for: each insight rule against seeded cases (including padded/unpadded join cases and each registration sub-state), vendor normalization, weekly new/returned windows, backfill reconstruction against known import-run counts.
- `npm run check` — zero NEW type errors vs the ~224 baseline.
- Manual: every KPI and card drill-down lands on the correctly filtered Rental Operations view; AI brief renders, regenerates (admin), and hides cleanly when the key is disabled.
- Backfill sanity: spot-check `vrm_exec_daily_metrics` rows against `vrm_rental_operations_import_runs` totals for the same dates.

## Out of scope

- Any change to the existing Rental Operations page (recommendations only; separate cycle).
- New scheduled deployments or cron entries (reuses the existing wake-up-call path).
- Writes to `fs_trucks` or any FleetScope table (this feature is read-only outside its own `vrm_exec_daily_metrics` table).
- LUCA/outbound-call integration on insight cards (future idea).
