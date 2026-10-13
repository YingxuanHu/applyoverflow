import Link from "next/link";
import { ListChecks, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function WorkflowTabs({ active }: { active: "tracker" | "auto-apply" }) {
  return <nav aria-label="Application workflow" className="flex gap-6 border-b border-border/70">
    {[{ id: "tracker", label: "Tracker", href: "/applications", Icon: ListChecks }, { id: "auto-apply", label: "Auto Apply", href: "/applications/auto-apply", Icon: WandSparkles }].map(({ id, label, href, Icon }) =>
      <Link key={id} href={href} aria-current={active === id ? "page" : undefined} className={cn("inline-flex min-h-11 items-center gap-2 border-b-2 text-sm", active === id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground")}><Icon className="size-4" />{label}</Link>)}
  </nav>;
}
