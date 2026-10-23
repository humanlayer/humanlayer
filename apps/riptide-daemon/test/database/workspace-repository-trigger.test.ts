import { ActorSystemDefault } from '@humanlayer/effect-machine'
import type { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { createORPCClient, type ClientLink } from '@orpc/client'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer, Ref, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { ORPCClient } from '@/agents/claudecode/types'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'
import { WorkspaceRepositorySetupActorsLive } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.layer'
import { WorkspaceRepositorySetupActors } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.service'
import { WorkspaceRepositorySetupChanges } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-changes'

import { getWorkspaceRepositoryStatusProcedure as liveGet } from '../../../riptide-api/src/orpc/daemon/project-workspaces/get-repository-status.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../../../riptide-api/test/mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
} from '../../../riptide-api/test/utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../../../riptide-api/test/utils/external-test-services'
import { createTestDb } from '../../../riptide-api/test/utils/test-db'
import { UnusedRepositoryRequirements } from '../helpers/unused-repository-requirements'
import { remainingWorkspaceSetupOperationStubs } from '../helpers/workspace-repository-snapshot'

await requireExternalTestServices()

const advance = (
	snapshot: WorkspaceRepositoryActorSnapshot,
	status: WorkspaceRepositoryActorSnapshot['status']['status'],
) => ({
	...snapshot,
	status: {
		...snapshot.status,
		status,
		updatedAt: snapshot.status.updatedAt + 1,
		resolvedCommit:
			status === 'materializing' || status === 'done' ? (snapshot.status.resolvedCommit ?? 'a'.repeat(40)) : null,
	},
})

describe('workspace repository database trigger', () => {
	let db: PostgresJsDatabase
	let cleanupDb: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('workspace-repository-trigger')
		db = testDb.db
		cleanupDb = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupDb?.()
	}, 30_000)

	test('starts the expected real actor tasks from a directly inserted status row', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/database-trigger-target',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/database-trigger.git',
					repositoryIdentity: 'github.com/humanlayer/database-trigger',
					sourcePath: '/tmp/database-trigger-source',
				},
			],
		})
		const context = createMockDaemonContext({
			auth: createMockDaemonAuth({
				organizationId: fixture.organizationId,
				userId: fixture.userId,
				hostId: fixture.hostId,
			}),
			services: { db, dbReadReplica: db },
		})
		const get = bindProcedureToRuntime(liveGet, runtime!)
		const link: ClientLink<Record<never, never>> = {
			call: (path, input) =>
				path.join('.') === 'projectWorkspaces.getRepositoryStatus'
					? call(get, input as never, { context })
					: Promise.reject(new Error(`Unexpected daemon API call: ${path.join('.')}`)),
		}
		const calls = await Effect.runPromise(Ref.make<ReadonlyArray<string>>([]))
		const scripted =
			(name: string, status: WorkspaceRepositoryActorSnapshot['status']['status']) =>
			(snapshot: WorkspaceRepositoryActorSnapshot) =>
				Ref.update(calls, (seen) => [...seen, name]).pipe(Effect.as(advance(snapshot, status)))
		const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
			...remainingWorkspaceSetupOperationStubs,
			start: scripted('start', 'checking_source'),
			checkSource: scripted('checkSource', 'refreshing_source'),
			refreshSource: scripted('refreshSource', 'resolving_commit'),
			resolveCommit: scripted('resolveCommit', 'materializing'),
			materialize: scripted('materialize', 'done'),
		})
		const ApiLive = DaemonApiLive(createORPCClient<ORPCClient>(link))
		const ActorsLive = WorkspaceRepositorySetupActorsLive.pipe(
			Layer.provide(Layer.succeed(WorkspaceRepositorySetupChanges, { changes: Stream.never })),
			Layer.provideMerge(
				Layer.mergeAll(ApiLive, OperationsTest, ActorSystemDefault, UnusedRepositoryRequirements),
			),
		)

		await Effect.runPromise(
			Effect.gen(function* () {
				const actors = yield* WorkspaceRepositorySetupActors
				yield* Effect.forEach(
					fixture.repositories,
					({ repositoryIdentity }) =>
						actors.enqueue({
							projectId: fixture.projectId,
							workspaceId: fixture.workspaceId,
							repositoryIdentity,
						}),
					{ concurrency: 'unbounded', discard: true },
				)
			}).pipe(Effect.provide(ActorsLive)),
		)

		expect(await Effect.runPromise(Ref.get(calls))).toEqual([
			'start',
			'checkSource',
			'refreshSource',
			'resolveCommit',
			'materialize',
		])
	})
})
