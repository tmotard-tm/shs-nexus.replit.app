import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  RotateCcw,
  Loader2,
  MapPin,
  Building,
  ArrowRight,
  ArrowLeft,
  Check,
  Pencil,
  Trash2,
} from "lucide-react";

type FlowType = "district" | "non-district" | null;
type WizardStep = "find" | "change" | "confirm";

interface TechResult {
  techId: string;
  enterpriseId: string;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  shippingAddresses: any[];
  selected?: boolean;
}

export default function ShippingAddresses() {
  const { toast } = useToast();
  const [flowType, setFlowType] = useState<FlowType>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>("find");

  const [districtNo, setDistrictNo] = useState("");
  const [districtAddress, setDistrictAddress] = useState<any>(null);
  const [streetAddress, setStreetAddress] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [techResults, setTechResults] = useState<TechResult[]>([]);

  const [newAddress, setNewAddress] = useState({
    addressType: "PRIMARY",
    shipToName: "",
    addrLine1: "",
    addrLine2: "",
    city: "",
    stateCd: "",
    zipCd: "",
  });

  const [editDialog, setEditDialog] = useState<{ techId: string; index: number; address: any } | null>(null);
  const [editingAddress, setEditingAddress] = useState<any>(null);

  const searchQuery = useQuery<TechResult[]>({
    queryKey: ["/api/tpms/techs", flowType === "district" ? `district=${districtNo}` : `address=${streetAddress}&zip=${zipCode}`],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (flowType === "district" && districtNo) {
        params.set("district", districtNo);
      } else if (flowType === "non-district") {
        if (streetAddress) params.set("address", streetAddress);
        if (zipCode) params.set("zip", zipCode);
      }
      const res = await fetch(`/api/tpms/techs?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: searchTriggered,
  });

  const addMutation = useMutation({
    mutationFn: async (data: { techs: TechResult[]; address: any }) => {
      const results = [];
      for (const tech of data.techs) {
        try {
          const res = await apiRequest("POST", `/api/tpms/techs/${tech.techId}/addresses`, data.address);
          results.push({ techId: tech.techId, success: true });
        } catch (err: any) {
          results.push({ techId: tech.techId, success: false, error: err.message });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      toast({ title: "Addresses added", description: `${successCount}/${results.length} technicians updated successfully.` });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      resetAll();
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (data: { techId: string; index: number; address: any }) => {
      await apiRequest("PUT", `/api/tpms/techs/${data.techId}/addresses/${data.index}`, data.address);
    },
    onSuccess: () => {
      toast({ title: "Address updated", description: "Shipping address updated and synced to TPMS." });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      setEditDialog(null);
      setSearchTriggered(false);
      setTimeout(() => setSearchTriggered(true), 100);
    },
    onError: (err: any) => {
      toast({ title: "Edit failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (data: { techId: string; index: number }) => {
      await apiRequest("DELETE", `/api/tpms/techs/${data.techId}/addresses/${data.index}`);
    },
    onSuccess: () => {
      toast({ title: "Address removed", description: "Shipping address removed and synced to TPMS." });
      queryClient.invalidateQueries({ queryKey: ["/api/tpms/techs"] });
      setSearchTriggered(false);
      setTimeout(() => setSearchTriggered(true), 100);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSearch = () => {
    setTechResults([]);
    setSearchTriggered(true);
  };

  const resetAll = () => {
    setFlowType(null);
    setWizardStep("find");
    setDistrictNo("");
    setDistrictAddress(null);
    setStreetAddress("");
    setZipCode("");
    setSearchTriggered(false);
    setTechResults([]);
    setNewAddress({ addressType: "PRIMARY", shipToName: "", addrLine1: "", addrLine2: "", city: "", stateCd: "", zipCd: "" });
  };

  const toggleTechSelection = (idx: number) => {
    setTechResults(prev => prev.map((t, i) => i === idx ? { ...t, selected: !t.selected } : t));
  };

  const selectedTechs = techResults.filter(t => t.selected);

  if (searchQuery.data && techResults.length === 0 && searchQuery.data.length > 0) {
    setTechResults(searchQuery.data.map(t => ({ ...t, selected: false })));
  }

  const handleConfirm = () => {
    addMutation.mutate({ techs: selectedTechs, address: newAddress });
  };

  const openEditDialog = (techId: string, index: number, address: any) => {
    setEditingAddress({ ...address });
    setEditDialog({ techId, index, address });
  };

  const handleEditSave = () => {
    if (!editDialog || !editingAddress) return;
    editMutation.mutate({ techId: editDialog.techId, index: editDialog.index, address: editingAddress });
  };

  const handleDeleteAddress = (techId: string, index: number) => {
    if (!confirm("Remove this shipping address? This will also update TPMS.")) return;
    deleteMutation.mutate({ techId, index });
  };

  if (!flowType) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Shipping Addresses</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage technician shipping addresses</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setFlowType("district")}>
            <CardHeader className="text-center pb-2">
              <Building className="h-10 w-10 mx-auto text-primary mb-2" />
              <CardTitle className="text-lg">District Shipping Address</CardTitle>
              <CardDescription>Find techs by district and update addresses in bulk</CardDescription>
            </CardHeader>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setFlowType("non-district")}>
            <CardHeader className="text-center pb-2">
              <MapPin className="h-10 w-10 mx-auto text-primary mb-2" />
              <CardTitle className="text-lg">Non-District Shipping Address</CardTitle>
              <CardDescription>Find techs by specific address and update individually</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Shipping Addresses</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {flowType === "district" ? "District Address Flow" : "Non-District Address Flow"}
          </p>
        </div>
        <Button variant="outline" onClick={resetAll}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
      </div>

      <div className="flex items-center gap-4 mb-4">
        {["find", "change", "confirm"].map((step, idx) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
              wizardStep === step ? "bg-primary text-primary-foreground" :
              ["find", "change", "confirm"].indexOf(wizardStep) > idx ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
              "bg-muted text-muted-foreground"
            }`}>
              {["find", "change", "confirm"].indexOf(wizardStep) > idx ? <Check className="h-4 w-4" /> : idx + 1}
            </div>
            <span className="text-sm font-medium capitalize">{step === "find" ? "Find Technicians" : step === "change" ? "Change Address" : "Confirm Change"}</span>
            {idx < 2 && <ArrowRight className="h-4 w-4 text-muted-foreground mx-2" />}
          </div>
        ))}
      </div>

      {wizardStep === "find" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {flowType === "district" ? "Find Techs by District" : "Find Techs by Address"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {flowType === "district" ? (
              <div className="flex items-end gap-4">
                <div className="space-y-1.5 flex-1 max-w-xs">
                  <Label className="text-xs">District #</Label>
                  <Input value={districtNo} onChange={e => setDistrictNo(e.target.value)} placeholder="Enter district number" />
                </div>
                <Button onClick={handleSearch} disabled={!districtNo || searchQuery.isLoading}>
                  {searchQuery.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  GET DISTRICT ADDRESS
                </Button>
              </div>
            ) : (
              <div className="flex items-end gap-4">
                <div className="space-y-1.5 flex-1 max-w-sm">
                  <Label className="text-xs">Street Address 1</Label>
                  <Input value={streetAddress} onChange={e => setStreetAddress(e.target.value)} placeholder="Street address" />
                </div>
                <div className="space-y-1.5 w-32">
                  <Label className="text-xs">Zip Code</Label>
                  <Input value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="Zip" />
                </div>
                <Button onClick={handleSearch} disabled={(!streetAddress && !zipCode) || searchQuery.isLoading}>
                  {searchQuery.isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  FIND ADDRESS
                </Button>
                <Button variant="outline" onClick={resetAll}>
                  <RotateCcw className="h-4 w-4 mr-2" /> RESET
                </Button>
              </div>
            )}

            {techResults.length > 0 && (
              <div className="mt-4">
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={techResults.every(t => t.selected)}
                            onCheckedChange={(checked) => {
                              setTechResults(prev => prev.map(t => ({ ...t, selected: !!checked })));
                            }}
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>District-Tech ID</TableHead>
                        <TableHead>Enterprise ID</TableHead>
                        <TableHead>Current Address</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {techResults.map((tech, idx) => {
                        const primaryAddr = tech.shippingAddresses?.[0];
                        return (
                          <TableRow key={tech.techId}>
                            <TableCell>
                              <Checkbox
                                checked={tech.selected}
                                onCheckedChange={() => toggleTechSelection(idx)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{tech.lastName}, {tech.firstName}</TableCell>
                            <TableCell>{tech.districtNo}-{tech.techId}</TableCell>
                            <TableCell>{tech.enterpriseId}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                              {primaryAddr ? `${primaryAddr.addrLine1 || ""}, ${primaryAddr.city || ""} ${primaryAddr.stateCd || ""}` : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {primaryAddr && (
                                  <>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => openEditDialog(tech.techId, 0, primaryAddr)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-700"
                                      onClick={() => handleDeleteAddress(tech.techId, 0)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between mt-4">
                  <Badge variant="secondary">{selectedTechs.length} selected</Badge>
                  <Button disabled={selectedTechs.length === 0} onClick={() => setWizardStep("change")}>
                    Next: Add New Address <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {wizardStep === "change" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Shipping Address</CardTitle>
            <CardDescription>Enter the new address to apply to {selectedTechs.length} selected technician(s).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 max-w-2xl">
              <div className="space-y-1.5">
                <Label className="text-xs">Address Type</Label>
                <Input value={newAddress.addressType} onChange={e => setNewAddress(p => ({ ...p, addressType: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ship To Name</Label>
                <Input value={newAddress.shipToName} onChange={e => setNewAddress(p => ({ ...p, shipToName: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Address Line 1</Label>
                <Input value={newAddress.addrLine1} onChange={e => setNewAddress(p => ({ ...p, addrLine1: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Address Line 2</Label>
                <Input value={newAddress.addrLine2} onChange={e => setNewAddress(p => ({ ...p, addrLine2: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">City</Label>
                <Input value={newAddress.city} onChange={e => setNewAddress(p => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="flex gap-4">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">State</Label>
                  <Input value={newAddress.stateCd} onChange={e => setNewAddress(p => ({ ...p, stateCd: e.target.value }))} maxLength={2} />
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Zip Code</Label>
                  <Input value={newAddress.zipCd} onChange={e => setNewAddress(p => ({ ...p, zipCd: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setWizardStep("find")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={() => setWizardStep("confirm")} disabled={!newAddress.addrLine1}>
                Next: Confirm <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {wizardStep === "confirm" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Confirm Address Change</CardTitle>
            <CardDescription>Review and confirm the address change for {selectedTechs.length} technician(s).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 border rounded-md p-4">
              <h4 className="text-sm font-semibold mb-2">New Address</h4>
              <p className="text-sm">{newAddress.shipToName}</p>
              <p className="text-sm">{newAddress.addrLine1}</p>
              {newAddress.addrLine2 && <p className="text-sm">{newAddress.addrLine2}</p>}
              <p className="text-sm">{newAddress.city}, {newAddress.stateCd} {newAddress.zipCd}</p>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Affected Technicians ({selectedTechs.length})</h4>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Tech ID</TableHead>
                      <TableHead>Enterprise ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTechs.map(tech => (
                      <TableRow key={tech.techId}>
                        <TableCell>{tech.lastName}, {tech.firstName}</TableCell>
                        <TableCell>{tech.techId}</TableCell>
                        <TableCell>{tech.enterpriseId}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={() => setWizardStep("change")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={handleConfirm} disabled={addMutation.isPending}>
                {addMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                CONFIRM CHANGE
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editDialog} onOpenChange={(open) => { if (!open) setEditDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Shipping Address</DialogTitle>
          </DialogHeader>
          {editingAddress && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Address Type</Label>
                <Input value={editingAddress.addressType || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, addressType: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ship To Name</Label>
                <Input value={editingAddress.shipToName || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, shipToName: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Address Line 1</Label>
                <Input value={editingAddress.addrLine1 || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, addrLine1: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Address Line 2</Label>
                <Input value={editingAddress.addrLine2 || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, addrLine2: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">City</Label>
                <Input value={editingAddress.city || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="flex gap-4">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">State</Label>
                  <Input value={editingAddress.stateCd || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, stateCd: e.target.value }))} maxLength={2} />
                </div>
                <div className="space-y-1.5 flex-1">
                  <Label className="text-xs">Zip Code</Label>
                  <Input value={editingAddress.zipCd || ""} onChange={e => setEditingAddress((p: any) => ({ ...p, zipCd: e.target.value }))} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editMutation.isPending || !editingAddress?.addrLine1}>
              {editMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
