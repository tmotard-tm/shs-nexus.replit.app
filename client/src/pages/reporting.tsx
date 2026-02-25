import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  Send,
  Loader2,
  BarChart3,
  Users,
  Clock,
  CheckCircle,
  TrendingUp,
  MessageSquare,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QueueSummary {
  module: string;
  label: string;
  total: number;
  new: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  completedToday: number;
  completedThisWeek: number;
  completedThisMonth: number;
  avgResolutionHours: number;
}

interface ReportData {
  generatedAt: string;
  queueSummary: QueueSummary[];
  activityByDay: Record<string, number>;
  activityByAction: Record<string, number>;
  userStats: {
    totalActive: number;
    totalInactive: number;
    byRole: Record<string, number>;
  };
  topAgents: { username: string; completed: number }[];
}

function renderInlineMarkdown(text: string, keyPrefix: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /(\*\*(.*?)\*\*|`(.*?)`)/g;
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b-${idx}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      parts.push(<code key={`${keyPrefix}-c-${idx}`} className="bg-muted px-1 rounded text-sm">{match[3]}</code>);
    }
    lastIndex = regex.lastIndex;
    idx++;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function MarkdownRenderer({ content }: { content: string }) {
  const renderMarkdown = (text: string) => {
    const lines = text.split("\n");
    const elements: JSX.Element[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeaders: string[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];

    const flushTable = () => {
      if (tableHeaders.length > 0) {
        elements.push(
          <div key={`table-${elements.length}`} className="overflow-x-auto my-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-border">
                  {tableHeaders.map((h, i) => (
                    <th key={i} className="text-left p-2 font-semibold text-foreground">{h.trim()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 hover:bg-muted/30">
                    {row.map((cell, ci) => (
                      <td key={ci} className="p-2 text-muted-foreground">{cell.trim()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      tableHeaders = [];
      tableRows = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("```")) {
        if (inCodeBlock) {
          elements.push(
            <pre key={`code-${elements.length}`} className="bg-muted rounded-md p-3 my-2 text-sm overflow-x-auto">
              <code>{codeLines.join("\n")}</code>
            </pre>
          );
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.includes("|") && line.trim().startsWith("|")) {
        const cells = line.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (!inTable) {
          tableHeaders = cells;
          inTable = true;
        } else if (cells.every(c => /^[-:\s]+$/.test(c))) {
          continue;
        } else {
          tableRows.push(cells);
        }
        continue;
      } else if (inTable) {
        flushTable();
      }

      if (line.startsWith("### ")) {
        elements.push(<h3 key={`h3-${i}`} className="font-semibold text-base mt-4 mb-2">{line.slice(4)}</h3>);
      } else if (line.startsWith("## ")) {
        elements.push(<h2 key={`h2-${i}`} className="font-bold text-lg mt-4 mb-2">{line.slice(3)}</h2>);
      } else if (line.startsWith("# ")) {
        elements.push(<h1 key={`h1-${i}`} className="font-bold text-xl mt-4 mb-2">{line.slice(2)}</h1>);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={`li-${i}`} className="ml-4 text-sm text-muted-foreground list-disc">{renderInlineMarkdown(line.slice(2), `li-${i}`)}</li>
        );
      } else if (/^\d+\.\s/.test(line)) {
        elements.push(
          <li key={`oli-${i}`} className="ml-4 text-sm text-muted-foreground list-decimal">{renderInlineMarkdown(line.replace(/^\d+\.\s/, ''), `oli-${i}`)}</li>
        );
      } else if (line.trim() === "") {
        elements.push(<div key={`br-${i}`} className="h-2" />);
      } else {
        elements.push(
          <p key={`p-${i}`} className="text-sm text-muted-foreground leading-relaxed">{renderInlineMarkdown(line, `p-${i}`)}</p>
        );
      }
    }

    if (inTable) flushTable();

    return elements;
  };

  return <div className="space-y-1">{renderMarkdown(content)}</div>;
}

const SUGGESTED_QUESTIONS = [
  "Give me a full fleet health report — vehicle dispositions, repairs, and key recovery status",
  "How many offboarded vehicles are still unresolved or missing?",
  "Break down the Holman fleet by make, fuel type, and state",
  "What's the current onboarding pipeline? How many new hires still need trucks?",
  "Show me storage location utilization across all facilities",
  "Which queues have the most backlog and what are the bottlenecks?",
];

export default function Reporting() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [aiProvider, setAiProvider] = useState<"openai" | "gemini">("openai");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reportQuery = useQuery<ReportData>({
    queryKey: ["/api/reports"],
    enabled: user?.role === "developer",
    refetchInterval: 5 * 60 * 1000,
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/reports/chat", {
        message,
        provider: aiProvider,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: data.reply, timestamp: new Date() },
      ]);
    },
    onError: (error: Error) => {
      let errorMsg = "Failed to get a response. Please try again.";
      try {
        const parsed = JSON.parse(error.message.substring(error.message.indexOf("{")));
        if (parsed.message) errorMsg = parsed.message;
      } catch {}
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: `Sorry, I encountered an error: ${errorMsg}`, timestamp: new Date() },
      ]);
    },
  });

  const handleSend = (text?: string) => {
    const msg = text || inputValue.trim();
    if (!msg || chatMutation.isPending) return;
    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: new Date() }]);
    setInputValue("");
    chatMutation.mutate(msg);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (user?.role !== "developer") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">Reports are only available to developers.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reportQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-muted-foreground">Loading report data...</p>
        </div>
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Error Loading Data</h2>
            <p className="text-muted-foreground mb-4">Failed to load report data. Please try again.</p>
            <Button onClick={() => reportQuery.refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = reportQuery.data;
  const totalTasks = data?.queueSummary?.reduce((sum, q) => sum + q.total, 0) || 0;
  const totalCompleted = data?.queueSummary?.reduce((sum, q) => sum + q.completed, 0) || 0;
  const totalInProgress = data?.queueSummary?.reduce((sum, q) => sum + q.in_progress, 0) || 0;
  const completedToday = data?.queueSummary?.reduce((sum, q) => sum + q.completedToday, 0) || 0;

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-h-screen">
      <div className="px-6 py-4 border-b bg-background/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Nexus AI Reports</h1>
              <p className="text-sm text-muted-foreground">Ask questions about your data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <Badge variant="outline" className="text-xs">
                Data as of {new Date(data.generatedAt).toLocaleTimeString()}
              </Badge>
            )}
            <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as "openai" | "gemini")}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI GPT-5</SelectItem>
                <SelectItem value="gemini">Gemini 2.5 Flash</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${reportQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-3 border-b shrink-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <CardContent className="p-3 flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-blue-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{totalTasks}</p>
                <p className="text-xs text-blue-600/70 dark:text-blue-400/70">Total Tasks</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <CardContent className="p-3 flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{totalInProgress}</p>
                <p className="text-xs text-amber-600/70 dark:text-amber-400/70">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
            <CardContent className="p-3 flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">{totalCompleted}</p>
                <p className="text-xs text-green-600/70 dark:text-green-400/70">Completed</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800">
            <CardContent className="p-3 flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-purple-600 shrink-0" />
              <div>
                <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{completedToday}</p>
                <p className="text-xs text-purple-600/70 dark:text-purple-400/70">Completed Today</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center space-y-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">What would you like to know?</h2>
              <p className="text-muted-foreground">
                I can analyze your task queues, user activity, productivity metrics, and more. Ask me anything about your Nexus data.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  className="justify-start text-left h-auto py-3 px-4 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => handleSend(q)}
                  disabled={chatMutation.isPending}
                >
                  <MessageSquare className="h-4 w-4 mr-2 shrink-0 text-blue-500" />
                  <span className="line-clamp-2">{q}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-muted border"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="flex items-start gap-2">
                  <Brain className="h-5 w-5 text-purple-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
              <p className={`text-xs mt-2 ${msg.role === "user" ? "text-blue-200" : "text-muted-foreground"}`}>
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-muted border rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-500" />
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Analyzing data...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="px-6 py-4 border-t bg-background/95 backdrop-blur-sm shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2 max-w-4xl mx-auto"
        >
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about your data... e.g., 'How many tasks were completed this week?'"
            disabled={chatMutation.isPending}
            className="flex-1"
            data-testid="report-chat-input"
          />
          <Button
            type="submit"
            disabled={!inputValue.trim() || chatMutation.isPending}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            data-testid="report-chat-send"
          >
            {chatMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Powered by {aiProvider === 'openai' ? 'OpenAI GPT-5' : 'Google Gemini 2.5 Flash'}. Responses are based on current application data.
        </p>
      </div>
    </div>
  );
}
