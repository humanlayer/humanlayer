import type { GitHubConnection, GitHubRepository } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

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
	repositoryCount: 3,
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

// Provider-free harness composing the real Pure card + rows with local interaction state, so the
// disconnected preview, the consent dialog, org switch, copy feedback, and per-row repository
// disclosure can be clicked through without any query or mutation wiring.
function GitHubIntegrationCardShellDemo() {
	const [connected, setConnected] = useState(false)
	const [enabled, setEnabled] = useState(true)
	const [copied, setCopied] = useState(false)

	return (
		<div className="max-w-2xl space-y-3">
			<label className="flex items-center gap-2 text-xs text-muted-foreground">
				<input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} />
				Connected
			</label>
			<GitHubIntegrationCard
				connected={connected}
				enabled={enabled}
				onEnabledChange={setEnabled}
				onContinueInstall={noOp}
				onCopyInstallLink={() => setCopied(true)}
			>
				<GitHubConnectionRow
					connection={healthyConnection}
					repositories={repositories}
					onOpenRepositories={noOp}
					onRefresh={noOp}
					onDisconnect={noOp}
					onRepair={noOp}
				/>
				<GitHubConnectionRow
					connection={partialConnection}
					repositories={repositories.slice(0, 2)}
					onOpenRepositories={noOp}
					onRefresh={noOp}
					onDisconnect={noOp}
					onRepair={noOp}
				/>
			</GitHubIntegrationCard>
			{copied && <p className="text-xs text-muted-foreground">Handoff link copied in this demo.</p>}
		</div>
	)
}

const meta = {
	title: 'Shell Demos/Settings/GitHubIntegrationCard',
	component: GitHubIntegrationCardShellDemo,
} satisfies Meta<typeof GitHubIntegrationCardShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {}
