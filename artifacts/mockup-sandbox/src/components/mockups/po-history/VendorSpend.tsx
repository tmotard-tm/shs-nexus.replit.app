import React, { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Search, X, FileText, Wrench, Calendar, AlertCircle } from "lucide-react";
import { MultiSelect } from "./MultiSelect";

type Note = { text: string; date: string };
type LineItem = { number: number; description: string; ataCode: string; ataGroup: string; repairType: string; amount: number };
type PO = { id: string; vehicle: string; type: "PO" | "RO"; status: "OPEN" | "APPROVED" | "CLOSED" | "DECLINED"; date: string; total: number; vendor: string; lines: LineItem[]; notes: Note[] };

const MOCK_VENDORS = ["Goodyear Auto Service", "NAPA Auto Parts", "Pep Boys", "Jiffy Lube", "Safelite AutoGlass", "Firestone Complete Auto Care", "Penske Truck Rental", "Valvoline Instant Oil Change"];
const ATA_CODES = ["01", "14", "33", "42", "71"];
const ATA_GROUPS = ["Engine", "Fuel", "Brakes", "Tires", "Body"];
const REPAIR_TYPES = ["PM", "PM_R", "R", "W"];
const STATUSES: PO["status"][] = ["OPEN", "APPROVED", "CLOSED", "DECLINED"];

const MOCK_POS: PO[] = Array.from({ length: 45 }).map((_, i) => {
  const vendor = MOCK_VENDORS[Math.floor(Math.pow(Math.random(), 2) * MOCK_VENDORS.length)];
  const status = (["OPEN", "APPROVED", "CLOSED", "CLOSED", "CLOSED", "DECLINED"] as PO["status"][])[Math.floor(Math.random() * 6)];
  const lineCount = Math.floor(Math.random() * 4) + 1;
  const lines: LineItem[] = Array.from({ length: lineCount }).map((_, li) => {
    const idx = Math.floor(Math.random() * 5);
    return { number: li + 1, description: `Replace part ${Math.floor(Math.random() * 1000)}`, ataCode: ATA_CODES[idx], ataGroup: ATA_GROUPS[idx], repairType: REPAIR_TYPES[Math.floor(Math.random() * 4)], amount: Math.floor(Math.random() * 500) + 50 };
  });
  return {
    id: `PO-${100000 + i}`,
    vehicle: ["021100", "034567", "048291", "051122"][Math.floor(Math.random() * 4)],
    type: Math.random() > 0.8 ? "RO" : "PO",
    status, date: new Date(Date.now() - Math.random() * 10000000000).toISOString().split('T')[0],
    total: lines.reduce((s, l) => s + l.amount, 0), vendor, lines,
    notes: Math.random() > 0.5 ? [{ text: "Called vendor for update, parts ordered.", date: new Date(Date.now() - Math.random() * 500000000).toISOString().split('T')[0] }] : []
  };
});

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const VENDOR_OPTIONS = MOCK_VENDORS.map(v => ({ value: v, label: v }));
const ATA_OPTIONS = [
  { value: "01", label: "01 - Engine" }, { value: "14", label: "14 - Fuel" },
  { value: "33", label: "33 - Brakes" }, { value: "42", label: "42 - Tires" }, { value: "71", label: "71 - Body" },
];
const REPAIR_OPTIONS = REPAIR_TYPES.map(r => ({ value: r, label: r }));

export function VendorSpend() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [ataFilter, setAtaFilter] = useState<Set<string>>(new Set());
  const [repairTypeFilter, setRepairTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    const n = new Set(expandedRows);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpandedRows(n);
  };

  const toggleStatus = (s: string) => {
    const n = new Set(statusFilter);
    n.has(s) ? n.delete(s) : n.add(s);
    setStatusFilter(n.size === STATUSES.length ? new Set() : n);
  };

  const vendorStats = useMemo(() => {
    const stats: Record<string, { total: number; count: number }> = {};
    MOCK_POS.forEach(po => {
      if (!stats[po.vendor]) stats[po.vendor] = { total: 0, count: 0 };
      stats[po.vendor].total += po.total;
      stats[po.vendor].count += 1;
    });
    return Object.entries(stats).map(([vendor, data]) => ({ vendor, ...data })).sort((a, b) => b.total - a.total).slice(0, 8);
  }, []);

  const maxSpend = Math.max(...vendorStats.map(v => v.total));

  const filteredPOs = useMemo(() => MOCK_POS.filter(po => {
    if (selectedVendor && po.vendor !== selectedVendor) return false;
    if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
    if (ataFilter.size > 0 && !po.lines.some(l => ataFilter.has(l.ataCode))) return false;
    if (repairTypeFilter.size > 0 && !po.lines.some(l => repairTypeFilter.has(l.repairType))) return false;
    return true;
  }), [selectedVendor, vehicleFilter, ataFilter, repairTypeFilter, statusFilter]);

  const selectedVendorData = selectedVendor ? vendorStats.find(v => v.vendor === selectedVendor) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans dark">
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-medium tracking-tight text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-zinc-400" />
              Spend by Vendor
            </h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Calendar className="w-4 h-4" />
              <span>Last 3 Years (Default)</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input placeholder="Vehicle #..." value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}
                className="w-36 bg-zinc-950 border-zinc-800 pl-9 text-sm h-9 placeholder:text-zinc-600 focus-visible:ring-zinc-700" />
            </div>
            <MultiSelect label="Vendors" options={VENDOR_OPTIONS} selected={selectedVendor ? new Set([selectedVendor]) : new Set()} onChange={s => setSelectedVendor(s.size === 1 ? [...s][0] : null)} width="w-48" />
            <MultiSelect label="ATA Codes" options={ATA_OPTIONS} selected={ataFilter} onChange={setAtaFilter} />
            <MultiSelect label="Repair Types" options={REPAIR_OPTIONS} selected={repairTypeFilter} onChange={setRepairTypeFilter} />
            <div className="flex items-center gap-1 border border-zinc-800 rounded-md p-1 bg-zinc-950">
              {STATUSES.map(s => (
                <button key={s} onClick={() => toggleStatus(s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter.size === 0 || statusFilter.has(s) ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Top Vendors by Total Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {vendorStats.map(stat => {
                const widthPercent = Math.max((stat.total / maxSpend) * 100, 2);
                const isSelected = selectedVendor === stat.vendor;
                return (
                  <div key={stat.vendor} className="flex items-center gap-4 cursor-pointer group" onClick={() => setSelectedVendor(isSelected ? null : stat.vendor)}>
                    <div className="w-48 text-right text-sm truncate font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">{stat.vendor}</div>
                    <div className="flex-1 flex items-center gap-3">
                      <div className="h-6 w-full bg-zinc-950 rounded-sm overflow-hidden">
                        <div className={`h-full transition-all duration-500 rounded-sm ${isSelected ? "bg-indigo-500" : "bg-zinc-700 group-hover:bg-zinc-600"}`} style={{ width: `${widthPercent}%` }} />
                      </div>
                      <div className="w-32 flex justify-between text-sm">
                        <span className={isSelected ? "text-indigo-400 font-medium" : "text-zinc-400"}>{fmt(stat.total)}</span>
                        <span className="text-zinc-500 text-xs mt-0.5">({stat.count})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedVendorData && (
            <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-3 py-1.5 rounded-full text-sm">
              <span>Showing: <strong>{selectedVendorData.vendor}</strong> — {fmt(selectedVendorData.total)} across {selectedVendorData.count} POs</span>
              <button onClick={() => setSelectedVendor(null)} className="ml-2 hover:bg-indigo-500/20 rounded-full p-0.5"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900 shadow-sm">
            <Table>
              <TableHeader className="bg-zinc-950 border-b border-zinc-800">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="w-10" />
                  <TableHead className="text-zinc-400 font-medium h-10">PO #</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10">Vehicle</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10">Type</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10">Status</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10">Date</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10">Vendor</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10 text-right">Lines</TableHead>
                  <TableHead className="text-zinc-400 font-medium h-10 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPOs.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="h-32 text-center text-zinc-500">No POs match the current filters.</TableCell></TableRow>
                ) : filteredPOs.map(po => (
                  <React.Fragment key={po.id}>
                    <TableRow className={`group cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${expandedRows.has(po.id) ? "bg-zinc-800/30" : ""}`} onClick={() => toggleRow(po.id)}>
                      <TableCell className="p-2 pl-4">
                        <Button variant="ghost" size="icon" className="w-6 h-6 p-0 text-zinc-500 hover:text-zinc-300">
                          {expandedRows.has(po.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-zinc-300 py-3">{po.id}</TableCell>
                      <TableCell className="text-sm text-zinc-300">{po.vehicle}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-mono text-xs ${po.type === "PO" ? "bg-violet-500/10 text-violet-400 border-violet-500/20" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"}`}>{po.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${po.status === "OPEN" ? "bg-blue-500" : po.status === "APPROVED" ? "bg-emerald-500" : po.status === "CLOSED" ? "bg-zinc-500" : "bg-red-500"}`} />
                          <span className="text-xs font-medium text-zinc-300">{po.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-400">{po.date}</TableCell>
                      <TableCell className="text-sm text-zinc-300 truncate max-w-[200px]">{po.vendor}</TableCell>
                      <TableCell className="text-sm text-zinc-400 text-right">{po.lines.length}</TableCell>
                      <TableCell className="text-sm font-medium text-zinc-200 text-right">{fmt(po.total)}</TableCell>
                    </TableRow>

                    {expandedRows.has(po.id) && (
                      <TableRow className="bg-zinc-950/50 hover:bg-zinc-950/50">
                        <TableCell colSpan={9} className="p-0 border-b border-zinc-800/50">
                          <div className="p-4 pl-12 border-l-2 border-indigo-500/30 ml-4 space-y-4 my-2">
                            <div>
                              <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Wrench className="w-3 h-3" /> Line Items</h4>
                              <div className="border border-zinc-800 rounded-md overflow-hidden bg-zinc-900/50">
                                <Table>
                                  <TableHeader className="bg-zinc-950/50">
                                    <TableRow className="border-zinc-800">
                                      <TableHead className="h-8 text-xs text-zinc-500">#</TableHead>
                                      <TableHead className="h-8 text-xs text-zinc-500">Description</TableHead>
                                      <TableHead className="h-8 text-xs text-zinc-500">ATA</TableHead>
                                      <TableHead className="h-8 text-xs text-zinc-500">Repair Type</TableHead>
                                      <TableHead className="h-8 text-xs text-zinc-500 text-right">Amount</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {po.lines.map(line => (
                                      <TableRow key={line.number} className="border-zinc-800/50 hover:bg-zinc-800/30">
                                        <TableCell className="py-2 text-xs text-zinc-400">{line.number}</TableCell>
                                        <TableCell className="py-2 text-xs text-zinc-300">{line.description}</TableCell>
                                        <TableCell className="py-2 text-xs text-zinc-400"><span className="font-mono">{line.ataCode}</span> <span className="text-zinc-500">- {line.ataGroup}</span></TableCell>
                                        <TableCell className="py-2 text-xs"><Badge variant="outline" className="text-[10px] bg-zinc-800/50 text-zinc-300 border-zinc-700 px-1.5 py-0">{line.repairType}</Badge></TableCell>
                                        <TableCell className="py-2 text-xs text-zinc-300 font-medium text-right">{fmt(line.amount)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                            {po.notes.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><AlertCircle className="w-3 h-3" /> Notes</h4>
                                <div className="space-y-2">
                                  {po.notes.map((note, idx) => (
                                    <div key={idx} className="text-sm bg-zinc-900/50 border border-zinc-800/80 rounded-md p-3">
                                      <div className="text-zinc-300">{note.text}</div>
                                      <div className="text-xs text-zinc-500 mt-1">{note.date}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
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
    </div>
  );
}
