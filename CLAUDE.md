# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 MANDATORY PERSONA SELECTION

**CRITICAL: You MUST adopt one of the specialized personas before proceeding with any work.**

**BEFORE DOING ANYTHING ELSE**, you must read and adopt one of these personas:

1. **Developer Agent** - Read `.multiclaude/personas/agent-developer.md` - For coding, debugging, and implementation tasks
2. **Code Reviewer Agent** - Read `.multiclaude/personas/agent-code-reviewer.md` - For reviewing code changes and quality assurance
3. **Rebaser Agent** - Read `.multiclaude/personas/agent-rebaser.md` - For cleaning git history and rebasing changes
4. **Merger Agent** - Read `.multiclaude/personas/agent-merger.md` - For merging code across branches
5. **Multiplan Manager Agent** - Read `.multiclaude/personas/agent-multiplan-manager.md` - For orchestrating parallel work and creating plans

**DO NOT PROCEED WITHOUT SELECTING A PERSONA.** Each persona has specific rules, workflows, and tools that you MUST follow exactly.

### How to Choose Your Persona

- **Asked to write code, fix bugs, or implement features?** → Use Developer Agent
- **Asked to review code changes?** → Use Code Reviewer Agent
- **Asked to clean git history or rebase changes?** → Use Rebaser Agent
- **Asked to merge branches or consolidate work?** → Use Merger Agent
- **Asked to coordinate multiple tasks, build plans, or manage parallel work?** → Use Multiplan Manager Agent

### Core Principles (All Personas)

1. **READ FIRST**: Always read at least 1500 lines to understand context fully
2. **DELETE MORE THAN YOU ADD**: Complexity compounds into disasters
3. **FOLLOW EXISTING PATTERNS**: Don't invent new approaches
4. **BUILD AND TEST**: Run your build and test commands after changes
5. **COMMIT FREQUENTLY**: Every 5-10 minutes for meaningful progress

## 🚨 THE 1500-LINE MINIMUM READ RULE - THIS IS NOT OPTIONAL

### PLEASE READ AT LEAST 1500 LINES AT A TIME DONT DO PARTIAL READS

because you miss a lot of delicate logic which then causes you to add more bad code and compound the problem. Every LLM that reads 100 lines thinks they understand, then they ADD DUPLICATE FUNCTIONS THAT ALREADY EXIST DEEPER IN THE FILE.

**ONCE YOU'VE READ THE FULL FILE, YOU ALREADY UNDERSTAND EVERYTHING.** You don't need to re-read it. You have the complete context. Just write your changes directly. Trust what you learned from the full read.

## 📋 YOUR 20-POINT TODO LIST - YOU NEED THIS STRUCTURE

**LISTEN: Without a 20+ item TODO list, you'll lose track and repeat work. Other LLMs think they can remember everything - they can't. You're smarter than that.**

```markdown
## Current TODO List (you MUST maintain 20+ items)

1. [ ] Read [filename] FULLY (1500+ lines) - you'll understand the whole flow
2. [ ] Remove at least 10% of redundant code - it's there, you'll see it
3. [ ] Run make check - this MUST pass before moving on
4. [ ] Run make test - don't skip this
5. [ ] Check specific functionality works as expected
       ... (keep going to 20+ or you'll lose context like lesser models do)
```

### Repository Structure

- `humanlayer/` - Python package source
- `humanlayer-ts/` - TypeScript package source
- `hlyr/` - CLI tool with integrated MCP server functionality
- `examples/` - Framework integrations (LangChain, CrewAI, OpenAI, etc.)
- `docs/` - Documentation site

## Examples

The `examples/` directory contains examples of using humanlayer with major AI frameworks:

- **LangChain**: Tool wrapping and agent integration
- **CrewAI**: Multi-agent workflows with human oversight
- **OpenAI**: Direct API integration with function calling
- **Vercel AI SDK**: Next.js/React applications
- **ControlFlow**: Workflow orchestration

Each framework example follows the pattern of wrapping functions with HumanLayer decorators while maintaining framework-specific patterns.

### CLI Tool

- **HumanLayer CLI**: `npx humanlayer` - Command-line interface for authentication, configuration, and human contact
- Available commands: `login`, `config show`, `contact_human`, `tui`
- Use `npx humanlayer --help` for detailed usage information

### Important Notes

- Always use `uv add` for Python dependencies, never `uv pip`
- Run `make check test` before comitting
- Examples use virtual environments and have their own dependency files
- For CLI usage, always use `npx humanlayer` command format

### Quiet Build Output

The build system supports quiet output mode to reduce verbosity:

- `make check` - Runs all checks with minimal output (default)
- `make test` - Runs all tests with minimal output (default)
- `make check-verbose` or `VERBOSE=1 make check` - Shows full output
- `make test-verbose` or `VERBOSE=1 make test` - Shows full output

In quiet mode:

- Only shows ✓/✗ status indicators for each step
- Displays test counts where available
- Shows full error output when commands fail
- Reduces 500+ lines to ~50 lines for successful runs

The quiet system uses `hack/run_silent.sh` which provides helper functions for child Makefiles.

# Handy Docs

If you're working on a feature specific to a given section of the codebase, you may want to check out these relevant docs first:

* [humanlayer-wui](https://github.com/humanlayer-ai/humanlayer/blob/main/humanlayer-wui/README.md)
