import './_group.css';
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Eye, Pencil, UserPlus, UserX, AlertTriangle, MapPin, Wrench,
  ChevronRight, Radio, MessageSquarePlus, FileText, Boxes, History,
  User, Calendar, Building, AlertCircle,
} from "lucide-react";

const AMS_COMMENTS = [
  { who: "n.alvarez", when: "2026-04-30 14:22", body: "Caliber confirms transmission part ETA 5/7. Will reschedule pickup for 5/9." },
  { who: "ops.team",  when: "2026-04-26 09:10", body: "Rental extended through 5/9. Enterprise mid-size SUV." },
  { who: "n.alvarez", when: "2026-04-19 16:48", body: "Vehicle dropped at Caliber Collision Tampa. Lockbox 3, key #412." },
];

const VEHICLE = {
  id: "61385",
  year: 2023,
  make: "Ford",
  model: "Transit Connect",
  vin: "1FTBR1Y89PKA48217",
  plate: "JZQ-T84 · FL",
  city: "Tampa, FL 33602",
  ownership: "Holman Lease",
  tech: "Carlos Rivera",
  techHolman: "ENT-44102",
  techTpms: "T49281",
  techAms: "T49281",
  status: "In Repair · Awaiting parts",
  vendor: "Caliber Collision · Tampa",
  repairETA: "2026-05-08",
  estimateCost: "$1,840.50",
  repairReason: "Transmission service",
  daysInRepair: 6,
  repairStarted: "2026-04-19",
  lastUpdated: "2026-04-30 14:22",
  lastUpdatedBy: "n.alvarez",
};

const ODO_SOURCES = [
  { sys: "Holman",  val: "58,420 mi", at: "12m ago",  canonical: true },
  { sys: "AMS",     val: "58,200 mi", at: "4h ago" },
  { sys: "Samsara", val: "58,431 mi", at: "live" },
];

const PRINCIPLES = [
  { key: "review",   label: "Review",   icon: Eye,      tone: "#1A56DB", note: "14 fields · 2 mismatched" },
  { key: "update",   label: "Update",   icon: Pencil,   tone: "#B45309", note: "6 editable · 3 pinned" },
  { key: "assign",   label: "Assign",   icon: UserPlus, tone: "#0D9668", note: "TPMS + Holman aligned" },
  { key: "unassign", label: "Unassign", icon: UserX,    tone: "#DC2626", note: "Reason required" },
] as const;

type PrincipleKey = typeof PRINCIPLES[number]["key"];

function Freshness({ src, at }: { src: string; at: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      <Radio className="w-2.5 h-2.5" />
      {src} · {at}
    </span>
  );
}

function FactRow({
  icon: Icon, label, value, mono, src, at,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  src: string;
  at: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 mt-1 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-0.5 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</div>
        <Freshness src={src} at={at} />
      </div>
    </div>
  );
}

function MismatchPanel() {
  return (
    <div className="mt-3 border-l-2 pl-3" style={{ borderColor: "#B45309" }}>
      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#B45309" }}>
        3 systems disagree — pick a source or set your own
      </div>
      <div className="space-y-1.5">
        {ODO_SOURCES.map((s) => (
          <div key={s.sys} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono w-16 text-muted-foreground">{s.sys}</span>
              <span className="font-mono">{s.val}</span>
              <span className="text-[10px] text-muted-foreground">· {s.at}</span>
              {s.canonical && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-foreground text-background">
                  Source
                </span>
              )}
            </div>
            {!s.canonical && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] uppercase tracking-wider">
                Set as source
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Use a different value…"
            className="h-7 text-xs font-mono rounded-none"
          />
          <Button size="sm" variant="outline" className="h-7 px-3 rounded-none text-[10px] uppercase tracking-wider">
            Override
          </Button>
        </div>
      </div>
    </div>
  );
}

function UpdateBody() {
  return (
    <div className="space-y-5">
      <div
        className="text-[10px] uppercase tracking-wider px-2 py-1 inline-flex items-center gap-1.5"
        style={{ background: "#FEF2F2", color: "#991B1B" }}
      >
        <Wrench className="w-3 h-3" />
        Pinned because vehicle is In Repair · day {VEHICLE.daysInRepair}
      </div>
      <div className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Repair ETA</Label>
          <Input defaultValue={VEHICLE.repairETA} className="mt-1 h-9 rounded-none font-mono text-sm" />
          <Freshness src="AMS" at="4h ago" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Repair Vendor</Label>
          <Input defaultValue={VEHICLE.vendor} className="mt-1 h-9 rounded-none text-sm" />
          <Freshness src="AMS" at="4h ago" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Estimate Cost</Label>
          <Input defaultValue={VEHICLE.estimateCost} className="mt-1 h-9 rounded-none font-mono text-sm" />
          <Freshness src="AMS" at="4h ago" />
        </div>
      </div>
    </div>
  );
}

function AssignBody() {
  return (
    <div className="space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        TPMS · Holman · AMS all assigned to the same tech.
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { sys: "TPMS",   id: VEHICLE.techTpms,   at: "2m ago" },
          { sys: "Holman", id: VEHICLE.techHolman, at: "12m ago" },
          { sys: "AMS",    id: VEHICLE.techAms,    at: "4h ago" },
        ].map((s) => (
          <div key={s.sys} className="border border-border p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.sys}</div>
            <div className="font-mono text-xs mt-0.5">{s.id}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{s.at}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button className="flex-1 rounded-none uppercase tracking-wider text-xs">Assign new tech</Button>
        <Button variant="outline" className="rounded-none uppercase tracking-wider text-xs">Resync</Button>
      </div>
    </div>
  );
}

function UnassignBody() {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Reason for unassignment
        </Label>
        <Select>
          <SelectTrigger className="mt-1 h-10 rounded-none">
            <SelectValue placeholder="Choose a reason…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="resignation">Resignation</SelectItem>
            <SelectItem value="vehicle-repair">Vehicle Repair</SelectItem>
            <SelectItem value="termination">Termination</SelectItem>
            <SelectItem value="reassignment">Reassignment</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        disabled
        variant="destructive"
        className="w-full rounded-none uppercase tracking-wider text-xs"
      >
        Unassign {VEHICLE.tech}
      </Button>
    </div>
  );
}

function ReviewBody() {
  return (
    <div className="text-sm text-muted-foreground">
      All 14 canonical fields are shown above in <span className="text-foreground">The Facts</span>. Use this principle to inspect freshness, mismatched values, or per-system source — open <span className="text-foreground">Update</span> to change anything.
    </div>
  );
}

export function Variant10() {
  const [active, setActive] = useState<PrincipleKey>("update");
  const Icon = PRINCIPLES.find((p) => p.key === active)!.icon;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="w-[540px]">
        {/* Editorial header — Who/What/Where at a glance */}
        <div className="px-6 pt-7 pb-5 border-b border-border">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Vehicle Detail · canonical view
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className="font-['Playfair_Display'] text-6xl leading-none tracking-tight"
              style={{ fontWeight: 700 }}
            >
              #{VEHICLE.id}
            </span>
            <span className="font-['Playfair_Display'] text-xl text-muted-foreground italic">
              {VEHICLE.year} {VEHICLE.make} {VEHICLE.model}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {VEHICLE.city}
            </span>
            <span>·</span>
            <span>{VEHICLE.ownership}</span>
            <span>·</span>
            <span className="font-mono">{VEHICLE.plate}</span>
          </div>
        </div>

        {/* 1. THE FACTS — Who / What / When / Where / Why */}
        <div className="px-6 py-5">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-['Playfair_Display'] text-2xl tracking-tight" style={{ fontWeight: 600 }}>
              The Facts
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Who · What · When · Where · Why
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <FactRow icon={User}     label="Who · Assigned tech"   value={`${VEHICLE.tech} (${VEHICLE.techTpms})`} src="TPMS · Holman · AMS" at="all aligned" />
            <FactRow icon={Building} label="What · Asset"          value={`${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`} src="Holman" at="12m ago" />
            <FactRow icon={Calendar} label="When · Last touched"   value={VEHICLE.lastUpdated} src="AMS · n.alvarez" at="4h ago" />
            <FactRow icon={MapPin}   label="Where · Current"       value={VEHICLE.city} src="Samsara GPS" at="live" />
            <FactRow icon={Wrench}   label="Why · Current state"   value={`${VEHICLE.status} · day ${VEHICLE.daysInRepair}`} src="AMS" at="4h ago" />
            <FactRow icon={FileText} label="VIN"                   value={VEHICLE.vin} mono src="AMS" at="1d ago" />
          </div>
        </div>

        {/* 2. NEEDS ATTENTION — alerts, surfaced on top of actions */}
        <div className="px-6 py-5 border-t border-border" style={{ background: "#FFFBEB" }}>
          <div className="flex items-baseline justify-between mb-3">
            <div
              className="font-['Playfair_Display'] text-2xl tracking-tight inline-flex items-center gap-2"
              style={{ fontWeight: 600, color: "#92400E" }}
            >
              <AlertTriangle className="w-5 h-5" />
              Needs attention
            </div>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "#92400E" }}>
              3 items
            </span>
          </div>

          {/* Alert 1 — odometer mismatch */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">Odometer disagrees across 3 systems</div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FFFBEB", color: "#B45309" }}>
                Mismatched
              </span>
            </div>
            <div className="font-['Playfair_Display'] text-2xl leading-none mt-1.5" style={{ fontWeight: 600 }}>
              58,420 <span className="text-base text-muted-foreground">mi</span>
              <span className="text-xs text-muted-foreground ml-2">canonical · Holman</span>
            </div>
            <MismatchPanel />
          </div>

          {/* Alert 2 — repair ETA */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <Wrench className="w-3 h-3" style={{ color: "#991B1B" }} />
                In Repair · day {VEHICLE.daysInRepair} · ETA in 8 days
              </div>
              <Freshness src="AMS" at="4h ago" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {VEHICLE.repairReason} at {VEHICLE.vendor}. Rental open through 5/9.
            </div>
          </div>

          {/* Alert 3 — reg renewal */}
          <div className="bg-background border border-border p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" style={{ color: "#92400E" }} />
                Registration renews in 141 days (2026-09-30)
              </div>
              <Freshness src="AMS" at="1d ago" />
            </div>
          </div>
        </div>

        {/* 3. CONTEXT — Latest from AMS */}
        <div className="px-6 pt-5 pb-5 border-t border-border" style={{ background: "#FAFAF7" }}>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-['Playfair_Display'] text-base tracking-tight" style={{ fontWeight: 600 }}>
              Latest from AMS
            </div>
            <Freshness src="AMS" at="updated 4h ago" />
          </div>
          <div className="space-y-2.5">
            {AMS_COMMENTS.slice(0, 2).map((c, i) => (
              <div key={i} className="text-xs leading-relaxed">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="font-mono">{c.who}</span>
                  <span>·</span>
                  <span>{c.when}</span>
                </div>
                <div className="mt-0.5 text-foreground">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Show {AMS_COMMENTS.length - 2} earlier
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 4. ACTIONS — principle dial + active region body, last */}
        <div className="border-t-2 border-foreground">
          <div className="px-6 pt-5 pb-3">
            <div className="flex items-baseline justify-between">
              <div className="font-['Playfair_Display'] text-2xl tracking-tight" style={{ fontWeight: 600 }}>
                Actions
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Pick a principle
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 border-y border-border">
            {PRINCIPLES.map((p) => {
              const PIcon = p.icon;
              const isActive = active === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setActive(p.key)}
                  className="px-3 py-3 text-left transition-all border-r border-border last:border-r-0"
                  style={{
                    background: isActive ? p.tone : "transparent",
                    color: isActive ? "#fff" : "#0F1117",
                  }}
                >
                  <PIcon className="w-4 h-4 mb-1.5" style={{ opacity: isActive ? 1 : 0.6 }} />
                  <div className="font-['Playfair_Display'] text-base leading-none" style={{ fontWeight: 600 }}>
                    {p.label}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider mt-1" style={{ opacity: isActive ? 0.85 : 0.55 }}>
                    {p.note}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {PRINCIPLES.find((p) => p.key === active)?.label}
              </span>
            </div>
            {active === "review"   && <ReviewBody />}
            {active === "update"   && <UpdateBody />}
            {active === "assign"   && <AssignBody />}
            {active === "unassign" && <UnassignBody />}
          </div>
        </div>

        {/* References — secondary actions */}
        <div className="px-6 py-3 border-t border-border grid grid-cols-4 gap-2">
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <MessageSquarePlus className="w-3 h-3 mr-1.5" /> Add note
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <FileText className="w-3 h-3 mr-1.5" /> PO History
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <Boxes className="w-3 h-3 mr-1.5" /> Inventory
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <History className="w-3 h-3 mr-1.5" /> History
          </Button>
        </div>

        <div className="px-6 pb-8 pt-4 border-t border-border text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Facts · Alerts · Context · Actions
        </div>
      </div>
    </div>
  );
}
