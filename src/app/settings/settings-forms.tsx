"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, LoaderCircle } from "lucide-react";

import { useNotifications } from "@/components/ui/notification-provider";
import {
  normalizeSalaryCurrency,
  SALARY_COMPARISON_CURRENCIES,
} from "@/lib/currency-conversion";
import { cn } from "@/lib/utils";

import { initialSettingsState, type SettingsActionState } from "./action-state";
import {
  saveAccountSettings,
  saveAutomationSettings,
  saveNotificationSettings,
  savePreferencesSettings,
} from "./actions";

const SETTINGS_LABEL_CLASS = "control-label normal-case tracking-normal";
const SETTINGS_INPUT_CLASS =
  "mt-1 h-10 w-full rounded-[12px] border border-input bg-card px-3.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

// ─── Shared feedback hook ──────────────────────────────────────────

function useSettingsFeedback(
  state: SettingsActionState,
  { resetKey }: { resetKey?: string } = {}
) {
  const { notify } = useNotifications();
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    const key = `${resetKey ?? ""}::${state.success ?? ""}::${state.error ?? ""}`;
    if (!state.success && !state.error) {
      lastKeyRef.current = key;
      return;
    }
    if (key === lastKeyRef.current) {
      return;
    }
    lastKeyRef.current = key;

    if (state.success) {
      notify({ tone: "success", title: "Saved", message: state.success });
    } else if (state.error) {
      notify({ tone: "error", title: "Save failed", message: state.error });
    }
  }, [notify, resetKey, state.error, state.success]);
}

// ─── Save button (shares pending state via useFormStatus) ──────────

function SaveButton({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="inline-flex h-10 items-center gap-1.5 rounded-[12px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <>
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ─── Account section ───────────────────────────────────────────────

export function AccountForm({
  defaultName,
  email,
}: {
  defaultName: string;
  email: string;
}) {
  const [state, formAction] = useActionState(
    saveAccountSettings,
    initialSettingsState
  );
  useSettingsFeedback(state);

  return (
    <form action={formAction} className="mt-4 grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-name">
            Display name
          </label>
          <input
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaultName}
            id="settings-name"
            maxLength={100}
            name="name"
            placeholder="Your name"
            required
            type="text"
          />
        </div>
        <div>
          <p className={SETTINGS_LABEL_CLASS}>
            Email
          </p>
          <div className="mt-1 flex h-10 items-center justify-between rounded-[12px] border border-border/60 bg-muted/45 px-3.5 text-sm text-foreground">
            <span className="truncate">{email}</span>
            <Link
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              href="#security"
            >
              <KeyRound className="h-3 w-3" />
              Security
            </Link>
          </div>
        </div>
      </div>
      <div>
        <SaveButton label="Save account" />
      </div>
    </form>
  );
}

// ─── Preferences section ───────────────────────────────────────────

const WORK_MODE_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
  { value: "FLEXIBLE", label: "Flexible" },
] as const;

const EXPERIENCE_LEVEL_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "ENTRY", label: "Entry level" },
  { value: "MID", label: "Mid level" },
  { value: "SENIOR", label: "Senior" },
  { value: "LEAD", label: "Lead / Staff" },
  { value: "EXECUTIVE", label: "Executive" },
] as const;

export function PreferencesForm({
  defaults,
}: {
  defaults: {
    preferredWorkMode: string;
    experienceLevel: string;
    salaryMin: string;
    salaryMax: string;
    salaryCurrency: string;
    location: string;
  };
}) {
  const [state, formAction] = useActionState(
    savePreferencesSettings,
    initialSettingsState
  );
  useSettingsFeedback(state);
  const defaultSalaryCurrency =
    normalizeSalaryCurrency(defaults.salaryCurrency) ?? "USD";

  return (
    <form action={formAction} className="mt-4 grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-work-mode">
            Preferred work mode
          </label>
          <select
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaults.preferredWorkMode}
            id="pref-work-mode"
            name="preferredWorkMode"
          >
            {WORK_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-experience">
            Experience level
          </label>
          <select
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaults.experienceLevel}
            id="pref-experience"
            name="experienceLevel"
          >
            {EXPERIENCE_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-salary-min">
            Target salary min
          </label>
          <input
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaults.salaryMin}
            id="pref-salary-min"
            inputMode="numeric"
            min={0}
            name="salaryMin"
            placeholder="80000"
            type="number"
          />
        </div>
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-salary-max">
            Target salary max
          </label>
          <input
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaults.salaryMax}
            id="pref-salary-max"
            inputMode="numeric"
            min={0}
            name="salaryMax"
            placeholder="150000"
            type="number"
          />
        </div>
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-currency">
            Currency
          </label>
          <select
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaultSalaryCurrency}
            id="pref-currency"
            name="salaryCurrency"
          >
            {SALARY_COMPARISON_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={SETTINGS_LABEL_CLASS} htmlFor="pref-location">
            Location
          </label>
          <input
            className={SETTINGS_INPUT_CLASS}
            defaultValue={defaults.location}
            id="pref-location"
            maxLength={120}
            name="location"
            placeholder="Toronto, ON"
            type="text"
          />
        </div>
      </div>

      <div>
        <SaveButton label="Save preferences" />
      </div>
    </form>
  );
}

// ─── Automation section ────────────────────────────────────────────

const AUTOMATION_MODE_OPTIONS = [
  {
    value: "REVIEW_BEFORE_SUBMIT",
    label: "Manual review",
    description:
      "Show job matches and prepare materials. You open and submit applications yourself.",
  },
  {
    value: "STRICT_AUTO_APPLY",
    label: "Strict auto-apply",
    description:
      "Submit only supported Greenhouse, Lever, and Ashby forms that pass quality guardrails.",
  },
] as const;

export function AutomationForm({
  currentMode,
}: {
  currentMode: string;
}) {
  const normalizedCurrentMode = AUTOMATION_MODE_OPTIONS.some(
    (option) => option.value === currentMode
  )
    ? currentMode
    : "REVIEW_BEFORE_SUBMIT";
  const [state, formAction] = useActionState(
    saveAutomationSettings,
    initialSettingsState
  );
  const [selectedMode, setSelectedMode] = useState(normalizedCurrentMode);
  useSettingsFeedback(state);

  useEffect(() => {
    setSelectedMode(normalizedCurrentMode);
  }, [normalizedCurrentMode]);

  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <div
        aria-label="Automation mode"
        className="grid gap-3 sm:grid-cols-2"
        role="radiogroup"
      >
        {AUTOMATION_MODE_OPTIONS.map((option) => {
          const isActive = selectedMode === option.value;
          return (
            <label
              className={cn(
                "relative flex cursor-pointer flex-col gap-1 rounded-[14px] border px-4 py-3 transition-colors",
                isActive
                  ? "border-primary/45 bg-accent"
                  : "border-border/70 bg-card hover:bg-muted"
              )}
              key={option.value}
            >
              <input
                className="sr-only"
                checked={isActive}
                name="automationMode"
                onChange={() => setSelectedMode(option.value)}
                type="radio"
                value={option.value}
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {option.label}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded-full border",
                    isActive ? "border-primary" : "border-border"
                  )}
                >
                  {isActive ? (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  ) : null}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {option.description}
              </span>
            </label>
          );
        })}
      </div>
      <div>
        <SaveButton label="Save automation mode" />
      </div>
    </form>
  );
}

// ─── Notifications section ─────────────────────────────────────────

export function NotificationsForm({
  defaultEnabled,
}: {
  defaultEnabled: boolean;
}) {
  const [state, formAction] = useActionState(
    saveNotificationSettings,
    initialSettingsState
  );
  useSettingsFeedback(state);

  return (
    <form action={formAction} className="mt-4 grid gap-3">
      <label className="flex items-start gap-3 rounded-[14px] border border-border/60 bg-card px-4 py-3 text-sm text-foreground">
        <input
          className="mt-1 h-4 w-4 rounded border border-input"
          defaultChecked={defaultEnabled}
          name="emailNotificationsEnabled"
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="font-medium">Email deadline reminders</span>
          <span className="mt-0.5 block text-muted-foreground">
            Send reminder emails for upcoming and overdue tracked application
            deadlines.
          </span>
        </span>
      </label>
      <div>
        <SaveButton label="Save notifications" />
      </div>
    </form>
  );
}
