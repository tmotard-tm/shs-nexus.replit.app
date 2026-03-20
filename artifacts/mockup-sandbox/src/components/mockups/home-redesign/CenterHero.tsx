import { useState } from "react";
import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus } from "lucide-react";

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

const stats = [
  { label: "Fleet Vehicles", value: "1,204", color: "#3B82F6" },
  { label: "Assigned", value: "1,087", color: "#10B981" },
  { label: "Unassigned", value: "117", color: "#F59E0B" },
  { label: "Active Techs", value: "48", color: "#8B5CF6" },
];

export function CenterHero() {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      className="relative w-full h-screen overflow-hidden flex items-center justify-center"
      style={{
        backgroundImage: "url(/__mockup/images/van.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Full overlay with slight vignette */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] pointer-events-none" />

      {/* Center card — tall, takes up most of the vertical space */}
      <div
        className="relative z-10 w-full max-w-3xl mx-6 flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.10)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 32px 64px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-white/10">
          <h1 className="text-2xl font-bold text-white">Nexus: Your Business, Synced.</h1>
          <p className="text-white/50 text-sm mt-1">Fleet management · People workflows · System integrations</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 divide-x divide-white/10">
          {stats.map((s) => (
            <div key={s.label} className="px-6 py-4 text-center">
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-white/50 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-8 border-t border-white/10" />

        {/* Action grid */}
        <div className="px-8 py-6">
          <p className="text-white/40 text-xs uppercase tracking-widest font-medium mb-4">Quick Actions</p>
          <div className="grid grid-cols-4 gap-3">
            {actions.map((a) => {
              const Icon = a.icon;
              const isHovered = hovered === a.label;
              return (
                <button
                  key={a.label}
                  onMouseEnter={() => setHovered(a.label)}
                  onMouseLeave={() => setHovered(null)}
                  className="relative flex flex-col items-center gap-2.5 py-4 px-2 rounded-xl transition-all"
                  style={{
                    background: isHovered ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${isHovered ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)"}`,
                    transform: isHovered ? "translateY(-2px)" : "none",
                  }}
                >
                  {(a as any).badge && (
                    <span className="absolute top-2 right-2 text-[10px] bg-white/25 text-white px-1.5 rounded-full">{(a as any).badge}</span>
                  )}
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: a.color }}
                  >
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs text-center text-white/70 font-medium leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
