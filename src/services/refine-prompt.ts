import { DiagramType } from "../types";

/** Mirrors the platform-wide generation input cap (see CLAUDE.md "Size limits"). */
export const MAX_DESCRIPTION_CHARS = 10000;

/**
 * Build the `description` (model prompt) for a refinement. We embed the current
 * Mermaid source + the user's instruction into the existing generate endpoint's
 * description field, so refinement works against today's deployed API with no
 * backend change. Pure + side-effect free for testability.
 */
export function buildRefinePrompt(params: {
  currentCode: string;
  instruction: string;
  diagramType: DiagramType;
}): string {
  return [
    "Here is the current Mermaid diagram:",
    "```mermaid",
    params.currentCode.trim(),
    "```",
    `Apply this change: ${params.instruction.trim()}.`,
    "Return the complete updated Mermaid diagram only, with no commentary.",
  ].join("\n");
}
