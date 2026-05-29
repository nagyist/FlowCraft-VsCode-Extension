# Change Log

All notable changes to the "flowcraft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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