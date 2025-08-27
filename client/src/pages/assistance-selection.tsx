import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MainContent } from "@/components/layout/main-content";
import { useAuth } from "@/hooks/use-auth";
import { Car, MapPin, UserPlus, UserMinus, HelpCircle, Settings } from "lucide-react";
import { useLocation } from "wouter";
import searsVanImage from "@assets/generated_images/Sears_service_van_5aad7e52.png";

export default function AssistanceSelection() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const assistanceOptions = [
    {
      id: "create-vehicle-location",
      title: "Create a new vehicle/location",
      description: "Add new vehicles or locations to the system",
      icon: Car,
      color: "chart-1",
      action: () => setLocation("/create-vehicle-location")
    },
    {
      id: "assign-vehicle-location", 
      title: "Assign a vehicle/location",
      description: "Assign existing vehicles or locations to users",
      icon: MapPin,
      color: "chart-2", 
      action: () => setLocation("/assign-vehicle-location")
    },
    {
      id: "onboard-hire",
      title: "Onboard a new hire",
      description: "Process new employee onboarding",
      icon: UserPlus,
      color: "chart-3",
      action: () => setLocation("/onboard-hire")
    },
    {
      id: "offboard-vehicle-location",
      title: "Offboard a vehicle or location", 
      description: "Remove vehicles or locations from the system",
      icon: UserMinus,
      color: "chart-4",
      action: () => setLocation("/offboard-vehicle-location")
    },
    {
      id: "other",
      title: "Other",
      description: "Access additional tools and features",
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
              <h1 className="text-2xl font-bold" data-testid="text-app-title">Sears Management Platform</h1>
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
        <div className="relative z-10 max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-4" style={{ color: '#007bff', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }} data-testid="text-selection-title">
              Welcome to Sears Vehicle and Asset Tool
            </h2>
            <p className="text-lg" style={{ color: 'white', textShadow: '1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black' }}>
              What can we help you with today?
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
                        className={`w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 bg-white/20`}
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

          {/* Quick Stats or Additional Info */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="flex items-center p-6">
                <Car className="h-8 w-8 text-[hsl(var(--chart-1))] mr-4" />
                <div>
                  <p className="text-2xl font-bold" data-testid="text-vehicles-count">12</p>
                  <p className="text-sm text-muted-foreground">Active Vehicles</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center p-6">
                <MapPin className="h-8 w-8 text-[hsl(var(--chart-2))] mr-4" />
                <div>
                  <p className="text-2xl font-bold" data-testid="text-locations-count">8</p>
                  <p className="text-sm text-muted-foreground">Locations</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center p-6">
                <UserPlus className="h-8 w-8 text-[hsl(var(--chart-3))] mr-4" />
                <div>
                  <p className="text-2xl font-bold" data-testid="text-employees-count">24</p>
                  <p className="text-sm text-muted-foreground">Active Employees</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </MainContent>
  );
}