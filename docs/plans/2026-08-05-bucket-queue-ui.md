# Plan C — Bucket Queue UI (VRM authoritative, FS mirror, Action Tracker retirement)

**Spec:** `docs/specs/2026-08-05-persona-bucket-queue-design.md` §9, §11
**Depends on:** Plan B deployed shape (`buckets`, `owner`, `classifications`, `dismissedToday`, `contextChips`, `vocabulary.classifications` on the queue payload; `queue/owner` + `queue/dismiss` endpoints). Land in the same release as Plan B (B6 removes scraper endpoints the current UI still fetches).
**Goal:** OpsQueue becomes bucket-first with server-backed dismiss/reassign; FS Today's Queue mirrors it read-only; Action Tracker page retired; all client scraper fetches and both localStorage done-mechanisms deleted.
**Verification:** typecheck workflow ≤ 213 baseline; `Start application` restart + Screenshot of `/vehicle-rental-management` OpsQueue and `/fleet-scope/queue`; greps prove no scraper/localStorage/ActionTracker stragglers.

---

## Task C1 — OpsQueue bucket-first rework

**Files:** `client/src/pages/vehicle-rental-management/pages/OpsQueue.tsx`

1. **Types:** extend `QueueItem` (line ~31) with the Plan B additive fields; add `Bucket` + `vocabulary.classifications` to `QueueResponse`. Delete `STATE_TO_REGION` (~73) and `REGION_OPTIONS` (~90) — region now comes from `item.region` (server). Keep `STEP_COLORS` for the Everyone view.
2. **Delete localStorage done:** remove the `vrm-ops-queue-done-*` state (~149–156), `doneSet`, and its checkbox handlers. Done semantics now: advance workbook status (existing `POST /api/vrm/rental-operations/workbook/:caseKey` mutation, vocabulary from `GET workbook/statuses`) or dismiss-for-today.
3. **Bucket bar** (new component in the same file, above the list):

```tsx
function BucketBar({ buckets, active, onPick }: {
  buckets: Array<{ owner: string; open: number; dueToday: number; overdue: number; needsRouting: number }>;
  active: string | null; onPick: (owner: string | null) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, margin: "12px 0" }}>
      <button data-testid="bucket-everyone" onClick={() => onPick(null)}
        style={{ ...cardStyle, outline: active === null ? `2px solid ${colors.accent}` : "none" }}>
        <div style={{ fontWeight: 700 }}>Everyone</div>
        <div style={{ fontSize: 11, color: colors.inkMuted }}>{buckets.reduce((n, b) => n + b.open, 0)} open</div>
      </button>
      {buckets.map((b) => (
        <button key={b.owner} data-testid={`bucket-${b.owner.replace(/\W+/g, "-").toLowerCase()}`}
          onClick={() => onPick(b.owner)}
          style={{ ...cardStyle, outline: active === b.owner ? `2px solid ${colors.accent}` : "none" }}>
          <div style={{ fontWeight: 700 }}>{b.owner}</div>
          <div style={{ fontSize: 11, color: colors.inkMuted }}>
            {b.open} open{b.dueToday > 0 && <> · {b.dueToday} due</>}
            {b.overdue > 0 && <span style={{ color: "#b3261e", fontWeight: 700 }}> · {b.overdue} overdue</span>}
          </div>
          {b.needsRouting > 0 && <div style={{ fontSize: 10, color: "#b3261e" }}>⚠ {b.needsRouting} needs routing</div>}
        </button>
      ))}
    </div>
  );
}
```

   (`cardStyle`: reuse the page's existing card style object; `colors`/`fonts` already imported.) State: `const [activeBucket, setActiveBucket] = useState<string | null>(null)`.
4. **Bucket view** (activeBucket set): filter `items` to `item.owner === activeBucket && !item.dismissedToday`, group by `classifications[0].priority` (P1→P4 sections), sort inside by `businessDaysLate desc, slaDueDate asc, sortKey`. Row renders: classification pill (reuse the LUCA pill styling), SLA chip (`due {slaDueDate}` or red `overdue {businessDaysLate}d`), secondary classifications as small chips, contextChips (effStatus → label prefix "PO", openPoDate, shop + phone as `tel:` link, last LUCA outcome + date, portal age), links (existing case-detail route; Fleet Finder link on `declined_repair_source_replacement` items; keep the 3-nearest-spares `suggestions` rendering from the current step-1 rows). Dismissed items render struck-through at the bottom with `dismissed by {dismissedToday.by}`.
5. **Actions per row:** owner `<select>` of the 8 roster names + "Auto (Annex A)" → `POST /api/vrm/rental-operations/queue/owner { key: item.key, owner }`; "Dismiss today" / "Undo" → `POST .../queue/dismiss { key, itemKey, undo? }`; status advance `<select>` from API vocabulary → existing workbook POST. All three: `useMutation` + invalidate `["/api/vrm/rental-operations/queue"]`.
6. **Everyone view** (activeBucket null): keep the existing step grouping UNCHANGED except: region filter chips now filter on `item.region` (values `east|central|west`, labels from a small local `{east: "East…"}` map matching server labels); add a pinned red "Needs routing" strip listing `items.filter(i => i.needsRouting)` above step groups when nonempty.
7. Header count `{doneCount}/{totalActionable}` → `{dismissedCount} dismissed · {items.length} open`.

**Verify:** restart `Start application`; Screenshot `/vehicle-rental-management` → bucket bar with 8 named cards + Everyone, click-through works (verify via a second Screenshot with an owner picked if uncertain); reassign + dismiss round-trip visible after refetch; browser console clean of new errors. **Revert any dev-DB rows created while testing reassign/dismiss.**
**Commit:** `feat(vrm): bucket-first Ops Queue (owner cards, SLA chips, server-backed dismiss)`

## Task C2 — FS Today's Queue = read-only mirror

**Files:** `client/src/pages/fleet-scope/TodaysQueue.tsx`

1. Extend its `QueueItem`/`QueueResponse` types with the same additive fields; delete the local `STATE_TO_REGION` copy (line ~43) — region filter uses `item.region`.
2. Add the same `BucketBar` (copy the component; FS styling uses Tailwind — translate the inline styles to the page's existing card classes) and bucket view grouping, but **no actions**: no owner select, no dismiss button, no status advance. Dismissed items still render struck-through with who dismissed (visibility per spec §8). Keep `LucaStatusBadge` exactly as shipped.
3. Delete the `fs-queue-done-*` localStorage done-tracking (checkboxes go entirely; the page is a mirror).
4. Keep the shop phone display (manual calls); keep `TruckDetailPanel` opening.
5. `holmanStatus` pill label: render as `PO: {value}` now that the value is the effective PO status; delete any styling branch keyed on scraper-era strings (grep `ERROR` in the file).

**Verify:** Screenshot `/fleet-scope/queue` → same buckets/counts as VRM (mirror), no action controls, no checkboxes; `rg -n "localStorage" client/src/pages/fleet-scope/TodaysQueue.tsx client/src/pages/vehicle-rental-management/pages/OpsQueue.tsx` → zero.
**Commit:** `feat(fs): Today's Queue mirrors bucket queue read-only`

## Task C3 — Retire Action Tracker

**Files:** `client/src/pages/fleet-scope/ActionTracker.tsx` (delete), `client/src/pages/fleet-scope/FleetScopeLayout.tsx`, `client/src/components/layout/fleet-scope-sidebar.tsx` (~79), `client/src/components/fleet-scope/app-sidebar.tsx` (~79), `shared/page-registry.ts` (~494)

1. Remove both sidebar entries and the page-registry record for `/fleet-scope/action-tracker`.
2. In the FS route table (FleetScopeLayout or wherever the `<Route>` lives — `rg -n "ActionTracker" client/src`), replace the route with a redirect component to `/fleet-scope/queue` (wouter: `<Route path="/fleet-scope/action-tracker">{() => { const [, nav] = useLocation(); useEffect(() => nav("/fleet-scope/queue", { replace: true }), []); return null; }}</Route>` — match the router idiom used by the app).
3. Delete `ActionTracker.tsx`. `getNextAction` texts are superseded by classification labels/action text (server); the flag columns surface as `tagsHold`/context chips. `normalizeOwnerName` lives in `shared/fleet-scope-schema.ts` and has other callers — LEAVE it.
4. Grep `rg -n "action-tracker|ActionTracker" client/ shared/ server/` → only the redirect remains.

**Verify:** navigate to `/fleet-scope/action-tracker` in dev → lands on queue; sidebars show no Action Tracker; typecheck clean.
**Commit:** `chore(fs): retire Action Tracker into bucket queue (redirect kept)`

## Task C4 — Client scraper fetch removal

**Files:** every hit of `rg -n -i "scraper" client/src` (known: Dashboard scraper-status column fetch, TruckDetailPanel scraper-detail fetch; enumerate at implementation)

1. For each hit: remove the query + the UI column/section it feeds. Where the UI slot is worth keeping (Dashboard Holman column), point it at fields already present on the truck/queue payload (`contextChips.effStatus`) instead of a new fetch; otherwise delete the column.
2. Remove any styling/branches keyed on scraper vocabulary (`"ERROR"`, `last_scraped`, `primary_issue`, `recommendation`).
3. `rg -n -i "scraper" client/ server/ shared/` → zero hits repo-wide (B6 cleared server).

**Verify:** restart `Start application`; Screenshot Dashboard → no broken column, console shows no 404s to `/trucks/scraper-*`.
**Commit:** `chore(fs): remove scraper fetches from client (feed retired)`

## Task C5 — Final verification sweep

1. Typecheck workflow (`npm run check`) → ≤ 213 baseline, no new errors in touched files.
2. Restart all unit workflows (`annex-a-routing-unit`, `bucket-queue-unit`, `schedule-pickup-unit`, `vrm-guard-unit`, `comms-lib-unit`, `cache-alignment-unit`) → green.
3. Acceptance spot-checks (spec §12): corrected-state case (e.g. tech in OH) shows in Oscar's bucket; manual owner sticks regardless of state; unmatched state → Rob + needs-routing strip; 8206 tags item → Cheryl & Monica while region = tech state; dismiss visible cross-session (second browser/profile or curl the queue and read `dismissedToday`); FS mirror identical data, read-only.
4. Report the rollout note to the user: ~15% of escalations shift buckets (9 corrected states + PR); LIVHR agent emails still use old routing for those states until LIVHR adopts Annex A (spec §10 transitional caveat).

**Commit:** none (verification only).

---

## Self-review notes
- BucketBar is duplicated (inline-style VRM vs Tailwind FS) rather than shared — the two pages use different styling systems; a shared component would drag one system into the other page. Acceptable v1 duplication, both read the same server payload.
- Redirect instead of 404 for `/fleet-scope/action-tracker`: bookmarks/muscle memory exist; tombstone costs one route entry.
- Risk: OpsQueue is a 928-line file getting a substantial rework — keep the Everyone view code paths untouched where possible so regressions stay confined to the new bucket branch.
- Ordering: C4 must not land before B6's endpoints are gone? Reverse — B6 removes endpoints, C4 removes callers; landing both in one release avoids a window of 404 noise (harmless but ugly). Plans B and C ship together.
