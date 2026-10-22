import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { WorkspaceSetupStrip } from './WorkspaceSetupStrip'

const now = Date.now()
const row: TaskWorkspaceSetupForHost = {
	id: '019f7de8-0240-7000-8000-000000000001',
	task_id: '019f7de8-0240-7000-8000-000000000002',
	organization_id: '019f7de8-0240-7000-8000-000000000003',
	host_id: 'local-mac',
	status: 'done',
	workspace_setup_state: {
		specVersion: 1,
		startedAt: now - 222_000,
		finishedAt: now,
		repos: [
			{ localPath: '.', status: 'done' },
			{ localPath: '../api', status: 'done' },
		],
		acceptedSkips: [
			{
				localPath: '.',
				stage: 'setup_command',
				skippedByUserId: 'user-1',
				skippedAt: now - 30_000,
				command: 'bun install',
			},
		],
	},
	error: null,
	created_at: BigInt(now - 222_000),
	updated_at: BigInt(now),
}

const meta = {
	title: 'Components/Task Detail/WorkspaceSetupStrip',
	component: WorkspaceSetupStrip,
	args: { row, elapsedMs: 222_000, onViewWorkspace: fn() },
	parameters: { layout: 'padded' },
} satisfies Meta<typeof WorkspaceSetupStrip>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyWithAcceptedSkip: Story = {}
