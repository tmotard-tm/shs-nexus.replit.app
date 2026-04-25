import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Settings,
  Zap,
  Database,
  RefreshCw,
  Globe,
  Layers,
  Workflow,
  Shield,
  Clock,
  Truck,
  Users,
  MessageSquare,
  MapPin,
  Mail,
  Wrench,
  Phone,
  GitBranch,
  Building2,
  ClipboardList,
  CheckCircle,
} from "lucide-react";

type Tab = "overview" | "integrations" | "capabilities" | "workflows";

export function Tabbed() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="px-6 py-4 max-w-5xl mx-auto">
          <div className="text-xs text-muted-foreground">Home / About</div>
          <h2 className="text-lg font-semibold mt-1">About Nexus</h2>
        </div>
      </div>

      <main className="p-6 max-w-5xl mx-auto">
        <div className="flex items-start gap-5 py-6">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0">
            <Settings className="h-8 w-8 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nexus</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              Enterprise platform that automates repetitive work, centralizes
              information across 9+ systems, and keeps every connected tool in
              sync — built for service organizations managing large technician
              workforces and vehicle fleets.
            </p>
          </div>
        </div>

        <div className="border-b mb-6">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<Layers className="h-4 w-4" />} label="Overview" />
            <TabButton active={tab === "integrations"} onClick={() => setTab("integrations")} icon={<Globe className="h-4 w-4" />} label="Integrations" count={9} />
            <TabButton active={tab === "capabilities"} onClick={() => setTab("capabilities")} icon={<CheckCircle className="h-4 w-4" />} label="Capabilities" count={12} />
            <TabButton active={tab === "workflows"} onClick={() => setTab("workflows")} icon={<Workflow className="h-4 w-4" />} label="Workflows" count={6} />
          </div>
        </div>

        <div className="space-y-6">
          {tab === "overview" && <Overview onJump={setTab} />}
          {tab === "integrations" && <Integrations />}
          {tab === "capabilities" && <Capabilities />}
          {tab === "workflows" && <Workflows />}
        </div>

        <div className="text-center text-xs text-muted-foreground pt-10 pb-4">
          One platform. Less manual work. A single source of truth.
        </div>
      </main>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        props.active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {props.icon}
      {props.label}
      {props.count !== undefined && (
        <span className={`text-xs px-1.5 py-0.5 rounded ${props.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {props.count}
        </span>
      )}
    </button>
  );
}

function Overview({ onJump }: { onJump: (t: Tab) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Pillar
          icon={<Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
          color="bg-blue-100 dark:bg-blue-900/30"
          title="Automation"
          desc="Auto-create tasks from HR data, run guided workflows, and let scheduled jobs replace manual entry."
        />
        <Pillar
          icon={<Database className="h-5 w-5 text-green-600 dark:text-green-400" />}
          color="bg-green-100 dark:bg-green-900/30"
          title="Centralization"
          desc="One interface across 9 systems, unified search, and role-based views for every department."
        />
        <Pillar
          icon={<RefreshCw className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
          color="bg-purple-100 dark:bg-purple-900/30"
          title="Synchronization"
          desc="Bi-directional sync, cross-system updates in one click, with auto-retry and full audit trail."
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="grid sm:grid-cols-3 gap-4 text-center">
            <Stat label="Connected systems" value="9+" onClick={() => onJump("integrations")} />
            <Stat label="Key capabilities" value="12" onClick={() => onJump("capabilities")} />
            <Stat label="Automated workflows" value="6" onClick={() => onJump("workflows")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Shield className="h-4 w-4 text-primary" /> Security & Access
          </div>
          <p className="text-sm text-muted-foreground">
            SAML SSO is the primary login with credential fallback. Three roles
            — Developer, Admin, Agent — control granular UI visibility per
            module. Every action lands in the activity log.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Integrations() {
  const items = [
    { name: "Snowflake", group: "Data", desc: "HR data warehouse — rosters, separations, rentals, profitability", cadence: "Daily 5am EST" },
    { name: "Holman", group: "Fleet", desc: "Vehicles, maintenance, POs, assignment updates", cadence: "Real-time + daily" },
    { name: "TPMS", group: "Fleet", desc: "Tech ↔ truck assignments, profiles, shipping addresses", cadence: "Cached + on-demand" },
    { name: "AMS", group: "Fleet", desc: "In-Home asset management — search, assignments, repairs", cadence: "Real-time" },
    { name: "PMF / PARQ AI", group: "Fleet", desc: "Available vehicle inventory by state", cadence: "On-demand" },
    { name: "Samsara", group: "Telematics", desc: "GPS location, address, speed, last-updated", cadence: "Real-time" },
    { name: "Twilio", group: "Comms", desc: "SMS & MMS for registration and decommissioning", cadence: "Webhook" },
    { name: "SendGrid", group: "Comms", desc: "Email delivery for Communication Hub templates", cadence: "On-demand" },
    { name: "Fleet Scope", group: "Internal", desc: "Internal module — repair pipeline, decommissioning, comms", cadence: "Built-in" },
  ];
  const groups = ["Data", "Fleet", "Telematics", "Comms", "Internal"];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {items.filter((i) => i.group === g).map((i) => (
              <Card key={i.name} className="border">
                <CardContent className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{i.name}</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {i.cadence}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{i.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Capabilities() {
  const caps = [
    { icon: <Users className="h-4 w-4" />, title: "Technician Management", desc: "Roster, onboarding, offboarding, weekly views" },
    { icon: <Truck className="h-4 w-4" />, title: "Fleet Operations", desc: "Assignments, PO tracking, decommissioning" },
    { icon: <Clock className="h-4 w-4" />, title: "Unified Task Queue", desc: "Cross-department work with specialized cards" },
    { icon: <Building2 className="h-4 w-4" />, title: "District Cost Centers", desc: "Manual + bulk import + daily auto-seed" },
    { icon: <Wrench className="h-4 w-4" />, title: "Rental Repair Tracker", desc: "Cases, stages, sub-stages, dark mode" },
    { icon: <MessageSquare className="h-4 w-4" />, title: "Communication Hub", desc: "Email & SMS templates with simulation modes" },
    { icon: <Phone className="h-4 w-4" />, title: "Phone Recovery", desc: "Inventory queue + dedicated workflow" },
    { icon: <MapPin className="h-4 w-4" />, title: "Cross-System Address", desc: "Update TPMS + AMS in a single action" },
    { icon: <GitBranch className="h-4 w-4" />, title: "Fleet Alignment Pipeline", desc: "Detects mismatches across TPMS, Holman, AMS" },
    { icon: <Shield className="h-4 w-4" />, title: "Role-Based Access", desc: "SAML SSO + granular per-role permissions" },
    { icon: <ClipboardList className="h-4 w-4" />, title: "Workflow Templates", desc: "Guided step-by-step task completion" },
    { icon: <Database className="h-4 w-4" />, title: "Activity Logging", desc: "Full audit trail of every action" },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {caps.map((c) => (
        <Card key={c.title} className="border">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
              {c.icon}
            </div>
            <div>
              <p className="font-medium text-sm">{c.title}</p>
              <p className="text-xs text-muted-foreground">{c.desc}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Workflows() {
  const flows = [
    { title: "Onboarding", desc: "HR data triggers tasks across Tools, Vehicle, and Comms queues." },
    { title: "Offboarding", desc: "Assets recovery, BYOV detection, return landing page for techs." },
    { title: "Cross-System Tech Assignment", desc: "Single op assigns / unassigns / transfers across TPMS, Holman, AMS." },
    { title: "Fleet Alignment Verification", desc: "Detects stale tech IDs and external system drift, with retry." },
    { title: "Decommissioning", desc: "Batch SMS, manager CC, media storage, weekly procurement counts." },
    { title: "Rental Reduction", desc: "Pipeline reports, profitability waterfall, daily snapshots and trends." },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {flows.map((f, i) => (
        <Card key={f.title} className="border">
          <CardContent className="p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                {i + 1}
              </div>
              <p className="font-medium text-sm">{f.title}</p>
            </div>
            <p className="text-xs text-muted-foreground">{f.desc}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Pillar(props: { icon: React.ReactNode; color: string; title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${props.color}`}>
          {props.icon}
        </div>
        <p className="font-semibold">{props.title}</p>
        <p className="text-sm text-muted-foreground">{props.desc}</p>
      </CardContent>
    </Card>
  );
}

function Stat(props: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={props.onClick} className="text-left rounded-lg p-3 hover:bg-muted transition-colors">
      <div className="text-3xl font-bold">{props.value}</div>
      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
        {props.label} <span className="text-primary">→</span>
      </div>
    </button>
  );
}
