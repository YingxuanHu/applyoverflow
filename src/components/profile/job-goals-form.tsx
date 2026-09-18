"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { saveJobGoals } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JobGoals } from "@/lib/profile-setup";

export function JobGoalsFields({
  value,
  onChange,
}: {
  value: JobGoals;
  onChange: (goals: JobGoals) => void;
}) {
  const [titlesText, setTitlesText] = useState(value.targetTitles.join(", "));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm sm:col-span-2">
        <span className="font-medium">Roles you are interested in</span>
        <Input
          value={titlesText}
          maxLength={504}
          placeholder="Financial analyst, Operations manager"
          onChange={(event) => {
            setTitlesText(event.target.value);
            onChange({
              ...value,
              targetTitles: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            });
          }}
        />
        <span className="block text-xs text-muted-foreground">
          Up to five role titles, separated by commas.
        </span>
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Preferred city or region</span>
        <Input
          value={value.preferredLocation}
          maxLength={200}
          placeholder="Toronto, Ontario"
          onChange={(event) =>
            onChange({ ...value, preferredLocation: event.target.value })
          }
        />
      </label>
      <label className="space-y-2 text-sm">
        <span className="font-medium">Preferred country</span>
        <select
          className="h-10 w-full rounded-lg border border-input bg-background px-3"
          value={value.country}
          onChange={(event) =>
            onChange({
              ...value,
              country: event.target.value as JobGoals["country"],
            })
          }
        >
          <option value="">Canada or United States</option>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
      </label>
    </div>
  );
}

export function JobGoalsForm({ initial }: { initial: JobGoals }) {
  const [goals, setGoals] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="space-y-4 border-b border-border/60 py-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        try {
          const result = await saveJobGoals(goals);
          setMessage(result.error ?? "Job interests saved.");
        } catch {
          setMessage("Could not save. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>
        <JobGoalsFields
          value={goals}
          onChange={(next) => {
            setGoals(next);
            setMessage("");
          }}
        />
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null}Save
          interests
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </form>
  );
}
