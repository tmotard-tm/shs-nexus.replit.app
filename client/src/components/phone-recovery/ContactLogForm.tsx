import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Phone, Mail, MessageSquare, PackageCheck, Loader2 } from "lucide-react";

interface ContactLogFormProps {
  taskId: string;
  onSuccess?: () => void;
}

const CONTACT_METHODS = [
  { value: "Phone", icon: Phone },
  { value: "Email", icon: Mail },
  { value: "Text", icon: MessageSquare },
] as const;

const OUTCOMES = [
  "Reached",
  "Voicemail",
  "No Response",
  "Declined",
  "Wrong Number",
] as const;

export function ContactLogForm({ taskId, onSuccess }: ContactLogFormProps) {
  const { toast } = useToast();
  const [method, setMethod] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [shippingLabelSent, setShippingLabelSent] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");

  const contactMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/phone-recovery/${taskId}/contact`, {
        method,
        outcome,
        notes,
        shippingLabelSent,
        trackingNumber: shippingLabelSent ? trackingNumber : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue", taskId] });
      toast({ title: "Contact logged", description: "Contact attempt has been recorded." });
      setMethod("");
      setOutcome("");
      setShippingLabelSent(false);
      setTrackingNumber("");
      setNotes("");
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const receivedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/phone-recovery/${taskId}/received`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-queue", taskId] });
      toast({ title: "Phone received", description: "Phone marked as received. Stage moved to reprovisioning." });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const canSubmit = method && outcome;

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-lg border p-4 bg-white dark:bg-gray-900">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Log Contact Attempt
        </h3>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Contact Method</Label>
          <div className="flex gap-2">
            {CONTACT_METHODS.map(({ value, icon: Icon }) => (
              <Button
                key={value}
                type="button"
                variant={method === value ? "default" : "outline"}
                size="sm"
                onClick={() => setMethod(value)}
                className="flex items-center gap-2"
              >
                <Icon className="h-4 w-4" />
                {value}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Outcome</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger>
              <SelectValue placeholder="Select outcome..." />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="shippingLabel"
            checked={shippingLabelSent}
            onCheckedChange={(checked) => setShippingLabelSent(checked === true)}
          />
          <Label htmlFor="shippingLabel" className="text-sm cursor-pointer">
            Shipping label sent
          </Label>
        </div>

        {shippingLabelSent && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Tracking Number</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Enter tracking number..."
            />
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-sm font-medium">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional details about this contact attempt..."
            rows={3}
          />
        </div>

        <Button
          onClick={() => contactMutation.mutate()}
          disabled={!canSubmit || contactMutation.isPending}
          className="w-full"
        >
          {contactMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Log Contact"
          )}
        </Button>
      </div>

      <Button
        variant="outline"
        onClick={() => receivedMutation.mutate()}
        disabled={receivedMutation.isPending}
        className="w-full border-green-500 text-green-700 hover:bg-green-50 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-950"
      >
        {receivedMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <PackageCheck className="h-4 w-4 mr-2" />
            Mark Received
          </>
        )}
      </Button>
    </div>
  );
}
