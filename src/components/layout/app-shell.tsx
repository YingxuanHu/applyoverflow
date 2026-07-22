import { Suspense } from "react";

import { NavSidebar } from "./nav-sidebar";
import { TopBar } from "./top-bar";
import { JobsNavigationPendingBoundary } from "@/components/jobs/jobs-navigation-pending-boundary";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellFrame>{children}</AppShellFrame>}>
      <JobsNavigationPendingBoundary>
        <AppShellFrame>{children}</AppShellFrame>
      </JobsNavigationPendingBoundary>
    </Suspense>
  );
}

function AppShellFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background md:overflow-hidden">
      <div className="flex min-h-dvh min-w-0 md:h-dvh md:min-h-0">
        <NavSidebar />
        <main className="app-scroll-root flex min-h-dvh min-w-0 flex-1 flex-col md:h-dvh md:min-h-0 md:overflow-y-auto">
          <Suspense fallback={null}>
            <TopBar />
          </Suspense>
          <div className="min-h-full min-w-0 flex-1 pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
