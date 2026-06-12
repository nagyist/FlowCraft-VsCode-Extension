import * as assert from "assert";
import { summarizeFolder, buildFileContext, MAX_CONTEXT_CHARS } from "../utils/visualize-context";

suite("summarizeFolder", () => {
  test("produces a tree + per-file import/export summary", () => {
    const files = [
      { relPath: "a.ts", text: "import { B } from './b';\nexport class A {}" },
      { relPath: "b.ts", text: "export function B() {}" },
    ];
    const out = summarizeFolder("src", files);
    assert.ok(out.includes("a.ts"), "lists a.ts");
    assert.ok(out.includes("b.ts"), "lists b.ts");
    assert.ok(out.includes("export class A"), "captures a.ts export");
    assert.ok(out.includes("import { B }"), "captures a.ts import");
  });

  test("truncates to the cap and notes truncation", () => {
    const big = { relPath: "big.ts", text: "export const x = 1;\n".repeat(5000) };
    const out = summarizeFolder("src", [big]);
    assert.ok(out.length <= MAX_CONTEXT_CHARS, "respects the cap");
    assert.ok(/truncated/i.test(out), "notes truncation");
  });
});

suite("buildFileContext", () => {
  test("caps oversized input at MAX_CONTEXT_CHARS", () => {
    assert.strictEqual(buildFileContext("a".repeat(20000)).length, MAX_CONTEXT_CHARS);
  });
});
