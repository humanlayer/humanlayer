import { KanbanCard, type KanbanCardModel, type KanbanCommenter } from '@humanlayer/ui/components/kanban'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { FolderArchive, Link as LinkIcon, Pencil } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useKanbanFocusStore } from '@/hooks/stores/kanbanFocusStore'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { summarizeTaskComments } from '@/lib/kanban/summarizeTaskComments'
import { copyTaskDeepLink } from '@/utils/sharing-links'

/**
 * Deliberate per-card wired boundary.
 *
 * Runs its own live query for this task's unresolved artifact comments (keyed by
 * `task_id`) so that comment churn (add / resolve / delete / reply) re-renders
 * only the affected card rather than forcing the board/columns to re-derive. The
 * board, columns, and presentational `KanbanCard` stay pure.
 */
export function WiredKanbanCard({
	card,
	onArchiveTask,
	onRenameTask,
	onForceArchiveTask,
	onForceRenameTask,
}: {
	card: KanbanCardModel
	/**
	 * Owner-gated archive handler. Truthy presence signals the current user may archive
	 * this task; omit (or pass `undefined`) when they cannot.
	 */
	onArchiveTask?: (taskId: string) => void
	/**
	 * Owner-gated rename handler. Truthy presence signals the current user may rename
	 * this task; omit (or pass `undefined`) when they cannot.
	 */
	onRenameTask?: (taskId: string) => void
	/**
	 * Admin force-archive handler. Truthy presence signals the current user is an admin
	 * who does not own this task; omit (or pass `undefined`) when they cannot.
	 */
	onForceArchiveTask?: (taskId: string) => void
	/**
	 * Admin force-rename handler. Truthy presence signals the current user is an admin
	 * who does not own this task; omit (or pass `undefined`) when they cannot.
	 */
	onForceRenameTask?: (taskId: string) => void
}) {
	const { artifactCommentsCollection } = useSync()
	const { membersMap } = useOrgMembers()
	const navigate = useNavigate()
	const keybindingDisplays = useKeybindingDisplays()

	// Per-card boolean selector: a focus change re-renders only the previously- and
	// newly-focused cards, not the whole board.
	const isFocused = useKanbanFocusStore((state) => state.focusedTaskId === card.id)

	// Stable `onSelect` keyed on the card *id* so an unrelated re-render can't recreate
	// this handler and churn the shared `archive-task` registry entry (which would
	// transiently unregister the focused card's action). See the shared-id safety note
	// in the structure outline.
	const handleArchiveSelect = useCallback(() => onArchiveTask?.(card.id), [onArchiveTask, card.id])

	// Stable admin force-archive handler keyed on the card id, mirroring
	// `handleArchiveSelect`. Routes through the board-level `WiredBoardTasksView` handler
	// (which owns the ack guard + confirm modal).
	const handleForceArchiveSelect = useCallback(() => onForceArchiveTask?.(card.id), [onForceArchiveTask, card.id])

	// Stable owner rename handler keyed on the card id. Routes through the
	// board-level `WiredBoardTasksView` handler (shared RenameTaskDialog, no admin warning).
	const handleRenameSelect = useCallback(() => onRenameTask?.(card.id), [onRenameTask, card.id])

	// Stable admin force-rename handler keyed on the card id, mirroring
	// `handleForceArchiveSelect`. Routes through the board-level `WiredBoardTasksView` handler
	// (which owns the shared RenameTaskDialog state).
	const handleForceRenameSelect = useCallback(() => onForceRenameTask?.(card.id), [onForceRenameTask, card.id])

	// Register the "Archive Task" palette action only while this card is the focused,
	// archivable one. Reuses the same handler the `e` hotkey calls, so palette behavior
	// can't drift from the hotkey.
	useCommandPaletteAction({
		id: 'archive-task',
		label: 'Archive Task',
		icon: FolderArchive,
		shortcut: keybindingDisplays.archive,
		enabled: isFocused && !!onArchiveTask,
		onSelect: handleArchiveSelect,
	})

	// Admin force-archive palette action for the focused, non-owned card. The
	// `shortcut` is display-only; the real `E` key binding lives in useKanbanHotkeys
	// (which routes to owner-archive vs force-archive per focused card). Routes
	// through the same board-level handler as the context menu.
	useCommandPaletteAction({
		id: 'force-archive-task',
		label: 'Archive Task',
		icon: FolderArchive,
		shortcut: keybindingDisplays.archive,
		enabled: isFocused && !!onForceArchiveTask,
		onSelect: handleForceArchiveSelect,
	})

	// Admin force-rename palette action for the focused, non-owned card. The
	// `shortcut` is display-only; the real `⇧R` key binding lives in
	// useKanbanHotkeys. Routes through the same board-level handler as the context
	// menu (shared RenameTaskDialog).
	useCommandPaletteAction({
		id: 'force-rename-task',
		label: 'Rename Task',
		icon: Pencil,
		shortcut: hotkeysCatalog.global.shortcuts.renameFocused.display,
		enabled: isFocused && !!onForceRenameTask,
		onSelect: handleForceRenameSelect,
	})

	// Owner rename palette action for the focused, owned card. Routes through the
	// same board-level handler as the context menu (shared RenameTaskDialog).
	useCommandPaletteAction({
		id: 'rename-task',
		label: 'Rename Task',
		icon: Pencil,
		shortcut: hotkeysCatalog.global.shortcuts.renameFocused.display,
		enabled: isFocused && !!onRenameTask,
		onSelect: handleRenameSelect,
	})

	// Stable handler keyed on the card id, same as `handleArchiveSelect` above.
	const handleCopyUrlSelect = useCallback(() => void copyTaskDeepLink(card.id), [card.id])
	const handleCreateSessionSelect = useCallback(
		() => navigate({ to: '/sessions/draft', search: { taskId: card.id } }),
		[navigate, card.id],
	)

	// "Copy Task URL" for the focused card. Drafts are excluded — they have no
	// `/tasks/$taskId` route until launched.
	useCommandPaletteAction({
		id: 'copy-task-url',
		label: 'Copy Task URL',
		icon: LinkIcon,
		shortcut: hotkeysCatalog.global.shortcuts.copyPrimaryUrl.display,
		enabled: isFocused && !card.isDraft,
		onSelect: handleCopyUrlSelect,
	})

	// Scoped to this card's task; the board-level query never touches comments, so
	// these rows changing re-renders only this card.
	const { data: commentRows } = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) =>
					and(eq(comments.task_id, card.id), eq(comments.is_deleted, false), eq(comments.is_resolved, false)),
				)
				.select(({ comments }) => ({
					id: comments.id,
					created_by_user_id: comments.created_by_user_id,
					reply_to_comment_id: comments.reply_to_comment_id,
				})),
		[artifactCommentsCollection, card.id],
	)

	const { commentCount, commenters } = useMemo(() => {
		const summary = summarizeTaskComments(
			(commentRows ?? []).map((row) => ({
				id: row.id,
				created_by_user_id: row.created_by_user_id,
				reply_to_comment_id: row.reply_to_comment_id,
			})),
		)

		const resolved: KanbanCommenter[] = summary.participantIds.map((userId) => {
			const member = membersMap.get(userId)
			const displayName = member
				? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
				: userId
			return {
				name: displayName,
				avatarUrl: member?.profilePictureUrl ?? '',
			}
		})

		return { commentCount: summary.count, commenters: resolved }
	}, [commentRows, membersMap])

	const cardWithComments = useMemo<KanbanCardModel>(
		() => ({ ...card, commentCount, commenters }),
		[card, commentCount, commenters],
	)

	return (
		<KanbanCard
			// Keying by focus state re-lifecycles the card when focus changes, letting
			// the pure card scroll itself into view from a mount effect instead of a
			// reactive one (react.dev "resetting all state when a prop changes").
			key={isFocused ? 'focused' : 'blurred'}
			card={cardWithComments}
			isFocused={isFocused}
			onCreateSession={card.isDraft ? null : handleCreateSessionSelect}
			// Right-click "Archive" menu — same owner-gated handler the palette action
			// and `e` hotkey use. Only wired for owners so the menu never surfaces (or
			// acts) for non-owned tasks.
			onArchiveTask={onArchiveTask ? handleArchiveSelect : undefined}
			// Right-click "Rename" — only for owners (mutually exclusive with the
			// admin "[Admin] Rename" item below).
			onRenameTask={onRenameTask ? handleRenameSelect : undefined}
			// Right-click destructive "[Admin] Archive" — only for admins on tasks they
			// don't own (mutually exclusive with the owner `Archive` item above).
			onForceArchiveTask={onForceArchiveTask ? handleForceArchiveSelect : null}
			// Right-click destructive "[Admin] Rename" — only for admins on tasks they
			// don't own (mutually exclusive with the owner's inline rename affordance).
			onForceRenameTask={onForceRenameTask ? handleForceRenameSelect : null}
			// Right-click "Copy Task URL" — same handler as the palette action. Not
			// wired for drafts, which have no `/tasks/$taskId` route until launched.
			onCopyTaskUrl={card.isDraft ? undefined : handleCopyUrlSelect}
			onMouseEnter={() => {
				// Only follow the mouse once the pointer has actually moved (focusSource
				// flipped to 'mouse' by WiredBoardTasksView's mousemove handler), so keyboard
				// navigation isn't stolen by an incidental hover on mount/scroll.
				if (useKanbanFocusStore.getState().focusSource === 'mouse') {
					useKanbanFocusStore.getState().setFocusedTaskId(card.id, 'mouse')
				}
			}}
			onClick={() => {
				// Remember the card we left from so returning to the board restores
				// focus to it (ENG-2749). Keyboard source so the restored card scrolls
				// into view and isn't stolen by an incidental hover on return.
				useKanbanFocusStore.getState().setFocusedTaskId(card.id, 'keyboard')
				// Drafts open the new-task form (same route the task table uses);
				// launched tasks open their detail page.
				if (card.isDraft) {
					navigate({ to: '/tasks/new', search: { draftId: card.id } })
				} else {
					navigate({ to: '/tasks/$taskId', params: { taskId: card.id } })
				}
			}}
		/>
	)
}
