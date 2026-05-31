"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function UserTimeZoneCookie({
  cookieName,
  currentTimeZone,
}: {
  cookieName: string;
  currentTimeZone: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTimeZone || browserTimeZone === currentTimeZone) return;

    document.cookie = [
      `${cookieName}=${encodeURIComponent(browserTimeZone)}`,
      "Path=/",
      "Max-Age=31536000",
      "SameSite=Lax",
    ].join("; ");

    router.refresh();
  }, [cookieName, currentTimeZone, router]);

  return null;
}
