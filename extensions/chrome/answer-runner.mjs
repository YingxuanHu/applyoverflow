import { questionAssistance } from "./question-policy.mjs";

export const canPrepareAnswer = field => field.state === "needed" && field.canAnswer && !field.profileKey && !field.aiRestricted &&
  ((field.kind === "text" && ["draft", "context"].includes(questionAssistance(field.label))) || questionAssistance(field.label) === "qualification");

// The worker owns this queue, so closing the toolbar does not stop Autofill.
// Generation can overlap; DOM writes stay serialized and recheck live values.
export async function fillProfessionalAnswers({ fields, inspect, suggest, progress }) {
  const candidates = fields.filter(canPrepareAnswer).slice(0, 40);
  const waiting = new Set(candidates.map(f => f.id)), processing = new Set(), outcomes = new Map();
  const deadline = Date.now() + 240_000;
  let current = fields;
  const display = () => current.map(field => ({ ...field,
    ...(field.state === "needed" ? { queued: waiting.has(field.id), processing: processing.has(field.id),
      ...(outcomes.has(field.id) ? { reason: outcomes.get(field.id) } : {}) } : {}),
  }));
  await progress(display(), candidates.length ? "Filling profile-supported answers..." : "Autofill complete.");
  for (let offset = 0; offset < candidates.length; offset += 2) {
    if (Date.now() >= deadline) {
      for (const field of candidates.slice(offset)) {
        waiting.delete(field.id);
        outcomes.set(field.id, "Time limit reached. Click Autofill again to continue.");
      }
      break;
    }
    const batch = candidates.slice(offset, offset + 2);
    for (const field of batch) {
      processing.add(field.id);
      if (field.kind === "combobox" && !field.options?.length) {
        const loaded = await inspect("autofill-options", { id: field.id, label: field.label });
        field.options = loaded.fields?.find(f => f.id === field.id)?.options || [];
      }
    }
    await progress(display(), `Answering: ${batch.map(f => f.label.replace(/[*]/g, "").trim()).join("; ")}`);
    const prepared = await Promise.all(batch.map(async field => {
      try {
        if (field.kind !== "text" && !field.options?.length) return { field, reason: "The site's choices could not be read. Choose on the form." };
        const result = await suggest(field);
        const answer = result.suggestion?.answer;
        if (!answer || result.suggestion?.missing) return { field, reason: result.suggestion?.missing || "Your profile does not include enough information for this question." };
        if (field.kind !== "text" && !field.options.includes(answer)) return { field, reason: "No exact supported choice. Choose on the form." };
        return { field, answer };
      } catch (error) {
        if (error.reconnect) throw error;
        return { field, reason: error.status === 429 ? "Answer generation is temporarily limited. Try Autofill again in a few minutes." :
          error.status === 409 ? "Your profile changed. Click Autofill to use the latest details." :
          "Could not prepare a supported answer. Retry Autofill or complete this field on the form." };
      }
    }));
    for (const { field, answer, reason } of prepared) {
      const latest = await inspect("inspect");
      const target = latest.fields?.find(f => f.id === field.id && f.label === field.label);
      if (answer && target?.state === "needed" && canPrepareAnswer(target)) {
        try { await inspect("autofill-answer", { id: field.id, label: field.label, answer }); }
        catch { outcomes.set(field.id, "The form changed or did not accept this answer. Check the field on the page."); }
      } else if (reason) outcomes.set(field.id, reason);
      waiting.delete(field.id); processing.delete(field.id);
      current = (await inspect("inspect")).fields || [];
      await progress(display(), target?.state !== "needed" ? `Kept your answer: ${field.label}` :
        current.some(f => f.id === field.id && f.state === "filled") ? `Filled: ${field.label}` : `Left empty: ${field.label}`);
    }
  }
  return display();
}
