---
name: Radix Select async-options prefill wipe
description: Radix Select 2.x bubble-input clears a controlled value set before its options have loaded
---

# Radix Select wipes a controlled value whose options haven't loaded yet

**The rule:** never set a Radix Select's controlled value before the options that contain it are rendered — the value will be silently reset to `""`.

**Why:** `SelectBubbleInput` (@radix-ui/react-select 2.3.7) mirrors the controlled value into a hidden native `<select>` and, on every value change, assigns `select.value` and dispatches a real `change` event whose handler calls `onValueChange(event.target.value)`. Native selects coerce an unmatched value to `""`, so if the matching `SelectItem` is not yet registered (options fetched async, e.g. cost-centers districts), the coerced `""` round-trips into app state and erases the value. Discovered when the Create Vehicle page's URL-prefilled `district` vanished: the prefill effect runs on mount, before the cost-centers query resolves. This is browser behavior, not a jsdom artifact — real users with a slow cost-centers response lose the prefilled district too.

**How to apply:**
- In component tests: seed the query cache (`queryClient.setQueryData`) for whatever feeds the options before rendering, so the option exists on first paint.
- In app code: hold async-optioned prefills until the options arrive (or re-apply after load); static-option selects (state, plate type) are immune.
