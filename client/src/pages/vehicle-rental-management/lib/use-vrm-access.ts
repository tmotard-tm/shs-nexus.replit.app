import { useQuery } from "@tanstack/react-query";
import { usePreviewRole } from "@/hooks/use-preview-role";

/**
 * What the current session may see inside Vehicle Rental Management.
 *
 * The allowlist lives ONLY on the server (HOLMAN_APPROVER_USERNAMES in
 * server/vrm/routes.ts) and the client asks for the answer. Shipping a second
 * copy of the names to the browser is how you end up with a nav item that
 * renders for someone the server will refuse — or worse, a page hidden in the UI
 * whose data is still served to anyone who types the URL.
 *
 * Fails CLOSED: while loading, and on any error, the restricted pages stay
 * hidden. A momentary flash of a page someone is not allowed to see is worse
 * than a momentary absence of one they are.
 */
export interface VrmAccess {
  username: string;
  /** may open the New Rentals page and read the PO queue */
  canSeeNewRentals: boolean;
  /** may authorise or decline a rental PO in Holman */
  canApproveHolman: boolean;
}

export function useVrmAccess(): {
  access: VrmAccess | null;
  loading: boolean;
  canSeeNewRentals: boolean;
  canApproveHolman: boolean;
} {
  // Developer preview-as-user must change the answer, otherwise the restricted
  // page renders under every previewed identity because the server only ever
  // sees the real developer session. Previewing a ROLE has no username, and the
  // allowlist is by username, so a role preview can never see the page.
  const { previewUser, previewRole } = usePreviewRole();
  const previewAs = previewUser?.username ?? (previewRole ? "__role_preview__" : "");
  const { data, isLoading } = useQuery<VrmAccess>({
    queryKey: ["/api/vrm/access", previewAs],
    queryFn: async () => {
      const url = previewAs ? `/api/vrm/access?as=${encodeURIComponent(previewAs)}` : "/api/vrm/access";
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    access: data ?? null,
    loading: isLoading,
    canSeeNewRentals: data?.canSeeNewRentals === true,
    canApproveHolman: data?.canApproveHolman === true,
  };
}
