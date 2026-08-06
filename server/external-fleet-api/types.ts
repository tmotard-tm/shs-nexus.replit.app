export const EXTERNAL_FLEET_API_VERSION = "1.0.0" as const;

export type FreshnessState = "fresh" | "stale" | "unknown" | "unavailable";
export type SourceLayer = "live" | "cached" | "extract" | "unknown";
export type ExternalFleetScope = "modules:read" | "profiles:read" | "search:read";

export type ExternalFleetModuleId =
  | "rental_ops.open_rentals"
  | "fleet_management.full_listing"
  | "fleet_scope.all_vehicles"
  | "fleet_scope.todays_queue"
  | "fleet_scope.rentals_dashboard"
  | "fleet_scope.tech_profitability"
  | "fleet_scope.purchase_orders"
  | "fleet_scope.spares"
  | "fleet_scope.park_my_fleet"
  | "fleet_scope.registration"
  | "fleet_scope.decommissioning"
  | "fleet_scope.fleet_cost"
  | "fleet_scope.executive_summary"
  | "fleet_scope.metrics_dashboard"
  | "fleet_scope.holman_research"
  | "fleet_scope.action_tracker"
  | "fleet_scope.procurement_history"
  | "fleet_scope.vehicle_search"
  | "fleet_scope.discrepancy_finder";

export interface Freshness {
  state: FreshnessState;
  observedAt: string | null;
  ageSeconds: number | null;
}

export interface ApiWarning {
  code: "SOURCE_UNAVAILABLE" | "SOURCE_STALE" | "AMBIGUOUS_MATCH" | "PARTIAL_DATA" | "CONTRACT_DISABLED";
  message: string;
}

export interface SourceObservation<T> {
  sourceLayer: SourceLayer;
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  value: T;
  normalizedValue?: T;
  freshness: Freshness;
}

export interface ExternalFleetEnvelope<T> {
  apiVersion: typeof EXTERNAL_FLEET_API_VERSION;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  freshness: Freshness;
  warnings: ApiWarning[];
  data: T;
}

export function createEnvelope<T>(args: Omit<ExternalFleetEnvelope<T>, "apiVersion" | "generatedAt">): ExternalFleetEnvelope<T> {
  return { apiVersion: EXTERNAL_FLEET_API_VERSION, generatedAt: new Date().toISOString(), ...args };
}
