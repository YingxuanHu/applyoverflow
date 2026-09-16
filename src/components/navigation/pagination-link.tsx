"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function PaginationLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} prefetch={true} scroll={false} className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      <PageLinkContent>{children}</PageLinkContent>
    </Link>
  );
}

function PageLinkContent({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <>
    <span className={`inline-flex items-center gap-1 ${pending ? "invisible" : ""}`}>{children}</span>
    {pending ? <span role="status" className="absolute inset-0 flex items-center justify-center"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /><span className="sr-only">Loading page</span></span> : null}
  </>;
}
