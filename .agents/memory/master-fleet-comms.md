---
name: Master Fleet Communications Module
description: Design constraints & cutover rules for the consolidated team-SMS inbox (fs_comms_*)
---

# Master Fleet Communications Module

A single team SMS inbox consolidating Registration (`fs_reg_messages`) + Decommissioning
(`fs_decomm_messages`) two-way texting into ONE thread per technician, keyed by LDAP, with
per-message category tabs. Takes over the shared `FS_TWILIO_PHONE_NUMBER`.

## Durable constraints (not obvious from code)

- **VRM 877-number / ElevenLabs voice path is OUT of scope** — do NOT route it through this module.
  **Why:** it's a separate voice pipeline; folding it in would break the tech-facing approval SMS flow.

- **Legacy backfill is copy-only.** `server/run-comms-migrate.ts` READS `fs_reg_messages` +
  `fs_decomm_messages` and never writes/deletes them. Idempotency rides on a deterministic dedupe key
  stored in `twilio_sid` (real SID, else synthetic `legacy:reg:<id>` / `legacy:decomm:<id>`) plus the
  partial unique index on `twilio_sid WHERE twilio_sid IS NOT NULL`.
  **Why:** re-running the one-off migrate must be safe; the legacy tables stay authoritative until cutover.
  **How to apply:** any new legacy source must add its own synthetic key prefix, never reuse reg/decomm.

- **Two-layer access gate (per-user permission + dark-rollout flag):** every non-webhook
  `/api/fs/comms/*` route runs a `gate` that requires BOTH: (1) the per-user
  `sidebar.activities.fleetCommunications` permission (the module has its OWN dedicated permission — it
  no longer piggybacks on `communicationHub`); AND (2) the `comms_module_enabled` app_setting — while
  OFF only developer/admin pilot roles pass even WITH the permission; once ON the permission alone
  governs. Anyone failing either gets 404. The server computes the effective permission with
  `permission-utils` (defaults→stored role row→`user.permissionOverrides`), mirroring the client.
  The two Twilio webhooks (`/webhooks/inbound` + `/status`) are auth-excluded and ALWAYS live so no
  inbound text is lost during rollout — do not gate the webhooks behind the flag.
  **Why:** once the flag flips ON the old gate let EVERY authenticated user hit the comms API; the
  dedicated permission makes it enablable per user (role default or user override).
  **How to apply:** the config route `/comms/config` is behind the same gate, so a user without the
  permission gets a 404 config → `Registration.tsx`/`Decommissioning.tsx` keep the LEGACY conversation
  UI (they render `CommsHandoff` only when `commsConfig.enabled===true`) — no dead handoff links, no
  extra gating needed there.

- **Autoscale-safe schedulers (in-process timers don't fire on autoscale).** Three standalone scripts
  are meant to be Replit Scheduled Deployments created AFTER publish (agent env can't create schedules):
  `run-comms-sync.ts` (daily contacts refresh, self-bootstraps Snowflake like run-rental-sync),
  `run-comms-queue.ts` (~5-min send-queue drain, no Snowflake), `run-comms-migrate.ts` (one-off backfill).
  In-process post-listen drain + startup `initCommsSchema()` are best-effort secondary paths only.

## Contacts-sync upsert pitfall (keep-last-good on timestamps)

The `fs_comms_contacts` upsert has two "keep last known-good" helpers in the ON CONFLICT SET
clause. `preferNonNull(col)` → `COALESCE(NULLIF(excluded.col,''), existing.col)` is **TEXT-only**:
the `NULLIF(x,'')` coerces the empty-string literal to the *column's* type, so on a **timestamp**
column it throws `22007 invalid input syntax for type timestamp: ""` — even with **zero** existing
rows, because the literal is coerced at plan time (the whole upsert statement fails, so a first-ever
sync inserts NOTHING). Use `preferNonNullTs(col)` → `COALESCE(excluded.col, existing.col)` for any
timestamp column (e.g. `phone_last_verified_at`).
**Why:** a timestamp is never an empty string, so the NULLIF('') guard is both wrong and fatal.
**How to apply:** any NEW column added to this upsert — pick the helper by column type; timestamps
never use `preferNonNull`.

## Legacy thread identity enrichment (phone-only → named)

The one-off backfill creates one `kind='unmatched'` thread PER phone number with NO name/LDAP,
because `fs_comms_contacts` is empty at migrate time. Naming is a SEPARATE post-sync pass
(`enrichThreadContacts()` in `server/fleet-comms/enrich.ts`, called at the END of
`syncCommsContacts()`), NOT part of the backfill. It resolves each phone-only thread's identity
straight from the still-authoritative legacy source tables, priority best-first:
current roster contact by phone → `fs_reg_messages.tech_id` (LDAP) on roster → reg `tech_id` off
roster (LDAP only, termed) → `fs_decomm_messages.contact_name` literal (NAME only — see MIX note). Then it
promotes roster-backed threads to `kind='tech'` (one canonical per LDAP, most-recent wins, never
colliding with an existing tech thread) so future inbound unifies instead of forking.
**Why:** phone→name mapping drifts as the roster changes; a one-off SQL fix would leave every new
non-roster inbound thread nameless. Termed/anonymous-adhoc numbers correctly stay `unmatched` (name
stamped when known, phone shown otherwise) — do NOT fabricate a name.
**How to apply:** it's idempotent (only touches unmatched threads still missing a `contact_name`) and
re-runs every contacts sync; the frontend already renders `contactName || ldap || phone`, so stamping
the thread's denormalized `contact_name`/`ldap`/`truck_number`/`district` is all that's needed.

**Manager-row name/ldap MIX — FIXED (the "wrong person's name on a thread" symptom):** the OLD `dec`
CTE took the decomm row's `contact_name` for the NAME but `cc_for_ldap` for the LDAP. On a
`contact_type='manager'` row `contact_name` is the MANAGER (the phone owner) and `cc_for_ldap` is the
CC'd TECH — two DIFFERENT people — so a manager's phone thread got the tech's LDAP and was then
promoted to `kind='tech'`, hijacking that tech's identity (symptom: a manager's number labeled + keyed
to a different technician). **Key fact:** `cc_for_ldap` is ONLY ever the CC'd tech, NEVER the phone
owner's own LDAP — decomm gives a reliable NAME (the phone owner, in either row type) but NO usable
LDAP. **Fix:** `dec` now prefers a `contact_type='tech'` row (`ORDER BY (contact_type='tech') DESC,
sent_at DESC`) and the `res` ldap COALESCE dropped `cc_for_ldap`. **Idempotent step 1c repair** un-keys
threads already corrupted (thread.phone = a manager row's phone AND thread.ldap = that row's
cc_for_ldap AND thread.name = that manager's name) → sets `ldap=NULL, kind='unmatched'`, keeping the
manager's own name. **Collision gotcha:** reverting to `unmatched` can hit
`uq_fs_comms_threads_unmatched` (partial unique on `phone_digits WHERE kind='unmatched'`) when an EMPTY
placeholder unmatched thread already exists for that phone — step 1c FIRST deletes those 0-message
duplicates, THEN flips (guarded against any remaining non-empty sibling), so no message history is lost.

## Thread district: truck→district source, MIXED formats, canonical everywhere

Legacy `fs_reg_messages` / `fs_decomm_messages` have NO district column, and the migrate never
populated `fs_comms_messages.ldap` (0/887) — so a thread's district can't be read off the message
history. Two sources only: the roster contact (`fs_comms_contacts.district`, by LDAP) OR derived from
the truck number via `holman_vehicles_cache` (truck→district). `enrichThreadContacts()` backfills
district from holman for ANY thread (tech + unmatched) still missing it, canonical-truck matched
(`ltrim(regexp_replace(x,'[^0-9]','','g'),'0')` on both sides; `ADHOC-*` trucks excluded — they're
phone-derived placeholders, no real truck). `fsPool` → `DATABASE_URL`, same DB as holman, so the
cross-table join works from the fleet-comms code.
**`holman_vehicles_cache.district` is stored in MIXED formats** — both padded `0007084` and unpadded
`7084` for the SAME district; roster contacts are always padded. So district MUST be canonicalized
(strip non-digits + leading zeros) EVERYWHERE it is compared, listed, or displayed, or one real
district splits into two dropdown entries and filters miss half the rows. The inbox district filter
(`GET /comms/threads?district=`) compares canonically; the dropdown source `GET /comms/threads/districts`
returns DISTINCT canonical values and is registered BEFORE `/threads/:id` so the param route can't
swallow it. Threads whose only truck is `ADHOC-*` legitimately have no district (no source exists).
**Why:** an exact-eq filter on the padded stored value silently matched nothing when the user picked/
typed the short district number — that was the "district search doesn't work" report.
**How to apply:** never `eq` on raw district; always canonicalize both sides. Reuse the same truck
canonicalization used for TPMS↔Holman number matching.

## `fsDb.execute()` returns a result OBJECT, not an iterable (Neon trap)

`fsDb.execute(sql\`…\`)` (fleet-scope Neon serverless driver) returns a result object with a `.rows`
array — it is NOT iterable. `const [x] = await fsDb.execute(...)` throws at runtime and 500s the route.
Always read `const rows = result?.rows ?? result ?? []` then `rows[0]`. This bit the `/comms/health`
route (destructured `[queueStats]`/`[contactStats]` → 500) AND is easy to reintroduce anywhere using
`fsDb.execute`. The `/comms/health` 500 is now fixed and guarded by an integration test asserting the
`.rows[0]` contract for both its queries.
**Why:** a 500 on `/comms/health` silently disables the inbox stale badge + the bulk-send stale-ack
gate, so the operator loses the stale-data safeguard without any visible error.
**How to apply:** never array-destructure an `fsDb.execute` result; the ORM `fsDb.select()` builder
DOES return an array (destructure OK there) — the trap is only the raw `.execute()` path.

## WS live-update shape

Inbound broadcasts via the shared `broadcastMessage(room, payload)` in `fleet-scope-reg-messaging.ts`,
which sends `{ type:"reg_message", truckNumber:room, ...payload }` — **payload.type overrides** the
default. Comms emits `comms_message` (payload `message`, room `comms:<threadId>`) and
`comms_inbox_update` (payload `threadId`, room `comms:inbox`). Frontend must derive the affected thread
from `d.threadId ?? d.message?.threadId`. Outbound (own sends) does NOT broadcast — relies on mutation
invalidation.

## Inbox rental flag + multi-select bulk

- **Rental-in-progress flag** on an inbox thread = the tech's LDAP is present in
  `GET /api/rental-ops/open-enterprise-ids` (returns `{enterpriseIds:string[]}`, uppercased,
  server-cached). Match by **LDAP, not truck#**: a thread's truck number is the last-texted truck,
  NOT necessarily the rental's truck. A 503 (Snowflake down) → empty set → no badges (graceful).
- **Comms uses `?scope=managed`; Weekly Offboarding uses the default (no param) — they intentionally
  return DIFFERENT counts.** The endpoint has TWO scopes (cache-keyed separately):
  - **default (badge/membership superset, ~494):** Enterprise open-ticket EIDs ∪ ALL non-toll Holman
    open rows' EIDs. Deliberately keeps Holman Enterprise-vendor rows (the inline comment says NOT to
    drop them) so no open-rental renter is missed. Weekly Offboarding's badge relies on this.
  - **`scope=managed` (~350, what Comms uses):** mirrors `rental-ops-sync.ts` SEGMENT 2 — Enterprise
    EIDs + only Holman **non-Enterprise-vendor** rows whose vehicle isn't already covered by an
    Enterprise ticket (`isEntVendor` skips enterprise/toll/empty; skip if vehicle in the Enterprise
    ticket set). Same population as `fs_trucks` (the Fleet Scope "rentals open" list).
  **Why:** the user reported the Comms "In rental" count (494) was wrong — it must reflect the *managed*
  Fleet Scope rentals list (~350), not the broader "anyone appearing in any open-rental feed" superset.
  **How to apply:** it's a person-keyed (EID) vs truck-keyed (`fs_trucks`) count, so managed ≈ 350 but
  won't be byte-exact (multi-truck techs collapse to one EID; Holman rows with a blank EID drop). Do
  NOT try to key Comms directly off `fs_trucks` — `fs_trucks.enterprise_id` is EMPTY (0/350) and it's
  truck-number keyed, so there's no LDAP to join on; replicate its *derivation* on the EID endpoint.
- **Bulk messaging resolves recipients by LDAP**, so only `kind==='tech'` threads WITH an `ldap` are
  selectable / flaggable; unmatched/phone-only threads can't be bulk-targeted or badged. The inbox
  "In rental" filter + bulk "In rental" mode both derive from the SAME `openRentalEidSet` (filter is
  client-side over fetched threads, `limit=300`; bulk passes the set as `ldaps`). Keep them on ONE
  shared source so the filter always matches the visible badge.

## Inbox sort order: recency-only, NOT unread-first (reverted from spec)

`GET /comms/threads` orders strictly by `last_message_at DESC NULLS LAST, id DESC` — deliberately
NOT unread-first. The original spec said "unread + newest first," but that combined with
mark-read-on-open (opening a thread POSTs `/threads/:id/read`, flips `unread=false`, invalidates the
list) made the just-opened thread jump out of the top "unread" block down into the read block by
date, so the list reshuffled unpredictably on every open (and again on the 20–30s poll / WS refresh).
Unread is now a visual bold-row + count badge only; the separate "unread only" toggle covers focus.
**Why:** user reported threads "move in and out of the list with no rhyme or reason" when opening
one — the unread-first primary sort key was the cause.
**How to apply:** do NOT re-introduce `desc(unread)` as a sort key to satisfy the old spec wording;
keep the sort keyed to activity so opening/reading a thread never moves it.

## Distinct visual identity (intentional divergence from app theme)

The Fleet Communications page (`client/src/pages/fleet-communications.tsx`) deliberately uses its
OWN "clean & premium SaaS" look — indigo/violet accent, slate surfaces, rounded-2xl panels, soft
shadows, technician initials avatars — via explicit Tailwind `light` + `dark:` variant classes,
NOT the global design tokens.
**Why:** the user explicitly asked for this module to look distinct and premium, and the global
theme forces a flat/clinical look everywhere (`--radius:0`, all `--shadow-*` at 0 opacity, pure
`hsl(0,0%,0%)` dark background, sky-blue primary). Relying on tokens can't achieve depth/rounding.
**How to apply:** do NOT "re-align it to the app theme" — that would undo a deliberate user choice.
Keep BOTH modes styled with explicit variants (dark uses softer `slate-950/900`, not pure black);
any new element on this page should follow the same slate+indigo palette, not the shadcn token bg.

## Thread lifecycle: ONE Archive action (Delete retired) + always-on unmatched auto-hide

`fs_comms_threads` has `archived_at`/`archived_by` + `deleted_at`/`deleted_by` (additive raw-SQL
`ALTER … ADD COLUMN IF NOT EXISTS` in `schema-init.ts` — NOT drizzle-kit). NOTHING is ever
hard-deleted — message rows AND their MMS `media_url` photos always stay, so any thread is fully
recoverable.

**Delete was RETIRED in favor of a SINGLE Archive action** (user asked for one button, not two).
Removed: the `deleteThread` storage helper, the `POST /comms/threads/:id/delete` route, the frontend
Delete button + `deleteThreadMutation`, and the "Deleted" scope tab. The `deleted_at` COLUMNS stay
(additive, no migration) so any LEGACY soft-deleted row is still reachable + restorable. There are now
just TWO scopes: `active` and `archived`. `GET /comms/threads?scope=archived` (and legacy `?scope=deleted`,
kept as an alias) folds together `deleted_at IS NOT NULL OR archived_at IS NOT NULL OR termed>14d`.
`GET /comms/threads/:id` has NO lifecycle filter, so a hidden thread stays openable to view + restore.
Storage helpers now: `archiveThread`/`restoreThread`/`bulkArchiveUnmatched`/`mergeResolvedUnmatchedThreads`.

**Unmatched auto-hide is now EVERY contacts sync, not a one-off.** `syncCommsContacts()` runs, AFTER
`enrichThreadContacts()`: (1) `mergeResolvedUnmatchedThreads()` then (2)
`bulkArchiveUnmatched(null, "auto: unmatched")`. So ALL unmatched threads stay hidden by default and a
NEW inbound text auto-restores its thread (`refreshThreadSummary` clears both timestamps + one
`auto_restored` audit, only when actually hidden). The next sync re-hides it ONLY while it stays
unmatched — a thread that got linked/promoted to a tech is no longer unmatched, so it stays visible.
`bulkArchiveUnmatched` is idempotent (skips already-hidden rows) so it never fights a live reply.

**`mergeResolvedUnmatchedThreads()` — fold an old-number thread INTO the tech's thread.** enrich
PROMOTES an unmatched thread → `kind='tech'` only when the tech has NO thread yet; merge handles the
complementary case (tech thread already exists, e.g. tech texts from a new recognized number after
older texts came from an old one). It moves the unmatched thread's messages to the tech thread
**preserving each message's own `phone`/`phone_digits`** (the number it was actually sent to/from) and
only re-keys the message `ldap`; then deletes the emptied unmatched thread and recomputes the dst
thread's `last_message_*` + unread from its actual messages. The frontend
(`fleet-communications.tsx`) labels any message whose last-10 digits differ from the thread's current
number (`thread.phoneDigits || contact.phone`) with a phone chip, so merged old-number texts stay
attributed to the number they used.
**Why:** the operator wanted unmatched clutter always hidden yet every SMS/photo recoverable, a fresh
reply to resurface, and — once a number is recognized — its old texts folded into the tech's one thread
while still showing which number each old text used.
**How to apply:** merge + auto-archive are best-effort inside the sync (own try/catch, never fail the
sync); order matters — merge BEFORE archive so resolved threads leave the unmatched set first.

## Always send to the MOST RECENT phone (contacts is source of truth)

Two layers so a stale client-cached number can't win:
1. `resolveTarget` (outbound.ts) prefers `contact.phone` (roster/TPMS, daily-refreshed) over the
   caller-supplied `input.phone`; `input.phone` is used ONLY when there's no known contact number
   (unmatched / manual sends).
2. `processSendQueue` **re-resolves** the current phone via `getContactByLdap` at DRAIN time for any
   row with an ldap, because bulk + quiet-hours rows snapshot the number at ENQUEUE and can be
   hours/days stale by send time. The re-resolved digits also drive the opt-out check + unmatched-thread
   routing, not just the Twilio `to`.
**Why:** a tech who changes phones between enqueue and drain would otherwise be texted at the old number.
**How to apply:** any NEW send path must resolve the phone from the contact by LDAP; never trust a
phone passed from the client for a known tech.

## Cutover order

(1) publish with flag OFF, (2) create sync + queue Scheduled Deployments, (3) run one-off migrate,
(4) pilot as developer/admin, (5) point shared `FS_TWILIO_PHONE_NUMBER` webhooks at
`/api/fs/comms/webhooks/*`, (6) flip `comms_module_enabled` ON.

### Cutover pre-mortem addenda (non-obvious launch rules)

- **Grant `fleetCommunications` to EVERY role/user who works Reg/Decomm SMS BEFORE step 5 (repoint).**
  Comms inbound writes ONLY `fs_comms_*` (no dual-write back to `fs_reg/decomm_messages`), so once the
  shared number's inbound webhook is repointed, the legacy Registration/Decommissioning conversation
  panels stop receiving replies. A user lacking the permission gets a 404 on `/comms/config`, so their
  UI silently stays on the legacy (now-dead) inbox with NO error. Agent role default is `false`.
  **Why:** avoids a class of users with a silently dead SMS inbox at cutover.
- **Do steps 5 (repoint) + 6 (flag ON) in ONE atomic window, then immediately send a live test inbound
  SMS and confirm a delivery-status callback.** Between repoint and flag-ON, inbound is visible only to
  pilot (developer/admin) roles.
- **Each Scheduled Deployment needs its OWN env config** (they are separate processes): `run-comms-queue`
  needs `DATABASE_URL` + `FS_TWILIO_*`; delivery-status tracking needs `COMMS_PUBLIC_BASE_URL` (or
  `SAML_BASE_URL`) so `statusCallback()` resolves a public URL — if absent, sends still go out but
  delivery tracking silently vanishes. Flipping the flag ON before the queue deployment exists means
  quiet-hours/bulk sends drain only while an instance is warm (autoscale-to-zero overnight delays them).
- **Run the contacts sync BEFORE the one-off migrate** so backfilled threads resolve to named techs
  instead of all-`unmatched` (enrich fixes it on the next sync, but day-one inbox looks broken otherwise).
- **Inbound webhook ACKs 200 (TwiML) BEFORE the async `handleInbound`** — a DB failure during processing
  loses that text permanently (Twilio won't retry). Confirm the "schema ensured" boot log before
  repointing, and monitor the inbound async-error log line for 48h post-cutover.

## Employment status display (single-letter flag)
- `fs_comms_contacts.empl_status` holds the LAST roster value (A/L/P/S) and is NOT cleared on tombstone — the sync only flips `active=false`. A terminated tech usually still reads 'A'.
- **Rule:** never surface `empl_status` raw for possibly-inactive contacts. Derive the display letter via `effectiveEmplStatus()` (server/fleet-comms/storage.ts): `active=false` → 'T', else the stored letter. Threads list/detail use it; the picker route is safe only because it hard-filters `active=true`.
- **Why:** raw reads rendered ex-employees with a green "Active" badge in the inbox.
