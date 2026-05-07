import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Truck,
  UserPlus,
  UserX,
  RefreshCw,
  Link2,
  FileText,
  History,
  AlertTriangle,
  ChevronDown,
  X,
  Eye,
  Pencil,
  Database,
  CheckCircle2,
  Gauge,
  MapPin,
  Wrench,
  DollarSign,
  Clock,
  ArrowDown,
} from "lucide-react";

function FreshnessChip({ source, time }: { source: string; time: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Clock className="h-2.5 w-2.5" />
      {source} · {time}
    </span>
  );
}

function ReviewRow({
  label,
  value,
  source,
  time,
  icon,
  children,
}: {
  label: string;
  value: React.ReactNode;
  source?: string;
  time?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {icon && <div className="mt-0.5 text-muted-foreground">{icon}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
          {children}
        </div>
      </div>
      {source && time && <FreshnessChip source={source} time={time} />}
    </div>
  );
}

function UpdateRow({
  label,
  value,
  hint,
  pinned,
}: {
  label: string;
  value: string;
  hint?: string;
  pinned?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {pinned && (
          <Badge
            variant="outline"
            className="h-4 border-amber-300 bg-amber-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300"
          >
            Pinned · Fleet
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input defaultValue={value} className="h-8 text-sm" />
        <Button size="sm" variant="ghost" className="h-8 px-2">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function SectionHeader({
  id,
  title,
  subtitle,
  icon,
  className,
  iconClassName,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  className: string;
  iconClassName: string;
}) {
  return (
    <div id={id} className={`scroll-mt-14 rounded-md border px-3 py-2.5 ${className}`}>
      <div className="flex items-center gap-2.5">
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${iconClassName}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold leading-tight tracking-tight">{title}</div>
          <div className="text-[11px] opacity-80">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}

export function Stacked() {
  return (
    <div className="h-screen w-full overflow-y-auto bg-background border-l">
      {/* Header strip */}
      <div className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold leading-tight text-foreground">
                Vehicle #28471
              </h2>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                Assigned
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                Owned
              </Badge>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              2022 Ford Transit 350 HD · VIN 1FTBR1Y89NKA12345
            </div>
          </div>

          {/* Region jump rail */}
          <nav className="hidden items-center gap-1 sm:flex">
            <a
              href="#region-review"
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              data-testid="link-jump-review"
            >
              Review
            </a>
            <a
              href="#region-update"
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950/40"
              data-testid="link-jump-update"
            >
              Update
            </a>
            <a
              href="#region-assign"
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              data-testid="link-jump-assign"
            >
              Assign
            </a>
            <a
              href="#region-unassign"
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950/40"
              data-testid="link-jump-unassign"
            >
              Unassign
            </a>
          </nav>

          <Button variant="ghost" size="icon" className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mini summary bar */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Sacramento, CA 95823
          </span>
          <span>·</span>
          <span>West / Sacramento Metro · CC 4421</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Road Ready · Grade A
          </span>
        </div>
      </div>

      <div className="space-y-5 px-4 pb-12 pt-4">
        {/* ───────────── REVIEW ───────────── */}
        <section className="space-y-2">
          <SectionHeader
            id="region-review"
            title="REVIEW"
            subtitle="Read-only context · single source of truth per row"
            icon={<Eye className="h-4 w-4" />}
            className="border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
            iconClassName="bg-slate-700 text-white dark:bg-slate-600"
          />

          <Card className="px-3 py-1.5">
            <ReviewRow
              icon={<Truck className="h-3.5 w-3.5" />}
              label="Identity"
              value={
                <div className="space-y-0.5">
                  <div>2022 Ford Transit 350 HD · White</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    Plate 8XYZ123 (CA) · VIN 1FTBR1Y89NKA12345
                  </div>
                </div>
              }
              source="Holman"
              time="12m ago"
            />

            <ReviewRow
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Location"
              value="Sacramento, CA 95823 · West / Sacramento Metro · CC 4421"
              source="Snowflake"
              time="4h ago"
            />

            {/* Mismatched odometer with per-system disclosure */}
            <div className="border-b py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Gauge className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Odometer
                      </span>
                      <Badge
                        variant="outline"
                        className="h-4 gap-1 border-amber-400 bg-amber-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" /> Mismatched
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-foreground">
                      47,832 mi
                    </div>
                  </div>
                </div>
                <FreshnessChip source="Snowflake" time="4h ago" />
              </div>

              <div className="mt-2 ml-5 rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900/40 dark:bg-amber-950/20">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Per-system values
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Database className="h-3 w-3 text-blue-600" />
                      <span className="font-medium">Snowflake</span>
                      <span className="text-muted-foreground">47,832 mi</span>
                      <Badge className="h-4 bg-emerald-600 px-1 text-[9px] hover:bg-emerald-600">
                        Source
                      </Badge>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                      Set as source
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Wrench className="h-3 w-3 text-purple-600" />
                      <span className="font-medium">AMS</span>
                      <span className="text-muted-foreground">47,201 mi</span>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">
                      Set as source
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <Input
                      placeholder="Manual override (mi)"
                      className="h-7 text-xs"
                    />
                    <Button size="sm" className="h-7 px-2 text-[11px]">
                      Override
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <ReviewRow
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Road Ready"
              value={
                <span className="inline-flex items-center gap-2">
                  Ready
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    Grade A
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-4 border-emerald-400 px-1 text-[10px] text-emerald-700 dark:text-emerald-300"
                  >
                    Verified
                  </Badge>
                </span>
              }
              source="Holman"
              time="12m ago"
            />

            <ReviewRow
              icon={<Wrench className="h-3.5 w-3.5" />}
              label="Next PM"
              value="50,000 mi · in 2,168 mi"
            />

            <ReviewRow
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Lifecycle"
              value={
                <div className="text-xs font-normal text-muted-foreground">
                  <span className="text-sm font-medium text-foreground">
                    Lifetime Maint $14,820
                  </span>
                  {" · "}Book Value $32,400 · Lease End 2026-08-31
                </div>
              }
              source="AMS"
              time="1d ago"
            />
          </Card>

          <Accordion type="multiple" className="rounded-md border bg-card px-3">
            <AccordionItem value="ams" className="border-b">
              <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-wide">
                <span className="inline-flex items-center gap-2">
                  <Database className="h-3.5 w-3.5" /> AMS Info — Ownership, Condition, Repair Updates
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Ownership: Owned · Condition: Good · Last repair update 6d ago — "Brake inspection complete, pads at 60%."
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="po" className="border-b">
              <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-wide">
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" /> PO History (12 records)
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Last PO: #PO-88291 · $412.50 · Tire rotation · 2026-02-10
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="hist" className="border-0">
              <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-wide">
                <span className="inline-flex items-center gap-2">
                  <History className="h-3.5 w-3.5" /> History &amp; Telematics
                </span>
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Last GPS ping 8m ago · Sacramento, CA. Assignment unchanged for 142 days.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <Separator className="h-1 rounded bg-border" />

        {/* ───────────── UPDATE ───────────── */}
        <section className="space-y-2">
          <SectionHeader
            id="region-update"
            title="UPDATE"
            subtitle="Editable fields · Fleet-priority pinned (vehicle is not in Rental)"
            icon={<Pencil className="h-4 w-4" />}
            className="border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100"
            iconClassName="bg-amber-600 text-white"
          />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <UpdateRow
              label="Odometer"
              value="47,832"
              hint="Last set from Snowflake · 4h ago"
              pinned
            />
            <UpdateRow
              label="Next PM (mi)"
              value="50,000"
              hint="Triggers PM workflow at 49,500"
              pinned
            />
            <UpdateRow label="Color" value="White" />
            <UpdateRow label="License Plate" value="8XYZ123 (CA)" />
          </div>

          <Accordion type="single" collapsible className="rounded-md border bg-card px-3">
            <AccordionItem value="more" className="border-0">
              <AccordionTrigger className="py-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-2">
                  <ChevronDown className="h-3.5 w-3.5" /> More fields (8)
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 gap-2 pb-1 sm:grid-cols-2">
                  <UpdateRow
                    label="Rental End Date"
                    value="—"
                    hint="Pinned when vehicle is in Rental state"
                  />
                  <UpdateRow label="Vendor Contact" value="—" />
                  <UpdateRow label="Branding" value="Sears Home Services" />
                  <UpdateRow label="Interior Config" value="Standard Cargo" />
                  <UpdateRow label="Vehicle Program" value="Owned Fleet" />
                  <UpdateRow label="Tune Status" value="Stock" />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <Separator className="h-1 rounded bg-border" />

        {/* ───────────── ASSIGN ───────────── */}
        <section className="space-y-2">
          <SectionHeader
            id="region-assign"
            title="ASSIGN"
            subtitle="Assign tech inline · current TPMS / Holman / AMS readouts"
            icon={<UserPlus className="h-4 w-4" />}
            className="border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-100"
            iconClassName="bg-emerald-600 text-white"
          />

          <Card className="space-y-3 p-3">
            {/* Current readouts */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  <Truck className="h-3 w-3" /> Holman
                </div>
                <div className="mt-1 text-sm font-medium leading-tight">Marcus Chen</div>
                <div className="text-[11px] font-mono text-muted-foreground">T8821</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
                  <Link2 className="h-3 w-3" /> TPMS
                  <Badge className="h-3.5 bg-purple-600 px-1 text-[8px] hover:bg-purple-600">
                    auth
                  </Badge>
                </div>
                <div className="mt-1 text-sm font-medium leading-tight">Marcus Chen</div>
                <div className="text-[11px] font-mono text-muted-foreground">T8821</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  <Database className="h-3 w-3" /> AMS
                </div>
                <div className="mt-1 text-sm font-medium leading-tight">Marcus Chen</div>
                <div className="text-[11px] font-mono text-muted-foreground">8821</div>
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">AMS chain:</span>{" "}
              TFD 421 (R. Hayes) · DSM 88 (L. Park) · TM 12 (J. Diaz)
            </div>

            <Separator />

            {/* Assign form */}
            <div className="space-y-2">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Assign New Tech
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="LDAP / Tech ID" className="h-8 text-sm" />
                <Input placeholder="Tech name" className="h-8 text-sm" />
                <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700">
                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                  Assign
                </Button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Writes to TPMS · syncs Holman + AMS in background.</span>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                  <RefreshCw className="mr-1 h-3 w-3" /> Resync
                </Button>
              </div>
            </div>
          </Card>
        </section>

        <Separator className="h-1 rounded bg-border" />

        {/* ───────────── UNASSIGN ───────────── */}
        <section className="space-y-2">
          <SectionHeader
            id="region-unassign"
            title="UNASSIGN"
            subtitle="Remove tech assignment · reason required"
            icon={<UserX className="h-4 w-4" />}
            className="border-red-300 bg-red-100 text-red-950 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-100"
            iconClassName="bg-red-600 text-white"
          />

          <Card className="space-y-3 p-3">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Currently Assigned
                </div>
                <div className="text-sm font-medium">Marcus Chen · T8821</div>
              </div>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                Active 142d
              </Badge>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="reason"
                className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Reason for Unassignment
                <span className="text-red-600">*</span>
              </Label>
              <Select>
                <SelectTrigger id="reason" className="h-8 text-sm">
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
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Notes (optional)
              </Label>
              <Input placeholder="Optional context for audit log…" className="h-8 text-sm" />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground">
                Writes to TPMS · removes from Holman + AMS.
              </span>
              <Button size="sm" variant="destructive" className="h-8">
                <UserX className="mr-1 h-3.5 w-3.5" /> Unassign Tech
              </Button>
            </div>
          </Card>
        </section>

        <div className="pt-2 text-center text-[10px] text-muted-foreground">
          <ArrowDown className="mx-auto mb-1 h-3 w-3" />
          End of vehicle workspace
        </div>
      </div>
    </div>
  );
}
