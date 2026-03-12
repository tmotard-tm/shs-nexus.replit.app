import { MapPin, UserPlus, UserMinus, Plus, LayoutGrid, CalendarPlus, CalendarMinus, Wrench, Menu } from "lucide-react";

const existingTiles = [
  { label: "Task Queue",          icon: LayoutGrid,    color: "bg-gray-600" },
  { label: "Offboarding",         icon: UserMinus,     color: "bg-red-600" },
  { label: "Onboarding",          icon: UserPlus,      color: "bg-purple-600" },
  { label: "Fleet Management",    icon: MapPin,        color: "bg-green-600" },
  { label: "Weekly Onboarding",   icon: CalendarPlus,  color: "bg-cyan-600" },
  { label: "Weekly Offboarding",  icon: CalendarMinus, color: "bg-rose-600" },
  { label: "Create New Vehicle",  icon: Plus,          color: "bg-blue-600" },
];

const fleetScopeTile = {
  label: "Fleet Scope",
  icon: Wrench,
  color: "bg-amber-600",
};

const allTiles = [...existingTiles, fleetScopeTile];

export function LandingPage() {
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}
    >
      {/* Hamburger menu button — top-left, matching Nexus */}
      <div className="fixed top-4 left-4 z-50">
        <button className="h-10 w-10 rounded-md border border-border bg-background shadow-md flex items-center justify-center">
          <Menu className="h-5 w-5 text-foreground" />
        </button>
      </div>

      {/* Van background image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url(/__mockup/images/sears-van.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* Semi-transparent overlay, matching bg-background/60 */}
      <div className="absolute inset-0 bg-white/60" />

      {/* Centered content */}
      <div className="relative z-10 max-w-4xl mx-auto pt-10 px-4">
        {/* Heading */}
        <div className="text-center mb-6">
          <h2
            className="text-3xl font-bold mb-3"
            style={{
              color: "#007bff",
              textShadow:
                "1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black",
              fontFamily: "'Montserrat', system-ui, sans-serif",
            }}
          >
            Welcome to Nexus
          </h2>
          <p
            className="text-lg"
            style={{
              color: "white",
              textShadow:
                "1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black",
            }}
          >
            What can we help you with today?
          </p>
        </div>

        {/* Workflow card */}
        <div className="rounded-xl border border-white/20 backdrop-blur-sm bg-white/95 shadow-xl p-6">
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(allTiles.length, 5)}, minmax(0, 1fr))`,
            }}
          >
            {allTiles.map((tile) => {
              const Icon = tile.icon;
              const isFleetScope = tile.label === "Fleet Scope";
              return (
                <button
                  key={tile.label}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-lg transition-colors
                    ${isFleetScope
                      ? "ring-2 ring-amber-400/60 bg-amber-50/60 hover:bg-amber-50"
                      : "hover:bg-gray-100"
                    }`}
                >
                  {isFleetScope && (
                    <span className="absolute -top-2 -right-2 text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full shadow">
                      NEW
                    </span>
                  )}
                  <div
                    className={`w-12 h-12 rounded-lg ${tile.color} flex items-center justify-center shadow-md`}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-xs text-center text-gray-700 font-medium leading-tight">
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
