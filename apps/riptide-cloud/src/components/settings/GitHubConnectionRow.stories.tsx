import type { GitHubConnection, GitHubRepository } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { GitHubConnectionRow } from './GitHubConnectionRow'

const fullCapabilities: GitHubConnection['capabilities'] = {
	listRepositories: true,
	previewIssue: true,
	writeBacklink: true,
	readContents: true,
	writeContents: true,
	readPullRequests: true,
	writePullRequests: true,
}

const healthyConnection: GitHubConnection = {
	id: '019f536c-b021-763a-84b2-bbd8ee8e2913',
	accountId: '90071992547409931235',
	accountLogin: 'acme-corp',
	accountType: 'Organization',
	repositorySelection: 'selected',
	repositoryCount: 12,
	permissions: { contents: 'write', issues: 'write', pull_requests: 'write', metadata: 'read' },
	status: 'active',
	needsReauth: false,
	suspendedAt: null,
	suspendedByLogin: null,
	managementUrl: 'https://github.com/organizations/acme-corp/settings/installations/42',
	capabilities: fullCapabilities,
	lastReconciledAt: Date.now() - 1000 * 60 * 60 * 6,
}

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
]

const noOp = () => undefined

const meta = {
	title: 'Components/Settings/GitHubConnectionRow',
	component: GitHubConnectionRow,
	args: {
		connection: healthyConnection,
		repositories,
		onOpenRepositories: noOp,
		onRefresh: noOp,
		onDisconnect: noOp,
		onRepair: noOp,
	},
} satisfies Meta<typeof GitHubConnectionRow>

export default meta
type Story = StoryObj<typeof meta>

export const Healthy: Story = {}

export const PersonalAccount: Story = {
	args: {
		connection: {
			...healthyConnection,
			accountLogin: 'founder-personal',
			accountType: 'User',
			repositorySelection: 'all',
			repositoryCount: 2,
		},
	},
}

export const PartialPermissions: Story = {
	args: {
		connection: {
			...healthyConnection,
			accountLogin: 'founder-personal',
			accountType: 'User',
			repositoryCount: 2,
			permissions: { issues: 'read', metadata: 'read' },
			capabilities: {
				...fullCapabilities,
				writeBacklink: false,
				readContents: false,
				writeContents: false,
				readPullRequests: false,
				writePullRequests: false,
			},
		},
	},
}

export const Suspended: Story = {
	args: {
		connection: {
			...healthyConnection,
			status: 'suspended',
			suspendedAt: Date.now() - 1000 * 60 * 60 * 24,
			suspendedByLogin: 'octo-admin',
		},
	},
}

export const SuspendedUnknownActor: Story = {
	args: {
		connection: { ...healthyConnection, status: 'suspended', suspendedAt: null, suspendedByLogin: null },
	},
}

export const NeedsReauth: Story = {
	args: { connection: { ...healthyConnection, needsReauth: true } },
}

export const RepositoriesOpen: Story = {
	args: { defaultDetailsOpen: true },
}

export const RepositoriesLoading: Story = {
	args: { defaultDetailsOpen: true, repositories: undefined, repositoriesLoading: true },
}

export const RepositoriesError: Story = {
	args: { defaultDetailsOpen: true, repositories: undefined, repositoriesError: true },
}

export const RefreshPending: Story = {
	args: { refreshPending: true },
}

export const DisconnectFailed: Story = {
	args: { disconnectError: true },
}

export const DisconnectConfirm: Story = {
	args: { defaultDisconnectDialogOpen: true },
}
