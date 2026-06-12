# Extension Growth Trio — Design

**Date:** 2026-06-11
**Surface:** FlowCraft VS Code extension (`FlowCraft.flowcraft`, v2.8.0)
**Source tickets (AnyType · ClaudeCode space):**
- 💬 Conversational refine loop in the render view
- 🪄 Right-click "Visualize this" — file / folder / selection with auto-context
- 📝 Mermaid-in-Markdown live authoring

These three were selected because they are **extension-only** (no API/web deploy) and
**share refine plumbing**. A new `RefineService` is built first; Features 1 and 3 both
consume it.

---

## Existing architecture this builds on

- **Generation (raw-fetch path):** context-menu commands call `runMermaidGeneration` in
  `src/extension.ts`, which POSTs `{title, description, type}` to
  `{FLOWCRAFT_API_URL}/v2/diagrams/generate`, reads back `response.mermaid_code` and
  `response.inserted_diagram.data[0].id`, then `showGeneratedDiagram(...)` persists the
  diagram (`persistRawFetchDiagram`) and previews it via `renderService.view(diagram)`.
  The `description` field **is** the model prompt (today it carries raw source code).
- **`RenderService`** (`src/services/render-service.ts`) owns one reusable `WebviewPanel`.
  It holds `current: Diagram`, posts `{command:"render", data:{code, theme}}` to the
  webview, and has a toolbar (Copy code / Export / Theme / Open on web). The webview HTML
  (with Mermaid) is inline in that file.
- **Auth:** the raw-fetch path resolves credentials via `resolveAuth(authResolver, …)` +
  `buildGenerateHeaders(auth)`. Header is `X-api-key: <provider key>`. BYOK; the API fans
  out to the right LLM via LiteLLM. The DiagramService path uses `ensureProviderApiKey`.
- **Hard limit:** every generation path caps input at **10,000 characters** and rejects
  empty input. New paths MUST mirror this.
- **Telemetry:** `telemetry.track(event, props)` (M1). Events already used:
  `generation_succeeded`, `generation_failed` (with `classifyErrorKind`).
- **"Visualize this" partially exists:** `flowcraft.generateFromFile` /
  `flowcraft.generateFromSelection` are already wired on `editor/context` +
  `explorer/context` and delegate to the legacy `generateFlowDiagram*` commands.

---

## Shared foundation — `RefineService`

**File:** `src/services/refine-service.ts`

**Responsibility:** given the current Mermaid source + a natural-language instruction,
return updated Mermaid source. One clear job; no webview or VS Code UI knowledge.

```
interface RefineRequest {
  currentCode: string;
  instruction: string;
  diagramType: DiagramType;
}
refine(req: RefineRequest): Promise<{ code: string; diagramId?: string }>
```

**Mechanism (decision):** embed the current code + instruction into the existing
`description` field rather than relying on the API's unproven `source?` field. Prompt
shape:

> Here is the current Mermaid diagram:
> ```\n<currentCode>\n```
> Apply this change: <instruction>.
> Return the complete updated Mermaid diagram only.

This works against the **currently deployed** `/v2/diagrams/generate` with no API change.

**Reuse:** route through the same auth (`resolveAuth`/`buildGenerateHeaders`) and the same
endpoint as `runMermaidGeneration`. Enforce the 10,000-char cap on the assembled
description; if `currentCode + instruction` would exceed it, surface a clear error.

**Prompt-building is a pure function** (`buildRefinePrompt(req): string`) so it is unit
tested without the network.

---

## Feature 1 — 💬 Conversational refine loop (RenderService)

**Goal:** stop forcing users to re-prompt from scratch when a generation is close-but-wrong.

**Webview (in `render-service.ts` HTML):**
- A **refine input bar** under the diagram: text input + "Refine" button.
- A **history strip** showing refinement steps for the active diagram with a **"Step back"**
  (undo) control.

**Messages (webview ↔ extension):**
- webview → ext: `{command:"refine", data:{instruction}}`
- webview → ext: `{command:"refineUndo"}`
- ext → webview: existing `{command:"render", …}` (re-used to paint new code), plus
  `{command:"refineState", data:{history:[…], busy:bool}}` to drive the strip.

**State:** `RenderService` keeps a per-diagram **refine stack** — an array of Mermaid
versions for `current`. "Refine" calls `RefineService.refine`, pushes the new version,
re-renders. "Step back" pops and re-renders. Stack resets when `view(diagram)` loads a
different diagram.

**Telemetry:** `refine_requested`, `refine_succeeded`, `refine_failed{error_kind}`.

**Error handling:** a failed refine leaves the current version intact and shows an inline
error in the bar (does not blow away the diagram). Reuses `classifyErrorKind`.

---

## Feature 2 — 🪄 Right-click "Visualize this" (auto-context + heuristic type)

**Goal:** kill the empty-prompt-box friction — diagram from code with zero typing.

**Command:** `flowcraft.visualizeThis`, contributed on:
- `editor/context` (operates on selection if present, else whole file)
- `explorer/context` (operates on the clicked file **or folder**)

**Auto-context builder** (`src/utils/visualize-context.ts`, pure + tested):
- **Single file / selection:** raw code (today's behavior), capped at 10k.
- **Folder:** a **structural summary** — file tree + per-file imports/exports/top-level
  declarations — rather than raw concatenation (raw concat blows the 10k cap immediately).
  Capped at 10k with a truncation notice when the folder is large.

**Heuristic diagram-type pick** (`pickDiagramType(code, languageId, isFolder)`, pure + tested):
- folder → `graph` / architecture
- code with classes/interfaces (OOP signals) → `classDiagram`
- otherwise (functions/procedural) → `flowchart`

**One-click override:** the viewer toolbar gets a small **diagram-type selector**; choosing
a different type re-generates from the same captured context as that type. (Wires through a
new `{command:"changeType", data:{type}}` webview message handled like a fresh generation.)

**Limits/empties:** mirror the existing empty/too-large guards with friendly messages.

---

## Feature 3 — 📝 Mermaid-in-Markdown live authoring

**Goal:** make FlowCraft the default way devs author diagrams in docs.

**CodeLens provider** (`src/providers/mermaid-codelens.ts`) for language `markdown`:
- Parse ` ```mermaid ` fenced blocks (pure `findMermaidBlocks(text)` → ranges, unit tested).
- Show **"Preview"** and **"Refine"** lenses above each block.

**Actions:**
- **Preview** → build an ephemeral `Diagram` from the block's code and `renderService.view`.
- **Refine** → prompt for an instruction (InputBox), call `RefineService.refine` with the
  block's current code, then apply a **`WorkspaceEdit`** replacing the fence body in place.
- **Insert diagram here** (`flowcraft.insertMermaidBlock`): NL prompt → generate → insert a
  ` ```mermaid ` block at the cursor.

**Live preview (opt-in per block):** while a block's preview panel is open, a **debounced**
`onDidChangeTextDocument` re-renders *that* block only. We do **not** auto-render every
block on open (cost/noise). Debounce ~400ms.

**Shared plumbing:** Refine here is the same `RefineService` as Feature 1.

---

## Structure, sequencing & testing

**One spec, one phased plan:**
- **Phase 0 — `RefineService`** (+ `buildRefinePrompt` tests). Foundation for 1 & 3.
- **Phase 1 — Refine loop** in RenderService.
- **Phase 2 — Visualize-this** (context builder + heuristic + folder entry + type override).
- **Phase 3 — Markdown authoring** (CodeLens + preview/refine/insert + live preview).

**Unit tests (pure, no webview):** `buildRefinePrompt`, `pickDiagramType`,
folder context-summarizer, `findMermaidBlocks`. Run via existing `npm run test`
(`vscode-test`, `src/test/*.test.ts`).

**Manual verification:** F5 Extension Development Host — refine a generated diagram and
step back; visualize a file/folder/selection and override the type; preview/refine/insert
a Mermaid block in a Markdown file.

**Conventions to honor:**
- New API calls route through existing auth (never read an OpenAI key directly).
- 10,000-char cap on every new generation/refine path.
- Webview assets: if any new webview file is added under `src/webview/`, it must be copied
  into `media/webview/` via `scripts/copy-webview-files.js`. (This design extends the
  existing inline RenderService HTML, so no new webview folder is required for Phase 1.)
- TypeScript strict settings (`noUnusedLocals`, `noImplicitReturns`, etc.).

## Non-goals (YAGNI)
- No API/web changes (those live in the Onboarding and Share-to-web tickets).
- No multi-turn chat transcript persistence beyond the in-memory refine stack.
- No cross-file diagram synthesis beyond the folder structural summary.
