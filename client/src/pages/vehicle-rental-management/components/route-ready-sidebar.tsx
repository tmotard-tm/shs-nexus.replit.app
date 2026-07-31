import { useState } from "react";
import { useLocation } from "wouter";
import { Truck, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { navItems, fonts, colors } from "../lib/constants";
import { useVrmAccess } from "../lib/use-vrm-access";

const COLLAPSE_KEY = "vrm_sidebar_collapsed";

export function RouteReadySidebar() {
  // Restricted pages are hidden unless the SERVER says this session may see
  // them. Fails closed while the answer is in flight.
  const { canSeeNewRentals } = useVrmAccess();
  const visibleNavItems = navItems.filter((n) => !n.restricted || canSeeNewRentals);
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, String(!prev));
      } catch {
        /* private mode etc. — collapse still works for the session */
      }
      return !prev;
    });
  };

  const isActive = (path: string) => {
    if (path === "/vehicle-rental-management") {
      return location === "/vehicle-rental-management";
    }
    return location.startsWith(path);
  };

  return (
    <aside
      className="flex flex-col shrink-0 h-screen sticky top-0 overflow-y-auto transition-all duration-150"
      style={{
        width: collapsed ? 64 : 220,
        backgroundColor: colors.sidebarBg,
      }}
    >
      <div className={`pt-5 pb-6 flex items-center ${collapsed ? "flex-col gap-3 px-0" : "gap-2.5 px-5"}`}>
        {!collapsed && <Truck className="h-4 w-4 text-white opacity-50 shrink-0" />}
        {!collapsed && (
          <span
            className="text-white flex-1 truncate"
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 14,
              opacity: 0.9,
            }}
          >
            Rental Reduction
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-md transition-colors duration-100 hover:bg-white/10 shrink-0"
          style={{ color: colors.inkMuted }}
          data-testid="button-vrm-sidebar-toggle"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 px-2">
        {visibleNavItems.map((item) => {
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
              title={collapsed ? item.label : undefined}
              className={`flex items-center rounded-md text-left w-full transition-colors duration-100 ${collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"}`}
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
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.wip && (
                <span
                  className="px-1.5 py-0.5 rounded-md"
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 10,
                    color: colors.amber,
                    backgroundColor: colors.amberLight,
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

      {!collapsed && (
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
      )}
    </aside>
  );
}
