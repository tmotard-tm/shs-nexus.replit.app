import './_group.css';
import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Truck, Link2, RefreshCw, Loader2, UserPlus, UserX, FileText, History,
  Boxes, Activity, Users, ChevronDown, ChevronRight, AlertCircle, Check, Info
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
  TFD: "TFD-221",
  TFDName: "Marcus Holloway",
  DSM: "DSM-117",
  DSMName: "Priya Anand",
  TM: "TM-058",
  TMName: "Dana Whitfield",
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
  GradeDescription: "Minor cosmetic wear, fully road-ready",
  GradeVerified: "2026-04-12",
  TruckStatus: "Active",
  TheftVerified: "N",
  VehicleRuns: "Runs normally",
  VehicleLooks: "Clean exterior, light interior wear",
  VehicleInRepair: true,
  DaysInRepair: 6,
  RepairDateStart: "2026-04-19",
  RepairETADate: "2026-05-08",
  RepairReasonName: "Transmission service",
  RepairStatusName: "Awaiting parts",
  Vendor: "Caliber Collision · Tampa",
  EstimateCost: 1840.5,
  RentalCarName: "Enterprise · Mid-size SUV",
  RentalStartDate: "2026-04-19",
  RentalEndDate: "2026-05-09",
  CurLocAddress: "412 N Franklin St",
  CurLocCity: "Tampa",
  CurLocState: "FL",
  CurLocZip: "33602",
  UpdateDate: "2026-04-30",
  Address: "1801 W Kennedy Blvd",
  City: "Tampa",
  State: "FL",
  Zip: "33606",
  DeliveryDate: "2023-03-12",
  KeyAddress: "412 N Franklin St · Lockbox 3",
  KeyZip: "33602",
  LastUpdate: "2026-04-30 14:22",
  LastUpdateUser: "n.alvarez",
};

const getAssignmentStatus = (_v: any) => ({
  label: "Active",
  color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-none",
});
const getVehicleOwnership = (_n: string) => ({ type: "Holman Lease" });

const PrinciplePill = ({ children }: { children: React.ReactNode }) => (
  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider py-0 px-2 h-4 mb-2">
    {children}
  </Badge>
);

export function Variant1() {
  const [descOpen, setDescOpen] = useState(false);
  const [condOpen, setCondOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(true);
  const [locOpen, setLocOpen] = useState(false);
  
  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center">
      <div className="w-[500px] border-x border-border bg-card/30">
        <ScrollArea className="h-screen">
          <div className="p-4 space-y-5">
            {/* Header / Badges */}
            <div>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-base font-semibold">
                  <Truck className="h-4 w-4" />
                  #{selectedVehicle.vehicleNumber}
                </h2>
                <div className="flex items-center gap-1.5">
                  <Badge className={getAssignmentStatus(selectedVehicle).color + " text-[10px] h-5 py-0"}>
                    {getAssignmentStatus(selectedVehicle).label}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] h-5 py-0">{getVehicleOwnership(selectedVehicle.vehicleNumber).type}</Badge>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName} · VIN: {selectedVehicle.vin}
              </p>
            </div>

            <Separator className="my-2" />

            {/* REVIEW Region */}
            <div>
              <PrinciplePill>Review</PrinciplePill>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  <div className="col-span-1">
                    <Label className="text-[10px] text-muted-foreground uppercase">Plate</Label>
                    <p className="font-medium">{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
                    <p className="text-[9px] text-muted-foreground">Snowflake · 4h ago</p>
                  </div>
                  
                  <div className="col-span-1">
                    <Label className="text-[10px] text-muted-foreground uppercase">Color</Label>
                    <p className="font-medium">{selectedVehicle.color}</p>
                    <p className="text-[9px] text-muted-foreground">Holman · 12m ago</p>
                  </div>

                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground uppercase">Odometer</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <div className="flex items-center gap-1.5 cursor-pointer hover:bg-muted p-1 -ml-1 rounded">
                          <p className="font-medium text-amber-600 dark:text-amber-500">58,420 mi</p>
                          <Badge variant="outline" className="text-[9px] h-4 py-0 px-1 border-amber-500/50 text-amber-600 bg-amber-500/10">Mismatched</Badge>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3 text-[11px]">
                        <div className="space-y-3">
                          <div className="font-medium flex items-center gap-2"><AlertCircle className="h-3 w-3 text-amber-500"/> Odometer Disagreement</div>
                          <div className="space-y-2 border-l-2 border-border pl-2">
                            <div className="flex justify-between items-center">
                              <div><span className="font-medium">Holman</span> (Current)</div>
                              <div className="flex items-center gap-2">
                                <span>58,420 mi <span className="text-muted-foreground text-[10px]">· 12m ago</span></span>
                                <Check className="h-3 w-3 text-green-500"/>
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <div><span className="font-medium">AMS</span></div>
                              <div className="flex items-center gap-2">
                                <span>58,200 mi <span className="text-muted-foreground text-[10px]">· 4h ago</span></span>
                                <Button size="sm" variant="secondary" className="h-5 text-[9px] px-2">Set as source</Button>
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <div><span className="font-medium">Samsara</span></div>
                              <div className="flex items-center gap-2">
                                <span>58,431 mi <span className="text-muted-foreground text-[10px]">· live</span></span>
                                <Button size="sm" variant="secondary" className="h-5 text-[9px] px-2">Set as source</Button>
                              </div>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-border flex gap-2">
                            <Input placeholder="Use a different value..." className="h-6 text-[10px]" />
                            <Button size="sm" className="h-6 text-[10px]">Save</Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground uppercase">Location</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <div className="flex items-center gap-1.5 cursor-pointer hover:bg-muted p-1 -ml-1 rounded">
                          <p className="font-medium text-amber-600 dark:text-amber-500 truncate">{selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}</p>
                          <Badge variant="outline" className="text-[9px] h-4 py-0 px-1 border-amber-500/50 text-amber-600 bg-amber-500/10">Mismatched</Badge>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3 text-[11px]">
                         <div className="space-y-3">
                          <div className="font-medium flex items-center gap-2"><AlertCircle className="h-3 w-3 text-amber-500"/> Location Disagreement</div>
                          <div className="space-y-2 border-l-2 border-border pl-2">
                            <div className="flex justify-between items-center">
                              <div><span className="font-medium">AMS</span></div>
                              <div className="flex items-center gap-2">
                                <span>Tampa, FL <span className="text-muted-foreground text-[10px]">· 1d ago</span></span>
                                <Check className="h-3 w-3 text-green-500"/>
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <div><span className="font-medium">Samsara</span></div>
                              <div className="flex items-center gap-2">
                                <span>Orlando, FL <span className="text-muted-foreground text-[10px]">· live</span></span>
                                <Button size="sm" variant="secondary" className="h-5 text-[9px] px-2">Set</Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground uppercase">Region / District</Label>
                    <p className="font-medium">{selectedVehicle.region} / {selectedVehicle.district}</p>
                    <p className="text-[9px] text-muted-foreground">AMS · 1d ago</p>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="my-2" />

            {/* UPDATE Region */}
            <div>
              <PrinciplePill>Update</PrinciplePill>
              <div className="space-y-3">
                <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 p-2 shadow-none">
                  <div className="flex items-center gap-1.5 mb-2 text-[10px] text-blue-700 dark:text-blue-400 font-medium">
                    <Info className="h-3 w-3" /> Pinned because vehicle is In Repair
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase">Repair ETA</Label>
                      <Input defaultValue="2026-05-19" className="h-6 text-[11px] mt-1" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase">Repair Vendor</Label>
                      <Input defaultValue="Caliber Collision" className="h-6 text-[11px] mt-1" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground uppercase">Est. Cost</Label>
                      <Input defaultValue="$2,840.00" className="h-6 text-[11px] mt-1" />
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" className="h-6 text-[10px] px-3">Save Updates</Button>
                  </div>
                </Card>

                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <ChevronDown className="h-3 w-3" /> More fields
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="grid grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <Label className="text-[10px] text-muted-foreground uppercase">Interior</Label>
                        <Input defaultValue="Charcoal Cloth" className="h-6 text-[11px] mt-1" />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground uppercase">Storage Cost</Label>
                        <Input defaultValue="0" className="h-6 text-[11px] mt-1" />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[10px] text-muted-foreground uppercase">Key Address</Label>
                        <Input defaultValue="412 N Franklin St · Lockbox 3" className="h-6 text-[11px] mt-1" />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>

            <Separator className="my-2" />

            {/* ASSIGN Region */}
            <div>
              <PrinciplePill>Assign</PrinciplePill>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="border border-border rounded p-2 bg-card">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Link2 className="h-3 w-3 text-blue-600" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">TPMS</span>
                  </div>
                  <p className="font-mono text-[11px] font-medium">{selectedVehicle.tpmsAssignedTechId}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{selectedVehicle.tpmsAssignedTechName}</p>
                </div>
                <div className="border border-border rounded p-2 bg-card">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Truck className="h-3 w-3 text-green-600" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Holman</span>
                  </div>
                  <p className="font-mono text-[11px] font-medium">{selectedVehicle.holmanTechAssigned}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{selectedVehicle.holmanTechName}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="h-7 text-[11px] flex-1"><UserPlus className="h-3 w-3 mr-1.5"/> Assign New Tech</Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1"><RefreshCw className="h-3 w-3 mr-1.5"/> Resync</Button>
              </div>
            </div>

            <Separator className="my-2" />

            {/* UNASSIGN Region */}
            <div>
              <PrinciplePill>Unassign</PrinciplePill>
              <div className="flex gap-2 items-end mt-1">
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground uppercase mb-1 block">Reason for Unassignment</Label>
                  <Select>
                    <SelectTrigger className="h-7 text-[11px]">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Resignation" className="text-[11px]">Resignation</SelectItem>
                      <SelectItem value="Vehicle Repair" className="text-[11px]">Vehicle Repair</SelectItem>
                      <SelectItem value="Termination" className="text-[11px]">Termination</SelectItem>
                      <SelectItem value="Reassignment" className="text-[11px]">Reassignment</SelectItem>
                      <SelectItem value="Other" className="text-[11px]">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="destructive" className="h-7 text-[11px] px-3 w-24">
                  <UserX className="h-3 w-3 mr-1.5" /> Unassign
                </Button>
              </div>
            </div>

            <Separator className="my-2" />

            {/* Collapsed AMS Information */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-xs text-foreground">AMS Information</h4>
                <p className="text-[10px] text-muted-foreground">Samsara · live</p>
              </div>
              
              <div className="space-y-1.5 border-l-2 border-border/50 pl-2">
                <Collapsible open={descOpen} onOpenChange={setDescOpen}>
                  <CollapsibleTrigger className="flex items-center text-[11px] font-medium py-1 w-full hover:bg-muted/50 rounded px-1 -ml-1 transition-colors">
                    {descOpen ? <ChevronDown className="h-3 w-3 mr-1.5 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mr-1.5 text-muted-foreground" />}
                    Description
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid grid-cols-4 gap-2 pt-1 pb-3 pl-4 text-[10px]">
                     <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Lease End</span>
                        <span className="font-medium">{amsVehicle.LeaseEndDate}</span>
                     </div>
                     <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Book Value</span>
                        <span className="font-medium">${amsVehicle.RemBookValue?.toLocaleString()}</span>
                     </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={condOpen} onOpenChange={setCondOpen}>
                  <CollapsibleTrigger className="flex items-center text-[11px] font-medium py-1 w-full hover:bg-muted/50 rounded px-1 -ml-1 transition-colors">
                    {condOpen ? <ChevronDown className="h-3 w-3 mr-1.5 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mr-1.5 text-muted-foreground" />}
                    Condition
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid grid-cols-4 gap-2 pt-1 pb-3 pl-4 text-[10px]">
                     <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Road Ready</span>
                        <span className="font-medium text-green-600">{amsVehicle.RoadReady === 'Y' ? 'Yes' : 'No'}</span>
                     </div>
                     <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Grade</span>
                        <span className="font-medium">{amsVehicle.Grade}</span>
                     </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={repairOpen} onOpenChange={setRepairOpen}>
                  <CollapsibleTrigger className="flex items-center text-[11px] font-medium py-1 w-full hover:bg-muted/50 rounded px-1 -ml-1 transition-colors">
                    {repairOpen ? <ChevronDown className="h-3 w-3 mr-1.5 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mr-1.5 text-muted-foreground" />}
                    Repair Updates
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-1 pb-3 pl-4 text-[10px] space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Status</span>
                        <Badge variant="outline" className="text-[9px] h-4 py-0 border-amber-500/30 text-amber-600 bg-amber-500/10">
                          {amsVehicle.RepairStatusName}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Reason</span>
                        <span className="font-medium">{amsVehicle.RepairReasonName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Vendor</span>
                        <span className="font-medium truncate block">{amsVehicle.Vendor}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block mb-0.5">Start Date</span>
                        <span className="font-medium">{amsVehicle.RepairDateStart}</span>
                      </div>
                      <div className="col-span-4 mt-1 bg-muted/40 p-1.5 rounded flex justify-between items-center border border-border/50">
                        <div className="flex items-center gap-1.5">
                          <Truck className="h-3 w-3 text-muted-foreground"/>
                          <span className="font-medium">Rental: {amsVehicle.RentalCarName}</span>
                        </div>
                        <span className="text-muted-foreground text-[9px]">{amsVehicle.RentalStartDate} - {amsVehicle.RentalEndDate}</span>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={locOpen} onOpenChange={setLocOpen}>
                  <CollapsibleTrigger className="flex items-center text-[11px] font-medium py-1 w-full hover:bg-muted/50 rounded px-1 -ml-1 transition-colors">
                    {locOpen ? <ChevronDown className="h-3 w-3 mr-1.5 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mr-1.5 text-muted-foreground" />}
                    Location
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-1 pb-3 pl-4 text-[10px]">
                     <div className="grid grid-cols-1 gap-2">
                        <div>
                          <span className="text-muted-foreground block mb-0.5">Current Address</span>
                          <span className="font-medium">{amsVehicle.CurLocAddress}, {amsVehicle.CurLocCity}, {amsVehicle.CurLocState} {amsVehicle.CurLocZip}</span>
                        </div>
                     </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>
            
            <div className="pb-8"></div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
