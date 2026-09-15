const CAREER_NAVIGATION = /^(?:search (?:all )?jobs|career areas|working here|current employees(?: start here)?|create account\s*\/\s*sign in)$/i;
const JOB_METADATA = /^(?:job category|job level|business unit|work type|job location|requisition id(?: #)?|job id)$/i;
const SALARY_BOUND = /^(?:(?:minimum|maximum) base salary(?: \([^\n]+\))?|[\w ()/-]+ (?:minimum|maximum))$/i;
const BULLET = /^(?:[-*–]\s+|[•·▪◦]\s*)\S/;

function labelText(line: string) {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*(.*?)\*\*$/, "$1").replace(/:$/, "").trim();
}

export function descriptionMetadata(text: string): { label: string; value: string } | null {
  const match = text.match(/^([^:\n]+):\s+(.+)$/);
  if (!match) return null;
  const [, label, value] = match;
  if (JOB_METADATA.test(label) || (SALARY_BOUND.test(label) && /^(?:[A-Z]{3}\s*)?[$£€]\s*\d/.test(value))) return { label, value };
  return null;
}

/** Repair old whole-page extracts only when a repeated title identifies the real posting. */
export function stripCareerPageNavigation(raw: string): string {
  const lines = raw.split("\n");
  const entries = lines.map((line, index) => ({ text: labelText(line), index })).filter(({ text }) => text);
  const firstNavigation = entries.findIndex(({ text }) => CAREER_NAVIGATION.test(text));
  if (firstNavigation < 0) return raw;
  const prefixLabels = new Set(entries.slice(0, firstNavigation).map(({ text }) => text));
  const navigation = new Set<string>();
  for (let index = firstNavigation; index < Math.min(entries.length, 500); index += 1) {
    const entry = entries[index];
    if (CAREER_NAVIGATION.test(entry.text)) navigation.add(entry.text.toLowerCase());
    // Long prose before the apparent posting might be substantive content, not navigation.
    if (entries[index - 1]?.text.length > 180) return raw;
    if (navigation.size < 3 || !prefixLabels.has(entry.text)) continue;
    const following = entries.slice(index + 1, index + 22);
    if (!following.slice(0, 4).some(({ text }) => /^(?:requisition|job) (?:id|number)\s*[:#]?\s*[\w-]+$/i.test(text))) continue;
    if (following.filter(({ text }) => JOB_METADATA.test(text)).length < 3) continue;
    if (entries.slice(0, firstNavigation).some(({ text }) => text.length > 180)) return raw;

    // A copied table of contents is useful evidence of headings whose HTML was lost.
    const headings = new Set([...prefixLabels].filter((text) => text !== entry.text && text.split(/\s+/).length >= 2 && !JOB_METADATA.test(text) && !SALARY_BOUND.test(text) && !/[$£€]/.test(text)));
    return lines.slice(entry.index).map((line) => headings.has(labelText(line)) ? `## ${labelText(line)}` : line).join("\n");
  }
  return raw;
}

export function repairDescriptionTextStructure(raw: string): string {
  const lines = stripCareerPageNavigation(raw)
    .replace(/\u200b/g, "")
    .replace(/^(Minimum|Desired|Required|Preferred):[ \t]*(?=[•·▪◦]|[-*–]\s)/gim, "## $1\n")
    .replace(/(^|\s)[•·▪◦][ \t]*(?=\S)/g, "$1• ")
    .split("\n");
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const label = labelText(line);
    if (JOB_METADATA.test(label) || SALARY_BOUND.test(label)) {
      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      const value = lines[next]?.trim() ?? "";
      const fact = descriptionMetadata(`${label}: ${value}`);
      if (fact && value.length <= 160 && !JOB_METADATA.test(labelText(value)) && !/^(?:#|[•·▪◦]|[-*–]\s|(?:position summary|job description|job responsibilities|qualifications)$)/i.test(value)) {
        result.push(`${label}: ${value}`);
        index = next;
        continue;
      }
    }
    const inlineSalary = line.match(/^(.+?)\s+((?:[A-Z]{3}\s*)?[$£€]\s*\d.*)$/);
    if (inlineSalary && SALARY_BOUND.test(inlineSalary[1])) {
      result.push(`${inlineSalary[1]}: ${inlineSalary[2]}`);
      continue;
    }
    result.push(lines[index]);
  }

  // Recover broken glyph bullets from text dumps. Leave HTML/Markdown's "-"
  // lists alone: their paragraph boundaries already carry source structure.
  const joined: string[] = [];
  let lastContent = -1;
  for (let index = 0; index < result.length; index += 1) {
    const line = result[index].trim();
    if (!line) {
      joined.push(result[index]);
      continue;
    }
    const previous = joined[lastContent] ?? "";
    let next = index + 1;
    while (next < result.length && !result[next].trim()) next += 1;
    const nextBullet = BULLET.test(result[next]?.trim() ?? "");
    const continuation = (/^\p{Ll}/u.test(line) && (nextBullet || /\/$/.test(previous))) || (line.length <= 80 && /\.$/.test(line) && nextBullet);
    if (line && !BULLET.test(line) && !/^#/.test(line) && /^[•·▪◦]/.test(previous) && !/[.!?;:]$/.test(previous) && continuation && !descriptionMetadata(line)) {
      joined[lastContent] = `${previous} ${line}`;
      joined.length = lastContent + 1;
    } else {
      joined.push(result[index]);
      if (line) lastContent = joined.length - 1;
    }
  }
  return joined.join("\n");
}
