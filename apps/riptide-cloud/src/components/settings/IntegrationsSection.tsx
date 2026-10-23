import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Separator } from '@humanlayer/ui/components/separator'
import { Switch } from '@humanlayer/ui/components/switch'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { AlertCircle, CheckCircle, ExternalLink, Link2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { type ApiClient, useRiptideApi } from '@/api/client'
import type { GitHubCallbackResult } from '@/lib/settings-search'

import { GitHubConnectionRow } from './GitHubConnectionRow'
import { GitHubIntegrationCard } from './GitHubIntegrationCard'
import { SlackIntegrationCard } from './SlackIntegrationCard'

const JIRA_INTEGRATION_DOCS_URL = 'https://docs.humanlayer.com/guide/jira-integration'
const LINEAR_INTEGRATION_DOCS_URL = 'https://docs.humanlayer.com/guide/linear-integration'

function IntegrationStatusBadge({ onDisconnect, isPending }: { onDisconnect: () => void; isPending: boolean }) {
	const [hovered, setHovered] = useState(false)

	if (isPending) {
		return (
			<Badge variant="secondary" className="gap-1">
				Disconnecting...
			</Badge>
		)
	}

	return (
		<div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
			{hovered ? (
				<Badge variant="destructive" className="gap-1 cursor-pointer" onClick={onDisconnect}>
					Disconnect?
				</Badge>
			) : (
				<Badge variant="default" className="gap-1">
					<CheckCircle className="h-3 w-3" />
					Connected
				</Badge>
			)}
		</div>
	)
}

type GitHubConnectionsResult = Awaited<ReturnType<ApiClient['client']['integrations']['github']['listConnections']>>
type GitHubInstallUrlResult = Awaited<ReturnType<ApiClient['client']['integrations']['github']['createInstallUrl']>>
type GitHubRepositoriesResult = Awaited<ReturnType<ApiClient['client']['integrations']['github']['listRepositories']>>
type GitHubRefreshResult = Awaited<ReturnType<ApiClient['client']['integrations']['github']['refreshConnection']>>
type GitHubDisconnectResult = Awaited<ReturnType<ApiClient['client']['integrations']['github']['disconnect']>>
type GitHubConnectionData = GitHubConnectionsResult['connections'][number]

interface WiredGitHubConnectionRowProps {
	readonly connection: GitHubConnectionData
	readonly listRepositories: (connectionId: string) => Promise<GitHubRepositoriesResult>
	readonly refreshConnection: (connectionId: string) => Promise<GitHubRefreshResult>
	readonly disconnectConnection: (connectionId: string) => Promise<GitHubDisconnectResult>
	readonly createRepairUrl: (connectionId: string) => Promise<GitHubInstallUrlResult>
	readonly onConnectionsChanged: () => void
}

// Wired leaf for one installation. Owns that connection's lazy repository query and its refresh,
// disconnect, and reconnect mutations. Each row is independent: its query and mutations key on the
// connection UUID, and its open repository details survive a sibling row's mutation because the row
// keeps its own state across the connection-list refetch (rows are keyed by connection id).
function WiredGitHubConnectionRow({
	connection,
	listRepositories,
	refreshConnection,
	disconnectConnection,
	createRepairUrl,
	onConnectionsChanged,
}: WiredGitHubConnectionRowProps) {
	const [detailsRequested, setDetailsRequested] = useState(false)

	const repositoriesQuery = useQuery({
		queryKey: ['settings', 'integrations', 'github', 'repositories', connection.id],
		queryFn: () => listRepositories(connection.id),
		enabled: detailsRequested,
	})

	const refreshMutation = useMutation({
		mutationFn: () => refreshConnection(connection.id),
		onSuccess: () => {
			toast.success('GitHub connection refreshed')
			onConnectionsChanged()
			if (detailsRequested) void repositoriesQuery.refetch()
		},
		onError: (error: unknown) => {
			Sentry.captureException(error, { tags: { action: 'refresh_github_connection' } })
			toast.error(error instanceof Error ? error.message : 'Failed to refresh GitHub connection')
		},
	})

	const disconnectMutation = useMutation({
		mutationFn: () => disconnectConnection(connection.id),
		onSuccess: ({ success }) => {
			if (success) {
				toast.success('GitHub installation disconnected')
				onConnectionsChanged()
				return
			}
			toast.error('Disconnect did not complete. Local access is preserved — try again.')
		},
		onError: (error: unknown) => {
			Sentry.captureException(error, { tags: { action: 'disconnect_github_connection' } })
			toast.error('Disconnect did not complete. Local access is preserved — try again.')
		},
	})

	const repairMutation = useMutation({
		mutationFn: () => createRepairUrl(connection.id),
		onSuccess: ({ url }) => {
			window.location.assign(url)
		},
		onError: (error: unknown) => {
			Sentry.captureException(error, { tags: { action: 'repair_github_connection' } })
			toast.error(error instanceof Error ? error.message : 'Failed to start GitHub reconnect')
		},
	})

	const disconnectFailed = disconnectMutation.isError || disconnectMutation.data?.success === false

	return (
		<GitHubConnectionRow
			connection={connection}
			repositories={repositoriesQuery.data?.repositories}
			repositoriesLoading={repositoriesQuery.isLoading}
			repositoriesError={repositoriesQuery.isError}
			refreshPending={refreshMutation.isPending}
			disconnectPending={disconnectMutation.isPending}
			disconnectError={disconnectFailed}
			repairPending={repairMutation.isPending}
			onOpenRepositories={() => setDetailsRequested(true)}
			onRefresh={() => refreshMutation.mutate()}
			onDisconnect={() => disconnectMutation.mutate()}
			onRepair={() => repairMutation.mutate()}
		/>
	)
}

export interface WiredGitHubIntegrationCardProps {
	readonly callbackResult?: GitHubCallbackResult
	readonly listConnections: () => Promise<GitHubConnectionsResult>
	readonly createInstallUrl: (connectionId?: string) => Promise<GitHubInstallUrlResult>
	readonly listRepositories: (connectionId: string) => Promise<GitHubRepositoriesResult>
	readonly refreshConnection: (connectionId: string) => Promise<GitHubRefreshResult>
	readonly disconnectConnection: (connectionId: string) => Promise<GitHubDisconnectResult>
	readonly onEnabledChange: (enabled: boolean, onSuccess: () => void) => void
	readonly pollIntervalMs?: number
}

export function WiredGitHubIntegrationCard({
	callbackResult,
	listConnections,
	createInstallUrl,
	listRepositories,
	refreshConnection,
	disconnectConnection,
	onEnabledChange,
	pollIntervalMs = 10_000,
}: WiredGitHubIntegrationCardProps) {
	const githubConnectionsQuery = useQuery({
		// callbackResult participates in the key so a completed handoff (?github=connected) refetches
		// immediately without a useEffect; the interval keeps polling for out-of-band GitHub changes.
		queryKey: ['settings', 'integrations', 'github', 'connections', callbackResult ?? 'none'],
		queryFn: listConnections,
		refetchInterval: pollIntervalMs,
	})
	const createGitHubInstallUrlMutation = useMutation({
		mutationFn: () => createInstallUrl(),
		onError: (error: unknown) => {
			Sentry.captureException(error, { tags: { action: 'create_github_install_url' } })
			toast.error(error instanceof Error ? error.message : 'Failed to create GitHub install link')
		},
	})

	const continueGitHubInstall = async () => {
		const { url } = await createGitHubInstallUrlMutation.mutateAsync()
		window.location.assign(url)
	}

	const copyGitHubInstallLink = async () => {
		const { url } = await createGitHubInstallUrlMutation.mutateAsync()
		await navigator.clipboard.writeText(url)
		toast.success('GitHub install link copied')
	}

	const connections = githubConnectionsQuery.data?.connections ?? []
	const refetchConnections = () => void githubConnectionsQuery.refetch()

	return (
		<GitHubIntegrationCard
			connected={connections.length > 0}
			enabled={githubConnectionsQuery.data?.enabled ?? false}
			loading={githubConnectionsQuery.isLoading}
			installLinkPending={createGitHubInstallUrlMutation.isPending}
			callbackResult={callbackResult}
			onContinueInstall={() => void continueGitHubInstall()}
			onCopyInstallLink={() => void copyGitHubInstallLink()}
			onEnabledChange={(checked) => onEnabledChange(checked, refetchConnections)}
		>
			{connections.map((connection) => (
				<WiredGitHubConnectionRow
					key={connection.id}
					connection={connection}
					listRepositories={listRepositories}
					refreshConnection={refreshConnection}
					disconnectConnection={disconnectConnection}
					createRepairUrl={createInstallUrl}
					onConnectionsChanged={refetchConnections}
				/>
			))}
		</GitHubIntegrationCard>
	)
}

export function IntegrationsSection() {
	const { client, queryClient: apiQueryClient } = useRiptideApi()
	const { github: githubCallback, github_error: githubError } = useSearch({ from: '/settings' })

	const orgSettingsQuery = useQuery(
		apiQueryClient.auth.admin.organizations.settings.get.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const jiraStatusQuery = useQuery(
		apiQueryClient.integrations.jira.getStatus.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const disconnectJiraMutation = useMutation(
		apiQueryClient.integrations.jira.disconnect.mutationOptions({
			onSuccess: () => {
				toast.success('Jira disconnected')
				void jiraStatusQuery.refetch()
				void orgSettingsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(error instanceof Error ? error : new Error('Failed to disconnect Jira'), {
					tags: { action: 'disconnect_jira' },
				})
				toast.error(error.message || 'Failed to disconnect Jira')
			},
		}),
	)

	const linearStatusQuery = useQuery(
		apiQueryClient.integrations.linear.getStatus.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const disconnectLinearMutation = useMutation(
		apiQueryClient.integrations.linear.disconnect.mutationOptions({
			onSuccess: () => {
				toast.success('Linear disconnected')
				void linearStatusQuery.refetch()
				void orgSettingsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(error instanceof Error ? error : new Error('Failed to disconnect Linear'), {
					tags: { action: 'disconnect_linear' },
				})
				toast.error(error.message || 'Failed to disconnect Linear')
			},
		}),
	)

	const updateOrgSettingsMutation = useMutation(
		apiQueryClient.auth.admin.organizations.settings.set.mutationOptions({
			onSuccess: () => {
				toast.success('Feature settings updated')
				void orgSettingsQuery.refetch()
			},
			onError: (error) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update feature settings'),
					{
						tags: { action: 'update_org_settings' },
					},
				)
				toast.error(error.message || 'Failed to update feature settings')
			},
		}),
	)

	const githubCallbackResult: GitHubCallbackResult | undefined = githubError ?? githubCallback

	return (
		<section>
			<div className="mb-4">
				<h2 className="text-base font-semibold">Integrations</h2>
				<p className="text-sm text-muted-foreground">Connect the tools your organization already uses.</p>
			</div>
			<div className="space-y-6">
				<WiredGitHubIntegrationCard
					callbackResult={githubCallbackResult}
					listConnections={() => client.integrations.github.listConnections({})}
					createInstallUrl={(connectionId) =>
						client.integrations.github.createInstallUrl(connectionId ? { connectionId } : {})
					}
					listRepositories={(connectionId) => client.integrations.github.listRepositories({ connectionId })}
					refreshConnection={(connectionId) => client.integrations.github.refreshConnection({ connectionId })}
					disconnectConnection={(connectionId) => client.integrations.github.disconnect({ connectionId })}
					onEnabledChange={(checked, onSuccess) =>
						updateOrgSettingsMutation.mutate({ githubIntegrationEnabled: checked }, { onSuccess })
					}
				/>

				<Separator />

				{/* Jira Integration */}
				<div className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<Label className="text-sm font-medium">Jira</Label>
							{jiraStatusQuery.data?.connected && !jiraStatusQuery.data.needsReauth && (
								<IntegrationStatusBadge
									onDisconnect={() => disconnectJiraMutation.mutate({})}
									isPending={disconnectJiraMutation.isPending}
								/>
							)}
							{jiraStatusQuery.data?.needsReauth && (
								<Badge variant="destructive" className="gap-1">
									<AlertCircle className="h-3 w-3" />
									Needs Reconnection
								</Badge>
							)}
						</div>
						<Button variant="link" className="h-auto p-0 text-sm" asChild>
							<a href={JIRA_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer">
								Setup guide
								<ExternalLink className="ml-1 h-3.5 w-3.5" />
							</a>
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						Connect your Jira Cloud instance to create tasks from Jira tickets.
					</p>
					{jiraStatusQuery.data?.connected ? (
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-1">
									<Label className="text-sm">Enable Jira Integration</Label>
									<p className="text-sm text-muted-foreground">
										Allow users to create tasks from Jira tickets.
									</p>
								</div>
								<Switch
									checked={orgSettingsQuery.data?.jiraIntegrationEnabled ?? false}
									onCheckedChange={(checked) =>
										updateOrgSettingsMutation.mutate({ jiraIntegrationEnabled: checked })
									}
									disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
								/>
							</div>
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Link2 className="h-4 w-4" />
								<span>{jiraStatusQuery.data.siteUrl}</span>
							</div>
							{jiraStatusQuery.data.needsReauth && (
								<Button
									size="sm"
									variant="destructive"
									onClick={async () => {
										const { url } = await client.integrations.jira.createInstallUrl({
											client: 'cloud',
										})
										window.location.href = url
									}}
								>
									Reconnect Jira
								</Button>
							)}
						</div>
					) : (
						<Button
							variant="outline"
							onClick={async () => {
								const { url } = await client.integrations.jira.createInstallUrl({
									client: 'cloud',
								})
								window.location.href = url
							}}
						>
							<Link2 className="mr-2 h-4 w-4" />
							Connect Jira
						</Button>
					)}
				</div>

				<Separator />

				{/* Linear Integration */}
				<div className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<Label className="text-sm font-medium">Linear</Label>
							{linearStatusQuery.data?.connected && !linearStatusQuery.data.needsReauth && (
								<IntegrationStatusBadge
									onDisconnect={() => disconnectLinearMutation.mutate({})}
									isPending={disconnectLinearMutation.isPending}
								/>
							)}
							{linearStatusQuery.data?.needsReauth && (
								<Badge variant="destructive" className="gap-1">
									<AlertCircle className="h-3 w-3" />
									Needs Reconnection
								</Badge>
							)}
						</div>
						<Button variant="link" className="h-auto p-0 text-sm" asChild>
							<a href={LINEAR_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer">
								Setup guide
								<ExternalLink className="ml-1 h-3.5 w-3.5" />
							</a>
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						Connect your Linear workspace to sync issue status and link artifacts.
					</p>
					{linearStatusQuery.data?.connected ? (
						<div className="space-y-3">
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-1">
									<Label className="text-sm">Enable Linear Integration</Label>
									<p className="text-sm text-muted-foreground">
										Allow users to create tasks from Linear issues.
									</p>
								</div>
								<Switch
									checked={orgSettingsQuery.data?.linearIntegrationEnabled ?? false}
									onCheckedChange={(checked) =>
										updateOrgSettingsMutation.mutate({ linearIntegrationEnabled: checked })
									}
									disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
								/>
							</div>
							{linearStatusQuery.data.needsReauth && (
								<Button
									size="sm"
									variant="destructive"
									onClick={async () => {
										const { url } = await client.integrations.linear.createInstallUrl({
											client: 'cloud',
										})
										window.location.href = url
									}}
								>
									Reconnect Linear
								</Button>
							)}
						</div>
					) : (
						<Button
							variant="outline"
							onClick={async () => {
								const { url } = await client.integrations.linear.createInstallUrl({
									client: 'cloud',
								})
								window.location.href = url
							}}
						>
							<Link2 className="mr-2 h-4 w-4" />
							Connect Linear
						</Button>
					)}
				</div>

				<Separator />

				<SlackIntegrationCard />
			</div>
		</section>
	)
}
