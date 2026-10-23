import type {
	GitHubConnection,
	GitHubRepository,
} from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import { Alert, AlertDescription, AlertTitle } from '@humanlayer/ui/components/alert'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { cn } from '@humanlayer/ui/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import {
	Building2,
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	GitBranch,
	Loader2,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
	TriangleAlert,
	Unplug,
	UserRound,
} from 'lucide-react'
import { useState } from 'react'

import { GitHubRepositoryList } from './GitHubRepositoryList'

// The grant carries whatever slugs GitHub names, so the roadmap below picks the ones this row
// explains rather than reading them off the payload's shape.
type PermissionKey = 'contents' | 'issues' | 'pull_requests' | 'metadata' | 'checks' | 'statuses'
type PermissionLevel = GitHubConnection['permissions'][PermissionKey]

const PERMISSION_LEVEL_RANK: Record<'read' | 'write', number> = { read: 1, write: 2 }

const levelRank = (level: PermissionLevel): number => (level ? PERMISSION_LEVEL_RANK[level] : 0)

interface RoadmapPermission {
	readonly key: PermissionKey
	readonly label: string
	readonly required: 'read' | 'write'
}

// The permissions the GitHub App requests up front (contents/issues/pull_requests: write,
// metadata/checks/statuses: read). The settings card compares the persisted grant against
// each and names every shortfall, matching the service's requirement map.
const GITHUB_PERMISSION_ROADMAP: ReadonlyArray<RoadmapPermission> = [
	{ key: 'issues', label: 'Issues', required: 'write' },
	{ key: 'contents', label: 'Repository contents', required: 'write' },
	{ key: 'pull_requests', label: 'Pull requests', required: 'write' },
	{ key: 'metadata', label: 'Metadata', required: 'read' },
	{ key: 'checks', label: 'Checks', required: 'read' },
	{ key: 'statuses', label: 'Commit statuses', required: 'read' },
]

interface PermissionStatus extends RoadmapPermission {
	readonly granted: PermissionLevel
	readonly satisfied: boolean
}

function describePermissions(connection: GitHubConnection): ReadonlyArray<PermissionStatus> {
	return GITHUB_PERMISSION_ROADMAP.map((permission) => {
		const granted = connection.permissions[permission.key]
		return {
			...permission,
			granted,
			satisfied: levelRank(granted) >= PERMISSION_LEVEL_RANK[permission.required],
		}
	})
}

const formatTimestamp = (value: number): string => format(new Date(value), 'PPp')

const formatRelative = (value: number): string => formatDistanceToNow(new Date(value), { addSuffix: true })

export interface GitHubConnectionRowProps {
	readonly connection: GitHubConnection
	readonly repositories?: ReadonlyArray<GitHubRepository>
	readonly repositoriesLoading?: boolean
	readonly repositoriesError?: boolean
	readonly refreshPending?: boolean
	readonly disconnectPending?: boolean
	readonly disconnectError?: boolean
	readonly repairPending?: boolean
	readonly defaultDetailsOpen?: boolean
	readonly defaultDisconnectDialogOpen?: boolean
	readonly onOpenRepositories?: () => void
	readonly onRefresh?: () => void
	readonly onDisconnect?: () => void
	readonly onRepair?: () => void
}

/**
 * Pure lifecycle-management view for one GitHub installation, keyed by its internal connection
 * UUID. Extends the Phase 1 healthy-connection view with permission-grant warnings, suspension
 * remediation, reauth repair, per-row refresh/manage/disconnect actions, and a confirmed uninstall
 * dialog. All state is driven by props (plus local disclosure/dialog state) so every deterministic
 * state renders in Storybook without provider calls.
 */
export function GitHubConnectionRow({
	connection,
	repositories,
	repositoriesLoading = false,
	repositoriesError = false,
	refreshPending = false,
	disconnectPending = false,
	disconnectError = false,
	repairPending = false,
	defaultDetailsOpen = false,
	defaultDisconnectDialogOpen = false,
	onOpenRepositories,
	onRefresh,
	onDisconnect,
	onRepair,
}: GitHubConnectionRowProps) {
	const [detailsOpen, setDetailsOpen] = useState(defaultDetailsOpen)
	const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(defaultDisconnectDialogOpen)

	const AccountIcon = connection.accountType === 'Organization' ? Building2 : UserRound
	const suspended = connection.status === 'suspended'
	const needsReauth = connection.needsReauth
	const permissions = describePermissions(connection)
	const missingPermissions = permissions.filter((permission) => !permission.satisfied)

	const toggleDetails = () => {
		const next = !detailsOpen
		setDetailsOpen(next)
		if (next) onOpenRepositories?.()
	}

	return (
		<div
			data-connection-id={connection.id}
			className={cn('rounded-lg border bg-muted/30 p-4', suspended && 'border-destructive/50')}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
						<AccountIcon className="size-4" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium">{connection.accountLogin}</p>
						<p className="text-xs text-muted-foreground">GitHub {connection.accountType.toLowerCase()}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{suspended ? (
						<Badge variant="destructive" className="gap-1">
							<ShieldAlert className="size-3" aria-hidden="true" /> Suspended
						</Badge>
					) : needsReauth ? (
						<Badge variant="destructive" className="gap-1">
							<TriangleAlert className="size-3" aria-hidden="true" /> Needs reconnection
						</Badge>
					) : (
						<Badge variant="secondary" className="gap-1.5">
							<GitBranch className="size-3" aria-hidden="true" />
							{connection.repositoryCount}{' '}
							{connection.repositoryCount === 1 ? 'repository' : 'repositories'}
						</Badge>
					)}
				</div>
			</div>

			{suspended && (
				<Alert variant="destructive" className="mt-3">
					<ShieldAlert />
					<AlertTitle>Installation suspended</AlertTitle>
					<AlertDescription className="space-y-2">
						<p>
							Suspended by {connection.suspendedByLogin ?? 'an unknown actor'}
							{connection.suspendedAt !== null && ` on ${formatTimestamp(connection.suspendedAt)}`}.
							Reconnecting will not fix it — a GitHub administrator must lift the suspension from the
							installation settings before Riptide can use this connection again.
						</p>
						<Button variant="outline" size="sm" asChild>
							<a href={connection.managementUrl} target="_blank" rel="noreferrer">
								Open GitHub settings <ExternalLink className="ml-1.5 size-3.5" aria-hidden="true" />
							</a>
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{!suspended && needsReauth && (
				<Alert variant="destructive" className="mt-3">
					<TriangleAlert />
					<AlertTitle>Reconnection required</AlertTitle>
					<AlertDescription>
						GitHub reported a credential problem for this installation. Reconnect to restore access;
						repositories and permissions are preserved.
					</AlertDescription>
				</Alert>
			)}

			{!suspended && missingPermissions.length > 0 && (
				<div className="mt-3 space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
					<div className="flex items-center gap-2 text-sm font-medium">
						<ShieldCheck className="size-4" aria-hidden="true" /> Permissions
					</div>
					<p className="text-xs">
						A GitHub admin needs to approve the updated permissions to get access to the latest integration
						features. Refresh this connection once that is done.
					</p>
					<p className="flex items-start gap-2 text-xs">
						<TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
						<span>
							Missing:{' '}
							{missingPermissions.map((permission, index) => (
								<span key={permission.key}>
									{index > 0 ? ', ' : ''}
									<span className="font-medium">{permission.label}</span> ({permission.required})
								</span>
							))}
						</span>
					</p>
				</div>
			)}

			<dl className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
				<div className="flex items-center justify-between gap-2 sm:justify-start">
					<dt className="text-muted-foreground">Repository access</dt>
					<dd className="font-medium">
						{connection.repositorySelection === 'all' ? 'All repositories' : 'Selected repositories'}
					</dd>
				</div>
				<div className="flex items-center justify-between gap-2 sm:justify-end">
					<dt className="text-muted-foreground">Updated</dt>
					<dd className="font-medium">{formatRelative(connection.lastReconciledAt)}</dd>
				</div>
			</dl>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					aria-expanded={detailsOpen}
					onClick={toggleDetails}
					className="gap-1.5"
				>
					<ChevronDown
						className={cn('size-3.5 transition-transform', detailsOpen && 'rotate-180')}
						aria-hidden="true"
					/>
					Repositories
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={suspended || refreshPending}
					onClick={onRefresh}
					className="gap-1.5"
				>
					<RefreshCw className={cn('size-3.5', refreshPending && 'animate-spin')} aria-hidden="true" />
					Refresh
				</Button>
				<Button variant="ghost" size="sm" asChild className="gap-1.5">
					<a href={connection.managementUrl} target="_blank" rel="noreferrer">
						<ExternalLink className="size-3.5" aria-hidden="true" /> Manage
					</a>
				</Button>
				{needsReauth && !suspended && (
					<Button variant="outline" size="sm" disabled={repairPending} onClick={onRepair} className="gap-1.5">
						{repairPending ? (
							<Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
						) : (
							<RefreshCw className="size-3.5" aria-hidden="true" />
						)}
						Reconnect
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setDisconnectDialogOpen(true)}
					className="gap-1.5 text-destructive hover:text-destructive"
				>
					<Unplug className="size-3.5" aria-hidden="true" /> Disconnect
				</Button>
			</div>

			{disconnectError && (
				<p className="mt-2 text-xs text-destructive">
					Disconnect did not complete. Local access is preserved — try again.
				</p>
			)}

			{detailsOpen && (
				<div className="mt-3 border-t pt-3">
					<GitHubRepositoryList
						repositories={repositories}
						loading={repositoriesLoading}
						error={repositoriesError}
					/>
				</div>
			)}

			<Dialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disconnect {connection.accountLogin}?</DialogTitle>
						<DialogDescription>
							Disconnecting uninstalls the Riptide GitHub App from this account. Riptide keeps no access
							to your code after you disconnect, and its repositories stop appearing in the new-task form.
						</DialogDescription>
					</DialogHeader>
					<Alert>
						<CheckCircle2 />
						<AlertTitle>This only affects this installation</AlertTitle>
						<AlertDescription>
							Your other GitHub connections and the organization-wide switch stay unchanged.
						</AlertDescription>
					</Alert>
					{disconnectError && (
						<p className="text-sm text-destructive">
							GitHub could not confirm the uninstall. Nothing was removed — try again.
						</p>
					)}
					<DialogFooter>
						<Button variant="ghost" onClick={() => setDisconnectDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" disabled={disconnectPending} onClick={onDisconnect}>
							{disconnectPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							Disconnect and uninstall
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
