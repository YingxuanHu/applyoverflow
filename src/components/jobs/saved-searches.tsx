"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BookmarkPlus, Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { savedSearchHref, type SavedSearch } from "@/lib/jobs/saved-searches";

export function SavedSearches({ query }: { query: string }) {
  const [rows, setRows] = useState<SavedSearch[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const loadVersion = useRef(0);
  async function load() {
    const version = ++loadVersion.current;
    const response = await fetch("/api/jobs/saved-searches", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not load saved searches.");
    const payload = await response.json();
    if (version === loadVersion.current) setRows(payload.data);
  }
  async function mutate(input: object) {
    ++loadVersion.current;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/jobs/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error ?? "Could not update saved search.",
        );
      await load();
      setName("");
      setRenameId(null);
      setMessage("Saved searches updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update saved searches.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="group border-t border-border/60 pt-3 text-sm sm:pt-4"
      onToggle={(event) => {
        if (event.currentTarget.open)
          void load().catch(() =>
            setMessage(
              "Could not load saved searches. Close and reopen to retry.",
            ),
          );
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-foreground [&::-webkit-details-marker]:hidden">
        Saved searches
        <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <form
        method="post"
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate({ action: "create", name, query });
        }}
      >
        <input
          aria-label="Saved search name"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3"
          required
          maxLength={60}
          placeholder="Search name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          <BookmarkPlus className="size-4" /> Save current search
        </Button>
      </form>
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {message}
      </p>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-3"
        >
          <div className="min-w-0">
            <Link
              className="break-words font-medium text-primary"
              href={savedSearchHref(row)}
            >
              {row.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              Reviewed {new Date(row.reviewedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              render={<Link href={savedSearchHref(row, true)} />}
            >
              Discovered since review
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Mark search reviewed"
              aria-label={`Mark ${row.name} reviewed`}
              disabled={busy}
              onClick={() => void mutate({ action: "reviewed", id: row.id })}
            >
              <Check className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Rename search"
              aria-label={`Rename ${row.name}`}
              disabled={busy}
              onClick={() => {
                setRenameId(row.id);
                setRename(row.name);
              }}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Delete search"
              aria-label={`Delete ${row.name}`}
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete saved search "${row.name}"?`))
                  void mutate({ action: "delete", id: row.id });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {renameId === row.id ? (
            <form
              method="post"
              className="flex w-full gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate({ action: "rename", id: row.id, name: rename });
              }}
            >
              <input
                aria-label="New search name"
                required
                maxLength={60}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3"
                value={rename}
                onChange={(event) => setRename(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy}>
                Rename
              </Button>
            </form>
          ) : null}
        </div>
      ))}
    </details>
  );
}
