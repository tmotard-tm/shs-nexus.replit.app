import './_group.css';
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Truck, AlertCircle, Clock, MapPin, Wrench, UserPlus, UserX, User, Building, Car, Navigation, DollarSign, ChevronDown, RefreshCw, CheckCircle2, Search, Info
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

export function Variant6() {
  const [isUpdateExpanded, setIsUpdateExpanded] = useState(false);
  const [unassignReason, setUnassignReason] = useState("");

  return (
    <div className="min-h-screen bg-slate-50/50 text-foreground w-[540px] flex flex-col font-sans">
      {/* Header */}
      <div className="bg-white border-b px-5 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Holman Lease</Badge>
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
              <Wrench className="w-3 h-3 mr-1" />
              In Repair
            </Badge>
          </div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Truck className="h-5 w-5 text-slate-500" />
            Vehicle #{selectedVehicle.vehicleNumber}
          </h2>
          <p className="text-sm text-slate-500">
            {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName} · {selectedVehicle.vin}
          </p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN: REVIEW */}
        <div className="w-1/2 border-r bg-white p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold tracking-tight uppercase text-slate-500">Review</h3>
          </div>

          <div className="space-y-6">
            
            {/* Identity & Specs */}
            <section className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-500">License Plate</Label>
                  <span className="text-[10px] text-slate-400">Snowflake · 4h ago</span>
                </div>
                <p className="text-sm font-medium">{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-500">Odometer</Label>
                  <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0 h-4">Mismatched</Badge>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-sm font-medium text-orange-700 border-b border-dashed border-orange-300 hover:border-orange-500 text-left">
                      58,420 mi (Holman)
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <div className="px-3 py-2 border-b bg-slate-50">
                      <p className="text-xs font-semibold text-slate-500 uppercase">Odometer Discrepancy</p>
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="flex items-center justify-between p-2 rounded bg-orange-50 border border-orange-100">
                        <div>
                          <p className="text-sm font-medium">58,420 mi</p>
                          <p className="text-[10px] text-slate-500">Holman · 12m ago</p>
                        </div>
                        <Button size="sm" variant="secondary" className="h-6 text-xs bg-white">Set as source</Button>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                        <div>
                          <p className="text-sm font-medium">58,200 mi</p>
                          <p className="text-[10px] text-slate-500">AMS · 4h ago</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-6 text-xs">Set</Button>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                        <div>
                          <p className="text-sm font-medium">58,431 mi</p>
                          <p className="text-[10px] text-slate-500">Samsara · live</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-6 text-xs">Set</Button>
                      </div>
                    </div>
                    <div className="p-2 border-t">
                      <div className="flex items-center gap-2">
                        <Input placeholder="Enter custom value..." className="h-7 text-xs" />
                        <Button size="sm" className="h-7 text-xs">Save</Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

            </section>

            <Separator />

            {/* AMS Ownership & Location */}
            <section className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-500">Location</Label>
                  <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0 h-4">Mismatched</Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm">Tampa, FL 33602</p>
                    <span className="text-[10px] text-slate-400">AMS · 1d ago</span>
                  </div>
                  <div className="flex items-center justify-between text-orange-700">
                    <p className="text-sm">Tampa, FL 33606</p>
                    <span className="text-[10px] opacity-70">Holman · 2h ago</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-500">Color / Body</Label>
                  <span className="text-[10px] text-slate-400">AMS · 1d ago</span>
                </div>
                <p className="text-sm">{selectedVehicle.color}</p>
              </div>
            </section>
            
          </div>
        </div>

        {/* RIGHT COLUMN: ACTION */}
        <div className="w-1/2 p-4 bg-slate-50 overflow-y-auto space-y-4">
          
          {/* UPDATE */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold uppercase text-slate-500 flex items-center justify-between">
                Update
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="w-4 h-4 text-slate-400" />
                    </TooltipTrigger>
                    <TooltipContent>Contextual update actions based on status</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="bg-blue-50/50 rounded-md p-3 border border-blue-100 space-y-3 relative">
                <div className="absolute -top-2.5 right-2 bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded font-medium border border-blue-200">
                  Pinned: In Repair
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Repair Vendor</Label>
                  <Input defaultValue="Caliber Collision · Tampa" className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">ETA</Label>
                    <Input type="date" defaultValue="2026-05-19" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Estimate</Label>
                    <Input defaultValue="$2,840" className="h-8 text-sm" />
                  </div>
                </div>
                <div className="space-y-1 pt-1">
                  <Label className="text-xs">Rental Backstop</Label>
                  <div className="text-sm bg-white border rounded px-3 py-1.5 text-slate-600 flex items-center justify-between">
                    Enterprise
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  </div>
                </div>
                <Button size="sm" className="w-full h-8">Save Repair Updates</Button>
              </div>

              <Collapsible open={isUpdateExpanded} onOpenChange={setIsUpdateExpanded}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-slate-500">
                    {isUpdateExpanded ? "Hide" : "More fields"} <ChevronDown className={`ml-1 w-3 h-3 transition-transform ${isUpdateExpanded ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Truck Status</Label>
                    <Select defaultValue="active">
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="spare">Spare</SelectItem>
                        <SelectItem value="decomm">Decommissioned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* ASSIGN */}
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold uppercase text-slate-500">Assign</CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-600">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-white border rounded p-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-500">TP</div>
                    <div>
                      <p className="text-xs font-medium leading-none">TPMS</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{selectedVehicle.tpmsAssignedTechName}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono">{selectedVehicle.tpmsAssignedTechId}</Badge>
                </div>

                <div className="flex items-center justify-between bg-white border rounded p-2 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-blue-50 flex items-center justify-center text-xs font-medium text-blue-600">HL</div>
                    <div>
                      <p className="text-xs font-medium leading-none">Holman</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{selectedVehicle.holmanTechName}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono">{selectedVehicle.holmanTechAssigned}</Badge>
                </div>
              </div>
              <Button size="sm" variant="outline" className="w-full h-8 bg-white"><UserPlus className="w-3.5 h-3.5 mr-2"/>Assign New Tech</Button>
            </CardContent>
          </Card>

          {/* UNASSIGN */}
          <Card className="shadow-sm border-slate-200 border-t-red-200 border-t-2">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold uppercase text-slate-500">Unassign</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Reason for Unassignment</Label>
                <Select value={unassignReason} onValueChange={setUnassignReason}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select a reason..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resignation">Resignation</SelectItem>
                    <SelectItem value="repair">Vehicle Repair</SelectItem>
                    <SelectItem value="termination">Termination</SelectItem>
                    <SelectItem value="reassignment">Reassignment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="destructive" className="w-full h-8" disabled={!unassignReason}>
                <UserX className="w-3.5 h-3.5 mr-2" />
                Unassign Tech
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

// Inline missing components for self-containment
function TooltipProvider({ children }: any) { return <>{children}</>; }
function Tooltip({ children }: any) { return <>{children}</>; }
function TooltipTrigger({ children }: any) { return <span className="inline-flex cursor-help">{children}</span>; }
function TooltipContent({ children }: any) { return <span className="hidden group-hover:block absolute bg-slate-800 text-white text-xs p-1 rounded z-50">{children}</span>; }
