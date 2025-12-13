import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useStatusBar } from "@/components/status-bar";
import { apiRequest } from "@/lib/queryClient";

export function useBackgroundSync() {
  const { user } = useAuth();
  const { showStatus, hideStatus } = useStatusBar();
  const syncTriggered = useRef(false);
  const lastSyncUser = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      syncTriggered.current = false;
      lastSyncUser.current = null;
      return;
    }

    if (syncTriggered.current && lastSyncUser.current === user.id) {
      return;
    }

    syncTriggered.current = true;
    lastSyncUser.current = user.id;

    const runBackgroundSync = async () => {
      const loadingId = showStatus("Syncing employee roster...", "loading", 0);

      try {
        const response = await apiRequest("POST", "/api/snowflake/sync/all-techs");
        const result = await response.json();

        hideStatus(loadingId);

        if (result.success) {
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          showStatus(
            `Employee roster updated at ${timeStr} (${result.recordsProcessed} employees)`,
            "success",
            5000
          );
        } else {
          showStatus("Employee roster sync completed", "success", 5000);
        }
      } catch (error: any) {
        hideStatus(loadingId);
        console.error("Background sync error:", error);
      }
    };

    const timeoutId = setTimeout(runBackgroundSync, 2000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [user, showStatus, hideStatus]);
}
