---
name: create-design-discussion
description: Only use when the user explicitly invokes this skill by name.
---

# Design Discussion Phase

You are now in the Design Discussion phase. Based on the research findings and the user's change request, work with them to make design decisions.

## Steps to follow after receiving the user's request

1. **Read the files in the task artifact directory and any mentioned files immediately and FULLY**:
   - `ls -La .humanlayer/tasks/TASKSLUG` to find all related documents in the task directory. Do NOT use the Grep or Glob tools, or `ls -l` as the directory may be a symlink.\
   - Ticket files (e.g., `.humanlayer/tasks/eng-1234-description/ticket.md` or `task.md`)
   - Research documents (e.g. `.humanlayer/tasks/eng-1234-description/NN-research-DESCRIPTION.md`)
   - **DO NOT read research questions documents** - research questions are inputs to the research phase only.
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files, never read files partially - if a file is mentioned, read it completely
   - do not spawn sub-tasks before reading these files yourself in the main context

2. **Check for related task content**:
   - if a path in `.humanlayer/tasks/TASKNAME` is mentioned, use Bash(`ls -La .humanlayer/tasks/TASKNAME`)
   - **IMPORTANT** DO NOT USE search or glob or grep, or `ls -l` (lowercase L), as .humanlayer/tasks may be a symlink and those tools don't traverse symlinks
   - read all relevant files in the task directory to fully understand the work so far, excluding research questions documents

3. **Optional - Spawn parallel sub-tasks for comprehensive research**:
   - If not clear from the research, spawn sub-tasks to research different aspects concurrently
   - Create multiple Agent() calls to research different aspects concurrently
   - Use the right agent for each type of research:

   **For deeper investigation:**
   - **codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder** - To find similar implementation patterns we can model after

   Each agent knows how to:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

<important if="the user asks you to find how things work or add detail about existing functionality">
  prefer to use an initial pass with one or more Agent() calls before reading files yourself
  <else if="the user gives straightforward feedback that doesn't require loading more codebase context">
      skip Agent() calls if you already have the context
  </else>
</important>

4. **Read the design discussion template and visual guidance**

`Read({SKILLBASE}/references/design_discussion_template.md)`

`Read({SKILLBASE}/references/show-me.md)`

- Follow the `show-me` guidance throughout the design discussion.
- Use the smallest set of visual views needed to make the current state, proposed end state, and key design choices clear.
- Place each visual next to the short text it supports. Do not add visuals that do not help the user make a design decision.

5. **Write the design discussion** to `.humanlayer/tasks/ENG-XXXX-description/NN-design-discussion-DESCRIPTION.md`
   - First, check the task directory in your system prompt. If you don't see it, find the task directory: `ls -La .humanlayer/tasks | grep -i "eng-XXXX"`
   - If the directory doesn't exist, create: `.humanlayer/tasks/ENG-XXXX-description/`
   - Format: `NN-design-discussion-DESCRIPTION.md` where NN is a zero-padded chronological index and DESCRIPTION is a 2-4 word kebab-case slug
   - **Chronological indexing**: `ls` the task directory, find the highest existing NN- prefix, and use the next number. First document = `01-`, second = `02-`, etc.
   - Directory naming:
     - With ticket: `.humanlayer/tasks/ENG-1478-parent-child-tracking/03-design-discussion-parent-child-tracking.md`
     - Without ticket: `.humanlayer/tasks/improve-error-handling/03-design-discussion-error-handling.md`

<content_guidance>
**Outline High-level product spec** - Current state, desired end state, what we're not doing in terms of user experience or functionality

**Outline the proposed end state architecture** - Use focused before-and-after diagrams, trees, pseudocode, or other views from the `show-me` guidance. Prefer `diff` blocks when the key point is what changes, and show the full target shape when it makes ownership or order clearer.

**Discuss design decisions**
   - For each major design choice, present options with pros/cons
   - Make recommendations based on codebase conventions
   - If the research surfaced testing patterns for the components being changed, include a brief testing approach (e.g. "follow the existing unit test pattern in `__tests__/foo.test.ts`")

**IMPORTANT: All design questions must be written in the OPEN state**
   - Put ALL questions under "Design Questions", NOT under "Resolved Design Questions"
   - You may recommend an option, but you must NOT resolve or close a question yourself
   - Only the user can resolve a design question — through explicit feedback or approval
   - The "Resolved Design Questions" section should be empty in the initial document
   - Do NOT auto-resolve questions even if the answer seems obvious from the research

**Resolving questions after user feedback**
   - When the user provides a clear answer (e.g. "for X we should do Y"), move the question to "Resolved Design Questions"
   - They don't need to say "resolve" explicitly — any clear indication of a decision counts
   - Record the final decision with rationale
   - Record the options that were considered but not chosen, with brief rationale for why they were discarded

**Present patterns to follow** 
   - Identify existing patterns in the codebase that should be followed
   - Include file locations and multiline code snippets showing the pattern

</content_guidance>

6. **Read the final output template**

`Read({SKILLBASE}/references/design_discussion_final_answer.md)`

If hook context says all design questions have been resolved, read the resolved template instead:

`Read({SKILLBASE}/references/design_discussion_final_answer_resolved.md)`

7. Respond following the selected template exactly. Do not include a summary or other information. Include cloud permalinks if available.

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

## Document Precedence

When documents conflict, the most recent document wins:
**design discussion > research > ticket**

Decisions made during the design discussion supersede the original ticket description.
The ticket provides the initial request; the design discussion refines and finalizes the approach.
</guidance>
