import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubRepositoriesWithoutAppNote } from './GitHubRepositoriesWithoutAppNote'

const meta = {
	title: 'Components/GitHub/GitHubRepositoriesWithoutAppNote',
	component: GitHubRepositoriesWithoutAppNote,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60 py-2">
				<Story />
			</div>
		),
	],
	args: {
		repositories: ['effect-ts/effect'],
		isAdmin: true,
		onOpenSettings: fn(),
	},
} satisfies Meta<typeof GitHubRepositoriesWithoutAppNote>

export default meta
type Story = StoryObj<typeof meta>

export const AsAdmin: Story = {}

export const AsMember: Story = {
	args: { isAdmin: false },
}

export const SeveralRepositories: Story = {
	args: { repositories: ['effect-ts/effect', 'vercel/chat', 'withastro/flue'] },
}
