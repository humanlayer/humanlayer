import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useState } from 'react'

import { ConversationEventRow } from '../ConversationEventRow'

export type CodeBlockAccentScenario = 'single-event' | 'mock-stream' | 'typescript-code'

interface ConversationCodeBlockAccentShellDemoProps {
	scenario?: CodeBlockAccentScenario
}

const assistantSummary = `Fixed, committed, and pushed.

- Commit: \`bd3f3c854 fix(riptide-daemon): stop polling for task diff drain\`
- Branch: \`origin/daemon-performance-issues\`
- Checks passed: daemon typecheck, quality, and 9 task-diff tests

The daemon now waits on an Effect \`Deferred\` instead of repeatedly reading the \`Ref\`.

## Next Highest-Leverage Fix

Stop rebuilding patches for files that have not changed since the last capture.

Today:

\`\`\`text
Task has 100 modified files
Tool changes 1 file
        |
        v
Daemon rebuilds 100 patches
Tool changes another file
        |
        v
Daemon rebuilds 100 patches again
\`\`\`

The daemon already knows which files changed since the last capture. It just does not use that information when deciding which patches to rebuild.

We should change it to:

\`\`\`text
Task has 100 modified files
Tool changes 1 file
        |
        v
Daemon rebuilds 1 patch
\`\`\``

const singleEvent: ConversationEvent = {
	id: 'assistant-code-block-accent',
	sessionId: 'storybook-code-block-accent',
	eventType: 'message',
	role: 'assistant',
	content: assistantSummary,
	createdAt: new Date('2026-08-14T18:00:00'),
}

const typescriptCodeEvent: ConversationEvent = {
	id: 'assistant-typescript-code-block-accent',
	sessionId: 'storybook-code-block-accent',
	eventType: 'message',
	role: 'assistant',
	content: `The changed-file list already has the information needed to avoid rebuilding unchanged patches.

\`\`\`ts
type FileSnapshot = {
  path: string
  content: string
}

const rebuildChangedPatches = (snapshots: FileSnapshot[], changedPaths: Set<string>) =>
  snapshots.filter((snapshot) => changedPaths.has(snapshot.path))
\`\`\`

Only the paths captured after the previous snapshot should reach the patch builder.`,
	createdAt: new Date('2026-08-14T18:00:00'),
}

const streamEvents: ConversationEvent[] = [
	{
		id: 'user-code-block-accent',
		sessionId: 'storybook-code-block-accent',
		eventType: 'message',
		role: 'user',
		content: 'Find the highest-leverage fix for the daemon task-diff performance issue.',
		createdAt: new Date('2026-08-14T17:58:00'),
	},
	singleEvent,
	{
		id: 'assistant-follow-up-code-block-accent',
		sessionId: 'storybook-code-block-accent',
		eventType: 'message',
		role: 'assistant',
		content:
			'The next implementation should capture the changed file paths and pass them into the patch rebuild step.',
		createdAt: new Date('2026-08-14T18:01:00'),
	},
]

export function ConversationCodeBlockAccentShellDemo({
	scenario = 'single-event',
}: ConversationCodeBlockAccentShellDemoProps) {
	const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
	const events =
		scenario === 'single-event'
			? [singleEvent]
			: scenario === 'typescript-code'
				? [typescriptCodeEvent]
				: streamEvents

	return (
		<div className="mx-auto max-w-5xl border border-border bg-background">
			{events.map((event) => (
				<ConversationEventRow
					key={event.id}
					event={event}
					isFocused={focusedEventId === event.id}
					workingDir="/Users/dev/riptide"
					onFocusChange={(eventId) => setFocusedEventId(eventId)}
					shouldIgnoreMouseEvent={() => false}
					onCopy={() => undefined}
				/>
			))}
		</div>
	)
}
