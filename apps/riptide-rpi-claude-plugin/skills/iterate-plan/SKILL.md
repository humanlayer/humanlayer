---
name: iterate-plan
description: Only use when the user explicitly invokes this skill by name.
---

# Iterate Plan

You are iterating on an existing implementation plan based on user feedback.

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read the plan document and any other provided paths
   - `ls -La .humanlayer/tasks/TASKNAME` to find all related documents in the task directory. Do not use glob or grep, or use `ls -l` or `ls` without `-L` as the directory may be a symlink.
   - Read everything in the task directory to build full context, including the plan and prior artifacts (`ticket.md` or `task.md`, research, design discussion, PRD/TDD, and structure outline if present)

2. **If a ticket file is provided, read it for feedback**:
   - These comments contain instructions/feedback from the user

3. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Read the specific files/directories they mention
   - Verify code examples and file paths are accurate
   - Only proceed once you've verified the facts yourself


4. **Process the feedback**:
   - If user requested phase changes: Reorganize or modify phases as requested
   - If user requested code changes: Update the specific code examples
   - If user found errors: Fix inaccuracies in file paths, code, or descriptions
   - Keep the same YAML frontmatter and format

5. **Update document** (if changes needed):
   - Update the document at the same path
   - Ensure code examples are accurate and complete
   - Verify success criteria are actionable
   - Maintain the phase structure with automated/manual verification

6. **Check if worktree setup should be skipped**:

```
Read(.humanlayer/workspace.json)
Read(.humanlayer/workspace.local.json)
Bash(git rev-parse --git-dir)
```

7. **Read the appropriate final output template**:

<condition if="git-dir output contains '.git/worktrees/'">

`Read({SKILLBASE}/references/plan_final_answer_in_worktree.md)`

<else if="disabled is true (workspace.local.json takes precedence over workspace.json)">

Check out the task branch for the user, defaulting to the task slug at .humanlayer/tasks/TASKSLUG

`Bash(git checkout -b [BRANCHNAME])`
`Read({SKILLBASE}/references/plan_final_answer_disabled.md)`

<else>

`Read({SKILLBASE}/references/plan_final_answer.md)`

</condition>

8. Respond following the selected template exactly. Do not include a summary or other information. Include cloud permalinks if available.

## Plan Writing Guidelines

- Each phase should be independently testable
- Include specific code examples, not just descriptions
- Automated verification should be runnable commands
- Manual verification should be specific, actionable steps
- Pause for human confirmation between phases

## Document Precedence

When documents conflict, the most recent document wins:
**plan > structure outline > TDD > design discussion > research > ticket**

The plan is the final authority. Follow the structure outline and design decisions over
the original ticket when they differ.

<guidance>
## Cloud Permalinks

When you write or edit documents in .humanlayer/tasks/, a cloud permalink is automatically provided in the hook response.
- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations
- Use this permalink in your final output for easy navigation
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`

## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````

## Validation Design

Not every phase requires manual validation, don't put steps for manual validation just to have them.
</guidance>
