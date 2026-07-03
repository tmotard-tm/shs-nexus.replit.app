// Shared TanStack Query keys used by more than one page.
//
// EXTERNAL_APPS_KEY is a SINGLE-element array on purpose. queryClient's default
// getQueryFn does `queryKey.join("/")`, so ['/api/external-apps'] fetches exactly
// '/api/external-apps'. A nested key like ['/api/external-apps','list'] would
// fetch '/api/external-apps/list' (404) AND break invalidation matching.
//
// Both the dashboard App Launcher dock (reads it) and the admin CRUD page
// (invalidates it on every mutation) import THIS constant so they can never
// drift. queryClient defaults are staleTime Infinity + refetchOnWindowFocus
// false, so a mismatched key would leave the dock permanently stale.
export const EXTERNAL_APPS_KEY = ['/api/external-apps'] as const;
