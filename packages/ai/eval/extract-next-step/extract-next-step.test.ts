import { describe, expect, test } from 'vitest'

import { extractNextStep } from '../../src/agents/extract-next-step'
import { buildMatrix } from '../_lib/matrix'

// 15s timeout for AI calls

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-haiku', modelId: 'claude-haiku-4-5' },
	openai: { label: 'openai-gpt-5-mini', modelId: 'gpt-5-mini' },
})

for (const { label, model } of MATRIX) {
	describe(`extractNextStep [${label}]`, () => {
		test('extracts skill prompt from conversational suggestion', async () => {
			const expectedPrompt = 'use the rpi:setup-worktree skill for task 12345'
			const message = `You can use the following prompt:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('setup-worktree')
			}
		})

		test('extracts multiline skill prompt exactly', async () => {
			const expectedPrompt = `use the rpi:create-research skill with the following questions (write the doc to thoughts/tasks/eng-1234-feature/research-feature-name.md)

- How does authentication work?
- Where are sessions stored?`
			const message = `Research questions generated. To continue, use a prompt like the below:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-research')
				expect(result.extraction.taskReference).toContain('eng-1234')
			}
		})

		test('extracts from ### Next Steps section with code block', async () => {
			const expectedPrompt =
				'use the rpi:create-design-discussion skill for thoughts/tasks/ll-31-riptide-next-session-suggestions'
			const message = `## Summary

I've completed the research phase for ll-31-riptide-next-session-suggestions.

### Next Steps

To proceed to the next phase, use a prompt like

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-design-discussion')
				expect(result.extraction.taskReference).toContain('ll-31')
			}
		})

		test('returns no_next_step for open-ended questions', async () => {
			const message = `I've analyzed the codebase and found several options for implementing this feature.

How would you like to proceed? We could:
1. Start with the database changes
2. Begin with the UI components
3. Implement the API first

Let me know your preference!
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('no_next_step')
		})

		test('returns no_next_step when no code block with skill', async () => {
			const message = `I've completed the implementation of the authentication feature. The changes include:

- Added JWT validation middleware
- Created user session management
- Updated the login endpoint

All tests are passing.
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('no_next_step')
		})

		test('returns no_next_step for prose suggestion without code block', async () => {
			const message = `Research complete.

You might want to consider using the rpi:create-design-discussion skill next, or you could jump straight to the structure outline if the design is already clear.
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('no_next_step')
		})

		test('extracts suggested directory from worktree setup message', async () => {
			const expectedPrompt = 'use the rpi:implement-plan skill for ll-31'
			const message = `worktree is ready, to start implementation, you can run

\`\`\`
${expectedPrompt}
\`\`\`

in ~/wt/inklayer/flicker-fix
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('implement-plan')
				expect(result.extraction.suggestedDirectory).toBe('~/wt/inklayer/flicker-fix')
			}
		})

		test('should NOT extract directory from file path in thoughts/tasks', async () => {
			// This message mentions a file path, NOT a directory to run in
			const expectedPrompt =
				'use the rpi:create-research-questions skill for thoughts/tasks/ll-145-app-signing/ticket.md'
			const message = `The ticket has been fetched to \`thoughts/tasks/ll-145-app-signing/ticket.md\`. To start the RPI workflow, use this prompt in a **new session**:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-research-questions')
				// Should NOT extract a directory - the message only mentions a file path
				expect(result.extraction.suggestedDirectory).toBeUndefined()
			}
		})

		test('should NOT extract directory from thoughts/tasks/ path with trailing slash in prompt', async () => {
			// The task path "thoughts/tasks/core-180/" is the task reference, NOT a directory to run in
			const expectedPrompt =
				'use the rpi:create-research-questions skill for thoughts/tasks/core-180/ - reference prev-design-discussion.md for context'
			const message = `Done. Created thoughts/tasks/core-180/ and copied the CORE-27 design discussion as prev-design-discussion.md.

Note: The Linear CLI is missing LINEAR_API_KEY - you'll need to set that to fetch the ticket. Once configured, run:

export LINEAR_API_KEY=your_key
linear get-issue CORE-180 > thoughts/tasks/core-180/ticket.md

Or if you want to proceed without the ticket, start research questions in a new session:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-research-questions')
				expect(result.extraction.taskReference?.toLowerCase()).toContain('core-180')
				// Should NOT extract a directory - "thoughts/tasks/core-180/" is the task path, not where to run
				expect(result.extraction.suggestedDirectory).toBeUndefined()
			}
		})

		test('extracts describe-pr skill from explicit suggestion', async () => {
			const expectedPrompt = 'use the rpi:describe-pr skill for rpi/tasks/eng-1234-feature'
			const message = `All phases are complete and verified! Implementation is done.

To create the PR description, use:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('describe-pr')
				expect(result.extraction.taskReference).toContain('eng-1234')
			}
		})

		test('extracts from OLD research-questions template format', async () => {
			const expectedPrompt =
				'use the rpi:create-research skill for .humanlayer/tasks/core-1212-users-are-confused-about-what-to-do-at-the-end-of-research'
			const message = `### Status
- Document: [research questions](https://cloud.example.com/artifacts/123)
- Ticket: CORE-1212

### Next Step

To continue this session, use a prompt like the below:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-research')
				expect(result.extraction.taskReference).toContain('core-1212')
			}
		})

		test('extracts from NEW research-questions template format', async () => {
			const expectedPrompt =
				'use the rpi:create-research skill for .humanlayer/tasks/core-1212-users-are-confused-about-what-to-do-at-the-end-of-research'
			const message = `### Status
- Document: [research questions](https://cloud.example.com/artifacts/123)
- Ticket: CORE-1212

### Next Steps

The research questions we wrote are a query plan for our research phase.

**You do not need to answer these questions** - they will guide the agent's research in the next phase.

To proceed to the research phase, you can use the button below or create a new session with the following command: \`/rpi:create-research\`

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-research')
				expect(result.extraction.taskReference).toContain('core-1212')
			}
		})

		test('extracts from OLD structure-outline template format', async () => {
			const expectedPrompt = 'use the rpi:create-plan skill for .humanlayer/tasks/eng-9999-example-task'
			const message = `### Status
- Document: [structure outline](https://cloud.example.com/artifacts/456)
- Ticket: ENG-9999

### Next Step

To continue this session, use a prompt like the below:

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-plan')
				expect(result.extraction.taskReference).toContain('eng-9999')
			}
		})

		test('extracts from NEW structure-outline template format', async () => {
			const expectedPrompt = 'use the rpi:create-plan skill for .humanlayer/tasks/eng-9999-example-task'
			const message = `### Status
- Document: [implementation outline](https://cloud.example.com/artifacts/456)
- Ticket: ENG-9999

### Next Steps

The implementation outline has been created. It defines how we will approach the implementation in a clear and concise way.

Please read it and work with me to ensure:

1. Step structure & ordering makes sense to you. Ideally, steps should be thin vertical slices that are incrementally verifiable and/or deliverable.
2. Verification steps make sense to you. Did I capture all the testing and verification patterns you have?

Once you're happy with the approach, you can use the button below to proceed to the planning phase, or create a new session with the following command: \`/rpi:create-plan\`

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-plan')
				expect(result.extraction.taskReference).toContain('eng-9999')
			}
		})

		test('returns no_next_step for design discussion with open questions', async () => {
			const message = `### Status
- Document: [design discussion](https://cloud.example.com/artifacts/789)
- Ticket: CORE-1212

### Next Steps

The design document has been created!

**You should carefully review this document**:

- Ensure the current state and desired end state are correct
- Read the design questions carefully, and work back and forth with me to answer them
- Ensure that critical patterns were captured in the document. Ask me to remove any which are incorrect or out-of-date. This is your chance to decide which patterns the implementation follows

You can also ask me to add more detail, code snippets, pseudo-code, or mermaid diagrams. You can use the sharing & commenting features to collaborate with your teammates on this document - I can review and/or resolve comments whenever you're ready.
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('no_next_step')
		})

		test('extracts from design discussion with resolved questions', async () => {
			const expectedPrompt =
				'use the rpi:create-structure-outline skill for .humanlayer/tasks/core-1212-users-are-confused-about-what-to-do-at-the-end-of-research'
			const message = `### Status
- Document: [design discussion](https://cloud.example.com/artifacts/789)
- Ticket: CORE-1212

### Next Steps

All questions in the design document have been resolved. At this point, we can proceed to the outline phase and create an outline of the implementation work.

To do this, you can use the button below, or create a new session with the following command: \`/rpi:create-structure-outline\`

\`\`\`text
${expectedPrompt}
\`\`\`
`
			const result = await extractNextStep(message, { model })

			expect(result.extraction.type).toBe('next_step_found')
			if (result.extraction.type === 'next_step_found') {
				expect(result.extraction.nextStepPrompt).toBe(expectedPrompt)
				expect(result.extraction.nextStepType).toBe('create-structure-outline')
				expect(result.extraction.taskReference).toContain('core-1212')
			}
		})

		test('should NOT suggest describe-pr when phases are incomplete', async () => {
			const message = `Phase 2 of 4 is now complete. Continuing to Phase 3...

The authentication middleware is implemented. Moving on to the API routes next.
`
			const result = await extractNextStep(message, { model })

			// Should not find describe-pr - implementation is still in progress
			expect(result.extraction.type).toBe('no_next_step')
		})

		test('should NOT suggest describe-pr when tests are failing', async () => {
			const message = `Implementation complete but there are failing tests:

- test/auth.test.ts: 2 failures
- test/api.test.ts: 1 failure

Let me know if you'd like me to fix these issues.
`
			const result = await extractNextStep(message, { model })

			// Should not find describe-pr - tests are failing
			expect(result.extraction.type).toBe('no_next_step')
		})
	})
}
