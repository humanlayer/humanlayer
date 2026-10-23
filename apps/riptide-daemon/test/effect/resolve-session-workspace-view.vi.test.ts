import { describe, it } from '@effect/vitest'
import { Effect, Layer, ManagedRuntime, Ref } from 'effect'
import * as Path from 'effect/Path'
import { expect } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import type { DaemonRuntime } from '@/effects/runtime'
import { DaemonTaskWorkspaceContextError } from '@/effects/services/daemon-api/daemon-api.errors'
import { reconcileTaskDiffCollections } from '@/effects/services/task-diff/task-diff-collection-reconciler'
import { TaskDiffLifecycleObserver } from '@/effects/services/task-diff/task-diff-lifecycle-observer.service'
import type { TaskDiffWorkspace } from '@/effects/services/task-diff/types'
import { resolveSessionWorkspaceView } from '@/effects/services/task-workspace-context/resolve-session-workspace-view'
import { sessionRepoDirs } from '@/lib/git/session-repo-dirs'

import {
	FIXTURE_BASE_COMMIT,
	FIXTURE_HOST_ID,
	FIXTURE_TASK_ID,
	FIXTURE_WORKSPACE_ID,
	makeTaskWorkspaceContext,
} from '../helpers/task-workspace-context-fixture'
import { UnusedGitRequirements } from '../helpers/unused-repository-requirements'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

const root = `/home/dev/.humanlayer/workspaces/${FIXTURE_WORKSPACE_ID}`
const apiPath = `${root}/api`
const uiPath = `${root}/ui`

const projectTask = {
	id: FIXTURE_TASK_ID,
	workspace_id: FIXTURE_WORKSPACE_ID,
	workspace_spec: null,
	workspace_state: null,
}

const bothMaterialized = makeTaskWorkspaceContext({
	repositories: [
		{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
		{ repositoryIdentity: 'github.com/humanlayer/ui', materializedPath: uiPath },
	],
})

const siblingPending = makeTaskWorkspaceContext({
	repositories: [
		{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
		{ repositoryIdentity: 'github.com/humanlayer/ui', status: 'materializing' },
	],
})

describe('resolveSessionWorkspaceView', () => {
	it.effect('a project-workspace task resolves through the task context and never reads legacy JSON', () =>
		Effect.gen(function* () {
			const freshness = yield* Ref.make<string[]>([])
			const layer = makeMockTaskWorkspaceContextLayer({
				loadTaskWorkspaceContext: () =>
					Ref.update(freshness, (seen) => [...seen, 'launch']).pipe(Effect.as(bothMaterialized)),
				recentTaskWorkspaceContext: () =>
					Ref.update(freshness, (seen) => [...seen, 'tracking']).pipe(Effect.as(siblingPending)),
			})
			const launch = yield* resolveSessionWorkspaceView({
				task: projectTask,
				hostId: FIXTURE_HOST_ID,
				// A stray legacy ledger row for the same task is ignored for project workspaces.
				setupRows: [{ id: 'ledger', task_id: FIXTURE_TASK_ID, host_id: FIXTURE_HOST_ID }],
				freshness: 'launch',
			}).pipe(Effect.provide(layer))
			expect(launch.view?.source).toBe('project_workspace')
			expect(launch.view?.repos.map((repo) => repo.targetPath)).toEqual([apiPath, uiPath])
			expect(launch.setupProgress).toBeNull()

			const tracking = yield* resolveSessionWorkspaceView({
				task: projectTask,
				hostId: FIXTURE_HOST_ID,
				setupRows: [],
				freshness: 'tracking',
			}).pipe(Effect.provide(layer))
			expect(tracking.view?.repos.map((repo) => repo.materialized)).toEqual([true, false])
			expect(tracking.setupProgress).toContain('ui - materializing - RUNNING')
			expect(yield* Ref.get(freshness)).toEqual(['launch', 'tracking'])
		}),
	)

	it.effect('a legacy task keeps the synced ledger resolution and never touches the task context', () =>
		Effect.gen(function* () {
			const resolution = yield* resolveSessionWorkspaceView({
				task: {
					id: 'legacy-task',
					workspace_id: null,
					workspace_spec: null,
					workspace_state: {
						workspaceBaseDirectory: '/tmp/legacy',
						repos: [{ path: 'repo', sourceRef: 'HEAD', branch: 'legacy', primary: true }],
					},
				},
				hostId: FIXTURE_HOST_ID,
				setupRows: [],
				freshness: 'launch',
			}).pipe(Effect.provide(makeMockTaskWorkspaceContextLayer()))
			expect(resolution.view?.source).toBe('legacy_workspace_state')
			expect(resolution.setupProgress).toBeNull()
		}),
	)

	it.effect('a launch without a usable placement fails instead of starting with missing siblings', () =>
		Effect.gen(function* () {
			const unplaced = makeTaskWorkspaceContext({
				placed: false,
				repositories: [{ repositoryIdentity: 'github.com/humanlayer/api', default: true }],
			})
			for (const context of [null, unplaced]) {
				const error = yield* resolveSessionWorkspaceView({
					task: projectTask,
					hostId: FIXTURE_HOST_ID,
					setupRows: [],
					freshness: 'launch',
				}).pipe(
					Effect.provide(
						makeMockTaskWorkspaceContextLayer({ loadTaskWorkspaceContext: () => Effect.succeed(context) }),
					),
					Effect.flip,
				)
				expect(error).toBeInstanceOf(DaemonTaskWorkspaceContextError)
			}
		}),
	)

	it.effect('an unavailable context degrades to no workspace view for trackers', () =>
		Effect.gen(function* () {
			const resolution = yield* resolveSessionWorkspaceView({
				task: projectTask,
				hostId: FIXTURE_HOST_ID,
				setupRows: [],
				freshness: 'tracking',
			}).pipe(
				Effect.provide(
					makeMockTaskWorkspaceContextLayer({ recentTaskWorkspaceContext: () => Effect.succeed(null) }),
				),
			)
			expect(resolution).toEqual({ view: null, setupProgress: null })
		}),
	)
})

const makeRuntime = (overrides: Parameters<typeof makeMockTaskWorkspaceContextLayer>[0]) =>
	ManagedRuntime.make(makeMockTaskWorkspaceContextLayer(overrides)) as unknown as DaemonRuntime

type SessionTask = { id: string; workspace_id: string | null; workspace_spec: null; workspace_state: null }

const makeServices = (runtime: DaemonRuntime, task: SessionTask | undefined) =>
	({
		daemonRuntime: runtime,
		collections: {
			tasks: { get: (id: string) => (task?.id === id ? task : undefined), toArray: task ? [task] : [] },
			workspaceSetup: { toArray: [] },
		},
	}) as unknown as DaemonServices

describe('sessionRepoDirs for project workspaces', () => {
	it.effect('adds only materialized siblings, for first, later, and recovered sessions alike', () =>
		Effect.gen(function* () {
			const reads = yield* Ref.make(0)
			const runtime = makeRuntime({
				recentTaskWorkspaceContext: () =>
					Ref.update(reads, (count) => count + 1).pipe(Effect.as(siblingPending)),
			})
			const services = makeServices(runtime, projectTask)
			// First, later, and recovered sessions of the task all anchor on the same worktree.
			const sessions = [
				{ working_directory: apiPath, task_id: FIXTURE_TASK_ID, host_id: FIXTURE_HOST_ID },
				{ working_directory: `${apiPath}/`, task_id: FIXTURE_TASK_ID, host_id: FIXTURE_HOST_ID },
				{
					working_directory: `${root}/./api`,
					task_id: FIXTURE_TASK_ID,
					host_id: FIXTURE_HOST_ID,
				},
			]
			for (const session of sessions) {
				const dirs = yield* Effect.promise(() => sessionRepoDirs({ session, services, setupRows: [] }))
				// The pending sibling is not watched; the cwd repo is not duplicated.
				expect(dirs.slice(1)).toEqual([])
			}
			const materializedServices = makeServices(
				makeRuntime({ recentTaskWorkspaceContext: () => Effect.succeed(bothMaterialized) }),
				projectTask,
			)
			const dirs = yield* Effect.promise(() =>
				sessionRepoDirs({ session: sessions[0]!, services: materializedServices, setupRows: [] }),
			)
			expect(dirs).toEqual([apiPath, uiPath])
			// Trackers read the recent context, never the authoritative launch read.
			expect(yield* Ref.get(reads)).toBe(3)
		}),
	)

	it.effect('a legacy task resolves from the synced ledger and never reaches the task context', () =>
		Effect.gen(function* () {
			// The runtime's task context dies if read, so reaching it would fail this test loudly.
			const legacyTask = { id: 'legacy', workspace_id: null, workspace_spec: null, workspace_state: null }
			const services = makeServices(makeRuntime({}), legacyTask)
			const session = { working_directory: '/tmp/legacy', task_id: 'legacy', host_id: FIXTURE_HOST_ID }
			const dirs = yield* Effect.promise(() => sessionRepoDirs({ session, services, setupRows: [] }))
			expect(dirs).toEqual(['/tmp/legacy'])
		}),
	)
})

describe('task diff registration for project workspaces', () => {
	const session = {
		id: 'session-1',
		task_id: FIXTURE_TASK_ID,
		host_id: FIXTURE_HOST_ID,
		working_directory: apiPath,
		status: 'running',
		updated_at: 1n,
	}
	const task = { id: FIXTURE_TASK_ID, organization_id: 'org', archived: false, workspace_id: FIXTURE_WORKSPACE_ID }

	const observe = (context: ReturnType<typeof makeTaskWorkspaceContext>) =>
		Effect.gen(function* () {
			const observed = yield* Ref.make<Array<TaskDiffWorkspace | undefined>>([])
			const observer = Layer.succeed(TaskDiffLifecycleObserver, {
				initialize: () => Effect.void,
				observeTask: () => Effect.void,
				observeWorkspace: ({ workspace }) => Ref.update(observed, (seen) => [...seen, workspace]),
			})
			yield* reconcileTaskDiffCollections({
				collections: { tasks: { toArray: [task] }, sessions: { toArray: [session] } },
				taskIds: new Set([FIXTURE_TASK_ID]),
			}).pipe(
				Effect.provide(observer),
				Effect.provide(
					makeMockTaskWorkspaceContextLayer({ recentTaskWorkspaceContext: () => Effect.succeed(context) }),
				),
				Effect.provide(Path.layer),
				Effect.provide(UnusedGitRequirements),
			)
			return yield* Ref.get(observed)
		})

	it.effect('registers every materialized worktree against the pinned base commit', () =>
		Effect.gen(function* () {
			const [workspace] = yield* observe(bothMaterialized)
			expect(workspace).toMatchObject({
				organizationId: bothMaterialized.workspace.organizationId,
				taskId: FIXTURE_TASK_ID,
				hostId: FIXTURE_HOST_ID,
				workspaceBaseDirectory: root,
			})
			expect(workspace?.repos).toEqual([
				{
					id: 'api',
					displayName: 'api',
					absolutePath: apiPath,
					sourceRef: 'HEAD',
					sourceCommit: FIXTURE_BASE_COMMIT,
				},
				{
					id: 'ui',
					displayName: 'ui',
					absolutePath: uiPath,
					sourceRef: 'HEAD',
					sourceCommit: FIXTURE_BASE_COMMIT,
				},
			])
		}),
	)

	it.effect('leaves a pending sibling out until it materializes, and withholds another host placement', () =>
		Effect.gen(function* () {
			const [partial] = yield* observe(siblingPending)
			expect(partial?.repos.map((repo) => repo.id)).toEqual(['api'])
			const [elsewhere] = yield* observe(
				makeTaskWorkspaceContext({
					hostId: 'another-host',
					repositories: [
						{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
					],
				}),
			)
			expect(elsewhere).toBeUndefined()
		}),
	)
})
