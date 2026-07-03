import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MainContent } from "@/components/layout/main-content";
import { usePermissions } from "@/hooks/use-permissions";
import { MapPin, Truck, UserPlus, UserMinus, Map, Plus, LayoutGrid, Wrench, CalendarPlus, CalendarMinus, Car, Package, ExternalLink, CalendarDays } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";
import { FilteredMap } from "@/components/vehicle-map-filters";
import { useQuery } from "@tanstack/react-query";
import { EXTERNAL_APPS_KEY } from "@/lib/query-keys";

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

// Original vector icons for App Launcher tiles that have no brand logo.
// A crew-cab pickup with a bed cap (NewMav / Mavericks) and a cargo van (VanGoNow).
function PickupCapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* capped bed */}
      <path d="M30 33 V15 H51 L55 21 V33 Z" fill="#2563eb" stroke="#1e3a8a" strokeWidth="2" strokeLinejoin="round" />
      {/* cab + hood */}
      <path d="M6 33 V22 H11 L16 12 H31 V33 Z" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="2" strokeLinejoin="round" />
      {/* cab window */}
      <path d="M17 14 H29 V21 H12.5 Z" fill="#d6e7ff" />
      {/* cap window */}
      <rect x="34" y="19" width="15" height="8" rx="1.5" fill="#d6e7ff" />
      {/* wheels */}
      <circle cx="18" cy="34" r="6" fill="#111827" />
      <circle cx="46" cy="34" r="6" fill="#111827" />
      <circle cx="18" cy="34" r="2.4" fill="#9ca3af" />
      <circle cx="46" cy="34" r="2.4" fill="#9ca3af" />
    </svg>
  );
}

function CargoVanIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M5 33 V12 H42 L54 22 V33 Z" fill="#0ea5e9" stroke="#0c4a6e" strokeWidth="2" strokeLinejoin="round" />
      <path d="M43 15 L52 22 H43 Z" fill="#d6e7ff" />
      <rect x="11" y="16" width="10" height="6" rx="1.5" fill="#d6e7ff" />
      <rect x="24" y="16" width="10" height="6" rx="1.5" fill="#d6e7ff" />
      <circle cx="18" cy="34" r="6" fill="#111827" />
      <circle cx="45" cy="34" r="6" fill="#111827" />
      <circle cx="18" cy="34" r="2.4" fill="#9ca3af" />
      <circle cx="45" cy="34" r="2.4" fill="#9ca3af" />
    </svg>
  );
}

// Maps an external app's `icon` field to a built-in icon; used when the app has
// no brand logo (logoUrl). Falls back to a generic external-link glyph.
function renderAppIcon(icon: string | null | undefined) {
  if (icon === "calendar") return <CalendarDays className="w-8 h-8 text-slate-700" />;
  if (icon === "pickup") return <PickupCapIcon className="w-10 h-9" />;
  if (icon === "van") return <CargoVanIcon className="w-10 h-9" />;
  return <ExternalLink className="h-6 w-6 text-slate-500" />;
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
    { value: "assign-vehicle", label: "Fleet Management", icon: MapPin, color: "bg-green-600 hover:bg-green-700", action: () => setLocation("/fleet-management"), permissionKey: "assignVehicle" as const },
    { value: "weekly-onboarding", label: "Weekly Onboarding", icon: CalendarPlus, color: "bg-cyan-600 hover:bg-cyan-700", action: () => setLocation("/weekly-onboarding"), permissionKey: "weeklyOnboarding" as const },
    { value: "weekly-offboarding", label: "Weekly Offboarding", icon: CalendarMinus, color: "bg-rose-600 hover:bg-rose-700", action: () => setLocation("/weekly-offboarding"), permissionKey: "weeklyOffboarding" as const },
    { value: "create-vehicle", label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700", action: () => setLocation("/create-vehicle-location"), permissionKey: "createVehicle" as const },
    { value: "fleet-scope", label: "Fleet Scope", icon: Wrench, color: "bg-amber-600 hover:bg-amber-700", action: () => setLocation("/fleet-scope"), permissionKey: "fleetScope" as const },
    { value: "vehicle-rental-management", label: "Vehicle Rental Management", icon: Car, color: "bg-teal-600 hover:bg-teal-700", action: () => setLocation("/vehicle-rental-management"), permissionKey: "vehicleRentalManagement" as const },
  ];

  const workflowOptions = useMemo(() => {
    if (!permissions?.quickActions?.enabled) {
      return [];
    }
    return allWorkflowOptions.filter(option =>
      permissions.quickActions[option.permissionKey] === true
    );
  }, [permissions]);

  // TPMS tile is appended to the workflow dock only for users with TPMS access.
  const canTpms = permissions?.sidebar?.tpms === true;
  const workflowTileCount = workflowOptions.length + (canTpms ? 1 : 0);

  // App Launcher dock — admin-managed external app tiles. staleTime is Infinity
  // globally, so the admin screen invalidates EXTERNAL_APPS_KEY to refresh this.
  interface ExternalAppTile {
    id: string;
    name: string;
    url: string;
    logoUrl: string | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
    isActive: boolean;
  }
  const { data: externalApps = [] } = useQuery<ExternalAppTile[]>({
    queryKey: EXTERNAL_APPS_KEY,
  });
  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set());
  const activeApps = [...externalApps]
    .filter((a) => a.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const glassCardStyle = {
    background: 'rgba(255, 255, 255, 0.12)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
  } as const;

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
            <h2 className="text-5xl font-bold mb-3" style={{ color: '#007bff', textShadow: '2px 2px 0 black, -2px -2px 0 black, 2px -2px 0 black, -2px 2px 0 black' }} data-testid="text-selection-title">
              Nexus: Your Business, Synced.
            </h2>
          </div>

          {/* Workflow Buttons Card — glass style */}
          {(workflowOptions.length > 0 || canTpms) && (
          <div
            className="rounded-2xl p-6"
            style={glassCardStyle}
          >
            <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${Math.min(workflowTileCount, 5)}, minmax(0, 1fr))` }}>
              {workflowOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={option.action}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all hover:bg-white/10"
                  data-testid={`button-${option.value}`}
                >
                  <div className={`w-12 h-12 rounded-lg ${option.color} flex items-center justify-center shadow-lg`}>
                    <option.icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-xs text-center text-white font-medium leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{option.label}</span>
                </button>
              ))}
              {canTpms && (
                <button
                  key="tpms"
                  onClick={() => setLocation("/tpms")}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all hover:bg-white/10"
                  data-testid="button-tpms"
                >
                  <div className="w-12 h-12 rounded-lg bg-orange-600 hover:bg-orange-700 flex items-center justify-center shadow-lg">
                    <Package className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-xs text-center text-white font-medium leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>TPMS</span>
                </button>
              )}
            </div>
          </div>
          )}

          {/* App Launcher Card — admin-managed external apps (everyone who sees the home sees these) */}
          {activeApps.length > 0 && (
          <div
            className="rounded-2xl p-6 mt-6"
            style={glassCardStyle}
          >
            <h3 className="text-sm font-semibold text-center text-white mb-4" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
              App Launcher
            </h3>
            <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${Math.min(activeApps.length, 5)}, minmax(0, 1fr))` }}>
              {activeApps.map((app) => {
                const showLogo = app.logoUrl && !failedLogos.has(app.id);
                return (
                  <a
                    key={app.id}
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all hover:bg-white/10"
                    data-testid={`link-app-${app.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center shadow-lg overflow-hidden"
                      style={{ backgroundColor: app.color || '#475569' }}
                    >
                      {showLogo ? (
                        <img
                          src={app.logoUrl as string}
                          alt=""
                          className="w-full h-full object-contain p-1"
                          onError={() =>
                            setFailedLogos((prev) => {
                              const next = new Set(prev);
                              next.add(app.id);
                              return next;
                            })
                          }
                        />
                      ) : (
                        renderAppIcon(app.icon)
                      )}
                    </div>
                    <span className="text-xs text-center text-white font-medium leading-tight" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{app.name}</span>
                  </a>
                );
              })}
            </div>
          </div>
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
