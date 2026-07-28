import React, { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, Calendar, Truck } from "lucide-react";
import { MultiSelect } from "./MultiSelect";

const ATA_GROUPS = [
  { code: "33", name: "Brakes", totalSpend: 28450, color: "bg-teal-500", text: "text-teal-400", border: "border-teal-500/20", bgLight: "bg-teal-500/10" },
  { code: "42", name: "Tires", totalSpend: 19200, color: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/20", bgLight: "bg-blue-500/10" },
  { code: "01", name: "Engine", totalSpend: 14600, color: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/20", bgLight: "bg-orange-500/10" },
  { code: "14", name: "Fuel", totalSpend: 8900, color: "bg-yellow-500", text: "text-yellow-400", border: "border-yellow-500/20", bgLight: "bg-yellow-500/10" },
  { code: "71", name: "Body", totalSpend: 6200, color: "bg-purple-500", text: "text-purple-400", border: "border-purple-500/20", bgLight: "bg-purple-500/10" },
];

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CLOSED: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  DECLINED: "bg-red-500/10 text-red-400 border-red-500/20",
};

const TYPE_COLORS: Record<string, string> = {
  Repair: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  PM: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Tires: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Body: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const MOCK_POS = [
  { id: "PO-90211", vehicle: "021100", type: "Repair", status: "APPROVED", date: "2026-06-12", total: 4250.00, vendor: "Jiffy Lube", ataGroup: "33", lines: [{ id: "L1", desc: "Front Brake Pads", ataCode: "33-001", ataGroup: "33 Brakes", repairType: "Replace", amount: 850.00 }, { id: "L2", desc: "Rotors Machining", ataCode: "33-002", ataGroup: "33 Brakes", repairType: "Machine", amount: 1200.00 }, { id: "L3", desc: "Labor", ataCode: "33-999", ataGroup: "33 Brakes", repairType: "Labor", amount: 2200.00 }], notes: [{ date: "2026-06-12 09:30", text: "Vendor reported heavy wear on rotors." }, { date: "2026-06-12 10:15", text: "Approved via automated rules." }] },
  { id: "PO-90212", vehicle: "034567", type: "Tires", status: "CLOSED", date: "2026-06-10", total: 3600.00, vendor: "Goodyear", ataGroup: "42", lines: [{ id: "L1", desc: "Drive Tires x4", ataCode: "42-004", ataGroup: "42 Tires", repairType: "Replace", amount: 3200.00 }, { id: "L2", desc: "Mount & Balance", ataCode: "42-999", ataGroup: "42 Tires", repairType: "Labor", amount: 400.00 }], notes: [{ date: "2026-06-10 14:20", text: "Routine replacement at 120k miles." }] },
  { id: "PO-90215", vehicle: "021100", type: "Repair", status: "OPEN", date: "2026-06-14", total: 2850.00, vendor: "NAPA", ataGroup: "01", lines: [{ id: "L1", desc: "Alternator Assembly", ataCode: "01-021", ataGroup: "01 Engine", repairType: "Replace", amount: 1850.00 }, { id: "L2", desc: "Serpentine Belt", ataCode: "01-022", ataGroup: "01 Engine", repairType: "Replace", amount: 150.00 }, { id: "L3", desc: "Labor", ataCode: "01-999", ataGroup: "01 Engine", repairType: "Labor", amount: 850.00 }], notes: [{ date: "2026-06-14 08:00", text: "Vehicle towed in, no start condition." }] },
  { id: "PO-90218", vehicle: "045612", type: "Body", status: "DECLINED", date: "2026-06-08", total: 1250.00, vendor: "Pep Boys", ataGroup: "71", lines: [{ id: "L1", desc: "Mirror Assembly Right", ataCode: "71-045", ataGroup: "71 Body", repairType: "Replace", amount: 1050.00 }, { id: "L2", desc: "Labor", ataCode: "71-999", ataGroup: "71 Body", repairType: "Labor", amount: 200.00 }], notes: [{ date: "2026-06-08 11:30", text: "Declined: Driver caused damage, pending safety review." }] },
  { id: "PO-90220", vehicle: "034567", type: "Repair", status: "APPROVED", date: "2026-06-15", total: 1400.00, vendor: "Jiffy Lube", ataGroup: "33", lines: [{ id: "L1", desc: "Rear Brake Adjust", ataCode: "33-005", ataGroup: "33 Brakes", repairType: "Adjust", amount: 400.00 }, { id: "L2", desc: "Air Valve Swap", ataCode: "33-008", ataGroup: "33 Brakes", repairType: "Replace", amount: 1000.00 }], notes: [{ date: "2026-06-15 10:00", text: "Driver reported air leak on rear axle." }] },
];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const VENDOR_OPTIONS = ["Jiffy Lube", "Goodyear", "NAPA", "Pep Boys"].map(v => ({ value: v, label: v }));
const STATUSES = ["OPEN", "APPROVED", "CLOSED", "DECLINED"];

export function AtaBreakdown() {
  const [selectedAta, setSelectedAta] = useState<string | null>(null);
  const [expandedPOs, setExpandedPOs] = useState<Record<string, boolean>>({});
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const togglePO = (id: string) => setExpandedPOs(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleStatus = (s: string) => {
    const n = new Set(statusFilter);
    n.has(s) ? n.delete(s) : n.add(s);
    setStatusFilter(n.size === STATUSES.length ? new Set() : n);
  };

  const filteredPOs = useMemo(() => MOCK_POS.filter(po => {
    if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
    if (vendorFilter.size > 0 && !vendorFilter.has(po.vendor)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(po.status)) return false;
    return true;
  }), [vehicleFilter, vendorFilter, statusFilter]);

  const groupedPOs = useMemo(() => {
    const groups: Record<string, typeof MOCK_POS> = {};
    filteredPOs.forEach(po => {
      if (!groups[po.ataGroup]) groups[po.ataGroup] = [];
      groups[po.ataGroup].push(po);
    });
    return groups;
  }, [filteredPOs]);

  const maxSpend = Math.max(...ATA_GROUPS.map(g => g.totalSpend));
  const filteredGroups = selectedAta ? ATA_GROUPS.filter(g => g.code === selectedAta) : ATA_GROUPS;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col p-4 md:p-6 lg:p-8 space-y-6">

      <div className="flex flex-col space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">ATA Group Breakdown</h1>

        <div className="flex flex-wrap items-center gap-2 bg-zinc-900/50 border border-zinc-800/80 p-3 rounded-lg">
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 focus-within:ring-1 focus-within:ring-zinc-700">
            <Search className="w-4 h-4 text-zinc-500" />
            <input type="text" placeholder="Vehicle #" value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}
              className="bg-transparent border-none outline-none text-sm placeholder:text-zinc-600 w-24" />
          </div>

          <MultiSelect label="Vendors" options={VENDOR_OPTIONS} selected={vendorFilter} onChange={setVendorFilter} />

          <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-md p-1">
            {STATUSES.map(s => (
              <button key={s} onClick={() => toggleStatus(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter.size === 0 || statusFilter.has(s) ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 ml-auto">
            <Calendar className="w-4 h-4 text-zinc-500" />
            <span className="text-sm text-zinc-300">Last 3 Years</span>
            <ChevronDown className="w-4 h-4 text-zinc-500 ml-1" />
          </div>
        </div>
      </div>

      <div className="flex gap-6 lg:gap-8 items-start">
        <div className="flex-1 flex flex-col space-y-8 min-w-0">

          <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Top Spend by ATA Group</h2>
              {selectedAta && <button onClick={() => setSelectedAta(null)} className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2">Clear filter</button>}
            </div>
            <div className="space-y-3">
              {ATA_GROUPS.map(group => {
                const isSelected = selectedAta === group.code;
                const isFaded = selectedAta && !isSelected;
                const widthPct = Math.max((group.totalSpend / maxSpend) * 100, 2);
                return (
                  <div key={group.code} className={`group flex items-center gap-4 cursor-pointer transition-opacity duration-200 ${isFaded ? "opacity-30" : "opacity-100"}`} onClick={() => setSelectedAta(isSelected ? null : group.code)}>
                    <div className="w-24 shrink-0 text-right text-sm">
                      <span className="font-mono text-zinc-500 mr-2">{group.code}</span>
                      <span className="font-medium">{group.name}</span>
                    </div>
                    <div className="flex-1 h-6 bg-zinc-950 rounded overflow-hidden relative border border-zinc-800">
                      <div className={`h-full ${group.color} transition-all duration-500 ease-out`} style={{ width: `${widthPct}%` }} />
                    </div>
                    <div className="w-24 shrink-0 text-sm font-mono text-zinc-300">{fmt(group.totalSpend)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            {filteredGroups.map(group => {
              const posInGroup = groupedPOs[group.code] || [];
              if (posInGroup.length === 0) return null;
              const groupSubtotal = posInGroup.reduce((sum, po) => sum + po.total, 0);
              return (
                <div key={group.code} className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/50">
                  <div className={`sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-zinc-800 backdrop-blur-md ${group.bgLight}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${group.color}`} />
                      <h3 className="font-medium"><span className="font-mono text-zinc-500 mr-2">{group.code}</span>{group.name}</h3>
                      <span className="text-xs text-zinc-500 bg-zinc-950/50 px-2 py-0.5 rounded-full">{posInGroup.length} POs</span>
                    </div>
                    <div className={`font-mono text-sm font-medium ${group.text}`}>{fmt(groupSubtotal)}</div>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {posInGroup.map(po => {
                      const isExpanded = expandedPOs[po.id];
                      return (
                        <div key={po.id} className="flex flex-col">
                          <div className={`flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/30 cursor-pointer transition-colors ${isExpanded ? "bg-zinc-800/20" : ""}`} onClick={() => togglePO(po.id)}>
                            <button className="text-zinc-500 hover:text-zinc-300 w-5 h-5 flex items-center justify-center shrink-0">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className="w-24 font-mono text-sm">{po.id}</div>
                            <div className="w-24"><span className="flex items-center gap-1.5 text-xs text-zinc-400"><Truck className="w-3 h-3" />{po.vehicle}</span></div>
                            <div className="w-24"><span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md border ${TYPE_COLORS[po.type] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>{po.type}</span></div>
                            <div className="w-28"><span className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md border ${STATUS_COLORS[po.status]}`}>{po.status}</span></div>
                            <div className="w-24 text-sm text-zinc-400">{po.date}</div>
                            <div className="flex-1 text-sm font-medium truncate">{po.vendor}</div>
                            <div className="w-24 text-sm text-zinc-400 text-right">{po.lines.length} lines</div>
                            <div className="w-24 font-mono text-sm text-right font-medium">{fmt(po.total)}</div>
                          </div>
                          {isExpanded && (
                            <div className="pl-14 pr-4 py-4 bg-zinc-950 border-t border-zinc-800/50 space-y-4">
                              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                                <table className="w-full text-sm text-left">
                                  <thead className="bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-500 font-medium">
                                    <tr>
                                      <th className="px-4 py-2 w-16">#</th>
                                      <th className="px-4 py-2">Description</th>
                                      <th className="px-4 py-2 w-24">ATA Code</th>
                                      <th className="px-4 py-2 w-32">ATA Group</th>
                                      <th className="px-4 py-2 w-24">Repair Type</th>
                                      <th className="px-4 py-2 w-32 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-800/50 bg-zinc-950/50">
                                    {po.lines.map(line => (
                                      <tr key={line.id} className="hover:bg-zinc-900/50 transition-colors">
                                        <td className="px-4 py-2 font-mono text-zinc-500">{line.id}</td>
                                        <td className="px-4 py-2 text-zinc-300">{line.desc}</td>
                                        <td className="px-4 py-2 font-mono text-zinc-400">{line.ataCode}</td>
                                        <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${group.color}`} /><span className="text-zinc-400 text-xs">{line.ataGroup}</span></span></td>
                                        <td className="px-4 py-2 text-zinc-400 text-xs">{line.repairType}</td>
                                        <td className="px-4 py-2 font-mono text-right">{fmt(line.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="space-y-2">
                                <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Notes Log</h4>
                                <div className="space-y-2">
                                  {po.notes.map((note, idx) => (
                                    <div key={idx} className="flex gap-3 text-sm">
                                      <span className="font-mono text-zinc-500 shrink-0">{note.date}</span>
                                      <span className="text-zinc-300 bg-zinc-900/50 px-3 py-1.5 rounded-md flex-1 border border-zinc-800/50">{note.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filteredGroups.every(g => !(groupedPOs[g.code] || []).length) && (
              <div className="text-center text-zinc-500 py-16">No POs match the current filters.</div>
            )}
          </div>
        </div>

        <div className="w-48 shrink-0 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sticky top-6">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4">Group Legend</h3>
            <div className="space-y-2">
              {ATA_GROUPS.map(group => (
                <button key={group.code} onClick={() => setSelectedAta(selectedAta === group.code ? null : group.code)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-all text-sm ${selectedAta === group.code ? `${group.bgLight} ${group.border} ${group.text}` : "border-transparent hover:bg-zinc-800/50 text-zinc-400"}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${group.color}`} />
                    <span>{group.name}</span>
                  </div>
                  <span className="font-mono text-xs opacity-50">{group.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
