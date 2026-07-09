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
