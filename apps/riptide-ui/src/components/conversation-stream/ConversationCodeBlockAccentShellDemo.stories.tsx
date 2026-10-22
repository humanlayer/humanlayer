import type { Meta, StoryObj } from '@storybook/react-vite'

import { ConversationCodeBlockAccentShellDemo } from './storybook/ConversationCodeBlockAccentShellDemo'

const meta = {
	title: 'Shell Demos/Conversation Code Fences',
	component: ConversationCodeBlockAccentShellDemo,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'Canonical Riptide assistant-message fences. They use the production path: ConversationEventRow -> AssistantMessageContent -> MarkdownRenderer -> PierreCodeFence. Fences always use a subtly darker surface, transparent hover copy control, and GitHub Dark or GitHub Light syntax based on theme polarity.',
			},
		},
	},
} satisfies Meta<typeof ConversationCodeBlockAccentShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const SingleAssistantEvent: Story = {
	args: {
		scenario: 'single-event',
	},
}

export const MockStream: Story = {
	args: {
		scenario: 'mock-stream',
	},
}

export const TypeScriptCodeBlock: Story = {
	args: {
		scenario: 'typescript-code',
	},
}
