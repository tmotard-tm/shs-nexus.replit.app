import { z } from "zod";

const nearbyTltResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    originTechnicianRecordSyncedAt: z.string().datetime(),
    matches: z.array(z.object({
      enterpriseId: z.string().min(1),
      displayName: z.string().min(1),
      jobTitle: z.enum([
        "Team Lead Technician",
        "HVAC Team Lead Technician",
      ]),
      distanceMiles: z.number().finite().nonnegative(),
      technicianRecordSyncedAt: z.string().datetime(),
    })).max(3),
    returnedCount: z.number().int().min(0).max(3),
    rankingBasis: z.literal("straight_line_distance"),
  }),
}).refine(
  (value) => value.data.returnedCount === value.data.matches.length,
  { message: "returnedCount must equal matches length" },
);

export type NearbyTltResponse = z.infer<typeof nearbyTltResponseSchema>;

export function parseNearbyTltResponse(input: unknown): NearbyTltResponse | null {
  const result = nearbyTltResponseSchema.safeParse(input);
  return result.success ? result.data : null;
}

export type NearbyTltUiState =
  | "loading"
  | "success"
  | "empty"
  | "missing-location"
  | "not-found"
  | "unavailable";

export function getNearbyTltUiState(input: {
  isLoading: boolean;
  matchCount?: number;
  errorCode?: string;
}): NearbyTltUiState {
  if (input.isLoading) return "loading";
  if (input.errorCode === "ORIGIN_LOCATION_UNAVAILABLE") return "missing-location";
  if (input.errorCode === "ORIGIN_NOT_FOUND") return "not-found";
  if (input.errorCode) return "unavailable";
  return (input.matchCount ?? 0) === 0 ? "empty" : "success";
}
