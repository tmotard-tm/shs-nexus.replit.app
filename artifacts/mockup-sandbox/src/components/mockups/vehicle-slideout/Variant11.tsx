import './_group.css';
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Eye, Pencil, UserPlus, UserX, AlertTriangle, MapPin, Wrench,
  MessageSquarePlus, FileText, Boxes, History, User, Calendar,
  Building, AlertCircle, XCircle, Activity, Users, Hash, Palette, Car,
  Save, Undo2, Lock,
} from "lucide-react";

import {
  VEHICLE, HOLMAN_FACTS, WMS_PARTS_TRUCK, AMS_DOSSIER, AMS_COMMENTS,
  PRINCIPLES, Freshness, FactRow, MismatchPanel,
  ReviewBody, AssignBody, UnassignBody,
  AmsDossier, CrossSystemLedger,
} from "./Variant10";

type PrincipleKey = typeof PRINCIPLES[number]["key"];

// ────────────────────────────────────────────────────────────────────
// Editable variants of the fact rows. Used only when "Update" is active.
// ────────────────────────────────────────────────────────────────────
type IconType = ComponentType<{ className?: string }>;

function EditableFactRow({
  icon: Icon, label, value, onChange, dirty, src, at, placeholder,
}: {
  icon: IconType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  dirty: boolean;
  src: string;
  at: string;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={
          "rounded-none mt-1 h-8 text-sm font-['Playfair_Display'] " +
          (dirty
            ? "border-2 bg-[#FFFBEB]"
            : "border-dashed bg-background")
        }
        style={dirty ? { borderColor: "#B45309" } : undefined}
      />
      <div className="text-[10px] mt-1" style={{ color: dirty ? "#B45309" : undefined }}>
        {dirty ? "Editing · unsaved" : <Freshness src={src} at={at} />}
      </div>
    </div>
  );
}

function EditableSelectRow({
  icon: Icon, label, value, options, onChange, dirty,
}: {
  icon: IconType;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  dirty: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className={
            "rounded-none mt-1 h-8 text-sm font-['Playfair_Display'] " +
            (dirty ? "border-2 bg-[#FFFBEB]" : "border-dashed bg-background")
          }
          style={dirty ? { borderColor: "#B45309" } : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-[10px] mt-1" style={{ color: dirty ? "#B45309" : undefined }}>
        {dirty ? "Editing · unsaved" : <Freshness src="Nexus" at="3mo ago" />}
      </div>
    </div>
  );
}

function LockedFactRow({
  icon: Icon, label, value, mono, src, at,
}: {
  icon: IconType;
  label: string;
  value: string;
  mono?: boolean;
  src: string;
  at: string;
}) {
  return (
    <div className="opacity-70">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" />
        {label}
        <Lock className="w-2.5 h-2.5 ml-auto" />
      </div>
      <div
        className={
          "mt-1 text-sm leading-tight " +
          (mono ? "font-mono" : "font-['Playfair_Display']")
        }
      >
        {value}
      </div>
      <div className="text-[10px] mt-1">
        <Freshness src={`${src} · canonical`} at={at} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
const STATE_OPTIONS = [
  { value: "in_repair",   label: "In repair" },
  { value: "active",      label: "Active" },
  { value: "in_transit",  label: "In transit" },
  { value: "available",   label: "Available pool" },
  { value: "unassigned",  label: "Unassigned" },
];

export function Variant11() {
  const [active, setActive] = useState<PrincipleKey>("update");
  const Icon = PRINCIPLES.find((p) => p.key === active)!.icon;
  const editing = active === "update";

  const initial = useMemo(
    () => ({
      tech: VEHICLE.techHolmanName,
      city: VEHICLE.city,
      costCenter: VEHICLE.costCenter,
      color: VEHICLE.color ?? "",
      state: VEHICLE.nexusStatus,
      odometer: "118426",
    }),
    [],
  );
  const [draft, setDraft] = useState(initial);
  // Discard pending edits whenever the user leaves Update mode.
  useEffect(() => { if (!editing) setDraft(initial); }, [editing, initial]);

  const dirtyKeys = (Object.keys(draft) as (keyof typeof draft)[])
    .filter((k) => String(draft[k]) !== String(initial[k]));
  const dirtyCount = dirtyKeys.length;
  const isDirty = (k: keyof typeof draft) => dirtyKeys.includes(k);
  const set = (k: keyof typeof draft) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div
      className={
        "h-screen w-[540px] bg-background text-foreground flex flex-col " +
        (editing ? "ring-2 ring-inset" : "")
      }
      style={editing ? { boxShadow: "inset 0 0 0 2px #B45309" } : undefined}
    >
      {/* Edit-mode banner */}
      {editing && (
        <div
          className="shrink-0 px-6 py-1.5 text-[10px] uppercase tracking-[0.2em] flex items-center justify-between"
          style={{ background: "#B45309", color: "#fff" }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Pencil className="w-3 h-3" /> Edit mode
          </span>
          <span>{dirtyCount === 0 ? "No changes yet" : `${dirtyCount} field${dirtyCount === 1 ? "" : "s"} pending`}</span>
        </div>
      )}

      {/* ───────────── SCROLLING INFO ───────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Identity header */}
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 inline-flex items-center gap-1"
              style={{ background: "#FFEDD5", color: "#9A3412" }}
            >
              <Wrench className="w-2.5 h-2.5" /> {VEHICLE.assignmentStatus} · {AMS_DOSSIER.daysInRepair}d
            </span>
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 inline-flex items-center gap-1"
              style={{ background: "#DBEAFE", color: "#1E40AF" }}
            >
              <Car className="w-2.5 h-2.5" /> Rental open
            </span>
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border"
              style={{ color: "#B45309" }}
            >
              {VEHICLE.ownershipShort} · expired 2017
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {VEHICLE.city}
            </span>
            <span>·</span>
            <span>{VEHICLE.region}</span>
            <span>·</span>
            <span className="font-mono">{VEHICLE.plate}</span>
          </div>
        </div>

        {/* 1. THE FACTS */}
        <div className="px-6 py-5">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-['Playfair_Display'] text-2xl tracking-tight" style={{ fontWeight: 600 }}>
              The Facts
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {editing ? "Click any field to edit" : "Who · What · When · Where · Why"}
            </span>
          </div>

          {editing ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <EditableFactRow
                icon={User} label="Who · Assigned tech"
                value={draft.tech} onChange={set("tech")} dirty={isDirty("tech")}
                src="Holman + AMS + TPMS aligned" at="WMS parts truck unbound"
              />
              <LockedFactRow
                icon={Building} label="What · Asset"
                value={`${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`}
                src="Holman" at={VEHICLE.lastHolmanSync}
              />
              <LockedFactRow
                icon={Calendar} label="When · Last touched"
                value={VEHICLE.lastNexusUpdate}
                src="Nexus comment log" at="3mo ago"
              />
              <EditableFactRow
                icon={MapPin} label="Where · Garaged"
                value={draft.city} onChange={set("city")} dirty={isDirty("city")}
                src="Holman" at={VEHICLE.lastHolmanSync}
              />
              <EditableSelectRow
                icon={Wrench} label="Why · Current state"
                value={draft.state} onChange={set("state")} dirty={isDirty("state")}
                options={STATE_OPTIONS}
              />
              <LockedFactRow
                icon={FileText} label="VIN" mono
                value={VEHICLE.vin}
                src="Holman" at={VEHICLE.lastHolmanSync}
              />
              <EditableFactRow
                icon={Hash} label="Cost Center"
                value={draft.costCenter} onChange={set("costCenter")} dirty={isDirty("costCenter")}
                src="Holman" at={VEHICLE.lastHolmanSync}
              />
              <EditableFactRow
                icon={Palette} label="Color"
                value={draft.color} onChange={set("color")} dirty={isDirty("color")}
                placeholder="— missing —"
                src="AMS" at={VEHICLE.lastAmsSync}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <FactRow icon={User}     label="Who · Assigned tech" value={`${VEHICLE.techHolmanName} (${VEHICLE.techHolman})`} src="Holman + AMS + TPMS aligned" at="WMS parts truck unbound" />
              <FactRow icon={Building} label="What · Asset"        value={`${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`} src="Holman" at={VEHICLE.lastHolmanSync} />
              <FactRow icon={Calendar} label="When · Last touched" value={VEHICLE.lastNexusUpdate} src="Nexus comment log" at="3mo ago" />
              <FactRow icon={MapPin}   label="Where · Garaged"     value={VEHICLE.city} src="Holman" at={VEHICLE.lastHolmanSync} />
              <FactRow icon={Wrench}   label="Why · Current state" value={`${VEHICLE.nexusStatus.replace(/_/g, " ")} · repaired`} src="Nexus" at="3mo ago" />
              <FactRow icon={FileText} label="VIN"                 value={VEHICLE.vin} mono src="Holman" at={VEHICLE.lastHolmanSync} />
              <FactRow icon={Hash}     label="Cost Center"         value={`CC ${VEHICLE.costCenter}`} src="Holman" at={VEHICLE.lastHolmanSync} />
              <FactRow icon={Palette}  label="Color"               value={VEHICLE.color ?? "— missing —"} src="AMS" at={VEHICLE.lastAmsSync} />
            </div>
          )}
        </div>

        {/* 2. NEEDS ATTENTION */}
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
              6 items
            </span>
          </div>

          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" style={{ color: "#991B1B" }} />
                Repair stuck at PEP BOYS for {AMS_DOSSIER.daysInRepair} days
              </div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                Severe
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ETA <span className="font-mono text-foreground">{AMS_DOSSIER.repairETADate}</span> passed {AMS_DOSSIER.etaOverdueDays} days ago. Status still <span className="text-foreground">{AMS_DOSSIER.repairStatus}</span> with no estimate on file. Rental has been running since <span className="font-mono">{AMS_DOSSIER.rentalStartDate}</span>.
            </div>
          </div>

          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">AMS key-location address has a typo</div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FFFBEB", color: "#B45309" }}>
                Drift
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              KeyLocAddress reads <span className="font-mono text-foreground">SHERWOOD</span> but CurLocAddress reads <span className="font-mono text-foreground">SHOREWOOD</span>. Same ZIP. Pick one and push back to AMS.
            </div>
          </div>

          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">Odometer reading is 27 days stale</div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FFFBEB", color: "#B45309" }}>
                Stale
              </span>
            </div>
            {editing ? (
              <div className="mt-1.5">
                <div className="flex items-baseline gap-2">
                  <Input
                    value={draft.odometer}
                    onChange={(e) => set("odometer")(e.target.value)}
                    className={
                      "rounded-none h-9 w-40 text-2xl font-['Playfair_Display'] " +
                      (isDirty("odometer") ? "border-2 bg-[#FFFBEB]" : "border-dashed bg-background")
                    }
                    style={isDirty("odometer") ? { borderColor: "#B45309", fontWeight: 600 } : { fontWeight: 600 }}
                  />
                  <span className="text-xs text-muted-foreground">mi · push to Holman + AMS</span>
                </div>
                {isDirty("odometer") && (
                  <div className="text-[10px] mt-1" style={{ color: "#B45309" }}>
                    Was {Number(initial.odometer).toLocaleString()} mi · was 27d old
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="font-['Playfair_Display'] text-2xl leading-none mt-1.5" style={{ fontWeight: 600 }}>
                  {VEHICLE.odometer}
                  <span className="text-xs text-muted-foreground ml-2">Holman = AMS · Samsara not connected</span>
                </div>
                <MismatchPanel />
              </>
            )}
          </div>

          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" style={{ color: "#991B1B" }} />
                Holman still shows <span className="font-mono">Active · Assigned</span> — AMS says In Repair
              </div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                Drift
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Holman last touched <span className="font-mono text-foreground">{VEHICLE.lastHolmanChange}</span> with statusCode <span className="font-mono text-foreground">1</span>. The PEP BOYS repair has never been mirrored back to Holman.
            </div>
          </div>

          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" style={{ color: "#92400E" }} />
                Still being billed {HOLMAN_FACTS.monthsBilled - HOLMAN_FACTS.leaseTerm} months past the {HOLMAN_FACTS.leaseTerm}-month lease term
              </div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5" style={{ background: "#FFFBEB", color: "#B45309" }}>
                Lease
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Lease ran <span className="font-mono text-foreground">{HOLMAN_FACTS.leaseStart} → {HOLMAN_FACTS.leaseEnd}</span> ({HOLMAN_FACTS.leaseTerm} mo). Holman has billed <span className="font-mono text-foreground">{HOLMAN_FACTS.monthsBilled} mo</span> at <span className="font-mono text-foreground">${HOLMAN_FACTS.capCost.toLocaleString()}</span>; book value is <span className="font-mono text-foreground">$0</span>.
            </div>
          </div>

          <div className="bg-background border border-border p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <Boxes className="w-3 h-3" style={{ color: "#B45309" }} />
                WMS Parts Truck has no tech bound · cost center mismatch
              </div>
              <Freshness src="WMS ↔ Holman" at="not aligned" missing />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              WMS truck <span className="font-mono text-foreground">#{WMS_PARTS_TRUCK.truckName}</span> ({WMS_PARTS_TRUCK.skuCount} SKUs across {WMS_PARTS_TRUCK.bins.join(" + ")}) has <span className="text-foreground">techEnterpriseId = null</span>. Cost center <span className="font-mono text-foreground">{WMS_PARTS_TRUCK.costCenter}</span> doesn't match Holman <span className="font-mono text-foreground">{VEHICLE.costCenter}</span>.
            </div>
          </div>
        </div>

        <AmsDossier />
        <CrossSystemLedger />

        {/* References */}
        <div className="px-6 py-3 border-t border-border grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <MessageSquarePlus className="w-3 h-3 mr-1.5" /> Add note
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <FileText className="w-3 h-3 mr-1.5" /> PO History · {VEHICLE.poCount}
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <History className="w-3 h-3 mr-1.5" /> History
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <Boxes className="w-3 h-3 mr-1.5" /> Inventory
          </Button>
          <Button variant="outline" size="sm" className="rounded-none text-[10px] uppercase tracking-wider justify-start">
            <Activity className="w-3 h-3 mr-1.5" /> Telematics
          </Button>
          <Button
            variant="outline" size="sm"
            className="rounded-none text-[10px] uppercase tracking-wider justify-start"
            style={{ color: "#7E22CE", borderColor: "#E9D5FF" }}
          >
            <Users className="w-3 h-3 mr-1.5" /> Ops Review
          </Button>
        </div>

        {/* 3. CONTEXT */}
        <div className="px-6 pt-5 pb-6 border-t border-border" style={{ background: "#FAFAF7" }}>
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-['Playfair_Display'] text-base tracking-tight" style={{ fontWeight: 600 }}>
              Latest from AMS
            </div>
            <Freshness src="AMS" at={VEHICLE.lastAmsSync} />
          </div>
          {AMS_COMMENTS.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No AMS comment thread for this vehicle. AMS record itself was last touched{" "}
              <span className="font-mono not-italic">{VEHICLE.lastAmsSync}</span>; the repair record was last touched{" "}
              <span className="font-mono not-italic">{VEHICLE.lastRepairUpdate}</span>; the most recent local Nexus note was{" "}
              <span className="font-mono not-italic">{VEHICLE.lastNexusUpdate}</span>.
            </div>
          ) : null}
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>Facts · Alerts · Dossier · Context</span>
          <span className="normal-case tracking-normal">
            Last updated <span className="font-mono">{VEHICLE.lastUpdateAt}</span> by <span className="font-mono">{VEHICLE.lastUpdateUser}</span>
          </span>
        </div>
      </div>

      {/* ───────────── STICKY BOTTOM: ACTIONS ───────────── */}
      <div
        className="shrink-0 border-t-2 border-foreground bg-background"
        style={{ boxShadow: "0 -8px 16px -10px rgba(0,0,0,0.18)" }}
      >
        <div className="px-6 pt-3 pb-2 flex items-baseline justify-between">
          <div className="font-['Playfair_Display'] text-xl tracking-tight" style={{ fontWeight: 600 }}>
            Actions
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            <Icon className="w-3 h-3" />
            {PRINCIPLES.find((p) => p.key === active)?.label}
          </span>
        </div>

        <div className="grid grid-cols-4 border-y border-border">
          {PRINCIPLES.map((p) => {
            const PIcon = p.icon;
            const isActive = active === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setActive(p.key)}
                className="px-2 py-2 text-left transition-all border-r border-border last:border-r-0"
                style={{
                  background: isActive ? p.tone : "transparent",
                  color: isActive ? "#fff" : "#0F1117",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <PIcon className="w-3.5 h-3.5" style={{ opacity: isActive ? 1 : 0.6 }} />
                  <div className="font-['Playfair_Display'] text-sm leading-none" style={{ fontWeight: 600 }}>
                    {p.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: 280 }}>
          {active === "review"   && <ReviewBody />}
          {active === "assign"   && <AssignBody />}
          {active === "unassign" && <UnassignBody />}
          {active === "update"   && (
            <UpdateActionPanel
              dirtyKeys={dirtyKeys as string[]}
              draft={draft}
              initial={initial}
              onDiscard={() => setDraft(initial)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sticky-bottom Save / Discard summary that replaces the old UpdateBody.
// ────────────────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  tech: "Assigned tech",
  city: "Garaged city",
  costCenter: "Cost center",
  color: "Color",
  state: "Current state",
  odometer: "Odometer",
};

function formatVal(k: string, v: string) {
  if (k === "odometer") {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toLocaleString()} mi` : v;
  }
  if (k === "state") return v.replace(/_/g, " ");
  return v || "—";
}

function UpdateActionPanel({
  dirtyKeys, draft, initial, onDiscard,
}: {
  dirtyKeys: string[];
  draft: Record<string, string>;
  initial: Record<string, string>;
  onDiscard: () => void;
}) {
  const hasChanges = dirtyKeys.length > 0;

  return (
    <div>
      {!hasChanges ? (
        <div className="text-xs text-muted-foreground">
          Click any field above to edit it. Only Cost Center, Garaged city, Tech, Color, Current state, and Odometer are editable; VIN, Year/Make/Model, and the AMS-only fields stay locked.
        </div>
      ) : (
        <div className="space-y-1.5 mb-3">
          {dirtyKeys.map((k) => (
            <div key={k} className="flex items-baseline justify-between text-xs gap-3">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 w-28">
                {FIELD_LABEL[k] ?? k}
              </span>
              <span className="font-mono text-muted-foreground line-through truncate">
                {formatVal(k, initial[k])}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono text-foreground truncate" style={{ color: "#B45309" }}>
                {formatVal(k, draft[k])}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!hasChanges}
          className="rounded-none text-[10px] uppercase tracking-wider"
          style={{ background: hasChanges ? "#B45309" : "#E5E5E0", color: hasChanges ? "#fff" : "#999" }}
        >
          <Save className="w-3 h-3 mr-1.5" />
          {hasChanges ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}` : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasChanges}
          onClick={onDiscard}
          className="rounded-none text-[10px] uppercase tracking-wider"
        >
          <Undo2 className="w-3 h-3 mr-1.5" /> Discard
        </Button>
        {hasChanges && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            Will write to Holman + AMS + Nexus
          </span>
        )}
      </div>
    </div>
  );
}
