// Only repeat the idempotent, claim-fenced completion write, never ranking work.
export async function retryRefreshCompletion<T>(
  complete: () => Promise<T>,
  wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await complete(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (attempt >= 2 || !["P2024", "P2028", "P1001", "P1017"].includes(String(code))) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}
