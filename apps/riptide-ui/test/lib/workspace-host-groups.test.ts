import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { describe, expect, test } from 'vitest'

import { deriveWorkspaceHostGroups } from '@/lib/workspace-host-groups'

const workspaceSpec: WorkspaceSpec = {
	specVersion: 1,
	directory: '~/src/syncopate',
	workspaceBaseDirectory: '~/.humanlayer/workspaces/task',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/.humanlayer/workspaces/task/syncopate',
			branch: 'task',
			sourceRef: 'HEAD',
			copyGlobs: [],
			primary: true,
		},
	],
}

function setupRow(hostId: string, targetPath: string): TaskWorkspaceSetupForHost {
	return {
		id: hostId === 'host-a' ? '019f7de8-0240-7000-8000-000000000001' : '019f7de8-0240-7000-8000-000000000002',
		task_id: '019f7de8-0240-7000-8000-000000000003',
		organization_id: '019f7de8-0240-7000-8000-000000000004',
		host_id: hostId,
		status: 'done',
		resolved_workspace_spec: {
			...workspaceSpec,
			workspaceBaseDirectory: targetPath.replace(/\/syncopate$/, ''),
			repos: [{ ...workspaceSpec.repos[0]!, targetPath }],
		},
		workspace_setup_state: {
			specVersion: 1,
			repos: [{ localPath: '.', status: 'done', worktree: { targetPath } }],
			finishedAt: 1,
		},
		error: null,
		created_at: 1n,
		updated_at: 1n,
	}
}

describe('deriveWorkspaceHostGroups', () => {
	test('keeps each host mapped to its own resolved workspace', () => {
		const groups = deriveWorkspaceHostGroups({
			hosts: [
				{
					hostId: 'host-a',
					hostName: 'Laptop',
					userId: 'user-1',
					row: setupRow('host-a', '/Users/alice/workspaces/task/syncopate'),
					configured: true,
				},
				{
					hostId: 'host-b',
					hostName: 'Desktop',
					userId: 'user-1',
					row: setupRow('host-b', '/home/alice/workspaces/task/syncopate'),
					configured: true,
				},
			],
			workspaceSpec,
			workspaceState: null,
			currentUserHostId: 'host-b',
		})

		expect(groups).toHaveLength(2)
		expect(groups[0]?.workspaceView.repos[0]?.targetPath).toBe('/Users/alice/workspaces/task/syncopate')
		expect(groups[1]?.workspaceView.repos[0]?.targetPath).toBe('/home/alice/workspaces/task/syncopate')
		expect(groups[1]?.isCurrentUserHost).toBe(true)
	})

	test('shows the planned workspace for an unconfigured session host', () => {
		const groups = deriveWorkspaceHostGroups({
			hosts: [
				{
					hostId: 'host-b',
					hostName: 'Desktop',
					userId: 'user-1',
					row: null,
					configured: false,
				},
			],
			workspaceSpec,
			workspaceState: null,
			currentUserHostId: 'host-b',
		})

		expect(groups).toMatchObject([
			{
				hostId: 'host-b',
				configured: false,
				isCurrentUserHost: true,
				workspaceView: { workspaceBaseDirectory: '~/.humanlayer/workspaces/task' },
			},
		])
	})

	test('omits hosts when the task has no workspace data', () => {
		expect(
			deriveWorkspaceHostGroups({
				hosts: [{ hostId: 'host-a', hostName: null, userId: null, row: null, configured: false }],
				workspaceSpec: null,
				workspaceState: null,
				currentUserHostId: 'host-a',
			}),
		).toEqual([])
	})
})
