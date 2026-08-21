/**
 * "Dispatch LUCA call" — Fleet Scope surfaces trigger a LUCA dial for one
 * truck THROUGH the existing VRM Rental Operations dispatch path
 * (POST /api/vrm/rental-operations/master/:caseKey/call → luca-dispatch.ts →
 * LIVHR). Fleet Scope never dials anything itself: VRM resolves the effective
 * shop (incl. the declined/auction assigned-truck redirect) and LUCA's own
 * live-dial gates (30-min double-dial guard, TCPA window, LUCA_LIVE dry-run
 * flags, clocked-in checks) decide whether a real call goes out. The call's
 * outcome lands back on these surfaces later via the LUCA write-back worker.
 *
 * The server refuses non-callable cases (no verified shop phone / not on the
 * VRM board) with a clear message — that refusal is surfaced as-is, never
 * retried or worked around here.
 */
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Bot, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

/** Shape of luca-dispatch.ts results relayed by the VRM route. */
interface DispatchResult {
  ok?: boolean;
  dialed?: boolean;
  dryRun?: boolean;
  message?: string;
  shop?: string | null;
  notConfigured?: boolean;
  notDeployed?: boolean;
}

export function DispatchLucaCallButton({
  caseKey,
  truckNumber,
  shopName,
  className,
}: {
  /** VRM rental-case key (the 5-digit display truck number). */
  caseKey: string;
  truckNumber: string;
  /** Shop shown in the confirm prompt / toasts when known client-side. */
  shopName?: string | null;
  className?: string;
}) {
  const { toast } = useToast();

  const dispatch = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/vrm/rental-operations/master/${encodeURIComponent(caseKey)}/call`,
      );
      return (await res.json()) as { ok: boolean; result?: DispatchResult };
    },
    onSuccess: (data) => {
      const r = data?.result ?? {};
      const where = r.shop || shopName || "the shop on record";
      if (data?.ok === false || r.ok === false) {
        toast({
          title: "LUCA dispatch refused",
          description: r.message || `Case ${caseKey} is not callable right now.`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: r.dryRun
          ? "LUCA dispatch accepted (dry-run)"
          : r.dialed
            ? "LUCA is calling the shop"
            : "Handed to LUCA",
        description: r.dryRun
          ? `${where} — LUCA is in dry-run mode, so no live call was placed.${r.message ? ` ${r.message}` : ""}`
          : r.dialed
            ? `LUCA is dialing ${where} about truck ${truckNumber}. The outcome will land on this queue via the LUCA write-back.`
            : `Truck ${truckNumber} handed to LUCA (${where}). LUCA's own gates decide when it dials.${r.message ? ` ${r.message}` : ""}`,
      });
      // The server busts its queue cache on dispatch — refetch so the row
      // reflects the new "LUCA dispatched to …" state.
      queryClient.invalidateQueries({ queryKey: ["/api/fs/queue/today"] });
    },
    onError: (e: any) => {
      toast({
        title: "LUCA dispatch failed",
        description: e?.message || "Request failed — nothing was dialed.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={dispatch.isPending}
      data-testid={`dispatch-luca-${truckNumber}`}
      title={`Hand truck ${truckNumber} to LUCA to call ${shopName || "the shop on record"}. Routes through VRM Rental Operations — LUCA's own dedup and dial gates still apply.`}
      className={cn("h-7 gap-1.5 text-sm whitespace-nowrap", className)}
      onClick={(e) => {
        e.stopPropagation();
        if (dispatch.isPending) return;
        if (
          !window.confirm(
            `Dispatch LUCA to call the shop for truck ${truckNumber}${shopName ? ` (${shopName})` : ""}?\n\nLUCA's own gates (recent-call dedup, dry-run mode, calling window) still decide whether a live call goes out.`,
          )
        )
          return;
        dispatch.mutate();
      }}
    >
      {dispatch.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Bot className="h-3.5 w-3.5" />
      )}
      Dispatch LUCA call
    </Button>
  );
}
