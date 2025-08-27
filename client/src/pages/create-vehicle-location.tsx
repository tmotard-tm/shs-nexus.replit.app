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

export default function CreateVehicle() {
  const { toast } = useToast();
  const [vehicleForm, setVehicleForm] = useState({
    make: "",
    model: "",
    year: "",
    licensePlate: "",
    vin: "",
    type: "",
    status: "available"
  });

  const handleVehicleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Vehicle Created",
      description: `${vehicleForm.make} ${vehicleForm.model} has been added to the system`,
    });
    setVehicleForm({
      make: "",
      model: "",
      year: "",
      licensePlate: "",
      vin: "",
      type: "",
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
              <form onSubmit={handleVehicleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="make">Make *</Label>
                    <Input
                      id="make"
                      value={vehicleForm.make}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, make: e.target.value }))}
                      placeholder="e.g., Toyota"
                      data-testid="input-make"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model *</Label>
                    <Input
                      id="model"
                      value={vehicleForm.model}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, model: e.target.value }))}
                      placeholder="e.g., Camry"
                      data-testid="input-model"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year">Year *</Label>
                    <Input
                      id="year"
                      value={vehicleForm.year}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, year: e.target.value }))}
                      placeholder="e.g., 2023"
                      data-testid="input-year"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Vehicle Type *</Label>
                    <Select 
                      value={vehicleForm.type} 
                      onValueChange={(value) => setVehicleForm(prev => ({ ...prev, type: value }))}
                      data-testid="select-vehicle-type"
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select vehicle type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rental" data-testid="option-rental">Rental</SelectItem>
                        <SelectItem value="byov" data-testid="option-byov">Bring Your Own Vehicle (B.Y.O.V.)</SelectItem>
                        <SelectItem value="sears-fleet" data-testid="option-sears-fleet">Sears Fleet Vehicle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="licensePlate">License Plate *</Label>
                    <Input
                      id="licensePlate"
                      value={vehicleForm.licensePlate}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, licensePlate: e.target.value }))}
                      placeholder="e.g., ABC-1234"
                      data-testid="input-license-plate"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vin">VIN</Label>
                    <Input
                      id="vin"
                      value={vehicleForm.vin}
                      onChange={(e) => setVehicleForm(prev => ({ ...prev, vin: e.target.value }))}
                      placeholder="Vehicle Identification Number"
                      data-testid="input-vin"
                    />
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