import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
	ChevronDown,
	Folder,
	FolderGit2,
	GitBranch,
	PanelLeft,
	Route,
	Server,
	SkipForward,
	Ticket as TicketIcon,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { uuidv7 } from 'uuidv7'

import { missingRepositorySources } from '@/lib/repository-sources'
import { Composer } from '@/minimalist/components/Composer'
import { IssueDialog } from '@/minimalist/components/IssueDialog'
import { HostIcon, HostMenu, TargetMenu } from '@/minimalist/components/LaunchMenus'
import { Menu, MenuItem, MenuSeparator } from '@/minimalist/components/Menu'
import { WiredTaskNavigation } from '@/minimalist/components/WiredTaskNavigation'
import { withAttachments } from '@/minimalist/lib/attachments'
import {
	DAEMON_START_COMMAND,
	useHosts,
	useProjects,
	useRecentDirectories,
	useSlashCommands,
	useTask,
	useTaskTree,
} from '@/minimalist/lib/data'
import { useDirectoryWorktree, useEditInPlace } from '@/minimalist/lib/directory-worktree'
import { newTaskDraftKey, useDraft } from '@/minimalist/lib/drafts'
import { basename } from '@/minimalist/lib/format'
import {
	defaultTarget,
	ensureRepositorySources,
	launchBlocker,
	launchError,
	launchInTask,
	launchHost,
	type LoadedTarget,
	rememberSettings,
	savedSettings,
	startTask,
	type Target,
	targetLabel,
	workingCopy,
} from '@/minimalist/lib/launch'
import { fitSettings, modelCatalog } from '@/minimalist/lib/models'
import {
	TASK_SIZES,
	type TaskSize,
	taskSizeOption,
	taskSizeWorkflow,
	useSmallTaskAutoAdvance,
	useTaskSize,
} from '@/minimalist/lib/task-size'
import { githubFullName, type Ticket, type TicketProvider, ticketLabel } from '@/minimalist/lib/tickets'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAttachments } from '@/minimalist/lib/use-attachments'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useRiptideApi } from '@/orpc/client'

export function NewTask({
	existingTaskId,
	projectId,
	directory,
	hostId: requestedHostId,
}: {
	existingTaskId?: string
	projectId?: string
	directory?: string
	/** A host to start on, such as the one the offline notice offers. */
	hostId?: string
}) {
	const { client: api, queryClient: orpc } = useRiptideApi()
	const navigate = useNavigate()
	const { showToast, taskSidebarOpen, toggleTaskSidebar } = useUi()
	const { hosts, isReady: hostsReady } = useHosts()
	const projects = useProjects()
	const { recent } = useTaskTree()
	const existing = useTask(existingTaskId)
	const latestExisting = existing.sessions.at(-1) ?? null
	const existingWorkspace = useQuery({
		...orpc.projectWorkspaces.getStatus.queryOptions({
			input: { taskId: existingTaskId ?? '' },
			context: { silent: true },
		}),
		enabled: Boolean(existingTaskId && existing.task?.workspace_id),
	})
	const existingProjectId = existing.task?.workspace_id
		? existingWorkspace.data?.workspace.projectId
		: existing.task?.project_id
	const [hostId, setHostId] = useState<string | null>(requestedHostId ?? null)
	// A project task's workspace can be set up on any host; a directory task stays where the directory is.
	const movable = Boolean(existing.task?.workspace_id)
	const taskHost = hosts.find((entry) => entry.host.host_id === latestExisting?.host_id) ?? null
	const host = launchHost(hosts, {
		picked: hostId,
		task: existingTaskId && latestExisting?.host_id ? { hostId: latestExisting.host_id, movable } : null,
	})
	const directories = useRecentDirectories(host?.host.host_id ?? null)
	const [target, setTarget] = useState<Target | null>(null)
	const [draft, setDraft] = useDraft(newTaskDraftKey(existingTaskId))
	const [ticket, setTicket] = useState<Ticket | null>(null)
	const [issueDialog, setIssueDialog] = useState<TicketProvider | null>(null)
	const [launching, setLaunching] = useState(false)
	const launchLock = useRef(false)
	const [ids] = useState(() => ({ taskId: uuidv7(), sessionId: uuidv7(), eventId: uuidv7() }))
	const attachments = useAttachments(existingTaskId ?? ids.taskId, Boolean(existingTaskId))
	const catalog = modelCatalog(host?.host)
	const [picked, setSettings] = useState(savedSettings)
	const settings = fitSettings(picked, catalog)
	const [menu, setMenu] = useState<'target' | 'host' | null>(null)
	const [taskSize, setTaskSize] = useTaskSize()
	const [smallAutoAdvance] = useSmallTaskAutoAdvance()
	const targetAnchor = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		if (!existingTaskId || !taskSidebarOpen || !matchMedia('(max-width: 1050px)').matches) return
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const frame = requestAnimationFrame(() =>
			document.querySelector<HTMLElement>('.task-nav button, .task-nav a')?.focus(),
		)
		const escape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') toggleTaskSidebar()
		}
		window.addEventListener('keydown', escape)
		return () => {
			cancelAnimationFrame(frame)
			window.removeEventListener('keydown', escape)
			opener?.focus()
		}
	}, [existingTaskId, taskSidebarOpen, toggleTaskSidebar])
	const hostAnchor = useRef<HTMLButtonElement>(null)

	const requestedProject = projectId ? projects.data?.find((project) => project.id === projectId) : undefined
	const requested: Target | null = requestedProject
		? { kind: 'project', projectId: requestedProject.id, name: requestedProject.name }
		: directory
			? { kind: 'directory', path: directory }
			: null
	// A project named in the address is where the task goes, so wait for it rather than guess another.
	const awaitingProject = Boolean(projectId) && projects.isPending
	const effectiveTarget =
		target ??
		requested ??
		(awaitingProject
			? null
			: defaultTarget({ latest: recent[0], directory: directories[0], project: projects.data?.[0] }))
	const targetProject =
		effectiveTarget?.kind === 'project'
			? projects.data?.find((project) => project.id === effectiveTarget.projectId)
			: undefined
	const targetDirectory = !existingTaskId && effectiveTarget?.kind === 'directory' ? effectiveTarget.path : null
	const directoryWorktree = useDirectoryWorktree(targetDirectory, host?.host.host_id ?? null)
	// A directory that can get worktrees gets them, unless you chose to edit it in place.
	const [inPlace, setInPlace] = useEditInPlace(targetDirectory)
	const worktreePlan = directoryWorktree?.kind === 'available' && !inPlace ? directoryWorktree : null
	const workspace: LoadedTarget | null =
		effectiveTarget?.kind === 'directory'
			? { ...effectiveTarget, worktree: worktreePlan?.plan ?? null }
			: targetProject
				? { kind: 'project', project: targetProject }
				: null
	const composerDirectory = existingTaskId
		? movable && latestExisting?.host_id !== host?.host.host_id
			? null
			: (latestExisting?.working_directory ?? existing.task?.default_working_directory ?? null)
		: effectiveTarget?.kind === 'directory'
			? effectiveTarget.path
			: null
	const commands = useSlashCommands({
		hostId: host?.host.host_id ?? null,
		workspacePath: composerDirectory,
		agent: settings.agent,
	})
	const sourceInput = {
		projectId: existingTaskId
			? (existingProjectId ?? '')
			: effectiveTarget?.kind === 'project'
				? effectiveTarget.projectId
				: '',
		hostId: host?.host.host_id ?? '',
	}
	const sources = useQuery({
		...orpc.projects.v2.repositorySources.get.queryOptions({ input: sourceInput, context: { silent: true } }),
		enabled: Boolean(sourceInput.projectId && sourceInput.hostId),
	})
	// A project repository with no checkout on this host is cloned by the host on first launch.
	const copy = workingCopy({
		inTask: Boolean(existingTaskId),
		project: effectiveTarget?.kind === 'project',
		clonesFirst: missingRepositorySources(sources.data?.sources).length > 0,
		hostName: host?.name ?? 'The host',
		movedFrom: host && taskHost && host !== taskHost ? taskHost.name : null,
		directoryWorktrees: worktreePlan,
	})
	const copyTitle =
		directoryWorktree?.kind === 'unavailable' && directoryWorktree.reason
			? `${copy?.title}. ${directoryWorktree.reason}`
			: copy?.title
	const targetName = existingTaskId ? (existing.task?.name ?? null) : targetLabel(effectiveTarget)
	let blocker = launchBlocker({ host, needsTarget: !existingTaskId, target: effectiveTarget })
	if (!hostsReady || awaitingProject) blocker = 'Loading…'
	else if (!existingTaskId && effectiveTarget?.kind === 'directory' && !directoryWorktree)
		blocker = 'Reading workspace.json…'
	else if (existingTaskId && !existing.isReady) blocker = 'Loading task…'
	else if (existingTaskId && !existing.task) blocker = "This task doesn't exist"
	else if (existingTaskId && existing.task?.workspace_id && existingWorkspace.isPending)
		blocker = 'Loading workspace…'
	else if (existingTaskId && existing.task?.workspace_id && existingWorkspace.isError)
		blocker = 'Could not load workspace. Refresh this task and try again.'
	else if (
		existingTaskId &&
		!existing.task?.workspace_id &&
		!latestExisting?.working_directory &&
		!existing.task?.default_working_directory
	)
		blocker = 'Choose a task with a workspace or directory'

	const launch = async () => {
		if (
			(!draft.trim() && attachments.metadata.length === 0 && !ticket) ||
			!host ||
			blocker ||
			launchLock.current ||
			attachments.blocked
		)
			return
		launchLock.current = true
		setLaunching(true)
		const hostId = host.host.host_id
		try {
			if (existingTaskId && existing.task) {
				if (existingProjectId && hostId !== latestExisting?.host_id)
					await ensureRepositorySources(api, existingProjectId, hostId)
				await launchInTask(api, existing.task, {
					sessionId: ids.sessionId,
					eventId: ids.eventId,
					text: withAttachments(draft, existing.task.slug ?? '', attachments.metadata),
					hostId,
					workingDirectory:
						latestExisting?.working_directory ?? existing.task.default_working_directory ?? '',
					settings,
				})
				rememberSettings(settings)
				setDraft('')
				void navigate({
					to: '/tasks/$taskId',
					params: { taskId: existingTaskId },
					search: { session: ids.sessionId },
				})
				return
			}
			if (!workspace) throw new Error('project not loaded')
			await startTask(api, {
				ids,
				target: workspace,
				hostId,
				draft,
				ticket,
				attachments: attachments.metadata,
				settings,
				workflow: taskSizeWorkflow(taskSize, smallAutoAdvance),
				directImplementation: taskSize === 'small',
			})
			rememberSettings(settings)
			setDraft('')
			void navigate({ to: '/tasks/$taskId', params: { taskId: ids.taskId } })
		} catch (error) {
			showToast(launchError(error))
		} finally {
			launchLock.current = false
			setLaunching(false)
		}
	}

	const strip = (
		<div className="envstrip">
			{existingTaskId ? (
				<span>
					<FolderGit2 className="i sm" strokeWidth={1.6} />
					{latestExisting
						? basename(latestExisting.working_directory)
						: existing.isReady
							? 'No session'
							: 'Loading…'}
				</span>
			) : (
				<button type="button" ref={targetAnchor} onClick={() => setMenu('target')}>
					<Folder className="i sm" strokeWidth={1.6} />
					{targetName ?? 'Choose a project'}
					<ChevronDown className="i sm" />
				</button>
			)}
			<button type="button" ref={hostAnchor} onClick={() => setMenu('host')}>
				<HostIcon host={host} />
				{host ? host.name : hostsReady ? 'No host' : 'Host'}
				<ChevronDown className="i sm" />
			</button>
			{copy && directoryWorktree?.kind === 'available' ? (
				<button
					type="button"
					className="wc"
					title={`${copy.title}. Click to ${inPlace ? (directoryWorktree.repositories > 1 ? 'work in worktrees' : 'work in a worktree') : 'edit your checkout instead'}.`}
					onClick={() => setInPlace(!inPlace)}
				>
					<WorkingCopyIcon branch={copy.branch} />
					{copy.label}
				</button>
			) : copy ? (
				<span className="muted wc" title={copyTitle}>
					<WorkingCopyIcon branch={copy.branch} />
					{copy.label}
				</span>
			) : null}
			{ticket && !existingTaskId ? <IssueChip ticket={ticket} onRemove={() => setTicket(null)} /> : null}
			{existingTaskId ? null : <TaskSizePicker size={taskSize} onPick={setTaskSize} />}
		</div>
	)

	const page = (
		<main className="main" tabIndex={-1}>
			<div className="titlebar">
				<span className="sp" />
			</div>
			{existingTaskId ? (
				<div className="hero">
					<h1>New session in {targetName ?? 'this task'}</h1>
				</div>
			) : (
				<Hero name={targetName} onPickTarget={() => setMenu('target')} />
			)}
			<div className="col">
				{hostsReady && hosts.length === 0 ? <NoHostsNotice /> : null}
				<Composer
					value={draft}
					onChange={setDraft}
					onSubmit={() => void launch()}
					placeholder={
						blocker ??
						(ticket && !existingTaskId
							? `Add instructions for ${ticketLabel(ticket)}, or send to start`
							: 'Ask the agent to do anything')
					}
					disabled={launching}
					submitDisabled={Boolean(blocker)}
					attachments={attachments}
					submitLabel={existingTaskId ? 'Start session' : 'Start task'}
					settings={settings}
					onSettingsChange={setSettings}
					catalog={catalog}
					usage={
						host ? { hostName: host.name, limits: host.host.coding_agent_usage_limits?.claude } : undefined
					}
					autoFocus
					commands={commands}
					onAddIssue={existingTaskId ? undefined : setIssueDialog}
					hasIssue={Boolean(ticket) && !existingTaskId}
					mentionScope={{
						taskId: existingTaskId ?? null,
						hostId: host?.host.host_id ?? null,
						directory: composerDirectory,
					}}
				>
					{strip}
				</Composer>
			</div>
			<TargetMenu
				anchor={targetAnchor}
				open={menu === 'target'}
				onClose={() => setMenu(null)}
				host={host}
				target={effectiveTarget}
				onPick={setTarget}
			/>
			<HostMenu
				anchor={hostAnchor}
				open={menu === 'host'}
				onClose={() => setMenu(null)}
				selectedId={host?.host.host_id ?? null}
				lockedTo={existingTaskId && !movable ? (latestExisting?.host_id ?? null) : null}
				// A picked directory stays picked. Dropping it fell back to the default target, often a
				// project, and launched a worktree of the wrong repository instead of running in place.
				onPick={setHostId}
			/>
			{issueDialog ? (
				<IssueDialog
					provider={issueDialog}
					projectRepository={githubFullName(
						targetProject?.repositories.find((repository) => repository.default)?.repositoryIdentity,
					)}
					onAttach={setTicket}
					onClose={() => setIssueDialog(null)}
				/>
			) : null}
		</main>
	)
	return existingTaskId ? (
		<div className="task-layout">
			<WiredTaskNavigation taskId={existingTaskId} />
			{taskSidebarOpen ? (
				<button
					className="task-nav-scrim"
					type="button"
					aria-label="Close task navigation"
					onClick={toggleTaskSidebar}
				/>
			) : null}
			<div className="task-content">
				<div className="task-content-bar">
					<button
						type="button"
						className="iconbtn"
						aria-label="Open task navigation"
						aria-expanded={taskSidebarOpen}
						onClick={toggleTaskSidebar}
					>
						<PanelLeft className="i" />
					</button>
					<span className="t">{existing.task?.name}</span>
				</div>
				{page}
			</div>
		</div>
	) : (
		page
	)
}

/** The greeting over the composer, naming the selected project or directory. */
function Hero({ name, onPickTarget }: { name: string | null; onPickTarget?: () => void }) {
	return (
		<div className="hero">
			<h1>
				{name ? (
					<>
						What should we work on in{' '}
						<u>
							{onPickTarget ? (
								<button type="button" onClick={onPickTarget}>
									{name}
								</button>
							) : (
								name
							)}
						</u>
						?
					</>
				) : (
					'What should we work on?'
				)}
			</h1>
		</div>
	)
}

/** The issue a new task starts from, linked, with a button to drop it. */
function IssueChip({ ticket, onRemove }: { ticket: Ticket; onRemove: () => void }) {
	return (
		<span className="issue-chip" title={ticket.name}>
			<TicketIcon className="i sm" strokeWidth={1.6} />
			{ticket.url ? (
				<a href={ticket.url} target="_blank" rel="noreferrer" className="ell">
					{ticket.name}
				</a>
			) : (
				<span className="ell">{ticket.name}</span>
			)}
			<button type="button" aria-label={`Remove ${ticketLabel(ticket)}`} onClick={onRemove}>
				<X className="i sm" />
			</button>
		</span>
	)
}

/** Nothing can launch until a daemon runs somewhere; the same card the thread shows for an offline host. */
function NoHostsNotice() {
	const copy = useCopy()
	return (
		<div className="notice" role="status">
			<Server className="i sm" strokeWidth={1.6} />
			<div className="body">
				<b>No hosts online</b>
				<div className="d">Start a daemon where your code lives to launch tasks.</div>
				<div className="acts">
					<button
						type="button"
						className="btn"
						title={DAEMON_START_COMMAND}
						onClick={() =>
							copy(
								DAEMON_START_COMMAND,
								'Start command copied. Run it in a terminal.',
								`Could not copy the command. Run ${DAEMON_START_COMMAND} in a terminal.`,
							)
						}
					>
						Copy start command
					</button>
				</div>
			</div>
		</div>
	)
}

/**
 * How big the new task is, which picks its workflow; small tasks also choose whether the pull
 * request follows on its own. Both picks stick on this device.
 */
function TaskSizePicker({ size, onPick }: { size: TaskSize; onPick: (size: TaskSize) => void }) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const [smallAutoAdvance, setSmallAutoAdvance] = useSmallTaskAutoAdvance()
	const current = taskSizeOption(size)
	const autoPr = size === 'small' && smallAutoAdvance
	return (
		<>
			<button
				type="button"
				className="task-size"
				ref={anchor}
				aria-label={`Task size: ${current.label}${autoPr ? ', auto-advance to pull request' : ''}`}
				title={autoPr ? `${current.description}\nAuto-advances to the pull request` : current.description}
				onClick={() => setOpen(true)}
			>
				<Route className="i sm" strokeWidth={1.6} />
				{current.label}
				{autoPr ? <SkipForward className="i sm task-size-auto" strokeWidth={1.6} fill="currentColor" /> : null}
				<ChevronDown className="i sm" />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="above-end" width={300}>
				{TASK_SIZES.map((option) => (
					<MenuItem
						key={option.value}
						label={option.label}
						detail={option.description}
						checked={option.value === size}
						onSelect={() => {
							onPick(option.value)
							setOpen(false)
						}}
					/>
				))}
				{size === 'small' ? (
					<>
						<MenuSeparator />
						<MenuItem
							icon={<SkipForward className="i sm" strokeWidth={1.6} fill="currentColor" />}
							label="Auto-advance to pull request"
							detail="Describe the pull request when implementation is done"
							checked={smallAutoAdvance}
							onSelect={() => setSmallAutoAdvance(!smallAutoAdvance)}
						/>
					</>
				) : null}
			</Menu>
		</>
	)
}

function WorkingCopyIcon({ branch }: { branch: boolean }) {
	return branch ? <GitBranch className="i sm" strokeWidth={1.6} /> : <Folder className="i sm" strokeWidth={1.6} />
}
