import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useStatusBar } from "@/components/status-bar";

/**
 * Background sync hook - OPTIMIZED
 * 
 * Previously this hook triggered a full Snowflake sync on every login,
 * which took 25+ seconds and blocked the UI.
 * 
 * The server now handles syncing:
 * - On startup (development mode)
 * - Via scheduled deployment (production mode - see replit.md)
 * - Manual sync available via superadmin UI at /snowflake-integration
 * 
 * This hook now only checks if employee data is available and shows
 * an info message if data is missing or stale.
 */
export function useBackgroundSync() {
  const { user } = useAuth();
  const { showStatus } = useStatusBar();
  const hasChecked = useRef(false);
  const lastCheckedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      hasChecked.current = false;
      lastCheckedUserId.current = null;
      return;
    }

    // Reset check state when user changes (different login)
    if (lastCheckedUserId.current !== user.id) {
      hasChecked.current = false;
      lastCheckedUserId.current = user.id;
    }

    // Only run once per user session
    if (hasChecked.current) {
      return;
    }
    hasChecked.current = true;

    // Just check if data is available, don't trigger a sync
    const checkDataStatus = async () => {
      try {
        const response = await fetch("/api/all-techs?limit=1");
        
        // Handle non-OK responses explicitly
        if (!response.ok) {
          console.log(`Employee roster check returned ${response.status}`);
          // Only show warning for superadmins who can actually sync
          if (user.role === 'superadmin') {
            showStatus(
              "Employee roster not available. Sync from Snowflake Integration page.",
              "info",
              8000
            );
          }
          return;
        }
        
        const data = await response.json();
        
        // API returns array directly - check if it's empty
        // Handle both array response and potential object wrapper
        const records = Array.isArray(data) ? data : (data?.data || data?.techs || []);
        const isEmpty = !records || (Array.isArray(records) && records.length === 0);
        
        if (isEmpty) {
          // Only show warning for superadmins who can actually sync
          if (user.role === 'superadmin') {
            showStatus(
              "Employee roster not synced. Sync from Snowflake Integration page.",
              "info",
              8000
            );
          }
        }
      } catch (error) {
        // Network error - silently ignore, not critical for app function
        console.log("Background data check skipped due to network error:", error);
      }
    };

    // Quick check after 1 second
    const timeoutId = setTimeout(checkDataStatus, 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [user, showStatus]);
}
