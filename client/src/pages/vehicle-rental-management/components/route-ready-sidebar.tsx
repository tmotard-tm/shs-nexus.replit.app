import { useLocation } from "wouter";
import { Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { navItems, fonts, colors } from "../lib/constants";

export function RouteReadySidebar() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  const isActive = (path: string) => {
    if (path === "/vehicle-rental-management") {
      return location === "/vehicle-rental-management";
    }
    return location.startsWith(path);
  };

  return (
    <aside
      className="flex flex-col shrink-0 h-screen sticky top-0 overflow-y-auto"
      style={{
        width: 220,
        backgroundColor: colors.sidebarBg,
      }}
    >
      <div className="px-5 pt-5 pb-6 flex items-center gap-2.5">
        <Truck className="h-4 w-4 text-white opacity-50" />
        <span
          className="text-white"
          style={{
            fontFamily: fonts.dmSans,
            fontWeight: 500,
            fontSize: 14,
            opacity: 0.9,
          }}
        >
          Rental Reduction
        </span>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 px-2">
        {navItems.map((item) => {
          const active = !item.wip && isActive(item.path);
          const Icon = item.icon;

          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.wip) {
                  toast({
                    title: "Coming Soon",
                    description: "This module is coming soon",
                  });
                  return;
                }
                setLocation(item.path);
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-left w-full transition-colors duration-100"
              style={{
                fontFamily: fonts.dmSans,
                fontWeight: 400,
                fontSize: 14,
                color: active ? "#FFFFFF" : colors.inkMuted,
                backgroundColor: active ? colors.sidebarActiveItemBg : "transparent",
                borderLeft: active ? `3px solid ${colors.accent}` : "3px solid transparent",
                cursor: item.wip ? "not-allowed" : "pointer",
              }}
            >
              <Icon className="h-4 w-4 shrink-0" style={{ opacity: active ? 1 : 0.6 }} />
              <span className="flex-1">{item.label}</span>
              {item.wip && (
                <span
                  className="px-1.5 py-0.5 rounded-md"
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 10,
                    color: "#B45309",
                    backgroundColor: "#FFFBEB",
                    borderRadius: 6,
                  }}
                >
                  WIP
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-5 pb-5 pt-4">
        <span
          style={{
            fontFamily: fonts.dmSans,
            fontWeight: 300,
            fontSize: 11,
            color: colors.inkMuted,
          }}
        >
          Transformco Fleet Ops
        </span>
      </div>
    </aside>
  );
}
