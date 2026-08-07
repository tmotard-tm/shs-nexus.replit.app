import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, ExternalLink, Send, Search, Loader2, ArrowRight } from "lucide-react";

/**
 * Master Fleet Communications — transition handoff for the retired
 * Registration / Decommissioning conversation UIs.
 *
 * When the Communications module is switched ON, the old per-page SMS
 * conversation views are replaced by this panel, which provides the two
 * transition affordances called for in the spec:
 *   1. A deep link into the unified Fleet Communications inbox (optionally
 *      pre-filtered to a specific tech's thread via ?q=).
 *   2. 1-click, template-backed quick-send that posts a category-tagged SMS
 *      through the new module (same send pipeline as the inbox).
 *
 * It is only rendered behind the module feature flag, so the legacy UIs stay
 * live and untouched until cutover is verified.
 */

export interface HandoffRecord {
  truckNumber: string;
  ldap?: string | null;
  name?: string | null;
  phone?: string | null;
  district?: string | null;
}

interface CommsTemplate {
  id: string;
  name: string;
  body: string;
}

/** apiRequest throws Error(`${status}: ${body}`); pull a 409 JSON body back out. */
function parse409(message?: string): any | null {
  if (!message) return null;
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(message);
  if (!m || m[1] !== "409") return null;
  try {
    return JSON.parse(m[2]);
  } catch {
    return null;
  }
}

export function CommsHandoff({
  category,
  categoryLabel,
  records,
}: {
  category: string;
  categoryLabel: string;
  records: HandoffRecord[];
}) {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<HandoffRecord | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const seen = new Set<string>();
    const list = records.filter((r) => {
      const key = `${r.truckNumber}|${r.ldap ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (!q) return true;
      return (
        (r.truckNumber || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.ldap || "").toLowerCase().includes(q)
      );
    });
    return list.slice(0, 200);
  }, [records, search]);

  return (
    <div className="space-y-4" data-testid="comms-handoff">
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <MessageSquare className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Team texting has moved to Fleet Communications</div>
            <div className="text-muted-foreground">
              All {categoryLabel} conversations now live in one shared inbox per technician. Use the
              quick-send below or open the full inbox.
            </div>
          </div>
          <Link href="/fleet-communications">
            <Button variant="default" size="sm" data-testid="link-open-comms-inbox">
              Open Fleet Communications <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search truck #, tech name, or LDAP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-handoff-search"
        />
      </div>

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground p-4 text-center">No matching records.</div>
        )}
        {filtered.map((r) => {
          const canText = !!(r.ldap || r.phone);
          const focus = r.ldap || r.truckNumber;
          return (
            <div
              key={`${r.truckNumber}|${r.ldap ?? ""}`}
              className="flex items-center gap-3 p-2 rounded border text-sm"
              data-testid={`handoff-row-${r.truckNumber}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {r.name || r.ldap || "Unknown tech"}
                  <span className="text-muted-foreground text-xs ml-2">Truck {r.truckNumber}</span>
                </div>
                <div className="text-muted-foreground text-xs truncate">
                  {r.ldap || "no LDAP"}
                  {r.district ? ` · District ${r.district}` : ""}
                  {r.phone ? ` · ${r.phone}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!canText}
                onClick={() => setActive(r)}
                data-testid={`button-handoff-quicktext-${r.truckNumber}`}
              >
                <Send className="w-3.5 h-3.5 mr-1" /> Quick text
              </Button>
              <Link href={`/fleet-communications?q=${encodeURIComponent(focus)}`}>
                <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`link-handoff-thread-${r.truckNumber}`}>
                  Thread <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          );
        })}
      </div>

      <QuickSendDialog
        record={active}
        category={category}
        categoryLabel={categoryLabel}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

export function QuickSendDialog({
  record,
  category,
  categoryLabel,
  onClose,
}: {
  record: HandoffRecord | null;
  category: string;
  categoryLabel: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [managerCc, setManagerCc] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const lastPayload = useRef<any>(null);

  const open = !!record;

  const { data: templates = [] } = useQuery<CommsTemplate[]>({
    queryKey: ["/api/fs/comms/templates", category],
    queryFn: async () =>
      (await apiRequest("GET", `/api/fs/comms/templates?category=${category}`)).json(),
    enabled: open,
  });

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === id);
    if (!t || !record) return;
    // Light client-side token fill so the agent sees a ready message; the agent
    // can still edit before sending.
    const filled = t.body
      .replace(/\{\{?\s*(firstName|first_name)\s*\}?\}/gi, (record.name || "").split(" ")[0] || "")
      .replace(/\{\{?\s*(name|techName|tech_name)\s*\}?\}/gi, record.name || "")
      .replace(/\{\{?\s*(truck|truckNumber|truck_number)\s*\}?\}/gi, record.truckNumber || "")
      .replace(/\{\{?\s*(district)\s*\}?\}/gi, record.district || "");
    setBody(filled);
  };

  const sendMut = useMutation({
    mutationFn: (payload: any) => {
      lastPayload.current = payload;
      return apiRequest("POST", "/api/fs/comms/send", payload);
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      if (data.status !== "sent" && data.status !== "queued") {
        // Refused (HVAC gate / opt-out / no phone): keep the dialog + draft.
        toast({ title: data.status === "blocked" ? "Blocked — not sent" : "Not sent", description: data.reason || `Send returned status "${data.status}"`, variant: "destructive" });
        return;
      }
      toast({ title: data.status === "queued" ? "Queued (quiet hours)" : "Message sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      reset();
      onClose();
    },
    onError: (err: any) => {
      const conflict = parse409(err?.message);
      if (conflict?.lifecycleWarning) {
        if (window.confirm(conflict.message || "This technician is off active duty. Send anyway?")) {
          sendMut.mutate({ ...(lastPayload.current || {}), confirmed: true });
        }
        return;
      }
      toast({ title: "Failed to send", description: err?.message, variant: "destructive" });
    },
  });

  const reset = () => {
    setBody("");
    setManagerCc(false);
    setTemplateId("");
  };

  const submit = () => {
    if (!record || !body.trim()) return;
    sendMut.mutate({
      ldap: record.ldap || undefined,
      phone: record.ldap ? undefined : record.phone || undefined,
      category,
      body: body.trim(),
      managerCc,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick text — {categoryLabel}</DialogTitle>
        </DialogHeader>
        {record && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-2 rounded border text-sm">
              <span className="font-medium">{record.name || record.ldap || "Tech"}</span>
              <Badge variant="secondary" className="text-xs">Truck {record.truckNumber}</Badge>
              {record.ldap && <span className="text-muted-foreground text-xs">{record.ldap}</span>}
            </div>
            {templates.length > 0 && (
              <Select value={templateId} onValueChange={applyTemplate}>
                <SelectTrigger data-testid="select-handoff-template">
                  <SelectValue placeholder="Insert a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={String(t.id)} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message..."
              rows={4}
              data-testid="input-handoff-body"
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={managerCc} onCheckedChange={(v) => setManagerCc(!!v)} /> CC the technician's manager
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!record || !body.trim() || sendMut.isPending}
            data-testid="button-handoff-send"
          >
            {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
