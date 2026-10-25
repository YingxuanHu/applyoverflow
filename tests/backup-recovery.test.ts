import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { assertDigest, digestStream, parseManifest, readRemoteManifest, verifyRemoteBackup } from "../scripts/db-restore-storage";

const bytes = Buffer.from("PGDMP test archive bytes");
const manifest = {
  schemaVersion: 1 as const, bucket: "test", key: "database-backups/test/exact.dump",
  sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  createdAt: "2026-10-25T00:00:00Z", database: "test",
};
function client(send: (command: unknown) => Promise<unknown>) { return { send } as unknown as S3Client; }

test("manifest requires complete size/hash identity and valid fields", () => {
  assert.deepEqual(parseManifest(manifest, "test", manifest.key), manifest);
  for (const patch of [{ sizeBytes: 0 }, { sizeBytes: NaN }, { sha256: "abc" }, { schemaVersion: 2 }, { createdAt: "bad" }]) {
    assert.throws(() => parseManifest({ ...manifest, ...patch }));
  }
  assert.throws(() => parseManifest(manifest, "wrong", manifest.key));
  assert.throws(() => parseManifest(manifest, "test", "different.dump"));
});

test("stream digest rejects same-size corruption and truncation", async () => {
  assertDigest(await digestStream(Readable.from([bytes])), manifest);
  assert.throws(() => assertDigest({ sizeBytes: bytes.length, sha256: "0".repeat(64) }, manifest));
  assert.throws(() => assertDigest({ sizeBytes: bytes.length - 1, sha256: manifest.sha256 }, manifest));
});

test("missing and oversized remote manifests fail closed", async () => {
  await assert.rejects(readRemoteManifest(client(async () => { throw new Error("NoSuchKey"); }), "test", manifest.key), /NoSuchKey/);
  await assert.rejects(readRemoteManifest(client(async () => ({ Body: Readable.from([Buffer.alloc(65537)]) })), "test", manifest.key), /64 KiB/);
});

for (const mode of ["good", "size", "corrupt", "truncated", "interrupted", "existing"] as const) {
  test(`remote download ${mode}: verified bytes only, no partial publication`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ao-backup-test-"));
    const output = path.join(directory, "backup.dump");
    const commands: unknown[] = [];
    try {
      if (mode === "existing") await writeFile(output, "keep me");
      const fake = client(async (command) => {
        commands.push(command);
        if (command instanceof HeadObjectCommand) return { ContentLength: mode === "size" ? bytes.length + 1 : bytes.length, ETag: "etag", VersionId: "v1" };
        assert.ok(command instanceof GetObjectCommand);
        assert.equal(command.input.IfMatch, "etag");
        assert.equal(command.input.VersionId, "v1");
        let body: Readable = Readable.from([mode === "corrupt" ? Buffer.alloc(bytes.length) : mode === "truncated" ? bytes.subarray(1) : bytes]);
        if (mode === "interrupted") body = Readable.from((async function* () { yield bytes.subarray(0, 5); throw new Error("connection lost"); })());
        return { Body: body, ContentLength: bytes.length, VersionId: "v1" };
      });
      if (mode === "good") {
        const result = await verifyRemoteBackup(fake, manifest, output);
        assert.equal(result.sha256, manifest.sha256);
        assert.deepEqual(await readFile(output), bytes);
      } else {
        await assert.rejects(verifyRemoteBackup(fake, manifest, output));
        if (mode === "existing") assert.equal(await readFile(output, "utf8"), "keep me");
        else await assert.rejects(readFile(output));
      }
      assert.equal((await readdir(directory)).filter((file) => file.endsWith(".partial")).length, 0);
      if (mode === "size") assert.equal(commands.length, 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
