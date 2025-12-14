import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainContent } from "@/components/layout/main-content";
import { usePermissions } from "@/hooks/use-permissions";
import { MapPin, Truck, UserPlus, UserMinus, Map, Plus, LayoutGrid, Wrench } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";
import { FilteredMap } from "@/components/vehicle-map-filters";
import { useQuery } from "@tanstack/react-query";

interface FleetVehicle {
  tpmsAssignedTechId?: string;
  holmanTechAssigned?: string;
  [key: string]: any;
}

interface FleetVehiclesResponse {
  success: boolean;
  vehicles: FleetVehicle[];
}

// Helper to check if a vehicle is assigned (has a tech via TPMS or Holman)
function isVehicleAssigned(vehicle: FleetVehicle): boolean {
  return !!(vehicle.tpmsAssignedTechId || vehicle.holmanTechAssigned);
}

export default function AssistanceSelection() {
  const { permissions } = usePermissions();
  const [, setLocation] = useLocation();
  const [isAssignUpdateDialogOpen, setIsAssignUpdateDialogOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  // Fetch vehicles from Holman API
  const { data: apiResponse } = useQuery<FleetVehiclesResponse>({
    queryKey: ['/api/holman/fleet-vehicles'],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const allVehicles = apiResponse?.vehicles || [];
  // Vehicle is assigned if it has a tech assigned via TPMS or Holman
  const assignedVehicles = allVehicles.filter(isVehicleAssigned);
  const unassignedVehicles = allVehicles.filter(v => !isVehicleAssigned(v));

  const allWorkflowOptions = [
    { value: "task-queue", label: "Task Queue", icon: LayoutGrid, color: "bg-gray-600 hover:bg-gray-700", action: () => setLocation("/queue-management"), permissionKey: "taskQueue" as const },
    { value: "offboarding", label: "Offboarding", icon: UserMinus, color: "bg-red-600 hover:bg-red-700", action: () => setLocation("/offboard-technician"), permissionKey: "offboarding" as const },
    { value: "onboarding", label: "Onboarding", icon: UserPlus, color: "bg-purple-600 hover:bg-purple-700", action: () => setLocation("/onboard-hire"), permissionKey: "onboarding" as const },
    { value: "assign-vehicle", label: "Assign or Update Vehicle", icon: MapPin, color: "bg-green-600 hover:bg-green-700", action: () => setIsAssignUpdateDialogOpen(true), permissionKey: "assignVehicle" as const },
    { value: "create-vehicle", label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700", action: () => setLocation("/create-vehicle-location"), permissionKey: "createVehicle" as const },
  ];

  const workflowOptions = useMemo(() => {
    if (!permissions?.quickActions?.enabled) {
      return [];
    }
    return allWorkflowOptions.filter(option => 
      permissions.quickActions[option.permissionKey] === true
    );
  }, [permissions]);

  return (
    <MainContent noPadding>
      {/* Main Content */}
      <main 
        className="relative min-h-screen"
        style={{
          backgroundImage: `url(${searsVanImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Overlay for better content readability */}
        <div className="absolute inset-0 bg-background/60"></div>
        <div className="relative z-10 max-w-4xl mx-auto pt-4 px-4">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold mb-3" style={{ color: '#007bff', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid="text-selection-title">
              Welcome to Sears Drive Line Management Systems
            </h2>
            <p className="text-lg" style={{ color: 'white', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }}>
              What can we help you with today?
            </p>
          </div>

          {/* Workflow Buttons Card */}
          {workflowOptions.length > 0 && (
          <Card className="backdrop-blur-sm border-white/20 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95">
            <CardContent className="p-6">
              <div className={`grid gap-4 ${workflowOptions.length >= 5 ? 'grid-cols-5' : workflowOptions.length >= 3 ? 'grid-cols-3' : 'grid-cols-' + workflowOptions.length}`} style={{ gridTemplateColumns: `repeat(${Math.min(workflowOptions.length, 5)}, minmax(0, 1fr))` }}>
                {workflowOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={option.action}
                    className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    data-testid={`button-${option.value}`}
                  >
                    <div className={`w-12 h-12 rounded-lg ${option.color} flex items-center justify-center`}>
                      <option.icon className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-xs text-center text-gray-700 dark:text-gray-200 font-medium leading-tight">{option.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          )}
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
                <p className="text-2xl font-bold text-green-600" data-testid="text-assigned-vehicles">{assignedVehicles.length}</p>
                <p className="text-sm text-muted-foreground">Assigned Vehicles</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-orange-600" data-testid="text-unassigned-vehicles">{unassignedVehicles.length}</p>
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
                <Wrench className="mr-2 h-4 w-4" />
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
                Interactive fleet tracking with real-time status updates • {allVehicles.length} Active Vehicles
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
