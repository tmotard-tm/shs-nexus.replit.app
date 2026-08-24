---
name: Queue tech-SMS single lane
description: Any "text the tech" surface must reuse the pickup-text endpoints (Fleet Comms guards), never a raw sender.
---

# Queue tech-SMS single lane

**Rule:** every UI surface that texts a technician (Ops Queue "Text" button, Rental Operations pickup text, future ones) must go through the existing pickup-text endpoints (`GET/POST .../master/:caseKey/pickup-text`), which route through Master Fleet Comms.

**Why:** that lane already enforces opt-out, quiet hours, threading into the tech's comms conversation, and the identity chain (employee_id → all_techs.tech_racfid → fs_comms_contacts.ldap). A parallel raw Twilio send would bypass all of those guards, and the body is editable anyway so the same lane serves generic messages.

**Second sanctioned lane (2026-08-23):** the VRM approval/denial dispatcher (`vrm_approval_oneway` sender, vrm_notifications queue) is deliberately separate from Fleet Comms, but it must carry the same TCPA floor itself: it defers SMS via `getNextAllowedSendTime(state)` (state = decision tech's `fs_comms_contacts.primary_state`) and parks held rows with a `not_before` stamp so they leave the FIFO drain batch until due. Lesson: any new outbound-SMS lane that skips Fleet Comms silently skips quiet hours too — audit for the gate explicitly; and never park rows by "leave queued and re-skip each tick", or held rows crowd out the batch window (starvation).

**How to apply:** new tech-messaging buttons should open the shared `TechTextModal` (VRM components) or hit the pickup-text endpoints directly; VRM route gating suffices — no separate comms RBAC needed. Phone at SEND time (verified 2026-08-16): `sendMessage`'s resolveTarget uses `fs_comms_contacts.phone` by LDAP; caller-supplied `input.phone` is used ONLY when the contact lacks a phone (`phoneLocked` pins are the exception). There is NO automatic fs_trucks fallback in the send path — the pickup lane hard-blocks with a `no_phone` warning instead. Any `fs_trucks.techPhone` use is display-only precedent. Also: the 24h (digits, body, category) dedupe is OPT-IN (`skipRecentDuplicate`), set only by the API surfaces — internal callers get no dedupe unless they pass it.
