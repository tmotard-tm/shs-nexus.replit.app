import React, { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  ChevronDown, 
  ChevronRight, 
  Search, 
  Filter,
  X,
  FileText,
  Wrench,
  Calendar,
  AlertCircle
} from "lucide-react";

// Mock Data Types
type Note = {
  text: string;
  date: string;
};

type LineItem = {
  number: number;
  description: string;
  ataCode: string;
  ataGroup: string;
  repairType: string;
  amount: number;
};

type PO = {
  id: string;
  vehicle: string;
  type: "PO" | "RO";
  status: "OPEN" | "APPROVED" | "CLOSED" | "DECLINED";
  date: string;
  total: number;
  vendor: string;
  lines: LineItem[];
  notes: Note[];
};

// Mock Data
const MOCK_VENDORS = [
  "Goodyear Auto Service",
  "NAPA Auto Parts",
  "Pep Boys",
  "Jiffy Lube",
  "Safelite AutoGlass",
  "Firestone Complete Auto Care",
  "Penske Truck Rental",
  "Valvoline Instant Oil Change"
];

const MOCK_POS: PO[] = Array.from({ length: 45 }).map((_, i) => {
  const vendorIndex = i % MOCK_VENDORS.length;
  // Make Goodyear have the most POs/Spend, NAPA second, etc.
  const weightedVendorIndex = Math.floor(Math.pow(Math.random(), 2) * MOCK_VENDORS.length);
  const vendor = MOCK_VENDORS[weightedVendorIndex];
  
  const statuses: PO["status"][] = ["OPEN", "APPROVED", "CLOSED", "CLOSED", "CLOSED", "DECLINED"];
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  
  const lineCount = Math.floor(Math.random() * 4) + 1;
  const lines: LineItem[] = Array.from({ length: lineCount }).map((_, li) => ({
    number: li + 1,
    description: `Replace part ${Math.floor(Math.random() * 1000)}`,
    ataCode: ["01", "14", "33", "42", "71"][Math.floor(Math.random() * 5)],
    ataGroup: ["Engine", "Fuel", "Brakes", "Tires", "Body"][Math.floor(Math.random() * 5)],
    repairType: ["PM", "PM_R", "R", "W"][Math.floor(Math.random() * 4)],
    amount: Math.floor(Math.random() * 500) + 50,
  }));
  
  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  return {
    id: `PO-${100000 + i}`,
    vehicle: ["021100", "034567", "048291", "051122"][Math.floor(Math.random() * 4)],
    type: Math.random() > 0.8 ? "RO" : "PO",
    status,
    date: new Date(Date.now() - Math.random() * 10000000000).toISOString().split('T')[0],
    total,
    vendor,
    lines,
    notes: Math.random() > 0.5 ? [{
      text: "Called vendor for update, parts ordered.",
      date: new Date(Date.now() - Math.random() * 500000000).toISOString().split('T')[0]
    }] : []
  };
});

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function VendorSpend() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [ataFilter, setAtaFilter] = useState("all");
  const [repairTypeFilter, setRepairTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["OPEN", "APPROVED", "CLOSED", "DECLINED"]));

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const toggleStatus = (status: string) => {
    const newStatus = new Set(statusFilter);
    if (newStatus.has(status)) {
      newStatus.delete(status);
    } else {
      newStatus.add(status);
    }
    setStatusFilter(newStatus);
  };

  // Compute vendor spend metrics
  const vendorStats = useMemo(() => {
    const stats: Record<string, { total: number; count: number }> = {};
    MOCK_POS.forEach(po => {
      if (!stats[po.vendor]) {
        stats[po.vendor] = { total: 0, count: 0 };
      }
      stats[po.vendor].total += po.total;
      stats[po.vendor].count += 1;
    });

    return Object.entries(stats)
      .map(([vendor, data]) => ({ vendor, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8); // Top 8
  }, []);

  const maxSpend = Math.max(...vendorStats.map(v => v.total));

  // Filter POs
  const filteredPOs = useMemo(() => {
    return MOCK_POS.filter(po => {
      if (selectedVendor && po.vendor !== selectedVendor) return false;
      if (vehicleFilter && !po.vehicle.includes(vehicleFilter)) return false;
      if (!statusFilter.has(po.status)) return false;
      
      const hasAta = ataFilter === "all" || po.lines.some(l => l.ataCode === ataFilter);
      if (!hasAta) return false;
      
      const hasRepairType = repairTypeFilter === "all" || po.lines.some(l => l.repairType === repairTypeFilter);
      if (!hasRepairType) return false;

      return true;
    });
  }, [selectedVendor, vehicleFilter, ataFilter, repairTypeFilter, statusFilter]);

  const selectedVendorData = selectedVendor ? vendorStats.find(v => v.vendor === selectedVendor) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans dark">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header & Filter Bar */}
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

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input 
                placeholder="Vehicle #..." 
                value={vehicleFilter}
                onChange={(e) => setVehicleFilter(e.target.value)}
                className="w-40 bg-zinc-950 border-zinc-800 pl-9 text-sm h-9 placeholder:text-zinc-600 focus-visible:ring-zinc-700" 
              />
            </div>
            
            <Select value={ataFilter} onValueChange={setAtaFilter}>
              <SelectTrigger className="w-40 bg-zinc-950 border-zinc-800 h-9 text-sm">
                <SelectValue placeholder="ATA Code" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                <SelectItem value="all">All ATA Codes</SelectItem>
                <SelectItem value="01">01 - Engine</SelectItem>
                <SelectItem value="14">14 - Fuel</SelectItem>
                <SelectItem value="33">33 - Brakes</SelectItem>
                <SelectItem value="42">42 - Tires</SelectItem>
                <SelectItem value="71">71 - Body</SelectItem>
              </SelectContent>
            </Select>

            <Select value={repairTypeFilter} onValueChange={setRepairTypeFilter}>
              <SelectTrigger className="w-40 bg-zinc-950 border-zinc-800 h-9 text-sm">
                <SelectValue placeholder="Repair Type" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                <SelectItem value="all">All Repair Types</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
                <SelectItem value="PM_R">PM_R</SelectItem>
                <SelectItem value="R">R</SelectItem>
                <SelectItem value="W">W</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1 border border-zinc-800 rounded-md p-1 bg-zinc-950">
              {["OPEN", "APPROVED", "CLOSED", "DECLINED"].map(status => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter.has(status) 
                      ? 'bg-zinc-800 text-zinc-100' 
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart Section */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">Top Vendors by Total Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {vendorStats.map((stat) => {
                const widthPercent = Math.max((stat.total / maxSpend) * 100, 2);
                const isSelected = selectedVendor === stat.vendor;
                return (
                  <div 
                    key={stat.vendor}
                    className="flex items-center gap-4 cursor-pointer group"
                    onClick={() => setSelectedVendor(isSelected ? null : stat.vendor)}
                  >
                    <div className="w-48 text-right text-sm truncate font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
                      {stat.vendor}
                    </div>
                    <div className="flex-1 flex items-center gap-3">
                      <div className="h-6 w-full bg-zinc-950 rounded-sm overflow-hidden flex items-center relative">
                        <div 
                          className={`h-full transition-all duration-500 rounded-sm ${isSelected ? 'bg-indigo-500' : 'bg-zinc-700 group-hover:bg-zinc-600'}`}
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>
                      <div className="w-32 flex justify-between text-sm">
                        <span className={isSelected ? 'text-indigo-400 font-medium' : 'text-zinc-400'}>
                          {formatCurrency(stat.total)}
                        </span>
                        <span className="text-zinc-500 text-xs mt-0.5">({stat.count})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Table Section */}
        <div className="space-y-4">
          {selectedVendorData && (
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-3 py-1.5 rounded-full text-sm">
                <span>Showing: <strong className="font-semibold text-indigo-200">{selectedVendorData.vendor}</strong> — {formatCurrency(selectedVendorData.total)} across {selectedVendorData.count} POs</span>
                <button 
                  onClick={() => setSelectedVendor(null)}
                  className="ml-2 hover:bg-indigo-500/20 rounded-full p-0.5 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900 shadow-sm">
            <Table>
              <TableHeader className="bg-zinc-950 border-b border-zinc-800">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="w-10"></TableHead>
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
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-zinc-500">
                      No POs match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPOs.map((po) => (
                    <React.Fragment key={po.id}>
                      <TableRow 
                        className={`group cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${expandedRows.has(po.id) ? 'bg-zinc-800/30' : ''}`}
                        onClick={() => toggleRow(po.id)}
                      >
                        <TableCell className="p-2 pl-4">
                          <Button variant="ghost" size="icon" className="w-6 h-6 p-0 text-zinc-500 hover:text-zinc-300">
                            {expandedRows.has(po.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-300 py-3">{po.id}</TableCell>
                        <TableCell className="text-sm text-zinc-300">{po.vehicle}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`
                            ${po.type === 'PO' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'}
                            font-mono text-xs
                          `}>
                            {po.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${
                              po.status === 'OPEN' ? 'bg-blue-500' :
                              po.status === 'APPROVED' ? 'bg-emerald-500' :
                              po.status === 'CLOSED' ? 'bg-zinc-500' :
                              'bg-red-500'
                            }`} />
                            <span className="text-xs font-medium text-zinc-300">{po.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-zinc-400">{po.date}</TableCell>
                        <TableCell className="text-sm text-zinc-300 truncate max-w-[200px]">{po.vendor}</TableCell>
                        <TableCell className="text-sm text-zinc-400 text-right">{po.lines.length}</TableCell>
                        <TableCell className="text-sm font-medium text-zinc-200 text-right">{formatCurrency(po.total)}</TableCell>
                      </TableRow>
                      
                      {/* Expanded Content */}
                      {expandedRows.has(po.id) && (
                        <TableRow className="bg-zinc-950/50 hover:bg-zinc-950/50">
                          <TableCell colSpan={9} className="p-0 border-b border-zinc-800/50">
                            <div className="p-4 pl-12 border-l-2 border-indigo-500/30 ml-4 space-y-4 my-2">
                              {/* Lines Table */}
                              <div>
                                <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                  <Wrench className="w-3 h-3" /> Line Items
                                </h4>
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
                                          <TableCell className="py-2 text-xs text-zinc-400">
                                            <span className="font-mono">{line.ataCode}</span> <span className="text-zinc-500">- {line.ataGroup}</span>
                                          </TableCell>
                                          <TableCell className="py-2 text-xs">
                                            <Badge variant="outline" className="text-[10px] bg-zinc-800/50 text-zinc-300 border-zinc-700 px-1.5 py-0">
                                              {line.repairType}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="py-2 text-xs text-zinc-300 font-medium text-right">{formatCurrency(line.amount)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>

                              {/* Notes */}
                              {po.notes.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <AlertCircle className="w-3 h-3" /> Notes
                                  </h4>
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
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

      </div>
    </div>
  );
}
