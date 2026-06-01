import { NavSidebar } from "./nav-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-hidden bg-background">
      <div className="flex h-full min-h-0">
        <NavSidebar />
        <main className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-y-auto">
          <TopBar />
          <div className="min-h-full min-w-0 flex-1 pb-[env(safe-area-inset-bottom)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
