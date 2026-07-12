import assert from "node:assert/strict";
import test from "node:test";

import {
  expandLocationSearchTerm,
  inferLocationSearchRegion,
} from "../src/lib/location-search";

test("country location filters expand to stored feed regions", () => {
  const canada = expandLocationSearchTerm("Canada");
  assert.equal(canada.region, "CA");
  assert.ok(canada.containsTerms.includes("Canada"));

  const unitedStates = expandLocationSearchTerm("United States");
  assert.equal(unitedStates.region, "US");
  assert.ok(unitedStates.containsTerms.includes("United States"));

  assert.equal(inferLocationSearchRegion("remote united states"), "US");
});

test("province filters expand to common city-level job locations", () => {
  const ontario = expandLocationSearchTerm("Ontario");

  assert.equal(ontario.region, null);
  assert.ok(ontario.containsTerms.includes("Ontario"));
  assert.ok(ontario.containsTerms.includes(", ON"));
  assert.ok(ontario.containsTerms.includes("Toronto"));
  assert.ok(ontario.containsTerms.includes("Ottawa"));

  const yukon = expandLocationSearchTerm("Yukon");
  assert.ok(yukon.containsTerms.includes("Whitehorse"));
});

test("state filters expand without relying on ambiguous raw abbreviations", () => {
  const california = expandLocationSearchTerm("California");

  assert.equal(california.region, null);
  assert.ok(california.containsTerms.includes("California"));
  assert.ok(california.containsTerms.includes(", CA"));
  assert.ok(california.containsTerms.includes("San Francisco"));
  assert.ok(california.containsTerms.includes("Los Angeles"));

  const ambiguousCa = expandLocationSearchTerm("CA");
  assert.equal(ambiguousCa.region, null);
  assert.deepEqual(ambiguousCa.containsTerms, []);

  const texasCode = expandLocationSearchTerm("TX");
  assert.ok(texasCode.containsTerms.includes("Texas"));
  assert.ok(texasCode.containsTerms.includes("Dallas"));

  const alaska = expandLocationSearchTerm("Alaska");
  assert.ok(alaska.containsTerms.includes("Anchorage"));
});

test("combined city and province searches keep both exact and hierarchy terms", () => {
  const expanded = expandLocationSearchTerm("Toronto Ontario");

  assert.ok(expanded.containsTerms.includes("Ontario"));
  assert.ok(expanded.containsTerms.includes("Toronto"));
});

test("unknown free-text locations remain searchable as entered", () => {
  const expanded = expandLocationSearchTerm("Halton Region");

  assert.equal(expanded.region, null);
  assert.deepEqual(expanded.containsTerms, ["Halton Region"]);
});
