import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { NodeServices } from '@effect/platform-node'
import { workspaceRepositoryStatusForUserForHost } from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import { workspaces } from '@humanlayer/db/tables/workspaces'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import { createFilesystemWorkspaceActorFixture } from '@humanlayer/test-fixtures/project-workspaces'
import { createORPCClient, type ClientLink } from '@orpc/client'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { ORPCClient } from '@/agents/claudecode/types'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunnerLive, GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { RepositorySourceResolverLive } from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'
import { WorkspaceRepositoryActorOperationsLive } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositorySetupActorsLive } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.layer'
import { WorkspaceRepositorySetupActors } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.service'
import { WorkspaceRepositorySetupChanges } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-changes'

import { getWorkspaceRepositoryStatusProcedure as liveGet } from '../../../riptide-api/src/orpc/daemon/project-workspaces/get-repository-status.effect'
import { advanceRepositorySetupStageProcedure as liveReport } from '../../../riptide-api/src/orpc/daemon/project-workspaces/report-repository-result.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../../../riptide-api/test/mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
} from '../../../riptide-api/test/utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../../../riptide-api/test/utils/external-test-services'
import { createTestDb } from '../../../riptide-api/test/utils/test-db'

await requireExternalTestServices()

const exec = promisify(execFile)

describe('workspace repository materialization boundary', () => {
	let db: PostgresJsDatabase
	let cleanupDb: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	const tempDirectories: string[] = []

	beforeAll(async () => {
		const testDb = await createTestDb('workspace-repository-materialization')
		db = testDb.db
		cleanupDb = testDb.cleanup
		runtime = createRuntimeWithTestPostgresLayer(db)
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
		await cleanupDb?.()
	}, 30_000)

	const materializeFixture = async (
		fixture: Awaited<ReturnType<typeof createFilesystemWorkspaceActorFixture>>,
		managedEnvironment?: { readonly home: string; readonly cacheRoot: string },
	) => {
		const context = createMockDaemonContext({
			auth: createMockDaemonAuth({
				organizationId: fixture.organizationId,
				userId: fixture.userId,
				hostId: fixture.hostId,
			}),
			services: { db, dbReadReplica: db },
		})
		const get = bindProcedureToRuntime(liveGet, runtime!)
		const report = bindProcedureToRuntime(liveReport, runtime!)
		const link: ClientLink<Record<never, never>> = {
			call: (path, input) => {
				switch (path.join('.')) {
					case 'projectWorkspaces.getRepositoryStatus':
						return call(get, input as never, { context })
					case 'projectWorkspaces.reportRepositoryResult':
						return call(report, input as never, { context })
					default:
						return Promise.reject(new Error(`Unexpected daemon API call: ${path.join('.')}`))
				}
			},
		}
		const ApiLive = DaemonApiLive(createORPCClient<ORPCClient>(link))
		const GitLive = Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
			Layer.provideMerge(NodeServices.layer),
			Layer.orDie,
		)
		const ConfigLive = managedEnvironment
			? ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						HOME: managedEnvironment.home,
						RIPTIDE_MANAGED_REPOSITORY_ROOT: managedEnvironment.cacheRoot,
					}),
				)
			: Layer.empty
		const ManagedCacheLive = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
			Layer.provideMerge(Layer.mergeAll(GitLive, NodeServices.layer, ConfigLive)),
		)
		const OperationsLive = WorkspaceRepositoryActorOperationsLive.pipe(
			Layer.provideMerge(
				Layer.mergeAll(ApiLive, GitLive, ManagedCacheLive, NodeServices.layer, RepositorySourceResolverLive),
			),
		)
		const ActorsLive = WorkspaceRepositorySetupActorsLive.pipe(
			Layer.provide(Layer.succeed(WorkspaceRepositorySetupChanges, { changes: Stream.never })),
			Layer.provideMerge(Layer.mergeAll(ApiLive, OperationsLive, ActorSystemDefault)),
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
	}

	test('uses the selected remote branches instead of stale local branches', async () => {
		const root = await mkdtemp(join(tmpdir(), 'workspace-repository-materialization-'))
		tempDirectories.push(root)
		const remote = join(root, 'remote.git')
		const source = join(root, 'source')
		const updater = join(root, 'updater')
		const target = join(root, 'target')
		const remoteUrl = 'https://github.com/humanlayer/workspace-fixture.git'
		const localRemoteUrl = 'git@github.com:humanlayer/workspace-fixture.git'
		await exec('git', ['init', '--bare', '--initial-branch=main', remote])
		await exec('git', ['init', '--initial-branch=main', source])
		await exec('git', ['-C', source, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', source, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(source, 'README.md'), 'stale local main\n')
		await exec('git', ['-C', source, 'add', 'README.md'])
		await exec('git', ['-C', source, 'commit', '-m', 'fixture'])
		await exec('git', ['-C', source, 'remote', 'add', 'selected', localRemoteUrl])
		await exec('git', ['-C', source, 'remote', 'add', 'broken', join(root, 'missing-remote.git')])
		await exec('git', ['-C', source, 'config', `url.${remote}.insteadOf`, localRemoteUrl])
		await exec('git', ['-C', source, 'push', 'selected', 'main'])

		await exec('git', ['clone', remote, updater])
		await exec('git', ['-C', updater, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', updater, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(updater, 'README.md'), 'current remote main\n')
		await exec('git', ['-C', updater, 'add', 'README.md'])
		await exec('git', ['-C', updater, 'commit', '-m', 'advance remote main'])
		await exec('git', ['-C', updater, 'push', 'origin', 'main'])
		const { stdout: baseHeadOutput } = await exec('git', ['-C', updater, 'rev-parse', 'HEAD'])
		const baseHead = baseHeadOutput.trim()
		await exec('git', ['-C', updater, 'switch', '-c', 'workspace-actor-test'])
		await writeFile(join(updater, 'README.md'), 'current remote workspace branch\n')
		await exec('git', ['-C', updater, 'add', 'README.md'])
		await exec('git', ['-C', updater, 'commit', '-m', 'advance workspace branch'])
		await exec('git', ['-C', updater, 'push', 'origin', 'workspace-actor-test'])
		const { stdout: workspaceBranchHeadOutput } = await exec('git', ['-C', updater, 'rev-parse', 'HEAD'])
		const workspaceBranchHead = workspaceBranchHeadOutput.trim()

		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: target,
			repositories: [
				{
					remoteUrl,
					repositoryIdentity: 'github.com/humanlayer/workspace-fixture',
					sourcePath: source,
					branch: 'workspace-actor-test',
				},
			],
		})
		await materializeFixture(fixture)
		expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('current remote workspace branch\n')
		expect((await exec('git', ['-C', target, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(workspaceBranchHead)
		await db
			.update(workspaceRepositoryStatusForUserForHost)
			.set({
				status: 'materializing',
				materialization: null,
				updated_at: BigInt(Date.now() + 1),
			})
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		// A fresh daemon scope must adopt the matching worktree rather than trying
		// to create a second one.
		await materializeFixture(fixture)

		const [status] = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, fixture.workspaceId))
		expect(status).toMatchObject({
			status: 'done',
			repo_available: true,
			resolved_commit: baseHead,
			materialization: { kind: 'worktree', path: target, branch: 'workspace-actor-test' },
		})
		expect(workspace?.repositories[0]?.baseCommit).toBe(baseHead)
		expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('current remote workspace branch\n')
		expect((await exec('git', ['-C', target, 'branch', '--show-current'])).stdout.trim()).toBe(
			'workspace-actor-test',
		)

		const baseTarget = join(root, 'target-from-base')
		const baseFixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: baseTarget,
			repositories: [
				{
					remoteUrl,
					repositoryIdentity: 'github.com/humanlayer/workspace-fixture',
					sourcePath: source,
					branch: 'workspace-branch-does-not-exist',
				},
			],
		})
		await materializeFixture(baseFixture)
		expect(await readFile(join(baseTarget, 'README.md'), 'utf8')).toBe('current remote main\n')
		expect((await exec('git', ['-C', baseTarget, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(baseHead)
	})

	test('falls back to a managed clone when the saved source path contains another repository', async () => {
		const root = await mkdtemp(join(tmpdir(), 'workspace-repository-identity-'))
		tempDirectories.push(root)
		const home = join(root, 'home')
		const cacheRoot = join(root, 'cache')
		const remote = join(root, 'remote.git')
		const producer = join(root, 'producer')
		const source = join(root, 'source')
		const target = join(root, 'target')
		await exec('mkdir', ['-p', home])
		await exec('git', ['init', '--bare', '--initial-branch=main', remote])
		await exec('git', ['init', '--initial-branch=main', producer])
		await exec('git', ['-C', producer, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', producer, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(producer, 'README.md'), 'managed fallback\n')
		await exec('git', ['-C', producer, 'add', 'README.md'])
		await exec('git', ['-C', producer, 'commit', '-m', 'managed fixture'])
		await exec('git', ['-C', producer, 'remote', 'add', 'origin', remote])
		await exec('git', ['-C', producer, 'push', 'origin', 'main'])
		await writeFile(
			join(home, '.gitconfig'),
			`[url "${remote}"]\n\tinsteadOf = git@github.com:humanlayer/syncopate.git\n`,
		)
		await exec('git', ['init', '--initial-branch=main', source])
		await exec('git', ['-C', source, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', source, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(source, 'README.md'), 'wrong repository\n')
		await exec('git', ['-C', source, 'add', 'README.md'])
		await exec('git', ['-C', source, 'commit', '-m', 'fixture'])
		await exec('git', ['-C', source, 'remote', 'add', 'wrong', 'https://github.com/humanlayer/agentlayer.git'])

		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: target,
			repositories: [
				{
					remoteUrl: 'git@github.com:humanlayer/syncopate.git',
					repositoryIdentity: 'github.com/humanlayer/syncopate',
					sourcePath: source,
				},
			],
		})
		await materializeFixture(fixture, { home, cacheRoot })

		const [status] = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		expect(status).toMatchObject({
			status: 'done',
			repo_available: true,
			source_kind: 'managed_clone',
			source_path: join(cacheRoot, 'github.com', 'humanlayer', 'syncopate', '.repository'),
			error: null,
		})
		expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('managed fallback\n')
	})

	test('publishes the workspace branch, copies files, and runs the setup command', async () => {
		const root = await mkdtemp(join(tmpdir(), 'workspace-repository-complete-setup-'))
		tempDirectories.push(root)
		const remote = join(root, 'remote.git')
		const source = join(root, 'source')
		const target = join(root, 'target')
		const remoteUrl = 'git@github.com:humanlayer/complete-setup.git'
		await exec('git', ['init', '--bare', '--initial-branch=main', remote])
		await exec('git', ['init', '--initial-branch=main', source])
		await exec('git', ['-C', source, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', source, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(source, 'README.md'), 'complete setup\n')
		await writeFile(join(source, '.gitignore'), '.env*\n')
		await writeFile(join(source, '.env.test'), 'COPIED=true\n')
		await exec('git', ['-C', source, 'add', 'README.md', '.gitignore'])
		await exec('git', ['-C', source, 'commit', '-m', 'fixture'])
		await exec('git', ['-C', source, 'remote', 'add', 'origin', remoteUrl])
		await exec('git', ['-C', source, 'config', `url.${remote}.insteadOf`, remoteUrl])
		await exec('git', ['-C', source, 'push', 'origin', 'main'])

		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: target,
			repositories: [
				{
					remoteUrl,
					repositoryIdentity: 'github.com/humanlayer/complete-setup',
					sourcePath: source,
					branch: 'workspace-complete-setup',
					autoPushBranch: true,
					copyGlobs: ['.env*'],
					setupCommand: 'printf setup-complete > setup-result.txt',
				},
			],
		})
		await materializeFixture(fixture)

		const [status] = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		expect(status).toMatchObject({
			status: 'done',
			branch_publish_status: 'published',
			copy_result: { copiedFiles: ['.env.test'] },
			setup_command_result: { command: 'printf setup-complete > setup-result.txt', exitCode: 0 },
			error: null,
		})
		expect(await readFile(join(target, '.env.test'), 'utf8')).toBe('COPIED=true\n')
		expect(await readFile(join(target, 'setup-result.txt'), 'utf8')).toBe('setup-complete')
		await exec('git', ['--git-dir', remote, 'show-ref', '--verify', 'refs/heads/workspace-complete-setup'])
	})

	test('parks a failed setup command with its output log', async () => {
		const root = await mkdtemp(join(tmpdir(), 'workspace-repository-failed-command-'))
		tempDirectories.push(root)
		const remote = join(root, 'remote.git')
		const source = join(root, 'source')
		const target = join(root, 'target')
		const remoteUrl = 'git@github.com:humanlayer/failed-command.git'
		await exec('git', ['init', '--bare', '--initial-branch=main', remote])
		await exec('git', ['init', '--initial-branch=main', source])
		await exec('git', ['-C', source, 'config', 'user.email', 'workspace-test@example.com'])
		await exec('git', ['-C', source, 'config', 'user.name', 'Workspace Test'])
		await writeFile(join(source, 'README.md'), 'failed command\n')
		await exec('git', ['-C', source, 'add', 'README.md'])
		await exec('git', ['-C', source, 'commit', '-m', 'fixture'])
		await exec('git', ['-C', source, 'remote', 'add', 'origin', remoteUrl])
		await exec('git', ['-C', source, 'config', `url.${remote}.insteadOf`, remoteUrl])
		await exec('git', ['-C', source, 'push', 'origin', 'main'])

		const fixture = await createFilesystemWorkspaceActorFixture(db, {
			targetRoot: target,
			repositories: [
				{
					remoteUrl,
					repositoryIdentity: 'github.com/humanlayer/failed-command',
					sourcePath: source,
					setupCommand: 'printf command-output; printf command-failed >&2; exit 7',
				},
			],
		})
		await materializeFixture(fixture)
		const [status] = await db
			.select()
			.from(workspaceRepositoryStatusForUserForHost)
			.where(eq(workspaceRepositoryStatusForUserForHost.workspace_id, fixture.workspaceId))
		expect(status).toMatchObject({
			status: 'running_setup_command',
			error: {
				stage: 'running_setup_command',
				message: 'Workspace setup command failed',
				exitCode: 7,
				stderr: 'command-failed',
			},
		})
		const stderrLogPath = status?.error?.stderrLogPath
		const stdoutLogPath = status?.error?.stdoutLogPath
		if (!stderrLogPath || !stdoutLogPath) throw new Error('Expected setup command output log paths')
		expect(await readFile(stderrLogPath, 'utf8')).toBe('command-failed')
		expect(await readFile(stdoutLogPath, 'utf8')).toBe('command-output')
	})
})
