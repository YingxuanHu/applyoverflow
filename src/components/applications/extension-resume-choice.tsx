"use client";

import { useActionState, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shareResume } from "@/app/extension/resume/[id]/actions";

export function ExtensionResumeChoice({
  id,
  documents,
  cancelUrl,
}: {
  id: string;
  documents: {
    id: string;
    title: string;
    originalFileName: string;
    sizeBytes: number;
    isAiGenerated: boolean;
  }[];
  cancelUrl: string;
}) {
  const [selected, setSelected] = useState("");
  const [state, action, pending] = useActionState(shareResume, { error: "" });
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={pending} className="min-w-0">
        <legend className="mb-2 text-sm font-medium">Choose a resume</legend>
        <div className="max-h-80 divide-y overflow-y-auto overscroll-contain border-y">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center gap-3 py-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="documentId"
                  value={document.id}
                  checked={selected === document.id}
                  onChange={() => setSelected(document.id)}
                  required
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 text-sm">
                  <span className="block break-words font-medium">
                    {document.title}
                  </span>
                  <span className="mt-1 block break-all text-xs text-muted-foreground">
                    {document.originalFileName} ·{" "}
                    {Math.ceil(document.sizeBytes / 1024)} KB
                    {document.isAiGenerated ? " · AI generated" : ""}
                  </span>
                </span>
              </label>
              <a
                href={`/api/profile/documents/${encodeURIComponent(document.id)}/download`}
                download
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                title={`Download ${document.title}`}
                aria-label={`Download ${document.title}`}
              >
                <Download className="size-4" />
              </a>
            </div>
          ))}
        </div>
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!selected || pending}>
          <Paperclip className="size-4" />
          {pending ? "Sharing..." : "Share and attach resume"}
        </Button>
        <a
          href={cancelUrl}
          className="px-2 py-2 text-sm text-muted-foreground underline underline-offset-4"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
