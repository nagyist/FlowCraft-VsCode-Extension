# Extension Growth Trio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three extension-only VS Code features — a conversational refine loop in the diagram viewer, a zero-typing "Visualize this" right-click action, and Mermaid-in-Markdown live authoring — on top of a shared `RefineService`.

**Architecture:** A new pure prompt builder + `RefineService` wrap the existing `/v2/diagrams/generate` raw-fetch path (auth via `AuthResolver.resolveByok`, `X-api-key` BYOK). The refine loop and markdown authoring both consume `RefineService`. Visualize-this adds a context builder + heuristic diagram-type picker over the existing generation path. All pure logic (prompt building, type heuristics, folder summarizing, fence parsing) is isolated into vscode-free modules so it is unit-testable; VS Code wiring lives in `extension.ts`, `RenderService`, and a new CodeLens provider.

**Tech Stack:** TypeScript (strict, Node16, ES2022), VS Code Extension API, Mermaid (in webview), `vscode-test`/mocha for tests.

---

## File Structure

**New (pure, unit-tested, no `vscode` import):**
- `src/services/refine-prompt.ts` — `buildRefinePrompt()`, `MAX_DESCRIPTION_CHARS`.
- `src/services/diagram-type-map.ts` — `toApiType(DiagramType): string` (legacy raw-fetch type strings).
- `src/utils/diagram-heuristics.ts` — `pickDiagramType(code, languageId, isFolder): DiagramType`.
- `src/utils/visualize-context.ts` — `buildFileContext()`, `summarizeFolder()`.
- `src/utils/mermaid-blocks.ts` — `findMermaidBlocks(text): MermaidBlock[]`.

**New (VS Code-aware):**
- `src/services/refine-service.ts` — `RefineService` (fetch + auth).
- `src/providers/mermaid-codelens.ts` — `MermaidCodeLensProvider`.

**New tests:**
- `src/test/refine-prompt.test.ts`, `src/test/diagram-heuristics.test.ts`, `src/test/visualize-context.test.ts`, `src/test/mermaid-blocks.test.ts`.

**Modified:**
- `src/services/render-service.ts` — refine bar + history + type-override in webview; refine stack + new message handlers.
- `src/extension.ts` — construct `RefineService`; wire `RenderService` refine/type callbacks; `flowcraft.visualizeThis` + `flowcraft.insertMermaidBlock` commands; register CodeLens provider.
- `src/services/telemetry-service.ts` — add new event names + props.
- `package.json` — new commands + menu contributions.

---

## Phase 0 — RefineService foundation

### Task 1: `buildRefinePrompt` (pure)

**Files:**
- Create: `src/services/refine-prompt.ts`
- Test: `src/test/refine-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/refine-prompt.test.ts
import * as assert from "assert";
import { buildRefinePrompt, MAX_DESCRIPTION_CHARS } from "../services/refine-prompt";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `../services/refine-prompt`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/refine-prompt.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS (both `buildRefinePrompt` tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/refine-prompt.ts src/test/refine-prompt.test.ts
git commit -m "feat: add buildRefinePrompt prompt builder"
```

### Task 2: `toApiType` diagram-type map (pure)

**Files:**
- Create: `src/services/diagram-type-map.ts`
- Test: append to `src/test/refine-prompt.test.ts`

- [ ] **Step 1: Write the failing test** (append a new suite)

```ts
// append to src/test/refine-prompt.test.ts
import { toApiType } from "../services/diagram-type-map";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `../services/diagram-type-map`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/diagram-type-map.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/diagram-type-map.ts src/test/refine-prompt.test.ts
git commit -m "feat: add toApiType diagram-type map"
```

### Task 3: `RefineService`

**Files:**
- Create: `src/services/refine-service.ts`

> No unit test: this is a thin network/auth wrapper exercised manually in the
> Phase 1 verification (F5). Its only non-trivial logic — the prompt and the cap
> — is already covered by Task 1.

- [ ] **Step 1: Write the implementation**

```ts
// src/services/refine-service.ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/refine-service.ts
git commit -m "feat: add RefineService over /v2/diagrams/generate"
```

### Task 4: Telemetry event names

**Files:**
- Modify: `src/services/telemetry-service.ts:23-38`

- [ ] **Step 1: Extend the event-name union and props**

Replace the `TelemetryEventName` union (lines 23-31) and add a prop. New union:

```ts
export type TelemetryEventName =
  | "extension_activated"
  | "generation_succeeded"
  | "generation_failed"
  | "upgrade_prompt_shown"
  | "upgrade_clicked"
  | "upgrade_link_clicked"
  | "free_limit_exhausted"
  | "signed_in"
  | "refine_requested"
  | "refine_succeeded"
  | "refine_failed"
  | "visualize_requested"
  | "markdown_insert_requested";
```

In `TelemetryProps` (after `error_kind?: string;`) add:

```ts
  /** Entry surface for visualize/refine, e.g. "file" | "folder" | "selection" | "markdown". */
  surface?: string;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/telemetry-service.ts
git commit -m "feat: add refine/visualize telemetry event names"
```

---

## Phase 1 — Conversational refine loop (RenderService)

The webview HTML is inline in `render-service.ts`. We add a refine bar + history
strip, a refine stack on the service, and wire `RefineService` from `extension.ts`
via a callback (mirrors the existing `onExportRequested` / `webUrlFor` pattern).

### Task 5: Refine stack + callback on RenderService (extension wiring)

**Files:**
- Modify: `src/services/render-service.ts` (class fields, `view()`, message handler)
- Modify: `src/extension.ts` (construct `RefineService`, set callback)

- [ ] **Step 1: Add the refine callback + stack fields to RenderService**

In `render-service.ts`, after the existing `webUrlFor` declaration (around line 57) add:

```ts
  /** Wired by extension.ts to run a refinement; returns updated Mermaid code. */
  public onRefine:
    | ((diagram: Diagram, instruction: string) => Promise<string>)
    | undefined;

  /** Per-active-diagram refine history (Mermaid versions), oldest first. */
  private refineStack: string[] = [];
```

- [ ] **Step 2: Reset the stack when a new diagram is viewed**

In `view()`, right after `this.current = diagram;` (around line 69) add:

```ts
    this.refineStack = [diagram.content ?? ""];
```

- [ ] **Step 3: Post refine UI state after each render**

In `renderCurrent()`, just after the existing `uiState` postMessage (around line 170) add:

```ts
    panel.webview.postMessage({
      command: "refineState",
      data: { steps: this.refineStack.length, busy: false },
    });
```

- [ ] **Step 4: Handle `refine` and `refineUndo` messages**

In `handleMessage()`'s `switch (command)` (around line 212), add two cases before `default`:

```ts
      case "refine": {
        void this.handleRefine(String(data.instruction ?? ""));
        break;
      }
      case "refineUndo": {
        void this.handleRefineUndo();
        break;
      }
```

- [ ] **Step 5: Add the handler methods**

Add these private methods to the class (after `handleToolbar`):

```ts
  private async handleRefine(instruction: string): Promise<void> {
    const diagram = this.current;
    if (!diagram || !instruction.trim() || !this.onRefine) {
      return;
    }
    this.panel?.webview.postMessage({
      command: "refineState",
      data: { steps: this.refineStack.length, busy: true },
    });
    try {
      const newCode = await this.onRefine(diagram, instruction.trim());
      diagram.content = newCode;
      this.refineStack.push(newCode);
      await this.renderCurrent();
    } catch (err) {
      this.panel?.webview.postMessage({
        command: "refineError",
        data: { message: (err as Error).message || "Refine failed." },
      });
    }
  }

  private async handleRefineUndo(): Promise<void> {
    const diagram = this.current;
    if (!diagram || this.refineStack.length <= 1) {
      return;
    }
    this.refineStack.pop();
    diagram.content = this.refineStack[this.refineStack.length - 1];
    await this.renderCurrent();
  }
```

- [ ] **Step 6: Construct RefineService and wire the callback in extension.ts**

In `extension.ts`, after `const renderService = new RenderService(...)` block (around line 418-431, near `renderService.webUrlFor = ...`) add:

```ts
  const refineService = new RefineService(
    authResolver,
    () => process.env.FLOWCRAFT_API_URL || FLOWCRAFT_API_URL
  );
  renderService.onRefine = async (diagram, instruction) => {
    telemetry.track("refine_requested", { diagram_type: diagram.type });
    try {
      const result = await refineService.refine({
        currentCode: diagram.content ?? "",
        instruction,
        diagramType: diagram.type,
        title: diagram.title,
      });
      telemetry.track("refine_succeeded", { diagram_type: diagram.type });
      return result.code;
    } catch (err) {
      telemetry.track("refine_failed", {
        diagram_type: diagram.type,
        error_kind: classifyErrorKind((err as Error).message),
      });
      throw err;
    }
  };
```

Add the import at the top of `extension.ts` (near the other service imports, around line 19):

```ts
import { RefineService } from "./services/refine-service";
```

- [ ] **Step 7: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/render-service.ts src/extension.ts
git commit -m "feat: refine stack + RefineService wiring on the viewer"
```

### Task 6: Refine bar + history UI in the webview HTML

**Files:**
- Modify: `src/services/render-service.ts` (`getHtml`: CSS, markup, script)

- [ ] **Step 1: Add CSS for the refine bar**

In `getHtml`'s `<style>` block (before `</style>`, around line 392) add:

```css
    .refinebar {
      display: flex; gap: 6px; align-items: center;
      padding: 8px 10px;
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      flex: 0 0 auto;
    }
    .refinebar input {
      flex: 1 1 auto; font: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
      border-radius: 4px; padding: 5px 8px;
    }
    .refinebar .hint { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .refinebar .err { color: var(--vscode-errorForeground, #f14c4c); font-size: 11px; }
    .refinebar button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: Add the refine bar markup**

Immediately after the `<div class="stage">…</div>` line (around line 403) add:

```html
  <div class="refinebar">
    <input id="rf-input" type="text" placeholder="Refine: e.g. 'make it left-to-right', 'add the error path'…" />
    <button id="rf-go" title="Apply this change">Refine</button>
    <button id="rf-undo" title="Step back to the previous version" disabled>↶ Back</button>
    <span id="rf-status" class="hint"></span>
  </div>
```

- [ ] **Step 3: Add the refine script**

Inside the webview IIFE, before the final `vscode.postMessage({ command: "ready" });` (around line 543) add:

```js
      const rfInput = document.getElementById("rf-input");
      const rfGo = document.getElementById("rf-go");
      const rfUndo = document.getElementById("rf-undo");
      const rfStatus = document.getElementById("rf-status");

      function submitRefine() {
        const instruction = (rfInput.value || "").trim();
        if (!instruction) { return; }
        vscode.postMessage({ command: "refine", data: { instruction } });
      }
      rfGo.addEventListener("click", submitRefine);
      rfInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { submitRefine(); }
      });
      rfUndo.addEventListener("click", function () {
        vscode.postMessage({ command: "refineUndo" });
      });
```

In the existing `window.addEventListener("message", …)` handler, add branches (after the `uiState` branch, around line 535):

```js
        else if (m.command === "refineState") {
          const busy = !!(m.data && m.data.busy);
          rfGo.disabled = busy;
          rfInput.disabled = busy;
          rfUndo.disabled = !(m.data && m.data.steps > 1);
          rfStatus.className = "hint";
          rfStatus.textContent = busy ? "Refining…" : "";
          if (!busy) { rfInput.value = ""; }
        }
        else if (m.command === "refineError") {
          rfGo.disabled = false; rfInput.disabled = false;
          rfStatus.className = "err";
          rfStatus.textContent = (m.data && m.data.message) || "Refine failed.";
        }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 5: Manual verification (F5)**

Launch the Extension Development Host (F5). Generate a diagram (right-click → FlowCraft), then in the viewer type "make it left to right" and click Refine. Expected: diagram re-renders; "↶ Back" enables; clicking Back restores the prior version.

- [ ] **Step 6: Commit**

```bash
git add src/services/render-service.ts
git commit -m "feat: conversational refine bar + step-back in the viewer"
```

---

## Phase 2 — Right-click "Visualize this"

### Task 7: `pickDiagramType` heuristic (pure)

**Files:**
- Create: `src/utils/diagram-heuristics.ts`
- Test: `src/test/diagram-heuristics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/diagram-heuristics.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `../utils/diagram-heuristics`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/diagram-heuristics.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/diagram-heuristics.ts src/test/diagram-heuristics.test.ts
git commit -m "feat: add pickDiagramType heuristic"
```

### Task 8: Folder context summarizer (pure)

**Files:**
- Create: `src/utils/visualize-context.ts`
- Test: `src/test/visualize-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/visualize-context.test.ts
import * as assert from "assert";
import { summarizeFolder, MAX_CONTEXT_CHARS } from "../utils/visualize-context";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `../utils/visualize-context`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/visualize-context.ts

/** Generation input cap shared across the extension (CLAUDE.md "Size limits"). */
export const MAX_CONTEXT_CHARS = 10000;

export interface FolderFile {
  relPath: string;
  text: string;
}

/** Lines that signal structure for an architecture diagram. */
function structuralLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) =>
      /^(import\b|export\b|from\b|class\b|interface\b|def\b|function\b)/.test(l)
    );
}

/**
 * Single file / selection just uses raw code (capped). Folders are summarized
 * into a file tree + per-file structural lines (imports/exports/declarations),
 * because raw concatenation blows the 10k cap immediately.
 */
export function buildFileContext(text: string): string {
  return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) : text;
}

export function summarizeFolder(rootName: string, files: FolderFile[]): string {
  const header = `Project folder "${rootName}" structure:\n`;
  const parts: string[] = [header];
  let truncated = false;

  for (const f of files) {
    const block = [`\n## ${f.relPath}`, ...structuralLines(f.text)].join("\n");
    if (parts.join("\n").length + block.length > MAX_CONTEXT_CHARS - 40) {
      truncated = true;
      break;
    }
    parts.push(block);
  }

  if (truncated) {
    parts.push("\n(…truncated: folder too large to include in full.)");
  }
  return parts.join("\n").slice(0, MAX_CONTEXT_CHARS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/visualize-context.ts src/test/visualize-context.test.ts
git commit -m "feat: add visualize-this context builder"
```

### Task 9: `flowcraft.visualizeThis` command + menus + type override

**Files:**
- Modify: `src/extension.ts` (new command, registration, subscriptions)
- Modify: `package.json` (command + menus)
- Modify: `src/services/render-service.ts` (type-override toolbar control + message)

- [ ] **Step 1: Add the command in extension.ts**

Near the other generate command registrations (around line 1264), add:

```ts
  let visualizeThisCommand = vscode.commands.registerCommand(
    "flowcraft.visualizeThis",
    async (uri?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      let surface: string;
      let code: string;
      let isFolder = false;
      let title = "Visualize";
      let languageId = "";

      if (uri) {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          isFolder = true;
          surface = "folder";
          const found = await vscode.workspace.findFiles(
            new vscode.RelativePattern(uri, "**/*.{ts,tsx,js,jsx,py,java,go,rb,cs}"),
            "**/node_modules/**",
            40
          );
          const files = [] as { relPath: string; text: string }[];
          for (const file of found) {
            const bytes = await vscode.workspace.fs.readFile(file);
            files.push({
              relPath: vscode.workspace.asRelativePath(file),
              text: Buffer.from(bytes).toString("utf8"),
            });
          }
          code = summarizeFolder(uri.path.split("/").pop() || "folder", files);
          title = (uri.path.split("/").pop() || "folder").replace(/\s/g, "_");
        } else {
          surface = "file";
          const doc = await vscode.workspace.openTextDocument(uri);
          languageId = doc.languageId;
          code = buildFileContext(doc.getText());
          title = (uri.path.split("/").pop() || "file").replace(/\s/g, "_");
        }
      } else if (editor) {
        const sel = editor.document.getText(editor.selection);
        const hasSel = sel.trim().length > 0;
        surface = hasSel ? "selection" : "file";
        languageId = editor.document.languageId;
        code = buildFileContext(hasSel ? sel : editor.document.getText());
        title = ((editor.document.fileName.split("/").pop()) || "file").replace(/\s/g, "_");
      } else {
        vscode.window.showErrorMessage("FlowCraft: open a file or pick one in the explorer to visualize.");
        return;
      }

      if (!code.trim()) {
        vscode.window.showErrorMessage("FlowCraft: nothing to visualize (the selection/file is empty).");
        return;
      }

      const diagramType = pickDiagramType(code, languageId, isFolder);
      telemetry.track("visualize_requested", { surface, diagram_type: diagramType });

      await runMermaidGeneration({
        body: { title, description: code, type: toApiType(diagramType) },
        diagramType,
        description: code,
        errorMessage: "FlowCraft couldn't visualize this. Try a smaller file or selection.",
      });
    }
  );
  context.subscriptions.push(visualizeThisCommand);
```

Add imports at the top of `extension.ts`:

```ts
import { pickDiagramType } from "./utils/diagram-heuristics";
import { buildFileContext, summarizeFolder } from "./utils/visualize-context";
import { toApiType } from "./services/diagram-type-map";
```

- [ ] **Step 2: Add command + menus to package.json**

In `contributes.commands` add:

```json
{ "command": "flowcraft.visualizeThis", "title": "FlowCraft: Visualize this", "icon": "$(sparkle)" }
```

Replace the `editor/context` and `explorer/context` arrays with:

```json
"editor/context": [
  { "command": "flowcraft.visualizeThis", "group": "flowcraft@1" }
],
"explorer/context": [
  { "command": "flowcraft.visualizeThis", "group": "flowcraft@1" }
]
```

- [ ] **Step 3: Add a type-override control to the viewer toolbar**

In `render-service.ts` `getHtml`, in the `.toolbar` markup after the "Copy code"/"Export…" buttons (around line 398), add:

```html
    <select id="tb-type" title="Re-generate as a different diagram type">
      <option value="">Type…</option>
      <option value="flowchart">Flowchart</option>
      <option value="classDiagram">Class</option>
      <option value="sequenceDiagram">Sequence</option>
      <option value="stateDiagram">State</option>
      <option value="erDiagram">ER</option>
    </select>
```

In the webview script add a listener (near the other toolbar listeners, around line 541):

```js
      document.getElementById("tb-type").addEventListener("change", function (e) {
        const type = e.target.value;
        if (type) { vscode.postMessage({ command: "toolbar", data: { action: "changeType", type } }); }
        e.target.value = "";
      });
```

In `render-service.ts` `handleMessage`, the `toolbar` case already routes to `handleToolbar(data.action)`; change it to pass the type too:

```ts
      case "toolbar": {
        void this.handleToolbar(data.action, data.type);
        break;
      }
```

Update `handleToolbar` signature to `private async handleToolbar(action: string, type?: string)` and add a case:

```ts
      case "changeType": {
        if (type && this.onChangeType && this.current) {
          await this.onChangeType(this.current, type);
        }
        break;
      }
```

Add the callback field near `onRefine`:

```ts
  /** Wired by extension.ts to re-generate the current diagram as another type. */
  public onChangeType:
    | ((diagram: Diagram, apiType: string) => void | Promise<void>)
    | undefined;
```

- [ ] **Step 4: Wire `onChangeType` in extension.ts**

After the `renderService.onRefine = …` block, add:

```ts
  renderService.onChangeType = async (diagram, apiType) => {
    telemetry.track("visualize_requested", { surface: "type_override", diagram_type: apiType });
    await runMermaidGeneration({
      body: { title: diagram.title, description: diagram.description, type: apiType },
      diagramType: diagram.type,
      description: diagram.description,
      errorMessage: "FlowCraft couldn't re-generate as that type.",
    });
  };
```

> Note: `runMermaidGeneration` is defined as a `const` arrow earlier in `activate`; ensure the `onChangeType`/`onRefine` assignments appear AFTER its declaration (they do — both are after line 479). If TS complains about use-before-declaration, move the `renderService.onChangeType`/`onRefine` assignments to just below the `runMermaidGeneration` definition.

- [ ] **Step 5: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 6: Manual verification (F5)**

F5. Right-click a code file in the editor → "FlowCraft: Visualize this" (no typing) → diagram appears. Right-click a folder in the Explorer → architecture graph appears. In the viewer, pick "Class" from the Type dropdown → re-generates.

- [ ] **Step 7: Commit**

```bash
git add src/extension.ts package.json src/services/render-service.ts
git commit -m "feat: right-click Visualize this with auto-context + type override"
```

---

## Phase 3 — Mermaid-in-Markdown live authoring

### Task 10: `findMermaidBlocks` (pure)

**Files:**
- Create: `src/utils/mermaid-blocks.ts`
- Test: `src/test/mermaid-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/mermaid-blocks.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot find module `../utils/mermaid-blocks`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/mermaid-blocks.ts

export interface MermaidBlock {
  /** 0-based line of the opening ```mermaid fence. */
  fenceStartLine: number;
  /** 0-based line of the closing ``` fence. */
  fenceEndLine: number;
  /** The Mermaid source between the fences (no trailing newline). */
  code: string;
}

/** Parse fenced ```mermaid blocks out of Markdown text. Pure + line-based. */
export function findMermaidBlocks(text: string): MermaidBlock[] {
  const lines = text.split("\n");
  const blocks: MermaidBlock[] = [];
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (start === -1) {
      if (/^```mermaid\b/.test(trimmed)) {
        start = i;
      }
    } else if (trimmed === "```") {
      blocks.push({
        fenceStartLine: start,
        fenceEndLine: i,
        code: lines.slice(start + 1, i).join("\n"),
      });
      start = -1;
    }
  }
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/mermaid-blocks.ts src/test/mermaid-blocks.test.ts
git commit -m "feat: add findMermaidBlocks markdown parser"
```

### Task 11: CodeLens provider (Preview / Refine)

**Files:**
- Create: `src/providers/mermaid-codelens.ts`
- Modify: `src/extension.ts` (register provider + two commands)

- [ ] **Step 1: Write the provider**

```ts
// src/providers/mermaid-codelens.ts
import * as vscode from "vscode";
import { findMermaidBlocks } from "../utils/mermaid-blocks";

/**
 * Shows "Preview" / "Refine" CodeLenses above each ```mermaid block in Markdown.
 * The lenses dispatch to commands registered in extension.ts, passing the
 * document URI + the block's fence line range.
 */
export class MermaidCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    for (const block of findMermaidBlocks(document.getText())) {
      const range = new vscode.Range(block.fenceStartLine, 0, block.fenceStartLine, 0);
      const args = [document.uri, block.fenceStartLine, block.fenceEndLine];
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(eye) Preview",
          command: "flowcraft.previewMermaidBlock",
          arguments: args,
        }),
        new vscode.CodeLens(range, {
          title: "$(sparkle) Refine",
          command: "flowcraft.refineMermaidBlock",
          arguments: args,
        })
      );
    }
    return lenses;
  }
}
```

- [ ] **Step 2: Register provider + commands in extension.ts**

Near the other command registrations, add the provider registration and two commands. Insert:

```ts
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "markdown" },
      new MermaidCodeLensProvider()
    )
  );

  function readBlockCode(doc: vscode.TextDocument, startLine: number, endLine: number): string {
    const lines: string[] = [];
    for (let i = startLine + 1; i < endLine; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return lines.join("\n");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flowcraft.previewMermaidBlock",
      async (uri: vscode.Uri, startLine: number, endLine: number) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const code = readBlockCode(doc, startLine, endLine);
        const now = new Date();
        renderService.view({
          id: `md_${startLine}`,
          title: "Markdown diagram",
          description: "Mermaid block",
          type: DiagramType.Flowchart,
          category: DiagramCategory.Mermaid,
          content: code,
          isPublic: false,
          createdAt: now,
          updatedAt: now,
          tokensUsed: 0,
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flowcraft.refineMermaidBlock",
      async (uri: vscode.Uri, startLine: number, endLine: number) => {
        const instruction = await vscode.window.showInputBox({
          title: "FlowCraft · refine this diagram",
          placeHolder: "e.g. make it left-to-right, add the error path…",
          ignoreFocusOut: true,
        });
        if (!instruction) { return; }
        const doc = await vscode.workspace.openTextDocument(uri);
        const code = readBlockCode(doc, startLine, endLine);
        telemetry.track("refine_requested", { surface: "markdown" });
        try {
          const result = await refineService.refine({
            currentCode: code,
            instruction,
            diagramType: DiagramType.Flowchart,
          });
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            uri,
            new vscode.Range(startLine + 1, 0, endLine, 0),
            result.code + "\n"
          );
          await vscode.workspace.applyEdit(edit);
          telemetry.track("refine_succeeded", { surface: "markdown" });
        } catch (err) {
          telemetry.track("refine_failed", {
            surface: "markdown",
            error_kind: classifyErrorKind((err as Error).message),
          });
          vscode.window.showErrorMessage(`FlowCraft: ${(err as Error).message}`);
        }
      }
    )
  );
```

Add import at top of `extension.ts`:

```ts
import { MermaidCodeLensProvider } from "./providers/mermaid-codelens";
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 4: Manual verification (F5)**

F5. Open a `.md` file containing a ` ```mermaid ` block. Expect "Preview" + "Refine" lenses above it. Click Preview → renders in the viewer. Click Refine → type an instruction → the block text updates in place.

- [ ] **Step 5: Commit**

```bash
git add src/providers/mermaid-codelens.ts src/extension.ts
git commit -m "feat: Mermaid CodeLens with Preview + in-place Refine"
```

### Task 12: "Insert diagram here" command

**Files:**
- Modify: `src/extension.ts` (command + registration)
- Modify: `package.json` (command + editor/context entry for markdown)

- [ ] **Step 1: Add the command in extension.ts**

```ts
  context.subscriptions.push(
    vscode.commands.registerCommand("flowcraft.insertMermaidBlock", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("FlowCraft: open a Markdown file to insert a diagram.");
        return;
      }
      const prompt = await vscode.window.showInputBox({
        title: "FlowCraft · insert diagram",
        placeHolder: "Describe the diagram to insert, e.g. 'auth login sequence'…",
        ignoreFocusOut: true,
        validateInput: (v) =>
          !v || !v.trim() ? "Please describe the diagram" :
          v.length > 10000 ? "Description is too long (max 10,000 characters)" : null,
      });
      if (!prompt) { return; }

      telemetry.track("markdown_insert_requested", { surface: "markdown" });
      const auth = await resolveAuth(authResolver, stateManager);
      if (!auth) { return; }
      const apiUrl = process.env.FLOWCRAFT_API_URL || FLOWCRAFT_API_URL;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "flowcraft › generating", cancellable: false },
        async () => {
          try {
            const response = await fetch(`${apiUrl}/v2/diagrams/generate`, {
              method: "POST",
              headers: buildGenerateHeaders(auth),
              body: JSON.stringify({ title: "Inserted diagram", description: prompt, type: "flowchart" }),
            });
            const data: any = await response.json();
            const code = data?.response?.mermaid_code;
            if (!code) {
              vscode.window.showErrorMessage("FlowCraft didn't return a diagram. Try again.");
              return;
            }
            const snippet = "```mermaid\n" + code + "\n```\n";
            await editor.edit((b) => b.insert(editor.selection.active, snippet));
          } catch (err) {
            vscode.window.showErrorMessage(`FlowCraft: ${(err as Error).message}`);
          }
        }
      );
    })
  );
```

- [ ] **Step 2: Add command + menu to package.json**

In `contributes.commands` add:

```json
{ "command": "flowcraft.insertMermaidBlock", "title": "FlowCraft: Insert diagram here", "icon": "$(add)" }
```

Add a markdown-scoped entry to `editor/context`:

```json
{ "command": "flowcraft.insertMermaidBlock", "when": "editorLangId == markdown", "group": "flowcraft@2" }
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 4: Manual verification (F5)**

F5. In a Markdown file, right-click → "FlowCraft: Insert diagram here" → type a prompt → a ` ```mermaid ` block is inserted at the cursor and CodeLenses appear above it.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat: Insert diagram here command for Markdown"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm run test`
Expected: all suites pass (`buildRefinePrompt`, `toApiType`, `pickDiagramType`, `summarizeFolder`, `findMermaidBlocks`, plus the sample test).

- [ ] **Lint + compile clean**

Run: `npm run lint && npm run compile`
Expected: no errors.

- [ ] **Update CHANGELOG** with the three features under a new version heading, matching the existing CHANGELOG style.

- [ ] **Commit** any remaining changes.

---

## Spec coverage check

- 💬 Refine input under the rendered diagram — Task 6. NL edits diffing current source — Tasks 1/3/5. Refine history + step-back — Tasks 5/6. ✅
- 🪄 Context-menu on file/folder/selection — Task 9. Auto-built prompt (no typing) — Tasks 8/9. Heuristic type + one-click override — Tasks 7/9. ✅
- 📝 Detect ```mermaid blocks + CodeLens — Tasks 10/11. Insert-diagram command — Task 12. Refine reuses shared plumbing — Task 11 (uses `RefineService`). ⚠️ Live-preview-on-edit is intentionally deferred: the spec marks it opt-in/debounced; Preview-on-click ships here, auto-update-on-edit is a fast follow if desired.
