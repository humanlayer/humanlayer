import type { Meta, StoryObj } from '@storybook/react-vite'
import type React from 'react'
import { CommandPaletteHarness, type CommandPaletteHarnessProps } from './command-palette-harness'

const meta = {
	title: 'Shell Demos/CommandPaletteHarness',
	component: CommandPaletteHarness,
	parameters: {
		layout: 'fullscreen',
	},
	args: {
		taskCount: 1000,
		sessionCount: 1000,
		largePromptChars: 25000,
		matchingSessionCount: 8,
		payloadMode: 'composite-value',
		churnMode: 'none',
		churnIntervalMs: 250,
		churnOnMount: false,
		simulateDebounceMs: 150,
		queryText: 'auth',
		autoTypeCadenceMs: 50,
		autoTypeOnMount: false,
		showPromptPreview: false,
	},
	argTypes: {
		payloadMode: {
			control: 'radio',
			options: ['composite-value', 'split-keywords'],
		},
		churnMode: {
			control: 'radio',
			options: ['none', 'matched-sessions', 'dataset-wide'],
		},
		churnOnMount: {
			control: 'boolean',
		},
	},
	decorators: [
		(Story: React.FC) => (
			<div className="min-h-screen bg-slate-100/70">
				<Story />
			</div>
		),
	],
} satisfies Meta<CommandPaletteHarnessProps>

export default meta

type Story = StoryObj<typeof meta>

export const ScenarioA_LargeDatasetShortText: Story = {
	args: {
		largePromptChars: 0,
		payloadMode: 'split-keywords',
		churnMode: 'none',
	},
}

export const ScenarioB_LargeDatasetHugeMatchingPrompts: Story = {
	args: {
		largePromptChars: 100000,
		payloadMode: 'composite-value',
		churnMode: 'none',
		showPromptPreview: true,
	},
}

export const ScenarioC_SmallVisibleSetHugePrompts: Story = {
	args: {
		taskCount: 5,
		sessionCount: 5,
		largePromptChars: 100000,
		matchingSessionCount: 5,
		payloadMode: 'composite-value',
		churnMode: 'none',
		showPromptPreview: true,
	},
}

export const ScenarioD_ChurningLastActivity: Story = {
	args: {
		largePromptChars: 100000,
		payloadMode: 'composite-value',
		churnMode: 'matched-sessions',
		churnIntervalMs: 120,
		autoTypeOnMount: false,
		churnOnMount: false,
		showPromptPreview: true,
	},
}

export const ScenarioD_DatasetWideChurn: Story = {
	args: {
		largePromptChars: 25000,
		payloadMode: 'composite-value',
		churnMode: 'dataset-wide',
		churnIntervalMs: 120,
		autoTypeOnMount: false,
		churnOnMount: false,
	},
}

export const ComparePayloadModes: Story = {
	args: {
		largePromptChars: 100000,
		matchingSessionCount: 8,
		payloadMode: 'split-keywords',
		churnMode: 'none',
		showPromptPreview: true,
	},
}
