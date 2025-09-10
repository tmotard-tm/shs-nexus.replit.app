import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { Sidebar } from "@/components/layout/sidebar";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import AssistanceSelection from "@/pages/assistance-selection";
import CreateVehicle from "@/pages/create-vehicle-location";
import AssignVehicleLocation from "@/pages/assign-vehicle-location";
import UpdateVehicle from "@/pages/update-vehicle";
import OnboardHire from "@/pages/onboard-hire";
import OffboardVehicleLocation from "@/pages/offboard-vehicle-location";
import ActiveVehicles from "@/pages/active-vehicles";
import Dashboard from "@/pages/dashboard";
import RequesterInterface from "@/pages/requester";
import ApproverInterface from "@/pages/approver";
import RequestsPage from "@/pages/requests";
import ApiManagement from "@/pages/api-management";
import QueueManagement from "@/pages/queue-management";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <>
        <div className="dev-banner">
          🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
        </div>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <div className="dev-banner">
          🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
        </div>
        <Login />
      </>
    );
  }

  return (
    <>
      <div className="dev-banner">
        🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
      </div>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        {children}
      </div>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <ProtectedRoute>
          <MainContent>
            <AssistanceSelection />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/dashboard">
        <ProtectedRoute>
          <MainContent>
            <Dashboard />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/requester">
        <ProtectedRoute>
          <MainContent>
            <RequesterInterface />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/approver">
        <ProtectedRoute>
          <MainContent>
            <ApproverInterface />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/requests">
        <ProtectedRoute>
          <MainContent>
            <RequestsPage />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/approvals">
        <ProtectedRoute>
          <MainContent>
            <ApproverInterface />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/create-vehicle-location">
        <ProtectedRoute>
          <MainContent>
            <CreateVehicle />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/assign-vehicle-location">
        <ProtectedRoute>
          <MainContent>
            <AssignVehicleLocation />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/update-vehicle">
        <ProtectedRoute>
          <MainContent>
            <UpdateVehicle />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/onboard-hire">
        <ProtectedRoute>
          <MainContent>
            <OnboardHire />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/offboard-vehicle-location">
        <ProtectedRoute>
          <MainContent>
            <OffboardVehicleLocation />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/queue-management">
        <ProtectedRoute>
          <QueueManagement />
        </ProtectedRoute>
      </Route>

      <Route path="/api-management">
        <ProtectedRoute>
          <MainContent>
            <ApiManagement />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/snowflake">
        <ProtectedRoute>
          <MainContent className="p-6">
            <BackButton href="/" />
            <h1 className="text-2xl font-bold">Snowflake Configuration</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/users">
        <ProtectedRoute>
          <MainContent className="p-6">
            <BackButton href="/" />
            <h1 className="text-2xl font-bold">User Management</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/activity">
        <ProtectedRoute>
          <MainContent className="p-6">
            <BackButton href="/" />
            <h1 className="text-2xl font-bold">Activity Logs</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/active-vehicles">
        <ProtectedRoute>
          <ActiveVehicles />
        </ProtectedRoute>
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SidebarProvider>
            <Toaster />
            <Router />
          </SidebarProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
