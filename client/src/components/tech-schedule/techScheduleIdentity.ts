export type TechScheduleIdentitySource = "techRacfid" | "racfId" | "ldapId";

export interface TechScheduleIdentity {
  ldap: string;
  source: TechScheduleIdentitySource;
}

/**
 * Schedule lookups are only safe when an ID originated in a named roster
 * identity field. Assignment labels, employee numbers, and display names are
 * deliberately not inferred as LDAPs.
 */
export function resolveTechScheduleIdentity(rosterCandidate: unknown): TechScheduleIdentity | null {
  if (!rosterCandidate || typeof rosterCandidate !== "object" || Array.isArray(rosterCandidate)) return null;

  const candidate = rosterCandidate as Record<string, unknown>;
  for (const source of ["techRacfid", "racfId", "ldapId"] as const) {
    const value = candidate[source];
    if (typeof value === "string" && value.trim()) {
      return { ldap: value.trim().toUpperCase(), source };
    }
  }
  return null;
}

export function findRosterScheduleIdentity(
  assignmentId: unknown,
  roster: readonly unknown[],
): TechScheduleIdentity | null {
  const normalizedAssignment =
    typeof assignmentId === "string" ? assignmentId.trim().toUpperCase() : "";
  if (!normalizedAssignment) return null;

  for (const entry of roster) {
    const identity = resolveTechScheduleIdentity(entry);
    if (identity?.ldap === normalizedAssignment) return identity;
  }
  return null;
}