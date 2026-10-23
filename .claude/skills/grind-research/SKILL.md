---
name: grind-research
description: autonomous deep-dive pass on research document. Use when you want to grind on a research doc without user feedback - digs deeper, vets claims, adds detail.
---

# Grind Research

You are performing an autonomous deep-dive pass on an existing research document. Self-direct the review by identifying gaps and verifying claims.

## Steps

1. **Read the existing document FULLY**:
   - Understand what research was previously conducted - there may be more than one research file - they are ALL in scope unless a single doc is explicitly specified
   - Use Read tool WITHOUT limit/offset to read the entire document(s)
   - Don't read any other files in the rpi/ directory for the task, focus on the research document.
   - **DO NOT read ticket files** - research must stay objective about the current codebase.

2. **Gap analysis — identify thin sections**:
   - Review every section of the document
   - Identify areas where related components or interactions are mentioned but not explored
   - Note any "Open Questions" that could be answered with codebase research or web research
   - Build a list of investigation targets

3. **Spawn sub-agents to fill gaps**:
   - For each gap identified, spawn the appropriate sub-agent:

   - **codebase-locator**: Find WHERE files and components live
     - Use when a section mentions a component but doesn't provide file paths
     - Use to discover related files not yet documented
   - **codebase-analyzer**: Understand HOW specific code works (without critiquing it)
     - Use when a section describes behavior but lacks implementation detail
     - Use to trace data flow through components mentioned in the doc
   - **codebase-pattern-finder**: Find examples of existing patterns (without evaluating them)
     - Use when a section describes a pattern but lacks concrete code examples
   - **web-researcher**: Deep research the web 
     - Use to add color around library behavior, external systems, and behavior that cannot be discovered through codebase research

   **Agent usage tips:**
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings
   - Run multiple agents in parallel when searching for different things
   - Each agent knows its job — just tell it what you're looking for

4. **Claim verification — vet existing claims**:
   - Re-read the document after gap-filling
   - Identify specific factual claims about the codebase (file paths, line numbers, function names, behavior descriptions)
   - Spawn sub-agents to verify each claim is still accurate:

   - **codebase-pattern-finder**: Verify that described patterns and code examples still exist as documented
   - **codebase-analyzer**: Verify that described behavior and data flows are accurate

   - For any claim that is outdated or incorrect, note it for correction in the update step

5. **Update document**:
   - Update the document at the same `docPath`
   - Add new findings to relevant existing sections
   - Deepen shallow sections with file:line references and implementation details
   - Correct any outdated or inaccurate claims found during verification
   - Move answered items out of "Open Questions"
   - Add any new open questions discovered during the deep-dive
   - Keep the same YAML frontmatter and format

6. **Refine and Split**:
   - Check if any document is over 1000 lines
   - if so, split it into 2-3 documents, using your judgement to decide subject matter boundaries and what makes sense, don't ask the user

7. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_final_answer.md)`
   - Respond with a summary following the template, including GitHub permalinks.

## Research Guidelines

Your job is to DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY:
- DO NOT suggest improvements or changes unless explicitly asked
- DO NOT perform root cause analysis unless explicitly asked
- DO NOT propose future enhancements unless explicitly asked
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact

Document structure should include:
- Summary answering the research question
- Detailed findings by component/area with file:line references
- Code references with descriptions
- Architecture documentation (patterns, conventions, design)
- Open questions for areas needing further investigation

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
## Important notes:
- Use parallel Task agents to maximize efficiency and minimize context usage
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only documentation operations
- Document cross-component connections and how systems interact
- Link to GitHub when possible for permanent references
- Stay focused on synthesis, not deep file reading
- Have sub-agents document examples and usage patterns as they exist
- **REMEMBER**: Document and Ask about what IS and WHY, not what SHOULD BE
- **NO RECOMMENDATIONS OR IMPLEMENTATION SUGGESTIONS**: Only describe the current state of the codebase
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 5)
  - NEVER write the research document with placeholder values
- **Path handling**: Task-specific research goes in .humanlayer/tasks/
  - Use `.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-research.md` for task research
</guidance>


Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/research_final_answer.md`
