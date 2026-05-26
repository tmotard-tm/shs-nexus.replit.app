import type { AutomationDetail, OutreachEvent } from "@shared/schema";

export const RECOVERY_OUTREACH_TEMPLATES = [
  "tool-recovery-outreach-pre",
  "tool-recovery-outreach-warm",
  "tool-recovery-outreach-late",
  "tool-recovery-outreach-cold",
] as const;

const LANE_LABELS: Record<string, string> = {
  "tool-recovery-outreach-pre": "PRE — Proactive",
  "tool-recovery-outreach-warm": "WARM — Prompt",
  "tool-recovery-outreach-late": "LATE — Urgent",
  "tool-recovery-outreach-cold": "COLD — Final Notice",
};

const LANE_SHORT: Record<string, string> = {
  "tool-recovery-outreach-pre": "PRE",
  "tool-recovery-outreach-warm": "WARM",
  "tool-recovery-outreach-late": "LATE",
  "tool-recovery-outreach-cold": "COLD",
};

export type RecoveryOutreachKind = "sent" | "simulated" | "failed" | "blocked";

export interface LatestRecoveryOutreach {
  event: OutreachEvent;
  laneLabel: string;
  laneShort: string;
  status: RecoveryOutreachKind;
  sentAt: Date;
}

// The current backend stores a single shared outreach log per queue item that
// applies to all three email-driven tasks (Tools Return, iPhone Return, Create
// UPS Shipping Label). `taskKey` is accepted so callers can request the latest
// outreach per task; if backend later splits by task, filter here.
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
  switch (latest.status) {
    case "sent":
      return `${latest.laneShort} email sent · ${rel}`;
    case "simulated":
      return `${latest.laneShort} email simulated · ${rel}`;
    case "failed":
      return `${latest.laneShort} email failed · ${rel}`;
    case "blocked":
      return `${latest.laneShort} email blocked · ${rel}`;
    default:
      return `${latest.laneShort} email · ${rel}`;
  }
}
