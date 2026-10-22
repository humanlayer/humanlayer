import type { Meta, StoryObj } from '@storybook/react-vite'
import { createFailedTaskData } from './mock-data'
import { WorkflowGraphLiteWrapper, type WorkflowGraphLiteWrapperProps } from './workflow-graph-lite-wrapper'

const meta = {
	title: 'Workflow/WorkflowGraphLite',
	component: WorkflowGraphLiteWrapper as any,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="w-[780px] h-[200px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<WorkflowGraphLiteWrapperProps>

export default meta
type Story = StoryObj<typeof meta>

const OUTLINE_ONLY_PHASES_WORKTREE_NOW = [
	{ name: 'rpi:worktree-setup', title: 'worktree', synthetic: true },
	{ name: 'rpi:research-questions', title: 'questions' },
	{ name: 'rpi:research', title: 'research' },
	{ name: 'rpi:design', title: 'design' },
	{ name: 'rpi:structure', title: 'outline' },
	{ name: 'rpi:implementation', title: 'implement' },
]

export const Static: Story = {
	args: {
		initialSessions: [],
		initialArtifactFlows: [],
		direction: 'LR',
		phases: OUTLINE_ONLY_PHASES_WORKTREE_NOW,
		static: true,
	},
}

const sessionsData = {
	sessions: [
		{
			id: 's-wt-1',
			labelName: 'rpi:worktree-setup',
			labelTitle: 'worktree',
			status: 'ready_for_input' as const,
			title: 'Set up worktree',
			artifacts: [],
			userProfile: { initials: 'KS' },
		},
		{
			id: 's-rq-1',
			labelName: 'rpi:research-questions',
			labelTitle: 'questions',
			status: 'ready_for_input' as const,
			title: 'Generate research questions',
			artifacts: [{ fileName: '01-research-questions.md', category: 'new' as const }],
			userProfile: { initials: 'KS' },
		},
		{
			id: 's-r-1',
			labelName: 'rpi:research',
			labelTitle: 'research',
			status: 'running' as const,
			title: 'Codebase research',
			artifacts: [{ fileName: '02-research.md', category: 'new' as const }],
			userProfile: { initials: 'KS' },
		},
	],
	artifactFlows: [],
}

export const WithSessions: Story = {
	args: {
		initialSessions: sessionsData.sessions,
		initialArtifactFlows: sessionsData.artifactFlows,
		direction: 'LR',
		phases: OUTLINE_ONLY_PHASES_WORKTREE_NOW,
	},
}

const FULL_RPI_PHASES = [
	{ name: 'rpi:research-questions', title: 'research-questions' },
	{ name: 'rpi:research', title: 'research' },
	{ name: 'rpi:design', title: 'design' },
	{ name: 'rpi:structure', title: 'structure' },
	{ name: 'rpi:plan', title: 'plan' },
	{ name: 'rpi:worktree-setup', title: 'worktree-setup' },
	{ name: 'rpi:implementation', title: 'implementation' },
	{ name: 'rpi:describe-pr', title: 'describe-pr' },
	{ name: 'rpi:review', title: 'review' },
]

const failed = createFailedTaskData()
const lost = {
	...failed,
	sessions: failed.sessions.map((session, index) =>
		index === failed.sessions.length - 1
			? { ...session, status: 'lost' as const, title: 'Retry implementation (lost)' }
			: session,
	),
}

export const Failed: Story = {
	args: {
		initialSessions: failed.sessions,
		initialArtifactFlows: [],
		direction: 'LR',
		phases: FULL_RPI_PHASES,
	},
}

export const Lost: Story = {
	args: {
		initialSessions: lost.sessions,
		initialArtifactFlows: [],
		direction: 'LR',
		phases: FULL_RPI_PHASES,
	},
}

const PRD_PHASES_WORKTREE_AFTER_OUTLINE = [
	{ name: 'rpi:research-questions', title: 'questions' },
	{ name: 'rpi:research', title: 'research' },
	{ name: 'rpi:design-prd', title: 'PRD' },
	{ name: 'rpi:design-tdd', title: 'TDD' },
	{ name: 'rpi:structure', title: 'outline' },
	{ name: 'rpi:worktree-setup', title: 'worktree' },
	{ name: 'rpi:implementation', title: 'implement' },
]

export const StaticPRD: Story = {
	args: {
		initialSessions: [],
		initialArtifactFlows: [],
		direction: 'LR',
		phases: PRD_PHASES_WORKTREE_AFTER_OUTLINE,
		static: true,
	},
}
