import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeTrustedOrigins,
  resolveCanonicalAppUrl,
} from "../src/lib/runtime-origin";

const ENV_KEYS = [
  "BETTER_AUTH_URL",
  "APP_URL",
  "HETZNER_APP_URL",
  "NEXT_PUBLIC_BETTER_AUTH_URL",
  "NODE_ENV",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function withEnv(overrides: Partial<Record<EnvKey, string>>, fn: () => void) {
  const env: Record<string, string | undefined> = process.env;
  const snapshot = new Map<EnvKey, string | undefined>();
  for (const key of ENV_KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const original = snapshot.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        env[key] = original;
      }
    }
  }
}

// A header source that mimics an attacker who controls every request header we
// might otherwise trust. None of these values must ever reach a generated URL
// or the trusted-origin allowlist.
const attackerHeaders = {
  get(name: string) {
    switch (name.toLowerCase()) {
      case "x-forwarded-host":
      case "host":
        return "attacker.example";
      case "origin":
        return "https://attacker.example";
      case "x-forwarded-proto":
        return "https";
      default:
        return null;
    }
  },
};

test("resolveCanonicalAppUrl takes no request/header input", () => {
  // A function that cannot receive headers cannot be poisoned by them.
  assert.equal(resolveCanonicalAppUrl.length, 0);
});

test("resolveCanonicalAppUrl prefers BETTER_AUTH_URL over other configured URLs", () => {
  withEnv(
    {
      BETTER_AUTH_URL: "https://canonical.example.com",
      APP_URL: "https://app.example.com",
      HETZNER_APP_URL: "https://hetzner.example.com",
      NEXT_PUBLIC_BETTER_AUTH_URL: "https://public.example.com",
    },
    () => {
      assert.equal(resolveCanonicalAppUrl(), "https://canonical.example.com");
    }
  );
});

test("resolveCanonicalAppUrl falls back through the configured env chain", () => {
  withEnv({ APP_URL: "https://app.example.com" }, () => {
    assert.equal(resolveCanonicalAppUrl(), "https://app.example.com");
  });
  withEnv({ HETZNER_APP_URL: "https://hetzner.example.com" }, () => {
    assert.equal(resolveCanonicalAppUrl(), "https://hetzner.example.com");
  });
  withEnv({ NEXT_PUBLIC_BETTER_AUTH_URL: "https://public.example.com" }, () => {
    assert.equal(resolveCanonicalAppUrl(), "https://public.example.com");
  });
});

test("resolveCanonicalAppUrl falls back to the localhost dev default when nothing is configured", () => {
  withEnv({}, () => {
    assert.equal(resolveCanonicalAppUrl(), "http://localhost:3000");
  });
});

test("buildRuntimeTrustedOrigins never trusts request-header-derived origins", () => {
  withEnv({ BETTER_AUTH_URL: "https://canonical.example.com" }, () => {
    const origins = buildRuntimeTrustedOrigins(attackerHeaders);

    assert.ok(
      origins.every((origin) => !origin.includes("attacker.example")),
      `attacker-controlled origin leaked into trusted origins: ${origins.join(", ")}`
    );
    assert.ok(origins.includes("https://canonical.example.com"));
  });
});

test("buildRuntimeTrustedOrigins ignores headers entirely (header-independent output)", () => {
  withEnv({ BETTER_AUTH_URL: "https://canonical.example.com" }, () => {
    assert.deepEqual(
      buildRuntimeTrustedOrigins(attackerHeaders),
      buildRuntimeTrustedOrigins(null)
    );
  });
});

test("buildRuntimeTrustedOrigins includes configured env URLs and localhost defaults", () => {
  withEnv(
    {
      BETTER_AUTH_URL: "https://canonical.example.com",
      APP_URL: "https://app.example.com",
    },
    () => {
      const origins = buildRuntimeTrustedOrigins();

      assert.ok(origins.includes("https://canonical.example.com"));
      assert.ok(origins.includes("https://app.example.com"));
      assert.ok(origins.includes("http://localhost:3000"));
      assert.ok(origins.includes("http://localhost:3004"));
      assert.ok(origins.includes("http://127.0.0.1:3000"));
    }
  );
});

test("production trusts configured origins only, with no automatic loopback origins", () => {
  withEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "https://app.example" }, () => {
    assert.deepEqual(buildRuntimeTrustedOrigins(attackerHeaders), ["https://app.example"]);
  });
});

test("production-mode local CI explicitly opts into only its configured local origin", () => {
  withEnv({ NODE_ENV: "production", BETTER_AUTH_URL: "http://127.0.0.1:4333" }, () => {
    assert.equal(resolveCanonicalAppUrl(), "http://127.0.0.1:4333");
    assert.deepEqual(buildRuntimeTrustedOrigins(), ["http://127.0.0.1:4333"]);
  });
});

test("production without canonical configuration never generates localhost links", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.throws(resolveCanonicalAppUrl, /Configure BETTER_AUTH_URL or APP_URL/);
    assert.deepEqual(buildRuntimeTrustedOrigins(attackerHeaders), []);
  });
});

test("trusted origins normalize paths and whitespace without adding request origins", () => {
  withEnv({ NODE_ENV: "production", APP_URL: " https://app.example/path?value=1 ", BETTER_AUTH_URL: "https://app.example/" }, () => {
    assert.deepEqual(buildRuntimeTrustedOrigins(attackerHeaders), ["https://app.example"]);
  });
});

test("non-HTTP, credential-bearing and wildcard trusted URLs fail closed", () => {
  for (const APP_URL of ["javascript:alert(1)", "https://user:password@app.example", "https://*.example", "not a URL"]) {
    withEnv({ NODE_ENV: "production", APP_URL }, () => assert.throws(buildRuntimeTrustedOrigins));
  }
});
