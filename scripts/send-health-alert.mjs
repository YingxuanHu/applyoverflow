import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const OWNER = "alvin.hu@mail.utoronto.ca";
export const ALERT_TEXT = Object.freeze({
  "root-disk": "Root filesystem usage is above the configured threshold.",
  "volume-disk": "Attached filesystem usage is above the configured threshold.",
  "volume-missing": "A required attached filesystem is unavailable.",
  "tablespace-policy": "The database storage placement check failed.",
  "memory": "Available memory is below the configured threshold.",
  "swap": "Swap usage is above the configured threshold.",
  "load": "System load is above the configured threshold.",
  "backup-receipt": "Verified backup evidence is missing or invalid.",
  "backup-age": "The last verified backup is outside the permitted age window.",
  "backup-failure": "The last database backup attempt failed.",
  "supply-missing": "The supply health report is missing or stale.",
  "supply-partial": "The supply health report is incomplete.",
  "container-inspection": "Container health could not be inspected.",
  "container-health": "A monitored service is unhealthy.",
  "caddy-inspection": "HTTP error counts could not be inspected.",
  "caddy-5xx": "The HTTP server error threshold was exceeded.",
  "alert-delivery": "An alert delivery configuration problem was detected.",
  "public-health": "The external public health check failed.",
  "public-http": "The external HTTP availability check failed.",
  "tls-expiry": "The public TLS certificate needs operator attention.",
  "monitor-stale": "The external monitor heartbeat is missing or stale.",
});

export function parseAlert(value) {
  if (!value || value.schemaVersion !== 1 || !["host", "external"].includes(value.source) ||
      !["alert", "recovery", "summary", "test"].includes(value.kind) ||
      Object.keys(value).some((key) => !["schemaVersion", "source", "kind", "active", "opened", "recovered"].includes(key))) {
    throw new Error("Invalid alert envelope.");
  }
  for (const key of ["active", "opened", "recovered"]) {
    if (!Array.isArray(value[key]) || value[key].length > 32 ||
        value[key].some((code) => typeof code !== "string" || !Object.hasOwn(ALERT_TEXT, code)) ||
        new Set(value[key]).size !== value[key].length) throw new Error("Invalid alert condition codes.");
  }
  if (value.kind === "alert" && value.active.length === 0) throw new Error("Alert has no active conditions.");
  if (value.kind === "recovery" && value.active.length !== 0) throw new Error("Recovery still has active conditions.");
  return value;
}

export async function sendHealthAlert(value, env = process.env, createTransport = nodemailer.createTransport) {
  const alert = parseAlert(value);
  if (env.MONITOR_ALERT_EMAIL !== OWNER) throw new Error("Alert recipient is not allowlisted.");
  const port = Number(env.SMTP_PORT || "587");
  if (!["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].every((key) => typeof env[key] === "string" && env[key].length > 0) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || /[\r\n]/.test(env.SMTP_FROM)) throw new Error("SMTP configuration is incomplete.");
  const transport = createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }, pool: false,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  const lines = [
    "ApplyOverflow operations notification",
    `Source: ${alert.source === "host" ? "host monitor" : "external monitor"}`,
    `State: ${alert.kind}`,
    ...alert.active.map((code) => `ACTIVE: ${ALERT_TEXT[code]}`),
    ...alert.recovered.map((code) => `RECOVERED: ${ALERT_TEXT[code]}`),
    "Inspect the private operations logs for details. This message contains no account records or credentials.",
  ];
  try {
    const result = await transport.sendMail({
      from: env.SMTP_FROM, to: OWNER, subject: `[ApplyOverflow] Operations ${alert.kind === "summary" ? "daily summary" : alert.kind}`,
      text: lines.join("\n"), disableFileAccess: true, disableUrlAccess: true,
    });
    if (!result.accepted?.some((address) => String(address).toLowerCase() === OWNER) || result.rejected?.length) {
      throw new Error("SMTP did not accept the owner recipient.");
    }
    return { delivery: "smtp-accepted", recipient: "configured-owner", inboxReceiptVerified: false };
  } finally { transport.close(); }
}

async function main() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 8192) throw new Error("Alert payload exceeds limit.");
    chunks.push(chunk);
  }
  const result = await sendHealthAlert(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  console.log(JSON.stringify(result));
}

if (process.argv.includes("--send-health-alert") ||
    (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)) {
  main().catch(() => {
    // Never expose SMTP exceptions: providers can include credentials or recipients.
    console.error("SMTP alert delivery failed; delivery-unverified.");
    process.exitCode = 1;
  });
}
