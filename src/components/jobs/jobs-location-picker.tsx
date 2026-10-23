"use client";

import Form from "next/form";
import { useState } from "react";
import { MapPin, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { appendLocationSearch, locationSearchOptions, splitLocationSearchValues } from "@/lib/location-search";
import { showJobsLoadingPopup } from "./jobs-navigation-pending-boundary";

export function JobsLocationPicker({ value, hiddenFields, basePath }: {
  value: string;
  hiddenFields: Array<{ name: string; value: string }>;
  basePath: "/jobs" | "/jobs/top-picks";
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const committed = splitLocationSearchValues(value);
  const suggestions = locationSearchOptions(query);
  const selectedKey = (place: string) => place.toLowerCase();
  const has = (place: string) => selected.some((entry) => selectedKey(entry) === selectedKey(place));

  function remove(place: string) {
    setSelected((current) => current.filter((entry) => selectedKey(entry) !== selectedKey(place)));
    setError(null);
  }

  function add(place: string) {
    const next = appendLocationSearch(selected.join(";"), place);
    if (next.error) { setError(next.error); return; }
    setSelected(splitLocationSearchValues(next.value));
    setQuery("");
    setError(null);
  }

  const fields = hiddenFields.filter((field) => !["location", "locationSearch", "page", "reset"].includes(field.name));
  const params = new URLSearchParams(fields.map((field) => [field.name, field.value]));
  if (selected.length) params.set("locationSearch", selected.join(";"));
  const href = params.size ? `${basePath}?${params}` : `${basePath}?reset=1`;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setSelected(committed); setQuery(""); setError(null); }
    }}>
      <DialogTrigger render={<Button type="button" variant="outline" className="h-11 w-full gap-2 rounded-lg sm:w-auto" />}>
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        Locations
        {committed.length > 0 ? <span className="min-w-5 rounded-full bg-primary/10 px-1.5 text-xs text-primary">{committed.length}</span> : null}
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-md">
        <div className="flex items-center gap-3 border-b p-4 pr-12">
          <DialogTitle>Locations</DialogTitle>
          <span className="text-xs text-muted-foreground" aria-live="polite">{selected.length ? `${selected.length} selected` : "Anywhere in US & Canada"}</span>
        </div>
        <Form action={basePath} scroll={false} className="flex min-h-0 flex-col" onSubmit={() => {
          setOpen(false);
          showJobsLoadingPopup(href);
        }}>
          {fields.map((field) => <input key={`${field.name}:${field.value}`} type="hidden" name={field.name} value={field.value} />)}
          {selected.length ? <input type="hidden" name="locationSearch" value={selected.join(";")} /> : null}
          {!params.size ? <input type="hidden" name="reset" value="1" /> : null}
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
            {selected.length ? <ul className="mb-3 flex flex-wrap gap-2" aria-label="Selected locations">
              {selected.map((place) => <li key={selectedKey(place)} className="flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2 text-sm">
                <span className="min-w-0 break-words">{place}</span>
                <Button aria-label={`Remove ${place}`} size="icon-sm" variant="ghost" type="button" onClick={() => remove(place)}><X className="size-3.5" /></Button>
              </li>)}
            </ul> : null}
            <label htmlFor="location-picker-search" className="mb-2 block text-sm font-medium">City, province, state or country</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input id="location-picker-search" autoComplete="off" maxLength={120} value={query} placeholder="Search locations" className="h-10 pl-9" aria-invalid={Boolean(error)} onChange={(event) => { setQuery(event.target.value); setError(null); }} onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); if (query.trim()) add(query); }
              }} />
            </div>
            {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
            <div className="mt-3 divide-y" role="group" aria-label="Matching locations">
              {suggestions.map((place) => <label key={place.value} className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={has(place.value)} onChange={() => has(place.value) ? remove(place.value) : add(place.value)} />
                <span className="min-w-0 flex-1 break-words">{place.label}</span>
                <span className="text-right text-xs text-muted-foreground">{place.kind}</span>
              </label>)}
            </div>
            {query.trim() && !suggestions.some((place) => place.value.toLowerCase() === query.trim().toLowerCase()) ? (
              <Button type="button" variant="ghost" className="mt-1 h-auto min-h-10 w-full justify-start whitespace-normal text-left" onClick={() => add(query)}>
                <Plus className="size-4 shrink-0" /><span className="min-w-0 break-words">Add &quot;{query.trim()}&quot;</span>
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 p-3">
            <Button type="button" variant="ghost" disabled={!selected.length} onClick={() => { setSelected([]); setError(null); }}>Clear locations</Button>
            <div className="flex gap-2">
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit">Apply locations</Button>
            </div>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
