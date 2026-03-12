import { Switch, Route, Redirect } from "wouter";
import { Link } from "wouter";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { TpmsSidebar } from "@/components/tpms/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Home } from "lucide-react";

import TechProfiles from "./TechProfiles";
import ShippingAddresses from "./ShippingAddresses";
import ShippingSchedules from "./ShippingSchedules";
import NotFound from "@/pages/not-found";

export default function TpmsLayout() {
  return (
    <SidebarProvider>
      <div className="tpms-layout min-h-screen flex w-full">
        <TpmsSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Home className="h-3.5 w-3.5" />
              <span>Nexus</span>
            </Link>
            <span className="text-muted-foreground text-sm">/</span>
            <span className="text-sm font-medium text-foreground">TPMS</span>
          </header>
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/tpms">
                <Redirect to="/tpms/tech-profiles" />
              </Route>
              <Route path="/tpms/tech-profiles" component={TechProfiles} />
              <Route path="/tpms/shipping-addresses" component={ShippingAddresses} />
              <Route path="/tpms/shipping-schedules" component={ShippingSchedules} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
