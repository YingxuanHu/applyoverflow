import "dotenv/config";

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  compareSourceIntelligenceBaselines,
  formatSourceIntelligenceComparisonMarkdown,
  type SourceIntelligenceBaselineLike,
} from "@/lib/ingestion/source-intelligence-metrics";

type Args = {
  beforePath: string;
  afterPath: string;
  outputDir: string;
  label: string;
};

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  let beforePath = "";
  let afterPath = "";
  let outputDir = path.resolve(process.cwd(), "data/discovery");
  let label = `source-intelligence-comparison-${today}`;

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const next = argv[index + 1];

    if (arg === "--before") {
      const value = inlineValue ?? next;
      if (!value) continue;
      beforePath = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--after") {
      const value = inlineValue ?? next;
      if (!value) continue;
      afterPath = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const value = inlineValue ?? next;
      if (!value) continue;
      outputDir = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--label") {
      const value = inlineValue ?? next;
      if (!value) continue;
      label = value.replace(/[^a-zA-Z0-9._-]/g, "-");
      if (!inlineValue) index += 1;
    }
  }

  if (!beforePath || !afterPath) {
    throw new Error("Usage: source:intelligence-compare --before <file> --after <file>");
  }

  return { beforePath, afterPath, outputDir, label };
}

async function readBaseline(filePath: string): Promise<SourceIntelligenceBaselineLike> {
  return JSON.parse(await readFile(filePath, "utf8")) as SourceIntelligenceBaselineLike;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [before, after] = await Promise.all([
    readBaseline(args.beforePath),
    readBaseline(args.afterPath),
  ]);
  const comparison = compareSourceIntelligenceBaselines(before, after);
  const markdown = formatSourceIntelligenceComparisonMarkdown(comparison);

  await mkdir(args.outputDir, { recursive: true });
  const basePath = path.join(args.outputDir, args.label);
  await writeFile(`${basePath}.json`, JSON.stringify(comparison, null, 2));
  await writeFile(`${basePath}.md`, markdown);

  console.log(
    JSON.stringify(
      {
        before: args.beforePath,
        after: args.afterPath,
        jsonPath: `${basePath}.json`,
        markdownPath: `${basePath}.md`,
        headline: comparison.metrics
          .filter((metric) =>
            [
              "feed_live_jobs",
              "active_validated_pollable_sources",
              "source_poll_backoff",
              "source_tasks_pending",
            ].includes(metric.key)
          )
          .map((metric) => ({
            key: metric.key,
            before: metric.before,
            after: metric.after,
            delta: metric.delta,
          })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    "[source:intelligence-compare] failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
