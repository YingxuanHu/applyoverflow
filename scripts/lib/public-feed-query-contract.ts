import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Prisma } from "../../src/generated/prisma/client";
import { JOB_BOARD_MIN_AVAILABILITY_SCORE } from "../../src/lib/jobs/visibility";
import { REGISTRATION_GATED_BOARD_PREFIXES } from "../../src/lib/jobs/outbound-policy";
import { requireEvidence } from "./launch-evidence-safety";

const DECLARATIONS = [
  "UNKNOWN_COMPANY_VISIBILITY_BLOCKLIST", "GENERIC_ATS_COMPANY_VISIBILITY_BLOCKS",
  "DEFAULT_MIN_AVAILABILITY_SCORE", "FILTERABLE_CLASSIFICATION_STATUSES",
  "buildRawCompanyVisibilitySql", "buildRawCanonicalPublicFeedWhere", "buildRawDefaultPublicFeedWhere",
] as const;

// The production predicates are private. Compile only their AST declarations,
// not the application module (which initializes DB/auth clients on import).
// This adapter can disappear once an owner exports these pure query builders.
export function loadPublicFeedContract(source = readFileSync(new URL("../../src/lib/queries/jobs.ts", import.meta.url), "utf8")) {
  const file = ts.createSourceFile("jobs.ts", source, ts.ScriptTarget.Latest, true);
  const hasCall = (node: ts.Node, name: string): boolean => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) return true;
    return node.getChildren(file).some((child) => hasCall(child, name));
  };
  for (const [consumer, dependency] of [["getPublicRankedFeedIndexRows", "buildRawDefaultPublicFeedWhere"], ["getJobsFromFeedIndex", "getPublicRankedFeedIndexRows"]]) {
    const declaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === consumer);
    requireEvidence(declaration && hasCall(declaration, dependency), "PUBLIC_QUERY_CONSUMER_CHANGED");
  }
  const snippets: string[] = [];
  for (const name of DECLARATIONS) {
    const matches = file.statements.flatMap((statement) => {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return [statement.getText(file)];
      if (!ts.isVariableStatement(statement)) return [];
      return statement.declarationList.declarations
        .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)
        .map((declaration) => `const ${declaration.getText(file)};`);
    });
    requireEvidence(matches.length === 1, "PUBLIC_QUERY_CONTRACT_CHANGED");
    snippets.push(matches[0]);
  }
  const code = ts.transpileModule(snippets.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ Prisma, Date, JOB_BOARD_MIN_AVAILABILITY_SCORE, REGISTRATION_GATED_BOARD_PREFIXES, now: null }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(code, context, { timeout: 1000 });
  const classificationStatuses = Array.from(vm.runInContext("FILTERABLE_CLASSIFICATION_STATUSES", context, { timeout: 1000 })) as string[];
  return {
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    predicateSha256: createHash("sha256").update(code).update(JSON.stringify({ JOB_BOARD_MIN_AVAILABILITY_SCORE, REGISTRATION_GATED_BOARD_PREFIXES })).digest("hex"),
    classificationStatuses,
    where(now: Date): Prisma.Sql {
      context.now = now;
      return vm.runInContext("buildRawDefaultPublicFeedWhere(now, null)", context, { timeout: 1000 }) as Prisma.Sql;
    },
  };
}
