import './_group.css';
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Eye, Pencil, UserPlus, UserX, AlertTriangle, MapPin, Wrench,
  MessageSquarePlus, FileText, Boxes, History, User, Calendar,
  Building, AlertCircle, XCircle, Activity, Users, Hash, Palette, Car,
} from "lucide-react";

import {
  VEHICLE, HOLMAN_FACTS, WMS_PARTS_TRUCK, AMS_DOSSIER, AMS_COMMENTS,
  PRINCIPLES, Freshness, FactRow, MismatchPanel,
  ReviewBody, UpdateBody, AssignBody, UnassignBody,
  AmsDossier, CrossSystemLedger,
} from "./Variant10";

type PrincipleKey = typeof PRINCIPLES[number]["key"];

export function Variant11() {
  const [active, setActive] = useState<PrincipleKey>("update");
  const Icon = PRINCIPLES.find((p) => p.key === active)!.icon;

  return (
    <div className="h-screen w-[540px] bg-background text-foreground flex flex-col">
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
              Who · What · When · Where · Why
            </span>
          </div>
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
            <div className="font-['Playfair_Display'] text-2xl leading-none mt-1.5" style={{ fontWeight: 600 }}>
              {VEHICLE.odometer}
              <span className="text-xs text-muted-foreground ml-2">Holman = AMS · Samsara not connected</span>
            </div>
            <MismatchPanel />
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
              Holman last touched <span className="font-mono text-foreground">{VEHICLE.lastHolmanChange}</span> with statusCode <span className="font-mono text-foreground">1</span>. The PEP BOYS repair has never been mirrored back to Holman, so the lessor still treats this truck as in service.
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
              Lease ran <span className="font-mono text-foreground">{HOLMAN_FACTS.leaseStart} → {HOLMAN_FACTS.leaseEnd}</span> ({HOLMAN_FACTS.leaseTerm} mo). Holman has now billed <span className="font-mono text-foreground">{HOLMAN_FACTS.monthsBilled} mo</span> at a <span className="font-mono text-foreground">${HOLMAN_FACTS.capCost.toLocaleString()}</span> cap cost; book value is <span className="font-mono text-foreground">$0</span>.
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

        {/* Audit footer rides at the bottom of the scroll region */}
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

        {/* Compact 4-tab principle picker */}
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

        {/* Active body — capped height with internal scroll if it overflows */}
        <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: 280 }}>
          {active === "review"   && <ReviewBody />}
          {active === "update"   && <UpdateBody />}
          {active === "assign"   && <AssignBody />}
          {active === "unassign" && <UnassignBody />}
        </div>
      </div>
    </div>
  );
}
