import type { Meta, StoryObj } from '@storybook/react-vite'
import { WorkspaceTabPure, type WorkspaceTreeNode } from './workspace-tab-pure'

const MULTI_REPO_NODES: WorkspaceTreeNode[] = [
	{ id: 'workspace-root', label: '~/.humanlayer/workspaces/core-1349-multi-repo/', kind: 'root' },
	{
		id: 'repo:syncopate',
		label: 'syncopate/',
		description: 'HumanLayer monorepo',
		primary: true,
		kind: 'repo',
	},
	{
		id: 'repo:agentlayer',
		label: 'agentlayer/',
		description: 'AgentLayer SDK & agent packages',
		kind: 'repo',
	},
	{
		id: 'repo:metalytics',
		label: 'metalytics/',
		description: 'Analytics service & dashboards',
		kind: 'repo',
	},
]

const RAW_STATE = JSON.stringify(
	{
		workspaceBaseDirectory: '~/.humanlayer/workspaces/core-1349-multi-repo',
		repos: [
			{
				path: 'syncopate',
				description: 'HumanLayer monorepo',
				remoteUrl: 'git@github.com:humanlayer/syncopate.git',
				sourceRef: 'HEAD',
				sourceCommit: 'aba7708885',
				branch: 'core-1349-multi-repo',
				primary: true,
			},
			{
				path: 'agentlayer',
				description: 'AgentLayer SDK & agent packages',
				remoteUrl: 'git@github.com:humanlayer/agentlayer.git',
				sourceRef: 'origin/main',
				sourceCommit: '9f1c2ab441',
				branch: 'core-1349-multi-repo',
				primary: false,
			},
			{
				path: 'metalytics',
				description: 'Analytics service & dashboards',
				remoteUrl: 'git@github.com:humanlayer/metalytics.git',
				sourceRef: 'origin/main',
				sourceCommit: '44d09ee102',
				branch: 'core-1349-multi-repo',
				primary: false,
			},
		],
	},
	null,
	2,
)

const meta = {
	title: 'Components/WorkspaceTabPure',
	component: WorkspaceTabPure,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="h-[480px] w-[320px] border p-3">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof WorkspaceTabPure>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		nodes: MULTI_REPO_NODES,
		rawState: RAW_STATE,
	},
}

/** Repos without a configured description render the path only — no fabricated label. */
export const WithoutDescriptions: Story = {
	args: {
		nodes: MULTI_REPO_NODES.map((node) =>
			node.kind === 'repo' ? { ...node, description: undefined } : node,
		),
		rawState: RAW_STATE,
	},
}
