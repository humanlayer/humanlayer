# CodeLayer Architecture & Integration Overview

*A comprehensive discussion about CodeLayer's integration with Claude Code and its unique features*

---

## Table of Contents

1. [Understanding CodeLayer vs HumanLayer](#understanding-codelayer-vs-humanlayer)
2. [Integration Architecture](#integration-architecture)
3. [Unique Features Beyond Vanilla Claude Code](#unique-features-beyond-vanilla-claude-code)
4. [Pre-built Workflows and Slash Commands](#pre-built-workflows-and-slash-commands)

---

## Understanding CodeLayer vs HumanLayer

### Question: Where is the CodeLayer codebase?

**Answer:** CodeLayer is actually the product name for the component located in the `humanlayer-wui/` directory. The naming can be confusing:

- **Directory name**: `humanlayer-wui/` (technical/internal name)
- **Product name**: CodeLayer (brand/user-facing name)
- **Full description**: Desktop/Web UI (Tauri + React) for graphical approval management

According to CLAUDE.md:
> `humanlayer-wui/` - CodeLayer - Desktop/Web UI (Tauri + React) for graphical approval management

---

## Integration Architecture

### The Three Integration Surfaces

CodeLayer integrates with Claude Code through three distinct communication layers:

#### 1. Claude Code ↔ hlyr (MCP Protocol via stdio)

**Location**: `hlyr/src/mcp.ts`

When Claude Code is configured to use HumanLayer, it spawns `hlyr` as an MCP (Model Context Protocol) server subprocess:

```bash
# Command passed to Claude Code's MCP config
["humanlayer", "mcp", "claude_approvals"]
```

**What it exposes:**
- A single MCP tool: `request_permission(tool_name, input, tool_use_id)`
- Claude Code calls this before executing dangerous operations
- Returns: `{behavior: 'allow'|'deny', message?, updatedInput?}`

#### 2. hlyr ↔ hld (JSON-RPC over Unix Socket)

**Location**: `hlyr/src/daemonClient.ts` → `hld/rpc/server.go`

The `hlyr` MCP server connects to the `hld` daemon via Unix socket:

```
Socket: ~/.humanlayer/daemon.sock
Protocol: Line-delimited JSON-RPC 2.0
```

**Key RPC methods**:
- `createApproval()` - Create a new approval request
- `getApproval()` - Poll for approval status
- `subscribe()` - Stream real-time events
- `launchSession()` - Start new Claude Code sessions
- `listSessions()` - Get all active sessions
- `sendDecision()` - Approve/deny actions

#### 3. CodeLayer WUI ↔ hld (REST API over HTTP)

**Location**: `humanlayer-wui/src/lib/daemon/http-client.ts` → `hld/daemon/http_server.go`

The web UI communicates via HTTP REST API:

```
URL: http://localhost:7777/api/v1/
Protocol: REST (OpenAPI spec)
Streaming: Server-Sent Events (SSE)
```

**Key endpoints**:
- `POST /api/v1/sessions` - Launch Claude Code session
- `GET /api/v1/approvals` - List pending approvals
- `POST /api/v1/approvals/{id}/decide` - Approve/deny
- `GET /api/v1/stream/events` - Real-time updates

### Complete Flow Example

```
1. User clicks "Launch Session" in CodeLayer WUI
   ↓
2. WUI → POST /api/v1/sessions → hld HTTP server
   ↓
3. hld spawns Claude Code subprocess with MCP config:
   {command: "humanlayer", args: ["mcp", "claude_approvals"]}
   ↓
4. Claude Code spawns hlyr as MCP server
   ↓
5. hlyr connects to hld via Unix socket
   ↓
6. Claude Code wants to execute a tool → calls request_permission()
   ↓
7. hlyr → createApproval() → hld (via JSON-RPC)
   ↓
8. WUI receives approval event (via SSE stream)
   ↓
9. User approves in WUI → POST /api/v1/approvals/{id}/decide
   ↓
10. hld updates approval → event published
    ↓
11. hlyr polls, sees decision → returns 'allow' to Claude Code
    ↓
12. Claude Code executes the tool
```

### Architecture Diagram

```
Claude Code → MCP Protocol → hlyr → JSON-RPC → hld → HumanLayer Cloud API
                                         ↑         ↑
                                    TUI ─┘         └─ WUI (CodeLayer)
```

### API Boundaries Summary

| Component | Protocol | Transport | Purpose |
|-----------|----------|-----------|---------|
| **hlyr ↔ hld** | JSON-RPC 2.0 | Unix socket | Approval requests from Claude Code |
| **hld (internal)** | JSON-RPC 2.0 | Go channels | RPC server ↔ session manager communication |
| **hld (internal)** | Events | Go channels | Event bus for real-time updates |
| **WUI ↔ hld** | REST (OpenAPI) | HTTP | UI dashboard and control |
| **WUI ↔ hld** | SSE | HTTP | Real-time event streaming |
| **Claude Code ↔ hlyr** | MCP | stdio | Approval requests |

### Key Files to Review

**hlyr (MCP Server)**:
- `hlyr/src/mcp.ts` - MCP server implementation
- `hlyr/src/daemonClient.ts` - Socket client (350 lines)

**hld (Daemon)**:
- `hld/daemon/daemon.go` - Daemon initialization
- `hld/daemon/http_server.go` - HTTP/REST setup
- `hld/rpc/server.go` - JSON-RPC server
- `hld/rpc/handlers.go` - RPC method handlers (800+ lines)
- `hld/mcp/server.go` - MCP server implementation
- `hld/session/manager.go` - Session lifecycle

**WUI (Web UI)**:
- `humanlayer-wui/src/lib/daemon/http-client.ts` - HTTP client (770 lines)
- `humanlayer-wui/src/lib/daemon/http-config.ts` - URL resolution
- `humanlayer-wui/docs/ARCHITECTURE.md` - Architecture diagram

**Documentation**:
- `hld/PROTOCOL.md` - Complete JSON-RPC specification
- `hld/README.md` - Daemon overview

---

## Unique Features Beyond Vanilla Claude Code

### What Makes CodeLayer More Effective?

**Vanilla Claude Code** is a single-session CLI tool where you type queries and get responses.

**CodeLayer** transforms it into:
- ✅ A **multi-session orchestration platform**
- ✅ A **knowledge management system** (thoughts)
- ✅ An **approval workflow engine** (human-in-the-loop)
- ✅ A **team collaboration tool** (handoffs, shared thoughts, PR workflows)
- ✅ A **productivity multiplier** (keyboard shortcuts, parallel sessions)
- ✅ A **codebase intelligence system** (research commands, context engineering)

### 10 Unique Features

#### 1. Human-in-the-Loop Approvals
The flagship feature - Claude Code pauses and asks for human approval before executing actions:
- **`request_permission` MCP tool** that Claude Code calls before dangerous operations
- **Multi-channel approval UI**: Desktop app (WUI), TUI, web interface
- **Real-time polling**: Approvals show up instantly in the UI with Server-Sent Events
- **Approval modification**: You can approve, deny, or even modify the input before allowing the action

**Files**: `hlyr/src/mcp.ts:46-65`, `humanlayer-wui/`

#### 2. "MultiClaude" - Parallel Session Management
Run multiple Claude Code sessions simultaneously with full orchestration:
- **Session dashboard**: See all active Claude sessions in one view
- **Conversation history**: Track what each session is doing
- **Session lifecycle control**: Launch, continue, pause, archive sessions
- **Worktree support**: Each session can run in its own git worktree
- **Session isolation**: Each has its own database, socket, and environment

**Files**: `hld/session/manager.go`, `hld/PROTOCOL.md:81-150`

#### 3. Thoughts System - Developer Knowledge Management
A sophisticated system for managing developer notes across projects:
- **Symlink-based structure**: `thoughts/{user}/`, `thoughts/shared/`, `thoughts/global/`
- **Auto-sync with git**: Post-commit hooks automatically sync thoughts to a separate repo
- **Cross-project notes**: Global thoughts accessible from all repos
- **Team collaboration**: Shared thoughts for team coordination
- **Pre-commit protection**: Prevents accidentally committing thoughts to code repos
- **Searchable index**: Hard-linked searchable directory for AI to find context

**Files**: `hlyr/src/commands/thoughts/init.ts:124-183`, `.claude/commands/` (slash commands reference thoughts)

**Thoughts Directory Structure**:
```
thoughts/
├── {user}/        → Personal repo-specific notes
├── shared/        → Team repo-specific notes
├── global/        → Cross-repository thoughts
│   ├── {user}/    → Personal cross-repo notes
│   └── shared/    → Team cross-repo notes
└── searchable/    → Hard links for searching (auto-generated)
```

#### 4. Superhuman-Style Keyboard Workflows
Vim-inspired keyboard shortcuts for managing sessions:
- **`j/k`** - Navigate sessions up/down
- **`shift+j/k`** - Bulk selection with anchor-based range selection
- **`x`** - Toggle individual selection
- **`e`** - Archive/unarchive sessions
- **Stateless anchor management**: Prevents sync issues during navigation

**Files**: `humanlayer-wui/CLAUDE.md:45-62`

#### 5. Advanced Slash Commands
Pre-built workflows for complex development tasks (28 commands available):

**Planning & Implementation**:
- `/create_plan` - Create detailed implementation plans with research
- `/implement_plan` - Implement plans with verification
- `/iterate_plan` - Update plans based on new requirements
- `/validate_plan` - Verify implementation matches plan

**Team Collaboration**:
- `/create_handoff` - Create handoff docs for transferring work
- `/resume_handoff` - Resume from handoff with context analysis
- `/local_review` - Set up worktree for reviewing colleague's branch

**CI/CD Integration**:
- `/ci_commit` - Create atomic commits with clear messages
- `/ci_describe_pr` - Generate PR descriptions following repo templates

**Workflow Automation**:
- `/ralph_plan`, `/ralph_impl`, `/ralph_research` - Automated ticket workflows
- `/linear` - Linear integration for ticket management
- `/founder_mode` - Rapid prototyping workflow

**Files**: `.claude/commands/` (28 custom commands)

#### 6. Codebase Research Workflows
Specialized commands for understanding large codebases:
- `/research_codebase` - Document codebase as-is with historical context
- `/research_codebase_generic` - Parallel sub-agents for comprehensive research
- `/research_codebase_nt` - Research without thoughts directory
- **Uses Task agents**: Spawns parallel research agents for thorough analysis

**Files**: `.claude/commands/research_codebase*.md`

#### 7. Session Persistence & Continuity
Resume conversations exactly where you left off:
- **Full conversation history**: Stored in SQLite database
- **Session continuation**: `continueSession()` API to resume with new queries
- **Parent-child sessions**: Track session lineage
- **Session status tracking**: starting → running → completed/failed
- **Error capture**: Failed sessions store error details

**Files**: `hld/PROTOCOL.md:149-170`, `hld/store/`

#### 8. Real-Time Event Streaming
Live updates across all components:
- **Event types**: `new_approval`, `approval_resolved`, `session_status_changed`
- **SSE for WUI**: Server-Sent Events for browser updates
- **JSON-RPC Subscribe**: Streaming events over Unix socket
- **Event bus architecture**: Decoupled event propagation

**Files**: `hld/daemon/http_server.go`, `hld/rpc/handlers.go:Subscribe`

#### 9. Desktop App with Auto-Daemon Management
Zero-config desktop application:
- **Tauri-based**: Native desktop app (macOS, Windows, Linux)
- **Auto-launch daemon**: Daemon starts invisibly when app opens
- **Branch isolation**: Each git branch gets its own daemon instance in dev mode
- **Bundled binaries**: Ships with `hld` + `hlyr` binaries included
- **Debug panel**: Manual daemon control for advanced users

**Files**: `humanlayer-wui/README.md:58-81`

#### 10. Git Worktree Integration
Advanced git workflows for parallel development:
- Commands create/manage worktrees automatically
- Each worktree can have its own Claude session
- Prevents cross-contamination between features
- Hooks handle worktree-specific edge cases

**Files**: `.claude/commands/create_worktree.md`, `hlyr/src/commands/thoughts/init.ts:239-245`

---

## Pre-built Workflows and Slash Commands

### Understanding the Distinction

#### Slash Commands = The Interface
These are **markdown files** stored in `.claude/commands/*.md` that you invoke with `/command_name`. When you type a slash command, it **expands into a detailed prompt** that tells Claude what to do.

**Structure**:
```markdown
---
description: Short description shown in command list
model: opus (optional - which Claude model to use)
---

# Detailed instructions for Claude
...
```

**Example**: When you type `/commit`, Claude receives the entire content of `commit.md` as a prompt.

#### Workflows = The Logic Inside Commands
These are the **multi-step processes** that the slash commands orchestrate. Some commands contain simple workflows, others are quite complex.

### Types of Commands by Complexity

#### 1️⃣ Simple Commands (Single workflow step)
Execute one straightforward task:

**`/commit`** - Create git commits
- Single workflow: analyze changes → draft message → get approval → commit

**`/founder_mode`** - Retroactively create ticket/PR
- Linear workflow: get commit → create ticket → create branch → cherry-pick → push → PR

#### 2️⃣ Compound Commands (Multi-step workflow with orchestration)
Execute multiple sub-workflows in sequence:

**`/ralph_plan`** - Plan highest priority ticket
```
Workflow:
1. Fetch top 10 Linear tickets (query workflow)
2. Select highest priority SMALL/XS ticket (selection logic)
3. Fetch ticket to thoughts/shared/tickets/ (storage workflow)
4. Read ticket + all comments (context gathering)
5. Move ticket to "plan in progress" (status workflow)
6. Create implementation plan (nested: calls /create_plan workflow)
7. Sync to thoughts repo (git workflow)
8. Attach plan to Linear ticket (attachment workflow)
9. Move to "plan in review" (status workflow)
```

**`/create_plan`** - Interactive planning workflow
```
Workflow:
1. Parse input (file path or interactive)
2. Spawn parallel research agents:
   - codebase-locator
   - codebase-analyzer
   - thoughts-locator
3. Read all identified files
4. Analyze discrepancies
5. Ask informed questions
6. Iterative refinement loop
7. Draft plan document
8. Review with user
9. Save to thoughts/
```

#### 3️⃣ Meta-Commands (Orchestrate other commands)
Commands that launch other commands or sessions:

**`/oneshot`** - Research + planning in separate session
```
Workflow:
1. Call /ralph_research (nested command)
2. Launch NEW Claude session with /oneshot_plan
```

This spawns an entirely new Claude Code session to do the planning!

### Key Architectural Patterns

#### Pattern 1: Command Chaining
Commands call other commands:
```
/oneshot
  → /ralph_research
  → launches new session with /oneshot_plan
```

#### Pattern 2: Agent Spawning
Commands spawn specialized Task agents:
```markdown
# Inside /create_plan
- Use the **codebase-locator** agent to find files
- Use the **codebase-analyzer** agent to understand implementation
- Use the **thoughts-locator** agent to find existing docs
```

These are the `Task` tool calls with `subagent_type` parameters!

#### Pattern 3: External Tool Integration
Commands integrate with external systems:
```
/linear - Uses MCP Linear tools
/ralph_plan - Fetches from Linear API
/commit - Uses git commands
/describe_pr - Uses gh CLI
```

#### Pattern 4: Session Lifecycle Management
Commands manage Claude sessions:
```
/oneshot - Launches new sessions
/create_handoff - Creates handoff docs
/resume_handoff - Resumes from handoff
```

### Real-World Example: The "Ralph" Workflow

The **Ralph commands** form a complete development workflow:

```
┌─────────────────────────────────────────────────┐
│ /ralph_research                                 │
│ - Fetch ticket from Linear                      │
│ - Research codebase                             │
│ - Document findings in thoughts/                │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ /ralph_plan                                     │
│ - Use research to create implementation plan    │
│ - Save to thoughts/shared/plans/                │
│ - Attach to Linear ticket                       │
│ - Move ticket to "plan in review"               │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ /ralph_impl                                     │
│ - Create worktree                               │
│ - Implement according to plan                   │
│ - Write tests                                   │
│ - Create PR                                     │
└─────────────────────────────────────────────────┘
```

Each `/ralph_*` command is a **slash command** that orchestrates a **workflow** internally.

### Summary Table

| Concept | What It Is | Where It Lives | Example |
|---------|-----------|----------------|---------|
| **Slash Command** | Markdown file that expands to prompt | `.claude/commands/*.md` | `/commit`, `/linear` |
| **Workflow** | Multi-step process logic | Inside the command markdown | "fetch → analyze → plan → save" |
| **Simple Command** | 1 workflow, linear | Single `.md` file | `/commit` |
| **Compound Command** | Multiple workflows, branching | Single `.md` file, complex | `/ralph_plan` |
| **Meta Command** | Launches other commands/sessions | `.md` that calls other commands | `/oneshot` |
| **Agent Spawning** | Pattern that uses Task tool | Inside workflow instructions | `codebase-locator` agent |

### The Mental Model

Think of it like this:

- **Slash Commands** = Functions you call
- **Workflows** = The implementation/algorithm inside those functions
- **Simple Commands** = Single-purpose functions
- **Compound Commands** = Functions that orchestrate multiple operations
- **Meta Commands** = Higher-order functions that call other functions

### Linear Workflow Integration

The `/linear` command provides integration with Linear issue tracking:

**Team Workflow Stages**:
1. **Triage** → Initial review
2. **Spec Needed** → More detail needed
3. **Research Needed** → Investigation required
4. **Research in Progress** → Active investigation
5. **Research in Review** → Research findings under review
6. **Ready for Plan** → Research complete, needs implementation plan
7. **Plan in Progress** → Writing implementation plan
8. **Plan in Review** → Plan under discussion
9. **Ready for Dev** → Plan approved, ready for implementation
10. **In Dev** → Active development
11. **Code Review** → PR submitted
12. **Done** → Completed

**Key principle**: Review and alignment happen at the plan stage (not PR stage) to move faster and avoid rework.

---

## Additional Resources

- **CLAUDE.md**: Project-level guidance for Claude Code
- **hld/PROTOCOL.md**: Complete JSON-RPC specification
- **humanlayer-wui/docs/ARCHITECTURE.md**: System architecture diagrams
- **DEVELOPMENT.md**: Development setup and conventions

---

*Document generated from conversation on 2025-11-26*
