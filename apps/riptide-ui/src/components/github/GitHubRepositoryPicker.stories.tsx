import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubRepositoryPicker } from '@/components/GitHubRepositoryPicker'

const repositories = [
	{
		connectionId: 'connection-acme',
		repositoryId: '101',
		fullName: 'acme/web-platform',
		accountLogin: 'acme',
		private: true,
		archived: false,
	},
	{
		connectionId: 'connection-acme',
		repositoryId: '102',
		fullName: 'acme/design-system',
		accountLogin: 'acme',
		private: false,
		archived: false,
	},
	{
		connectionId: 'connection-personal',
		repositoryId: '103',
		fullName: 'octocat/retired-prototype',
		accountLogin: 'octocat',
		private: true,
		archived: true,
	},
] as const

const meta = {
	title: 'Components/GitHub/RepositoryPicker',
	component: GitHubRepositoryPicker,
	parameters: { layout: 'centered' },
	decorators: [(Story) => <div className="w-[min(34rem,calc(100vw-2rem))]"><Story /></div>],
	args: { repositories, selectedRepositoryId: '101', onSelect: fn() },
} satisfies Meta<typeof GitHubRepositoryPicker>

export default meta
type Story = StoryObj<typeof meta>

export const RememberedSelection: Story = {}
export const NoSelection: Story = { args: { selectedRepositoryId: null } }
export const EmptyInventory: Story = { args: { repositories: [], selectedRepositoryId: null } }
