# humanlayerRPOA — Claude Code Project Template

A ready-to-use project template for AI-assisted development with Claude Code.
No external services required — everything runs locally with markdown files and git.

## What this is

A structured workspace that gives Claude Code the context, commands, and agents it needs to help you plan, research, implement, and ship software — using only your local repo.

- `/commands` — slash commands for each phase of the development cycle
- `/agents` — specialised sub-agents spawned by commands for parallel work
- `thoughts/` — persistent local storage for plans, research, handoffs, tickets, and PRs

---

## Setup — using this template for a new project

1. **Copy this repo** into your project directory (or clone and re-init git):
   ```bash
   cp -r humanlayerRPOA/ my-project/
   cd my-project/
   git init && git add . && git commit -m "init: project template"
   ```

2. **Rename the README template** — the file `README_project.md` is the template for your project's own README. Rename it:
   ```bash
   mv README_project.md README.md   # replace this file when ready
   ```

3. **Fill in `plan.md`** — this is the first file Claude reads. Add your project goal, stack, and initial next steps.

4. **Open Claude Code** in the project root:
   ```bash
   claude
   ```

5. You're ready. Claude now has access to all commands and agents.

---

## Directory structure

```
.
├── .claude/
│   ├── commands/        # Slash commands (/create_plan, /research_codebase, etc.)
│   └── agents/          # Sub-agents (ticket-reader, codebase-locator, etc.)
├── thoughts/
│   ├── plans/           # Implementation plans
│   ├── research/        # Research documents
│   ├── handoffs/        # Session handoff documents
│   ├── prs/             # PR descriptions
│   └── tickets/         # Local tickets (replaces Linear/Jira)
│       └── _template.md # Ticket template
├── decisions/           # Architecture and design decisions
├── notes/               # Free-form notes and drafts
├── logs/                # Application logs (any *.log files go here)
├── plan.md              # Project goal, stack, current status, next steps
├── CLAUDE.md            # Instructions Claude reads in every session
└── README_project.md    # README template for your actual project
```

---

## Available commands

### Planning & research
| Command | What it does |
|---|---|
| `/research_codebase` | Documents the codebase as-is; saves to `thoughts/research/` |
| `/create_plan` | Creates a detailed implementation plan from a ticket or description |
| `/iterate_plan` | Updates an existing plan based on new findings |
| `/validate_plan` | Checks implementation against the plan; reports gaps |

### Implementation
| Command | What it does |
|---|---|
| `/implement_plan` | Implements a plan file step by step |
| `/create_worktree` | Creates a git worktree for isolated implementation |

### Git & PRs
| Command | What it does |
|---|---|
| `/commit` | Creates a clean commit with user approval |
| `/describe_pr` | Generates a full PR description from git diff |

### Tickets
| Command | What it does |
|---|---|
| `/tickets` | Create, update, search, and move tickets through the workflow |

### Session continuity
| Command | What it does |
|---|---|
| `/create_handoff` | Saves current session state for the next session |
| `/resume_handoff` | Loads a handoff and picks up where you left off |
| `/debug` | Investigates logs, git state, and project data without editing files |

### Other
| Command | What it does |
|---|---|
| `/founder_mode` | Creates a ticket + PR after an experimental implementation |
| `/local_review` | Sets up a worktree to review a colleague's branch |

---

## Workflow examples

The core development loop has three phases, regardless of context:

```
Investigate → Plan → Execute
```

---

### New project (greenfield)

No codebase yet. Start from a description or idea.

```
1. Describe the project in notes/idea.md or directly in the prompt
2. Fill in plan.md — goal, stack, initial constraints

── Investigate ──────────────────────────────────────────
3. /research_codebase — explore stack, patterns, dependencies, similar examples

── Plan ─────────────────────────────────────────────────
4. /create_plan — build a full implementation plan from the description

── Execute ──────────────────────────────────────────────
5. /implement_plan — implement phase by phase
6. /commit + /describe_pr — ship
```

---

### New feature or bug fix (existing project)

```
1. /tickets — create a ticket: problem to solve + proposed solution
2. /research_codebase — map the relevant parts of the codebase for this ticket
3. /create_plan — build an implementation plan linked to the ticket (iterate with /iterate_plan until satisfied)
4. /implement_plan — implement step by step
5. /validate_plan — verify success criteria are met
6. /commit + /describe_pr — ship
```

---

### Resuming work after a break

```
1. /create_handoff  ← run at the end of the current session
2. (new session) /resume_handoff — reloads context, plans, and current state
3. Continue from where you left off
```

---

### Parallel implementation with worktrees

When you want to implement on an isolated branch without interrupting current work.

```
1. /create_plan — create the plan in thoughts/plans/
2. /create_worktree — creates ~/wt/feature-name/ on a new branch
3. cd ~/wt/feature-name && claude  ← open a new Claude Code session there
4. /implement_plan — implement in isolation
5. /commit + /describe_pr — ship from the worktree
6. git worktree remove ~/wt/feature-name  ← clean up after merge
```

---

### Experimental feature (no prior planning)

Implemented something without a ticket or plan first.

```
1. /commit — commit what you built
2. /founder_mode — creates a ticket retroactively, makes a branch, pushes, opens a PR
```

---

### Debugging an issue

```
1. /debug — describe the problem; Claude investigates logs/, git state, and project data
   without editing any files
```

---

## Ticket workflow

Tickets live in `thoughts/tickets/` as markdown files.

```
backlog → spec needed → research needed → research in progress
       → ready for plan → plan in progress → plan in review
       → in progress → in review → done
```

Use `/tickets` to create, update, search, or move tickets through these states.

---

## License

[LICENSE](LICENSE)
