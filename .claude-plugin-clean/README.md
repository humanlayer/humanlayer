# Claude Code Plugin - Clean Commands & Agents

A comprehensive Claude Code plugin with generic, reusable commands and agents for software development workflows. This plugin has been cleaned of all Linear-specific integrations to work with any project management system.

## Contents

### Agents (6)
Specialized research and analysis agents that help explore and understand codebases:

- **codebase-analyzer** - Analyzes implementation details and traces data flow
- **codebase-locator** - Finds WHERE code lives in the codebase
- **codebase-pattern-finder** - Discovers similar implementations and patterns
- **thoughts-analyzer** - Extracts insights from documentation
- **thoughts-locator** - Discovers relevant documents in thoughts/ directory
- **web-search-researcher** - Performs deep web research

### Commands (20)

#### Planning & Implementation
- **create_plan** - Create detailed implementation plans through interactive research
- **create_plan_generic** - Generic planning with thorough research
- **create_plan_nt** - Planning without thoughts directory integration
- **implement_plan** - Execute implementation plans with verification
- **iterate_plan** - Iterate on existing plans with research
- **iterate_plan_nt** - Iterate on plans without thoughts directory
- **validate_plan** - Validate implementation against plan

#### Research
- **research_codebase** - Document codebase with historical context
- **research_codebase_generic** - Generic codebase research
- **research_codebase_nt** - Research without thoughts directory

#### Git & PR Management
- **commit** - Create git commits with user approval
- **ci_commit** - Create commits for session changes
- **describe_pr** - Generate comprehensive PR descriptions
- **describe_pr_nt** - Generate PR descriptions (no thoughts)
- **ci_describe_pr** - CI-focused PR descriptions

#### Session Management
- **create_handoff** - Create handoff documents for work transfer
- **resume_handoff** - Resume work from handoff documents
- **create_worktree** - Create worktree and launch implementation session

#### Code Review & Debugging
- **local_review** - Set up worktree for reviewing branches
- **debug** - Debug issues by investigating logs and state

## Installation

1. Copy the entire `.claude-plugin-clean` directory contents to your project's `.claude/` directory:
   ```bash
   cp -r .claude-plugin-clean/* /path/to/your/project/.claude/
   ```

2. Or create a fresh `.claude/` directory:
   ```bash
   mkdir -p /path/to/your/project/.claude
   cp -r .claude-plugin-clean/* /path/to/your/project/.claude/
   ```

## Usage

All commands are available via slash commands in Claude Code:

- `/create_plan` - Start planning a new feature
- `/research_codebase` - Research how something works
- `/implement_plan` - Execute an implementation plan
- `/commit` - Create a git commit
- `/describe_pr` - Generate PR description
- And more...

## Features

- **No External Dependencies** - All commands work standalone
- **Parallel Agent Execution** - Efficient research via concurrent sub-agents
- **Comprehensive Planning** - Detailed, iterative planning workflows
- **Git Integration** - Seamless commit and PR workflows
- **Documentation Focus** - Built-in research and documentation generation

## Customization

You can customize the behavior by editing:
- `settings.json` - Adjust permissions and environment variables
- Individual command files in `commands/` - Modify workflows
- Agent definitions in `agents/` - Tune agent behaviors

## Notes

- This plugin was derived from the HumanLayer repository
- All Linear-specific integrations have been removed
- Commands that reference "thoughts/" directory are optional and can be adapted to your documentation structure
- The `ENG-XXXX` ticket format in examples can be replaced with your ticket system format

## License

Same as the source repository (HumanLayer).
