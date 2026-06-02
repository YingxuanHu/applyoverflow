import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplicationFlowData,
  buildApplicationFlowPath,
  getApplicationsForFlowLink,
  getApplicationsForFlowNode,
  type ApplicationFlowNodeId,
  type FlowApplication,
  type FlowApplicationEventType,
  type FlowApplicationStatus,
} from "../src/lib/application-flow";

const NOW = new Date("2026-06-02T12:00:00.000Z");
const BASE = new Date("2026-01-01T00:00:00.000Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

let sequence = 0;

type EventSpec = FlowApplicationEventType | { type: FlowApplicationEventType; dayOffset: number };

function makeApp(input: {
  status: FlowApplicationStatus;
  events?: EventSpec[];
  createdAt?: Date;
  updatedAt?: Date;
  id?: string;
}): FlowApplication {
  const id = input.id ?? `app-${(sequence += 1)}`;
  const events = (input.events ?? []).map((spec, index) => {
    const type = typeof spec === "string" ? spec : spec.type;
    const dayOffset = typeof spec === "string" ? index : spec.dayOffset;
    return { type, timestamp: new Date(BASE + dayOffset * DAY) };
  });
  return {
    id,
    company: "Company",
    roleTitle: "Role",
    status: input.status,
    createdAt: input.createdAt ?? new Date(BASE),
    updatedAt: input.updatedAt ?? new Date(BASE),
    events,
  };
}

function pathOf(app: FlowApplication): ApplicationFlowNodeId[] {
  return buildApplicationFlowPath(app);
}

// ── Per-application path scenarios (1–18) ───────────────────────────────────

test("Scenario 1: applied only → no_response", () => {
  assert.deepEqual(pathOf(makeApp({ status: "APPLIED", events: ["APPLIED"] })), [
    "applications",
    "no_response",
  ]);
  // No events at all still reads as applied → no_response.
  assert.deepEqual(pathOf(makeApp({ status: "APPLIED", events: [] })), [
    "applications",
    "no_response",
  ]);
});

test("Scenario 2: applied → rejected → rejected_before_screen", () => {
  assert.deepEqual(pathOf(makeApp({ status: "REJECTED", events: ["APPLIED", "REJECTED"] })), [
    "applications",
    "rejected_before_screen",
  ]);
});

test("Scenario 3: applied → closed/withdrawn → closed_before_screen", () => {
  // WITHDRAWN has no event type; it arrives via current status.
  assert.deepEqual(pathOf(makeApp({ status: "WITHDRAWN", events: ["APPLIED"] })), [
    "applications",
    "closed_before_screen",
  ]);
});

test("Scenario 4: screened, waiting → waiting_after_screen", () => {
  assert.deepEqual(pathOf(makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] })), [
    "applications",
    "screened",
    "waiting_after_screen",
  ]);
});

test("Scenario 5: screened then rejected → rejected_after_screen", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "REJECTED", events: ["APPLIED", "SCREEN", "REJECTED"] })),
    ["applications", "screened", "rejected_after_screen"]
  );
});

test("Scenario 6: screened then closed → closed_after_screen", () => {
  assert.deepEqual(pathOf(makeApp({ status: "WITHDRAWN", events: ["APPLIED", "SCREEN"] })), [
    "applications",
    "screened",
    "closed_after_screen",
  ]);
});

test("Scenario 7: direct interview, waiting → waiting_after_interview", () => {
  assert.deepEqual(pathOf(makeApp({ status: "INTERVIEW", events: ["APPLIED", "INTERVIEW"] })), [
    "applications",
    "interviews",
    "waiting_after_interview",
  ]);
});

test("Scenario 8: screened then interview, waiting", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "INTERVIEW", events: ["APPLIED", "SCREEN", "INTERVIEW"] })),
    ["applications", "screened", "interviews", "waiting_after_interview"]
  );
});

test("Scenario 9: interview then rejected → no_offer (no invented screen)", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "REJECTED", events: ["APPLIED", "INTERVIEW", "REJECTED"] })),
    ["applications", "interviews", "no_offer"]
  );
});

test("Scenario 10: screened interview rejected → no_offer", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "REJECTED", events: ["APPLIED", "SCREEN", "INTERVIEW", "REJECTED"] })),
    ["applications", "screened", "interviews", "no_offer"]
  );
});

test("Scenario 11: offer pending with full timeline", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "OFFER", events: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"] })),
    ["applications", "screened", "interviews", "offers", "offer_pending"]
  );
});

test("Scenario 12: offer accepted", () => {
  assert.deepEqual(
    pathOf(
      makeApp({
        status: "ACCEPTED",
        events: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "ACCEPTED"],
      })
    ),
    ["applications", "screened", "interviews", "offers", "accepted"]
  );
});

test("Scenario 13: offer declined", () => {
  assert.deepEqual(
    pathOf(
      makeApp({
        status: "DECLINED",
        events: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "DECLINED"],
      })
    ),
    ["applications", "screened", "interviews", "offers", "declined"]
  );
});

test("Scenario 14: offer rejected → rejected_after_offer", () => {
  assert.deepEqual(
    pathOf(
      makeApp({
        status: "REJECTED",
        events: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER", "REJECTED"],
      })
    ),
    ["applications", "screened", "interviews", "offers", "rejected_after_offer"]
  );
});

test("Scenario 15: offer closed → closed_after_offer", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "WITHDRAWN", events: ["APPLIED", "SCREEN", "INTERVIEW", "OFFER"] })),
    ["applications", "screened", "interviews", "offers", "closed_after_offer"]
  );
});

test("Scenario 16: current status OFFER, no timeline → offers → offer_pending", () => {
  assert.deepEqual(pathOf(makeApp({ status: "OFFER", events: [] })), [
    "applications",
    "offers",
    "offer_pending",
  ]);
});

test("Scenario 17: reopened after rejection uses the latest active path", () => {
  // applied → screened → rejected → interview: the trailing interview means the
  // application is active again, so the stale rejection must not be counted.
  assert.deepEqual(
    pathOf(makeApp({ status: "INTERVIEW", events: ["APPLIED", "SCREEN", "REJECTED", "INTERVIEW"] })),
    ["applications", "screened", "interviews", "waiting_after_interview"]
  );
});

test("Scenario 18: consecutive duplicate events collapse", () => {
  assert.deepEqual(
    pathOf(makeApp({ status: "REJECTED", events: ["APPLIED", "SCREEN", "SCREEN", "REJECTED"] })),
    ["applications", "screened", "rejected_after_screen"]
  );
});

// ── Aggregation-level scenarios (19–21) ─────────────────────────────────────

test("Scenario 19: WISHLIST and PREPARING are excluded entirely", () => {
  const data = buildApplicationFlowData(
    [
      makeApp({ status: "WISHLIST", events: ["APPLIED"] }),
      makeApp({ status: "PREPARING", events: ["APPLIED"] }),
      makeApp({ status: "APPLIED", events: ["APPLIED"] }),
    ],
    { range: "all", now: NOW }
  );

  assert.equal(data.totalCount, 1);
  assert.equal(data.applications.length, 1);
  // Only the no_response branch should exist.
  assert.deepEqual(
    data.links.map((link) => link.id),
    ["applications:no_response"]
  );
});

test("Scenario 20: first-level branches sum exactly to total (no double counting)", () => {
  const applications: FlowApplication[] = [];
  for (let index = 0; index < 228; index += 1) {
    applications.push(makeApp({ status: "APPLIED", events: ["APPLIED"] }));
  }
  for (let index = 0; index < 7; index += 1) {
    applications.push(makeApp({ status: "REJECTED", events: ["APPLIED", "REJECTED"] }));
  }
  for (let index = 0; index < 4; index += 1) {
    applications.push(makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] }));
  }
  for (let index = 0; index < 4; index += 1) {
    applications.push(makeApp({ status: "WITHDRAWN", events: ["APPLIED"] }));
  }
  applications.push(makeApp({ status: "INTERVIEW", events: ["APPLIED", "INTERVIEW"] }));

  const data = buildApplicationFlowData(applications, { range: "all", now: NOW });

  assert.equal(data.totalCount, 244);

  const firstLevel = data.links.filter((link) => link.source === "applications");
  const firstLevelSum = firstLevel.reduce((sum, link) => sum + link.count, 0);
  assert.equal(firstLevelSum, 244);

  const byTarget = new Map(firstLevel.map((link) => [link.target, link.count]));
  assert.equal(byTarget.get("no_response"), 228);
  assert.equal(byTarget.get("rejected_before_screen"), 7);
  assert.equal(byTarget.get("screened"), 4);
  assert.equal(byTarget.get("closed_before_screen"), 4);
  assert.equal(byTarget.get("interviews"), 1);

  // Every application appears in exactly one first-level link.
  const seen = new Set<string>();
  for (const link of firstLevel) {
    for (const applicationId of link.applicationIds) {
      assert.equal(seen.has(applicationId), false, "application counted twice");
      seen.add(applicationId);
    }
  }
  assert.equal(seen.size, 244);
});

test("Scenario 21: no offers means no offer-stage nodes (no zero nodes)", () => {
  const data = buildApplicationFlowData(
    [
      makeApp({ status: "APPLIED", events: ["APPLIED"] }),
      makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] }),
      makeApp({ status: "REJECTED", events: ["APPLIED", "SCREEN", "REJECTED"] }),
    ],
    { range: "all", now: NOW }
  );

  const nodeIds = new Set(data.nodes.map((node) => node.id));
  for (const absent of ["offers", "offer_pending", "accepted", "declined"] as const) {
    assert.equal(nodeIds.has(absent), false, `${absent} should not exist`);
  }
  // And there are no zero-value nodes anywhere.
  for (const node of data.nodes) {
    assert.ok(node.count > 0, `${node.id} is a zero node`);
  }
});

// ── Metrics, ranges, and filtering ──────────────────────────────────────────

test("link metrics expose percent-of-parent and percent-of-total", () => {
  const applications: FlowApplication[] = [];
  for (let index = 0; index < 240; index += 1) {
    applications.push(makeApp({ status: "APPLIED", events: ["APPLIED"] }));
  }
  // 4 screened, 2 of which reach interview.
  applications.push(makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] }));
  applications.push(makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] }));
  applications.push(makeApp({ status: "INTERVIEW", events: ["APPLIED", "SCREEN", "INTERVIEW"] }));
  applications.push(makeApp({ status: "INTERVIEW", events: ["APPLIED", "SCREEN", "INTERVIEW"] }));

  const data = buildApplicationFlowData(applications, { range: "all", now: NOW });
  assert.equal(data.totalCount, 244);

  const screenedToInterview = data.links.find((link) => link.id === "screened:interviews");
  assert.ok(screenedToInterview);
  assert.equal(screenedToInterview!.count, 2);
  assert.equal(screenedToInterview!.parentCount, 4);
  assert.equal(Number((screenedToInterview!.percentOfParent * 100).toFixed(1)), 50);
  assert.equal(Number((screenedToInterview!.percentOfTotal * 100).toFixed(1)), 0.8);
});

test("range filtering uses activity date (max of created/updated)", () => {
  const recentlyUpdatedOldApp = makeApp({
    status: "SCREEN",
    events: [{ type: "APPLIED", dayOffset: 0 }],
    createdAt: new Date(NOW.getTime() - 200 * DAY),
    updatedAt: new Date(NOW.getTime() - 5 * DAY),
  });
  const staleApp = makeApp({
    status: "APPLIED",
    events: [{ type: "APPLIED", dayOffset: 0 }],
    createdAt: new Date(NOW.getTime() - 200 * DAY),
    updatedAt: new Date(NOW.getTime() - 200 * DAY),
  });

  const all = buildApplicationFlowData([recentlyUpdatedOldApp, staleApp], { range: "all", now: NOW });
  assert.equal(all.totalCount, 2);

  const last30 = buildApplicationFlowData([recentlyUpdatedOldApp, staleApp], {
    range: "30d",
    now: NOW,
  });
  // Only the recently-updated application survives the 30-day window.
  assert.equal(last30.totalCount, 1);
  assert.equal(last30.applications[0]?.id, recentlyUpdatedOldApp.id);
});

test("NOTE and REMINDER events never affect the funnel", () => {
  const app = makeApp({
    status: "SCREEN",
    events: ["APPLIED", "NOTE", "SCREEN", "REMINDER"],
  });
  assert.deepEqual(pathOf(app), ["applications", "screened", "waiting_after_screen"]);
});

test("node and link click helpers return the right application ids", () => {
  const screened = makeApp({ status: "SCREEN", events: ["APPLIED", "SCREEN"] });
  const interviewed = makeApp({ status: "INTERVIEW", events: ["APPLIED", "SCREEN", "INTERVIEW"] });
  const data = buildApplicationFlowData([screened, interviewed], { range: "all", now: NOW });

  // The screened node holds both (both reached screening).
  assert.deepEqual(getApplicationsForFlowNode(data, "screened").sort(), [screened.id, interviewed.id].sort());

  // The exact screened → interviews transition holds only the one that advanced.
  assert.deepEqual(getApplicationsForFlowLink(data, "screened:interviews"), [interviewed.id]);

  // The interviews → no_offer link does not exist (nobody was rejected there).
  assert.deepEqual(getApplicationsForFlowLink(data, "interviews:no_offer"), []);
});

test("empty input yields an empty, render-safe dataset", () => {
  const data = buildApplicationFlowData([], { range: "all", now: NOW });
  assert.equal(data.totalCount, 0);
  assert.deepEqual(data.nodes, []);
  assert.deepEqual(data.links, []);
});
