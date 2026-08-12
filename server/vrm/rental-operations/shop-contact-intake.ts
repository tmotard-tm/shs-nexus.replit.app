/**
 * LUCA shop-contact intake — the decision core behind
 * POST /api/vrm/rental-operations/luca/shop-contact.
 *
 * Why this exists (Tyler 2026-08-12): LUCA's pre-clock-in audit showed 24
 * rentals with no dialable shop phone. VRM already ships shop name + phone to
 * LUCA on every luca-rental-list pull, but numbers LUCA resolves on its side
 * (resolve_shop_contact) had NOWHERE to land in VRM — the two systems could
 * only drift further apart. This intake closes the loop: LUCA pushes a
 * resolved contact, VRM stores it under the SAME lock/precedence semantics an
 * operator edit gets, and the next feed pull returns it — synced both ways.
 *
 * Guard rails (all deliberate, mirroring the operator routes):
 *  - ONE phone gate: cleanPhone — the same junk filter every VRM surface and
 *    the LUCA feed use. No second cleaner (see vrm-surface-alignment tests).
 *  - Wrong-vendor protection: the pushed shop NAME must vendor-match the
 *    current reconciled pick. A mismatch is a 409, never a silent overwrite —
 *    the portal's truck-level phone belonging to a different vendor is exactly
 *    the corruption the read side rejects, so the write side must too.
 *  - No pick at all (e.g. BYOV trucks with no repair PO): the pushed name +
 *    phone are stored together as an override-backed contact — that IS the
 *    "create the shop contact" case from LUCA's briefing.
 *  - An operator's manually locked number always wins: LUCA never overwrites
 *    a human. LUCA may correct its OWN earlier number (source='luca').
 *  - Locks stay episode-scoped: expireStaleShopPhoneLocks clears them once
 *    the rental leaves the board, same as manual edits.
 *
 * Pure function — no DB, no HTTP — so the whole decision table is unit-tested
 * (tests/vrm-shop-contact-intake.test.ts).
 */
import { cleanPhone, vendorKey } from "./read-repository";

export interface ShopContactProposal {
  /** Shop name as LUCA resolved it. Required — it is the vendor-match key. */
  shopName: string | null | undefined;
  /** Phone as LUCA resolved it (any format; cleaned here). */
  phone: string | null | undefined;
}

export interface ShopContactCurrent {
  /** Reconciled shop-of-record name for the truck, manual override already
   *  applied (loadQueuePoContext().shopName). null = no pick (no repair PO). */
  pickName: string | null;
  /** Stored portal-hist phone (raw column value; may be junk/legacy). */
  existingPhone: string | null;
  existingLocked: boolean;
  existingSource: string | null;
}

export type ShopContactDecision =
  | { action: "invalid_name"; reason: string }
  | { action: "invalid_phone"; reason: string }
  | { action: "unchanged"; phone: string }
  | { action: "kept_manual_lock"; phone: string | null }
  | { action: "vendor_mismatch"; pickName: string; proposedName: string }
  | { action: "apply"; phone: string }
  | { action: "apply_with_name"; phone: string; shopName: string };

export function evaluateShopContactUpdate(
  proposal: ShopContactProposal,
  current: ShopContactCurrent,
): ShopContactDecision {
  const name = String(proposal.shopName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { action: "invalid_name", reason: "shop_name required — it is the vendor-match key" };
  if (name.length > 160) return { action: "invalid_name", reason: "shop name too long (160 chars max)" };

  const phone = cleanPhone(proposal.phone);
  if (!phone) return { action: "invalid_phone", reason: "phone must clean to a real 10-digit US number (no repeated-digit fillers)" };

  // Idempotency first: re-pushing the number we already hold is a no-op even
  // when locked — LUCA retries must not 409.
  if (cleanPhone(current.existingPhone) === phone) return { action: "unchanged", phone };

  // A human typed and locked a number for THIS truck: LUCA never overwrites
  // it. LUCA's own earlier value (source='luca') is not a human — the agent
  // may correct itself.
  if (current.existingLocked && current.existingSource !== "luca") {
    return { action: "kept_manual_lock", phone: cleanPhone(current.existingPhone) };
  }

  if (current.pickName) {
    if (vendorKey(name) !== vendorKey(current.pickName)) {
      return { action: "vendor_mismatch", pickName: current.pickName, proposedName: name };
    }
    return { action: "apply", phone };
  }

  // No shop of record (no qualifying repair PO — BYOV trucks, brand-new
  // cases): store name + phone together so the contact exists at all.
  return { action: "apply_with_name", phone, shopName: name };
}
