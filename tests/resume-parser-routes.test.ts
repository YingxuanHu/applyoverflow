import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import * as parserRuntime from "../scripts/resume-parser/runtime.cjs";
import * as availability from "../src/lib/service-availability";
import { loadTsModule } from "./helpers/load-ts-module";

type RouteKind = "upload" | "sync";
type ServiceInput = { signal?: AbortSignal; user: { id: string }; file?: File; documentId?: string };
const user = { id: "profile-1", email: "test@example.invalid" };
class UnauthorizedError extends Error {}
class AiAccessDeniedError extends Error {}

function fixture(kind: RouteKind) {
  const calls: ServiceInput[] = [];
  const state = {
    error: null as unknown,
    authError: null as unknown,
    revalidated: 0,
    rateLimited: false,
    run: null as null | ((input: ServiceInput) => Promise<unknown>),
  };
  const parser = loadTsModule<typeof import("../src/lib/resume-parser")>("src/lib/resume-parser.ts", {
    "server-only": {}, "../../scripts/resume-parser/runtime.cjs": parserRuntime,
  });
  const current = {
    UnauthorizedError, AiAccessDeniedError,
    requireCurrentUserProfile: async () => {
      if (state.authError) throw state.authError;
      return user;
    },
  };
  const api = loadTsModule<typeof import("../src/lib/api-utils")>("src/lib/api-utils.ts", {
    "@/lib/current-user": current, "@/lib/service-availability": availability,
    "@/lib/api-rate-limit": {
      enforceApiRateLimit: async () => state.rateLimited ? Response.json({ error: "Too many requests" }, { status: 429 }) : null,
    },
  });
  const service = async (input: ServiceInput) => {
    calls.push(input);
    if (state.error) throw state.error;
    if (state.run) await state.run(input);
    return { message: "Resume imported.", revision: 4 };
  };
  const imports = {
    "@/lib/api-utils": api,
    "@/lib/api-rate-limit": { API_RATE_LIMITS: { documentUpload: {}, documentSync: {} } },
    "@/lib/ai-access": { isAiFeatureAllowed: () => false },
    "@/lib/current-user": current,
    "@/lib/db": { prisma: {} },
    "@/lib/profile-resume-service": { importUploadedResumeForProfile: service, syncStoredResumeForProfile: service },
    "@/lib/resume-parser": parser,
    "@/lib/revalidation": { revalidateProfileViews: () => { state.revalidated++; } },
    "@/lib/storage": { getStorageReadiness: () => ({ configured: true }) },
  };
  const upload = kind === "upload"
    ? loadTsModule<typeof import("../src/app/api/profile/resumes/route")>("src/app/api/profile/resumes/route.ts", imports, { File })
    : null;
  const sync = kind === "sync"
    ? loadTsModule<typeof import("../src/app/api/profile/resumes/[id]/sync/route")>("src/app/api/profile/resumes/[id]/sync/route.ts", imports)
    : null;
  const request = (signal?: AbortSignal, includeFile = true) => {
    const formData = new FormData();
    formData.set("profileId", user.id);
    if (includeFile) formData.set("file", new File(["Taylor Applicant"], "resume.txt", { type: "text/plain" }));
    return new NextRequest(`https://app.example/api/profile/resumes${kind === "sync" ? "/resume-1/sync" : ""}`, {
      method: "POST", signal, ...(kind === "upload" ? { body: formData } : {}),
    });
  };
  const post = (req: NextRequest) => upload ? upload.POST(req) : sync!.POST(req, { params: Promise.resolve({ id: "resume-1" }) });
  return { state, calls, request, post };
}

for (const kind of ["upload", "sync"] as const) {
  test(`${kind} forwards the exact request signal and preserves its successful API response`, async () => {
    const f = fixture(kind);
    const request = f.request(new AbortController().signal);
    const response = await f.post(request);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].signal, request.signal);
    assert.equal(f.calls[0].user.id, user.id);
    if (kind === "upload") assert.equal(f.calls[0].file?.name, "resume.txt");
    else assert.equal(f.calls[0].documentId, "resume-1");
    assert.equal(response.status, kind === "upload" ? 201 : 200);
    assert.deepEqual(await response.json(), kind === "upload" ? { message: "Resume imported.", revision: 4 } : { message: "Resume imported." });
    assert.equal(f.state.revalidated, 1);
  });

  test(`${kind} preserves parser statuses and retry metadata without exposing internal errors`, async () => {
    const f = fixture(kind);
    for (const code of ["BUSY", "UNAVAILABLE", "TIMEOUT", "MEMORY_LIMIT", "INVALID", "ENCRYPTED", "UNSUPPORTED", "INPUT_LIMIT", "ARCHIVE_LIMIT", "PAGE_LIMIT", "IMAGE_LIMIT", "OUTPUT_LIMIT", "CANCELLED"]) {
      const error = new parserRuntime.ResumeParserError(code);
      Object.assign(error, { cause: new Error("private-parser-details"), stack: "private-parser-stack" });
      f.state.error = error;
      const response = await f.post(f.request());
      assert.equal(response.status, error.status, code);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("retry-after"), error.status === 503 ? "15" : null);
      assert.deepEqual(await response.json(), { error: error.message, code, retryable: error.retryable });
    }
    assert.equal(f.state.revalidated, 0, "failed parsing must not refresh the profile as though it was imported");
  });

  test(`${kind} request cancellation reaches the isolated parser and is not reported as success`, async () => {
    const f = fixture(kind);
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolveStarted) => { entered = resolveStarted; });
    f.state.run = (input) => {
      const parsing = parserRuntime.parseResume(Buffer.from("spin"), "resume.txt", "text/plain", {
        signal: input.signal, workerPath: resolve("tests/fixtures/resume-parser-probe.cjs"),
      });
      entered();
      return parsing;
    };
    const request = f.request(controller.signal);
    const pending = f.post(request);
    await started;
    controller.abort();
    const response = await pending;
    assert.equal(response.status, new parserRuntime.ResumeParserError("CANCELLED").status);
    const body = await response.json();
    assert.equal(body.code, "CANCELLED");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal(f.state.revalidated, 0);
  });

  test(`${kind} keeps auth, rate-limit and ordinary validation errors unchanged`, async () => {
    const f = fixture(kind);
    f.state.authError = new UnauthorizedError();
    assert.equal((await f.post(f.request())).status, 401);
    assert.equal(f.calls.length, 0);
    f.state.authError = null;
    f.state.rateLimited = true;
    assert.equal((await f.post(f.request())).status, 429);
    assert.equal(f.calls.length, 0);
    f.state.rateLimited = false;
    if (kind === "upload") {
      assert.equal((await f.post(f.request(undefined, false))).status, 400);
      assert.equal(f.calls.length, 0);
    }
    // Arbitrary status-looking properties must not be treated as trusted parser metadata.
    f.state.error = Object.assign(new Error("Resume not found."), { status: 503, code: "BUSY", retryable: true });
    const response = await f.post(f.request());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Resume not found." });
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal(f.state.revalidated, 0);
  });
}
