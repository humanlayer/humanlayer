import type { Session } from '@humanlayer/db/tables/sessions'
import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import {
	Archive,
	ArrowRightLeft,
	Bell,
	BellDot,
	Cpu,
	FileText,
	FolderGit2,
	GitFork,
	GitPullRequest,
	Keyboard,
	LayoutTemplate,
	Link2,
	ListPlus,
	Minimize2,
	Monitor,
	Moon,
	PanelLeft,
	RefreshCw,
	Settings,
	Shield,
	SquareArrowOutUpRight,
	SquarePen,
	Sun,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useToggleMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { openInEditor } from '@/integrations/desktop/editor'
import { isElectron, isTauri } from '@/lib/utils'
import { useSessionAccess } from '@/minimalist/lib/access'
import { artifactName, isAttachment, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { useRecentArtifacts, useTask, useTaskTree } from '@/minimalist/lib/data'
import { formatAgo, toMs } from '@/minimalist/lib/format'
import { AGENT_NAMES, pickModel, sessionSettings } from '@/minimalist/lib/models'
import { matchActions } from '@/minimalist/lib/palette'
import { phaseOf } from '@/minimalist/lib/phases'
import { contextPercent, useAskAgent } from '@/minimalist/lib/send'
import { useSessionSettings } from '@/minimalist/lib/session-settings'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { PERMISSION_MODES } from '@/minimalist/lib/status'
import { useOpenInTask } from '@/minimalist/lib/thread-panel'
import { requestThread } from '@/minimalist/lib/thread-requests'
import { useUi } from '@/minimalist/lib/ui-state'
import { useArchive } from '@/minimalist/lib/use-archive'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useUnreadActions } from '@/minimalist/lib/use-unread'

export type PaletteItem = {
	id: string
	label: string
	detail?: string
	icon?: ReactNode
	kbd?: string
	run: () => void
}

/** The task on screen, and the session you're reading in it (the latest when none is picked). */
function useOnScreen() {
	const params = useParams({ strict: false }) as { taskId?: string; sessionId?: string }
	const search = useLocation().search as { session?: string }
	const { task, sessions } = useTask(params.taskId)
	const session =
		sessions.find((entry) => entry.id === (params.sessionId ?? search.session)) ?? sessions.at(-1) ?? null
	return { task, sessions, session }
}

/** Tasks by name, most recent first, numbered for ⌘1–9. Before you type, the six that ⌥⌘1–6 open. */
export function useTaskResults(query: string): PaletteItem[] {
	const navigate = useNavigate()
	const { recent } = useTaskTree()
	const needle = query.trim().toLowerCase()
	return recent
		.filter((row) => !needle || row.task.name.toLowerCase().includes(needle))
		.slice(0, needle ? 9 : 6)
		.map((row, index) => ({
			id: row.task.id,
			label: row.task.name,
			detail: [row.projectName, row.latest ? phaseOf(row.latest) : null].filter(Boolean).join(' · '),
			kbd: `⌘${index + 1}`,
			run: () => void navigate({ to: '/tasks/$taskId', params: { taskId: row.task.id } }),
		}))
}

/** Before you type, this task's documents; while searching, any document by its name or its task's. */
export function useDocumentResults(query: string): PaletteItem[] {
	const openInTask = useOpenInTask()
	const { panelOpen, togglePanel } = useUi()
	const { recent: tasks } = useTaskTree()
	const { artifacts: recent } = useRecentArtifacts()
	const { task } = useOnScreen()
	const needle = query.trim().toLowerCase()
	const taskNames = new Map(tasks.map((row) => [row.task.id, row.task.name]))
	return recent
		.filter((artifact) => !isPromptArtifact(artifact) && !isAttachment(artifact) && taskNames.has(artifact.task_id))
		.filter((artifact) =>
			needle
				? artifactName(artifact.file_name).toLowerCase().includes(needle) ||
					(taskNames.get(artifact.task_id) ?? '').toLowerCase().includes(needle)
				: artifact.task_id === task?.id,
		)
		.slice(0, needle ? 6 : 4)
		.map((artifact) => {
			const here = artifact.task_id === task?.id
			return {
				id: `artifact-${artifact.id}`,
				label: artifactName(artifact.file_name),
				detail: here
					? `Updated ${formatAgo(toMs(artifact.last_updated_at ?? 0))}`
					: taskNames.get(artifact.task_id),
				icon: <FileText className="i sm" />,
				run: () => {
					if (!panelOpen) togglePanel()
					void openInTask(artifact.task_id, { artifactId: artifact.id })
				},
			}
		})
}

/** What you can do to the task and session on screen first, then the app-wide actions. */
export function useActionResults(query: string): PaletteItem[] {
	const { task, sessions, session } = useOnScreen()
	const navigate = useNavigate()
	const { archive } = useArchive()
	const { markUnread } = useUnreadActions()
	const sessionActions = useSessionActions(session)
	const appActions = useAppActions()
	const taskActions: PaletteItem[] = task
		? [
				{
					id: 'new-session',
					label: 'New session in this task',
					icon: <ListPlus className="i sm" />,
					run: () => void navigate({ to: '/', search: { task: task.id } }),
				},
				{
					id: 'archive-task',
					label: 'Archive this task',
					icon: <Archive className="i sm" />,
					kbd: shortcutHint('archive'),
					run: () => void archive({ kind: 'task', id: task.id }, true),
				},
				{
					id: 'mark-unread',
					label: 'Mark as unread',
					icon: <BellDot className="i sm" />,
					kbd: shortcutHint('mark-unread'),
					run: () => {
						const latest = sessions.at(-1)
						if (latest) void markUnread(task.id, latest.id)
					},
				},
			]
		: []
	return matchActions(
		[...taskActions, ...sessionActions, ...appActions],
		query,
		session ? contextPercent(session) : null,
	)
}

/** Compact, fork, model, permissions and hand-off for whoever may do them; copy and open for anyone. */
function useSessionActions(session: Session | null): PaletteItem[] {
	const { showToast } = useUi()
	const copy = useCopy()
	const editor = useSettingsStore((state) => state.defaultEditor)
	const settings = useSessionSettings(session)
	const agent = useAskAgent(session?.id ?? null)
	const { canSendPrompt, canManageSession } = useSessionAccess(session ?? undefined)
	if (!session) return []
	const items: PaletteItem[] = []
	const context = contextPercent(session)
	if (canSendPrompt)
		items.push(
			{
				id: 'compact',
				label: 'Compact this session',
				detail: context !== null ? `${context}% of context used` : undefined,
				icon: <Minimize2 className="i sm" />,
				run: () => void agent.compact(),
			},
			{
				id: 'fork',
				label: 'Fork from your last message',
				icon: <GitFork className="i sm" />,
				kbd: shortcutHint('fork'),
				run: () => requestThread({ kind: 'fork' }),
			},
		)
	const current = sessionSettings(session)
	const models = canManageSession ? settings.catalog.models : []
	const autoMode = models.find((model) => model.value === current.model)?.autoMode ?? true
	for (const model of models) {
		if (model.value === current.model) continue
		if (model.agent !== current.agent) {
			if (!settings.handoffBlocked)
				items.push({
					id: `handoff-${model.value}`,
					label: `Hand off to ${AGENT_NAMES[model.agent]} on ${model.label}`,
					icon: <ArrowRightLeft className="i sm" />,
					run: () => requestThread({ kind: 'handoff', model: model.value }),
				})
			continue
		}
		items.push({
			id: `model-${model.value}`,
			label: `Switch model to ${model.label}`,
			icon: <Cpu className="i sm" />,
			run: () => settings.change(pickModel(current, model), `Model set to ${model.label}`),
		})
	}
	// Codex always runs without asking, and Auto needs a model that offers it.
	for (const mode of canManageSession && current.agent === 'claude' ? PERMISSION_MODES : []) {
		if (mode.value === current.permissionsMode || (mode.value === 'auto' && !autoMode)) continue
		items.push({
			id: `permissions-${mode.value}`,
			label: `Change permissions to ${mode.label}`,
			icon: <Shield className="i sm" />,
			run: () => settings.change({ ...current, permissionsMode: mode.value }, `Permissions set to ${mode.label}`),
		})
	}
	items.push(
		{
			id: 'copy-link',
			label: 'Copy session link',
			icon: <Link2 className="i sm" />,
			run: () =>
				copy(
					`${location.origin}/sessions/${session.id}`,
					'Session link copied',
					'Could not copy the link. Copy the address from your browser.',
				),
		},
		{
			id: 'copy-dir',
			label: 'Copy working directory',
			icon: <FolderGit2 className="i sm" />,
			run: () => copy(session.working_directory, 'Path copied', 'Could not copy the path. Try again.'),
		},
	)
	if (isElectron() || isTauri())
		items.push({
			id: 'open-editor',
			label: 'Open in editor',
			icon: <SquareArrowOutUpRight className="i sm" />,
			run: () =>
				void openInEditor({
					path: session.working_directory,
					editor: editor === 'system' ? null : editor,
				}).catch(() =>
					showToast(
						'Could not open the folder in your editor. Check that it is installed and the folder still exists.',
					),
				),
		})
	return items
}

function useAppActions(): PaletteItem[] {
	const navigate = useNavigate()
	const { theme, setTheme, toggleSidebar, attentionView, toggleAttentionView } = useUi()
	const toggleMinimalist = useToggleMinimalistLayout()
	const go =
		(
			to:
				| '/'
				| '/settings/general'
				| '/pull-requests'
				| '/artifacts'
				| '/settings/archived'
				| '/settings/keybindings'
				| '/settings/git',
		) =>
		() =>
			void navigate({ to, search: {} })
	const themes: PaletteItem[] = [
		{
			id: 'system',
			label: 'Match system appearance',
			icon: <Monitor className="i sm" />,
			run: () => setTheme('system'),
		},
		{ id: 'light', label: 'Use light appearance', icon: <Sun className="i sm" />, run: () => setTheme('light') },
		{ id: 'dark', label: 'Use dark appearance', icon: <Moon className="i sm" />, run: () => setTheme('dark') },
	]
	return [
		{
			id: 'new',
			label: 'New task',
			icon: <SquarePen className="i sm" />,
			kbd: shortcutHint('new-task'),
			run: go('/'),
		},
		{
			id: 'settings',
			label: 'Settings',
			icon: <Settings className="i sm" />,
			kbd: shortcutHint('settings'),
			run: go('/settings/general'),
		},
		{
			id: 'prs',
			label: 'Go to pull requests',
			icon: <GitPullRequest className="i sm" />,
			run: go('/pull-requests'),
		},
		{ id: 'artifacts', label: 'Go to artifacts', icon: <FileText className="i sm" />, run: go('/artifacts') },
		{
			id: 'attention',
			label: attentionView ? 'Show all tasks' : 'Show what needs you',
			icon: <Bell className="i sm" />,
			kbd: shortcutHint('attention'),
			run: toggleAttentionView,
		},
		{
			id: 'sidebar',
			label: 'Show or hide the sidebar',
			icon: <PanelLeft className="i sm" />,
			kbd: shortcutHint('sidebar'),
			run: toggleSidebar,
		},
		{ id: 'archived', label: 'Archived tasks', icon: <Archive className="i sm" />, run: go('/settings/archived') },
		{
			id: 'shortcuts',
			label: 'Keyboard shortcuts',
			icon: <Keyboard className="i sm" />,
			run: go('/settings/keybindings'),
		},
		{ id: 'git', label: 'Git settings', icon: <Settings className="i sm" />, run: go('/settings/git') },
		{
			id: 'check-updates',
			label: 'Check for updates',
			icon: <RefreshCw className="i sm" />,
			run: () => void navigate({ to: '/settings/updates', search: { updateCheck: true } }),
		},
		...themes.filter((item) => item.id !== theme),
		{
			id: 'toggle-minimalist',
			label: 'Toggle Minimalist UI',
			icon: <LayoutTemplate className="i sm" />,
			run: toggleMinimalist,
		},
	]
}
