import * as assert from "assert";
import { findMermaidBlocks } from "../utils/mermaid-blocks";

suite("findMermaidBlocks", () => {
  test("finds fenced mermaid blocks with line ranges and code", () => {
    const md = [
      "# Title",
      "```mermaid",
      "graph TD",
      "  A-->B",
      "```",
      "text",
    ].join("\n");
    const blocks = findMermaidBlocks(md);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].fenceStartLine, 1);
    assert.strictEqual(blocks[0].fenceEndLine, 4);
    assert.strictEqual(blocks[0].code, "graph TD\n  A-->B");
  });

  test("ignores non-mermaid code fences", () => {
    const md = "```js\nconst x = 1;\n```";
    assert.strictEqual(findMermaidBlocks(md).length, 0);
  });
});
