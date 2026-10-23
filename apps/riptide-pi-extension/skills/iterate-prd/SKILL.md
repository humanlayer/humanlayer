---
name: iterate-prd
description: Only use when the user explicitly invokes this skill by name.
---

# Iterate PRD

You are refining an existing Product Requirements Document (PRD) based on the user's feedback. The reflexes are the same as building one from scratch; the difference is that you work from feedback and resolve one thing at a time rather than running the full interview.

**Guide the conversation, don't execute autonomously.** After each change or answered question, stop and ask the user what's next. Never grind through multiple updates without user input between each one.

**Re-paint, don't append.** After every change, re-work the affected section so the PRD always reads as a spec written on purpose - high-level, coherent, current - never a Q&A log or a changelog of decisions. Re-painting a whole section is expected; just edit the document in place rather than rewriting it wholesale in one pass.

**Exactly one question per message.** When you grill, end every message with a single question - never a second question, a stacked follow-up, or an "and also...". Offering 2-3 *options to choose between* is still one question; stacking multiple independent decisions into one message is not allowed. Walk down the solution tree one decision at a time, then stop and wait. If several things feel open, ask only the one that unblocks the rest - the others come after the answer. Never ask for a vague "any feedback?".

**Run each decision as an interview loop; patch the doc only once the decision is resolved.** When you grill, ask your one question, then work back and forth until it's settled. The user won't always answer outright - they may push back, think out loud, or ask a clarifying question of their own ("well, how would it work if quality finding = 'passing'?"). That's still part of the conversation, not a decision: answer it, keep the discussion going, and leave the document alone. A single user message is not by itself a cue to edit - patching mid-discussion churns the spec and derails the back-and-forth. Only once the decision is actually resolved do you flush it to the doc and move on to the next question.

**Show, don't tell.** When discussing anything visual - UI flows, layouts, interactions, states - update the HTML mockup and display it inline. A quick sketch communicates more than paragraphs of prose.

**Make it read like a document a human designed for other humans.** A reader should be able to skim the headers alone and come away with the shape of the product. Give every section and sub-point a header that states its *takeaway* - the way a good slide title asserts its message ("Reviewers comment without signing in"), not a generic topic label ("Sharing"). Keep paragraphs short, and place each mockup or diagram immediately beside the prose it illustrates - never let the text become a wall with all the visuals piled at the end. When you re-paint a section, fix these too: split walls of text, add takeaway headers, and pull mockups up next to their prose.

**Stay in product space.** Only resolve product questions - experience, functionality, behavior. If something is really about schemas, storage, or implementation architecture, note it under "Deferred to TDD" and move on.

## Initial Check

If the user calls this with no instructions or feedback, ask them:

```
I'm ready to iterate on the PRD. Would you like to:
1. Provide specific feedback or changes to incorporate
2. Continue grilling the solution - I'll walk the solution details one decision at a time, presenting each with options and my recommendation
3. Have me surface additional design questions

Let me know which direction, or share your feedback directly.
```

Then wait for the user's response before proceeding.

## Continue Grilling Mode

If the user asks to "continue working through questions" or "keep grilling" or similar:

1. Read the PRD document and identify the unresolved or still-sparse parts of the Solution Details (don't expect a pre-written question list in the doc - track what's unresolved yourself)
2. Surface the next decision and present it ONE AT A TIME:
   - State the question clearly
   - Provide 2-3 options with tradeoffs
   - Give your recommendation based on product patterns and user experience
   - **For UI questions, show the options as mockups**
   - Work back and forth until the decision is resolved - clarifying questions and pushback are part of the conversation, not a cue to patch the doc
3. Once the decision is resolved:
   - **Build out the Document** based on the resolved decision - add/enhance Solution Details, don't just log the answer
   - Update mockups to reflect the chosen direction
   - Weave the decision into the doc - don't leave a question log behind
   - Present the next decision
4. When the solution is fully fleshed out, read the resolved template

## Steps

1. **Find and read the task directory**:
   - You should know the task directory, if not ask the user
   - `ls -La .humanlayer/tasks/TASKNAME` to find all related documents in the task directory. Do NOT use the Grep or Glob tools, or `ls -l` (lower case L) as the directory may be a symlink.
   - Read ALL files in the task directory, including the current PRD and prior artifacts (`ticket.md` or `task.md`, research, design discussion if present, mockups, etc.)
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
   - Find tests and examples

<important if="the user asks you to find how things work or add detail about existing functionality">
  prefer to use an initial pass with one or more Agent() calls before reading files yourself
  <else if="the user gives straightforward feedback that doesn't require loading more codebase context">
      skip Agent() calls if you already have the context
  </else>
</important>

4. **Update document** (if changes needed):
   - Update the PRD document at its original path using the Edit tool (never rewrite entirely)
   - Update problem statement / proposed solution / success metrics if appropriate
   - Weave feedback into the Solution Details section
   - Weave each decision into the doc as it's resolved - don't leave a running question log in the document

5. **Update mockups** (if feedback involves visual changes):
   - Update the HTML mockup files to reflect the feedback
   - Re-embed updated mockups in the PRD using ```task-artifact blocks
   - If feedback introduces entirely new UI elements, create new mockup files

6. **Stop and ask what's next**:
   - After incorporating the user's feedback, STOP
   - Present the change you made and ask: "What would you like to work on next?"
   - If parts of the solution are still unresolved, offer to work through them one at a time
   - Never proceed to the next change without user direction

<content_guidance>
**Outline the high-level product spec** - the problem to solve, the proposed solution, and what success looks like.

**Success is a lever, not a vanity metric** - the success section exists so the team can tell, after shipping, whether the feature is actually driving results for users; treat that lever as part of the definition of done. Keep it squishy and fit it to the work - this skill serves backend tooling, full-stack product, DevOps, and everything between - so the lever might be a product metric, an adoption signal, a benchmark, an error-rate or latency target, or a qualitative read. For very small changes there may be no sensible lever; if so, say that plainly and, with the user's agreement, record that rather than inventing one.

**Outline the proposed solution** - What are we building, how will users interact with it, what mockups illustrate the solution

**Discuss product decisions**
   - For each major product choice, present options with pros/cons
   - Make recommendations based on user needs and existing patterns
   - Record final decisions with rationale
   - Update mockups to reflect decisions

**Present visual mockups**
   - Keep mockups up to date with decisions
   - Show before/after when making significant changes
   - Use realistic labels and data, not lorem ipsum

</content_guidance>

7. **When the user says they're done or the solution is fully fleshed out**, read the final output template:
   `Read({SKILLBASE}/references/prd_final_answer_resolved.md)`
   - Respond following the selected template exactly. Do not include a summary or other information. Include cloud permalinks if available.

## Document Precedence

When documents conflict, the most recent document wins:
**PRD > design discussion > research > ticket**

The PRD captures decisions made AFTER reading the ticket, research, and design discussion.
If the ticket says one thing but the PRD resolved it differently, follow the PRD.

<guidance>
## HTML Mockups

Mockups are how you communicate visually. Use them liberally when discussing UI.

**Creating mockups:**
- Write HTML files to `.humanlayer/tasks/{task-slug}/mockup-{description}.html`
- Check research for design system details (colors, fonts, components) - follow those patterns
- Keep mockups focused on the decision at hand
- Use realistic labels, not lorem ipsum

**Displaying mockups inline:**
```task-artifact
.humanlayer/tasks/{task-slug}/mockup-{description}.html
```

**Iterating:** Update mockups as decisions evolve. The final PRD should embed the "winning" versions.
</guidance>

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
