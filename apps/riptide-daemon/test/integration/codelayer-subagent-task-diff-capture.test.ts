import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { runCodelayerTaskDiffCaptureFixture } from './helpers/codelayer-task-diff-capture-fixture'

describe('CodeLayer subagent task diff capture integration', () => {
	it.effect('propagates PostToolUse capture into a real AgentLayer child agent', () =>
		Effect.gen(function* () {
			const { files, versions } = yield* Effect.promise(() =>
				runCodelayerTaskDiffCaptureFixture('write', { throughSubagent: true }),
			)

			expect(files.map((file) => file.path)).toEqual(['subagent-write.txt'])
			expect(files[0]?.sessionId).toBe('session-fixture')
			expect(versions).toHaveLength(1)
			expect(versions[0]?.content).toContain('added by CodeLayer subagent')
		}),
	)
})
