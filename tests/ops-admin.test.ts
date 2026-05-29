import assert from "node:assert/strict";
import test from "node:test";

import { isOpsAdminEmail, parseOpsAdminEmails } from "../src/lib/ops-admin";

test("ops admin allowlist parses comma and newline separated emails", () => {
  const emails = parseOpsAdminEmails(" Admin@Example.com,ops@example.com\nsecond@example.com ");

  assert.deepEqual([...emails], [
    "admin@example.com",
    "ops@example.com",
    "second@example.com",
  ]);
});

test("ops admin email checks are case-insensitive and deny empty allowlists", () => {
  assert.equal(isOpsAdminEmail("ADMIN@example.com", "admin@example.com"), true);
  assert.equal(isOpsAdminEmail("user@example.com", "admin@example.com"), false);
  assert.equal(isOpsAdminEmail("admin@example.com", ""), false);
  assert.equal(isOpsAdminEmail(null, "admin@example.com"), false);
});
