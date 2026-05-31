import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";

type ParsedArgs = {
  label: string;
  localOnly: boolean;
  noRetention: boolean;
  uploadFile: string | null;
};

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const DEFAULT_BACKUP_IMAGE = "postgres:18-bookworm";

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    label: "auto",
    localOnly: false,
    noRetention: false,
    uploadFile: null,
  };

  for (const rawArg of argv) {
    if (rawArg === "--local-only") {
      parsed.localOnly = true;
      continue;
    }

    if (rawArg === "--no-retention") {
      parsed.noRetention = true;
      continue;
    }

    const [key, value] = rawArg.replace(/^--/, "").split("=");
    if (key === "label" && value) {
      parsed.label = value;
      continue;
    }

    if (key === "upload-file" && value) {
      parsed.uploadFile = value;
    }
  }

  return parsed;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readStorageConfig(): StorageConfig {
  return {
    bucket: requireEnv("STORAGE_BUCKET"),
    region: requireEnv("STORAGE_REGION"),
    endpoint: optionalEnv("STORAGE_ENDPOINT"),
    accessKeyId: requireEnv("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("STORAGE_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  };
}

function createStorageClient(config: StorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getDatabaseName(connectionString: string) {
  const parsed = new URL(connectionString);
  return parsed.pathname.replace(/^\//, "") || "database";
}

function getTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function runCommandToFile(command: string, args: string[], outputFile: string) {
  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputFile);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });

    child.stdout.pipe(output);
    child.on("error", reject);
    output.on("error", reject);
    child.on("exit", (code) => {
      output.end();
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function dumpDatabase(input: { databaseUrl: string; outputFile: string }) {
  const pgDumpBin = process.env.PG_DUMP_BIN?.trim() || "pg_dump";
  if (commandExists(pgDumpBin)) {
    await runCommand(pgDumpBin, [input.databaseUrl, "-Fc", "-f", input.outputFile]);
    return;
  }

  const dockerImage =
    process.env.DB_BACKUP_PG_DUMP_DOCKER_IMAGE?.trim() || DEFAULT_BACKUP_IMAGE;
  if (!commandExists("docker")) {
    throw new Error(
      `Neither ${pgDumpBin} nor docker is available. Install PostgreSQL client tools or set DB_BACKUP_PG_DUMP_DOCKER_IMAGE.`
    );
  }

  await runCommandToFile(
    "docker",
    ["run", "--rm", dockerImage, "pg_dump", input.databaseUrl, "-Fc"],
    input.outputFile
  );
}

async function uploadBackup(input: {
  filePath: string;
  key: string;
  config: StorageConfig;
}) {
  const client = createStorageClient(input.config);
  const fileStat = await stat(input.filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: input.config.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentLength: fileStat.size,
      ContentType: "application/octet-stream",
      Metadata: {
        createdBy: "applyoverflow-db-backup",
      },
    })
  );
}

async function listBackupObjects(input: {
  client: S3Client;
  bucket: string;
  prefix: string;
}) {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await input.client.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.prefix,
        ContinuationToken: continuationToken,
      })
    );

    objects.push(...(response.Contents ?? []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function pruneOldBackups(input: {
  config: StorageConfig;
  prefix: string;
  retentionDays: number;
}) {
  if (input.retentionDays <= 0) {
    return;
  }

  const client = createStorageClient(input.config);
  const cutoff = Date.now() - input.retentionDays * 24 * 60 * 60 * 1000;
  const objects = await listBackupObjects({
    client,
    bucket: input.config.bucket,
    prefix: input.prefix,
  });
  const expiredKeys = objects
    .filter((object) => object.Key && object.LastModified)
    .filter((object) => object.LastModified!.getTime() < cutoff)
    .map((object) => ({ Key: object.Key! }));

  for (let i = 0; i < expiredKeys.length; i += 1000) {
    const batch = expiredKeys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: input.config.bucket,
        Delete: {
          Objects: batch,
          Quiet: true,
        },
      })
    );
  }

  if (expiredKeys.length > 0) {
    console.log(`Pruned ${expiredKeys.length} backup object(s) older than ${input.retentionDays} days.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL_FOR_BACKUP?.trim() || requireEnv("DATABASE_URL");
  const dbName = sanitizeSegment(getDatabaseName(databaseUrl));
  const backupDir =
    process.env.DB_BACKUP_LOCAL_DIR?.trim() ||
    path.join(os.tmpdir(), "applyoverflow-db-backups", dbName);
  await mkdir(backupDir, { recursive: true });

  const label = sanitizeSegment(args.label);
  const stamp = getTimestamp();
  const sourceFile =
    args.uploadFile ??
    path.join(backupDir, `${label}-${dbName}-${stamp}.dump`);

  if (!args.uploadFile) {
    console.log(`Dumping ${dbName} to ${sourceFile}`);
    await dumpDatabase({ databaseUrl, outputFile: sourceFile });
  } else {
    await stat(sourceFile);
    console.log(`Uploading existing dump ${sourceFile}`);
  }

  const sizeBytes = (await stat(sourceFile)).size;
  console.log(`Backup file ready (${Math.ceil(sizeBytes / 1024 / 1024)} MB).`);

  if (!args.localOnly) {
    const config = readStorageConfig();
    const prefix = (
      process.env.DB_BACKUP_STORAGE_PREFIX?.trim() || "database-backups"
    ).replace(/^\/+|\/+$/g, "");
    const objectKey = `${prefix}/${dbName}/${label}-${dbName}-${stamp}.dump`;

    console.log(`Uploading backup to ${config.bucket}/${objectKey}`);
    await uploadBackup({ filePath: sourceFile, key: objectKey, config });
    console.log("Upload complete.");

    if (!args.noRetention) {
      const retentionDays = Number(process.env.DB_BACKUP_RETENTION_DAYS ?? "14");
      await pruneOldBackups({
        config,
        prefix: `${prefix}/${dbName}/`,
        retentionDays: Number.isFinite(retentionDays) ? retentionDays : 14,
      });
    }
  }

  if (process.env.DB_BACKUP_KEEP_LOCAL !== "1" && !args.uploadFile) {
    await unlink(sourceFile).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
