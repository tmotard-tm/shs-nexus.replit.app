import { useState, useEffect } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { PermissionsProvider } from "@/hooks/use-permissions";
import { PreviewRoleProvider } from "@/hooks/use-preview-role";
import { ThemeProvider } from "@/hooks/use-theme";
import { OnboardingProvider } from "@/hooks/use-onboarding";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBarProvider } from "@/components/status-bar";
import { BackgroundSyncManager } from "@/components/background-sync-manager";
import { OnboardingOverlay } from "@/components/onboarding-overlay";
import { PreviewModeBanner } from "@/components/preview-mode-banner";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import ManualLogin from "@/pages/manual-login";
import SsoCallback from "@/pages/sso-callback";
import AssistanceSelection from "@/pages/assistance-selection";
import CreateVehicle from "@/pages/create-vehicle-location";
import AssignVehicleLocation from "@/pages/assign-vehicle-location";
import UpdateVehicle from "@/pages/update-vehicle";
import OnboardHire from "@/pages/onboard-hire";
import OffboardTechnician from "@/pages/offboard-technician";
import ActiveVehicles from "@/pages/active-vehicles";
import Dashboard from "@/pages/dashboard";
import Integrations from "@/pages/integrations";
import HolmanIntegration from "@/pages/holman-integration";
import AmsIntegration from "@/pages/ams-integration";
import ParqIntegration from "@/pages/parq-integration";
import SegnoIntegration from "@/pages/segno-integration";
import SamsaraIntegration from "@/pages/samsara-integration";
import TpmsIntegration from "@/pages/tpms-integration";
import QueueManagement from "@/pages/queue-management";
import DecommissionsQueuePage from "@/pages/decommissions-queue";
import UserManagement from "@/pages/user-management";
import TemplateManagement from "@/pages/template-management";
import RolePermissions from "@/pages/role-permissions";
import ChangePassword from "@/pages/change-password";
import AnalyticsBoard from "@/pages/analytics-board";
import OperationsDashboard from "@/pages/operations-dashboard";
import RentalReductionDashboard from "@/pages/rental-reduction-dashboard";
import StorageSpots from "@/pages/storage-spots";
import SearsDriveEnrollment from "@/pages/sears-drive-enrollment";
import TaskWorkPage from "@/pages/task-work";
import TechRoster from "@/pages/tech-roster";
import FleetManagement from "@/pages/fleet-management";
import WeeklyOnboarding from "@/pages/weekly-onboarding";
import WeeklyOffboarding from "@/pages/weekly-offboarding";
import FieldMapping from "@/pages/field-mapping";
import ActivityLogs from "@/pages/activity-logs";
import Reporting from "@/pages/reporting";
import CommunicationHub from "@/pages/communication-hub";
import TestRepairResults from "@/pages/test-repair-results";
import About from "@/pages/about";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { PermissionProtectedRoute } from "@/components/permission-protected-route";
import { PublicFormRoute } from "@/components/public-form-route";
import { RoleProtectedRoute } from "@/components/role-protected-route";
import { RoleBasedHome } from "@/components/role-based-home";
import { SecurityQuestionsGate } from "@/components/security-questions-gate";

function AmsGate() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  if (user?.username !== 'tmotard') {
    navigate('/integrations');
    return null;
  }
  return <MainContent><AmsIntegration /></MainContent>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleProtectedRoute>
      <>
        <PreviewModeBanner />
        <div className="dev-banner">
          🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
        </div>
        <div className="min-h-screen bg-background flex overflow-x-hidden">
          <Sidebar />
          {children}
        </div>
      </>
    </RoleProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/manual-login" component={ManualLogin} />
      <Route path="/sso-callback" component={SsoCallback} />
      
      <Route path="/">
        <ProtectedRoute>
          <RoleBasedHome />
        </ProtectedRoute>
      </Route>
      
      <Route path="/dashboard">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/fleet-distribution">
        <ProtectedRoute>
          <MainContent>
            <AnalyticsBoard />
          </MainContent>
        </ProtectedRoute>
      </Route>


      <Route path="/operations">
        <ProtectedRoute>
          <OperationsDashboard />
        </ProtectedRoute>
      </Route>

      <Route path="/rental-dashboard">
        <ProtectedRoute>
          <RentalReductionDashboard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/storage-spots">
        <ProtectedRoute>
          <MainContent>
            <StorageSpots />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      
      {/* New shareable deep-link form routes - public access */}
      <Route path="/forms/create-vehicle">
        <PublicFormRoute>
          <MainContent>
            <CreateVehicle />
          </MainContent>
        </PublicFormRoute>
      </Route>
      
      <Route path="/forms/assign-vehicle">
        <PublicFormRoute>
          <MainContent>
            <AssignVehicleLocation />
          </MainContent>
        </PublicFormRoute>
      </Route>
      
      <Route path="/forms/onboarding">
        <PublicFormRoute>
          <MainContent>
            <OnboardHire />
          </MainContent>
        </PublicFormRoute>
      </Route>
      
      <Route path="/forms/offboarding">
        <PublicFormRoute>
          <MainContent>
            <OffboardTechnician />
          </MainContent>
        </PublicFormRoute>
      </Route>
      
      <Route path="/forms/byov-enrollment">
        <PublicFormRoute>
          <MainContent>
            <SearsDriveEnrollment />
          </MainContent>
        </PublicFormRoute>
      </Route>
      
      {/* Task work routes - deep linking for specific task IDs */}
      <Route path="/tasks/:id/work">
        <ProtectedRoute>
          <TaskWorkPage />
        </ProtectedRoute>
      </Route>
      
      {/* Legacy routes - kept for backward compatibility */}
      <Route path="/create-vehicle-location">
        <ProtectedRoute>
          <MainContent>
            <CreateVehicle />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/weekly-onboarding">
        <ProtectedRoute>
          <WeeklyOnboarding />
        </ProtectedRoute>
      </Route>

      <Route path="/weekly-offboarding">
        <ProtectedRoute>
          <WeeklyOffboarding />
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
      
      <Route path="/offboard-technician">
        <ProtectedRoute>
          <MainContent>
            <OffboardTechnician />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/sears-drive-enrollment">
        <ProtectedRoute>
          <MainContent>
            <SearsDriveEnrollment />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/queue-management">
        <ProtectedRoute>
          <QueueManagement />
        </ProtectedRoute>
      </Route>

      {/* Legacy queue page redirects - redirect to unified queue management with department filter */}
      <Route path="/ntao-queue">
        <Redirect to="/queue-management?dept=ntao" />
      </Route>

      <Route path="/assets-queue">
        <Redirect to="/queue-management?dept=assets" />
      </Route>

      <Route path="/inventory-queue">
        <Redirect to="/queue-management?dept=inventory" />
      </Route>

      <Route path="/fleet-queue">
        <Redirect to="/queue-management?dept=fleet" />
      </Route>

      <Route path="/decommissions-queue">
        <ProtectedRoute>
          <DecommissionsQueuePage />
        </ProtectedRoute>
      </Route>

      <Route path="/phone-recovery">
        <Redirect to="/queue-management?dept=inventory" />
      </Route>

      <Route path="/integrations">
        <ProtectedRoute>
          <MainContent>
            <Integrations />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/holman-integration">
        <ProtectedRoute>
          <MainContent>
            <HolmanIntegration />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/ams-integration">
        <ProtectedRoute>
          <AmsGate />
        </ProtectedRoute>
      </Route>

      <Route path="/parq-integration">
        <ProtectedRoute>
          <ParqIntegration />
        </ProtectedRoute>
      </Route>

      <Route path="/samsara-integration">
        <ProtectedRoute>
          <MainContent>
            <SamsaraIntegration />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/tpms-integration">
        <ProtectedRoute>
          <TpmsIntegration />
        </ProtectedRoute>
      </Route>

      <Route path="/segno-integration">
        <ProtectedRoute>
          <SegnoIntegration />
        </ProtectedRoute>
      </Route>

      <Route path="/tech-roster">
        <ProtectedRoute>
          <TechRoster />
        </ProtectedRoute>
      </Route>

      <Route path="/fleet-management">
        <ProtectedRoute>
          <FleetManagement />
        </ProtectedRoute>
      </Route>

      <Route path="/field-mapping">
        <ProtectedRoute>
          <MainContent>
            <FieldMapping />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/users">
        <PermissionProtectedRoute formKey="user-management" redirectOnDenied={true}>
          <MainContent>
            <UserManagement />
          </MainContent>
        </PermissionProtectedRoute>
      </Route>
      
      <Route path="/templates">
        <PermissionProtectedRoute formKey="template-management" redirectOnDenied={true}>
          <MainContent>
            <TemplateManagement />
          </MainContent>
        </PermissionProtectedRoute>
      </Route>

      <Route path="/communication-hub">
        <ProtectedRoute>
          <MainContent>
            <CommunicationHub />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/role-permissions">
        <ProtectedRoute>
          <MainContent>
            <RolePermissions />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/activity">
        <ProtectedRoute>
          <MainContent>
            <ActivityLogs />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/about">
        <ProtectedRoute>
          <About />
        </ProtectedRoute>
      </Route>
      
      <Route path="/active-vehicles">
        <ProtectedRoute>
          <ActiveVehicles />
        </ProtectedRoute>
      </Route>

      <Route path="/analytics-board">
        <ProtectedRoute>
          <AnalyticsBoard />
        </ProtectedRoute>
      </Route>

      <Route path="/reporting">
        <ProtectedRoute>
          <MainContent>
            <Reporting />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/change-password">
        <ProtectedRoute>
          <MainContent>
            <ChangePassword />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/test-repair-results">
        <ProtectedRoute>
          <MainContent>
            <TestRepairResults />
          </MainContent>
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
        <ThemeProvider>
          <AuthProvider>
            <StatusBarProvider>
              <PreviewRoleProvider>
                <PermissionsProvider>
                  <SidebarProvider>
                    <OnboardingProvider>
                      <Toaster />
                      <OnboardingOverlay />
                      <SecurityQuestionsGate />
                      <BackgroundSyncManager />
                      <Router />
                    </OnboardingProvider>
                  </SidebarProvider>
                </PermissionsProvider>
              </PreviewRoleProvider>
            </StatusBarProvider>
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
