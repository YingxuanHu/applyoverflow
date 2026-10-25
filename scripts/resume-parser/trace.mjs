import { createRequire } from "node:module";
import { resolve } from "node:path";

// Use Next's own tracer, including the existing parser dependencies' transitive
// files. An include of worker.cjs alone does not trace its require() graph.
export async function traceResumeParserFiles(root) {
  const require = createRequire(resolve(root, "package.json"));
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
  const { fileList } = await nodeFileTrace([
    resolve(root, "scripts/resume-parser/worker.cjs"),
    resolve(root, "scripts/resume-parser/runtime.cjs"),
    // createRequire at the existing dependency's location is not traced by all NFT versions.
    createRequire(require.resolve("word-extractor")).resolve("yauzl"),
  ], { base: root, processCwd: root });
  return [...fileList].map((file) => `./${file.replaceAll("\\", "/")}`);
}
