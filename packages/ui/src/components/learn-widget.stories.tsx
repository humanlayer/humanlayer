import type { Meta, StoryObj } from '@storybook/react'
import type { LearnQuestion } from '@humanlayer/db/zodschemas/learn-questions'
import { LearnWidget } from './learn-widget'

const MOCK_QUESTIONS: LearnQuestion[] = [
	// --- Mechanism questions (mid-level) ---
	{
		question:
			'Why does the fire-and-forget pattern pass the top-level `db` handle instead of the transaction handle `tx` to the async function?',
		context: 'The riptide-api uses post-transaction async work for expensive AI calls.',
		options: [
			{
				label:
					'The transaction has already committed and the `tx` handle is invalid — using it would throw a "cannot use a pool client after calling release" error',
			},
			{
				label:
					'The top-level `db` handle has special permissions that the transaction handle lacks',
			},
			{
				label:
					'The transaction handle is read-only and cannot perform UPDATE operations',
			},
			{
				label:
					'Passing the transaction handle would cause the transaction to remain open indefinitely',
			},
		],
		correctIndex: 0,
		explanation:
			'After a transaction commits, the `tx` handle is released back to the pool and becomes invalid. The async function needs a fresh connection from the pool, which is what the top-level `db` handle provides. Using `tx` after commit would throw an error because the connection has been released.',
	},
	{
		question:
			'What race condition does passing data as arguments (rather than re-querying) prevent?',
		options: [
			{
				label:
					'Another request could modify the row between the transaction commit and when the async function reads it, causing the async function to process stale or incorrect data',
			},
			{
				label:
					'Multiple async functions could attempt to query the same row simultaneously, causing a database deadlock',
			},
			{
				label:
					'The database connection pool could be exhausted by too many simultaneous queries',
			},
			{
				label:
					'The async function could read uncommitted data from other transactions',
			},
		],
		correctIndex: 0,
		explanation:
			'By passing data as arguments from the transaction result, the async function is guaranteed to work with the exact data that was committed. If it re-queried the database, another request could have modified that row in the time between commit and query.',
	},
	// --- Code-heavy question (markdown with fenced code blocks in options) ---
	{
		question:
			'How should errors be handled in a fire-and-forget async function?',
		context: 'Consider this pattern where an async function is called without awaiting.',
		options: [
			{
				label:
					'Wrap all work in try/catch, log and report errors to Sentry, but never re-throw:\n```typescript\ntry {\n  const result = await generateSomething(content)\n  await db.update(artifacts).set({ extracted: result })\n} catch (err) {\n  logger.error({ err, artifactId }, \'Extraction failed\')\n  Sentry.captureException(err)\n  // Do NOT re-throw\n}\n```',
			},
			{
				label:
					'Let errors propagate naturally so they can be caught by a global error handler:\n```typescript\nconst result = await generateSomething(content)\nawait db.update(artifacts).set({ extracted: result })\n// No try/catch needed\n```',
			},
			{
				label:
					'Re-throw errors after logging so the caller can handle them:\n```typescript\ntry {\n  const result = await generateSomething(content)\n  await db.update(artifacts).set({ extracted: result })\n} catch (err) {\n  logger.error({ err }, \'Extraction failed\')\n  throw err // Re-throw for caller\n}\n```',
			},
			{
				label:
					'Return error objects instead of throwing:\n```typescript\nconst result = await generateSomething(content)\nif (result.error) {\n  return { success: false, error: result.error }\n}\n```',
			},
		],
		correctIndex: 0,
		explanation:
			'Since the async function is not awaited (fire-and-forget), there is no caller to catch errors. If an error is thrown or left unhandled, it becomes an unhandled promise rejection, which can crash the entire Node.js/Bun process. The function must catch all errors internally, log them for debugging, report to Sentry, but never re-throw.',
	},
	// --- Guard conditions / idempotency ---
	{
		question:
			'What is the purpose of guard conditions before firing the async function?',
		options: [
			{
				label:
					'To check both applicability (is this the right type of data?) and idempotency (has this work already been done?) so the expensive operation runs at most once',
			},
			{
				label:
					'To validate user permissions before performing expensive AI operations',
			},
			{
				label:
					'To ensure the database transaction has fully committed before starting async work',
			},
			{
				label:
					'To rate-limit AI API calls and prevent exceeding quota limits',
			},
		],
		correctIndex: 0,
		explanation:
			'Guard conditions serve two purposes: (1) Applicability checks ensure the async work only runs for relevant data (e.g., only research-type artifacts), and (2) Idempotency checks prevent duplicate work by verifying the result doesn\'t already exist. This means if an artifact is upserted again, the extraction only runs once.',
	},
	// --- Code comparison question (fire-and-forget pattern) ---
	{
		question:
			'What is the correct pattern for fire-and-forget async work after a database transaction?',
		context: 'The riptide-api runs expensive AI calls after transactions commit without blocking the response.',
		options: [
			{
				label:
					'Pass top-level `db` and data as arguments, no `await`:\n```ts\nconst txResult = await db.transaction(async (tx) => {\n  return { id, content }\n})\nrunExtractionAsync(db, txResult.id, txResult.content)\nreturn { success: true }\n```',
			},
			{
				label:
					'Await the async function to ensure completion:\n```ts\nconst txResult = await db.transaction(async (tx) => {\n  return { id, content }\n})\nawait runExtractionAsync(db, txResult.id, txResult.content)\nreturn { success: true }\n```',
			},
			{
				label:
					'Pass the `tx` handle for consistency:\n```ts\nawait db.transaction(async (tx) => {\n  const data = await tx.insert(artifacts).values(input).returning()\n  runExtractionAsync(tx, data.id, data.content)\n  return data\n})\n```',
			},
		],
		correctIndex: 0,
		explanation:
			'The async function is called without await (fire-and-forget) so the HTTP response returns immediately. It receives the top-level db handle because the tx handle is invalid after the transaction commits.',
	},
	// --- CSS mechanism question with short code blocks ---
	{
		question:
			'Nested flex containers in the session page break scrolling without a specific CSS trick. Which pattern enables overflow scrolling in a flex child?',
		context:
			'The session detail page locks to viewport height with h-dvh and uses cascading flex containers.',
		options: [
			{ label: '```css\nflex-1 min-h-0    /* parent */\noverflow-y-auto   /* child */\n```' },
			{ label: '```css\nflex-1 h-full     /* parent */\noverflow-y-scroll /* child */\n```' },
			{ label: '```css\nflex-1 shrink-0   /* parent */\noverflow: hidden   /* child */\n```' },
		],
		correctIndex: 0,
		explanation:
			'Without min-h-0, flex items default to min-height: auto which prevents shrinking below content height and breaks overflow scrolling. This is the critical pattern used throughout the session layout.',
	},
	// --- Dynamic import / lazy load ---
	{
		question:
			'Why does the async function use dynamic `import()` for AI SDK dependencies?',
		options: [
			{
				label:
					'AI SDK packages are large, and dynamic import lazy-loads them only when extraction runs, keeping the main handler\'s cold start time fast',
			},
			{
				label:
					'Dynamic imports allow the code to gracefully handle missing dependencies in development environments',
			},
			{
				label:
					'The AI SDK must be loaded asynchronously to prevent blocking the event loop during initialization',
			},
			{
				label:
					'Dynamic imports enable hot-reloading of AI models without restarting the server',
			},
		],
		correctIndex: 0,
		explanation:
			'The AI SDK packages (`@ai-sdk/anthropic`, `ai`) are heavy dependencies that increase module load time. By using dynamic `import()`, these packages are only loaded when the async extraction function actually runs — not when the main handler loads. This keeps the initial handler cold start fast.',
	},
	// --- Mermaid diagram in options ---
	{
		question:
			'Which diagram correctly represents the event flow when a user submits a form that triggers both a database write and an async notification?',
		context: 'The system uses fire-and-forget for notifications after the transaction commits.',
		options: [
			{
				label:
					'Transaction commits first, then notification fires async:\n```mermaid\nsequenceDiagram\n    participant U as User\n    participant API as API Handler\n    participant DB as Database\n    participant N as Notification\n\n    U->>API: Submit form\n    API->>DB: BEGIN transaction\n    DB-->>API: Committed\n    API-->>U: 200 OK\n    API-)N: Fire-and-forget\n    N->>N: Send email\n```',
			},
			{
				label:
					'Notification fires inside the transaction:\n```mermaid\nsequenceDiagram\n    participant U as User\n    participant API as API Handler\n    participant DB as Database\n    participant N as Notification\n\n    U->>API: Submit form\n    API->>DB: BEGIN transaction\n    API->>N: Send email\n    N-->>API: Sent\n    DB-->>API: Committed\n    API-->>U: 200 OK\n```',
			},
			{
				label:
					'Response waits for notification to complete:\n```mermaid\nsequenceDiagram\n    participant U as User\n    participant API as API Handler\n    participant DB as Database\n    participant N as Notification\n\n    U->>API: Submit form\n    API->>DB: BEGIN transaction\n    DB-->>API: Committed\n    API->>N: Send email\n    N-->>API: Sent\n    API-->>U: 200 OK\n```',
			},
		],
		correctIndex: 0,
		explanation:
			'The fire-and-forget pattern means the API responds immediately after the transaction commits, then kicks off the notification without awaiting it. This keeps response times fast while ensuring data is persisted before side effects run.',
	},
	// --- Simple text question ---
	{
		question:
			'When the sidebar forward-cycles with the "s" hotkey and reaches the last tab, what happens next?',
		options: [
			{ label: 'Wraps around to the minimap tab' },
			{ label: 'The sidebar hides entirely' },
			{ label: 'Stays on the last tab (no-op)' },
			{ label: 'Toggles to full-width panel mode' },
		],
		correctIndex: 1,
		explanation:
			'The forward cycle goes minimap → artifacts → todos → summary → hidden. Pressing "s" again from hidden re-opens at minimap. Tabs without data are skipped.',
	},
]

const meta = {
	title: 'Components/LearnWidget',
	component: LearnWidget,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[70%] min-w-[600px] h-[700px] p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof LearnWidget>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: { questions: MOCK_QUESTIONS },
}

export const SingleQuestion: Story = {
	args: { questions: [MOCK_QUESTIONS[0]] },
}

/** Long code blocks in each option — tests that syntax highlighting, scrolling, and layout all work at sidebar width */
export const CodeBlocksInOptions: Story = {
	args: { questions: [MOCK_QUESTIONS[2]] },
}

/** Side-by-side code comparison — 3 options each with fenced TS code blocks */
export const CodeComparisonPattern: Story = {
	args: { questions: [MOCK_QUESTIONS[4]] },
}

/** Short CSS code snippets in options */
export const ShortCodeSnippets: Story = {
	args: { questions: [MOCK_QUESTIONS[5]] },
}

/** Mermaid sequence diagrams rendered inside answer options */
export const MermaidDiagramsInOptions: Story = {
	args: { questions: [MOCK_QUESTIONS[7]] },
}

/** Mix of text-only and code-heavy questions to check transitions */
export const MixedFormats: Story = {
	args: {
		questions: [
			MOCK_QUESTIONS[0], // text-only mechanism
			MOCK_QUESTIONS[2], // long code blocks
			MOCK_QUESTIONS[4], // code comparison
			MOCK_QUESTIONS[8], // text-only simple
		],
	},
}

export const Empty: Story = {
	args: { questions: [] },
}
