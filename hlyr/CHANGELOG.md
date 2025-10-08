# Changelog

All notable changes to the HumanLayer CLI (hlyr) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2025-10-07

### Added

- New `humanlayer claude init` command to copy HumanLayer .claude config files to projects
- Interactive wizard-style UX with @clack/prompts for file selection
- Multi-select interface for choosing commands, agents, and settings
- Arrow key navigation (↑↓ to move, space to toggle, enter to confirm)
- `--all` flag to copy all files non-interactively
- `--force` flag to overwrite existing .claude directory
- Automatic .gitignore entry for settings.local.json
- End-to-end tests for both interactive and non-interactive modes

### Changed

- Improved UX from number-based selection to visual multiselect prompts

## [0.11.0] - 2025-01-23

### Added

- Write tool success pattern detection for better feedback
- Improved session table and conversation view UX
- Enhanced session title inheritance when continuing sessions

### Changed

- Removed visual noise from session launcher (ENG-1714)
- Updated web research instructions for more explicit guidance
- Improved bash allowlist configuration

### Fixed

- Edit tool false 'failed' display in WUI
- Session titles clearing when sending new user messages (ENG-1727)

## [0.10.0] - Previous release
