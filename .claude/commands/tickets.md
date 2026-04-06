---
description: Manage local tickets - create, update, search, and follow workflow patterns
---

# Tickets - Local Ticket Management

You are tasked with managing local tickets in `thoughts/tickets/`, including creating tickets from thoughts documents, updating existing tickets, searching for tickets, and following the team workflow.

## Initial Response

Respond based on the user's request:

### For general requests:
```
I can help you with tickets. What would you like to do?
1. Create a new ticket from a thoughts document
2. Add a note or update to an existing ticket
3. Search for tickets
4. Update ticket status
```

### For specific create requests:
```
I'll help you create a ticket from your thoughts document. Please provide:
1. The path to the thoughts document (or topic to search for)
2. Any specific focus or angle for the ticket (optional)
```

Then wait for the user's input.

## Ticket Workflow & Status Progression

Tickets follow a workflow to ensure alignment before code implementation:

1. **backlog** → All new tickets start here
2. **spec needed** → More detail needed — problem to solve and solution outline required
3. **research needed** → Ticket requires investigation before a plan can be written
4. **research in progress** → Active research/investigation underway
5. **ready for plan** → Research complete, ticket needs an implementation plan
6. **plan in progress** → Actively writing the implementation plan
7. **plan in review** → Plan written and under discussion
8. **in progress** → Active development
9. **in review** → PR submitted
10. **done** → Completed

**Key principle**: Review and alignment happen at the plan stage (not PR stage) to move faster and avoid rework.

## Ticket File Format

All tickets are stored as markdown files in `thoughts/tickets/` using the template at `thoughts/tickets/_template.md`.

Read that file before creating any ticket to ensure the correct structure is used.

**File naming**: `TICKET-XXX-kebab-case-title.md` where XXX is the next sequential number.

## Action-Specific Instructions

### 1. Creating Tickets from Thoughts

#### Steps to follow:

1. **Locate and read the thoughts document:**
   - If given a path, read the document directly
   - If given a topic/keyword, search `thoughts/` using Grep to find relevant documents
   - If multiple matches found, show list and ask user to select

2. **Analyze the document content:**
   - Identify the core problem or feature being discussed
   - Extract key implementation details or technical decisions
   - Note any specific code files or areas mentioned
   - Identify what stage the idea is at (early ideation vs ready to implement)

3. **Find the next ticket number:**
   - List files in `thoughts/tickets/` with Glob
   - Find the highest existing TICKET-XXX number and increment by 1

4. **Draft the ticket summary:**
   Present a draft to the user:
   ```
   ## Draft Ticket

   **File**: `thoughts/tickets/TICKET-XXX-kebab-title.md`
   **Title**: [Clear, action-oriented title]
   **Priority**: [Low / Medium / High]
   **Size**: [XS / S / M / L]
   **State**: backlog

   ## Problem to solve
   [2-3 sentence summary of the problem/goal]

   ## Proposed solution
   [High-level approach]

   ## References
   - Source: `thoughts/[path/to/document.md]`
   ```

5. **Interactive refinement:**
   Ask the user:
   - Does this summary capture the ticket accurately?
   - What priority? (default: Medium)
   - What size estimate? (default: M)
   - Any additional context to add?
   - Should we add a reference to this ticket in the source document?

6. **Write the ticket file** using the template above.

7. **Post-creation actions:**
   - Show the created file path
   - Ask if user wants to update the original thoughts document with a ticket reference

### 2. Adding Notes to Existing Tickets

When the user wants to update a ticket with new information:

1. **Find the ticket:**
   - Use the `ticket-searcher` agent or Glob `thoughts/tickets/` to find the file
   - Read the file completely

2. **Add a note to the Notes section:**
   ```markdown
   ## Notes
   
   **[YYYY-MM-DD]**: [Key insight or update]
   - What was done or discovered
   - What matters about it
   - What it means for next steps
   ```

3. **Update references if needed:**
   - If a plan or research document was created, add it to the References section

### 3. Searching for Tickets

Use the `ticket-searcher` agent or:
1. Glob `thoughts/tickets/*.md` to list all tickets
2. Grep inside files for the query terms
3. Present results: file path, title, priority, size, state, one-line summary

### 4. Updating Ticket Status

When moving tickets through the workflow:

1. **Read the ticket file**
2. **Show current state and suggest the next logical state** based on the workflow above
3. **Edit the State field** in the Status section
4. **Add a note** in the Notes section explaining the state change

## Important Notes

- All tickets **must** include a clear "problem to solve" — if the user only gives implementation details, ask: *"To write a good ticket, please explain the problem you're trying to solve from a user perspective"*
- Focus on the "what" and "why"; include "how" only if well-defined
- Keep tickets concise but complete — aim for scannable content
- Don't create tickets from early-stage brainstorming unless requested
