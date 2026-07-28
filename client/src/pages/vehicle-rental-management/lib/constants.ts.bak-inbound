import {
  TrendingUp,
  MessagesSquare,
  ClipboardList,
  Wrench,
  Gauge,
  MapPin,
  Settings2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

export const fonts = {
  syne: "'Syne', sans-serif",
  dmSans: "'DM Sans', sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};

export const colors = {
  background: "var(--vrm-background)",
  surface: "var(--vrm-surface)",
  ink: "var(--vrm-ink)",
  inkSoft: "var(--vrm-ink-soft)",
  inkMuted: "var(--vrm-ink-muted)",
  rule: "var(--vrm-rule)",
  accent: "var(--vrm-accent)",
  accentLight: "var(--vrm-accent-light)",
  green: "var(--vrm-green)",
  greenLight: "var(--vrm-green-light)",
  amber: "var(--vrm-amber)",
  amberLight: "var(--vrm-amber-light)",
  red: "var(--vrm-red)",
  redLight: "var(--vrm-red-light)",
  redDeep: "var(--vrm-red-deep)",
  redDeepLight: "var(--vrm-red-deep-light)",
  greenDeep: "var(--vrm-green-deep)",
  greenDeepLight: "var(--vrm-green-deep-light)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
  blueDeep: "var(--vrm-blue-deep)",
  blueDeepLight: "var(--vrm-blue-deep-light)",
  purple: "var(--vrm-purple)",
  purpleLight: "var(--vrm-purple-light)",
  purpleDeep: "var(--vrm-purple-deep)",
  purpleDeepLight: "var(--vrm-purple-deep-light)",
  sidebarBg: "var(--vrm-sidebar-bg)",
  sidebarActiveItemBg: "var(--vrm-sidebar-active-item-bg)",
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
  in_rental: { label: "In Rental", fg: colors.amber, bg: colors.amberLight },
  byov_enrolled: { label: "BYOV Enrolled", fg: colors.green, bg: colors.greenLight },
  exception_paired: { label: "Exception — Paired", fg: colors.accent, bg: colors.accentLight },
  exception_home_learning: { label: "Exception — Home Learning", fg: colors.accent, bg: colors.accentLight },
  escalated_carl: { label: "Escalated to Carl", fg: colors.red, bg: colors.redLight },
  epv_issued: { label: "EPV Issued", fg: "var(--vrm-red-deep)", bg: "var(--vrm-red-deep-light)" },
  resolved: { label: "Resolved", fg: "var(--vrm-green-deep)", bg: "var(--vrm-green-deep-light)" },
  exempt_scorecard: { label: "Exempt — Scorecard", fg: colors.inkSoft, bg: colors.surface },
  exempt_new_hire: { label: "Exempt — New Hire", fg: colors.inkSoft, bg: colors.surface },
  dca_hold: { label: "DCA Hold", fg: colors.amber, bg: colors.amberLight },
  cleared: { label: "Cleared", fg: colors.green, bg: colors.greenLight },
  wip: { label: "WIP", fg: colors.amber, bg: colors.amberLight },
  pending: { label: "Pending", fg: colors.amber, bg: colors.amberLight },
  hold: { label: "Hold", fg: colors.amber, bg: colors.amberLight },
  escalate: { label: "Escalate", fg: colors.red, bg: colors.redLight },
  // Gate 1 classifications
  underwater: { label: "Underwater", fg: colors.red, bg: colors.redLight },
  marginal: { label: "Marginal", fg: colors.amber, bg: colors.amberLight },
  profitable: { label: "Profitable", fg: colors.green, bg: colors.greenLight },
  // Evaluator recommendations
  approve: { label: "Approve", fg: colors.green, bg: colors.greenLight },
  deny: { label: "Deny", fg: colors.red, bg: colors.redLight },
};

export type GateClassification = "underwater" | "marginal" | "profitable";

export const gateClassColors: Record<
  GateClassification,
  { fg: string; bg: string }
> = {
  underwater: { fg: colors.red, bg: colors.redLight },
  marginal: { fg: colors.amber, bg: colors.amberLight },
  profitable: { fg: colors.green, bg: colors.greenLight },
};

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  wip?: boolean;
}

export const navItems: NavItem[] = [
  { label: "Executive Summary", path: "/vehicle-rental-management/executive-summary", icon: BarChart3 },
  { label: "New Rentals", path: "/vehicle-rental-management/new-rentals", icon: TrendingUp },
  { label: "New Rental - Full Log", path: "/vehicle-rental-management/new-rental-full-log", icon: ClipboardList },
  { label: "Rental Denial Tracker", path: "/vehicle-rental-management/rental-repair-tracker", icon: Wrench },
  { label: "Rental Operations", path: "/vehicle-rental-management/rental-operations", icon: Gauge },
  { label: "Cases by Region", path: "/vehicle-rental-management/cases-by-region", icon: MapPin },
  { label: "Rightsize Tracker", path: "/vehicle-rental-management/rightsize-tracker", icon: MessagesSquare },
  { label: "Settings", path: "/vehicle-rental-management/settings", icon: Settings2 },
];
