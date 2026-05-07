import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  X,
  RefreshCw,
  AlertTriangle,
  Link2,
  Database,
  FileText,
  History,
  UserPlus,
  UserX,
  Pencil,
  ChevronRight,
  CheckCircle2,
  MapPin,
  Gauge,
  Wrench,
  ShieldCheck,
  Clock,
} from "lucide-react";

function FreshChip({ source, ago }: { source: string; ago: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Clock className="h-2.5 w-2.5" />
      {source} · {ago}
    </span>
  );
}

function ReviewRow({
  label,
  value,
  source,
  ago,
  icon,
  children,
}: {
  label: string;
  value: React.ReactNode;
  source?: string;
  ago?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2 hover:bg-muted/30 border-b last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
          <span className="text-sm font-medium text-foreground truncate">{value}</span>
        </div>
        {source && ago && <FreshChip source={source} ago={ago} />}
      </div>
      {children}
    </div>
  );
}

function MismatchRow() {
  const [open, setOpen] = useState(true);
  return (
    <div className="px-3 py-2 border-b bg-amber-50/40 dark:bg-amber-950/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground w-28 shrink-0">Odometer</span>
          <span className="text-sm font-medium">47,832 mi</span>
          <Badge
            variant="outline"
            className="h-5 gap-1 border-amber-500/50 bg-amber-100/60 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            mismatched
          </Badge>
        </div>
        <FreshChip source="Snowflake" ago="4h ago" />
      </div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-1 ml-[136px] inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {open ? "Hide" : "Show"} per-system values
      </button>
      {open && (
        <div className="mt-2 ml-[136px] space-y-1.5 rounded border bg-background p-2">
          {[
            { src: "Snowflake", val: "47,832 mi", active: true, ago: "4h ago" },
            { src: "AMS", val: "47,201 mi", active: false, ago: "1d ago" },
            { src: "Holman", val: "47,810 mi", active: false, ago: "12m ago" },
          ].map((row) => (
            <div
              key={row.src}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <Database className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium w-20">{row.src}</span>
                <span className="text-muted-foreground">{row.val}</span>
                <span className="text-[10px] text-muted-foreground">· {row.ago}</span>
                {row.active && (
                  <Badge className="h-4 bg-emerald-600 text-[9px] hover:bg-emerald-600">
                    SOURCE
                  </Badge>
                )}
              </div>
              {!row.active && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                >
                  Set as source
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t">
            <Label className="text-[10px] text-muted-foreground w-20">
              Override
            </Label>
            <Input className="h-6 text-xs" placeholder="Manual value…" />
            <Button size="sm" className="h-6 px-2 text-[10px]">
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UpdateRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="px-3 py-2 border-b last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground w-32 shrink-0">
          {label}
        </Label>
        <div className="relative flex-1">
          <Input defaultValue={value} className="h-8 text-sm pr-7" />
          <Pencil className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        </div>
      </div>
      {hint && (
        <p className="ml-32 mt-1 text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function SystemReadout({
  label,
  color,
  techId,
  techName,
}: {
  label: string;
  color: string;
  techId: string;
  techName: string;
}) {
  return (
    <div className="rounded border bg-background p-2">
      <div className={`flex items-center gap-1 text-[10px] font-medium ${color}`}>
        <Link2 className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1 text-xs font-medium leading-tight">{techName}</p>
      <p className="text-[10px] font-mono text-muted-foreground">{techId}</p>
    </div>
  );
}

export function Tabbed() {
  const [tab, setTab] = useState("review");
  const [reason, setReason] = useState("");

  return (
    <div className="h-screen w-full overflow-hidden bg-background border-l flex flex-col">
      {/* Header strip */}
      <div className="shrink-0 border-b">
        <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md border bg-muted/50 p-2">
              <Truck className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold leading-tight">
                  Vehicle #28471
                </h2>
                <Badge variant="secondary" className="h-5 text-[10px]">
                  Assigned
                </Badge>
                <Badge variant="outline" className="h-5 text-[10px]">
                  Owned
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                2022 Ford Transit 350 HD · VIN 1FTBR1Y89NKA12345
              </p>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  Sacramento, CA 95823
                </span>
                <span>·</span>
                <span>West / Sacramento Metro · CC 4421</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="shrink-0 border-b bg-muted/20 px-3 py-1.5">
          <TabsList className="h-9 w-full grid grid-cols-4 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="review"
              className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1"
            >
              <FileText className="h-3 w-3" />
              Review
            </TabsTrigger>
            <TabsTrigger
              value="update"
              className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1 relative"
            >
              <Pencil className="h-3 w-3" />
              Update
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
            </TabsTrigger>
            <TabsTrigger
              value="assign"
              className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1"
            >
              <UserPlus className="h-3 w-3" />
              Assign
            </TabsTrigger>
            <TabsTrigger
              value="unassign"
              className="text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm gap-1"
            >
              <UserX className="h-3 w-3" />
              Unassign
            </TabsTrigger>
          </TabsList>
        </div>

        {/* REVIEW */}
        <TabsContent
          value="review"
          className="flex-1 overflow-y-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <div className="p-3 space-y-3">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Identity
              </h3>
              <div className="rounded-md border bg-card">
                <ReviewRow
                  icon={<Truck className="h-3.5 w-3.5" />}
                  label="Make / Model"
                  value="Ford Transit 350 HD · 2022"
                  source="Holman"
                  ago="12m ago"
                />
                <ReviewRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="License Plate"
                  value="8XYZ123 (CA)"
                />
                <ReviewRow
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  label="Color"
                  value="White"
                />
                <ReviewRow
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  label="Road Ready"
                  value={
                    <span className="inline-flex items-center gap-1">
                      Ready · Grade A
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Verified
                    </span>
                  }
                  source="AMS"
                  ago="2h ago"
                />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Telematics & Maintenance
              </h3>
              <div className="rounded-md border bg-card">
                <MismatchRow />
                <ReviewRow
                  icon={<Wrench className="h-3.5 w-3.5" />}
                  label="Next PM"
                  value="50,000 mi (in 2,168 mi)"
                  source="Holman"
                  ago="12m ago"
                />
                <ReviewRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Lifetime Maint"
                  value="$14,820"
                />
                <ReviewRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Book Value"
                  value="$32,400"
                />
                <ReviewRow
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label="Lease End"
                  value="2026-08-31"
                />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                AMS Org
              </h3>
              <div className="rounded-md border bg-card">
                <ReviewRow label="TFD" value="421 · R. Hayes" />
                <ReviewRow label="DSM" value="88 · L. Park" />
                <ReviewRow label="TM" value="12 · J. Diaz" />
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                History
              </h3>
              <div className="rounded-md border bg-card divide-y">
                <button className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30">
                  <span className="inline-flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    PO History (12)
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30">
                  <span className="inline-flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    Assignment History
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* UPDATE */}
        <TabsContent
          value="update"
          className="flex-1 overflow-y-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/10 p-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span className="text-amber-800 dark:text-amber-300">
                Pending mismatch: Odometer differs between Snowflake and AMS.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] ml-auto"
                onClick={() => setTab("review")}
              >
                Resolve
              </Button>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1 flex items-center gap-1">
                Pinned (Fleet)
                <Badge variant="outline" className="h-4 text-[9px]">
                  prioritized
                </Badge>
              </h3>
              <div className="rounded-md border bg-card">
                <UpdateRow
                  label="Odometer"
                  value="47,832"
                  hint="Last reading from Snowflake · 4h ago"
                />
                <UpdateRow label="Next PM" value="50,000" />
                <UpdateRow label="Color" value="White" />
                <UpdateRow label="Location ZIP" value="95823" />
              </div>
            </div>

            <Accordion type="single" collapsible>
              <AccordionItem value="more" className="border rounded-md bg-card">
                <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                  More fields (Rental, Lease, Org)
                </AccordionTrigger>
                <AccordionContent className="p-0">
                  <UpdateRow label="Rental End Date" value="—" hint="Vehicle is Fleet, not Rental" />
                  <UpdateRow label="Vendor Contact" value="—" />
                  <UpdateRow label="License Plate" value="8XYZ123" />
                  <UpdateRow label="Cost Center" value="4421" />
                  <UpdateRow label="Lease End" value="2026-08-31" />
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs">
                Save changes
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ASSIGN */}
        <TabsContent
          value="assign"
          className="flex-1 overflow-y-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <div className="p-3 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Current Assignments
                </h3>
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px]">
                  <RefreshCw className="h-3 w-3" />
                  Resync
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SystemReadout
                  label="TPMS"
                  color="text-purple-600 dark:text-purple-400"
                  techId="T8821"
                  techName="Marcus Chen"
                />
                <SystemReadout
                  label="Holman"
                  color="text-blue-600 dark:text-blue-400"
                  techId="T8821"
                  techName="Marcus Chen"
                />
                <SystemReadout
                  label="AMS"
                  color="text-emerald-600 dark:text-emerald-400"
                  techId="8821"
                  techName="Marcus Chen"
                />
              </div>
              <p className="mt-1.5 px-1 inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                All systems aligned
              </p>
            </div>

            <Separator />

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                Assign New Tech
              </h3>
              <div className="rounded-md border bg-card p-3 space-y-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">Tech LDAP / Employee ID</Label>
                  <Input className="h-8 text-sm" placeholder="e.g. T8821" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tech Name</Label>
                  <Input className="h-8 text-sm" placeholder="Auto-fills from lookup" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">District</Label>
                    <Input className="h-8 text-sm" defaultValue="Sacramento Metro" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select defaultValue="assigned">
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="assigned">Assigned</SelectItem>
                        <SelectItem value="temp">Temp</SelectItem>
                        <SelectItem value="dummy">Dummy</SelectItem>
                        <SelectItem value="in-repair">In-Repair</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    Cancel
                  </Button>
                  <Button size="sm" className="h-7 text-xs gap-1">
                    <UserPlus className="h-3 w-3" />
                    Assign Tech
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* UNASSIGN */}
        <TabsContent
          value="unassign"
          className="flex-1 overflow-y-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <div className="p-3 space-y-3">
            <div className="rounded-md border bg-card p-3">
              <div className="flex items-center gap-2 mb-2">
                <UserX className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    Currently assigned to Marcus Chen
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    T8821 · since Jan 14, 2026 · TPMS + Holman + AMS
                  </p>
                </div>
              </div>
              <Separator className="my-2" />
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Reason for Unassignment
                    <span className="text-red-500 ml-0.5">*</span>
                  </Label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select a reason…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resignation">Resignation</SelectItem>
                      <SelectItem value="vehicle-repair">
                        Vehicle Repair
                      </SelectItem>
                      <SelectItem value="termination">Termination</SelectItem>
                      <SelectItem value="reassignment">Reassignment</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {!reason && (
                    <p className="text-[10px] text-muted-foreground">
                      Required before unassigning.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input className="h-8 text-sm" placeholder="Add context…" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" className="h-7 text-xs">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!reason}
                    className="h-7 text-xs gap-1"
                  >
                    <UserX className="h-3 w-3" />
                    Unassign
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground px-1">
              Unassign disabled when no tech is assigned. Reason syncs to AMS audit
              trail.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
