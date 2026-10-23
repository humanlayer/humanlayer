---
name: create-research
description: Only use when the user explicitly invokes this skill by name.
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by spawning parallel sub-agents and synthesizing their findings.

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY
- DO NOT suggest improvements or changes unless the user explicitly asks for them
- DO NOT perform root cause analysis unless the user explicitly asks for them
- DO NOT propose future enhancements unless the user explicitly asks for them
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact
- You are creating a technical map/documentation of the existing system

## Initial Setup:

When this command is invoked, check the task artifact directory from your system prompt for documents like `*research-questions*.md` with `ls -La` (the directory may be a symlink - do NOT use regular `ls` or grep/glob tools). If you find one, read it and proceed with the contents as the research query. 

If you see several, ask the user which one to proceed with before reading any of them. 

If you do not know what the task artifact directory is from your system prompt, respond with:
```
I'm ready to research the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```

**IMPORTANT**: You may NEVER read `ticket.md`/`task.md` files or other files from the artifact directory which do not match the `research-questions` pattern above unless such a file is explicitly asked for by the user.

Then wait for the user's research query.

## Steps to follow after receiving the research query:

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (docs, JSON, research questions), read them FULLY first
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
   - **DO NOT read ticket files** - research must stay objective about the current codebase, not be influenced by what a ticket wants to build. The research questions already capture what needs to be investigated.
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Take time to ultrathink about the underlying patterns, connections, and architectural implications the user might be seeking
   - Identify specific components, patterns, or concepts to investigate
   - Create a research plan that tracks all subtasks
   - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel sub-agent tasks for comprehensive research:**
   - Create multiple Task agents to research different aspects concurrently
   - Use only the specialized research agents listed below. Do not use other agent types, including `general-purpose`, `Explore`, or `Plan`.
   - Agent names differ by runtime. Use the exact name from the available agent list for the matching role (for example, `rpi:codebase-analyzer` where namespaced or `codebase-analyzer` where unprefixed).

   **For codebase research:**
   - Use the **codebase-locator** agent to find WHERE files and components live
   - Use the **codebase-analyzer** agent to understand HOW specific code works 
   - Use the **codebase-pattern-finder** agent to find examples of existing patterns 

   **For web research and researching libraries & dependencies (if applicable):**
   - Use the **web-search-researcher** agent for external documentation and resources
   - You _may_ see a humanlayer library researcher tool. If you do, you should use this to answer any research questions about dependencies and libraries that are in scope for the research. If the tool is not present, do not mention it.
   - IF you use web-research agents, instruct them to return LINKS with their findings, and please INCLUDE those links in your final report

   The key is to use these agents intelligently:
   - **Combine related questions**: Don't necessarily launch one subagent per research question. Group related questions that touch the same area of the codebase into a single subagent prompt. For example, if 3 questions are about how the daemon handles sessions, combine them into one codebase-analyzer call.
   - Aim for 2-6 well-scoped subagents rather than 1:1 question-to-agent mapping - this is not a hard rule, just guidance
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings to document how they work
   - Run multiple agents in parallel when they're searching for **different areas** of the codebase
   - Each agent knows its job - just tell it what you're looking for
   - Don't write detailed prompts about HOW to search - the agents already know

4. **Wait for all sub-agents to complete and synthesize findings:**
   - IMPORTANT: Wait for ALL sub-agent tasks to complete before proceeding
   - Compile all sub-agent results
   - Prioritize live codebase findings as primary source of truth
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Verify all rpi/ paths are correct (task-specific files go in .humanlayer/tasks/)
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Gather metadata for the research document:**
   - Filename: `.humanlayer/tasks/TASKNAME/NN-research-DESCRIPTION.md`
     - First, check the task directory in your system prompt. If you do not see it, find the task directory: `ls -La .humanlayer/tasks | grep -i "eng-XXXX"`
     - If the directory doesn't exist, create: `.humanlayer/tasks/ENG-XXXX-description/`
     - Format: `NN-research-DESCRIPTION.md` where NN is a zero-padded chronological index and DESCRIPTION is a 2-4 word kebab-case slug
     - **Chronological indexing**: `ls -La` the task directory, find the highest existing NN- prefix, and use the next number. First document = `01-`, second = `02-`, etc.
     - Directory naming:
       - With ticket: `.humanlayer/tasks/ENG-1478-parent-child-tracking/02-research-parent-child-tracking.md`
       - Without ticket: `.humanlayer/tasks/authentication-flow/02-research-auth-flow.md`

6. **Generate research document:**
   - Use the metadata gathered in step 4
   - Read the research template:

   `Read({SKILLBASE}/references/research_template.md)`

   - Write the document to `.humanlayer/tasks/TASKNAME/NN-research-DESCRIPTION.md`

7. **Attempt to answer open questions**
   - if there are open questions in the doc you write, dispatch subagents to additional targeted research AFTER you write the doc
   - update the doc with your findings, removing and open questions that now have answers - don't append to the end, 
   - do at most one additional pass to find more information, if your second group of subagents can't find all the answers, leave the remaining questions as open and proceed to the final answer 

8. **Note cloud permalinks:**
   Cloud permalinks are automatically provided when you write artifacts. Include them in your final output.

   For code references in the humanlayer repo (if on main or pushed):
   - Get repo info: `gh repo view --json owner,name`
   - Create permalinks: `https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`

9. **Respond to the user according to the template**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_final_answer.md)`
   - Respond following the template exactly, include cloud permalinks if you have them.

10. **Handle follow-up questions:**
   - If the user has follow-up questions for you to investigate
   - Spawn new sub-agents as needed for additional investigation
   - Update the existing document in place with your new findings, likely you will update existing sections rather than adding net-new ones to the end

## Document Style and Format

The research document should read as a **story about the codebase** — a technical explainer someone
wrote on purpose, told with diagrams, tables, code blocks, pseudocode, and takeaway headers in
between. It is **not a list of answers to the research questions**, and not a file index. A reader
should be able to understand how the system works from the document alone — file citations support
the narrative, they don't replace it. Human readability is critical, but never at the expense of
technical depth and thoroughness.

### Headers state the takeaway, not the topic or the question

Make it read like a document a human wrote for other humans: a reader should be able to skim the
headers alone and come away with how the system actually works. Give every section and sub-point a
header that asserts its *takeaway* — the way a good slide title states its message ("Sessions
persist to Postgres before the daemon acks the write"), not a generic topic label ("Sessions") and
**not the research question restated** ("How are sessions persisted?"). Lead with the point, then
support it with prose, citations, and visuals.

- BAD (topic label): `### Session storage`
- BAD (question as header): `### How does the daemon persist sessions?`
- GOOD (takeaway): `### Sessions persist to Postgres before the daemon acks the write`

Keep paragraphs short, and place each diagram, signature, table, or snippet immediately beside the
prose it illustrates — never let the text become a wall with all the visuals piled at the end.

### Writing and citation style
- Write each findings section as a **cohesive explanation** of how something works, with file/line
  citations woven in parenthetically
- **Concept-first, not location-first**: describe what something does, then cite where it lives —
  not the other way around
- Bullets are fine for listing fields, flags, or options, but each bullet should describe a concept,
  not just point at a file
- When multiple facts come from adjacent lines in the same file, use a **range** (e.g.
  `file.ts:45-67`) rather than citing each line individually
- Be thorough — include enough citations that a developer can trace every claim back to code
- BAD: `- \`src/app.ts:57\` creates WorkosService` / `- \`src/app.ts:58\` creates S3Service` / `- \`src/app.ts:59\` creates JiraService`
- GOOD: "Services are module-level singletons created at startup in `src/app.ts:57-80`: WorkosService, S3Service, JiraService, LinearService, StripeService, and two Drizzle database handles."

### Visual structure — show the shape of the code, don't just describe it

Reach for a high-bandwidth visual whenever it conveys structure faster than prose would. Don't rely
solely on bullet lists — mix prose, tables, diagrams, and code. Technical depth and thoroughness
must not be sacrificed for readability — do both. 

Pick the views that make each part of the story clearest:

- **Tables** for comparisons, capability matrices, config matrices, and other structured data.

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
  module/package boundaries (the example below is React/TSX; adapt to whatever UI framework the
  codebase uses).
  ```tsx
  <SessionPage> (apps/example/src/routes/session.tsx)
    useSessionData()
    <SessionToolbar>
      <SessionList> (packages/ui)
        useVirtualizer()
  ```

- **Type signatures, endpoint shapes, and data contracts** for the boundaries between components as
  they exist — function signatures, routes, message shapes, or the schema behind a store (use the
  codebase's language).
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

### Code References section
- Should be **very comprehensive** — a developer should be able to navigate the entire researched
  area from this list
- It is okay to reference **directories** in addition to individual files
- **Indicate coverage**: note when the list is exhaustive for a given area vs. when it covers
  key files but others in the directory may also be relevant
- Group related files together

### Testing patterns
- Document under each findings section how that component is currently tested
- Include **test file locations**, testing approach (unit/integration/e2e), mocking patterns,
  test fixtures and utilities used
- If there are no tests, say so explicitly — that's a finding

<guidance>
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
- **Testing patterns**: For each component area you research, document how it's currently tested (unit, integration, e2e). Include test file locations and patterns. The research template has a "Testing patterns" section under each component - always fill it in.
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Path handling**: Task-specific research goes in .humanlayer/tasks/
  - Use `.humanlayer/tasks/ENG-XXXX-description/NN-research-DESCRIPTION.md` for task research

## Response

Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/research_final_answer.md`

<important if="there are open questions in the research document">

If there are open questions after writing the document (and optionally, after your second pass to find answers):

You should include the following text after the section in the final answer template that says 'If you'd like, you can review the research document for completeness.':

```
There are N open questions that you should review, you can
- ask me to go find the answers for them
- provide the answers yourself
- tell me they are irrelevant and I'll remove them
```
</important>

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
