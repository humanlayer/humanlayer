import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { PhaseTipBanner } from './phase-tip-banner'

const meta = {
	title: 'UI/PhaseTipBanner',
	component: PhaseTipBanner,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
	args: {
		onDontShowAgain: fn(),
	},
	decorators: [
		(Story) => (
			<div className="w-64 border border-border rounded p-0 bg-card">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PhaseTipBanner>

export default meta
type Story = StoryObj<typeof meta>

export const ResearchQuestions: Story = {
	args: { phase: 'research-questions' },
}

export const Research: Story = {
	args: { phase: 'research' },
}

export const Design: Story = {
	args: { phase: 'design' },
}

export const Structure: Story = {
	args: { phase: 'structure' },
}

export const Plan: Story = {
	args: { phase: 'plan' },
}

export const WorktreeSetup: Story = {
	args: { phase: 'worktree-setup' },
}

export const Implementation: Story = {
	args: { phase: 'implementation' },
}

export const DescribePR: Story = {
	args: { phase: 'describe-pr' },
}

export const AllPhasesGallery: Story = {
	decorators: [
		(Story) => (
			<div className="w-64">
				<Story />
			</div>
		),
	],
	render: (args) => (
		<div className="flex flex-col gap-4">
			{[
				'research-questions',
				'research',
				'design',
				'structure',
				'plan',
				'worktree-setup',
				'implementation',
				'describe-pr',
			].map((phase) => (
				<div key={phase} className="border border-border rounded bg-card">
					<PhaseTipBanner {...args} phase={phase} />
				</div>
			))}
		</div>
	),
}
