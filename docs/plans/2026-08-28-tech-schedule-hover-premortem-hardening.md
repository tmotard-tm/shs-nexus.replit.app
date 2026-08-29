# Technician Schedule Hover Premortem Hardening Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Make schedule hover cards identity-safe, privacy-safe, bounded, responsive, and keyboard-accessible before publish.

**Architecture:** Keep cards lazy and share React Query cache by normalized LDAP/date window. Resolve schedule identity only from known RACFID/LDAP roster fields, render typed safe errors, and make the returned schedule identity authoritative.

**Tech Stack:** React, TypeScript, TanStack Query, Radix HoverCard, Tailwind CSS, jsdom/Node tests.

**Verification:** `npx tsx --test tests/technician-schedule-hover-card.test.ts`, `npm run test:tech-shifts`, affected viewport checks, `npm run check` against the 224-error baseline, `npm run build`, and `git diff --check`.

## Global Constraints

- Closed cards must make zero schedule requests.
- Employee IDs, names, and arbitrary assignment strings are not schedule LDAPs.
- Raw upstream/client error bodies never render.
- Preserve fleet-card click suppression and existing schedule surfaces.
- Every production change follows a failing regression test.

---

### Task 1: Resolve canonical schedule identity

**Files:**
- Add: `client/src/components/tech-schedule/techScheduleIdentity.ts`
- Modify: `client/src/pages/fleet-management.tsx`
- Modify: `client/src/components/tech-schedule/TechnicianScheduleHoverCard.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Produces: `resolveTechScheduleIdentity(rosterCandidate): { ldap: string; source: "techRacfid" | "racfId" | "ldapId" } | null`.
- Consumes: actual Fleet Management roster entries and assignment candidates.

- [ ] Add pure resolver tests for RACFID/LDAP precedence, trim/uppercase, and rejection of employee ID/name/arbitrary values.
- [ ] Add component regressions proving unresolved assignments make no request and show “Schedule identity unavailable”; mismatched Holman/TPMS rows resolve independently.
- [ ] Run the focused suite and confirm current arbitrary-string behavior fails.
- [ ] Implement the resolver and derive canonical IDs from the existing roster map before rendering the hover card.
- [ ] Keep route normalization as a final guard; do not introduce regex-only identity guessing.
- [ ] Run the focused suite and `npm run test:tech-shifts`.
- [ ] Commit identity hardening.

### Task 2: Render only typed safe errors

**Files:**
- Modify: `client/src/components/tech-schedule/TechScheduleView.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Produces: a typed `ScheduleErrorKind` and fixed operator-safe copy.

- [ ] Add tests for 400/401/404/429/500/502 bodies containing HTML, hostnames, stack text, and fake secrets; assert none render.
- [ ] Preserve an actionable `CONFIG_MISSING` test based only on machine-readable code.
- [ ] Run the focused suite and confirm raw text leaks.
- [ ] Replace raw-message rendering with fixed copy for configuration, authentication, rate limit, invalid request, unavailable, and unknown cases.
- [ ] Run the focused suite and commit safe error handling.

### Task 3: Bound query refresh behavior

**Files:**
- Modify: `client/src/components/tech-schedule/TechScheduleView.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Consumes: normalized LDAP and 14-day date window.
- Produces: lazy cached lookup with 15-minute freshness and no automatic focus fan-out.

- [ ] Add tests proving closed cards fetch zero times, reopen within freshness reuses one request, case variants share a key, and focus does not refetch open cards.
- [ ] Run the focused suite and confirm the focus behavior fails.
- [ ] Set bounded 15-minute `staleTime`, disable window-focus refetch, and keep explicit retry single-flight while pending.
- [ ] Rerun the focused suite and commit query bounding.

### Task 4: Show authoritative returned identity and mismatch

**Files:**
- Modify: `client/src/components/tech-schedule/TechScheduleView.tsx`
- Modify: `client/src/components/tech-schedule/TechnicianScheduleHoverCard.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Consumes: fleet assignment label and returned schedule `techName`/roster name.
- Produces: returned identity as primary plus a non-color-only mismatch note when labels differ.

- [ ] Add differing-name and blank-returned-name regressions.
- [ ] Run the focused suite and confirm stale fleet label remains unqualified.
- [ ] Render returned roster identity as authority; show both labels when normalized names disagree and keep LDAP visible.
- [ ] Rerun and commit identity-label hardening.

### Task 5: Make the 14-day layout readable on narrow screens

**Files:**
- Modify: `client/src/components/tech-schedule/TechScheduleView.tsx`
- Modify: `client/src/components/tech-schedule/TechnicianScheduleHoverCard.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Produces: viewport-bounded popup with an inner horizontal-scroll grid whose day cells have a readable minimum width.

- [ ] Add structural tests for 320/375px requiring an overflow wrapper and minimum grid width, plus a desktop assertion.
- [ ] Run the focused suite and confirm the seven-column sliver layout fails.
- [ ] Add the bounded scroll wrapper/minimum width without forcing the popup beyond the viewport.
- [ ] Run focused tests and the relevant viewport script at narrow and desktop sizes.
- [ ] Commit responsive hardening.

### Task 6: Complete keyboard and assistive semantics

**Files:**
- Modify: `client/src/components/tech-schedule/TechnicianScheduleHoverCard.tsx`
- Modify: `tests/technician-schedule-hover-card.test.ts`

**Interfaces:**
- Produces: associated trigger/content IDs, correct expanded state, focus-away close, Escape close with focus return, and parent-click suppression.

- [ ] Add keyboard tests for focus-open, Tab-away close, Escape close/focus return, Enter/Space without fleet-card activation, and content click suppression.
- [ ] Assert accessible name, `aria-expanded`, `aria-controls`, and associated content ID.
- [ ] Run the focused suite and confirm missing behavior.
- [ ] Implement only the semantics Radix does not already provide; preserve pointer hover behavior.
- [ ] Rerun the focused suite and commit accessibility hardening.

### Task 7: Schedule verification and review

- [ ] Run the focused component suite and `npm run test:tech-shifts`.
- [ ] Run affected Fleet Management/Tech Schedule tests discovered by source search.
- [ ] Run viewport checks at phone, tablet, and desktop widths.
- [ ] Run `npm run check`, confirm no touched-file errors, then `npm run build`.
- [ ] Restore build-generated deployment history if changed and run `git diff --check`.
- [ ] Obtain independent code review and repair all Critical and Important findings.
