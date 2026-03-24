import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, MapPin, Plus, Check } from "lucide-react";

type TechAddress = {
  addressType: string;
  shipToName?: string;
  addrLine1?: string;
  addrLine2?: string;
  city?: string;
  stateCd?: string;
  zipCd?: string;
};

type Tech = {
  id: string;
  techId: string | null;
  enterpriseId: string | null;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  truckNo: string | null;
  shippingAddresses: TechAddress[];
  selected?: boolean;
};

const defaultAddress: TechAddress = {
  addressType: "PRIMARY",
  shipToName: "",
  addrLine1: "",
  addrLine2: "",
  city: "",
  stateCd: "",
  zipCd: "",
};

export default function TpmsShippingAddresses() {
  const { toast } = useToast();
  const [findMode, setFindMode] = useState<"district" | "non-district" | null>(null);
  const [district, setDistrict] = useState("");
  const [addressStr, setAddressStr] = useState("");
  const [zip, setZip] = useState("");
  const [doSearch, setDoSearch] = useState(false);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [newAddress, setNewAddress] = useState<TechAddress>(defaultAddress);
  const [step, setStep] = useState<"find" | "select" | "confirm">("find");

  const queryKey = [
    "/api/tpms/techs",
    findMode === "district" ? `district=${district}` : `address=${addressStr}&zip=${zip}`,
  ];

  const { isFetching } = useQuery<Tech[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (findMode === "district" && district) {
        params.set("district", district);
      } else if (findMode === "non-district") {
        if (addressStr) params.set("address", addressStr);
        if (zip) params.set("zip", zip);
      }
      const r = await fetch(`/api/tpms/techs?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Search failed");
      return r.json();
    },
    enabled: doSearch,
  });

  const addMutation = useMutation({
    mutationFn: async ({ techs: selected, address }: { techs: Tech[]; address: TechAddress }) => {
      const results = [];
      for (const t of selected) {
        try {
          await apiRequest("POST", `/api/tpms/techs/${t.techId}/addresses`, address);
          results.push({ techId: t.techId, success: true });
        } catch (e: any) {
          results.push({ techId: t.techId, success: false, error: e.message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.success).length;
      toast({ title: "Addresses added", description: `${ok}/${results.length} technicians updated successfully.` });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      handleReset();
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setTechs([]);
    setDoSearch(true);
    setStep("select");
  };

  const handleReset = () => {
    setFindMode(null);
    setStep("find");
    setDistrict("");
    setAddressStr("");
    setZip("");
    setDoSearch(false);
    setTechs([]);
    setNewAddress(defaultAddress);
  };

  const toggleSelect = (idx: number) => {
    setTechs((prev) => prev.map((t, i) => (i === idx ? { ...t, selected: !t.selected } : t)));
  };

  const selected = techs.filter((t) => t.selected);

  const handleConfirm = () => {
    addMutation.mutate({ techs: selected, address: newAddress });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Shipping Addresses</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage technician shipping addresses</p>
      </div>

      <div className="flex items-center gap-4 mb-4">
        {(["find", "select", "confirm"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : ["find", "select", "confirm"].indexOf(step) > i
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {["find", "select", "confirm"].indexOf(step) > i ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-sm font-medium capitalize">{s}</span>
          </div>
        ))}
      </div>

      {step === "find" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Find Technicians</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                variant={findMode === "district" ? "default" : "outline"}
                onClick={() => setFindMode("district")}
              >
                By District
              </Button>
              <Button
                variant={findMode === "non-district" ? "default" : "outline"}
                onClick={() => setFindMode("non-district")}
              >
                By Address / Zip
              </Button>
            </div>
            {findMode === "district" && (
              <div className="space-y-1.5">
                <Label className="text-xs">District #</Label>
                <Input placeholder="District number" value={district} onChange={(e) => setDistrict(e.target.value)} />
              </div>
            )}
            {findMode === "non-district" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Input placeholder="Street address" value={addressStr} onChange={(e) => setAddressStr(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Zip Code</Label>
                  <Input placeholder="Zip code" value={zip} onChange={(e) => setZip(e.target.value)} />
                </div>
              </div>
            )}
            {findMode && (
              <Button onClick={handleSearch} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Find Technicians
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {step === "select" && (
        <div className="space-y-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{techs.length} technicians found — select those to update</p>
              <div className="grid gap-3 md:grid-cols-2">
                {techs.map((tech, idx) => (
                  <Card
                    key={tech.id}
                    className={`cursor-pointer transition-all ${tech.selected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => toggleSelect(idx)}
                  >
                    <CardContent className="pt-4 flex items-start gap-3">
                      <Checkbox checked={!!tech.selected} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{tech.firstName} {tech.lastName}</p>
                        <p className="text-xs text-muted-foreground">{tech.enterpriseId} · Truck #{tech.truckNo}</p>
                        {tech.shippingAddresses?.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {tech.shippingAddresses.map((addr, ai) => (
                              <div key={ai} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>{addr.addrLine1}, {addr.city}, {addr.stateCd} {addr.zipCd}</span>
                                <Badge variant="outline" className="text-[10px] px-1">{addr.addressType}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {techs.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <MapPin className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p>No technicians found.</p>
                </div>
              )}
              {selected.length > 0 && (
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => setStep("confirm")}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Address to {selected.length} Technician{selected.length !== 1 ? "s" : ""}
                  </Button>
                  <Button variant="outline" onClick={handleReset}>Cancel</Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Shipping Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Address Type</Label>
                <Select value={newAddress.addressType} onValueChange={(v) => setNewAddress((p) => ({ ...p, addressType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIMARY">PRIMARY</SelectItem>
                    <SelectItem value="RE_ASSORTMENT">RE_ASSORTMENT</SelectItem>
                    <SelectItem value="DROP_RETURN">DROP_RETURN</SelectItem>
                    <SelectItem value="ALTERNATE">ALTERNATE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Ship To Name</Label>
                <Input value={newAddress.shipToName || ""} onChange={(e) => setNewAddress((p) => ({ ...p, shipToName: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Address Line 1</Label>
                <Input value={newAddress.addrLine1 || ""} onChange={(e) => setNewAddress((p) => ({ ...p, addrLine1: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Address Line 2</Label>
                <Input value={newAddress.addrLine2 || ""} onChange={(e) => setNewAddress((p) => ({ ...p, addrLine2: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">City</Label>
                <Input value={newAddress.city || ""} onChange={(e) => setNewAddress((p) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">State</Label>
                <Input placeholder="AZ" maxLength={2} value={newAddress.stateCd || ""} onChange={(e) => setNewAddress((p) => ({ ...p, stateCd: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Zip Code</Label>
                <Input value={newAddress.zipCd || ""} onChange={(e) => setNewAddress((p) => ({ ...p, zipCd: e.target.value }))} />
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground mb-3">
                This address will be added to <strong>{selected.length}</strong> technician{selected.length !== 1 ? "s" : ""}.
              </p>
              <div className="flex gap-2">
                <Button onClick={handleConfirm} disabled={addMutation.isPending}>
                  {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Confirm & Save
                </Button>
                <Button variant="outline" onClick={() => setStep("select")}>Back</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
