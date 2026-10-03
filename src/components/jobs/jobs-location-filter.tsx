"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MAX_LOCATION_SEARCH_ENTRIES,
  MAX_LOCATION_SEARCH_LENGTH,
  normalizeLocationSearch,
  splitLocationSearchValues,
} from "@/lib/location-search";

export function JobsLocationFilter({ defaultValue }: { defaultValue?: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [locations, setLocations] = useState(() => splitLocationSearchValues(defaultValue));
  const [draft, setDraft] = useState("");
  const combined = [...locations, ...splitLocationSearchValues(draft)];
  const unique = combined.filter((place, index) =>
    combined.findIndex((entry) => entry.toLowerCase() === place.toLowerCase()) === index,
  );
  const tooMany = unique.length > MAX_LOCATION_SEARCH_ENTRIES;
  const tooLong = unique.join(";").length > MAX_LOCATION_SEARCH_LENGTH;
  const limitMessage = tooMany ? `Choose up to ${MAX_LOCATION_SEARCH_ENTRIES} locations.`
    : tooLong ? "These locations exceed the search length limit." : "";

  useEffect(() => {
    inputRef.current?.setCustomValidity(limitMessage);
  }, [limitMessage]);

  function addLocation() {
    if (!draft.trim()) return;
    if (limitMessage) {
      inputRef.current?.reportValidity();
      return;
    }
    setLocations(unique);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-lg border border-border/60 bg-card p-3 sm:col-span-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="text-xs font-medium">Locations</h3>
        {locations.length > 0 || draft ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setLocations([]); setDraft(""); }}
          >
            Clear locations
          </button>
        ) : null}
      </div>
      {locations.length > 0 ? (
        <ul aria-label="Selected locations" className="mb-3 flex flex-wrap gap-1.5">
          {locations.map((location) => (
            <li key={location.toLowerCase()} className="flex max-w-full items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-xs">
              <MapPin aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{location}</span>
              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0"
                    aria-label={`Remove ${location}`}
                    onClick={() => setLocations((current) => current.filter((place) => place !== location))}
                  >
                    <X className="size-3.5" />
                  </Button>
                } />
                <TooltipContent>Remove {location}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">City, province, state or country</label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          ref={inputRef}
          className="h-9 min-w-0 flex-1 rounded-md text-sm"
          placeholder="e.g. Toronto or Canada"
          autoComplete="off"
          maxLength={120}
          value={draft}
          aria-invalid={Boolean(limitMessage)}
          aria-describedby={limitMessage ? `${id}-error` : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              addLocation();
            }
          }}
        />
        <Tooltip>
          <TooltipTrigger render={
            <Button
              type="button"
              variant="outline"
              className="size-9 shrink-0 rounded-md p-0"
              aria-label="Add location"
              disabled={!draft.trim()}
              onClick={addLocation}
            >
              <Plus className="size-4" />
            </Button>
          } />
          <TooltipContent>Add location</TooltipContent>
        </Tooltip>
      </div>
      {limitMessage ? <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-destructive">{limitMessage}</p> : null}
      {/* Include a pending entry when Apply filters is clicked without Add. */}
      <input type="hidden" name="locationSearch" value={normalizeLocationSearch(unique.join(";")) ?? ""} />
    </section>
  );
}
