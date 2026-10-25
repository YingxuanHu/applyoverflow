import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { EvidenceError, requireEvidence, validateDatabaseTarget } from "./launch-evidence-safety";

const execute = promisify(execFile);

export async function cleanupDisposableCluster(operations: {
  status: () => Promise<"running" | "stopped">;
  stop: () => Promise<void>;
  removeOwnedDirectory: () => Promise<void>;
}) {
  const before = await operations.status();
  requireEvidence(before === "running" || before === "stopped", "DISPOSABLE_CLUSTER_STATUS_UNKNOWN_DIRECTORY_RETAINED");
  if (before === "running") {
    try { await operations.stop(); }
    catch { /* A failed stop is not proof of exit; verify status below. */ }
    requireEvidence(await operations.status() === "stopped", "DISPOSABLE_CLUSTER_STILL_RUNNING_DIRECTORY_RETAINED");
  }
  await operations.removeOwnedDirectory();
}

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  requireEvidence(address && typeof address !== "string", "LOCAL_PORT_UNAVAILABLE");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// No caller-supplied URL, existing cluster, migrations, .env, or user DB.
export async function createDisposableEvidencePostgres() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "launch-evidence-pg-")));
  const data = path.join(directory, "data");
  const environment = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LC_ALL: "C", NODE_ENV: "test" as const };
  const command = async (binary: string, args: string[], code: string, timeout = 15_000) => {
    try { return await execute(binary, args, { env: environment, timeout, maxBuffer: 262_144 }); }
    catch { throw new EvidenceError(code); }
  };
  let startAttempted = false;
  const status = async (): Promise<"running" | "stopped"> => {
    try {
      await execute("pg_ctl", ["-D", data, "status"], { env: environment, timeout: 5000, maxBuffer: 262_144 });
      return "running";
    } catch (error) {
      // pg_ctl's documented exit 3 is the only accepted stopped result.
      if ((error as { code?: unknown }).code === 3) return "stopped";
      throw new EvidenceError("DISPOSABLE_CLUSTER_STATUS_UNKNOWN_DIRECTORY_RETAINED");
    }
  };
  const stop = async () => {
    const removeOwnedDirectory = () => rm(directory, { recursive: true, force: true });
    if (!startAttempted) { await removeOwnedDirectory(); return; }
    await cleanupDisposableCluster({ status, removeOwnedDirectory, stop: async () => {
      await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "10", "stop"], "DISPOSABLE_CLUSTER_STOP_FAILED");
    } });
  };
  try {
    await command("initdb", ["-D", data, "--username=evidence_owner", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale"], "LOCAL_PG_INIT_FAILED");
    const port = await availablePort();
    // A bind race fails startup; never fall back to the listener on that port.
    startAttempted = true;
    await command("pg_ctl", ["-D", data, "-l", path.join(directory, "server.log"), "-w", "-t", "10", "-o",
      `-h 127.0.0.1 -p ${port} -c unix_socket_directories= -c timezone=UTC -c shared_buffers=32MB -c work_mem=4MB -c maintenance_work_mem=32MB -c max_connections=8 -c max_parallel_workers_per_gather=0 -c autovacuum=off`, "start"], "LOCAL_PG_START_FAILED");
    const base = `postgresql://evidence_owner@127.0.0.1:${port}`;
    const admin = new Client({ connectionString: `${base}/postgres`, password: "", ssl: false, options: "-c timezone=UTC", connectionTimeoutMillis: 2000, query_timeout: 5000 });
    try {
      await admin.connect();
      const actual = (await admin.query("SHOW data_directory")).rows[0].data_directory;
      requireEvidence(await realpath(actual) === await realpath(data), "DISPOSABLE_CLUSTER_IDENTITY_MISMATCH");
      await admin.query('CREATE DATABASE "launch_evidence_fixture_synthetic"');
    } finally { await admin.end(); }
    const connectionString = `${base}/launch_evidence_fixture_synthetic`;
    validateDatabaseTarget(connectionString, `postgresql://127.0.0.1:${port}/launch_evidence_fixture_synthetic`, {
      environment: "local", isolatedSyntheticData: true, noProductionInfrastructure: true,
    });
    return { connectionString, readerConnectionString: connectionString.replace("evidence_owner@", "evidence_reader@"), stop };
  } catch (error) {
    // Failed readiness may still leave a live postmaster. Never delete until
    // pg_ctl status verifies exit, including when stop itself failed.
    await stop();
    throw error;
  }
}
