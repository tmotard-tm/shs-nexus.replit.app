/**
 * Fleet Scope wrapper for the Tech Schedules lookup.
 *
 * The actual page lives in the VRM module and is intentionally reused here so
 * fleet staff get the same technician / district / paste-a-list lookup without
 * entering Vehicle Rental Management. The API behind it
 * (`/api/vrm/tech-schedule/*`) is session-gated only — any logged-in Nexus
 * user can call it — so no extra access plumbing is needed on this side.
 *
 * The VRM page styles itself with its own `colors` / `fonts` constants and
 * renders a bare content column (its shell normally provides padding and a
 * background), so this wrapper supplies those two things and nothing else.
 */
import VrmTechSchedules from "@/pages/vehicle-rental-management/pages/TechSchedules";
import { colors } from "@/pages/vehicle-rental-management/lib/constants";

export default function TechSchedules() {
  return (
    <div style={{ minHeight: "100%", background: colors.background, padding: "20px 24px 32px" }}>
      <VrmTechSchedules />
    </div>
  );
}
