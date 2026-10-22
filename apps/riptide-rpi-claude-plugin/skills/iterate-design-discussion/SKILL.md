---
name: iterate-design-discussion
description: Only use when the user explicitly invokes this skill by name.
---

# Iterate Design Discussion

You are iterating on an existing design discussion document based on user feedback.

## Initial Check

If the user calls this with no instructions or feedback, ask them for their feedback:

```
I'm ready to iterate on the design discussion. What feedback or changes would you like me to incorporate?
```

Then wait for the user's feedback before proceeding.

## Steps

1. **Find and read the task directory**:
   - You should know the task directory, if not ask the user
   - `ls -La .humanlayer/tasks/TASKNAME` to find all related documents in the task directory. Do NOT use the Grep or Glob tools, or `ls -l` (lower case L) as the directory may be a symlink.
   - Read ALL files in the task directory, including the current design discussion document and prior artifacts (`ticket.md` or `task.md`, research, etc.)
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files, never read files partially
   - **IMPORTANT**: DO NOT use Glob or Grep on .humanlayer/tasks — it may be a symlink

2. **If the user gives any input**:
   - DO NOT just accept the correction blindly
   - Read the specific files/directories they mention
   - If you don't have enough info, spawn Agent() calls to verify the correct information
   - Only proceed once you've verified the facts yourself

3. **Optional - Spawn parallel Agent() calls for research**:
   - If not clear from existing context, spawn Agent() calls to research different aspects concurrently
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

<important if="the user asks you to find how things work or add detail about existing functionality">
  prefer to use an initial pass with one or more Agent() calls before reading files yourself
  <else if="the user gives straightforward feedback that doesn't require loading more codebase context">
      skip Agent() calls if you already have the context
  </else>
</important>

4. **Update document** (if changes needed):
   - Update the design discussion document at its original path
   - Update current state / desired end state / proposed architecture if appropriate
   - Move answered questions to "Resolved Design Questions" section
   - Update patterns with new code examples if discovered
   - Add any new design questions that emerged

<content_guidance>
**Outline High-level product spec** - Current state, desired end state, what we're not doing in terms of user experience or functionality

**Outline the proposed end state architecture** - Before and after diagrams, concise outline, description, psuedocode, etc

**Discuss design decisions**
   - For each major design choice, present options with pros/cons
   - Make recommendations based on codebase conventions
   - Record final decisions with rationale

**Present patterns to follow** 
   - Identify existing patterns in the codebase that should be followed
   - Include file locations and multiline code snippets showing the pattern

</content_guidance>

5. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/design_discussion_final_answer.md)`
   - If hook context says all design questions have been resolved, read the resolved template instead:
   `Read({SKILLBASE}/references/design_discussion_final_answer_resolved.md)`
   - Respond following the selected template exactly. Do not include a summary or other information. Include cloud permalinks if available.

## Document Precedence

When documents conflict, the most recent document wins:
**design discussion > research > ticket**

The design discussion captures decisions made AFTER reading the ticket and research.
If the ticket says one thing but the design discussion resolved it differently, follow the design discussion.

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
</guidance>
