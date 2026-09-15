"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function PaginationLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={true} scroll={false} className="relative inline-flex h-8 items-center gap-1 rounded-[10px] border border-input/80 bg-background px-2.5 text-sm text-foreground transition-colors hover:bg-muted">
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
