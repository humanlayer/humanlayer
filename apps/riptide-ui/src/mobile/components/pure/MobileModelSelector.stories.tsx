import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { MobileModelSelector, type MobileModelOption, type MobileModelSelectorProps } from './MobileModelSelector'

const meta: Meta<typeof MobileModelSelector> = {
	title: 'Mobile/MobileModelSelector',
	component: MobileModelSelector,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileModelSelector>

const SAMPLE_MODELS: MobileModelOption[] = [
	{ value: 'opus', label: 'OPUS' },
	{ value: 'claude-opus-4-8', label: 'OPUS 4.8' },
	{ value: 'claude-opus-4-7', label: 'OPUS 4.7' },
	{ value: 'sonnet', label: 'SONNET' },
	{ value: 'claude-sonnet-5', label: 'SONNET 5' },
	{ value: 'claude-sonnet-4-6', label: 'SONNET 4.6' },
	{ value: 'claude-haiku-4-5-20251001', label: 'HAIKU 4.5' },
]

function Wrapper(props: Partial<MobileModelSelectorProps> & { initialOpen?: boolean; initialValue?: string }) {
	const { initialOpen = true, initialValue = SAMPLE_MODELS[0].value, options = SAMPLE_MODELS, ...rest } = props
	const [open, setOpen] = useState(initialOpen)
	const [value, setValue] = useState(initialValue)
	return (
		<div className="h-dvh bg-background flex items-end justify-center">
			<button
				type="button"
				className="m-4 rounded-md border border-input px-3 py-2 text-sm"
				onClick={() => setOpen(true)}
			>
				Open model selector
			</button>
			<MobileModelSelector
				{...rest}
				open={open}
				onOpenChange={setOpen}
				value={value}
				options={options}
				onChange={setValue}
			/>
		</div>
	)
}

export const Open: Story = {
	render: () => <Wrapper initialOpen />,
}

export const SonnetSelected: Story = {
	render: () => <Wrapper initialOpen initialValue="claude-sonnet-5" />,
}
