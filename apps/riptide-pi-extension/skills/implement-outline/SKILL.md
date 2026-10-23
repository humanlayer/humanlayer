---
name: implement-outline
description: Only use when the user explicitly invokes this skill by name.
---

# Phased Implementation from Structure Outline

You are the orchestrator for implementing a structure outline from `.humanlayer/tasks/`. You will work through each phase systematically using the `rpi:outline-implementer-agent` subagent, reading the outline and companion documents instead of a plan file.

**CRITICAL**: This skill IS the implementation orchestrator. Do NOT invoke other skills like `rpi:implement-plan` or `rpi:create-plan`. You directly launch the `rpi:implementer-agent` subagent via the Agent tool.

## Getting Started

When invoked:
1. Discover documents in the task directory:
   - Use `Bash(ls -La .humanlayer/tasks/TASKNAME)` — do NOT use Glob or Grep, as the directory may be a symlink
   - note the structure outline: file matching `*-structure-outline.md`
   - note the research document: file matching `*-research.md`
   - note the design discussion: file matching `*-design-discussion.md`
3. Read the structure outline fully to understand the phases
4. Begin with Phase 1 (or first unimplemented phase if resuming)
5. Follow the workflow below

**Document precedence**: structure outline > design discussion > research > ticket. When documents conflict, the outline takes precedence.

**Progress tracking**: The outline-implementer-agent updates the outline document as work completes:
- Validation checkboxes: `- [ ]` → `- [x]` when automated verification passes
- Phase titles: `## Phase N: Title` → `## ✅ Phase N: Title` when all phase validation is confirmed

## Workflow

For each phase in the structure outline:

### 1. Launch Implementer Agent

Use the **Agent tool** with `subagent_type="rpi:outline-implementer-agent"` to implement the current phase. Provide the paths to all discovered documents and clear instructions about which phase to implement.

Example prompt:
```
Implement Phase [N] from the structure outline at .humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-structure-outline.md

Companion documents (read these for context):
- Research: .humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-research.md
- Design discussion: .humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-design-discussion.md

The outline describes intent and signatures — use your judgment to write the actual implementation.
Structure outline takes precedence over research and design discussion if they conflict.
Focus only on Phase [N]. Stop after completing automated verification.
Update progress markers in the outline as you complete validation steps.
```

IMPORTANT — keep your prompt short. The implementer agent will read the documents itself. Do not duplicate the outline contents in your prompt.

### 2. Report to Human

After the implementer agent completes, summarize the phase:
```
## Phase [N] Complete

**What was done:**
- [Brief summary of changes]

**Manual verification needed:**
- [List manual checks from the outline's Validation section]

Ready for Phase [N+1] when you confirm, or let me know if anything needs adjustment.
```

### 3. Wait for Human Confirmation

Ask for the human to:
- Confirm manual checks passed
- Report any issues found
- Give permission to continue to the next phase

### 4. Commit the Changes

- Create a new commit for the changes
- Remember — the `.humanlayer/tasks/` directory should not be committed, it's a symlink to another repo

### 5. Repeat for Next Phase

When prompted, repeat this workflow for the next phase.

## Special Instructions

### Resuming Work

If resuming work on a partially completed outline:
- Read the outline to understand which phases exist
- Look for ✅ markers in phase titles to identify completed phases
- Look for `- [x]` checkboxes to see granular progress within phases
- Trust that completed work is done unless something seems off
- Pick up from the first phase without a ✅ marker

### Handling Issues

If the implementer agent reports a mismatch or gets stuck:
- Present the issue clearly to the human
- Wait for guidance before proceeding
- Consider whether the outline needs to be updated based on codebase evolution

### Multiple Phases

If instructed to implement multiple phases consecutively:
- Still launch separate implementer agents for each phase
- Perform verification between phases
- Report summary after all requested phases complete
- Only pause for human verification after the final phase

### Waiting for Input

Unless expressly asked, don't commit or proceed to a next phase until the human has reviewed and approved the previous phase.

Workflow checklist:

- [ ] get task directory path and discover documents (use `Bash(ls -La n...)`)
- [ ] read the structure outline to understand phases
- [ ] launch `rpi:outline-implementer-agent` via the **Agent tool** for Phase 1 (do NOT use Skill tool)
- [ ] report summary and ask the human to perform manual verification
- [ ] iterate with the human until the results are satisfactory
- [ ] commit the changes
- [ ] launch implementer subagent for next phase

## After Final Phase Completion

When ALL phases are complete and verified:

1. Commit the final changes
2. Read the final output template:

`Read({SKILLBASE}/references/implement_outline_final_answer.md)`

3. Respond following the template exactly. Do not include a summary or other information.
