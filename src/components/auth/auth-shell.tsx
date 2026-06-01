import type { ReactNode } from "react";
import Link from "next/link";
import { BriefcaseBusiness, FileText, ListChecks } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";

type AuthShellProps = {
  contextTitle: ReactNode;
  contextDescription: string;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthShell({
  contextTitle,
  contextDescription,
  footer,
  children,
}: AuthShellProps) {
  const previewItems = [
    {
      label: "Better jobs",
      value: "cleaner sources",
      icon: BriefcaseBusiness,
    },
    {
      label: "Fresh feed",
      value: "less stale noise",
      icon: ListChecks,
    },
    {
      label: "Apply support",
      value: "documents and answers ready",
      icon: FileText,
    },
  ];

  return (
    <main className="flex min-h-dvh items-center bg-background px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl min-w-0 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,430px)] lg:gap-8">
        <section className="order-2 min-w-0 lg:order-1">
          <Link
            aria-label="Go to sign in"
            className="inline-flex items-center gap-2 rounded-full text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            href="/sign-in"
          >
            <BrandLogo priority />
          </Link>

          <div className="mt-7 max-w-2xl sm:mt-10">
            <p className="section-label">Smarter job search workspace</p>
            <h1 className="mt-3 max-w-xl text-[2.35rem] font-semibold leading-[1.06] tracking-tight text-foreground sm:mt-4 sm:text-5xl">
              {contextTitle}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-5 sm:text-lg sm:leading-7">
              {contextDescription}
            </p>
          </div>

          <div className="mt-6 max-w-xl rounded-[24px] border border-border/60 bg-card/80 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.035)] backdrop-blur sm:mt-8 sm:rounded-[28px] sm:p-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {previewItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="flex min-w-0 items-center gap-3 rounded-[18px] bg-muted/45 p-3 sm:block sm:rounded-[20px] sm:p-4"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground sm:size-9">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground sm:mt-3">
                        {item.label}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground sm:mt-1 sm:text-sm sm:leading-5">
                        {item.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
        </section>

        <section className="order-1 mx-auto flex w-full max-w-[calc(100vw-2rem)] min-w-0 flex-col justify-center sm:max-w-md lg:order-2">
          {children}
        </section>
      </div>
    </main>
  );
}
