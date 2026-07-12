import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";

type ParsedArgs = {
  key: string | null;
  latest: boolean;
  file: string | null;
  downloadOnly: boolean;
  outputFile: string | null;
};

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const DEFAULT_RESTORE_IMAGE = "postgres:18-bookworm";

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    key: null,
    latest: false,
    file: null,
    downloadOnly: false,
    outputFile: null,
  };

  for (const rawArg of argv) {
    if (rawArg === "--latest") {
      parsed.latest = true;
      continue;
    }

    if (rawArg === "--download-only") {
      parsed.downloadOnly = true;
      continue;
    }

    const [key, value] = rawArg.replace(/^--/, "").split("=");
    if (key === "key" && value) {
      parsed.key = value;
      continue;
    }

    if (key === "file" && value) {
      parsed.file = value;
      continue;
    }

    if (key === "output-file" && value) {
      parsed.outputFile = value;
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

function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function listBackupObjects(input: {
  client: S3Client;
  bucket: string;
  prefix: string;
}) {
  return new Promise<_Object[]>(async (resolve, reject) => {
    const objects: _Object[] = [];
    let continuationToken: string | undefined;

    try {
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

      resolve(objects);
    } catch (error) {
      reject(error);
    }
  });
}

async function findLatestBackup(input: {
  config: StorageConfig;
  sourceDatabaseName: string;
}) {
  const client = createStorageClient(input.config);
  const prefixRoot = (
    process.env.DB_BACKUP_STORAGE_PREFIX?.trim() || "database-backups"
  ).replace(/^\/+|\/+$/g, "");
  const prefix = `${prefixRoot}/${sanitizeSegment(input.sourceDatabaseName)}/`;
  const objects = await listBackupObjects({
    client,
    bucket: input.config.bucket,
    prefix,
  });

  const latest = objects
    .filter((object) => object.Key && object.LastModified)
    .sort((left, right) => right.LastModified!.getTime() - left.LastModified!.getTime())[0];

  if (!latest?.Key) {
    throw new Error(`No backup objects found under ${input.config.bucket}/${prefix}`);
  }

  return latest.Key;
}

async function downloadBackup(input: {
  config: StorageConfig;
  key: string;
  outputFile: string;
}) {
  const client = createStorageClient(input.config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: input.config.bucket,
      Key: input.key,
    })
  );

  if (!response.Body) {
    throw new Error(`Backup object ${input.key} has no body.`);
  }

  await mkdir(path.dirname(input.outputFile), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(input.outputFile);
    const body = response.Body as NodeJS.ReadableStream;
    body.pipe(output);
    body.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
  });
}

function runRestoreWithLocalBinary(input: {
  databaseUrl: string;
  backupFile: string;
  pgRestoreBin: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      input.pgRestoreBin,
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "-d",
        input.databaseUrl,
        input.backupFile,
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: process.env,
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${input.pgRestoreBin} exited with code ${code ?? "unknown"}`));
    });
  });
}

function runRestoreWithDocker(input: {
  databaseUrl: string;
  backupFile: string;
  image: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const backupStream = createReadStream(input.backupFile);
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        input.image,
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "-d",
        input.databaseUrl,
      ],
      {
        stdio: ["pipe", "inherit", "inherit"],
        env: process.env,
      }
    );

    backupStream.pipe(child.stdin);
    backupStream.on("error", reject);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`docker pg_restore exited with code ${code ?? "unknown"}`));
    });
  });
}

async function restoreDatabase(input: {
  databaseUrl: string;
  backupFile: string;
}) {
  const pgRestoreBin = process.env.PG_RESTORE_BIN?.trim() || "pg_restore";
  if (commandExists(pgRestoreBin)) {
    await runRestoreWithLocalBinary({
      databaseUrl: input.databaseUrl,
      backupFile: input.backupFile,
      pgRestoreBin,
    });
    return;
  }

  const dockerImage =
    process.env.DB_BACKUP_PG_RESTORE_DOCKER_IMAGE?.trim() || DEFAULT_RESTORE_IMAGE;
  if (!commandExists("docker")) {
    throw new Error(
      `Neither ${pgRestoreBin} nor docker is available. Install PostgreSQL client tools or set DB_BACKUP_PG_RESTORE_DOCKER_IMAGE.`
    );
  }

  await runRestoreWithDocker({
    databaseUrl: input.databaseUrl,
    backupFile: input.backupFile,
    image: dockerImage,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl =
    process.env.DATABASE_URL_FOR_RESTORE?.trim() || requireEnv("DATABASE_URL");
  const databaseName = getDatabaseName(databaseUrl);
  const sourceDatabaseName =
    process.env.DB_RESTORE_SOURCE_DATABASE_NAME?.trim() || databaseName;

  let backupFile = args.file;

  if (!backupFile) {
    const config = readStorageConfig();
    const key = args.latest
      ? await findLatestBackup({ config, sourceDatabaseName })
      : args.key;

    if (!key) {
      throw new Error("Provide --latest, --key=<object-key>, or --file=<dump-file>.");
    }

    backupFile =
      args.outputFile ||
      path.join(
        os.tmpdir(),
        "applyoverflow-db-restores",
        sanitizeSegment(databaseName),
        path.basename(key)
      );

    console.log(`Downloading ${config.bucket}/${key} to ${backupFile}`);
    await downloadBackup({ config, key, outputFile: backupFile });
  }

  await stat(backupFile);
  console.log(`Restore file ready: ${backupFile}`);

  if (args.downloadOnly) {
    return;
  }

  if (process.env.CONFIRM_RESTORE !== databaseName) {
    throw new Error(
      `Refusing to restore ${databaseName}. Re-run with CONFIRM_RESTORE=${databaseName}.`
    );
  }

  console.log(`Restoring ${databaseName} from ${backupFile}`);
  await restoreDatabase({ databaseUrl, backupFile });
  console.log("Restore complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
