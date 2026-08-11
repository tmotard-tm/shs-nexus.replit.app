/**
 * Registration/tags context derivation — the "whose move is it" classifier
 * behind the rental-card registration block (Tyler 2026-08-10).
 *
 * Pure tests: deriveRegistrationContext() only. The DB batch fetch is a thin
 * IN-list join over three tables; what must never regress silently is the
 * classification — a wrong "no tech action needed" line sends a real van to
 * sit for another month, and a wrong "tech action required" line is exactly
 * the wasted tech-chasing this feature exists to stop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRegistrationContext,
  canonReg,
  pickNewerTracking,
  mergeIdentity,
} from "../server/vrm/rental-operations/registration-context";

const NOW = new Date("2026-08-11T12:00:00Z");

test("AMS disposal (declined/auction) suppresses the block even at full trigger strength", () => {
  const base = {
    mainStatus: "Tags",
    fs: { registrationStickerValid: "Expired 3/31/25", awaitingTechDocuments: true },
    tracking: { holmanCaseStatus: "Rejected", holmanPendingTasks: "EMISSIONS INSPECTION - Please obtain", updatedAt: NOW },
    now: NOW,
  } as const;
  const live = deriveRegistrationContext(base as any);
  assert.equal(live.tagsNeeded, true, "sanity: without disposal this is a maxed-out live block");
  assert.equal(live.suppressedByDisposal, false);
  const gone = deriveRegistrationContext({ ...base, disposal: true } as any);
  assert.equal(gone.tagsNeeded, false, "disposal van: tag status is irrelevant, nothing renders");
  assert.equal(gone.suppressedByDisposal, true);
  assert.equal(gone.techAction.required, false, "a disposal van must NEVER demand tech action for tags");
  assert.match(gone.techAction.summary, /irrelevant/i);
});

test("disposal false/undefined leaves the badge gate untouched", () => {
  const off = deriveRegistrationContext({ mainStatus: "Tags", disposal: false, now: NOW });
  assert.equal(off.tagsNeeded, true);
  assert.equal(off.suppressedByDisposal, false);
  const undef = deriveRegistrationContext({ mainStatus: "Tags", now: NOW });
  assert.equal(undef.tagsNeeded, true);
  assert.equal(undef.suppressedByDisposal, false);
});

test("mergeIdentity: real values never clobbered; blanks normalize to null and fill later", () => {
  const base = { truck: "22350", plate: null, plateState: null, vin: null };
  const a = mergeIdentity(base, { plate: "1CH3635", plateState: "", vin: null });
  assert.equal(a.plate, "1CH3635");
  assert.equal(a.plateState, null, "blank string must normalize to null, not ''");
  // Second Holman row for the same van (dual number-column formats): fills the
  // gaps but must NOT replace a plate we already have.
  const b = mergeIdentity(a, { plate: "ZZ99999", plateState: "NC", vin: "1FTBW3XM6PKB39616" });
  assert.equal(b.plate, "1CH3635", "existing plate must NOT be clobbered by a later row");
  assert.equal(b.plateState, "NC");
  assert.equal(b.vin, "1FTBW3XM6PKB39616");
  const c = mergeIdentity(b, { plate: null, plateState: undefined, vin: "   " });
  assert.deepEqual(c, b, "nulls/whitespace never erase real values");
});

test("pickNewerTracking: last_scraped counts as recency; ties never decided by row order", () => {
  // Legacy dup: prev has newer updated_at=null but the candidate was scraped later.
  const prev = { holmanCaseStatus: "Sent to State", updatedAt: "2026-06-01T00:00:00Z", lastScraped: null } as any;
  const cand = { holmanCaseStatus: "Rejected", updatedAt: null, lastScraped: "2026-07-01T00:00:00Z" } as any;
  assert.equal(pickNewerTracking(prev, cand), cand, "newer last_scraped must beat older updated_at");
  assert.equal(pickNewerTracking(cand, prev), cand, "and win regardless of argument order");
  // Exact tie: prev kept unless the candidate carries more signal.
  const t1 = { holmanCaseStatus: null, updatedAt: "2026-07-01T00:00:00Z" } as any;
  const t2 = { holmanCaseStatus: "Rejected", updatedAt: "2026-07-01T00:00:00Z" } as any;
  assert.equal(pickNewerTracking(t1, t2), t2, "tie: case-status row wins over empty row");
  assert.equal(pickNewerTracking(t2, t1), t2, "tie: prev with case status is kept");
});

test("canonReg strips padding and non-digits", () => {
  assert.equal(canonReg("061309"), "61309");
  assert.equal(canonReg(" 61309 "), "61309");
  assert.equal(canonReg("T-061309"), "61309");
  assert.equal(canonReg(null), "");
});

test("61309 shape: rejected Holman case with EMISSIONS note → van/tech move, stale data flagged", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Tags",
    fs: { registrationStickerValid: "Expired" },
    tracking: {
      holmanCaseStatus: "Rejected",
      holmanPendingTasks:
        "EMISSIONS - Please have emissions completed and advise once it has been done for the renewal to be processed.",
      updatedAt: "2026-04-10T15:00:00Z",
    },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, true);
  assert.match(ctx.techAction.summary, /van itself/i);
  assert.equal(ctx.holmanCaseStatus, "Rejected");
  assert.match(ctx.blockerNote!, /EMISSIONS/);
  assert.equal(ctx.stale, true, "April data in August must be flagged stale");
  assert.equal(ctx.asOf, "2026-04-10T15:00:00.000Z");
});

test("awaiting tech documents beats everything → tech must send documents", () => {
  const ctx = deriveRegistrationContext({
    fs: { awaitingTechDocuments: true },
    tracking: { holmanPendingTasks: "EMISSIONS - complete emissions" },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, true);
  assert.match(ctx.techAction.summary, /documents/i);
});

test("tags mailed to tech → confirm they arrived and are on the van", () => {
  const ctx = deriveRegistrationContext({ fs: { tagsSentToTech: true }, now: NOW });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, true);
  assert.match(ctx.techAction.summary, /arrived|on the van/i);
});

test('sticker "Contacted tech" → follow up with the tech', () => {
  const ctx = deriveRegistrationContext({
    fs: { registrationStickerValid: "Contacted tech" },
    tracking: { currentStep: "Prerequisites" },
    now: NOW,
  });
  assert.equal(ctx.techAction.required, true);
  assert.match(ctx.techAction.summary, /tech's reply|follow up/i);
});

test("tags in office → office must mail them; do NOT chase the tech", () => {
  const ctx = deriveRegistrationContext({ fs: { tagsInOffice: true }, now: NOW });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, false);
  assert.match(ctx.techAction.summary, /office/i);
});

test("renewal sent to state on a Tags case → nothing for the tech", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Tags",
    tracking: { currentStep: "Sent to State", updatedAt: NOW },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, false);
  assert.match(ctx.techAction.summary, /state/i);
  assert.equal(ctx.stale, false);
});

test("routine in-flight renewal (no blocker, good sticker, not a Tags case) → NO badge", () => {
  for (const cs of ["Sent to State", "Preparing Paperwork", "Pending Pre-Req"]) {
    const ctx = deriveRegistrationContext({
      mainStatus: "Scheduling",
      tracking: { holmanCaseStatus: cs, updatedAt: NOW },
      now: NOW,
    });
    assert.equal(ctx.tagsNeeded, false, `"${cs}" alone must not badge the card`);
  }
});

test("rejected renewal badges even off a Tags case; blocker note badges too", () => {
  const rej = deriveRegistrationContext({
    mainStatus: "Scheduling",
    tracking: { holmanCaseStatus: "Rejected", updatedAt: NOW },
    now: NOW,
  });
  assert.equal(rej.tagsNeeded, true);
  const note = deriveRegistrationContext({
    mainStatus: "Scheduling",
    tracking: { holmanCaseStatus: "Pending Pre-Req", holmanPendingTasks: "EMISSIONS INSPECTION - Please obtain", updatedAt: NOW },
    now: NOW,
  });
  assert.equal(note.tagsNeeded, true);
  assert.equal(note.techAction.required, true);
});

test("non-van Holman blocker (office paperwork) → no tech action", () => {
  const ctx = deriveRegistrationContext({
    tracking: {
      holmanCaseStatus: "Pending",
      holmanPendingTasks: "PROOF OF INSURANCE - upload current certificate",
      updatedAt: NOW,
    },
    now: NOW,
  });
  assert.equal(ctx.techAction.required, false);
  assert.match(ctx.techAction.summary, /holman|office/i);
});

test('status "Tags" with zero data still renders (default line, undated → stale)', () => {
  const ctx = deriveRegistrationContext({ mainStatus: "Tags", now: NOW });
  assert.equal(ctx.tagsNeeded, true);
  assert.equal(ctx.techAction.required, false);
  assert.equal(ctx.asOf, null);
  assert.equal(ctx.stale, true);
});

test("clean truck: valid sticker, no signals → tagsNeeded false (no block rendered)", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Repairing",
    fs: { registrationStickerValid: "Yes" },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, false);
});

test("completed renewal step + closed case → not treated as live tag work", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Repairing",
    tracking: { currentStep: "Complete", holmanCaseStatus: "Closed", updatedAt: NOW },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, false);
});

test("renewal date: tracking wins, Holman feed fills the gap", () => {
  const a = deriveRegistrationContext({
    tracking: { renewalDate: "03/31/2027", currentStep: "New" },
    holmanRenewalDate: "5/31/2025",
    now: NOW,
  });
  assert.equal(a.renewalDate, "03/31/2027");
  const b = deriveRegistrationContext({
    mainStatus: "Tags",
    holmanRenewalDate: "5/31/2025",
    now: NOW,
  });
  assert.equal(b.renewalDate, "5/31/2025");
});

test("asOf = newest of tracking update / scrape / fs last-update; fresh within 30 days", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Tags",
    fs: { registrationLastUpdate: "2026-07-20" },
    tracking: { updatedAt: "2026-06-01T00:00:00Z", lastScraped: "2026-08-01T09:00:00Z" },
    now: NOW,
  });
  assert.equal(ctx.asOf, "2026-08-01T09:00:00.000Z");
  assert.equal(ctx.stale, false);
});

test("expired sticker alone (no rental Tags status) still marks tag work live", () => {
  const ctx = deriveRegistrationContext({
    mainStatus: "Scheduling for pickup",
    fs: { registrationStickerValid: "Expired" },
    now: NOW,
  });
  assert.equal(ctx.tagsNeeded, true, "pickup must not be dispatched blind to a dead tag");
});
