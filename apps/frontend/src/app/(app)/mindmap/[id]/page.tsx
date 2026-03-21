"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  applyNodeChanges,
  Background,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import {
  ArrowLeft,
  FileText,
  GitFork,
  Loader2,
  Mic,
  Minus,
  Move,
  Network,
  Plus,
  RefreshCw,
  ScanSearch,
  Video,
  WandSparkles,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGenerateMindmap,
  useMindmap,
  type MindmapGraphData,
} from "@/hooks/use-mindmap";

function getStatusBadge(status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null) {
  switch (status) {
    case "READY":
      return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "GENERATING":
      return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300";
    case "ERROR":
      return "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/15 dark:text-rose-300";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300";
  }
}

function getStatusLabel(status?: "PENDING" | "GENERATING" | "READY" | "ERROR" | null) {
  switch (status) {
    case "READY":
      return "Готово";
    case "GENERATING":
      return "Собираем карту";
    case "ERROR":
      return "Ошибка";
    default:
      return "В очереди";
  }
}

function getSourceIcon(sourceType: "FILE" | "AUDIO" | "VIDEO") {
  if (sourceType === "AUDIO") {
    return <Mic className="h-3.5 w-3.5" />;
  }

  if (sourceType === "VIDEO") {
    return <Video className="h-3.5 w-3.5" />;
  }

  return <FileText className="h-3.5 w-3.5" />;
}

function createFlow(graph?: MindmapGraphData | null): { nodes: Node[]; edges: Edge[] } {
  if (!graph?.nodes?.length) {
    return { nodes: [], edges: [] };
  }

  const rootNode = graph.nodes.find((node) => node.kind === "root");
  const branchNodes = graph.nodes.filter((node) => node.kind === "branch");
  const leafNodes = graph.nodes.filter((node) => node.kind === "leaf");
  const groups = branchNodes.map((branch, index) => ({
    branch,
    side: index % 2 === 0 ? "left" : "right",
    leaves: leafNodes
      .filter((leaf) => leaf.groupIndex === branch.groupIndex)
      .sort((left, right) => left.order - right.order),
  }));
  const leftGroups = groups.filter((group) => group.side === "left");
  const rightGroups = groups.filter((group) => group.side === "right");
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const leafSpacing = 136;
  const groupGap = 76;
  const branchX = 460;
  const leafX = 890;

  if (rootNode) {
    nodes.push({
      id: rootNode.id,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      data: {
        label: (
          <div className="w-[290px] rounded-[26px] border border-emerald-400/35 bg-linear-to-br from-emerald-500/15 via-primary/10 to-cyan-500/10 px-5 py-4 text-left shadow-[0_20px_70px_-30px_rgba(16,185,129,0.42)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5">
            <div className="mb-2 inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
              Центр карты
            </div>
            <p className="text-lg font-semibold text-slate-950 dark:text-white">{rootNode.label}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{rootNode.summary}</p>
          </div>
        ),
      },
      style: {
        border: "none",
        background: "transparent",
        padding: 0,
        width: 290,
      },
    });
  }

  const placeColumn = (
    columnGroups: typeof groups,
    side: "left" | "right",
  ) => {
    if (!columnGroups.length) {
      return;
    }

    const heights = columnGroups.map((group) =>
      Math.max(220, (Math.max(group.leaves.length, 1) - 1) * leafSpacing + 170),
    );
    const totalHeight =
      heights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, columnGroups.length - 1) * groupGap;
    let cursor = -totalHeight / 2;

    columnGroups.forEach((group, index) => {
      const groupHeight = heights[index];
      const branchY = cursor + groupHeight / 2;
      const currentBranchX = side === "left" ? -branchX : branchX;
      const currentLeafX = side === "left" ? -leafX : leafX;
      const sourcePosition = side === "left" ? Position.Left : Position.Right;
      const targetPosition = side === "left" ? Position.Right : Position.Left;
      const leafStartY =
        branchY - ((Math.max(group.leaves.length, 1) - 1) * leafSpacing) / 2;

      nodes.push({
        id: group.branch.id,
        position: { x: currentBranchX, y: branchY },
        sourcePosition,
        targetPosition,
        data: {
          label: (
            <div className="w-[290px] rounded-[22px] border border-slate-200 bg-white/95 px-4 py-3 text-left shadow-[0_16px_45px_-30px_rgba(15,23,42,0.55)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_55px_-34px_rgba(16,185,129,0.28)] dark:border-border dark:bg-card/95">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{group.branch.label}</p>
              <p className="mt-1.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{group.branch.summary}</p>
            </div>
          ),
        },
        style: {
          border: "none",
          background: "transparent",
          padding: 0,
          width: 290,
        },
      });

      edges.push({
        id: `edge-root-${group.branch.id}`,
        source: "root",
        target: group.branch.id,
        type: "smoothstep",
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
        },
        style: {
          stroke: "#22c55e",
          strokeWidth: 2.25,
        },
      });

      group.leaves.forEach((leaf, leafIndex) => {
        nodes.push({
          id: leaf.id,
          position: { x: currentLeafX, y: leafStartY + leafIndex * leafSpacing },
          sourcePosition,
          targetPosition,
          data: {
            label: (
              <div className="w-[255px] rounded-[20px] border border-slate-200/90 bg-slate-50/95 px-4 py-3 text-left shadow-[0_14px_40px_-34px_rgba(15,23,42,0.5)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-34px_rgba(20,184,166,0.28)] dark:border-border dark:bg-muted/30">
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{leaf.label}</p>
                <p className="mt-1.5 text-[11px] leading-5 text-slate-600 dark:text-slate-400">{leaf.summary}</p>
              </div>
            ),
          },
          style: {
            border: "none",
            background: "transparent",
            padding: 0,
            width: 255,
          },
        });

        edges.push({
          id: `edge-${group.branch.id}-${leaf.id}`,
          source: group.branch.id,
          target: leaf.id,
          type: "smoothstep",
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
          },
          style: {
            stroke: "#14b8a6",
            strokeWidth: 1.7,
          },
        });
      });

      cursor += groupHeight + groupGap;
    });
  };

  placeColumn(leftGroups, "left");
  placeColumn(rightGroups, "right");

  return { nodes, edges };
}

export default function MindmapWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useMindmap(id);
  const generateMindmap = useGenerateMindmap(id);
  const { resolvedTheme } = useTheme();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    const flow = createFlow(data?.mindmap?.data);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [data?.mindmap?.data]);

  useEffect(() => {
    if (!flowInstance || !nodes.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      void flowInstance.fitView({
        padding: 0.24,
        duration: 850,
      });
      window.setTimeout(() => {
        setZoomPercent(Math.round(flowInstance.getZoom() * 100));
      }, 240);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [flowInstance, nodes]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-full rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted-foreground">Карта знаний недоступна</div>;
  }

  const hasMap = nodes.length > 0;
  const isBusy =
    data.mindmap?.status === "PENDING" || data.mindmap?.status === "GENERATING";
  const canGenerate = data.readyDocuments.length > 0;
  const isDark = resolvedTheme === "dark";

  const handleNodesChange = (changes: NodeChange<Node>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  };

  const handleMoveEnd = (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoomPercent(Math.round(viewport.zoom * 100));
  };

  const zoomIn = () => {
    if (!flowInstance) return;
    void flowInstance.zoomIn({ duration: 220 });
    window.setTimeout(() => setZoomPercent(Math.round(flowInstance.getZoom() * 100)), 230);
  };

  const zoomOut = () => {
    if (!flowInstance) return;
    void flowInstance.zoomOut({ duration: 220 });
    window.setTimeout(() => setZoomPercent(Math.round(flowInstance.getZoom() * 100)), 230);
  };

  const fitMap = () => {
    if (!flowInstance) return;
    void flowInstance.fitView({ padding: 0.24, duration: 520 });
    window.setTimeout(() => setZoomPercent(Math.round(flowInstance.getZoom() * 100)), 540);
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 px-1">
        <div>
          <a
            href={`/workspace/${id}`}
            className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Вернуться к воркспейсу
          </a>
          <h1 className="font-[Syne] text-3xl font-bold">Карта знаний</h1>
          <p className="mt-1 text-sm text-muted-foreground">Воркспейс: {data.workspace.name}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`gap-2 ${getStatusBadge(data.mindmap?.status)}`}>
            <Network className="h-3.5 w-3.5" />
            {getStatusLabel(data.mindmap?.status)}
          </Badge>
          <Button
            onClick={() => generateMindmap.mutate()}
            disabled={!canGenerate || generateMindmap.isPending || isBusy}
          >
            {generateMindmap.isPending || isBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : hasMap ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <WandSparkles className="mr-2 h-4 w-4" />
            )}
            {hasMap ? "Пересобрать карту" : "Собрать карту"}
          </Button>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/80 bg-white/90 shadow-sm dark:bg-card dark:shadow-none">
        <CardHeader className="shrink-0 border-b border-border/70 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>
                {data.mindmap?.title || `Карта знаний: ${data.workspace.name}`}
              </CardTitle>
              <CardDescription className="mt-2">
                {hasMap
                  ? `Собрано по ${data.mindmap?.data.generatedFrom || data.readyDocuments.length} готовым источникам`
                  : "Соберите карту знаний по документам, аудио и видео текущего воркспейса."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.readyDocuments.slice(0, 5).map((document) => (
                <Badge key={document.id} variant="outline" className="gap-1.5">
                  {getSourceIcon(document.sourceType)}
                  <span className="max-w-40 truncate">{document.originalName}</span>
                </Badge>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
          {!canGenerate ? (
            <div className="flex h-full min-h-[420px] items-center justify-center p-8">
              <div className="max-w-md space-y-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
                  <GitFork className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold">Пока нет готовых материалов</h2>
                  <p className="text-sm text-muted-foreground">
                    Загрузите документы, аудио или видео в воркспейс и дождитесь обработки, чтобы построить mindmap.
                  </p>
                </div>
                <Button asChild>
                  <Link href={`/workspace/${id}`}>Перейти к загрузке</Link>
                </Button>
              </div>
            </div>
          ) : !hasMap && !isBusy ? (
            <div className="flex h-full min-h-[420px] items-center justify-center p-8">
              <div className="max-w-lg space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary">
                  <Network className="h-7 w-7" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold">Соберите первую карту знаний</h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    AI выделит главные темы, связи и подзоны по готовым источникам текущего воркспейса.
                  </p>
                </div>
                <Button
                  onClick={() => generateMindmap.mutate()}
                  disabled={generateMindmap.isPending}
                >
                  {generateMindmap.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-2 h-4 w-4" />
                  )}
                  Запустить генерацию
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              <div className="absolute left-5 top-5 z-10 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-background/90 backdrop-blur">
                  Обновлено{" "}
                  {data.mindmap?.updatedAt
                    ? formatDistanceToNow(new Date(data.mindmap.updatedAt), {
                        addSuffix: true,
                        locale: ru,
                      })
                    : "только что"}
                </Badge>
                <Badge variant="outline" className="bg-background/90 backdrop-blur">
                  {data.readyDocuments.length} источника в воркспейсе
                </Badge>
              </div>

              <ReactFlow
                nodes={nodes}
                edges={edges}
                onInit={setFlowInstance}
                onNodesChange={handleNodesChange}
                onMoveEnd={handleMoveEnd}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                zoomOnScroll
                zoomOnPinch
                panOnDrag
                panOnScroll={false}
                minZoom={0.35}
                maxZoom={2.2}
                fitView
                fitViewOptions={{ padding: 0.24, duration: 850 }}
                proOptions={{ hideAttribution: true }}
                className="h-full min-h-[620px]"
                colorMode={isDark ? "dark" : "light"}
              >
                <Background
                  gap={20}
                  size={1.15}
                  color={isDark ? "#18372b" : "#d4e7de"}
                />
              </ReactFlow>

              {hasMap && (
                <>
                  <div className="absolute bottom-5 left-5 z-10 flex flex-col gap-2">
                    <div className="overflow-hidden rounded-2xl border border-border bg-background/95 shadow-lg backdrop-blur">
                      <button
                        type="button"
                        onClick={zoomIn}
                        className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <div className="mx-2 h-px bg-border" />
                      <button
                        type="button"
                        onClick={zoomOut}
                        className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="mx-2 h-px bg-border" />
                      <button
                        type="button"
                        onClick={fitMap}
                        className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ScanSearch className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="rounded-xl border border-border bg-background/95 px-3 py-2 text-center text-xs font-medium shadow-lg backdrop-blur">
                      {zoomPercent}%
                    </div>
                  </div>

                  <div className="absolute bottom-5 right-5 z-10 rounded-2xl border border-border bg-background/95 px-3.5 py-2.5 text-xs text-muted-foreground shadow-lg backdrop-blur">
                    <div className="flex items-center gap-2">
                      <Move className="h-3.5 w-3.5" />
                      Колёсико мыши масштабирует, узлы можно перетаскивать
                    </div>
                  </div>
                </>
              )}

              {isBusy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-[2px]">
                  <div className="rounded-2xl border border-border bg-background/95 px-5 py-4 shadow-lg">
                    <div className="flex items-center gap-3 text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Собираем обновлённую карту знаний...
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
