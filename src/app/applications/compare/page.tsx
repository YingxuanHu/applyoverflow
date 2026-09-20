import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { JobComparisonPicker } from "@/components/applications/job-comparison-picker";
import { DECISION_FACT_LABELS } from "@/lib/jobs/decision-facts";
import { getJobComparison } from "@/lib/queries/job-comparison";
import { formatDisplayLabel } from "@/lib/job-display";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ job?: string | string[] }> }) {
  const { job } = await searchParams;
  const data = await getJobComparison(job);
  return <div className="app-page app-page-workspace space-y-6">
    <Link href="/applications?status=WISHLIST" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Wishlist</Link>
    <h1 className="page-title">Compare saved jobs</h1>
    {data.options.length === 0 ? <p className="text-muted-foreground">No saved jobs yet. <Link className="text-primary" href="/jobs">Browse jobs</Link></p> : <JobComparisonPicker key={data.jobs.map((job) => job.id).join(":")} options={data.options} selected={data.jobs.map((job) => job.id)} />}
    {data.unavailable > 0 ? <p role="status" className="text-sm text-muted-foreground">Some selected jobs are no longer in your wishlist.</p> : null}
    {data.jobs.length >= 2 ? <div role="region" aria-label="Job comparison" tabIndex={0} className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-border focus-visible:outline-primary">
      <table className="w-full table-fixed border-collapse text-left text-sm" style={{ minWidth: `${160 + data.jobs.length * 240}px` }}>
        <caption className="sr-only">Saved job facts and application readiness</caption>
        <colgroup><col style={{ width: 160 }} />{data.jobs.map((job) => <col key={job.id} />)}</colgroup>
        <thead><tr><th scope="col" className="sticky left-0 z-10 border-b border-border bg-background p-4">Job</th>{data.jobs.map((job) => <th scope="col" key={job.id} className="border-b border-l border-border p-4 align-top">
          <div className="mb-2 flex items-center gap-2"><CompanyLogo company={job.company} domain={job.companyDomain} /><span className="break-words text-xs font-normal text-muted-foreground">{job.company}</span></div>
          <Link className="break-words font-semibold hover:text-primary" href={`/jobs/${job.id}`}>{job.title}<ArrowUpRight className="ml-1 inline h-3.5 w-3.5" /></Link>
        </th>)}</tr></thead>
        <tbody>{Object.entries(DECISION_FACT_LABELS).map(([key, label]) => <tr key={key}>
          <th scope="row" className="sticky left-0 z-10 border-b border-border bg-background p-4 align-top font-medium">{label}</th>
          {data.jobs.map((job) => <td key={job.id} className="break-words border-b border-l border-border p-4 align-top">{job.facts[key as keyof typeof DECISION_FACT_LABELS] ?? <span className="text-muted-foreground">Not confirmed by source</span>}</td>)}
        </tr>)}
        <tr><th scope="row" className="sticky left-0 z-10 bg-background p-4 align-top font-medium">Application readiness</th>{data.jobs.map((job) => <td key={job.id} className="border-l border-border p-4 align-top">
          <p>{job.readiness ? formatDisplayLabel(job.readiness) : "Not assessed"}</p>
          {job.readinessReasons.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{job.readinessReasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        </td>)}</tr>
        </tbody>
      </table>
    </div> : data.options.length > 0 ? <p className="text-sm text-muted-foreground">Select at least two saved jobs.</p> : null}
  </div>;
}
