import type {
  ApplicationFlowData,
  ApplicationFlowLink,
  ApplicationFlowNode,
  ApplicationFlowNodeId,
} from "@/lib/application-flow";

// Deterministic left-to-right Sankey layout for the fixed flow vocabulary.
//
// - Node heights and ribbon widths are proportional to counts.
// - Each node's height is divided among its links proportionally, so every
//   ribbon attaches flush to the node edge (no gaps / misalignment). Where a
//   tiny node is floored to a minimum height the ribbon tapers slightly to stay
//   flush at both ends.
// - Vertical positions come from barycenter relaxation (d3-sankey style) while
//   keeping the fixed column order, which removes crossings and keeps the
//   progression spine on top.
// - Labels for every node are de-collided vertically with leader lines.

export type FlowLayoutNode = {
  node: ApplicationFlowNode;
  x: number;
  y: number;
  width: number;
  height: number;
  centerY: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end";
  /** Y on the node edge where a leader line should originate. */
  labelAnchorX: number;
  /** True when the label was nudged away from the node center to avoid overlap. */
  hasLeader: boolean;
};

export type FlowLayoutLink = {
  link: ApplicationFlowLink;
  /** Filled proportional ribbon (visual only). */
  ribbonPath: string;
  /**
   * Transparent pointer/click target. It is the ribbon shape itself (thin
   * flows are thickened a little for usability) so the clickable region spans
   * only this segment — source node edge to target node edge — and never bulges
   * past the endpoints or onto a neighbouring ribbon.
   */
  hitPath: string;
  /** Anchor point (chart px) used to position the tooltip on focus. */
  anchorX: number;
  anchorY: number;
};

export type FlowLayout = {
  width: number;
  height: number;
  nodes: FlowLayoutNode[];
  links: FlowLayoutLink[];
  nodeById: Map<ApplicationFlowNodeId, FlowLayoutNode>;
};

export type FlowLayoutOptions = {
  width: number;
  height: number;
  paddingX?: number;
  paddingY?: number;
  nodeWidth?: number;
  nodeGap?: number;
  minNodeHeight?: number;
  /** Thin ribbons are thickened to at least this for a usable click target. */
  minHitThickness?: number;
  labelSlot?: number;
};

export type FlowLayoutHeightOptions = {
  minHeight?: number;
  maxHeight?: number;
  paddingY?: number;
  nodeGap?: number;
  labelSlot?: number;
};

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

export function estimateFlowLayoutHeight(
  data: ApplicationFlowData,
  options: FlowLayoutHeightOptions = {}
): number {
  const minHeight = options.minHeight ?? 420;
  const maxHeight = options.maxHeight ?? 680;
  const paddingY = options.paddingY ?? 24;
  const nodeGap = options.nodeGap ?? 18;
  const labelSlot = options.labelSlot ?? 30;
  const skipLaneGap = Math.max(nodeGap * 2.5, labelSlot + 12);

  const nodeById = new Map<ApplicationFlowNodeId, ApplicationFlowNode>(
    data.nodes.map((node) => [node.id, node])
  );
  const columnOf = (id: ApplicationFlowNodeId) => nodeById.get(id)?.column ?? 0;
  const skipLinks = data.links.filter(
    (link) => columnOf(link.target) - columnOf(link.source) > 1
  );
  const topLaneTargetIds = new Set(skipLinks.map((link) => link.target));

  const groups = new Map<number, ApplicationFlowNode[]>();
  for (const node of data.nodes) getOrCreate(groups, node.column, () => []).push(node);

  const columnHeightNeeds = [...groups.entries()].map(([column, group]) => {
    const regularSlots = group.length * labelSlot;
    const ordinaryGaps = Math.max(0, group.length - 1) * nodeGap;
    const crossingReserve =
      skipLinks.filter(
        (link) => columnOf(link.source) < column && column < columnOf(link.target)
      ).length * (skipLaneGap + labelSlot);
    const topLaneCount = group.filter((node) => topLaneTargetIds.has(node.id)).length;
    const topLaneReserve = topLaneCount * (skipLaneGap + labelSlot);
    return paddingY * 2 + regularSlots + ordinaryGaps + crossingReserve + topLaneReserve;
  });

  const busiestBranchCount = Math.max(
    0,
    ...data.nodes.map(
      (node) =>
        data.links.filter((link) => link.source === node.id).length +
        data.links.filter((link) => link.target === node.id).length
    )
  );
  const branchDensityHeight = paddingY * 2 + busiestBranchCount * (labelSlot + nodeGap * 0.75);

  const skipComplexityHeight = minHeight + skipLinks.length * (skipLaneGap + labelSlot);
  const branchComplexityHeight =
    minHeight + Math.max(0, busiestBranchCount - 3) * (labelSlot + nodeGap);
  const desired = Math.max(
    minHeight,
    branchDensityHeight,
    skipComplexityHeight,
    branchComplexityHeight,
    ...columnHeightNeeds
  );
  return Math.min(maxHeight, Math.ceil(desired / 10) * 10);
}

// Tapered ribbon: smooth left→right band from (sx, sy0)/sThick to (tx, ty0)/tThick.
function ribbonPath(
  sx: number,
  sy0: number,
  sThick: number,
  tx: number,
  ty0: number,
  tThick: number
): string {
  const controlX = (sx + tx) / 2;
  const sy1 = sy0 + sThick;
  const ty1 = ty0 + tThick;
  return [
    `M${sx},${sy0}`,
    `C${controlX},${sy0} ${controlX},${ty0} ${tx},${ty0}`,
    `L${tx},${ty1}`,
    `C${controlX},${ty1} ${controlX},${sy1} ${sx},${sy1}`,
    "Z",
  ].join(" ");
}

export function buildFlowLayout(
  data: ApplicationFlowData,
  options: FlowLayoutOptions
): FlowLayout {
  const paddingX = options.paddingX ?? 18;
  const paddingY = options.paddingY ?? 24;
  const nodeWidth = options.nodeWidth ?? 12;
  const nodeGap = options.nodeGap ?? 18;
  const minNodeHeight = options.minNodeHeight ?? 5;
  const minHitThickness = options.minHitThickness ?? 7;
  const labelSlot = options.labelSlot ?? 30;
  const { width, height } = options;

  const plotTop = paddingY;
  const plotHeight = Math.max(40, height - paddingY * 2);
  const plotBottom = plotTop + plotHeight;

  const columns = [...new Set(data.nodes.map((node) => node.column))].sort((a, b) => a - b);
  const maxColumn = columns.length ? columns[columns.length - 1] : 0;

  const innerWidth = Math.max(1, width - paddingX * 2 - nodeWidth);
  const xForColumn = (column: number) =>
    paddingX + (maxColumn === 0 ? 0 : (column / maxColumn) * innerWidth);

  const groups = new Map<number, ApplicationFlowNode[]>();
  for (const node of data.nodes) getOrCreate(groups, node.column, () => []).push(node);
  for (const group of groups.values()) group.sort((a, b) => a.order - b.order);

  const inputNodeById = new Map<ApplicationFlowNodeId, ApplicationFlowNode>(
    data.nodes.map((node) => [node.id, node])
  );
  const columnOf = (id: ApplicationFlowNodeId) => inputNodeById.get(id)?.column ?? 0;
  const skipLinks = data.links.filter(
    (link) => columnOf(link.target) - columnOf(link.source) > 1
  );
  const topLaneTargetIds = new Set(skipLinks.map((link) => link.target));
  const skipLaneGap = Math.max(nodeGap * 2.5, labelSlot + 12);

  const skipLinksCrossingColumn = (column: number) =>
    skipLinks.filter((link) => columnOf(link.source) < column && column < columnOf(link.target));

  const topLaneCountForGroup = (group: ApplicationFlowNode[]) =>
    group.filter((node) => topLaneTargetIds.has(node.id)).length;

  const extraTopLaneGapForGroup = (group: ApplicationFlowNode[]) => {
    const topLaneCount = topLaneCountForGroup(group);
    const skipGapSlots = topLaneCount > 0 ? Math.min(topLaneCount, group.length - 1) : 0;
    return skipGapSlots * (skipLaneGap - nodeGap);
  };

  const orderedGroupForLayout = (group: ApplicationFlowNode[]) => {
    const topLane = group.filter((node) => topLaneTargetIds.has(node.id));
    if (topLane.length === 0) return group;
    const regular = group.filter((node) => !topLaneTargetIds.has(node.id));
    return [...topLane, ...regular];
  };

  const gapAfterIndex = (
    index: number,
    orderedLength: number,
    topLaneCount: number
  ) => {
    if (index >= orderedLength - 1) return 0;
    return topLaneCount > 0 && index < topLaneCount ? skipLaneGap : nodeGap;
  };

  // Shared value→pixel scale: largest scale at which every column still fits.
  let scale = Number.POSITIVE_INFINITY;
  for (const group of groups.values()) {
    const column = group[0]?.column;
    const crossingLinks = column === undefined ? [] : skipLinksCrossingColumn(column);
    const reservedTopValue = crossingLinks.reduce((total, link) => total + link.value, 0);
    const reservedTopGap = crossingLinks.length * skipLaneGap;
    const sum = group.reduce((total, node) => total + node.value, 0) + reservedTopValue;
    if (sum <= 0) continue;
    const available = Math.max(
      10,
      plotHeight -
        reservedTopGap -
        (group.length - 1) * nodeGap -
        extraTopLaneGapForGroup(group)
    );
    scale = Math.min(scale, available / sum);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = plotHeight / Math.max(1, data.totalCount);

  const heightOf = new Map<ApplicationFlowNodeId, number>();
  for (const node of data.nodes) {
    heightOf.set(node.id, Math.max(minNodeHeight, node.value * scale));
  }
  const valueOf = new Map<ApplicationFlowNodeId, number>(data.nodes.map((n) => [n.id, n.value]));

  const skipLaneReserveHeight = (column: number) =>
    skipLinksCrossingColumn(column).reduce(
      (total, link) => total + Math.max(minNodeHeight, link.value * scale) + skipLaneGap,
      0
    );

  const stackHeightForGroup = (group: ApplicationFlowNode[]) => {
    const ordered = orderedGroupForLayout(group);
    const topLaneCount = topLaneCountForGroup(group);
    return ordered.reduce((total, node, index) => {
      return (
        total +
        (heightOf.get(node.id) ?? 0) +
        gapAfterIndex(index, ordered.length, topLaneCount)
      );
    }, 0);
  };

  const outgoing = new Map<ApplicationFlowNodeId, ApplicationFlowLink[]>();
  const incoming = new Map<ApplicationFlowNodeId, ApplicationFlowLink[]>();
  for (const link of data.links) {
    getOrCreate(outgoing, link.source, () => []).push(link);
    getOrCreate(incoming, link.target, () => []).push(link);
  }

  // Initialize each column centered, then relax positions toward the barycenter
  // of each node's links (d3-sankey style) while preserving the fixed column
  // order. Each node settles at the weighted center of the ribbons that feed
  // it, so a multi-parent node like Interviews (fed by both Screened and a
  // direct Applications skip-link) reads as a clear merge and its incoming
  // ribbons visibly sum to its height.
  const topY = new Map<ApplicationFlowNodeId, number>();
  for (const group of groups.values()) {
    const column = group[0]?.column ?? 0;
    const reservedTop = skipLaneReserveHeight(column);
    const ordered = orderedGroupForLayout(group);
    const topLaneCount = topLaneCountForGroup(group);
    const stackHeight = stackHeightForGroup(group);
    let y = plotTop + reservedTop + Math.max(0, (plotHeight - reservedTop - stackHeight) / 2);
    for (const [index, node] of ordered.entries()) {
      topY.set(node.id, y);
      y += (heightOf.get(node.id) ?? 0) + gapAfterIndex(index, ordered.length, topLaneCount);
    }
  }

  const centerY = (id: ApplicationFlowNodeId) => (topY.get(id) ?? 0) + (heightOf.get(id) ?? 0) / 2;

  const resolveColumn = (group: ApplicationFlowNode[]) => {
    const column = group[0]?.column ?? 0;
    const ordered = orderedGroupForLayout(group);
    const topLaneCount = topLaneCountForGroup(group);
    let y = plotTop + skipLaneReserveHeight(column);
    for (const [index, node] of ordered.entries()) {
      if (index < topLaneCount) {
        topY.set(node.id, y);
      } else if ((topY.get(node.id) ?? 0) < y) {
        topY.set(node.id, y);
      }
      y =
        (topY.get(node.id) ?? 0) +
        (heightOf.get(node.id) ?? 0) +
        gapAfterIndex(index, ordered.length, topLaneCount);
    }
    let bottom = plotBottom;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const node = ordered[index];
      const h = heightOf.get(node.id) ?? 0;
      if ((topY.get(node.id) ?? 0) + h > bottom) topY.set(node.id, bottom - h);
      bottom =
        (topY.get(node.id) ?? 0) -
        (index > 0 ? gapAfterIndex(index - 1, ordered.length, topLaneCount) : 0);
    }
  };

  const alignToNeighbors = (
    node: ApplicationFlowNode,
    links: ApplicationFlowLink[] | undefined,
    other: (link: ApplicationFlowLink) => ApplicationFlowNodeId,
    alpha: number
  ) => {
    if (!links || links.length === 0) return;
    let weight = 0;
    let weighted = 0;
    for (const link of links) {
      weight += link.value;
      weighted += centerY(other(link)) * link.value;
    }
    if (weight <= 0) return;
    const delta = weighted / weight - centerY(node.id);
    topY.set(node.id, (topY.get(node.id) ?? 0) + delta * alpha);
  };

  let alpha = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    alpha *= 0.99;
    for (let ci = 1; ci < columns.length; ci += 1) {
      const group = groups.get(columns[ci]) ?? [];
      for (const node of group) alignToNeighbors(node, incoming.get(node.id), (l) => l.source, alpha);
      resolveColumn(group);
    }
    for (let ci = columns.length - 2; ci >= 0; ci -= 1) {
      const group = groups.get(columns[ci]) ?? [];
      for (const node of group) alignToNeighbors(node, outgoing.get(node.id), (l) => l.target, alpha);
      resolveColumn(group);
    }
  }

  // Band offsets: divide each node's height proportionally among its links so
  // ribbons fill the node edge flush.
  const sourceBand = new Map<string, { y: number; thick: number }>();
  const targetBand = new Map<string, { y: number; thick: number }>();
  for (const node of data.nodes) {
    const nodeHeight = heightOf.get(node.id) ?? 0;
    const nodeValue = valueOf.get(node.id) ?? 0;

    const outs = (outgoing.get(node.id) ?? []).slice().sort((a, b) => centerY(a.target) - centerY(b.target));
    let outOffset = topY.get(node.id) ?? 0;
    for (const link of outs) {
      const thick = nodeValue > 0 ? (link.value / nodeValue) * nodeHeight : 0;
      sourceBand.set(link.id, { y: outOffset, thick });
      outOffset += thick;
    }

    const ins = (incoming.get(node.id) ?? []).slice().sort((a, b) => {
      const skipRank = (link: ApplicationFlowLink) =>
        columnOf(link.target) - columnOf(link.source) > 1 ? 0 : 1;
      return skipRank(a) - skipRank(b) || centerY(a.source) - centerY(b.source);
    });
    let inOffset = topY.get(node.id) ?? 0;
    for (const link of ins) {
      const thick = nodeValue > 0 ? (link.value / nodeValue) * nodeHeight : 0;
      targetBand.set(link.id, { y: inOffset, thick });
      inOffset += thick;
    }
  }

  const nodeById = new Map<ApplicationFlowNodeId, FlowLayoutNode>();
  const layoutNodes: FlowLayoutNode[] = [];
  for (const [column, group] of groups) {
    const x = xForColumn(column);
    const onRight = !(column === maxColumn && maxColumn !== 0);
    for (const node of group) {
      const h = heightOf.get(node.id) ?? 0;
      const y = topY.get(node.id) ?? 0;
      const layoutNode: FlowLayoutNode = {
        node,
        x,
        y,
        width: nodeWidth,
        height: h,
        centerY: y + h / 2,
        labelX: onRight ? x + nodeWidth + 10 : x - 10,
        labelY: y + h / 2,
        labelAnchor: onRight ? "start" : "end",
        labelAnchorX: onRight ? x + nodeWidth : x,
        hasLeader: false,
      };
      nodeById.set(node.id, layoutNode);
      layoutNodes.push(layoutNode);
    }
  }

  // De-collide labels vertically per column, then mark which need leader lines.
  for (const [, group] of groups) {
    const items = group
      .map((node) => nodeById.get(node.id)!)
      .sort((a, b) => a.centerY - b.centerY);
    let last = plotTop - labelSlot;
    for (const item of items) {
      item.labelY = Math.max(item.centerY, last + labelSlot);
      last = item.labelY;
    }
    let limit = plotBottom;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].labelY > limit) items[index].labelY = limit;
      limit = items[index].labelY - labelSlot;
    }
    for (const item of items) {
      item.hasLeader = Math.abs(item.labelY - item.centerY) > 4;
    }
  }

  const layoutLinks: FlowLayoutLink[] = data.links.map((link) => {
    const source = nodeById.get(link.source)!;
    const target = nodeById.get(link.target)!;
    const src = sourceBand.get(link.id) ?? { y: source.y, thick: 0 };
    const tgt = targetBand.get(link.id) ?? { y: target.y, thick: 0 };
    const sx = source.x + source.width;
    const tx = target.x;
    const syMid = src.y + src.thick / 2;
    const tyMid = tgt.y + tgt.thick / 2;
    const sHit = Math.max(src.thick, minHitThickness);
    const tHit = Math.max(tgt.thick, minHitThickness);
    return {
      link,
      ribbonPath: ribbonPath(sx, src.y, src.thick, tx, tgt.y, tgt.thick),
      hitPath: ribbonPath(sx, syMid - sHit / 2, sHit, tx, tyMid - tHit / 2, tHit),
      anchorX: (sx + tx) / 2,
      anchorY: (syMid + tyMid) / 2,
    };
  });

  return { width, height, nodes: layoutNodes, links: layoutLinks, nodeById };
}
