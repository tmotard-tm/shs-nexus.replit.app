import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, 
  Database, 
  RefreshCw, 
  Users, 
  Truck, 
  Settings,
  CheckCircle,
  Globe,
  Shield,
  Clock
} from "lucide-react";

export default function About() {
  return (
    <MainContent>
      <TopBar title="About Nexus" breadcrumbs={["Home", "About"]} />
      
      <main className="p-6 max-w-5xl mx-auto">
        <BackButton href="/" />
        
        <div className="space-y-8">
          <div className="text-center space-y-4 py-8">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
                <Settings className="h-10 w-10 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Nexus</h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Enterprise task management operations platform designed to automate repetitive tasks, 
              centralize scattered information, and synchronize updates across multiple systems in real-time.
            </p>
            <p className="text-muted-foreground">
              Built for service organizations managing large technician workforces and vehicle fleets.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-lg">Automation</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-sm text-muted-foreground space-y-2">
                <p>Auto-creation of onboarding/offboarding tasks from HR data</p>
                <p>Workflow templates guide agents through complex processes</p>
                <p>Scheduled syncs eliminate manual data entry</p>
                <p>Email automation for routine communications</p>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Database className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <CardTitle className="text-lg">Centralization</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-sm text-muted-foreground space-y-2">
                <p>Single interface consolidating 4+ external systems</p>
                <p>Unified search across employees, vehicles, and assignments</p>
                <p>One source of truth eliminating spreadsheet chaos</p>
                <p>Role-based views showing users exactly what they need</p>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <RefreshCw className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <CardTitle className="text-lg">Synchronization</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-sm text-muted-foreground space-y-2">
                <p>Bi-directional sync keeps local and external systems aligned</p>
                <p>Queue-based updates to Holman ensure reliability</p>
                <p>Change detection triggers automated responses</p>
                <p>Audit logging tracks every modification</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Connected Systems
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">Snowflake</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">HR data warehouse - employee rosters, terminated techs</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Daily sync at 5am EST
                  </p>
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300">Holman</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Fleet management - vehicle details, maintenance, assignments</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> Real-time + daily sync
                  </p>
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300">TPMS</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Technician-to-truck assignments and vehicle tracking</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Database className="h-3 w-3" /> Cached with on-demand refresh
                  </p>
                </div>
                
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300">PMF/PARQ AI</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Available vehicle inventory by state for allocation</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="h-3 w-3" /> On-demand
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Key Capabilities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Technician Management</p>
                    <p className="text-xs text-muted-foreground">Complete roster with onboarding/offboarding workflows</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Truck className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Fleet Operations</p>
                    <p className="text-xs text-muted-foreground">Vehicle assignments, tracking, and Holman sync</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Task Queue</p>
                    <p className="text-xs text-muted-foreground">Unified work queue across all departments</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Role-Based Access</p>
                    <p className="text-xs text-muted-foreground">Granular permissions control per role</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Settings className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Workflow Templates</p>
                    <p className="text-xs text-muted-foreground">Guided step-by-step task completion</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Database className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Activity Logging</p>
                    <p className="text-xs text-muted-foreground">Complete audit trail of all actions</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-sm text-muted-foreground py-4">
            <p>Nexus eliminates manual data entry, reduces errors, and provides a single source of truth.</p>
          </div>
        </div>
      </main>
    </MainContent>
  );
}
