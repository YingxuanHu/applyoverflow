import { notFound, redirect } from "next/navigation";

import { getOptionalSessionUser } from "@/lib/current-user";
import { isOpsAdminEmail } from "@/lib/ops-admin";

export async function requireOpsAdmin(callbackPath: string) {
  const sessionUser = await getOptionalSessionUser();

  if (!sessionUser) {
    redirect(`/?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }

  if (!isOpsAdminEmail(sessionUser.email)) {
    notFound();
  }

  return sessionUser;
}
