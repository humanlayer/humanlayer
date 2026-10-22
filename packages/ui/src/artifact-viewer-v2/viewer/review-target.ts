import type { CommentKind } from '../anchor/types'
import type { NavigableBlock } from './build-navigable-blocks'
import type { KeyboardRangeState } from './keyboard-range'
import type { SelectionIntent, SelectionResult } from './selection'

export type ReviewTarget =
	| { kind: 'block'; blockId: string; from: number; to: number }
	| { kind: 'range'; owner: 'mouse'; intent: SelectionIntent }
	| { kind: 'range'; owner: 'browser-keyboard'; intent: SelectionIntent }
	| { kind: 'range'; owner: 'keyboard'; intent: SelectionIntent; keyboard: KeyboardRangeState }

export type ReviewTargetState =
	| { phase: 'idle' }
	| { phase: 'pending'; target: ReviewTarget }
	| { phase: 'composing'; target: ReviewTarget }

export type ReviewTargetDecoration =
	| { kind: 'keep' }
	| { kind: 'clear' }
	| { kind: 'range'; from: number; to: number }

/**
 * An explicit "persist this now" command emitted by an instant typed verdict.
 * The app adapter derives the anchor from `target` and persists the canonical
 * verdict content — the target module owns *which* target and *what* kind, the
 * adapter owns persistence, decorations, and focus continuity.
 */
export interface ReviewSubmitCommand {
	target: ReviewTarget
	kind: CommentKind
}

export interface ReviewTargetOutcome {
	state: ReviewTargetState
	decoration: ReviewTargetDecoration
	/** Whether this transition consumed an Escape/dismiss attempt. */
	consumed: boolean
	/** Present only for an instant verdict: persist this target with this kind. */
	submit?: ReviewSubmitCommand
}

export type ReviewTargetEvent =
	| { type: 'accept-block'; block: Pick<NavigableBlock, 'id' | 'pos' | 'end'> }
	| { type: 'accept-selection'; result: SelectionResult; source?: 'mouse' | 'keyboard' }
	| {
			type: 'accept-keyboard'
			result:
				| { status: 'valid'; keyboard: KeyboardRangeState; intent: SelectionIntent }
				| { status: 'invalid' }
	  }
	| { type: 'open-composer'; fallbackBlock?: Pick<NavigableBlock, 'id' | 'pos' | 'end'> }
	| { type: 'close-composer' }
	| { type: 'submit-verdict'; kind: CommentKind; fallbackBlock?: Pick<NavigableBlock, 'id' | 'pos' | 'end'> }
	| { type: 'dismiss' }
	| { type: 'submitted' }
	| { type: 'fold'; hiddenBlockIds: ReadonlySet<string>; hiddenRanges: readonly TargetRange[] }

export interface TargetRange {
	from: number
	to: number
}

export const idleReviewTarget = (): ReviewTargetState => ({ phase: 'idle' })

const outcome = (
	state: ReviewTargetState,
	decoration: ReviewTargetDecoration,
	consumed = false,
): ReviewTargetOutcome => ({ state, decoration, consumed })

const targetDecoration = (target: ReviewTarget): ReviewTargetDecoration =>
	target.kind === 'block'
		? { kind: 'range', from: target.from, to: target.to }
		: { kind: 'range', from: target.intent.from, to: target.intent.to }

function targetIsHidden(
	target: ReviewTarget,
	hiddenBlockIds: ReadonlySet<string>,
	hiddenRanges: readonly TargetRange[],
): boolean {
	if (target.kind === 'block') return hiddenBlockIds.has(target.blockId)
	return hiddenRanges.some((hidden) => target.intent.from < hidden.to && target.intent.to > hidden.from)
}

/**
 * The complete review-target transition interface. React stores only the
 * returned discriminated state; ProseMirror applies only the decoration
 * outcome. This keeps ownership, replacement, composer, dismiss, and fold
 * policy independent from either adapter.
 */
export function transitionReviewTarget(state: ReviewTargetState, event: ReviewTargetEvent): ReviewTargetOutcome {
	switch (event.type) {
		case 'accept-block': {
			const target: ReviewTarget = {
				kind: 'block',
				blockId: event.block.id,
				from: event.block.pos,
				to: event.block.end,
			}
			return outcome({ phase: 'pending', target }, targetDecoration(target))
		}
		case 'accept-selection': {
			if (state.phase === 'composing') return outcome(state, { kind: 'keep' })
			if (event.result.status === 'selection') {
				const target: ReviewTarget = {
					kind: 'range',
					owner: event.source === 'keyboard' ? 'browser-keyboard' : 'mouse',
					intent: event.result.intent,
				}
				return outcome({ phase: 'pending', target }, targetDecoration(target))
			}
			// Collapsing the browser selection is an implementation detail while a
			// keyboard range owns the target; it must not clear that target.
			if (state.phase === 'pending' && state.target.kind === 'range' && state.target.owner === 'keyboard') {
				return outcome(state, { kind: 'keep' })
			}
			return state.phase === 'idle' ? outcome(state, { kind: 'keep' }) : outcome(idleReviewTarget(), { kind: 'clear' })
		}
		case 'accept-keyboard': {
			// Invalid construction is a real rejection, not a keyboard target with
			// no visible intent. Clear any previous target to prevent stale leakage.
			if (event.result.status === 'invalid') return outcome(idleReviewTarget(), { kind: 'clear' })
			const target: ReviewTarget = {
				kind: 'range',
				owner: 'keyboard',
				intent: event.result.intent,
				keyboard: event.result.keyboard,
			}
			return outcome({ phase: 'pending', target }, targetDecoration(target))
		}
		case 'open-composer': {
			if (state.phase === 'composing') return outcome(state, { kind: 'keep' })
			if (state.phase === 'pending') return outcome({ phase: 'composing', target: state.target }, { kind: 'keep' })
			if (!event.fallbackBlock) return outcome(state, { kind: 'keep' })
			const target: ReviewTarget = {
				kind: 'block',
				blockId: event.fallbackBlock.id,
				from: event.fallbackBlock.pos,
				to: event.fallbackBlock.end,
			}
			return outcome({ phase: 'composing', target }, targetDecoration(target))
		}
		case 'close-composer': {
			if (state.phase !== 'composing') return outcome(state, { kind: 'keep' })
			return outcome({ phase: 'pending', target: state.target }, { kind: 'keep' }, true)
		}
		case 'submit-verdict': {
			// A stored target is exact, whether it came from a range or a block whose
			// composer was closed. Pointer-driven focus must not redirect the verdict.
			if (state.phase !== 'idle') {
				return {
					state: idleReviewTarget(),
					decoration: { kind: 'clear' },
					consumed: false,
					submit: { target: state.target, kind: event.kind },
				}
			}
			// With no stored target, the focused block is the keyboard fallback.
			if (event.fallbackBlock) {
				const target: ReviewTarget = {
					kind: 'block',
					blockId: event.fallbackBlock.id,
					from: event.fallbackBlock.pos,
					to: event.fallbackBlock.end,
				}
				return {
					state: idleReviewTarget(),
					decoration: { kind: 'keep' },
					consumed: false,
					submit: { target, kind: event.kind },
				}
			}
			return outcome(state, { kind: 'keep' })
		}
		case 'dismiss':
		case 'submitted':
			return state.phase === 'idle'
				? outcome(state, { kind: 'keep' })
				: outcome(idleReviewTarget(), { kind: 'clear' }, event.type === 'dismiss')
		case 'fold':
			if (state.phase === 'idle' || !targetIsHidden(state.target, event.hiddenBlockIds, event.hiddenRanges)) {
				return outcome(state, { kind: 'keep' })
			}
			return outcome(idleReviewTarget(), { kind: 'clear' })
	}
}
