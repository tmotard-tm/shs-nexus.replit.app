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
  Activity, Users, Hash, Palette,
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
  color: null as string | null,            // missing in Holman
  ownership: "Holman Lease (expired 2017-05-31)",
  ownershipShort: "Holman Lease",
  assignmentStatus: "Active",              // Holman shows assignment
  odometer: "118,426 mi",
  odometerAt: "2026-04-15 (27d ago)",
  techHolman: "sgoshin",
  techHolmanName: "Shaun Goshinsky",
  techTpms: null as string | null,
  techAms: null as string | null,
  inService: "2012-06-01",
  lastHolmanSync: "2m ago",
  lastNexusUpdate: "2026-02-09 by jdyer2",
  lastUpdateUser: "jdyer2",
  lastUpdateAt: "2026-02-09",
  nexusStatus: "assigned_to_tech",
  repaired: "complete",
  poCount: 0,                              // no POs against this vehicle
};

// AMS dossier — every field is missing because this VIN has no AMS record.
// Render the labels anyway to show structure; values render as em-dash.
const AMS_DOSSIER = {
  hasRecord: false,
  // Ownership hierarchy
  amsTech: null as string | null,
  amsTechName: null as string | null,
  tfd: null as string | null,
  tfdName: null as string | null,
  dsm: null as string | null,
  dsmName: null as string | null,
  tm: null as string | null,
  tmName: null as string | null,
  // Description
  branding: null as string | null,
  interior: null as string | null,
  amsOdometer: null as number | null,
  amsOdometerDate: null as string | null,
  remBookValue: null as number | null,
  leaseEndDate: null as string | null,
  outOfSvcDate: null as string | null,
  saleDate: null as string | null,
  regRenewalDate: null as string | null,
  lifetimeMaintenanceCost: null as number | null,
  storageCost: null as number | null,
  // Condition
  roadReady: null as string | null,
  grade: null as string | null,
  gradeDescription: null as string | null,
  gradeVerified: null as string | null,
  truckStatus: null as string | null,
  theftVerified: null as string | null,
  vehicleRuns: null as string | null,
  vehicleLooks: null as string | null,
  // Location (the "where is the vehicle now" — distinct from garaged city)
  curLocAddress: null as string | null,
  curLocCity: null as string | null,
  curLocState: null as string | null,
  curLocZip: null as string | null,
  // Repair (Tier 3 — gates on inRepair)
  inRepair: false,
  daysInRepair: null as number | null,
  repairDateStart: null as string | null,
  repairETADate: null as string | null,
  repairReason: null as string | null,
  repairStatus: null as string | null,
  repairVendor: null as string | null,
  estimateCost: null as number | null,
  rentalCar: null as string | null,
  rentalStartDate: null as string | null,
  rentalEndDate: null as string | null,
  finalDisposition: null as string | null,
  finalDispositionReason: null as string | null,
  finalDispositionDate: null as string | null,
};

// vehicle_nexus_data.comments is empty for 21165 — no AMS comment thread exists.
const AMS_COMMENTS: { who: string; when: string; body: string }[] = [];

const ODO_SOURCES = [
  { sys: "Holman",  val: "118,426 mi", at: "27d ago",  canonical: true },
  { sys: "AMS",     val: "—",          at: "no record" },
  { sys: "Samsara", val: "—",          at: "not connected" },
];

const PRINCIPLES = [
  { key: "review",   label: "Review",   icon: Eye,      tone: "#1A56DB", note: "9 fields · gaps in AMS / TPMS" },
  { key: "update",   label: "Update",   icon: Pencil,   tone: "#B45309", note: "Pinned: re-sync AMS" },
  { key: "assign",   label: "Assign",   icon: UserPlus, tone: "#0D9668", note: "Pick or reconcile" },
  { key: "unassign", label: "Unassign", icon: UserX,    tone: "#DC2626", note: "Reason required" },
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
        style={{ background: "#FEF2F2", color: "#991B1B" }}
      >
        <XCircle className="w-3 h-3" />
        Pinned: AMS has no record for this VIN
      </div>
      <div className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Force AMS sync</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input defaultValue={VEHICLE.vin} className="h-9 rounded-none font-mono text-sm" />
            <Button className="h-9 rounded-none uppercase tracking-wider text-xs">Re-sync</Button>
          </div>
          <Freshness src="AMS" at="never synced" missing />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Registration renewal date (missing)</Label>
          <Input placeholder="YYYY-MM-DD" className="mt-1 h-9 rounded-none font-mono text-sm" />
          <Freshness src="Holman" at="not on file" missing />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Color (missing)</Label>
          <Input placeholder="—" className="mt-1 h-9 rounded-none text-sm" />
          <Freshness src="Holman" at="not on file" missing />
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
        <div className="text-[10px] uppercase tracking-wider" style={{ color: "#B45309" }}>
          Holman has an assignment. TPMS and AMS are blank.
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="border border-border p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holman</div>
            <div className="font-mono text-xs mt-0.5">{VEHICLE.techHolman}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{VEHICLE.lastHolmanSync}</div>
          </div>
          <div className="border border-dashed border-border p-2" style={{ background: "#FEF2F2" }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#991B1B" }}>TPMS</div>
            <div className="font-mono text-xs mt-0.5 text-muted-foreground">— blank —</div>
            <div className="text-[10px] mt-0.5" style={{ color: "#991B1B" }}>no record</div>
          </div>
          <div className="border border-dashed border-border p-2" style={{ background: "#FEF2F2" }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#991B1B" }}>AMS</div>
            <div className="font-mono text-xs mt-0.5 text-muted-foreground">— blank —</div>
            <div className="text-[10px] mt-0.5" style={{ color: "#991B1B" }}>no record</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 rounded-none uppercase tracking-wider text-xs">
            Push Holman → TPMS + AMS
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
    <div className="text-sm text-muted-foreground">
      All canonical fields are shown above in <span className="text-foreground">The Facts</span>. The full AMS dossier (Ownership · Description · Condition · Location) sits in the collapsible block below — it's empty for this vehicle because AMS has no record for the VIN. Open <span className="text-foreground">Update</span> to force a re-sync, or <span className="text-foreground">Assign</span> to push Holman's assignment downstream.
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

          {!AMS_DOSSIER.hasRecord && (
            <div className="border border-dashed border-border p-3" style={{ background: "#FEF2F2" }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "#991B1B" }}>
                Why is this empty?
              </div>
              <div className="text-xs mt-1 text-muted-foreground">
                AMS has no record matching VIN <span className="font-mono">{VEHICLE.vin}</span>.
                Force a sync from the <span className="text-foreground">Update</span> tab to populate
                Ownership, Description, Condition, Repair, and Location at once.
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
              style={{ background: "#DCFCE7", color: "#166534" }}
            >
              <Check className="w-2.5 h-2.5" /> {VEHICLE.assignmentStatus}
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
              src="Holman only"
              at="TPMS + AMS blank"
              missing
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
              src="Holman"
              at={VEHICLE.color ? VEHICLE.lastHolmanSync : "not on file"}
              missing={!VEHICLE.color}
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

          {/* Alert 1 — AMS missing */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" style={{ color: "#991B1B" }} />
                AMS has no record for this vehicle
              </div>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: "#FEE2E2", color: "#991B1B" }}
              >
                Severe
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              VIN <span className="font-mono">{VEHICLE.vin}</span> never appeared in <span className="font-mono">ams_vehicles_cache</span>. Re-sync from Update.
            </div>
          </div>

          {/* Alert 2 — assignment misalignment */}
          <div className="bg-background border border-border p-3 mb-2">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium">Assignment is Holman-only</div>
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5"
                style={{ background: "#FFFBEB", color: "#B45309" }}
              >
                Mismatched
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Holman shows <span className="font-mono">{VEHICLE.techHolman}</span>; TPMS and AMS are blank. Push from Assign tab.
            </div>
          </div>

          {/* Alert 3 — odometer is stale + only one source */}
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
              <span className="text-xs text-muted-foreground ml-2">canonical · Holman</span>
            </div>
            <MismatchPanel />
          </div>

          {/* Alert 4 — lease expired */}
          <div className="bg-background border border-border p-3">
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-medium inline-flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" style={{ color: "#92400E" }} />
                Lease term ended 2017-05-31 (8.9 years ago)
              </div>
              <Freshness src="Holman" at="raw_data" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              No registration renewal date on file. Confirm ownership status.
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
            <Freshness src="AMS" at="never synced" missing />
          </div>
          {AMS_COMMENTS.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No AMS notes on file for this vehicle. The most recent Nexus comment was on{" "}
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
