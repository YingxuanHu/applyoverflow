import type {
  TrackedApplicationEventType,
  TrackedApplicationStatus,
} from "@/generated/prisma/client";

// ───────────────────────────────────────────────────────────────────────────
// Application Flow
//
// Turns a user's tracked applications into a Sankey-style funnel: one root
// ("Applications") that branches into contextual outcome/stage nodes. Each
// application contributes to exactly one first-level branch, so the branches
// out of the root always sum to the total. Every node and link stores the set
// of application ids that flow through it, which powers click-to-filter.
// ───────────────────────────────────────────────────────────────────────────

export type ApplicationFlowRange = "all" | "30d" | "90d";

export type ApplicationFlowNodeId =
  | "applications"
  | "no_response"
  | "rejected_before_screen"
  | "closed_before_screen"
  | "screened"
  | "waiting_after_screen"
  | "rejected_after_screen"
  | "closed_after_screen"
  | "interviews"
  | "waiting_after_interview"
  | "no_offer"
  | "closed_after_interview"
  | "offers"
  | "offer_pending"
  | "accepted"
  | "declined"
  | "rejected_after_offer"
  | "closed_after_offer";

export type ApplicationFlowNodeKind =
  | "root"
  | "waiting"
  | "screen"
  | "interview"
  | "offer"
  | "success"
  | "rejection"
  | "closed"
  | "declined";

export type ApplicationFlowNode = {
  id: ApplicationFlowNodeId;
  label: string;
  count: number;
  value: number;
  kind: ApplicationFlowNodeKind;
  /** Deterministic left-to-right column (0 = root). */
  column: number;
  /** Vertical order within the column (lower = higher up). */
  order: number;
  /** Share of the total, 0..1. */
  percentOfTotal: number;
  applicationIds: string[];
};

export type ApplicationFlowLink = {
  /** `${source}:${target}` */
  id: string;
  source: ApplicationFlowNodeId;
  target: ApplicationFlowNodeId;
  value: number;
  count: number;
  applicationIds: string[];
  sourceLabel: string;
  targetLabel: string;
  /** e.g. "Applications → No response" */
  pathLabel: string;
  parentCount: number;
  totalCount: number;
  /** Share of the source node, 0..1. */
  percentOfParent: number;
  /** Share of the total, 0..1. */
  percentOfTotal: number;
};

// Re-exported so consumers (and tests) can build inputs without reaching into
// the generated Prisma client directly.
export type FlowApplicationStatus = TrackedApplicationStatus;
export type FlowApplicationEventType = TrackedApplicationEventType;

export type FlowApplicationEvent = {
  type: FlowApplicationEventType;
  timestamp: Date;
};

export type FlowApplication = {
  id: string;
  company: string;
  roleTitle: string;
  status: FlowApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  events: ReadonlyArray<FlowApplicationEvent>;
};

export type ApplicationFlowData = {
  nodes: ApplicationFlowNode[];
  links: ApplicationFlowLink[];
  /** Applications that contributed to the funnel (post exclusion + range). */
  applications: FlowApplication[];
  totalCount: number;
  range: ApplicationFlowRange;
};

// ── Internal normalized vocabulary ──────────────────────────────────────────

type FlowMilestone = "applied" | "screened" | "interview" | "offer";
type FlowOutcome = "accepted" | "declined" | "rejected" | "closed";
type FlowStatus = FlowMilestone | FlowOutcome;

const MILESTONE_RANK: Record<FlowMilestone, number> = {
  applied: 0,
  screened: 1,
  interview: 2,
  offer: 3,
};

type FlowNodeMeta = {
  label: string;
  kind: ApplicationFlowNodeKind;
  column: number;
  order: number;
};

// Single source of truth for labels, colors-by-kind, and deterministic layout.
const FLOW_NODE_META: Record<ApplicationFlowNodeId, FlowNodeMeta> = {
  applications: { label: "Applications", kind: "root", column: 0, order: 0 },

  screened: { label: "Screened", kind: "screen", column: 1, order: 0 },
  no_response: { label: "No response", kind: "waiting", column: 1, order: 1 },
  rejected_before_screen: { label: "Rejected", kind: "rejection", column: 1, order: 2 },
  closed_before_screen: { label: "Closed", kind: "closed", column: 1, order: 3 },

  interviews: { label: "Interviews", kind: "interview", column: 2, order: 0 },
  waiting_after_screen: { label: "Screen result pending", kind: "waiting", column: 2, order: 1 },
  rejected_after_screen: { label: "Rejected after screen", kind: "rejection", column: 2, order: 2 },
  closed_after_screen: { label: "Closed after screen", kind: "closed", column: 2, order: 3 },

  offers: { label: "Offers", kind: "offer", column: 3, order: 0 },
  waiting_after_interview: { label: "Interview result pending", kind: "waiting", column: 3, order: 1 },
  no_offer: { label: "No offer", kind: "rejection", column: 3, order: 2 },
  closed_after_interview: { label: "Closed after interview", kind: "closed", column: 3, order: 3 },

  accepted: { label: "Accepted", kind: "success", column: 4, order: 0 },
  offer_pending: { label: "Offer pending", kind: "waiting", column: 4, order: 1 },
  declined: { label: "Declined", kind: "declined", column: 4, order: 2 },
  rejected_after_offer: { label: "Rejected after offer", kind: "rejection", column: 4, order: 3 },
  closed_after_offer: { label: "Closed after offer", kind: "closed", column: 4, order: 4 },
};

function isMilestone(status: FlowStatus): status is FlowMilestone {
  return (
    status === "applied" ||
    status === "screened" ||
    status === "interview" ||
    status === "offer"
  );
}

function isOutcome(status: FlowStatus): status is FlowOutcome {
  return (
    status === "accepted" ||
    status === "declined" ||
    status === "rejected" ||
    status === "closed"
  );
}

// Only these event types influence the funnel. NOTE and REMINDER are ignored.
function eventTypeToFlowStatus(type: FlowApplicationEventType): FlowStatus | null {
  switch (type) {
    case "APPLIED":
      return "applied";
    case "SCREEN":
      return "screened";
    case "INTERVIEW":
      return "interview";
    case "OFFER":
      return "offer";
    case "ACCEPTED":
      return "accepted";
    case "DECLINED":
      return "declined";
    case "REJECTED":
      return "rejected";
    case "NOTE":
    case "REMINDER":
    default:
      return null;
  }
}

// Maps the current application status into the funnel. WISHLIST/PREPARING are
// not funnel states and return null (the application is excluded entirely).
// WITHDRAWN only exists as a status (there is no WITHDRAWN event type), so the
// closed outcome is contributed from here.
function statusToFlowStatus(status: FlowApplicationStatus): FlowStatus | null {
  switch (status) {
    case "APPLIED":
      return "applied";
    case "SCREEN":
      return "screened";
    case "INTERVIEW":
      return "interview";
    case "OFFER":
      return "offer";
    case "ACCEPTED":
      return "accepted";
    case "REJECTED":
      return "rejected";
    case "DECLINED":
      return "declined";
    case "WITHDRAWN":
      return "closed";
    case "WISHLIST":
    case "PREPARING":
    default:
      return null;
  }
}

/** True when an application's current status keeps it out of the funnel. */
export function isExcludedFromFlow(status: FlowApplicationStatus): boolean {
  return statusToFlowStatus(status) === null;
}

// Build the normalized status timeline for one application.
function buildStatusTimeline(application: FlowApplication): FlowStatus[] {
  const eventStatuses = application.events
    .map((event) => ({ status: eventTypeToFlowStatus(event.type), time: event.timestamp.getTime() }))
    .filter((entry): entry is { status: FlowStatus; time: number } => entry.status !== null)
    .sort((left, right) => left.time - right.time)
    .map((entry) => entry.status);

  const timeline: FlowStatus[] = [...eventStatuses];

  // Append the current status when it isn't already the latest event. This is
  // how WITHDRAWN (closed) and any status not yet logged as an event enters.
  const current = statusToFlowStatus(application.status);
  if (current && timeline[timeline.length - 1] !== current) {
    timeline.push(current);
  }

  // Every funnel application is at least "applied".
  if (timeline.length === 0) {
    timeline.push("applied");
  }
  if (!timeline.includes("applied")) {
    timeline.unshift("applied");
  }

  // Collapse consecutive duplicates: applied → screened → screened → rejected
  // becomes applied → screened → rejected.
  const collapsed: FlowStatus[] = [];
  for (const status of timeline) {
    if (collapsed[collapsed.length - 1] !== status) {
      collapsed.push(status);
    }
  }
  return collapsed;
}

type TimelineClassification = {
  deepest: FlowMilestone;
  outcome: FlowOutcome | null;
  milestones: Set<FlowMilestone>;
};

// Deepest milestone reached + the active final outcome. The outcome is read
// from the LAST entry only, so a milestone logged after a terminal outcome
// (a reopened application) supersedes the stale outcome instead of being
// double-counted.
function classifyTimeline(timeline: FlowStatus[]): TimelineClassification {
  const milestones = new Set<FlowMilestone>();
  let deepest: FlowMilestone = "applied";

  for (const status of timeline) {
    if (isMilestone(status)) {
      milestones.add(status);
      if (MILESTONE_RANK[status] > MILESTONE_RANK[deepest]) {
        deepest = status;
      }
    }
  }

  const last = timeline[timeline.length - 1];
  const outcome = last && isOutcome(last) ? last : null;

  return { deepest, outcome, milestones };
}

function closedNodeForMilestone(deepest: FlowMilestone): ApplicationFlowNodeId {
  switch (deepest) {
    case "applied":
      return "closed_before_screen";
    case "screened":
      return "closed_after_screen";
    case "interview":
      return "closed_after_interview";
    case "offer":
      return "closed_after_offer";
  }
}

// The single terminal node an application ends on, given how far it got and
// how it ended.
function terminalNodeForApplication(
  deepest: FlowMilestone,
  outcome: FlowOutcome | null
): ApplicationFlowNodeId {
  if (outcome === null) {
    switch (deepest) {
      case "applied":
        return "no_response";
      case "screened":
        return "waiting_after_screen";
      case "interview":
        return "waiting_after_interview";
      case "offer":
        return "offer_pending";
    }
  }

  if (outcome === "accepted") {
    return "accepted";
  }

  if (outcome === "declined") {
    // Declining only reads as a distinct outcome once an offer exists.
    return deepest === "offer" ? "declined" : closedNodeForMilestone(deepest);
  }

  if (outcome === "rejected") {
    switch (deepest) {
      case "applied":
        return "rejected_before_screen";
      case "screened":
        return "rejected_after_screen";
      case "interview":
        return "no_offer";
      case "offer":
        return "rejected_after_offer";
    }
  }

  // outcome === "closed"
  return closedNodeForMilestone(deepest);
}

/**
 * The ordered path of node ids for one application, always starting at the
 * "applications" root. Intermediate milestone nodes appear only when the
 * timeline proves the application actually reached them — missing stages are
 * never invented.
 */
export function buildApplicationFlowPath(
  application: FlowApplication
): ApplicationFlowNodeId[] {
  const timeline = buildStatusTimeline(application);
  const { deepest, outcome, milestones } = classifyTimeline(timeline);

  const path: ApplicationFlowNodeId[] = ["applications"];
  if (milestones.has("screened")) path.push("screened");
  if (milestones.has("interview")) path.push("interviews");
  if (milestones.has("offer")) path.push("offers");
  path.push(terminalNodeForApplication(deepest, outcome));
  return path;
}

function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return value / total;
}

function isWithinRange(
  application: FlowApplication,
  range: ApplicationFlowRange,
  nowMs: number
): boolean {
  if (range === "all") return true;
  const days = range === "30d" ? 30 : 90;
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  // Activity date keeps recently-updated older applications in recent ranges.
  const activity = Math.max(application.updatedAt.getTime(), application.createdAt.getTime());
  return activity >= cutoff;
}

/**
 * Build the full Sankey dataset for the given applications and time range.
 *
 * Guarantees:
 * - WISHLIST/PREPARING applications are excluded.
 * - Each application contributes to exactly one first-level branch, so the
 *   links out of "applications" sum to `totalCount`.
 * - Only non-empty nodes/links are emitted (no zero nodes).
 */
export function buildApplicationFlowData(
  applications: readonly FlowApplication[],
  options: { range: ApplicationFlowRange; now: number | Date }
): ApplicationFlowData {
  const { range } = options;
  const nowMs = options.now instanceof Date ? options.now.getTime() : options.now;

  const included = applications.filter(
    (application) =>
      !isExcludedFromFlow(application.status) && isWithinRange(application, range, nowMs)
  );

  const nodeApplications = new Map<ApplicationFlowNodeId, Set<string>>();
  const linkApplications = new Map<string, Set<string>>();
  const linkEndpoints = new Map<string, { source: ApplicationFlowNodeId; target: ApplicationFlowNodeId }>();

  const addToNode = (id: ApplicationFlowNodeId, applicationId: string) => {
    let set = nodeApplications.get(id);
    if (!set) {
      set = new Set();
      nodeApplications.set(id, set);
    }
    set.add(applicationId);
  };

  const addToLink = (
    source: ApplicationFlowNodeId,
    target: ApplicationFlowNodeId,
    applicationId: string
  ) => {
    const id = `${source}:${target}`;
    let set = linkApplications.get(id);
    if (!set) {
      set = new Set();
      linkApplications.set(id, set);
      linkEndpoints.set(id, { source, target });
    }
    set.add(applicationId);
  };

  for (const application of included) {
    const path = buildApplicationFlowPath(application);
    for (const nodeId of path) {
      addToNode(nodeId, application.id);
    }
    for (let index = 0; index < path.length - 1; index += 1) {
      addToLink(path[index], path[index + 1], application.id);
    }
  }

  const totalCount = nodeApplications.get("applications")?.size ?? 0;

  const nodes: ApplicationFlowNode[] = [];
  for (const [id, set] of nodeApplications) {
    const meta = FLOW_NODE_META[id];
    const count = set.size;
    nodes.push({
      id,
      label: meta.label,
      kind: meta.kind,
      column: meta.column,
      order: meta.order,
      count,
      value: count,
      percentOfTotal: safeRatio(count, totalCount),
      applicationIds: [...set],
    });
  }

  const links: ApplicationFlowLink[] = [];
  for (const [id, set] of linkApplications) {
    const endpoints = linkEndpoints.get(id)!;
    const sourceMeta = FLOW_NODE_META[endpoints.source];
    const targetMeta = FLOW_NODE_META[endpoints.target];
    const count = set.size;
    const parentCount = nodeApplications.get(endpoints.source)?.size ?? 0;
    links.push({
      id,
      source: endpoints.source,
      target: endpoints.target,
      value: count,
      count,
      applicationIds: [...set],
      sourceLabel: sourceMeta.label,
      targetLabel: targetMeta.label,
      pathLabel: `${sourceMeta.label} → ${targetMeta.label}`,
      parentCount,
      totalCount,
      percentOfParent: safeRatio(count, parentCount),
      percentOfTotal: safeRatio(count, totalCount),
    });
  }

  // Deterministic order for stable, low-crossing rendering.
  nodes.sort((left, right) => left.column - right.column || left.order - right.order);
  links.sort((left, right) => {
    const leftSource = FLOW_NODE_META[left.source];
    const rightSource = FLOW_NODE_META[right.source];
    const leftTarget = FLOW_NODE_META[left.target];
    const rightTarget = FLOW_NODE_META[right.target];
    return (
      leftSource.column - rightSource.column ||
      leftSource.order - rightSource.order ||
      leftTarget.column - rightTarget.column ||
      leftTarget.order - rightTarget.order
    );
  });

  return { nodes, links, applications: included, totalCount, range };
}

// ── Click-filtering helpers ─────────────────────────────────────────────────

/** Application ids contained in a node (empty when the node is absent). */
export function getApplicationsForFlowNode(
  data: ApplicationFlowData,
  nodeId: ApplicationFlowNodeId
): string[] {
  return data.nodes.find((node) => node.id === nodeId)?.applicationIds ?? [];
}

/** Application ids on one exact transition (empty when the link is absent). */
export function getApplicationsForFlowLink(
  data: ApplicationFlowData,
  linkId: string
): string[] {
  return data.links.find((link) => link.id === linkId)?.applicationIds ?? [];
}

const RANGE_LABELS: Record<ApplicationFlowRange, string> = {
  all: "All time",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export function flowRangeLabel(range: ApplicationFlowRange): string {
  return RANGE_LABELS[range];
}
