"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, MoreHorizontal } from "lucide-react";

import {
  deleteProfileCoverLetter,
  uploadProfileCoverLetter,
} from "@/app/profile/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/components/ui/use-action-toast";

type CoverLetterRecord = {
  id: string;
  title: string;
  originalFileName: string;
  mimeType: string;
  sizeLabel: string;
  createdAtLabel: string;
  downloadHref: string;
  isAiGenerated: boolean;
};

type CoverLetterManagerProps = {
  coverLetters: CoverLetterRecord[];
  storageConfigured: boolean;
};

function formatDocumentKind(mimeType: string, fileName?: string) {
  const value = mimeType.toLowerCase();
  const name = (fileName ?? "").toLowerCase();
  if (value.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (value.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")) return "Word";
  if (value.includes("text") || name.endsWith(".txt")) return "Text";
  if (name.endsWith(".rtf")) return "RTF";
  return "File";
}

function CoverLetterRow({ coverLetter }: { coverLetter: CoverLetterRecord }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteState, deleteAction] = useActionState(deleteProfileCoverLetter, {
    error: null,
    success: null,
  });
  useActionToast(deleteState, {
    successTitle: "Cover letter updated",
    errorTitle: "Could not update cover letter",
  });

  useEffect(() => {
    if (deleteState.success) {
      router.refresh();
    }
  }, [deleteState.success, router]);

  function dispatchDelete() {
    const payload = new FormData();
    payload.set("documentId", coverLetter.id);
    startTransition(() => deleteAction(payload));
  }

  return (
    <div className="rounded-[14px] border border-border/65 bg-card px-3 py-2.5 sm:px-3.5 sm:py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="truncate text-sm font-medium text-foreground">{coverLetter.title}</span>
          <p className="mt-1 truncate text-xs text-muted-foreground">{coverLetter.originalFileName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button render={<a href={coverLetter.downloadHref} />} className="h-8 px-2.5 text-xs sm:px-3" size="sm" variant="secondary">
            Download
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="cursor-pointer"
                variant="destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:gap-x-4">
        <span>{formatDocumentKind(coverLetter.mimeType, coverLetter.originalFileName)}</span>
        <span>{coverLetter.sizeLabel}</span>
        <span>{coverLetter.createdAtLabel}</span>
      </div>
      {deleteState.error ? <p className="mt-2 text-xs text-destructive">{deleteState.error}</p> : null}
      <ConfirmActionDialog
        confirmLabel="Delete"
        description={`Delete "${coverLetter.title}" from your cover letter library.`}
        destructive
        onConfirm={dispatchDelete}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title="Delete cover letter?"
      />
    </div>
  );
}

function AddCoverLetterForm({
  storageConfigured,
  onDone,
}: {
  storageConfigured: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(uploadProfileCoverLetter, {
    error: null,
    success: null,
  });
  useActionToast(state, {
    successTitle: "Cover letter uploaded",
    errorTitle: "Could not upload cover letter",
  });

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      router.refresh();
      onDone();
    }
  }, [onDone, router, state.success]);

  return (
    <form action={formAction} className="rounded-[14px] border border-border/65 bg-muted/35 p-3" ref={formRef}>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cl-title">
            Label
          </label>
          <Input
            className="h-8 text-sm"
            id="cl-title"
            name="title"
            placeholder="e.g. Software engineering — general"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cl-file">
            File
          </label>
          <FileInput
            accept=".pdf,.doc,.docx,.txt,.rtf"
            className="h-8 text-sm"
            id="cl-file"
            name="file"
            required
          />
        </div>
        <div className="flex items-end gap-2">
          <Button className="h-8 px-3 text-xs" disabled={!storageConfigured || pending} size="sm" type="submit">
            {pending ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              "Upload"
            )}
          </Button>
          <Button className="h-8 px-3 text-xs" onClick={onDone} size="sm" type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </div>
      {state.error ? <p className="mt-2 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export function CoverLetterManager({ coverLetters, storageConfigured }: CoverLetterManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const uploadedCoverLetters = coverLetters.filter(
    (coverLetter) => !coverLetter.isAiGenerated
  );
  const aiCoverLetters = coverLetters.filter(
    (coverLetter) => coverLetter.isAiGenerated
  );

  return (
    <div className="grid gap-3 sm:gap-5">
      <DocumentGroup
        count={uploadedCoverLetters.length}
        description="Uploaded cover letters you can attach from the application workspace."
        title="Cover letters"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Uploaded by you
          </h3>
          <span className="text-xs text-muted-foreground">{uploadedCoverLetters.length}</span>
        </div>
        {uploadedCoverLetters.length === 0 && !showAdd ? (
          <p className="py-2 text-sm italic text-muted-foreground">
            No uploaded cover letters yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {uploadedCoverLetters.map((coverLetter) => (
              <CoverLetterRow coverLetter={coverLetter} key={coverLetter.id} />
            ))}
          </div>
        )}

        {showAdd ? (
          <div className="mt-2">
            <AddCoverLetterForm
              onDone={() => setShowAdd(false)}
              storageConfigured={storageConfigured}
            />
          </div>
        ) : (
          <button
            className="mt-2 rounded-full px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-accent"
            onClick={() => setShowAdd(true)}
            type="button"
          >
            + Add cover letter
          </button>
        )}
      </DocumentGroup>

      {aiCoverLetters.length > 0 ? (
        <div className="rounded-[16px] border border-dashed border-border/70 bg-muted/35 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Generated cover letters
            </h3>
            <span className="text-xs text-muted-foreground">{aiCoverLetters.length}</span>
          </div>
          <p className="mb-2 hidden text-xs text-muted-foreground sm:block">
            Cover letters produced by the app for specific jobs.
          </p>
          <div className="grid gap-2">
            {aiCoverLetters.map((coverLetter) => (
              <CoverLetterRow coverLetter={coverLetter} key={coverLetter.id} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DocumentGroup({
  children,
  count,
  description,
  title,
}: {
  children: ReactNode;
  count: number;
  description: string;
  title: string;
}) {
  return (
    <section className="grouped-panel p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-1 hidden text-sm leading-5 text-muted-foreground sm:block">{description}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  );
}
