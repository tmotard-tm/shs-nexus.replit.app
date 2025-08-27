import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import RequesterInterface from "@/pages/requester";
import ApproverInterface from "@/pages/approver";
import RequestsPage from "@/pages/requests";
import ApiManagement from "@/pages/api-management";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      {children}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/dashboard">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/requester">
        <ProtectedRoute>
          <RequesterInterface />
        </ProtectedRoute>
      </Route>
      
      <Route path="/approver">
        <ProtectedRoute>
          <ApproverInterface />
        </ProtectedRoute>
      </Route>
      
      <Route path="/requests">
        <ProtectedRoute>
          <RequestsPage />
        </ProtectedRoute>
      </Route>
      
      <Route path="/approvals">
        <ProtectedRoute>
          <ApproverInterface />
        </ProtectedRoute>
      </Route>
      
      <Route path="/api-management">
        <ProtectedRoute>
          <ApiManagement />
        </ProtectedRoute>
      </Route>
      
      <Route path="/snowflake">
        <ProtectedRoute>
          <div className="flex-1 ml-64 p-6">
            <h1 className="text-2xl font-bold">Snowflake Configuration</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </div>
        </ProtectedRoute>
      </Route>
      
      <Route path="/users">
        <ProtectedRoute>
          <div className="flex-1 ml-64 p-6">
            <h1 className="text-2xl font-bold">User Management</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </div>
        </ProtectedRoute>
      </Route>
      
      <Route path="/activity">
        <ProtectedRoute>
          <div className="flex-1 ml-64 p-6">
            <h1 className="text-2xl font-bold">Activity Logs</h1>
            <p className="text-muted-foreground mt-2">Coming soon...</p>
          </div>
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
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
