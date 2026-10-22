import type { Meta, StoryObj } from '@storybook/react-vite'
import {
	createCompletedTaskData,
	createEmptyTaskData,
	createFailedTaskData,
	createWaitingForInputData,
} from './mock-data'
import { WorkflowGraphWrapper, type WorkflowGraphWrapperProps } from './workflow-graph-wrapper'

const meta = {
	title: 'Workflow/WorkflowGraph',
	component: WorkflowGraphWrapper as any,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="w-[700px] h-[900px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<WorkflowGraphWrapperProps>

export default meta
type Story = StoryObj<typeof meta>

const completed = createCompletedTaskData()
const failed = createFailedTaskData()
const lost = {
	...failed,
	sessions: failed.sessions.map((session, index) =>
		index === failed.sessions.length - 1
			? { ...session, status: 'lost' as const, title: 'Retry implementation (lost)' }
			: session,
	),
}
const empty = createEmptyTaskData()
const waiting = createWaitingForInputData()

export const Default: Story = {
	args: {},
}

export const Empty: Story = {
	args: {
		initialSessions: empty.sessions,
		initialArtifactFlows: empty.artifactFlows,
	},
}

export const Completed: Story = {
	args: {
		initialSessions: completed.sessions,
		initialArtifactFlows: completed.artifactFlows,
	},
}

export const Failed: Story = {
	args: {
		initialSessions: failed.sessions,
		initialArtifactFlows: failed.artifactFlows,
	},
}

export const Lost: Story = {
	args: {
		initialSessions: lost.sessions,
		initialArtifactFlows: lost.artifactFlows,
	},
}

export const WaitingForInput: Story = {
	args: {
		initialSessions: waiting.sessions,
		initialArtifactFlows: waiting.artifactFlows,
	},
}

export const LeftToRight: Story = {
	args: {
		direction: 'LR',
	},
	decorators: [
		(Story) => (
			<div className="w-[1200px] h-[600px]">
				<Story />
			</div>
		),
	],
}

export const CompletedLeftToRight: Story = {
	args: {
		initialSessions: completed.sessions,
		initialArtifactFlows: completed.artifactFlows,
		direction: 'LR',
	},
	decorators: [
		(Story) => (
			<div className="w-[1200px] h-[600px]">
				<Story />
			</div>
		),
	],
}

export const FailedLeftToRight: Story = {
	args: {
		initialSessions: failed.sessions,
		initialArtifactFlows: failed.artifactFlows,
		direction: 'LR',
	},
	decorators: [
		(Story) => (
			<div className="w-[1200px] h-[600px]">
				<Story />
			</div>
		),
	],
}

export const TopToBottom: Story = {
	args: {
		direction: 'TB',
	},
}

export const CompletedTopToBottom: Story = {
	args: {
		initialSessions: completed.sessions,
		initialArtifactFlows: completed.artifactFlows,
		direction: 'TB',
	},
}
