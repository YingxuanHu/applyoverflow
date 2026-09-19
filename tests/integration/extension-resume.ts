import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { hashSecret } from "../../src/lib/queries/application-assistant";
import {
  requestExtensionResume,
  getExtensionResumeChoice,
  approveExtensionResume,
  exchangeExtensionResume,
} from "../../src/lib/queries/extension-resume";
import { readStoredFileBounded } from "../../src/lib/storage";

async function main() {
  assert.ok(
    isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL),
    "Local database required",
  );
  const suffix = randomBytes(8).toString("hex");
  const root = `data/uploads/extension-resume-test-${suffix}`;
  const storageKey = `extension-resume-test-${suffix}/resume.pdf`;
  const pdf = Buffer.from("%PDF-1.4\nSynthetic resume only\n%%EOF");
  const clientId = "a".repeat(32);
  process.env.APPLICATION_EXTENSION_IDS = clientId;
  const user = await prisma.user.create({
    data: {
      name: "Resume Test",
      email: `resume-${suffix}@example.test`,
      profile: {
        create: { name: "Resume Test", email: `resume-${suffix}@example.test` },
      },
    },
    include: { profile: true },
  });
  const other = await prisma.user.create({
    data: {
      name: "Other",
      email: `resume-other-${suffix}@example.test`,
      profile: {
        create: { name: "Other", email: `resume-other-${suffix}@example.test` },
      },
    },
    include: { profile: true },
  });
  try {
    await mkdir(root, { recursive: true });
    await writeFile(`${root}/resume.pdf`, pdf);
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const connection = await prisma.extensionConnection.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        clientId,
        challenge: "b".repeat(43),
        tokenHash: hashSecret(randomBytes(32).toString("base64url")),
        connectedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const document = await prisma.document.create({
      data: {
        userId: user.profile!.id,
        type: "RESUME",
        title: "Synthetic resume",
        originalFileName: "Test Resume.pdf",
        filename: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        storageKey,
      },
    });
    const foreign = await prisma.document.create({
      data: {
        userId: other.profile!.id,
        type: "RESUME",
        title: "Private other resume",
        originalFileName: "Private.pdf",
        filename: "private.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: `extension-resume-test-${suffix}/other.pdf`,
      },
    });
    const identity = { userId: user.id, connectionId: connection.id };
    const webIdentity = { authUserId: user.id, sessionId: session.id };
    const url = "https://job-boards.greenhouse.io/fixture/jobs/123";
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const request = () =>
      requestExtensionResume(identity, {
        url,
        challenge: hashSecret(verifier),
        state,
      });
    const approve = (id: string) =>
      approveExtensionResume(webIdentity, { id, documentId: document.id });
    const exchange = (id: string, callback: string, extra = {}) =>
      exchangeExtensionResume(identity, {
        id,
        url,
        code: new URL(callback).searchParams.get("code"),
        verifier,
        ...extra,
      });

    const first = await request();
    assert.equal(await getExtensionResumeChoice(other.id, first.id), null);
    const choice = await getExtensionResumeChoice(user.id, first.id);
    assert.deepEqual(
      choice?.documents.map((doc) => doc.id),
      [document.id],
    );
    assert.equal(
      new URL(choice!.cancelUrl).host,
      `${clientId}.chromiumapp.org`,
    );
    assert.equal(new URL(choice!.cancelUrl).searchParams.get("state"), state);
    await assert.rejects(() =>
      approveExtensionResume(webIdentity, {
        id: first.id,
        documentId: foreign.id,
      }),
    );
    await assert.rejects(() =>
      approveExtensionResume(
        { ...webIdentity, sessionId: "another-session" },
        { id: first.id, documentId: document.id },
      ),
    );
    await assert.rejects(() =>
      exchangeExtensionResume(identity, {
        id: first.id,
        url,
        verifier,
        code: "x".repeat(43),
      }),
    );
    const callback = await approve(first.id);
    assert.equal(new URL(callback).searchParams.get("state"), state);
    const grant = await prisma.extensionResumeTransfer.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.notEqual(grant.codeHash, new URL(callback).searchParams.get("code"));
    await assert.rejects(() => approve(first.id));
    await assert.rejects(() =>
      exchange(first.id, callback, { verifier: "y".repeat(43) }),
    );
    await assert.rejects(() =>
      exchange(first.id, callback, { url: url.replace("123", "456") }),
    );
    await assert.rejects(() =>
      exchangeExtensionResume(
        { ...identity, userId: other.id },
        {
          id: first.id,
          url,
          verifier,
          code: new URL(callback).searchParams.get("code"),
        },
      ),
    );
    const raced = await Promise.allSettled([
      exchange(first.id, callback),
      exchange(first.id, callback),
    ]);
    assert.equal(
      raced.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const transferred = raced.find((result) => result.status === "fulfilled");
    assert.ok(transferred?.status === "fulfilled");
    assert.equal(transferred.value.base64, pdf.toString("base64"));
    assert.equal(transferred.value.name, "Test Resume.pdf");
    assert.deepEqual(Object.keys(transferred.value).sort(), [
      "base64",
      "mimeType",
      "name",
      "size",
    ]);
    assert.equal(
      await prisma.extensionResumeTransfer.count({ where: { id: first.id } }),
      0,
    );
    await assert.rejects(() => exchange(first.id, callback));

    const changed = await request();
    const changedCallback = await approve(changed.id);
    await prisma.document.update({
      where: { id: document.id },
      data: { title: "Changed resume", updatedAt: new Date(Date.now() + 1000) },
    });
    await assert.rejects(() => exchange(changed.id, changedCallback));
    await prisma.extensionResumeTransfer.delete({ where: { id: changed.id } });

    const expired = await request();
    await prisma.extensionResumeTransfer.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(await getExtensionResumeChoice(user.id, expired.id), null);
    await assert.rejects(() => approve(expired.id));
    const missing = await request();
    const missingCallback = await approve(missing.id);
    await rm(`${root}/resume.pdf`);
    await assert.rejects(
      () => exchange(missing.id, missingCallback),
      /unavailable/,
    );
    assert.equal(
      await prisma.extensionResumeTransfer.count({ where: { id: missing.id } }),
      0,
    );
    await writeFile(`${root}/resume.pdf`, Buffer.alloc(1024));
    await assert.rejects(() => readStoredFileBounded(storageKey, 512), /limit/);
    await writeFile(`${root}/resume.pdf`, pdf);
    assert.deepEqual(await readStoredFileBounded(storageKey, pdf.length), pdf);

    const revoked = await request();
    const revokedCallback = await approve(revoked.id);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(0) },
    });
    await assert.rejects(() => exchange(revoked.id, revokedCallback));
    assert.equal(await getExtensionResumeChoice(user.id, revoked.id), null);
    await prisma.session.delete({ where: { id: session.id } });
    assert.equal(
      await prisma.extensionResumeTransfer.count({
        where: { connectionId: connection.id },
      }),
      0,
    );
    console.log(
      "PASS: resume owner isolation, explicit single-file grant, wrong PKCE/session/URL denial, race/replay protection, file replacement/missing bytes, bounded reads, expiry, session revocation and cascade cleanup",
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [user.id, other.id] } },
    });
    await rm(root, { force: true, recursive: true });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
