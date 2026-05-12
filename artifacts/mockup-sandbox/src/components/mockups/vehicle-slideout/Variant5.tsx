import './_group.css';
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MapPin, AlertTriangle, Truck, CheckCircle2, Clock, Wrench, Calendar, Map,
  Building, MapPinned, Pin, Edit, PenLine, UserPlus, UserX, User, ChevronRight, Navigation, LocateFixed
} from "lucide-react";

const selectedVehicle = {
  vehicleNumber: "61385",
  vin: "1FTBR1Y89PKA48217",
  licensePlate: "JZQ-T84",
  licenseState: "FL",
  modelYear: 2023,
  makeName: "Ford",
  modelName: "Transit Connect",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  color: "Oxford White",
};

export function Variant5() {
  return (
    <div className="min-h-screen bg-slate-50 text-foreground w-[500px] mx-auto overflow-hidden shadow-2xl flex flex-col relative">
      
      {/* Map Header */}
      <div className="relative h-[280px] w-full bg-slate-200 overflow-hidden shrink-0">
        {/* Faux map pattern */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none" 
          style={{ 
            backgroundImage: `linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)`,
            backgroundSize: '40px 40px' 
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-100/40 to-sky-100/40 mix-blend-multiply" />
        
        {/* Center Map Pin */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-blue-500/20 rounded-full animate-pulse" />
            <MapPin className="h-10 w-10 text-blue-600 drop-shadow-md relative z-10" fill="white" />
          </div>
          <Badge variant="secondary" className="mt-2 shadow-sm font-mono tracking-tight bg-white/90 backdrop-blur-sm">
            Tampa, FL 33602
          </Badge>
        </div>

        {/* Overlaid Vehicle Badge */}
        <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
          <div className="bg-white/95 backdrop-blur-md p-3 rounded-lg shadow-lg border border-slate-200/50 max-w-[65%]">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 leading-tight">
              <Truck className="h-5 w-5 text-slate-700" />
              #{selectedVehicle.vehicleNumber}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
            </p>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline" className="text-[10px] bg-white text-slate-600 border-slate-200">Holman Lease</Badge>
              <Badge variant="outline" className="text-[10px] bg-white text-slate-600 font-mono border-slate-200">{selectedVehicle.licensePlate}</Badge>
            </div>
          </div>
          
          {/* Repair Callout */}
          <div className="bg-amber-500/90 backdrop-blur-md text-white px-3 py-2 rounded-lg shadow-lg border border-amber-600/50 flex flex-col items-end text-right">
            <div className="flex items-center gap-1.5 font-bold text-sm">
              <Wrench className="h-4 w-4" />
              In Repair
            </div>
            <p className="text-[10px] font-medium mt-0.5 opacity-90">Caliber Collision</p>
            <p className="text-[10px] font-medium opacity-90">2.1 mi away</p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        
        {/* 1. REVIEW REGION */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="h-6 w-6 rounded bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">1</div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Review Data</h3>
          </div>
          
          <Card className="shadow-sm border-slate-200">
            <CardContent className="p-0 divide-y divide-slate-100">
              
              {/* Odometer Mismatch Demo */}
              <div className="p-4 bg-amber-50/30">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Odometer</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xl font-bold font-mono">58,420 mi</span>
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-[10px] uppercase font-bold py-0 h-5">Mismatched</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-medium text-slate-500 flex items-center justify-end gap-1"><Clock className="h-3 w-3"/> Holman · 12m ago</span>
                  </div>
                </div>
                
                {/* Breakdown Panel */}
                <div className="bg-white rounded-md border border-amber-200 p-3 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-700">Holman</div>
                      <div className="text-[10px] text-slate-500">12m ago</div>
                    </div>
                    <div className="font-mono text-sm font-medium">58,420 mi</div>
                    <Button size="sm" variant="secondary" className="h-6 text-[10px] bg-slate-100" disabled>Current</Button>
                  </div>
                  <Separator className="bg-amber-100" />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-700">AMS</div>
                      <div className="text-[10px] text-slate-500">4h ago</div>
                    </div>
                    <div className="font-mono text-sm text-slate-600">58,200 mi</div>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]">Set Source</Button>
                  </div>
                  <Separator className="bg-amber-100" />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-700">Samsara</div>
                      <div className="text-[10px] text-slate-500">2m ago</div>
                    </div>
                    <div className="font-mono text-sm text-slate-600">58,431 mi</div>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]">Set Source</Button>
                  </div>
                  <div className="pt-1 flex justify-end">
                    <Button variant="link" className="h-auto p-0 text-[10px] text-amber-700 font-medium">Use a different value...</Button>
                  </div>
                </div>
              </div>

              {/* Location Row (Freshness) */}
              <div className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <MapPinned className="h-3.5 w-3.5 text-blue-500" /> Location
                    </Label>
                    <div className="mt-1 font-medium text-slate-800">412 N Franklin St, Tampa, FL 33602</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <Badge variant="outline" className="text-[10px] font-normal border-green-200 bg-green-50 text-green-700">Samsara GPS · 2m ago</Badge>
                  <Badge variant="outline" className="text-[10px] font-normal border-slate-200 text-slate-500">AMS · 1d ago</Badge>
                </div>
              </div>

            </CardContent>
          </Card>
        </section>

        {/* 2. UPDATE REGION */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="h-6 w-6 rounded bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">2</div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Update Details</h3>
          </div>
          
          <Card className="shadow-sm border-amber-200 overflow-hidden">
            <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                <Pin className="h-3 w-3 fill-amber-700" /> Pinned because vehicle is In Repair
              </span>
              <Badge variant="secondary" className="bg-amber-200/50 text-amber-800 hover:bg-amber-200/50 text-[10px]">Awaiting parts</Badge>
            </div>
            
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600 flex items-center gap-1">
                    <Building className="h-3.5 w-3.5" /> Repair Vendor
                  </Label>
                  <Input defaultValue="Caliber Collision · Tampa" className="h-8 text-sm bg-white" />
                  <span className="text-[9px] text-slate-400">Snowflake · 4h ago</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" /> Repair ETA
                  </Label>
                  <Input defaultValue="2026-05-19" type="date" className="h-8 text-sm bg-white" />
                  <span className="text-[9px] text-slate-400">Holman · 12m ago</span>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs text-slate-600">Estimate Cost</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1.5 text-sm text-slate-500">$</span>
                    <Input defaultValue="2,840.00" className="h-8 pl-6 text-sm bg-white" />
                  </div>
                </div>
              </div>
              
              <Separator />
              <Button variant="ghost" className="w-full h-8 text-xs text-slate-500" size="sm">
                Show more fields <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* 3. ASSIGN REGION */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="h-6 w-6 rounded bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">3</div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Assign Technician</h3>
          </div>

          <Card className="shadow-sm border-slate-200">
            <CardContent className="p-0 divide-y divide-slate-100">
              
              {/* Assigned Tech Mismatch Demo */}
              <div className="p-4 bg-amber-50/30">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned Tech</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-base font-bold text-slate-800">Carlos Rivera</span>
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-[10px] uppercase font-bold py-0 h-5">Mismatched IDs</Badge>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-md border border-amber-200 p-3 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-700">Holman ID</div>
                    </div>
                    <div className="font-mono text-sm font-medium">ENT-44102</div>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]">Set Source</Button>
                  </div>
                  <Separator className="bg-amber-100" />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-700">AMS / TPMS ID</div>
                    </div>
                    <div className="font-mono text-sm text-slate-600">T49281</div>
                    <Button size="sm" variant="secondary" className="h-6 text-[10px] bg-slate-100" disabled>Current</Button>
                  </div>
                </div>
              </div>

              <div className="p-4 flex items-end justify-between bg-slate-50/50">
                <div className="space-y-1.5 flex-1 mr-4">
                  <Label className="text-xs text-slate-600">Assign New Technician</Label>
                  <Select>
                    <SelectTrigger className="h-9 text-sm bg-white">
                      <SelectValue placeholder="Search technicians..." />
                    </SelectTrigger>
                  </Select>
                </div>
                <Button className="h-9 shrink-0">
                  <UserPlus className="h-4 w-4 mr-2" /> Assign
                </Button>
              </div>

            </CardContent>
          </Card>
        </section>

        {/* 4. UNASSIGN REGION */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="h-6 w-6 rounded bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">4</div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Unassign</h3>
          </div>

          <Card className="shadow-sm border-slate-200 bg-white">
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Reason for Unassignment</Label>
                <Select>
                  <SelectTrigger className="h-9 text-sm bg-white">
                    <SelectValue placeholder="Select a reason..." />
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
              <div className="bg-slate-50 p-3 rounded-md border border-slate-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Unassigning will log a history event. Ensure a backstop vehicle (currently <strong>Enterprise Rental</strong>) is properly tracked if the technician remains active.
                  </p>
                </div>
              </div>
              <Button variant="destructive" className="w-full h-9">
                <UserX className="h-4 w-4 mr-2" />
                Unassign Technician
              </Button>
            </CardContent>
          </Card>
        </section>
        
        {/* Footer pad */}
        <div className="h-8" />
      </div>
    </div>
  );
}
