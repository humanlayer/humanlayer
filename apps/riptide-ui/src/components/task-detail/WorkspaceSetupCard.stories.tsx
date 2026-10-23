import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { WorkspaceSetupCard } from './WorkspaceSetupCard'

const now = Date.now()
const workspaceSpec = {
	specVersion: 1,
	directory: '~/src/app',
	workspaceBaseDirectory: '~/wt/eng-1234-queue-backpressure',
	setupBlocksFirstSession: false,
	repos: [
		{
			localPath: '.',
			targetPath: '~/wt/eng-1234-queue-backpressure/app',
			branch: 'eng-1234',
			sourceRef: 'main',
			setupCommand: 'bun install',
			copyGlobs: ['.env'],
			primary: true,
		},
		{
			localPath: '../api',
			targetPath: '~/wt/eng-1234-queue-backpressure/api',
			branch: 'eng-1234',
			sourceRef: 'main',
			setupCommand: 'bun run build',
			copyGlobs: ['.env'],
			primary: false,
		},
	],
} as const

const baseRow: TaskWorkspaceSetupForHost = {
	id: '019f7de8-0240-7000-8000-000000000001',
	task_id: '019f7de8-0240-7000-8000-000000000002',
	organization_id: '019f7de8-0240-7000-8000-000000000003',
	host_id: 'local-mac',
	status: 'setup_command',
	workspace_setup_state: {
		specVersion: 1,
		startedAt: now - 42_000,
		repos: [
			{
				localPath: '.',
				status: 'done',
				preflight: { resolvedSourceCommit: 'a11ce123' },
				worktree: { targetPath: '~/wt/eng-1234-queue-backpressure/app' },
				copyGlobs: { filesCopied: ['.env'] },
				setupCommand: { command: 'bun install', exitCode: 0 },
			},
			{
				localPath: '../api',
				status: 'setup_command',
				preflight: { resolvedSourceCommit: 'b22ef456' },
				worktree: { targetPath: '~/wt/eng-1234-queue-backpressure/api' },
				copyGlobs: { filesCopied: ['.env'] },
			},
		],
	},
	error: null,
	created_at: BigInt(now - 42_000),
	updated_at: BigInt(now),
}

const meta = {
	title: 'Components/Task Detail/WorkspaceSetupCard',
	component: WorkspaceSetupCard,
	args: {
		hostName: "Kyle's Mac",
		workspaceSpec,
		hasSession: true,
		onRetry: fn(),
		onSkip: fn(),
		onDiagnose: fn(),
	},
	parameters: { layout: 'padded' },
} satisfies Meta<typeof WorkspaceSetupCard>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = { args: { row: baseRow } }

export const RunningWithoutSession: Story = { args: { row: baseRow, hasSession: false } }

export const Blocking: Story = { args: { row: baseRow, setupBlocksFirstSession: true } }

export const FailedSetupCommand: Story = {
	args: {
		row: {
			...baseRow,
			error: {
				localPath: '../api',
				stage: 'setup_command',
				message: 'Dependency install failed',
				command: 'bun install',
				exitCode: 1,
				stderr: 'error: lockfile is out of date',
			},
		},
	},
}

export const FailedWorktree: Story = {
	args: {
		row: {
			...baseRow,
			status: 'worktree',
			error: { localPath: '../api', stage: 'worktree', message: 'Branch is already checked out' },
		},
	},
}

export const DoneWithAcceptedSkip: Story = {
	args: {
		row: {
			...baseRow,
			status: 'done',
			workspace_setup_state: {
				...baseRow.workspace_setup_state,
				finishedAt: now,
				repos: baseRow.workspace_setup_state.repos.map((repo) => ({ ...repo, status: 'done' as const })),
				acceptedSkips: [
					{
						localPath: '../api',
						stage: 'setup_command',
						skippedByUserId: 'user-1',
						skippedAt: now,
						errorMessage: 'Optional tool was unavailable',
					},
				],
			},
		},
	},
}

export const NoOpWorkspace: Story = {
	args: {
		row: {
			...baseRow,
			status: 'done',
			workspace_setup_state: { specVersion: 1, startedAt: now - 200, finishedAt: now, repos: [] },
		},
	},
}
