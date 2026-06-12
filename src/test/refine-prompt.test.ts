import * as assert from "assert";
import { buildRefinePrompt, MAX_DESCRIPTION_CHARS } from "../services/refine-prompt";
import { toApiType } from "../services/diagram-type-map";
import { DiagramType } from "../types";

suite("buildRefinePrompt", () => {
  test("embeds current code and instruction, asks for full diagram", () => {
    const out = buildRefinePrompt({
      currentCode: "graph TD\n  A-->B",
      instruction: "make it left to right",
      diagramType: DiagramType.Flowchart,
    });
    assert.ok(out.includes("graph TD"), "includes current code");
    assert.ok(out.includes("make it left to right"), "includes instruction");
    assert.ok(/return the complete updated mermaid/i.test(out), "asks for full diagram");
  });

  test("MAX_DESCRIPTION_CHARS matches the platform 10k cap", () => {
    assert.strictEqual(MAX_DESCRIPTION_CHARS, 10000);
  });
});

suite("toApiType", () => {
  test("maps to the raw-fetch type strings the context-menu path uses", () => {
    assert.strictEqual(toApiType(DiagramType.Flowchart), "flowchart");
    assert.strictEqual(toApiType(DiagramType.Class), "classDiagram");
    assert.strictEqual(toApiType(DiagramType.Sequence), "sequenceDiagram");
  });
  test("falls back to the enum value for unmapped types", () => {
    assert.strictEqual(toApiType(DiagramType.Timeline), "timeline");
  });
});
