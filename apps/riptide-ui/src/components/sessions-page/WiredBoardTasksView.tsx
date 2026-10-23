import { KanbanBoard, KanbanColumn } from '@humanlayer/ui/components/kanban'
import { TaskViewControls } from '@humanlayer/ui/components/task-view-controls'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { archiveTaskWithCleanup } from '@/actions/archiveTaskWithCleanup'
import { ForceArchiveConfirmDialog } from '@/components/ForceArchiveConfirmDialog'
import { WiredKanbanCard } from '@/components/kanban/WiredKanbanCard'
import { RenameTaskDialog } from '@/components/RenameTaskDialog'
import { useKanbanFocusStore } from '@/hooks/stores/kanbanFocusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskViewPreferencesStore } from '@/hooks/stores/taskViewPreferencesStore'
import { useKanbanColumns } from '@/hooks/useKanbanColumns'
import { useKanbanHotkeys } from '@/hooks/useKanbanHotkeys'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useTaskActions } from '@/hooks/useTaskActions'
import { captureException } from '@/integrations/sentry/sentry'
import { createMouseMoveHandler } from '@/lib/mouse-move-handler'
import type { TaskScope } from '@/lib/tasks/taskScope'

interface ForceArchiveDialogState {
	taskId: string | null
	isOpen: boolean
}

interface RenameDialogState {
	taskId: string | null
	name: string
	isOpen: boolean
	/** When true, the shared RenameTaskDialog renders the admin-override warning. */
	isAdminOverride: boolean
}

/**
 * The Board layout of the Tasks tab. Reads/writes `taskViewPreferencesStore`,
 * renders the pure `TaskViewControls` above the pure read-only `KanbanBoard`,
 * pushes the shared task scope into `useKanbanColumns`, and mounts keyboard
 * navigation (`useKanbanHotkeys`) that is active only while Board is on screen.
 *
 * The first-run Create Task state is resolved by `TasksTab`, so this view always
 * renders its controls even when the current filter shows nothing.
 */
export function WiredBoardTasksView() {
	const setLayout = useTaskViewPreferencesStore((s) => s.setLayout)
	const mode = useTaskViewPreferencesStore((s) => s.mode)
	const selectedUserIds = useTaskViewPreferencesStore((s) => s.selectedUserIds)
	const setMode = useTaskViewPreferencesStore((s) => s.setMode)
	const setSelectedUserIds = useTaskViewPreferencesStore((s) => s.setSelectedUserIds)
	// Board never renders the Grouped toggle, but the row is one shared component
	// and the preference must survive a round trip through Board.
	const grouped = useTaskViewPreferencesStore((s) => s.grouped)
	const setGrouped = useTaskViewPreferencesStore((s) => s.setGrouped)
	const { user, roles } = useAuth()
	const scope = useMemo<TaskScope>(
		() => ({ mode, selectedUserIds, currentUserId: user?.id ?? null }),
		[mode, selectedUserIds, user?.id],
	)

	const { columns, userOptions, totalCards, ownerByTaskId, sessionIdsByTaskId } = useKanbanColumns(scope)

	const selectedIds = useMemo(() => new Set(scope.selectedUserIds), [scope.selectedUserIds])

	// Archive action — same optimistic action + undo toast the task table uses.
	const isAdmin = roles?.includes('admin') ?? false
	const taskActions = useTaskActions()

	// Force-archive acknowledgement (one-time modal), persisted in settingsStore.
	const forceArchiveAcknowledged = useSettingsStore((s) => s.forceArchiveAcknowledged)
	const acknowledgeForceArchive = useSettingsStore((s) => s.acknowledgeForceArchive)
	const [forceArchiveDialog, setForceArchiveDialog] = useState<ForceArchiveDialogState>({
		taskId: null,
		isOpen: false,
	})

	// Shared archive body: resolve the name, run the optimistic cascade + undo toast,
	// then keep keyboard focus moving as the card disappears. No ownership guard — the
	// caller decides who may archive (owner `canArchive` vs admin `canForceArchive`).
	const doArchive = useCallback(
		(taskId: string) => {
			const taskName = columns.flatMap((column) => column.cards).find((card) => card.id === taskId)?.title ?? ''

			archiveTaskWithCleanup({
				taskActions,
				taskId,
				taskName,
				archived: true,
				sessionIds: sessionIdsByTaskId.get(taskId) ?? [],
			})

			// Keep keyboard flow moving within the same column as the card disappears.
			if (useKanbanFocusStore.getState().focusedTaskId === taskId) {
				useKanbanFocusStore.getState().focusAfterTaskRemoved(columns, taskId)
			}
		},
		[columns, sessionIdsByTaskId, taskActions],
	)

	const handleArchiveTask = useCallback(
		(taskId: string) => {
			// Only the owner may archive (mirrors the task table behavior).
			if (user?.id && ownerByTaskId.get(taskId) !== user.id) return
			doArchive(taskId)
		},
		[user?.id, ownerByTaskId, doArchive],
	)

	// Admin force-archive: gate the one-time confirmation modal on the persisted ack.
	// Rendering is already gated by `canForceArchive`, so no ownership guard here.
	const handleForceArchiveTask = useCallback(
		(taskId: string) => {
			if (forceArchiveAcknowledged) {
				doArchive(taskId)
				return
			}
			setForceArchiveDialog({ taskId, isOpen: true })
		},
		[forceArchiveAcknowledged, doArchive],
	)

	const confirmForceArchive = useCallback(() => {
		acknowledgeForceArchive()
		if (forceArchiveDialog.taskId) doArchive(forceArchiveDialog.taskId)
	}, [acknowledgeForceArchive, forceArchiveDialog.taskId, doArchive])

	// Board-level shared RenameTaskDialog state, mirroring the single-instance
	// pattern in ConnectedSidebarTaskTree. Used for both owner rename and admin
	// force-rename — `isAdminOverride` toggles the dialog's warning line. Rename
	// always shows the dialog (no ack flag).
	const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
		taskId: null,
		name: '',
		isOpen: false,
		isAdminOverride: false,
	})

	// Open the shared dialog pre-filled with the card's current title.
	const openRenameDialog = useCallback(
		(taskId: string, isAdminOverride: boolean) => {
			const taskName = columns.flatMap((column) => column.cards).find((card) => card.id === taskId)?.title ?? ''
			setRenameDialog({ taskId, name: taskName, isOpen: true, isAdminOverride })
		},
		[columns],
	)

	// Owner rename — rendering is gated by `canRename` (the current user owns it),
	// so no ownership guard here; the standard `tasks.update` path authorizes it.
	const handleRenameTask = useCallback((taskId: string) => openRenameDialog(taskId, false), [openRenameDialog])

	// Admin force-rename — rendering is gated by `canForceRename` (admin, non-owner);
	// the backend admin bypass (Phase 1) authorizes the non-owned write.
	const handleForceRenameTask = useCallback((taskId: string) => openRenameDialog(taskId, true), [openRenameDialog])

	// Reuse the existing optimistic rename action (name-only). Shared by owner and
	// admin rename; the backend authorizes each via ownership or the admin bypass.
	const handleSaveRename = useCallback(
		(taskId: string, name: string) => {
			const transaction = taskActions.updateTaskName({ taskId, name })
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update task name')
				captureException(error, { extra: { action: 'renameTask', taskId } })
			})
		},
		[taskActions],
	)

	// Ownership-agnostic resolver for the `e` hotkey: owners archive their own task,
	// admins force-archive a task they don't own. Keeps `useKanbanHotkeys` unaware of
	// ownership (it just calls `onArchiveTask`), matching how the palette actions gate
	// owner `Archive` vs `[Admin] Archive` per focused card.
	const handleArchiveHotkey = useCallback(
		(taskId: string) => {
			const isOwner = user?.id ? ownerByTaskId.get(taskId) === user.id : false
			if (isOwner) {
				handleArchiveTask(taskId)
			} else if (isAdmin) {
				handleForceArchiveTask(taskId)
			}
		},
		[user?.id, ownerByTaskId, isAdmin, handleArchiveTask, handleForceArchiveTask],
	)

	const handleRenameHotkey = useCallback(
		(taskId: string) => {
			const isOwner = user?.id ? ownerByTaskId.get(taskId) === user.id : false
			if (isOwner) handleRenameTask(taskId)
			else if (isAdmin) handleForceRenameTask(taskId)
		},
		[user?.id, ownerByTaskId, isAdmin, handleRenameTask, handleForceRenameTask],
	)

	useKanbanHotkeys(columns, {
		onArchiveTask: handleArchiveHotkey,
		onRenameTask: handleRenameHotkey,
	})

	// Mouse-driven focus, set up once for the tab's lifetime. Until the pointer
	// actually moves, focus stays keyboard-driven so cards don't light up from an
	// incidental hover on mount/scroll; once it moves past the threshold we flip the
	// store to 'mouse', after which each card's onMouseEnter lights it up (mirrors the
	// global FocusSourceHandler).
	//
	// Focus is intentionally NOT cleared on unmount: leaving the board for a task and
	// returning should restore the previously focused card (ENG-2749). On remount we
	// re-assert the persisted focus as keyboard-driven so the restored card scrolls
	// into view and isn't immediately stolen by an incidental hover.
	useMountEffect(() => {
		const { focusedTaskId, setFocusedTaskId } = useKanbanFocusStore.getState()
		if (focusedTaskId) setFocusedTaskId(focusedTaskId, 'keyboard')

		const handleMouseMove = createMouseMoveHandler(() => useKanbanFocusStore.getState().enableMouseFocus())
		document.addEventListener('mousemove', handleMouseMove, { passive: true })
		return () => {
			document.removeEventListener('mousemove', handleMouseMove)
		}
	})

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TaskViewControls
				layout="board"
				mode={scope.mode}
				selectedIds={selectedIds}
				users={userOptions}
				taskCount={totalCards}
				grouped={grouped}
				onLayoutChange={setLayout}
				onModeChange={(next) => {
					setMode(next)
					setSelectedUserIds([])
				}}
				onSelectionChange={(next) => setSelectedUserIds(Array.from(next))}
				onGroupedChange={setGrouped}
			/>
			<div className="min-h-0 flex-1">
				<KanbanBoard>
					{columns.map((column) => (
						<KanbanColumn key={column.id} title={column.title} count={column.cards.length}>
							{column.cards.map((card) => {
								const isCurrentUserOwner = !!user?.id && ownerByTaskId.get(card.id) === user.id
								const isAdminNonOwner = isAdmin && !!user?.id && !isCurrentUserOwner
								return (
									<WiredKanbanCard
										key={card.id}
										card={card}
										onArchiveTask={isCurrentUserOwner ? handleArchiveTask : undefined}
										onRenameTask={isCurrentUserOwner ? handleRenameTask : undefined}
										onForceArchiveTask={isAdminNonOwner ? handleForceArchiveTask : undefined}
										onForceRenameTask={isAdminNonOwner ? handleForceRenameTask : undefined}
									/>
								)
							})}
						</KanbanColumn>
					))}
				</KanbanBoard>
			</div>
			<ForceArchiveConfirmDialog
				open={forceArchiveDialog.isOpen}
				onOpenChange={(isOpen) => setForceArchiveDialog((prev) => ({ ...prev, isOpen }))}
				onConfirm={confirmForceArchive}
				onCancel={() => {}}
			/>
			<RenameTaskDialog
				taskId={renameDialog.taskId}
				currentName={renameDialog.name}
				isOpen={renameDialog.isOpen}
				onOpenChange={(isOpen) => setRenameDialog((prev) => ({ ...prev, isOpen }))}
				onSave={handleSaveRename}
				isAdminOverride={renameDialog.isAdminOverride}
			/>
		</div>
	)
}
