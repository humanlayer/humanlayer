import type { GitHubRepository } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { GitHubRepositoryList } from './GitHubRepositoryList'

const repositories: GitHubRepository[] = [
	{
		id: '1296269',
		ownerLogin: 'acme-corp',
		name: 'web-app',
		fullName: 'acme-corp/web-app',
		private: true,
		defaultBranch: 'main',
		archived: false,
	},
	{
		id: '1296270',
		ownerLogin: 'acme-corp',
		name: 'api',
		fullName: 'acme-corp/api',
		private: true,
		defaultBranch: 'main',
		archived: false,
	},
	{
		id: '1296271',
		ownerLogin: 'acme-corp',
		name: 'design-system',
		fullName: 'acme-corp/design-system',
		private: false,
		defaultBranch: 'trunk',
		archived: false,
	},
	{
		id: '1296272',
		ownerLogin: 'acme-corp',
		name: 'legacy-monolith',
		fullName: 'acme-corp/legacy-monolith',
		private: true,
		defaultBranch: 'master',
		archived: true,
	},
]

const meta = {
	title: 'Components/Settings/GitHubRepositoryList',
	component: GitHubRepositoryList,
	args: { repositories },
} satisfies Meta<typeof GitHubRepositoryList>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Loading: Story = { args: { repositories: undefined, loading: true } }

export const ErrorState: Story = { args: { repositories: undefined, error: true } }

export const Empty: Story = { args: { repositories: [] } }
