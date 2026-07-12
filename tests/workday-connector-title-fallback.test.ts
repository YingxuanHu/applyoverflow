import assert from "node:assert/strict";
import test from "node:test";

import { selectWorkdayJobTitle } from "../src/lib/ingestion/workday-title-parser";

test("selectWorkdayJobTitle: prefers JSON-LD title when present and clean", () => {
  assert.equal(
    selectWorkdayJobTitle({
      jsonLdTitle: "Senior Software Engineer",
      listTitle: "Senior Software Engineer",
      applyUrl: "https://x.wd1.myworkdayjobs.com/y/job/Toronto/Senior-Software-Engineer_R1",
    }),
    "Senior Software Engineer"
  );
});

test("selectWorkdayJobTitle: falls back to list title when JSON-LD missing", () => {
  assert.equal(
    selectWorkdayJobTitle({
      jsonLdTitle: null,
      listTitle: "Customer Experience Associate",
      applyUrl: "https://x.wd1.myworkdayjobs.com/y/job/Toronto/Customer-Experience-Associate_R1",
    }),
    "Customer Experience Associate"
  );
});

test("selectWorkdayJobTitle: rewrites title when JSON-LD and list both return a location string", () => {
  // The bug we're guarding against: both upstream title sources returned a
  // city ("New York") instead of the real title. The connector should
  // recover by extracting from the apply URL.
  assert.equal(
    selectWorkdayJobTitle({
      jsonLdTitle: "New York",
      listTitle: "New York",
      applyUrl:
        "https://tmobile.wd1.myworkdayjobs.com/external/job/New-York-New-York/Account-Executive--Government---New-York_REQ347140-1",
    }),
    "Account Executive Government New York"
  );
});

test("selectWorkdayJobTitle: keeps the bogus title when URL-extracted title is ALSO a location", () => {
  // Defense in depth: if both inputs and the URL all yield only location-y
  // strings, do nothing — better to leave the row alone than rewrite it
  // with another bogus value.
  assert.equal(
    selectWorkdayJobTitle({
      jsonLdTitle: "Toronto",
      listTitle: "Toronto",
      applyUrl: "https://x.wd1.myworkdayjobs.com/y/job/Toronto/Toronto-Office_R1",
    }),
    "Toronto"
  );
});

test("selectWorkdayJobTitle: returns null when all inputs are empty", () => {
  assert.equal(
    selectWorkdayJobTitle({ jsonLdTitle: null, listTitle: null, applyUrl: null }),
    null
  );
});
