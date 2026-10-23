import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import type { TaskDiffReviewModel } from '@/hooks/diffs/useTaskDiffReviewModel'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useTaskDiffReviewStore } from '@/hooks/stores/taskDiffReviewStore'

import type { DiffFeedbackDeliveryTarget } from './delivery/use-diff-feedback-delivery'
import { TaskDiffReviewWorkspace } from './TaskDiffReviewWorkspace'

interface DiffFullscreenReviewProps {
	model: TaskDiffReviewModel
	deliveryTarget?: DiffFeedbackDeliveryTarget
}

export function DiffFullscreenReview({ model, deliveryTarget }: DiffFullscreenReviewProps) {
	const setFullscreenDialogOpen = useTaskDiffReviewStore((state) => state.setFullscreenDialogOpen)
	const openDialog = useCallback(
		(dialog: HTMLDialogElement | null) => {
			if (!dialog) return
			if (!dialog.open) {
				dialog.showModal()
				// showModal otherwise focuses the first tree row and steals the initial
				// keyboard owner from the center editor.
				dialog
					.querySelector<HTMLElement>('[data-fullscreen-diff-pane="editor"]')
					?.focus({ preventScroll: true })
			}
			setFullscreenDialogOpen(true)
			return () => setFullscreenDialogOpen(false)
		},
		[setFullscreenDialogOpen],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.DIFF_FULLSCREEN}
			isActive={model.activePresentation === 'fullscreen'}
			rootScopeDisabled
			componentName="DiffFullscreenReview"
		>
			<dialog
				ref={openDialog}
				data-diff-review-root
				data-focus-area={FOCUSED_AREAS.RIGHT_PANE}
				data-right-pane-focus-surface="fullscreen"
				tabIndex={-1}
				// Native drag regions on the covered page still participate in window
				// hit testing. Exclude the review surface so its controls receive clicks.
				className="fixed inset-0 z-[60] m-0 flex h-auto max-h-none w-auto max-w-none min-h-0 min-w-0 border-0 bg-background p-0 text-foreground [-webkit-app-region:no-drag]"
				aria-label="Fullscreen task diff review"
				onCancel={(event) => {
					event.preventDefault()
					model.closeFullscreen()
				}}
			>
				<TaskDiffReviewWorkspace
					model={model}
					onClose={model.closeFullscreen}
					isFullscreen
					showFileTree
					onFullscreenToggle={model.closeFullscreen}
					deliveryTarget={deliveryTarget}
				/>
			</dialog>
		</HotkeyScopeBoundary>
	)
}
