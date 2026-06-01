# First-Run Onboarding Walkthrough — Design

**Date:** 2026-05-30
**Milestone:** M5 Growth (first of three sub-features; the others — marketplace
listing optimization and telemetry-driven upgrade nudges — are separate specs.)
**Repo:** `FlowCraft-VsCode-Extension`

## Context

FlowCraft is a BYOK VS Code extension: every generation uses the user's own
provider API key. Today there is **no first-run onboarding** — a freshly
installed extension has no `hasSeenWelcome`/first-run flag, and the Welcome
sidebar view offers sign-in but **no guided, validated API-key setup**. A new
user must discover Settings, figure out BYOK, and add a key before anything
works. The extension gets ~2 organic installs/day, so reducing install →
first-successful-generation friction directly serves the milestone goal.

This spec covers a **native VS Code Walkthrough** (`contributes.walkthroughs`)
that guides a new user from install → validated BYOK key → first diagram.

## Goals

- On first run, surface a guided "Get Started with FlowCraft" walkthrough in
  VS Code's Get Started gallery.
- Let the user add their provider API key with **live validation** from inside
  the walkthrough (pick provider → paste key → stored).
- Track step completion natively (checkmarks) using VS Code completion events.
- Never interrupt a returning user who already has a key configured.
- Require **no new image assets** (markdown-based step media).

## Non-Goals

- Marketplace listing optimization (separate M5 spec; needs a banner image).
- Upgrade nudges (separate M5 spec).
- Changing the existing Welcome sidebar webview beyond what's needed to launch
  the walkthrough.
- Any change to the generation path (stays free + BYOK).

## Design

### 1. Walkthrough structure (`package.json` → `contributes.walkthroughs`)

One walkthrough, id `flowcraftGettingStarted`, title "Get Started with
FlowCraft". Steps:

1. **Add your API key (BYOK).** Explains bring-your-own-key + privacy (nothing
   routes through FlowCraft servers). Primary button runs `flowcraft.setupApiKey`.
   - `completionEvents`: `onContext:flowcraft.hasApiKey`
2. **Generate your first diagram.** Button runs `flowcraft.openGenerationView`.
   - `completionEvents`: `onCommand:flowcraft.openGenerationView`
3. **Go further** (optional). Buttons/links: create an infographic
   (`flowcraft.openGenerationView` with the `infographic` arg), Sign in for
   Premium (`flowcraft.signIn`), open Settings (`flowcraft.openSettings`).
   - `completionEvents`: `onCommand:flowcraft.openSettings`

Each step's `media` is a **markdown file** under `media/walkthrough/` (e.g.
`step-key.md`, `step-generate.md`, `step-more.md`). Markdown media avoids
screenshot assets; the existing logo (`FlowCraftLogo_New.png`) may be embedded.

> The fully-qualified walkthrough id used by commands is
> `FlowCraft.flowcraft#flowcraftGettingStarted` (`<publisher>.<name>#<id>`).

### 2. New command: `flowcraft.setupApiKey`

Title: "FlowCraft: Set Up API Key". Behavior:

1. `showQuickPick` of providers (OpenAI, Anthropic, Google, FlowCraft).
2. Persist the choice as the default provider
   (`stateManager.setSetting("defaultProvider", provider)`).
3. Reuse the existing **`promptForProviderApiKey(apiKeyService, provider)`**
   (already does per-provider prefix/length `validateInput` + `store`).
4. On a stored key, set context `flowcraft.hasApiKey = true` (step-1 completion)
   and show a confirmation toast offering "Generate a diagram".

Registered in `activate()` alongside the other commands; added to
`contributes.commands`.

### 3. Completion-context plumbing: `flowcraft.hasApiKey`

A VS Code context key drives step-1's checkmark.

- Add a helper `refreshHasApiKeyContext(apiKeyService, stateManager)` that checks
  whether a key exists for the default provider (via the existing
  `getProviderApiKey`) and calls
  `vscode.commands.executeCommand("setContext", "flowcraft.hasApiKey", boolean)`.
- Call it: once on activation, after `flowcraft.setupApiKey` succeeds, and after
  `flowcraft.resetApiKey` (so the checkmark clears if keys are reset).

### 4. First-run auto-open + state

- One-off flag in `context.globalState`: key `flowcraft.onboarding.seen`
  (boolean). Not a user-facing Setting — it's a lifecycle flag.
- In `activate()`, after services are wired:
  - Determine `hasKey` (same check as the context helper).
  - If `!hasKey` **and** `globalState.get("flowcraft.onboarding.seen") !== true`:
    run `vscode.commands.executeCommand("workbench.action.openWalkthrough",
    "FlowCraft.flowcraft#flowcraftGettingStarted", false)`, then
    `globalState.update("flowcraft.onboarding.seen", true)`.
  - A returning user who already has a key is never interrupted.
- Optional convenience: a `flowcraft.openWalkthrough` command (and/or a button in
  the Welcome view) to re-open the walkthrough on demand. Low priority; include
  only if cheap.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `contributes.walkthroughs` (package.json) | Declares the walkthrough + steps + completion events | command ids, media md files |
| `media/walkthrough/*.md` | Step detail copy (static) | logo asset (optional) |
| `flowcraft.setupApiKey` command | Provider pick + validated key store + set context | `promptForProviderApiKey`, `StateManager`, `APIKeyService` |
| `refreshHasApiKeyContext` helper | Sync `flowcraft.hasApiKey` context with stored-key reality | `getProviderApiKey`, `setContext` |
| First-run trigger (in `activate`) | Open walkthrough once on a keyless first run | `globalState`, `openWalkthrough` |

## Error handling / edge cases

- User cancels the provider QuickPick or the key InputBox → no-op, context
  unchanged, walkthrough step stays unchecked.
- Invalid key → existing `validateInput` blocks the InputBox from resolving;
  nothing is stored.
- Reset keys → context flips to false, step-1 checkmark clears.
- Reinstall / synced Settings where a key already exists → auto-open suppressed.
- `openWalkthrough` unavailable (very old VS Code) → wrapped in try/catch; first
  run silently proceeds without the walkthrough (engine is already `^1.85.0`,
  which supports walkthroughs).

## Testing / verification

Walkthroughs are **manual-test only** (no unit-test surface). In a fresh
Extension Dev Host profile (F5):

1. Walkthrough auto-opens on first activation (no key present).
2. Step 1 button → provider QuickPick → paste an **invalid** key → rejected by
   validation (nothing stored, step stays unchecked).
3. Paste a **valid** key → stored → step 1 checks off (`hasApiKey` context).
4. Step 2 button → generation view opens → step 2 checks off.
5. Reload the window → walkthrough does **not** auto-open again (flag set).
6. Run `flowcraft.resetApiKey` → reopen walkthrough → step 1 is unchecked again.

## Rollout

Extension-only; ships in a minor version bump (e.g. v2.8.0) via
`vsce package` / `publish`. No API or web changes.
