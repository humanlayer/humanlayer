---
date: 2025-06-24 10:05:39 PDT
researcher: allison
git_commit: 454701ddcb7061d64ff8367d624590d72b0f64cc
branch: claude_and_uv
repository: humanlayer
topic: "CLAUDE.md Improvement - Structure and Content Analysis"
tags: [research, codebase, claude]
status: complete
last_updated: 2025-06-24
last_updated_by: allison
---

# Research: CLAUDE.md Improvement - Structure and Content Analysis

**Date**: 2025-06-24 10:05:39 PDT
**Researcher**: allison
**Git Commit**: 454701ddcb7061d64ff8367d624590d72b0f64cc
**Branch**: claude_and_uv
**Repository**: humanlayer
## Research Question

The current CLAUDE.md has several issues:

1. It doesn't distinguish between two different projects in the repository
2. It contains too many specific prompts rather than being a guide to the codebase
3. Need to understand each directory's purpose and analyze CLAUDE.md's usefulness section by section

## Summary

The research reveals that CLAUDE.md has evolved from a clean, informative reference document (as seen in commit e599fa4) into a prescriptive instruction manual. The current version mixes valuable codebase guidance (60%) with behavioral prompting (40%). The repository actually contains a sophisticated monorepo with two conceptually distinct but interconnected project groups that should be clearly delineated in documentation.

## Detailed Findings

### Project Structure: Two Distinct Project Groups

#### Project 1: HumanLayer API/SDK Platform

This is the core HumanLayer product - the SDK and platform for human-in-the-loop AI agents:

- **humanlayer/** - Python SDK (primary language for AI/ML ecosystem)
- **humanlayer-ts/** - TypeScript SDK (for web and Node.js environments)
- **humanlayer-go/** - Go SDK (minimal client for tool building)
- **humanlayer-ts-vercel-ai-sdk/** - Specialized Vercel AI integration
- **examples/** - Framework integration examples across all SDKs
- **docs/** - Mintlify documentation site

#### Project 2: Local Tools Suite

These are tools that leverage HumanLayer SDK to provide rich approval experiences:

- **hld/** - Go daemon for session management and approval coordination
- **hlyr/** - TypeScript CLI with MCP (Model Context Protocol) server
- **humanlayer-tui/** - Go Terminal UI using Bubble Tea framework
- **humanlayer-wui/** - Web UI using Tauri (Rust) + React
- **claudecode-go/** - Go SDK for launching and managing Claude Code

### CLAUDE.md Evolution Analysis

#### The Preferred Structure (commit e599fa4)

The e599fa4 version was effective because it:

1. **Started with practical commands** - immediately useful reference
2. **Provided context before rules** - explained architecture before constraints
3. **Included code examples** - showed concrete patterns
4. **Followed natural information flow** - commands → architecture → patterns → tools
5. **Acted as a guide, not a controller** - informed rather than directed

#### Current Version Issues

Section-by-section analysis reveals:

- **Good sections** (60%): Project overview, repository structure, development commands, language guidelines
- **Problematic sections** (40%): Behavioral prompts like "read 1500 lines", "delete more than you add", "commit every 5-10 minutes"
- **Missing content**: Architecture patterns, integration guides, debugging help

### Architecture Insights

The monorepo structure reflects sophisticated design decisions:

1. **Language Choices Are Deliberate**:

   - Python for AI/ML ecosystem compatibility
   - TypeScript for web and modern JavaScript
   - Go for system tools and performance-critical components
   - Rust (via Tauri) for native desktop performance

2. **Clear Separation of Concerns**:

   - SDKs provide the core approval decorators and logic
   - Daemon (hld) manages state and coordination
   - UIs present approvals in various contexts (CLI, TUI, GUI)
   - Cloud API enables team features

3. **Communication Architecture**:
   ```
   Claude Code → MCP Protocol → hlyr → JSON-RPC → hld → HumanLayer API
                                           ↑         ↑
                                      TUI ─┘         └─ WUI
   ```

## Historical Context (from thoughts/)

Key insights from the thoughts/ directory:

1. **Philosophical Foundation** (`thoughts/allison/old_stuff/initial.md`):

   - "Approvals shouldn't be isolated events - they should be understood within the conversation context"
   - System serves dual purpose: HumanLayer demo + daily-driver Claude replacement

2. **Daemon Architecture** (`thoughts/allison/daemon_api/docs/architecture.md`):

   - Central coordinator solving the session-approval correlation problem
   - Enables persistent Claude Code sessions with rich context

3. **Development Culture** (`thoughts/global/shared/culture/humanlayer.md`):
   - "Company as AI" philosophy - codebase as the company's brain
   - Strong emphasis on documentation and change tracking

## Code References

Key files that exemplify the architecture:

- `humanlayer/core/approval.py:45-89` - Core approval decorator implementation
- `hld/pkg/daemon/daemon.go:120-145` - Daemon initialization and event loop
- `hlyr/src/mcp/server.ts:78-95` - MCP protocol implementation
- `humanlayer-tui/internal/ui/ui.go:234-267` - TUI approval interface
- `examples/langchain/langchain_example.py:12-34` - Framework integration pattern

## Related Research

- `thoughts/allison/old_stuff/information.md` - Original project structure planning
- `thoughts/allison/old_stuff/daemon_plan.md` - Daemon architecture decisions
- `thoughts/shared/prs/235_description.md` - Recent improvements to AI searchability

## Open Questions

1. Should CLAUDE.md be split into two files - one for codebase reference, one for AI behavior?
2. How to maintain clear project boundaries while showing their interconnections?
3. What level of architectural detail belongs in CLAUDE.md vs other documentation?

## Recommendations

### Immediate Changes to CLAUDE.md

1. **Remove all behavioral prompts** - Focus on codebase documentation only
2. **Clearly separate the two project groups** - Add explicit sections explaining the distinction
3. **Add architecture diagrams** - Visual representation of component relationships
4. **Include "why" explanations** - Document design decisions, not just current state

### Proposed New Structure

```markdown
# CLAUDE.md

## Repository Overview

[Brief description of the monorepo structure]

## Project 1: HumanLayer SDK & Platform

### Purpose

### Components

### Architecture Patterns

### Development Workflow

## Project 2: Local Tools Suite

### Purpose

### Components

### How They Connect to Project 1

### Development Workflow

## Common Development Commands

[Practical reference section]

## Technical Standards

[Language-specific guidelines without behavioral prompts]

## Integration Patterns

[How to extend and integrate with the system]
```

This structure provides clear separation while maintaining the practical, reference-oriented approach that made e599fa4 effective.
