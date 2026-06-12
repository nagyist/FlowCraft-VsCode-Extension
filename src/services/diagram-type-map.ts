import { DiagramType } from "../types";

/**
 * Map our DiagramType enum to the raw `type` strings the proven raw-fetch
 * generation path (`runMermaidGeneration`) sends to /v2/diagrams/generate
 * ("flowchart", "classDiagram", ...). Unmapped types fall back to the enum value.
 */
const API_TYPE: Partial<Record<DiagramType, string>> = {
  [DiagramType.Flowchart]: "flowchart",
  [DiagramType.Class]: "classDiagram",
  [DiagramType.Sequence]: "sequenceDiagram",
  [DiagramType.State]: "stateDiagram",
  [DiagramType.ER]: "erDiagram",
};

export function toApiType(type: DiagramType): string {
  return API_TYPE[type] ?? type;
}
