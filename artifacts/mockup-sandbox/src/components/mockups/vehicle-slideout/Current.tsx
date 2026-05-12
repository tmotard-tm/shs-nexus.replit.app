import './_group.css';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Truck, Link2, RefreshCw, Loader2, UserPlus, UserX, FileText, History,
  Boxes, Activity, Users, Pencil, Wrench,
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

const amsLoading = false;
const truckStatusLookup: any[] = [];
const vehicleRunsLookup: any[] = [];
const vehicleLooksLookup: any[] = [];
const repairReasonLookup: any[] = [];
const repairStatusLookup: any[] = [];
const rentalCarLookup: any[] = [];
const dispositionLookup: any[] = [];
const dispositionReasonLookup: any[] = [];
const vehiclePOs: any[] = [];

const lookupCostCenter = (_district: string) => "4423";
const getAssignmentStatus = (_v: any) => ({
  label: "Active",
  color:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-none",
});
const getVehicleOwnership = (_n: string) => ({ type: "Holman Lease" });
const getAmsLookupLabel = (item: any) =>
  item?.Description ?? String(item?.UniqueID ?? "");

const noop = () => {};
const resyncAssignmentsMutation = { isPending: false, mutate: noop };
const setShowHistoryDialog = noop;
const openModal = (_m: string) => {};
const setOpsReviewVehicle = (_v: any) => {};
const setOpsRefZip = (_z: string) => {};
const setShowOpsReview = (_b: boolean) => {};
const targetZipcode = "";
const setAmsEditColor = (_v: string) => {};
const setAmsEditBranding = (_v: string) => {};
const setAmsEditInterior = (_v: string) => {};
const setAmsEditAddress = (_v: string) => {};
const setAmsEditAddressZip = (_v: string) => {};
const setAmsEditTruckStatus = (_v: string) => {};
const setAmsEditTheftVerified = (_v: string) => {};
const setAmsEditKeyAddress = (_v: string) => {};
const setAmsEditKeyZip = (_v: string) => {};
const setAmsEditStorageCost = (_v: string) => {};
const setAmsEditVehicleRuns = (_v: string) => {};
const setAmsEditVehicleLooks = (_v: string) => {};
const setAmsRepairInRepair = (_v: boolean) => {};
const setAmsRepairDate = (_v: string) => {};
const setAmsRepairReason = (_v: string) => {};
const setAmsRepairVendor = (_v: string) => {};
const setAmsRepairETA = (_v: string) => {};
const setAmsRepairStatus = (_v: string) => {};
const setAmsRepairEstimate = (_v: string) => {};
const setAmsRepairRentalCar = (_v: string) => {};
const setAmsRepairRentalStart = (_v: string) => {};
const setAmsRepairRentalEnd = (_v: string) => {};
const setAmsRepairFinalDisposition = (_v: string) => {};
const setAmsRepairDispositionReason = (_v: string) => {};
const setAmsRepairFinalDate = (_v: string) => {};

const colorLookup: any[] = [];
const brandingLookup: any[] = [];
const interiorLookup: any[] = [];

export function Current() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="w-[500px] p-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Truck className="h-5 w-5" />
            Vehicle #{selectedVehicle.vehicleNumber}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selectedVehicle.modelYear} {selectedVehicle.makeName} {selectedVehicle.modelName}
          </p>
        </div>

        <div className="mt-6 space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <Badge className={getAssignmentStatus(selectedVehicle).color}>
              {getAssignmentStatus(selectedVehicle).label}
            </Badge>
            <Badge variant="outline">{getVehicleOwnership(selectedVehicle.vehicleNumber).type}</Badge>
          </div>

          <Separator />

          {/* Vehicle Details */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-muted-foreground">Vehicle Information</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">VIN</Label>
                <p className="font-mono text-xs">{selectedVehicle.vin}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">License Plate</Label>
                <p>{selectedVehicle.licensePlate} ({selectedVehicle.licenseState})</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Location</Label>
                <p>{selectedVehicle.city}, {selectedVehicle.state} {selectedVehicle.zip}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Region / District</Label>
                <p>
                  {selectedVehicle.region} / {selectedVehicle.district}
                  {lookupCostCenter(selectedVehicle.district) && (
                    <span className="text-muted-foreground"> · CC {lookupCostCenter(selectedVehicle.district)}</span>
                  )}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Odometer</Label>
                <p>{selectedVehicle.odometer?.toLocaleString() || 'N/A'} miles</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Color</Label>
                <p>{selectedVehicle.color || 'N/A'}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Assignment Info */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm text-muted-foreground">Assignment Details</h4>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={resyncAssignmentsMutation.isPending}
                onClick={() => resyncAssignmentsMutation.mutate()}
              >
                {resyncAssignmentsMutation.isPending
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                {resyncAssignmentsMutation.isPending ? "Resyncing…" : "Resync"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="h-4 w-4 text-blue-600" />
                  <Label className="text-xs font-medium">TPMS</Label>
                </div>
                {selectedVehicle.tpmsAssignedTechId ? (
                  <>
                    <p className="font-mono text-sm">{selectedVehicle.tpmsAssignedTechId}</p>
                    {selectedVehicle.tpmsAssignedTechName && (
                      <p className="text-xs text-muted-foreground mt-1">{selectedVehicle.tpmsAssignedTechName}</p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Unassigned</p>
                )}
              </Card>
              <Card className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="h-4 w-4 text-green-600" />
                  <Label className="text-xs font-medium">Holman</Label>
                </div>
                {selectedVehicle.holmanTechAssigned ? (
                  <>
                    <p className="font-mono text-sm">{selectedVehicle.holmanTechAssigned}</p>
                    {selectedVehicle.holmanTechName && (
                      <p className="text-xs text-muted-foreground mt-1">{selectedVehicle.holmanTechName}</p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Unassigned</p>
                )}
              </Card>
            </div>
          </div>

          <Separator />

          {/* Operations */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground">Operations</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="w-full" onClick={() => openModal("assign")}>
                <UserPlus className="h-4 w-4 mr-1.5" />Assign Tech
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => openModal("unassign")}
                disabled={!selectedVehicle.tpmsAssignedTechId?.trim() && !selectedVehicle.holmanTechAssigned?.trim()}
              >
                <UserX className="h-4 w-4 mr-1.5" />Unassign Tech
              </Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => openModal("poHistory")}>
                <FileText className="h-4 w-4 mr-1.5" />
                PO History
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setShowHistoryDialog()}
                disabled={!selectedVehicle.tpmsAssignedTechId}
              >
                <History className="h-4 w-4 mr-1.5" />History
              </Button>
            </div>
            <Button variant="outline" size="sm" className="w-full">
              <Boxes className="h-4 w-4 mr-1.5" />View Inventory
            </Button>
            <Button variant="outline" size="sm" className="w-full">
              <Activity className="h-4 w-4 mr-1.5" />Telematics
            </Button>
            {!selectedVehicle.tpmsAssignedTechId?.trim() && !selectedVehicle.holmanTechAssigned?.trim() && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-300 dark:border-purple-700 dark:hover:bg-purple-950"
                onClick={() => {
                  setOpsReviewVehicle(selectedVehicle);
                  setOpsRefZip(selectedVehicle.zip || targetZipcode);
                  setShowOpsReview(true);
                }}
              >
                <Users className="h-4 w-4 mr-1.5" />Ops Review
              </Button>
            )}
          </div>

          <Separator />

          {/* AMS Information */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground">AMS Information</h4>
            {amsLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading AMS data...</div>
            ) : !amsVehicle ? (
              <p className="text-xs text-muted-foreground">AMS data not available for this vehicle.</p>
            ) : (
              <div className="space-y-4">

                {/* Ownership / Management Hierarchy */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Ownership</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {amsVehicle.Tech && (
                      <div>
                        <Label className="text-xs text-muted-foreground">AMS Tech</Label>
                        <p className="font-mono text-xs">{amsVehicle.Tech}</p>
                        {amsVehicle.TechName && <p className="text-xs text-muted-foreground">{amsVehicle.TechName}</p>}
                      </div>
                    )}
                    {(amsVehicle.TFD || amsVehicle.TFDName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">TFD</Label>
                        <p className="text-xs font-mono">{amsVehicle.TFD || "—"}</p>
                        {amsVehicle.TFDName && <p className="text-xs text-muted-foreground">{amsVehicle.TFDName}</p>}
                      </div>
                    )}
                    {(amsVehicle.DSM || amsVehicle.DSMName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">DSM</Label>
                        <p className="text-xs font-mono">{amsVehicle.DSM || "—"}</p>
                        {amsVehicle.DSMName && <p className="text-xs text-muted-foreground">{amsVehicle.DSMName}</p>}
                      </div>
                    )}
                    {(amsVehicle.TM || amsVehicle.TMName) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">TM</Label>
                        <p className="text-xs font-mono">{amsVehicle.TM || "—"}</p>
                        {amsVehicle.TMName && <p className="text-xs text-muted-foreground">{amsVehicle.TMName}</p>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Description</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {amsVehicle.ColorName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Color</Label>
                        <p>{amsVehicle.ColorName}</p>
                      </div>
                    )}
                    {amsVehicle.BrandingName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Branding</Label>
                        <p>{amsVehicle.BrandingName}</p>
                      </div>
                    )}
                    {amsVehicle.InteriorName && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Interior</Label>
                        <p>{amsVehicle.InteriorName}</p>
                      </div>
                    )}
                    {amsVehicle.CurOdometer != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">AMS Odometer</Label>
                        <p>{amsVehicle.CurOdometer.toLocaleString()} mi</p>
                        {amsVehicle.CurOdometerDate && <p className="text-xs text-muted-foreground">{amsVehicle.CurOdometerDate.slice(0, 10)}</p>}
                      </div>
                    )}
                    {amsVehicle.RemBookValue != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Book Value</Label>
                        <p>${Number(amsVehicle.RemBookValue).toLocaleString()}</p>
                      </div>
                    )}
                    {amsVehicle.LeaseEndDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Lease End</Label>
                        <p>{amsVehicle.LeaseEndDate}</p>
                      </div>
                    )}
                    {amsVehicle.OutofSvcDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Out of Service</Label>
                        <p>{amsVehicle.OutofSvcDate}</p>
                      </div>
                    )}
                    {amsVehicle.SaleDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Sale Date</Label>
                        <p>{amsVehicle.SaleDate}</p>
                      </div>
                    )}
                    {amsVehicle.RegRenewalDate && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Reg Renewal</Label>
                        <p>{amsVehicle.RegRenewalDate}</p>
                      </div>
                    )}
                    {amsVehicle.LifeTimeMaintenanceCost != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Lifetime Maint.</Label>
                        <p>${Number(amsVehicle.LifeTimeMaintenanceCost).toLocaleString()}</p>
                      </div>
                    )}
                    {amsVehicle.StorageCost != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Storage Cost</Label>
                        <p>${Number(amsVehicle.StorageCost).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Condition */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Condition</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">Road Ready</Label>
                      <div className="mt-0.5">
                        {amsVehicle.RoadReady === "Y" || amsVehicle.RoadReady === "Yes" ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-none text-xs">Ready</Badge>
                        ) : amsVehicle.RoadReady ? (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-none text-xs">{amsVehicle.RoadReady}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Grade</Label>
                      <p>{amsVehicle.Grade || "N/A"}</p>
                      {amsVehicle.GradeDescription && <p className="text-xs text-muted-foreground">{amsVehicle.GradeDescription}</p>}
                      {amsVehicle.GradeVerified && <p className="text-xs text-muted-foreground">Verified: {amsVehicle.GradeVerified}</p>}
                    </div>
                    {amsVehicle.TruckStatus != null && (() => {
                      const match = Array.isArray(truckStatusLookup) ? truckStatusLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.TruckStatus)) : undefined;
                      return (
                        <div>
                          <Label className="text-xs text-muted-foreground">Truck Status</Label>
                          <p>{match ? getAmsLookupLabel(match) : String(amsVehicle.TruckStatus)}</p>
                        </div>
                      );
                    })()}
                    {amsVehicle.TheftVerified != null && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Theft Verified</Label>
                        <p>{amsVehicle.TheftVerified === "Y" || amsVehicle.TheftVerified === true ? "Yes" : "No"}</p>
                      </div>
                    )}
                    {amsVehicle.VehicleRuns != null && (() => {
                      const match = Array.isArray(vehicleRunsLookup) ? vehicleRunsLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleRuns)) : undefined;
                      return (
                        <div className="col-span-2">
                          <Label className="text-xs text-muted-foreground">How Vehicle Runs</Label>
                          <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleRuns)}</p>
                        </div>
                      );
                    })()}
                    {amsVehicle.VehicleLooks != null && (() => {
                      const match = Array.isArray(vehicleLooksLookup) ? vehicleLooksLookup.find((item: any) => String(item.UniqueID) === String(amsVehicle.VehicleLooks)) : undefined;
                      return (
                        <div className="col-span-2">
                          <Label className="text-xs text-muted-foreground">How Vehicle Looks</Label>
                          <p className="text-xs">{match ? getAmsLookupLabel(match) : String(amsVehicle.VehicleLooks)}</p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Repair Updates */}
                {(() => {
                  const irRaw = amsVehicle.VehicleInRepair ?? amsVehicle.InRepair;
                  const isInRepair = irRaw === true || irRaw === 1 || (typeof irRaw === "string" && ["y","yes","true","1","t"].includes(irRaw.trim().toLowerCase()));
                  const labelFor = (lookup: any[] | undefined, raw: any, nameField?: any): string | null => {
                    if (nameField) return String(nameField);
                    if (raw == null || raw === "") return null;
                    const match = Array.isArray(lookup) ? lookup.find((item: any) => String(item.UniqueID) === String(raw)) : undefined;
                    return match ? getAmsLookupLabel(match) : String(raw);
                  };
                  const fmtDate = (d: any): string | null => {
                    if (!d) return null;
                    const s = String(d);
                    return s.length > 10 ? s.slice(0, 10) : s;
                  };
                  const repairReason = labelFor(repairReasonLookup, amsVehicle.RepairReason, amsVehicle.RepairReasonName);
                  const repairStatus = labelFor(repairStatusLookup, amsVehicle.RepairStatus, amsVehicle.RepairStatusName);
                  const rentalCar = labelFor(rentalCarLookup, amsVehicle.RentalCar, amsVehicle.RentalCarName);
                  const finalDispo = labelFor(dispositionLookup, amsVehicle.FinalDisposition, amsVehicle.FinalDispositionName);
                  const finalDispoReason = labelFor(dispositionReasonLookup, amsVehicle.FinalDispositionReason, amsVehicle.FinalDispositionReasonName);
                  const repairDateStart = fmtDate(amsVehicle.RepairDateStart ?? amsVehicle.RepairStartDate);
                  const etaDate = fmtDate(amsVehicle.RepairETADate ?? amsVehicle.EtaDate ?? amsVehicle.RepairEtaDate ?? amsVehicle.RepairETA);
                  const rentalStart = fmtDate(amsVehicle.RentalStartDate);
                  const rentalEnd = fmtDate(amsVehicle.RentalEndDate);
                  const finalDate = fmtDate(amsVehicle.FinalDispositionDate);
                  const vendor = amsVehicle.Vendor ?? amsVehicle.RepairVendor;
                  const estCost = amsVehicle.EstimateCost ?? amsVehicle.RepairEstimateCost;
                  const hasAnyRepairData =
                    irRaw != null || amsVehicle.DaysInRepair != null ||
                    repairReason || repairStatus || rentalCar || finalDispo || finalDispoReason ||
                    repairDateStart || etaDate || rentalStart || rentalEnd || finalDate ||
                    vendor || estCost != null;
                  if (!hasAnyRepairData) return null;
                  return (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                        <Wrench className="h-3 w-3" /> Repair Updates
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        {irRaw != null && (
                          <div>
                            <Label className="text-xs text-muted-foreground">In Repair</Label>
                            <div className="mt-0.5">
                              {isInRepair ? (
                                <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-none text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">No</Badge>
                              )}
                            </div>
                          </div>
                        )}
                        {amsVehicle.DaysInRepair != null && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Days In Repair</Label>
                            <p>{amsVehicle.DaysInRepair}</p>
                          </div>
                        )}
                        {repairDateStart && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Repair Date</Label>
                            <p>{repairDateStart}</p>
                          </div>
                        )}
                        {etaDate && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Repair ETA</Label>
                            <p>{etaDate}</p>
                          </div>
                        )}
                        {repairReason && (
                          <div className="col-span-2">
                            <Label className="text-xs text-muted-foreground">Svc. Reason</Label>
                            <p className="text-xs">{repairReason}</p>
                          </div>
                        )}
                        {repairStatus && (
                          <div className="col-span-2">
                            <Label className="text-xs text-muted-foreground">Repair Status</Label>
                            <p className="text-xs">{repairStatus}</p>
                          </div>
                        )}
                        {vendor && (
                          <div className="col-span-2">
                            <Label className="text-xs text-muted-foreground">Repair Vendor</Label>
                            <p className="text-xs">{vendor}</p>
                          </div>
                        )}
                        {estCost != null && estCost !== "" && !isNaN(Number(estCost)) && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Estimate Cost</Label>
                            <p>${Number(estCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          </div>
                        )}
                        {rentalCar && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Rental Car</Label>
                            <p>{rentalCar}</p>
                          </div>
                        )}
                        {rentalStart && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Rental Start</Label>
                            <p>{rentalStart}</p>
                          </div>
                        )}
                        {rentalEnd && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Rental End</Label>
                            <p>{rentalEnd}</p>
                          </div>
                        )}
                        {(finalDispo || finalDispoReason || finalDate) && (
                          <div className="col-span-2 border-t mt-1 pt-2 space-y-2">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Final Disposition</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                              {finalDispo && (
                                <div className="col-span-2">
                                  <Label className="text-xs text-muted-foreground">Disposition</Label>
                                  <p className="text-xs">{finalDispo}</p>
                                </div>
                              )}
                              {finalDispoReason && (
                                <div className="col-span-2">
                                  <Label className="text-xs text-muted-foreground">Disposition Reason</Label>
                                  <p className="text-xs">{finalDispoReason}</p>
                                </div>
                              )}
                              {finalDate && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">Final Date</Label>
                                  <p>{finalDate}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Location */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Location</p>
                  <div className="space-y-1.5 text-sm">
                    {(amsVehicle.CurLocAddress || amsVehicle.CurLocCity) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Current Location</Label>
                        <p className="text-xs">
                          {[amsVehicle.CurLocAddress, amsVehicle.CurLocCity, amsVehicle.CurLocState].filter(Boolean).join(", ")}
                          {amsVehicle.CurLocZip ? ` ${amsVehicle.CurLocZip}` : ""}
                        </p>
                        {amsVehicle.UpdateDate && <p className="text-xs text-muted-foreground">Updated: {amsVehicle.UpdateDate}</p>}
                      </div>
                    )}
                    {(amsVehicle.DeliveryDate || amsVehicle.Address) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Delivery Location</Label>
                        <p className="text-xs">
                          {[amsVehicle.Address, amsVehicle.City, amsVehicle.State].filter(Boolean).join(", ")}
                          {amsVehicle.Zip ? ` ${amsVehicle.Zip}` : ""}
                        </p>
                        {amsVehicle.DeliveryDate && <p className="text-xs text-muted-foreground">Delivered: {amsVehicle.DeliveryDate}</p>}
                      </div>
                    )}
                    {((amsVehicle.KeyAddress || amsVehicle.keyAddress) || (amsVehicle.KeyZip || amsVehicle.keyZip)) && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Key Location</Label>
                        <p className="text-xs">
                          {[(amsVehicle.KeyAddress || amsVehicle.keyAddress)].filter(Boolean).join(", ")}
                          {(amsVehicle.KeyZip || amsVehicle.keyZip) ? ` ${amsVehicle.KeyZip || amsVehicle.keyZip}` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {(amsVehicle.LastUpdate || amsVehicle.LastUpdateUser) && (
                  <p className="text-xs text-muted-foreground">
                    AMS last updated: {amsVehicle.LastUpdate || "N/A"}{amsVehicle.LastUpdateUser ? ` by ${amsVehicle.LastUpdateUser}` : ""}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                    const matchLookup = (lookup: any[] | undefined, raw: any): string => {
                      if (raw == null || !lookup?.length) return "";
                      const s = String(raw);
                      const byId = lookup.find(item => String(item.UniqueID) === s);
                      if (byId) return s;
                      const byLabel = lookup.find(item => getAmsLookupLabel(item).toLowerCase() === s.toLowerCase());
                      return byLabel ? String(byLabel.UniqueID) : "";
                    };
                    setAmsEditColor(matchLookup(colorLookup, amsVehicle?.Color));
                    setAmsEditBranding(matchLookup(brandingLookup, amsVehicle?.Branding));
                    setAmsEditInterior(matchLookup(interiorLookup, amsVehicle?.Interior));
                    setAmsEditAddress(amsVehicle?.CurLocAddress || "");
                    setAmsEditAddressZip(amsVehicle?.CurLocZip || "");
                    setAmsEditTruckStatus(matchLookup(truckStatusLookup, amsVehicle?.TruckStatus));
                    const tv = amsVehicle?.TheftVerified;
                    setAmsEditTheftVerified(tv === true || tv === "Y" ? "Y" : tv === false || tv === "N" ? "N" : "");
                    setAmsEditKeyAddress(amsVehicle?.KeyLocAddress || amsVehicle?.KeyAddress || amsVehicle?.keyAddress || "");
                    setAmsEditKeyZip(amsVehicle?.KeyLocZip || amsVehicle?.KeyZip || amsVehicle?.keyZip || "");
                    setAmsEditStorageCost(amsVehicle?.StorageCost != null ? String(amsVehicle.StorageCost) : "");
                    setAmsEditVehicleRuns(matchLookup(vehicleRunsLookup, amsVehicle?.VehicleRuns));
                    setAmsEditVehicleLooks(matchLookup(vehicleLooksLookup, amsVehicle?.VehicleLooks));
                    openModal("amsEdit");
                  }}>
                    <Pencil className="h-4 w-4 mr-1.5" />Edit Fields
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                    const v: any = amsVehicle || {};
                    const findField = (obj: any, ...names: string[]): any => {
                      for (const n of names) if (obj?.[n] != null) return obj[n];
                      const lcKeys = Object.keys(obj || {});
                      for (const n of names) {
                        const found = lcKeys.find(k => k.toLowerCase() === n.toLowerCase());
                        if (found && obj[found] != null) return obj[found];
                      }
                      return undefined;
                    };
                    const isTruthy = (val: any): boolean => {
                      if (val === true || val === 1) return true;
                      if (typeof val === "string") {
                        const s = val.trim().toLowerCase();
                        return s === "y" || s === "yes" || s === "true" || s === "1" || s === "t";
                      }
                      return false;
                    };
                    const ir = findField(v, "VehicleInRepair", "InRepair", "inRepair", "IsInRepair");
                    setAmsRepairInRepair(isTruthy(ir));
                    const fromAmsDate = (d: any): string => {
                      if (!d) return "";
                      const s = String(d);
                      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
                      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
                      const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                      if (us) return `${us[3]}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
                      return "";
                    };
                    const matchLookup = (lookup: any[] | undefined, raw: any): string => {
                      if (raw == null || raw === "" || !lookup?.length) return "";
                      const s = String(raw);
                      const byId = lookup.find((item: any) => String(item.UniqueID) === s);
                      if (byId) return s;
                      const byLabel = lookup.find((item: any) => getAmsLookupLabel(item).toLowerCase() === s.toLowerCase());
                      return byLabel ? String(byLabel.UniqueID) : "";
                    };
                    setAmsRepairDate(fromAmsDate(v.RepairDateStart ?? v.RepairStartDate));
                    setAmsRepairReason(matchLookup(repairReasonLookup, v.RepairReason ?? v.RepairReasonName));
                    setAmsRepairVendor(v.Vendor ?? v.RepairVendor ?? "");
                    setAmsRepairETA(fromAmsDate(v.RepairETADate ?? v.EtaDate ?? v.RepairEtaDate ?? v.RepairETA));
                    setAmsRepairStatus(matchLookup(repairStatusLookup, v.RepairStatus ?? v.RepairStatusName));
                    setAmsRepairEstimate(v.EstimateCost != null ? String(v.EstimateCost) : (v.RepairEstimateCost != null ? String(v.RepairEstimateCost) : ""));
                    setAmsRepairRentalCar(matchLookup(rentalCarLookup, v.RentalCar ?? v.RentalCarName));
                    setAmsRepairRentalStart(fromAmsDate(v.RentalStartDate));
                    setAmsRepairRentalEnd(fromAmsDate(v.RentalEndDate));
                    setAmsRepairFinalDisposition(matchLookup(dispositionLookup, v.FinalDisposition ?? v.FinalDispositionName));
                    setAmsRepairDispositionReason(matchLookup(dispositionReasonLookup, v.FinalDispositionReason ?? v.FinalDispositionReasonName));
                    setAmsRepairFinalDate(fromAmsDate(v.FinalDispositionDate));
                    openModal("amsRepair");
                  }}>
                    <Wrench className="h-4 w-4 mr-1.5" />Repair
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
