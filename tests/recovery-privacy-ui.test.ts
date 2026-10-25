import assert from "node:assert/strict";
import test from "node:test";
import { Children, createElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module";

const { default: ErrorBoundary } = loadTsModule<typeof import("../src/app/error")>("src/app/error.tsx", {
  "@/components/ui/button": { Button: "button" }, "lucide-react": { RotateCw: "svg" },
});

function elements(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return [];
    return [child, ...elements(child.props.children)];
  });
}

test("error boundary's retry button invokes Next's refetch callback", () => {
  let calls = 0;
  const tree = ErrorBoundary({ error: new Error("private data"), retry: () => { calls++; } });
  const button = elements(tree).find(element => element.type === "button");
  assert.ok(button?.props.onClick);
  button.props.onClick();
  assert.equal(calls, 1);
});

test("error boundary handles arbitrary thrown values without exposing messages or claiming monitoring", () => {
  for (const error of [null, "private-token", { message: "private-resume", digest: "private-token" }, new Error("private-password")]) {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, { error, retry() {} }));
    assert.match(html, /do not need to sign out/);
    assert.doesNotMatch(html, /private|logged automatically/);
  }
  const error = Object.assign(new Error("private"), { digest: "123456" });
  assert.match(renderToStaticMarkup(createElement(ErrorBoundary, { error, retry() {} })), /Error ID: 123456/);
});

test("rendered privacy notice discloses default corrections, on-form drafts and bounded diagnostics", () => {
  const { default: Privacy } = loadTsModule<typeof import("../src/app/extension/privacy/page")>("src/app/extension/privacy/page.tsx", {
    "next/link": { __esModule: true, default: "a" }, "@/components/brand/brand-logo": { BrandLogo: () => null },
  });
  const html = renderToStaticMarkup(createElement(Privacy));
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /checked by default in the toolbar and on-page assistant/);
  assert.match(text, /correct a uniquely matched work or education record/);
  assert.match(text, /Turn it off before Autofill to keep prefilled values/);
  assert.match(text, /inserted with Fill answer or Use answer/);
  assert.match(text, /insert supported professional answers directly into the employer form/);
  assert.match(text, /When onboarding measurement is enabled/);
  assert.match(text, /report-only mode; it does not enforce/);
  assert.match(text, /Autofill never submits/);
  assert.doesNotMatch(text, /existing answers, passwords/);
});
