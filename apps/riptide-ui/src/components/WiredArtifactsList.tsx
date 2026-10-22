import { useLocalStorage } from '@uidotdev/usehooks'
import { type FC, useCallback, useRef } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArtifactCommentCounts } from '@/hooks/live-queries/useArtifactCommentCounts'
import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { useArtifactListFocusStore } from '@/hooks/stores/artifactListFocusStore'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { ARTIFACTS_GROUP_BY_TYPE_KEY } from '@/lib/preferences'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

import { ArtifactContextMenu } from './ArtifactContextMenu'
import { ArtifactsListPure } from './ArtifactsListPure'
import { TrashDropdown } from './TrashDropdown'

export interface WiredArtifactsListProps {
	artifacts: SessionArtifact[]
	onArtifactClick: (artifactId: string) => void
	className?: string
	taskId: string
	/** Always supplied by the live caller; `undefined` when the viewer's identity is not yet known. */
	currentUserId: string | undefined
	deletedArtifacts: TaskArtifact[]
	/** Always supplied by the live caller; `undefined` when no trash affordance is wired. */
	onDeletedArtifactClick: ((artifactId: string) => void) | undefined
	/**
	 * When true, artifacts are segmented by read/write/edit category headers.
	 * When false, artifacts are shown as a flat list without category headers.
	 */
	segmentByReadWriteEdit: boolean
	/** When true, the current user can delete any artifact in this list (e.g. task edit access). */
	canDeleteAnyArtifact: boolean | undefined
}

export const WiredArtifactsList: FC<WiredArtifactsListProps> = ({
	artifacts,
	onArtifactClick,
	className,
	taskId,
	currentUserId,
	deletedArtifacts,
	onDeletedArtifactClick,
	segmentByReadWriteEdit,
	canDeleteAnyArtifact,
}) => {
	const commentCounts = useArtifactCommentCounts(artifacts)
	// Global preference: group artifacts by frontmatter document type instead of read/write status
	const [groupByFrontmatterType, setGroupByFrontmatterType] = useLocalStorage<boolean>(
		ARTIFACTS_GROUP_BY_TYPE_KEY,
		false,
	)
	const selectedArtifactId = useArtifactViewerStore((state) => state.selectedArtifactId)
	const listRootRef = useRef<HTMLDivElement | null>(null)
	const listStructureKey = `${artifacts.map((artifact) => artifact.id).join('\u0000')}:${String(
		segmentByReadWriteEdit,
	)}:${String(groupByFrontmatterType)}`

	const artifactIdsInVisualOrder = useCallback((): string[] => {
		if (!listRootRef.current) return []
		return Array.from(listRootRef.current.querySelectorAll<HTMLElement>('[data-artifact-list-row-id]'))
			.map((row) => row.dataset.artifactListRowId)
			.filter((id): id is string => Boolean(id))
	}, [])

	const setListRoot = useCallback(
		(node: HTMLDivElement | null) => {
			listRootRef.current = node
			if (!node) {
				useArtifactListFocusStore.getState().clearFocus()
				return
			}
			// The key deliberately invalidates this callback ref when list membership,
			// grouping, or segmentation changes; reconcile after the new DOM commits.
			void listStructureKey
			useArtifactListFocusStore.getState().reconcileArtifactIds(artifactIdsInVisualOrder())
		},
		[artifactIdsInVisualOrder, listStructureKey],
	)

	const listInteractiveChildOwnsKeyboard = useCallback((event: KeyboardEvent): boolean => {
		const root = listRootRef.current
		const activeElement = event.view?.document.activeElement ?? document.activeElement
		if (activeElement instanceof HTMLElement && activeElement.hasAttribute('data-artifact-list-row-id')) {
			return false
		}
		return Boolean(
			root &&
			activeElement instanceof HTMLElement &&
			root.contains(activeElement) &&
			activeElement.matches('button, a, input, textarea, select, [contenteditable="true"], [role="button"]'),
		)
	}, [])

	const moveCursor = useCallback(
		(direction: 'next' | 'previous') => {
			const artifactIds = artifactIdsInVisualOrder()
			const store = useArtifactListFocusStore.getState()
			if (direction === 'next') store.focusNext(artifactIds)
			else store.focusPrevious(artifactIds)

			const nextId = useArtifactListFocusStore.getState().focusedArtifactId
			const nextIndex = useArtifactListFocusStore.getState().focusedArtifactIndex
			const nextRow = Array.from(
				listRootRef.current?.querySelectorAll<HTMLElement>('[data-artifact-list-row-id]') ?? [],
			).find(
				(row) =>
					row.dataset.artifactListRowId === nextId && Number(row.dataset.artifactListRowIndex) === nextIndex,
			)
			nextRow?.scrollIntoView({ block: 'nearest' })
			nextRow?.focus({ preventScroll: true })
		},
		[artifactIdsInVisualOrder],
	)

	const handleArtifactPointerDown = useCallback(
		(artifactId: string, index: number) => {
			if (artifactIdsInVisualOrder()[index] === artifactId) {
				useArtifactListFocusStore.getState().setFocusedArtifact(artifactId, index, 'pointer')
			}
		},
		[artifactIdsInVisualOrder],
	)
	const handleArtifactPointerEnter = useCallback(
		(artifactId: string, index: number) => {
			handleArtifactPointerDown(artifactId, index)
			useFocusStore.getState().focusRightPane()
		},
		[handleArtifactPointerDown],
	)

	const handleArtifactOpen = useCallback(
		(artifactId: string) => {
			useArtifactListFocusStore.getState().clearFocus()
			onArtifactClick(artifactId)
		},
		[onArtifactClick],
	)

	const listHotkeyOptions = {
		area: 'RIGHT_PANE' as const,
		scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.TASK_DETAIL],
		enabled: selectedArtifactId === null,
		preventDefault: true,
		ignoreEventWhen: listInteractiveChildOwnsKeyboard,
	}

	useAppHotkeys('j', () => moveCursor('next'), listHotkeyOptions)
	useAppHotkeys('k', () => moveCursor('previous'), listHotkeyOptions)
	useAppHotkeys(
		'enter',
		(event) => {
			const { focusedArtifactId: artifactId, focusedArtifactIndex: artifactIndex } =
				useArtifactListFocusStore.getState()
			if (artifactId && artifactIndex !== null && artifactIdsInVisualOrder()[artifactIndex] === artifactId) {
				event.preventDefault()
				handleArtifactOpen(artifactId)
			}
		},
		{ ...listHotkeyOptions, preventDefault: false },
	)

	return (
		<div ref={setListRoot} className="contents">
			<ArtifactsListPure
				artifacts={artifacts}
				focusCursor="artifact-list"
				onArtifactClick={handleArtifactOpen}
				onArtifactPointerDown={handleArtifactPointerDown}
				onArtifactPointerEnter={handleArtifactPointerEnter}
				className={className}
				segmentByReadWriteEdit={segmentByReadWriteEdit}
				groupByFrontmatterType={groupByFrontmatterType}
				onGroupByFrontmatterTypeChange={setGroupByFrontmatterType}
				commentCounts={commentCounts}
				footerActions={
					deletedArtifacts.length > 0 ? (
						<TrashDropdown
							artifacts={deletedArtifacts}
							onArtifactClick={(id) => onDeletedArtifactClick?.(id)}
						/>
					) : null
				}
				attachMenu={(artifact, button) => {
					const isOwner = artifact.resourceOwnerUserId === currentUserId
					const canDelete = isOwner || !!canDeleteAnyArtifact
					return (
						<ArtifactContextMenu
							artifactId={artifact.id}
							taskId={taskId}
							fileName={artifact.path.split('/').pop() ?? ''}
							filePath={artifact.path}
							shareKey={artifact.shareKey}
							shareEnabled={artifact.shareEnabled ?? false}
							isOwner={isOwner}
							canDelete={canDelete}
						>
							{button}
						</ArtifactContextMenu>
					)
				}}
			/>
		</div>
	)
}
