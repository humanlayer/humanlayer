import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Input } from '@humanlayer/ui/components/input'
import { SessionLabelBadge } from '@humanlayer/ui/components/session-label-badge'
import { UnreadBullet } from '@humanlayer/ui/components/sidebar/status-indicators'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { TableCell, TableRow } from '@humanlayer/ui/components/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { Link as RouterLink } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Link, MoreHorizontal, Pencil, ShieldOff, TriangleAlert } from 'lucide-react'
import { type FC, type ReactNode, useCallback } from 'react'
import { toast } from 'sonner'

import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import type { OrgMember } from '@/hooks/useOrgMembers'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copySessionDeepLink, getSessionShareUrl } from '@/utils/sharing-links'

import { cn } from '../../lib/utils'
import type { SessionStatus, TableSession } from './types'
import { getSessionStatusClass } from './types'

export interface SessionTableRowProps {
	session: TableSession
	isFocused: boolean
	isDraftsView: boolean
	hideTaskColumn: boolean
	/** Show "Created By" column with user avatar and name */
	showCreatedBy: boolean
	/** Hide non-essential columns (Labels, Working Directory, Last Activity) */
	compactMode: boolean
	/** Org members map for resolving user names/avatars */
	orgMembers?: Map<string, OrgMember>
	/** Hide action menu (for archived views where actions don't apply) */
	hideActionMenu: boolean
	/** Hide share link action (when parent task is not shared with org) */
	isShareLinkHidden: boolean
	/** Hide archive action in row menu (for shared tasks viewed by non-owners) */
	isArchiveActionHidden: boolean
	/** Hide bypass permissions action in row menu (for shared tasks viewed by non-owners) */
	isBypassActionHidden: boolean

	// Inline editing
	isEditing: boolean
	editValue: string
	onEditChange: (value: string) => void
	onEditSave: () => void
	onEditCancel: () => void
	onStartEdit: () => void

	// Callbacks
	onRowClick: () => void
	onRowMouseEnter: () => void
	onRowMouseLeave: () => void
	/** Called when user clicks Archive in the action menu */
	onOpenArchiveDialog: () => void
	/** Called when user clicks Bypass Permissions in the action menu */
	onOpenBypassDialog: () => void

	// Utilities passed from parent
	renderSessionStatus: (session: TableSession) => ReactNode
}

export const SessionTableRow: FC<SessionTableRowProps> = ({
	session,
	isFocused,
	isDraftsView,
	hideTaskColumn,
	showCreatedBy,
	compactMode,
	orgMembers,
	hideActionMenu,
	isShareLinkHidden,
	isArchiveActionHidden,
	isBypassActionHidden,
	isEditing,
	editValue,
	onEditChange,
	onEditSave,
	onEditCancel,
	onStartEdit,
	onRowClick,
	onRowMouseEnter,
	onRowMouseLeave,
	onOpenArchiveDialog,
	onOpenBypassDialog,
	renderSessionStatus,
}) => {
	const displayTitle = session.title || session.summary || session.query || ''
	const sessionStatusNode = renderSessionStatus(session)

	// Stable handler keyed on the session id so an unrelated re-render of an unfocused
	// row can't churn the shared `copy-session-url` registry entry (same shared-id
	// safety pattern as the task table's `archive-task` action).
	const handleCopySessionUrl = useCallback(() => void copySessionDeepLink(session.id), [session.id])

	// "Copy Session URL" for the focused row — both the standalone sessions table and
	// the table embedded in a task page render this row component. Drafts are excluded
	// because they have no `/sessions/$sessionId` route until launched.
	useCommandPaletteAction({
		id: 'copy-session-url',
		label: 'Copy Session URL',
		icon: Link,
		shortcut: hotkeysCatalog.global.shortcuts.copyPrimaryUrl.display,
		enabled: isFocused && session.status !== 'draft',
		onSelect: handleCopySessionUrl,
	})

	return (
		<TableRow
			data-session-id={session.id}
			onMouseEnter={onRowMouseEnter}
			onMouseLeave={onRowMouseLeave}
			onClick={onRowClick}
			className={cn(
				'cursor-pointer transition-colors duration-200 border-l-2! border-b-0',
				isFocused
					? ['border-l-[var(--terminal-accent)]!', 'bg-accent/10']
					: ['border-l-transparent!', 'hover:bg-transparent!'],
				session.archived && 'opacity-60',
			)}
		>
			{/* Status (hidden in drafts view) */}
			{!isDraftsView && (
				<TableCell className="relative pl-16">
					{session.isUnread && (
						<span className="absolute left-6 top-1/2 -translate-y-1/2 inline-flex items-center justify-center">
							<UnreadBullet />
						</span>
					)}
					<div className="flex items-center gap-1.5">
						{session.status !== 'failed' && (
							<>
								{session.dangerouslySkipPermissions && (
									<ShieldOff
										className="inline-block w-4 h-4 text-[var(--terminal-error)] animate-pulse-error shrink-0"
										strokeWidth={3}
									/>
								)}
								{session.autoAcceptEdits && !session.dangerouslySkipPermissions && (
									<span className="text-[var(--terminal-warning)] text-base leading-none animate-pulse-warning shrink-0">
										⏵⏵
									</span>
								)}
							</>
						)}
						{session.status === 'running' && (
							<SyncGridAnimation
								variant="ring"
								synchronized
								size="sm"
								className="text-[var(--terminal-success)] shrink-0"
							/>
						)}
						{session.status === 'interrupt_requested' && (
							<SyncGridAnimation
								variant="ring"
								synchronized
								size="sm"
								className="text-[var(--terminal-warning)] shrink-0"
							/>
						)}
						{session.status === 'lost' && (
							<TriangleAlert
								className="h-4 w-4 shrink-0 text-[var(--terminal-warning)]"
								strokeWidth={2}
							/>
						)}
						{(session.status === 'launching' ||
							session.status === 'ready_for_launch' ||
							session.status === 'resuming') && (
							<SyncGridAnimation
								variant="snake"
								synchronized
								size="sm"
								speed={120}
								className="text-muted-foreground shrink-0"
							/>
						)}
						<span className={getSessionStatusClass(sessionStatusNode as SessionStatus)}>
							{sessionStatusNode}
						</span>
					</div>
				</TableCell>
			)}

			{/* Title (with inline editing) */}
			<TableCell className={cn('max-w-[300px]', isDraftsView && 'pl-16')}>
				{isEditing ? (
					<div className="flex items-center gap-2">
						<Input
							value={editValue}
							onChange={(e) => onEditChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault()
									onEditSave()
								} else if (e.key === 'Escape') {
									e.preventDefault()
									onEditCancel()
								}
							}}
							onClick={(e) => e.stopPropagation()}
							className="h-7 text-sm"
							autoFocus
							spellCheck={false}
						/>
						<Button
							size="sm"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation()
								onEditSave()
							}}
							className="h-7 px-2"
						>
							Save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation()
								onEditCancel()
							}}
							className="h-7 px-2"
						>
							Cancel
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-2 group min-w-0">
						{session.status === 'draft' ? (
							<RouterLink
								to="/sessions/draft"
								search={{ draftId: session.id, taskId: session.taskId }}
								preload="intent"
								className="block truncate no-underline"
								onClick={(e) => e.stopPropagation()}
							>
								<Tooltip disableHoverableContent>
									<TooltipTrigger asChild>
										<span className="cursor-help">{displayTitle}</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-[600px] pointer-events-none">
										<span>{displayTitle || 'No title'}</span>
									</TooltipContent>
								</Tooltip>
							</RouterLink>
						) : (
							<RouterLink
								to="/sessions/$sessionId"
								params={{ sessionId: session.id }}
								preload="intent"
								className="block truncate no-underline"
								onClick={(e) => e.stopPropagation()}
							>
								<Tooltip disableHoverableContent>
									<TooltipTrigger asChild>
										<span className="cursor-help">{displayTitle}</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-[600px] pointer-events-none">
										<span>{displayTitle || 'No title'}</span>
									</TooltipContent>
								</Tooltip>
							</RouterLink>
						)}
						<Button
							size="sm"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation()
								onStartEdit()
							}}
							className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
						>
							<Pencil className="h-3 w-3" />
						</Button>
					</div>
				)}
			</TableCell>

			{/* Labels (hidden in drafts view) */}
			{!isDraftsView && (
				<TableCell>
					{Array.isArray(session.labels) && session.labels.length > 0 && (
						<div className="flex gap-1 flex-wrap">
							{session.labels.map((label) => (
								<SessionLabelBadge key={label.name} label={label} />
							))}
						</div>
					)}
				</TableCell>
			)}

			{/* Task (hidden when viewing a specific task) */}
			{!hideTaskColumn && (
				<TableCell className="max-w-[150px]">
					{session.taskName ? (
						<Tooltip disableHoverableContent>
							<TooltipTrigger asChild>
								<span className="block truncate cursor-help text-sm">{session.taskName}</span>
							</TooltipTrigger>
							<TooltipContent className="max-w-[400px] pointer-events-none">
								<span>{session.taskName}</span>
							</TooltipContent>
						</Tooltip>
					) : (
						<span className="text-muted-foreground">-</span>
					)}
				</TableCell>
			)}

			{/* Created By */}
			{showCreatedBy && (
				<TableCell>
					{session.createdByUserId ? (
						(() => {
							const member = orgMembers?.get(session.createdByUserId)
							if (!member)
								return (
									<span className="text-muted-foreground">{session.createdByUserId.slice(0, 8)}</span>
								)
							const fullName =
								[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
							const initials =
								member.firstName || member.lastName
									? `${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}`.toUpperCase()
									: member.email
										? member.email[0]?.toUpperCase()
										: '?'
							return (
								<div className="flex items-center gap-2 min-w-0">
									<Avatar className="h-5 w-5 shrink-0">
										<AvatarImage src={member.profilePictureUrl ?? ''} alt={fullName} />
										<AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
									</Avatar>
									<span className="text-sm truncate">{fullName}</span>
								</div>
							)
						})()
					) : (
						<span className="text-muted-foreground">-</span>
					)}
				</TableCell>
			)}

			{/* Working Directory */}
			{!compactMode && (
				<TableCell className="max-w-[200px]">
					<Tooltip disableHoverableContent>
						<TooltipTrigger asChild>
							<span
								className="block truncate cursor-help text-sm"
								style={{
									direction: 'rtl',
									textAlign: 'left',
									overflow: 'hidden',
									whiteSpace: 'nowrap',
									textOverflow: 'ellipsis',
								}}
							>
								<bdo dir="ltr" style={{ unicodeBidi: 'bidi-override' }}>
									{session.workingDirectory || '-'}
								</bdo>
							</span>
						</TooltipTrigger>
						<TooltipContent className="max-w-[600px] pointer-events-none">
							<span className="font-mono text-sm">
								{session.workingDirectory || 'No working directory'}
							</span>
						</TooltipContent>
					</Tooltip>
				</TableCell>
			)}

			{/* Last Activity */}
			{!compactMode && (
				<TableCell>
					<Tooltip disableHoverableContent>
						<TooltipTrigger asChild>
							<span className="cursor-help">{formatCompactRelativeTime(session.lastActivityAt)}</span>
						</TooltipTrigger>
						<TooltipContent className="pointer-events-none">
							{formatLocalAbsoluteTime(session.lastActivityAt)}
						</TooltipContent>
					</Tooltip>
				</TableCell>
			)}

			{/* Action Menu */}
			{!hideActionMenu && (
				<TableCell className="w-[40px] pr-4">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 cursor-pointer"
								aria-label="Session actions"
								onClick={(e) => e.stopPropagation()}
							>
								<MoreHorizontal className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{!isShareLinkHidden && (
								<DropdownMenuItem
									className="group cursor-pointer"
									onClick={async (e) => {
										e.stopPropagation()
										const shareUrl = getSessionShareUrl(session.id)
										await navigator.clipboard.writeText(shareUrl)
										toast.success('Session share link copied to clipboard')
									}}
								>
									<Link className="h-4 w-4 mr-2 group-hover:text-background group-focus:text-accent-foreground" />
									<span className="group-hover:text-background">Copy Session Share Link</span>
								</DropdownMenuItem>
							)}
							{!isArchiveActionHidden && (
								<>
									{!isShareLinkHidden && <DropdownMenuSeparator />}
									<DropdownMenuItem
										className="group cursor-pointer"
										onClick={(e) => {
											e.stopPropagation()
											onOpenArchiveDialog()
										}}
									>
										{session.archived ? (
											<ArchiveRestore className="h-4 w-4 mr-2 group-focus:text-accent-foreground" />
										) : (
											<Archive className="h-4 w-4 mr-2 group-focus:text-accent-foreground" />
										)}
										{session.archived ? 'Unarchive' : 'Archive'}
									</DropdownMenuItem>
								</>
							)}
							{!isBypassActionHidden && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className="group cursor-pointer"
										onClick={(e) => {
											e.stopPropagation()
											onOpenBypassDialog()
										}}
									>
										<ShieldOff className="h-4 w-4 mr-2 group-focus:text-accent-foreground" />
										{session.dangerouslySkipPermissions ? 'Disable' : 'Enable'} Bypass Permissions
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</TableCell>
			)}
		</TableRow>
	)
}
