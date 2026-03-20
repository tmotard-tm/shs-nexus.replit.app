import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus, ChevronRight } from "lucide-react";

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

export function BottomAnchor() {
  return (
    <div
      className="relative w-full h-screen overflow-hidden flex flex-col"
      style={{
        backgroundImage: "url(/__mockup/images/van.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Minimal top gradient so van shows fully */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

      {/* Top-left tagline — floats over the image */}
      <div className="relative z-10 pt-8 pl-8">
        <h1
          className="text-4xl font-bold leading-tight"
          style={{
            color: "#ffffff",
            textShadow: "0 2px 12px rgba(0,0,0,0.7)",
          }}
        >
          Nexus:<br />Your Business,<br />Synced.
        </h1>
      </div>

      {/* Spacer — van fills the middle */}
      <div className="flex-1" />

      {/* Bottom action bar — full width, pinned to bottom */}
      <div className="relative z-10 w-full px-6 pb-6">
        <div
          className="w-full rounded-2xl px-6 py-5 flex items-center gap-4"
          style={{
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.2)",
          }}
        >
          {/* Section label */}
          <div className="flex-shrink-0 pr-4 border-r border-white/20">
            <p className="text-white/60 text-xs uppercase tracking-widest font-medium">Quick&nbsp;Actions</p>
          </div>

          {/* Actions in a row */}
          <div className="flex-1 grid grid-cols-8 gap-2">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
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
  );
}
