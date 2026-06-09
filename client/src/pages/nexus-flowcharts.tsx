import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  MarkerType,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "@dagrejs/dagre";
import { TopBar } from "@/components/layout/top-bar";
import { MainContent } from "@/components/layout/main-content";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, GitBranch } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  label: string;
  type: "terminal" | "decision" | "process";
  x: number;
  y: number;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface Diagram {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface FlowchartsResponse {
  diagrams: Diagram[];
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const DECISION_SIZE = 90;

// ── Dagre auto-layout ────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  nodes.forEach((n) => {
    const w = n.data?.nodeType === "decision" ? DECISION_SIZE : NODE_WIDTH;
    const h = n.data?.nodeType === "decision" ? DECISION_SIZE : NODE_HEIGHT;
    g.setNode(n.id, { width: w, height: h });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const { x, y } = g.node(n.id);
      const w = n.data?.nodeType === "decision" ? DECISION_SIZE : NODE_WIDTH;
      const h = n.data?.nodeType === "decision" ? DECISION_SIZE : NODE_HEIGHT;
      return { ...n, position: { x: x - w / 2, y: y - h / 2 } };
    }),
    edges,
  };
}

// ── Custom node renderers ─────────────────────────────────────────────────────

function TerminalNode({ data }: { data: any }) {
  const isStart = /^start$/i.test(String(data.label ?? ""));
  return (
    <div
      className={`px-4 py-2 rounded-full text-xs font-semibold text-white shadow flex items-center justify-center text-center ${
        isStart ? "bg-green-600 dark:bg-green-700" : "bg-red-500 dark:bg-red-600"
      }`}
      style={{ minWidth: 120, maxWidth: NODE_WIDTH, minHeight: 36 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      {data.label || "—"}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

function DecisionNode({ data }: { data: any }) {
  return (
    <div style={{ width: DECISION_SIZE, height: DECISION_SIZE, position: "relative" }}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ top: 0, left: "50%", transform: "translateX(-50%)" }}
        className="!bg-slate-400 !w-2 !h-2"
      />
      <div
        style={{
          width: DECISION_SIZE,
          height: DECISION_SIZE,
          transform: "rotate(45deg)",
          background: "#F59E0B",
          position: "absolute",
          top: 0,
          left: 0,
          borderRadius: 4,
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "#78350f",
          padding: 10,
          lineHeight: 1.2,
        }}
      >
        {data.label || "?"}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ bottom: 0, left: "50%", transform: "translateX(-50%)" }}
        className="!bg-slate-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        id="right"
        position={Position.Right}
        style={{ right: 0, top: "50%", transform: "translateY(-50%)" }}
        className="!bg-slate-400 !w-2 !h-2"
      />
    </div>
  );
}

function ProcessNode({ data }: { data: any }) {
  return (
    <div
      className="px-3 py-2 bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700 rounded text-xs text-blue-900 dark:text-blue-100 shadow text-center"
      style={{ minWidth: 140, maxWidth: NODE_WIDTH, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      {data.label || "—"}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

const NODE_TYPES = { terminal: TerminalNode, decision: DecisionNode, process: ProcessNode };

// ── Helpers to build React Flow nodes/edges from diagram data ─────────────────

function buildRFNodes(nodes: FlowNode[]): Node[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    data: { label: n.label, nodeType: n.type },
    style: n.type === "decision" ? { width: DECISION_SIZE, height: DECISION_SIZE } : { width: NODE_WIDTH },
  }));
}

function buildRFEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    labelStyle: { fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.85 },
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#94a3b8" },
  }));
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NexusFlowcharts() {
  const { data, isLoading, isError, error } = useQuery<FlowchartsResponse>({
    queryKey: ["/api/flowcharts"],
    staleTime: 5 * 60 * 1000,
  });

  const [activeTab, setActiveTab] = useState<string | null>(null);

  const diagrams = data?.diagrams ?? [];

  useEffect(() => {
    if (diagrams.length && !activeTab) {
      setActiveTab(diagrams[0].id);
    }
  }, [diagrams, activeTab]);

  const activeDiagram = diagrams.find((d) => d.id === activeTab) ?? null;

  const { nodes: rfNodes, edges: rfEdges } = useMemo(() => {
    if (!activeDiagram) return { nodes: [], edges: [] };
    const rawNodes = buildRFNodes(activeDiagram.nodes);
    const rawEdges = buildRFEdges(activeDiagram.edges);
    return applyDagreLayout(rawNodes, rawEdges);
  }, [activeDiagram]);

  return (
    <MainContent>
      <TopBar title="Nexus Flowcharts" breadcrumbs={["Home", "Flowcharts"]} />

      <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
        {/* Tab strip */}
        <div className="border-b bg-white dark:bg-gray-950 px-4 pt-2 flex-shrink-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex gap-2 pb-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-36 rounded" />
              ))}
            </div>
          ) : (
            <Tabs value={activeTab ?? ""} onValueChange={setActiveTab}>
              <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
                {diagrams.map((d) => (
                  <TabsTrigger
                    key={d.id}
                    value={d.id}
                    className="text-xs px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    {d.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center space-y-3">
                <GitBranch className="h-10 w-10 mx-auto text-muted-foreground animate-pulse" />
                <p className="text-muted-foreground text-sm">Loading flowcharts…</p>
              </div>
            </div>
          )}

          {isError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
                <p className="font-medium">Failed to load flowcharts</p>
                <p className="text-sm text-muted-foreground">
                  {(error as Error)?.message ?? "Unknown error"}
                </p>
              </div>
            </div>
          )}

          {!isLoading && !isError && activeDiagram && (
            <ReactFlow
              key={activeDiagram.id}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.15}
              maxZoom={2.5}
              className="bg-gray-50 dark:bg-gray-900"
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} color="#e2e8f0" />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(n) => {
                  const t = (n.data as any)?.nodeType;
                  if (t === "terminal")
                    return /^start$/i.test(String((n.data as any)?.label ?? "")) ? "#16a34a" : "#ef4444";
                  if (t === "decision") return "#f59e0b";
                  return "#93c5fd";
                }}
                className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700"
              />
            </ReactFlow>
          )}

          {!isLoading && !isError && !activeDiagram && data && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              Select a diagram above
            </div>
          )}
        </div>
      </div>
    </MainContent>
  );
}
