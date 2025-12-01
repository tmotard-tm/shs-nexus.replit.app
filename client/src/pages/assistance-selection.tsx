import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainContent } from "@/components/layout/main-content";
import { useAuth } from "@/hooks/use-auth";
import { MapPin, Truck, UserPlus, UserMinus, Settings, Map, Plus, LayoutGrid } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";
import { getActiveVehicleCount, getAvailableVehicles, getUnassignedVehicles } from "@/data/fleetData";
import { FilteredMap } from "@/components/vehicle-map-filters";

export default function AssistanceSelection() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isAssignUpdateDialogOpen, setIsAssignUpdateDialogOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const workflowOptions = [
    { value: "task-queue", label: "Task Queue", icon: LayoutGrid, color: "bg-gray-600 hover:bg-gray-700", action: () => setLocation("/queue-management") },
    { value: "offboarding", label: "Offboarding", icon: UserMinus, color: "bg-red-600 hover:bg-red-700", action: () => setLocation("/offboard-technician") },
    { value: "onboarding", label: "Onboarding", icon: UserPlus, color: "bg-purple-600 hover:bg-purple-700", action: () => setLocation("/onboard-hire") },
    { value: "assign-vehicle", label: "Assign or Update Vehicle", icon: MapPin, color: "bg-green-600 hover:bg-green-700", action: () => setIsAssignUpdateDialogOpen(true) },
    { value: "create-vehicle", label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700", action: () => setLocation("/create-vehicle-location") },
  ];

  return (
    <MainContent>
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Settings className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Welcome back, {user?.username}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main 
        className="p-8 relative min-h-screen"
        style={{
          backgroundImage: `url(${searsVanImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Overlay for better content readability */}
        <div className="absolute inset-0 bg-background/80"></div>
        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#007bff', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid="text-selection-title">
              Welcome to SearsDriveLine Management Systems
            </h2>
            <p className="text-lg" style={{ color: 'white', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }}>
              What can we help you with today?
            </p>
          </div>

          {/* Workflow Buttons Card */}
          <Card 
            className="backdrop-blur-sm border-white/20"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
          >
            <CardContent className="p-6">
              <div className="grid grid-cols-5 gap-4">
                {workflowOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={option.action}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-gray-100 transition-colors"
                    data-testid={`button-${option.value}`}
                  >
                    <div className={`w-12 h-12 rounded-lg ${option.color} flex items-center justify-center`}>
                      <option.icon className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-xs text-center text-gray-700 font-medium leading-tight">{option.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Assign/Update Selection Dialog */}
      <Dialog open={isAssignUpdateDialogOpen} onOpenChange={setIsAssignUpdateDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Choose Action</DialogTitle>
              <DialogDescription>
                Would you like to assign a vehicle to an employee or update vehicle information?
              </DialogDescription>
            </DialogHeader>
            
            {/* Vehicle Status Summary */}
            <div className="grid grid-cols-2 gap-4 my-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-green-600" data-testid="text-assigned-vehicles">{getAvailableVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Assigned Vehicles</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-orange-600" data-testid="text-unassigned-vehicles">{getUnassignedVehicles().length}</p>
                <p className="text-sm text-muted-foreground">Unassigned Vehicles</p>
              </div>
            </div>

            <div className="space-y-3">
              <Button 
                className="w-full justify-start" 
                onClick={() => {
                  setIsAssignUpdateDialogOpen(false);
                  setLocation("/assign-vehicle-location");
                }}
                data-testid="button-dialog-assign-vehicle"
              >
                <Truck className="mr-2 h-4 w-4" />
                Assign Vehicle to Employee
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start"
                onClick={() => {
                  setIsAssignUpdateDialogOpen(false);
                  setLocation("/update-vehicle");
                }}
                data-testid="button-dialog-update-vehicle"
              >
                <Settings className="mr-2 h-4 w-4" />
                Update Vehicle Information
              </Button>
            </div>
          </DialogContent>
      </Dialog>

      {/* Fleet Map Dialog */}
      <Dialog open={isMapOpen} onOpenChange={setIsMapOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Map className="h-5 w-5" />
                TRUCK STATUS - Fleet Vehicle Map
              </DialogTitle>
              <DialogDescription>
                Interactive fleet tracking with real-time status updates • {getActiveVehicleCount()} Active Vehicles
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Status Legend */}
              <div className="flex flex-wrap gap-4 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span className="text-sm">Assigned to Tech</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm">In Use</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span className="text-sm">Declined Repair</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-sm">In Repair</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-sm">Spare</span>
                </div>
              </div>
              <FilteredMap isOpen={isMapOpen} />
            </div>
          </DialogContent>
      </Dialog>
    </MainContent>
  );
}
