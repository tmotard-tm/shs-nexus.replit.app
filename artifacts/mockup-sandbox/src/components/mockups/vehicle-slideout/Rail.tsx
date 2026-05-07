import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Truck, UserPlus, UserX, RefreshCw, Link2, FileText, History, AlertTriangle,
  ChevronDown, X, Eye, Pencil, Gauge, MapPin, CheckCircle2, Database, Clock,
  Wrench, Package, Shield, ChevronRight,
} from "lucide-react";

type Region = "review" | "update" | "assign" | "unassign";

const RAIL = [
  { id: "review" as Region,   label: "Review",   icon: Eye,      desc: "Read-only context" },
  { id: "update" as Region,   label: "Update",   icon: Pencil,   desc: "Editable fields" },
  { id: "assign" as Region,   label: "Assign",   icon: UserPlus, desc: "Assign technician" },
  { id: "unassign" as Region, label: "Unassign", icon: UserX,    desc: "Remove technician" },
];

function FreshnessChip({ source, time, tone = "muted" }: { source: string; time: string; tone?: "muted" | "warn" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
      tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-border bg-muted/50 text-muted-foreground"
    }`}>
      <Clock className="h-2.5 w-2.5" />
      {source} · {time}
    </span>
  );
}

function ReviewRow({
  label, value, source, time, mismatched, children,
}: {
  label: string; value: string; source: string; time: string;
  mismatched?: boolean; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{value}</span>
            <FreshnessChip source={source} time={time} />
            {mismatched && (
              <button
                onClick={() => setOpen(!open)}
                className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400 hover:bg-red-500/20"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Mismatched
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        </div>
      </div>
      {mismatched && open && children && (
        <div className="border-t bg-muted/30 px-3 py-2">{children}</div>
      )}
    </div>
  );
}

function UpdateRow({
  label, value, hint, pinned,
}: { label: string; value: string; hint?: string; pinned?: boolean }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
          {pinned && <Badge variant="secondary" className="h-4 px-1 text-[9px]">Pinned</Badge>}
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
          <Pencil className="mr-1 h-3 w-3" /> Edit
        </Button>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{value}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function ReviewPane() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4" /> Review
        </h3>
        <p className="text-xs text-muted-foreground">Read-only context, consolidated from all source systems.</p>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Identity</div>
        <div className="grid grid-cols-2 gap-2">
          <ReviewRow label="VIN" value="1FTBR1Y89NKA12345" source="Holman" time="12m ago" />
          <ReviewRow label="License Plate" value="8XYZ123 (CA)" source="Holman" time="12m ago" />
          <ReviewRow label="Color" value="White" source="AMS" time="1d ago" />
          <ReviewRow label="Location" value="Sacramento, CA 95823" source="Snowflake" time="4h ago" />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Telematics & Maintenance</div>
        <div className="space-y-2">
          <ReviewRow
            label="Odometer"
            value="47,832 mi"
            source="Snowflake"
            time="4h ago"
            mismatched
          >
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Per-system values</div>
              {[
                { sys: "Snowflake", val: "47,832 mi", time: "4h ago", current: true },
                { sys: "Holman",    val: "47,832 mi", time: "12m ago", current: false },
                { sys: "AMS",       val: "47,201 mi", time: "1d ago", current: false },
              ].map((r) => (
                <div key={r.sys} className="flex items-center justify-between rounded border bg-background px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Database className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium">{r.sys}</span>
                    <span className="text-xs text-muted-foreground">{r.val}</span>
                    <span className="text-[10px] text-muted-foreground">· {r.time}</span>
                  </div>
                  {r.current ? (
                    <Badge variant="secondary" className="h-5 text-[10px]"><CheckCircle2 className="mr-1 h-2.5 w-2.5" />Source</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]">Set as source</Button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Input placeholder="Manual override (mi)" className="h-7 text-xs" />
                <Button size="sm" className="h-7 text-xs">Override</Button>
              </div>
            </div>
          </ReviewRow>
          <ReviewRow label="Next PM" value="50,000 mi (in 2,168 mi)" source="Holman" time="12m ago" />
          <ReviewRow label="Road Ready" value="Ready · Grade A · Verified" source="TPMS" time="2h ago" />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">AMS Hierarchy</div>
        <div className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <div><div className="text-muted-foreground text-[10px]">TFD 421</div><div className="font-medium">R. Hayes</div></div>
            <div><div className="text-muted-foreground text-[10px]">DSM 88</div><div className="font-medium">L. Park</div></div>
            <div><div className="text-muted-foreground text-[10px]">TM 12</div><div className="font-medium">J. Diaz</div></div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lifecycle</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="text-[10px] text-muted-foreground">Lifetime Maint</div>
            <div className="font-semibold">$14,820</div>
          </div>
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="text-[10px] text-muted-foreground">Book Value</div>
            <div className="font-semibold">$32,400</div>
          </div>
          <div className="rounded-md border bg-card px-3 py-2">
            <div className="text-[10px] text-muted-foreground">Lease End</div>
            <div className="font-semibold">2026-08-31</div>
          </div>
        </div>
      </div>

      <Accordion type="multiple" className="border rounded-md">
        <AccordionItem value="po" className="border-b">
          <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
            <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> PO History (12)</span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-2 text-xs text-muted-foreground">
            Most recent: PO-88421 · Brake service · $612.40 · 6d ago
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="hist" className="border-b-0">
          <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
            <span className="flex items-center gap-2"><History className="h-3.5 w-3.5" /> Assignment History</span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-2 text-xs text-muted-foreground">
            Assigned to T8821 since 2024-06-12 · Previous: T8210 (Williams)
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function UpdatePane() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Pencil className="h-4 w-4" /> Update
        </h3>
        <p className="text-xs text-muted-foreground">
          Editable fields. Fleet-priority pinned (vehicle is not on rental).
        </p>
      </div>

      <div className="space-y-2">
        <UpdateRow label="Odometer" value="47,832 mi" hint="Last write: 4h ago" pinned />
        <UpdateRow label="Next PM" value="50,000 mi" hint="2,168 mi remaining" pinned />
        <UpdateRow label="Location" value="Sacramento, CA 95823" hint="Home location" />
        <UpdateRow label="Status" value="Assigned · Owned" />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs font-medium hover:bg-muted/60">
          <span className="flex items-center gap-2">
            <ChevronRight className="h-3.5 w-3.5" /> More fields (rental, branding, telematics)
          </span>
          <span className="text-[10px] text-muted-foreground">8 collapsed</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          <UpdateRow label="Rental End Date" value="—" hint="Not on rental" />
          <UpdateRow label="Vendor Contact" value="—" hint="Not on rental" />
          <UpdateRow label="Branding" value="Sears Home Services" />
          <UpdateRow label="Interior Configuration" value="Standard van" />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function AssignPane() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Assign
          </h3>
          <p className="text-xs text-muted-foreground">Assign a technician across TPMS, Holman, and AMS.</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <RefreshCw className="mr-1 h-3 w-3" /> Resync
        </Button>
      </div>

      <div className="rounded-md border bg-card p-3 space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New assignment</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[11px]">Tech LDAP</Label>
            <Input placeholder="e.g. T8821" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px]">Tech Name</Label>
            <Input placeholder="auto-fills" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px]">District</Label>
            <Input placeholder="auto-fills" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px]">Assignment Type</Label>
            <Select defaultValue="assigned">
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="temp">Temporary</SelectItem>
                <SelectItem value="dummy">Dummy</SelectItem>
                <SelectItem value="in-repair">In Repair</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" className="w-full h-8 text-xs"><UserPlus className="mr-1 h-3 w-3" /> Assign Technician</Button>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current readouts</div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "TPMS",   icon: Link2,    color: "text-purple-500",  authoritative: true },
            { label: "Holman", icon: Truck,    color: "text-blue-500",    authoritative: false },
            { label: "AMS",    icon: Database, color: "text-emerald-500", authoritative: false },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-md border bg-card px-2.5 py-2 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-3 w-3 ${s.color}`} />
                  <span className="text-[11px] font-medium">{s.label}</span>
                  {s.authoritative && <span className="rounded bg-purple-500/15 px-1 text-[9px] font-semibold text-purple-700 dark:text-purple-300">auth</span>}
                </div>
                <div className="text-xs font-medium leading-tight">Marcus Chen</div>
                <div className="font-mono text-[10px] text-muted-foreground">T8821</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UnassignPane() {
  const [reason, setReason] = useState<string>("");
  const canUnassign = reason !== "";
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <UserX className="h-4 w-4" /> Unassign
        </h3>
        <p className="text-xs text-muted-foreground">Remove the current technician across all systems.</p>
      </div>

      <div className="rounded-md border bg-card p-3 space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Currently Assigned</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Marcus Chen</div>
            <div className="font-mono text-[11px] text-muted-foreground">T8821 · Since 2024-06-12</div>
          </div>
          <Badge variant="secondary" className="text-[10px]">All systems aligned</Badge>
        </div>
      </div>

      <div className="rounded-md border bg-card p-3 space-y-3">
        <div>
          <Label className="text-[11px] flex items-center gap-1">
            Reason for Unassignment <span className="text-red-500">*</span>
          </Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resignation">Resignation</SelectItem>
              <SelectItem value="vehicle-repair">Vehicle Repair</SelectItem>
              <SelectItem value="termination">Termination</SelectItem>
              <SelectItem value="reassignment">Reassignment</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          {!canUnassign && (
            <p className="mt-1 text-[10px] text-muted-foreground">Required before unassign is enabled.</p>
          )}
        </div>

        <div>
          <Label className="text-[11px]">Notes (optional)</Label>
          <Input placeholder="Additional context…" className="h-8 text-xs mt-1" />
        </div>

        <Button size="sm" variant="destructive" disabled={!canUnassign} className="w-full h-8 text-xs">
          <UserX className="mr-1 h-3 w-3" /> Unassign Technician
        </Button>
      </div>
    </div>
  );
}

export function Rail() {
  const [active, setActive] = useState<Region>("review");

  return (
    <div className="h-screen w-full overflow-hidden bg-background border-l flex flex-col">
      {/* Header — spans both columns */}
      <div className="border-b bg-card/50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md border bg-background p-2">
              <Truck className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold leading-tight">Vehicle #28471</h2>
                <Badge variant="default" className="h-5 text-[10px]">Assigned</Badge>
                <Badge variant="secondary" className="h-5 text-[10px]">Owned</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">2022 Ford Transit 350 HD</p>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Sacramento, CA</span>
                <span>West · Sacramento Metro</span>
                <span>CC 4421</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body — rail + active pane */}
      <div className="flex-1 flex min-h-0">
        {/* Rail */}
        <nav className="w-[68px] shrink-0 border-r bg-muted/30 flex flex-col py-2">
          {RAIL.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                title={item.desc}
                className={`relative mx-1.5 my-0.5 flex flex-col items-center gap-1 rounded-md px-1 py-2.5 text-[10px] font-medium transition-colors ${
                  isActive
                    ? "bg-background text-foreground border shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 -translate-x-1.5 rounded-r bg-primary" />
                )}
                <Icon className="h-4 w-4" />
                <span className="leading-tight">{item.label}</span>
              </button>
            );
          })}

          <div className="mt-auto border-t mx-2 pt-2 flex flex-col items-center gap-1.5">
            <button title="History" className="rounded-md p-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <History className="h-4 w-4" />
            </button>
            <button title="Inventory" className="rounded-md p-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <Package className="h-4 w-4" />
            </button>
            <button title="Telematics" className="rounded-md p-1.5 text-muted-foreground hover:bg-background/60 hover:text-foreground">
              <Gauge className="h-4 w-4" />
            </button>
          </div>
        </nav>

        {/* Active pane */}
        <main className="flex-1 overflow-y-auto p-4">
          {active === "review"   && <ReviewPane />}
          {active === "update"   && <UpdatePane />}
          {active === "assign"   && <AssignPane />}
          {active === "unassign" && <UnassignPane />}
        </main>
      </div>
    </div>
  );
}
