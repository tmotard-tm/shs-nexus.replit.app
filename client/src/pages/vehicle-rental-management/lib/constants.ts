import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  ClipboardCheck,
  ShieldAlert,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export const fonts = {
  syne: "'Syne', sans-serif",
  dmSans: "'DM Sans', sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};

export const colors = {
  background: "#FFFFFF",
  surface: "#F7F8FA",
  ink: "#0F1117",
  inkSoft: "#3D4152",
  inkMuted: "#8891A4",
  rule: "#E8EAEF",
  accent: "#1A56DB",
  accentLight: "#EFF4FF",
  green: "#0D9668",
  greenLight: "#ECFDF5",
  amber: "#B45309",
  amberLight: "#FFFBEB",
  red: "#DC2626",
  redLight: "#FEF2F2",
  sidebarBg: "#0F1117",
  sidebarActiveItemBg: "rgba(255,255,255,0.063)",
};

export type TechStatus =
  | "in_rental"
  | "byov_enrolled"
  | "exception_paired"
  | "exception_home_learning"
  | "escalated_carl"
  | "epv_issued"
  | "resolved"
  | "exempt_scorecard"
  | "exempt_new_hire";

export type DCAOutcome = "pending" | "cleared" | "hold" | "escalate";

export const statusConfig: Record<
  string,
  { label: string; fg: string; bg: string }
> = {
  in_rental: { label: "In Rental", fg: "#B45309", bg: "#FFFBEB" },
  byov_enrolled: { label: "BYOV Enrolled", fg: "#0D9668", bg: "#ECFDF5" },
  exception_paired: { label: "Exception — Paired", fg: "#1A56DB", bg: "#EFF4FF" },
  exception_home_learning: { label: "Exception — Home Learning", fg: "#1A56DB", bg: "#EFF4FF" },
  escalated_carl: { label: "Escalated to Carl", fg: "#DC2626", bg: "#FEF2F2" },
  epv_issued: { label: "EPV Issued", fg: "#991B1B", bg: "#FEE2E2" },
  resolved: { label: "Resolved", fg: "#065F46", bg: "#D1FAE5" },
  exempt_scorecard: { label: "Exempt — Scorecard", fg: "#3D4152", bg: "#F7F8FA" },
  exempt_new_hire: { label: "Exempt — New Hire", fg: "#3D4152", bg: "#F7F8FA" },
  dca_hold: { label: "DCA Hold", fg: "#B45309", bg: "#FFFBEB" },
  cleared: { label: "Cleared", fg: "#0D9668", bg: "#ECFDF5" },
  wip: { label: "WIP", fg: "#B45309", bg: "#FFFBEB" },
  pending: { label: "Pending", fg: "#B45309", bg: "#FFFBEB" },
  hold: { label: "Hold", fg: "#B45309", bg: "#FFFBEB" },
  escalate: { label: "Escalate", fg: "#DC2626", bg: "#FEF2F2" },
  // Gate 1 classifications
  underwater: { label: "Underwater", fg: "#DC2626", bg: "#FEF2F2" },
  marginal: { label: "Marginal", fg: "#B45309", bg: "#FFFBEB" },
  profitable: { label: "Profitable", fg: "#0D9668", bg: "#ECFDF5" },
};

export type GateClassification = "underwater" | "marginal" | "profitable";

export const gateClassColors: Record<
  GateClassification,
  { fg: string; bg: string }
> = {
  underwater: { fg: "#DC2626", bg: "#FEF2F2" },
  marginal: { fg: "#B45309", bg: "#FFFBEB" },
  profitable: { fg: "#0D9668", bg: "#ECFDF5" },
};

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  wip?: boolean;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", path: "/vehicle-rental-management", icon: LayoutDashboard },
  { label: "New Rentals", path: "/vehicle-rental-management/new-rentals", icon: TrendingUp },
  { label: "Active Rentals", path: "/vehicle-rental-management/tech-population", icon: Users },
  { label: "Escalations", path: "/vehicle-rental-management/escalations", icon: AlertTriangle },
  { label: "DCA Review", path: "/vehicle-rental-management/dca-review", icon: ClipboardCheck },
  { label: "Exception Cases", path: "/vehicle-rental-management/exception-cases", icon: ShieldAlert },
];
