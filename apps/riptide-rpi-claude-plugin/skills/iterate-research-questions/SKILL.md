---
name: iterate-research-questions
description: Only use when the user explicitly invokes this skill by name.
---

# Iterate Research Questions

You are iterating on an existing research questions document based on user feedback.

## Input

- `docPath`: Path to the existing research questions document (e.g., `.humanlayer/tasks/ENG-XXXX-description/NN-research-questions-DESCRIPTION.md`)
- Optionally, a ticket file path containing comments with feedback
- If only a directory is provided, check the task's artifact directory for a research questions document: `ls -La .humanlayer/tasks/<task slug>` from your prompt. Do NOT use grep or glob or run ls without `-L` or with `-l`, as the directory may be a symlink.

## Steps

1. **Read the existing document FULLY**:
   - Use Read tool WITHOUT limit/offset to read the entire document at `docPath`
   - Understand what questions were previously created

2. **If a ticket file is provided, read it for feedback**:
   - These comments contain instructions/feedback from the user

3. **Process the feedback**:
   - Update the document at the same path based on feedback
   - Keep the same YAML frontmatter and format

4. **Write updated document** (if changes needed):
   - Update the document at the same `docPath`
   - Address each piece of feedback from the user

5. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_questions_final_answer.md)`
   - Respond following the template. DO NOT add a summary or other information.

## Research Question Guidelines

Questions should focus ONLY on the current state of the codebase:
- Do NOT include questions about what should be built
- Do NOT suggest improvements unless asked
- Do NOT ask about what changes need to happen
- Only ask questions that document what exists, where it exists, and how components are organized

Good research questions explore:
- Current implementation details
- Relevant patterns or constraints
- Potential complexities or edge cases
- Architecture, dependencies, and implementation details

Format questions as high-level codebase exploration:
- "Explain how [FEATURE] works end to end and all the systems involved"
- "Explore the contract between [COMPONENT1] and [COMPONENT2] and how it's implemented on both sides"
- "Trace the flow of logic from [ENDPOINT] down to [DATASTORE]"
- "Find all users of [DATABASE COLUMN or DATABASE TABLE] and what the data is used for"

Use 3-8 questions per task (use your judgement based on complexity).

Preserve any **Key Context Pointers** section (links, repositories, libraries, dependencies, filepaths the user or ticket called out). Keep those pointers verbatim, and add newly surfaced ones from the feedback when relevant.

CRITICAL - DO NOT LEAK ANY IMPLEMENTATION DETAILS OR THE NATURE OF YOUR TASK INTO THE QUESTION LIST. NO "HOW WOULD WE XYZ" - ONLY "HOW DOES IT WORK"

<guidance>
If the ticket might involve frontend work or new/updated visual components, ensure research questions cover the project's design system. 

Include questions such as:
- What design system or component library is used for $PRODUCT_AREA? 
- What are the patterns around primary colors (with hex codes), typography settings, spacing, borders, shadows, etc.?
- What theming system exists, if any?

Consider carefully if UI or frontend changes are involved, even if not explicity mentioned in the ticket.

This is the one question category that does not need to be tailored to the specific UI work described in the ticket - if we're making frontend changes, we need to understand the design system and patterns for one-off html mockups.
</guidance>

<guidance>
## Cloud Permalinks

When you write or edit documents in .humanlayer/tasks/, a cloud permalink is automatically provided in the hook response.
- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations
- Use this permalink in your final output for easy navigation
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`
</guidance>
