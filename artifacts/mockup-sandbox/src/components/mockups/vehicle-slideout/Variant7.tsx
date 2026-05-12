import './_group.css';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Truck, Link2, RefreshCw, UserPlus, UserX, AlertTriangle, 
  MapPin, Clock, Pin, CheckCircle2, CircleDashed, ChevronDown, CheckCircle
} from "lucide-react";

const selectedVehicle = {
  vehicleNumber: "61385",
  vin: "1FTBR1Y89PKA48217",
  licensePlate: "JZQ-T84",
  licenseState: "FL",
  modelYear: 2023,
  makeName: "Ford",
  modelName: "Transit Connect",
  region: "Southeast",
  district: "0744",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  odometer: 58420,
  color: "Oxford White",
  tpmsAssignedTechId: "T49281",
  tpmsAssignedTechName: "Carlos Rivera",
  holmanTechAssigned: "ENT-44102",
  holmanTechName: "Carlos Rivera",
};

export function Variant7() {
  const timelineEvents = [
    { date: "2023-03-12", text: "Acquired (Holman Lease)" },
    { date: "2023-03-15", text: "Delivered to Tampa" },
    { date: "2024-01-04", text: "Assigned to Carlos Rivera" },
    { date: "2025-09-12", text: "Odometer 50k milestone" },
    { date: "2026-04-19", text: "Sent to Caliber Collision · Transmission service" },
    { date: "2026-04-24", text: "Repair status: Awaiting parts" }
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center">
      <div className="w-[500px] flex p-4 pb-12">
        {/* Left Timeline Rail */}
        <div className="w-[80px] flex-shrink-0 flex flex-col items-center pt-2 relative">
          {timelineEvents.map((ev, idx) => (
            <div key={idx} className="flex flex-col items-center w-full relative" style={{ height: "120px" }}>
              <div className="text-[10px] text-muted-foreground text-center px-1 mb-1 font-mono">
                {ev.date.substring(0,4)}<br/>{ev.date.substring(5)}
              </div>
              <div className="w-2.5 h-2.5 rounded-full border-2 border-primary bg-background z-10"></div>
              {idx < timelineEvents.length - 1 && (
                <div className="absolute top-10 bottom-[-20px] w-px bg-border -z-10"></div>
              )}
            </div>
          ))}
          {/* NOW pulsing marker */}
          <div className="absolute top-[calc(6*120px-10px)] bottom-12 w-px bg-border -z-10"></div>
          <div className="mt-8 relative flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-primary animate-pulse relative z-10"></div>
            <div className="text-[10px] font-bold text-primary mt-2">NOW</div>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col gap-6 ml-2 mt-4">
          <div className="mb-2">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Truck className="h-5 w-5" />
              #{selectedVehicle.vehicleNumber}
            </h2>
            <p className="text-sm text-muted-foreground">
              {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName} · VIN {selectedVehicle.vin}
            </p>
          </div>

          {/* REVIEW Card */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <CheckCircle className="h-3 w-3" /> Review
            </h3>
            <Card className="p-4 border-l-4 border-l-blue-500">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Location</Label>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{selectedVehicle.city}, {selectedVehicle.state}</p>
                      <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] uppercase font-bold tracking-tight">Mismatch</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      AMS · 1d ago
                    </p>
                  </div>
                  
                  {/* Odometer Mismatch */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <div className="cursor-pointer group hover:bg-slate-50 p-1 -m-1 rounded">
                        <Label className="text-xs text-muted-foreground cursor-pointer">Odometer</Label>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium underline decoration-dashed decoration-amber-300 underline-offset-4">{selectedVehicle.odometer.toLocaleString()} mi</p>
                          <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px] uppercase font-bold tracking-tight">Mismatch</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                          Holman · 12m ago <ChevronDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                        </p>
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <div className="p-3 bg-muted/30 border-b border-border">
                        <h4 className="text-sm font-semibold">Odometer Discrepancy</h4>
                        <p className="text-xs text-muted-foreground">Select source to use as canonical.</p>
                      </div>
                      <div className="p-2 space-y-2">
                        <div className="flex items-center justify-between p-2 rounded bg-blue-50 border border-blue-100">
                          <div>
                            <p className="text-sm font-medium">58,420 mi</p>
                            <p className="text-xs text-muted-foreground">Holman · 12m ago</p>
                          </div>
                          <Button size="sm" variant="secondary" className="h-7 text-xs">Current</Button>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded hover:bg-muted/50 border border-transparent">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">58,200 mi</p>
                            <p className="text-xs text-muted-foreground">AMS · 4h ago</p>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs">Set Source</Button>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded hover:bg-muted/50 border border-transparent">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">58,431 mi</p>
                            <p className="text-xs text-muted-foreground">Samsara · live</p>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs">Set Source</Button>
                        </div>
                        <div className="px-2 pt-2 border-t border-border mt-2">
                          <Label className="text-xs text-muted-foreground mb-1 block">Manual Override</Label>
                          <div className="flex gap-2">
                            <Input placeholder="Enter miles..." className="h-8 text-xs" />
                            <Button size="sm" className="h-8 text-xs">Save</Button>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">License Plate</Label>
                    <p className="text-sm font-medium">{selectedVehicle.licensePlate}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Snowflake · 4h ago</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <p className="text-sm font-medium text-red-600">In Repair</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">AMS · 1d ago</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* UPDATE Card */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <RefreshCw className="h-3 w-3" /> Update
            </h3>
            <Card className="p-0 overflow-hidden border-l-4 border-l-amber-500">
              <div className="bg-amber-50 p-3 border-b border-amber-100 flex items-start gap-2">
                <Pin className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-amber-900">Pinned Fields</h4>
                  <p className="text-xs text-amber-700/80">Because vehicle is <strong>In Repair</strong></p>
                </div>
              </div>
              <div className="p-4 grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Repair Vendor</Label>
                  <Input defaultValue="Caliber Collision · Tampa" className="h-8 text-sm bg-amber-50/30" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Repair ETA</Label>
                  <Input type="date" defaultValue="2026-05-19" className="h-8 text-sm bg-amber-50/30" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-muted-foreground">Estimate Cost</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-2 text-muted-foreground text-sm">$</span>
                    <Input defaultValue="2,840.00" className="h-8 text-sm pl-6 bg-amber-50/30" />
                  </div>
                </div>
              </div>
              <div className="bg-muted/30 p-2 text-center border-t border-border">
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground w-full">
                  Show 12 more fields <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </Card>
          </div>

          {/* ASSIGN Card */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <UserPlus className="h-3 w-3" /> Assign
            </h3>
            <Card className="p-4 border-l-4 border-l-green-500">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Assigned to {selectedVehicle.tpmsAssignedTechName}</span>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" /> Resync
                </Button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 bg-muted/40 p-2 rounded border border-border flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5"><Link2 className="h-3 w-3 text-blue-500"/> TPMS</span>
                  <span className="text-xs font-mono">{selectedVehicle.tpmsAssignedTechId}</span>
                </div>
                <div className="flex-1 bg-muted/40 p-2 rounded border border-border flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5"><Truck className="h-3 w-3 text-green-500"/> Holman</span>
                  <span className="text-xs font-mono">{selectedVehicle.holmanTechAssigned}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* UNASSIGN Card */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <UserX className="h-3 w-3" /> Unassign
            </h3>
            <Card className="p-4 border-l-4 border-l-slate-300">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Reason for Unassignment</Label>
                  <Select>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resignation">Resignation</SelectItem>
                      <SelectItem value="repair">Vehicle Repair</SelectItem>
                      <SelectItem value="termination">Termination</SelectItem>
                      <SelectItem value="reassignment">Reassignment</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="destructive" className="w-full" disabled>
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Process Unassignment
                </Button>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
