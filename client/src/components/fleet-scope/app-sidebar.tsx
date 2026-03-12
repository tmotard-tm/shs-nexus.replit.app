import { useLocation, Link } from "wouter";
import { useUser } from "@/context/FleetScopeUserContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  Car,
  LayoutDashboard,
  ClipboardList,
  Search,
  Truck,
  ParkingCircle,
  FileText,
  Receipt,
  Trash2,
  BarChart3,
  TrendingUp,
  DollarSign,
  Wrench,
  ListChecks,
  AlertTriangle,
  User,
  LogOut,
  Phone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import searsLogo from "@assets/image_1764154330093.png";

const navGroups = [
  {
    label: "Action Center",
    items: [
      { title: "Today's Queue", href: "/fleet-scope/queue", icon: ClipboardList },
    ],
  },
  {
    label: "Fleet Operations",
    items: [
      { title: "All Vehicles", href: "/fleet-scope", icon: Car },
      { title: "Vehicle Search", href: "/fleet-scope/vehicle-search", icon: Search },
      { title: "Spares", href: "/fleet-scope/spares", icon: Truck },
      { title: "Park My Fleet", href: "/fleet-scope/pmf", icon: ParkingCircle },
      { title: "Registration", href: "/fleet-scope/registration", icon: FileText },
    ],
  },
  {
    label: "Repair Pipeline",
    items: [
      { title: "Rentals Dashboard", href: "/fleet-scope/dashboard", icon: LayoutDashboard },
      { title: "Purchase Orders", href: "/fleet-scope/pos", icon: Receipt },
      { title: "Decommissioning", href: "/fleet-scope/decommissioning", icon: Trash2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Discrepancy Finder", href: "/fleet-scope/discrepancies", icon: AlertTriangle },
      { title: "Fleet Cost", href: "/fleet-scope/fleet-cost", icon: DollarSign },
      { title: "Executive Summary", href: "/fleet-scope/executive-summary", icon: BarChart3 },
      { title: "Metrics Dashboard", href: "/fleet-scope/metrics", icon: TrendingUp },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Holman Research", href: "/fleet-scope/holman-research", icon: Wrench },
      { title: "Batch Caller", href: "/fleet-scope/batch-caller", icon: Phone },
      { title: "Action Tracker", href: "/fleet-scope/action-tracker", icon: ListChecks },
    ],
  },
];

const placeholderRoutes = ["/fleet-scope/queue", "/fleet-scope/vehicle-search", "/fleet-scope/discrepancies"];

export function AppSidebar() {
  const [location] = useLocation();
  const { currentUser, setCurrentUser } = useUser();

  const isActive = (href: string) => {
    if (href === "/fleet-scope") return location === "/fleet-scope" || location === "/fleet-scope/";
    return location.startsWith(href);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="sidebar-logo">
            <img src={searsLogo} alt="Fleet Scope" className="h-7 w-auto shrink-0" />
            <span className="text-sm font-semibold truncate group-data-[collapsible=icon]:hidden">
              Fleet Scope
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const isPlaceholder = placeholderRoutes.includes(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                      >
                        <Link href={item.href} data-testid={`nav-${item.href.replace(/\//g, "").replace(/^$/, "home")}`}>
                          <item.icon className="shrink-0" />
                          <span className="truncate">{item.title}</span>
                          {isPlaceholder && (
                            <Badge variant="secondary" className="ml-auto text-[9px] px-1.5 py-0 no-default-hover-elevate no-default-active-elevate">
                              Soon
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={currentUser || "Profile"}>
              <Link href="/profile" data-testid="nav-profile">
                <User className="shrink-0" />
                <span className="truncate">{currentUser || "Select Profile"}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {currentUser && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign Out"
                onClick={() => setCurrentUser(null)}
                data-testid="button-sign-out"
              >
                <LogOut className="shrink-0" />
                <span className="truncate">Sign Out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
