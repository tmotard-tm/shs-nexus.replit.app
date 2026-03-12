import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  AlertTriangle,
  Calendar,
  MapPin,
  ChevronDown,
  ChevronUp,
  Phone,
  Truck,
  Clock,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RegMessage {
  id: string;
  truckNumber: string;
  techId: string | null;
  techPhone: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  twilioSid: string | null;
  sentAt: string | null;
  readAt: string | null;
  sentBy: string | null;
  senderName: string | null;
  autoTriggered: boolean;
  triggerType: string | null;
}

interface Conversation {
  truckNumber: string;
  techPhone: string;
  techId: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface TruckInfo {
  truckNumber: string;
  techName: string;
  techPhone: string;
  techLeadName: string;
  state: string;
  tagState: string;
  regExpDate: string;
  district: string;
  ldap: string;
  assignmentStatus: string;
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

function getDaysToExpiry(dateStr: string): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface RegConversationsProps {
  registrationData: TruckInfo[];
  initialTruckNumber?: string;
}

export function RegConversations({ registrationData, initialTruckNumber }: RegConversationsProps) {
  const { toast } = useToast();
  const [selectedTruck, setSelectedTruck] = useState<string | null>(initialTruckNumber ?? null);
  const [messageBody, setMessageBody] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvSearch, setNewConvSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // When a truck is deep-linked from the table, open that conversation
  useEffect(() => {
    if (initialTruckNumber) {
      setSelectedTruck(initialTruckNumber);
    }
  }, [initialTruckNumber]);

  // Fetch conversation list
  const { data: conversations = [], refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/fs/reg-conversations"],
    refetchInterval: 30000,
  });

  // Fetch messages for selected truck
  const { data: messages = [], refetch: refetchMessages } = useQuery<RegMessage[]>({
    queryKey: ["/api/fs/reg-messages", selectedTruck],
    enabled: !!selectedTruck,
    refetchInterval: 30000,
  });

  // Mark messages read when opening a conversation
  const markReadMutation = useMutation({
    mutationFn: (truckNumber: string) =>
      apiRequest("PATCH", `/api/fs/reg-messages/read/${truckNumber}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fs/reg-conversations"] });
    },
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest("POST", "/api/fs/reg-messages", {
        truckNumber: selectedTruck,
        techPhone: selectedTruckInfo?.techPhone,
        techId: selectedTruckInfo?.ldap,
        body,
        triggerType: "manual",
      }),
    onSuccess: (data: any) => {
      setMessageBody("");
      if (data?.scheduled) {
        toast({
          title: "Message Scheduled",
          description: data.message,
        });
      } else {
        toast({ title: "Message sent" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/fs/reg-messages", selectedTruck] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/reg-conversations"] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send message",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Get selected truck's full info from registration data
  const selectedTruckInfo = selectedTruck
    ? registrationData.find((t) => t.truckNumber === selectedTruck)
    : null;

  // Stable ref to selectedTruck so WS handler stays current without reconnecting
  const selectedTruckRef = useRef<string | null>(null);
  selectedTruckRef.current = selectedTruck;

  // WebSocket for real-time updates — connect once, reconnect with backoff
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/fs-ws`;
    let retryDelay = 2000;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "reg_message") {
            queryClient.invalidateQueries({ queryKey: ["/api/fs/reg-conversations"] });
            if (data.truckNumber === selectedTruckRef.current) {
              queryClient.invalidateQueries({ queryKey: ["/api/fs/reg-messages", selectedTruckRef.current] });
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      };

      ws.onopen = () => { retryDelay = 2000; };

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, 30000);
        }
      };

      ws.onerror = () => { ws.close(); };
    };

    connect();

    return () => {
      destroyed = true;
      wsRef.current?.close();
    };
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages read when selecting a truck
  useEffect(() => {
    if (selectedTruck) {
      markReadMutation.mutate(selectedTruck);
    }
  }, [selectedTruck]);

  const handleSelectTruck = (truckNumber: string) => {
    setSelectedTruck(truckNumber);
    setMessageBody("");
  };

  const handleSend = () => {
    const body = messageBody.trim();
    if (!body || !selectedTruck) return;
    sendMutation.mutate(body);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-trigger templates based on truck conditions
  const getTemplates = (info: TruckInfo) => {
    const templates: { label: string; icon: React.ReactNode; body: string; type: string }[] = [];
    const daysToExpiry = getDaysToExpiry(info.regExpDate);
    const name = info.techName?.split(" ")[0] || "Technician";

    if (daysToExpiry !== null && daysToExpiry <= 30) {
      const expiryStr = info.regExpDate
        ? new Date(info.regExpDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : "soon";
      templates.push({
        label: daysToExpiry < 0 ? "Registration Expired" : `Expiring in ${daysToExpiry} days`,
        icon: <Calendar className="w-3.5 h-3.5" />,
        type: "expiry",
        body: `Hi ${name}, your van #${info.truckNumber.replace(/^0+/, "")} registration expires on ${expiryStr}. Please contact us to schedule a renewal appointment at your earliest convenience. Thank you!`,
      });
    }

    if (info.tagState && info.state && info.tagState !== info.state) {
      templates.push({
        label: `State Mismatch: Tag ${info.tagState} / Tech ${info.state}`,
        icon: <MapPin className="w-3.5 h-3.5" />,
        type: "mismatch",
        body: `Hi ${name}, your van #${info.truckNumber.replace(/^0+/, "")} is registered in ${info.tagState} but you're located in ${info.state}. Please contact us so we can update your registration to the correct state. Thank you!`,
      });
    }

    return templates;
  };

  // Filter conversations by search
  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const info = registrationData.find((t) => t.truckNumber === c.truckNumber);
    return (
      c.truckNumber.includes(q) ||
      c.techPhone.includes(q) ||
      info?.techName?.toLowerCase().includes(q) ||
      false
    );
  });

  // Filter registration trucks for new conversation search
  const availableTrucks = registrationData.filter((t) => {
    if (!newConvSearch) return true;
    const q = newConvSearch.toLowerCase();
    return (
      t.truckNumber.includes(q) ||
      t.techName?.toLowerCase().includes(q) ||
      t.techPhone?.includes(q)
    );
  }).slice(0, 30);

  const templates = selectedTruckInfo ? getTemplates(selectedTruckInfo) : [];
  const daysToExpiry = selectedTruckInfo ? getDaysToExpiry(selectedTruckInfo.regExpDate) : null;
  const stateMismatch = selectedTruckInfo?.tagState && selectedTruckInfo?.state && selectedTruckInfo.tagState !== selectedTruckInfo.state;

  return (
    <div className="flex h-[calc(100vh-180px)] gap-0 border rounded-lg overflow-hidden">
      {/* Left panel — conversation list */}
      <div className="w-72 flex-shrink-0 border-r flex flex-col bg-muted/30">
        {/* Search + New */}
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-conv-search"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() => setNewConvOpen(true)}
            data-testid="button-new-conversation"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Conversation
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {conversations.length === 0
                ? "No conversations yet. Start one by clicking \"New Conversation\"."
                : "No matches found."}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const info = registrationData.find((t) => t.truckNumber === conv.truckNumber);
              const isSelected = selectedTruck === conv.truckNumber;
              return (
                <div
                  key={conv.truckNumber}
                  onClick={() => handleSelectTruck(conv.truckNumber)}
                  className={`p-3 border-b cursor-pointer transition-colors hover-elevate ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                  data-testid={`conv-item-${conv.truckNumber}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-sm font-semibold truncate">
                        {conv.truckNumber.replace(/^0+/, "") || conv.truckNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {conv.unreadCount > 0 && (
                        <Badge className="text-xs px-1.5 py-0" data-testid={`badge-unread-${conv.truckNumber}`}>
                          {conv.unreadCount}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    </div>
                  </div>
                  {info?.techName && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{info.techName}</p>
                  )}
                  <p className="text-xs text-foreground/70 mt-1 truncate leading-4">
                    {conv.lastMessage}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — conversation thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedTruck ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a conversation or start a new one</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="p-3 border-b bg-muted/20 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-base">
                      #{selectedTruck.replace(/^0+/, "") || selectedTruck}
                    </span>
                    {selectedTruckInfo?.assignmentStatus === "Unassigned" ? (
                      <Badge variant="secondary" className="text-xs">Unassigned</Badge>
                    ) : selectedTruckInfo?.techName ? (
                      <span className="text-sm text-muted-foreground">{selectedTruckInfo.techName}</span>
                    ) : null}
                    {stateMismatch && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        State Mismatch
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {selectedTruckInfo?.techPhone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {selectedTruckInfo.techPhone}
                      </span>
                    )}
                    {selectedTruckInfo?.tagState && (
                      <span className="text-xs text-muted-foreground">
                        Tag: <span className={stateMismatch ? "text-amber-600 font-medium" : ""}>{selectedTruckInfo.tagState}</span>
                      </span>
                    )}
                    {selectedTruckInfo?.state && (
                      <span className="text-xs text-muted-foreground">
                        Tech State: <span className={stateMismatch ? "text-amber-600 font-medium" : ""}>{selectedTruckInfo.state}</span>
                      </span>
                    )}
                    {selectedTruckInfo?.regExpDate && (
                      <span className={`text-xs flex items-center gap-1 ${daysToExpiry !== null && daysToExpiry <= 30 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                        <Calendar className="w-3 h-3" />
                        Exp: {selectedTruckInfo.regExpDate}
                        {daysToExpiry !== null && (
                          <span>({daysToExpiry < 0 ? `${Math.abs(daysToExpiry)}d overdue` : `${daysToExpiry}d`})</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSelectedTruck(null)}
                data-testid="button-close-conversation"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  No messages yet. Send the first message below.
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${msg.id}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        msg.direction === "outbound"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {msg.direction === "outbound" && msg.senderName && (
                        <p className="text-xs opacity-70 mb-1">{msg.senderName}</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                      <div className={`flex items-center gap-1 mt-1 ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                        <span className="text-xs opacity-60">
                          {formatTime(msg.sentAt)}
                        </span>
                        {msg.direction === "outbound" && (
                          <span className="text-xs opacity-60">
                            {msg.status === "failed" ? "· Failed" : msg.status === "delivered" ? "· Delivered" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Templates bar */}
            {templates.length > 0 && (
              <div className="border-t bg-muted/20">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowTemplates(!showTemplates)}
                  data-testid="button-toggle-templates"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    Quick message templates ({templates.length} condition{templates.length > 1 ? "s" : ""} detected)
                  </span>
                  {showTemplates ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
                {showTemplates && (
                  <div className="px-3 pb-2 space-y-1.5">
                    {templates.map((t, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-auto py-1 flex-shrink-0"
                          onClick={() => setMessageBody(t.body)}
                          data-testid={`button-template-${t.type}`}
                        >
                          <span className="flex items-center gap-1">
                            {t.icon}
                            {t.label}
                          </span>
                        </Button>
                        <p className="text-xs text-muted-foreground leading-4 pt-1 truncate">{t.body.slice(0, 80)}…</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unassigned notice */}
            {selectedTruckInfo?.assignmentStatus === "Unassigned" && (
              <div className="px-3 py-2 bg-muted/40 border-t text-xs text-muted-foreground text-center">
                No technician assigned to this truck — messaging not available.
              </div>
            )}

            {/* Input bar */}
            {selectedTruckInfo?.assignmentStatus !== "Unassigned" && (
              <div className="p-3 border-t flex gap-2 items-end">
                <Textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  className="min-h-[60px] max-h-[120px] resize-none text-sm"
                  data-testid="textarea-message-input"
                />
                <Button
                  onClick={handleSend}
                  disabled={!messageBody.trim() || sendMutation.isPending}
                  data-testid="button-send-message"
                >
                  {sendMutation.isPending ? (
                    <Clock className="w-4 h-4 animate-pulse" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* New Conversation Dialog */}
      <Dialog open={newConvOpen} onOpenChange={setNewConvOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by truck #, tech name, or phone..."
                value={newConvSearch}
                onChange={(e) => setNewConvSearch(e.target.value)}
                className="pl-8"
                autoFocus
                data-testid="input-new-conv-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {availableTrucks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No trucks found</p>
              ) : (
                availableTrucks.map((t) => (
                  <div
                    key={t.truckNumber}
                    onClick={() => {
                      handleSelectTruck(t.truckNumber);
                      setNewConvOpen(false);
                      setNewConvSearch("");
                    }}
                    className="flex items-center justify-between p-2.5 rounded-md cursor-pointer hover-elevate border"
                    data-testid={`new-conv-truck-${t.truckNumber}`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">
                          #{t.truckNumber.replace(/^0+/, "") || t.truckNumber}
                        </span>
                        {t.assignmentStatus === "Unassigned" ? (
                          <Badge variant="secondary" className="text-xs">Unassigned</Badge>
                        ) : null}
                      </div>
                      {t.techName && <p className="text-xs text-muted-foreground">{t.techName}</p>}
                    </div>
                    {t.techPhone && (
                      <span className="text-xs text-muted-foreground">{t.techPhone}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
