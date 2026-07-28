import React, { useState, useMemo, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown, ChevronRight, Search, Calendar, Check, X,
  FileText, Wrench, AlertCircle, BarChart3, Truck, PenTool,
} from "lucide-react";

// ─── Shared MultiSelect ────────────────────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange, width = "w-40",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const allSelected = selected.size === 0 || selected.size === options.length;

  const toggle = (value: string) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onChange(next.size === options.length ? new Set() : next);
  };

  const isChecked = (value: string) => selected.size === 0 || selected.has(value);

  const triggerLabel = (() => {
    if (selected.size === 0 || selected.size === options.length) return `All ${label}`;
    if (selected.size === 1) return options.find(o => selected.has(o.value))?.label ?? `1 ${label}`;
    return `${selected.size} ${label}`;
  })();

  return (
    <div ref={ref} className={`relative ${width}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full h-9 flex items-center justify-between gap-2 px-3 text-sm bg-background border border-border rounded-md text-muted-foreground hover:border-input hover:text-foreground transition-colors"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] bg-popover border border-border rounded-md shadow-xl overflow-hidden">
          <button
            onClick={() => onChange(new Set())}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border"
          >
            <span className={`flex items-center justify-center w-4 h-4 rounded border ${allSelected ? "bg-primary border-primary" : "border-border bg-transparent"}`}>
              {allSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </span>
            <span className="text-foreground font-medium">All {label}</span>
          </button>
          {options.map(opt => {
            const checked = isChecked(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <span className={`flex items-center justify-center w-4 h-4 rounded border ${checked ? "bg-primary border-primary" : "border-border bg-transparent"}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </span>
                <span className={checked ? "text-foreground" : "text-muted-foreground"}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Mock data ─────────────────────────────────────────────────────────────
type POStatus = "OPEN" | "APPROVED" | "CLOSED" | "DECLINED";

interface LineItem {
  id: string;
  lineNumber: number;
  description: string;
  ataCode: string;
  ataGroup: string;
  repairType: string;
  amount: number;
}

interface Note { id: string; text: string; date: string }

interface PO {
  poNumber: string;
  vehicle: string;
  type: string;
  status: POStatus;
  openDate: string;
  totalAmount: number;
  vendorName: string;
  lines: LineItem[];
  notes: Note[];
}

const MOCK_POS: PO[] = [
  { poNumber: "PO-2023-0891", vehicle: "021100", type: "MAINTENANCE", status: "CLOSED", openDate: "2023-04-12", totalAmount: 450.00, vendorName: "Jiffy Lube", lines: [{ id: "L1", lineNumber: 1, description: "Synthetic Oil Change", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 150.00 }, { id: "L2", lineNumber: 2, description: "Air Filter Replacement", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 300.00 }], notes: [{ id: "N1", text: "Approved standard PM services.", date: "2023-04-12T09:00:00Z" }] },
  { poNumber: "PO-2023-1102", vehicle: "034567", type: "REPAIR", status: "APPROVED", openDate: "2023-08-05", totalAmount: 1250.75, vendorName: "Goodyear", lines: [{ id: "L3", lineNumber: 1, description: "Replace 4 Tires", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Wear", amount: 1100.00 }, { id: "L4", lineNumber: 2, description: "Wheel Alignment", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Wear", amount: 150.75 }], notes: [{ id: "N2", text: "Tires under minimum tread depth.", date: "2023-08-05T10:15:00Z" }, { id: "N3", text: "Vendor requested quick approval.", date: "2023-08-05T11:00:00Z" }] },
  { poNumber: "PO-2023-1544", vehicle: "047823", type: "REPAIR", status: "OPEN", openDate: "2023-11-20", totalAmount: 875.50, vendorName: "NAPA", lines: [{ id: "L5", lineNumber: 1, description: "Brake Pads and Rotors", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Wear", amount: 875.50 }], notes: [{ id: "N4", text: "Driver reported squeaking brakes.", date: "2023-11-20T08:30:00Z" }] },
  { poNumber: "PO-2023-1999", vehicle: "056231", type: "ACCIDENT", status: "DECLINED", openDate: "2023-12-01", totalAmount: 3200.00, vendorName: "Pep Boys", lines: [{ id: "L6", lineNumber: 1, description: "Front Bumper Replacement", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 2000.00 }, { id: "L7", lineNumber: 2, description: "Paint and Labor", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 1200.00 }], notes: [{ id: "N5", text: "Estimate seems high. Requesting secondary quote.", date: "2023-12-01T14:20:00Z" }, { id: "N6", text: "Declined PO.", date: "2023-12-02T09:00:00Z" }] },
  { poNumber: "PO-2024-0012", vehicle: "021100", type: "MAINTENANCE", status: "OPEN", openDate: "2024-01-10", totalAmount: 210.00, vendorName: "Jiffy Lube", lines: [{ id: "L8", lineNumber: 1, description: "Transmission Fluid Flush", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 210.00 }], notes: [] },
  { poNumber: "PO-2024-0234", vehicle: "034567", type: "REPAIR", status: "CLOSED", openDate: "2024-02-15", totalAmount: 450.25, vendorName: "Goodyear", lines: [{ id: "L9", lineNumber: 1, description: "Fuel Pump Replacement", ataCode: "14 Fuel", ataGroup: "Fuel", repairType: "Repair", amount: 450.25 }], notes: [{ id: "N7", text: "Vehicle stalling. Fuel pump diagnosed as faulty.", date: "2024-02-15T11:45:00Z" }] },
  { poNumber: "PO-2024-0456", vehicle: "047823", type: "MAINTENANCE", status: "APPROVED", openDate: "2024-03-01", totalAmount: 85.00, vendorName: "NAPA", lines: [{ id: "L10", lineNumber: 1, description: "Wiper Blades", ataCode: "71 Body", ataGroup: "Body", repairType: "PM", amount: 85.00 }], notes: [] },
  { poNumber: "PO-2024-0789", vehicle: "056231", type: "REPAIR", status: "CLOSED", openDate: "2024-04-10", totalAmount: 1150.00, vendorName: "Pep Boys", lines: [{ id: "L11", lineNumber: 1, description: "Alternator Replacement", ataCode: "01 Engine", ataGroup: "Electrical", repairType: "Repair", amount: 1150.00 }], notes: [{ id: "N8", text: "Battery not charging. Alternator failed.", date: "2024-04-10T09:30:00Z" }] },
  { poNumber: "PO-2024-1011", vehicle: "021100", type: "REPAIR", status: "APPROVED", openDate: "2024-05-22", totalAmount: 2850.00, vendorName: "NAPA", lines: [{ id: "L12", lineNumber: 1, description: "Alternator Assembly", ataCode: "01 Engine", ataGroup: "Electrical", repairType: "Repair", amount: 1850.00 }, { id: "L13", lineNumber: 2, description: "Labor", ataCode: "01 Engine", ataGroup: "Electrical", repairType: "Labor", amount: 1000.00 }], notes: [{ id: "N9", text: "No-start condition.", date: "2024-05-22T08:00:00Z" }] },
  { poNumber: "PO-2024-1234", vehicle: "034567", type: "REPAIR", status: "APPROVED", openDate: "2024-06-12", totalAmount: 4250.00, vendorName: "Goodyear", lines: [{ id: "L14", lineNumber: 1, description: "Front Brake Pads", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Replace", amount: 850.00 }, { id: "L15", lineNumber: 2, description: "Rotors Machining", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Machine", amount: 1200.00 }, { id: "L16", lineNumber: 3, description: "Labor", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Labor", amount: 2200.00 }], notes: [{ id: "N10", text: "Heavy wear on rotors.", date: "2024-06-12T09:30:00Z" }] },
];

const VENDOR_OPTIONS = [
  { value: "Jiffy Lube", label: "Jiffy Lube" },
  { value: "Goodyear", label: "Goodyear" },
  { value: "NAPA", label: "NAPA" },
  { value: "Pep Boys", label: "Pep Boys" },
];

const ATA_OPTIONS = [
  { value: "01 Engine", label: "01 Engine" },
  { value: "14 Fuel", label: "14 Fuel" },
  { value: "33 Brakes", label: "33 Brakes" },
  { value: "42 Tires", label: "42 Tires" },
  { value: "71 Body", label: "71 Body" },
];

const REPAIR_TYPE_OPTIONS = [
  { value: "PM", label: "PM" },
  { value: "Wear", label: "Wear" },
  { value: "Repair", label: "Repair" },
  { value: "Accident", label: "Accident" },
  { value: "Replace", label: "Replace" },
  { value: "Labor", label: "Labor" },
];

const STATUS_OPTIONS: POStatus[] = ["OPEN", "APPROVED", "CLOSED", "DECLINED"];

const STATUS_BADGE: Record<POStatus, string> = {
  OPEN: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
  APPROVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  CLOSED: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-400",
  DECLINED: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
};

const STATUS_TOGGLE_ON: Record<POStatus, string> = {
  OPEN: "bg-blue-500/15 text-blue-600 border-blue-400/40 dark:text-blue-300",
  APPROVED: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40 dark:text-emerald-300",
  CLOSED: "bg-zinc-500/15 text-zinc-600 border-zinc-400/40 dark:text-zinc-300",
  DECLINED: "bg-red-500/15 text-red-600 border-red-400/40 dark:text-red-300",
};

const TYPE_BADGE: Record<string, string> = {
  MAINTENANCE: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20 dark:text-cyan-400",
  REPAIR: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  ACCIDENT: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
};

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

// ─── ATA groups (for "By ATA Group" tab) ──────────────────────────────────
const ATA_GROUPS = [
  { code: "33", name: "Brakes", color: "bg-teal-500", textColor: "text-teal-500" },
  { code: "42", name: "Tires", color: "bg-blue-500", textColor: "text-blue-500" },
  { code: "01", name: "Engine", color: "bg-orange-500", textColor: "text-orange-500" },
  { code: "14", name: "Fuel", color: "bg-yellow-500", textColor: "text-yellow-500" },
  { code: "71", name: "Body", color: "bg-purple-500", textColor: "text-purple-500" },
];

// ─── Shared filter bar ──────────────────────────────────────────────────────
function FilterBar({
  vehicleFilter, setVehicleFilter,
  vendorFilter, setVendorFilter,
  ataFilter, setAtaFilter,
  repairTypeFilter, setRepairTypeFilter,
  statusFilter, setStatusFilter,
  showVendorFilter = true,
}: {
  vehicleFilter: string; setVehicleFilter: (v: string) => void;
  vendorFilter: Set<string>; setVendorFilter: (v: Set<string>) => void;
  ataFilter: Set<string>; setAtaFilter: (v: Set<string>) => void;
  repairTypeFilter: Set<string>; setRepairTypeFilter: (v: Set<string>) => void;
  statusFilter: Set<POStatus>; setStatusFilter: (v: Set<POStatus>) => void;
  showVendorFilter?: boolean;
}) {
  const toggleStatus = (s: POStatus) => {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next.size === STATUS_OPTIONS.length ? new Set() : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/30 rounded-lg p-3">
      <div className="relative w-40">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Vehicle #"
          value={vehicleFilter}
          onChange={e => setVehicleFilter(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>
      {showVendorFilter && (
        <MultiSelect label="Vendors" options={VENDOR_OPTIONS} selected={vendorFilter} onChange={setVendorFilter} />
      )}
      <MultiSelect label="ATA Codes" options={ATA_OPTIONS} selected={ataFilter} onChange={setAtaFilter} />
      <MultiSelect label="Repair Types" options={REPAIR_TYPE_OPTIONS} selected={repairTypeFilter} onChange={setRepairTypeFilter} />
      <Button variant="outline" size="sm" className="h-9 gap-2 font-normal text-sm text-muted-foreground w-36">
        <Calendar className="h-4 w-4" />
        Last 3 Years
      </Button>
      <div className="flex items-center gap-1 ml-auto">
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-all ${
              statusFilter.size === 0 || statusFilter.has(s)
                ? STATUS_TOGGLE_ON[s]
                : STATUS_BADGE[s] + " opacity-40"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Expandable PO row (shared) ─────────────────────────────────────────────
function PORow({ po }: { po: PO }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <TableCell className="p-3">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium">{po.poNumber}</TableCell>
        <TableCell className="font-mono text-sm">{po.vehicle}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${TYPE_BADGE[po.type] ?? "bg-muted text-muted-foreground border-border"}`}>
            {po.type}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[po.status]}`}>
            {po.status}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">{po.openDate}</TableCell>
        <TableCell className="text-sm">{po.vendorName}</TableCell>
        <TableCell className="text-right font-medium">{fmt(po.totalAmount)}</TableCell>
        <TableCell className="text-right text-muted-foreground">{po.lines.length}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={9} className="p-0">
            <div className="p-6 pl-14 space-y-5">
              <div>
                <h4 className="text-sm font-medium mb-2">Line Items</h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs text-muted-foreground w-10">#</TableHead>
                        <TableHead className="text-xs text-muted-foreground">Description</TableHead>
                        <TableHead className="text-xs text-muted-foreground">ATA</TableHead>
                        <TableHead className="text-xs text-muted-foreground">Repair Type</TableHead>
                        <TableHead className="text-xs text-muted-foreground text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {po.lines.map(line => (
                        <TableRow key={line.id}>
                          <TableCell className="text-xs text-muted-foreground">{line.lineNumber}</TableCell>
                          <TableCell className="text-sm">{line.description}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{line.ataCode}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{line.repairType}</TableCell>
                          <TableCell className="text-sm text-right font-medium">{fmt(line.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {po.notes.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Notes</h4>
                  <div className="space-y-2">
                    {po.notes.map(note => {
                      const d = new Date(note.date);
                      return (
                        <div key={note.id} className="bg-background border border-border rounded-md p-3">
                          <div className="flex justify-between mb-1">
                            <span className="text-xs text-muted-foreground font-medium">System Note</span>
                            <span className="text-[10px] text-muted-foreground">
                              {d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-sm">{note.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Tab 1: All POs ──────────────────────────────────────────────────────────
function AllPOsTab() {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<POStatus>>(new Set());

  const filtered = useMemo(() => MOCK_POS.filter(po => {
    if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
    if (vendorFilter.size > 0 && !vendorFilter.has(po.vendorName)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
    if (ataFilter.size > 0 && !po.lines.some(l => ataFilter.has(l.ataCode))) return false;
    if (repairTypeFilter.size > 0 && !po.lines.some(l => repairTypeFilter.has(l.repairType))) return false;
    return true;
  }), [vehicleFilter, vendorFilter, statusFilter, ataFilter, repairTypeFilter]);

  const totalSpend = filtered.reduce((a, p) => a + p.totalAmount, 0);
  const openCount = filtered.filter(p => p.status === "OPEN").length;
  const uniqueVehicles = new Set(filtered.map(p => p.vehicle)).size;
  const avgPerVehicle = uniqueVehicles ? totalSpend / uniqueVehicles : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total POs", value: filtered.length },
          { label: "Total Spend", value: fmt(totalSpend) },
          { label: "Open POs", value: openCount },
          { label: "Avg / Vehicle", value: fmt(avgPerVehicle) },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <FilterBar
        vehicleFilter={vehicleFilter} setVehicleFilter={setVehicleFilter}
        vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
        ataFilter={ataFilter} setAtaFilter={setAtaFilter}
        repairTypeFilter={repairTypeFilter} setRepairTypeFilter={setRepairTypeFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>PO #</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No POs match the current filters.</TableCell></TableRow>
              : filtered.map(po => <PORow key={po.poNumber} po={po} />)
            }
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab 2: By Vendor ───────────────────────────────────────────────────────
function ByVendorTab() {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<POStatus>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);

  const vendorStats = useMemo(() => {
    const stats: Record<string, { total: number; count: number }> = {};
    MOCK_POS.forEach(po => {
      if (!stats[po.vendorName]) stats[po.vendorName] = { total: 0, count: 0 };
      stats[po.vendorName].total += po.totalAmount;
      stats[po.vendorName].count++;
    });
    return Object.entries(stats).map(([vendor, data]) => ({ vendor, ...data })).sort((a, b) => b.total - a.total);
  }, []);

  const maxSpend = Math.max(...vendorStats.map(v => v.total), 1);

  const filteredPOs = useMemo(() => MOCK_POS.filter(po => {
    if (selectedVendor && po.vendorName !== selectedVendor) return false;
    if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
    if (vendorFilter.size > 0 && !vendorFilter.has(po.vendorName)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
    if (ataFilter.size > 0 && !po.lines.some(l => ataFilter.has(l.ataCode))) return false;
    if (repairTypeFilter.size > 0 && !po.lines.some(l => repairTypeFilter.has(l.repairType))) return false;
    return true;
  }), [selectedVendor, vehicleFilter, vendorFilter, statusFilter, ataFilter, repairTypeFilter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Spend by Vendor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {vendorStats.map(stat => {
              const isSelected = selectedVendor === stat.vendor;
              const widthPct = Math.max((stat.total / maxSpend) * 100, 2);
              return (
                <div key={stat.vendor} className="flex items-center gap-4 cursor-pointer group" onClick={() => setSelectedVendor(isSelected ? null : stat.vendor)}>
                  <div className="w-44 text-right text-sm font-medium truncate group-hover:text-foreground transition-colors">{stat.vendor}</div>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="h-6 w-full bg-muted rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-500 ${isSelected ? "bg-primary" : "bg-muted-foreground/40 group-hover:bg-muted-foreground/60"}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className="w-28 flex justify-between text-sm">
                      <span className={isSelected ? "text-primary font-medium" : "text-muted-foreground"}>{fmt(stat.total)}</span>
                      <span className="text-muted-foreground text-xs mt-0.5">({stat.count})</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <FilterBar
        vehicleFilter={vehicleFilter} setVehicleFilter={setVehicleFilter}
        vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
        ataFilter={ataFilter} setAtaFilter={setAtaFilter}
        repairTypeFilter={repairTypeFilter} setRepairTypeFilter={setRepairTypeFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />

      {selectedVendor && (
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-3 py-1.5 rounded-full text-sm">
          <span>Filtering: <strong>{selectedVendor}</strong></span>
          <button onClick={() => setSelectedVendor(null)} className="hover:bg-primary/20 rounded-full p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>PO #</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPOs.length === 0
              ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No POs match the current filters.</TableCell></TableRow>
              : filteredPOs.map(po => <PORow key={po.poNumber} po={po} />)
            }
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab 3: By ATA Group ────────────────────────────────────────────────────
function ByAtaGroupTab() {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<POStatus>>(new Set());
  const [selectedAta, setSelectedAta] = useState<string | null>(null);

  const ataStats = useMemo(() => {
    const stats: Record<string, number> = {};
    MOCK_POS.forEach(po => po.lines.forEach(l => {
      const code = l.ataCode.split(" ")[0];
      stats[code] = (stats[code] ?? 0) + l.amount;
    }));
    return stats;
  }, []);

  const filteredPOs = useMemo(() => MOCK_POS.filter(po => {
    if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
    if (vendorFilter.size > 0 && !vendorFilter.has(po.vendorName)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
    if (ataFilter.size > 0 && !po.lines.some(l => ataFilter.has(l.ataCode))) return false;
    if (repairTypeFilter.size > 0 && !po.lines.some(l => repairTypeFilter.has(l.repairType))) return false;
    if (selectedAta && !po.lines.some(l => l.ataCode.startsWith(selectedAta))) return false;
    return true;
  }), [vehicleFilter, vendorFilter, statusFilter, ataFilter, repairTypeFilter, selectedAta]);

  const maxStat = Math.max(...Object.values(ataStats), 1);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Spend by ATA Group</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5">
            {ATA_GROUPS.map(group => {
              const spend = ataStats[group.code] ?? 0;
              const isSelected = selectedAta === group.code;
              const widthPct = Math.max((spend / maxStat) * 100, spend > 0 ? 2 : 0);
              return (
                <div key={group.code} className="flex items-center gap-4 cursor-pointer group" onClick={() => setSelectedAta(isSelected ? null : group.code)}>
                  <div className="w-32 text-right text-sm">
                    <span className="font-mono text-muted-foreground mr-1.5">{group.code}</span>
                    <span className="font-medium">{group.name}</span>
                  </div>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="h-6 w-full bg-muted rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-500 ${isSelected ? "bg-primary" : group.color + " opacity-70 group-hover:opacity-90"}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className={`w-24 text-sm ${isSelected ? "text-primary font-medium" : "text-muted-foreground"}`}>{fmt(spend)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <FilterBar
        vehicleFilter={vehicleFilter} setVehicleFilter={setVehicleFilter}
        vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
        ataFilter={ataFilter} setAtaFilter={setAtaFilter}
        repairTypeFilter={repairTypeFilter} setRepairTypeFilter={setRepairTypeFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
      />

      {selectedAta && (
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-3 py-1.5 rounded-full text-sm">
          <span>ATA group: <strong>{selectedAta} {ATA_GROUPS.find(g => g.code === selectedAta)?.name}</strong></span>
          <button onClick={() => setSelectedAta(null)} className="hover:bg-primary/20 rounded-full p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>PO #</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Lines</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPOs.length === 0
              ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No POs match the current filters.</TableCell></TableRow>
              : filteredPOs.map(po => <PORow key={po.poNumber} po={po} />)
            }
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab 4: By Vehicle ──────────────────────────────────────────────────────
function ByVehicleTab() {
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<POStatus>>(new Set());
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  const vehicleStats = useMemo(() => {
    const stats: Record<string, { total: number; count: number; open: number; lastDate: string; topVendor: string }> = {};
    MOCK_POS.forEach(po => {
      if (!stats[po.vehicle]) stats[po.vehicle] = { total: 0, count: 0, open: 0, lastDate: "", topVendor: po.vendorName };
      stats[po.vehicle].total += po.totalAmount;
      stats[po.vehicle].count++;
      if (po.status === "OPEN") stats[po.vehicle].open++;
      if (!stats[po.vehicle].lastDate || po.openDate > stats[po.vehicle].lastDate)
        stats[po.vehicle].lastDate = po.openDate;
    });
    return Object.entries(stats).map(([vehicle, data]) => ({ vehicle, ...data })).sort((a, b) => b.total - a.total);
  }, []);

  const filteredVehiclePos = useMemo(() => {
    if (!selectedVehicle) return [];
    return MOCK_POS.filter(po => {
      if (po.vehicle !== selectedVehicle) return false;
      if (vendorFilter.size > 0 && !vendorFilter.has(po.vendorName)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
      if (ataFilter.size > 0 && !po.lines.some(l => ataFilter.has(l.ataCode))) return false;
      if (repairTypeFilter.size > 0 && !po.lines.some(l => repairTypeFilter.has(l.repairType))) return false;
      return true;
    });
  }, [selectedVehicle, vendorFilter, statusFilter, ataFilter, repairTypeFilter]);

  const filteredVehicles = useMemo(() => vehicleStats.filter(v => {
    if (vehicleFilter && !v.vehicle.includes(vehicleFilter)) return false;
    return true;
  }), [vehicleStats, vehicleFilter]);

  const totalFleetSpend = vehicleStats.reduce((a, v) => a + v.total, 0);
  const totalOpenPOs = vehicleStats.reduce((a, v) => a + v.open, 0);
  const mostExpensive = vehicleStats[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Fleet Total Spend", value: fmt(totalFleetSpend) },
          { label: "Vehicles", value: vehicleStats.length },
          { label: "Open POs", value: totalOpenPOs },
          { label: "Highest Cost Vehicle", value: mostExpensive ? `#${mostExpensive.vehicle}` : "—" },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!selectedVehicle ? (
        <>
          <FilterBar
            vehicleFilter={vehicleFilter} setVehicleFilter={setVehicleFilter}
            vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
            ataFilter={ataFilter} setAtaFilter={setAtaFilter}
            repairTypeFilter={repairTypeFilter} setRepairTypeFilter={setRepairTypeFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            showVendorFilter={false}
          />
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Vehicle #</TableHead>
                  <TableHead className="text-right">PO Count</TableHead>
                  <TableHead className="text-right">Total Spend</TableHead>
                  <TableHead className="text-center">Open POs</TableHead>
                  <TableHead>Last PO</TableHead>
                  <TableHead>Top Vendor</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVehicles.map(v => (
                  <TableRow key={v.vehicle} className="cursor-pointer hover:bg-muted/40 group" onClick={() => setSelectedVehicle(v.vehicle)}>
                    <TableCell className="font-mono font-medium">{v.vehicle}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{v.count}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(v.total)}</TableCell>
                    <TableCell className="text-center">
                      {v.open > 0
                        ? <Badge variant="outline" className={STATUS_BADGE.OPEN}>{v.open} Open</Badge>
                        : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{v.lastDate}</TableCell>
                    <TableCell className="text-sm">{v.topVendor}</TableCell>
                    <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelectedVehicle(null)}>
              ← All Vehicles
            </Button>
            <span className="text-lg font-semibold">Vehicle #{selectedVehicle}</span>
            <Badge variant="secondary">{fmt(vehicleStats.find(v => v.vehicle === selectedVehicle)?.total ?? 0)} Total</Badge>
          </div>

          <FilterBar
            vehicleFilter={vehicleFilter} setVehicleFilter={setVehicleFilter}
            vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
            ataFilter={ataFilter} setAtaFilter={setAtaFilter}
            repairTypeFilter={repairTypeFilter} setRepairTypeFilter={setRepairTypeFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            showVendorFilter={true}
          />

          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead>PO #</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVehiclePos.length === 0
                  ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No POs match the current filters.</TableCell></TableRow>
                  : filteredVehiclePos.map(po => <PORow key={po.poNumber} po={po} />)
                }
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Page root ──────────────────────────────────────────────────────────────
export default function PoHistoryDashboard() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PO History Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Holman purchase orders · last 3 years</p>
        </div>
        <Button variant="outline" size="sm">Export CSV</Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> All POs
          </TabsTrigger>
          <TabsTrigger value="vendor" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> By Vendor
          </TabsTrigger>
          <TabsTrigger value="ata" className="gap-1.5">
            <Wrench className="h-3.5 w-3.5" /> By ATA Group
          </TabsTrigger>
          <TabsTrigger value="vehicle" className="gap-1.5">
            <Truck className="h-3.5 w-3.5" /> By Vehicle
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="all"><AllPOsTab /></TabsContent>
          <TabsContent value="vendor"><ByVendorTab /></TabsContent>
          <TabsContent value="ata"><ByAtaGroupTab /></TabsContent>
          <TabsContent value="vehicle"><ByVehicleTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
