import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus, ChevronRight } from "lucide-react";

const actions = [
  { label: "Task Queue", icon: LayoutGrid, color: "#4B5563", badge: "4" },
  { label: "Offboarding", icon: UserMinus, color: "#DC2626" },
  { label: "Onboarding", icon: UserPlus, color: "#7C3AED" },
  { label: "Fleet Management", icon: MapPin, color: "#16A34A" },
  { label: "Weekly Onboarding", icon: CalendarPlus, color: "#0891B2" },
  { label: "Weekly Offboarding", icon: CalendarMinus, color: "#E11D48" },
  { label: "Create New Vehicle", icon: Plus, color: "#2563EB" },
  { label: "Fleet Scope", icon: Wrench, color: "#D97706" },
];

export function LeftGlassPanel() {
  return (
    <div
      className="relative w-full h-screen overflow-hidden flex"
      style={{
        backgroundImage: "url(/__mockup/images/van.png)",
        backgroundSize: "cover",
        backgroundPosition: "right center",
      }}
    >
      {/* Left-side gradient to blend panel into image */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-transparent pointer-events-none" />

      {/* Left panel */}
      <div className="relative z-10 flex flex-col justify-between h-full w-80 px-8 py-10 flex-shrink-0">
        {/* Branding */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium text-white/60 border border-white/20 mb-6"
            style={{ background: "rgba(255,255,255,0.08)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
            All systems operational
          </div>
          <h1 className="text-3xl font-bold text-white leading-tight mb-2">
            Nexus: Your Business, Synced.
          </h1>
          <p className="text-white/50 text-sm">Fleet management · People · Integrations</p>
        </div>

        {/* Action list */}
        <div className="space-y-2">
          <p className="text-white/40 text-xs uppercase tracking-widest font-medium mb-3">Quick Actions</p>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.label}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl group transition-all"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.14)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)";
                }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: a.color }}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <span className="flex-1 text-sm font-medium text-white/80 group-hover:text-white text-left transition-colors">{a.label}</span>
                {(a as any).badge && (
                  <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{(a as any).badge}</span>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-white/70 transition-colors" />
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 text-white/30 text-xs">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-white/50 font-medium">A</div>
          <span>Administrator</span>
        </div>
      </div>

      {/* Van shows on the right — no content overlaps it */}
    </div>
  );
}
