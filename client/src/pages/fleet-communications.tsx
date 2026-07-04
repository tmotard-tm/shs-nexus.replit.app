import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  Phone,
  Car,
  Truck,
  MapPin,
  X,
  Users,
  ListChecks,
  Loader2,
  Link2,
  ShieldAlert,
  Download,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Paperclip,
  Settings2,
  Trash2,
  Archive,
  RotateCcw,
  Pencil,
  AlertTriangle,
  Tag,
  ArrowLeft,
} from "lucide-react";

interface CategoryOpt {
  value: string;
  label: string;
}
interface CommsConfig {
  enabled: boolean;
  canManage: boolean;
  categories: CategoryOpt[];
  tokens: string[];
}
interface Thread {
  id: string;
  kind: "tech" | "unmatched";
  ldap: string | null;
  phoneDigits: string | null;
  contactName: string | null;
  district: string | null;
  truckNumber: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastCategory: string | null;
  unread: boolean;
  unreadCount: number;
  optedOut: boolean;
  archivedAt?: string | null;
  deletedAt?: string | null;
}
interface Message {
  id: string;
  category: string;
  direction: "inbound" | "outbound";
  contactRole: string;
  body: string;
  phone: string | null;
  status: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  senderName: string | null;
  createdAt: string | null;
}
interface Contact {
  ldap: string;
  name: string | null;
  district: string | null;
  truckNumber: string | null;
  phone: string | null;
  managerLdap: string | null;
  managerName: string | null;
  emplStatus: string | null;
}
interface Template {
  id: string;
  category: string;
  name: string;
  body: string;
}

function formatPhone(raw: string | null): string {
  const d = (raw || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return raw || "";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** apiRequest throws Error(`${status}: ${body}`); pull a 409 JSON body back out. */
function parseConflict(message?: string): any | null {
  if (!message) return null;
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(message);
  if (!m || m[1] !== "409") return null;
  try {
    return JSON.parse(m[2]);
  } catch {
    return null;
  }
}

function RentalBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1 py-0 border-amber-400 text-amber-600 dark:text-amber-400 flex items-center gap-0.5"
      data-testid="badge-rental"
    >
      <Car className="w-2.5 h-2.5" /> Rental
    </Badge>
  );
}

// Inbound MMS media is stored in Object Storage and served through the app's
// proxy (`/api/fs/comms/media/<key>`); outbound attachments are already full URLs.
function resolveMediaUrl(mediaUrl: string) {
  return mediaUrl.startsWith("http") ? mediaUrl : `/api/fs/comms/media/${mediaUrl}`;
}

// Full-size image lightbox: zoom, download, and open-in-new-tab for MMS images.
function ImageViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setZoom(1); }, [src]);

  const fit = zoom <= 1;

  const download = async () => {
    if (!src) return;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const base = src.split("?")[0].split("/").pop() || "image";
      a.download = /\.\w+$/.test(base) ? base : `${base}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(src, "_blank");
      toast({ title: "Opened image in a new tab", description: "Use your browser's Save Image to download." });
    }
  };

  return (
    <Dialog open={!!src} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 gap-0 overflow-hidden" data-testid="dialog-image-viewer">
        <DialogHeader className="flex-row items-center justify-between space-y-0 px-4 py-2.5 border-b">
          <DialogTitle className="text-sm">Image</DialogTitle>
          <div className="flex items-center gap-1 mr-6">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))} disabled={zoom <= 1} title="Zoom out" data-testid="button-zoom-out">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <button onClick={() => setZoom(1)} className="text-xs w-12 tabular-nums rounded px-1 py-1 hover-elevate" title="Reset zoom" data-testid="button-zoom-reset">
              {Math.round(zoom * 100)}%
            </button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(2)))} disabled={zoom >= 5} title="Zoom in" data-testid="button-zoom-in">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => src && window.open(src, "_blank")} title="Open in new tab" data-testid="button-open-newtab">
              <ExternalLink className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={download} title="Download" data-testid="button-download-image">
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="overflow-auto bg-black/90" style={{ maxHeight: "80vh" }}>
          {src && (
            <img
              src={src}
              alt="attachment full size"
              onClick={() => setZoom((z) => (z <= 1 ? 2 : 1))}
              className={`block ${fit ? "mx-auto cursor-zoom-in" : "cursor-zoom-out"}`}
              style={fit ? { maxWidth: "100%", maxHeight: "80vh" } : { width: `${zoom * 100}%`, maxWidth: "none" }}
              data-testid="img-viewer-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const AVATAR_GRADIENTS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
  "from-fuchsia-500 to-purple-600",
];
function commsInitials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function commsAvatarGradient(key: string) {
  let h = 0;
  const s = String(key || "?");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}
function CommsAvatar({ name, className = "", size = "md" }: { name: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-10 w-10 text-sm" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <div
      className={`${dims} rounded-full bg-gradient-to-br ${commsAvatarGradient(name)} text-white font-semibold flex items-center justify-center flex-shrink-0 shadow-sm ring-1 ring-black/5 ${className}`}
      aria-hidden
    >
      {commsInitials(name)}
    </div>
  );
}

export default function FleetCommunications() {
  const { toast } = useToast();
  const [category, setCategory] = useState<string>("all");
  // Deep link support: /fleet-communications?q=<ldap|truck> pre-filters the inbox
  // (used by the Registration/Decommissioning handoff "Thread" links).
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [districtFilter, setDistrictFilter] = useState("");
  const [inRentalOnly, setInRentalOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [scope, setScope] = useState<"active" | "archived">("active");
  const [body, setBody] = useState("");
  const [sendCategory, setSendCategory] = useState<string>("general_fleet");
  const [managerCc, setManagerCc] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; preview: string } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedLdaps, setSelectedLdaps] = useState<Set<string>>(new Set());
  const [presetLdaps, setPresetLdaps] = useState<string[]>([]);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: config } = useQuery<CommsConfig>({ queryKey: ["/api/fs/comms/config"] });
  const { data: health } = useQuery<any>({ queryKey: ["/api/fs/comms/health"], refetchInterval: 60000 });
  const { data: districtOptions = [] } = useQuery<string[]>({ queryKey: ["/api/fs/comms/threads/districts"] });

  // Techs currently in an open rental get a badge. Uses `scope=managed` so this
  // matches the Fleet Scope / Rental Ops "rentals open" list (fs_trucks) — the same
  // Enterprise + Holman-non-Enterprise de-dupe — instead of the broader membership
  // superset the default badge scope returns. Cached server-side, so cheap to poll.
  // Falls back to no badges if Snowflake is down.
  const { data: openRentalEids } = useQuery<{ enterpriseIds: string[] }>({
    queryKey: ["/api/rental-ops/open-enterprise-ids?scope=managed"],
    staleTime: 5 * 60 * 1000,
  });
  const openRentalEidSet = new Set<string>(
    (openRentalEids?.enterpriseIds || []).map((id) => id.toUpperCase()),
  );
  const isInRental = (t: { ldap: string | null }) =>
    !!t.ldap && openRentalEidSet.has(t.ldap.toUpperCase());

  const threadsKey = ["/api/fs/comms/threads", category, search, districtFilter, unreadOnly, scope] as const;
  const { data: threads = [], isLoading: threadsLoading } = useQuery<Thread[]>({
    queryKey: threadsKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      if (districtFilter.trim()) params.set("district", districtFilter.trim());
      if (unreadOnly) params.set("unread", "true");
      if (scope !== "active") params.set("scope", scope);
      // Fetch the full list (thread volume is small) so the client-side
      // "in a rental" filter below has every thread to work with.
      params.set("limit", "300");
      const res = await apiRequest("GET", `/api/fs/comms/threads?${params.toString()}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Client-side "in a rental" filter. Uses the exact same open-rental set that
  // drives the on-thread rental badge (isInRental), so the filter always matches
  // the badges the user sees. Thread volume is small and we fetch up to 300
  // above, so filtering the loaded list is complete (no pagination gap).
  const visibleThreads = inRentalOnly ? threads.filter(isInRental) : threads;

  const { data: detail } = useQuery<{ thread: Thread; messages: Message[]; pending: any[]; contact: Contact | null; hasMore?: boolean }>({
    queryKey: ["/api/fs/comms/threads", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/fs/comms/threads/${selectedId}?limit=50`);
      return res.json();
    },
    refetchInterval: 20000,
  });

  // Older-message pages fetched on demand (prepended above the latest page).
  const [olderMessages, setOlderMessages] = useState<Message[]>([]);
  const [moreOlder, setMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => {
    setOlderMessages([]);
    setMoreOlder(false);
  }, [selectedId]);

  // Always open a thread scrolled to the newest message so the team never has to
  // scroll down. Re-runs when the open thread changes or a new latest message
  // arrives; loading OLDER pages doesn't change the latest id, so it won't yank
  // the view back to the bottom while someone is reading history.
  const latestMsgId = detail?.messages?.length
    ? detail.messages[detail.messages.length - 1].id
    : null;
  useEffect(() => {
    if (!selectedId) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [selectedId, latestMsgId]);
  useEffect(() => {
    setMoreOlder(!!detail?.hasMore);
  }, [detail?.hasMore, selectedId]);

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/fs/comms/templates", sendCategory],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/fs/comms/templates?category=${sendCategory}`);
      return res.json();
    },
    enabled: !!selectedId || composeOpen,
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/fs/comms/threads/${id}/archive`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      setSelectedId(null);
      toast({ title: "Conversation archived", description: "Moved to the Archived tab — recoverable anytime." });
    },
    onError: (e: any) => toast({ title: "Archive failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/fs/comms/threads/${id}/restore`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      toast({ title: "Conversation restored", description: "Back in the active inbox." });
    },
    onError: (e: any) => toast({ title: "Restore failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const archiveUnmatchedMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/fs/comms/threads/archive-unmatched")).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      const n = d?.archived ?? 0;
      toast({ title: `Archived ${n} unmatched conversation${n === 1 ? "" : "s"}`, description: "Still viewable in the Archived tab." });
    },
    onError: (e: any) => toast({ title: "Bulk archive failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/fs/comms/threads/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] }),
  });

  useEffect(() => {
    if (selectedId) markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // WebSocket live refresh (shares the fleet-scope socket).
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/fs-ws`;
    let destroyed = false;
    let ws: WebSocket | null = null;
    let delay = 2000;
    const connect = () => {
      if (destroyed) return;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type === "comms_message" || d.type === "comms_inbox_update") {
            // Affected thread id arrives either as d.threadId (inbox update) or
            // inside the message payload (d.message.threadId).
            const affected = d.threadId ?? d.message?.threadId ?? null;
            queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
            if (affected && affected === selectedRef.current)
              queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads", selectedRef.current] });
          }
        } catch {
          /* ignore */
        }
      };
      ws.onopen = () => { delay = 2000; };
      ws.onclose = () => {
        if (!destroyed) { setTimeout(connect, delay); delay = Math.min(delay * 1.5, 30000); }
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { destroyed = true; ws?.close(); };
  }, []);

  const lastSendPayload = useRef<any>(null);
  const sendMut = useMutation({
    mutationFn: (payload: any) => {
      lastSendPayload.current = payload;
      return apiRequest("POST", "/api/fs/comms/send", payload);
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      setBody("");
      setAttachment(null);
      if (data.status === "queued") toast({ title: "Message queued", description: "Will send after quiet hours." });
      else if (data.status === "skipped") toast({ title: "Not sent", description: data.reason || "Skipped", variant: "destructive" });
      else toast({ title: "Message sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads", selectedId] });
    },
    onError: (err: any) => {
      const conflict = parseConflict(err?.message);
      if (conflict?.lifecycleWarning) {
        if (window.confirm(conflict.message || "This technician is off active duty. Send anyway?")) {
          sendMut.mutate({ ...(lastSendPayload.current || {}), confirmed: true });
        }
        return;
      }
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const toggleFlag = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("POST", "/api/fs/comms/config", { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/config"] }),
  });

  const recategorize = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      apiRequest("PATCH", `/api/fs/comms/messages/${id}/category`, { category }),
    onSuccess: () => {
      toast({ title: "Category updated" });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
    },
    onError: (e: any) => toast({ title: "Re-categorize failed", description: e.message, variant: "destructive" }),
  });

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAttach = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only images can be attached", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await apiRequest("POST", "/api/fs/comms/upload", { dataUrl });
      const data = await res.json();
      setAttachment({ url: data.url, preview: dataUrl });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const thread = detail?.thread;
  const messages = [...olderMessages, ...(detail?.messages ?? [])];
  // The thread's current number on file — used to flag any message that used a
  // different (e.g. older) number, so merged old-number texts stay labeled.
  const threadDigits = (thread?.phoneDigits || (detail?.contact?.phone || "").replace(/\D/g, "")).slice(-10);

  const loadOlder = async () => {
    const earliest = messages[0];
    if (!earliest || !selectedId || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const params = new URLSearchParams({ limit: "50", before: String(earliest.createdAt) });
      const res = await apiRequest("GET", `/api/fs/comms/threads/${selectedId}?${params.toString()}`);
      const data = await res.json();
      setOlderMessages((prev) => [...(data.messages ?? []), ...prev]);
      setMoreOlder(!!data.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSend = () => {
    if (!thread || (!body.trim() && !attachment)) return;
    sendMut.mutate({
      ldap: thread.ldap,
      phone: thread.ldap ? undefined : (detail?.contact?.phone ?? (thread.phoneDigits ? `+1${thread.phoneDigits}` : undefined)),
      category: sendCategory,
      body: body.trim(),
      mediaUrl: attachment ? [attachment.url] : undefined,
      managerCc,
    });
  };

  // ── Multi-select for bulk messaging ──
  // Only tech threads with an LDAP are selectable (bulk resolves recipients by
  // LDAP). Unmatched / phone-only threads can't be bulk-targeted.
  const selectableThreads = visibleThreads.filter((t) => t.kind === "tech" && !!t.ldap);
  const toggleSelect = (ldap: string) =>
    setSelectedLdaps((prev) => {
      const next = new Set(prev);
      if (next.has(ldap)) next.delete(ldap);
      else next.add(ldap);
      return next;
    });
  const allVisibleSelected =
    selectableThreads.length > 0 && selectableThreads.every((t) => selectedLdaps.has(t.ldap!));
  const toggleSelectAll = () =>
    setSelectedLdaps((prev) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      for (const t of selectableThreads) next.add(t.ldap!);
      return next;
    });
  const clearSelection = () => {
    setSelectedLdaps(new Set());
    setSelectMode(false);
  };
  const messageSelected = () => {
    if (selectedLdaps.size === 0) return;
    setPresetLdaps(Array.from(selectedLdaps));
    setBulkOpen(true);
  };

  // When opening a thread, default the send category to its last category.
  useEffect(() => {
    if (thread?.lastCategory) setSendCategory(thread.lastCategory);
  }, [thread?.id, thread?.lastCategory]);

  if (config && !config.enabled && !config.canManage) {
    return (
      <div className="min-h-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="h-16 w-16 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-7 h-7 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">Fleet Communications is not enabled yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fleet-comms min-h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/10">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Fleet Communications</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">One team inbox for every technician text.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {health && (
            <Badge variant={health.isStale ? "destructive" : "secondary"} className="text-xs">
              Contacts {health.isStale ? "stale" : "synced"}
              {health?.queue?.pending ? ` · ${health.queue.pending} queued` : ""}
            </Badge>
          )}
          {config && !config.enabled && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
              <ShieldAlert className="w-3 h-3 mr-1" /> Dark rollout (staff only)
            </Badge>
          )}
          {config?.canManage && (
            <div className="flex items-center gap-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 h-9 shadow-sm">
              <span className="text-slate-600 dark:text-slate-300">Enabled</span>
              <Switch
                checked={!!config.enabled}
                onCheckedChange={(v) => toggleFlag.mutate(v)}
                data-testid="switch-comms-enabled"
              />
            </div>
          )}
          {config?.canManage && (
            <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)} className="h-9 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm" data-testid="button-manage-templates">
              <Settings2 className="w-4 h-4 mr-1.5" /> Templates
            </Button>
          )}
          {config?.canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (window.confirm("Archive ALL current unmatched conversations? They stay fully viewable and recoverable in the Archived tab.")) {
                  archiveUnmatchedMutation.mutate();
                }
              }}
              disabled={archiveUnmatchedMutation.isPending}
              className="h-9 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
              data-testid="button-archive-unmatched"
            >
              <Archive className="w-4 h-4 mr-1.5" /> Archive unmatched
            </Button>
          )}
          <Button
            size="sm"
            variant={selectMode ? "default" : "outline"}
            onClick={() => {
              if (selectMode) setSelectedLdaps(new Set());
              setSelectMode((v) => !v);
            }}
            className={selectMode
              ? "h-9 bg-indigo-600 hover:bg-indigo-600 text-white border-0 shadow-sm"
              : "h-9 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"}
            data-testid="button-select-mode"
          >
            <ListChecks className="w-4 h-4 mr-1.5" /> {selectMode ? "Done" : "Select"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setPresetLdaps([]); setBulkOpen(true); }} className="h-9 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm" data-testid="button-bulk-send">
            <Users className="w-4 h-4 mr-1.5" /> Bulk
          </Button>
          <Button size="sm" onClick={() => setComposeOpen(true)} className="h-9 bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border-0 shadow-md shadow-indigo-500/25" data-testid="button-compose">
            <Plus className="w-4 h-4 mr-1.5" /> New
          </Button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm w-fit max-w-full">
        <button
          onClick={() => setCategory("all")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${category === "all" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
          data-testid="tab-all"
        >
          All
        </button>
        {config?.categories.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${category === c.value ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            data-testid={`tab-${c.value}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex h-[calc(100dvh-220px)] min-h-[420px] gap-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Thread list */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} w-full md:w-80 md:flex-shrink-0 border-r border-slate-200 dark:border-slate-800 flex-col bg-slate-50/70 dark:bg-slate-950/40`}>
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, LDAP, truck, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-thread-search"
              />
            </div>
            <div className="space-y-2">
              <Select
                value={districtFilter || "all"}
                onValueChange={(v) => setDistrictFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm w-full" data-testid="select-district-filter">
                  <SelectValue placeholder="All districts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All districts</SelectItem>
                  {districtOptions.map((d) => (
                    <SelectItem key={d} value={d}>
                      District {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setInRentalOnly((v) => !v)}
                  title="Show only technicians currently in an open rental (matches the rental badge)"
                  className={`px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${inRentalOnly ? "bg-emerald-600 text-white border-emerald-600 shadow-sm" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  data-testid="toggle-in-rental"
                >
                  In rental
                </button>
                <button
                  onClick={() => setUnreadOnly((v) => !v)}
                  className={`px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${unreadOnly ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  data-testid="toggle-unread-only"
                >
                  Unread
                </button>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden" data-testid="scope-selector">
                  {([
                    { v: "active" as const, label: "Active", title: "Active inbox" },
                    { v: "archived" as const, label: "Archived", title: "Hidden conversations — archived + techs terminated over 14 days ago (fully recoverable)" },
                  ]).map((s) => (
                    <button
                      key={s.v}
                      onClick={() => { setScope(s.v); setSelectedId(null); }}
                      title={s.title}
                      className={`px-2.5 h-8 text-xs font-medium transition-colors whitespace-nowrap ${scope === s.v ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                      data-testid={`scope-${s.v}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {selectMode && (
            <div className="px-3 py-2 border-b border-indigo-100 dark:border-indigo-500/20 bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-between gap-2" data-testid="bulk-selection-bar">
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{selectedLdaps.size} selected</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleSelectAll}
                  className="px-2 h-7 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  data-testid="button-select-all"
                >
                  {allVisibleSelected ? "Unselect all" : "Select all"}
                </button>
                <button
                  onClick={messageSelected}
                  disabled={selectedLdaps.size === 0}
                  className="px-2 h-7 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-1 shadow-sm transition-colors"
                  data-testid="button-message-selected"
                >
                  <Send className="w-3 h-3" /> Message
                </button>
                <button
                  onClick={clearSelection}
                  className="px-2 h-7 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  data-testid="button-clear-selection"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {threadsLoading ? (
              <div className="p-6 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
            ) : visibleThreads.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                <div className="h-12 w-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-5 h-5 text-slate-400" />
                </div>
                {inRentalOnly ? "No conversations for technicians in an open rental" : "No conversations"}
              </div>
            ) : (
              visibleThreads.map((t) => {
                const displayName = t.contactName || t.ldap || (t.phoneDigits ? `+1 ${t.phoneDigits}` : "Unknown");
                const active = selectedId === t.id;
                const unread = t.unreadCount > 0;
                return (
                <div
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`relative px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/60 cursor-pointer transition-colors ${active ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-slate-100/70 dark:hover:bg-slate-800/40"}`}
                  data-testid={`thread-${t.id}`}
                >
                  {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-r" />}
                  <div className="flex items-start gap-2.5">
                    {selectMode &&
                      (t.kind === "tech" && t.ldap ? (
                        <Checkbox
                          checked={selectedLdaps.has(t.ldap)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggleSelect(t.ldap!)}
                          className="mt-2.5 flex-shrink-0"
                          data-testid={`select-thread-${t.id}`}
                        />
                      ) : (
                        <div className="w-4 flex-shrink-0" />
                      ))}
                    <CommsAvatar name={displayName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-sm truncate ${unread ? "font-bold text-slate-900 dark:text-white" : "font-semibold text-slate-800 dark:text-slate-100"}`}>
                            {displayName}
                          </span>
                          {isInRental(t) && <RentalBadge />}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {unread && <Badge className="text-xs px-1.5 py-0 bg-indigo-600 hover:bg-indigo-600 text-white border-0">{t.unreadCount}</Badge>}
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{formatTime(t.lastMessageAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                        {t.contactName && t.ldap && <span className="font-mono">{t.ldap}</span>}
                        {t.truckNumber && !t.truckNumber.startsWith("ADHOC-") && <span className="flex items-center gap-0.5"><Truck className="w-3 h-3" />{t.truckNumber.replace(/^0+/, "")}</span>}
                        {t.district && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{t.district.replace(/^0+/, "")}</span>}
                        {t.kind === "unmatched" && <Badge variant="outline" className="text-xs px-1 py-0">unmatched</Badge>}
                        {t.optedOut && <Badge variant="destructive" className="text-xs px-1 py-0">opted out</Badge>}
                      </div>
                      <p className={`text-xs mt-1 truncate ${unread ? "text-slate-700 dark:text-slate-200 font-medium" : "text-slate-500 dark:text-slate-400"}`}>{t.lastMessagePreview}</p>
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>

        {/* Thread detail */}
        <div className={`${selectedId ? "flex" : "hidden md:flex"} flex-1 flex-col min-w-0 bg-white dark:bg-slate-900`}>
          {!thread ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="h-16 w-16 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Select a conversation</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Choose a technician from the list to view the thread.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="md:hidden -ml-1 mt-0.5 p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
                    aria-label="Back to conversations"
                    data-testid="button-back-to-list"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <CommsAvatar name={thread.contactName || thread.ldap || "Unknown"} size="lg" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-slate-900 dark:text-white">{thread.contactName || thread.ldap || "Unknown"}</span>
                      {thread.ldap && <Badge variant="secondary" className="text-xs">{thread.ldap}</Badge>}
                      {isInRental(thread) && <RentalBadge />}
                      {thread.optedOut && <Badge variant="destructive" className="text-xs">Opted out (STOP)</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                      {detail?.contact?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{detail.contact.phone}</span>}
                      {thread.truckNumber && !thread.truckNumber.startsWith("ADHOC-") && <span className="flex items-center gap-1"><Truck className="w-3 h-3" />{thread.truckNumber.replace(/^0+/, "")}</span>}
                      {thread.district && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />District {thread.district.replace(/^0+/, "")}</span>}
                      {detail?.contact?.managerName && <span className="flex items-center gap-1" data-testid="text-thread-manager">Lead: {detail.contact.managerName}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {(thread.archivedAt || thread.deletedAt) ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Restore conversation to the active inbox"
                      onClick={() => restoreMutation.mutate(thread.id)}
                      disabled={restoreMutation.isPending}
                      data-testid="button-restore-thread"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Archive conversation (hide from inbox, recoverable)"
                      onClick={() => archiveMutation.mutate(thread.id)}
                      disabled={archiveMutation.isPending}
                      data-testid="button-archive-thread"
                    >
                      <Archive className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Export conversation to CSV"
                    onClick={() => window.open(`/api/fs/comms/threads/${thread.id}/export`, "_blank")}
                    data-testid="button-export-thread"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setSelectedId(null)} data-testid="button-close-thread">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {thread.kind === "unmatched" && (
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <Link2 className="w-3.5 h-3.5" />
                  This number isn't linked to a technician yet.
                  <LinkThreadButton threadId={thread.id} />
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950/50">
                {moreOlder && (
                  <div className="text-center">
                    <button
                      onClick={loadOlder}
                      disabled={loadingOlder}
                      className="px-3 h-7 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                      data-testid="button-load-older"
                    >
                      {loadingOlder ? "Loading…" : "Load older messages"}
                    </button>
                  </div>
                )}
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">No messages yet.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`} data-testid={`message-${m.id}`}>
                      <div className={`max-w-[75%] px-3.5 py-2.5 text-sm shadow-sm ${m.direction === "outbound" ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-2xl rounded-br-md" : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-md"}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Select value={m.category} onValueChange={(v) => recategorize.mutate({ id: m.id, category: v })}>
                            <SelectTrigger
                              className="h-5 w-auto gap-1 border-0 bg-transparent px-1 py-0 text-[10px] opacity-80 hover:opacity-100 focus:ring-0 [&>svg]:h-3 [&>svg]:w-3"
                              data-testid={`select-recategorize-${m.id}`}
                            >
                              <Tag className="w-2.5 h-2.5" />
                              <span>
                                {config?.categories.find((c) => c.value === m.category)?.label || m.category}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {config?.categories.map((c) => (
                                <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {m.contactRole === "manager" && <Badge variant="outline" className="text-[10px] px-1 py-0">lead</Badge>}
                        </div>
                        {m.mediaUrl && m.mediaType?.startsWith("image/") && (
                          <img
                            src={resolveMediaUrl(m.mediaUrl)}
                            alt="attachment"
                            className="rounded max-w-full max-h-60 mb-1 cursor-zoom-in hover-elevate"
                            onClick={() => setViewerSrc(resolveMediaUrl(m.mediaUrl!))}
                            title="Click to view full size"
                            data-testid={`img-message-${m.id}`}
                          />
                        )}
                        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                        <div className="flex items-center gap-2 mt-1 text-[10px] opacity-70">
                          {m.direction === "outbound" && m.senderName && <span>{m.senderName}</span>}
                          <span>{formatTime(m.createdAt)}</span>
                          {(() => {
                            const md = (m.phone || "").replace(/\D/g, "").slice(-10);
                            return md && md !== threadDigits ? (
                              <span className="flex items-center gap-0.5" title="Sent to/from a different number than the one currently on file">
                                <Phone className="w-2.5 h-2.5" />{formatPhone(m.phone)}
                              </span>
                            ) : null;
                          })()}
                          {m.direction === "outbound" && m.status && <span>· {m.status}</span>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {(detail?.pending?.length ?? 0) > 0 && (
                  <div className="text-center text-xs text-slate-400 dark:text-slate-500">{detail!.pending.length} message(s) queued for later</div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2">
                {templates.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {templates.slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => setBody(t.body)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" data-testid={`template-${t.id}`}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={sendCategory} onValueChange={setSendCategory}>
                    <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-send-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {config?.categories.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={managerCc} onCheckedChange={(v) => setManagerCc(!!v)} data-testid="checkbox-manager-cc" />
                    CC Lead{detail?.contact?.managerName ? ` (${detail.contact.managerName})` : detail?.contact ? " (none on file)" : ""}
                  </label>
                </div>
                {attachment && (
                  <div className="relative inline-block" data-testid="attachment-preview">
                    <img src={attachment.preview} alt="attachment" className="max-h-24 rounded border" />
                    <button
                      onClick={() => setAttachment(null)}
                      className="absolute -top-1.5 -right-1.5 bg-background border rounded-full p-0.5 hover-elevate"
                      data-testid="button-remove-attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttach(f); }}
                    data-testid="input-attachment-file"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || thread.optedOut}
                    title="Attach image"
                    data-testid="button-attach"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </Button>
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder={thread.optedOut ? "This contact opted out — texting is blocked" : "Type a message..."}
                    disabled={thread.optedOut}
                    className="min-h-[44px] max-h-32 text-sm"
                    data-testid="input-message-body"
                  />
                  <Button onClick={handleSend} disabled={sendMut.isPending || (!body.trim() && !attachment) || thread.optedOut} className="bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border-0 shadow-md shadow-indigo-500/25" data-testid="button-send">
                    {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        categories={config?.categories ?? []}
        health={health}
        onSent={(threadId) => { if (threadId) setSelectedId(threadId); }}
      />
      <BulkDialog
        open={bulkOpen}
        onOpenChange={(v) => { setBulkOpen(v); if (!v) setPresetLdaps([]); }}
        categories={config?.categories ?? []}
        health={health}
        presetLdaps={presetLdaps}
        rentalLdaps={Array.from(openRentalEidSet)}
        onSent={() => { setSelectedLdaps(new Set()); setSelectMode(false); }}
      />
      {config?.canManage && (
        <TemplateAdminDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          categories={config?.categories ?? []}
          tokens={config?.tokens ?? []}
        />
      )}
      <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />
    </div>
  );
}

function LinkThreadButton({ threadId }: { threadId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/fs/comms/contacts", q],
    queryFn: async () => (await apiRequest("GET", `/api/fs/comms/contacts?search=${encodeURIComponent(q)}`)).json(),
    enabled: open,
  });
  const linkMut = useMutation({
    mutationFn: (ldap: string) => apiRequest("POST", `/api/fs/comms/threads/${threadId}/link`, { ldap }),
    onSuccess: () => {
      toast({ title: "Linked to technician" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
    },
    onError: (e: any) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });
  return (
    <>
      <Button size="sm" variant="outline" className="h-6 text-xs ml-auto" onClick={() => setOpen(true)} data-testid="button-link-thread">
        Link to tech
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link conversation to a technician</DialogTitle></DialogHeader>
          <Input placeholder="Search tech by name / LDAP / truck" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-link-search" />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {contacts.map((c) => (
              <button key={c.ldap} onClick={() => linkMut.mutate(c.ldap)} className="w-full text-left p-2 rounded border hover-elevate text-sm" data-testid={`link-contact-${c.ldap}`}>
                <span className="font-medium">{c.name || c.ldap}</span>
                <span className="text-muted-foreground text-xs ml-2">{c.ldap} · {c.truckNumber || "no truck"}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Employment-status flags surfaced on every contact row (source: roster
// EMPL_STATUS). A/L/P/S are the only values the contacts sync keeps; T
// (terminated) is included defensively. L/P/S techs are warned on individual
// sends and excluded from bulk sends, so flagging them in the picker lets the
// sender see status before choosing recipients.
const EMPL_STATUS_META: Record<string, { label: string; cls: string }> = {
  A: { label: "Active", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  L: { label: "Leave of Absence", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  P: { label: "Paid Leave", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  S: { label: "Suspended", cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400" },
  T: { label: "Terminated", cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400" },
};

function EmplStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const key = status.trim().toUpperCase();
  const meta = EMPL_STATUS_META[key];
  if (!meta) return null;
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${meta.cls}`}
      title={`Employment status: ${meta.label}`}
      data-testid={`empl-status-${key}`}
    >
      {meta.label}
    </span>
  );
}

// Shared recipient picker used by both New Message and Bulk message. Loads the
// FULL active-technician directory once when its dialog opens, then filters
// entirely client-side (name / LDAP / truck # / phone + district) so every tech
// is browsable and selectable without searching first. Selection is controlled
// by the parent so each dialog owns its own audience state.
function RecipientPicker({
  open,
  selected,
  onChange,
}: {
  open: boolean;
  selected: Map<string, Contact>;
  onChange: (next: Map<string, Contact>) => void;
}) {
  const [q, setQ] = useState("");
  const [districtFilter, setDistrictFilter] = useState("all");

  const { data: districtOptions = [] } = useQuery<string[]>({
    queryKey: ["/api/fs/comms/contacts/districts"],
    enabled: open,
  });

  const { data: allContacts = [], isFetching } = useQuery<Contact[]>({
    queryKey: ["/api/fs/comms/contacts", "picker-all"],
    queryFn: async () => (await apiRequest("GET", `/api/fs/comms/contacts?limit=2000`)).json(),
    enabled: open,
  });

  const canonNum = (s?: string | null) => (s || "").replace(/\D/g, "").replace(/^0+/, "");
  const districtParam = districtFilter !== "all" ? districtFilter : "";
  const contacts = useMemo(() => {
    const term = q.trim().toLowerCase();
    const termDigits = q.replace(/\D/g, "");
    const dc = districtParam ? canonNum(districtParam) : "";
    return allContacts.filter((c) => {
      if (dc && canonNum(c.district) !== dc) return false;
      if (term) {
        const hay = `${c.name || ""} ${c.ldap || ""} ${c.truckNumber || ""}`.toLowerCase();
        const phoneDigits = (c.phone || "").replace(/\D/g, "");
        if (!(hay.includes(term) || (!!termDigits && phoneDigits.includes(termDigits)))) return false;
      }
      return true;
    });
  }, [allContacts, q, districtParam]);

  const toggle = (c: Contact) => {
    const next = new Map(selected);
    if (next.has(c.ldap)) next.delete(c.ldap);
    else next.set(c.ldap, c);
    onChange(next);
  };
  const selectAllVisible = () => {
    const next = new Map(selected);
    for (const c of contacts) next.set(c.ldap, c);
    onChange(next);
  };

  const selectedList = Array.from(selected.values());
  const count = selectedList.length;

  return (
    <>
      <div className="flex gap-2">
        <Input placeholder="Search name, LDAP, truck #, or phone…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-picker-search" />
        <Select value={districtFilter} onValueChange={setDistrictFilter}>
          <SelectTrigger className="w-40 flex-shrink-0" data-testid="select-picker-district"><SelectValue placeholder="District" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All districts</SelectItem>
            {districtOptions.map((d) => <SelectItem key={d} value={d}>District {d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{isFetching && allContacts.length === 0 ? "Loading technicians…" : `${contacts.length} of ${allContacts.length} technician${allContacts.length === 1 ? "" : "s"}`}</span>
        <div className="flex gap-3">
          <button type="button" className="underline hover:no-underline disabled:opacity-40 disabled:no-underline" onClick={selectAllVisible} disabled={contacts.length === 0} data-testid="button-picker-select-all">Select all</button>
          <button type="button" className="underline hover:no-underline disabled:opacity-40 disabled:no-underline" onClick={() => onChange(new Map())} disabled={count === 0} data-testid="button-picker-clear">Clear</button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1 border rounded p-1">
        {isFetching && allContacts.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">Loading technicians…</div>
        ) : contacts.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">No technicians match.</div>
        ) : (
          contacts.slice(0, 200).map((c) => {
            const on = selected.has(c.ldap);
            return (
              <button
                type="button"
                key={c.ldap}
                onClick={() => toggle(c)}
                className={`w-full text-left p-2 rounded border text-sm flex items-start gap-2 ${on ? "border-primary bg-primary/5" : "hover-elevate"}`}
                data-testid={`picker-contact-${c.ldap}`}
              >
                <Checkbox checked={on} className="mt-0.5 pointer-events-none" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{c.name || c.ldap}</span>
                    <span className="text-muted-foreground text-xs font-normal shrink-0">{c.ldap}</span>
                    <EmplStatusBadge status={c.emplStatus} />
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(c.truckNumber || "no truck").replace(/^0+/, "")} · {c.district ? `Dist ${c.district.replace(/^0+/, "")}` : "no district"} · Lead: {c.managerName || "—"}
                  </div>
                </div>
              </button>
            );
          })
        )}
        {contacts.length > 200 && (
          <div className="text-xs text-muted-foreground p-2" data-testid="picker-more-hint">
            Showing first 200 of {contacts.length}. Refine your search (name, LDAP, truck #, or phone), pick a district, or use “Select all”.
          </div>
        )}
      </div>

      {count > 0 && (
        <div className="rounded border bg-muted/40 p-2 space-y-1" data-testid="picker-selected">
          <div className="text-xs font-medium">{count} recipient{count === 1 ? "" : "s"} selected</div>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {selectedList.slice(0, 50).map((c) => (
              <div key={c.ldap} className="flex items-center justify-between text-xs gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{c.name || c.ldap}</span>
                  <EmplStatusBadge status={c.emplStatus} />
                  <span className="text-muted-foreground truncate">→ Lead: {c.managerName || "none on file"}</span>
                </span>
                <button type="button" onClick={() => toggle(c)} className="text-muted-foreground hover:text-foreground shrink-0" data-testid={`picker-remove-${c.ldap}`}>✕</button>
              </div>
            ))}
            {count > 50 && <div className="text-xs text-muted-foreground">+ {count - 50} more selected</div>}
          </div>
        </div>
      )}
    </>
  );
}

function ComposeDialog({ open, onOpenChange, categories, health, onSent }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: CategoryOpt[];
  health?: { isStale?: boolean; lastSuccessAgeHours?: number | null } | null;
  onSent: (threadId?: string) => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());
  const [cat, setCat] = useState("general_fleet");
  const [body, setBody] = useState("");
  const [managerCc, setManagerCc] = useState(false);
  const [ackStale, setAckStale] = useState(false);
  const [recipientMode, setRecipientMode] = useState<"tech" | "phone">("tech");
  const [manualPhone, setManualPhone] = useState("");

  const reset = () => {
    setSelected(new Map());
    setBody(""); setManagerCc(false); setAckStale(false);
    setRecipientMode("tech"); setManualPhone("");
  };

  const selectedList = Array.from(selected.values());
  const count = selectedList.length;
  const withoutManager = selectedList.filter((c) => !c.managerName && !c.managerLdap).length;

  // Ad-hoc recipient: text a number not on the technician roster. Normalize to
  // E.164 because sendTwilioMessage passes `to` straight to Twilio.
  const phoneDigits = manualPhone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1"));
  const phoneE164 = phoneDigits.length === 10 ? `+1${phoneDigits}` : phoneDigits.length === 11 ? `+${phoneDigits}` : manualPhone.trim();

  const singleMut = useMutation({
    mutationFn: (confirmed?: boolean) =>
      apiRequest("POST", "/api/fs/comms/send", { ldap: selectedList[0]?.ldap, category: cat, body: body.trim(), managerCc, confirmed }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      toast({ title: data.status === "queued" ? "Queued" : "Sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      onOpenChange(false);
      reset();
      onSent(data.threadId);
    },
    onError: (e: any) => {
      const conflict = parseConflict(e?.message);
      if (conflict?.lifecycleWarning) {
        if (window.confirm(conflict.message || "This technician is off active duty. Send anyway?")) {
          singleMut.mutate(true);
        }
        return;
      }
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const bulkMut = useMutation({
    mutationFn: (confirmed: boolean) =>
      apiRequest("POST", "/api/fs/comms/bulk", {
        category: cat,
        body: body.trim(),
        managerCc,
        ldaps: selectedList.map((c) => c.ldap),
        filterDesc: `${count} hand-picked recipient${count === 1 ? "" : "s"}`,
        confirmed,
      }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      toast({ title: "Messages queued", description: `${data.queued ?? count} recipient(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      onOpenChange(false);
      reset();
      onSent();
    },
    onError: (e: any) => {
      const conflict = parseConflict(e?.message);
      if (conflict?.needsConfirmation) {
        const msg = conflict.message || `This will text ${conflict.recipients ?? count} recipient(s). Send now?`;
        if (window.confirm(msg)) bulkMut.mutate(true);
        return;
      }
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const phoneMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/fs/comms/send", { phone: phoneE164, category: cat, body: body.trim() }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      toast({ title: data.status === "queued" ? "Queued" : "Sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      onOpenChange(false);
      reset();
      onSent(data.threadId);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const sending = singleMut.isPending || bulkMut.isPending || phoneMut.isPending;
  const staleBlock = !!health?.isStale && count > 1 && !ackStale;
  const canSend = recipientMode === "phone"
    ? phoneValid && !!body.trim() && !sending
    : count > 0 && !!body.trim() && !sending && !staleBlock;

  const doSend = () => {
    if (recipientMode === "phone") phoneMut.mutate();
    else if (count === 1) singleMut.mutate(false);
    else bulkMut.mutate(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New message</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Recipient: pick from the technician roster, or text an arbitrary number */}
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            <button type="button" onClick={() => setRecipientMode("tech")} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${recipientMode === "tech" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid="button-recipient-mode-tech">Technician</button>
            <button type="button" onClick={() => setRecipientMode("phone")} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${recipientMode === "phone" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid="button-recipient-mode-phone">Phone number</button>
          </div>

          {recipientMode === "tech" ? (
            <RecipientPicker open={open} selected={selected} onChange={setSelected} />
          ) : (
            <div className="space-y-1">
              <Input type="tel" inputMode="tel" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="e.g. (704) 555-0123" data-testid="input-compose-phone" />
              {manualPhone.trim() !== "" && !phoneValid && (
                <div className="text-xs text-amber-600 dark:text-amber-500">Enter a 10-digit US number.</div>
              )}
              <div className="text-xs text-muted-foreground">Texts a number that is not on the technician roster. Replies land in the inbox as an unmatched thread.</div>
            </div>
          )}

          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger data-testid="select-compose-category"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message... (supports {name}, {truck}, {district}, {ldap}, {managerName})" data-testid="input-compose-body" />
          {recipientMode === "tech" && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={managerCc} onCheckedChange={(v) => setManagerCc(!!v)} data-testid="checkbox-compose-managercc" /> CC each technician's Lead
              </label>
              {managerCc && count > 0 && withoutManager > 0 && (
                <div className="text-xs text-amber-600 dark:text-amber-500">{withoutManager} selected recipient{withoutManager === 1 ? " has" : "s have"} no Lead on file — they won't get a CC.</div>
              )}
            </>
          )}

          {!!health?.isStale && count > 1 && (
            <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-2" data-testid="compose-stale-warning">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-500">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="text-xs">Contact data may be out of date{typeof health.lastSuccessAgeHours === "number" ? ` (synced ~${Math.round(health.lastSuccessAgeHours)}h ago)` : ""}. Recipients or phone numbers may have changed.</div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-500">
                <Checkbox checked={ackStale} onCheckedChange={(v) => setAckStale(!!v)} data-testid="checkbox-compose-ack-stale" />
                Send anyway despite possibly stale contact data
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doSend} disabled={!canSend} data-testid="button-compose-send">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : count > 1 ? `Send to ${count}` : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkEstimate {
  recipients: number;
  totalSegments: number;
  estimatedSeconds: number;
  needsConfirmation: boolean;
  matched: number;
  withPhone: number;
  missingPhone: number;
  unresolvedTrucks: string[];
  threshold: number;
}

function humanizeSeconds(s: number): string {
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function BulkDialog({ open, onOpenChange, categories, health, presetLdaps, rentalLdaps, onSent }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: CategoryOpt[];
  health?: any;
  presetLdaps?: string[];
  rentalLdaps?: string[];
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [cat, setCat] = useState("general_fleet");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"list" | "ldaps" | "trucks" | "district" | "rental">("ldaps");
  const [ldaps, setLdaps] = useState("");
  const [trucks, setTrucks] = useState("");
  const [district, setDistrict] = useState("");
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());
  const [managerCc, setManagerCc] = useState(false);
  const [estimate, setEstimate] = useState<BulkEstimate | null>(null);
  const [ackStale, setAckStale] = useState(false);

  const reset = () => { setBody(""); setLdaps(""); setTrucks(""); setDistrict(""); setSelected(new Map()); setEstimate(null); setAckStale(false); };

  // When opened from "Message selected", pre-seed the LDAP audience.
  useEffect(() => {
    if (open && presetLdaps && presetLdaps.length > 0) {
      setMode("ldaps");
      setLdaps(presetLdaps.join(", "));
      setEstimate(null);
    }
  }, [open, presetLdaps]);

  // Saved templates for the selected category. Picking one drops its raw body
  // (tokens intact) into the message field; the server renders {name}/{truck}/…
  // per recipient at send time (see renderForContacts in routes.ts).
  const { data: bulkTemplates = [] } = useQuery<Template[]>({
    queryKey: ["/api/fs/comms/templates", "bulk", cat],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/fs/comms/templates?category=${cat}`);
      return res.json();
    },
    enabled: open,
  });

  const buildPayload = (confirmed: boolean) => {
    const base: any = { category: cat, body: body.trim(), managerCc, confirmed };
    if (mode === "list") { base.ldaps = Array.from(selected.keys()); base.filterDesc = `${selected.size} hand-picked recipient${selected.size === 1 ? "" : "s"}`; }
    else if (mode === "ldaps") base.ldaps = ldaps.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    else if (mode === "trucks") base.truckNumbers = trucks.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    else if (mode === "rental") { base.ldaps = rentalLdaps ?? []; base.filterDesc = "technicians in an open rental"; }
    else base.filter = { district: district.trim() };
    return base;
  };

  const hasAudience =
    mode === "list" ? selected.size > 0
    : mode === "ldaps" ? !!ldaps.trim()
    : mode === "trucks" ? !!trucks.trim()
    : mode === "rental" ? (rentalLdaps?.length ?? 0) > 0
    : !!district.trim();

  const previewMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/fs/comms/bulk/preview", buildPayload(false)),
    onSuccess: async (res: any) => setEstimate(await res.json()),
    onError: (e: any) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const bulkMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/fs/comms/bulk", buildPayload(true)),
    onSuccess: async (res: any) => {
      const data = await res.json();
      toast({ title: "Bulk queued", description: `${data.queued} recipient(s)` });
      onOpenChange(false);
      reset();
      onSent?.();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Re-preview whenever the audience/body changes so the estimate stays fresh.
  const stale = !estimate;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk message</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger data-testid="select-bulk-category"><SelectValue /></SelectTrigger>
            <SelectContent>{categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>

          <div className="flex gap-1.5 flex-wrap">
            {([["list", "Pick from list"], ["ldaps", "LDAP list"], ["trucks", "Truck list"], ["district", "District"], ["rental", "In rental"]] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => { setMode(m); setEstimate(null); }}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${mode === m ? "bg-primary text-primary-foreground" : "bg-background hover-elevate"}`}
                data-testid={`bulk-mode-${m}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "list" && (
            <RecipientPicker open={open} selected={selected} onChange={(next) => { setSelected(next); setEstimate(null); }} />
          )}
          {mode === "ldaps" && (
            <Textarea value={ldaps} onChange={(e) => { setLdaps(e.target.value); setEstimate(null); }} placeholder="LDAP IDs (comma or space separated)" className="min-h-[60px]" data-testid="input-bulk-ldaps" />
          )}
          {mode === "trucks" && (
            <Textarea value={trucks} onChange={(e) => { setTrucks(e.target.value); setEstimate(null); }} placeholder="Truck numbers (comma or space separated) — resolved to assigned techs" className="min-h-[60px]" data-testid="input-bulk-trucks" />
          )}
          {mode === "district" && (
            <Input value={district} onChange={(e) => { setDistrict(e.target.value); setEstimate(null); }} placeholder="District number" data-testid="input-bulk-district" />
          )}
          {mode === "rental" && (
            <div className="text-sm text-slate-600 dark:text-slate-300 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2" data-testid="bulk-rental-info">
              {(rentalLdaps?.length ?? 0) > 0
                ? `Targets every technician currently in an open rental — ${rentalLdaps!.length} on the rental list. Only active, messageable techs are sent (preview shows the exact count).`
                : "No open-rental list is loaded right now (rental data may be unavailable). Try again shortly."}
            </div>
          )}

          {bulkTemplates.length > 0 ? (
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Start from a template</div>
              <div className="flex gap-1.5 flex-wrap">
                {bulkTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setBody(t.body); setEstimate(null); }}
                    className="text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    data-testid={`bulk-template-${t.id}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 dark:text-slate-500" data-testid="bulk-no-templates">
              No saved templates for this category yet — type your message below, or an admin can add templates from the Templates panel.
            </div>
          )}

          <Textarea value={body} onChange={(e) => { setBody(e.target.value); setEstimate(null); }} placeholder="Message (supports {name}, {truck}, {district}, {ldap}, {managerName})" data-testid="input-bulk-body" />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={managerCc} onCheckedChange={(v) => setManagerCc(!!v)} /> CC each technician's Lead
          </label>

          {health?.isStale && (
            <div className="rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm space-y-2" data-testid="bulk-stale-warning">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-500">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Contact data may be stale</div>
                  <div className="text-xs">
                    The contacts sync last succeeded
                    {typeof health.lastSuccessAgeHours === "number" ? ` ~${Math.round(health.lastSuccessAgeHours)}h ago` : " a while ago"}.
                    Recipients or phone numbers may be out of date.
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-500">
                <Checkbox checked={ackStale} onCheckedChange={(v) => setAckStale(!!v)} data-testid="checkbox-ack-stale" />
                Send anyway despite stale contact data
              </label>
            </div>
          )}

          {estimate && (
            <div className="rounded border bg-muted/40 p-3 text-sm space-y-1" data-testid="bulk-estimate">
              <div className="font-medium">{estimate.withPhone} recipient(s) will be texted</div>
              <div className="text-xs text-muted-foreground">
                {estimate.matched} matched · {estimate.missingPhone} missing phone (skipped)
                {estimate.unresolvedTrucks.length > 0 && ` · ${estimate.unresolvedTrucks.length} truck(s) unresolved`}
              </div>
              <div className="text-xs text-muted-foreground">
                {estimate.totalSegments} SMS segment(s) · est. send time ~{humanizeSeconds(estimate.estimatedSeconds)}
              </div>
              {estimate.needsConfirmation && (
                <div className="text-xs text-amber-600 font-medium pt-1">
                  Large send ({estimate.recipients} ≥ {estimate.threshold}). Review the numbers, then confirm.
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Cancel</Button>
          {stale ? (
            <Button
              onClick={() => previewMut.mutate()}
              disabled={!body.trim() || !hasAudience || previewMut.isPending}
              data-testid="button-bulk-preview"
            >
              {previewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview"}
            </Button>
          ) : (
            <Button
              onClick={() => bulkMut.mutate()}
              disabled={estimate!.withPhone === 0 || bulkMut.isPending || (health?.isStale && !ackStale)}
              data-testid="button-bulk-send-confirm"
            >
              {bulkMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : estimate!.needsConfirmation ? "Confirm & send" : "Send bulk"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateAdminDialog({ open, onOpenChange, categories, tokens }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: CategoryOpt[];
  tokens: string[];
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState(categories[0]?.value ?? "general_fleet");
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const listKey = ["/api/fs/comms/templates", "admin", category] as const;
  const { data: rows = [], isLoading } = useQuery<Template[]>({
    queryKey: listKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/fs/comms/templates?category=${category}`);
      return res.json();
    },
    enabled: open,
  });

  const resetForm = () => { setEditing(null); setName(""); setBody(""); };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/templates"] });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { category, name: name.trim(), body: body.trim() };
      return editing
        ? apiRequest("PATCH", `/api/fs/comms/templates/${editing.id}`, payload)
        : apiRequest("POST", "/api/fs/comms/templates", payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Template updated" : "Template created" });
      resetForm();
      invalidate();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fs/comms/templates/${id}`),
    onSuccess: () => {
      toast({ title: "Template deleted" });
      resetForm();
      invalidate();
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // Mirror the server's token parser (findUnknownTokens / TOKEN_RE in
  // server/fleet-comms/lib.ts): accept both {token} and {{token}} with optional
  // surrounding whitespace, letters-only token names, so the client precheck
  // exactly matches what the server will accept.
  const usedTokens = (() => {
    const re = /\{\{?\s*([a-zA-Z]+)\s*\}?\}/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) found.add(m[1]);
    return Array.from(found);
  })();
  const unknownTokens = usedTokens.filter((t) => !tokens.includes(t));

  const startEdit = (t: Template) => { setEditing(t); setName(t.name); setBody(t.body); setCategory(t.category); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manage templates</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Select value={category} onValueChange={(v) => { setCategory(v); resetForm(); }}>
              <SelectTrigger data-testid="select-template-admin-category"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
            <div className="border rounded max-h-72 overflow-y-auto divide-y">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No templates in this category.</div>
              ) : (
                rows.map((t) => (
                  <div key={t.id} className={`p-2 text-sm flex items-start gap-2 ${editing?.id === t.id ? "bg-muted" : ""}`} data-testid={`template-row-${t.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{t.body}</div>
                    </div>
                    <button onClick={() => startEdit(t)} className="p-1 rounded hover-elevate" title="Edit" data-testid={`button-edit-template-${t.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { if (window.confirm(`Delete template "${t.name}"?`)) deleteMut.mutate(t.id); }}
                      className="p-1 rounded hover-elevate text-destructive"
                      title="Delete"
                      data-testid={`button-delete-template-${t.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{editing ? "Edit template" : "New template"}</div>
            <Input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-template-name" />
            <Textarea placeholder="Message body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[120px]" data-testid="input-template-body" />
            {tokens.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Available tokens:{" "}
                {tokens.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBody((b) => `${b}{${t}}`)}
                    className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded border text-[10px] hover-elevate"
                    data-testid={`token-${t}`}
                  >
                    {`{${t}}`}
                  </button>
                ))}
              </div>
            )}
            {unknownTokens.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs text-destructive" data-testid="template-unknown-tokens">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>Unknown token(s): {unknownTokens.map((t) => `{${t}}`).join(", ")}</span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => saveMut.mutate()}
                disabled={!name.trim() || !body.trim() || unknownTokens.length > 0 || saveMut.isPending}
                data-testid="button-save-template"
              >
                {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? "Update" : "Create"}
              </Button>
              {editing && (
                <Button variant="outline" onClick={resetForm} data-testid="button-cancel-edit-template">Cancel</Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
