import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Send, Loader2, ArrowLeft, MessageSquare, ExternalLink, Search } from "lucide-react";

/**
 * Embedded, category-scoped view of the Master Fleet Communications inbox.
 *
 * Reads the SAME `fs_comms_*` data as /fleet-communications, filtered to a single
 * category, so the Registration / Decommissioning pages can VIEW and REPLY to their
 * conversations inline without a second source of truth. The conversations stay
 * rooted in the new module; this is just a second window onto the same feed.
 *
 * Starting a brand-new text to a truck that has no history is intentionally NOT
 * here — that stays on the CommsHandoff quick-text picker rendered below this,
 * since this feed only lists trucks that already have a conversation.
 */

interface FeedThread {
  id: string;
  kind: string;
  ldap: string | null;
  phoneDigits: string | null;
  contactName: string | null;
  truckNumber: string | null;
  district: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unread?: boolean;
  unreadCount?: number;
}
interface FeedMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  mediaUrl: string | null;
  senderName: string | null;
  status: string | null;
  createdAt: string | null;
}
interface FeedDetail {
  thread: FeedThread;
  messages: FeedMessage[];
  contact: { phone: string | null } | null;
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
  if (diffDays === 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Inbound MMS is served through the app proxy; outbound attachments are full URLs.
function resolveMediaUrl(mediaUrl: string) {
  return mediaUrl.startsWith("http") ? mediaUrl : `/api/fs/comms/media/${mediaUrl}`;
}
// apiRequest throws Error(`${status}: ${body}`); pull a 409 lifecycle body back out.
function parseConflict(message?: string): any | null {
  if (!message) return null;
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(message);
  if (!m || m[1] !== "409") return null;
  try { return JSON.parse(m[2]); } catch { return null; }
}
function threadName(t: FeedThread): string {
  return t.contactName || t.ldap || formatPhone(t.phoneDigits) || "Unknown";
}

export function CommsCategoryFeed({
  category,
  categoryLabel,
  initialSearch,
}: {
  category: string;
  categoryLabel: string;
  initialSearch?: string;
}) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastPayload = useRef<any>(null);

  const { data: threads = [], isLoading } = useQuery<FeedThread[]>({
    queryKey: ["/api/fs/comms/threads", category, search],
    queryFn: async () => {
      const params = new URLSearchParams({ category, limit: "300" });
      if (search.trim()) params.set("search", search.trim());
      return (await apiRequest("GET", `/api/fs/comms/threads?${params.toString()}`)).json();
    },
    refetchInterval: 30000,
  });

  const { data: detail } = useQuery<FeedDetail>({
    queryKey: ["/api/fs/comms/threads", selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await apiRequest("GET", `/api/fs/comms/threads/${selectedId}?limit=50`)).json(),
    refetchInterval: 20000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/fs/comms/threads/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] }),
  });
  useEffect(() => {
    if (selectedId) markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const messages = detail?.messages ?? [];
  const latestId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (selectedId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [selectedId, latestId]);

  const sendMut = useMutation({
    mutationFn: (payload: any) => {
      lastPayload.current = payload;
      return apiRequest("POST", "/api/fs/comms/send", payload);
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      // Success allow-list: only a real send/queue clears the draft. "blocked"
      // (HVAC gate) and "skipped" refusals keep it so the agent can adjust.
      if (data.status === "sent" || data.status === "queued") {
        setBody("");
        if (data.status === "queued") toast({ title: "Message queued", description: "Will send after quiet hours." });
        else toast({ title: "Message sent" });
      } else {
        toast({ title: data.status === "blocked" ? "Blocked — not sent" : "Not sent", description: data.reason || `Send returned status "${data.status}"`, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads"] });
      if (selectedId) queryClient.invalidateQueries({ queryKey: ["/api/fs/comms/threads", selectedId] });
    },
    onError: (err: any) => {
      const conflict = parseConflict(err?.message);
      if (conflict?.lifecycleWarning) {
        if (window.confirm(conflict.message || "This technician is off active duty. Send anyway?")) {
          sendMut.mutate({ ...(lastPayload.current || {}), confirmed: true });
        }
        return;
      }
      toast({ title: "Failed to send", description: err?.message, variant: "destructive" });
    },
  });

  const thread = detail?.thread;
  const handleSend = () => {
    if (!thread || !body.trim()) return;
    sendMut.mutate({
      ldap: thread.ldap ?? undefined,
      phone: thread.ldap ? undefined : (detail?.contact?.phone ?? (thread.phoneDigits ? `+1${thread.phoneDigits}` : undefined)),
      category,
      body: body.trim(),
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden" data-testid={`comms-feed-${category}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="w-4 h-4 text-indigo-600" />
          {categoryLabel} conversations
          <Badge variant="outline" className="ml-1 text-[10px]">{threads.length}</Badge>
        </div>
        <Link href={`/fleet-communications?category=${category}`}>
          <Button variant="ghost" size="sm" className="h-7 text-xs" data-testid="link-feed-open-full">
            Open full inbox <ExternalLink className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Link>
      </div>

      <div className="flex h-[calc(100dvh-360px)] min-h-[360px]">
        {/* Conversation list */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 border-r border-slate-200 dark:border-slate-800`}>
          <div className="p-2 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-8 h-9"
                placeholder="Search name, LDAP, truck, phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-feed-search"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
            ) : threads.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">No {categoryLabel.toLowerCase()} conversations yet.</div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${selectedId === t.id ? "bg-slate-100 dark:bg-slate-800" : ""}`}
                  data-testid={`feed-thread-${t.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-sm truncate ${t.unread ? "font-semibold" : "font-medium"}`}>{threadName(t)}</div>
                    <div className="text-[10px] text-slate-400 flex-shrink-0">{formatTime(t.lastMessageAt)}</div>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {t.truckNumber ? `Truck ${t.truckNumber}` : ""}{t.district ? ` · Dist ${t.district}` : ""}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{t.lastMessagePreview || ""}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation detail */}
        <div className={`${selectedId ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0`}>
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Select a conversation to view it.</div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
                <button className="md:hidden p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setSelectedId(null)} data-testid="button-feed-back">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{thread ? threadName(thread) : ""}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {thread?.ldap ? thread.ldap : formatPhone(thread?.phoneDigits ?? null)}
                    {thread?.truckNumber ? ` · Truck ${thread.truckNumber}` : ""}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 dark:bg-slate-950/40">
                {messages.length === 0 ? (
                  <div className="text-center text-sm text-slate-400 py-8">No messages in this conversation.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`} data-testid={`feed-message-${m.id}`}>
                      <div className={`max-w-[75%] px-3.5 py-2.5 text-sm shadow-sm ${m.direction === "outbound" ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-2xl rounded-br-md" : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-md"}`}>
                        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                        {m.mediaUrl && (
                          <img
                            src={resolveMediaUrl(m.mediaUrl)}
                            alt="attachment"
                            onClick={() => window.open(resolveMediaUrl(m.mediaUrl!), "_blank")}
                            className="mt-1.5 max-h-48 rounded-lg cursor-zoom-in"
                          />
                        )}
                        <div className={`flex items-center gap-1.5 mt-1 text-[10px] ${m.direction === "outbound" ? "text-white/70" : "text-slate-400"}`}>
                          {m.direction === "outbound" && m.senderName && <span>{m.senderName}</span>}
                          <span>{formatTime(m.createdAt)}</span>
                          {m.direction === "outbound" && m.status && <span>· {m.status}</span>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 flex items-end gap-2">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={`Reply — sends as ${categoryLabel}`}
                  className="min-h-[40px] max-h-32 resize-none"
                  rows={1}
                  data-testid="input-feed-reply"
                />
                <Button onClick={handleSend} disabled={!body.trim() || sendMut.isPending} data-testid="button-feed-send">
                  {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
