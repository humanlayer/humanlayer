import { workspaceLocationsForUserForHost } from '@humanlayer/db/tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import type { WorkspaceRepositorySetupResult } from '@humanlayer/schemas/effect/project-workspace'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getWorkspaceRepositoryStatusProcedure as liveGet } from '../../src/orpc/daemon/project-workspaces/get-repository-status.effect'
import { advanceRepositorySetupStageProcedure as liveReport } from '../../src/orpc/daemon/project-workspaces/report-repository-result.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('workspace repository progress', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let get: typeof liveGet
	let report: typeof liveReport

	beforeAll(async () => {
		const testDb = await createTestDb('workspace-repository-progress')
		db = testDb.db
		cleanup = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
		get = bindProcedureToRuntime(liveGet, runtime)
		report = bindProcedureToRuntime(liveReport, runtime)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	const contextFor = (fixture: Awaited<ReturnType<typeof createFilesystemWorkspaceActorFixture>>) =>
		createMockDaemonContext({
			auth: createMockDaemonAuth({
				organizationId: fixture.organizationId,
				userId: fixture.userId,
				hostId: fixture.hostId,
			}),
			services: { db, dbReadReplica: db },
		})

	const readFixtureStatuses = (fixture: Awaited<ReturnType<typeof createFilesystemWorkspaceActorFixture>>) =>
		Promise.all(
			fixture.repositories.map(
				async ({ repositoryIdentity }) =>
					(
						await call(
							get,
							{ projectId: fixture.projectId, workspaceId: fixture.workspaceId, repositoryIdentity },
							{ context: contextFor(fixture) },
						)
					).repositoryStatus,
			),
		)

	test('gets the current repository status for the authenticated user and host', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/original-workspace-target',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/current-status.git',
					repositoryIdentity: 'github.com/humanlayer/current-status',
					sourcePath: '/tmp/source',
				},
			],
		})
		const input = {
			projectId: fixture.projectId,
			workspaceId: fixture.workspaceId,
			repositoryIdentity: 'github.com/humanlayer/current-status',
		}

		await db
			.update(workspaceLocationsForUserForHost)
			.set({ file_path: '/tmp/current-workspace-target', setup_generation: 2n })
			.where(eq(workspaceLocationsForUserForHost.workspace_id, fixture.workspaceId))
		await db
			.update(workspaceRepositoryStatusForUserForHost)
			.set({ status: 'materializing', generation: 2n, resolved_commit: 'a'.repeat(40) })
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))

		const result = await call(get, input, { context: contextFor(fixture) })
		expect(result.repositoryStatus.location).toMatchObject({
			filePath: '/tmp/current-workspace-target',
			setupGeneration: 2,
		})
		expect(result.repositoryStatus.status).toMatchObject({ status: 'materializing', generation: 2 })

		const otherHost = createMockDaemonContext({
			auth: createMockDaemonAuth({
				organizationId: fixture.organizationId,
				userId: fixture.userId,
				hostId: 'other-host',
			}),
			services: { db, dbReadReplica: db },
		})
		await expect(call(get, input, { context: otherHost })).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('conditionally commits the Phase 4 transition sequence and pins the workspace commit once', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/workspace-target',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/effect-machine.git',
					repositoryIdentity: 'github.com/humanlayer/effect-machine',
					sourcePath: '/tmp/source',
					branch: 'workspace-test',
				},
			],
		})
		const context = contextFor(fixture)
		let snapshot = (await readFixtureStatuses(fixture))[0]!
		const send = async (result: WorkspaceRepositorySetupResult) => {
			const response = await call(
				report,
				{
					projectId: fixture.projectId,
					workspaceId: fixture.workspaceId,
					repositoryIdentity: snapshot.status.repositoryIdentity,
					generation: snapshot.status.generation,
					expectedUpdatedAt: snapshot.status.updatedAt,
					result,
				},
				{ context },
			)
			expect(response.snapshot.status.updatedAt).toBeGreaterThan(snapshot.status.updatedAt)
			snapshot = response.snapshot
		}

		await send({ _tag: 'SetupStarted' })
		expect(snapshot.status.status).toBe('checking_source')
		await send({ _tag: 'SourceChecked', repoAvailable: true, sourceKind: 'filesystem', sourcePath: '/tmp/source' })
		expect(snapshot.status.status).toBe('refreshing_source')
		await send({ _tag: 'SourceRefreshed', sourceKind: 'filesystem', sourcePath: '/tmp/source' })
		expect(snapshot.status.status).toBe('resolving_commit')
		const commit = 'a'.repeat(40)
		await send({ _tag: 'CommitResolved', resolvedCommit: commit })
		expect(snapshot.status).toMatchObject({ status: 'materializing', resolvedCommit: commit })
		await send({
			_tag: 'WorktreeMaterialized',
			materialization: { kind: 'worktree', path: '/tmp/workspace-target', branch: 'workspace-test' },
		})
		expect(snapshot.status.status).toBe('copying_files')
		await send({ _tag: 'FilesCopied', result: { copiedFiles: ['.env'], completedAt: 10 } })
		expect(snapshot.status).toMatchObject({
			status: 'running_setup_command',
			copyResult: { copiedFiles: ['.env'] },
		})
		await send({
			_tag: 'SetupCommandFinished',
			result: {
				command: 'bun install',
				exitCode: 0,
				stdoutLogPath: '/tmp/setup.stdout.log',
				stderrLogPath: '/tmp/setup.stderr.log',
				completedAt: 20,
			},
		})
		expect(snapshot.status.status).toBe('done')

		const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, fixture.workspaceId))
		expect(workspace?.repositories[0]?.baseCommit).toBe(commit)
	})

	test('serializes concurrent commit pins for sibling repositories', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/concurrent-pin-target',
			status: 'resolving_commit',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/syncopate.git',
					repositoryIdentity: 'github.com/humanlayer/syncopate',
					sourcePath: '/tmp/concurrent-pin-source-a',
				},
				{
					remoteUrl: 'https://github.com/humanlayer/agentlayer.git',
					repositoryIdentity: 'github.com/humanlayer/agentlayer',
					sourcePath: '/tmp/concurrent-pin-source-b',
					default: false,
				},
			],
		})
		const context = contextFor(fixture)
		const snapshots = await readFixtureStatuses(fixture)
		const commits = new Map([
			['github.com/humanlayer/syncopate', 'a'.repeat(40)],
			['github.com/humanlayer/agentlayer', 'b'.repeat(40)],
		])

		await Promise.all(
			snapshots.map((snapshot) => {
				const resolvedCommit = commits.get(snapshot.status.repositoryIdentity)
				if (!resolvedCommit) throw new Error(`Missing test commit for ${snapshot.status.repositoryIdentity}`)
				return call(
					report,
					{
						projectId: fixture.projectId,
						workspaceId: fixture.workspaceId,
						repositoryIdentity: snapshot.status.repositoryIdentity,
						generation: snapshot.status.generation,
						expectedUpdatedAt: snapshot.status.updatedAt,
						result: {
							_tag: 'CommitResolved',
							resolvedCommit,
						},
					},
					{ context },
				)
			}),
		)

		const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, fixture.workspaceId))
		expect(
			Object.fromEntries(
				(workspace?.repositories ?? []).map((repository) => [
					repository.repositoryIdentity,
					repository.baseCommit,
				]),
			),
		).toEqual(Object.fromEntries(commits))
	})

	test('persists the managed clone request and readiness transitions', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/managed-transition-target',
			status: 'checking_source',
			repositories: [
				{
					remoteUrl: 'git@github.com:humanlayer/syncopate.git',
					repositoryIdentity: 'github.com/humanlayer/syncopate',
					sourcePath: '/tmp/missing-source',
				},
			],
		})
		const context = contextFor(fixture)
		let snapshot = (await readFixtureStatuses(fixture))[0]!
		const sourcePath = '/home/test/.humanlayer/repos/humanlayer/syncopate'
		const cloning = await call(
			report,
			{
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				repositoryIdentity: snapshot.status.repositoryIdentity,
				generation: snapshot.status.generation,
				expectedUpdatedAt: snapshot.status.updatedAt,
				result: { _tag: 'ManagedCloneRequested', sourcePath },
			},
			{ context },
		)
		expect(cloning.snapshot.status).toMatchObject({
			status: 'cloning_source',
			repoAvailable: false,
			sourceKind: 'managed_clone',
			sourcePath,
		})
		snapshot = cloning.snapshot

		const ready = await call(
			report,
			{
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				repositoryIdentity: snapshot.status.repositoryIdentity,
				generation: snapshot.status.generation,
				expectedUpdatedAt: snapshot.status.updatedAt,
				result: { _tag: 'ManagedCloneReady', sourcePath },
			},
			{ context },
		)
		expect(ready.snapshot.status).toMatchObject({
			status: 'refreshing_source',
			repoAvailable: true,
			sourceKind: 'managed_clone',
			sourcePath,
		})
	})

	test('returns the current snapshot for a stale progress write and preserves sibling rows', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/multi-target',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/syncopate.git',
					repositoryIdentity: 'github.com/humanlayer/syncopate',
					sourcePath: '/tmp/source-a',
				},
				{
					remoteUrl: 'https://github.com/humanlayer/effect-machine.git',
					repositoryIdentity: 'github.com/humanlayer/effect-machine',
					sourcePath: '/tmp/source-b',
					default: false,
				},
			],
		})
		const context = contextFor(fixture)
		const snapshots = await readFixtureStatuses(fixture)
		const first = snapshots[0]!

		await expect(
			call(
				report,
				{
					projectId: fixture.projectId,
					workspaceId: fixture.workspaceId,
					repositoryIdentity: first.status.repositoryIdentity,
					generation: first.status.generation,
					expectedUpdatedAt: first.status.updatedAt,
					result: {
						_tag: 'SourceChecked',
						repoAvailable: true,
						sourceKind: 'filesystem',
						sourcePath: '/tmp/source-a',
					},
				},
				{ context },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		const staleWrite = call(
			report,
			{
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				repositoryIdentity: first.status.repositoryIdentity,
				generation: first.status.generation,
				expectedUpdatedAt: first.status.updatedAt - 1,
				result: { _tag: 'SetupStarted' },
			},
			{ context },
		)
		await expect(staleWrite).rejects.toMatchObject({
			code: 'REPOSITORY_STATUS_CHANGED',
			data: { snapshot: { status: { updatedAt: first.status.updatedAt } } },
		})
		await expect(
			call(
				report,
				{
					projectId: fixture.projectId,
					workspaceId: fixture.workspaceId,
					repositoryIdentity: first.status.repositoryIdentity,
					generation: first.status.generation + 1,
					expectedUpdatedAt: first.status.updatedAt,
					result: { _tag: 'SetupStarted' },
				},
				{ context },
			),
		).rejects.toMatchObject({ code: 'REPOSITORY_STATUS_CHANGED' })

		const rows = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(
				and(
					eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId),
					eq(workspaceRepositoryStatusForUserForHost.status, 'setup_requested'),
				),
			)
		expect(rows).toHaveLength(2)
	})

	test('parks an exact-stage failure without advancing the durable status', async () => {
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/failed-target',
			status: 'checking_source',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/failed-source.git',
					repositoryIdentity: 'github.com/humanlayer/failed-source',
					sourcePath: '/tmp/missing-source',
				},
			],
		})
		const context = contextFor(fixture)
		const snapshot = (await readFixtureStatuses(fixture))[0]!
		const response = await call(
			report,
			{
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				repositoryIdentity: snapshot.status.repositoryIdentity,
				generation: snapshot.status.generation,
				expectedUpdatedAt: snapshot.status.updatedAt,
				result: {
					_tag: 'StageFailed',
					stage: 'checking_source',
					error: { stage: 'checking_source', message: 'source missing' },
				},
			},
			{ context },
		)
		expect(response.snapshot.status).toMatchObject({
			status: 'checking_source',
			error: { stage: 'checking_source', message: 'source missing' },
		})
		expect((await readFixtureStatuses(fixture))[0]?.status.error).toMatchObject({
			stage: 'checking_source',
			message: 'source missing',
		})
	})

	test('keeps the first workspace commit pin when a later resolver reports a different commit', async () => {
		const firstCommit = 'a'.repeat(40)
		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: '/tmp/pinned-target',
			status: 'resolving_commit',
			repositories: [
				{
					remoteUrl: 'https://github.com/humanlayer/pinned-source.git',
					repositoryIdentity: 'github.com/humanlayer/pinned-source',
					sourcePath: '/tmp/pinned-source',
					baseCommit: firstCommit,
				},
			],
		})
		const context = contextFor(fixture)
		const snapshot = (await readFixtureStatuses(fixture))[0]!
		const response = await call(
			report,
			{
				projectId: fixture.projectId,
				workspaceId: fixture.workspaceId,
				repositoryIdentity: snapshot.status.repositoryIdentity,
				generation: snapshot.status.generation,
				expectedUpdatedAt: snapshot.status.updatedAt,
				result: { _tag: 'CommitResolved', resolvedCommit: 'b'.repeat(40) },
			},
			{ context },
		)
		expect(response.snapshot.status.resolvedCommit).toBe(firstCommit)
		const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, fixture.workspaceId))
		expect(workspace?.repositories[0]?.baseCommit).toBe(firstCommit)
	})
})
