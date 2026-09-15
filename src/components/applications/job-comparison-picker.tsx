"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobComparisonPicker({ options, selected }: { options: Array<{ id: string; title: string; company: string }>; selected: string[] }) {
  const [ids, setIds] = useState(Array.from({ length: 4 }, (_, index) => selected[index] ?? ""));
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <form className="space-y-3 border-y border-border py-4" onSubmit={(event) => {
    event.preventDefault();
    const query = new URLSearchParams();
    ids.filter(Boolean).forEach((id) => query.append("job", id));
    startTransition(() => router.push(`/applications/compare?${query.toString()}`));
  }}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ids.map((value, index) => <label key={index} className="min-w-0 space-y-1.5 text-sm">
        <span className="block text-muted-foreground">Job {index + 1}</span>
        <select value={value} className="h-10 w-full min-w-0 truncate rounded-lg border border-input bg-background px-2" onChange={(event) => setIds((current) => current.map((id, slot) => slot === index ? event.target.value : id))}>
          <option value="">Choose a saved job</option>
          {options.map((job) => <option key={job.id} value={job.id} disabled={job.id !== value && ids.includes(job.id)}>{job.title} - {job.company}</option>)}
        </select>
      </label>)}
    </div>
    <Button disabled={pending || ids.filter(Boolean).length < 2} type="submit">{pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Columns3 className="h-4 w-4" />}Compare</Button>
  </form>;
}
