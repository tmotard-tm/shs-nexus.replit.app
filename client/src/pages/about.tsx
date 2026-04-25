import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
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
  Clock,
  MessageSquare,
  MapPin,
  Mail,
  Building2,
  ClipboardList,
  Wrench,
  Phone,
  GitBranch,
} from "lucide-react";
import type { ReactNode } from "react";

export default function About() {
  return (
    <MainContent>
      <TopBar title="About Nexus" breadcrumbs={["Home", "About"]} />

      <main className="p-6 max-w-5xl mx-auto">
        <div className="space-y-8">
          <div className="text-center space-y-4 py-8">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
                <Settings className="h-10 w-10 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Nexus</h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Enterprise task management operations platform that automates
              repetitive work, centralizes scattered information, and keeps
              every connected system in sync.
            </p>
            <p className="text-muted-foreground">
              Built for service organizations managing large technician
              workforces and vehicle fleets.
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
                <p>Auto-creation of onboarding & offboarding tasks from HR data</p>
                <p>Workflow templates guide agents through complex processes</p>
                <p>Daily auto-seed jobs keep cost centers and rosters fresh</p>
                <p>Email & SMS automation for routine communications</p>
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
                <p>Single interface across 9+ external systems</p>
                <p>Unified search across people, vehicles, and assignments</p>
                <p>One source of truth eliminates spreadsheet chaos</p>
                <p>Role-based views for Developers, Admins, and Agents</p>
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
                <p>Bi-directional sync across TPMS, Holman, and AMS</p>
                <p>Cross-system tech & address updates in one operation</p>
                <p>Auto-retry queue with 24-hour lifecycle sweep</p>
                <p>Full audit trail for every modification</p>
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
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <SystemTile
                  badgeClass="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  name="Snowflake"
                  desc="HR data warehouse — rosters, separations, rentals, profitability"
                  cadence="Daily sync at 5am EST"
                  icon={<Clock className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                  name="Holman"
                  desc="Fleet management — vehicles, maintenance, POs, assignments"
                  cadence="Real-time + daily sync"
                  icon={<RefreshCw className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300"
                  name="TPMS"
                  desc="Tech ↔ truck assignments, profiles, shipping addresses"
                  cadence="Cached + on-demand refresh"
                  icon={<Database className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-300"
                  name="AMS"
                  desc="In-Home asset management — search, assignments, repairs"
                  cadence="Real-time"
                  icon={<RefreshCw className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300"
                  name="PMF / PARQ AI"
                  desc="Available vehicle inventory by state for allocation"
                  cadence="On-demand"
                  icon={<Zap className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300"
                  name="Samsara"
                  desc="Telematics — GPS, address, speed, last-updated"
                  cadence="Real-time"
                  icon={<MapPin className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                  name="Twilio"
                  desc="SMS & MMS for registration and decommissioning"
                  cadence="Webhook-driven"
                  icon={<MessageSquare className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300"
                  name="SendGrid"
                  desc="Email delivery for Communication Hub templates"
                  cadence="On-demand"
                  icon={<Mail className="h-3 w-3" />}
                />
                <SystemTile
                  badgeClass="bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                  name="Fleet Scope"
                  desc="Internal module — repair pipeline, decommissioning, comms"
                  cadence="Built-in"
                  icon={<Wrench className="h-3 w-3" />}
                />
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
                <Capability icon={<Users className="h-4 w-4 text-primary" />} title="Technician Management" desc="Roster, onboarding, offboarding, weekly views" />
                <Capability icon={<Truck className="h-4 w-4 text-primary" />} title="Fleet Operations" desc="Assignments, PO tracking, decommissioning" />
                <Capability icon={<Clock className="h-4 w-4 text-primary" />} title="Unified Task Queue" desc="Cross-department work with specialized cards" />
                <Capability icon={<Building2 className="h-4 w-4 text-primary" />} title="District Cost Centers" desc="Manual + bulk import + daily auto-seed" />
                <Capability icon={<Wrench className="h-4 w-4 text-primary" />} title="Rental Repair Tracker" desc="Cases, stages, sub-stages, dark-mode UI" />
                <Capability icon={<MessageSquare className="h-4 w-4 text-primary" />} title="Communication Hub" desc="Email & SMS templates with simulation modes" />
                <Capability icon={<Phone className="h-4 w-4 text-primary" />} title="Phone Recovery" desc="Inventory queue + dedicated workflow" />
                <Capability icon={<MapPin className="h-4 w-4 text-primary" />} title="Cross-System Address" desc="Update TPMS + AMS in a single action" />
                <Capability icon={<GitBranch className="h-4 w-4 text-primary" />} title="Fleet Alignment Pipeline" desc="Detects mismatches across TPMS, Holman, AMS" />
                <Capability icon={<Shield className="h-4 w-4 text-primary" />} title="Role-Based Access" desc="SAML SSO + granular per-role permissions" />
                <Capability icon={<ClipboardList className="h-4 w-4 text-primary" />} title="Workflow Templates" desc="Guided step-by-step task completion" />
                <Capability icon={<Database className="h-4 w-4 text-primary" />} title="Activity Logging" desc="Full audit trail of every action" />
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

function SystemTile(props: {
  badgeClass: string;
  name: string;
  desc: string;
  cadence: string;
  icon: ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg bg-muted/50 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={props.badgeClass}>
          {props.name}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{props.desc}</p>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {props.icon} {props.cadence}
      </p>
    </div>
  );
}

function Capability(props: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
        {props.icon}
      </div>
      <div>
        <p className="font-medium text-sm">{props.title}</p>
        <p className="text-xs text-muted-foreground">{props.desc}</p>
      </div>
    </div>
  );
}
