import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readStoredFileBounded } from "../../src/lib/storage";

async function main() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.headers.range || "");
    if (request.url?.includes("missing")) {
      response.writeHead(404, { "Content-Type": "application/xml" });
      response.end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    response.end(
      request.url?.includes("oversized")
        ? Buffer.alloc(2048)
        : Buffer.from("small remote file"),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  Object.assign(process.env, {
    STORAGE_ENDPOINT: `http://127.0.0.1:${address.port}`,
    STORAGE_BUCKET: "fixture",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY_ID: "synthetic",
    STORAGE_SECRET_ACCESS_KEY: "synthetic",
    STORAGE_FORCE_PATH_STYLE: "true",
  });
  try {
    assert.equal(
      (
        await readStoredFileBounded("ao-storage-fixture/small", 1024)
      )?.toString(),
      "small remote file",
    );
    assert.equal(
      await readStoredFileBounded("ao-storage-fixture/missing", 1024),
      null,
    );
    await assert.rejects(
      () => readStoredFileBounded("ao-storage-fixture/oversized", 1024),
      /limit/,
    );
    assert.deepEqual(requests, [
      "bytes=0-1024",
      "bytes=0-1024",
      "bytes=0-1024",
    ]);
    console.log(
      "PASS: bounded remote storage read, missing object, range request and oversize rejection even when the server ignores Range; no local copy",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
