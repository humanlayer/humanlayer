import { Table, TableBody, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { type FC, type ReactNode, useEffect, useRef, useState } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import type { OrgMember } from '@/hooks/useOrgMembers'

import { cn } from '../../lib/utils'
import { ArchivedSessionsEmptyState } from './ArchivedSessionsEmptyState'
import { SessionsEmptyState } from './SessionsEmptyState'
import { SessionTableRow } from './SessionTableRow'
import { getSessionStatusClass, getSessionStatusDisplay, type TableSession } from './types'
import { type SessionFocusCursor, WiredSessionTableRow } from './WiredSessionTableRow'

export interface SessionTableProps {
	sessions: TableSession[]
	/** Controlled focus is reserved for provider-free demos. App callers omit this for store-backed rows. */
	focusedSessionId?: string | null
	/** Selects the store cursor for app-backed rows. */
	focusCursor?: SessionFocusCursor

	// View mode
	isArchivedView?: boolean
	isDraftsView?: boolean
	hideTaskColumn?: boolean
	compactMode?: boolean

	// Inline editing (controlled from outside)
	editingSessionId?: string | null
	onEditingChange?: (sessionId: string | null) => void

	// Navigation callbacks
	onFocusSession: (session: TableSession) => void
	onBlurSession: () => void
	onActivateSession: (session: TableSession) => void
	onActivateDraft?: (session: TableSession) => void

	// Action callbacks
	onSaveTitle: (sessionId: string, newTitle: string) => void
	/** Called when user clicks Archive in row menu - receives session data */
	onOpenArchiveDialog?: (session: TableSession) => void
	/** Called when user clicks Bypass Permissions in row menu - receives session data */
	onOpenBypassDialog?: (session: TableSession) => void

	// Empty state callbacks
	onCreateSession?: () => void
	onOpenCommandPalette?: () => void
	onNavigateToSessions?: () => void

	/** Hide share link action on session rows (when parent task is not shared with org) */
	isShareLinkHidden?: boolean
	/** Hide archive action in session row menu (for shared tasks viewed by non-owners) */
	isArchiveActionHidden?: boolean
	/** Hide bypass permissions action in session row menu (for shared tasks viewed by non-owners) */
	isBypassActionHidden?: boolean

	/** Show "Created By" column with user avatar and name (for shared tasks) */
	showCreatedBy?: boolean

	/** Map of org members keyed by user id. Required when `showCreatedBy` is true so rows can render avatar/name. */
	orgMembers?: Map<string, OrgMember>

	// Styling
	className?: string
	stickyHeader?: boolean
}

// Default formatters
const defaultRenderSessionStatus = (session: TableSession): ReactNode => {
	return <span className={getSessionStatusClass(session.status)}>{getSessionStatusDisplay(session.status)}</span>
}

export const SessionTable: FC<SessionTableProps> = ({
	sessions,
	focusedSessionId,
	focusCursor = 'session',
	isArchivedView = false,
	isDraftsView = false,
	hideTaskColumn = false,
	compactMode = false,
	editingSessionId: externalEditingSessionId,
	onEditingChange,
	onFocusSession,
	onBlurSession,
	onActivateSession,
	onActivateDraft,
	onSaveTitle,
	onOpenArchiveDialog,
	onOpenBypassDialog,
	onCreateSession,
	onOpenCommandPalette,
	onNavigateToSessions,
	isShareLinkHidden = false,
	isArchiveActionHidden = false,
	isBypassActionHidden = false,
	showCreatedBy = false,
	orgMembers,
	className,
	stickyHeader = false,
}) => {
	const rootRef = useRef<HTMLDivElement>(null)
	const isStoreBacked = focusedSessionId === undefined

	// Internal state for inline editing (used when not controlled externally)
	const [internalEditingSessionId, setInternalEditingSessionId] = useState<string | null>(null)
	const [editValue, setEditValue] = useState('')
	const [prevEditingSessionId, setPrevEditingSessionId] = useState<string | null | undefined>(
		externalEditingSessionId,
	)

	// Use external editing state if provided, otherwise use internal
	const editingSessionId =
		externalEditingSessionId !== undefined ? externalEditingSessionId : internalEditingSessionId
	const setEditingSessionId = (sessionId: string | null) => {
		if (onEditingChange) {
			onEditingChange(sessionId)
		} else {
			setInternalEditingSessionId(sessionId)
		}
	}

	// Initialize edit value when external editing session changes (adjust state during render)
	if (externalEditingSessionId !== prevEditingSessionId) {
		setPrevEditingSessionId(externalEditingSessionId)
		if (externalEditingSessionId) {
			const session = sessions.find((s) => s.id === externalEditingSessionId)
			if (session) {
				setEditValue(session.title || session.summary || '')
			}
		}
	}

	// Controlled demos still scroll from their local focus value.
	useEffect(() => {
		if (!isStoreBacked && focusedSessionId && rootRef.current) {
			const focusedRow = Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-session-id]')).find(
				(row) => row.dataset.sessionId === focusedSessionId,
			)
			if (focusedRow) {
				focusedRow.scrollIntoView({ behavior: 'auto', block: 'nearest' })
			}
		}
	}, [focusedSessionId, isStoreBacked])

	// App tables observe focus imperatively so cursor movement never renders the
	// table owner. Mount-scoped: `isStoreBacked` and `focusCursor` are mode
	// configuration fixed for the life of a mounted table.
	useMountEffect(() => {
		if (!isStoreBacked) return

		return useFocusStore.subscribe((state, previousState) => {
			const nextId = focusCursor === 'archived-session' ? state.focusedArchivedSessionId : state.focusedSessionId
			const previousId =
				focusCursor === 'archived-session'
					? previousState.focusedArchivedSessionId
					: previousState.focusedSessionId
			if (state.focusSource !== 'keyboard' || !nextId || nextId === previousId || !rootRef.current) {
				return
			}

			const focusedRow = Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-session-id]')).find(
				(row) => row.dataset.sessionId === nextId,
			)
			focusedRow?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
		})
	})

	const startEdit = (sessionId: string, currentTitle: string) => {
		setEditingSessionId(sessionId)
		setEditValue(currentTitle)
	}

	const saveEdit = () => {
		if (editingSessionId) {
			onSaveTitle(editingSessionId, editValue)
			setEditingSessionId(null)
			setEditValue('')
		}
	}

	const cancelEdit = () => {
		setEditingSessionId(null)
		setEditValue('')
	}

	const handleRowClick = (session: TableSession) => {
		if (session.status === 'draft' && onActivateDraft) {
			onActivateDraft(session)
		} else {
			onActivateSession(session)
		}
	}

	if (sessions.length === 0) {
		if (isArchivedView) {
			return <ArchivedSessionsEmptyState onNavigateBack={onNavigateToSessions} />
		}
		if (isDraftsView) {
			return null
		}
		return <SessionsEmptyState onCreateSession={onCreateSession} onOpenCommandPalette={onOpenCommandPalette} />
	}

	return (
		<div ref={rootRef} className={cn('h-full flex flex-col', className)}>
			<div className="flex-1 min-h-0 overflow-auto">
				<Table>
					<TableHeader className={stickyHeader ? 'sticky top-0 bg-background z-10' : ''}>
						<TableRow>
							{!isDraftsView && <TableHead className="pl-16">Status</TableHead>}
							<TableHead className={isDraftsView ? 'pl-16' : ''}>Title</TableHead>
							{!isDraftsView && <TableHead>Labels</TableHead>}
							{!hideTaskColumn && <TableHead>Task</TableHead>}
							{showCreatedBy && <TableHead>Created By</TableHead>}
							{!compactMode && <TableHead>Working Directory</TableHead>}
							{!compactMode && <TableHead>Updated</TableHead>}
							{!isArchivedView && <TableHead className="w-[40px]" />}
						</TableRow>
					</TableHeader>
					<TableBody>
						{sessions.map((session) => {
							const rowProps = {
								session,
								isDraftsView,
								hideTaskColumn,
								showCreatedBy,
								compactMode,
								orgMembers,
								hideActionMenu: isArchivedView,
								isShareLinkHidden,
								isEditing: editingSessionId === session.id,
								editValue: editingSessionId === session.id ? editValue : '',
								onEditChange: setEditValue,
								onEditSave: saveEdit,
								onEditCancel: cancelEdit,
								onStartEdit: () => startEdit(session.id, session.title || session.summary || ''),
								onRowClick: () => handleRowClick(session),
								onRowMouseEnter: () => onFocusSession(session),
								onRowMouseLeave: onBlurSession,
								onOpenArchiveDialog: () => onOpenArchiveDialog?.(session),
								onOpenBypassDialog: () => onOpenBypassDialog?.(session),
								isArchiveActionHidden,
								isBypassActionHidden,
								renderSessionStatus: defaultRenderSessionStatus,
							}

							return isStoreBacked ? (
								<WiredSessionTableRow key={session.id} {...rowProps} focusCursor={focusCursor} />
							) : (
								<SessionTableRow
									key={session.id}
									{...rowProps}
									isFocused={focusedSessionId === session.id}
								/>
							)
						})}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

// Export a ref-based API for external control of editing
export interface SessionTableHandle {
	startEdit: (sessionId: string, currentTitle: string) => void
	cancelEdit: () => void
	isEditing: () => boolean
	getEditingSessionId: () => string | null
}
