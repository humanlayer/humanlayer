import type { Session } from '@humanlayer/db/tables/sessions'
import { ArrowDown, PanelRight } from 'lucide-react'
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TaskDiffScope } from '@/components/diffs/TaskDiffScope'
import { useSharedResponseOptions } from '@/hooks/session-detail/use-response-editor-collaboration'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { AskCard } from '@/minimalist/components/AskCard'
import { WiredUserAvatar } from '@/minimalist/components/Avatar'
import { ForkDialog, HandoffDialog } from '@/minimalist/components/BranchDialogs'
import { ChapterMenu } from '@/minimalist/components/ChapterMenu'
import { Composer } from '@/minimalist/components/Composer'
import { EnvironmentMenu } from '@/minimalist/components/EnvironmentMenu'
import { NextStepCard } from '@/minimalist/components/NextStepCard'
import { PromptAccessDialog, SharingPill } from '@/minimalist/components/PromptAccessDialog'
import { QueueHeader, QueuedMessage } from '@/minimalist/components/QueuedMessage'
import { DiffStat } from '@/minimalist/components/ReviewPanel'
import { ReadOnlyNotice, SessionNotice } from '@/minimalist/components/SessionNotice'
import { SharedComposer } from '@/minimalist/components/SharedComposer'
import { SidePanel } from '@/minimalist/components/SidePanel'
import { ThreadActions } from '@/minimalist/components/ThreadActions'
import { Transcript } from '@/minimalist/components/Transcript'
import { WorkspaceSetup } from '@/minimalist/components/WorkspaceSetup'
import { isMultiplayerThread, usePromptSharing, useSessionAccess } from '@/minimalist/lib/access'
import { withAttachments } from '@/minimalist/lib/attachments'
import { useHost, useSessionThread, useSlashCommands, useTask, useTaskArtifacts } from '@/minimalist/lib/data'
import { useDraft } from '@/minimalist/lib/drafts'
import { plural } from '@/minimalist/lib/format'
import { type ModelOption, sessionSettings } from '@/minimalist/lib/models'
import { contextUsage, type SendIntent, sendToSession, useAskAgent } from '@/minimalist/lib/send'
import { sessionName } from '@/minimalist/lib/session-name'
import { useSessionSettings } from '@/minimalist/lib/session-settings'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { isBusy, statusAnnouncement } from '@/minimalist/lib/status'
import { useTaskNavigation } from '@/minimalist/lib/task-navigation'
import { useThreadPanel } from '@/minimalist/lib/thread-panel'
import { type ThreadRequest, useThreadRequests } from '@/minimalist/lib/thread-requests'
import { buildTurns, type EventRow } from '@/minimalist/lib/transcript'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { useAttachments } from '@/minimalist/lib/use-attachments'
import { useStickToBottom } from '@/minimalist/lib/use-stick-to-bottom'
import { useRiptideApi } from '@/orpc/client'

/** One session's thread, with its task's other sessions in the chapter menu. Everything derives from the id. */
export function ThreadView({
	sessionId,
	workspaceFocused = false,
	taskManaged = false,
	visible = true,
}: {
	sessionId: string
	workspaceFocused?: boolean
	taskManaged?: boolean
	visible?: boolean
}) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const { session, events, pendingApprovals, queued, isReady } = useSessionThread(sessionId)
	const taskId = session?.task_id ?? null
	const artifacts = useTaskArtifacts(taskId)
	const { task } = useTask(taskId)
	const attachments = useAttachments(taskId, true)
	const commands = useSlashCommands({
		hostId: session?.host_id ?? null,
		workspacePath: session?.working_directory ?? null,
		agent: session?.coding_agent ?? null,
		continuingSession: true,
	})
	const [draft, setDraft] = useDraft(sessionId)
	const [sharingOpen, setSharingOpen] = useState(false)
	const sharingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const { user } = useBrowserAuth()
	const [denying, setDenying] = useState<{ approvalId: string; what: string } | null>(null)
	const sendingLock = useRef(false)
	const stop = useAction()
	const agent = useAskAgent(sessionId)
	const model = useSessionSettings(session)
	const [fork, setFork] = useState<{ id: string; text: string } | null>(null)
	const [handoff, setHandoff] = useState<ModelOption | null>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)

	// Reading the session clears its unread dot, including turns that finish while it's open.
	useEffect(() => {
		if (!visible) return
		const clear = (ids: Set<string>) => {
			if (ids.has(sessionId)) useUnreadStore.getState().markRead(sessionId)
		}
		clear(useUnreadStore.getState().unreadSessionIds)
		return useUnreadStore.subscribe((state) => clear(state.unreadSessionIds))
	}, [sessionId, visible])

	const turns = useMemo(() => buildTurns(events as EventRow[]), [events])
	const legacyPanel = useThreadPanel(events as EventRow[], artifacts, task)
	const navigation = useTaskNavigation(taskId, sessionId)
	const panel = taskManaged ? { ...legacyPanel, open: navigation.open } : legacyPanel
	// ⌘Y forks from the latest message you sent; the first message has nothing before it to keep.
	const forkTarget =
		turns
			.filter((turn) => turn.kind === 'user')
			.slice(1)
			.at(-1) ?? null
	useThreadRequests((request: ThreadRequest) => {
		if (!visible) return
		if (request.kind === 'handoff') {
			const target = model.catalog.models.find((option) => option.value === request.model)
			if (model.handoffBlocked) showToast(`Could not hand off. ${model.handoffBlocked}`)
			else if (target) setHandoff(target)
		} else if (running) showToast('Could not fork while the agent works. Stop it or wait for it to finish.')
		else if (hostOffline) showToast(`Could not fork. ${host?.name ?? 'The host'} is offline.`)
		else if (!canFork) showToast('Could not fork. This coding agent does not support forks.')
		else if (!forkTarget || forkTarget.kind !== 'user')
			showToast('Nothing to fork yet. Fork starts from your second message.')
		else setFork({ id: forkTarget.id, text: forkTarget.text })
	}, visible)
	const userTurns = turns.filter((turn) => turn.kind === 'user').length
	const [outgoing, setOutgoing] = useState<{ text: string; after: number } | null>(null)
	const showOutgoing = outgoing !== null && userTurns <= outgoing.after
	const latest = useStickToBottom(`${events.length}:${pendingApprovals.length}:${queued.length}:${showOutgoing}`)
	const { host } = useHost(session?.host_id, session?.created_by)
	const running = session ? isBusy(session.status) : false
	const settingUp = session?.status === 'waiting_for_workspace'
	const workspaceRef = useCallback(
		(element: HTMLDivElement | null) => {
			if (workspaceFocused) element?.scrollIntoView({ block: 'center' })
		},
		[workspaceFocused],
	)
	const hostOffline = session !== null && host !== null && !host.online && session.status !== 'draft'
	const { canSendPrompt, canResolveApproval, canManageSession } = useSessionAccess(session ?? undefined)
	const canFork =
		session !== null &&
		canSendPrompt &&
		!hostOffline &&
		!running &&
		['claude', 'codelayer', 'fold'].includes(session.coding_agent)

	if (!session) {
		return (
			<main className="main">
				<div className="hero">
					{isReady ? <h1 className="status">This session doesn't exist</h1> : <div className="boot-mark" />}
				</div>
			</main>
		)
	}

	// Avatars mark who sent what once teammates can prompt, or already have.
	const multiplayer = isMultiplayerThread(session, [
		...turns.map((turn) => (turn.kind === 'user' ? turn.userId : null)),
		...queued.map((message) => message.user_id),
	])

	const submit = async (intent: SendIntent = running ? 'queue' : 'send', sharedText?: string) => {
		const text = withAttachments(sharedText ?? draft, task?.slug ?? '', attachments.metadata)
		if (!text || sendingLock.current || attachments.blocked) return false
		sendingLock.current = true
		// Show the message right away; the round trip takes a few seconds and the composer shouldn't wait on it,
		// or lose focus to a disabled state while it does.
		const before = draft
		if (sharedText === undefined) setDraft('')
		if (!denying && intent !== 'queue') setOutgoing({ text, after: userTurns })
		try {
			if (denying) {
				await api.approvals.resolve({ approvalId: denying.approvalId, decision: 'deny', comment: text })
				setDenying(null)
			} else {
				await sendToSession(api, session.id, text, intent)
			}
			attachments.clear()
			return true
		} catch {
			setOutgoing(null)
			if (sharedText === undefined) setDraft((current) => current || before)
			showToast('Could not send. Your message is still in the composer.')
			return false
		} finally {
			sendingLock.current = false
		}
	}

	const page = (
		<>
			<main className="main">
				<div className="sr-only" role="status">
					{statusAnnouncement(session.status)}
				</div>
				<div className="titlebar">
					<span className="title">
						{taskManaged ? sessionName(session) : (task?.name ?? sessionName(session, 'Session'))}
					</span>
					{!taskManaged ? <ChapterMenu session={session} /> : null}
					<ThreadActions session={session} />
					<span className="sp" />
					<SharingPill session={session} />
					{task ? <DiffStat task={task} onOpen={() => panel.open('review')} /> : null}
					<EnvironmentMenu session={session} host={host} />
					{task && !taskManaged ? (
						<button
							type="button"
							className="iconbtn panel-toggle"
							title={`${panel.show ? 'Close side panel' : 'Review, artifacts and PR'} (${shortcutHint('panel')})`}
							aria-label="Toggle side panel"
							aria-pressed={panel.show}
							onClick={panel.toggle}
						>
							<PanelRight className="i" strokeWidth={1.6} />
						</button>
					) : null}
				</div>
				<div className="scroll" ref={latest.ref}>
					<div className="col">
						{!isReady ? <div className="boot-mark" /> : null}
						<Transcript
							multiplayer={multiplayer}
							turns={turns}
							running={running && !settingUp}
							onFork={canFork ? setFork : undefined}
							taskId={taskId}
							onOpen={task ? panel.open : undefined}
						/>
						{showOutgoing ? (
							<div className="turn-user outgoing">
								{multiplayer && user ? <WiredUserAvatar userId={user.id} size={24} /> : null}
								<div className="bubble">{outgoing.text}</div>
							</div>
						) : null}
						{(settingUp || workspaceFocused) && taskId ? (
							<div ref={workspaceRef}>
								<WorkspaceSetup taskId={taskId} waitingForWorkspace={settingUp} />
							</div>
						) : null}
						{isReady &&
						task &&
						canSendPrompt &&
						!running &&
						pendingApprovals.length === 0 &&
						session.status !== 'failed' &&
						session.status !== 'lost' ? (
							<NextStepCard session={session} task={task} host={host} />
						) : null}
					</div>
				</div>
				<div className="col dock">
					{latest.away ? (
						<button
							type="button"
							className="to-latest"
							title="Jump to latest"
							aria-label="Jump to latest"
							onClick={latest.jump}
						>
							<ArrowDown className="i sm" strokeWidth={1.8} />
						</button>
					) : null}
					<SessionNotice session={session} host={host} taskId={taskId} />
					{pendingApprovals[0] && canResolveApproval && !denying ? (
						<AskCard
							key={pendingApprovals[0].id}
							approval={pendingApprovals[0]}
							total={pendingApprovals.length}
							onDenyWithFeedback={(approvalId, what) => {
								setDenying({ approvalId, what })
								requestAnimationFrame(() => composerRef.current?.focus())
							}}
						/>
					) : null}
					{queued.length > 0 ? (
						<QueueHeader count={queued.length} ownerId={session.resource_owner_user_id} />
					) : null}
					{queued.map((message) => (
						<QueuedMessage
							multiplayer={multiplayer}
							key={message.id}
							sessionId={session.id}
							message={message}
							disabled={hostOffline || !canSendPrompt}
						/>
					))}
					{canSendPrompt ? (
						<ThreadComposer
							session={session}
							privatePrompt={Boolean(denying)}
							onSend={(text, interrupt) =>
								submit(interrupt ? 'interrupt_and_send' : running ? 'queue' : 'send', text)
							}
							onManageSharing={() => setSharingOpen(true)}
							sharingBlocked={
								!canManageSession
									? 'Only the session owner can change this'
									: !sharingEnabled
										? 'An admin turned this off for your organization'
										: null
							}
							value={draft}
							onChange={setDraft}
							onSubmit={() => void submit()}
							onStop={() =>
								void stop.run(
									() => api.sessions.interrupt({ sessionId: session.id }),
									'Could not stop the agent. Check the session and try again.',
								)
							}
							onInterruptAndSend={() => void submit('interrupt_and_send')}
							onCompact={() => void agent.compact()}
							running={running && !denying && !settingUp}
							disabled={hostOffline || stop.pending || agent.pending}
							placeholder={composerPlaceholder({
								denying: denying !== null,
								hostOffline,
								hostName: host?.name,
								running,
								settingUp,
							})}
							submitLabel={denying ? 'Deny and send' : running ? 'Queue' : 'Send'}
							settings={sessionSettings(session)}
							onSettingsChange={model.change}
							catalog={model.catalog}
							onHandoff={setHandoff}
							handoffBlocked={model.handoffBlocked}
							context={contextUsage(session)}
							chip={
								denying
									? { label: `Denying ${denying.what}`, onClear: () => setDenying(null) }
									: undefined
							}
							autoFocus={visible && !navigation.search.artifactId}
							inputRef={composerRef}
							commands={commands}
							mentionScope={{
								taskId,
								hostId: session.host_id,
								directory: session.working_directory ?? null,
							}}
							attachments={task?.slug && !denying ? attachments : undefined}
							usage={
								host
									? { hostName: host.name, limits: host.host.coding_agent_usage_limits?.claude }
									: undefined
							}
						/>
					) : (
						<ReadOnlyNotice session={session} waiting={pendingApprovals.length > 0} />
					)}
				</div>
			</main>
			{fork ? <ForkDialog session={session} from={fork} onClose={() => setFork(null)} /> : null}
			{sharingOpen ? <PromptAccessDialog session={session} onClose={() => setSharingOpen(false)} /> : null}
			{handoff ? <HandoffDialog session={session} model={handoff} onClose={() => setHandoff(null)} /> : null}
			{task && !taskManaged && panel.show ? (
				<button className="panel-scrim" type="button" aria-label="Close panel" onClick={panel.toggle} />
			) : null}
			{task && !taskManaged && panel.show ? (
				<SidePanel
					task={task}
					preferred={panel.preferred}
					requested={panel.request}
					sessionId={session.id}
					artifacts={artifacts}
					onClose={panel.toggle}
				/>
			) : null}
		</>
	)
	// One diff stream per task, shared by the title bar's stat and the Review tab.
	return taskId && !taskManaged ? (
		<TaskDiffScope
			taskId={taskId}
			loading={
				<main className="main">
					<div className="hero">
						<div className="boot-mark" />
					</div>
				</main>
			}
			missing={page}
		>
			{page}
		</TaskDiffScope>
	) : (
		page
	)
}

function ThreadComposer({
	session,
	privatePrompt,
	onSend,
	onManageSharing,
	sharingBlocked,
	...props
}: ComponentProps<typeof Composer> & {
	session: Session
	privatePrompt: boolean
	onSend: (text: string, interrupt: boolean) => Promise<boolean>
	onManageSharing: () => void
	/** Why this person can't change who may prompt, if they can't. */
	sharingBlocked: string | null
}) {
	const sharing = usePromptSharing(session)
	const options = useSharedResponseOptions(session, true)
	const multiplayer = {
		active: sharing.active,
		detail:
			sharingBlocked ??
			(sharing.active
				? `${plural(sharing.userIds.length, 'teammate')} can prompt${sharing.left ? ` · ${sharing.left} left` : ''}`
				: 'Let teammates prompt this session'),
		disabled: sharingBlocked !== null,
		onSelect: onManageSharing,
	}
	return options && !privatePrompt ? (
		<SharedComposer
			key={`${options.organizationId}:${options.sessionId}:${options.memberId}:${options.contentAccess}`}
			{...props}
			multiplayer={multiplayer}
			options={options}
			onSend={onSend}
		/>
	) : (
		<Composer {...props} multiplayer={multiplayer} />
	)
}

function composerPlaceholder(state: {
	denying: boolean
	hostOffline: boolean
	hostName?: string
	running: boolean
	settingUp: boolean
}) {
	if (state.denying) return 'Tell the agent what to do instead'
	if (state.hostOffline) return `${state.hostName ?? 'The host'} is offline`
	if (state.settingUp) return 'Queue a message. It sends after setup succeeds.'
	if (state.running) return 'Queue a follow-up. It sends when the agent finishes.'
	return 'Ask for follow-up changes'
}
