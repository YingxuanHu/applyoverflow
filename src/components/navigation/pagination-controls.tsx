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
  const pageInputId = `${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${placement}-page`;
  const containerClassName =
    placement === "top"
      ? "mt-2 flex flex-wrap items-center gap-3 border-t border-border/60 pt-2 pb-1"
      : "mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4";

  return (
    <nav
      aria-label={ariaLabel}
      className={containerClassName}
    >
      <div className="flex shrink-0 items-center gap-1">
        <PageLink label="Previous page" disabled={!hasPrevious} href={getPageHref(previousPage)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </PageLink>
        <PageLink label="Next page" disabled={!hasKnownNext} href={getPageHref(nextPage)}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </PageLink>
      </div>
      <div className="flex min-w-max items-center gap-2 text-sm text-muted-foreground">
        <label htmlFor={pageInputId}>Page</label>
        <Form
          action={basePath}
          className="flex"
          scroll={false}
        >
          {buildHiddenSearchInputs(searchParams)}
          <div className="inline-flex h-9 overflow-hidden rounded-md border border-input/80 bg-background focus-within:ring-2 focus-within:ring-ring/30">
            <input
              aria-label="Jump to page"
              aria-describedby={pageError ? `${pageInputId}-error` : undefined}
              aria-invalid={pageError ? true : undefined}
              className="w-14 appearance-none border-0 bg-transparent px-1 text-center text-sm tabular-nums text-foreground outline-none transition-colors focus-visible:bg-muted/40 aria-invalid:ring-2 aria-invalid:ring-destructive/15 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [appearance:textfield]"
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
              className="inline-flex w-9 items-center justify-center border-l border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
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
      </div>
      {pageError ? <p className="basis-full text-xs text-destructive" role="alert" id={`${pageInputId}-error`}>{pageError}</p> : null}
    </nav>
  );
}

function PageLink({
  children,
  disabled,
  href,
  label,
}: {
  children: ReactNode;
  disabled?: boolean;
  href: string;
  label: string;
}) {
  if (disabled) {
    return (
      <button type="button" disabled aria-label={label} title={label} className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground opacity-35">
        {children}
      </button>
    );
  }

  return (
    <PaginationLink href={href} label={label}>
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
