import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainContent } from "@/components/layout/main-content";
import { useAuth } from "@/hooks/use-auth";
import { Car, MapPin, Truck, UserPlus, UserMinus, HelpCircle, Settings, Map } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";
import { getActiveVehicleCount, getAvailableVehicles, getUnassignedVehicles } from "@/data/fleetData";
import { FilteredMap } from "@/components/vehicle-map-filters";

export default function AssistanceSelection() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isAssignUpdateDialogOpen, setIsAssignUpdateDialogOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const assistanceOptions = [
    {
      id: "create-vehicle-location",
      title: "Create a New Vehicle",
      description: "Add New Vehicles to the System",
      icon: Car,
      color: "chart-1",
      action: () => setLocation("/create-vehicle-location")
    },
    {
      id: "assign-vehicle-location", 
      title: "Assign or Update a Vehicle",
      description: "Assign Existing Vehicles to Users",
      icon: MapPin,
      color: "chart-2", 
      action: () => setIsAssignUpdateDialogOpen(true)
    },
    {
      id: "onboard-hire",
      title: "Onboarding",
      description: "Process New Employee Onboarding",
      icon: UserPlus,
      color: "chart-3",
      action: () => setLocation("/onboard-hire")
    },
    {
      id: "offboard-vehicle-location",
      title: "Offboarding", 
      description: "Remove Vehicles or Locations from the System",
      icon: UserMinus,
      color: "chart-4",
      action: () => setLocation("/offboard-vehicle-location")
    },
    {
      id: "truck-status",
      title: "TRUCK STATUS",
      description: "Interactive fleet tracking with real-time status updates",
      icon: Map,
      color: "chart-4",
      action: () => setIsMapOpen(true)
    },
    {
      id: "other",
      title: "Other",
      description: "Access Additional Tools and Features",
      icon: HelpCircle,
      color: "chart-5",
      action: () => setLocation("/dashboard")
    }
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
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#007bff', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid="text-selection-title">
              Welcome to Sears Vehicle and Asset Tool
            </h2>
            <p className="text-lg" style={{ color: 'white', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }}>
              What can we help you with today?
            </p>
          </div>

          <div className="flex gap-8">
            {/* Left side stats */}
            <div className="flex flex-col gap-4 w-32">
              <Card 
                className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
                onClick={() => setLocation("/active-vehicles")}
                data-testid="card-active-vehicles"
              >
                <CardContent className="flex flex-col items-center text-center p-4">
                  <Car className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                  <p className="text-lg font-bold text-black" data-testid="text-vehicles-count">{getActiveVehicleCount()}</p>
                  <p className="text-sm text-black">Active Vehicles</p>
                </CardContent>
              </Card>
              <Card 
                className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
                onClick={() => setIsMapOpen(true)}
                data-testid="card-vehicle-map"
              >
                <CardContent className="flex flex-col items-center text-center p-4">
                  <Map className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                  <p className="text-lg font-bold text-black" data-testid="text-map-button">MAP</p>
                  <p className="text-sm text-black">View on Map</p>
                </CardContent>
              </Card>
              <Card 
                className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
                onClick={() => setLocation("/active-vehicles?filter=assigned")}
                data-testid="card-assigned-vehicles"
              >
                <CardContent className="flex flex-col items-center text-center p-4">
                  <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                  <p className="text-lg font-bold text-black" data-testid="text-assigned-count">{getAvailableVehicles().length}</p>
                  <p className="text-sm text-black">Assigned Vehicles</p>
                </CardContent>
              </Card>
              <Card 
                className="bg-white cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105"
                onClick={() => setLocation("/active-vehicles?filter=unassigned")}
                data-testid="card-unassigned-vehicles"
              >
                <CardContent className="flex flex-col items-center text-center p-4">
                  <Truck className="h-6 w-6 mb-2" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                  <p className="text-lg font-bold text-black" data-testid="text-unassigned-count">{getUnassignedVehicles().length}</p>
                  <p className="text-sm text-black">Unassigned Vehicles</p>
                </CardContent>
              </Card>
            </div>

            {/* Right side main options */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {assistanceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <Card 
                  key={option.id} 
                  className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-105 backdrop-blur-sm border-white/20"
                  style={{ backgroundColor: 'rgba(108, 117, 125, 0.2)' }}
                  data-testid={`card-${option.id}`}
                >
                    <CardHeader className="text-center">
                      <div 
                        className={`w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 bg-gray-500`}
                        data-testid={`icon-${option.id}`}
                      >
                        <Icon className="h-8 w-8" style={{ color: '#01effc', filter: 'drop-shadow(1px 0 0 black) drop-shadow(-1px 0 0 black) drop-shadow(0 1px 0 black) drop-shadow(0 -1px 0 black)' }} />
                      </div>
                      <CardTitle className="text-lg font-bold" style={{ color: '#01effc', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid={`title-${option.id}`}>
                        {option.title}
                      </CardTitle>
                      <CardDescription className="font-medium" style={{ color: '#01effc', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid={`description-${option.id}`}>
                        {option.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        onClick={option.action}
                        className="w-full"
                        data-testid={`button-${option.id}`}
                      >
                        Get Started
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
        
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
                data-testid="button-assign-vehicle"
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
                data-testid="button-update-vehicle"
              >
                <Settings className="mr-2 h-4 w-4" />
                Update Vehicle Information
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        
        {/* Vehicle Map Dialog */}
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
      </main>
    </MainContent>
  );
}