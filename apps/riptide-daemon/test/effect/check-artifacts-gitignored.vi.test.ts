import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

import { checkArtifactsGitignored } from '../../src/effects/check-artifacts-gitignored'
import { GitCommandFailedError } from '../../src/effects/services/task-diff/errors'
import { GitCommandRunner } from '../../src/effects/services/task-diff/git-command-runner.service'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'

const expectedArgv = ['check-ignore', '--quiet', '--no-index', '--', '.humanlayer/tasks']

describe('checkArtifactsGitignored', () => {
	it.effect('maps exit 0 to ignored and passes the exact command options', () => {
		const calls: Array<{
			argv: ReadonlyArray<string>
			opts: { cwd: string; okExitCodes?: ReadonlyArray<number> }
		}> = []
		const runner = Layer.succeed(GitCommandRunner, {
			run: (argv, opts) =>
				Effect.sync(() => {
					calls.push({ argv, opts })
					return { stdout: '', stderr: '', exitCode: 0 }
				}),
		})

		return Effect.gen(function* () {
			const status = yield* checkArtifactsGitignored({ cwd: '/worktree' })

			expect(status).toBe('ignored')
			expect(calls).toEqual([
				{
					argv: expectedArgv,
					opts: { cwd: '/worktree', okExitCodes: [0, 1] },
				},
			])
		}).pipe(Effect.provide(runner), Effect.provide(UnusedGitRequirements))
	})

	it.effect('maps exit 1 to not-ignored', () => {
		const runner = Layer.succeed(GitCommandRunner, {
			run: () => Effect.succeed({ stdout: '', stderr: '', exitCode: 1 }),
		})

		return Effect.gen(function* () {
			const status = yield* checkArtifactsGitignored({ cwd: '/worktree' })
			expect(status).toBe('not-ignored')
		}).pipe(Effect.provide(runner), Effect.provide(UnusedGitRequirements))
	})

	it.effect('keeps runner failures in the error channel', () => {
		const failure = new GitCommandFailedError({
			message: 'fatal git error',
			argv: expectedArgv,
			exitCode: 128,
			stderr: 'fatal git error',
		})
		const runner = Layer.succeed(GitCommandRunner, {
			run: () => Effect.fail(failure),
		})

		return Effect.gen(function* () {
			const error = yield* Effect.flip(checkArtifactsGitignored({ cwd: '/worktree' }))
			expect(error).toBe(failure)
		}).pipe(Effect.provide(runner), Effect.provide(UnusedGitRequirements))
	})
})
