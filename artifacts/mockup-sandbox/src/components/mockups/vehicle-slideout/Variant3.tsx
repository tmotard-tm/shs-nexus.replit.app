import './_group.css';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Truck, Link2, RefreshCw, Loader2, UserPlus, UserX, 
  MapPin, AlertTriangle, AlertCircle, Wrench, ChevronDown, ChevronUp, Check, Info, CheckCircle2
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

const amsVehicle: any = {
  Tech: "T49281",
  TechName: "Carlos Rivera",
  ColorName: "Oxford White",
  BrandingName: "Sears Home Services",
  InteriorName: "Charcoal Cloth",
  CurOdometer: 58420,
  CurOdometerDate: "2026-04-30T00:00:00",
  RemBookValue: 17840,
  LeaseEndDate: "2027-03-15",
  RegRenewalDate: "2026-09-30",
  LifeTimeMaintenanceCost: 6420,
  StorageCost: 0,
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
  EstimateCost: 2840,
  RentalCarName: "Enterprise",
};

export function Variant3() {
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-8">
      <div className="w-[500px] border shadow-sm rounded-lg bg-card overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 bg-background border-b">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Truck className="h-6 w-6 text-primary" />
                #{selectedVehicle.vehicleNumber}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none font-medium">
                Active
              </Badge>
              <Badge variant="outline" className="font-normal text-xs text-muted-foreground">Holman Lease</Badge>
            </div>
          </div>
        </div>

        {/* 1. REVIEW */}
        <div className="border-l-4 border-blue-500 bg-background p-6">
          <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-4">1. Review</h3>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <Label className="text-xs text-muted-foreground block mb-1">VIN</Label>
                <div className="font-mono text-sm">{selectedVehicle.vin}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Snowflake · 4h ago</div>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground block mb-1">Location</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{selectedVehicle.city}, {selectedVehicle.state}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">AMS · 1d ago</div>
              </div>

              {/* Mismatch: Odometer */}
              <div className="col-span-2 p-3 bg-orange-50/50 rounded-md border border-orange-100 relative">
                <div className="absolute top-3 right-3">
                  <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200 text-[10px] px-1.5 py-0">
                    Mismatched
                  </Badge>
                </div>
                <Label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1">
                  Odometer <AlertCircle className="h-3 w-3 text-orange-500" />
                </Label>
                <div className="font-medium text-sm mb-3">{selectedVehicle.odometer.toLocaleString()} mi <span className="text-muted-foreground font-normal ml-1">(Holman)</span></div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs bg-white p-1.5 rounded border">
                    <span className="font-medium w-16">Holman</span>
                    <span className="text-muted-foreground">58,420 mi · 12m ago</span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 bg-blue-50 text-blue-700">Set as source</Button>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-white p-1.5 rounded border">
                    <span className="font-medium w-16">AMS</span>
                    <span className="text-muted-foreground">58,200 mi · 4h ago</span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">Set as source</Button>
                  </div>
                  <div className="flex items-center justify-between text-xs bg-white p-1.5 rounded border">
                    <span className="font-medium w-16">Samsara</span>
                    <span className="text-muted-foreground">58,431 mi · live</span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">Set as source</Button>
                  </div>
                  <div className="flex items-center mt-2 pt-2 border-t border-orange-200/50">
                    <Input className="h-7 text-xs flex-1" placeholder="Use a different value..." />
                    <Button size="sm" className="h-7 ml-2 text-xs">Save</Button>
                  </div>
                </div>
              </div>

              {/* Mismatch: License Plate */}
              <div className="col-span-2 p-3 bg-orange-50/50 rounded-md border border-orange-100 flex items-start justify-between">
                <div>
                  <Label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1">
                    License Plate <AlertCircle className="h-3 w-3 text-orange-500" />
                  </Label>
                  <div className="font-medium text-sm">{selectedVehicle.licensePlate} <span className="text-muted-foreground font-normal">({selectedVehicle.licenseState})</span></div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Holman agrees, AMS missing state</div>
                </div>
                <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200 text-[10px] px-1.5 py-0 mt-1">
                  Mismatched
                </Badge>
              </div>

            </div>
          </div>
        </div>

        <Separator />

        {/* 2. UPDATE */}
        <div className="border-l-4 border-amber-500 bg-background p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider">2. Update</h3>
            <div className="flex items-center text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-medium">
              <Wrench className="h-3 w-3 mr-1" />
              Pinned because vehicle is In Repair
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Repair ETA</Label>
                <Input defaultValue="2026-05-19" type="date" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Estimate Cost</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-muted-foreground text-sm">$</span>
                  <Input defaultValue="2,840" className="h-8 text-sm pl-6" />
                </div>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Repair Vendor</Label>
                <Input defaultValue="Caliber Collision · Tampa" className="h-8 text-sm" />
              </div>
            </div>

            <Collapsible open={showMoreFields} onOpenChange={setShowMoreFields}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground">
                  {showMoreFields ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showMoreFields ? "Hide extra fields" : "More fields"}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Color</Label>
                  <Select defaultValue="oxford-white">
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="oxford-white">Oxford White</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Storage Cost</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1.5 text-muted-foreground text-sm">$</span>
                    <Input defaultValue="0" className="h-8 text-sm pl-6" />
                  </div>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">Truck Status</Label>
                  <Select defaultValue="active">
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="active">Active</SelectItem></SelectContent>
                  </Select>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <Separator />

        {/* 3. ASSIGN */}
        <div className="border-l-4 border-emerald-500 bg-background p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">3. Assign</h3>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2 gap-1.5">
              <RefreshCw className="h-3 w-3" /> Resync
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="border rounded-md p-3 bg-card shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <Link2 className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">TPMS</span>
              </div>
              <div className="font-mono text-sm font-medium">{selectedVehicle.tpmsAssignedTechId}</div>
              <div className="text-xs text-muted-foreground truncate">{selectedVehicle.tpmsAssignedTechName}</div>
            </div>
            
            <div className="border rounded-md p-3 bg-card shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <Truck className="h-3.5 w-3.5 text-blue-600" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Holman</span>
              </div>
              <div className="font-mono text-sm font-medium">{selectedVehicle.holmanTechAssigned}</div>
              <div className="text-xs text-muted-foreground truncate">{selectedVehicle.holmanTechName}</div>
            </div>
          </div>
          
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" size="sm">
            <UserPlus className="h-4 w-4 mr-2" /> Assign New Tech
          </Button>
        </div>

        <Separator />

        {/* 4. UNASSIGN */}
        <div className="border-l-4 border-red-500 bg-background p-6">
          <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-4">4. Unassign</h3>
          
          <div className="space-y-3 bg-red-50/50 p-4 rounded-md border border-red-100">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-red-900">Reason for Unassignment</Label>
              <Select value={unassignReason} onValueChange={setUnassignReason}>
                <SelectTrigger className="h-9 bg-white border-red-200 focus:ring-red-500">
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resignation">Resignation</SelectItem>
                  <SelectItem value="vehicle-repair">Vehicle Repair</SelectItem>
                  <SelectItem value="termination">Termination</SelectItem>
                  <SelectItem value="reassignment">Reassignment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              variant="destructive" 
              className="w-full shadow-sm" 
              disabled={!unassignReason}
            >
              <UserX className="h-4 w-4 mr-2" /> 
              Unassign Current Tech
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
