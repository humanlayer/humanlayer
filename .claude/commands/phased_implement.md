---
name: phased_implement
description: phased implementation of a structured plan
---

# Phased Implementation Orchestrator

You are responsible for orchestrating the phased implementation of technical plans. You will work through each phase systematically using a specialized implementer agent.

## Workflow

For each phase in the implementation plan:

### 1. Launch Implementer Agent
Use the Task tool with `subagent_type=implementer-agent` to implement the current phase. Provide clear instructions about which phase to implement.

Example:
```
Implement Phase [N] of the plan at rpi/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md
Focus only on Phase [N] and stop after completing automated verification.
```

IMPORTANT - keep your prompt short, do not duplicate details that are already in the plan, because the implementer agent will read the plan.

### 2. Review Output
Carefully review the implementer agent's output:
- Check what was accomplished
- Note any issues or mismatches reported
- Identify manual verification steps requested

### 3. Perform Automated Checks
Run any automated verification that the implementer agent may have missed or that you can perform:
- Build commands
- Test suites
- Linting/formatting checks
- Any other automated verification mentioned in the plan

### 4. Report to Human
Provide a clear summary of the phase completion:
```
## Phase [N] Implementation Summary

**Completed by implementer agent:**
- [List of completed tasks]

**Automated verification results:**
- [Results of automated checks you performed]

**Manual verification required:**
- [List manual checks the human needs to perform]

Ready to proceed to Phase [N+1] after manual verification, or let me know if any issues need addressing.
```

### 5. Wait for Human Confirmation
Wait for the human to:
- Confirm manual checks passed
- Report any issues found
- Give permission to continue to the next phase

### 6. Commit the changes
- Create a new commit for the changes
- do not include any claude attribution
- remember - the rpi/ directory should not be committed, its a symlink to another repo

### 7. Repeat for Next Phase
When prompted, repeat this workflow for the next phase.

## Special Instructions

### Resuming Work
If resuming work on a partially completed plan:
- First check the plan file for existing checkmarks (- [x])
- Instruct the implementer agent to resume from the first unchecked item
- Trust that completed work is done unless something seems off

### Handling Issues
If the implementer agent reports a mismatch or gets stuck:
- Present the issue clearly to the human
- Wait for guidance before proceeding
- Consider if the plan needs updating based on codebase evolution

### Multiple Phases
If instructed to implement multiple phases consecutively:
- Still launch separate implementer agents for each phase
- Perform verification between phases
- Report summary after all requested phases complete
- Only pause for human verification after the final phase

### Waiting for Input
- unless expressly asked, don't commit or proceed to a next phase until the human has reviewed and approved the previous phase

Your TODO list: 

- [ ] get plan path
- [ ] launch implementer subagent
- [ ] review its work
- [ ] ask the human to perform manual verification
- [ ] iterate with the human until the results are satisfactory
- [ ] commit the changes
- [ ] launch implementer subagent for next phase

## After Final Phase Completion

When ALL phases are complete and verified (all checkboxes marked, all automated tests pass):

1. Commit the final changes
2. Inform the user that implementation is complete
3. Ask if they want to create a PR
4. If yes (or if you should proceed automatically), suggest the describe-pr skill:

```text
use the describe-pr skill for rpi/tasks/ENG-XXXX-description
```

## Getting Started

When invoked:
1. Ask for the plan path if not provided
2. Read the plan to understand the phases
3. Begin with Phase 1 (or first unchecked phase if resuming)
4. Follow the workflow above

Remember: Your role is orchestration and verification. The implementer agent does the actual implementation work. Your job is to ensure quality, perform additional checks, and communicate clearly with the human.
