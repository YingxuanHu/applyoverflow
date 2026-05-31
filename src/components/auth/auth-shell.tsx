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
    <main className="flex min-h-screen items-center bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,430px)] lg:items-center">
        <section className="order-2 min-w-0 lg:order-1">
          <Link
            aria-label="Go to sign in"
            className="inline-flex items-center gap-2 rounded-full text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            href="/sign-in"
          >
            <BrandLogo priority />
          </Link>

          <div className="mt-10 max-w-2xl">
            <p className="section-label">Smarter job search workspace</p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {contextTitle}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              {contextDescription}
            </p>
          </div>

          <div className="mt-8 max-w-xl rounded-[28px] border border-border/60 bg-card/80 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.035)] backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-3">
              {previewItems.map((item) => {
                const Icon = item.icon;

                return (
                  <div key={item.label} className="min-w-0 rounded-[20px] bg-muted/45 p-4">
                    <div className="flex size-9 items-center justify-center rounded-full bg-card text-muted-foreground">
                      <Icon className="size-4" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.value}</p>
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
