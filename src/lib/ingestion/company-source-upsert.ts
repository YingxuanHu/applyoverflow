import { prisma } from "@/lib/db";
import { Prisma, type CompanySource } from "@/generated/prisma/client";

type CompanySourceIdentity = {
  companyId: string;
  connectorName: string;
  token: string;
  sourceName: string;
  atsTenantId?: string | null;
};

type UpsertCompanySourceByIdentityInput = {
  identity: CompanySourceIdentity;
  create: Prisma.CompanySourceUncheckedCreateInput;
  update: Prisma.CompanySourceUncheckedUpdateInput;
};

type CompanySourceIdentityMatch = {
  id: string;
  companyId: string;
  connectorName: string;
  token: string;
  sourceName: string;
  atsTenantId: string | null;
  updatedAt: Date;
};

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function identityMatchesCompound(
  match: Pick<CompanySourceIdentityMatch, "companyId" | "connectorName" | "token">,
  identity: CompanySourceIdentity
) {
  return (
    match.companyId === identity.companyId &&
    match.connectorName === identity.connectorName &&
    match.token === identity.token
  );
}

function scoreIdentityMatch(
  match: CompanySourceIdentityMatch,
  identity: CompanySourceIdentity
) {
  let score = 0;

  if (identity.atsTenantId && match.atsTenantId === identity.atsTenantId) {
    score += 8;
  }
  if (match.sourceName === identity.sourceName) {
    score += 4;
  }
  if (identityMatchesCompound(match, identity)) {
    score += 2;
  }

  return score;
}

function chooseCanonicalIdentityMatch(
  matches: CompanySourceIdentityMatch[],
  identity: CompanySourceIdentity
) {
  return [...matches].sort((left, right) => {
    const scoreDelta =
      scoreIdentityMatch(right, identity) - scoreIdentityMatch(left, identity);
    if (scoreDelta !== 0) return scoreDelta;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0] ?? null;
}

function buildIdentityWhere(identity: CompanySourceIdentity): Prisma.CompanySourceWhereInput {
  const clauses: Prisma.CompanySourceWhereInput[] = [
    { sourceName: identity.sourceName },
    {
      companyId: identity.companyId,
      connectorName: identity.connectorName,
      token: identity.token,
    },
  ];

  if (identity.atsTenantId) {
    clauses.unshift({ atsTenantId: identity.atsTenantId });
  }

  return { OR: clauses };
}

function buildSafeIdentityUpdate(
  input: UpsertCompanySourceByIdentityInput,
  existing: CompanySourceIdentityMatch,
  matches: CompanySourceIdentityMatch[]
): Prisma.CompanySourceUncheckedUpdateInput {
  const updateData: Prisma.CompanySourceUncheckedUpdateInput = {
    ...input.update,
  };

  const sourceNameConflict = matches.some(
    (match) => match.id !== existing.id && match.sourceName === input.identity.sourceName
  );
  if (!sourceNameConflict) {
    updateData.sourceName = input.identity.sourceName;
  }

  const compoundConflict = matches.some(
    (match) =>
      match.id !== existing.id &&
      identityMatchesCompound(match, input.identity)
  );
  if (!compoundConflict) {
    updateData.companyId = input.identity.companyId;
    updateData.connectorName = input.identity.connectorName;
    updateData.token = input.identity.token;
  }

  if (input.identity.atsTenantId !== undefined) {
    const atsTenantConflict = matches.some(
      (match) =>
        match.id !== existing.id && match.atsTenantId === input.identity.atsTenantId
    );
    if (!atsTenantConflict) {
      updateData.atsTenantId = input.identity.atsTenantId ?? null;
    }
  }

  return updateData;
}

export async function upsertCompanySourceByIdentity(
  input: UpsertCompanySourceByIdentityInput
): Promise<CompanySource> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const matches = await prisma.companySource.findMany({
      where: buildIdentityWhere(input.identity),
      select: {
        id: true,
        companyId: true,
        connectorName: true,
        token: true,
        sourceName: true,
        atsTenantId: true,
        updatedAt: true,
      },
    });

    const existing = chooseCanonicalIdentityMatch(matches, input.identity);

    if (matches.length > 1) {
      console.warn(
        `[company-source-upsert] Multiple identity matches for ${input.identity.connectorName}:${input.identity.token} (company ${input.identity.companyId}) — using ${existing?.id ?? "none"} from [${matches.map((match) => match.id).join(", ")}]`
      );
    }

    try {
      if (existing) {
        return await prisma.companySource.update({
          where: { id: existing.id },
          data: buildSafeIdentityUpdate(input, existing, matches),
        });
      }

      return await prisma.companySource.create({
        data: input.create,
      });
    } catch (error) {
      if (attempt === 0 && isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to upsert CompanySource for ${input.identity.connectorName}:${input.identity.token}`
  );
}
