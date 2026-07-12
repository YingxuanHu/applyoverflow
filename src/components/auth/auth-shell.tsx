import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, FileText, ListChecks } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";

type AuthShellProps = {
  contextTitle: ReactNode;
  contextDescription: string;
  footer?: ReactNode;
  children: ReactNode;
  mobileMode?: "landing" | "form";
};

export function AuthShell({
  contextTitle,
  contextDescription,
  footer,
  children,
  mobileMode = "form",
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
    <main className="min-h-dvh overflow-x-hidden bg-background">
      {mobileMode === "landing" ? (
        <MobileAuthLanding
          contextDescription={contextDescription}
          contextTitle={contextTitle}
          previewItems={previewItems}
        />
      ) : (
        <MobileAuthFormFrame>{children}</MobileAuthFormFrame>
      )}

      <div className="hidden min-h-dvh items-center px-6 py-10 md:flex lg:px-8">
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
                      className="flex min-w-0 items-center gap-3 rounded-[18px] bg-muted/45 p-3 sm:block sm:rounded-[20px] sm:p-4"
                      key={item.label}
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
      </div>
    </main>
  );
}

type PreviewItem = {
  label: string;
  value: string;
  icon: typeof BriefcaseBusiness;
};

type MobileAuthLandingProps = {
  contextTitle: ReactNode;
  contextDescription: string;
  previewItems: PreviewItem[];
};

function MobileAuthLanding({
  contextTitle,
  contextDescription,
  previewItems,
}: MobileAuthLandingProps) {
  return (
    <section
      className="flex min-h-dvh flex-col px-5 md:hidden"
      style={{
        paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        paddingTop: "max(1.25rem, env(safe-area-inset-top))",
      }}
    >
      <Link
        aria-label="Go to sign in"
        className="inline-flex w-fit items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        href="/sign-in"
      >
        <BrandLogo
          iconClassName="size-10"
          priority
          textClassName="text-[1.55rem]"
        />
      </Link>

      <div className="flex flex-1 flex-col justify-center py-5">
        <p className="section-label">Smarter job search workspace</p>
        <h1 className="mt-4 max-w-[18rem] text-[2.75rem] font-semibold leading-[0.98] tracking-tight text-foreground min-[390px]:max-w-[21rem] min-[390px]:text-[3.05rem]">
          {contextTitle}
        </h1>
        <p className="mt-4 max-w-[21rem] text-base leading-7 text-muted-foreground">
          {contextDescription}
        </p>

        <div className="auth-mobile-scan mt-5 rounded-[26px] border border-border/70 bg-card/55 p-2.5 shadow-[0_22px_70px_rgba(0,0,0,0.16)] backdrop-blur">
          <div className="space-y-2.5">
            {previewItems.map((item, index) => {
              const Icon = item.icon;
              const style = { "--auth-delay": `${index * 90}ms` } as CSSProperties;

              return (
                <div
                  className="auth-mobile-card flex min-w-0 items-center gap-3.5 rounded-[20px] bg-muted/45 px-3.5 py-3"
                  key={item.label}
                  style={style}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-background/70 text-muted-foreground">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold leading-6 text-foreground">
                      {item.label}
                    </p>
                    <p className="truncate text-[0.93rem] leading-5 text-muted-foreground">
                      {item.value}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-4 pb-1">
        <Link
          className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-[0_10px_28px_rgba(10,132,255,0.24)] transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 active:scale-[0.99]"
          href="/sign-up"
        >
          Join now
          <ArrowRight className="size-4" />
        </Link>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
        <p className="mx-auto w-fit rounded-full border border-border/70 bg-card/70 px-5 py-2 text-sm font-semibold text-muted-foreground">
          applyoverflow.com
        </p>
      </div>
    </section>
  );
}

function MobileAuthFormFrame({ children }: { children: ReactNode }) {
  return (
    <section
      className="flex min-h-dvh flex-col overflow-x-hidden px-4 md:hidden"
      style={{
        paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        paddingTop: "max(1.25rem, env(safe-area-inset-top))",
      }}
    >
      <Link
        aria-label="Go to home"
        className="mb-5 inline-flex w-fit items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        href="/"
      >
        <BrandLogo
          iconClassName="size-9"
          priority
          textClassName="text-[1.35rem]"
        />
      </Link>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-3">
        {children}
      </div>
    </section>
  );
}
