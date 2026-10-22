import type { GitHubConnection } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { GitHubConnectionRow } from './GitHubConnectionRow'
import { GitHubIntegrationCard } from './GitHubIntegrationCard'

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

const partialConnection: GitHubConnection = {
	...healthyConnection,
	id: '019f536c-b021-763a-84b2-bbd8ee8e2914',
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
}

const suspendedConnection: GitHubConnection = {
	...healthyConnection,
	id: '019f536c-b021-763a-84b2-bbd8ee8e2915',
	accountLogin: 'contoso',
	repositoryCount: 5,
	status: 'suspended',
	suspendedAt: Date.now() - 1000 * 60 * 60 * 24,
	suspendedByLogin: 'octo-admin',
}

const noOp = () => undefined

const meta = {
	title: 'Components/Settings/GitHubIntegrationCard',
	component: GitHubIntegrationCard,
	args: {
		connected: false,
		enabled: false,
		onContinueInstall: noOp,
		onCopyInstallLink: noOp,
		onEnabledChange: noOp,
	},
} satisfies Meta<typeof GitHubIntegrationCard>

export default meta
type Story = StoryObj<typeof meta>

export const Disconnected: Story = {}

export const ConsentOpen: Story = { args: { defaultConsentOpen: true } }

export const InstallLinkPending: Story = {
	args: { defaultConsentOpen: true, installLinkPending: true },
}

export const CallbackError: Story = { args: { callbackResult: 'invalid_link' } }

export const UnclaimedActionRequired: Story = { args: { callbackResult: 'unclaimed' } }

export const ConnectedSingle: Story = {
	args: { connected: true, enabled: true, callbackResult: 'connected' },
	render: (args) => (
		<GitHubIntegrationCard {...args}>
			<GitHubConnectionRow connection={healthyConnection} onOpenRepositories={noOp} onRefresh={noOp} onDisconnect={noOp} onRepair={noOp} />
		</GitHubIntegrationCard>
	),
}

export const ConnectedCollection: Story = {
	args: { connected: true, enabled: true },
	render: (args) => (
		<GitHubIntegrationCard {...args}>
			<GitHubConnectionRow connection={healthyConnection} onOpenRepositories={noOp} onRefresh={noOp} onDisconnect={noOp} onRepair={noOp} />
			<GitHubConnectionRow connection={partialConnection} onOpenRepositories={noOp} onRefresh={noOp} onDisconnect={noOp} onRepair={noOp} />
			<GitHubConnectionRow connection={suspendedConnection} onOpenRepositories={noOp} onRefresh={noOp} onDisconnect={noOp} onRepair={noOp} />
		</GitHubIntegrationCard>
	),
}
