import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Queue, Stream } from 'effect'

import { makeWorkspaceRepositorySetupChangesStream } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-changes'

describe('workspace repository Electric changes', () => {
	it.effect('includes initial state, observes retry updates, filters terminal rows, and unsubscribes', () =>
		Effect.gen(function* () {
			const subscribed = yield* Queue.unbounded<void>()
			type Collection = Parameters<typeof makeWorkspaceRepositorySetupChangesStream>[0]
			let listener: Parameters<Collection['subscribeChanges']>[0] = () => undefined
			let unsubscribed = false
			const row = {
				project_id: 'project',
				workspace_id: 'workspace',
				repository_identity: 'github.com/org/repo',
				status: 'setup_requested' as const,
				error: null,
			}
			const stream = makeWorkspaceRepositorySetupChangesStream({
				subscribeChanges: (callback, options) => {
					listener = callback
					expect(options.includeInitialState).toBe(true)
					callback([{ type: 'insert', value: row }])
					Queue.offerUnsafe(subscribed, undefined)
					return {
						unsubscribe: () => {
							unsubscribed = true
						},
					}
				},
			})
			const fiber = yield* stream.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
			yield* Queue.take(subscribed)
			listener([
				{ type: 'delete', value: { ...row, workspace_id: 'deleted' } },
				{ type: 'update', value: { ...row, workspace_id: 'done', status: 'done' } },
				{
					type: 'update',
					value: { ...row, workspace_id: 'parked', error: { stage: 'checking_source', message: 'parked' } },
				},
				{ type: 'update', value: { ...row, status: 'materializing' } },
			])
			const values = yield* Fiber.join(fiber)
			expect(values).toEqual([
				{
					projectId: row.project_id,
					workspaceId: row.workspace_id,
					repositoryIdentity: row.repository_identity,
				},
				{
					projectId: row.project_id,
					workspaceId: row.workspace_id,
					repositoryIdentity: row.repository_identity,
				},
			])
			expect(unsubscribed).toBe(true)
		}),
	)
})
