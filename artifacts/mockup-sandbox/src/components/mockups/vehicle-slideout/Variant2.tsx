import './_group.css';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Truck, Link2, RefreshCw, Loader2, UserPlus, UserX, FileText, History,
  Boxes, Activity, Users, Pencil, Eye, AlertTriangle, ChevronDown, Check, Pin
} from "lucide-react";
import { useState } from "react";

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

const amsVehicle: any = {
  Tech: "T49281",
  TechName: "Carlos Rivera",
  CurOdometer: 58420,
  RemBookValue: 17840,
  LeaseEndDate: "2027-03-15",
  RegRenewalDate: "2026-09-30",
  LifeTimeMaintenanceCost: 6420,
  RoadReady: "Y",
  Grade: "B+",
  TruckStatus: "Active",
  VehicleInRepair: true,
  DaysInRepair: 6,
  RepairDateStart: "2026-04-19",
  RepairETADate: "2026-05-19",
  RepairReasonName: "Transmission service",
  RepairStatusName: "Awaiting parts",
  Vendor: "Caliber Collision · Tampa",
  EstimateCost: 2840.0,
  RentalCarName: "Enterprise · Mid-size SUV",
  CurLocAddress: "412 N Franklin St",
  CurLocCity: "Tampa",
  CurLocState: "FL",
  CurLocZip: "33602",
};

export function Variant2() {
  const [unassignReason, setUnassignReason] = useState("");

  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center">
      <div className="w-[500px] p-8 border-r border-l border-border bg-card">
        {/* Header */}
        <div className="mb-8">
          <h2 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
            <Truck className="h-6 w-6 text-primary" />
            Vehicle #{selectedVehicle.vehicleNumber}
          </h2>
          <p className="text-base text-muted-foreground mt-1">
            {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
          </p>
          <div className="flex items-center gap-3 mt-4">
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-none text-sm py-1">
              In Repair
            </Badge>
            <Badge variant="outline" className="text-sm py-1">Holman Lease</Badge>
          </div>
        </div>

        {/* REVIEW REGION */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-primary">
            <Eye className="h-5 w-5" />
            <h3 className="text-sm font-bold uppercase tracking-widest">Review</h3>
          </div>

          <Card className="p-5 space-y-5 shadow-sm border-border">
            <h4 className="font-semibold text-base">Vehicle Information</h4>
            
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">VIN</Label>
                <p className="font-mono text-sm mt-1">{selectedVehicle.vin}</p>
                <p className="text-[10px] text-muted-foreground mt-1">Holman · 12m ago</p>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">License Plate</Label>
                <p className="text-sm mt-1">{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
                <p className="text-[10px] text-muted-foreground mt-1">AMS · 1d ago</p>
              </div>

              {/* Mismatched Odometer */}
              <div className="col-span-2 p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-md border border-amber-100 dark:border-amber-900">
                <div className="flex justify-between items-start">
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      Odometer
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400 text-[10px] h-4 font-semibold px-1.5">MISMATCH</Badge>
                    </Label>
                    <p className="text-sm font-medium mt-1">58,420 mi</p>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs border-dashed border-amber-200">
                        View Sources <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="end">
                      <div className="p-3 border-b bg-muted/30">
                        <p className="text-xs font-semibold">Odometer Discrepancy</p>
                      </div>
                      <div className="p-2 space-y-1">
                        <div className="flex items-center justify-between p-2 hover:bg-muted rounded-sm">
                          <div>
                            <p className="text-sm font-medium flex items-center gap-2">58,420 mi <Check className="h-3 w-3 text-green-500"/></p>
                            <p className="text-[10px] text-muted-foreground">Holman · 12m ago</p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">Canonical</Badge>
                        </div>
                        <div className="flex items-center justify-between p-2 hover:bg-muted rounded-sm">
                          <div>
                            <p className="text-sm">58,200 mi</p>
                            <p className="text-[10px] text-muted-foreground">AMS · 4h ago</p>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]">Set Source</Button>
                        </div>
                        <div className="flex items-center justify-between p-2 hover:bg-muted rounded-sm">
                          <div>
                            <p className="text-sm">58,431 mi</p>
                            <p className="text-[10px] text-muted-foreground">Samsara · live</p>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]">Set Source</Button>
                        </div>
                      </div>
                      <div className="p-2 border-t">
                        <div className="flex gap-2">
                          <Input placeholder="Custom value..." className="h-7 text-xs" />
                          <Button size="sm" className="h-7 text-xs">Save</Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Mismatched Location */}
              <div className="col-span-2 p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-md border border-amber-100 dark:border-amber-900">
                <div className="flex justify-between items-start">
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      Location
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-400 text-[10px] h-4 font-semibold px-1.5">MISMATCH</Badge>
                    </Label>
                    <p className="text-sm font-medium mt-1">{amsVehicle.CurLocAddress}, {amsVehicle.CurLocCity}, {amsVehicle.CurLocState} {amsVehicle.CurLocZip}</p>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs border-dashed border-amber-200">
                        View Sources <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="end">
                      <div className="p-3 border-b bg-muted/30">
                        <p className="text-xs font-semibold">Location Discrepancy</p>
                      </div>
                      <div className="p-2 space-y-1">
                        <div className="flex items-center justify-between p-2 hover:bg-muted rounded-sm">
                          <div>
                            <p className="text-sm font-medium">412 N Franklin St, Tampa FL <Check className="h-3 w-3 inline text-green-500"/></p>
                            <p className="text-[10px] text-muted-foreground">AMS · 1d ago</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-2 hover:bg-muted rounded-sm">
                          <div>
                            <p className="text-sm">Caliber Collision, 891 Tampa Blvd</p>
                            <p className="text-[10px] text-muted-foreground">Samsara GPS · live</p>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]">Set Source</Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Separator className="my-8" />

        {/* UPDATE REGION */}
        <div className="space-y-6">
          <div className="flex items-center justify-between text-primary">
            <div className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              <h3 className="text-sm font-bold uppercase tracking-widest">Update</h3>
            </div>
            <p className="text-xs text-muted-foreground">Vehicle is <strong className="text-amber-600 dark:text-amber-500">In Repair</strong></p>
          </div>

          <Card className="p-5 border-border shadow-sm border-t-2 border-t-amber-500 bg-gradient-to-b from-amber-50/30 to-transparent dark:from-amber-900/10">
            <div className="flex items-start gap-2 mb-4">
              <Pin className="h-4 w-4 text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-sm">Prioritized Fields</h4>
                <p className="text-xs text-muted-foreground">Pinned because vehicle is awaiting parts</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Repair ETA</Label>
                  <Input defaultValue={amsVehicle.RepairETADate} className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Estimate Cost</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1.5 text-muted-foreground text-sm">$</span>
                    <Input defaultValue={amsVehicle.EstimateCost} className="h-8 text-sm pl-6" />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Repair Vendor</Label>
                <Input defaultValue={amsVehicle.Vendor} className="h-8 text-sm" />
              </div>
            </div>

            <Separator className="my-4" />
            
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
                Show 14 hidden fields <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </Card>
        </div>

        <Separator className="my-8" />

        {/* ASSIGN REGION */}
        <div className="space-y-6">
          <div className="flex items-center justify-between text-primary">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              <h3 className="text-sm font-bold uppercase tracking-widest">Assign</h3>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Resync
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 border-border">
              <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                <Link2 className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">TPMS</span>
              </div>
              <p className="font-mono text-sm font-medium">{selectedVehicle.tpmsAssignedTechId}</p>
              <p className="text-sm mt-1">{selectedVehicle.tpmsAssignedTechName}</p>
              <p className="text-[10px] text-muted-foreground mt-2">Snowflake · 4h ago</p>
            </Card>
            
            <Card className="p-4 border-border">
              <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                <Truck className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Holman</span>
              </div>
              <p className="font-mono text-sm font-medium">{selectedVehicle.holmanTechAssigned}</p>
              <p className="text-sm mt-1">{selectedVehicle.holmanTechName}</p>
              <p className="text-[10px] text-muted-foreground mt-2">Holman API · 12m ago</p>
            </Card>
          </div>
          
          <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-sm">
            Assign to New Tech
          </Button>
        </div>

        <Separator className="my-8" />

        {/* UNASSIGN REGION */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-destructive">
            <UserX className="h-5 w-5" />
            <h3 className="text-sm font-bold uppercase tracking-widest">Unassign</h3>
          </div>

          <Card className="p-5 border-destructive/20 bg-destructive/5 shadow-sm">
            <p className="text-sm text-muted-foreground mb-4">
              Remove current technician assignment across all systems.
            </p>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Reason for Unassignment</Label>
                <Select value={unassignReason} onValueChange={setUnassignReason}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select a reason..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Resignation">Resignation</SelectItem>
                    <SelectItem value="Vehicle Repair">Vehicle Repair</SelectItem>
                    <SelectItem value="Termination">Termination</SelectItem>
                    <SelectItem value="Reassignment">Reassignment</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button 
                variant="destructive" 
                className="w-full font-medium shadow-sm"
                disabled={!unassignReason}
              >
                Confirm Unassignment
              </Button>
            </div>
          </Card>
        </div>
        
      </div>
    </div>
  );
}
