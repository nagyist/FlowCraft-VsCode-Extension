# Change Log

All notable changes to the "flowcraft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.6.0] - 2026-05-30

### Added
- **Premium Templates.** Run **FlowCraft: Insert Premium Template** to browse a curated library of Mermaid diagram templates and drop one into your workspace as a ready-to-edit diagram. Browsing is free; inserting a template requires FlowCraft Premium. Inserted templates open in an editor and (for subscribers) sync to your cloud history automatically.

## [2.5.0] - 2026-05-30

### Added
- **Cloud History Sync (Premium).** When you're signed in to FlowCraft and subscribed, diagrams you generate are automatically mirrored to your account — so they show up on the web dashboard and on your other machines. Run **FlowCraft: Sync Diagrams to Cloud** from the Command Palette to push everything and pull your cloud history on demand. Syncing is idempotent (re-syncing never creates duplicates). Generation itself stays free and BYOK; cloud sync is purely an account-level convenience for subscribers.

## [2.4.0] - 2026-05-29

### Added
- FlowCraft Premium account layer. Sign in to see your plan in **Settings → Account**, with **Upgrade to Premium** / **Manage subscription** links. Premium will unlock cloud history sync, premium templates, and advanced exports (rolling out next).

### Changed
- Diagram generation now **always** uses your own provider API key (BYOK), even when you're signed in to FlowCraft. Signing in only unlocks account-level premium features — it never routes your generations through FlowCraft's servers. This keeps generation free and private.

## [2.3.1] - 2026-05-29

### Fixed
- Chat participant (`@flowcraft` slash commands like `/flowchart`, `/sequence`) no longer ends every generation with a spurious "Something went wrong" error. It was posting the diagram to a placeholder URL after already rendering it; that dead call has been removed.

### Changed
- Slimmed the published package: internal files (`CLAUDE.md`, `.claude/`, `docs/`, `local_mds/`, `MAINTENANCE.md`) are no longer shipped in the `.vsix`.
- Chat-participant diagram generations are now included in anonymous telemetry counts (still no keys/prompts).

## [2.3.0] - 2026-05-29

### Added
- Anonymous, opt-out usage telemetry so we can understand which diagram types and providers are used and improve reliability. It never includes your API keys, prompts, or generated content, and honors VS Code's global telemetry setting. Toggle it under **Settings → Privacy → Share anonymous usage data**.

### Changed
- Infographics and AI Images are now generally available (previously marked "Coming Soon").
- The extension is now fully bring-your-own-key: FlowCraft-issued keys are no longer accepted for generation. Add your own OpenAI, Anthropic, or Google key in Settings.

## [2.2.1] - 2026-05-09

### Fixed
- Context-menu "Use Current File" / "Use Selection" and the legacy flow/class diagram commands were calling the retired v1 `/diagrams/generate` endpoint and returning a 404 ("An error occurred while generating the diagram"). All generation paths now call `/v2/diagrams/generate`.

## [2.1.0] - 2025-11-27

### Fixed
- Resolved an issue where only the OpenAI provider was being taken into account when multiple providers were configured.


## [2.0.3]

### Added
- Initial implementation of core functionality
    - Generate flow diagrams for code blocks and files

### Fixed
- Fixed the links to the extension's Documentation and Support pages