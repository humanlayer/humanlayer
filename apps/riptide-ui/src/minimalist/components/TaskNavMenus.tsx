import type { Session } from '@humanlayer/db/tables/sessions'
import type { RefObject } from 'react'

import { createArtifactActions } from '@/actions/artifacts'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useLocalTaskArtifactDirectory } from '@/hooks/useLocalTaskArtifactDirectory'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { openInEditor } from '@/integrations/desktop/editor'
import { EDITOR_OPTIONS } from '@/lib/preferences'
import { isElectron, isTauri } from '@/lib/utils'
import { Menu, MenuItem, MenuSeparator } from '@/minimalist/components/Menu'
import { PromptAccessDialog } from '@/minimalist/components/PromptAccessDialog'
import { TextDialog } from '@/minimalist/components/TextDialog'
import { useSessionAccess } from '@/minimalist/lib/access'
import { artifactName, isImageArtifact } from '@/minimalist/lib/artifacts'
import { useTask } from '@/minimalist/lib/data'
import { sessionName } from '@/minimalist/lib/session-name'
import { useUi } from '@/minimalist/lib/ui-state'
import { useArchive } from '@/minimalist/lib/use-archive'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useRiptideApi } from '@/orpc/client'
import { getAuthenticatedArtifactUrl } from '@/utils/artifact-links'

/** What a session row's menu asks its row to open once the menu closes. */
export type SessionDialog = 'rename' | 'share'

/**
 * A session row's right-click menu. It mounts only while open, so the rows don't each
 * read permissions. Rename and teammate prompting open dialogs the row owns.
 */
export function SessionRowMenu({
	anchor,
	session,
	selected,
	onClose,
	onDialog,
}: {
	anchor: RefObject<HTMLElement | null>
	session: Session
	selected: boolean
	onClose: () => void
	onDialog: (dialog: SessionDialog) => void
}) {
	const copy = useCopy()
	const archiver = useArchive()
	const { canManageSession } = useSessionAccess(session)
	const sharingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const unread = useUnreadStore((state) => state.unreadSessionIds.has(session.id))
	const link = `${window.location.origin}/sessions/${session.id}`
	const run = (action: () => void) => () => {
		onClose()
		action()
	}
	return (
		<Menu anchor={anchor} open onClose={onClose} placement="below-start" width={220}>
			{canManageSession ? <MenuItem label="Rename" onSelect={run(() => onDialog('rename'))} /> : null}
			{/* The open session reads itself, so it can't be left unread. */}
			{unread || !selected ? (
				<MenuItem
					label={unread ? 'Mark as read' : 'Mark as unread'}
					onSelect={run(() =>
						unread
							? useUnreadStore.getState().markRead(session.id)
							: useUnreadStore.getState().markUnread(session.id),
					)}
				/>
			) : null}
			{canManageSession ? (
				<>
					<MenuItem
						label="Let teammates prompt…"
						detail={sharingEnabled ? undefined : 'An admin turned this off for your organization'}
						disabled={!sharingEnabled}
						onSelect={run(() => onDialog('share'))}
					/>
					<MenuItem
						label={session.archived ? 'Unarchive' : 'Archive'}
						disabled={archiver.pending}
						onSelect={run(
							() => void archiver.archive({ kind: 'session', id: session.id }, !session.archived),
						)}
					/>
				</>
			) : null}
			<MenuSeparator />
			<MenuItem
				label="Copy link"
				onSelect={run(() =>
					copy(link, 'Session link copied', 'Could not copy the link. Copy it from the address bar.'),
				)}
			/>
			<MenuItem label="Open in new window" onSelect={run(() => window.open(link, '_blank', 'noopener'))} />
		</Menu>
	)
}

/** The dialog a session row's menu asked for. */
export function SessionRowDialog({
	dialog,
	session,
	onClose,
}: {
	dialog: SessionDialog
	session: Session
	onClose: () => void
}) {
	const { client: api } = useRiptideApi()
	if (dialog === 'share') return <PromptAccessDialog session={session} onClose={onClose} />
	return (
		<TextDialog
			title="Rename session"
			initialValue={sessionName(session, '')}
			submitLabel="Save name"
			onClose={onClose}
			onSave={(title) => api.sessions.update({ sessionId: session.id, title })}
		/>
	)
}

/**
 * An artifact row's right-click menu: copy its text, link or path, open it in your editor when
 * this computer has the file, and delete it with an undo. Mounts only while open.
 */
export function ArtifactRowMenu({
	anchor,
	artifact,
	onClose,
}: {
	anchor: RefObject<HTMLElement | null>
	artifact: TaskArtifact
	onClose: () => void
}) {
	const copy = useCopy()
	const image = isImageArtifact(artifact)
	const content = useArtifactContent(image ? null : artifact.id).artifact?.content ?? ''
	const deletion = useArtifactDelete(artifact)
	const link = getAuthenticatedArtifactUrl(artifact.task_id ?? '', artifact.id)
	const run = (action: () => void) => () => {
		onClose()
		action()
	}
	return (
		<Menu anchor={anchor} open onClose={onClose} placement="below-start" width={240}>
			{image ? null : (
				<MenuItem
					label="Copy contents"
					disabled={!content}
					onSelect={run(() =>
						copy(content, 'Contents copied', 'Could not copy the contents. Open the file and copy it.'),
					)}
				/>
			)}
			<MenuItem
				label="Copy link"
				onSelect={run(() =>
					copy(link, 'Link copied', 'Could not copy the link. Copy it from the address bar.'),
				)}
			/>
			<MenuItem label="Open in new window" onSelect={run(() => window.open(link, '_blank', 'noopener'))} />
			<LocalFileItems artifact={artifact} run={run} />
			{deletion.allowed ? (
				<>
					<MenuSeparator />
					<MenuItem label="Delete" onSelect={run(deletion.remove)} />
				</>
			) : null}
		</Menu>
	)
}

function editorLabel(editor: string): string {
	if (editor === 'system') return 'your editor'
	return EDITOR_OPTIONS.find((option) => option.value === editor)?.label ?? 'your editor'
}

/** Open the file in your editor and copy its paths, when this computer has the task's directory. */
function LocalFileItems({ artifact, run }: { artifact: TaskArtifact; run: (action: () => void) => () => void }) {
	const copy = useCopy()
	const { showToast } = useUi()
	const editor = useSettingsStore((state) => state.defaultEditor)
	const directory = useLocalTaskArtifactDirectory(artifact.task_id ?? '')
	const relative = artifact.task_slug ? `.humanlayer/tasks/${artifact.task_slug}/${artifact.file_name}` : null
	if (!directory || !relative) return null
	const path = `${directory.replace(/\/+$/, '')}/${relative}`
	const label = editorLabel(editor)
	const open = () =>
		void openInEditor({ path, editor: editor === 'system' ? null : editor }).catch(() =>
			showToast(
				`Could not open ${artifactName(artifact.file_name)} in ${label}. Check that it is installed and the file still exists.`,
			),
		)
	return (
		<>
			<MenuSeparator />
			{isElectron() || isTauri() ? <MenuItem label={`Open in ${label}`} onSelect={run(open)} /> : null}
			<MenuItem
				label="Copy path"
				onSelect={run(() => copy(path, 'Path copied', 'Could not copy the path. Try again.'))}
			/>
			<MenuItem
				label="Copy relative path"
				onSelect={run(() => copy(relative, 'Path copied', 'Could not copy the path. Try again.'))}
			/>
		</>
	)
}

/** Whether you may delete the artifact (you edit the task, or it's yours), and the delete itself with an undo toast. */
function useArtifactDelete(artifact: TaskArtifact) {
	const { client: api } = useRiptideApi()
	const { artifactsMetadataCollection, taskOrganizationAclsCollection, taskUserAclsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { user } = useBrowserAuth()
	const { showToast } = useUi()
	const { task } = useTask(artifact.task_id ?? '')
	const { canEditTask } = useTaskPermissions(
		task ?? undefined,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)
	const name = artifactName(artifact.file_name)
	const remove = () => {
		const actions = createArtifactActions(artifactsMetadataCollection, api, confirmTx.artifactsMetadata)
		actions.deleteArtifact({ artifactId: artifact.id }).isPersisted.promise.then(
			() =>
				showToast(`Deleted ${name}`, {
					label: 'Undo',
					run: () =>
						void actions
							.restoreArtifact({ artifactId: artifact.id })
							.isPersisted.promise.catch(() => showToast(`Could not restore ${name}. Try again.`)),
				}),
			() => showToast(`Could not delete ${name}. It is back in the list.`),
		)
	}
	return { allowed: canEditTask || artifact.resource_owner_user_id === user?.id, remove }
}
