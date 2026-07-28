import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Search, Calendar, Filter } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// --- Mock Data ---

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
    poNumber: "PO-2023-0891",
    vehicle: "021100",
    type: "MAINTENANCE",
    status: "CLOSED",
    openDate: "2023-04-12",
    totalAmount: 450.00,
    vendorName: "Jiffy Lube",
    lines: [
      { id: "L1", lineNumber: 1, description: "Synthetic Oil Change", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 150.00 },
      { id: "L2", lineNumber: 2, description: "Air Filter Replacement", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 300.00 }
    ],
    notes: [
      { id: "N1", text: "Approved standard PM services.", date: "2023-04-12T09:00:00Z" }
    ]
  },
  {
    poNumber: "PO-2023-1102",
    vehicle: "034567",
    type: "REPAIR",
    status: "APPROVED",
    openDate: "2023-08-05",
    totalAmount: 1250.75,
    vendorName: "Goodyear",
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
    poNumber: "PO-2023-1544",
    vehicle: "047823",
    type: "REPAIR",
    status: "OPEN",
    openDate: "2023-11-20",
    totalAmount: 875.50,
    vendorName: "NAPA",
    lines: [
      { id: "L5", lineNumber: 1, description: "Brake Pads and Rotors", ataCode: "33 Brakes", ataGroup: "Brakes", repairType: "Wear", amount: 875.50 }
    ],
    notes: [
      { id: "N4", text: "Driver reported squeaking brakes.", date: "2023-11-20T08:30:00Z" }
    ]
  },
  {
    poNumber: "PO-2023-1999",
    vehicle: "056231",
    type: "ACCIDENT",
    status: "DECLINED",
    openDate: "2023-12-01",
    totalAmount: 3200.00,
    vendorName: "Pep Boys",
    lines: [
      { id: "L6", lineNumber: 1, description: "Front Bumper Replacement", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 2000.00 },
      { id: "L7", lineNumber: 2, description: "Paint and Labor", ataCode: "71 Body", ataGroup: "Body", repairType: "Accident", amount: 1200.00 }
    ],
    notes: [
      { id: "N5", text: "Estimate seems high. Requesting secondary quote from another shop.", date: "2023-12-01T14:20:00Z" },
      { id: "N6", text: "Declined PO.", date: "2023-12-02T09:00:00Z" }
    ]
  },
  {
    poNumber: "PO-2024-0012",
    vehicle: "021100",
    type: "MAINTENANCE",
    status: "OPEN",
    openDate: "2024-01-10",
    totalAmount: 210.00,
    vendorName: "Jiffy Lube",
    lines: [
      { id: "L8", lineNumber: 1, description: "Transmission Fluid Flush", ataCode: "01 Engine", ataGroup: "PM", repairType: "PM", amount: 210.00 }
    ],
    notes: []
  },
  {
    poNumber: "PO-2024-0234",
    vehicle: "034567",
    type: "REPAIR",
    status: "CLOSED",
    openDate: "2024-02-15",
    totalAmount: 450.25,
    vendorName: "Goodyear",
    lines: [
      { id: "L9", lineNumber: 1, description: "Fuel Pump Replacement", ataCode: "14 Fuel", ataGroup: "Fuel", repairType: "Repair", amount: 450.25 }
    ],
    notes: [
      { id: "N7", text: "Vehicle stalling. Fuel pump diagnosed as faulty.", date: "2024-02-15T11:45:00Z" }
    ]
  },
  {
    poNumber: "PO-2024-0456",
    vehicle: "047823",
    type: "MAINTENANCE",
    status: "APPROVED",
    openDate: "2024-03-01",
    totalAmount: 85.00,
    vendorName: "NAPA",
    lines: [
      { id: "L10", lineNumber: 1, description: "Wiper Blades", ataCode: "71 Body", ataGroup: "Body", repairType: "PM", amount: 85.00 }
    ],
    notes: []
  },
  {
    poNumber: "PO-2024-0789",
    vehicle: "056231",
    type: "REPAIR",
    status: "CLOSED",
    openDate: "2024-04-10",
    totalAmount: 1150.00,
    vendorName: "Pep Boys",
    lines: [
      { id: "L11", lineNumber: 1, description: "Alternator Replacement", ataCode: "01 Engine", ataGroup: "Electrical", repairType: "Repair", amount: 1150.00 }
    ],
    notes: [
      { id: "N8", text: "Battery not charging. Alternator failed.", date: "2024-04-10T09:30:00Z" }
    ]
  }
];

export function FleetTable() {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  
  const toggleRow = (poNumber: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [poNumber]: !prev[poNumber]
    }));
  };

  const getStatusColor = (status: POStatus) => {
    switch (status) {
      case "OPEN": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "APPROVED": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "CLOSED": return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
      case "DECLINED": return "bg-red-500/20 text-red-400 border-red-500/30";
      default: return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "MAINTENANCE": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
      case "REPAIR": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "ACCIDENT": return "bg-violet-500/10 text-violet-400 border-violet-500/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  const totalSpend = mockPOs.reduce((acc, po) => acc + po.totalAmount, 0);
  const openCount = mockPOs.filter(p => p.status === "OPEN").length;
  const uniqueVehicles = new Set(mockPOs.map(p => p.vehicle)).size;
  const avgPerVehicle = totalSpend / (uniqueVehicles || 1);

  return (
    <div className="flex flex-col h-full min-h-screen bg-zinc-950 text-zinc-100 font-sans p-6 overflow-auto dark">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Fleet PO History</h1>
          <Button variant="outline" size="sm" className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800">
            Export CSV
          </Button>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-center">
            <span className="text-xs text-zinc-400 uppercase tracking-wider font-medium mb-1">Total POs</span>
            <span className="text-2xl font-semibold">{mockPOs.length}</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-center">
            <span className="text-xs text-zinc-400 uppercase tracking-wider font-medium mb-1">Total Spend</span>
            <span className="text-2xl font-semibold">${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-center">
            <span className="text-xs text-zinc-400 uppercase tracking-wider font-medium mb-1">Open POs</span>
            <span className="text-2xl font-semibold text-blue-400">{openCount}</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col justify-center">
            <span className="text-xs text-zinc-400 uppercase tracking-wider font-medium mb-1">Avg / Vehicle</span>
            <span className="text-2xl font-semibold">${avgPerVehicle.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center gap-3">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-500" />
            <Input 
              placeholder="Vehicle #" 
              className="pl-8 bg-zinc-950 border-zinc-800 focus-visible:ring-zinc-700 h-9"
            />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-36 bg-zinc-950 border-zinc-800 h-9">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              <SelectItem value="all">All Vendors</SelectItem>
              <SelectItem value="jiffy">Jiffy Lube</SelectItem>
              <SelectItem value="goodyear">Goodyear</SelectItem>
              <SelectItem value="napa">NAPA</SelectItem>
              <SelectItem value="pepboys">Pep Boys</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="w-36 bg-zinc-950 border-zinc-800 h-9">
              <SelectValue placeholder="ATA Code" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              <SelectItem value="all">All ATA Codes</SelectItem>
              <SelectItem value="01">01 Engine</SelectItem>
              <SelectItem value="14">14 Fuel</SelectItem>
              <SelectItem value="33">33 Brakes</SelectItem>
              <SelectItem value="42">42 Tires</SelectItem>
              <SelectItem value="71">71 Body</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all">
            <SelectTrigger className="w-36 bg-zinc-950 border-zinc-800 h-9">
              <SelectValue placeholder="Repair Type" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="pm">PM</SelectItem>
              <SelectItem value="wear">Wear</SelectItem>
              <SelectItem value="repair">Repair</SelectItem>
              <SelectItem value="accident">Accident</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="bg-zinc-950 border-zinc-800 text-zinc-300 h-9 gap-2 justify-start font-normal w-48">
            <Calendar className="h-4 w-4 text-zinc-500" />
            Last 3 Years
          </Button>

          <div className="flex items-center gap-1 ml-auto">
            <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30 cursor-pointer hover:bg-blue-500/30">OPEN</Badge>
            <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/30">APPROVED</Badge>
            <Badge variant="outline" className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 cursor-pointer hover:bg-zinc-500/30">CLOSED</Badge>
            <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30 cursor-pointer hover:bg-red-500/30">DECLINED</Badge>
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-zinc-950/50">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-10"></TableHead>
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
              {mockPOs.map((po) => (
                <React.Fragment key={po.poNumber}>
                  <TableRow 
                    className="border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                    onClick={() => toggleRow(po.poNumber)}
                  >
                    <TableCell className="p-3">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                        {expandedRows[po.poNumber] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium text-zinc-200">{po.poNumber}</TableCell>
                    <TableCell className="font-mono text-zinc-300">{po.vehicle}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${getTypeColor(po.type)}`}>
                        {po.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${getStatusColor(po.status)}`}>
                        {po.status}
                      </Badge>
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
                          
                          {/* Line Items */}
                          <div>
                            <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                              Line Items
                              <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-800 border-transparent rounded px-1.5 py-0 text-xs">
                                {po.lines.length}
                              </Badge>
                            </h4>
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

                          {/* Notes */}
                          <div>
                            <h4 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                              Notes History
                              <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-800 border-transparent rounded px-1.5 py-0 text-xs">
                                {po.notes.length}
                              </Badge>
                            </h4>
                            {po.notes.length > 0 ? (
                              <div className="space-y-3">
                                {po.notes.map(note => {
                                  const dateObj = new Date(note.date);
                                  return (
                                    <div key={note.id} className="bg-zinc-900 border border-zinc-800 rounded-md p-3">
                                      <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-xs font-medium text-zinc-400">System Note</span>
                                        <span className="text-[10px] text-zinc-500">
                                          {dateObj.toLocaleDateString()} {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      </div>
                                      <p className="text-sm text-zinc-300 leading-relaxed">{note.text}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-sm text-zinc-500 italic bg-zinc-900/50 border border-zinc-800/50 rounded-md p-4 text-center">
                                No notes recorded for this PO.
                              </div>
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
