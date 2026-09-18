import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { importUploadedResumeForProfile } from "../../src/lib/profile-resume-service";
import {
  INITIAL_ONBOARDING,
  ONBOARDING_KEY,
  parseOnboardingState,
} from "../../src/lib/profile-setup";

async function main() {
  assert.ok(
    isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL),
    "local database required",
  );
  const objects = new Map<string, Buffer>();
  const server = createServer(async (request, response) => {
    const key = new URL(request.url!, "http://localhost").pathname;
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"fixture"' }).end();
    } else if (request.method === "DELETE") {
      objects.delete(key);
      response.writeHead(204).end();
    } else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  Object.assign(process.env, {
    STORAGE_BUCKET: "onboarding-test",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY_ID: "test-only",
    STORAGE_SECRET_ACCESS_KEY: "test-only",
    STORAGE_FORCE_PATH_STYLE: "true",
    STORAGE_ENDPOINT: `http://127.0.0.1:${address.port}`,
  });

  const user = await prisma.user.create({
    data: {
      name: "Resume Fixture",
      email: `setup-${randomUUID()}@example.invalid`,
    },
  });
  const profile = await prisma.userProfile.create({
    data: { authUserId: user.id, name: user.name, email: user.email },
  });
  const file = new File(
    [
      "Jordan Example\njordan@example.invalid\n416-555-0100\nToronto, ON\n\nSUMMARY\nFinancial analyst with reporting experience.\n\nSKILLS\nExcel, Financial analysis, SQL\n\nEXPERIENCE\nFinancial Analyst\nExample Corp\n2022 - Present\nToronto, ON\nPrepared financial reports and reviewed forecasts.\n\nEDUCATION\nExample University\nBachelor of Commerce\n2018 - 2022\n",
    ],
    "onboarding-fixture.txt",
    { type: "text/plain" },
  );
  const upload = (setupRevision: number) =>
    importUploadedResumeForProfile({
      user: profile,
      file,
      titleRaw: "Fixture resume",
      makePrimary: false,
      allowAiParse: false,
      reviewOnly: true,
      setupRevision,
    });
  const storageKeys: string[] = [];
  try {
    await assert.rejects(
      upload(0),
      /Setup changed/,
      "existing users are not silently enrolled",
    );
    await prisma.userPreference.create({
      data: {
        userId: profile.id,
        key: ONBOARDING_KEY,
        value: JSON.stringify(INITIAL_ONBOARDING),
      },
    });
    const result = await upload(0);
    assert.equal(result.revision, 1);
    assert.ok(result.draft?.skills.some((skill) => /excel/i.test(skill.name)));
    assert.ok(result.draft?.experiences.length);
    const unchanged = await prisma.userProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    assert.equal(
      unchanged.updatedAt.toISOString(),
      profile.updatedAt.toISOString(),
      "resume import must not confirm extracted facts",
    );
    assert.equal(unchanged.skillsJson, null);
    const state = parseOnboardingState(
      (
        await prisma.userPreference.findUniqueOrThrow({
          where: { userId_key: { userId: profile.id, key: ONBOARDING_KEY } },
        })
      ).value,
    );
    assert.deepEqual(
      state?.draft,
      result.draft,
      "review draft survives reload",
    );
    assert.equal(state?.step, 1);
    await assert.rejects(
      upload(0),
      /Setup changed/,
      "stale imports cannot overwrite a newer draft",
    );
    const simultaneous = await Promise.allSettled([upload(1), upload(1)]);
    assert.equal(
      simultaneous.filter((entry) => entry.status === "fulfilled").length,
      1,
    );
    assert.equal(
      simultaneous.filter((entry) => entry.status === "rejected").length,
      1,
    );
    const documents = await prisma.document.findMany({
      where: { userId: profile.id },
    });
    storageKeys.push(...documents.map((document) => document.storageKey));
    assert.equal(documents.length, 2);
    assert.equal(
      objects.size,
      2,
      "losing concurrent import cleans up its uploaded object",
    );
    assert.equal(documents.filter((document) => document.isPrimary).length, 1);
    console.log(
      "PASS: local resume extraction, review-before-save, persisted draft, existing-account isolation, stale revision and concurrent import cleanup",
    );
  } finally {
    storageKeys.push(
      ...(
        await prisma.document.findMany({
          where: { userId: profile.id },
          select: { storageKey: true },
        })
      ).map((document) => document.storageKey),
    );
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.storageDeletionTask.deleteMany({
      where: { storageKey: { in: storageKeys } },
    });
    await prisma.$disconnect();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
