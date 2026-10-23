import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { useArchivedSessions } from '@/hooks/live-queries/useArchivedSessions'
import { type EditorType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useToggleMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { EDITOR_OPTIONS } from '@/lib/preferences'
import { Segmented, SettingRow, SettingsGroup, Toggle } from '@/minimalist/components/SettingsControls'
import { useBatchQueueDelivery } from '@/minimalist/lib/batch-queue'
import { useTaskTree } from '@/minimalist/lib/data'
import { formatAgo, toMs } from '@/minimalist/lib/format'
import { branchName, type GitPrefs, setGitPrefs, useGitPrefs } from '@/minimalist/lib/git-prefs'
import {
	osNotificationsEnabled,
	osNotificationsSupported,
	setOsNotificationsEnabled,
} from '@/minimalist/lib/os-notifications'
import { sessionName } from '@/minimalist/lib/session-name'
import { SHORTCUTS } from '@/minimalist/lib/shortcuts'
import { type ThemePreference, useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
	{ value: 'system', label: 'System' },
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
]

export function GeneralSettingsPage() {
	const { theme, setTheme } = useUi()
	const toggleMinimalist = useToggleMinimalistLayout()
	const sendKey = useSettingsStore((state) => state.sendMessageKeybinding)
	const setSendKey = useSettingsStore((state) => state.setSendMessageKeybinding)
	const { batch, setBatch } = useBatchQueueDelivery()
	const sounds = useSettingsStore((state) => state.notificationSoundsEnabled)
	const setSounds = useSettingsStore((state) => state.setNotificationSoundsEnabled)
	const editor = useSettingsStore((state) => state.defaultEditor)
	const setEditor = useSettingsStore((state) => state.setDefaultEditor)

	return (
		<>
			<SettingsGroup title="Appearance">
				<SettingRow label="Theme" description="System follows your computer's light or dark setting">
					<Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
				</SettingRow>
				<SettingRow
					label="Minimalist interface"
					description="Turn off to return to the standard interface on this device"
					htmlFor="minimalist-ui-enabled"
				>
					<Toggle
						id="minimalist-ui-enabled"
						label="Minimalist interface"
						checked
						onChange={toggleMinimalist}
					/>
				</SettingRow>
			</SettingsGroup>
			<SettingsGroup title="Messages">
				<SettingRow label="Send with" description="The other key combination adds a new line">
					<Segmented
						label="Send with"
						value={sendKey}
						options={[
							{ value: 'enter', label: 'Enter' },
							{ value: 'mod+enter', label: '⌘ Enter' },
						]}
						onChange={setSendKey}
					/>
				</SettingRow>
				<SettingRow
					label="Batch mode"
					description="When the agent finishes, send every queued message at once instead of one at a time"
					htmlFor="batch-queue"
				>
					<Toggle id="batch-queue" label="Batch mode" checked={batch} onChange={setBatch} />
				</SettingRow>
			</SettingsGroup>
			<SettingsGroup title="Notifications">
				<SettingRow
					label="Sound"
					description="Play a sound when a session finishes or needs you, or someone comments on your work, while HumanLayer is in the background"
					htmlFor="notification-sounds"
				>
					<Toggle id="notification-sounds" label="Sound" checked={sounds} onChange={setSounds} />
				</SettingRow>
				{osNotificationsSupported() ? <DesktopNotificationsRow /> : null}
			</SettingsGroup>
			<SettingsGroup title="Editor">
				<SettingRow
					label="Open files in"
					description="Used when you open a session's directory"
					htmlFor="default-editor"
				>
					<select
						id="default-editor"
						className="select"
						value={editor}
						onChange={(event) => setEditor(event.target.value as EditorType)}
					>
						{EDITOR_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.value === 'system' ? 'System default' : option.label}
							</option>
						))}
					</select>
				</SettingRow>
			</SettingsGroup>
		</>
	)
}

function DesktopNotificationsRow() {
	const [on, setOn] = useState(osNotificationsEnabled)
	const denied = Notification.permission === 'denied'
	const change = async (next: boolean) => {
		if (next && Notification.permission !== 'granted') await Notification.requestPermission()
		setOsNotificationsEnabled(next)
		setOn(osNotificationsEnabled())
	}
	return (
		<SettingRow
			label="Desktop notifications"
			description={
				denied
					? 'Blocked. Allow notifications for HumanLayer in your system or browser settings.'
					: 'When a session needs approval, finishes or fails, or someone comments on your work. Click one to open it.'
			}
			htmlFor="os-notifications"
		>
			<Toggle
				id="os-notifications"
				label="Desktop notifications"
				checked={on}
				onChange={(next) => void change(next)}
			/>
		</SettingRow>
	)
}

const MERGE_METHODS: Array<{ value: GitPrefs['mergeMethod']; label: string }> = [
	{ value: 'github', label: "Repository's default" },
	{ value: 'SQUASH', label: 'Squash and merge' },
	{ value: 'MERGE', label: 'Merge commit' },
	{ value: 'REBASE', label: 'Rebase and merge' },
]

/** Each setting shapes what the Commit, Open PR and Merge buttons ask for. Git itself still runs on the host. */
export function GitSettingsPage() {
	const prefs = useGitPrefs()
	return (
		<>
			<p className="settings-lede">
				The Commit and Open PR buttons send the agent a message. These settings shape that message. They apply
				on this device.
			</p>
			<SettingsGroup title="Branches">
				<SettingRow
					label="Branch prefix"
					description={`Project tasks get branches like ${branchName(prefs.branchPrefix, 'fix-login-a1b2')}`}
					htmlFor="git-branch-prefix"
				>
					<input
						id="git-branch-prefix"
						className="sinput"
						placeholder="None"
						spellCheck={false}
						value={prefs.branchPrefix}
						onChange={(event) => setGitPrefs({ branchPrefix: event.target.value })}
					/>
				</SettingRow>
			</SettingsGroup>
			<SettingsGroup title="Pull requests">
				<SettingRow
					label="Open as drafts"
					description="Open PR asks for a draft. You can still change it for each PR."
					htmlFor="git-draft"
				>
					<Toggle
						id="git-draft"
						label="Open as drafts"
						checked={prefs.draftPullRequests}
						onChange={(checked) => setGitPrefs({ draftPullRequests: checked })}
					/>
				</SettingRow>
				<SettingRow
					label="Merge method"
					description="What the Merge button in the PR panel does"
					htmlFor="git-merge-method"
				>
					<select
						id="git-merge-method"
						className="select"
						value={prefs.mergeMethod}
						onChange={(event) =>
							setGitPrefs({ mergeMethod: event.target.value as GitPrefs['mergeMethod'] })
						}
					>
						{MERGE_METHODS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</SettingRow>
			</SettingsGroup>
			<SettingsGroup title="Instructions">
				<InstructionsRow
					id="git-commit-instructions"
					label="Commit instructions"
					description="Added to every commit request"
					placeholder="For example: use Conventional Commits and keep the subject under 60 characters."
					value={prefs.commitInstructions}
					onChange={(value) => setGitPrefs({ commitInstructions: value })}
				/>
				<InstructionsRow
					id="git-pr-instructions"
					label="PR instructions"
					description="Added to every Open PR request"
					placeholder="For example: link the Linear ticket and list how you tested the change."
					value={prefs.pullRequestInstructions}
					onChange={(value) => setGitPrefs({ pullRequestInstructions: value })}
				/>
			</SettingsGroup>
		</>
	)
}

function InstructionsRow({
	id,
	label,
	description,
	placeholder,
	value,
	onChange,
}: {
	id: string
	label: string
	description: string
	placeholder: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<div className="srow stack">
			<div className="l">
				<label htmlFor={id}>
					<b>{label}</b>
				</label>
				<span>{description}</span>
			</div>
			<textarea
				id={id}
				className="sinput"
				rows={3}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	)
}

function Keys({ keys }: { keys: string }) {
	return (
		<span className="keys">
			{keys.split(' ').map((key, index) => (
				<span key={`${key}-${index}`} className="kbd">
					{key}
				</span>
			))}
		</span>
	)
}

export function ShortcutsSettingsPage() {
	const sendKey = useSettingsStore((state) => state.sendMessageKeybinding)
	const titles = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))]
	const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
		...titles.map((title) => ({
			title,
			rows: SHORTCUTS.filter((shortcut) => shortcut.group === title).map((shortcut): [string, string] => [
				shortcut.label,
				shortcut.keys,
			]),
		})),
		// These work only where they apply, so they live with the composer and the cards rather than the table.
		{
			title: 'Composer',
			rows: [
				['Send', sendKey === 'enter' ? 'Enter' : '⌘ Enter'],
				['New line', sendKey === 'enter' ? '⇧ Enter' : 'Enter'],
				['Stop the agent', 'Esc Esc'],
				['Commands and skills', '/'],
				['Mention a document or file', '@'],
			],
		},
		{
			title: 'Approvals',
			rows: [
				['Approve', 'Enter'],
				['Deny', 'D'],
				['Pick an answer', '1 2 3 4'],
			],
		},
	]
	return (
		<>
			<p className="settings-lede">
				Single keys work only inside a focused approval or question, so typing elsewhere never triggers an
				action.
			</p>
			{groups.map((group) => (
				<SettingsGroup key={group.title} title={group.title}>
					{group.rows.map(([label, keys]) => (
						<SettingRow key={label} label={label}>
							<Keys keys={keys} />
						</SettingRow>
					))}
				</SettingsGroup>
			))}
		</>
	)
}

export function ArchivedSettingsPage() {
	const { groups, standalone, isReady } = useTaskTree(true)
	const { user } = useBrowserAuth()
	const inTasks = useArchivedSessions(user?.id)
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const action = useAction()
	const tasks = groups
		.flatMap((group) => group.tasks.map((row) => ({ row, project: group.name })))
		.sort((a, b) => b.row.lastActivity - a.row.lastActivity)
	const archivedTaskIds = new Set(tasks.map(({ row }) => row.task.id))
	// Sessions in an archived task come back with it, so only those in open tasks list on their own.
	const sessions = [
		...standalone.map((session) => ({ session, taskName: null as string | null })),
		...inTasks
			.filter((session) => session.task_id && session.status !== 'draft' && !archivedTaskIds.has(session.task_id))
			.map((session) => ({ session, taskName: session.taskName || 'Untitled task' })),
	].sort((a, b) => toMs(b.session.last_activity_at) - toMs(a.session.last_activity_at))
	if (isReady && tasks.length === 0 && sessions.length === 0)
		return (
			<p className="settings-lede">
				Archived tasks and sessions show up here. Archiving keeps every session and file.
			</p>
		)
	return (
		<>
			{tasks.length > 0 ? (
				<SettingsGroup title="Tasks">
					{tasks.map(({ row, project }) => (
						<div key={row.task.id} className="srow">
							<Link className="l" to="/tasks/$taskId" params={{ taskId: row.task.id }}>
								<b>{row.task.name || 'Untitled task'}</b>
								<span>
									{project} · {formatAgo(row.lastActivity)}
								</span>
							</Link>
							<button
								type="button"
								className="btn"
								disabled={action.pending}
								onClick={() =>
									void action.run(async () => {
										await api.tasks.archive({
											taskId: row.task.id,
											archived: false,
											cascadeToSessions: false,
										})
										showToast('Task unarchived')
									}, 'Could not unarchive the task. Try again.')
								}
							>
								Unarchive
							</button>
						</div>
					))}
				</SettingsGroup>
			) : null}
			{sessions.length > 0 ? (
				<SettingsGroup title="Sessions">
					{sessions.map(({ session, taskName }) => (
						<div key={session.id} className="srow">
							<Link className="l" to="/sessions/$sessionId" params={{ sessionId: session.id }}>
								<b>{sessionName(session)}</b>
								<span>
									{taskName ? `${taskName} · ` : ''}
									{formatAgo(toMs(session.last_activity_at))}
								</span>
							</Link>
							<button
								type="button"
								className="btn"
								disabled={action.pending}
								onClick={() =>
									void action.run(async () => {
										await api.sessions.update({ sessionId: session.id, archived: false })
										showToast('Session unarchived')
									}, 'Could not unarchive the session. Try again.')
								}
							>
								Unarchive
							</button>
						</div>
					))}
				</SettingsGroup>
			) : null}
		</>
	)
}

/**
 * Projects need the Projects V2 setting. Instead of pointing at Experiments,
 * say what turning it on does and let the user do it here.
 */
export function ProjectsOptInPage() {
	const { queryClient: api } = useRiptideApi()
	const { showToast } = useUi()
	const applyServerSettings = useSettingsStore((state) => state.applyServerSettings)
	const markMutationInFlight = useSettingsStore((state) => state.markMutationInFlight)
	const enable = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onSuccess: (data) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				applyServerSettings(data)
			},
			onError: () => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				useSettingsStore.setState({ projectsV2Enabled: false })
				showToast('Could not turn on projects. Try again.')
			},
		}),
	)
	return (
		<>
			<p className="settings-lede">
				A project is one or more repositories and how to set them up. Each task in a project gets its own
				worktree and branch, so the agent never edits your checkout.
			</p>
			<SettingsGroup>
				<SettingRow
					label="Turn on projects"
					description="Once on, projects stay on for you in this organization. Directory tasks keep working."
				>
					<button
						type="button"
						className="btn primary"
						disabled={enable.isPending}
						onClick={() => {
							useSettingsStore.setState({ projectsV2Enabled: true })
							markMutationInFlight()
							enable.mutate({ projectsV2Enabled: true })
						}}
					>
						Turn on
					</button>
				</SettingRow>
			</SettingsGroup>
		</>
	)
}
