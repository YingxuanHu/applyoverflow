import assert from "node:assert/strict";
import test from "node:test";

import { isClearlyNonNorthAmericanLocation } from "@/lib/geo-scope";

test("flags well-known non-NA cities without any NA qualifier", () => {
  for (const location of [
    "Surabaya",
    "London",
    "Bangalore",
    "Jakarta",
    "Berlin",
    "Manila",
    "Sydney",
    "Tel Aviv",
    "Semarang",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), true, location);
  }
});

test("flags production-observed foreign strings embedded in free text", () => {
  assert.equal(
    isClearlyNonNorthAmericanLocation("Mobile Phone Shop Surabaya"),
    true
  );
  assert.equal(
    isClearlyNonNorthAmericanLocation("Unity Corporation Semarang"),
    true
  );
});

test("flags explicit non-NA country names", () => {
  for (const location of [
    "United Kingdom",
    "Jakarta, Indonesia",
    "Munich, Germany",
    "Hyderabad, India",
    "Cebu, Philippines",
    "Sao Paulo, Brazil",
    "Lagos, Nigeria",
    "Karachi, Pakistan",
    "Remote - Europe",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), true, location);
  }
});

test("flags unambiguous non-NA country codes as comma segments", () => {
  assert.equal(isClearlyNonNorthAmericanLocation("Warsaw, PL"), true);
  assert.equal(isClearlyNonNorthAmericanLocation("Oxford, GB"), true);
});

test("handles diacritics in foreign city names", () => {
  assert.equal(isClearlyNonNorthAmericanLocation("São Paulo"), true);
  assert.equal(isClearlyNonNorthAmericanLocation("Zürich"), true);
});

test("never flags foreign-sounding cities carrying a US/CA qualifier", () => {
  for (const location of [
    "London, ON",
    "London, Ontario",
    "Paris, TX",
    "Paris, Texas",
    "Ontario, CA",
    "New Mexico",
    "Remote - New Mexico",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), false, location);
  }
});

test("never flags ambiguous or empty locations", () => {
  for (const location of ["Remote", "", "   ", "Hybrid", "Sales Department"]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), false, location);
  }
});

test("never flags US locations", () => {
  for (const location of [
    "New York, NY",
    "San Francisco, CA",
    "Austin, Texas",
    "Wilmington, DE",
    "Chicago",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), false, location);
  }
});

test("never flags Canadian locations", () => {
  for (const location of [
    "Toronto",
    "Vancouver, BC",
    "Montreal, Quebec",
    "Remote - Canada",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), false, location);
  }
});

test("does not match markers embedded inside longer words", () => {
  // "EU" must not match inside "Eugene"; "India" must not match inside
  // "Indianapolis"; "London" must not match inside "Londonderry".
  assert.equal(isClearlyNonNorthAmericanLocation("Eugene"), false);
  assert.equal(isClearlyNonNorthAmericanLocation("Indianapolis"), false);
  assert.equal(isClearlyNonNorthAmericanLocation("Londonderry"), false);
});

test("a US city qualified by a foreign country is still clearly foreign", () => {
  assert.equal(isClearlyNonNorthAmericanLocation("San Jose, Costa Rica"), true);
});

// ── Strong-evidence ordering regressions (production 2026-07-09) ───────────
// Trailing two-letter country codes collide with US state codes (Indonesia's
// ID = Idaho, India's IN = Indiana), and foreign-city strings collide with
// US city markers ("Cambridge, UK"). Spelled-out foreign countries and admin
// regions must beat code segments; codes still beat foreign CITY names so
// "Paris, TX" stays American.

import { hasStrongNonNorthAmericanGeoEvidence } from "@/lib/geo-scope";

// normalize.ts transitively touches the db module at import time; stub the
// connection string before the lazy import (same pattern as
// tests/global-ingestion-scope.test.ts).
process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";
async function loadInferRegion() {
  const { inferRegion } = await import("@/lib/ingestion/normalize");
  return inferRegion;
}

test("foreign admin regions beat colliding trailing state codes", async () => {
  const inferRegion = await loadInferRegion();
  for (const location of [
    "Jakarta Selatan, DKI Jakarta, ID",
    "India, Bengaluru; Bengaluru, KA, IN",
    "Bristol, UK; Cambridge, UK; London, UK",
    "Al Jubail, Eastern Province, Saudi Arabia",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), true, location);
    assert.equal(inferRegion(location), null, location);
  }
});

test("NA codes still beat foreign city names, and real NA rows still resolve", async () => {
  const inferRegion = await loadInferRegion();
  assert.equal(isClearlyNonNorthAmericanLocation("Paris, TX"), false);
  assert.equal(isClearlyNonNorthAmericanLocation("London, ON"), false);
  assert.equal(inferRegion("Paris, TX"), "US");
  assert.equal(inferRegion("London, ON"), "CA");
  assert.equal(inferRegion("Boise, ID"), "US");
  assert.equal(inferRegion("Gary, IN"), "US");
});

test("explicit NA names beat foreign evidence in multi-location strings", async () => {
  const inferRegion = await loadInferRegion();
  // A posting genuinely offered in both the US and India stays US-visible.
  assert.equal(
    inferRegion("Fort Wayne, Indiana, United States; Mumbai, India"),
    "US"
  );
  assert.equal(
    hasStrongNonNorthAmericanGeoEvidence(
      "Fort Wayne, Indiana, United States; Mumbai, India"
    ),
    false
  );
});

test("NA towns named after foreign places stay American", async () => {
  const inferRegion = await loadInferRegion();
  for (const [location, expected] of [
    ["Peru, IN", "US"],
    ["Turkey, TX", "US"],
    ["Moscow, ID", "US"],
    ["Warsaw, IN", "US"],
    ["Greece, NY", "US"],
  ] as const) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), false, location);
    assert.equal(inferRegion(location), expected, location);
  }
});

test("homonym-free foreign cities beat colliding codes; homonym countries still detected without NA codes", async () => {
  const inferRegion = await loadInferRegion();
  for (const location of [
    "Jakarta, ID",
    "South Jakarta, ID",
    "Jakarta, JK, ID - Remote",
    "Warsaw, Poland",
    "Mexico City, Mexico",
    "Lima, Peru",
  ]) {
    assert.equal(isClearlyNonNorthAmericanLocation(location), true, location);
    assert.equal(inferRegion(location), null, location);
  }
});
