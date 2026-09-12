import OpenAI from "openai";

type OpenAIReadiness = {
  configured: boolean;
  missingKeys: string[];
};

const requiredOpenAIEnvKeys = ["OPENAI_API_KEY"] as const;

const globalForOpenAI = globalThis as unknown as {
  openai?: OpenAI;
};

export function getReasoningModel() {
  return process.env.OPENAI_REASONING_MODEL?.trim() || "gpt-5.4";
}

export function getStandardModel() {
  return process.env.OPENAI_STANDARD_MODEL?.trim() || "gpt-5.4-mini";
}

export function getFastModel() {
  return process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5.4-nano";
}

export function getOpenAIReadiness(): OpenAIReadiness {
  const missingKeys = requiredOpenAIEnvKeys.filter(
    (key) => !process.env[key]?.trim()
  );

  return {
    configured: missingKeys.length === 0,
    missingKeys,
  };
}

export function getOpenAIClient(systemSubject?: string) {
  const readiness = getOpenAIReadiness();
  if (!readiness.configured) {
    throw new Error(
      `OpenAI is not configured. Missing: ${readiness.missingKeys.join(", ")}`
    );
  }

  const createClient = () => new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120_000,
      maxRetries: 0,
      fetch: async (url, init) => {
        const { withResourceBudget } = await import("@/lib/resource-budget");
        const subject = systemSubject ?? await (await import("@/lib/current-user")).getOptionalCurrentAuthUserId();
        if (!subject) throw new Error("Sign in before generating content.");
        return withResourceBudget("ai", subject, async () => {
          const response = await fetch(url, init);
          // Consume the bounded non-streaming response before releasing the
          // lease so a slow response body cannot escape the concurrency limit.
          const body = await response.arrayBuffer();
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        });
      },
    });
  if (systemSubject) return createClient();
  globalForOpenAI.openai ??= createClient();

  return globalForOpenAI.openai;
}
