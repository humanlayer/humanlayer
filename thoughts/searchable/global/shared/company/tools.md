---
summary: Catalog of all tools, scripts, and resources for company operations
last_updated: 2025-07-02
last_updated_by: dex
last_update: added org, dev, and lists
---

# HumanLayer Tools & Resources

_This file catalogs all tools, scripts, and resources available for company operations, including development tools, communication platforms, and data sources._

## Organization

- all tools live in the repo root under tools/
- python tools should get their own folder and use uv, e.g. tools/gmail/
- typescript tools can all live in the tools/ts/ folder and share a single package.json
- all tools must be documented here in this file
- all tools must include a README.md with basic usage instructions

## Tool development 

- Always prefer typescript / bun over python/uv - only use python if explicitly instructed
- All CLI tools should write high-level audit logs to journal-tools.yaml, properly resolving the path to that file and failing if not found
- All CLI tools must require a --summary cli arg for ai agents to provide useful audit log entries
- All Typescript tools must include a Makefile with `make check` that runs `bunx @biomejs/biome --fix --unsafe` and `bunx vitest`
- All python tools must include a Makefile with `make check` that runs `uvx mypy .`, `uvx ruff check . --fix`, and `uvx pytest`



## Tools

- tools/gmail/README.md - gmail cli tool

