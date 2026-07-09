import assert from "node:assert/strict";
import test from "node:test";

import {
  describeApplyPlatform,
  describeVerification,
  pickApplyPlatformSourceName,
} from "../src/lib/job-trust-display";

const NOW = "2026-07-09T12:00:00.000Z";

function daysBefore(days: number, reference: string = NOW) {
  return new Date(new Date(reference).getTime() - days * 86_400_000).toISOString();
}

// ─── describeVerification ────────────────────────────────────────────────────

test("confirmed alive today reads as verified today with a fresh tone", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: "2026-07-09T09:00:00.000Z",
      lastSourceSeenAt: null,
      now: NOW,
    }),
    { label: "Verified today", tone: "fresh" }
  );
});

test("confirmed alive 3 days ago reads as verified 3d ago and stays fresh", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: daysBefore(3),
      lastSourceSeenAt: daysBefore(1),
      now: NOW,
    }),
    { label: "Verified 3d ago", tone: "fresh" }
  );
});

test("confirmed alive beyond a week ages the tone", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: daysBefore(10),
      lastSourceSeenAt: null,
      now: NOW,
    }),
    { label: "Verified 10d ago", tone: "aging" }
  );
});

test("falls back to the source-seen signal when never confirmed alive", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: null,
      lastSourceSeenAt: daysBefore(5),
      now: NOW,
    }),
    { label: "Seen 5d ago", tone: "fresh" }
  );
});

test("falls back to a recent source-seen signal when the confirmation is stale", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: daysBefore(35),
      lastSourceSeenAt: daysBefore(2),
      now: NOW,
    }),
    { label: "Seen 2d ago", tone: "fresh" }
  );
});

test("returns null when both signals are absent", () => {
  assert.equal(
    describeVerification({
      lastConfirmedAliveAt: null,
      lastSourceSeenAt: undefined,
      now: NOW,
    }),
    null
  );
});

test("returns null when the freshest signal is older than 30 days", () => {
  assert.equal(
    describeVerification({
      lastConfirmedAliveAt: daysBefore(31),
      lastSourceSeenAt: daysBefore(31),
      now: NOW,
    }),
    null
  );
  // Exactly 30 days is still shown, as aging.
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: daysBefore(30),
      lastSourceSeenAt: null,
      now: NOW,
    }),
    { label: "Verified 30d ago", tone: "aging" }
  );
});

test("slightly-future timestamps clamp to today instead of disappearing", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: "2026-07-09T12:05:00.000Z",
      lastSourceSeenAt: null,
      now: NOW,
    }),
    { label: "Verified today", tone: "fresh" }
  );
});

test("unparseable timestamps are ignored rather than rendered", () => {
  assert.deepEqual(
    describeVerification({
      lastConfirmedAliveAt: "not-a-date",
      lastSourceSeenAt: daysBefore(4),
      now: NOW,
    }),
    { label: "Seen 4d ago", tone: "fresh" }
  );
  assert.equal(
    describeVerification({
      lastConfirmedAliveAt: "not-a-date",
      lastSourceSeenAt: null,
      now: NOW,
    }),
    null
  );
});

// ─── describeApplyPlatform ───────────────────────────────────────────────────

test("maps known ATS family prefixes to platform labels", () => {
  assert.equal(describeApplyPlatform("Greenhouse:stripe"), "Greenhouse");
  assert.equal(describeApplyPlatform("Workday:acme"), "Workday");
  assert.equal(describeApplyPlatform("iCIMS:token"), "iCIMS");
  assert.equal(describeApplyPlatform("SuccessFactors:sap"), "SAP SuccessFactors");
  assert.equal(describeApplyPlatform("TheMuse:feed"), "The Muse");
});

test("maps first-party company families to a single company-site label", () => {
  assert.equal(describeApplyPlatform("OfficialCompany:Acme"), "Company site");
  assert.equal(describeApplyPlatform("CompanySite:acme.com"), "Company site");
  assert.equal(describeApplyPlatform("FirstPartyCompany:Acme"), "Company site");
});

test("maps both Job Bank connector families to the same label", () => {
  assert.equal(describeApplyPlatform("JobBank:ontario"), "Job Bank");
  assert.equal(describeApplyPlatform("JobBankLive:feed"), "Job Bank");
});

test("handles sources without a tenant suffix", () => {
  assert.equal(describeApplyPlatform("Jooble"), "Jooble");
});

test("title-cases unknown families instead of hiding them", () => {
  assert.equal(describeApplyPlatform("shinyats:token"), "Shinyats");
  assert.equal(describeApplyPlatform("new-board_x:feed"), "New Board X");
});

test("returns null when there is no usable source name", () => {
  assert.equal(describeApplyPlatform(null), null);
  assert.equal(describeApplyPlatform(""), null);
  assert.equal(describeApplyPlatform(":tenant-only"), null);
});

test("withholds the platform for seeded demo sources", () => {
  assert.equal(describeApplyPlatform("BoardAggregator-X"), null);
});

// ─── pickApplyPlatformSourceName ─────────────────────────────────────────────

test("prefers the primary mapping and falls back to the first one", () => {
  assert.equal(
    pickApplyPlatformSourceName([
      { sourceName: "Adzuna:ca", isPrimary: false },
      { sourceName: "Greenhouse:acme", isPrimary: true },
    ]),
    "Greenhouse:acme"
  );
  assert.equal(
    pickApplyPlatformSourceName([
      { sourceName: "Adzuna:ca", isPrimary: false },
      { sourceName: "Greenhouse:acme", isPrimary: false },
    ]),
    "Adzuna:ca"
  );
  assert.equal(pickApplyPlatformSourceName([]), null);
});
