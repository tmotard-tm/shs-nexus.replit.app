import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  ChevronRight,
  X,
  Pencil,
  Check,
  Database,
  MapPin,
  Gauge,
  Wrench,
  Clock,
  ShieldCheck,
} from "lucide-react";

function FreshnessChip({ source, time }: { source: string; time: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
}: {
  label: string;
  value: React.ReactNode;
  source?: string;
  time?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2 hover:bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        {source && time && <FreshnessChip source={source} time={time} />}
      </div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

function UpdateRow({
  label,
  children,
  pinned,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  pinned?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        {pinned && (
          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
            PINNED · FLEET
          </Badge>
        )}
      </div>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TwoColumn() {
  const [mismatchOpen, setMismatchOpen] = useState(true);
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [unassignReason, setUnassignReason] = useState<string>("");

  return (
    <div className="h-screen w-full overflow-y-auto bg-background border-l text-foreground">
      {/* Header strip */}
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex items-start gap-3 px-4 pt-3 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted">
            <Truck className="h-5 w-5 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold leading-tight">
                Vehicle #28471
              </h2>
              <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                Assigned
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                Owned
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              2022 Ford Transit 350 HD · VIN 1FTBR1Y89NKA12345
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Action strip — Assign + Unassign + Status */}
        <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2">
          <Button
            size="sm"
            variant={assignOpen ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => {
              setAssignOpen(!assignOpen);
              if (!assignOpen) setUnassignOpen(false);
            }}
          >
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            Assign
            <ChevronDown
              className={`ml-1 h-3 w-3 transition-transform ${
                assignOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
          <Button
            size="sm"
            variant={unassignOpen ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => {
              setUnassignOpen(!unassignOpen);
              if (!unassignOpen) setAssignOpen(false);
            }}
          >
            <UserX className="mr-1 h-3.5 w-3.5" />
            Unassign
            <ChevronDown
              className={`ml-1 h-3 w-3 transition-transform ${
                unassignOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs">
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            Resync
          </Button>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Road Ready · Grade A
          </div>
        </div>

        {/* Inline Assign form */}
        {assignOpen && (
          <div className="border-t bg-background px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Assign Tech
              </span>
              <Button size="sm" variant="ghost" className="ml-auto h-6 text-[10px]">
                <RefreshCw className="mr-1 h-3 w-3" />
                Resync
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  LDAP / Tech ID
                </Label>
                <Input
                  defaultValue="T8821"
                  className="h-8 text-xs"
                  placeholder="e.g. T1234"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Name
                </Label>
                <Input
                  defaultValue="Marcus Chen"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 rounded border bg-muted/30 p-2">
              <div>
                <div className="flex items-center gap-1 text-[10px] font-medium uppercase text-blue-600 dark:text-blue-400">
                  <Truck className="h-3 w-3" /> Holman
                </div>
                <p className="text-xs font-medium">Marcus Chen</p>
                <p className="font-mono text-[10px] text-muted-foreground">T8821</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] font-medium uppercase text-purple-600 dark:text-purple-400">
                  <Link2 className="h-3 w-3" /> TPMS
                </div>
                <p className="text-xs font-medium">Marcus Chen</p>
                <p className="font-mono text-[10px] text-muted-foreground">T8821</p>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
                  <Database className="h-3 w-3" /> AMS
                </div>
                <p className="text-xs font-medium">Marcus Chen</p>
                <p className="font-mono text-[10px] text-muted-foreground">8821</p>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAssignOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs">
                <Check className="mr-1 h-3 w-3" /> Confirm Assign
              </Button>
            </div>
          </div>
        )}

        {/* Inline Unassign form */}
        {unassignOpen && (
          <div className="border-t bg-background px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <UserX className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Unassign Tech
              </span>
              <Badge variant="outline" className="ml-auto h-5 text-[10px]">
                Currently: T8821 · Marcus Chen
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">
                  Reason for Unassignment <span className="text-red-500">*</span>
                </Label>
                <Select value={unassignReason} onValueChange={setUnassignReason}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resignation">Resignation</SelectItem>
                    <SelectItem value="vehicle_repair">Vehicle Repair</SelectItem>
                    <SelectItem value="termination">Termination</SelectItem>
                    <SelectItem value="reassignment">Reassignment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setUnassignOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!unassignReason}
                >
                  <UserX className="mr-1 h-3 w-3" /> Confirm Unassign
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-[280px_1fr] gap-0">
        {/* REVIEW column */}
        <div className="border-r bg-muted/10">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 backdrop-blur">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Review
            </span>
            <span className="text-[10px] text-muted-foreground">read-only</span>
          </div>
          <div className="divide-y">
            <ReviewRow
              icon={<Truck className="h-3 w-3" />}
              label="Identity"
              value={
                <div className="space-y-0.5">
                  <p className="font-medium">2022 Ford Transit 350 HD · White</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    1FTBR1Y89NKA12345
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Plate 8XYZ123 (CA)
                  </p>
                </div>
              }
              source="AMS"
              time="1d ago"
            />

            {/* Mismatched Odometer row */}
            <Collapsible open={mismatchOpen} onOpenChange={setMismatchOpen}>
              <div className="px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Gauge className="h-3 w-3" />
                    Odometer
                  </div>
                  <FreshnessChip source="Snowflake" time="4h ago" />
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-sm font-medium">47,832 mi</span>
                  <CollapsibleTrigger asChild>
                    <button className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      mismatched
                      <ChevronDown
                        className={`h-2.5 w-2.5 transition-transform ${
                          mismatchOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="mt-2 space-y-1.5 rounded border bg-background p-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-4 items-center rounded bg-blue-100 px-1 text-[9px] font-semibold uppercase text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        Snowflake
                      </span>
                      <span className="text-xs font-medium">47,832 mi</span>
                      <Badge variant="secondary" className="ml-auto h-4 text-[9px]">
                        source
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-4 items-center rounded bg-emerald-100 px-1 text-[9px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        AMS
                      </span>
                      <span className="text-xs">47,201 mi</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-5 px-1.5 text-[9px]"
                      >
                        Set as source
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 pt-1">
                      <Input
                        placeholder="Manual override…"
                        className="h-6 text-[11px]"
                      />
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]">
                        Save
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            <ReviewRow
              icon={<MapPin className="h-3 w-3" />}
              label="Location"
              value={
                <div className="space-y-0.5">
                  <p>Sacramento, CA 95823</p>
                  <p className="text-[11px] text-muted-foreground">
                    West / Sacramento Metro · CC 4421
                  </p>
                </div>
              }
              source="Holman"
              time="12m ago"
            />

            <ReviewRow
              icon={<ShieldCheck className="h-3 w-3" />}
              label="Road Ready"
              value={
                <div className="flex items-center gap-1.5">
                  <Badge className="h-4 bg-emerald-600 px-1 text-[10px] hover:bg-emerald-600">
                    Ready
                  </Badge>
                  <span className="text-xs">Grade A · Verified</span>
                </div>
              }
              source="Parq.ai"
              time="2h ago"
            />

            <ReviewRow
              icon={<Wrench className="h-3 w-3" />}
              label="AMS Repair"
              value={
                <div className="space-y-0.5">
                  <p className="text-xs">No open repair orders</p>
                  <p className="text-[11px] text-muted-foreground">
                    Last PM 11/14/25 · 45,664 mi
                  </p>
                </div>
              }
            />

            <ReviewRow
              icon={<FileText className="h-3 w-3" />}
              label="AMS Hierarchy"
              value={
                <div className="space-y-0.5 text-[11px]">
                  <p>
                    <span className="text-muted-foreground">TFD:</span> 421 · R. Hayes
                  </p>
                  <p>
                    <span className="text-muted-foreground">DSM:</span> 88 · L. Park
                  </p>
                  <p>
                    <span className="text-muted-foreground">TM:</span> 12 · J. Diaz
                  </p>
                </div>
              }
            />

            <ReviewRow
              icon={<History className="h-3 w-3" />}
              label="PO History"
              value={
                <div className="space-y-0.5">
                  <p className="text-xs">12 POs · $14,820 lifetime</p>
                  <p className="text-[11px] text-muted-foreground">
                    Last PO 10/02/25 · $412
                  </p>
                </div>
              }
              source="AMS"
              time="6h ago"
            />

            <ReviewRow
              icon={<History className="h-3 w-3" />}
              label="History"
              value={
                <p className="text-[11px] text-muted-foreground">
                  4 prior assignments · in service since 03/14/22
                </p>
              }
            />
          </div>
        </div>

        {/* UPDATE column */}
        <div>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 backdrop-blur">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Update
            </span>
            <span className="text-[10px] text-muted-foreground">
              fleet context · pinned fields first
            </span>
          </div>

          <div className="space-y-4 p-4">
            {/* Pinned fleet fields */}
            <Card className="space-y-3 border-primary/20 bg-primary/5 p-3">
              <UpdateRow
                label="Odometer"
                pinned
                hint="Current canonical: 47,832 mi (Snowflake) · resolves mismatch above"
              >
                <div className="flex items-center gap-1">
                  <Input defaultValue="47,832" className="h-8 text-sm" />
                  <span className="text-xs text-muted-foreground">mi</span>
                  <Button size="sm" variant="ghost" className="h-8 px-2">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </UpdateRow>

              <UpdateRow
                label="Next PM Due"
                pinned
                hint="Auto-calculated · 2,168 mi remaining"
              >
                <div className="flex items-center gap-1">
                  <Input defaultValue="50,000" className="h-8 text-sm" />
                  <span className="text-xs text-muted-foreground">mi</span>
                  <Button size="sm" variant="ghost" className="h-8 px-2">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </UpdateRow>
            </Card>

            <UpdateRow label="Color">
              <Select defaultValue="white">
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="white">White</SelectItem>
                  <SelectItem value="black">Black</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                </SelectContent>
              </Select>
            </UpdateRow>

            <UpdateRow label="License Plate">
              <div className="flex items-center gap-1">
                <Input defaultValue="8XYZ123" className="h-8 w-28 text-sm font-mono" />
                <Select defaultValue="CA">
                  <SelectTrigger className="h-8 w-20 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CA">CA</SelectItem>
                    <SelectItem value="NV">NV</SelectItem>
                    <SelectItem value="OR">OR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </UpdateRow>

            <UpdateRow label="Status">
              <Select defaultValue="assigned">
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  <SelectItem value="rental">Rental</SelectItem>
                  <SelectItem value="repair">In Repair</SelectItem>
                </SelectContent>
              </Select>
            </UpdateRow>

            <Separator />

            {/* More fields disclosure */}
            <Collapsible open={moreFieldsOpen} onOpenChange={setMoreFieldsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between rounded border bg-muted/30 px-3 py-2 text-left text-xs font-medium hover:bg-muted/50">
                  <span className="flex items-center gap-1.5">
                    {moreFieldsOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    More fields
                    <span className="font-normal text-muted-foreground">
                      (rental, financial, hierarchy)
                    </span>
                  </span>
                  <Badge variant="outline" className="h-4 text-[9px]">
                    8 fields
                  </Badge>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <UpdateRow label="Rental End Date" hint="Not in rental state">
                  <Input
                    type="date"
                    disabled
                    className="h-8 text-sm"
                  />
                </UpdateRow>
                <UpdateRow label="Vendor Contact" hint="Not in rental state">
                  <Input
                    disabled
                    placeholder="—"
                    className="h-8 text-sm"
                  />
                </UpdateRow>
                <div className="grid grid-cols-2 gap-3">
                  <UpdateRow label="Lifetime Maint">
                    <Input
                      defaultValue="$14,820"
                      className="h-8 text-sm"
                    />
                  </UpdateRow>
                  <UpdateRow label="Book Value">
                    <Input
                      defaultValue="$32,400"
                      className="h-8 text-sm"
                    />
                  </UpdateRow>
                </div>
                <UpdateRow label="Lease End">
                  <Input
                    type="date"
                    defaultValue="2026-08-31"
                    className="h-8 text-sm"
                  />
                </UpdateRow>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </div>
    </div>
  );
}
