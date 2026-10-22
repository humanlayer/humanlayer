import { Check, MessageSquarePlus, Trash2, X } from 'lucide-react'

import { Button } from '../../components/button'
import { KeyboardShortcut } from '../../components/keyboard-shortcut'
import { APPROVE_ACTION, DELETE_ACTION } from '../toolbar/review-actions'
import { SelectionToolbar } from '../toolbar/SelectionToolbar'

export interface ArtifactSelectionToolbarProps {
	selectionToolbar: { rect: DOMRect } | null
	commentSelection: () => void
	dismissSelection: () => void
	submitVerdict: (kind: 'deletion' | 'approval') => void
}

/**
 * Floating selection actions for an active precise/keyboard range or clicked
 * block. Composes the shared `SelectionToolbar` shell with Comment, Approve,
 * Deny, and Dismiss controls (in that order). Approve/Deny dispatch the exact
 * same `submitVerdict` command as the `a`/`d` hotkeys (so mouse and keyboard
 * semantics cannot drift); Comment opens the composer through the same path the
 * `c` key uses; Dismiss clears the pending target. A Pure leaf: receives the
 * view-model fields as props (one-hop) from the Wired `ArtifactViewerV2` in each
 * app and forwards them straight to the design-system controls.
 */
export function ArtifactSelectionToolbar({
	selectionToolbar,
	commentSelection,
	dismissSelection,
	submitVerdict,
}: ArtifactSelectionToolbarProps) {
	if (!selectionToolbar) return null
	return (
		<SelectionToolbar rect={selectionToolbar.rect}>
			<Button variant="ghost" size="sm" onClick={commentSelection}>
				<MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
				Comment
				<KeyboardShortcut size="xs" className="ml-1">
					C
				</KeyboardShortcut>
			</Button>
			<Button variant="ghost" size="sm" onClick={() => submitVerdict('approval')}>
				<Check className="mr-1 h-3.5 w-3.5" />
				{APPROVE_ACTION.label}
				<KeyboardShortcut size="xs" className="ml-1">
					{APPROVE_ACTION.hotkey.toUpperCase()}
				</KeyboardShortcut>
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="text-destructive hover:text-destructive"
				onClick={() => submitVerdict('deletion')}
			>
				<Trash2 className="mr-1 h-3.5 w-3.5" />
				{DELETE_ACTION.label}
				<KeyboardShortcut size="xs" className="ml-1">
					{DELETE_ACTION.hotkey.toUpperCase()}
				</KeyboardShortcut>
			</Button>
			<Button variant="ghost" size="icon" aria-label="Dismiss selection" onClick={dismissSelection}>
				<X className="h-3.5 w-3.5" />
			</Button>
		</SelectionToolbar>
	)
}
