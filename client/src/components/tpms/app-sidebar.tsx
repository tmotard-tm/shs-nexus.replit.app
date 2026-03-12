import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
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
  Users,
  MapPin,
  Clock,
  Package,
} from "lucide-react";

const navItems = [
  { title: "Tech Profiles", href: "/tpms/tech-profiles", icon: Users },
  { title: "Shipping Addresses", href: "/tpms/shipping-addresses", icon: MapPin },
  { title: "Shipping Schedules", href: "/tpms/shipping-schedules", icon: Clock },
];

export function TpmsSidebar() {
  const [location] = useLocation();

  const isActive = (href: string) => {
    if (href === "/tpms") return location === "/tpms" || location === "/tpms/";
    return location.startsWith(href);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <Link href="/tpms/tech-profiles">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="tpms-sidebar-logo">
            <Package className="h-5 w-5 shrink-0 text-primary" />
            <span className="text-sm font-semibold truncate group-data-[collapsible=icon]:hidden">
              TPMS
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <Link href={item.href} data-testid={`tpms-nav-${item.href.split('/').pop()}`}>
                        <item.icon className="shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
