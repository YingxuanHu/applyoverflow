import assert from "node:assert/strict";
import test from "node:test";

import {
  isLocalDevelopmentAuthEnabled,
  isLocalDevelopmentDatabaseUrl,
} from "../src/lib/local-development-auth";

test("local development auth requires a loopback app and never enables in production", () => {
  assert.equal(
    isLocalDevelopmentAuthEnabled({
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
    }),
    true
  );
  assert.equal(
    isLocalDevelopmentAuthEnabled({
      NODE_ENV: "production",
      APP_URL: "http://localhost:3000",
    }),
    false
  );
  assert.equal(
    isLocalDevelopmentAuthEnabled({
      NODE_ENV: "development",
      APP_URL: "https://applyoverflow.example",
    }),
    false
  );
});

test("local development auth rejects SSH tunnels and remote databases", () => {
  assert.equal(
    isLocalDevelopmentDatabaseUrl("postgresql://user:password@localhost:5432/autoapplication"),
    true
  );
  assert.equal(
    isLocalDevelopmentDatabaseUrl("postgresql://user:password@127.0.0.1:15432/autoapplication"),
    false
  );
  assert.equal(
    isLocalDevelopmentDatabaseUrl("postgresql://user:password@db.example:5432/autoapplication"),
    false
  );
});
