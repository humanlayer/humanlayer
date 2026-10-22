import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { runClaudeTaskDiffCaptureFixture } from './helpers/claude-task-diff-capture-fixture'

describe('Claude subagent task diff capture integration', () => {
	it.effect('publishes edits from the SDK subagent PostToolUse path', () =>
		Effect.gen(function* () {
			const { files, versions } = yield* Effect.promise(() => runClaudeTaskDiffCaptureFixture('fixture-subagent'))

			expect(files.map((file) => file.path).sort()).toEqual(['added.txt', 'modified.txt'])
			// Two files, then a later edit to added.txt.
			expect(versions).toHaveLength(3)
			expect(files.every((file) => file.sessionId === 'session-fixture')).toBe(true)
		}),
	)
})
