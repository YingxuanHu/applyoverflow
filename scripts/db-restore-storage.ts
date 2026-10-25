import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export type BackupManifest = {
  schemaVersion: 1;
  bucket: string;
  key: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  database: string;
  remoteVerifiedAt?: string;
  versionId?: string;
};

export function storageConfig() {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const bucket = required("STORAGE_BUCKET");
  return {
    bucket,
    client: new S3Client({
      region: required("STORAGE_REGION"),
      endpoint: process.env.STORAGE_ENDPOINT?.trim() || undefined,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
      },
    }),
  };
}

export function parseManifest(value: unknown, bucket?: string, key?: string): BackupManifest {
  const m = value as BackupManifest | null;
  if (!m || m.schemaVersion !== 1 || typeof m.bucket !== "string" || !m.bucket ||
      typeof m.key !== "string" || !m.key.endsWith(".dump") ||
      !Number.isSafeInteger(m.sizeBytes) || m.sizeBytes <= 0 ||
      typeof m.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.sha256) ||
      typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) ||
      typeof m.database !== "string" || !m.database ||
      (m.versionId !== undefined && (typeof m.versionId !== "string" || !m.versionId)) ||
      (m.remoteVerifiedAt !== undefined && !Number.isFinite(Date.parse(m.remoteVerifiedAt)))) {
    throw new Error("Invalid backup manifest; restore verification failed closed.");
  }
  if ((bucket && m.bucket !== bucket) || (key && m.key !== key)) {
    throw new Error("Backup manifest bucket/key does not match the requested object.");
  }
  return m;
}

export async function readRemoteManifest(client: S3Client, bucket: string, key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${key}.manifest.json` }));
  if (!result.Body) throw new Error("Missing manifest body.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of result.Body as Readable) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("Backup manifest exceeds 64 KiB.");
    chunks.push(buffer);
  }
  return parseManifest(JSON.parse(Buffer.concat(chunks).toString("utf8")), bucket, key);
}

export async function digestStream(source: Readable, output?: Writable) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, meter, output ?? new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  return { sizeBytes, sha256: hash.digest("hex") };
}

export function assertDigest(actual: { sizeBytes: number; sha256: string }, expected: BackupManifest) {
  if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
    throw new Error(`Backup verification failed: expected ${expected.sizeBytes} bytes / ${expected.sha256}, received ${actual.sizeBytes} bytes / ${actual.sha256}`);
  }
}

export async function inspectRemoteBackup(client: S3Client, manifest: BackupManifest) {
  const head = await client.send(new HeadObjectCommand({ Bucket: manifest.bucket, Key: manifest.key, VersionId: manifest.versionId }));
  if (head.ContentLength !== manifest.sizeBytes) throw new Error("Remote backup size does not match manifest.");
  if (!head.ETag && !head.VersionId) throw new Error("Storage cannot pin the object for verified download.");
  return head;
}

export async function verifyRemoteBackup(client: S3Client, manifest: BackupManifest, outputFile?: string) {
  const head = await inspectRemoteBackup(client, manifest);
  if (outputFile) await mkdir(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  const temporary = outputFile ? `${outputFile}.${randomUUID()}.partial` : undefined;
  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: manifest.bucket, Key: manifest.key,
      VersionId: manifest.versionId ?? head.VersionId,
      IfMatch: head.ETag,
    }));
    if (!result.Body) throw new Error("Backup object has no body.");
    if (result.ContentLength !== manifest.sizeBytes) {
      (result.Body as Readable).destroy();
      throw new Error("Downloaded Content-Length does not match manifest.");
    }
    const actual = await digestStream(result.Body as Readable,
      temporary ? createWriteStream(temporary, { flags: "wx", mode: 0o600 }) : undefined);
    assertDigest(actual, manifest);
    if (temporary && outputFile) {
      // link is atomic and refuses to overwrite an existing target or symlink.
      await link(temporary, outputFile);
    }
    return { ...actual, versionId: result.VersionId, verifiedAt: new Date().toISOString() };
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}

async function latestBackup(client: S3Client, bucket: string) {
  const database = process.env.DB_RESTORE_SOURCE_DATABASE_NAME?.trim();
  if (!database || !/^[a-zA-Z0-9._-]+$/.test(database)) throw new Error("--latest requires DB_RESTORE_SOURCE_DATABASE_NAME.");
  const prefix = `${(process.env.DB_BACKUP_STORAGE_PREFIX || "database-backups").replace(/^\/+|\/+$/g, "")}/${database}/`;
  let token: string | undefined;
  const dumps: { key: string; time: number }[] = [];
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      if (object.Key?.endsWith(".dump") && object.LastModified) dumps.push({ key: object.Key, time: object.LastModified.getTime() });
    }
    token = page.NextContinuationToken;
  } while (token);
  const latest = dumps.sort((a, b) => b.time - a.time)[0];
  if (!latest) throw new Error("No backup dumps found.");
  // Do not silently fall back to an older backup if the newest is unverified.
  return latest.key;
}

async function main() {
  const flags = new Set(["--latest", "--verify-only", "--download-only", "--inspect"]);
  const values = new Map<string, string>();
  const selected = new Set<string>();
  for (const arg of process.argv.slice(2)) {
    if (flags.has(arg)) { selected.add(arg); continue; }
    const match = /^(--(?:key|file|output-file|manifest|expected-size|expected-sha256))=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error(`Unknown or duplicate argument: ${arg}`);
    values.set(match[1], match[2]);
  }
  if (["--verify-only", "--download-only", "--inspect"].filter((key) => selected.has(key)).length !== 1) {
    throw new Error("Choose --verify-only, --download-only, or --inspect. Direct/live database restores are disabled; use deploy/single-vps/restore-drill.sh.");
  }
  if ([values.has("--key"), values.has("--file"), selected.has("--latest")].filter(Boolean).length !== 1) {
    throw new Error("Choose exactly one of --key=<exact-object-key>, --latest, or --file=<local-dump>.");
  }
  if (values.has("--file")) {
    if (!selected.has("--verify-only")) throw new Error("Local files support --verify-only only.");
    const manifest = parseManifest(JSON.parse(await readFile(values.get("--manifest") || `${values.get("--file")}.manifest.json`, "utf8")));
    assertDigest(await digestStream(createReadStream(values.get("--file")!)), manifest);
    console.log(JSON.stringify({ status: "verified", manifest, verifiedAt: new Date().toISOString() }));
    return;
  }
  const { client, bucket } = storageConfig();
  try {
    const key = values.get("--key") || await latestBackup(client, bucket);
    let manifest: BackupManifest;
    if (values.has("--expected-size") || values.has("--expected-sha256")) {
      if (!selected.has("--verify-only") || values.has("--manifest")) throw new Error("Explicit trusted size/hash are only for read-only legacy verification.");
      manifest = parseManifest({ schemaVersion: 1, bucket, key,
        sizeBytes: Number(values.get("--expected-size")), sha256: values.get("--expected-sha256"),
        createdAt: new Date().toISOString(), database: "legacy-operator-asserted" }, bucket, key);
    } else {
      manifest = values.has("--manifest")
        ? parseManifest(JSON.parse(await readFile(values.get("--manifest")!, "utf8")), bucket, key)
        : await readRemoteManifest(client, bucket, key);
    }
    if (selected.has("--inspect")) {
      await inspectRemoteBackup(client, manifest);
      console.log(JSON.stringify({ status: "metadata-only-not-content-verified", manifest }));
      return;
    }
    const outputFile = selected.has("--download-only") ? values.get("--output-file") : undefined;
    if (selected.has("--download-only") && !outputFile) throw new Error("--download-only requires --output-file on a capacity-checked volume.");
    const started = Date.now();
    const verified = await verifyRemoteBackup(client, manifest, outputFile);
    if (outputFile) await writeFile(`${outputFile}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "verified", manifest, ...verified, elapsedSeconds: (Date.now() - started) / 1000, outputFile }));
  } finally { client.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
