import type { Meta, StoryObj } from '@storybook/react-vite'
import { RPI_LABELS, SessionLabelBadge } from './session-label-badge'

const meta = {
	title: 'UI/SessionLabelBadge',
	component: SessionLabelBadge,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof SessionLabelBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		label: { name: 'rpi:research', title: 'research' },
	},
}

export const AllLabels: Story = {
	render: () => (
		<div className="flex flex-col gap-6 p-8">
			<div className="text-sm text-muted-foreground">All RPI Phase Labels</div>
			<div className="flex gap-2 flex-wrap">
				{RPI_LABELS.map((label) => (
					<SessionLabelBadge key={label.name} label={label} />
				))}
			</div>
		</div>
	),
}

export const MultipleLabels: Story = {
	render: () => (
		<div className="flex flex-col gap-4 p-8">
			<div className="text-sm text-muted-foreground">Session with Multiple Phases</div>
			<div className="flex gap-2">
				<SessionLabelBadge label={{ name: 'rpi:research', title: 'research' }} />
				<SessionLabelBadge label={{ name: 'rpi:design', title: 'design' }} />
				<SessionLabelBadge label={{ name: 'rpi:implementation', title: 'implementation' }} />
			</div>
		</div>
	),
}

export const ByPhase: Story = {
	render: () => (
		<div className="flex flex-col gap-6 p-8">
			<div>
				<div className="text-xs text-muted-foreground mb-2">Research Phase (blue)</div>
				<div className="flex gap-2">
					<SessionLabelBadge label={{ name: 'rpi:research-questions', title: 'research-questions' }} />
					<SessionLabelBadge label={{ name: 'rpi:research', title: 'research' }} />
				</div>
			</div>

			<div>
				<div className="text-xs text-muted-foreground mb-2">Design Phase (cyan family)</div>
				<div className="flex gap-2">
					<SessionLabelBadge label={{ name: 'rpi:design', title: 'design' }} />
					<SessionLabelBadge label={{ name: 'rpi:design-prd', title: 'design-prd' }} />
					<SessionLabelBadge label={{ name: 'rpi:design-tdd', title: 'design-tdd' }} />
				</div>
			</div>

			<div>
				<div className="text-xs text-muted-foreground mb-2">Structure Phase (gold)</div>
				<SessionLabelBadge label={{ name: 'rpi:structure', title: 'structure' }} />
			</div>

			<div>
				<div className="text-xs text-muted-foreground mb-2">Plan Phase (violet)</div>
				<SessionLabelBadge label={{ name: 'rpi:plan', title: 'plan' }} />
			</div>

			<div>
				<div className="text-xs text-muted-foreground mb-2">Worktree Setup (muted)</div>
				<SessionLabelBadge label={{ name: 'rpi:worktree-setup', title: 'worktree-setup' }} />
			</div>

			<div>
				<div className="text-xs text-muted-foreground mb-2">Implementation Phase (green)</div>
				<SessionLabelBadge label={{ name: 'rpi:implementation', title: 'implementation' }} />
			</div>
		</div>
	),
}
