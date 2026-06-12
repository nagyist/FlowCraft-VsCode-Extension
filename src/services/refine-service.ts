import { AuthResolver } from "../api/auth-resolver";
import { DiagramType } from "../types";
import { buildRefinePrompt, MAX_DESCRIPTION_CHARS } from "./refine-prompt";
import { toApiType } from "./diagram-type-map";

export interface RefineRequest {
  currentCode: string;
  instruction: string;
  diagramType: DiagramType;
  title?: string;
}

export interface RefineResult {
  code: string;
  diagramId?: string;
}

/**
 * Turns a "current Mermaid + NL instruction" into updated Mermaid by calling the
 * existing /v2/diagrams/generate endpoint with an embedded refine prompt. BYOK
 * auth only (never FlowCraft server keys), matching the generation path.
 */
export class RefineService {
  constructor(
    private readonly authResolver: AuthResolver,
    private readonly getApiUrl: () => string
  ) {}

  async refine(req: RefineRequest): Promise<RefineResult> {
    const description = buildRefinePrompt(req);
    if (description.length > MAX_DESCRIPTION_CHARS) {
      throw new Error(
        "This diagram is too large to refine (max 10,000 characters). Simplify it first."
      );
    }

    const auth = await this.authResolver.resolveByok();
    const response = await fetch(`${this.getApiUrl()}/v2/diagrams/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [auth.headerName]: auth.headerValue,
      },
      body: JSON.stringify({
        title: req.title ?? "Refined diagram",
        description,
        type: toApiType(req.diagramType),
      }),
    });

    if (!response.ok) {
      throw new Error(`FlowCraft API error (${response.status}).`);
    }

    const data: any = await response.json();
    const res = data?.response;
    const code: string | undefined = res?.mermaid_code;
    if (!code) {
      throw new Error("FlowCraft didn't return updated diagram code.");
    }
    return { code, diagramId: res?.inserted_diagram?.data?.[0]?.id };
  }
}
