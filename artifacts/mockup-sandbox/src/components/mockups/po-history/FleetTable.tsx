import React, { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Search, Calendar } from "lucide-react";
import { MultiSelect } from "./MultiSelect";

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

interface Note {
  id: string;
  text: string;
  date: string;
}

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

const mockPOs: PO[] = [
  {
    poNumber: "PO-2023-0891", vehicle: "021100", type: "MAINTENANCE", status: "CLOSED", openDate: "2023-04-12", totalAmount: 450.00, vendorName: "Jiffy Lube",
    lines: [
      { id: "L1", lineNumber: 1, description: "Synthetic Oil Change", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 150.00 },
      { id: "L2", lineNumber: 2, description: "Air Filter Replacement", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 300.00 }
    ],
    notes: [{ id: "N1", text: "Approved standard PM services.", date: "2023-04-12T09:00:00Z" }]
  },
  {
    poNumber: "PO-2023-1102", vehicle: "034567", type: "REPAIR", status: "APPROVED", openDate: "2023-08-05", totalAmount: 1250.75, vendorName: "Goodyear",
    lines: [
      { id: "L3", lineNumber: 1, description: "Replace 4 Tires", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Wear", amount: 1100.00 },
      { id: "L4", lineNumber: 2, description: "Wheel Alignment", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Wear", amount: 150.75 }
    ],
    notes: [
      { id: "N2", text: "Tires under minimum tread depth. Alignment required.", date: "2023-08-05T10:15:00Z" },
      { id: "N3", text: "Vendor requested quick approval to ship tires today.", date: "2023-08-05T11:00:00Z" }
    ]
  },
  {
    poNumber: "PO-2023-1544", vehicle: "047823", type: "REPAIR", status: "OPEN", openDate: "2023-11-20", totalAmount: 875.50, vendorName: "NAPA",
    lines: [{ id: "L5", lineNumber: 1, description: "Brake Pads and Rotors", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Wear", amount: 875.50 }],
    notes: [{ id: "N4", text: "Driver reported squeaking brakes.", date: "2023-11-20T08:30:00Z" }]
  },
  {
    poNumber: "PO-2023-1999", vehicle: "056231", type: "ACCIDENT", status: "DECLINED", openDate: "2023-12-01", totalAmount: 3200.00, vendorName: "Pep Boys",
    lines: [
      { id: "L6", lineNumber: 1, description: "Front Bumper Replacement", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 2000.00 },
      { id: "L7", lineNumber: 2, description: "Paint and Labor", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 1200.00 }
    ],
    notes: [
      { id: "N5", text: "Estimate seems high. Requesting secondary quote.", date: "2023-12-01T14:20:00Z" },
      { id: "N6", text: "Declined PO.", date: "2023-12-02T09:00:00Z" }
    ]
  },
  {
    poNumber: "PO-2024-0012", vehicle: "021100", type: "MAINTENANCE", status: "OPEN", openDate: "2024-01-10", totalAmount: 210.00, vendorName: "Jiffy Lube",
    lines: [{ id: "L8", lineNumber: 1, description: "Transmission Fluid Flush", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 210.00 }],
    notes: []
  },
  {
    poNumber: "PO-2024-0234", vehicle: "034567", type: "REPAIR", status: "CLOSED", openDate: "2024-02-15", totalAmount: 450.25, vendorName: "Goodyear",
    lines: [{ id: "L9", lineNumber: 1, description: "Fuel Pump Replacement", ataCode: "14 Fuel", ataGroup: "Fuel", repairType: "Repair", amount: 450.25 }],
    notes: [{ id: "N7", text: "Vehicle stalling. Fuel pump diagnosed as faulty.", date: "2024-02-15T11:45:00Z" }]
  },
  {
    poNumber: "PO-2024-0456", vehicle: "047823", type: "MAINTENANCE", status: "APPROVED", openDate: "2024-03-01", totalAmount: 85.00, vendorName: "NAPA",
    lines: [{ id: "L10", lineNumber: 1, description: "Wiper Blades", ataCode: "71 Body", ataGroup: "Body", repairType: "PM", amount: 85.00 }],
    notes: []
  },
  {
    poNumber: "PO-2024-0789", vehicle: "056231", type: "REPAIR", status: "CLOSED", openDate: "2024-04-10", totalAmount: 1150.00, vendorName: "Pep Boys",
    lines: [{ id: "L11", lineNumber: 1, description: "Alternator Replacement", ataCode: "01 Engine", ataGroup: "Electrical", repairType: "Repair", amount: 1150.00 }],
    notes: [{ id: "N8", text: "Battery not charging. Alternator failed.", date: "2024-04-10T09:30:00Z" }]
  }
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
];

const STATUS_OPTIONS: POStatus[] = ["OPEN", "APPROVED", "CLOSED", "DECLINED"];

const STATUS_STYLE: Record<POStatus, string> = {
  OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  APPROVED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  CLOSED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  DECLINED: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_ACTIVE: Record<POStatus, string> = {
  OPEN: "bg-blue-500/30 text-blue-300 border-blue-500/50 ring-1 ring-blue-500/40",
  APPROVED: "bg-emerald-500/30 text-emerald-300 border-emerald-500/50 ring-1 ring-emerald-500/40",
  CLOSED: "bg-zinc-500/30 text-zinc-300 border-zinc-500/50 ring-1 ring-zinc-500/40",
  DECLINED: "bg-red-500/30 text-red-300 border-red-500/50 ring-1 ring-red-500/40",
};

const TYPE_STYLE: Record<string, string> = {
  MAINTENANCE: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  REPAIR: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  ACCIDENT: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

export function FleetTable() {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<POStatus>>(new Set());

  const toggleRow = (poNumber: string) =>
    setExpandedRows(prev => ({ ...prev, [poNumber]: !prev[poNumber] }));

  const toggleStatus = (s: POStatus) => {
    const next = new Set(statusFilter);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusFilter(next.size === STATUS_OPTIONS.length ? new Set() : next);
  };

  const filtered = useMemo(() => mockPOs.filter(po => {
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
  const avgPerVehicle = filtered.length ? totalSpend / (uniqueVehicles || 1) : 0;

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100 font-sans p-6 overflow-auto dark">
      <div className="max-w-7xl mx-auto w-full space-y-5">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Fleet PO History</h1>
          <Button variant="outline" size="sm" className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800">
            Export CSV
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total POs", value: filtered.length, cls: "" },
            { label: "Total Spend", value: `$${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, cls: "" },
            { label: "Open POs", value: openCount, cls: "text-blue-400" },
            { label: "Avg / Vehicle", value: `$${avgPerVehicle.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, cls: "" },
          ].map(c => (
            <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <span className="text-xs text-zinc-400 uppercase tracking-wider font-medium block mb-1">{c.label}</span>
              <span className={`text-2xl font-semibold ${c.cls}`}>{c.value}</span>
            </div>
          ))}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center gap-2">
          <div className="relative w-44">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-500" />
            <Input
              placeholder="Vehicle #"
              value={vehicleFilter}
              onChange={e => setVehicleFilter(e.target.value)}
              className="pl-8 bg-zinc-950 border-zinc-800 focus-visible:ring-zinc-700 h-9 text-sm"
            />
          </div>
          <MultiSelect label="Vendors" options={VENDOR_OPTIONS} selected={vendorFilter} onChange={setVendorFilter} />
          <MultiSelect label="ATA Codes" options={ATA_OPTIONS} selected={ataFilter} onChange={setAtaFilter} />
          <MultiSelect label="Repair Types" options={REPAIR_TYPE_OPTIONS} selected={repairTypeFilter} onChange={setRepairTypeFilter} />
          <Button variant="outline" className="bg-zinc-950 border-zinc-800 text-zinc-300 h-9 gap-2 justify-start font-normal w-40 text-sm">
            <Calendar className="h-4 w-4 text-zinc-500" />
            Last 3 Years
          </Button>
          <div className="flex items-center gap-1 ml-auto">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-all ${statusFilter.size === 0 || statusFilter.has(s) ? STATUS_ACTIVE[s] : STATUS_STYLE[s] + " opacity-40"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-zinc-950/50">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="text-zinc-400 font-medium">PO #</TableHead>
                <TableHead className="text-zinc-400 font-medium">Vehicle</TableHead>
                <TableHead className="text-zinc-400 font-medium">Type</TableHead>
                <TableHead className="text-zinc-400 font-medium">Status</TableHead>
                <TableHead className="text-zinc-400 font-medium">Date</TableHead>
                <TableHead className="text-zinc-400 font-medium">Vendor</TableHead>
                <TableHead className="text-zinc-400 font-medium text-right">Total ($)</TableHead>
                <TableHead className="text-zinc-400 font-medium text-right">Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-zinc-500">No POs match the current filters.</TableCell>
                </TableRow>
              ) : filtered.map(po => (
                <React.Fragment key={po.poNumber}>
                  <TableRow className="border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition-colors" onClick={() => toggleRow(po.poNumber)}>
                    <TableCell className="p-3">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                        {expandedRows[po.poNumber] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium text-zinc-200">{po.poNumber}</TableCell>
                    <TableCell className="font-mono text-zinc-300">{po.vehicle}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${TYPE_STYLE[po.type] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>{po.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[po.status]}`}>{po.status}</Badge>
                    </TableCell>
                    <TableCell className="text-zinc-400">{po.openDate}</TableCell>
                    <TableCell className="text-zinc-300">{po.vendorName}</TableCell>
                    <TableCell className="text-right font-medium text-zinc-200">${po.totalAmount.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-zinc-400">{po.lines.length}</TableCell>
                  </TableRow>

                  {expandedRows[po.poNumber] && (
                    <TableRow className="bg-zinc-950/30 hover:bg-zinc-950/30 border-zinc-800">
                      <TableCell colSpan={9} className="p-0">
                        <div className="p-6 pl-14 space-y-6">
                          <div>
                            <h4 className="text-sm font-medium text-zinc-300 mb-3">Line Items <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 border-transparent rounded px-1.5 py-0 text-xs">{po.lines.length}</Badge></h4>
                            <div className="border border-zinc-800 rounded-md overflow-hidden">
                              <Table>
                                <TableHeader className="bg-zinc-900/50">
                                  <TableRow className="border-zinc-800 hover:bg-transparent">
                                    <TableHead className="text-xs text-zinc-500 w-12">#</TableHead>
                                    <TableHead className="text-xs text-zinc-500">Description</TableHead>
                                    <TableHead className="text-xs text-zinc-500">ATA Code</TableHead>
                                    <TableHead className="text-xs text-zinc-500">Group</TableHead>
                                    <TableHead className="text-xs text-zinc-500">Repair Type</TableHead>
                                    <TableHead className="text-xs text-zinc-500 text-right">Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {po.lines.map(line => (
                                    <TableRow key={line.id} className="border-zinc-800 hover:bg-zinc-900/30">
                                      <TableCell className="text-xs text-zinc-400">{line.lineNumber}</TableCell>
                                      <TableCell className="text-sm text-zinc-300">{line.description}</TableCell>
                                      <TableCell className="text-xs font-mono text-zinc-400">{line.ataCode}</TableCell>
                                      <TableCell className="text-xs text-zinc-400">{line.ataGroup}</TableCell>
                                      <TableCell className="text-xs text-zinc-400">{line.repairType}</TableCell>
                                      <TableCell className="text-sm text-right text-zinc-300 font-medium">${line.amount.toFixed(2)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-zinc-300 mb-3">Notes <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 border-transparent rounded px-1.5 py-0 text-xs">{po.notes.length}</Badge></h4>
                            {po.notes.length > 0 ? (
                              <div className="space-y-3">
                                {po.notes.map(note => {
                                  const d = new Date(note.date);
                                  return (
                                    <div key={note.id} className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
                                      <div className="flex justify-between mb-1.5">
                                        <span className="text-xs font-medium text-zinc-400">System Note</span>
                                        <span className="text-[10px] text-zinc-500">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                      </div>
                                      <p className="text-sm text-zinc-300">{note.text}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-sm text-zinc-500 italic bg-zinc-900/50 border border-zinc-800/50 rounded-md p-4 text-center">No notes recorded.</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
