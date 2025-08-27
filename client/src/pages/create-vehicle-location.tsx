import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";
import { Car } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { type InsertVehicle } from "@shared/schema";

export default function CreateVehicle() {
  const { toast } = useToast();
  const [vehicleForm, setVehicleForm] = useState<Partial<InsertVehicle & { vehicleType: string }>>({
    vin: "",
    vehicleNumber: "",
    modelYear: new Date().getFullYear(),
    makeName: "",
    modelName: "",
    vehicleType: "",
    color: "",
    licensePlate: "",
    licenseState: "",
    branding: "",
    interior: "",
    tuneStatus: "",
    region: "",
    district: "",
    acquisitionAddress: "",
    city: "",
    state: "",
    zip: "",
    status: "available"
  });

  const handleVehicleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Vehicle Created",
      description: `${vehicleForm.modelYear} ${vehicleForm.makeName} ${vehicleForm.modelName} has been added to the system`,
    });
    setVehicleForm({
      vin: "",
      vehicleNumber: "",
      modelYear: new Date().getFullYear(),
      makeName: "",
      modelName: "",
      vehicleType: "",
      color: "",
      licensePlate: "",
      licenseState: "",
      branding: "",
      interior: "",
      tuneStatus: "",
      region: "",
      district: "",
      acquisitionAddress: "",
      city: "",
      state: "",
      zip: "",
      status: "available"
    });
  };


  return (
    <MainContent>
      <TopBar 
        title="Create Vehicle" 
        breadcrumbs={["Home", "Create Vehicle"]}
      />
      
      <main className="p-6">
        <div className="max-w-4xl mx-auto">
          <BackButton href="/" />
          <Card>
            <CardHeader>
              <CardTitle data-testid="text-vehicle-title">Add New Vehicle</CardTitle>
              <CardDescription>
                Enter the vehicle details to add it to your fleet
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVehicleSubmit} className="space-y-8">
                {/* Basic Vehicle Information */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-basic">Basic Vehicle Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vin">VIN *</Label>
                      <Input
                        id="vin"
                        value={vehicleForm.vin || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, vin: e.target.value }))}
                        placeholder="17-character Vehicle Identification Number"
                        maxLength={17}
                        data-testid="input-vin"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicleNumber">Vehicle Number</Label>
                      <Input
                        id="vehicleNumber"
                        value={vehicleForm.vehicleNumber || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                        placeholder="Internal fleet number"
                        data-testid="input-vehicle-number"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="modelYear">Model Year *</Label>
                      <Input
                        id="modelYear"
                        type="number"
                        value={vehicleForm.modelYear || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, modelYear: parseInt(e.target.value) || undefined }))}
                        placeholder={new Date().getFullYear().toString()}
                        min="1990"
                        max={new Date().getFullYear() + 1}
                        data-testid="input-model-year"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="makeName">Make *</Label>
                      <Select 
                        value={vehicleForm.makeName || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, makeName: value }))}
                        data-testid="select-make"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select make" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FORD" data-testid="option-ford">Ford</SelectItem>
                          <SelectItem value="CHEVROLET" data-testid="option-chevrolet">Chevrolet</SelectItem>
                          <SelectItem value="TOYOTA" data-testid="option-toyota">Toyota</SelectItem>
                          <SelectItem value="HONDA" data-testid="option-honda">Honda</SelectItem>
                          <SelectItem value="NISSAN" data-testid="option-nissan">Nissan</SelectItem>
                          <SelectItem value="RAM" data-testid="option-ram">Ram</SelectItem>
                          <SelectItem value="GMC" data-testid="option-gmc">GMC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="modelName">Model *</Label>
                      <Input
                        id="modelName"
                        value={vehicleForm.modelName || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, modelName: e.target.value }))}
                        placeholder="e.g., Econoline, Transit"
                        data-testid="input-model-name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vehicleType">Vehicle Type *</Label>
                    <Select 
                      value={vehicleForm.vehicleType || ""} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, vehicleType: value }))}
                      data-testid="select-vehicle-type"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select vehicle type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sears-fleet" data-testid="option-sears-fleet">Sears Fleet</SelectItem>
                        <SelectItem value="byov" data-testid="option-byov">Bring Your Own Vehicle (B.Y.O.V.)</SelectItem>
                        <SelectItem value="rental" data-testid="option-rental">Rental</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="color">Color</Label>
                    <Select 
                      value={vehicleForm.color || ""} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, color: value }))}
                      data-testid="select-color"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select color" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Blue" data-testid="option-blue">Blue</SelectItem>
                        <SelectItem value="White" data-testid="option-white">White</SelectItem>
                        <SelectItem value="Red" data-testid="option-red">Red</SelectItem>
                        <SelectItem value="Black" data-testid="option-black">Black</SelectItem>
                        <SelectItem value="Silver" data-testid="option-silver">Silver</SelectItem>
                        <SelectItem value="Gray" data-testid="option-gray">Gray</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                {/* Registration & Licensing */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-registration">Registration & Licensing</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="licensePlate">License Plate</Label>
                      <Input
                        id="licensePlate"
                        value={vehicleForm.licensePlate || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, licensePlate: e.target.value }))}
                        placeholder="e.g., ABC1234"
                        data-testid="input-license-plate"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="licenseState">License State</Label>
                      <Input
                        id="licenseState"
                        value={vehicleForm.licenseState || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, licenseState: e.target.value.toUpperCase() }))}
                        placeholder="e.g., NY, CA, TX"
                        maxLength={2}
                        data-testid="input-license-state"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Configuration & Branding */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-configuration">Configuration & Branding</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branding">Branding</Label>
                      <Select 
                        value={vehicleForm.branding || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, branding: value }))}
                        data-testid="select-branding"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select branding" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Sears" data-testid="option-sears">Sears</SelectItem>
                          <SelectItem value="AE Factory Service" data-testid="option-ae-factory">AE Factory Service</SelectItem>
                          <SelectItem value="Unmarked" data-testid="option-unmarked">Unmarked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="interior">Interior Configuration</Label>
                      <Select 
                        value={vehicleForm.interior || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, interior: value }))}
                        data-testid="select-interior"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select interior type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Lawn & Garden" data-testid="option-lawn-garden">Lawn & Garden</SelectItem>
                          <SelectItem value="Utility With Ref Racks" data-testid="option-utility-with-racks">Utility With Ref Racks</SelectItem>
                          <SelectItem value="Utility Without Ref Racks" data-testid="option-utility-without-racks">Utility Without Ref Racks</SelectItem>
                          <SelectItem value="Empty" data-testid="option-empty">Empty</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tuneStatus">Tune Status</Label>
                      <Select 
                        value={vehicleForm.tuneStatus || ""} 
                        onValueChange={(value) => setVehicleForm(prev => ({ ...prev, tuneStatus: value }))}
                        data-testid="select-tune-status"
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select tune status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Maximum" data-testid="option-maximum">Maximum</SelectItem>
                          <SelectItem value="Medium" data-testid="option-medium">Medium</SelectItem>
                          <SelectItem value="Stock" data-testid="option-stock">Stock</SelectItem>
                          <SelectItem value="NA" data-testid="option-na">N/A</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Location & Assignment */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-location">Location & Assignment</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="region">Region</Label>
                      <Input
                        id="region"
                        value={vehicleForm.region || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, region: e.target.value }))}
                        placeholder="e.g., 0000850"
                        data-testid="input-region"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="district">District</Label>
                      <Input
                        id="district"
                        value={vehicleForm.district || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, district: e.target.value }))}
                        placeholder="e.g., 0007670"
                        data-testid="input-district"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="acquisitionAddress">Acquisition Address</Label>
                    <Input
                      id="acquisitionAddress"
                      value={vehicleForm.acquisitionAddress || ""}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, acquisitionAddress: e.target.value }))}
                      placeholder="Street address"
                      data-testid="input-acquisition-address"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={vehicleForm.city || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, city: e.target.value }))}
                        placeholder="City name"
                        data-testid="input-city"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={vehicleForm.state || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, state: e.target.value.toUpperCase() }))}
                        placeholder="e.g., NY, CA"
                        maxLength={2}
                        data-testid="input-state"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="zip">ZIP Code</Label>
                      <Input
                        id="zip"
                        value={vehicleForm.zip || ""}
                        onChange={(e) => setVehicleForm(prev => ({ ...prev, zip: e.target.value }))}
                        placeholder="ZIP code"
                        data-testid="input-zip"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Status */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary" data-testid="text-section-status">Vehicle Status</h3>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select 
                      value={vehicleForm.status || "available"} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, status: value }))}
                      data-testid="select-status"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available" data-testid="option-available">Available</SelectItem>
                        <SelectItem value="assigned" data-testid="option-assigned">Assigned</SelectItem>
                        <SelectItem value="maintenance" data-testid="option-maintenance">Maintenance</SelectItem>
                        <SelectItem value="retired" data-testid="option-retired">Retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button type="submit" className="w-full" data-testid="button-submit-vehicle">
                  Create Vehicle
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </MainContent>
  );
}