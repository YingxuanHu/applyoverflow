import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type DiagnosticEvent =
  | {
      kind: "unhandledRejection";
      processName: string;
      timestamp: string;
      pid: number;
      uptimeSeconds: number;
      memoryUsage: NodeJS.MemoryUsage;
      cwd: string;
      argv: string[];
      reason: SerializedErrorValue;
    }
  | {
      kind: "uncaughtException";
      processName: string;
      timestamp: string;
      pid: number;
      uptimeSeconds: number;
      memoryUsage: NodeJS.MemoryUsage;
      cwd: string;
      argv: string[];
      origin: string;
      error: SerializedErrorValue;
    }
  | {
      kind: "warning";
      processName: string;
      timestamp: string;
      pid: number;
      uptimeSeconds: number;
      memoryUsage: NodeJS.MemoryUsage;
      cwd: string;
      argv: string[];
      warning: SerializedErrorValue;
    }
  | {
      kind: "beforeExit" | "exit";
      processName: string;
      timestamp: string;
      pid: number;
      uptimeSeconds: number;
      memoryUsage: NodeJS.MemoryUsage;
      cwd: string;
      argv: string[];
      code: number;
    };

type SerializedErrorValue =
  | {
      type: "error";
      name: string;
      message: string;
      stack: string | null;
      cause?: SerializedErrorValue;
    }
  | {
      type: "object";
      value: string;
    }
  | {
      type: "primitive";
      value: string;
    };

function serializeUnknown(value: unknown): SerializedErrorValue {
  if (value instanceof Error) {
    const serialized: SerializedErrorValue = {
      type: "error",
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };

    if ("cause" in value && value.cause) {
      serialized.cause = serializeUnknown(value.cause);
    }

    return serialized;
  }

  if (typeof value === "object" && value !== null) {
    try {
      return {
        type: "object",
        value: JSON.stringify(value),
      };
    } catch {
      return {
        type: "object",
        value: Object.prototype.toString.call(value),
      };
    }
  }

  return {
    type: "primitive",
    value: String(value),
  };
}

function buildLogPath(processName: string) {
  return path.join(
    process.cwd(),
    ".runtime",
    "process-diagnostics",
    `${processName}.jsonl`
  );
}

function writeDiagnostic(event: DiagnosticEvent) {
  const outputPath = buildLogPath(event.processName);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(event)}\n`, "utf8");
}

function logEvent(
  processName: string,
  event:
    | { kind: "unhandledRejection"; reason: unknown }
    | { kind: "uncaughtException"; origin: string; error: unknown }
    | { kind: "warning"; warning: Error }
    | { kind: "beforeExit" | "exit"; code: number }
) {
  const base = {
    processName,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    memoryUsage: process.memoryUsage(),
    cwd: process.cwd(),
    argv: process.argv.slice(2),
  };

  if (event.kind === "unhandledRejection") {
    writeDiagnostic({
      ...base,
      kind: event.kind,
      reason: serializeUnknown(event.reason),
    });
    return;
  }

  if (event.kind === "uncaughtException") {
    writeDiagnostic({
      ...base,
      kind: event.kind,
      origin: event.origin,
      error: serializeUnknown(event.error),
    });
    return;
  }

  if (event.kind === "warning") {
    writeDiagnostic({
      ...base,
      kind: event.kind,
      warning: serializeUnknown(event.warning),
    });
    return;
  }

  writeDiagnostic({
    ...base,
    kind: event.kind,
    code: event.code,
  });
}

export function installProcessDiagnostics(options: { processName: string }) {
  let fatalExitRequested = false;

  process.on("unhandledRejection", (reason) => {
    // DB connection pool timeouts are transient and should not crash the process.
    // They surface as unhandled rejections from deep inside Prisma/pg-pool when
    // a concurrent task can't acquire a connection within the timeout.
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes("timeout exceeded when trying to connect") || msg.includes("Connection pool timeout")) {
      console.warn(`[${options.processName}] Transient DB pool timeout (non-fatal):`, msg);
      logEvent(options.processName, { kind: "unhandledRejection", reason });
      return; // Don't crash — the task already logged a failure and moved on.
    }

    console.error(`[${options.processName}] Unhandled rejection:`, reason);
    logEvent(options.processName, {
      kind: "unhandledRejection",
      reason,
    });

    if (!fatalExitRequested) {
      fatalExitRequested = true;
      setImmediate(() => {
        process.exitCode = 1;
        process.exit(1);
      });
    }
  });

  process.on("uncaughtException", (error, origin) => {
    console.error(`[${options.processName}] Uncaught exception (${origin}):`, error);
    logEvent(options.processName, {
      kind: "uncaughtException",
      origin,
      error,
    });

    if (!fatalExitRequested) {
      fatalExitRequested = true;
      process.exitCode = 1;
      process.exit(1);
    }
  });

  process.on("warning", (warning) => {
    console.warn(`[${options.processName}] Process warning:`, warning);
    logEvent(options.processName, {
      kind: "warning",
      warning,
    });
  });

  process.on("beforeExit", (code) => {
    console.warn(`[${options.processName}] beforeExit with code ${code}`);
    logEvent(options.processName, {
      kind: "beforeExit",
      code,
    });
  });

  process.on("exit", (code) => {
    console.warn(`[${options.processName}] exit with code ${code}`);
    logEvent(options.processName, {
      kind: "exit",
      code,
    });
  });
}
