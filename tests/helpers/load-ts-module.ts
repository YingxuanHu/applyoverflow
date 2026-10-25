import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Execute the unmodified module with explicit dependency doubles. This keeps
// route/auth behavior under test without opening database/network connections.
export function loadTsModule<T>(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loaded = { exports: {} };
  runInNewContext(outputText, {
    module: loaded, exports: loaded.exports,
    require: (name: string) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name.startsWith("@/")) throw new Error(`Unmocked application import: ${name}`);
      return require(name);
    },
    process, console, Error, TypeError, Date, URL, Headers, Request, Response,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, atob, setTimeout, clearTimeout,
    ...globals,
  }, { filename: path });
  return loaded.exports as T;
}
