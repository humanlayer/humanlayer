import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { LauncherSuggestionChips } from './LauncherSuggestionChips'

const meta = {
	title: 'Components/LauncherV3/SuggestionChips',
	component: LauncherSuggestionChips,
	parameters: { layout: 'centered' },
	decorators: [
		(Story) => (
			<div className="w-[680px] max-w-full">
				<Story />
			</div>
		),
	],
	args: { onSelectChip: fn(), onDismissChip: fn() },
} satisfies Meta<typeof LauncherSuggestionChips>

export default meta
type Story = StoryObj<typeof meta>

export const Suggestions: Story = {
	args: {
		chips: [
			{ id: 'connect-linear', label: 'Connect Linear', kind: 'integration' },
			{ id: 'connect-github', label: 'Connect GitHub', kind: 'integration' },
			{ id: 'connect-jira', label: 'Reconnect Jira', kind: 'integration' },
		],
	},
}

export const Disabled: Story = {
	args: {
		chips: [{ id: 'connect-linear', label: 'Connect Linear', kind: 'integration' }],
		disabled: true,
	},
}
