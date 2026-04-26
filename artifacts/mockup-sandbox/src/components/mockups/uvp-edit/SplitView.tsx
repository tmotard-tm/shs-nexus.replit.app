import React, { useState } from "react";
import { format } from "date-fns";
import {
  Pencil,
  Save,
  MessageSquare,
  Wrench,
  MapPin,
  DollarSign,
  Info,
  History,
  Truck,
  FileText,
  AlertTriangle,
  UserPlus,
  UserMinus,
  RefreshCw,
  Search,
  CheckCircle2,
  X,
  ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// --- Mock Data ---
const MOCK_VEHICLE = {
  vehicleNumber: "VEH-4471",
  vin: "1FTBR3Y80NKA12345",
  year: "2022",
  make: "Ford",
  model: "Transit-350 High-Roof",
  district: "DAL-NORTH",
  currentLocation: "123 Main St, Dallas, TX 75001",
  keyLocation: "Drop box at 123 Main St",
  lastUpdated: new Date(Date.now() - 3600000 * 2), // 2 hours ago
  color: "White",
  branding: "Full Wrap",
  interior: "Vinyl",
  truckStatus: "In Repair",
  theftVerified: false,
  storageCost: 15.0,
  vehicleRuns: "Yes",
  vehicleLooks: "Fair",
  inRepair: true,
  repairDate: "2024-05-10",
  repairReason: "Transmission slipping in 3rd gear",
  repairVendor: "Hertz Equipment Rental",
  repairETA: "2024-05-20",
  repairStatus: "Awaiting Parts",
  repairEstimate: 3450.0,
  rentalCar: "Enterprise Compact",
  rentalStart: "2024-05-11",
  rentalEnd: "2024-05-21",
  finalDisposition: "In Service",
  dispositionReason: "",
  finalDate: "",
};

const MOCK_COMMENTS = [
  { id: 1, author: "Sarah Jenkins", timestamp: new Date(Date.now() - 86400000 * 2), body: "Vehicle dropped off at Hertz. They suspect it's the transmission." },
  { id: 2, author: "Mike Ross", timestamp: new Date(Date.now() - 86400000), body: "Hertz confirmed transmission needs rebuild. Ordered parts, ETA 5 days." },
  { id: 3, author: "Sarah Jenkins", timestamp: new Date(Date.now() - 3600000 * 4), body: "Approved repair estimate for $3450. Tech assigned a rental car in the meantime." },
];

export function SplitView() {
  const [activeSection, setActiveSection] = useState<"overview" | "vehicle" | "repair" | "disposition" | "comments">("overview");
  const [data, setData] = useState(MOCK_VEHICLE);
  const [newComment, setNewComment] = useState("");

  const handleSave = (section: string) => {
    // In a real app, this would mutate data to the server
    console.log(`Saving ${section}...`, data);
    setActiveSection("overview");
  };

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6 bg-muted/30 min-h-screen">
      <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-3rem)]">
        
        {/* LEFT COLUMN: Read-Only / Context Pane */}
        <div className="w-full md:w-[45%] flex flex-col gap-4">
          <Card className="border shadow-sm flex-shrink-0">
            <CardHeader className="pb-3 border-b bg-muted/30">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl font-bold flex items-center gap-2">
                    {data.vehicleNumber}
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    {data.year} {data.make} {data.model} • VIN: {data.vin}
                  </CardDescription>
                </div>
                <div className="flex flex-col gap-2 items-end">
                   <Popover>
                    <PopoverTrigger asChild>
                      <Badge variant="destructive" className="cursor-pointer hover:opacity-80 text-sm py-1">
                        {data.truckStatus} <ChevronRight className="w-3 h-3 ml-1" />
                      </Badge>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-3">
                      <div className="space-y-3">
                        <h4 className="font-medium text-sm">Update Status</h4>
                        <Select value={data.truckStatus} onValueChange={(v) => setData({...data, truckStatus: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="In Service">In Service</SelectItem>
                            <SelectItem value="Out of Service">Out of Service</SelectItem>
                            <SelectItem value="In Repair">In Repair</SelectItem>
                            <SelectItem value="Stolen">Stolen</SelectItem>
                            <SelectItem value="Sold">Sold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {data.inRepair && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted text-xs border-orange-200 text-orange-700 bg-orange-50">
                          {data.repairStatus} <ChevronRight className="w-3 h-3 ml-1" />
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent className="w-60 p-3">
                        <div className="space-y-3">
                          <h4 className="font-medium text-sm">Repair Status</h4>
                          <Select value={data.repairStatus} onValueChange={(v) => setData({...data, repairStatus: v})}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Awaiting Estimate">Awaiting Estimate</SelectItem>
                              <SelectItem value="Awaiting Parts">Awaiting Parts</SelectItem>
                              <SelectItem value="In Progress">In Progress</SelectItem>
                              <SelectItem value="Completed">Completed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-4 text-xs text-muted-foreground items-center">
                <MapPin className="w-3 h-3" /> {data.district}
                <Separator orientation="vertical" className="h-3" />
                <RefreshCw className="w-3 h-3" /> Last updated {format(data.lastUpdated, "MMM d, h:mm a")}
              </div>
            </CardHeader>

            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-0">
                {/* Clickable Sections */}
                
                {/* Vehicle Info Summary */}
                <div 
                  className={`p-4 border-b cursor-pointer transition-colors hover:bg-muted/50 ${activeSection === 'vehicle' ? 'bg-primary/5 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent'}`}
                  onClick={() => setActiveSection('vehicle')}
                >
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-sm flex items-center text-foreground">
                      <Truck className="w-4 h-4 mr-2" /> Vehicle Information
                    </h3>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Color / Branding</span>
                      <span className="font-medium">{data.color} • {data.branding}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Runs / Looks</span>
                      <span className="font-medium">{data.vehicleRuns} • {data.vehicleLooks}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground text-xs block mb-1">Current Location</span>
                      <span className="font-medium truncate block">{data.currentLocation}</span>
                    </div>
                  </div>
                </div>

                {/* Repair Info Summary */}
                <div 
                  className={`p-4 border-b cursor-pointer transition-colors hover:bg-muted/50 ${activeSection === 'repair' ? 'bg-primary/5 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent'}`}
                  onClick={() => setActiveSection('repair')}
                >
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-sm flex items-center text-foreground">
                      <Wrench className="w-4 h-4 mr-2" /> Repair Information
                    </h3>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </div>
                  {data.inRepair ? (
                    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                      <div className="col-span-2">
                        <span className="text-muted-foreground text-xs block mb-1">Vendor</span>
                        <span className="font-medium">{data.repairVendor}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Reason</span>
                        <span className="font-medium truncate block">{data.repairReason}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">Estimate</span>
                        <span className="font-medium text-destructive">${data.repairEstimate.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block mb-1">ETA</span>
                        <span className="font-medium">{format(new Date(data.repairETA), "MMM d, yyyy")}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">Not currently in repair.</div>
                  )}
                </div>

                {/* Disposition Summary */}
                <div 
                  className={`p-4 border-b cursor-pointer transition-colors hover:bg-muted/50 ${activeSection === 'disposition' ? 'bg-primary/5 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent'}`}
                  onClick={() => setActiveSection('disposition')}
                >
                   <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-sm flex items-center text-foreground">
                      <AlertTriangle className="w-4 h-4 mr-2" /> Disposition
                    </h3>
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </div>
                  <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Status</span>
                      <span className="font-medium">{data.finalDisposition}</span>
                    </div>
                    {data.finalDate && (
                       <div>
                        <span className="text-muted-foreground text-xs block mb-1">Date</span>
                        <span className="font-medium">{data.finalDate}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Comments Preview */}
                <div 
                  className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${activeSection === 'comments' ? 'bg-primary/5 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent'}`}
                  onClick={() => setActiveSection('comments')}
                >
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-sm flex items-center text-foreground">
                      <MessageSquare className="w-4 h-4 mr-2" /> Recent Comments
                    </h3>
                    <span className="text-xs text-muted-foreground">{MOCK_COMMENTS.length} total</span>
                  </div>
                  <div className="space-y-3">
                    {MOCK_COMMENTS.slice(0, 2).map((c) => (
                      <div key={c.id} className="text-sm">
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="font-medium text-xs">{c.author}</span>
                          <span className="text-[10px] text-muted-foreground">{format(c.timestamp, "MMM d")}</span>
                        </div>
                        <p className="text-muted-foreground text-xs line-clamp-2">{c.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </ScrollArea>
          </Card>

          {/* Persistent Comment Composer at bottom of left rail */}
          <Card className="flex-shrink-0 shadow-sm border-t-4 border-t-primary/20">
            <CardContent className="p-3">
              <div className="flex gap-2">
                <Textarea 
                  placeholder="Drop a quick comment..." 
                  className="min-h-[60px] text-sm resize-none"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                <Button size="icon" className="h-[60px] w-12 flex-shrink-0" disabled={!newComment.trim()}>
                  <MessageSquare className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* RIGHT COLUMN: Contextual Editor Pane */}
        <div className="w-full md:w-[55%] flex flex-col">
          <Card className="flex-1 shadow-md border-0 ring-1 ring-border/50 overflow-hidden flex flex-col">
            
            {/* OVERVIEW (Default State) */}
            {activeSection === "overview" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-muted/30/50">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                  <Pencil className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-semibold mb-2">Select a section to edit</h2>
                <p className="text-muted-foreground max-w-sm mb-8">
                  Click on any card in the left panel to open its editor here. Your changes will be highlighted before saving.
                </p>

                <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                   <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={() => setActiveSection('vehicle')}>
                     <Truck className="w-4 h-4 mr-3 text-muted-foreground" />
                     <div className="text-left">
                       <div className="font-medium text-sm">Vehicle Info</div>
                       <div className="text-xs text-muted-foreground font-normal">Location, Cost, Look</div>
                     </div>
                   </Button>
                   <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={() => setActiveSection('repair')}>
                     <Wrench className="w-4 h-4 mr-3 text-muted-foreground" />
                     <div className="text-left">
                       <div className="font-medium text-sm">Repair Info</div>
                       <div className="text-xs text-muted-foreground font-normal">Estimates, Vendor, ETA</div>
                     </div>
                   </Button>
                   <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={() => setActiveSection('disposition')}>
                     <AlertTriangle className="w-4 h-4 mr-3 text-muted-foreground" />
                     <div className="text-left">
                       <div className="font-medium text-sm">Disposition</div>
                       <div className="text-xs text-muted-foreground font-normal">Final status, Dates</div>
                     </div>
                   </Button>
                   <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={() => setActiveSection('comments')}>
                     <History className="w-4 h-4 mr-3 text-muted-foreground" />
                     <div className="text-left">
                       <div className="font-medium text-sm">Full History</div>
                       <div className="text-xs text-muted-foreground font-normal">Comments & Logs</div>
                     </div>
                   </Button>
                </div>

                <div className="mt-12 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" size="sm"><UserPlus className="w-3 h-3 mr-2"/> Assign Tech</Button>
                  <Button variant="secondary" size="sm"><UserMinus className="w-3 h-3 mr-2"/> Unassign Tech</Button>
                  <Button variant="secondary" size="sm"><FileText className="w-3 h-3 mr-2"/> PO History</Button>
                </div>
              </div>
            )}

            {/* VEHICLE INFO EDITOR */}
            {activeSection === "vehicle" && (
              <>
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center text-lg">
                        <Truck className="w-5 h-5 mr-2 text-primary" /> Edit Vehicle Info
                      </CardTitle>
                      <CardDescription>Update location, condition, and physical attributes.</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setActiveSection('overview')}><X className="w-4 h-4" /></Button>
                  </div>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-6 space-y-8">
                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-2">Physical Attributes</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Color</Label>
                          <Select defaultValue={data.color}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="White">White</SelectItem>
                              <SelectItem value="Black">Black</SelectItem>
                              <SelectItem value="Silver">Silver</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Branding</Label>
                          <Select defaultValue={data.branding}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Full Wrap">Full Wrap</SelectItem>
                              <SelectItem value="Partial Wrap">Partial Wrap</SelectItem>
                              <SelectItem value="Decals">Decals</SelectItem>
                              <SelectItem value="None">None</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Interior</Label>
                          <Select defaultValue={data.interior}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Vinyl">Vinyl</SelectItem>
                              <SelectItem value="Cloth">Cloth</SelectItem>
                              <SelectItem value="Leather">Leather</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Theft Verified</Label>
                          <Select defaultValue={data.theftVerified ? "Yes" : "No"}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="No">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-2">Condition & Cost</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Vehicle Runs</Label>
                          <Select defaultValue={data.vehicleRuns}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="No">No</SelectItem>
                              <SelectItem value="Unknown">Unknown</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Vehicle Looks</Label>
                          <Select defaultValue={data.vehicleLooks}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Good">Good</SelectItem>
                              <SelectItem value="Fair">Fair</SelectItem>
                              <SelectItem value="Poor">Poor</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Storage Cost (Daily)</Label>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="number" defaultValue={data.storageCost} className="pl-9" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-2">Location Information</h4>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Current Location (Address + Zip)</Label>
                          <Input defaultValue={data.currentLocation} />
                        </div>
                        <div className="space-y-2">
                          <Label>Key Location (Address + Zip)</Label>
                          <Input defaultValue={data.keyLocation} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </ScrollArea>
                <CardFooter className="border-t p-4 bg-muted/30 flex justify-between">
                  <Button variant="ghost" onClick={() => setActiveSection('overview')}>Cancel</Button>
                  <Button onClick={() => handleSave('vehicle')} className="gap-2"><Save className="w-4 h-4"/> Save Changes</Button>
                </CardFooter>
              </>
            )}

            {/* REPAIR INFO EDITOR */}
            {activeSection === "repair" && (
              <>
                <CardHeader className="bg-muted/30 border-b border-border pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center text-lg text-orange-800">
                        <Wrench className="w-5 h-5 mr-2" /> Edit Repair Info
                      </CardTitle>
                      <CardDescription>Manage repair details, vendor, and rental assignments.</CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center space-x-2 bg-white px-3 py-1.5 rounded-md border shadow-sm">
                        <Switch id="in-repair" checked={data.inRepair} onCheckedChange={(v) => setData(d => ({ ...d, inRepair: v }))} />
                        <Label htmlFor="in-repair" className="font-semibold cursor-pointer">In Repair</Label>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setActiveSection('overview')}><X className="w-4 h-4" /></Button>
                    </div>
                  </div>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-6 space-y-8">
                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-2">Repair Details</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                          <Label>Repair Reason</Label>
                          <Textarea defaultValue={data.repairReason} rows={2} />
                        </div>
                        <div className="space-y-2">
                          <Label>Vendor</Label>
                          <Input defaultValue={data.repairVendor} />
                        </div>
                        <div className="space-y-2">
                          <Label>Repair Status</Label>
                          <Select defaultValue={data.repairStatus}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Awaiting Estimate">Awaiting Estimate</SelectItem>
                              <SelectItem value="Awaiting Parts">Awaiting Parts</SelectItem>
                              <SelectItem value="In Progress">In Progress</SelectItem>
                              <SelectItem value="Completed">Completed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Repair Estimate</Label>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="number" defaultValue={data.repairEstimate} className="pl-9 text-orange-700 font-medium" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-2">
                            <Label>Start Date</Label>
                            <Input type="date" defaultValue={data.repairDate} />
                          </div>
                          <div className="space-y-2">
                            <Label>ETA</Label>
                            <Input type="date" defaultValue={data.repairETA} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-foreground border-b pb-2">Rental Car Information</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                          <Label>Rental Vehicle</Label>
                          <Input defaultValue={data.rentalCar} placeholder="e.g. Enterprise Compact SUV" />
                        </div>
                        <div className="space-y-2">
                          <Label>Rental Start</Label>
                          <Input type="date" defaultValue={data.rentalStart} />
                        </div>
                        <div className="space-y-2">
                          <Label>Rental End</Label>
                          <Input type="date" defaultValue={data.rentalEnd} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </ScrollArea>
                <CardFooter className="border-t p-4 bg-muted/30 flex justify-between">
                  <Button variant="ghost" onClick={() => setActiveSection('overview')}>Cancel</Button>
                  <Button onClick={() => handleSave('repair')} className="gap-2 bg-orange-600 hover:bg-orange-700"><Save className="w-4 h-4"/> Save Repair Info</Button>
                </CardFooter>
              </>
            )}

            {/* DISPOSITION EDITOR */}
            {activeSection === "disposition" && (
              <>
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center text-lg">
                        <AlertTriangle className="w-5 h-5 mr-2 text-primary" /> Edit Disposition
                      </CardTitle>
                      <CardDescription>Final status and resolution for this vehicle.</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setActiveSection('overview')}><X className="w-4 h-4" /></Button>
                  </div>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-6 space-y-6">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Final Disposition</Label>
                          <Select defaultValue={data.finalDisposition}>
                            <SelectTrigger className="border-primary/50 ring-1 ring-primary/20"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="In Service">In Service</SelectItem>
                              <SelectItem value="Returned">Returned</SelectItem>
                              <SelectItem value="Sold">Sold</SelectItem>
                              <SelectItem value="Totaled">Totaled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Final Date</Label>
                          <Input type="date" defaultValue={data.finalDate} />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label>Disposition Reason / Notes</Label>
                          <Textarea defaultValue={data.dispositionReason} rows={4} placeholder="Provide details on why this vehicle is changing disposition..." />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </ScrollArea>
                <CardFooter className="border-t p-4 bg-muted/30 flex justify-between">
                  <Button variant="ghost" onClick={() => setActiveSection('overview')}>Cancel</Button>
                  <Button onClick={() => handleSave('disposition')} className="gap-2"><Save className="w-4 h-4"/> Save Disposition</Button>
                </CardFooter>
              </>
            )}

            {/* FULL COMMENTS HISTORY */}
            {activeSection === "comments" && (
              <>
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center text-lg">
                        <History className="w-5 h-5 mr-2 text-primary" /> Comment History
                      </CardTitle>
                      <CardDescription>Full timeline of notes and status changes.</CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setActiveSection('overview')}><X className="w-4 h-4" /></Button>
                  </div>
                </CardHeader>
                <ScrollArea className="flex-1 bg-muted/30/30">
                  <CardContent className="p-6">
                    <div className="space-y-6">
                      {MOCK_COMMENTS.map((c, i) => (
                        <div key={c.id} className="relative pl-6 border-l-2 border-border pb-2">
                          <div className="absolute w-3 h-3 bg-primary rounded-full -left-[7px] top-1 border-2 border-white" />
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">{c.author}</span>
                            <span className="text-xs text-muted-foreground">{format(c.timestamp, "MMM d, yyyy 'at' h:mm a")}</span>
                          </div>
                          <div className="bg-white p-3 rounded-md border shadow-sm text-sm">
                            {c.body}
                          </div>
                        </div>
                      ))}
                      <div className="relative pl-6 border-l-2 border-border pb-2">
                          <div className="absolute w-3 h-3 bg-slate-300 rounded-full -left-[7px] top-1 border-2 border-white" />
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-muted-foreground">System</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(Date.now() - 86400000 * 5), "MMM d, yyyy")}</span>
                          </div>
                          <div className="text-sm text-muted-foreground italic">
                            Vehicle status changed to In Repair
                          </div>
                        </div>
                    </div>
                  </CardContent>
                </ScrollArea>
              </>
            )}

          </Card>
        </div>

      </div>
    </div>
  );
}
