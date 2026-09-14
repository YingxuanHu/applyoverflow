import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const directory = mkdtempSync(join(tmpdir(), "pdf-runtime-smoke-"));
try {
  for (const compiler of ["pdflatex", "xelatex"]) {
    for (const [name, source] of Object.entries(fixtures)) {
      const stem = `${name}-${compiler}`;
      writeFileSync(join(directory, `${stem}.tex`), source);
      try {
        execFileSync(compiler, ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", `-output-directory=${directory}`, `${stem}.tex`], {
          cwd: directory, env: { ...process.env, openin_any: "p", openout_any: "p" }, timeout: 45000, stdio: "pipe",
        });
      } catch (error) {
        throw new Error(`${stem} failed: ${error.stdout?.toString().slice(-8000) ?? error.message}`);
      }
      const pdf = readFileSync(join(directory, `${stem}.pdf`));
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.length > 1000);
      if (process.env.PDF_SMOKE_OUTPUT_DIR) {
        mkdirSync(process.env.PDF_SMOKE_OUTPUT_DIR, { recursive: true });
        copyFileSync(join(directory, `${stem}.pdf`), join(process.env.PDF_SMOKE_OUTPUT_DIR, `${stem}.pdf`));
      }
      console.log(`${stem}: valid PDF (${pdf.length} bytes)`);
    }
    const guarded = join(directory, compiler);
    mkdirSync(guarded);
    writeFileSync(join(directory, "outside.txt"), "Private test fixture");
    const runProbe = (source) => {
      writeFileSync(join(guarded, "probe.tex"), source);
      return () => execFileSync(compiler, ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${guarded}`, "probe.tex"], {
        cwd: guarded, env: { ...process.env, openin_any: "p", openout_any: "p" }, timeout: 45000, stdio: "pipe",
      });
    };
    runProbe(String.raw`\documentclass{article}\begin{document}\immediate\write18{touch shell-escape-marker}Safe\end{document}`)();
    assert.equal(existsSync(join(guarded, "shell-escape-marker")), false, "shell escape must stay disabled");
    assert.throws(runProbe(String.raw`\documentclass{article}\begin{document}\input{../outside.txt}\end{document}`), "parent-directory reads must fail");
    assert.throws(runProbe(String.raw`\documentclass{article}\begin{document}\newwrite\out\immediate\openout\out=../escape.txt\immediate\write\out{unsafe}\end{document}`), "parent-directory writes must fail");
    assert.equal(existsSync(join(directory, "escape.txt")), false);
    console.log(`${compiler}: shell escape and parent-directory access blocked`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
