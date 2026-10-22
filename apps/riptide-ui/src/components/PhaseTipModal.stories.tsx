import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'
import { Button } from '@humanlayer/ui/components/button'
import { PhaseTipModal, type PhaseTipModalProps } from './PhaseTipModal'

function ModalWrapper(props: Partial<PhaseTipModalProps> & { phase: string }) {
	const [open, setOpen] = useState(false)

	return (
		<HotkeysProvider initiallyActiveScopes={['*', '.', 'sessions.detail']}>
			<Button onClick={() => setOpen(true)}>Open {props.phase} tip</Button>
			<PhaseTipModal
				open={open}
				onOpenChange={setOpen}
				phase={props.phase}
				onClose={() => setOpen(false)}
				onDontShowPhase={props.onDontShowPhase ?? fn()}
				onNeverShowTips={props.onNeverShowTips ?? fn()}
				{...props}
			/>
		</HotkeysProvider>
	)
}

const meta = {
	title: 'Riptide/PhaseTipModal',
	component: PhaseTipModal,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
	args: {
		onClose: fn(),
		onDontShowPhase: fn(),
		onNeverShowTips: fn(),
	},
} satisfies Meta<typeof PhaseTipModal>

export default meta
type Story = StoryObj<typeof meta>

export const ResearchQuestions: Story = {
	render: (args) => <ModalWrapper {...args} phase="research-questions" />,
}

export const Research: Story = {
	render: (args) => <ModalWrapper {...args} phase="research" />,
}

export const Design: Story = {
	render: (args) => <ModalWrapper {...args} phase="design" />,
}

export const Structure: Story = {
	render: (args) => <ModalWrapper {...args} phase="structure" />,
}

export const Plan: Story = {
	render: (args) => <ModalWrapper {...args} phase="plan" />,
}

export const WorktreeSetup: Story = {
	render: (args) => <ModalWrapper {...args} phase="worktree-setup" />,
}

export const Implementation: Story = {
	render: (args) => <ModalWrapper {...args} phase="implementation" />,
}

export const DescribePR: Story = {
	render: (args) => <ModalWrapper {...args} phase="describe-pr" />,
}

export const AllPhasesGallery: Story = {
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
				<ModalWrapper key={phase} {...args} phase={phase} />
			))}
		</div>
	),
}
