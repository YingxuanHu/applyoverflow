import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireOpsAdmin } from "@/lib/ops-auth";
import { JOB_REPORT_CATEGORIES } from "@/lib/jobs/data-report";

export default async function JobReportsPage({ searchParams }: { searchParams: Promise<{ status?: string; after?: string }> }) {
  await requireOpsAdmin("/ops/job-reports");
  const params = await searchParams;
  const status = ["RESOLVED", "DISMISSED"].includes(params.status ?? "") ? params.status! : "OPEN";
  const reports = await prisma.jobDataReport.findMany({
    where: { status }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 51,
    ...(params.after && params.after.length <= 200 ? { cursor: { id: params.after }, skip: 1 } : {}),
    include: { canonicalJob: { select: { id: true, title: true, company: true } } },
  });
  async function review(form: FormData) {
    "use server";
    await requireOpsAdmin("/ops/job-reports");
    const id = String(form.get("id") ?? "");
    const decision = String(form.get("decision") ?? "");
    if (!id || id.length > 200 || !["RESOLVED", "DISMISSED"].includes(decision) || form.get("verified") !== "on") return;
    await prisma.jobDataReport.updateMany({ where: { id, status: "OPEN" }, data: { status: decision, resolvedAt: new Date() } });
    revalidatePath("/ops/job-reports");
  }
  return <div className="app-page space-y-5">
    <div className="page-header"><h1 className="page-title">Job detail reports</h1><Link href="/ops/ingestion" className="text-sm text-primary">Ingestion</Link></div>
    <nav aria-label="Report status" className="flex gap-5 border-b border-border pb-3">
      {["OPEN", "RESOLVED", "DISMISSED"].map((value) => <Link key={value} aria-current={status === value ? "page" : undefined} className={status === value ? "text-primary" : "text-muted-foreground"} href={`/ops/job-reports?status=${value}`}>{value === "OPEN" ? "Awaiting review" : value === "RESOLVED" ? "Resolved" : "Dismissed"}</Link>)}
    </nav>
    {reports.length === 0 ? <p className="text-muted-foreground">No reports in this queue.</p> : reports.slice(0, 50).map((report) => <article key={report.id} className="space-y-3 border-b border-border py-4">
      <Link href={`/jobs/${report.canonicalJobId}`} className="font-medium text-primary">{report.canonicalJob.title} · {report.canonicalJob.company}</Link>
      <p className="text-xs text-muted-foreground">{JOB_REPORT_CATEGORIES[report.category as keyof typeof JOB_REPORT_CATEGORIES] ?? "Other"} · {report.createdAt.toISOString().slice(0, 10)}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{report.details}</p>
      {status === "OPEN" ? <form action={review} className="flex flex-wrap items-center gap-3 text-sm">
        <input type="hidden" name="id" value={report.id} />
        <label className="flex items-center gap-2"><input name="verified" type="checkbox" required /> Source checked and any required correction verified</label>
        <button name="decision" value="RESOLVED" className="rounded-lg border border-border px-3 py-2">Resolve</button>
        <button name="decision" value="DISMISSED" className="rounded-lg border border-border px-3 py-2">Dismiss</button>
      </form> : null}
    </article>)}
    {reports.length > 50 ? <Link className="text-primary" href={`/ops/job-reports?status=${status}&after=${encodeURIComponent(reports[49].id)}`}>Next reports</Link> : null}
  </div>;
}
