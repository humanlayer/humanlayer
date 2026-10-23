import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { WorkspaceTabPure, type WorkspaceTreeNode } from '@humanlayer/ui/components/workspace-tab-pure'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { Monitor } from 'lucide-react'
import { type ReactNode, useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { WorkspaceSetupRepoSuffix } from '@/components/task-detail/WorkspaceSetupCard'
import { workspaceOwnerDisplay } from '@/components/workspace-owner-display'
import { type OrgMember, useOrgMembers } from '@/hooks/useOrgMembers'
import type { WorkspaceHostGroup } from '@/lib/workspace-host-groups'

export type { WorkspaceHostGroup } from '@/lib/workspace-host-groups'

const withTrailingSlash = (path: string) => (path.endsWith('/') ? path : `${path}/`)

export function SidebarWidgetWorkspace({
	hosts,
	children,
	renderHostAction,
}: {
	hosts: WorkspaceHostGroup[]
	children?: (hostId: string, localPath: string) => ReactNode
	renderHostAction?: (hostId: string) => ReactNode
}) {
	const { membersMap } = useOrgMembers()
	const { user } = useAuth()
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto">
			{hosts.map((host) => {
				const ownerUserId = host.userId ?? (host.isCurrentUserHost ? (user?.id ?? undefined) : undefined)
				const member = ownerUserId ? membersMap.get(ownerUserId) : undefined
				return (
					<WorkspaceHostSection
						key={host.hostId}
						host={host}
						member={member}
						profilePictureUrl={
							member?.profilePictureUrl ??
							(ownerUserId === user?.id ? (user?.profilePictureUrl ?? undefined) : undefined)
						}
						hostAction={renderHostAction?.(host.hostId)}
					>
						{children}
					</WorkspaceHostSection>
				)
			})}
		</div>
	)
}

function WorkspaceHostSection({
	host,
	member,
	profilePictureUrl,
	hostAction,
	children,
}: {
	host: WorkspaceHostGroup
	member?: OrgMember
	profilePictureUrl?: string
	hostAction?: ReactNode
	children?: (hostId: string, localPath: string) => ReactNode
}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const hostLabel = host.hostName?.trim() || `Host ${host.hostId.slice(0, 6)}`
	const owner = workspaceOwnerDisplay(member, host.userId, profilePictureUrl)
	const nodes = useMemo<WorkspaceTreeNode[]>(
		() => [
			{
				id: 'workspace-root',
				label: withTrailingSlash(host.workspaceView.workspaceBaseDirectory),
				kind: 'root',
			},
			...host.workspaceView.repos.map<WorkspaceTreeNode>((repo) => ({
				id: `repo:${repo.localPath}`,
				label: withTrailingSlash(repo.relativePath),
				description: repo.description,
				primary: repo.primary,
				kind: 'repo',
			})),
		],
		[host.workspaceView],
	)
	const rawState = useMemo(
		() =>
			JSON.stringify(
				host.setupRow
					? {
							host: { id: host.hostId, name: host.hostName, userId: host.userId },
							workspace: host.workspaceView,
							setup: host.setupRow,
						}
					: {
							host: { id: host.hostId, name: host.hostName, userId: host.userId },
							workspace: host.workspaceView,
						},
				(_key, value) => (typeof value === 'bigint' ? value.toString() : value),
				2,
			),
		[host],
	)
	const localPathByNodeId = useMemo(
		() => new Map(host.workspaceView.repos.map((repo) => [`repo:${repo.localPath}`, repo.localPath])),
		[host.workspaceView.repos],
	)
	const handleCopyNode = useCallback(
		(node: WorkspaceTreeNode) => {
			void copyToClipboard(node.label)
			toast.success('Workspace directory copied to clipboard')
		},
		[copyToClipboard],
	)

	return (
		<section aria-label={`Workspace for ${hostLabel}`} className="min-w-0">
			<header className="flex items-center gap-2.5 border border-border/70 bg-muted/30 px-2.5 py-2">
				<Avatar className="size-7 shrink-0 border border-border" title={owner.name}>
					<AvatarImage src={owner.profilePictureUrl ?? ''} alt={owner.name} />
					<AvatarFallback className="text-xs">{owner.initials}</AvatarFallback>
				</Avatar>
				<Monitor className="size-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
				<div className="min-w-0 flex-1">
					<div className="truncate font-mono text-xs font-medium text-foreground">{hostLabel}</div>
				</div>
				{hostAction}
				<code className="shrink-0 text-xs text-muted-foreground" title={host.hostId}>
					{host.hostId.slice(0, 6)}
				</code>
			</header>
			{!host.configured ? (
				<div className="border-x border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
					No workspace has been configured for this task on this host. The paths below are planned and will be
					created after repository locations are provided.
				</div>
			) : null}
			<div className="ml-[13px] border-l border-border/70 pb-1 pl-3 pt-3">
				<WorkspaceTabPure
					nodes={nodes}
					rawState={rawState}
					onCopyNode={handleCopyNode}
					renderRepoSuffix={(node) => {
						const localPath = localPathByNodeId.get(node.id)
						return host.setupRow && localPath ? (
							<WorkspaceSetupRepoSuffix row={host.setupRow} localPath={localPath} />
						) : null
					}}
					renderRepoDetails={(node) => {
						if (!host.setupRow || !children) return null
						const localPath = localPathByNodeId.get(node.id)
						if (!localPath) return null
						const repo = host.setupRow.workspace_setup_state.repos.find(
							(candidate) => candidate.localPath === localPath,
						)
						if (!repo) return null
						const active = repo.status !== 'done' && repo.status !== 'setup_requested'
						const failed = host.setupRow.error?.localPath === localPath
						return active || failed ? children(host.hostId, localPath) : null
					}}
					className="h-auto shrink-0"
				/>
			</div>
		</section>
	)
}
