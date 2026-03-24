import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, User, Truck, Phone, Mail, MapPin } from "lucide-react";

type Tech = {
  id: string;
  techId: string | null;
  enterpriseId: string | null;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  pdcNo: string | null;
  techManagerLdapId: string | null;
  techManagerName: string | null;
  truckNo: string | null;
  mobilePhone: string | null;
  email: string | null;
  shippingAddresses: any[];
};

export default function TpmsTechProfiles() {
  const [filters, setFilters] = useState({
    district: "",
    lastName: "",
    firstName: "",
    techManagerId: "",
    pdc: "",
    enterpriseId: "",
    truckNo: "",
  });
  const [searchParams, setSearchParams] = useState<Record<string, string> | null>(null);
  const [truckSearch, setTruckSearch] = useState("");
  const [searchStr, setSearchStr] = useState("");

  const queryKey = searchParams
    ? ["/api/tpms/techs", searchParams]
    : ["/api/tpms/techs", { truckNo: truckSearch }];

  const { data: techs = [], isFetching } = useQuery<Tech[]>({
    queryKey: truckSearch
      ? ["/api/tpms/techs", { truckNo: truckSearch }]
      : searchStr
      ? ["/api/tpms/techs", { search: searchStr }]
      : ["/api/tpms/techs", searchParams],
    queryFn: async () => {
      if (!searchParams && !truckSearch && !searchStr) return [];
      const params = new URLSearchParams();
      if (truckSearch) {
        params.set("truckNo", truckSearch);
      } else if (searchStr) {
        params.set("search", searchStr);
      } else if (searchParams) {
        Object.entries(searchParams).forEach(([k, v]) => {
          if (v) params.set(k, v);
        });
      }
      const r = await fetch(`/api/tpms/techs?${params.toString()}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!searchParams || !!truckSearch || !!searchStr,
  });

  const handleSearch = () => {
    const active: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) active[k] = v; });
    setSearchParams(Object.keys(active).length ? active : {});
  };

  const handleReset = () => {
    setFilters({ district: "", lastName: "", firstName: "", techManagerId: "", pdc: "", enterpriseId: "", truckNo: "" });
    setSearchParams(null);
    setTruckSearch("");
    setSearchStr("");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tech Profiles</h1>
          <p className="text-muted-foreground text-sm mt-1">Search and manage technician profiles</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find Technician</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">District</Label>
              <Input placeholder="District #" value={filters.district} onChange={(e) => setFilters((p) => ({ ...p, district: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last Name</Label>
              <Input placeholder="Last name" value={filters.lastName} onChange={(e) => setFilters((p) => ({ ...p, lastName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">First Name</Label>
              <Input placeholder="First name" value={filters.firstName} onChange={(e) => setFilters((p) => ({ ...p, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tech Mgr Enterprise ID</Label>
              <Input placeholder="Manager LDAP" value={filters.techManagerId} onChange={(e) => setFilters((p) => ({ ...p, techManagerId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PDC</Label>
              <Input placeholder="PDC #" value={filters.pdc} onChange={(e) => setFilters((p) => ({ ...p, pdc: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Enterprise ID</Label>
              <Input placeholder="LDAP ID" value={filters.enterpriseId} onChange={(e) => setFilters((p) => ({ ...p, enterpriseId: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Truck #</Label>
              <Input placeholder="Truck number" value={filters.truckNo} onChange={(e) => setFilters((p) => ({ ...p, truckNo: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
            <Button variant="outline" onClick={handleReset}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      {isFetching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isFetching && techs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{techs.length} technician{techs.length !== 1 ? "s" : ""} found</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {techs.map((tech) => (
              <Card key={tech.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm">
                          {tech.firstName} {tech.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{tech.enterpriseId}</p>
                      </div>
                    </div>
                    {tech.districtNo && (
                      <Badge variant="secondary" className="text-xs">Dist {tech.districtNo}</Badge>
                    )}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {tech.truckNo && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" />
                        <span>Truck #{tech.truckNo}</span>
                      </div>
                    )}
                    {tech.mobilePhone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{tech.mobilePhone}</span>
                      </div>
                    )}
                    {tech.email && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="truncate">{tech.email}</span>
                      </div>
                    )}
                    {tech.shippingAddresses?.length > 0 && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{tech.shippingAddresses[0].city}, {tech.shippingAddresses[0].stateCd}</span>
                      </div>
                    )}
                  </div>
                  {tech.pdcNo && (
                    <div className="pt-1 border-t">
                      <p className="text-xs text-muted-foreground">PDC: {tech.pdcNo}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!isFetching && searchParams !== null && techs.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <User className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No technicians found matching your search criteria.</p>
        </div>
      )}
    </div>
  );
}
