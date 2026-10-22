import type { CommentThreadBucket } from './comment-visibility'
import type { ProjectedCommentThread } from './project-comments'

/**
 * Pure deep-link reveal policy for Artifact Viewer V2 (Phase 4).
 *
 * The app route adapters own URL parsing and writes; this module owns only the
 * decision: given a linked comment ID and the controller's CURRENT projected
 * threads, what must the viewer do to reveal it once? It never resolves anchors
 * again — placement facts come from the projection snapshot — and it never
 * distinguishes deleted, unknown, and unauthorized IDs (all three are simply
 * absent from the projection), so an unavailable result leaks no data.
 */

export interface CommentDeepLinkFacts {
	/** Open (unresolved) projected threads, in document order. */
	threads: ProjectedCommentThread[]
	/** Resolved projected threads from the same snapshot. */
	resolvedThreads: ProjectedCommentThread[]
}

export type CommentDeepLinkDecision =
	| {
			/** The ID names no visible root or reply: deleted, unknown, or unauthorized. */
			status: 'unavailable'
	  }
	| {
			status: 'reveal'
			/** The thread root that hosts the target (reply IDs normalize to their root). */
			rootId: string
			/** The linked reply to emphasize, or null when the link named the root. */
			replyId: string | null
			/** Live placements only exist in Rendered; the host must switch before revealing. */
			requiredMode: 'rendered'
			/** The completion bucket holding this thread; the rail keeps any filter that includes it. */
			visibility: CommentThreadBucket
			/**
			 * Open roots with an exact or approximate document location scroll the
			 * document; everything else scrolls its rail card.
			 */
			scrollTarget: 'document' | 'rail'
			/** The thread's projected state, for callers that report or trace the reveal. */
			threadState: 'open' | 'outdated' | 'resolved'
	  }

interface ThreadMatch {
	thread: ProjectedCommentThread
	replyId: string | null
}

function findThread(threads: ProjectedCommentThread[], targetId: string): ThreadMatch | null {
	for (const thread of threads) {
		if (thread.root.id === targetId) return { thread, replyId: null }
		const reply = thread.replies.find((candidate) => candidate.id === targetId)
		if (reply) return { thread, replyId: reply.id }
	}
	return null
}

/** Decide the one-shot reveal for a linked root or reply ID. */
export function decideCommentDeepLink(
	commentId: string,
	facts: CommentDeepLinkFacts,
): CommentDeepLinkDecision {
	const targetId = commentId.trim()
	if (!targetId) return { status: 'unavailable' }

	const open = findThread(facts.threads, targetId)
	if (open) {
		const anchored = open.thread.placement.status === 'resolved'
		const located = anchored || open.thread.approximate != null
		return {
			status: 'reveal',
			rootId: open.thread.root.id,
			replyId: open.replyId,
			requiredMode: 'rendered',
			visibility: 'open',
			// A reply card only exists in the rail. A root link scrolls the document
			// to its exact or approximate location when it has one.
			scrollTarget: located && open.replyId == null ? 'document' : 'rail',
			threadState: anchored ? 'open' : 'outdated',
		}
	}

	const resolved = findThread(facts.resolvedThreads, targetId)
	if (resolved) {
		return {
			status: 'reveal',
			rootId: resolved.thread.root.id,
			replyId: resolved.replyId,
			requiredMode: 'rendered',
			visibility: 'resolved',
			scrollTarget: 'rail',
			threadState: 'resolved',
		}
	}

	return { status: 'unavailable' }
}

/** The short one-shot emphasis class; `revealDeepLinkTarget` removes it again. */
export const DEEP_LINK_EMPHASIS_CLASS = 'artifact-viewer-v2-deep-link-emphasis'
/** How long the emphasis stays. Bounds the non-animated reduced-motion form too. */
export const DEEP_LINK_EMPHASIS_MS = 2000

/** Reduced motion preference; false when `matchMedia` is unavailable (tests). */
export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false
}

/**
 * Scroll a reveal target into view and apply one short emphasis. Reduced motion
 * uses deterministic (non-smooth) placement; the class removal below bounds the
 * reduced-motion static form so no lasting selected style remains.
 */
export function revealDeepLinkTarget(element: HTMLElement): void {
	element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
	element.classList.remove(DEEP_LINK_EMPHASIS_CLASS)
	// Force a reflow so re-revealing the same element restarts the CSS animation.
	void element.offsetWidth
	element.classList.add(DEEP_LINK_EMPHASIS_CLASS)
	window.setTimeout(() => element.classList.remove(DEEP_LINK_EMPHASIS_CLASS), DEEP_LINK_EMPHASIS_MS)
}
