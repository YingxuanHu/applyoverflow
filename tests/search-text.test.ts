import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchText } from "../src/lib/ingestion/quality";

const searchDescription = (description: string) =>
  buildSearchText({
    title: "",
    company: "",
    location: "",
    roleFamily: "",
    shortSummary: "",
    description,
  });

test("search text never splits a surrogate pair at the description cutoff", () => {
  const description = "x".repeat(3999) + "\uD83D\uDCB6 benefits";
  const result = searchDescription(description);
  assert.equal(result.isWellFormed(), true);
  assert.equal(result, "x".repeat(3999));
});

test("search text keeps complete emoji and the original size budget", () => {
  const description = "x".repeat(3998) + "\uD83D\uDCB6 more";
  assert.equal(searchDescription(description), description.slice(0, 4000));
  assert.equal(searchDescription("a".repeat(4001)).length, 4000);
  assert.equal(searchDescription("\u00e9".repeat(4001)), "\u00e9".repeat(4000));
  assert.equal(
    searchDescription("Short \uD83D\uDCB6 description"),
    "Short \uD83D\uDCB6 description",
  );
});
