"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { questionKind, type AssistantState } from "@/lib/application-assistant";
import { saveQuestionReview } from "@/app/applications/[id]/review/actions";

export function QuestionReview({
  id,
  state,
  suggestions,
}: {
  id: string;
  state: AssistantState;
  suggestions: Record<string, string>;
}) {
  const [answers, setAnswers] = useState(
    state.questions.map((q) => ({ ...q, remember: false })),
  );
  const [revision, setRevision] = useState(state.revision);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(key: string, patch: { answer?: string; remember?: boolean }) {
    setAnswers((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
    setDirty(true);
    setMessage("");
    setCopied("");
  }
  async function save() {
    setPending(true);
    setMessage("");
    try {
      const result = await saveQuestionReview(id, {
        revision,
        answers: answers.map(({ key, answer, remember }) => ({
          key,
          answer,
          remember,
        })),
      });
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      setRevision(result.revision);
      setDirty(false);
      setMessage("Answers saved. Nothing submitted.");
    } catch {
      setMessage("Could not save. Your answers are still here; try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
        <h2 className="text-base font-semibold">
          Questions{" "}
          <span className="text-muted-foreground">({answers.length})</span>
        </h2>
        <Button disabled={pending || !dirty} onClick={() => void save()}>
          <Save className="size-4" />
          {pending ? "Saving..." : "Save answers"}
        </Button>
      </div>
      <p role="status" className="min-h-8 py-2 text-sm text-muted-foreground">
        {message || (dirty ? "Unsaved answers" : "")}
      </p>
      {!answers.length && (
        <p className="py-6 text-sm text-muted-foreground">
          No additional questions found on this step.
        </p>
      )}
      <div className="divide-y">
        {answers.map((question, index) => {
          const kind = questionKind(question.label);
          const privateQuestion =
            kind === "sensitive" || kind === "work_authorization";
          return (
            <div className="space-y-3 py-5" key={question.key}>
              <label
                className="block break-words text-sm font-medium"
                htmlFor={`answer-${index}`}
              >
                {question.label}
              </label>
              {privateQuestion ? (
                <p className="text-sm text-muted-foreground">
                  Answer this directly on the employer form. This answer will
                  not be remembered.
                </p>
              ) : (
                <>
                  {Object.hasOwn(suggestions, question.key) &&
                    suggestions[question.key] && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-primary">
                          Previously approved answer for this employer
                        </summary>
                        <p className="my-3 whitespace-pre-wrap break-words text-muted-foreground">
                          {suggestions[question.key]}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            update(question.key, {
                              answer: suggestions[question.key],
                            })
                          }
                        >
                          Use this answer
                        </Button>
                      </details>
                    )}
                  <Textarea
                    id={`answer-${index}`}
                    value={question.answer}
                    maxLength={3000}
                    rows={3}
                    disabled={pending}
                    onChange={(event) =>
                      update(question.key, { answer: event.target.value })
                    }
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={question.remember}
                        disabled={pending}
                        onChange={(event) =>
                          update(question.key, {
                            remember: event.target.checked,
                          })
                        }
                      />
                      Remember for this employer
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!question.answer}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(question.answer);
                          setCopied(question.key);
                        } catch {
                          setMessage(
                            "Could not copy. Select the answer and copy it manually.",
                          );
                        }
                      }}
                    >
                      {copied === question.key ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied === question.key ? "Copied" : "Copy answer"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
