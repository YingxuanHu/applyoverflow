"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type {
  ApplicationFlowData,
  ApplicationFlowNodeId,
  ApplicationFlowNodeKind,
} from "@/lib/application-flow";

import { buildFlowLayout, estimateFlowLayoutHeight } from "./application-flow-sankey-layout";

export type FlowSelection =
  | { type: "node"; id: ApplicationFlowNodeId }
  | { type: "link"; id: string };

type ApplicationFlowChartProps = {
  data: ApplicationFlowData;
  selected: FlowSelection | null;
  onSelect: (selection: FlowSelection) => void;
  height?: number;
};

// Calm, restrained palette. Links are tinted by the node they flow INTO, so the
// destination tells the story without needing a legend.
const KIND_COLOR: Record<ApplicationFlowNodeKind, string> = {
  root: "#6b8fd6", // muted blue
  waiting: "#8b93a5", // cool slate
  screen: "#2bb3a3", // teal
  interview: "#7c80de", // indigo / violet
  offer: "#46ad77", // green
  success: "#34a564", // green (accepted)
  rejection: "#db8985", // soft red
  closed: "#9aa0aa", // neutral gray
  declined: "#d2a85a", // muted amber
};

const DEFAULT_HEIGHT = 420;

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatCount(count: number): string {
  return `${count} ${count === 1 ? "application" : "applications"}`;
}

function selectionMatches(a: FlowSelection | null, b: FlowSelection | null): boolean {
  return Boolean(a && b && a.type === b.type && a.id === b.id);
}

export function ApplicationFlowChart({
  data,
  selected,
  onSelect,
  height,
}: ApplicationFlowChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [hovered, setHovered] = useState<FlowSelection | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setMeasuredWidth(entries[0]?.contentRect.width ?? element.clientWidth);
    });
    observer.observe(element);
    setMeasuredWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const maxColumn = useMemo(
    () => data.nodes.reduce((max, node) => Math.max(max, node.column), 0),
    [data.nodes]
  );

  const desiredWidth = Math.min(960, Math.max(360, 96 + maxColumn * 172 + 148));
  const svgWidth = Math.max(320, measuredWidth || desiredWidth);
  const chartHeight = height ?? estimateFlowLayoutHeight(data, { minHeight: DEFAULT_HEIGHT });

  const layout = useMemo(
    () => buildFlowLayout(data, { width: svgWidth, height: chartHeight }),
    [data, svgWidth, chartHeight]
  );

  const nodeKindById = useMemo(() => {
    const map = new Map<ApplicationFlowNodeId, ApplicationFlowNodeKind>();
    for (const node of data.nodes) map.set(node.id, node.kind);
    return map;
  }, [data.nodes]);

  const active = hovered ?? selected;
  const hasActive = Boolean(active);

  const { activeNodeIds, activeLinkIds } = useMemo(() => {
    const nodes = new Set<string>();
    const links = new Set<string>();
    if (active) {
      if (active.type === "node") {
        nodes.add(active.id);
        for (const link of data.links) {
          if (link.source === active.id || link.target === active.id) {
            links.add(link.id);
            nodes.add(link.source);
            nodes.add(link.target);
          }
        }
      } else {
        const link = data.links.find((item) => item.id === active.id);
        if (link) {
          links.add(link.id);
          nodes.add(link.source);
          nodes.add(link.target);
        }
      }
    }
    return { activeNodeIds: nodes, activeLinkIds: links };
  }, [active, data.links]);

  function updatePointer(event: { clientX: number; clientY: number }) {
    const rect = innerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function activate(target: FlowSelection, event: { clientX: number; clientY: number }) {
    setHovered(target);
    updatePointer(event);
  }

  function focusTarget(target: FlowSelection, anchorX: number, anchorY: number) {
    setHovered(target);
    setTooltipPos({ x: anchorX, y: anchorY });
  }

  function handleKey(event: KeyboardEvent, selection: FlowSelection) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(selection);
    }
  }

  const tooltip = hovered ? buildTooltip(data, hovered) : null;

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <div
        ref={innerRef}
        className="relative w-full"
        onPointerMove={(event) => {
          if (hovered) updatePointer(event);
        }}
      >
        <svg
          width={svgWidth}
          height={chartHeight}
          viewBox={`0 0 ${svgWidth} ${chartHeight}`}
          className="block"
          role="group"
          aria-label="Application flow diagram"
        >
          {/* Links (behind nodes) */}
          <g>
            {layout.links.map((layoutLink) => {
              const { link } = layoutLink;
              const selection: FlowSelection = { type: "link", id: link.id };
              const isActive = activeLinkIds.has(link.id);
              const isSelected = selectionMatches(selected, selection);
              const color = KIND_COLOR[nodeKindById.get(link.target) ?? "waiting"];
              const opacity = hasActive ? (isActive ? 0.85 : 0.08) : 0.42;
              return (
                <g key={link.id}>
                  <path
                    d={layoutLink.ribbonPath}
                    fill={color}
                    fillOpacity={opacity}
                    stroke={isSelected ? color : "none"}
                    strokeOpacity={isSelected ? 0.9 : 0}
                    strokeWidth={isSelected ? 1 : 0}
                    style={{ pointerEvents: "none", transition: "fill-opacity 120ms ease" }}
                  />
                  <path
                    d={layoutLink.hitPath}
                    fill="transparent"
                    style={{ pointerEvents: "fill", cursor: "pointer" }}
                    className="outline-none"
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Filter by ${link.pathLabel}, ${formatCount(link.count)}${
                      isSelected ? " (selected)" : ""
                    }`}
                    onPointerEnter={(event) => activate(selection, event)}
                    onPointerLeave={() => setHovered(null)}
                    onClick={() => onSelect(selection)}
                    onFocus={() => focusTarget(selection, layoutLink.anchorX, layoutLink.anchorY)}
                    onBlur={() => setHovered(null)}
                    onKeyDown={(event) => handleKey(event, selection)}
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {layout.nodes.map((layoutNode) => {
              const { node } = layoutNode;
              const selection: FlowSelection = { type: "node", id: node.id };
              const isActive = activeNodeIds.has(node.id);
              const isSelected = selectionMatches(selected, selection);
              const opacity = hasActive ? (isActive ? 1 : 0.3) : 1;
              return (
                <rect
                  key={node.id}
                  x={layoutNode.x}
                  y={layoutNode.y}
                  width={layoutNode.width}
                  height={layoutNode.height}
                  rx={Math.min(layoutNode.width / 2, 4)}
                  fill={KIND_COLOR[node.kind]}
                  opacity={opacity}
                  className={isSelected ? "stroke-foreground/45 outline-none" : "outline-none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                  style={{ cursor: "pointer", transition: "opacity 120ms ease" }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`Filter by ${node.label}, ${formatCount(node.count)}${
                    isSelected ? " (selected)" : ""
                  }`}
                  onPointerEnter={(event) => activate(selection, event)}
                  onPointerLeave={() => setHovered(null)}
                  onClick={() => onSelect(selection)}
                  onFocus={() =>
                    focusTarget(selection, layoutNode.labelAnchorX, layoutNode.centerY)
                  }
                  onBlur={() => setHovered(null)}
                  onKeyDown={(event) => handleKey(event, selection)}
                />
              );
            })}
          </g>

          {/* Labels for every node (above nodes, never intercept pointer) */}
          <g aria-hidden="true" style={{ pointerEvents: "none" }}>
            {layout.nodes.map((layoutNode) => {
              const { node } = layoutNode;
              const isRight = layoutNode.labelAnchor === "start";
              const opacity = hasActive ? (activeNodeIds.has(node.id) ? 1 : 0.3) : 1;
              const leaderEndX = isRight ? layoutNode.labelX - 4 : layoutNode.labelX + 4;
              return (
                <g key={node.id} opacity={opacity} style={{ transition: "opacity 120ms ease" }}>
                  {layoutNode.hasLeader ? (
                    <path
                      d={`M${layoutNode.labelAnchorX},${layoutNode.centerY} L${leaderEndX},${layoutNode.labelY}`}
                      className="stroke-muted-foreground"
                      strokeWidth={1}
                      fill="none"
                      opacity={0.4}
                    />
                  ) : null}
                  <text x={layoutNode.labelX} y={layoutNode.labelY} textAnchor={layoutNode.labelAnchor}>
                    <tspan
                      x={layoutNode.labelX}
                      dy="-0.15em"
                      className="fill-foreground"
                      style={{ fontWeight: 600, fontSize: 12 }}
                    >
                      {node.count}
                    </tspan>
                    <tspan
                      x={layoutNode.labelX}
                      dy="1.25em"
                      className="fill-muted-foreground"
                      style={{ fontSize: 11 }}
                    >
                      {node.label}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && tooltipPos ? (
          <FlowTooltip tooltip={tooltip} pos={tooltipPos} width={svgWidth} height={chartHeight} />
        ) : null}
      </div>
    </div>
  );
}

type TooltipContent = {
  title: string;
  count: number;
  lines: string[];
};

function buildTooltip(data: ApplicationFlowData, target: FlowSelection): TooltipContent | null {
  if (target.type === "node") {
    const node = data.nodes.find((item) => item.id === target.id);
    if (!node) return null;
    return {
      title: node.label,
      count: node.count,
      lines: [`${formatPercent(node.percentOfTotal)} of all applications`],
    };
  }
  const link = data.links.find((item) => item.id === target.id);
  if (!link) return null;
  const lines: string[] = [];
  if (link.source !== "applications") {
    lines.push(
      `${formatPercent(link.percentOfParent)} of ${link.sourceLabel.toLowerCase()} applications`
    );
  }
  lines.push(`${formatPercent(link.percentOfTotal)} of all applications`);
  return { title: link.pathLabel, count: link.count, lines };
}

function FlowTooltip({
  tooltip,
  pos,
  width,
  height,
}: {
  tooltip: TooltipContent;
  pos: { x: number; y: number };
  width: number;
  height: number;
}) {
  const flipX = pos.x > width * 0.62;
  const flipY = pos.y > height * 0.7;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[220px] rounded-[10px] border border-border/70 bg-popover/95 px-3 py-2 text-xs shadow-md backdrop-blur-sm"
      style={{
        left: pos.x + (flipX ? -12 : 12),
        top: pos.y + (flipY ? -12 : 14),
        transform: `${flipX ? "translateX(-100%)" : ""} ${flipY ? "translateY(-100%)" : ""}`.trim(),
      }}
    >
      <p className="font-semibold text-popover-foreground">{tooltip.title}</p>
      <p className="mt-0.5 text-popover-foreground">{formatCount(tooltip.count)}</p>
      {tooltip.lines.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}
