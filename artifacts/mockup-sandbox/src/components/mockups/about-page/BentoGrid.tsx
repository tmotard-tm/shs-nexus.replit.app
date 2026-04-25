import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings,
  Zap,
  Database,
  RefreshCw,
  Shield,
  Truck,
  Users,
  MessageSquare,
  Wrench,
  GitBranch,
  Building2,
  Activity,
  Workflow,
  Phone,
  MapPin,
  ClipboardList,
} from "lucide-react";

export function BentoGrid() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="px-6 py-4 max-w-6xl mx-auto">
          <div className="text-xs text-muted-foreground">Home / About</div>
          <h2 className="text-lg font-semibold mt-1">About Nexus</h2>
        </div>
      </div>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4 py-4">
          <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center shadow">
            <Settings className="h-7 w-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Nexus</h1>
            <p className="text-sm text-muted-foreground">
              The enterprise hub for technicians, fleet, and the systems behind them.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 md:col-span-7 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
            <CardContent className="p-6 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">What is Nexus</div>
              <h3 className="text-xl font-semibold leading-snug">
                One platform that automates repetitive work, centralizes
                scattered information, and keeps every connected system in sync.
              </h3>
              <p className="text-sm text-muted-foreground">
                Built for service organizations managing large technician
                workforces and vehicle fleets.
              </p>
              <div className="flex gap-2 pt-2">
                <PillarChip icon={<Zap className="h-3.5 w-3.5" />} label="Automation" tone="blue" />
                <PillarChip icon={<Database className="h-3.5 w-3.5" />} label="Centralization" tone="green" />
                <PillarChip icon={<RefreshCw className="h-3.5 w-3.5" />} label="Synchronization" tone="purple" />
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-6 md:col-span-3">
            <CardContent className="p-5 space-y-1">
              <div className="text-4xl font-bold">9+</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Connected Systems</div>
              <div className="flex flex-wrap gap-1 pt-2">
                {["Snowflake","Holman","TPMS","AMS","PARQ","Samsara","Twilio","SendGrid","Fleet Scope"].map(n => (
                  <Badge key={n} variant="secondary" className="text-[10px] py-0 px-1.5">{n}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-6 md:col-span-2 bg-muted/40">
            <CardContent className="p-5 space-y-1">
              <div className="text-4xl font-bold">3</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">User Roles</div>
              <p className="text-xs text-muted-foreground pt-2">Developer · Admin · Agent</p>
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-4">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Truck className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Fleet Operations</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• Cross-system tech assignment</li>
                <li>• PO tracking + Holman sync</li>
                <li>• Cross-system address updates</li>
                <li>• Fleet alignment verification</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-4">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">People & Workflows</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• Onboarding & offboarding tasks</li>
                <li>• Weekly onboarding views</li>
                <li>• Tools & assets queues</li>
                <li>• Offboarding return landing page</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-4">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Comms & Tracking</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1.5">
                <li>• Communication Hub (email + SMS)</li>
                <li>• Twilio inbound + MMS storage</li>
                <li>• Phone recovery workflow</li>
                <li>• Decommissioning batch messages</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-6 bg-gradient-to-br from-blue-50 to-transparent dark:from-blue-950/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold">Fleet Scope Module</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Repair pipeline, rental reduction reporting, decommissioning, and tech profitability — all under one roof.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <FeatureRow icon={<Activity className="h-3.5 w-3.5" />} label="Rental dashboards" />
                <FeatureRow icon={<Wrench className="h-3.5 w-3.5" />} label="Repair tracker cases" />
                <FeatureRow icon={<Building2 className="h-3.5 w-3.5" />} label="District cost centers" />
                <FeatureRow icon={<GitBranch className="h-3.5 w-3.5" />} label="Decomm history" />
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-12 md:col-span-6 bg-gradient-to-br from-purple-50 to-transparent dark:from-purple-950/20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Workflow className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-semibold">Sync & Reliability</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Operation events track every cross-system action with auto-retry and a 24-hour lifecycle sweep.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <FeatureRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="Bi-directional sync" />
                <FeatureRow icon={<Shield className="h-3.5 w-3.5" />} label="Full audit logging" />
                <FeatureRow icon={<MapPin className="h-3.5 w-3.5" />} label="Address propagation" />
                <FeatureRow icon={<ClipboardList className="h-3.5 w-3.5" />} label="Workflow templates" />
              </div>
            </CardContent>
          </Card>

          <Card className="col-span-12 bg-muted/30">
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Secure by default</p>
                  <p className="text-xs text-muted-foreground">SAML SSO with credential fallback · Role-based access · Activity log on every action</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3.5 w-3.5" /> 24/7 sync
                <span className="mx-1">·</span>
                <Activity className="h-3.5 w-3.5" /> Daily auto-seed
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs text-muted-foreground pt-4 pb-2">
          One platform. Less manual work. A single source of truth.
        </div>
      </main>
    </div>
  );
}

function PillarChip(props: { icon: React.ReactNode; label: string; tone: "blue" | "green" | "purple" }) {
  const tones = {
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  } as const;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tones[props.tone]}`}>
      {props.icon} {props.label}
    </div>
  );
}

function FeatureRow(props: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {props.icon} <span>{props.label}</span>
    </div>
  );
}
