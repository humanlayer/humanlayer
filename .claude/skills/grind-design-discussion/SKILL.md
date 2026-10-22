---
name: grind-design-discussion
description: autonomous review pass on design discussion document. Use when you want to grind on a design doc without user feedback - surfaces questions, vets assumptions, verifies patterns.
---

# Grind Design Discussion

You are performing an autonomous review pass on an existing design discussion document. Self-direct the review by mining assumptions, verifying patterns, and surfacing new design questions.

## Steps

1. **Find and read the task directory**:
   - You should know the task directory, if not ask the user
   - Read ALL files in the task directory (design discussion, ticket, research, etc.)
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset to read entire files
   - **IMPORTANT**: DO NOT use Glob or Grep or Search tools on .humanlayer/tasks — it may be a symlink

2. **Assumption mining — surface implicit assumptions**:
   - Re-read the design discussion carefully
   - For each design decision and recommendation, identify implicit assumptions:
     - What codebase behavior is assumed but not verified by the research?
     - What edge cases or failure modes are not discussed?
     - What interactions between components are assumed but not explored?
     
   - Build a list of assumptions to investigate

3. **Pattern verification — verify patterns to follow**:

   - Note any patterns that are outdated, incomplete, or have edge cases not mentioned in the design doc
   - If you find multiple patterns to accomplish a task, remove it from "patterns to follow" and add a design question about which one to follow
   - If you find important information in the codebase, add it to the research document as well. Remember the research doc must only contain information about the current state.

4. **Question completeness review**:
   - Review existing design questions
   - For each question, check if the listed options are comprehensive — are there other viable approaches not considered?
   - Check if recommendations are well-supported by patterns found
   - Identify any new design questions that emerge from the assumption mining and pattern verification

5. **Update document**:
   - Update the design discussion document at its original path
   - Update current state / desired end state if new codebase findings warrant it
   - Update "Patterns to follow" with corrections, removal in favor of design question, or additional detail from verification
   - Add new design questions discovered during the review
   - Add new options to existing questions if the review revealed viable alternatives
   - **Do NOT add new features, new scope, or new requirements — only deepen understanding of what's already scoped**
   - **Do NOT answer any of the existing design questions**
   - **Do NOT change the content of resolved design questions**

6. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/design_discussion_final_answer.md)`
   - Respond with a summary following the template

<guidance>

## Subagents

To get better context about the codebase, you may find it useful to use 

- **codebase-pattern-finder** find patterns and how we do things in the codebase
- **codebase-analyzer** understand how code works

## Document Precedence

When documents conflict, the most recent document wins:
**design discussion > research > ticket**

The design discussion captures decisions made AFTER reading the ticket and research.
If the ticket says one thing but the design discussion resolved it differently, follow the design discussion.

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
