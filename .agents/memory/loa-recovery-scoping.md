---
name: LOA Recovery department scoping
description: How LOA Recovery queue items are scoped per department, and a label-mapping trap when guarding their endpoints.
---

# LOA Recovery queue — department scoping

LOA recovery creates one queue item per department (Fleet/Assets/Inventory) sharing a `workflowId`. Agent visibility rides entirely on existing department/queue access (the `/api/queues` listing filters by `getAccessibleQueueModules`), NOT on any dedicated permission flag. A `loaRecovery` permission flag once existed but was dead (never read) and was removed.

**Cross-queue leak rule:** the "This case also spans:" strip (`LoaDetailView` CrossQueueStrip) renders siblings from the `allItems` prop. That prop must be filtered to the user's accessible queue modules in `queue-management.tsx`, or an agent sees sibling LOA tasks from departments they can't access. Admin/Developer have all modules, so their full cross-queue view is preserved automatically.

**Label-mapping trap:** LOA lane items store `department` as full labels — `"FLEET"`, `"Assets Management"`, `"Inventory Control"` (see `server/loa-recovery-sync-service.ts`). `departmentToQueueModule()` in `server/routes.ts` only matches exact uppercase tokens (`FLEET`/`ASSETS`/`INVENTORY`/`NTAO`), so it returns `null` for `"Assets Management"` / `"Inventory Control"`.
**Why:** When adding the access guard to `PATCH /api/loa-recovery/:id/update`, using `departmentToQueueModule` directly would have 403'd every Assets/Inventory LOA edit for everyone.
**How to apply:** when mapping an LOA item's stored `department` to a queue module, use substring matching (`includes("ASSET")`, `includes("INVENTORY")`, `includes("FLEET")`), not exact-label mapping. The queue listing path doesn't hit this because module is derived from which queue store the item lives in, not from the department string.
