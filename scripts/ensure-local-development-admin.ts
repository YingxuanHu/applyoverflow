import {
  isLocalDevelopmentAuthEnabled,
  isLocalDevelopmentDatabaseUrl,
  LOCAL_DEVELOPMENT_ADMIN,
} from "../src/lib/local-development-auth";

async function main() {
  if (
    process.env.LOCAL_DEVELOPMENT_AUTH_SEED !== "1" ||
    !isLocalDevelopmentAuthEnabled() ||
    !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)
  ) {
    console.log(
      "[local-auth] Skipped: a localhost app, a loopback PostgreSQL database on port 5432, and LOCAL_DEVELOPMENT_AUTH_SEED=1 are required."
    );
    return;
  }

  const [{ hashPassword }, { prisma }, { syncProfileForAuthUser }] = await Promise.all([
    import("better-auth/crypto"),
    import("../src/lib/db"),
    import("../src/lib/user-profile-sync"),
  ]);

  try {
    const passwordHash = await hashPassword(LOCAL_DEVELOPMENT_ADMIN.password);
    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { email: LOCAL_DEVELOPMENT_ADMIN.email },
      });
      let createdUser = false;
      let createdPassword = false;

      if (!user) {
        user = await tx.user.create({
          data: {
            email: LOCAL_DEVELOPMENT_ADMIN.email,
            name: LOCAL_DEVELOPMENT_ADMIN.name,
            emailVerified: true,
            status: "ACTIVE",
          },
        });
        createdUser = true;
      }

      const credentialAccount = await tx.account.findFirst({
        where: {
          userId: user.id,
          providerId: "credential",
        },
        select: {
          id: true,
          password: true,
        },
      });

      if (!credentialAccount) {
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: "credential",
            accountId: user.id,
            password: passwordHash,
          },
        });
        createdPassword = true;
      } else if (!credentialAccount.password) {
        await tx.account.update({
          where: { id: credentialAccount.id },
          data: { password: passwordHash },
        });
        createdPassword = true;
      }

      return { user, createdPassword, createdUser };
    });

    await syncProfileForAuthUser(result.user);

    const action = result.createdUser
      ? "Created"
      : result.createdPassword
        ? "Repaired"
        : "Confirmed";
    console.log(
      `[local-auth] ${action} local sign-in: ${LOCAL_DEVELOPMENT_ADMIN.username} / ${LOCAL_DEVELOPMENT_ADMIN.password}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error("[local-auth] Unable to prepare the local account:", error);
    process.exitCode = 1;
  });
