# Change Log

All notable changes to the "flowcraft" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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