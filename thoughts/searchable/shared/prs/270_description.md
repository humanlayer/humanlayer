## What problem(s) was I solving?

I needed to create two complementary Claude commands for better project planning and management:

1. A new `/implementation_plan` command that helps create detailed technical specifications through an interactive, iterative process
2. Enhanced the Linear ticket management workflow by renaming `/create_linear_ticket` to `/linear` with support for multiple actions (create, update, search, status management)

The existing `research_codebase` command was also improved to read directly mentioned files first, ensuring full context is available before spawning research sub-tasks.

## What user-facing changes did I ship?

### New `/implementation_plan` Command
- Interactive command that guides users through creating comprehensive technical specifications
- Accepts file paths or ticket references as parameters for immediate processing (e.g., `/implementation_plan thoughts/allison/tickets/eng_1234.md`)
- Generates structured implementation plans saved to `thoughts/shared/plans/` for team visibility
- Separates success criteria into automated verification (tests, builds) vs manual verification (UI/UX)
- Ensures plans are complete and actionable with no unresolved decisions

### Enhanced `/linear` Command (renamed from `/create_linear_ticket`)
- Multi-action support: create tickets, update status, add links/comments, search
- Documents team's spec review workflow (Triage → Spec Needed → Spec in Review → Ready for Dev)
- Automatic GitHub URL mapping for thoughts documents
- MCP tool availability check with clear setup instructions
- Sensible defaults: new tickets start in "Triage" status with Medium priority

### Improved `/research_codebase` Command
- Now reads directly mentioned files FULLY before spawning sub-tasks
- Ensures main context has complete information from tickets/docs before decomposing research

## How I implemented it

### `/implementation_plan` Command Implementation
Created a detailed command specification in `.claude/commands/implementation_plan.md` that:
- Follows a 5-step interactive process: Context Gathering → Research & Discovery → Plan Structure Development → Detailed Plan Writing → Review & Refinement
- Emphasizes reading mentioned files COMPLETELY before any analysis begins
- Uses parallel sub-tasks for comprehensive research across different codebase aspects
- Includes detailed guidelines for spawning directory-aware research tasks
- Validates understanding when users correct misunderstandings (spawns new research tasks)
- Generates plans with clear phases, separated success criteria, and concrete code changes

### `/linear` Command Enhancements
Renamed and enhanced `.claude/commands/linear.md` to:
- Support multiple Linear actions beyond just ticket creation
- Document the team's workflow where review happens at spec stage (not PR stage)
- Use the `links` parameter properly for URL attachments instead of just markdown
- Check for MCP tool availability before proceeding
- Provide GitHub URL mapping for thoughts references

### `/research_codebase` Enhancement
- Added Step 1 to read any directly mentioned files first using the Read tool WITHOUT limit/offset
- Renumbered subsequent steps and updated all references throughout
- Ensures tickets, docs, and data files are fully loaded before research decomposition

## How to verify it

- [x] I have ensured `make check test` passes

### Manual Verification Needed:
- [ ] Test the new `/implementation_plan` command with a real ticket to ensure interactive flow works smoothly
- [ ] Verify that implementation plans are saved correctly to `thoughts/shared/plans/`
- [ ] Test the enhanced `/linear` command for creating, updating, and searching tickets
- [ ] Confirm MCP tool check provides clear instructions when Linear tools aren't available
- [ ] Test that `/research_codebase` properly reads mentioned files before spawning sub-tasks
- [ ] Verify parameter support in `/implementation_plan` (direct file path invocation)

## Description for the changelog

Added `/implementation_plan` Claude command for creating detailed technical specifications through interactive planning. Enhanced `/linear` command (renamed from `/create_linear_ticket`) with multi-action support and team workflow documentation. Improved `/research_codebase` to read mentioned files upfront for better context.