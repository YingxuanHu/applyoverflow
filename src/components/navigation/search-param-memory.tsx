"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SearchParamMemoryProps = {
  basePath: string;
  storageKey: string;
};

export function SearchParamMemory({
  basePath,
  storageKey,
}: SearchParamMemoryProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (pathname !== basePath) return;

    const reset = searchParams.get("reset");
    if (reset === "1") {
      sessionStorage.removeItem(storageKey);
      router.replace(basePath);
      return;
    }

    if (search) {
      sessionStorage.setItem(storageKey, search);
      return;
    }

    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      router.replace(`${basePath}?${saved}`);
    }
  }, [basePath, pathname, router, search, searchParams, storageKey]);

  return null;
}
