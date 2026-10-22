import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubPermissionPrompt } from './GitHubPermissionPrompt'

const meta = {
	title: 'Components/GitHub/GitHubPermissionPrompt',
	component: GitHubPermissionPrompt,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60">
				<Story />
			</div>
		),
	],
	args: {
		isAdmin: true,
		settingsUrl: 'https://cloud.example.com/settings',
		onOpenExternal: fn((event: React.MouseEvent) => event.preventDefault()),
	},
} satisfies Meta<typeof GitHubPermissionPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const AsAdmin: Story = {}

export const AsMember: Story = {
	args: { isAdmin: false },
}
