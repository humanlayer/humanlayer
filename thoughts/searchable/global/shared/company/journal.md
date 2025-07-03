---
summary: Comprehensive activity log tracking all HumanLayer company actions, decisions, and changes
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary fields to 9 company files and updated journal
---

# HumanLayer Activity Journal

_This file records everything the AI company has done, organized by date with bulleted lists. It serves as a comprehensive activity log and decision history._

## How to Use This File

The journal is HumanLayer's memory and activity log. It must be updated after EVERY meaningful action or decision.

### When to Add Entries
- **ALWAYS** after creating or updating any file in this repository
- After important conversations or decisions
- When completing tasks or reaching milestones
- When encountering challenges or pivots
- After team interactions or meetings

### What to Include
- Specific actions taken (files created/updated)
- Decisions made and rationale
- Who was involved (use usernames)
- Key insights or learnings
- Problems encountered and solutions
- Links to relevant files or resources

### Entry Guidelines
- Be specific - "Updated metrics in README.md" not "Updated some files"
- Include context - why the action was taken
- Note dependencies - what led to this action
- Record outcomes - what changed as a result

## Instructions

- Add new entries at the top with date headers
- Use bulleted lists for clarity
- Include both actions taken and decisions made
- Record interactions with team members
- Keep entries concise but informative
- Archive older entries if file becomes too long

## Format

```
### YYYY-MM-DD
- Activity or decision made
- Another activity
```

---

### 2025-06-26
- Simplified tool specifications based on review (requested by dex)
- Created minimal, clear documentation:
  - SIMPLIFIED.md: One-page overview of entire system
  - README.md: Quick start guide focusing on essentials
  - stripe-minimal.md: Example of simple tool implementation
  - example-workflow.yaml: 30-line workflow anyone can copy
- Key simplifications:
  - Removed verbose explanations
  - Focused on `claude -p` doing the work
  - Reduced workflows from 100+ lines to ~30 lines
  - Made human setup steps crystal clear
- Design principle: Let Claude handle complexity, keep configs minimal
- Added GitHub Actions automation sections to all tool specifications (requested by dex)
- Each tool spec now includes:
  - Minimal permissions required (repository access, secrets, GitHub permissions)
  - Example automation workflows using cron schedules and workflow_dispatch
  - Integration with `claude -p` for headless Claude Code execution
- Created complete workflow examples:
  - weekly-update-workflow.yaml: Comprehensive Friday automation for weekly updates
  - daily-priorities-workflow.yaml: Daily priorities check and standup preparation
- Key decision: Use `claude -p` to launch headless sessions rather than calling tools directly
- Updated all tool specs with GitHub Actions sections:
  - stripe-metrics-collector: Daily metrics update workflow
  - mercury-bank-fetcher: Daily financial metrics workflow
  - linear-integration: Daily priorities and weekly report workflows
  - social-media-fetcher: Weekly content collection workflow
- Moved tools specifications from tools/tools-plan-06-26/ to global/shared/company/tools-specs/ (requested by dex)
- Added frontmatter with summary fields to all tool specification files
- Added comprehensive human dependencies sections to all tool specs (requested by dex)
- Human dependencies detail:
  - Initial setup requirements (API keys, credentials, permissions)
  - Where to save credentials (/Users/dex/go/src/github.com/humanlayer/thoughts/.env)
  - Ongoing maintenance needs (credential rotation, monitoring)
  - How AI will use each tool during SOPs
- Updated tool specifications:
  - social-media-fetcher: Twitter/LinkedIn API setup for thought leadership content
  - stripe-metrics-collector: Stripe dashboard API key for revenue metrics
  - mercury-bank-fetcher: Mercury API credentials (expire every 90 days)
  - linear-integration: Linear personal API key for ticket management
  - spec.md: Added frontmatter to main specification document
- Key decision: All credentials stored in single .env file for centralized management
- Added summary field to all markdown files in global/shared/company/ (requested by dex)
- Updated frontmatter for 22 total files to include descriptive summary at the top
- Summary fields provide quick understanding of each file's purpose without reading content
- Added summary field to frontmatter for remaining 4 SOP files (requested by dex):
  - daily-standup.md: "Daily standup process for team synchronization at 8:30am PST"
  - spec-driven-development.md: "Planning process to maximize velocity through detailed specification before coding"
  - triage.md: "Queue management for issues needing team prioritization and discussion"
  - update-financials.md: "Process for updating company financial metrics and tracking"
- Updated all last_updated dates to 2025-06-26 and last_update to "Added summary field to frontmatter"
- All SOP files now have consistent frontmatter with summary fields for better documentation
- Added summary field to frontmatter for 9 company files (requested by dex):
  - metrics/README.md: "High-level overview of HumanLayer's most critical KPIs and metrics"
  - metrics/all.md: "Comprehensive metrics tracking including revenue, growth, product, and operational KPIs"
  - quarterly-goals.md: "Quarterly objectives and progress tracking for strategic company direction"
  - two-week-goal.md: "Current top priority goal for the next two weeks with specific actions"
  - weekly-updates.md: "All weekly updates since company creation including business progress and metrics"
  - tools.md: "Catalog of all tools, scripts, and resources for company operations"
  - tasks-for-humans.md: "Active tasks requiring human intervention that cannot be automated"
  - tasks-for-humans-archive.md: "Archive of completed human tasks for reference and historical tracking"
  - manifest/team.md: "Detailed team member information including roles and responsibilities"
- Updated all last_updated dates to 2025-06-26 and last_update to "Added summary field to frontmatter"
- Updated hack/index-files.ts to show clean ===filename=== format with YAML output (requested by dex)
- Modified make index command to only process global/shared directory, skipping repos/
- Added note to sops/README.md explaining SOPs serve dual purpose as human and AI prompts
- Created comprehensive tools specification plan in tools/tools-plan-06-26/ (requested by dex)
- Reviewed all SOPs to identify tooling needs, found 12 key tools required for automation
- Created main spec.md defining overall tooling strategy with 4 implementation phases
- Added social-media-fetcher tool spec for capturing thought leadership content (requested by dex)
- Created detailed specifications for highest priority tools:
  - stripe-metrics-collector: Automates MRR and customer metrics collection
  - mercury-bank-fetcher: Automates bank balance and burn rate calculations
  - linear-integration: Enables ticket management and workflow analysis
- Key decision: Prioritize financial tools first as they unblock the most critical SOPs
- Merged root CLAUDE.md into global/shared/company/CLAUDE.md (requested by dex)
- Consolidated redundant sections in CLAUDE.md, reducing from 146 to 113 lines (22% reduction)
- Added proper frontmatter to global/shared/company/CLAUDE.md
- Removed duplicate information about frontmatter requirements, file constraints, and working procedures
- Better organized sections with clear hierarchy: identity → overview → commands → structure → workflow
- Key decision: Keep all repository-specific guidance in the company CLAUDE.md file rather than having multiple CLAUDE.md files

### 2025-06-26
- Reviewed all markdown files in global/shared/company/ for frontmatter completeness with dex
- Confirmed all files already have proper frontmatter with descriptive last_update fields
- Skipped hack/index-files.ts as it's a TypeScript file without frontmatter
- Created daily-priorities.md SOP with dex defining work prioritization framework
- Established 7 core concepts: minimize WIP, right-to-left kanban, sync/async balance, unblocking focus
- Added daily workflow priorities: unblock others first, then complete own work
- Updated SOPs README.md with links to all SOP documents
- Fixed incorrect dates across multiple files (most were dated 2025-06-25 instead of 2025-06-26)
- Discovered daily-priorities.md had wrong date (2025-01-26 instead of 2025-06-26)

### 2025-06-25
- Created comprehensive SOPs for update processes with dex
- Developed weekly-update.md SOP for internal weekly updates (replacing previous investor-focused approach)
- Created monthly_investor_updates.md SOP with dual metrics approach (full and lite versions)
- Created monthly_public_updates.md SOP for community-facing updates
- Refined SOPs based on dex's feedback to ensure proper execution order
- Updated SOPs README with clear categorization and execution order
- Noted multiple areas needing tooling: Stripe metrics, Mercury balance, Linear export, calendar integration
- Established clear distinction between internal, investor, and public communications
- Updated spec-driven-development.md SOP with new Linear categories and workflow phases
- Reviewed all frontmatter across global/shared/ directory with dex
- Added historical journal entries based on frontmatter last_update information
- Enhanced journal.md with "How to Use This File" section for better guidance
- Updated CLAUDE.md to make journal entries MANDATORY after every file change
- Established journal as critical memory system between AI sessions


### 2025-01-25
- Documented daily standup process with Tuple in daily-standup.md with dex
- Set 8:30am PST schedule for team synchronization
- Updated triage.md to reference daily standup process
- Established process for clearing triage queue daily

### 2025-06-20
- Initial bootstrap of HumanLayer company knowledge base with dex
- Created foundational structure for all company documentation
- Established manifest.md as central registry (under 200 lines)
- Set up metrics tracking system with README and detailed all.md
- Created weekly-updates.md for investor communications
- Initialized quarterly and two-week goal tracking systems
- Set up human task delegation system with archive
- Created tools catalog for company resources
- Established team manifest structure
- Created journal.md for activity tracking

### 2024-01-25
- Started work on update-financials.md SOP with dex
- Work in progress on financial update procedures
