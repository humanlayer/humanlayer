import { describe, expect, test } from 'vitest'

import { inferDesignDocQuestionCounts } from '../../src/agents/design-doc-open-questions'
import { buildMatrix } from '../_lib/matrix'

// 15s timeout for AI calls

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6' },
	openai: { label: 'openai-gpt-5', modelId: 'gpt-5' },
})

for (const { label, model } of MATRIX) {
	describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)(
		`inferDesignDocQuestionCounts [${label}]`,
		() => {
			test('returns zero open questions when all resolved', async () => {
				const doc = `---
task: test-task
type: design-discussion
---

### Design Questions

(all resolved)

### Resolved Design Questions

#### Q1: Handler Implementation Approach ✅

**Decision**: Option A - Simple implementation

Should we use a simple or complex handler?

**Resolution**: Simple is better for this use case.

#### Q2: Database Schema ✅

**Decision**: Single table

Use one table or multiple?

**Resolution**: Single table is sufficient.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(0)
				expect(result.numResolvedQuestions).toBe(2)
			})

			test('returns correct count when open questions exist', async () => {
				const doc = `---
task: test-task
type: design-discussion
---

### Design Questions

#### Q1: API Design

Should we use REST or GraphQL?

Options:
- Option A: REST - simpler
- Option B: GraphQL - more flexible

#### Q2: Caching Strategy

How should we handle caching?

### Resolved Design Questions

#### Q3: Authentication Method ✅

**Decision**: JWT tokens

**Resolution**: JWT provides stateless auth.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(2)
				expect(result.numResolvedQuestions).toBe(1)
			})

			test('counts questions with descriptive headings (no Q1/Q2 prefix)', async () => {
				// This format was used by ll-163 and incorrectly returned 0 open questions
				const doc = `---
task: ll-163-add-a-new-riptide-theme-nord-night
type: design-discussion
---

### Design Questions

#### Theme Name Format
Should the identifier be \`super-noir\`, \`nord-night-super-noir\`, or \`super-noir-bw\`?
- Option A: \`super-noir\` - Clean, follows convention
- Option B: \`nord-night-super-noir\` - References Nord
- Option C: \`super-noir-bw\` - Explicit about B&W

Recommendation: **Option A** - The noir aesthetic is the core identity

#### Accent Color Choice
What accent color for a black & white theme?
- Option A: Pure white \`#ffffff\`
- Option B: Warm off-white \`#f5f5dc\` (classic film noir warmth)
- Option C: Cool blue-gray \`#8899aa\`
- Option D: Classic red \`#cc0000\` (femme fatale accent)

Recommendation: **Option B** - Classic noir films have warm, slightly sepia quality

#### ANSI Color Handling
How should terminal colors work in B&W?
- Option A: All grayscale
- Option B: Desaturated semantic colors
- Option C: Grayscale base + muted red for errors only

Recommendation: **Option C** - Balances noir aesthetic with usability

#### Icon Selection
Which icon in the theme selector?
- Option A: \`Moon\` - Standard dark icon
- Option B: \`ScanEye\` - "Watching" noir aesthetic

Recommendation: **Option B** - Pairs well with noir surveillance/mystery vibe

### Next Steps
Please let me know any feedback you want and I'll incorporate it.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(4)
				expect(result.numResolvedQuestions).toBe(0)
			})

			test('counts numbered design questions with bold recommendations (core-170 format)', async () => {
				// This format from core-170 incorrectly returned 0 open questions
				// The key differences: numbered headings (#### 1. ...) and **Recommendation**: bold format
				const doc = `---
task: core-170-when-opening-riptide-ui-for-the-first-time-create-session-c
type: design-discussion
---

### Patterns to Follow
- **Task creation with navigation** - Direct API call from \`routes/tasks/new.tsx:34-47\`
- **Navigation with multiple search params** - From \`routes/sessions/$sessionId.tsx:370-384\`
- **Zustand persist pattern** - From \`hooks/stores/settingsStore.ts:26-55\`
- **Session count hooks** - From \`hooks/live-queries/useActiveSessionsCount.ts\`

### Design Questions

#### 1. First-Time User Detection Strategy
How should we determine if a user is opening riptide-ui for the very first time?
- Option A: Check total session count (active + draft + archived === 0)
- Option B: Add localStorage flag \`hasSeenWelcome\` to settingsStore
- Option C: Combination - check total session count === 0 AND \`!hasCompletedBootstrap\` flag

**Recommendation**: Option C - Most robust approach ensuring bootstrap welcome shows only once for true first-time users.

#### 2. Task Creation Timing
When should the \`riptide-bootstrap\` task be created?
- Option A: At render time when first-time user detected
- Option B: When user clicks the "Get Started" button (async in handler)
- Option C: Don't create task at all

**Recommendation**: Option B - Create in click handler to avoid orphaned tasks.

#### 3. Welcome Message Updates
How should we modify SessionsEmptyState?
- Option A: Create separate \`FirstTimeEmptyState\` component
- Option B: Add conditional rendering with \`isFirstTime?: boolean\` prop

**Recommendation**: Option B - Changes are minimal enough for conditional in existing component.

#### 4. Directory Placeholder Customization
Should "where are you writing code today?" be universal or first-time only?
- Option A: Change placeholder globally in \`DraftLauncherForm\`
- Option B: Pass dynamic placeholder only for bootstrap flow
- Option C: Add \`directoryPlaceholder\` prop with default

**Recommendation**: Option A - The friendlier text is a global UX improvement.

#### 5. Button Label
What should the first-time welcome button say?
- Option A: Keep "Create Session"
- Option B: Change to "Get Started" for first-time users

**Recommendation**: Option B - Clearer CTA indicating this is an onboarding flow.

### Next Steps
Please let me know any feedback you want and I'll incorporate it.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(5)
				expect(result.numResolvedQuestions).toBe(0)
			})
		},
	)

	describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)(
		`inferDesignDocQuestionCounts design discussion fixtures [${label}]`,
		() => {
			test('counts all questions resolved via all-resolved marker and resolved section', async () => {
				const doc = `---
task: core-1188-need-more-protections-against-accidentally-discarding
type: design-discussion
---

### Design Questions

All design questions have been resolved.

### Resolved Design Questions

#### How should NewTaskFormV2 handle the confirmation dialog?

**Decision**: Option C - Add draft status to tasks table.

#### Should NewTaskFormV2 reuse SaveDraftDialog?

**Decision**: Yes - Reuse SaveDraftDialog since we now have full parity.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(0)
				expect(result.numResolvedQuestions).toBe(2)
			})

			test('counts none resolved when only recommendations are present', async () => {
				const doc = `---
task: email-campaign-manager
type: design-discussion
---

### Design Questions

#### 1. Checkbox selection storage mechanism

How should the dashboard store and manage selected contacts?

- **Option A: In-memory array with clipboard sync**
- **Option B: localStorage persistence**

**Recommendation:** Option A - In-memory with clipboard sync.

#### 2. Template slug configuration

Where should template ID to slug mappings live?

- **Option A: Hardcoded in send.ts**
- **Option B: External JSON config file**

**Recommendation:** Option B - External JSON config.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(2)
				expect(result.numResolvedQuestions).toBe(0)
			})

			test('counts mixed open and resolved design questions', async () => {
				const doc = `---
task: core-432-rewind-a-task-or-fork-from-document
type: design-discussion
---

### Design Questions

#### Q1: What should happen to sessions?

- **Option A: Sessions stay with original task**
- **Option B: Option to move sessions**

**Recommendation:** Option A (sessions stay).

#### Q2: How should symlinks be handled for forked tasks?

- **Option A: Immediate symlink setup**
- **Option B: Lazy symlink on session launch**

**Recommendation:** Option B (lazy setup).

### Resolved Design Questions

#### Q3: Should the original task track its forks?

**Decision: Option B - Track fork origin only**
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(2)
				expect(result.numResolvedQuestions).toBe(1)
			})

			test('treats ambiguous recommendation-only questions as open', async () => {
				const doc = `---
task: discard-protections
type: design-discussion
---

### Design Questions

#### 1. What defines a high-risk discard action?

The question is which actions warrant a confirmation dialog vs just an undo toast.

Recommendation: **Option B** - Drafts with content and running sessions.

#### 2. Should the confirmation dialog have a Don't ask me again option?

Recommendation: **Option A** - Add a persisted setting.

#### 3. Where should the new dialog component live?

No recommendation has been chosen yet.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(3)
				expect(result.numResolvedQuestions).toBe(0)
			})

			test('deduplicates questions listed under both unresolved and resolved sections', async () => {
				const doc = `---
task: outline-implementer
type: design-discussion
---

### Design Questions

#### Register the outline implementer in @humanlayer/codelayer

Should this be a package-level specialist or a daemon override?

#### Use the rpi:-prefixed CodeLayer sub-agent name

Should we register only the prefixed name or both prefixed and unprefixed names?

### Resolved Design Questions

#### Register the outline implementer in @humanlayer/codelayer

Option A chosen: add it to @humanlayer/codelayer as a first-class RPI specialist.

#### Use the rpi:-prefixed CodeLayer sub-agent name

Option B chosen: register the CodeLayer sub-agent as rpi:outline-implementer-agent only.

#### Keep broader parity work out of scope

Option A chosen: solve only the outline implementer gap and add a focused roster assertion.
`
				const result = await inferDesignDocQuestionCounts(doc, { model })

				expect(result.numOpenQuestions).toBe(0)
				expect(result.numResolvedQuestions).toBe(3)
			})
		},
	)
}
