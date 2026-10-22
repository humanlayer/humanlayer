import type { CommentKind } from '../anchor/types'

/**
 * One typed instant-verdict action. Delete and Approve are the complete typed
 * review vocabulary beyond free-form Comment; both persist a fixed `kind` and a
 * canonical body (never inferred from prose) at the current review target.
 *
 * Descriptors are the single source shared by the floating toolbar buttons and
 * the keyboard commands so mouse and keyboard semantics cannot drift. They are
 * intentionally free of emoji or rendered markup — presentation lives in the
 * button components, semantics live here.
 */
export interface ReviewActionDescriptor {
	/** Stable action ID (never localized). */
	id: 'delete' | 'approve'
	/** The single-key hotkey in the target-active review scope. */
	hotkey: 'd' | 'a'
	/** The persisted comment kind. */
	kind: Extract<CommentKind, 'deletion' | 'approval'>
	/** Canonical persisted body text for the verdict. */
	contentText: string
	/** Accessible/visible label. */
	label: string
}

export const DELETE_ACTION: ReviewActionDescriptor = {
	id: 'delete',
	hotkey: 'd',
	kind: 'deletion',
	contentText: 'Delete this',
	label: 'Delete',
}

export const APPROVE_ACTION: ReviewActionDescriptor = {
	id: 'approve',
	hotkey: 'a',
	kind: 'approval',
	contentText: 'Looks good',
	label: 'Approve',
}

/** All typed verdict actions in toolbar order. */
export const REVIEW_ACTIONS: readonly ReviewActionDescriptor[] = [DELETE_ACTION, APPROVE_ACTION]
