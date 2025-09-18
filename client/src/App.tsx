import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { ThemeProvider } from "@/hooks/use-theme";
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
import NTAOQueuePage from "@/pages/ntao-queue";
import AssetsQueuePage from "@/pages/assets-queue";
import InventoryQueuePage from "@/pages/inventory-queue";
import FleetQueuePage from "@/pages/fleet-queue";
import DecommissionsQueuePage from "@/pages/decommissions-queue";
import UserManagement from "@/pages/user-management";
import ChangePassword from "@/pages/change-password";
import AnalyticsBoard from "@/pages/analytics-board";
import ProductivityDashboard from "@/pages/productivity-dashboard";
import OperationsDashboard from "@/pages/operations-dashboard";
import StorageSpots from "@/pages/storage-spots";
import SearsDriveEnrollment from "@/pages/sears-drive-enrollment";
import TaskWorkPage from "@/pages/task-work";
import { BackButton } from "@/components/ui/back-button";
import { MainContent } from "@/components/layout/main-content";
import { PermissionProtectedRoute } from "@/components/permission-protected-route";
import { PublicFormRoute } from "@/components/public-form-route";
import { RoleProtectedRoute } from "@/components/role-protected-route";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleProtectedRoute>
      <>
        <div className="dev-banner">
          🚧 DEVELOPMENT VERSION - CONCEPT MODEL ONLY - NOT FOR PRODUCTION USE 🚧
        </div>
        <div className="min-h-screen bg-background flex">
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
      
      <Route path="/analytics">
        <ProtectedRoute>
          <MainContent>
            <AnalyticsBoard />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/productivity">
        <ProtectedRoute>
          <MainContent>
            <ProductivityDashboard />
          </MainContent>
        </ProtectedRoute>
      </Route>

      <Route path="/operations">
        <ProtectedRoute>
          <MainContent>
            <OperationsDashboard />
          </MainContent>
        </ProtectedRoute>
      </Route>
      
      <Route path="/storage-spots">
        <ProtectedRoute>
          <MainContent>
            <StorageSpots />
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
            <OffboardVehicleLocation />
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

      <Route path="/ntao-queue">
        <ProtectedRoute>
          <NTAOQueuePage />
        </ProtectedRoute>
      </Route>

      <Route path="/assets-queue">
        <ProtectedRoute>
          <AssetsQueuePage />
        </ProtectedRoute>
      </Route>

      <Route path="/inventory-queue">
        <ProtectedRoute>
          <InventoryQueuePage />
        </ProtectedRoute>
      </Route>

      <Route path="/fleet-queue">
        <ProtectedRoute>
          <FleetQueuePage />
        </ProtectedRoute>
      </Route>

      <Route path="/decommissions-queue">
        <ProtectedRoute>
          <DecommissionsQueuePage />
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
        <PermissionProtectedRoute formKey="user-management" redirectOnDenied={true}>
          <MainContent>
            <UserManagement />
          </MainContent>
        </PermissionProtectedRoute>
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

      <Route path="/analytics-board">
        <ProtectedRoute>
          <AnalyticsBoard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/change-password">
        <ProtectedRoute>
          <MainContent>
            <ChangePassword />
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
            <SidebarProvider>
              <Toaster />
              <Router />
            </SidebarProvider>
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
