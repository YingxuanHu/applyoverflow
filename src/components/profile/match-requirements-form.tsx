"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type MatchRequirements } from "@/lib/top-picks/requirements";

export function MatchRequirementsForm({
  initial,
}: {
  initial: MatchRequirements;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const field =
    "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
  return (
    <form
      className="space-y-4 border-t border-border py-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch("/api/jobs/top-picks/requirements", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
          });
          if (!response.ok) throw new Error();
          setMessage("Requirements saved. Picks are being refreshed.");
        } catch {
          setMessage("Could not save requirements. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">
        Requirements for Picks for you
      </h2>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Eligible country
          <select
            aria-label="Eligible country"
            className={field}
            value={value.country}
            onChange={(event) =>
              setValue({
                ...value,
                country: event.target.value as MatchRequirements["country"],
              })
            }
          >
            <option value="ANY">Any country in the job pool</option>
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </select>
        </label>
        <label className="text-sm">
          When a requirement is not stated
          <select
            aria-label="When a requirement is not stated"
            className={field}
            value={value.unknownPolicy}
            onChange={(event) =>
              setValue({
                ...value,
                unknownPolicy: event.target
                  .value as MatchRequirements["unknownPolicy"],
              })
            }
          >
            <option value="include">Include with an uncertainty warning</option>
            <option value="exclude">Exclude from my picks</option>
          </select>
        </label>
        <label className="text-sm">
          Minimum advertised annual salary
          <input
            className={field}
            type="number"
            min={0}
            max={2000000}
            value={value.minimumSalary ?? ""}
            onChange={(event) =>
              setValue({
                ...value,
                minimumSalary:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="text-sm">
          Salary currency
          <select
            aria-label="Salary currency"
            className={field}
            value={value.salaryCurrency}
            onChange={(event) =>
              setValue({
                ...value,
                salaryCurrency: event.target.value as "CAD" | "USD",
              })
            }
          >
            <option>CAD</option>
            <option>USD</option>
          </select>
        </label>
        <fieldset>
          <legend className="mb-2 text-sm">Required work arrangements</legend>
          <div className="flex flex-wrap gap-3">
            {(["REMOTE", "HYBRID", "ONSITE", "FLEXIBLE"] as const).map(
              (mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={value.workModes.includes(mode)}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        workModes: event.target.checked
                          ? [...value.workModes, mode]
                          : value.workModes.filter((item) => item !== mode),
                      })
                    }
                  />
                  {mode.toLowerCase()}
                </label>
              ),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm">Required employment types</legend>
          <div className="flex flex-wrap gap-3">
            {(
              ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"] as const
            ).map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value.employmentTypes.includes(type)}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      employmentTypes: event.target.checked
                        ? [...value.employmentTypes, type]
                        : value.employmentTypes.filter((item) => item !== type),
                    })
                  }
                />
                {type.toLowerCase().replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.sponsorshipRequired}
            onChange={(event) =>
              setValue({ ...value, sponsorshipRequired: event.target.checked })
            }
          />
          Visa sponsorship required
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          <Save className="size-4" />
          {busy ? "Saving..." : "Save requirements"}
        </Button>
        <p role="status" className="text-sm">
          {message}
        </p>
      </div>
    </form>
  );
}
