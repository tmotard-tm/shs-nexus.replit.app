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
  ChevronRight, Sparkles, Radio,
} from "lucide-react";

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
};

const ODO_SOURCES = [
  { sys: "Holman",  val: "58,420 mi", at: "12m ago",  canonical: true },
  { sys: "AMS",     val: "58,200 mi", at: "4h ago" },
  { sys: "Samsara", val: "58,431 mi", at: "live" },
];

const PRINCIPLES = [
  { key: "review",   label: "Review",   icon: Eye,      tone: "#1A56DB", count: "14 fields", note: "2 mismatched" },
  { key: "update",   label: "Update",   icon: Pencil,   tone: "#B45309", count: "6 editable", note: "3 pinned · In Repair" },
  { key: "assign",   label: "Assign",   icon: UserPlus, tone: "#0D9668", count: "TPMS + Holman", note: "Aligned" },
  { key: "unassign", label: "Unassign", icon: UserX,    tone: "#DC2626", count: "Reason required", note: "—" },
] as const;

type PrincipleKey = typeof PRINCIPLES[number]["key"];

function Quadrant({
  p, active, onClick,
}: { p: typeof PRINCIPLES[number]; active: boolean; onClick: () => void }) {
  const Icon = p.icon;
  return (
    <button
      onClick={onClick}
      className="relative h-[140px] text-left p-4 transition-all overflow-hidden group"
      style={{
        background: active ? p.tone : "transparent",
        color: active ? "#fff" : "#0F1117",
      }}
    >
      <div className="flex items-start justify-between">
        <Icon className="w-5 h-5" style={{ opacity: active ? 1 : 0.6 }} />
        {active && <Sparkles className="w-3.5 h-3.5 opacity-80" />}
      </div>
      <div className="mt-6">
        <div
          className="font-['Playfair_Display'] text-2xl leading-none tracking-tight"
          style={{ fontWeight: 600 }}
        >
          {p.label}
        </div>
        <div className="text-[11px] mt-1.5" style={{ opacity: active ? 0.85 : 0.55 }}>
          {p.count}
        </div>
        <div className="text-[10px] mt-0.5 uppercase tracking-wider" style={{ opacity: active ? 0.7 : 0.4 }}>
          {p.note}
        </div>
      </div>
      <ChevronRight
        className="w-4 h-4 absolute bottom-3 right-3 transition-transform group-hover:translate-x-0.5"
        style={{ opacity: active ? 0.9 : 0.3 }}
      />
    </button>
  );
}

function Freshness({ src, at }: { src: string; at: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      <Radio className="w-2.5 h-2.5" />
      {src} · {at}
    </span>
  );
}

function MismatchPanel() {
  return (
    <div className="mt-2 border-l-2 pl-3" style={{ borderColor: "#B45309" }}>
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

function ReviewBody() {
  const rows = [
    { label: "Vehicle",     value: `${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`, src: "Holman", at: "12m ago" },
    { label: "VIN",         value: VEHICLE.vin, src: "AMS", at: "1d ago", mono: true },
    { label: "Plate",       value: VEHICLE.plate, src: "Holman", at: "12m ago" },
    { label: "Location",    value: VEHICLE.city, src: "Samsara GPS", at: "live" },
    { label: "Ownership",   value: VEHICLE.ownership, src: "AMS", at: "4h ago" },
    { label: "Assigned",    value: VEHICLE.tech, src: "TPMS · Holman · AMS", at: "all aligned" },
  ];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Odometer</Label>
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 inline-flex items-center gap-1"
            style={{ background: "#FFFBEB", color: "#B45309" }}
          >
            <AlertTriangle className="w-2.5 h-2.5" /> Mismatched
          </span>
        </div>
        <div
          className="font-['Playfair_Display'] text-3xl leading-none mt-1"
          style={{ fontWeight: 600 }}
        >
          58,420 <span className="text-base text-muted-foreground">mi</span>
        </div>
        <div className="mt-1"><Freshness src="Holman" at="12m ago" /></div>
        <MismatchPanel />
      </div>
      <div className="border-t border-border pt-3 space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[110px_1fr] gap-3 items-baseline">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{r.label}</div>
            <div>
              <div className={r.mono ? "font-mono text-xs" : "text-sm"}>{r.value}</div>
              <Freshness src={r.src} at={r.at} />
            </div>
          </div>
        ))}
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
      <details className="text-sm group">
        <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          More fields (Color · Branding · Interior · Truck Status · Storage Cost)
          <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
        </summary>
        <div className="mt-3 space-y-3 pl-3 border-l border-border">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Color</Label>
              <Input defaultValue="Oxford White" className="mt-1 h-8 rounded-none text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Branding</Label>
              <Input defaultValue="Sears Home Services" className="mt-1 h-8 rounded-none text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Interior</Label>
              <Input defaultValue="Charcoal Cloth" className="mt-1 h-8 rounded-none text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Truck Status</Label>
              <Input defaultValue="Active" className="mt-1 h-8 rounded-none text-xs" />
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function AssignBody() {
  return (
    <div className="space-y-5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        TPMS · Holman · AMS all assigned to the same tech.
      </div>
      <div className="space-y-3">
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">TPMS</div>
          <div className="font-mono text-sm mt-0.5">{VEHICLE.techTpms} · {VEHICLE.tech}</div>
          <Freshness src="TPMS" at="2m ago" />
        </div>
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holman</div>
          <div className="font-mono text-sm mt-0.5">{VEHICLE.techHolman} · {VEHICLE.tech}</div>
          <Freshness src="Holman" at="12m ago" />
        </div>
        <div className="border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">AMS</div>
          <div className="font-mono text-sm mt-0.5">{VEHICLE.techAms} · {VEHICLE.tech}</div>
          <Freshness src="AMS" at="4h ago" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button className="flex-1 rounded-none uppercase tracking-wider text-xs">
          Assign new tech
        </Button>
        <Button variant="outline" className="rounded-none uppercase tracking-wider text-xs">
          Resync
        </Button>
      </div>
    </div>
  );
}

function UnassignBody() {
  return (
    <div className="space-y-5">
      <div
        className="text-[10px] uppercase tracking-wider px-2 py-1 inline-flex items-center gap-1.5"
        style={{ background: "#FEE2E2", color: "#991B1B" }}
      >
        <AlertTriangle className="w-3 h-3" />
        Reason is required to unassign
      </div>
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
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Add a note (optional)
        </Label>
        <Input placeholder="Context for ops review…" className="mt-1 h-10 rounded-none text-sm" />
      </div>
      <Button
        disabled
        variant="destructive"
        className="w-full rounded-none uppercase tracking-wider text-xs"
      >
        Unassign {VEHICLE.tech}
      </Button>
      <div className="text-[10px] text-muted-foreground">
        Disabled until a reason is selected. Unassign clears TPMS, Holman, and AMS atomically.
      </div>
    </div>
  );
}

export function Variant10() {
  const [active, setActive] = useState<PrincipleKey>("update");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="w-[540px]">
        {/* Editorial header */}
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
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {VEHICLE.city}
            </span>
            <span>·</span>
            <span>{VEHICLE.ownership}</span>
            <span>·</span>
            <span style={{ color: "#991B1B" }} className="inline-flex items-center gap-1">
              <Wrench className="w-3 h-3" /> {VEHICLE.status}
            </span>
          </div>
        </div>

        {/* Principle dial — 2x2 quadrant */}
        <div className="grid grid-cols-2 border-b border-border" style={{ background: "#F7F8FA" }}>
          {PRINCIPLES.map((p, i) => (
            <div
              key={p.key}
              className={
                "border-border " +
                (i % 2 === 0 ? "border-r " : "") +
                (i < 2 ? "border-b" : "")
              }
            >
              <Quadrant p={p} active={active === p.key} onClick={() => setActive(p.key)} />
            </div>
          ))}
        </div>

        {/* Active region content */}
        <div className="px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <div
              className="font-['Playfair_Display'] text-2xl tracking-tight"
              style={{ fontWeight: 600 }}
            >
              {PRINCIPLES.find((p) => p.key === active)?.label}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {PRINCIPLES.find((p) => p.key === active)?.note}
            </div>
          </div>
          {active === "review"   && <ReviewBody />}
          {active === "update"   && <UpdateBody />}
          {active === "assign"   && <AssignBody />}
          {active === "unassign" && <UnassignBody />}
        </div>

        <div className="px-6 pb-8 pt-4 border-t border-border text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          One vehicle · four canonical actions · sourced from Holman, AMS, TPMS, Samsara, Snowflake
        </div>
      </div>
    </div>
  );
}
