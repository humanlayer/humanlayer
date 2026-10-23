---
name: iterate-research
description: Only use when the user explicitly invokes this skill by name.
---

# Iterate Research

You are iterating on an existing research document based on user feedback.

## Initial Setup:

When this command is invoked, check the task artifact directory from your system prompt for documents like `*research*.md` (NOT `*research-questions*.md` - `research-questions` documents are EXCLUDED) with `ls -La` (the directory may be a symlink - do NOT use regular `ls` or grep/glob tools). If you find a research document, read it and proceed. 

If you see several research documents, ask the user which one to proceed with before reading any of them. 

If you do not know what the artifact task directory is from your system prompt, respond with:
```
I'm ready to iterate on researching the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```

**IMPORTANT**: You may NEVER read `ticket.md`/`task.md` files or other files from the artifact directory which do not match the `*research*.md` pattern above unless such a file is explicitly asked for by the user.

## Steps

1. **Read the existing document FULLY**:
   - Use Read tool WITHOUT limit/offset to read the entire document at `docPath`
   - Understand what research was previously conducted
   - Don't read any other files in the rpi/ directory for the task, focus on the research document and the provided feedback.
   - **DO NOT read ticket files** - research must stay objective about the current codebase.
   - **If a document path was not provided:**
         - List the contents of the task's artifact directory from your propmt. Run `ls -La .humanlayer/tasks/<task slug>` to find all related documents in the task directory. Do not use glob or grep, or use `ls -l` or `ls` without `-L` as the directory may be a symlink.


2. **Process the feedback**:
   - If user requested additional research: Spawn sub-agents to investigate
   - If user requested corrections: Update the document at the same path
   - Keep the same YAML frontmatter and format

3. **Conduct additional research** (if needed):
   - Spawn parallel sub-agent tasks for comprehensive research
   - Use only the specialized research agents listed below. Do not use other agent types, including `general-purpose`, `Explore`, or `Plan`.
   - Agent names differ by runtime. Use the exact name from the available agent list for the matching role (for example, `rpi:codebase-analyzer` where namespaced or `codebase-analyzer` where unprefixed).

   **For codebase research:**
   - **codebase-locator**: Find WHERE files and components live
     - Finds relevant source files, configs, and tests
     - Returns file paths organized by purpose
   - **codebase-analyzer**: Understand HOW specific code works (without critiquing it)
     - Traces data flow and key functions
     - Returns detailed explanations with file:line references
   - **codebase-pattern-finder**: Find examples of existing patterns (without evaluating them)
     - Identifies conventions and patterns
     - Returns code examples with locations

   **For web research (only if user explicitly asks):**
   - **web-search-researcher**: For external documentation and resources
     - If used, instruct agents to return LINKS with their findings
     - Include those links in the updated document

   **Agent usage tips:**
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings
   - Run multiple agents in parallel when searching for different things
   - Each agent knows its job - just tell it what you're looking for
   - Don't write detailed prompts about HOW to search - the agents already know
   - Keep the main agent focused on synthesis, not deep file reading

4. **Update document** (if changes needed):
   - Update the document at the same `docPath`
   - Add new findings to relevant sections

5. **Update the user**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_final_answer.md)`
   - Respond following the template exactly, include cloud permalinks if you have them.

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

## Document Style and Format

Keep the document reading as a **story about the codebase** — a technical explainer told with
diagrams, tables, code blocks, pseudocode, and takeaway headers in between. It is **not a list of
answers to the research questions**, and not a file index. When you fold new findings in, re-work
the affected sections so the document stays cohesive rather than appending a changelog of edits.

### Headers state the takeaway, not the topic or the question

A reader should be able to skim the headers alone and come away with how the system actually works.
Give every findings section and sub-point a header that asserts its *takeaway* — the way a good
slide title states its message ("Sessions persist to Postgres before the daemon acks the write"),
not a generic topic label ("Sessions") and **not the research question restated** ("How are
sessions persisted?"). When you add or revise a section, give it a takeaway header in the same
style; if you encounter an existing topic-label or question-style header while iterating, rewrite it
to assert its takeaway.

- BAD (topic label): `### Session storage`
- BAD (question as header): `### How does the daemon persist sessions?`
- GOOD (takeaway): `### Sessions persist to Postgres before the daemon acks the write`

Keep paragraphs short, and place each diagram, signature, table, or snippet immediately beside the
prose it illustrates — never let the text become a wall with all the visuals piled at the end.

### Visual structure — show the shape of the code, don't just describe it

Reach for a high-bandwidth visual whenever it conveys structure faster than prose would. Don't rely
solely on bullet lists — mix prose, tables, diagrams, and code. Every view describes the system
**as it exists today**, so keep them objective: do not use `diff` blocks or `+`/`-` change markers —
there is no proposed change to show, only current state.

Pick the views that make each part of the story clearest:

- **Tables** for comparisons, capability matrices, and structured data.
- **Mermaid diagrams** for object graphs, data flows, sequence/control flow, and architectural
  relationships between components.
- **Call-stack tree** for how control actually flows through a service, CLI, worker, or request
  handler today. Show the important calls, not every frame.
  ```text
  handleRequest
    authenticate(token)
    SessionService.load(sessionId)
      sessionStore.fetch(sessionId)
    SessionService.append(event)
      eventStore.write(event)
  ```
- **File tree** for how responsibility is split across files and directories. Format like `tree`
  output so depth is easy to scan; annotate what each file is responsible for.
  ```text
  src/session
  ├── session-service.ts   # loads/appends sessions, owns the write path
  ├── session-store.ts     # Postgres queries behind the service
  └── session-route.ts     # HTTP handler that calls the service
  ```
- **Component tree** for frontend areas — production components, their state/local data, and
  module/package boundaries (adapt to whatever UI framework the codebase uses).
  ```tsx
  <SessionPage> (apps/example/src/routes/session.tsx)
    useSessionData()
    <SessionToolbar>
      <SessionList> (packages/ui)
        useVirtualizer()
  ```
- **Type signatures, endpoint shapes, and data contracts** for the boundaries between components as
  they exist (use the codebase's language).
  ```text
  PUT /api/sessions/:id
    request:  { event: SessionEvent }
    response: { session: Session }
  ```
- **Pseudocode** for complex algorithms or logic — english-y, not a programming language — to show
  how something currently behaves without reproducing the whole function.
  ```text
  on(sessionEvent)
    load session from store
    if session.closed
      reject event
    else
      append event and persist
      return updated session
  ```

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
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Path handling**: Task-specific research goes in .humanlayer/tasks/
  - Use `.humanlayer/tasks/ENG-XXXX-description/NN-research-DESCRIPTION.md` for task research
</guidance>


Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/research_final_answer.md`

<important if="there are open questions in the research document">
You should include the following text after the section in the final answer template that says 'If you'd like, you can review the research document for completeness.':

```
There are N open questions that you should review, you can
- ask me to go find the answers for them
- provide the answers yourself
- tell me they are irrelevant and I'll remove them
```
</important>
