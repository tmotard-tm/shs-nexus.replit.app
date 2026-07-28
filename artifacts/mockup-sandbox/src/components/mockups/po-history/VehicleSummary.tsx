import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { ChevronDown, ChevronRight, ArrowLeft, Filter, Search, Calendar, FileText, Wrench, MoreHorizontal, PenTool } from "lucide-react";
import "./_group.css";

// --- Mock Data ---

type LineItem = {
  lineNumber: number;
  description: string;
  ataCode: string;
  ataGroup: string;
  repairType: string;
  amount: number;
};

type Note = {
  text: string;
  date: string;
};

type PO = {
  poNumber: string;
  type: string;
  status: "OPEN" | "APPROVED" | "CLOSED" | "DECLINED";
  date: string;
  total: number;
  vendor: string;
  lines: LineItem[];
  notes: Note[];
};

type Vehicle = {
  id: string;
  poCount: number;
  totalSpend: number;
  openPos: number;
  lastPoDate: string;
  topVendor: string;
  pos: PO[];
};

const mockVehicles: Vehicle[] = [
  {
    id: "021100",
    poCount: 14,
    totalSpend: 12450.50,
    openPos: 2,
    lastPoDate: "2023-10-15",
    topVendor: "Goodyear",
    pos: [
      {
        poNumber: "PO-99412",
        type: "Repair",
        status: "OPEN",
        date: "2023-10-15",
        total: 1250.00,
        vendor: "Goodyear",
        lines: [
          { lineNumber: 1, description: "Replace 4 Tires", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Replacement", amount: 1200.00 },
          { lineNumber: 2, description: "Disposal Fee", ataCode: "42 Tires", ataGroup: "Tires", repairType: "Fee", amount: 50.00 }
        ],
        notes: [
          { text: "Awaiting approval for premium tires", date: "2023-10-16" }
        ]
      },
      {
        poNumber: "PO-98111",
        type: "Maintenance",
        status: "CLOSED",
        date: "2023-09-01",
        total: 150.00,
        vendor: "Jiffy Lube",
        lines: [
          { lineNumber: 1, description: "Synthetic Oil Change", ataCode: "01 Engine", ataGroup: "PM", repairType: "Preventative", amount: 150.00 }
        ],
        notes: []
      }
    ]
  },
  {
    id: "034567",
    poCount: 8,
    totalSpend: 4320.75,
    openPos: 0,
    lastPoDate: "2023-11-02",
    topVendor: "NAPA",
    pos: [
      {
        poNumber: "PO-100234",
        type: "Repair",
        status: "APPROVED",
        date: "2023-11-02",
        total: 450.25,
        vendor: "NAPA",
        lines: [
          { lineNumber: 1, description: "Brake Pads", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Replacement", amount: 300.00 },
          { lineNumber: 2, description: "Labor", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Labor", amount: 150.25 }
        ],
        notes: [
          { text: "Approved by regional manager", date: "2023-11-03" }
        ]
      }
    ]
  },
  {
    id: "047823",
    poCount: 22,
    totalSpend: 28900.00,
    openPos: 5,
    lastPoDate: "2023-11-10",
    topVendor: "Pep Boys",
    pos: []
  },
  {
    id: "056231",
    poCount: 3,
    totalSpend: 890.00,
    openPos: 0,
    lastPoDate: "2023-05-20",
    topVendor: "Jiffy Lube",
    pos: []
  },
  {
    id: "062445",
    poCount: 11,
    totalSpend: 8450.20,
    openPos: 1,
    lastPoDate: "2023-10-28",
    topVendor: "Goodyear",
    pos: []
  },
  {
    id: "071009",
    poCount: 31,
    totalSpend: 41200.80,
    openPos: 0,
    lastPoDate: "2023-11-12",
    topVendor: "Cummins",
    pos: []
  }
];

// --- Formatters ---
const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const getStatusColor = (status: PO["status"]) => {
  switch (status) {
    case "OPEN": return "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/20";
    case "APPROVED": return "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20";
    case "CLOSED": return "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 border-zinc-500/20";
    case "DECLINED": return "bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20";
    default: return "bg-zinc-500/10 text-zinc-400";
  }
};

const getTypeColor = (type: string) => {
  switch (type.toLowerCase()) {
    case "repair": return "bg-violet-500/10 text-violet-400 border-violet-500/20";
    case "maintenance": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    default: return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
};

export function VehicleSummary() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const selectedVehicle = mockVehicles.find(v => v.id === selectedVehicleId);

  // Stats
  const totalSpend = mockVehicles.reduce((acc, v) => acc + v.totalSpend, 0);
  const totalPOs = mockVehicles.reduce((acc, v) => acc + v.poCount, 0);
  const openPOs = mockVehicles.reduce((acc, v) => acc + v.openPos, 0);
  const maxSpendVehicle = [...mockVehicles].sort((a, b) => b.totalSpend - a.totalSpend)[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header & Filter Bar */}
        <div className="flex flex-col space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight text-white">Vehicle Cost Summary</h1>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" className="bg-zinc-900 border-zinc-800 text-zinc-300">
                <Calendar className="w-4 h-4 mr-2" />
                Last 3 Years
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/50">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input placeholder="Vehicle #..." className="w-36 pl-9 bg-zinc-900 border-zinc-800 h-9" />
            </div>
            
            <Select>
              <SelectTrigger className="w-40 bg-zinc-900 border-zinc-800 h-9">
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="goodyear">Goodyear</SelectItem>
                <SelectItem value="jiffylube">Jiffy Lube</SelectItem>
                <SelectItem value="napa">NAPA</SelectItem>
                <SelectItem value="pepboys">Pep Boys</SelectItem>
              </SelectContent>
            </Select>

            <Select>
              <SelectTrigger className="w-40 bg-zinc-900 border-zinc-800 h-9">
                <SelectValue placeholder="ATA Code" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="01">01 Engine</SelectItem>
                <SelectItem value="14">14 Fuel</SelectItem>
                <SelectItem value="33">33 Brakes</SelectItem>
                <SelectItem value="42">42 Tires</SelectItem>
                <SelectItem value="71">71 Body</SelectItem>
              </SelectContent>
            </Select>

            <Select>
              <SelectTrigger className="w-40 bg-zinc-900 border-zinc-800 h-9">
                <SelectValue placeholder="Repair Type" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="pm">Preventative</SelectItem>
                <SelectItem value="repair">Repair</SelectItem>
                <SelectItem value="tow">Towing</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1 border-l border-zinc-800 pl-3">
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 cursor-pointer hover:bg-blue-500/20">Open</Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20">Approved</Badge>
              <Badge variant="outline" className="bg-zinc-800 text-zinc-400 border-zinc-700 cursor-pointer hover:bg-zinc-700">Closed</Badge>
              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 cursor-pointer hover:bg-red-500/20">Declined</Badge>
            </div>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="bg-zinc-900/50 border-zinc-800/50 shadow-none">
            <CardContent className="p-4 flex flex-col justify-center">
              <p className="text-sm font-medium text-zinc-500 mb-1">Fleet Total Spend</p>
              <p className="text-2xl font-bold text-white">{formatCurrency(totalSpend)}</p>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800/50 shadow-none">
            <CardContent className="p-4 flex flex-col justify-center">
              <p className="text-sm font-medium text-zinc-500 mb-1">Total POs</p>
              <p className="text-2xl font-bold text-white">{totalPOs}</p>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800/50 shadow-none">
            <CardContent className="p-4 flex flex-col justify-center">
              <p className="text-sm font-medium text-zinc-500 mb-1">Open POs</p>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-white">{openPOs}</p>
                {openPOs > 0 && <span className="flex h-2 w-2 rounded-full bg-blue-500" />}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800/50 shadow-none">
            <CardContent className="p-4 flex flex-col justify-center">
              <p className="text-sm font-medium text-zinc-500 mb-1">Most Expensive Vehicle</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-200 hover:bg-zinc-700">#{maxSpendVehicle.id}</Badge>
                <span className="text-sm font-medium text-zinc-400">{formatCurrency(maxSpendVehicle.totalSpend)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Area */}
        {!selectedVehicleId ? (
          // Top Vehicle Table
          <div className="border border-zinc-800/50 rounded-lg overflow-hidden bg-zinc-900/20">
            <Table>
              <TableHeader className="bg-zinc-900/50">
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 font-medium">Vehicle #</TableHead>
                  <TableHead className="text-zinc-400 font-medium text-right">PO Count</TableHead>
                  <TableHead className="text-zinc-400 font-medium text-right">Total Spend</TableHead>
                  <TableHead className="text-zinc-400 font-medium text-center">Open POs</TableHead>
                  <TableHead className="text-zinc-400 font-medium">Last PO Date</TableHead>
                  <TableHead className="text-zinc-400 font-medium">Top Vendor</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockVehicles.map(vehicle => (
                  <TableRow 
                    key={vehicle.id} 
                    className="border-zinc-800/50 hover:bg-zinc-800/20 cursor-pointer group"
                    onClick={() => setSelectedVehicleId(vehicle.id)}
                  >
                    <TableCell className="font-medium text-zinc-200">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-zinc-600" />
                        {vehicle.id}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-zinc-400">{vehicle.poCount}</TableCell>
                    <TableCell className="text-right font-medium text-zinc-200">{formatCurrency(vehicle.totalSpend)}</TableCell>
                    <TableCell className="text-center">
                      {vehicle.openPos > 0 ? (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 font-normal">
                          {vehicle.openPos} Open
                        </Badge>
                      ) : (
                        <span className="text-zinc-600">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-400">{vehicle.lastPoDate}</TableCell>
                    <TableCell className="text-zinc-400">{vehicle.topVendor}</TableCell>
                    <TableCell>
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          // Drill-in PO Detail View for a Vehicle
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-4 border-b border-zinc-800 pb-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSelectedVehicleId(null)}
                className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                All Vehicles
              </Button>
              <div className="h-4 w-px bg-zinc-800" />
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-white">Vehicle #{selectedVehicle?.id}</h2>
                <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
                  {formatCurrency(selectedVehicle?.totalSpend || 0)} Total
                </Badge>
                {(selectedVehicle?.openPos || 0) > 0 && (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                    {selectedVehicle?.openPos} Open POs
                  </Badge>
                )}
              </div>
            </div>

            <div className="border border-zinc-800/50 rounded-lg overflow-hidden bg-zinc-900/20">
              <Table>
                <TableHeader className="bg-zinc-900/50">
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead className="text-zinc-400 font-medium">PO #</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Type</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Status</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Date</TableHead>
                    <TableHead className="text-zinc-400 font-medium">Vendor</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-right"># Lines</TableHead>
                    <TableHead className="text-zinc-400 font-medium text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedVehicle?.pos.map(po => (
                    <CollapsibleRow key={po.poNumber} po={po} />
                  ))}
                  {selectedVehicle?.pos.length === 0 && (
                    <TableRow className="hover:bg-transparent border-0">
                      <TableCell colSpan={8} className="h-32 text-center text-zinc-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <FileText className="w-8 h-8 text-zinc-700" />
                          <p>No PO details loaded for this mockup.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleRow({ po }: { po: PO }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <TableRow className="border-zinc-800/50 hover:bg-zinc-800/20 group">
        <TableCell>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-300" onClick={() => setIsOpen(!isOpen)}>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "rotate-180" : "-rotate-90"}`} />
          </Button>
        </TableCell>
        <TableCell className="font-medium text-zinc-200">{po.poNumber}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`font-normal ${getTypeColor(po.type)}`}>
            {po.type}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`font-normal ${getStatusColor(po.status)}`}>
            {po.status}
          </Badge>
        </TableCell>
        <TableCell className="text-zinc-400">{po.date}</TableCell>
        <TableCell className="text-zinc-300">{po.vendor}</TableCell>
        <TableCell className="text-right text-zinc-400">{po.lines.length}</TableCell>
        <TableCell className="text-right font-medium text-zinc-200">{formatCurrency(po.total)}</TableCell>
      </TableRow>
      
      {isOpen && (
        <TableRow className="border-zinc-800/50 bg-zinc-900/30 hover:bg-zinc-900/30">
          <TableCell colSpan={8} className="p-0">
            <div className="px-10 py-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
              
              {/* Line Items */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Line Items</h4>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-zinc-900/80">
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="w-[50px] text-zinc-500">#</TableHead>
                        <TableHead className="text-zinc-400">Description</TableHead>
                        <TableHead className="text-zinc-400">ATA Code</TableHead>
                        <TableHead className="text-zinc-400">Repair Type</TableHead>
                        <TableHead className="text-right text-zinc-400">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {po.lines.map((line) => (
                        <TableRow key={line.lineNumber} className="border-zinc-800/50 hover:bg-zinc-900/50">
                          <TableCell className="text-zinc-500">{line.lineNumber}</TableCell>
                          <TableCell className="text-zinc-300">{line.description}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 font-normal hover:bg-zinc-800">
                              {line.ataCode}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-zinc-400">{line.repairType}</TableCell>
                          <TableCell className="text-right font-medium text-zinc-300">{formatCurrency(line.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Notes */}
              {po.notes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Notes</h4>
                  <div className="space-y-2">
                    {po.notes.map((note, i) => (
                      <div key={i} className="flex gap-3 text-sm bg-zinc-900/50 p-3 rounded-md border border-zinc-800/50">
                        <div className="mt-0.5 text-zinc-500"><PenTool className="w-4 h-4" /></div>
                        <div>
                          <p className="text-zinc-300">{note.text}</p>
                          <span className="text-xs text-zinc-600 mt-1 block">{note.date}</span>
                        </div>
                      </div>
                    ))}
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
