---
name: Queue tech-SMS single lane
description: Any "text the tech" surface must reuse the pickup-text endpoints (Fleet Comms guards), never a raw sender.
---

# Queue tech-SMS single lane

**Rule:** every UI surface that texts a technician (Ops Queue "Text" button, Rental Operations pickup text, future ones) must go through the existing pickup-text endpoints (`GET/POST .../master/:caseKey/pickup-text`), which route through Master Fleet Comms.

**Why:** that lane already enforces opt-out, quiet hours, threading into the tech's comms conversation, and the identity chain (employee_id → all_techs.tech_racfid → fs_comms_contacts.ldap). A parallel raw Twilio send would bypass all of those guards, and the body is editable anyway so the same lane serves generic messages.

**How to apply:** new tech-messaging buttons should open the shared `TechTextModal` (VRM components) or hit the pickup-text endpoints directly; VRM route gating suffices — no separate comms RBAC needed. Tech phone display precedence: `fs_comms_contacts.phone` by LDAP (keep termed contacts — they may still hold rentals) → `fs_trucks.techPhone` fallback.
