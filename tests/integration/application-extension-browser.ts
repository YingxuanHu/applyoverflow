import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

async function main() {
  assert.ok(
    isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL),
    "Local database required",
  );
  assert.ok(
    process.env.EXTENSION_TEST_PROFILE,
    "Use the dedicated test Chrome profile with supported-site permission approved",
  );
  const email = `extension-browser-${randomBytes(8).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const user = await prisma.user.create({
    data: {
      email,
      name: "Extension Browser Fixture",
      emailVerified: true,
      profile: {
        create: {
          email,
          name: "Extension Browser Fixture",
          contactJson: {
            fullName: "Jordan Example",
            givenName: "Jordan",
            familyName: "Example",
            email,
            phone: "+14165550100",
            linkedInUrl: "https://www.linkedin.com/in/example",
          },
          experiencesJson: [
            { title: "Analyst", company: "Reference Fixture", time: "", dates: { start: "2020", end: "2022-06", current: false }, description: "Reviewed reports." },
            { title: "Senior Analyst", company: "Reference Fixture", time: "", dates: { start: "2024-03", end: "", current: true } },
          ],
          educationsJson: [{ school: "Example University", degree: "BA", time: "2016 - 2020" }],
        },
      },
    },
  });
  const resumeRoot = `data/uploads/extension-browser-${user.id}`;
  try {
    await mkdir(resumeRoot, { recursive: true });
    const bytes = Buffer.from("%PDF-1.4\nSynthetic browser resume\n%%EOF");
    await writeFile(`${resumeRoot}/resume.pdf`, bytes);
    const profile = await prisma.userProfile.findUniqueOrThrow({
      where: { authUserId: user.id },
    });
    await prisma.document.create({
      data: {
        userId: profile.id,
        type: "RESUME",
        isPrimary: true,
        title: "Browser test resume",
        originalFileName: "Jordan Resume.pdf",
        filename: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        storageKey: `extension-browser-${user.id}/resume.pdf`,
      },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await hashPassword(password),
      },
    });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["scripts/test-application-extension-connection.mjs"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            ASSISTANT_TEST_EMAIL: email,
            ASSISTANT_TEST_PASSWORD: password,
          },
        },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Browser integration failed (${code})`)),
      );
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await rm(resumeRoot, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
