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
  ChevronRight, ChevronDown, Radio, MessageSquarePlus, FileText, Boxes,
  History, User, Calendar, Building, AlertCircle, XCircle, Search, Check,
  Activity, Users, Hash, Palette, Car,
} from "lucide-react";

// Real data pulled from holman_vehicles_cache + vehicle_nexus_data on 2026-05-12.
const VEHICLE = {
  id: "21165",
  year: 2012,
  make: "Chevrolet",
  model: "Express",
  vin: "1GCSGAFX0C1148369",
  plate: "3185806B · IL",
  city: "Salem, WI",
  region: "890 / District 8555",
  costCenter: "4423",
  color: "White",
  ownership: "Holman Lease (expired 2017-05-24)",
  ownershipShort: "Holman Lease",
  assignmentStatus: "In Repair",           // truth: vehicle is at PEP BOYS, rental open
  odometer: "118,426 mi",
  odometerAt: "2026-04-15 (27d ago)",
  techHolman: "sgoshin",
  techHolmanName: "Shaun Goshinsky",
  techAms: "SGOSHIN",                       // matches Holman ✓
  techAmsName: "Shaun Goshinsky",
  techTpms: null as string | null,         // TPMS still blank
  inService: "2012-05-17",                 // AMS DeliveryDate
  vehicleAgeMonths: 168,
  lastHolmanSync: "2m ago",
  lastAmsSync: "2026-01-24 by rdelgal",
  lastRepairUpdate: "by pyadav",
  lastNexusUpdate: "2026-02-09 by jdyer2",
  lastUpdateUser: "jdyer2",
  lastUpdateAt: "2026-02-09",
  nexusStatus: "in_repair",
  poCount: 0,
};

// AMS dossier — vehicle has a full AMS record (82 fields). Real values below.
const AMS_DOSSIER = {
  hasRecord: true,
  // Ownership hierarchy
  amsTech: "SGOSHIN",
  amsTechName: "Shaun Goshinsky",
  tfd: "CONEI02",
  tfdName: "Carl L O'Neill",
  dsm: "FACOST2",
  dsmName: "Frankie Acosta",
  tm: "DBALABA",
  tmName: "Daniel J Balaban",
  // Description
  branding: "AE Factory Service",
  interior: "Utility With Ref Racks",
  sctTune: "Medium",
  amsOdometer: 118426,
  amsOdometerDate: "2026-04-15",
  remBookValue: 0,
  leaseEndDate: "2017-05-24",
  outOfSvcDate: null as string | null,
  saleDate: null as string | null,
  regRenewalDate: "2026-10-31",
  lifetimeMaintenanceCost: 22861.52,
  storageCost: 0,
  // Condition
  roadReady: "Yes",
  grade: "B",
  gradeDescription: "101K–175K mi. Baseball-size dents, 6\" scratches, 4×4\" rust patch. Safety aspects good.",
  gradeVerified: "Yes",
  truckStatus: "Assigned to Tech",
  theftVerified: "Yes",
  vehicleRuns: "Operational",
  vehicleLooks: "Poor — decals/paint peeling, minor body damage, minor rust",
  // Key location (AMS has a typo here — SHERWOOD vs SHOREWOOD on current loc)
  keyLocAddress: "7816 Sherwood Dr",
  keyLocZip: "53168",
  // Current location (where the vehicle physically is — distinct from garaged city)
  curLocAddress: "7816 Shorewood Dr",
  curLocCity: "Salem",
  curLocState: "WI",
  curLocZip: "53168",
  // Repair (Tier 3 — gates on inRepair). Vehicle has been at PEP BOYS since 2026-01-29.
  inRepair: true,
  daysInRepair: 103,
  repairDateStart: "2026-01-29",
  repairETADate: "2026-02-04",
  etaOverdueDays: 97,
  repairReason: "Mechanical Breakdown / Failure",
  repairStatus: "Waiting Estimate From Shop",
  repairVendor: "PEP BOYS · 818 E Rollins Rd, Round Lake Beach IL 60073",
  estimateCost: 0,
  rentalCar: "YES — Rental",
  rentalStartDate: "2026-01-29",
  rentalEndDate: null as string | null,
  finalDisposition: null as string | null,
  finalDispositionReason: null as string | null,
  finalDispositionDate: null as string | null,
};

// vehicle_nexus_data.comments is empty for 21165 — no AMS comment thread exists.
const AMS_COMMENTS: { who: string; when: string; body: string }[] = [];

const ODO_SOURCES = [
  { sys: "Holman",  val: "118,426 mi", at: "27d ago",  canonical: true },
  { sys: "AMS",     val: "118,426 mi", at: "27d ago",  match: true },
  { sys: "Samsara", val: "—",          at: "not connected" },
];

const PRINCIPLES = [
  { key: "review",   label: "Review",   icon: Eye,      tone: "#1A56DB", note: "Repair stuck 103d · est. pending" },
  { key: "update",   label: "Update",   icon: Pencil,   tone: "#B45309", note: "Pinned: chase PEP BOYS estimate" },
  { key: "assign",   label: "Assign",   icon: UserPlus, tone: "#0D9668", note: "Tech aligned in Holman + AMS" },
  { key: "unassign", label: "Unassign", icon: UserX,    tone: "#DC2626", note: "Blocked while in repair" },
] as const;

type PrincipleKey = typeof PRINCIPLES[number]["key"];

function Freshness({ src, at, missing }: { src: string; at: string; missing?: boolean }) {
  return (
    <span
      className="text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
      style={{ color: missing ? "#991B1B" : undefined }}
    >
      <Radio className="w-2.5 h-2.5" />
      {src} · {at}
    </span>
  );
}

function FactRow({
  icon: Icon, label, value, mono, src, at, missing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
  src: string;
  at: string;
  missing?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 mt-1 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-0.5 ${mono ? "font-mono text-xs" : "text-sm"}`} style={missing ? { color: "#991B1B" } : undefined}>
          {value}
        </div>
        <Freshness src={src} at={at} missing={missing} />
      </div>
    </div>
  );
}

// Editorial-style read-only field for the AMS dossier
function DossierField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const empty = value == null || value === "" || value === "—";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 text-xs"
        style={empty ? { color: "#6B7280", fontStyle: "italic" } : undefined}
      >
        {empty ? "— missing —" : String(value)}
      </div>
    </div>
  );
}

function MismatchPanel() {
  return (
    <div className="mt-3 border-l-2 pl-3" style={{ borderColor: "#B45309" }}>
      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#B45309" }}>
        Only Holman has odometer — AMS and Samsara are silent
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
            {!s.canonical && s.val !== "—" && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] uppercase tracking-wider">
                Set as source
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <Input placeholder="Use a different value…" className="h-7 text-xs font-mono rounded-none" />
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
        style={{ background: "#FFFBEB", color: "#92400E" }}
      >
        <Wrench className="w-3 h-3" />
        Pinned: chase PEP BOYS for repair estimate (97d overdue)
      </div>
      <div className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Update repair status</Label>
          <Select>
            <SelectTrigger className="mt-1 h-9 rounded-none">
              <SelectValue placeholder={AMS_DOSSIER.repairStatus ?? "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="waiting-estimate">Waiting Estimate From Shop</SelectItem>
              <SelectItem value="estimate-received">Estimate Received</SelectItem>
              <SelectItem value="approved">Approved · Repair In Progress</SelectItem>
              <SelectItem value="completed">Completed · Picked Up</SelectItem>
              <SelectItem value="totaled">Totaled</SelectItem>
            </SelectContent>
          </Select>
          <Freshness src="AMS" at="updated 2026-01-29" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Revise repair ETA</Label>
          <Input placeholder="YYYY-MM-DD" defaultValue={AMS_DOSSIER.repairETADate ?? ""} className="mt-1 h-9 rounded-none font-mono text-sm" />
          <Freshness src="AMS" at={`overdue ${AMS_DOSSIER.etaOverdueDays}d`} missing />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Estimate cost (USD)</Label>
          <Input placeholder="0.00" className="mt-1 h-9 rounded-none font-mono text-sm" />
          <Freshness src="AMS" at="not on file" missing />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Force AMS resync</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input defaultValue={VEHICLE.vin} className="h-9 rounded-none font-mono text-sm" />
            <Button className="h-9 rounded-none uppercase tracking-wider text-xs">Re-sync</Button>
          </div>
          <Freshness src="AMS" at={VEHICLE.lastAmsSync} />
        </div>
      </div>
    </div>
  );
}

const TECH_DIRECTORY = [
  { racf: "jsmith2",   name: "Jane Smith",       district: "8555", currentTruck: null,    inDistrict: true  },
  { racf: "mwilson",   name: "Marcus Wilson",    district: "8555", currentTruck: "20987", inDistrict: true  },
  { racf: "rgarcia4",  name: "Rosa Garcia",      district: "8555", currentTruck: null,    inDistrict: true  },
  { racf: "tnguyen",   name: "Tran Nguyen",      district: "8501", currentTruck: null,    inDistrict: false },
  { racf: "dkowalski", name: "Derek Kowalski",   district: "8555", currentTruck: "21002", inDistrict: true  },
];

function AssignBody() {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<typeof TECH_DIRECTORY[number] | null>(null);

  const results = query.trim()
    ? TECH_DIRECTORY.filter((t) => {
        const q = query.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.racf.toLowerCase().includes(q) ||
          t.district.includes(q)
        );
      })
    : [];

  return (
    <div className="space-y-6">
      {/* TOP HALF — pick a new tech */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-wider font-medium">Pick a new tech</div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            District {VEHICLE.region.split("/").pop()?.trim()}
          </span>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a tech by name, RACF ID, or district…"
            className="h-9 pl-8 rounded-none text-sm"
          />
        </div>

        {picked ? (
          <div className="border-2 border-foreground p-3 space-y-3">
            <div className="flex items-start gap-3">
              <Check className="w-4 h-4 mt-0.5" style={{ color: "#0D9668" }} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Assign to truck #{VEHICLE.id}
                </div>
                <div className="text-sm mt-0.5">
                  <span className="font-medium">{picked.name}</span>{" "}
                  <span className="text-muted-foreground">
                    ({picked.racf} · District {picked.district})
                  </span>
                </div>
                {picked.currentTruck && (
                  <div
                    className="text-[10px] uppercase tracking-wider mt-1.5 inline-flex items-center gap-1"
                    style={{ color: "#B45309" }}
                  >
                    <AlertCircle className="w-3 h-3" />
                    Will unassign from truck #{picked.currentTruck}
                  </div>
                )}
              </div>
              <button
                onClick={() => { setPicked(null); setQuery(""); }}
                className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Change
              </button>
            </div>

            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              We'll sync Holman, TPMS, and AMS in the background.
            </div>

            <Button className="w-full rounded-none uppercase tracking-wider text-xs">
              Confirm assignment
            </Button>
          </div>
        ) : results.length > 0 ? (
          <div className="border border-border">
            {results.map((t) => (
              <button
                key={t.racf}
                onClick={() => setPicked(t)}
                className="w-full px-3 py-2 text-left border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors flex items-center gap-3"
              >
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{t.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <span className="font-mono">{t.racf}</span>
                    <span>·</span>
                    <span>District {t.district}</span>
                    {!t.inDistrict && (
                      <span style={{ color: "#B45309" }}>· out of district</span>
                    )}
                  </div>
                </div>
                {t.currentTruck ? (
                  <span
                    className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 shrink-0"
                    style={{ background: "#FFFBEB", color: "#B45309" }}
                  >
                    On #{t.currentTruck}
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                    Unassigned
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : query.trim() ? (
          <div className="text-xs text-muted-foreground italic px-1">
            No techs match "{query}".
          </div>
        ) : null}
      </section>

      {/* DIVIDER */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            or just reconcile what's already there
          </span>
        </div>
      </div>

      {/* BOTTOM HALF — reconcile existing across all 3 systems */}
      <section className="space-y-3">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: "#0D9668" }}>
          Holman and AMS already agree. Only TPMS is blank.
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="border border-border p-2" style={{ background: "#F0FDF4" }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#166534" }}>Holman</div>
            <div className="font-mono text-xs mt-0.5">{VEHICLE.techHolman}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{VEHICLE.lastHolmanSync}</div>
          </div>
          <div className="border border-dashed border-border p-2" style={{ background: "#FEF2F2" }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#991B1B" }}>TPMS</div>
            <div className="font-mono text-xs mt-0.5 text-muted-foreground">— blank —</div>
            <div className="text-[10px] mt-0.5" style={{ color: "#991B1B" }}>no record</div>
          </div>
          <div className="border border-border p-2" style={{ background: "#F0FDF4" }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#166534" }}>AMS</div>
            <div className="font-mono text-xs mt-0.5">{VEHICLE.techAms?.toLowerCase()}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{VEHICLE.lastAmsSync}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 rounded-none uppercase tracking-wider text-xs">
            Push Holman → TPMS
          </Button>
          <Button variant="ghost" className="rounded-none uppercase tracking-wider text-xs">
            Resync
          </Button>
        </div>
      </section>
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
      <Button disabled variant="destructive" className="w-full rounded-none uppercase tracking-wider text-xs">
        Unassign {VEHICLE.techHolmanName}
      </Button>
    </div>
  );
}

function ReviewBody() {
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <p>
        Vehicle has been at <span className="text-foreground">PEP BOYS Round Lake Beach</span> for{" "}
        <span className="text-foreground">{AMS_DOSSIER.daysInRepair} days</span> waiting on a repair estimate. ETA{" "}
        <span className="font-mono text-foreground">{AMS_DOSSIER.repairETADate}</span> passed{" "}
        <span style={{ color: "#991B1B" }}>{AMS_DOSSIER.etaOverdueDays} days ago</span>. A YES-Rental has been open the entire time.
      </p>
      <p>
        Holman and AMS agree on tech (<span className="font-mono">{VEHICLE.techHolman}</span>). The full AMS dossier (Ownership · Description · Condition · Repair · Location) is in the collapsible block below. Two small drift items worth noting are flagged in <span className="text-foreground">Needs attention</span>.
      </p>
    </div>
  );
}

// Tier 2 — full AMS dossier collapsible
function AmsDossier() {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6 py-5 border-t border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-baseline justify-between text-left"
      >
        <div className="font-['Playfair_Display'] text-2xl tracking-tight" style={{ fontWeight: 600 }}>
          AMS dossier
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span style={{ color: "#991B1B" }}>No record · 26 fields blank</span>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          {/* Ownership hierarchy */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 pb-1 border-b border-border">
              Ownership hierarchy
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DossierField label="AMS Tech" value={AMS_DOSSIER.amsTech} />
              <DossierField label="TFD" value={AMS_DOSSIER.tfd} />
              <DossierField label="DSM" value={AMS_DOSSIER.dsm} />
              <DossierField label="TM" value={AMS_DOSSIER.tm} />
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 pb-1 border-b border-border">
              Description
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DossierField label="Branding" value={AMS_DOSSIER.branding} />
              <DossierField label="Interior" value={AMS_DOSSIER.interior} />
              <DossierField
                label="AMS Odometer"
                value={AMS_DOSSIER.amsOdometer != null ? `${AMS_DOSSIER.amsOdometer.toLocaleString()} mi` : null}
              />
              <DossierField label="Odo. read date" value={AMS_DOSSIER.amsOdometerDate} />
              <DossierField
                label="Book Value"
                value={AMS_DOSSIER.remBookValue != null ? `$${AMS_DOSSIER.remBookValue.toLocaleString()}` : null}
              />
              <DossierField label="Lease End" value={AMS_DOSSIER.leaseEndDate} />
              <DossierField label="Out of Service" value={AMS_DOSSIER.outOfSvcDate} />
              <DossierField label="Sale Date" value={AMS_DOSSIER.saleDate} />
              <DossierField label="Reg Renewal" value={AMS_DOSSIER.regRenewalDate} />
              <DossierField
                label="Lifetime Maint."
                value={AMS_DOSSIER.lifetimeMaintenanceCost != null ? `$${AMS_DOSSIER.lifetimeMaintenanceCost.toLocaleString()}` : null}
              />
              <DossierField
                label="Storage Cost"
                value={AMS_DOSSIER.storageCost != null ? `$${AMS_DOSSIER.storageCost.toLocaleString()}` : null}
              />
            </div>
          </div>

          {/* Condition */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 pb-1 border-b border-border">
              Condition
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <DossierField label="Road Ready" value={AMS_DOSSIER.roadReady} />
              <DossierField label="Grade" value={AMS_DOSSIER.grade} />
              <DossierField label="Grade Description" value={AMS_DOSSIER.gradeDescription} />
              <DossierField label="Grade Verified By" value={AMS_DOSSIER.gradeVerified} />
              <DossierField label="Truck Status" value={AMS_DOSSIER.truckStatus} />
              <DossierField label="Theft Verified" value={AMS_DOSSIER.theftVerified} />
              <div className="col-span-2">
                <DossierField label="How Vehicle Runs" value={AMS_DOSSIER.vehicleRuns} />
              </div>
              <div className="col-span-2">
                <DossierField label="How Vehicle Looks" value={AMS_DOSSIER.vehicleLooks} />
              </div>
            </div>
          </div>

          {/* Tier 3 — Repair Updates (only if InRepair) */}
          {AMS_DOSSIER.inRepair && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] mb-2 pb-1 border-b inline-flex items-center gap-1.5"
                style={{ color: "#B45309", borderColor: "#B45309" }}>
                <Wrench className="w-3 h-3" /> Repair Updates
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DossierField label="In Repair" value={AMS_DOSSIER.inRepair ? "Yes" : "No"} />
                <DossierField label="Days In Repair" value={AMS_DOSSIER.daysInRepair} />
                <DossierField label="Repair Date" value={AMS_DOSSIER.repairDateStart} />
                <DossierField label="Repair ETA" value={AMS_DOSSIER.repairETADate} />
                <div className="col-span-2"><DossierField label="Svc. Reason" value={AMS_DOSSIER.repairReason} /></div>
                <div className="col-span-2"><DossierField label="Repair Status" value={AMS_DOSSIER.repairStatus} /></div>
                <div className="col-span-2"><DossierField label="Repair Vendor" value={AMS_DOSSIER.repairVendor} /></div>
                <DossierField
                  label="Estimate Cost"
                  value={AMS_DOSSIER.estimateCost != null ? `$${AMS_DOSSIER.estimateCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : null}
                />
                <DossierField label="Rental Car" value={AMS_DOSSIER.rentalCar} />
                <DossierField label="Rental Start" value={AMS_DOSSIER.rentalStartDate} />
                <DossierField label="Rental End" value={AMS_DOSSIER.rentalEndDate} />
                <div className="col-span-2 mt-1 pt-2 border-t border-border">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Final Disposition</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div className="col-span-2"><DossierField label="Disposition" value={AMS_DOSSIER.finalDisposition} /></div>
                    <div className="col-span-2"><DossierField label="Reason" value={AMS_DOSSIER.finalDispositionReason} /></div>
                    <DossierField label="Final Date" value={AMS_DOSSIER.finalDispositionDate} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Location (where the vehicle physically is — distinct from garaged city) */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 pb-1 border-b border-border">
              Current Location
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">(distinct from garaged city)</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2"><DossierField label="Address" value={AMS_DOSSIER.curLocAddress} /></div>
              <DossierField label="City" value={AMS_DOSSIER.curLocCity} />
              <DossierField label="State" value={AMS_DOSSIER.curLocState} />
              <DossierField label="ZIP" value={AMS_DOSSIER.curLocZip} />
            </div>
          </div>

          {AMS_DOSSIER.keyLocAddress && AMS_DOSSIER.curLocAddress &&
            AMS_DOSSIER.keyLocAddress.toLowerCase().replace(/\s+/g, "") !==
            AMS_DOSSIER.curLocAddress.toLowerCase().replace(/\s+/g, "") && (
            <div className="border border-dashed border-border p-3" style={{ background: "#FFFBEB" }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "#92400E" }}>
                Address drift inside AMS
              </div>
              <div className="text-xs mt-1 text-muted-foreground">
                Key location reads <span className="font-mono text-foreground">{AMS_DOSSIER.keyLocAddress}</span>{" "}
                but current location reads <span className="font-mono text-foreground">{AMS_DOSSIER.curLocAddress}</span>.
                Looks like a typo in one of the two AMS fields — open <span className="text-foreground">Update</span> to correct.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Variant10() {
  const [active, setActive] = useState<PrincipleKey>("update");
  const Icon = PRINCIPLES.find((p) => p.key === active)!.icon;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="w-[540px]">
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

          {/* Status + ownership badges (Tier 1) */}
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
            <FactRow
              icon={User}
              label="Who · Assigned tech"
              value={`${VEHICLE.techHolmanName} (${VEHICLE.techHolman})`}
              src="Holman + AMS aligned"
              at="TPMS blank"
            />
            <FactRow
              icon={Building}
              label="What · Asset"
              value={`${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`}
              src="Holman"
              at={VEHICLE.lastHolmanSync}
            />
            <FactRow
              icon={Calendar}
              label="When · Last touched"
              value={VEHICLE.lastNexusUpdate}
              src="Nexus comment log"
              at="3mo ago"
            />
            <FactRow
              icon={MapPin}
              label="Where · Garaged"
              value={VEHICLE.city}
              src="Holman"
              at={VEHICLE.lastHolmanSync}
            />
            <FactRow
              icon={Wrench}
              label="Why · Current state"
              value={`${VEHICLE.nexusStatus.replace(/_/g, " ")} · repaired`}
              src="Nexus"
              at="3mo ago"
            />
            <FactRow
              icon={FileText}
              label="VIN"
              value={VEHICLE.vin}
              mono
              src="Holman"
              at={VEHICLE.lastHolmanSync}
            />
            {/* Tier 1 additions */}
            <FactRow
              icon={Hash}
              label="Cost Center"
              value={`CC ${VEHICLE.costCenter}`}
              src="Holman"
              at={VEHICLE.lastHolmanSync}
            />
            <FactRow
              icon={Palette}
              label="Color"
              value={VEHICLE.color ?? "— missing —"}
              src="AMS"
              at={VEHICLE.lastAmsSync}
            />
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
              4 items
            </span>
          </div>

          {/* Alert 1 — repair stuck */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" style={{ color: "#991B1B" }} />
                Repair stuck at PEP BOYS for {AMS_DOSSIER.daysInRepair} days
              </div>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: "#FEE2E2", color: "#991B1B" }}
              >
                Severe
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ETA <span className="font-mono text-foreground">{AMS_DOSSIER.repairETADate}</span> passed {AMS_DOSSIER.etaOverdueDays} days ago. Status still <span className="text-foreground">{AMS_DOSSIER.repairStatus}</span> with no estimate on file. Rental has been running since <span className="font-mono">{AMS_DOSSIER.rentalStartDate}</span>.
            </div>
          </div>

          {/* Alert 2 — internal AMS address drift (key vs current location) */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">AMS key-location address has a typo</div>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: "#FFFBEB", color: "#B45309" }}
              >
                Drift
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              KeyLocAddress reads <span className="font-mono text-foreground">SHERWOOD</span> but CurLocAddress reads <span className="font-mono text-foreground">SHOREWOOD</span>. Same ZIP. Pick one and push back to AMS.
            </div>
          </div>

          {/* Alert 3 — odometer stale (Holman + AMS agree, but both 27d old) */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">Odometer reading is 27 days stale</div>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: "#FFFBEB", color: "#B45309" }}
              >
                Stale
              </span>
            </div>
            <div className="font-['Playfair_Display'] text-2xl leading-none mt-1.5" style={{ fontWeight: 600 }}>
              {VEHICLE.odometer}
              <span className="text-xs text-muted-foreground ml-2">Holman = AMS · Samsara not connected</span>
            </div>
            <MismatchPanel />
          </div>

          {/* Alert 4 — lease end + 7-day mismatch between Holman and AMS */}
          <div className="bg-background border border-border p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" style={{ color: "#92400E" }} />
                Lease ended ~8.9 years ago — 7-day mismatch between systems
              </div>
              <Freshness src="Holman ↔ AMS" at="off by 7d" missing />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Holman shows <span className="font-mono text-foreground">2017-05-31</span>, AMS shows <span className="font-mono text-foreground">2017-05-24</span>. Confirm ownership status either way.
            </div>
          </div>
        </div>

        {/* AMS dossier (Tier 2 + Tier 3 conditional) */}
        <AmsDossier />

        {/* References (Tier 1 — added Telematics + Ops Review, PO count) */}
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
            variant="outline"
            size="sm"
            className="rounded-none text-[10px] uppercase tracking-wider justify-start"
            style={{ color: "#7E22CE", borderColor: "#E9D5FF" }}
          >
            <Users className="w-3 h-3 mr-1.5" /> Ops Review
          </Button>
        </div>

        {/* 3. CONTEXT */}
        <div className="px-6 pt-5 pb-5 border-t border-border" style={{ background: "#FAFAF7" }}>
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
          ) : (
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
          )}
        </div>

        {/* 4. ACTIONS */}
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

        {/* Audit footer (Tier 1) */}
        <div className="px-6 pt-4 pb-2 border-t border-border flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>Facts · Alerts · Dossier · Context · Actions</span>
          <span className="normal-case tracking-normal">
            Last updated <span className="font-mono">{VEHICLE.lastUpdateAt}</span> by <span className="font-mono">{VEHICLE.lastUpdateUser}</span>
          </span>
        </div>
        <div className="px-6 pb-8" />
      </div>
    </div>
  );
}
