import { NavSidebar } from "./nav-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen overflow-hidden bg-background">
      <div className="flex h-full min-h-0">
        <NavSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <TopBar />
          <div className="min-h-full flex-1">{children}</div>
        </main>
      </div>
    </div>
  );
}
