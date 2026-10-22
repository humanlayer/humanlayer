import { SessionRow } from '@humanlayer/ui/components/sidebar/SessionRow'
import type { SidebarSession } from '@humanlayer/ui/components/sidebar/types'
import { useMatch, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Archive } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useIsColocated } from '@/hooks/use-colocated'
import { useArchiveSessionAction } from '@/hooks/useArchiveActions'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useSessionActions } from '@/hooks/useSessionActions'
import { copySessionDeepLink } from '@/utils/sharing-links'

function SessionArchivePaletteAction({ onSelect }: { onSelect: () => void }) {
	useCommandPaletteAction({
		id: 'archive-session',
		label: 'Archive Session',
		icon: Archive,
		shortcut: 'E',
		onSelect,
	})
	return null
}

export function WiredSessionRow({
	session,
	taskId,
	projectTree = false,
}: {
	session: SidebarSession
	taskId?: string
	projectTree?: boolean
}) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const sessionMatch = useMatch({ from: '/_app/sessions/$sessionId', shouldThrow: false })
	const isSelected = sessionMatch?.params.sessionId === session.id
	const isFocused = useFocusStore((state) => {
		const focused = state.focusedSidebarItem
		if (taskId) return focused?.type === 'session' && focused.id === session.id && focused.taskId === taskId
		return focused?.type === 'standalone-session' && focused.id === session.id
	})
	// localHostId is null outside the desktop app (and before it resolves),
	// which suppresses the remote-host icon there.
	const { isColocated, localHostId } = useIsColocated(session.hostId)
	const sessionActions = useSessionActions()
	const archiveSession = useArchiveSessionAction()
	const canArchive = Boolean(user?.id && session.ownerUserId === user.id)
	const [renameOpen, setRenameOpen] = useState(false)

	const handleArchive = useCallback(() => {
		const archived = archiveSession({ id: session.id, name: session.name, ownerUserId: session.ownerUserId })
		if (!archived || !isSelected) return

		if (taskId) navigate({ to: '/tasks/$taskId', params: { taskId } })
		else navigate({ to: '/sessions' })
	}, [archiveSession, isSelected, navigate, session, taskId])

	const handleSaveName = useCallback(
		(sessionId: string, name: string) => {
			const transaction = sessionActions.updateSessionTitle({ sessionId, title: name })
			transaction.isPersisted.promise.catch(() => {
				toast.error('Failed to update session name')
			})
		},
		[sessionActions],
	)

	return (
		<>
			{isFocused && canArchive ? <SessionArchivePaletteAction onSelect={handleArchive} /> : null}
			<SessionRow
				session={session}
				isSelected={isSelected}
				isFocused={isFocused}
				nested={Boolean(taskId)}
				projectTree={projectTree}
				showHostIndicator={Boolean(localHostId) && !isColocated}
				onSelect={() => {
					if (taskId) useSidebarStore.getState().expandTask(taskId)
					navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
					focusMainAndReleaseSpatialDomFocus()
				}}
				onRename={() => setRenameOpen(true)}
				onCopyDeepLink={() => void copySessionDeepLink(session.id)}
				onArchive={canArchive ? handleArchive : undefined}
			/>
			<RenameSessionDialog
				sessionId={session.id}
				currentName={session.name}
				isOpen={renameOpen}
				onOpenChange={setRenameOpen}
				onSave={handleSaveName}
			/>
		</>
	)
}
