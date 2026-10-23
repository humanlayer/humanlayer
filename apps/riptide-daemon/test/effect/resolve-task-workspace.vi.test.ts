import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
	resolveTaskWorkspaceView,
	resolveTaskWorkspaceViewOrNull,
} from '@/effects/workspace-setup/resolve-task-workspace'

const spec = {
	specVersion: 1,
	directory: '/repo',
	workspaceBaseDirectory: '/workspaces/task-1',
	setupBlocksFirstSession: false,
	repos: [
		{ localPath: '.', targetPath: '/workspaces/task-1/repo', branch: 'task-1', sourceRef: 'HEAD', primary: true },
	],
}

const legacyWorkspaceState = {
	workspaceBaseDirectory: '~/.humanlayer/workspaces/task-1',
	repos: [{ path: 'repo', sourceRef: 'HEAD', branch: 'task-1', primary: true }],
}

// The shape the API writes for tasks without a managed workspace: resolved spec null, empty ledger.
const specLessSetupRow = {
	id: 'setup-1',
	task_id: 'task-1',
	host_id: 'host-1',
	resolved_workspace_spec: null,
	workspace_setup_state: { specVersion: 1, repos: [], finishedAt: 1 },
	error: null,
}

describe('resolveTaskWorkspaceView', () => {
	it.effect('resolves null for a spec-less task with a spec-less setup row', ({ expect }) =>
		Effect.gen(function* () {
			const view = yield* resolveTaskWorkspaceView({
				task: { id: 'task-1', workspace_spec: null, workspace_state: null },
				hostId: 'host-1',
				setupRows: [specLessSetupRow],
			})
			expect(view).toBeNull()
		}),
	)

	it.effect('falls back to legacy workspace_state when the setup row is spec-less', ({ expect }) =>
		Effect.gen(function* () {
			const view = yield* resolveTaskWorkspaceView({
				task: { id: 'task-1', workspace_spec: null, workspace_state: legacyWorkspaceState },
				hostId: 'host-1',
				setupRows: [specLessSetupRow],
			})
			expect(view?.source).toBe('legacy_workspace_state')
			expect(view?.repos.map((repo) => repo.localPath)).toEqual(['repo'])
		}),
	)

	it.effect('resolves a workspace_spec view from a setup row with a resolved spec', ({ expect }) =>
		Effect.gen(function* () {
			const view = yield* resolveTaskWorkspaceView({
				task: { id: 'task-1', workspace_spec: null, workspace_state: null },
				hostId: 'host-1',
				setupRows: [{ ...specLessSetupRow, resolved_workspace_spec: spec }],
			})
			expect(view?.source).toBe('workspace_spec')
			expect(view?.repos.map((repo) => repo.localPath)).toEqual(['.'])
		}),
	)

	it.effect('still fails on a malformed non-null resolved spec', ({ expect }) =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				resolveTaskWorkspaceView({
					task: { id: 'task-1', workspace_spec: null, workspace_state: null },
					hostId: 'host-1',
					setupRows: [{ ...specLessSetupRow, resolved_workspace_spec: { bogus: true } }],
				}),
			)
			expect(error._tag).toBe('InvalidWorkspaceSpecError')
		}),
	)
})

describe('resolveTaskWorkspaceViewOrNull', () => {
	it('resolves null without failing for the spec-less combination', async ({ expect }) => {
		const view = await resolveTaskWorkspaceViewOrNull({
			task: { id: 'task-1', workspace_spec: null, workspace_state: null },
			hostId: 'host-1',
			setupRows: [specLessSetupRow],
		})
		expect(view).toBeNull()
	})
})
