import type { AutomationDetail, OutreachEvent } from "@shared/schema";

// Task #424: simplified to PRE (fleet/byov) and PAST (email/sms) outreaches.
export const RECOVERY_OUTREACH_TEMPLATES = [
  "recovery-pre-fleet",
  "recovery-pre-byov",
  "recovery-past-email",
  "recovery-past-sms",
] as const;

const LANE_LABELS: Record<string, string> = {
  "recovery-pre-fleet": "PRE — Fleet (Tool Audit)",
  "recovery-pre-byov": "PRE — BYOV/Rental (Return)",
  "recovery-past-email": "PAST — Return Everything (Email)",
  "recovery-past-sms": "PAST — Return Everything (SMS)",
};

const LANE_SHORT: Record<string, string> = {
  "recovery-pre-fleet": "PRE",
  "recovery-pre-byov": "PRE",
  "recovery-past-email": "PAST",
  "recovery-past-sms": "PAST",
};

export type RecoveryOutreachKind = "sent" | "simulated" | "failed" | "blocked";

export interface LatestRecoveryOutreach {
  event: OutreachEvent;
  laneLabel: string;
  laneShort: string;
  status: RecoveryOutreachKind;
  sentAt: Date;
  channel: "email" | "sms";
}

export function getLatestRecoveryOutreach(
  automationDetail?: AutomationDetail | null,
  _taskKey?: string,
): LatestRecoveryOutreach | null {
  const events = automationDetail?.outreach;
  if (!events || events.length === 0) return null;

  const matching = events.filter((e) =>
    (RECOVERY_OUTREACH_TEMPLATES as readonly string[]).includes(e.templateName),
  );
  if (matching.length === 0) return null;

  const latest = matching.reduce((acc, cur) => {
    const accT = new Date(acc.sentAt).getTime();
    const curT = new Date(cur.sentAt).getTime();
    return curT > accT ? cur : acc;
  });

  return {
    event: latest,
    laneLabel: LANE_LABELS[latest.templateName] || latest.templateName,
    laneShort: LANE_SHORT[latest.templateName] || latest.templateName,
    status: latest.status as RecoveryOutreachKind,
    sentAt: new Date(latest.sentAt),
    channel: (latest.channel as "email" | "sms") || "email",
  };
}

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr}y ago`;
}

export function buildRecoveryOutreachBadgeText(latest: LatestRecoveryOutreach): string {
  const rel = formatRelativeTime(latest.sentAt);
  const channelLabel = latest.channel === "sms" ? "SMS" : "email";
  switch (latest.status) {
    case "sent":
      return `${latest.laneShort} ${channelLabel} sent · ${rel}`;
    case "simulated":
      return `${latest.laneShort} ${channelLabel} simulated · ${rel}`;
    case "failed":
      return `${latest.laneShort} ${channelLabel} failed · ${rel}`;
    case "blocked":
      return `${latest.laneShort} ${channelLabel} blocked · ${rel}`;
    default:
      return `${latest.laneShort} ${channelLabel} · ${rel}`;
  }
}
