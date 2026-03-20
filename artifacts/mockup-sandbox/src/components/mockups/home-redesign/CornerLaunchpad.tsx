import { useState } from "react";
import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus, Zap } from "lucide-react";

const actions = [
  { label: "Task Queue", icon: LayoutGrid, color: "#4B5563", badge: "4" },
  { label: "Offboarding", icon: UserMinus, color: "#DC2626" },
  { label: "Onboarding", icon: UserPlus, color: "#7C3AED" },
  { label: "Fleet Mgmt", icon: MapPin, color: "#16A34A" },
  { label: "Wkly On", icon: CalendarPlus, color: "#0891B2" },
  { label: "Wkly Off", icon: CalendarMinus, color: "#E11D48" },
  { label: "New Vehicle", icon: Plus, color: "#2563EB" },
  { label: "Fleet Scope", icon: Wrench, color: "#D97706" },
];

export function CornerLaunchpad() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{
        backgroundImage: "url(/__mockup/images/van.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Very subtle vignette — van is the hero */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-black/20 pointer-events-none" />

      {/* Bottom-left watermark tagline */}
      <div className="absolute bottom-8 left-8 z-10">
        <p
          className="text-white text-sm font-medium"
          style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}
        >
          Nexus: Your Business, Synced.
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
          <span className="text-white/50 text-xs">All systems online</span>
        </div>
      </div>

      {/* Top-right floating launchpad */}
      <div className="absolute top-6 right-6 z-10">
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "rgba(10,10,20,0.75)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            width: 300,
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: "rgba(255,255,255,0.10)" }}
          >
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-white text-sm font-semibold">Quick Launch</span>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-white/40 hover:text-white/80 text-xs transition-colors"
            >
              {expanded ? "−" : "+"}
            </button>
          </div>

          {expanded && (
            <div className="p-4">
              {/* 4×2 grid */}
              <div className="grid grid-cols-4 gap-2.5">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.label}
                      className="relative flex flex-col items-center gap-1.5 group"
                    >
                      {(a as any).badge && (
                        <span className="absolute -top-1 -right-1 z-10 text-[9px] bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center font-bold">{(a as any).badge}</span>
                      )}
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ backgroundColor: a.color }}
                      >
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <span className="text-white/60 group-hover:text-white/90 text-[10px] text-center leading-tight transition-colors">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer status */}
          <div
            className="px-4 py-2 border-t flex items-center gap-4"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            {[
              { label: "Fleet", value: "1,204", ok: true },
              { label: "Techs", value: "48", ok: true },
              { label: "Alerts", value: "2", ok: false },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1">
                <div className={`w-1 h-1 rounded-full ${s.ok ? "bg-emerald-400" : "bg-amber-400"}`}></div>
                <span className="text-white/40 text-[10px]">{s.label}</span>
                <span className="text-white/70 text-[10px] font-semibold">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
