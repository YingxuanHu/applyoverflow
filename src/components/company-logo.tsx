"use client";

import { useCallback, useState } from "react";
import {
  companyInitials,
  normalizeCompanyLogoDomain,
} from "@/lib/company-logo";
import { cn } from "@/lib/utils";

export function CompanyLogo({
  company,
  domain,
  size = "sm",
}: {
  company: string;
  domain?: string | null;
  size?: "sm" | "md";
}) {
  const host = normalizeCompanyLogoDomain(domain);
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      // Cached failures can finish before hydration attaches onError.
      if (image?.complete && image.naturalWidth === 0) setFailedHost(host);
    },
    [host],
  );
  return (
    <span
      aria-hidden="true"
      data-company-logo
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted text-xs font-semibold text-muted-foreground",
        size === "sm" ? "size-7" : "size-9",
      )}
    >
      {companyInitials(company)}
      {host && failedHost !== host ? (
        // Native image deliberately bypasses Next's on-disk image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={host}
          ref={imageRef}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          src={`/api/company-logo?domain=${encodeURIComponent(host)}`}
          onError={() => setFailedHost(host)}
          className="absolute inset-0 size-full bg-white object-contain p-1"
        />
      ) : null}
    </span>
  );
}
