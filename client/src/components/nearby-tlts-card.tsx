import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, MapPin, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getNearbyTltUiState,
  parseNearbyTltResponse,
  type NearbyTltResponse,
} from "@/lib/nearby-tlts";

class NearbyTltRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NearbyTltRequestError";
  }
}

async function loadNearbyTlts(itemId: string): Promise<NearbyTltResponse> {
  const response = await fetch(
    `/api/assets-queue/${encodeURIComponent(itemId)}/nearby-tlts`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NearbyTltRequestError(
      response.status,
      body?.error?.code || "UNKNOWN_ERROR",
      body?.error?.message || "Nearby TLT service is unavailable",
    );
  }
  const parsed = parseNearbyTltResponse(body);
  if (!parsed) {
    throw new NearbyTltRequestError(
      response.status,
      "INVALID_RESPONSE",
      "Nearby TLT service returned an invalid response",
    );
  }
  return parsed;
}

function readableFreshness(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Freshness unavailable";
  return `CTR data synced ${formatDistanceToNow(date, { addSuffix: true })}`;
}

function StateMessage({
  icon = false,
  children,
}: {
  icon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
      {icon && <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function NearbyTltsCard({ itemId }: { itemId: string }) {
  const query = useQuery<NearbyTltResponse, NearbyTltRequestError>({
    queryKey: ["nearby-tlts", "assets", itemId],
    queryFn: () => loadNearbyTlts(itemId),
    retry: false,
    staleTime: Infinity,
    refetchInterval: false,
  });

  const state = getNearbyTltUiState({
    isLoading: query.isLoading,
    matchCount: query.data?.data.matches.length,
    errorCode: query.error?.code,
  });

  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm" aria-labelledby="nearby-tlts-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="nearby-tlts-heading" className="flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4" />
            Nearby TLTs
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Straight-line geographic distance based on CTR-stored technician coordinates.
            This does not indicate availability or capacity.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          aria-label="Refresh nearby TLTs"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {state === "loading" && (
        <div className="grid gap-2" aria-label="Loading nearby TLTs">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-20 w-full" />
          ))}
        </div>
      )}

      {state === "success" && (
        <ol className="grid gap-2">
          {query.data!.data.matches.map((match) => (
            <li key={match.enterpriseId} className="rounded-md border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{match.displayName}</p>
                  <p className="text-xs text-muted-foreground">{match.enterpriseId}</p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold">
                  {match.distanceMiles.toFixed(1)} mi
                </span>
              </div>
              <p className="mt-2 text-xs">{match.jobTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {readableFreshness(match.technicianRecordSyncedAt)}
              </p>
            </li>
          ))}
        </ol>
      )}

      {state === "empty" && (
        <StateMessage>No eligible active TLTs with usable CTR coordinates were found.</StateMessage>
      )}
      {state === "missing-location" && (
        <StateMessage icon>
          CTR does not have usable coordinates for this technician, so proximity cannot be calculated.
        </StateMessage>
      )}
      {state === "not-found" && (
        <StateMessage icon>
          This technician was not found in the current CTR technician records.
        </StateMessage>
      )}
      {state === "unavailable" && (
        <StateMessage icon>
          Nearby TLTs are temporarily unavailable. Use Refresh to try again.
        </StateMessage>
      )}
    </section>
  );
}
