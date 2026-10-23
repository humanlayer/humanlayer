import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
	runCodelayerTaskDiffCaptureFixture,
	type CodelayerCaptureTool,
} from './helpers/codelayer-task-diff-capture-fixture'

const cases: ReadonlyArray<{ readonly toolName: CodelayerCaptureTool; readonly expectedPath: string }> = [
	{ toolName: 'write', expectedPath: 'write.txt' },
	{ toolName: 'edit', expectedPath: 'modified.txt' },
	{ toolName: 'apply_patch', expectedPath: 'apply-patch.txt' },
	{ toolName: 'bash', expectedPath: 'bash.txt' },
]

describe('CodeLayer task diff capture integration', () => {
	for (const { toolName, expectedPath } of cases) {
		it.effect(`publishes ${toolName} changes to local Durable Streams`, () =>
			Effect.gen(function* () {
				const { files, versions } = yield* Effect.promise(() => runCodelayerTaskDiffCaptureFixture(toolName))

				expect(files.map((file) => file.path)).toEqual([expectedPath])
				expect(files[0]?.sessionId).toBe('session-fixture')
				expect(versions).toHaveLength(1)
				expect(versions[0]?.id).toBe(files[0]?.versionId)
				expect(versions[0]?.content).toContain('CodeLayer')
			}),
		)
	}

	it.effect('keeps environment files out of every real Durable Stream', () =>
		Effect.gen(function* () {
			const { files, versions } = yield* Effect.promise(() =>
				runCodelayerTaskDiffCaptureFixture('write', { includeEnvironmentFile: true }),
			)

			expect(files.map((file) => file.path)).toEqual(['write.txt'])
			expect(versions).toHaveLength(1)
			expect(versions[0]?.id).toBe(files[0]?.versionId)
			expect(versions[0]?.content).toContain('added by CodeLayer write')
			expect(versions[0]?.path).not.toContain('.env.integration')
			expect(versions[0]?.content).not.toContain('INTEGRATION_SECRET')
			expect(versions[0]?.content).not.toContain('excluded-value')
		}),
	)
})
