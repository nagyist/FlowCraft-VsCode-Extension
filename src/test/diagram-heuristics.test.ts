import * as assert from "assert";
import { pickDiagramType } from "../utils/diagram-heuristics";
import { DiagramType } from "../types";

suite("pickDiagramType", () => {
  test("folder → flowchart (architecture/graph)", () => {
    assert.strictEqual(pickDiagramType("", "", true), DiagramType.Flowchart);
  });
  test("OOP code → class diagram", () => {
    const code = "export class Foo {\n  bar(): void {}\n}";
    assert.strictEqual(pickDiagramType(code, "typescript", false), DiagramType.Class);
  });
  test("procedural code → flowchart", () => {
    const code = "function add(a, b) { return a + b; }";
    assert.strictEqual(pickDiagramType(code, "javascript", false), DiagramType.Flowchart);
  });
});
