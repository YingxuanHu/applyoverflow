import assert from "node:assert/strict";
import test from "node:test";

import { getPaginationItems } from "../src/lib/pagination";

test("pagination items show full short ranges", () => {
  assert.deepEqual(
    getPaginationItems({ currentPage: 1, totalPages: 6 }),
    [1, 2, 3, 4, 5, 6]
  );
});

test("pagination items show early pages and final page for large ranges", () => {
  assert.deepEqual(
    getPaginationItems({ currentPage: 1, totalPages: 42 }),
    [1, 2, 3, 4, 5, "gap", 42]
  );
});

test("pagination items show nearby pages for middle ranges", () => {
  assert.deepEqual(
    getPaginationItems({ currentPage: 21, totalPages: 42 }),
    [1, "gap", 20, 21, 22, "gap", 42]
  );
});

test("pagination items show final window for late pages", () => {
  assert.deepEqual(
    getPaginationItems({ currentPage: 42, totalPages: 42 }),
    [1, "gap", 38, 39, 40, 41, 42]
  );
});

test("pagination items support unknown totals with a known next page", () => {
  assert.deepEqual(
    getPaginationItems({ currentPage: 5, hasNextPage: true, totalPages: null }),
    [1, 4, 5, 6]
  );
});
