import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalDateTime } from "../src/components/ui/local-date-time";

test("session timestamps have deterministic initial HTML across server time zones", () => {
  const previousZone = process.env.TZ;
  try {
    const outputs = ["UTC", "America/Toronto", "America/Los_Angeles"].map((zone) => {
      process.env.TZ = zone;
      return renderToStaticMarkup(createElement(LocalDateTime, { value: "2026-09-14T14:21:00.000Z" }));
    });
    assert.equal(new Set(outputs).size, 1);
    assert.match(outputs[0], /dateTime="2026-09-14T14:21:00.000Z"/);
    assert.match(outputs[0], /2:21 PM UTC/);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("invalid timestamp data does not crash the security panel", () => {
  assert.equal(renderToStaticMarkup(createElement(LocalDateTime, { value: "invalid" })), "Unknown");
});
