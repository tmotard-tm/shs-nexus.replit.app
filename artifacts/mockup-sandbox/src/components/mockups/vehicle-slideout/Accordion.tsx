import { useState } from "react";
import {
  Accordion as UIAccordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  Pencil,
  Clock,
  Database,
  CheckCircle2,
  Gauge,
  MapPin,
  Wrench,
  Search,
} from "lucide-react";

function FreshnessChip({ source, ago }: { source: string; ago: string }) {
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
  mono,
}: {
  label: string;
  value: React.ReactNode;
  source?: string;
  ago?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={`text-sm text-foreground ${mono ? "font-mono" : ""}`}
        >
          {value}
        </div>
      </div>
      {source && ago && (
        <div className="pt-3.5">
          <FreshnessChip source={source} ago={ago} />
        </div>
      )}
    </div>
  );
}

function MismatchedRow() {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Odometer
            </span>
            <Badge
              variant="outline"
              className="h-4 gap-1 border-amber-400 bg-amber-100 px-1 text-[9px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              MISMATCHED
            </Badge>
          </div>
          <div className="text-sm font-medium text-foreground">
            47,832 mi
          </div>
        </div>
        <div className="flex items-center gap-2 pt-3.5">
          <FreshnessChip source="Snowflake" ago="4h ago" />
          <CollapsibleTriggerLike open={open} setOpen={setOpen} />
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 rounded border bg-background p-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Database className="h-3 w-3 text-emerald-500" />
              <span className="font-medium">Snowflake</span>
              <span className="text-muted-foreground">47,832 mi</span>
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[9px] font-semibold"
              >
                CANONICAL
              </Badge>
            </div>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
              Set as source
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Database className="h-3 w-3 text-blue-500" />
              <span className="font-medium">AMS</span>
              <span className="text-muted-foreground">47,201 mi</span>
              <span className="text-[10px] text-muted-foreground">
                · 1d ago
              </span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
              Set as source
            </Button>
          </div>
          <Separator className="my-1" />
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">
              Manual override
            </Label>
            <Input
              placeholder="Enter value…"
              className="h-7 flex-1 text-xs"
            />
            <Button size="sm" className="h-7 px-2 text-[11px]">
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsibleTriggerLike({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => setOpen(!open)}
      className="inline-flex h-6 items-center gap-1 rounded border bg-background px-1.5 text-[10px] text-muted-foreground hover:bg-accent"
    >
      Per-system
      <ChevronDown
        className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function UpdateRow({
  label,
  value,
  pinned,
  hint,
}: {
  label: string;
  value: string;
  pinned?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </Label>
          {pinned && (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[9px] font-semibold"
            >
              PINNED
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">
          <Pencil className="mr-1 h-3 w-3" />
          Edit
        </Button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Input defaultValue={value} className="h-7 flex-1 text-xs" />
      </div>
      {hint && (
        <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function SystemReadout({
  label,
  techId,
  techName,
  color,
}: {
  label: string;
  techId: string;
  techName: string;
  color: string;
}) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <Link2 className={`h-3 w-3 ${color}`} />
        <span className={`text-[10px] font-semibold uppercase ${color}`}>
          {label}
        </span>
      </div>
      <div className="mt-0.5 text-xs font-medium">{techName}</div>
      <div className="font-mono text-[10px] text-muted-foreground">
        {techId}
      </div>
    </div>
  );
}

export function Accordion() {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="h-screen w-full overflow-y-auto bg-background border-l">
      {/* Header strip */}
      <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted/40 p-2">
              <Truck className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold leading-tight">
                  Vehicle #28471
                </h2>
                <Badge className="h-5 bg-emerald-600 px-1.5 text-[10px] hover:bg-emerald-600">
                  Assigned
                </Badge>
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px]"
                >
                  Owned
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                2022 Ford Transit 350 HD
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-mono">1FTBR1Y89NKA12345</span>
                <span>·</span>
                <span>8XYZ123 (CA)</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Accordion regions */}
      <div className="px-3 py-2">
        <UIAccordion
          type="multiple"
          defaultValue={["review"]}
          className="space-y-2"
        >
          {/* REVIEW */}
          <AccordionItem
            value="review"
            className="rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex w-full items-center justify-between pr-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">REVIEW</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  6 fields · 1 mismatched
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="divide-y">
                <ReviewRow
                  label="Location"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      Sacramento, CA 95823
                    </span>
                  }
                  source="Holman"
                  ago="12m ago"
                />
                <ReviewRow
                  label="Region / District"
                  value="West / Sacramento Metro · CC 4421"
                />
                <ReviewRow label="Color" value="White" />
                <div className="py-1.5">
                  <MismatchedRow />
                </div>
                <ReviewRow
                  label="Road Ready"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Ready · Grade A · Verified
                    </span>
                  }
                  source="AMS"
                  ago="2h ago"
                />
                <ReviewRow
                  label="AMS TFD / DSM / TM"
                  value={
                    <span className="text-sm">
                      <span className="font-mono">421</span> R. Hayes ·{" "}
                      <span className="font-mono">88</span> L. Park ·{" "}
                      <span className="font-mono">12</span> J. Diaz
                    </span>
                  }
                />
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <History className="h-3 w-3" />
                  Last PO #PO-44821 · 3d ago
                </span>
                <Button variant="link" size="sm" className="h-auto p-0 text-[11px]">
                  View PO history →
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* UPDATE */}
          <AccordionItem
            value="update"
            className="rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex w-full items-center justify-between pr-2">
                <div className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">UPDATE</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  3 editable fields, 1 mismatched
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Fleet · Pinned
                </div>
                <UpdateRow
                  label="Odometer"
                  value="47,832"
                  pinned
                  hint="Mismatched with AMS (47,201). Resolve in Review."
                />
                <UpdateRow
                  label="Next PM"
                  value="50,000 mi"
                  pinned
                  hint="Due in 2,168 mi"
                />
                <UpdateRow label="Color" value="White" />
              </div>

              <Collapsible
                open={moreOpen}
                onOpenChange={setMoreOpen}
                className="mt-3"
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-full justify-between text-[11px]"
                  >
                    <span className="inline-flex items-center gap-1">
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${
                          moreOpen ? "rotate-180" : ""
                        }`}
                      />
                      More fields (5)
                    </span>
                    <span className="text-muted-foreground">
                      Rental, Lifecycle, Cost
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  <UpdateRow label="Rental End Date" value="—" />
                  <UpdateRow label="Vendor Contact" value="—" />
                  <UpdateRow label="Lease End" value="2026-08-31" />
                  <UpdateRow label="Lifetime Maint Cost" value="$14,820" />
                  <UpdateRow label="Book Value" value="$32,400" />
                </CollapsibleContent>
              </Collapsible>
            </AccordionContent>
          </AccordionItem>

          {/* ASSIGN */}
          <AccordionItem
            value="assign"
            className="rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex w-full items-center justify-between pr-2">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">ASSIGN</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Assigned to Marcus Chen (T8821)
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="grid grid-cols-3 gap-2">
                <SystemReadout
                  label="TPMS"
                  techId="T8821"
                  techName="Marcus Chen"
                  color="text-purple-600 dark:text-purple-400"
                />
                <SystemReadout
                  label="Holman"
                  techId="T8821"
                  techName="Marcus Chen"
                  color="text-blue-600 dark:text-blue-400"
                />
                <SystemReadout
                  label="AMS"
                  techId="8821"
                  techName="Marcus Chen"
                  color="text-emerald-600 dark:text-emerald-400"
                />
              </div>
              <Separator className="my-3" />
              <div className="space-y-2">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Assign new tech
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="LDAP or tech name…"
                      className="h-8 pl-7 text-xs"
                    />
                  </div>
                  <Button size="sm" className="h-8 text-xs">
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    Assign
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Resync
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Resync re-checks TPMS + Holman APIs for the latest assignment
                  state.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* UNASSIGN */}
          <AccordionItem
            value="unassign"
            className="rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex w-full items-center justify-between pr-2">
                <div className="flex items-center gap-2">
                  <UserX className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">UNASSIGN</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Unassign Marcus Chen · reason required
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="rounded-md border bg-muted/20 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    Currently assigned:{" "}
                    <span className="font-medium">Marcus Chen</span>{" "}
                    <span className="font-mono text-muted-foreground">
                      (T8821)
                    </span>
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Reason for Unassignment <span className="text-red-500">*</span>
                </Label>
                <Select>
                  <SelectTrigger className="h-8 text-xs">
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
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Notes (optional)
                </Label>
                <Input
                  placeholder="Add context…"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 w-full text-xs"
                >
                  <UserX className="mr-1 h-3.5 w-3.5" />
                  Unassign Tech
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Disabled when no tech is assigned. Reason is written to the
                  vehicle history log.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </UIAccordion>
        <div className="h-4" />
      </div>
    </div>
  );
}
