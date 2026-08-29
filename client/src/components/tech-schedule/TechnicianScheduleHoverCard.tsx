import React, { useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { CalendarDays } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TechScheduleView, todayET } from "@/components/tech-schedule/TechScheduleView";
import { resolveTechScheduleIdentity } from "@/components/tech-schedule/techScheduleIdentity";
import { cn } from "@/lib/utils";

export interface TechnicianScheduleHoverCardProps {
  rosterCandidate: unknown;
  name: string;
  className?: string;
}

function stopCardEvent(event: MouseEvent | PointerEvent | KeyboardEvent) {
  event.stopPropagation();
}

/**
 * A technician-name schedule affordance for clickable vehicle cards.
 * The view is mounted only while open, so simply rendering a fleet page never
 * requests schedules. Identical LDAP/window URLs share React Query's cache.
 */
export function TechnicianScheduleHoverCard({
  rosterCandidate,
  name,
  className,
}: TechnicianScheduleHoverCardProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returningFocusRef = useRef(false);
  const contentId = useId();
  const identity = resolveTechScheduleIdentity(rosterCandidate);
  const today = todayET();

  if (!identity) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1 text-muted-foreground", className)}>
        <span className="truncate">{name}</span>
        <span className="sr-only">Schedule identity unavailable</span>
      </span>
    );
  }

  return (
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={250}
      closeDelay={180}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          ref={triggerRef}
          aria-label={`View 14-day schedule for ${name}`}
          aria-expanded={open}
          aria-controls={contentId}
          onFocus={() => {
            if (returningFocusRef.current) {
              returningFocusRef.current = false;
              return;
            }
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            stopCardEvent(event);
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
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
        id={contentId}
        className="w-[min(760px,calc(100vw-24px))] max-h-[min(620px,calc(100vh-24px))] overflow-auto p-4"
        onClick={stopCardEvent}
        onPointerDown={stopCardEvent}
        onKeyDown={stopCardEvent}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          returningFocusRef.current = true;
          setOpen(false);
          triggerRef.current?.focus();
        }}
        aria-label={`Schedule for ${name}`}
      >
        {open ? (
          <TechScheduleView
            ldap={identity.ldap}
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