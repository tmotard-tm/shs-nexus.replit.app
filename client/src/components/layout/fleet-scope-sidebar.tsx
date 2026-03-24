import { Link, useLocation } from "wouter";
import {
  Car,
  Search,
  Package,
  ParkingSquare,
  ClipboardList,
  LayoutDashboard,
  ShoppingCart,
  Trash2,
  Triangle,
  DollarSign,
  BarChart3,
  TrendingUp,
  Wrench,
  Phone,
  LogOut,
  Clock,
  Home,
  ChevronLeft,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    title: "Action Center",
    items: [
      { label: "Today's Queue", href: "/fleet-scope/queue", icon: Clock, soon: true },
    ],
  },
  {
    title: "Fleet Operations",
    items: [
      { label: "All Vehicles", href: "/fleet-scope", icon: Car },
      { label: "Vehicle Search", href: "/fleet-scope/vehicle-search", icon: Search, soon: true },
      { label: "Spares", href: "/fleet-scope/spares", icon: Package },
      { label: "Park My Fleet", href: "/fleet-scope/pmf", icon: ParkingSquare },
      { label: "Registration", href: "/fleet-scope/registration", icon: ClipboardList },
    ],
  },
  {
    title: "Repair Pipeline",
    items: [
      { label: "Rentals Dashboard", href: "/fleet-scope/dashboard", icon: LayoutDashboard },
      { label: "Purchase Orders", href: "/fleet-scope/pos", icon: ShoppingCart },
      { label: "Decommissioning", href: "/fleet-scope/decommissioning", icon: Trash2 },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { label: "Discrepancy Finder", href: "/fleet-scope/discrepancies", icon: Triangle, soon: true },
      { label: "Fleet Cost", href: "/fleet-scope/fleet-cost", icon: DollarSign },
      { label: "Executive Summary", href: "/fleet-scope/executive-summary", icon: BarChart3 },
      { label: "Metrics Dashboard", href: "/fleet-scope/metrics", icon: TrendingUp },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Holman Research", href: "/fleet-scope/holman-research", icon: Wrench },
      { label: "Batch Caller", href: "/fleet-scope/batch-caller", icon: Phone },
      { label: "Action Tracker", href: "/fleet-scope/action-tracker", icon: CheckSquare },
    ],
  },
];

export function FleetScopeSidebar() {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    try {
      await logout();
      setLocation("/login");
    } catch {
      toast({ title: "Sign out failed", variant: "destructive" });
    }
  };

  const isActive = (href: string) => {
    if (href === "/fleet-scope") {
      return location === "/fleet-scope" || location === "/fleet-scope/";
    }
    return location === href || location.startsWith(href + "/");
  };

  return (
    <aside className="w-[230px] min-w-[230px] h-screen bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">S</span>
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Fleet Scope</span>
        </div>
        <Link href="/">
          <a className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mt-1 transition-colors">
            <ChevronLeft className="w-3 h-3" />
            Back to Nexus
          </a>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
              {section.title}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <a
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors mb-0.5",
                      active
                        ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.soon && (
                      <span className="text-[10px] font-semibold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-full px-1.5 py-0.5 leading-none">
                        Soon
                      </span>
                    )}
                  </a>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-3 space-y-1">
        <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-400">
          <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
            <span className="text-xs text-gray-600 dark:text-gray-300">{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
          </div>
          <span className="truncate">{user?.username ?? ""}</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <LogOut className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
