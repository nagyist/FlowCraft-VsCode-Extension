# First-Run Onboarding Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native VS Code "Get Started with FlowCraft" walkthrough that, on first run, guides a new user to add a validated BYOK API key and generate their first diagram.

**Architecture:** Declare a walkthrough in `package.json` (`contributes.walkthroughs`) with three markdown-media steps. Add a `flowcraft.setupApiKey` command (provider QuickPick → save default → reuse the existing validated key prompt). Drive step-1 completion with a `flowcraft.hasApiKey` context key kept in sync by a `refreshHasApiKeyContext` helper. Auto-open the walkthrough once on a keyless first run, gated by a `globalState` flag.

**Tech Stack:** TypeScript, VS Code Extension API (`contributes.walkthroughs`, `setContext`, `workbench.action.openWalkthrough`), `tsc`.

**Branch:** `feat/onboarding-walkthrough`. **Spec:** `docs/superpowers/specs/2026-05-30-first-run-onboarding-walkthrough-design.md`.

**Note on testing:** Walkthroughs have no unit-test surface, so this plan uses **build + manual F5** verification per task instead of TDD. Build command for every task: `npm run compile` (alias `tsc -p ./`). The webview copy script is **not** needed (walkthrough media lives directly under `media/`, which is already packaged).

---

## File Structure

| File | Responsibility | Create/Modify |
| --- | --- | --- |
| `media/walkthrough/step-key.md` | Step 1 detail copy (BYOK key) | Create |
| `media/walkthrough/step-generate.md` | Step 2 detail copy (generate) | Create |
| `media/walkthrough/step-more.md` | Step 3 detail copy (go further) | Create |
| `package.json` | `contributes.walkthroughs` + `flowcraft.setupApiKey` command entry | Modify |
| `src/extension.ts` | `refreshHasApiKeyContext` helper, `flowcraft.setupApiKey` command, reset-key context refresh, first-run auto-open | Modify |

---

## Task 1: Walkthrough step media (markdown)

**Files:**
- Create: `media/walkthrough/step-key.md`
- Create: `media/walkthrough/step-generate.md`
- Create: `media/walkthrough/step-more.md`

- [ ] **Step 1: Create `media/walkthrough/step-key.md`**

```markdown
## Bring your own API key

FlowCraft is **BYOK** — it generates diagrams using *your* AI provider key
(OpenAI, Anthropic, Google, or a FlowCraft token). Your key is stored in VS
Code's secret storage and your prompts never route through FlowCraft's servers.

Click **Set Up API Key**, pick your provider, and paste your key. FlowCraft
validates the format before saving.

- OpenAI keys start with `sk-`
- Anthropic keys start with `sk-ant-`
- Google (Gemini) keys start with `AIza`
- FlowCraft tokens start with `fc_`
```

- [ ] **Step 2: Create `media/walkthrough/step-generate.md`**

```markdown
## Generate your first diagram

Open the generation view, choose a diagram type, and describe what you want in
plain language — FlowCraft turns it into a Mermaid diagram you can preview,
theme, and export right inside VS Code.

You can also right-click a file or selection in the editor and choose a
**FlowCraft: Generate…** action.
```

- [ ] **Step 3: Create `media/walkthrough/step-more.md`**

```markdown
## Go further

- **Infographics & illustrations** — generate richer visuals from the generation view.
- **Premium** — sign in to unlock cloud history sync, premium templates, and advanced exports.
- **Settings** — set a default provider, pick per-provider models, and manage keys.
```

- [ ] **Step 4: Commit**

```bash
git add media/walkthrough/
git commit -m "Add walkthrough step media (markdown)"
```

---

## Task 2: Declare the walkthrough + command in package.json

**Files:**
- Modify: `package.json` (`contributes.commands` array; new `contributes.walkthroughs`)

- [ ] **Step 1: Add the `flowcraft.setupApiKey` command entry**

In `package.json`, inside `contributes.commands`, add this object immediately after the `flowcraft.resetApiKey` entry (the one titled "FlowCraft: Reset API Keys"):

```json
{
  "command": "flowcraft.setupApiKey",
  "title": "FlowCraft: Set Up API Key",
  "icon": "$(key)"
},
```

- [ ] **Step 2: Add the `walkthroughs` contribution**

In `package.json`, inside `contributes`, add a new `walkthroughs` key (sibling of `commands`, `menus`, `configuration`):

```json
"walkthroughs": [
  {
    "id": "flowcraftGettingStarted",
    "title": "Get Started with FlowCraft",
    "description": "Add your AI provider key (BYOK) and generate your first diagram.",
    "steps": [
      {
        "id": "addApiKey",
        "title": "Add your API key (BYOK)",
        "description": "FlowCraft uses your own AI provider key — nothing routes through FlowCraft's servers.\n[Set Up API Key](command:flowcraft.setupApiKey)",
        "media": { "markdown": "media/walkthrough/step-key.md" },
        "completionEvents": ["onContext:flowcraft.hasApiKey"]
      },
      {
        "id": "generate",
        "title": "Generate your first diagram",
        "description": "Open the generation view and describe what you want.\n[Generate a Diagram](command:flowcraft.openGenerationView)",
        "media": { "markdown": "media/walkthrough/step-generate.md" },
        "completionEvents": ["onCommand:flowcraft.openGenerationView"]
      },
      {
        "id": "more",
        "title": "Go further",
        "description": "Create infographics, sign in for Premium, or tweak settings.\n[Open Settings](command:flowcraft.openSettings)\n[Sign in for Premium](command:flowcraft.signIn)",
        "media": { "markdown": "media/walkthrough/step-more.md" },
        "completionEvents": ["onCommand:flowcraft.openSettings"]
      }
    ]
  }
]
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "require('./package.json') && console.log('package.json valid')"`
Expected: `package.json valid`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "Declare Get Started walkthrough + setupApiKey command"
```

---

## Task 3: `refreshHasApiKeyContext` helper + `flowcraft.setupApiKey` command

**Files:**
- Modify: `src/extension.ts` (add module-level helper near `getProviderApiKey`; register command in `activate`; push to subscriptions; refresh context after `resetApiKey`)

- [ ] **Step 1: Add the `refreshHasApiKeyContext` helper**

In `src/extension.ts`, immediately after the existing `getProviderApiKey` function (around line 60-65), add:

```typescript
/**
 * Sync the `flowcraft.hasApiKey` context key with whether a key is stored for
 * the default provider. Drives the walkthrough's "Add your API key" checkmark.
 * Returns whether a key is present.
 */
async function refreshHasApiKeyContext(
  apiKeyService: APIKeyService,
  stateManager: StateManager
): Promise<boolean> {
  const provider = stateManager.getSetting("defaultProvider");
  const hasKey = !!(await getProviderApiKey(apiKeyService, provider));
  await vscode.commands.executeCommand("setContext", "flowcraft.hasApiKey", hasKey);
  return hasKey;
}
```

- [ ] **Step 2: Register the `flowcraft.setupApiKey` command**

In `activate()`, immediately after the `resetKeyCommand` registration block (it ends around line 487, just before `let openWelcomeCommand`), add:

```typescript
  let setupApiKeyCommand = vscode.commands.registerCommand(
    "flowcraft.setupApiKey",
    async () => {
      type ProviderItem = vscode.QuickPickItem & { value: Provider };
      const items: ProviderItem[] = [
        { label: "OpenAI", description: "GPT-4 / GPT-3.5 · key starts sk-", value: Provider.OpenAI },
        { label: "Anthropic", description: "Claude · key starts sk-ant-", value: Provider.Anthropic },
        { label: "Google", description: "Gemini · key starts AIza", value: Provider.Google },
        { label: "FlowCraft", description: "FlowCraft token · starts fc_", value: Provider.FlowCraft },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        title: "FlowCraft · set up your AI provider",
        placeHolder: "Choose the provider whose API key you'll use (BYOK)",
      });
      if (!picked) {
        return;
      }
      stateManager.setSetting("defaultProvider", picked.value);
      const key = await promptForProviderApiKey(apiKeyService, picked.value);
      if (!key) {
        return;
      }
      await refreshHasApiKeyContext(apiKeyService, stateManager);
      const choice = await vscode.window.showInformationMessage(
        `FlowCraft: ${picked.value} key saved — you're ready to generate diagrams.`,
        "Generate a diagram"
      );
      if (choice === "Generate a diagram") {
        await vscode.commands.executeCommand("flowcraft.openGenerationView");
      }
    }
  );
```

- [ ] **Step 3: Refresh the context after a key reset**

In the `resetKeyCommand` handler, add a context refresh at the very end of the callback — after both the `"all"` and per-provider branches (i.e. as the last statement before the callback's closing `}`, after the `else { ... }` block that shows the per-provider cleared message):

```typescript
      await refreshHasApiKeyContext(apiKeyService, stateManager);
```

- [ ] **Step 4: Push the new command to subscriptions**

In the `context.subscriptions.push(...)` block near the end of `activate()` (around line 1500), add after `context.subscriptions.push(resetKeyCommand);`:

```typescript
  context.subscriptions.push(setupApiKeyCommand);
```

- [ ] **Step 5: Build**

Run: `npm run compile`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "Add setupApiKey command + hasApiKey context helper"
```

---

## Task 4: First-run auto-open

**Files:**
- Modify: `src/extension.ts` (`activate()` — add first-run logic after services are constructed and `refreshHasApiKeyContext` exists)

- [ ] **Step 1: Add the first-run auto-open block**

In `activate()`, add the following just before the final `context.subscriptions.push(...)` block (around line 1500, right before `context.subscriptions.push(generateClassDiagramDisposable);` or the first push in that trailing block):

```typescript
  // First-run onboarding: open the Get Started walkthrough exactly once, and
  // only when the user has no key yet (don't interrupt returning users).
  const hasKeyOnStartup = await refreshHasApiKeyContext(apiKeyService, stateManager);
  try {
    const onboardingSeen =
      context.globalState.get<boolean>("flowcraft.onboarding.seen") === true;
    if (!onboardingSeen && !hasKeyOnStartup) {
      await vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "FlowCraft.flowcraft#flowcraftGettingStarted",
        false
      );
    }
    await context.globalState.update("flowcraft.onboarding.seen", true);
  } catch (err) {
    console.error("FlowCraft: onboarding walkthrough failed to open:", err);
  }
```

- [ ] **Step 2: Build**

Run: `npm run compile`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "Auto-open Get Started walkthrough on keyless first run"
```

---

## Task 5: Manual verification (F5) + package

**Files:** none (verification only)

- [ ] **Step 1: Launch the Extension Development Host**

Press **F5** in VS Code (or run the "Run Extension" launch config). Use a **fresh** profile / first-run state — if you've run it before, clear the flag via the Command Palette: run "Developer: Reload Window" after wiping global state, or test in a clean VS Code profile.

- [ ] **Step 2: Verify auto-open**

Expected: with no FlowCraft key stored, the "Get Started with FlowCraft" walkthrough opens automatically in the editor area.

- [ ] **Step 3: Verify step 1 (key) with validation**

Click **Set Up API Key** → pick a provider → paste an **invalid** key (e.g. `bad`).
Expected: the input box rejects it (validation message, nothing saved, step stays unchecked).
Then paste a **valid**-format key (e.g. `sk-` + 20+ chars for OpenAI).
Expected: toast "key saved", and **step 1 gets a checkmark** (driven by `flowcraft.hasApiKey`).

- [ ] **Step 4: Verify step 2 (generate)**

Click **Generate a Diagram** (from the toast or step 2).
Expected: the generation view opens and **step 2 gets a checkmark**.

- [ ] **Step 5: Verify no re-open on reload**

Run "Developer: Reload Window".
Expected: the walkthrough does **not** auto-open again (flag set), and because a key now exists it wouldn't open anyway.

- [ ] **Step 6: Verify reset clears the checkmark**

Run "FlowCraft: Reset API Keys" → clear all.
Reopen the walkthrough via Command Palette → "Welcome: Open Walkthrough…" → "Get Started with FlowCraft".
Expected: step 1 is **unchecked** again (`flowcraft.hasApiKey` flipped to false).

- [ ] **Step 7: Package to confirm media ships**

Run: `npx vsce ls | grep walkthrough`
Expected: lists `media/walkthrough/step-key.md`, `step-generate.md`, `step-more.md`.

- [ ] **Step 8: Final commit (changelog + version, optional bundling)**

If shipping standalone, bump `package.json` to the next minor (e.g. `2.8.0`) and add a CHANGELOG entry:

```markdown
## [2.8.0] - 2026-05-30

### Added
- **Get Started walkthrough.** New users now get a guided first-run walkthrough: add your provider API key (BYOK, with format validation) and generate your first diagram, with native step checkmarks.
```

```bash
git add package.json CHANGELOG.md
git commit -m "Onboarding walkthrough: changelog + version bump (v2.8.0)"
```

---

## Self-Review

**Spec coverage:**
- Walkthrough structure (3 steps, markdown media, completion events) → Tasks 1, 2. ✓
- `flowcraft.setupApiKey` (provider pick → default → validated prompt → context) → Task 3. ✓
- `flowcraft.hasApiKey` context refresh on activation / after setup / after reset → Tasks 3, 4. ✓
- First-run auto-open via `flowcraft.onboarding.seen`, suppressed when a key exists → Task 4. ✓
- Asset-light markdown media, no images → Task 1. ✓
- Manual F5 verification → Task 5. ✓
- Optional `flowcraft.openWalkthrough` re-open command → **dropped** per the approved design ("low priority"); step 6 reopens via the built-in "Welcome: Open Walkthrough…" command instead, so no custom command is needed.

**Placeholder scan:** No TBD/TODO; all code blocks complete; the walkthrough id `FlowCraft.flowcraft#flowcraftGettingStarted` matches `<publisher>.<name>#<walkthrough id>` from `package.json` (`publisher: "FlowCraft"`, `name: "flowcraft"`, walkthrough `id: "flowcraftGettingStarted"`).

**Type consistency:** `refreshHasApiKeyContext(apiKeyService, stateManager)` signature is identical in Tasks 3 and 4. `Provider` enum members (`OpenAI`/`Anthropic`/`Google`/`FlowCraft`) match `src/types/settings.ts`. `promptForProviderApiKey(apiKeyService, provider)` and `getProviderApiKey(apiKeyService, provider)` match existing signatures in `src/extension.ts`. `stateManager.setSetting("defaultProvider", …)` / `getSetting("defaultProvider")` match `StateManager`.
