import assert from "node:assert/strict";
import test from "node:test";

import { getCompanyFrontierWindow } from "../src/lib/ingestion/frontier-rotation";

test("frontier rotation advances through contiguous company slices", () => {
  assert.deepEqual(getCompanyFrontierWindow(10_000, 2_000, 0), {
    offset: 0,
    tailTake: 2_000,
    headTake: 0,
  });
  assert.deepEqual(getCompanyFrontierWindow(10_000, 2_000, 1), {
    offset: 2_000,
    tailTake: 2_000,
    headTake: 0,
  });
  assert.deepEqual(getCompanyFrontierWindow(10_000, 2_000, 4), {
    offset: 8_000,
    tailTake: 2_000,
    headTake: 0,
  });
});

test("frontier rotation wraps the selected slice without shrinking a pass", () => {
  assert.deepEqual(getCompanyFrontierWindow(2_675, 2_000, 1), {
    offset: 2_000,
    tailTake: 675,
    headTake: 1_325,
  });
});

test("frontier rotation handles empty or invalid corpus sizes", () => {
  assert.deepEqual(getCompanyFrontierWindow(0, 2_000, 0), {
    offset: 0,
    tailTake: 0,
    headTake: 0,
  });
  assert.deepEqual(getCompanyFrontierWindow(100, 0, 1), {
    offset: 0,
    tailTake: 0,
    headTake: 0,
  });
});
