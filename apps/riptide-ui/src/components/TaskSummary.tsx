import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import {
	ArrowRight,
	Bell,
	BellOff,
	Check,
	Copy,
	Folder,
	FolderOpen,
	Link,
	Pencil,
	Share,
	SquareTerminal,
	Users,
	X,
} from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { useTaskWorkspaceView } from '@/hooks/live-queries/useTaskWorkspaceView'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { OrgMember } from '@/hooks/useOrgMembers'
import { useTaskActions } from '@/hooks/useTaskActions'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { openInEditor } from '@/integrations/desktop/editor'
import { captureException } from '@/integrations/sentry/sentry'
import { openExternal } from '@/lib/url-opener'
import { useRiptideApi } from '@/orpc/client'
import { getNextStepButtonLabel } from '@/utils/next-step-labels'
import { copyTaskDeepLink } from '@/utils/sharing-links'

import { DirectorySearchInputWithFilesystem } from './DirectorySearchInputWithFilesystem'
import { PermissionsDialog } from './PermissionsDialog'

function getOrgMemberDisplay(member: OrgMember): { displayName: string; initials: string } {
	const displayName =
		[member.firstName, member.lastName].filter((part) => part !== undefined && part !== '').join(' ') ||
		member.email
	const initials =
		`${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase() ||
		member.email[0]?.toUpperCase() ||
		'?'
	return { displayName, initials }
}

export interface TaskSummaryTask {
	id: string
	name: string
	slug?: string | null
	default_working_directory: string | null
	ticket_id?: string | null
	ticket_url?: string | null
	organization_id: string
	resource_owner_user_id: string
	workflow_type?: string | null
	/**
	 * Point-in-time workspace snapshot for worktree:now tasks. Drives the
	 * clickable workspace-root row when it spans more than one repo;
	 * single-repo snapshots and legacy (null) tasks render unchanged.
	 */
	workspace_state: WorkspaceState | null
	workspace_spec: WorkspaceSpec | null
	auto_advance_questions_to_research: boolean
	auto_advance_research_to_design: boolean
	auto_advance_plan_to_worktree: boolean
	auto_advance_worktree_to_implementation: boolean
	auto_advance_implementation_to_pr: boolean
	slack_notifications_muted: boolean
}

export interface TaskSummaryHandle {
	isEditing: boolean
	startEditName: () => void
	startEditDirectory: () => void
	focusDirectoryInput: () => void
}

// =============================================================================
// Pure Presentational Component (for Storybook and testing)
// =============================================================================

export interface TaskSummaryPureProps {
	task: TaskSummaryTask
	workspaceView: WorkspaceView | null
	recentDirectories: string[]
	className?: string

	// Action state - nextStepType determines button label (null = no next step)
	nextStepType: string | null
	/** Override the next step button label (e.g., "View research" when sibling exists) */
	nextStepLabelOverride?: string
	/** Override the next step button variant */
	nextStepVariant?: 'loud-success-cta' | 'outline'
	/** Hide artifacts section and action buttons (e.g., when empty state handles actions) */
	hideActionsAndArtifacts: boolean
	workspaceSetupStatus?: 'ready' | 'setting_up' | 'needs_attention'

	// Sharing state
	isSharedWithOrg: boolean
	isOwner: boolean // Only owners can manage sharing
	onOpenPermissionsDialog: () => void

	// Slack task-owner notification control. Only rendered for the task owner when the org has Slack
	// connected; org-wide automations ignore this preference (it gates owner-filtered automations).
	showSlackNotificationControl: boolean
	/** True when the owner has muted Slack artifact notifications for this task. */
	slackNotificationsMuted: boolean
	onToggleSlackNotifications: () => void

	// Permission-based visibility (effect-based props)
	/** When true, hides edit controls: name pencil, directory edit, sharing dropdown */
	isEditHidden: boolean
	/** When true, hides the "Create Session" button */
	isCreateSessionHidden: boolean

	// Owner and collaborator display
	ownerDisplayName?: string
	ownerInitials?: string
	ownerProfilePictureUrl?: string
	/** Collaborators shown beside the owner. Live callers always supply this (empty when none). */
	participantMembers: readonly OrgMember[]
	onOpenOwnerReassignment?: () => void

	/**
	 * The working directory to display in the "Default Directory" field. Defaults to
	 * `task.default_working_directory`. The wired wrapper passes the per-user override
	 * (`task_user_settings.working_directory`) for non-owners so the display reflects
	 * what session launches will actually use.
	 */
	displayWorkingDirectory: string | null

	// Callbacks
	onSaveName: (name: string) => void
	onSaveDirectory: (directory: string) => void
	onCopyDirectory: () => void
	onOpenDirectory: () => void
	/** Called when the workspace root is clicked — focuses the Workspace sidebar tab (multi-repo tasks only) */
	onWorkspaceFocus: () => void
	/** Toggle terminal panel open/closed. Only provided when isTauri() and directory available. */
	onToggleTerminal: (() => void) | null
	/** Whether the terminal panel is currently open */
	isTerminalOpen: boolean
	onCreateSession: () => void
	onProceedToNextStep: () => void
}

function workflowTypeLabel(workflowType: string): string {
	switch (workflowType) {
		case 'rpi':
			return 'RPI'
		case 'outline_only':
			return 'OUTLINE ONLY'
		case 'prd_tdd':
			return 'PRD/TDD'
		case 'oneshot':
			return 'ONESHOT'
		default:
			return workflowType.toUpperCase()
	}
}

export const TaskSummaryPure = forwardRef<TaskSummaryHandle, TaskSummaryPureProps>(
	(
		{
			task,
			workspaceView,
			recentDirectories,
			className,
			nextStepType,
			nextStepLabelOverride,
			nextStepVariant,
			hideActionsAndArtifacts,
			workspaceSetupStatus,
			isSharedWithOrg,
			isOwner,
			onOpenPermissionsDialog,
			showSlackNotificationControl,
			slackNotificationsMuted,
			onToggleSlackNotifications,
			isEditHidden,
			isCreateSessionHidden,
			ownerDisplayName,
			ownerInitials,
			ownerProfilePictureUrl,
			participantMembers,
			onOpenOwnerReassignment,
			displayWorkingDirectory,
			onSaveName,
			onSaveDirectory,
			onCopyDirectory,
			onOpenDirectory,
			onWorkspaceFocus,
			onToggleTerminal,
			isTerminalOpen,
			onCreateSession,
			onProceedToNextStep,
		},
		ref,
	) => {
		// Name editing state
		const [isEditingName, setIsEditingName] = useState(false)
		const [editNameValue, setEditNameValue] = useState('')

		// Directory editing state
		const [isEditingDirectory, setIsEditingDirectory] = useState(false)
		const [editDirectoryValue, setEditDirectoryValue] = useState('')

		// Ref for directory input focus
		const directoryInputRef = useRef<HTMLInputElement>(null)

		// Hover state for open directory button
		const [isHoveringOpenDir, setIsHoveringOpenDir] = useState(false)

		// Effective directory for display/edit. Falls back to `task.default_working_directory`
		// when the wired wrapper doesn't supply an override (Storybook, owner case).
		const effectiveWorkingDirectory = displayWorkingDirectory

		// Multi-repo workspace: show the workspace root above the primary repo
		// directory; clicking it focuses the Workspace sidebar tab. Single-repo
		// snapshots and legacy (null) tasks render unchanged.
		const effectiveWorkspaceView =
			workspaceView ??
			deriveWorkspaceView({
				workspaceSpec: task.workspace_spec,
				legacyWorkspaceState: task.workspace_state,
			})
		const multiRepoWorkspaceView =
			effectiveWorkspaceView !== null && effectiveWorkspaceView.repos.length > 1 ? effectiveWorkspaceView : null
		const workspaceRootDisplay = multiRepoWorkspaceView
			? multiRepoWorkspaceView.workspaceBaseDirectory.endsWith('/')
				? multiRepoWorkspaceView.workspaceBaseDirectory
				: `${multiRepoWorkspaceView.workspaceBaseDirectory}/`
			: null

		const handleStartEditName = useCallback(() => {
			setEditNameValue(task.name)
			setIsEditingName(true)
		}, [task.name])

		const handleSaveName = useCallback(() => {
			if (editNameValue.trim() && editNameValue.trim() !== task.name) {
				onSaveName(editNameValue.trim())
			}
			setIsEditingName(false)
		}, [editNameValue, task.name, onSaveName])

		const handleCancelEditName = useCallback(() => {
			setIsEditingName(false)
			setEditNameValue('')
		}, [])

		const handleStartEditDirectory = useCallback(() => {
			setEditDirectoryValue(effectiveWorkingDirectory || '')
			setIsEditingDirectory(true)
			// Focus input after state update
			setTimeout(() => directoryInputRef.current?.focus(), 0)
		}, [effectiveWorkingDirectory])

		const handleSaveDirectory = useCallback(() => {
			if (editDirectoryValue.trim() && editDirectoryValue.trim() !== effectiveWorkingDirectory) {
				onSaveDirectory(editDirectoryValue.trim())
			}
			setIsEditingDirectory(false)
		}, [editDirectoryValue, effectiveWorkingDirectory, onSaveDirectory])

		const handleCancelEditDirectory = useCallback(() => {
			setIsEditingDirectory(false)
			setEditDirectoryValue('')
		}, [])

		// Expose methods for parent hotkey coordination
		useImperativeHandle(
			ref,
			() => ({
				isEditing: isEditingName || isEditingDirectory,
				startEditName: handleStartEditName,
				startEditDirectory: handleStartEditDirectory,
				focusDirectoryInput: () => directoryInputRef.current?.focus(),
			}),
			[isEditingName, isEditingDirectory, handleStartEditName, handleStartEditDirectory],
		)

		return (
			<div className={cn('flex gap-6 min-w-0 font-mono', className)}>
				{/* Left column: Task info + artifacts + buttons */}
				<div className="flex flex-col gap-4 min-w-0 w-full">
					{/* Task Name */}
					<div>
						<div className="flex items-center gap-2 mb-1">
							<label className="text-xs font-medium text-muted-foreground uppercase tracking-wider leading-4">
								Task Name
							</label>
							{task.workflow_type && (
								<Badge variant="outline" className="text-[10px] py-0 px-1.5 leading-4">
									{workflowTypeLabel(task.workflow_type)}
								</Badge>
							)}
							{isSharedWithOrg && (
								<Badge
									variant="outline"
									className="text-[10px] py-0 px-1.5 leading-4"
									style={{
										borderColor: 'color-mix(in srgb, var(--terminal-accent) 50%, transparent)',
										backgroundColor: 'color-mix(in srgb, var(--terminal-accent) 10%, transparent)',
										color: 'var(--terminal-accent)',
									}}
								>
									SHARED WITH ORG
								</Badge>
							)}
							{!isOwner && isEditHidden && (
								<Badge variant="outline" className="text-[10px] py-0 px-1.5 leading-4">
									READ-ONLY
								</Badge>
							)}
							{task.ticket_id &&
								(task.ticket_url ? (
									<Button
										variant="outline"
										size="sm"
										className="h-5 px-1.5 text-[10px] font-mono"
										onClick={() => openExternal(task.ticket_url ?? '')}
									>
										{task.ticket_id}
									</Button>
								) : (
									<Button
										variant="outline"
										size="sm"
										className="h-5 px-1.5 text-[10px] font-mono pointer-events-none"
									>
										{task.ticket_id}
									</Button>
								))}
						</div>
						{isEditingName ? (
							<div className="flex items-center gap-2">
								<Input
									value={editNameValue}
									onChange={(e) => setEditNameValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') handleSaveName()
										else if (e.key === 'Escape') {
											e.stopPropagation() // Prevent ESC from bubbling to parent
											handleCancelEditName()
										}
									}}
									autoFocus
									className="text-sm font-mono"
									style={{
										width: `${Math.max(20, editNameValue.length) * 0.6 + 4}em`,
										minWidth: '12em',
										maxWidth: '50em',
									}}
								/>
								<Button size="icon" variant="ghost" aria-label="Save name" onClick={handleSaveName}>
									<Check className="h-4 w-4" />
								</Button>
								<Button
									size="icon"
									variant="ghost"
									aria-label="Cancel editing name"
									onClick={handleCancelEditName}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						) : (
							<div className="flex items-center gap-2 text-sm font-mono min-w-0">
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="truncate">{task.name}</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-[600px]">{task.name}</TooltipContent>
								</Tooltip>
								{!isEditHidden && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												onClick={handleStartEditName}
												className="h-6 w-6"
												aria-label="Rename task"
											>
												<Pencil className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<span className="flex items-center gap-1.5">
												Rename <KeyboardShortcut>⇧+R</KeyboardShortcut>
											</span>
										</TooltipContent>
									</Tooltip>
								)}
								{/* Task actions menu - always show for copy link, share/unshare only for owners */}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-6 w-6"
											aria-label="Task actions"
										>
											<Share className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										{isSharedWithOrg && (
											<DropdownMenuItem
												className="group cursor-pointer"
												onClick={async () => {
													await copyTaskDeepLink(task.id)
												}}
											>
												<Link className="h-4 w-4 mr-2 group-hover:text-background group-focus:text-accent-foreground" />
												<span className="group-hover:text-background">Copy task deep link</span>
											</DropdownMenuItem>
										)}
										{isOwner && onOpenPermissionsDialog && (
											<>
												{isSharedWithOrg && <DropdownMenuSeparator />}
												<DropdownMenuItem onClick={onOpenPermissionsDialog}>
													Manage Permissions
												</DropdownMenuItem>
											</>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
								{/* Slack notification control — task owner only, when the org has Slack connected.
								    A muted task shows the slashed bell; org-wide automations ignore this preference. */}
								{showSlackNotificationControl && (
									<DropdownMenu>
										<Tooltip>
											<TooltipTrigger asChild>
												<DropdownMenuTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="h-6 w-6"
														aria-label="Slack notifications"
													>
														{slackNotificationsMuted ? (
															<BellOff className="h-3.5 w-3.5 text-muted-foreground hover:text-accent transition-colors" />
														) : (
															<Bell className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
														)}
													</Button>
												</DropdownMenuTrigger>
											</TooltipTrigger>
											<TooltipContent>Notifications</TooltipContent>
										</Tooltip>
										<DropdownMenuContent align="start" className="w-auto">
											<DropdownMenuItem
												onClick={onToggleSlackNotifications}
												className="whitespace-nowrap"
											>
												{slackNotificationsMuted
													? 'Turn Slack artifact notifications on'
													: 'Turn Slack artifact notifications off'}
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}
							</div>
						)}
					</div>

					{/* Ownership and collaboration use separate identities. */}
					<div className="flex flex-wrap items-start gap-x-8 gap-y-4">
						{ownerDisplayName && (
							<div>
								<label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
									Owner
								</label>
								<button
									type="button"
									onClick={onOpenOwnerReassignment}
									disabled={!onOpenOwnerReassignment}
									className={cn(
										'flex items-center gap-2 text-sm font-mono text-muted-foreground',
										onOpenOwnerReassignment && 'cursor-pointer transition-colors hover:text-accent',
									)}
									aria-label={
										onOpenOwnerReassignment ? `Reassign owner ${ownerDisplayName}` : undefined
									}
								>
									<Avatar className="h-5 w-5 shrink-0">
										<AvatarImage src={ownerProfilePictureUrl ?? ''} alt={ownerDisplayName} />
										<AvatarFallback className="text-[10px]">{ownerInitials}</AvatarFallback>
									</Avatar>
									<span>{ownerDisplayName}</span>
									{onOpenOwnerReassignment && <Pencil className="h-3.5 w-3.5 text-accent" />}
								</button>
							</div>
						)}
						{participantMembers.length > 0 && (
							<div>
								<label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
									Collaborators
								</label>
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Users className="h-4 w-4 shrink-0" />
									<div className="flex -space-x-2" aria-label="Collaborators">
										{participantMembers.map((member) => {
											const display = getOrgMemberDisplay(member)
											return (
												<Tooltip key={member.id}>
													<TooltipTrigger asChild>
														<Avatar className="h-6 w-6 ring-2 ring-background">
															<AvatarImage
																src={member.profilePictureUrl ?? ''}
																alt={display.displayName}
															/>
															<AvatarFallback className="text-[9px]">
																{display.initials}
															</AvatarFallback>
														</Avatar>
													</TooltipTrigger>
													<TooltipContent>{display.displayName}</TooltipContent>
												</Tooltip>
											)
										})}
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Workspace root — multi-repo worktree:now tasks only; visible to
					    everyone (teammates included). Clicking focuses the Workspace
					    sidebar tab, opening the sidebar if collapsed. */}
					{multiRepoWorkspaceView && (
						<div>
							<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
								<span>Workspace Root · {multiRepoWorkspaceView.repos.length} repos</span>
								{workspaceSetupStatus && (
									<span
										className={`inline-flex items-center gap-1 border-l border-border pl-2 text-[10px] tracking-[0.08em] ${
											workspaceSetupStatus === 'ready'
												? 'text-[var(--terminal-success)]'
												: workspaceSetupStatus === 'needs_attention'
													? 'text-destructive'
													: 'text-[var(--terminal-warning)]'
										}`}
									>
										<span className="size-1.5 bg-current" />
										{workspaceSetupStatus === 'ready'
											? 'Ready'
											: workspaceSetupStatus === 'needs_attention'
												? 'Needs attention'
												: 'Setting up'}
									</span>
								)}
							</div>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={onWorkspaceFocus}
										className="flex max-w-full min-w-0 cursor-pointer items-center gap-2 text-sm font-mono text-muted-foreground transition-colors hover:text-[var(--terminal-accent)]"
										aria-label="View workspace repos"
									>
										<Folder className="h-4 w-4 shrink-0" />
										<span className="truncate">{workspaceRootDisplay}</span>
									</button>
								</TooltipTrigger>
								<TooltipContent>View workspace repos</TooltipContent>
							</Tooltip>
						</div>
					)}

					{/* Default Working Directory - hidden for non-owners */}
					{!isEditHidden && (
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
								Default Directory
							</div>
							{isEditingDirectory ? (
								<div
									className="flex items-center gap-2"
									onKeyDown={(e) => {
										// Handle ESC at container level to cancel editing
										// (DirectorySearchInputWithFilesystem handles ESC for its dropdown)
										if (e.key === 'Escape') {
											e.stopPropagation()
											handleCancelEditDirectory()
										}
									}}
								>
									<DirectorySearchInputWithFilesystem
										ref={directoryInputRef}
										value={editDirectoryValue}
										onChange={setEditDirectoryValue}
										onConfirm={handleSaveDirectory}
										recentDirectories={recentDirectories}
										placeholder="/path/to/directory"
										className="w-full font-mono text-sm"
										style={{
											width: `${Math.max(20, editDirectoryValue.length) * 0.6 + 4}em`,
											minWidth: '12em',
											maxWidth: '50em',
										}}
									/>
									<Button
										size="icon"
										variant="ghost"
										aria-label="Save directory"
										onClick={handleSaveDirectory}
									>
										<Check className="h-4 w-4" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										aria-label="Cancel editing directory"
										onClick={handleCancelEditDirectory}
									>
										<X className="h-4 w-4" />
									</Button>
								</div>
							) : (
								<div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
									<FolderOpen className="h-4 w-4" />
									<span>{effectiveWorkingDirectory || 'Not set'}</span>
									{/* Edit directory button */}
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon"
												onClick={handleStartEditDirectory}
												className="h-6 w-6"
												aria-label="Edit directory"
											>
												<Pencil className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<span className="flex items-center gap-1.5">
												Edit directory <KeyboardShortcut>⇧+D</KeyboardShortcut>
											</span>
										</TooltipContent>
									</Tooltip>
									{effectiveWorkingDirectory && (
										<>
											{/* Copy directory button */}
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={onCopyDirectory}
														className="h-6 w-6"
														aria-label="Copy directory"
													>
														<Copy className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>Copy directory</TooltipContent>
											</Tooltip>
											{/* Open in editor button */}
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={onOpenDirectory}
														className="h-6 w-6"
														aria-label="Open in editor"
														onMouseEnter={() => setIsHoveringOpenDir(true)}
														onMouseLeave={() => setIsHoveringOpenDir(false)}
													>
														{isHoveringOpenDir ? (
															<FolderOpen className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
														) : (
															<Folder className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
														)}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													<span className="flex items-center gap-1.5">
														Open in editor <KeyboardShortcut>⌘+⇧+O</KeyboardShortcut>
													</span>
												</TooltipContent>
											</Tooltip>
											{/* Terminal toggle button */}
											{onToggleTerminal && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															onClick={onToggleTerminal}
															className="h-6 w-6"
															aria-label="Toggle terminal"
														>
															<SquareTerminal className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														<span className="flex items-center gap-1.5">
															{isTerminalOpen ? 'Close' : 'Open'} terminal{' '}
															<KeyboardShortcut>⌘+J</KeyboardShortcut>
														</span>
													</TooltipContent>
												</Tooltip>
											)}
										</>
									)}
								</div>
							)}
						</div>
					)}

					{/* Action Buttons (hidden when empty state handles actions) */}
					{!hideActionsAndArtifacts && (
						<div className="flex flex-wrap gap-3">
							{!isCreateSessionHidden && (
								<Button onClick={onCreateSession}>
									Create Session
									<kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded bg-muted">
										C
									</kbd>
								</Button>
							)}
							{workspaceSetupStatus && multiRepoWorkspaceView && (
								<Button variant="secondary" onClick={onWorkspaceFocus}>
									View Workspace
									<ArrowRight className="ml-1 h-4 w-4" />
								</Button>
							)}
							{!isCreateSessionHidden && nextStepType && (
								<Button variant={nextStepVariant ?? 'loud-success-cta'} onClick={onProceedToNextStep}>
									{nextStepLabelOverride ?? getNextStepButtonLabel(nextStepType)}
									<ArrowRight className="h-4 w-4 ml-1" />
									<KeyboardShortcut size="xs" className="ml-1">
										⌘+Shift+Enter
									</KeyboardShortcut>
								</Button>
							)}
						</div>
					)}
				</div>
			</div>
		)
	},
)

TaskSummaryPure.displayName = 'TaskSummaryPure'

// =============================================================================
// Connected Component (uses hooks for real application)
// =============================================================================

export interface TaskSummaryProps {
	task: TaskSummaryTask
	hostId: string | null
	nextStepType: string | null
	/** Override the next step button label (e.g., "View research" when sibling exists) */
	nextStepLabelOverride?: string
	/** Override the next step button variant */
	nextStepVariant?: 'loud-success-cta' | 'outline'
	/** Hide artifacts section and action buttons (e.g., when empty state handles actions) */
	hideActionsAndArtifacts: boolean
	workspaceSetupStatus?: 'ready' | 'setting_up' | 'needs_attention'
	className?: string
	onCreateSession: () => void
	onProceedToNextStep: () => void
	/** Called when the workspace root is clicked — focuses the Workspace sidebar tab (multi-repo tasks only) */
	onWorkspaceFocus: () => void
	/** Toggle terminal panel open/closed */
	onToggleTerminal: (() => void) | null
	/** Whether the terminal panel is currently open */
	isTerminalOpen: boolean
	/** Resource owner user ID of the task - needed to determine if current user is owner */
	resourceOwnerUserId: string
	/** When true, hides edit controls: name pencil, directory edit, sharing dropdown */
	isEditHidden: boolean
	/** When true, hides the "Create Session" button */
	isCreateSessionHidden: boolean
	// Owner display (shown for non-owners)
	ownerDisplayName?: string
	ownerInitials?: string
	ownerProfilePictureUrl?: string
	/** Collaborators shown beside the owner. Live callers always supply this (empty when none). */
	participantMembers: readonly OrgMember[]
	onOpenOwnerReassignment?: () => void
}

export const TaskSummary = forwardRef<TaskSummaryHandle, TaskSummaryProps>(
	(
		{
			task,
			hostId,
			nextStepType,
			nextStepLabelOverride,
			nextStepVariant,
			hideActionsAndArtifacts,
			workspaceSetupStatus,
			className,
			onCreateSession,
			onProceedToNextStep,
			onWorkspaceFocus,
			onToggleTerminal,
			isTerminalOpen,
			resourceOwnerUserId,
			isEditHidden,
			isCreateSessionHidden,
			ownerDisplayName,
			ownerInitials,
			ownerProfilePictureUrl,
			participantMembers,
			onOpenOwnerReassignment,
		},
		ref,
	) => {
		const { tasksCollection, taskOrganizationAclsCollection, taskUserSettingsCollection } = useSync()
		const { client, queryClient } = useRiptideApi()
		const [, copyToClipboard] = useCopyToClipboard()
		const { user } = useAuth()
		const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false)

		const workspaceView = useTaskWorkspaceView(task, hostId)

		// Get recent directories for directory input autocomplete
		const recentDirectories = useRecentDirectories(hostId ?? undefined, user?.id)

		// Query ACL collection to check if task is shared with org (reactive via Electric sync)
		const { data: taskOrgAclData } = useLiveQuery(
			(q) => q.from({ acls: taskOrganizationAclsCollection }).where(({ acls }) => eq(acls.task_id, task.id)),
			[taskOrganizationAclsCollection, task.id],
		)
		const isOwner = resourceOwnerUserId != null && resourceOwnerUserId === user?.id
		// Only show "shared with org" when we have actual ACL data (owners can see their own ACL records).
		// Non-owners may not have ACL records synced, so we don't show the badge for them.
		const isSharedWithOrg = (taskOrgAclData?.length ?? 0) > 0

		// Per-user settings: ownership-aware optimistic actions for this task
		const { settings, updateDefaultWorkingDirectory, updateSlackNotificationsMuted, userWorkingDirectory } =
			useTaskSettings({
				task,
				userId: user?.id,
				taskUserSettingsCollection,
				tasksCollection,
				api: { tasks: client.tasks },
			})

		// Slack task-owner notification control: only the owner manages it, and only when the org has
		// Slack connected. Org-wide automations ignore this preference; it gates owner-filtered ones.
		const { data: slackStatus } = useQuery(
			queryClient.integrations.slack.getStatus.queryOptions({
				input: {},
				enabled: isOwner,
				refetchInterval: 60_000,
				staleTime: 30_000,
			}),
		)
		const showSlackNotificationControl = isOwner && (slackStatus?.connected ?? false)

		const handleToggleSlackNotifications = useCallback(() => {
			const transaction = updateSlackNotificationsMuted({
				taskId: task.id,
				slackNotificationsMuted: !settings.slackNotificationsMuted,
			})
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update Slack notifications')
				captureException(error, { extra: { action: 'updateSlackNotificationsMuted', taskId: task.id } })
			})
		}, [task.id, settings.slackNotificationsMuted, updateSlackNotificationsMuted])

		// Effective directory shown in the "Default Directory" field. For owners this is
		// the task default; for non-owners it's the per-user override (falling back to the
		// user's local default), matching the resolution chain at routes/_app/sessions/draft.tsx.
		const localDefaultDirectory = useSettingsStore((s) => s.defaultDirectory)
		const effectiveWorkingDirectory = isOwner
			? task.default_working_directory
			: (userWorkingDirectory ?? localDefaultDirectory ?? null)

		const taskActions = useTaskActions()

		const handleSaveName = useCallback(
			(name: string) => {
				const transaction = taskActions.updateTaskName({
					taskId: task.id,
					name,
				})
				transaction.isPersisted.promise.catch((error) => {
					toast.error('Failed to update task name')
					captureException(error, { extra: { action: 'updateTaskName', taskId: task.id } })
				})
			},
			[task.id, taskActions],
		)

		const handleSaveDirectory = useCallback(
			(directory: string) => {
				const transaction = updateDefaultWorkingDirectory({
					taskId: task.id,
					defaultWorkingDirectory: directory,
				})
				transaction.isPersisted.promise.catch((error) => {
					toast.error('Failed to update default working directory')
					captureException(error, { extra: { action: 'updateTaskDefaultWorkingDirectory', taskId: task.id } })
				})
			},
			[task.id, updateDefaultWorkingDirectory],
		)

		// Copy directory to clipboard
		const handleCopyDirectory = useCallback(() => {
			if (!effectiveWorkingDirectory) return
			void copyToClipboard(effectiveWorkingDirectory)
			toast.success('Copied to clipboard')
		}, [effectiveWorkingDirectory, copyToClipboard])

		// Open directory in user's default editor
		const handleOpenDirectory = useCallback(async () => {
			if (!effectiveWorkingDirectory) return

			const editor = useSettingsStore.getState().defaultEditor
			try {
				await openInEditor({
					path: effectiveWorkingDirectory,
					editor: editor === 'system' ? null : editor,
				})
				toast.success('Opened in editor', {
					description: `Opening ${effectiveWorkingDirectory} in ${editor === 'system' ? 'default application' : editor}`,
				})
			} catch (error) {
				const errorMessage =
					typeof error === 'string' ? error : error instanceof Error ? error.message : 'Unknown error'

				if (errorMessage.includes('does not exist')) {
					toast.error('Directory not found', {
						description: 'The default working directory no longer exists',
					})
				} else if (errorMessage.includes('is not installed')) {
					toast.error('Editor not found', {
						description: `${editor} does not appear to be installed. Check Settings.`,
					})
				} else {
					toast.error('Failed to open directory', {
						description: errorMessage,
					})
				}
			}
		}, [effectiveWorkingDirectory])

		return (
			<>
				<TaskSummaryPure
					ref={ref}
					task={task}
					workspaceView={workspaceView}
					recentDirectories={recentDirectories}
					nextStepType={nextStepType}
					nextStepLabelOverride={nextStepLabelOverride}
					nextStepVariant={nextStepVariant}
					hideActionsAndArtifacts={hideActionsAndArtifacts}
					workspaceSetupStatus={workspaceSetupStatus}
					className={className}
					isSharedWithOrg={isSharedWithOrg}
					isOwner={isOwner}
					showSlackNotificationControl={showSlackNotificationControl}
					slackNotificationsMuted={settings.slackNotificationsMuted}
					onToggleSlackNotifications={handleToggleSlackNotifications}
					isEditHidden={isEditHidden}
					isCreateSessionHidden={isCreateSessionHidden}
					ownerDisplayName={ownerDisplayName}
					ownerInitials={ownerInitials}
					ownerProfilePictureUrl={ownerProfilePictureUrl}
					participantMembers={participantMembers}
					onOpenOwnerReassignment={onOpenOwnerReassignment}
					displayWorkingDirectory={effectiveWorkingDirectory}
					onOpenPermissionsDialog={() => setPermissionsDialogOpen(true)}
					onSaveName={handleSaveName}
					onSaveDirectory={handleSaveDirectory}
					onCopyDirectory={handleCopyDirectory}
					onOpenDirectory={handleOpenDirectory}
					onWorkspaceFocus={onWorkspaceFocus}
					onToggleTerminal={onToggleTerminal}
					isTerminalOpen={isTerminalOpen}
					onCreateSession={onCreateSession}
					onProceedToNextStep={onProceedToNextStep}
				/>
				{isOwner && (
					<PermissionsDialog
						taskId={task.id}
						isOpen={permissionsDialogOpen}
						onOpenChange={setPermissionsDialogOpen}
					/>
				)}
			</>
		)
	},
)

TaskSummary.displayName = 'TaskSummary'
