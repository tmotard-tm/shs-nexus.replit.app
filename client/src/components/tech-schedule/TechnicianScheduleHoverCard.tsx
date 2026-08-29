import React, { useState, type MouseEvent, type PointerEvent } from "react";
import { CalendarDays } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TechScheduleView, todayET } from "@/components/tech-schedule/TechScheduleView";
import { cn } from "@/lib/utils";

export interface TechnicianScheduleHoverCardProps {
  ldap: string;
  name: string;
  className?: string;
}

function stopCardEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}

/**
 * A technician-name schedule affordance for clickable vehicle cards.
 * The view is mounted only while open, so simply rendering a fleet page never
 * requests schedules. Identical LDAP/window URLs share React Query's cache.
 */
export function TechnicianScheduleHoverCard({
  ldap,
  name,
  className,
}: TechnicianScheduleHoverCardProps) {
  const [open, setOpen] = useState(false);
  const normalizedLdap = ldap.trim().toUpperCase();
  const today = todayET();

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={180}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`View 14-day schedule for ${name}`}
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onClick={(event) => {
            stopCardEvent(event);
            setOpen(true);
          }}
          onPointerDown={stopCardEvent}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-left underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            className,
          )}
        >
          <span className="truncate">{name}</span>
          <CalendarDays className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(760px,calc(100vw-24px))] max-h-[min(620px,calc(100vh-24px))] overflow-auto p-4"
        onClick={stopCardEvent}
        onPointerDown={stopCardEvent}
        aria-label={`Schedule for ${name}`}
      >
        {open ? (
          <TechScheduleView
            ldap={normalizedLdap}
            name={name}
            startDate={today}
            weeks={2}
            exactStart
          />
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

export default TechnicianScheduleHoverCard;