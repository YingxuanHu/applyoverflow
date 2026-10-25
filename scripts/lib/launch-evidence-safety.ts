import { isIP } from "node:net";
import { readFile } from "node:fs/promises";

export class EvidenceError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function requireEvidence(condition: unknown, code: string): asserts condition {
  if (!condition) throw new EvidenceError(code);
}

export function boundedNumber(value: unknown, min: number, max: number, code: string, integer = true): number {
  requireEvidence(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), code);
  return value;
}

export type Isolation = {
  environment: "local" | "staging";
  isolatedSyntheticData: true;
  noProductionInfrastructure: true;
};

export function validateIsolation(value: Isolation) {
  requireEvidence(value.environment === "local" || value.environment === "staging", "NON_PRODUCTION_ENVIRONMENT_REQUIRED");
  requireEvidence(value.isolatedSyntheticData === true && value.noProductionInfrastructure === true, "ISOLATION_ATTESTATION_REQUIRED");
}

// Numeric addresses only: no DNS rebinding, wildcard hosts, or public staging
// aliases. An operator must still verify that a local tunnel is not production.
export function validateHost(hostname: string, environment: Isolation["environment"]) {
  const loopback = hostname === "127.0.0.1" || hostname === "[::1]";
  const parts = hostname.split(".").map(Number);
  const privateV4 = isIP(hostname) === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
  requireEvidence(loopback || (environment === "staging" && privateV4), "TARGET_MUST_BE_LOOPBACK_OR_PRIVATE_LITERAL");
}

export function parseUrl(value: unknown): URL {
  requireEvidence(typeof value === "string", "INVALID_TARGET");
  try { return new URL(value); } catch { throw new EvidenceError("INVALID_TARGET"); }
}

export function validateHttpTarget(value: string, allowOrigins: string[], isolation: Isolation): URL {
  validateIsolation(isolation);
  const target = parseUrl(value);
  requireEvidence(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash && target.pathname === "/", "ORIGIN_ONLY_REQUIRED");
  validateHost(target.hostname, isolation.environment);
  requireEvidence(Array.isArray(allowOrigins) && allowOrigins.length > 0 && allowOrigins.length <= 8 && allowOrigins.includes(target.origin), "EXACT_ORIGIN_ALLOWLIST_REQUIRED");
  for (const origin of allowOrigins) {
    const allowed = parseUrl(origin);
    requireEvidence(allowed.origin === origin && ["http:", "https:"].includes(allowed.protocol), "EXACT_ORIGIN_ALLOWLIST_REQUIRED");
    validateHost(allowed.hostname, isolation.environment);
  }
  return target;
}

export function validateDatabaseTarget(connectionString: string, allowedTarget: string, isolation: Isolation): URL {
  validateIsolation(isolation);
  const target = parseUrl(connectionString);
  requireEvidence(target.protocol === "postgresql:" && !target.search && !target.hash, "DATABASE_URL_OPTIONS_FORBIDDEN");
  validateHost(target.hostname, isolation.environment);
  requireEvidence(/^\/launch_evidence_(fixture|staging)_[a-z0-9_]+$/.test(target.pathname), "DEDICATED_EVIDENCE_DATABASE_REQUIRED");
  requireEvidence(allowedTarget === `postgresql://${target.host}${target.pathname}`, "EXACT_DATABASE_ALLOWLIST_REQUIRED");
  return target;
}

export async function readEvidenceConfig(args: string[]) {
  requireEvidence(args.length === 1 && args[0].startsWith("--config="), "USAGE_CONFIG_FILE_REQUIRED");
  const bytes = await readFile(args[0].slice("--config=".length));
  requireEvidence(bytes.length <= 32_768, "CONFIG_TOO_LARGE");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new EvidenceError("INVALID_CONFIG_JSON"); }
}

export function redactedFailure(error: unknown) {
  return { schemaVersion: 1, complete: false, passed: false, error: error instanceof EvidenceError ? error.code : "EVIDENCE_RUN_FAILED" };
}
