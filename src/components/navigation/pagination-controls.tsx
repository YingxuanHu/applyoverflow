import Form from "next/form";
import { PaginationLink } from "@/components/navigation/pagination-link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

type PaginationControlsProps = {
  ariaLabel: string;
  basePath: string;
  currentPage: number;
  getPageHref: (page: number) => string;
  hasNextPage: boolean;
  pageError?: string | null;
  placement?: "top" | "bottom";
  searchParams: SearchParamsRecord;
  totalPages: number | null;
};

export function PaginationControls({
  ariaLabel,
  basePath,
  currentPage,
  getPageHref,
  hasNextPage,
  pageError,
  placement = "bottom",
  searchParams,
  totalPages,
}: PaginationControlsProps) {
  const previousPage = Math.max(1, currentPage - 1);
  const nextPage = currentPage + 1;
  const hasPrevious = currentPage > 1;
  const hasKnownNext = totalPages !== null ? currentPage < totalPages : hasNextPage;
  const pageInputId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-page`;
  const containerClassName =
    placement === "top"
      ? "mt-2 flex items-center justify-between gap-3 overflow-x-auto border-t border-border/60 pt-2 pb-1"
      : "mt-5 flex items-center justify-between gap-3 overflow-x-auto border-t border-border/60 pt-4";

  return (
    <nav
      aria-label={ariaLabel}
      className={containerClassName}
    >
      <div className="flex min-w-max items-center gap-2 text-sm text-muted-foreground">
        <span>Page</span>
        <Form
          action={basePath}
          className="flex"
          scroll={false}
        >
          {buildHiddenSearchInputs(searchParams)}
          <label className="sr-only" htmlFor={pageInputId}>
            Jump to page
          </label>
          <div className="inline-flex h-8 overflow-hidden rounded-[10px] border border-input/80 bg-background">
            <input
              aria-describedby={pageError ? `${pageInputId}-error` : undefined}
              aria-invalid={pageError ? true : undefined}
              className="w-12 border-0 border-r border-input/80 bg-transparent px-1 text-center text-sm tabular-nums text-foreground outline-none transition-colors focus-visible:bg-muted/40 aria-invalid:border-destructive/60 aria-invalid:ring-2 aria-invalid:ring-destructive/15"
              defaultValue={currentPage}
              id={pageInputId}
              inputMode="numeric"
              key={currentPage}
              max={totalPages ?? undefined}
              min={1}
              name="page"
              type="number"
            />
            <button
              aria-label="Go to page"
              className="inline-flex w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
              title="Go to page"
              type="submit"
            >
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </Form>
        {totalPages !== null ? (
          <span className="tabular-nums">
            of <span className="font-medium text-foreground">{totalPages.toLocaleString()}</span>
          </span>
        ) : null}
        {pageError ? (
          <span className="text-xs text-destructive" id={`${pageInputId}-error`}>
            {pageError}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-max items-center gap-2">
        <PageLink disabled={!hasPrevious} href={getPageHref(previousPage)}>
          <ChevronLeft className="size-3.5" />
          Previous
        </PageLink>
        <PageLink disabled={!hasKnownNext} href={getPageHref(nextPage)}>
          Next
          <ChevronRight className="size-3.5" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  children,
  disabled,
  href,
}: {
  children: ReactNode;
  disabled?: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-input px-2.5 text-sm text-muted-foreground opacity-40">
        {children}
      </span>
    );
  }

  return (
    <PaginationLink href={href}>
      {children}
    </PaginationLink>
  );
}

function buildHiddenSearchInputs(searchParams: SearchParamsRecord) {
  return Object.entries(searchParams).flatMap(([key, value]) => {
    if (key === "page") return [];
    const values = Array.isArray(value) ? value : [value];

    return values
      .filter((item): item is string => Boolean(item))
      .map((item, index) => (
        <input
          key={`${key}-${index}`}
          name={key}
          type="hidden"
          value={item}
        />
      ));
  });
}
