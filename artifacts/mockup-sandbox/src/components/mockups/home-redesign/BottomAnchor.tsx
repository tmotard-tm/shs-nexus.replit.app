import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus, Menu, Bell, Settings } from "lucide-react";

const actions = [
  { label: "Task Queue", icon: LayoutGrid, color: "#4B5563" },
  { label: "Offboarding", icon: UserMinus, color: "#DC2626" },
  { label: "Onboarding", icon: UserPlus, color: "#7C3AED" },
  { label: "Fleet Mgmt", icon: MapPin, color: "#16A34A" },
  { label: "Wkly Onboard", icon: CalendarPlus, color: "#0891B2" },
  { label: "Wkly Offboard", icon: CalendarMinus, color: "#E11D48" },
  { label: "New Vehicle", icon: Plus, color: "#2563EB" },
  { label: "Fleet Scope", icon: Wrench, color: "#D97706" },
];

function AppHeader() {
  return (
    <div className="flex items-center h-12 px-4 bg-background border-b border-border z-50 flex-shrink-0">
      <button className="p-1.5 rounded hover:bg-accent mr-2">
        <Menu className="h-5 w-5 text-foreground" />
      </button>
      <span className="font-semibold text-sm text-foreground">Nexus</span>
      <div className="ml-auto flex items-center gap-2">
        <button className="relative p-1.5 rounded hover:bg-accent">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
        </button>
        <button className="p-1.5 rounded hover:bg-accent">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground ml-1">AD</div>
      </div>
    </div>
  );
}

export function BottomAnchor() {
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <AppHeader />

      <div
        className="relative flex-1 overflow-hidden flex flex-col"
        style={{
          backgroundImage: "url(/__mockup/images/van.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Gradient from bottom up — van fully visible at top */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent pointer-events-none" />

        {/* Top-left tagline */}
        <div className="relative z-10 pt-7 pl-8">
          <h1
            className="text-4xl font-bold leading-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}
          >
            Nexus:<br />Your Business,<br />Synced.
          </h1>
        </div>

        {/* Spacer — van fills the middle */}
        <div className="flex-1" />

        {/* Bottom action bar pinned to bottom */}
        <div className="relative z-10 w-full px-6 pb-5">
          <div
            className="w-full rounded-2xl px-6 py-4 flex items-center gap-4"
            style={{
              background: "rgba(255,255,255,0.12)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            <div className="flex-shrink-0 pr-4 border-r border-white/20">
              <p className="text-white/60 text-xs uppercase tracking-widest font-medium">Quick&nbsp;Actions</p>
            </div>
            <div className="flex-1 grid grid-cols-8 gap-2">
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button key={a.label} className="flex flex-col items-center gap-1.5 group">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                      style={{ backgroundColor: a.color }}
                    >
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-white/80 text-[10px] text-center font-medium leading-tight group-hover:text-white transition-colors">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
