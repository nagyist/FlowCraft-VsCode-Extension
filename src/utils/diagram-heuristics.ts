import { DiagramType } from "../types";

/**
 * Best-effort diagram type from code shape, so "Visualize this" needs zero
 * prompt input. Folder → architecture graph (flowchart); OOP → class diagram;
 * otherwise flowchart. The viewer offers a one-click override.
 */
export function pickDiagramType(
  code: string,
  _languageId: string,
  isFolder: boolean
): DiagramType {
  if (isFolder) {
    return DiagramType.Flowchart;
  }
  // OOP signal: class/interface declarations (TS/JS/Java/Python/C#).
  if (/\b(class|interface)\s+[A-Za-z_]/.test(code)) {
    return DiagramType.Class;
  }
  return DiagramType.Flowchart;
}
