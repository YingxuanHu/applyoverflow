"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { showJobsLoadingPopup } from "@/components/jobs/jobs-navigation-pending-boundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeFilterValueList } from "@/lib/filter-values";
import { mergeNaturalLanguageJobsSearch } from "@/lib/jobs/search-state";
import { getUnsupportedSearchConstraints } from "@/lib/jobs/search-constraints";
import type { NaturalLanguageJobSearchResult } from "@/lib/jobs/natural-language-search";
import type { JobSearchScope } from "@/lib/queries/jobs";

type HiddenField = {
  name: string;
  value: string;
};

type SearchValues = Record<JobSearchScope, string>;
type VisibleJobSearchScope = Exclude<JobSearchScope, "all">;
type SearchMode = VisibleJobSearchScope | "ai";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike | undefined;
  };
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const DEFAULT_SEARCH_SCOPE: VisibleJobSearchScope = "title";
const MAX_AI_SEARCH_LENGTH = 600;

const SEARCH_SCOPE_OPTIONS: Array<{ label: string; value: SearchMode }> = [
  { label: "Title", value: "title" },
  { label: "Company", value: "company" },
  { label: "Location", value: "location" },
  { label: "AI search", value: "ai" },
];

const SEARCH_PARAM_BY_SCOPE: Record<JobSearchScope, string> = {
  all: "search",
  title: "titleSearch",
  company: "companySearch",
  location: "locationSearch",
};

const SEARCH_FIELD_PARAM_NAMES = new Set([
  "field",
  "q",
  "search",
  "searchScope",
  "titleSearch",
  "companySearch",
  "locationSearch",
]);

const PLACEHOLDER_BY_SCOPE: Record<SearchMode, string> = {
  ai: "Describe a role, location, level, or work style",
  company: "Search companies by keyword",
  location: "Search locations by keyword",
  title: "Search job titles by keyword",
};

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function joinTranscriptParts(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_AI_SEARCH_LENGTH);
}

function getSpeechErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was blocked. Allow microphone access or type what you want.";
  }
  if (error === "no-speech") {
    return "No speech was detected. Try again or type what you want.";
  }
  if (error === "audio-capture") {
    return "No microphone was found. Type what you want instead.";
  }
  return "Voice input stopped. You can keep typing or try again.";
}

function normalizeSearchList(value: string) {
  return normalizeFilterValueList(value) ?? "";
}

function normalizeSubmittedSearchValue(scope: VisibleJobSearchScope, value: string) {
  const normalizedValue = value.trim();
  return scope === "location" ? normalizeSearchList(normalizedValue) : normalizedValue;
}

function getSubmittedValue(scope: VisibleJobSearchScope, values: SearchValues) {
  return normalizeSubmittedSearchValue(scope, values[scope]);
}

export function JobsSearchForm({
  basePath = "/jobs",
  filterFormId,
  hiddenFields,
  initialScope,
  initialValues,
}: {
  basePath?: "/jobs" | "/jobs/top-picks";
  filterFormId?: string;
  hiddenFields: HiddenField[];
  initialScope: JobSearchScope;
  initialValues: SearchValues;
}) {
  const initialVisibleScope =
    initialScope === "all" ? DEFAULT_SEARCH_SCOPE : initialScope;
  const normalizedInitialValues = {
    all: "",
    title:
      initialValues.title ||
      (initialScope === "all" ? initialValues.all : ""),
    company: initialValues.company,
    location: initialValues.location,
  };
  const [scope, setScope] = useState<SearchMode>(initialVisibleScope);
  const [committedValues] = useState<SearchValues>(() => normalizedInitialValues);
  const [draftValue, setDraftValue] = useState(() => normalizedInitialValues[initialVisibleScope]);
  const [error, setError] = useState<string | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const aiSubmitHandlerRef = useRef<((event: FormEvent<HTMLFormElement>) => void) | null>(null);
  const baseTranscriptRef = useRef("");
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const submittedSearchValue =
    scope === "ai" ? "" : normalizeSubmittedSearchValue(scope, draftValue);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function startListening() {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setVoiceMessage("Voice input is not available in this browser. Type what you want instead.");
      return;
    }

    recognitionRef.current?.abort();
    baseTranscriptRef.current = draftValue.trim();
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setVoiceMessage(null);
    setError(null);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onstart = () => setIsListening(true);
    recognition.onerror = (event) => setVoiceMessage(getSpeechErrorMessage(event.error));
    recognition.onresult = (event) => {
      const finalParts: string[] = [];
      const interimParts: string[] = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const resultEntry = event.results[index];
        if (!resultEntry) continue;
        const transcript = resultEntry[0]?.transcript?.trim();
        if (!transcript) continue;
        if (resultEntry.isFinal) finalParts.push(transcript);
        else interimParts.push(transcript);
      }

      if (finalParts.length > 0) {
        finalTranscriptRef.current = joinTranscriptParts(
          finalTranscriptRef.current,
          finalParts.join(" "),
        );
      }
      interimTranscriptRef.current = interimParts.join(" ").trim();
      setDraftValue(
        joinTranscriptParts(
          baseTranscriptRef.current,
          finalTranscriptRef.current,
          interimTranscriptRef.current,
        ),
      );
    };
    recognition.onend = () => {
      setDraftValue(
        joinTranscriptParts(
          baseTranscriptRef.current,
          finalTranscriptRef.current,
          interimTranscriptRef.current,
        ),
      );
      interimTranscriptRef.current = "";
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function handleScopeChange(nextScope: SearchMode) {
    if (isListening) stopListening();
    setScope(nextScope);
    setDraftValue((currentDraft) => {
      if (currentDraft.trim()) return currentDraft;
      return nextScope === "ai" ? "" : committedValues[nextScope];
    });
    setError(null);
    setVoiceMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (scope === "ai") aiSubmitHandlerRef.current?.(event);
  }

  const submittedHiddenFields =
    scope === "ai"
      ? buildCommittedSearchHiddenFields(committedValues)
      : buildSubmittedSearchHiddenFields(scope, submittedSearchValue, committedValues);

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <form
        action={basePath}
        className="flex min-w-0 items-center gap-2"
        method="get"
        onSubmit={handleSubmit}
      >
        {scope === "ai" ? (
          <AiSearchSubmitHandler
            basePath={basePath}
            draftValue={draftValue}
            isListening={isListening}
            onError={setError}
            onPendingChange={setIsPending}
            stopListening={stopListening}
            submitHandlerRef={aiSubmitHandlerRef}
          />
        ) : null}
        {hiddenFields
          .filter((field) => !SEARCH_FIELD_PARAM_NAMES.has(field.name))
          .map((field) => (
            <input
              key={`${field.name}:${field.value}`}
              name={field.name}
              type="hidden"
              value={field.value}
            />
          ))}
        {submittedHiddenFields.map((field) => (
          <input
            key={`${field.name}:${field.value}`}
            name={field.name}
            type="hidden"
            value={field.value}
          />
        ))}
        {filterFormId
          ? submittedHiddenFields.map((field) => (
              <input
                form={filterFormId}
                key={`filter:${field.name}:${field.value}`}
                name={field.name}
                type="hidden"
                value={field.value}
              />
            ))
          : null}

        <div className="flex min-w-0 flex-1 overflow-hidden rounded-[14px] border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
          <label className="sr-only" htmlFor="jobs-search-scope">
            Search type
          </label>
          <div className="relative w-[6.8rem] shrink-0 border-r border-border/60 sm:w-32">
            <select
              className="h-10 w-full appearance-none bg-transparent pl-3 pr-7 text-left text-sm font-medium leading-10 text-foreground outline-none sm:pl-4 sm:pr-8"
              id="jobs-search-scope"
              onChange={(event) => handleScopeChange(event.target.value as SearchMode)}
              style={{ textAlignLast: "left" }}
              value={scope}
            >
              {SEARCH_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground sm:right-2.5" />
          </div>

          <div className="relative min-w-0 flex-1">
            {scope === "ai" ? (
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            )}
            <Input
              aria-label={PLACEHOLDER_BY_SCOPE[scope]}
              className="h-10 rounded-none border-0 bg-transparent pl-9 pr-16 text-sm focus-visible:border-transparent focus-visible:ring-0 sm:pr-[4.25rem]"
              maxLength={scope === "ai" ? MAX_AI_SEARCH_LENGTH : 120}
              onChange={(event) => {
                if (isListening) stopListening();
                setDraftValue(event.target.value);
                setError(null);
                setVoiceMessage(null);
              }}
              placeholder={PLACEHOLDER_BY_SCOPE[scope]}
              value={draftValue}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {draftValue ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Clear search"
                        onClick={() => {
                          if (isListening) stopListening();
                          setDraftValue("");
                          setError(null);
                          setVoiceMessage(null);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={isListening ? "Stop voice input" : "Use voice input"}
                      aria-pressed={isListening}
                      className={
                        isListening
                          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
                          : ""
                      }
                      disabled={isPending}
                      onClick={isListening ? stopListening : startListening}
                      size="icon-sm"
                      type="button"
                      variant={isListening ? "destructive" : "ghost"}
                    >
                      {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </Button>
                  }
                />
                <TooltipContent>{isListening ? "Stop voice input" : "Use voice input"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={scope === "ai" ? "Run AI job search" : "Search jobs"}
                className="h-10 w-10 rounded-[14px] p-0"
                disabled={isPending}
                type="submit"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            }
          />
          <TooltipContent>{scope === "ai" ? "Run AI job search" : "Search jobs"}</TooltipContent>
        </Tooltip>
      </form>

      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {voiceMessage ? <p role="alert" className="text-xs text-destructive">{voiceMessage}</p> : null}
    </div>
  );
}

function AiSearchSubmitHandler({
  basePath,
  draftValue,
  isListening,
  onError,
  onPendingChange,
  stopListening,
  submitHandlerRef,
}: {
  basePath: "/jobs" | "/jobs/top-picks";
  draftValue: string;
  isListening: boolean;
  onError: (message: string | null) => void;
  onPendingChange: (pending: boolean) => void;
  stopListening: () => void;
  submitHandlerRef: MutableRefObject<((event: FormEvent<HTMLFormElement>) => void) | null>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  submitHandlerRef.current = async (event) => {
    event.preventDefault();
    const text = draftValue.trim();
    if (!text) {
      onError("Type or speak the jobs you want.");
      return;
    }

    if (isListening) stopListening();
    onPendingChange(true);
    onError(null);
    try {
      const response = await fetch("/api/jobs/natural-language-search", {
        body: JSON.stringify({ text }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | NaturalLanguageJobSearchResult
        | { error?: string }
        | null;

      if (!response.ok) {
        onError(payload && "error" in payload && payload.error ? payload.error : "Could not interpret this search.");
        return;
      }

      const searchResult = payload as NaturalLanguageJobSearchResult;
      const unsupported = getUnsupportedSearchConstraints(searchResult, basePath);
      if (unsupported) {
        onError(unsupported);
        return;
      }
      const href = mergeNaturalLanguageJobsSearch(searchParams, searchResult.params, {
        basePath,
      });
      showJobsLoadingPopup(href);
      router.push(href);
    } catch {
      onError("Could not interpret this search.");
    } finally {
      onPendingChange(false);
    }
  };

  return null;
}

function buildSubmittedSearchHiddenFields(
  scope: VisibleJobSearchScope,
  submittedSearchValue: string,
  committedValues: SearchValues,
): HiddenField[] {
  const fields: HiddenField[] = [];

  if (submittedSearchValue) {
    fields.push({ name: "searchScope", value: scope });
    fields.push({ name: SEARCH_PARAM_BY_SCOPE[scope], value: submittedSearchValue });
  }

  for (const option of SEARCH_SCOPE_OPTIONS) {
    if (option.value === "ai" || option.value === scope) continue;
    const value = getSubmittedValue(option.value, committedValues);
    if (!value) continue;
    fields.push({ name: SEARCH_PARAM_BY_SCOPE[option.value], value });
  }

  return fields;
}

function buildCommittedSearchHiddenFields(committedValues: SearchValues): HiddenField[] {
  return (Object.keys(SEARCH_PARAM_BY_SCOPE) as JobSearchScope[]).flatMap((scope) => {
    if (scope === "all") return [];
    const value = getSubmittedValue(scope, committedValues);
    return value ? [{ name: SEARCH_PARAM_BY_SCOPE[scope], value }] : [];
  });
}
