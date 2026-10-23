import { describe, expect, test } from 'vitest'

import { generateLearnQuestions } from '../../src/agents/generate-learn-questions/generate-learn-questions'

// Patterns that indicate a question is just trivia recall (too low-level)
const TRIVIA_PATTERNS = [
	/^which file /i,
	/^what file /i,
	/^where is .* located/i,
	/^what is the (exact |specific )?(file|path|directory)/i,
	/^what is the (exact |specific )?(function|method) name/i,
	/^what is the (sync )?url for/i,
	/^what is the getKey/i,
	/^what (exact )?value/i,
]

// Patterns that indicate a question is about mechanisms/behavior (mid-level)
const MECHANISM_PATTERNS = [
	/how does/i,
	/what happens when/i,
	/why does/i,
	/what problem does/i,
	/what is the (purpose|role|benefit|advantage|trade-?off)/i,
	/how are .* (handled|managed|resolved|processed|isolated)/i,
	/what (strategy|approach|pattern|mechanism)/i,
	/when does .* (occur|happen|trigger|fire|run)/i,
	/what prevents/i,
	/how .* (ensure|avoid|prevent|handle|recover)/i,
]

function isTriviaQuestion(questionText: string): boolean {
	return TRIVIA_PATTERNS.some((p) => p.test(questionText))
}

function isMechanismQuestion(questionText: string): boolean {
	return MECHANISM_PATTERNS.some((p) => p.test(questionText))
}

// This input deliberately contains ALL levels of detail:
// - HIGH-LEVEL: "uses Electric SQL for real-time sync", "React context provider"
// - MID-LEVEL: on-demand sync behavior, backoff recovery strategy, tenant isolation via cache key,
//              bucketed sorting to prevent thrashing, presence detection pattern
// - LOW-LEVEL: exact file paths, exact config values (500ms, 2s, 1.5x), function names, sync URLs
//
// Good questions should target the MID-LEVEL — how mechanisms work and why.
const MULTI_LEVEL_INPUT = `# Electric SQL Data Flow in Riptide UI

## Architecture Overview (high-level)

Riptide UI uses Electric SQL for real-time data synchronization between the Postgres database and the browser. Data flows through a sync proxy that handles authorization, then into TanStack DB collections that components query reactively.

## Collections (all levels)

All collections live in \`apps/riptide-ui/src/collections/\` and share a common pattern using \`electricCollectionOptions\` from \`@tanstack/electric-db-collection\`.

### Sync Behavior

Collections use **on-demand sync mode** — data is NOT eagerly loaded on page mount. Instead, sync only begins when a component actually queries the collection via \`useLiveQuery\`. This means navigating to a page that doesn't use a particular collection incurs zero sync overhead for that data.

### Error Recovery

All collections use an exponential backoff strategy for transient failures: 500ms initial delay, 2s maximum, 1.5x multiplier, with infinite retries. This handles common scenarios like the sync proxy restarting during a deploy — the client automatically reconnects without user intervention. HTTP 401 errors trigger a token refresh, 404 errors are silently ignored (resource deleted server-side), and 409 conflicts trigger a full re-sync.

### Specific Collections

- \`sessions.ts\` → sync URL \`/v1/sessions\`, getKey: \`item.id\`
- \`conversation-events.ts\` → sync URL \`/v1/events\`, getKey: \`item.id\`
- \`artifacts.ts\` → sync URL \`/v1/artifacts\`, getKey: \`item.id\`
- \`online-hosts.ts\` → sync URL \`/v1/hosts\`, getKey: \`item.host_id\` (uses host identity, not row ID, because multiple rows may track the same host across reconnections)
- \`tasks.ts\` → sync URL \`/v1/tasks\`, getKey: \`item.id\`

## Provider (mid + low level)

**Location**: \`apps/riptide-ui/src/components/providers/ElectricProvider.tsx\`

The provider isolates tenant data by caching collections per \`\${userId}:\${organizationId}\` composite key. When a user switches organizations, existing collections are torn down via the \`status:change\` event listener and new ones are created for the new org context. This prevents data from one org leaking into another org's view.

All 7 collections are provided via React context: sessions, events, artifacts, online hosts, tasks, approvals, task-organization-acls.

## Live Query Hooks (mid + low level)

Located in \`apps/riptide-ui/src/hooks/live-queries/\`:

- **\`useActiveSessions.ts\`**: LEFT JOIN sessions to tasks, filters by non-archived, non-draft, owned by user. Sorts by 15-second bucketed \`last_activity_at\` — the bucketing prevents the list from constantly re-sorting during active coding sessions, giving a stable UI while still surfacing recently active sessions near the top.
- **\`useTaskArtifacts.ts\`**: Queries artifacts by \`task_id\`, ordered by \`last_updated_at\` desc.
- **\`useTaskStatuses.ts\`**: Runs four separate queries to derive task state: needs_approval count, most recent session status, running session count, and pending count (ready_for_launch + resuming). These are separate queries rather than one complex query because each maps to a distinct UI indicator and they update at different frequencies.
- **\`use-is-host-online.ts\`**: Presence check via \`onlineHostsCollection\` — determines if a user's coding host is currently connected, which controls whether "launch session" or "host offline" is shown.`

// Known mid-level mechanisms that good questions should be asking ABOUT (not just recalling values from).
// Each entry describes a mechanism and what a correct answer about it should convey.
const EXPECTED_MECHANISMS = [
	{
		name: 'on-demand sync',
		// A good question would ask HOW sync works or WHY it's on-demand, not "what is the syncMode value?"
		// Narrow: must mention on-demand/eager/lazy/load concepts, not just "sync" generically
		topic: /on.demand|eager|lazy.*load|page.*load|overhead|useLiveQuery|sync.*mode|when.*data.*sync|start.*sync/i,
		correctShouldConvey:
			/on.demand|only.*(when|if).*quer|not.*eager|zero.*overhead|component.*queries|begin.*when/i,
	},
	{
		name: 'error recovery',
		// A good question would ask WHAT HAPPENS during failures, how errors are handled, or how recovery works
		topic: /error|fail|recover|backoff|retry|reconnect|transient|deploy|restart|409|401|404|conflict/i,
		correctShouldConvey:
			/backoff|retry|reconnect|automatic|without.*user|token.*refresh|re.sync|full.*sync|from.*scratch/i,
	},
	{
		name: 'tenant isolation',
		// A good question would ask HOW tenant data is isolated
		topic: /tenant|isolat|org.*switch|org.*leak|cache.*collection|separate.*org/i,
		correctShouldConvey: /userId.*organizationId|composite.*key|torn.*down|new.*org|prevent.*leak|cache.*per/i,
	},
	{
		name: 'bucketed sorting',
		// A good question would ask WHY sorting uses time buckets
		topic: /bucket|15.second|thrash|re.sort|active.*session.*sort|sort.*active.*session/i,
		correctShouldConvey: /bucket|prevent.*re.sort|stable|thrash|constant.*re.sort/i,
	},
	{
		name: 'host_id key choice',
		// A good question would ask WHY online-hosts uses host_id instead of id
		topic: /host_id|online.host.*key|getKey.*host|host.*identity|host.*reconnect/i,
		correctShouldConvey: /reconnect|multiple.*row|host.*identity|same.*host|stable.*identity/i,
	},
	{
		name: 'separate status queries',
		// A good question would ask WHY task statuses use four separate queries
		topic: /four.*quer|separate.*quer|task.*status.*quer|distinct.*indicator|frequenc.*update/i,
		correctShouldConvey: /distinct.*indicator|different.*frequenc|separate|independent|update.*different/i,
	},
]

function matchMechanism(questionText: string) {
	return EXPECTED_MECHANISMS.find((m) => m.topic.test(questionText)) ?? null
}

describe('generateLearnQuestions', () => {
	test('generates mid-level mechanism questions, not trivia', async () => {
		// Append a unique seed to bust Anthropic's prompt cache between runs
		const seed = `\n\n<!-- eval-run-${Date.now()}-${Math.random().toString(36).slice(2)} -->`
		const result = await generateLearnQuestions(MULTI_LEVEL_INPUT + seed)

		// --- structural checks ---
		expect(result.hasQuestions).toBe(true)
		const questions = result.questions!
		expect(questions.length).toBeGreaterThanOrEqual(3)
		expect(questions.length).toBeLessThanOrEqual(5)

		// Pretty-print all generated questions for manual review
		console.log(`\n${'═'.repeat(80)}`)
		console.log('  GENERATED QUESTIONS')
		console.log('═'.repeat(80))
		for (let qi = 0; qi < questions.length; qi++) {
			const q = questions[qi]!
			const mechanism = matchMechanism(q.question)
			const trivia = isTriviaQuestion(q.question)
			const mech = isMechanismQuestion(q.question)

			console.log(`\n${'─'.repeat(80)}`)
			console.log(
				`  Q${qi + 1}  ${trivia ? '⚠ TRIVIA' : mech ? '✓ mechanism' : '○ other'}  ${mechanism ? `→ ${mechanism.name}` : ''}`,
			)
			console.log(`${'─'.repeat(80)}`)
			if (q.context) {
				console.log(`  context: ${q.context}`)
			}
			console.log(`  ${q.question}`)
			console.log('')
			for (let oi = 0; oi < q.options.length; oi++) {
				const marker = oi === q.correctIndex ? '✓' : '✗'
				const selected = oi === q.correctIndex ? ' ← correct' : ''
				console.log(`    ${marker} [${oi}] ${q.options[oi]!.label}${selected}`)
			}
			console.log('')
			console.log(`  explanation: ${q.explanation}`)
		}
		console.log(`\n${'═'.repeat(80)}`)
		console.log(
			`  SUMMARY: ${questions.length} questions | trivia: ${questions.filter((q) => isTriviaQuestion(q.question)).length} | mechanism: ${questions.filter((q) => isMechanismQuestion(q.question)).length} | matched: ${questions.filter((q) => matchMechanism(q.question)).length}`,
		)
		console.log(`${'═'.repeat(80)}\n`)

		// --- abstraction level checks ---

		// At most 1 question should be pure trivia recall
		const triviaCount = questions.filter((q) => isTriviaQuestion(q.question)).length
		expect(triviaCount).toBeLessThanOrEqual(1)

		// At least half the questions should be about mechanisms/behavior
		const mechanismCount = questions.filter((q) => isMechanismQuestion(q.question)).length
		expect(mechanismCount).toBeGreaterThanOrEqual(Math.floor(questions.length / 2))

		// --- per-question structural checks ---
		for (const q of questions) {
			expect(q.options.length).toBeGreaterThanOrEqual(2)
			expect(q.options.length).toBeLessThanOrEqual(4)
			expect(q.correctIndex).toBeGreaterThanOrEqual(0)
			expect(q.correctIndex).toBeLessThan(q.options.length)

			// Questions and explanations should be substantive
			expect(q.question.length).toBeGreaterThan(20)
			expect(q.explanation.length).toBeGreaterThan(30)

			const correctAnswer = q.options[q.correctIndex]!.label
			const wrongAnswers = q.options.filter((_, i) => i !== q.correctIndex).map((o) => o.label)

			// All options non-empty and distinct
			for (const opt of q.options) {
				expect(opt.label.length).toBeGreaterThan(0)
			}
			for (const wrong of wrongAnswers) {
				expect(correctAnswer).not.toBe(wrong)
			}
		}

		// --- mechanism matching: at least 2 questions should target known mechanisms ---
		let matchedMechanisms = 0
		for (const q of questions) {
			const mechanism = matchMechanism(q.question)
			if (mechanism) {
				matchedMechanisms++
				// The correct answer should convey the right understanding of the mechanism
				const correctAnswer = q.options[q.correctIndex]!.label
				const conveys = mechanism.correctShouldConvey.test(correctAnswer)
				if (!conveys) {
					// Also check the explanation — sometimes the mechanism detail is there
					const explanation = q.explanation
					expect(conveys || mechanism.correctShouldConvey.test(explanation)).toBe(true)
				}
			}
		}
		expect(matchedMechanisms).toBeGreaterThanOrEqual(2)
	})

	// This input is code-pattern-heavy — it describes HOW async work is structured after
	// database transactions, with multiple concrete code examples showing correct and
	// incorrect approaches. Good questions should naturally include markdown with code
	// blocks in their options (e.g. "which snippet correctly handles post-tx async work?").
	const ASYNC_PATTERNS_INPUT = `# Post-Transaction Async Patterns in Riptide API

## Overview

The riptide-api uses a fire-and-forget pattern for expensive async work (AI calls, webhook delivery, external API calls) that should happen after a database transaction commits but must not block the HTTP response. This pattern appears in session title generation, artifact extraction, and learn question generation.

## The Core Pattern

After a database transaction commits, the handler calls an async function **without awaiting it**. The async function receives all data it needs as arguments — it never queries for its own input. This is critical because the transaction is already committed, so the data is guaranteed consistent.

\`\`\`typescript
// Inside the oRPC handler:
const txResult = await db.transaction(async (tx) => {
  // ... mutations ...
  return { id, content, frontmatter }
})

// Fire-and-forget — no await, does not block response
if (txResult.frontmatter?.type === 'research') {
  runExtractionAsync(db, txResult.id, txResult.content)
}

return { success: true }
\`\`\`

## Why Not Await?

The API response should return as fast as possible. AI calls (Sonnet structured output) take 3-8 seconds. Awaiting them would mean the daemon's HTTP request hangs for that duration, which can cause timeout issues and blocks the daemon from processing other events. The fire-and-forget approach means the response returns immediately after the transaction commits.

## DB Handle: Top-Level vs Transaction

The async function receives the **top-level \`db\` handle** from \`context.services.db\`, NOT the transaction handle \`tx\`. This is because:

1. The transaction has already committed by the time the async function runs
2. The \`tx\` handle is invalid after commit — using it would throw "cannot use a pool client after calling release"
3. The top-level \`db\` handle gets a fresh connection from the pool for the UPDATE

\`\`\`typescript
// CORRECT: pass top-level db, not tx
async function runExtractionAsync(
  db: PgDatabase<any, any, any>,  // top-level pool connection
  artifactId: string,
  content: string,
) {
  const result = await generateSomething(content)
  await db.update(artifacts).set({ extracted: result }).where(eq(artifacts.id, artifactId))
}

// WRONG: using tx after commit
const txResult = await db.transaction(async (tx) => {
  const data = await tx.insert(artifacts).values(input).returning()
  // Don't pass tx out — it will be released after this block
  return data
})
// tx is now invalid — this would crash:
// await tx.update(artifacts).set({ ... })
\`\`\`

## Data Passing: Arguments, Not Re-Queries

The async function receives everything it needs as arguments. It does NOT re-query the database for its input. This avoids a race condition where another request could modify the row between the transaction commit and the async function's read.

\`\`\`typescript
// CORRECT: data passed as arguments from transaction result
runExtractionAsync(db, txResult.id, orgId, userId, txResult.content)

// WRONG: re-querying inside the async function
async function runExtractionAsync(db, artifactId) {
  // Race condition: another request could have modified this row
  const artifact = await db.select().from(artifacts).where(eq(artifacts.id, artifactId))
  // ... use artifact.content
}
\`\`\`

## Error Isolation

The async function wraps ALL work in try/catch. Errors are logged and reported to Sentry but never propagate to the caller (since there is no caller — the function was not awaited). This prevents a failure in AI extraction from crashing the API process or affecting other requests.

\`\`\`typescript
async function runExtractionAsync(db, artifactId, content) {
  try {
    const result = await generateSomething(content)
    await db.update(artifacts).set({ extracted: result }).where(...)
    logger.info({ artifactId }, 'Extraction complete')
  } catch (err) {
    // Log + report, but do NOT re-throw
    logger.error({ err, artifactId }, 'Extraction failed')
    Sentry.captureException(err, {
      tags: { error_type: 'extraction' },
      extra: { artifactId },
    })
  }
}
\`\`\`

If the error were re-thrown, it would become an unhandled promise rejection (since no one awaits the promise), which in Node.js/Bun can crash the process entirely.

## Guard Conditions

The fire-and-forget call is gated by a guard that checks two things:
1. **Applicability**: Is this the right kind of data? (e.g. \`frontmatter.type === 'research'\`)
2. **Idempotency**: Has this work already been done? (e.g. \`!existingResult\`)

This means the extraction runs at most once per artifact. If the artifact is upserted again with the same content, the guard short-circuits because the result column is already populated.

## Dynamic Import for Heavy Dependencies

AI SDK packages (\`@ai-sdk/anthropic\`, \`ai\`) are large. The async function uses dynamic \`import()\` to lazy-load them only when extraction actually runs, keeping the main handler's cold start time fast:

\`\`\`typescript
async function runExtractionAsync(db, artifactId, content) {
  try {
    // Lazy-load AI SDK only when needed
    const { generateSomething } = await import('@humanlayer/ai')
    const result = await generateSomething(content)
    // ...
  } catch (err) { /* ... */ }
}
\`\`\``

	const ASYNC_PATTERN_MECHANISMS = [
		{
			name: 'data passing (no re-query)',
			// Check before fire-and-forget since questions often mention both concepts
			topic: /pass.*data.*argument|data.*as.*argument|re.quer|race.*condition|pass.*data|data.*pass|input.*argument/i,
			correctShouldConvey:
				/argument|race.*condition|re.quer|modif|pass.*from.*transaction|consistent|another.*request/i,
		},
		{
			name: 'top-level db vs tx handle',
			topic: /top.level.*db|transaction.*handle|tx.*handle|pool.*connect|db.*handle|after.*commit|invalid.*tx|released|which.*handle/i,
			correctShouldConvey: /top.level|committed|released|invalid|pool|fresh.*connect|already.*commit/i,
		},
		{
			name: 'fire-and-forget (no await)',
			topic: /fire.and.forget|not.*await|without.*await|no.*await|block.*response|immediate.*return|block.*http/i,
			correctShouldConvey:
				/not.*await|fire.and.forget|immediate|block|return.*fast|response.*fast|hang|timeout|unhandled.*reject|crash/i,
		},
		{
			name: 'error isolation',
			topic: /error.*isolat|try.*catch|re.throw|unhandled.*reject|crash.*process|propagat|sentry/i,
			correctShouldConvey: /try.*catch|not.*re.throw|unhandled.*reject|crash|isolat|propagat|sentry|log/i,
		},
		{
			name: 'guard conditions / idempotency',
			topic: /guard|idempoten|already.*done|already.*populated|at.most.once|short.circuit|skip.*if/i,
			correctShouldConvey: /idempoten|at.most.once|already.*populated|short.circuit|once.*per|skip/i,
		},
		{
			name: 'dynamic import / lazy load',
			topic: /dynamic.*import|lazy.*load|cold.*start|import\(\)/i,
			correctShouldConvey: /dynamic.*import|lazy|cold.*start|only.*when.*needed|import\(\)/i,
		},
	]

	function matchAsyncMechanism(questionText: string) {
		return ASYNC_PATTERN_MECHANISMS.find((m) => m.topic.test(questionText)) ?? null
	}

	test('generates questions with code in options from code-pattern-heavy input', async () => {
		const seed = `\n\n<!-- eval-run-${Date.now()}-${Math.random().toString(36).slice(2)} -->`
		const result = await generateLearnQuestions(ASYNC_PATTERNS_INPUT + seed)

		// --- structural checks ---
		expect(result.hasQuestions).toBe(true)
		const questions = result.questions!
		expect(questions.length).toBeGreaterThanOrEqual(3)
		expect(questions.length).toBeLessThanOrEqual(5)

		// Pretty-print all generated questions for manual review
		console.log(`\n${'═'.repeat(80)}`)
		console.log('  GENERATED QUESTIONS (async patterns)')
		console.log('═'.repeat(80))
		for (let qi = 0; qi < questions.length; qi++) {
			const q = questions[qi]!
			const mechanism = matchAsyncMechanism(q.question)
			const trivia = isTriviaQuestion(q.question)
			const mech = isMechanismQuestion(q.question)

			console.log(`\n${'─'.repeat(80)}`)
			const hasCode = q.options.some((o) => /```/.test(o.label))
			console.log(
				`  Q${qi + 1}  ${trivia ? '⚠ TRIVIA' : mech ? '✓ mechanism' : '○ other'}  ${hasCode ? '📝 has code' : ''}  ${mechanism ? `→ ${mechanism.name}` : ''}`,
			)
			console.log(`${'─'.repeat(80)}`)
			if (q.context) {
				console.log(`  context: ${q.context}`)
			}
			console.log(`  ${q.question}`)
			console.log('')
			for (let oi = 0; oi < q.options.length; oi++) {
				const marker = oi === q.correctIndex ? '✓' : '✗'
				const selected = oi === q.correctIndex ? ' ← correct' : ''
				console.log(`    ${marker} [${oi}] ${q.options[oi]!.label}${selected}`)
			}
			console.log('')
			console.log(`  explanation: ${q.explanation}`)
		}
		console.log(`\n${'═'.repeat(80)}`)
		const questionsWithCode = questions.filter((q) => q.options.some((o) => /```/.test(o.label))).length
		console.log(
			`  SUMMARY: ${questions.length} questions | with-code: ${questionsWithCode} | trivia: ${questions.filter((q) => isTriviaQuestion(q.question)).length} | mechanism: ${questions.filter((q) => isMechanismQuestion(q.question)).length} | matched: ${questions.filter((q) => matchAsyncMechanism(q.question)).length}`,
		)
		console.log(`${'═'.repeat(80)}\n`)

		// --- format checks ---

		// At least one question should have code blocks in its options — the input is full of
		// code patterns where comparing snippets is the natural way to test understanding
		expect(questionsWithCode).toBeGreaterThanOrEqual(1)

		// --- abstraction level checks ---
		const triviaCount = questions.filter((q) => isTriviaQuestion(q.question)).length
		expect(triviaCount).toBeLessThanOrEqual(1)

		const mechanismCount = questions.filter((q) => isMechanismQuestion(q.question)).length
		expect(mechanismCount).toBeGreaterThanOrEqual(Math.floor(questions.length / 2))

		// --- per-question structural checks ---
		for (const q of questions) {
			expect(q.options.length).toBeGreaterThanOrEqual(2)
			expect(q.options.length).toBeLessThanOrEqual(4)
			expect(q.correctIndex).toBeGreaterThanOrEqual(0)
			expect(q.correctIndex).toBeLessThan(q.options.length)
			expect(q.question.length).toBeGreaterThan(20)
			expect(q.explanation.length).toBeGreaterThan(30)

			const correctAnswer = q.options[q.correctIndex]!.label
			const wrongAnswers = q.options.filter((_, i) => i !== q.correctIndex).map((o) => o.label)
			for (const opt of q.options) {
				expect(opt.label.length).toBeGreaterThan(0)
			}
			for (const wrong of wrongAnswers) {
				expect(correctAnswer).not.toBe(wrong)
			}
		}

		// --- mechanism matching: at least 2 questions should target known async patterns ---
		let matchedMechanisms = 0
		for (const q of questions) {
			const mechanism = matchAsyncMechanism(q.question)
			if (mechanism) {
				matchedMechanisms++
				const correctAnswer = q.options[q.correctIndex]!.label
				const conveys = mechanism.correctShouldConvey.test(correctAnswer)
				if (!conveys) {
					const explanation = q.explanation
					expect(conveys || mechanism.correctShouldConvey.test(explanation)).toBe(true)
				}
			}
		}
		expect(matchedMechanisms).toBeGreaterThanOrEqual(2)
	})

	// This input is data-flow-heavy — it describes HOW data moves through a pipeline
	// with multiple stages, branching paths, and error handling at each stage.
	// Good questions should naturally include mermaid diagrams in their options
	// (e.g. "which diagram shows the correct data flow for artifact processing?").
	const DATA_FLOW_INPUT = `# Artifact Processing Pipeline in Riptide

## Overview

When a coding agent produces an artifact (research document, code file, plan), the artifact goes through a multi-stage processing pipeline before it appears in the UI. Each stage transforms or enriches the artifact, and failures at any stage are isolated so downstream stages can still proceed.

## Stage 1: Daemon Capture

The daemon monitors the agent's file system for changes. When a file matching the artifact pattern is detected, the daemon reads the file content and sends it to the API via an upsert RPC call. The daemon does NOT parse the content — it sends raw text. This keeps the daemon lightweight and ensures all parsing logic lives in one place (the API).

## Stage 2: API Ingestion

The API receives the raw content and runs it through a transaction with multiple steps:

1. **Hash check**: Compute content hash (ohash). If it matches the existing artifact's hash, skip all processing — this is a no-op upsert that prevents redundant work when the daemon re-sends unchanged files.
2. **Version creation**: If the hash differs, create a new artifact version row storing the previous content for history.
3. **Frontmatter extraction**: Parse YAML frontmatter from the markdown content. The frontmatter contains metadata like \`type: research\`, \`title\`, \`tags\`. This is stored as JSONB on the artifact row.
4. **Content storage**: Update the artifact row with new content, hash, and parsed frontmatter.

The transaction commits atomically — either all steps succeed or none do.

## Stage 3: Post-Transaction Enrichment

After the transaction commits, the API fires off async enrichment based on the artifact type:

- **Research artifacts** (\`frontmatter.type === 'research'\`): Trigger learn question generation via AI (Sonnet). Questions are stored back on the artifact row as JSONB.
- **Plan artifacts** (\`frontmatter.type === 'plan'\`): Trigger phase extraction that parses the plan into structured phases with success criteria.
- **All artifacts**: Trigger search index update that sends title + first 500 chars to the search service.

Each enrichment runs independently. If learn question generation fails, phase extraction and search indexing still proceed. Enrichment functions receive data as arguments from the transaction result — they never re-query.

## Stage 4: Electric SQL Sync

The artifact row change (from the transaction commit) propagates through Electric SQL's change data capture. The Postgres WAL entry flows to the Electric sync service, through the authorization proxy (which filters by tenant), and into the browser's TanStack DB collection. This happens automatically — no explicit push or notification is needed.

The sync path is: Postgres WAL → Electric sync service → Auth proxy → Browser ShapeStream → TanStack DB collection → React component re-render.

## Stage 5: UI Rendering

The ConnectedSidebarWidget queries the artifacts collection via useLiveQuery. When a new artifact version arrives, the reactive query automatically re-fires. The presentational SidebarWidget receives the updated data and re-renders the artifact list, showing the new version. If learn questions were generated, they appear in the Learn tab.

## Error Handling Per Stage

- **Stage 1 (Daemon)**: File read errors are logged and retried on next file watch tick. Network errors to the API trigger exponential backoff retry.
- **Stage 2 (API)**: Transaction failures roll back atomically. The daemon receives an error response and will retry the upsert.
- **Stage 3 (Enrichment)**: Each async function has its own try/catch. Failures are logged to Sentry but do NOT affect the API response (which already returned after Stage 2). Failed enrichment can be manually re-triggered.
- **Stage 4 (Sync)**: Electric SQL handles retries internally. If sync breaks, the browser client uses the same exponential backoff strategy as collections.
- **Stage 5 (UI)**: React error boundaries catch rendering failures. A broken artifact card doesn't crash the entire sidebar.`

	const DATA_FLOW_MECHANISMS = [
		{
			name: 'hash-based deduplication',
			topic: /hash|dedup|no.op|unchanged|skip.*process|redundant|same.*content/i,
			correctShouldConvey: /hash|no.op|skip|unchanged|redundant|same.*content|already.*match/i,
		},
		{
			name: 'pipeline stage ordering',
			topic: /stage|pipeline|order|sequence|first.*then|before.*after|flow|which.*step|process.*order/i,
			correctShouldConvey:
				/daemon.*api|capture.*ingest|transaction.*enrich|commit.*sync|ingest.*enrich|before.*enrich/i,
		},
		{
			name: 'enrichment isolation',
			topic: /isolat|independen|fail.*one.*still|each.*enrich|separate.*enrich|does.*not.*affect/i,
			correctShouldConvey: /independen|isolat|still.*proceed|own.*try.*catch|does.*not.*affect|separate/i,
		},
		{
			name: 'sync propagation path',
			topic: /sync.*path|propagat|WAL|electric.*sync|change.*data|how.*reach.*browser|how.*data.*get/i,
			correctShouldConvey: /WAL|electric|proxy|ShapeStream|TanStack|automatic|no.*explicit.*push/i,
		},
		{
			name: 'daemon simplicity',
			topic: /daemon.*pars|daemon.*lightweight|daemon.*NOT|raw.*text|parsing.*api|where.*pars/i,
			correctShouldConvey: /raw.*text|not.*pars|lightweight|one.*place|api.*pars|daemon.*send/i,
		},
	]

	function matchDataFlowMechanism(questionText: string) {
		return DATA_FLOW_MECHANISMS.find((m) => m.topic.test(questionText)) ?? null
	}

	test('generates questions with mermaid diagrams from data-flow-heavy input', async () => {
		const seed = `\n\n<!-- eval-run-${Date.now()}-${Math.random().toString(36).slice(2)} -->`
		const result = await generateLearnQuestions(DATA_FLOW_INPUT + seed)

		// --- structural checks ---
		expect(result.hasQuestions).toBe(true)
		const questions = result.questions!
		expect(questions.length).toBeGreaterThanOrEqual(3)
		expect(questions.length).toBeLessThanOrEqual(5)

		// Pretty-print all generated questions for manual review
		console.log(`\n${'═'.repeat(80)}`)
		console.log('  GENERATED QUESTIONS (data flow / mermaid)')
		console.log('═'.repeat(80))
		for (let qi = 0; qi < questions.length; qi++) {
			const q = questions[qi]!
			const mechanism = matchDataFlowMechanism(q.question)
			const trivia = isTriviaQuestion(q.question)
			const mech = isMechanismQuestion(q.question)

			console.log(`\n${'─'.repeat(80)}`)
			const hasCode = q.options.some((o) => /```/.test(o.label))
			const hasMermaid = q.options.some((o) => /```mermaid/.test(o.label))
			console.log(
				`  Q${qi + 1}  ${trivia ? '⚠ TRIVIA' : mech ? '✓ mechanism' : '○ other'}  ${hasMermaid ? '🧜 mermaid' : hasCode ? '📝 code' : ''}  ${mechanism ? `→ ${mechanism.name}` : ''}`,
			)
			console.log(`${'─'.repeat(80)}`)
			if (q.context) {
				console.log(`  context: ${q.context}`)
			}
			console.log(`  ${q.question}`)
			console.log('')
			for (let oi = 0; oi < q.options.length; oi++) {
				const marker = oi === q.correctIndex ? '✓' : '✗'
				const selected = oi === q.correctIndex ? ' ← correct' : ''
				console.log(`    ${marker} [${oi}] ${q.options[oi]!.label}${selected}`)
			}
			console.log('')
			console.log(`  explanation: ${q.explanation}`)
		}
		console.log(`\n${'═'.repeat(80)}`)
		const questionsWithMermaid = questions.filter((q) => q.options.some((o) => /```mermaid/.test(o.label))).length
		const questionsWithCode = questions.filter((q) => q.options.some((o) => /```/.test(o.label))).length
		console.log(
			`  SUMMARY: ${questions.length} questions | with-mermaid: ${questionsWithMermaid} | with-code: ${questionsWithCode} | trivia: ${questions.filter((q) => isTriviaQuestion(q.question)).length} | mechanism: ${questions.filter((q) => isMechanismQuestion(q.question)).length} | matched: ${questions.filter((q) => matchDataFlowMechanism(q.question)).length}`,
		)
		console.log(`${'═'.repeat(80)}\n`)

		// --- mermaid checks ---

		// At least one question should have mermaid diagrams in its options — the input
		// describes a multi-stage pipeline with clear data flows, which is the ideal
		// scenario for comparing diagrams
		expect(questionsWithMermaid).toBeGreaterThanOrEqual(1)

		// --- abstraction level checks ---
		const triviaCount = questions.filter((q) => isTriviaQuestion(q.question)).length
		expect(triviaCount).toBeLessThanOrEqual(1)

		const mechanismCount = questions.filter((q) => isMechanismQuestion(q.question)).length
		expect(mechanismCount).toBeGreaterThanOrEqual(Math.floor(questions.length / 2))

		// --- per-question structural checks ---
		for (const q of questions) {
			expect(q.options.length).toBeGreaterThanOrEqual(2)
			expect(q.options.length).toBeLessThanOrEqual(4)
			expect(q.correctIndex).toBeGreaterThanOrEqual(0)
			expect(q.correctIndex).toBeLessThan(q.options.length)
			expect(q.question.length).toBeGreaterThan(20)
			expect(q.explanation.length).toBeGreaterThan(30)

			const correctAnswer = q.options[q.correctIndex]!.label
			const wrongAnswers = q.options.filter((_, i) => i !== q.correctIndex).map((o) => o.label)
			for (const opt of q.options) {
				expect(opt.label.length).toBeGreaterThan(0)
			}
			for (const wrong of wrongAnswers) {
				expect(correctAnswer).not.toBe(wrong)
			}
		}

		// --- mechanism matching: at least 2 questions should target known data flow mechanisms ---
		let matchedMechanisms = 0
		for (const q of questions) {
			const mechanism = matchDataFlowMechanism(q.question)
			if (mechanism) {
				matchedMechanisms++
				const correctAnswer = q.options[q.correctIndex]!.label
				const conveys = mechanism.correctShouldConvey.test(correctAnswer)
				if (!conveys) {
					const explanation = q.explanation
					expect(conveys || mechanism.correctShouldConvey.test(explanation)).toBe(true)
				}
			}
		}
		expect(matchedMechanisms).toBeGreaterThanOrEqual(2)
	})
})
